// https://dev.to/marcogrcr/type-safe-eventtarget-subclasses-in-typescript-1nkf
export type TypedEventTarget<EventMap extends object> = {
  new (): IntermediateEventTarget<EventMap>;
};

// internal helper type
interface IntermediateEventTarget<EventMap> extends EventTarget {
  addEventListener<K extends keyof EventMap>(
    type: K,
    callback: (
      event: EventMap[K] extends Event ? EventMap[K] : never,
    ) => EventMap[K] extends Event ? void : never,
    options?: AddEventListenerOptions | boolean,
  ): void;

  addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ): void;

  removeEventListener<K extends keyof EventMap>(
    type: K,
    callback: (
      event: EventMap[K] extends Event ? EventMap[K] : never,
    ) => EventMap[K] extends Event ? void : never,
    options?: EventListenerOptions | boolean,
  ): void;

  removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean,
  ): void;
}

type StoredValue = {
  value: string | null;
  timestamp: Date | null;
};

type StoredValueSerialized = {
  value: string | null;
  timestamp: string | null;
};

export type BroadcastChannelStorageMessage =
  | {
      type: 'request';
    }
  | {
      type: 'values';
      payload: Record<string, StoredValueSerialized>;
    }
  | {
      type: 'clear';
    }
  | {
      type: 'set';
      payload: {
        key: string;
        value: string;
        timestamp: string;
      };
    }
  | {
      type: 'remove';
      payload: {
        key: string;
        timestamp: string;
      };
    };

export type BroadcastChannelStorageOptions = {
  /** Name for the broadcast-channel, default is "__broadcast_channel-storage" */
  channelName?: string;
  /** Timeout cutoff to get a response from channel */
  responseTimeoutMs?: number;
  /** initial data */
  initialData?: Record<string, string | null>;
};

const DEFAULT_CHANNEL_NAME = '__broadcast_channel-storage';
const DEFAULT_RESPONSE_TIMEOUT = 50;

export class BroadcastChannelStorage extends (EventTarget as TypedEventTarget<{
  storage: StorageEvent;
}>) {
  private _options;
  private _channel: BroadcastChannel;
  private _storedValues: Map<string, StoredValue> = new Map();
  private _initPromise: Promise<void>;
  private _channelListener: { cancel: () => void } | null = null;
  private _listeners: {
    type: string;
    callback: EventListenerOrEventListenerObject;
  }[] = [];

  constructor(options: BroadcastChannelStorageOptions = {}) {
    super();
    const {
      channelName = DEFAULT_CHANNEL_NAME,
      responseTimeoutMs = DEFAULT_RESPONSE_TIMEOUT,
      initialData = {},
    } = options;
    this._options = {
      channelName,
      responseTimeoutMs,
    };
    for (const key in initialData) {
      this._storedValues.set(key, {
        value: initialData[key] ?? null,
        timestamp: null,
      });
    }
    this._channel = new BroadcastChannel(this._options.channelName);
    this._initPromise = this._init();
  }

  async getItem(key: string) {
    if (typeof key !== 'string' || key.length === 0) {
      throw new Error('invalid key');
    }
    await this._initPromise;
    const value = this._storedValues.get(key)?.value || null;
    return value;
  }

  async setItem(key: string, value: string) {
    if (typeof key !== 'string' || key.length === 0) {
      throw new Error('invalid key');
    }
    await this._initPromise;
    const newValue = {
      value,
      timestamp: new Date(),
    };
    const oldValue = this._storedValues.get(key) || {
      value: null,
      timestamp: null,
    };
    if (newValue.value === oldValue.value) return;
    this._storedValues.set(key, newValue);
    this._postMessage({
      type: 'set',
      payload: {
        key,
        value,
        timestamp: newValue.timestamp.toISOString(),
      },
    });
  }

  async removeItem(key: string) {
    if (typeof key !== 'string' || key.length === 0) {
      throw new Error('invalid key');
    }
    await this._initPromise;
    const newValue = {
      value: null,
      timestamp: new Date(),
    };
    const oldValue = this._storedValues.get(key) || {
      value: null,
      timestamp: null,
    };
    if (newValue.value === oldValue.value) return;
    this._storedValues.delete(key);
    this._postMessage({
      type: 'remove',
      payload: {
        key,
        timestamp: newValue.timestamp.toISOString(),
      },
    });
  }

  async clear() {
    await this._initPromise;
    this._storedValues.clear();
    this._postMessage({
      type: 'clear',
    });
  }

  destroy() {
    this._channelListener?.cancel();
    this._channel.close();
    for (const { type, callback } of this._listeners) {
      super.removeEventListener(type, callback);
    }
    this._listeners = [];
  }

  async sync() {
    const initialData = await this._initialData();
    for (const key in initialData) {
      this._storedValues.set(key, initialData[key]!);
    }
  }

  private _postMessage(message: BroadcastChannelStorageMessage) {
    this._channel.postMessage(message);
  }

  private async _init() {
    const initialData = await this._initialData();
    for (const key in initialData) {
      this._storedValues.set(key, initialData[key]!);
    }
    this._channelListener = this._listen();
  }

  private async _initialData() {
    return new Promise<Record<string, StoredValue>>((resolve) => {
      let timerId: NodeJS.Timeout | null = null;

      const handleInitialValues = (
        event: MessageEvent<BroadcastChannelStorageMessage>,
      ) => {
        const action = event.data;
        if (action.type !== 'values') return;
        if (timerId) {
          clearTimeout(timerId);
        }
        const initialData = action.payload;
        const output: Record<string, StoredValue> = {};
        for (const [key, { value, timestamp }] of Object.entries(initialData)) {
          output[key] = {
            value,
            timestamp: timestamp !== null ? new Date(timestamp) : null,
          };
        }
        this._channel.removeEventListener('message', handleInitialValues);
        resolve(output);
      };

      timerId = setTimeout(() => {
        this._channel.removeEventListener('message', handleInitialValues);
        resolve({});
      }, this._options.responseTimeoutMs);

      this._channel.addEventListener('message', handleInitialValues);

      this._postMessage({ type: 'request' });
    });
  }

  private _listen() {
    const listener = (event: MessageEvent<BroadcastChannelStorageMessage>) => {
      const action = event.data;

      if (action.type === 'request') {
        const values: Record<string, StoredValueSerialized> = {};
        for (const key in this._storedValues) {
          const { value, timestamp } = this._storedValues.get(key)!;
          values[key] = {
            value,
            timestamp: timestamp !== null ? timestamp.toISOString() : null,
          };
        }
        this._postMessage({
          type: 'values',
          payload: values,
        });
        return;
      }

      if (action.type === 'set') {
        const { key, value, timestamp } = action.payload;
        const newValue = { value, timestamp: new Date(timestamp) };
        const oldValue = this._storedValues.get(key) || {
          value: null,
          timestamp: null,
        };
        if (oldValue.value === newValue.value) return;
        this._storedValues.set(key, newValue);
        const storageEvent = new StorageEvent('storage', {
          key,
          oldValue: oldValue.value,
          newValue: newValue.value,
          url: window.location.href,
        });
        this.dispatchEvent(storageEvent);
        return;
      }

      if (action.type === 'remove') {
        const { key, timestamp } = action.payload;
        const newValue = {
          value: null,
          timestamp: new Date(timestamp),
        };
        const oldValue = this._storedValues.get(key) || {
          value: null,
          timestamp: null,
        };
        if (oldValue === newValue) return;
        this._storedValues.delete(key);
        const storageEvent = new StorageEvent('storage', {
          key,
          oldValue: oldValue.value,
          newValue: newValue.value,
          url: window.location.href,
        });
        this.dispatchEvent(storageEvent);
        return;
      }

      if (action.type === 'clear') {
        this._storedValues.clear();
        const storageEvent = new StorageEvent('storage', {
          key: null,
          oldValue: null,
          newValue: null,
          url: window.location.href,
        });
        this.dispatchEvent(storageEvent);
        return;
      }
    };

    this._channel.addEventListener('message', listener);
    return {
      cancel: () => this._channel.removeEventListener('message', listener),
    };
  }

  override addEventListener<K extends 'storage'>(
    type: K,
    callback: (
      event: { storage: StorageEvent }[K] extends Event
        ? { storage: StorageEvent }[K]
        : never,
    ) => { storage: StorageEvent }[K] extends Event ? void : never,
    options?: AddEventListenerOptions | boolean,
  ): void {
    super.addEventListener(type, callback, options);
    this._listeners.push({
      type,
      callback: callback as unknown as EventListenerOrEventListenerObject,
    });
  }

  override removeEventListener<K extends 'storage'>(
    type: K,
    callback: (
      event: { storage: StorageEvent }[K] extends Event
        ? { storage: StorageEvent }[K]
        : never,
    ) => { storage: StorageEvent }[K] extends Event ? void : never,
    options?: EventListenerOptions | boolean,
  ): void {
    super.removeEventListener(type, callback, options);
    this._listeners = this._listeners.filter(
      (listener) =>
        listener.type !== type ||
        listener.callback !==
          (callback as unknown as EventListenerOrEventListenerObject),
    );
  }
}
