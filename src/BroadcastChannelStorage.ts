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

type InstanceState = {
  instanceId: string;
  instanceTimestamp: Date;
  values: Record<string, StoredValue>;
};

export function consolidateValues(
  current: InstanceState,
  incoming: InstanceState,
) {
  const {
    instanceId: currentInstanceId,
    instanceTimestamp: currentInstanceTimestamp,
    values: currentValues,
  } = current;
  const {
    instanceId: incomingInstanceId,
    instanceTimestamp: incomingInstanceTimestamp,
    values: incomingValues,
  } = incoming;
  const changedCurrentValues: Record<string, StoredValue> = {};
  const changedIncomingValues: Record<string, StoredValue> = {};

  for (const key in incomingValues) {
    const incomingValue = incomingValues[key]!;
    const currentValue = currentValues[key];

    // current value did not exist
    if (!currentValue) {
      changedCurrentValues[key] = incomingValue;
      continue;
    }

    // values are the same
    if (
      currentValue.value === incomingValue.value &&
      currentValue.timestamp === incomingValue.timestamp
    ) {
      continue;
    }

    if (!currentValue.timestamp && !incomingValue.timestamp) {
      // initial values differ
      if (
        incomingInstanceTimestamp > currentInstanceTimestamp ||
        (incomingInstanceTimestamp.getTime() ===
          currentInstanceTimestamp.getTime() &&
          incomingInstanceId > currentInstanceId)
      ) {
        // incoming value is newer OR id is lexicographically greater (so same winner is picked)
        changedCurrentValues[key] = incomingValue;
      } else {
        // incoming value is older OR id is lexicographically less (so same winner is picked)
        changedIncomingValues[key] = currentValue;
      }
    } else if (currentValue.timestamp === null) {
      changedCurrentValues[key] = incomingValue;
    } else if (incomingValue.timestamp === null) {
      changedIncomingValues[key] = currentValue;
    } else if (incomingValue.timestamp > currentValue.timestamp) {
      changedCurrentValues[key] = incomingValue;
    } else {
      changedIncomingValues[key] = currentValue;
    }
  }

  return {
    changedCurrentValues,
    changedIncomingValues,
  };
}

export type BroadcastChannelStorageMessage =
  | {
      type: 'sync_request';
      payload: InstanceState;
    }
  | {
      type: 'sync_response';
      payload: InstanceState;
    }
  | {
      type: 'request';
    }
  | {
      type: 'values';
      payload: Record<string, StoredValue>;
    }
  | {
      type: 'clear';
    }
  | {
      type: 'set';
      payload: {
        key: string;
        value: string;
        timestamp: Date;
      };
    }
  | {
      type: 'remove';
      payload: {
        key: string;
        timestamp: Date;
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

// export type BroadcastChannelStorageEvent = CustomEvent<{
//   readonly key: string | null;
//   readonly oldValue: string | null;
//   readonly newValue: string | null;
// }>

export class BroadcastChannelStorageEvent extends Event {
  key: string | null;
  oldValue: string | null;
  newValue: string | null;
  constructor(
    type: 'storage',
    {
      key,
      oldValue,
      newValue,
    }: { key: string | null; oldValue: string | null; newValue: string | null },
  ) {
    super(type);
    this.key = key;
    this.oldValue = oldValue;
    this.newValue = newValue;
  }
}

export class BroadcastChannelStorage extends (EventTarget as TypedEventTarget<{
  storage: BroadcastChannelStorageEvent;
}>) {
  private _options;
  private _channel: BroadcastChannel;
  private _id: string;
  private _creationTimestamp: Date;
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
    // 6 character string for id - not guaranteed to be unique
    this._id = Math.random()
      .toString(36)
      .substring(2, 6 + 2);
    this._creationTimestamp = new Date();
    for (const key in initialData) {
      this._storedValues.set(key, {
        value: initialData[key] ?? null,
        timestamp: null,
      });
    }
    this._channel = new BroadcastChannel(this._options.channelName);
    this._initPromise = this._init();
  }

  getItemSync(key: string) {
    if (typeof key !== 'string' || key.length === 0) {
      throw new Error('invalid key');
    }
    const value = this._storedValues.get(key)?.value || null;
    return value;
  }

  setItemSync(key: string, value: string) {
    if (typeof key !== 'string' || key.length === 0) {
      throw new Error('invalid key');
    }
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
        timestamp: newValue.timestamp,
      },
    });
  }

  removeItemSync(key: string) {
    if (typeof key !== 'string' || key.length === 0) {
      throw new Error('invalid key');
    }
    const newValue = {
      value: null,
      timestamp: new Date(),
    };
    const oldValue = this._storedValues.get(key) || {
      value: null,
      timestamp: null,
    };
    if (newValue.value === oldValue.value) return;
    this._storedValues.set(key, newValue);
    this._postMessage({
      type: 'remove',
      payload: {
        key,
        timestamp: newValue.timestamp,
      },
    });
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
        timestamp: newValue.timestamp,
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
        timestamp: newValue.timestamp,
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
    const currentInstance: InstanceState = {
      instanceTimestamp: this._creationTimestamp,
      values: Object.fromEntries(this._storedValues),
    };
    this._postMessage({
      type: 'sync_request',
      payload: currentInstance,
    });
  }

  private _postMessage(message: BroadcastChannelStorageMessage) {
    this._channel.postMessage(message);
  }

  private async _init() {
    this.sync();
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
      console.log('listener', event);
      const action = event.data;

      if (action.type === 'sync_request' || action.type === 'sync_response') {
        debugger;
        console.log('received sync event', event.data);
        const current: InstanceState = {
          instanceTimestamp: this._creationTimestamp,
          values: Object.fromEntries(this._storedValues),
        };
        const incoming = action.payload;

        const { changedCurrentValues, changedIncomingValues } =
          consolidateValues(current, incoming);

        for (const key in changedCurrentValues) {
          const oldValue = this._storedValues.get('key') || {
            value: null,
            timestamp: null,
          };
          const newValue = changedCurrentValues[key]!;
          this._storedValues.set('key', newValue);
          if (oldValue.value !== newValue.value) {
            const storageEvent = new BroadcastChannelStorageEvent('storage', {
              key,
              oldValue: oldValue.value,
              newValue: newValue.value,
            });
            this.dispatchEvent(storageEvent);
          }
        }

        if (Object.keys(changedIncomingValues).length > 0) {
          debugger;
          this._postMessage({
            type: 'sync_response',
            payload: {
              instanceTimestamp: this._creationTimestamp,
              values: changedIncomingValues,
            },
          });
        }
      }

      if (action.type === 'request') {
        const values: Record<string, StoredValue> = {};
        for (const key in this._storedValues) {
          const { value, timestamp } = this._storedValues.get(key)!;
          values[key] = {
            value,
            timestamp,
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
        const storageEvent = new BroadcastChannelStorageEvent('storage', {
          key,
          oldValue: oldValue.value,
          newValue: newValue.value,
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
        const storageEvent = new BroadcastChannelStorageEvent('storage', {
          key,
          oldValue: oldValue.value,
          newValue: newValue.value,
        });
        this.dispatchEvent(storageEvent);
        return;
      }

      if (action.type === 'clear') {
        this._storedValues.clear();
        const storageEvent = new BroadcastChannelStorageEvent('storage', {
          key: null,
          oldValue: null,
          newValue: null,
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
      event: { storage: BroadcastChannelStorageEvent }[K] extends Event
        ? { storage: BroadcastChannelStorageEvent }[K]
        : never,
    ) => { storage: BroadcastChannelStorageEvent }[K] extends Event
      ? void
      : never,
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
      event: { storage: BroadcastChannelStorageEvent }[K] extends Event
        ? { storage: BroadcastChannelStorageEvent }[K]
        : never,
    ) => { storage: BroadcastChannelStorageEvent }[K] extends Event
      ? void
      : never,
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
