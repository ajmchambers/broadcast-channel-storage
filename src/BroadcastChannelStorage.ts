import type { TypedEventTarget } from './utils.js';

export type BroadcastChannelStorageMessage =
  | {
      type: 'request';
    }
  | {
      type: 'values';
      payload: Record<string, string>;
    }
  | {
      type: 'clear';
    }
  | {
      type: 'set';
      payload: {
        key: string;
        value: string;
      };
    }
  | {
      type: 'remove';
      payload: string;
    };

export type BroadcastChannelStorageOptions = {
  /** Name for the broadcast-channel, default is "__broadcast_channel-storage" */
  channelName?: string;
  /** Timeout cutoff to get a response from channel */
  responseTimeoutMs?: number;
};

const DEFAULT_CHANNEL_NAME = '__broadcast_channel-storage';
const DEFAULT_RESPONSE_TIMEOUT = 50;

export class BroadcastChannelStorage extends (EventTarget as TypedEventTarget<{
  storage: StorageEvent;
}>) {
  private _options;
  private _channel: BroadcastChannel;
  private _storedValues: Map<string, string> = new Map();
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
    } = options;
    this._options = {
      channelName,
      responseTimeoutMs,
    };
    this._channel = new BroadcastChannel(this._options.channelName);
    this._initPromise = this._init();
  }

  async getItem(key: string) {
    if (typeof key !== 'string' || key.length === 0) {
      throw new Error('invalid key');
    }
    await this._initPromise;
    const value = this._storedValues.get(key) || null;
    return value;
  }

  async setItem(key: string, value: string) {
    if (typeof key !== 'string' || key.length === 0) {
      throw new Error('invalid key');
    }
    await this._initPromise;
    const oldValue = this._storedValues.get(key) || null;
    if (value === oldValue) return;
    this._storedValues.set(key, value);
    this._postMessage({
      type: 'set',
      payload: {
        key,
        value,
      },
    });
  }

  async removeItem(key: string) {
    if (typeof key !== 'string' || key.length === 0) {
      throw new Error('invalid key');
    }
    await this._initPromise;
    const newValue = null;
    const oldValue = this._storedValues.get(key) || null;
    if (newValue === oldValue) return;
    this._storedValues.delete(key);
    this._postMessage({
      type: 'remove',
      payload: key,
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

  private _postMessage(message: BroadcastChannelStorageMessage) {
    this._channel.postMessage(message);
  }

  private async _init() {
    const initialData = await this._initialData();
    for (const key in initialData) {
      this._storedValues.set(key, initialData[key] as string);
    }
    this._channelListener = this._listen();
  }

  private async _initialData() {
    return new Promise<Record<string, string>>((resolve) => {
      let timerId: number | null = null;

      const handleInitialValues = (
        event: MessageEvent<BroadcastChannelStorageMessage>,
      ) => {
        const action = event.data;
        if (action.type !== 'values') return;
        if (timerId) {
          clearTimeout(timerId);
        }
        this._channel.removeEventListener('message', handleInitialValues);
        resolve(action.payload);
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
        const values: Record<string, string> = {};
        for (const key in this._storedValues) {
          values[key] = this._storedValues.get(key)!;
        }
        this._postMessage({
          type: 'values',
          payload: values,
        });
        return;
      }

      if (action.type === 'set') {
        const { key, value: newValue } = action.payload;
        const oldValue = this._storedValues.get(key) || null;
        if (oldValue === newValue) return;
        this._storedValues.set(key, newValue);
        const storageEvent = new StorageEvent('storage', {
          key,
          oldValue,
          newValue,
          url: window.location.href,
        });
        this.dispatchEvent(storageEvent);
        return;
      }

      if (action.type === 'remove') {
        const key = action.payload;
        const newValue = null;
        const oldValue = this._storedValues.get(key) || null;
        if (oldValue === newValue) return;
        this._storedValues.delete(key);
        const storageEvent = new StorageEvent('storage', {
          key,
          oldValue,
          newValue,
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
