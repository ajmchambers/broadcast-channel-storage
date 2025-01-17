// https://dev.to/marcogrcr/type-safe-eventtarget-subclasses-in-typescript-1nkf
type TypedEventTarget<EventMap extends object> = {
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

/**
 * Timestamp: need higher resolution timestamp so using performance.now() + performance.timeOrigin
 * - performance.timeOrigin // the time when the browser context was created
 * - performance.now() // time since performance.timeOrigin
 */
let lastUniqueTimestamp = 0;

export const getUniqueTimestamp = () => {
  let currentTimestamp = performance.timeOrigin + performance.now();
  if (currentTimestamp <= lastUniqueTimestamp) {
    currentTimestamp = lastUniqueTimestamp + 0.001; // increment to ensure newer timestamps occur after last timestamp
  }
  lastUniqueTimestamp = currentTimestamp;
  return currentTimestamp;
};

export type StoredValue = {
  value: string | null;
  timestamp: number;
};

export type InstanceState = {
  clearedTimestamp: null | number;
  values: Record<string, StoredValue>;
};

export function mergeValues(current: InstanceState, incoming: InstanceState) {
  const { clearedTimestamp: currentClearedTimestamp, values: mergedValues } =
    current;
  const { clearedTimestamp: incomingClearedTimestamp, values: incomingValues } =
    incoming;
  const changedValues: Record<string, StoredValue> = {};
  const clearedValues: string[] = [];

  const clearedTimestamp: number | null =
    incomingClearedTimestamp === currentClearedTimestamp
      ? currentClearedTimestamp
      : Math.max(
          incomingClearedTimestamp ?? -Infinity,
          currentClearedTimestamp ?? -Infinity,
        );

  // if cleared timestamp has changed, then clear any values equal or older
  if (clearedTimestamp && clearedTimestamp !== currentClearedTimestamp) {
    for (const key in mergedValues) {
      const currentValue = mergedValues[key]!;

      if (currentValue.timestamp <= clearedTimestamp) {
        delete mergedValues[key];
        clearedValues.push(key);
      }
    }
  }

  // loop over incoming values and merge with current values
  for (const key in incomingValues) {
    const incomingValue = incomingValues[key]!;
    const currentValue = mergedValues[key];

    // If value is older than latest cleared timestamp, ignore it
    if (
      clearedTimestamp &&
      clearedTimestamp !== incomingClearedTimestamp &&
      incomingValue.timestamp <= clearedTimestamp
    ) {
      continue;
    }

    // value is new
    if (!currentValue) {
      mergedValues[key] = incomingValue;
      changedValues[key] = incomingValue;
      continue;
    }

    // values are the same
    if (
      currentValue.value === incomingValue.value &&
      currentValue.timestamp === incomingValue.timestamp
    ) {
      continue;
    }

    // values differ but have same timestamp
    if (
      currentValue.timestamp === incomingValue.timestamp &&
      currentValue.value !== incomingValue.value
    ) {
      if (incomingValue.value && !currentValue.value) {
        // use non-null value
        mergedValues[key] = incomingValue;
        changedValues[key] = incomingValue;
      } else if (
        incomingValue.value &&
        currentValue.value &&
        incomingValue.value > currentValue.value
      ) {
        // use largest value lexicographically
        mergedValues[key] = incomingValue;
        changedValues[key] = incomingValue;
      }
    }

    // values differ and both have different timestamp
    if (incomingValue.timestamp > currentValue.timestamp) {
      // both values have a timestamp and the incoming value's is newer
      mergedValues[key] = incomingValue;
      changedValues[key] = incomingValue;
    }
  }

  return {
    clearedTimestamp,
    mergedValues,
    changedValues,
    clearedValues,
  };
}

export type BroadcastChannelStorageMessage =
  | {
      type: 'request';
      payload: InstanceState;
    }
  | {
      type: 'state';
      payload: InstanceState;
    }
  | {
      type: 'clear';
      payload: number; // timestamp
    }
  | {
      type: 'set';
      payload: {
        key: string;
        value: string;
        timestamp: number;
        clearedTimestamp: null | number;
      };
    }
  | {
      type: 'remove';
      payload: {
        key: string;
        timestamp: number;
        clearedTimestamp: null | number;
      };
    }
  | {
      type: 'close';
      payload: InstanceState;
    };

export type BroadcastChannelStorageOptions = {
  /** Name for the broadcast-channel, default is "__broadcast-channel-storage" */
  channelName?: string;
  /** Timeout cutoff to get a response from channel */
  responseTimeoutMs?: number;
};

const DEFAULT_CHANNEL_NAME = '__broadcast-channel-storage';
const DEFAULT_RESPONSE_TIMEOUT = 200;
const ERROR_CLOSED_MESSAGE = 'Channel is closed';

export class BroadcastChannelStorageEvent extends Event {
  key: string | null;
  oldValue: string | null;
  newValue: string | null;
  constructor({
    key,
    oldValue,
    newValue,
  }: {
    key: string | null;
    oldValue: string | null;
    newValue: string | null;
  }) {
    super('storage');
    this.key = key;
    this.oldValue = oldValue;
    this.newValue = newValue;
  }
}

export class BroadcastChannelChangeEvent extends Event {
  key: string | null;
  oldValue: string | null;
  newValue: string | null;
  constructor({
    key,
    oldValue,
    newValue,
  }: {
    key: string | null;
    oldValue: string | null;
    newValue: string | null;
  }) {
    super('change');
    this.key = key;
    this.oldValue = oldValue;
    this.newValue = newValue;
  }
}

export class BroadcastChannelReadyEvent extends Event {
  constructor() {
    super('ready');
  }
}

export class BroadcastChannelLastInstanceEvent extends Event {
  isLastInstance: boolean;
  constructor(isLastInstance: boolean) {
    super('last-instance');
    this.isLastInstance = isLastInstance;
  }
}

export class BroadcastChannelClosedEvent extends Event {
  constructor() {
    super('closed');
  }
}

type BroadcastChannelEventTypes =
  | 'change'
  | 'storage'
  | 'ready'
  | 'closed'
  | 'last-instance';
type BroadcastChannelEvents = {
  change: BroadcastChannelStorageEvent;
  storage: BroadcastChannelChangeEvent;
  ready: BroadcastChannelReadyEvent;
  closed: BroadcastChannelClosedEvent;
  ['last-instance']: BroadcastChannelLastInstanceEvent;
};

export class BroadcastChannelStorage extends (EventTarget as TypedEventTarget<BroadcastChannelEvents>) {
  private _options: Required<BroadcastChannelStorageOptions>;
  private _storedValues: Map<string, StoredValue> = new Map();
  private _clearedTimestamp: number | null = null;
  private _channel: BroadcastChannel;
  private _readyPromise: Promise<void>;
  private _readyCalled: boolean;
  private _readyAbortController: AbortController = new AbortController();
  private _channelListener;
  private _listeners: {
    type: string;
    callback: EventListenerOrEventListenerObject;
    options: boolean | AddEventListenerOptions | undefined;
  }[] = [];
  private _lastInstance: boolean = false;
  private _status: 'loading' | 'ready' | 'closed' = 'loading';

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
    this._channel = new BroadcastChannel(channelName);
    this._channelListener = this._listen();
    this._readyPromise = this.ready();
    this._readyCalled = false;
  }

  get values() {
    let storedValues: Record<string, string> = {};
    for (const key of this._storedValues.keys()) {
      const value = this._storedValues.get(key)?.value;
      if (value) {
        storedValues[key] = value;
      }
    }
    return storedValues;
  }

  get channel() {
    return this._channel;
  }

  get length() {
    return Object.keys(this.values).length;
  }

  get isReady() {
    return this._status === 'ready';
  }

  get isClosed() {
    return this._status === 'closed';
  }

  get isLastInstance() {
    return this._lastInstance;
  }

  async ready() {
    if (this._status === 'closed') {
      throw new Error(ERROR_CLOSED_MESSAGE);
    }

    if (this._status === 'loading') {
      if (this._readyPromise) {
        // Don't want set on initial run (in constructor), only on subsequent calls
        this._readyCalled = true;
        return this._readyPromise;
      }
      this._readyPromise = this.sync()
        .then(() => {
          this._status = 'ready';
          this.dispatchEvent(new BroadcastChannelReadyEvent());
        })
        .catch((error) => {
          if (this._readyCalled) {
            throw error;
          }
          return;
        });
      return this._readyPromise;
    }

    return;
  }

  async sync() {
    if (this._status === 'closed') {
      throw new Error(ERROR_CLOSED_MESSAGE);
    }

    if (this._status === 'loading' && this._readyPromise) {
      return this._readyPromise;
    }

    return new Promise<void>((resolve, reject) => {
      const { signal } = this._readyAbortController;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const handleTimeout = () => {
        if (this._channel) {
          this._channel.removeEventListener('message', handleValuesResponse);
        }
        if (!this._lastInstance) {
          this._lastInstance = true;
          this.dispatchEvent(new BroadcastChannelLastInstanceEvent(true));
        }
        this._status = 'ready';
        resolve();
      };

      const handleValuesResponse = (
        event: MessageEvent<BroadcastChannelStorageMessage>,
      ) => {
        const action = event.data;
        if (action.type !== 'request' && action.type !== 'state') return;
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        if (this._channel) {
          this._channel.removeEventListener('message', handleValuesResponse);
        }
        if (this._lastInstance) {
          this._lastInstance = false;
          this.dispatchEvent(new BroadcastChannelLastInstanceEvent(false));
        }
        this._status = 'ready';
        resolve();
      };

      const handleAbort = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        if (this._channel) {
          this._channel.removeEventListener('message', handleValuesResponse);
        }
        reject(new Error(ERROR_CLOSED_MESSAGE));
      };

      this._channel.addEventListener('message', handleValuesResponse);
      timeoutId = setTimeout(handleTimeout, this._options.responseTimeoutMs);

      signal.addEventListener('abort', handleAbort, { once: true });

      const current: InstanceState = {
        clearedTimestamp: this._clearedTimestamp,
        values: Object.fromEntries(this._storedValues),
      };

      this._postMessage({ type: 'request', payload: current });
    });
  }

  getItem = (key: string): string | null => {
    if (this._status === 'closed') {
      throw new Error(ERROR_CLOSED_MESSAGE);
    }
    if (typeof key !== 'string' || key.length === 0) {
      throw new Error('invalid key');
    }
    const value = this._storedValues.get(key)?.value || null;
    return value;
  };

  setItem = (key: string, value: string) => {
    if (this._status === 'closed') {
      throw new Error(ERROR_CLOSED_MESSAGE);
    }
    if (typeof key !== 'string' || key.length === 0) {
      throw new Error('invalid key');
    }
    const newValue = {
      value: String(value),
      timestamp: getUniqueTimestamp(),
    };
    const oldValue = this._storedValues.get(key) || {
      value: null,
      timestamp: null,
    };
    this._storedValues.set(key, newValue);
    this._postMessage({
      type: 'set',
      payload: {
        key,
        value,
        timestamp: newValue.timestamp,
        clearedTimestamp: this._clearedTimestamp,
      },
    });
    if (newValue.value === oldValue.value) return;
    const changeEvent = new BroadcastChannelChangeEvent({
      key,
      oldValue: oldValue.value,
      newValue: newValue.value,
    });
    this.dispatchEvent(changeEvent);
  };

  removeItem = (key: string) => {
    if (this._status === 'closed') {
      throw new Error(ERROR_CLOSED_MESSAGE);
    }
    if (typeof key !== 'string' || key.length === 0) {
      throw new Error('invalid key');
    }
    const newValue = {
      value: null,
      timestamp: getUniqueTimestamp(),
    };
    const oldValue = this._storedValues.get(key) || {
      value: null,
      timestamp: null,
    };
    this._storedValues.set(key, newValue);
    this._postMessage({
      type: 'remove',
      payload: {
        key,
        timestamp: newValue.timestamp,
        clearedTimestamp: this._clearedTimestamp,
      },
    });
    if (newValue.value === oldValue.value) return;
    const changeEvent = new BroadcastChannelChangeEvent({
      key,
      oldValue: oldValue.value,
      newValue: newValue.value,
    });
    this.dispatchEvent(changeEvent);
  };

  clear = () => {
    if (this._status === 'closed') {
      throw new Error(ERROR_CLOSED_MESSAGE);
    }
    const clearedTimestamp = getUniqueTimestamp();
    this._storedValues.clear();
    this._clearedTimestamp = clearedTimestamp;
    this._postMessage({
      type: 'clear',
      payload: clearedTimestamp,
    });
    const changeEvent = new BroadcastChannelChangeEvent({
      key: null,
      oldValue: null,
      newValue: null,
    });
    this.dispatchEvent(changeEvent);
  };

  close = () => {
    if (this._status === 'closed') {
      return;
    }

    // cancel channel listener
    this._channelListener.cancel();

    // abort ready
    if (!this._readyAbortController.signal.aborted) {
      this._readyAbortController.abort();
    }

    // post close message
    this._postMessage({
      type: 'close',
      payload: {
        clearedTimestamp: this._clearedTimestamp,
        values: Object.fromEntries(this._storedValues),
      },
    });
    this._channel.close();
    this._status = 'closed';

    // Dispatch close event
    this.dispatchEvent(new BroadcastChannelClosedEvent());

    // remove all listeners
    if (this._listeners.length > 0) {
      for (const { type, callback, options } of this._listeners) {
        super.removeEventListener(type, callback, options);
      }
      this._listeners = [];
    }
  };

  private _postMessage(message: BroadcastChannelStorageMessage) {
    if (this._status === 'closed') {
      throw new Error(ERROR_CLOSED_MESSAGE);
    }
    try {
      this._channel.postMessage(message);
    } catch (error) {
      this.close();
      throw new Error(ERROR_CLOSED_MESSAGE);
    }
  }

  private _merge(incoming: InstanceState, dispatchEvents = false) {
    const current: InstanceState = {
      clearedTimestamp: this._clearedTimestamp,
      values: Object.fromEntries(this._storedValues),
    };
    const { clearedTimestamp, mergedValues, changedValues, clearedValues } =
      mergeValues(current, incoming);

    // Update cleared timestamp
    if (this._clearedTimestamp !== clearedTimestamp) {
      this._clearedTimestamp = clearedTimestamp;
    }

    if (Object.keys(mergedValues).length === 0 && clearedValues.length > 0) {
      // Handle when all keys are cleared
      this._storedValues.clear();
      const storageEvent = new BroadcastChannelStorageEvent({
        key: null,
        oldValue: null,
        newValue: null,
      });
      if (dispatchEvents) {
        this.dispatchEvent(storageEvent);
      }
    } else {
      // Update changed values
      for (const key in changedValues) {
        const oldValue = this._storedValues.get(key) || {
          value: null,
        };
        const newValue = changedValues[key]!;
        this._storedValues.set(key, newValue);
        if (oldValue.value !== newValue.value) {
          const storageEvent = new BroadcastChannelStorageEvent({
            key,
            oldValue: oldValue.value,
            newValue: newValue.value,
          });
          if (dispatchEvents) {
            this.dispatchEvent(storageEvent);
          }
        }
      }
      // Remove cleared values
      clearedValues.forEach((key) => {
        const oldValue = this._storedValues.get(key)!;
        this._storedValues.delete(key);
        if (oldValue.value !== null) {
          const storageEvent = new BroadcastChannelStorageEvent({
            key,
            oldValue: oldValue.value,
            newValue: null,
          });
          if (dispatchEvents) {
            this.dispatchEvent(storageEvent);
          }
        }
      });
    }

    return { clearedTimestamp, mergedValues, changedValues, clearedValues };
  }

  private _listen() {
    const channel = this._channel;

    const channelListener = (
      event: MessageEvent<BroadcastChannelStorageMessage>,
    ) => {
      // received an event so not last instance
      if (this._lastInstance) {
        this._lastInstance = false;
        this.dispatchEvent(new BroadcastChannelLastInstanceEvent(false));
      }

      if (this._status === 'closed') return;

      const action = event.data;

      // only emit events once 'ready'
      const emitEvents = this._status === 'ready';

      if (
        action.type === 'request' ||
        action.type === 'state' ||
        action.type === 'close'
      ) {
        const incoming = action.payload;

        this._merge(incoming, emitEvents);

        if (action.type === 'close') {
          // rerun sync to see if there are still other instances
          this.sync().catch(() => {
            return;
          });
          return;
        }

        if (action.type === 'request') {
          this._postMessage({
            type: 'state',
            payload: {
              clearedTimestamp: this._clearedTimestamp,
              values: Object.fromEntries(this._storedValues),
            },
          });
        }

        return;
      }

      if (action.type === 'set') {
        const { key, value, timestamp, clearedTimestamp } = action.payload;
        const incoming: InstanceState = {
          clearedTimestamp,
          values: {
            [key]: { value, timestamp },
          },
        };
        this._merge(incoming, emitEvents);
        return;
      }

      if (action.type === 'remove') {
        const { key, timestamp, clearedTimestamp } = action.payload;
        const incoming: InstanceState = {
          clearedTimestamp,
          values: {
            [key]: { value: null, timestamp },
          },
        };
        this._merge(incoming, emitEvents);
        return;
      }

      if (action.type === 'clear') {
        const clearedTimestamp = action.payload;
        const incoming: InstanceState = {
          clearedTimestamp,
          values: {},
        };
        this._merge(incoming, emitEvents);
        return;
      }
    };

    const supportsVisibilityChange =
      typeof document !== 'undefined' && 'visibilityState' in document;

    const supportsBeforeUnload =
      typeof window !== 'undefined' && 'addEventListener' in window;

    const visibilityListener = () => {
      if (document.visibilityState === 'visible') {
        // rerun sync to see if there are any other instances
        this.sync().catch(() => {
          return;
        });
      }
    };

    const beforeUnloadListener = () => {
      this._postMessage({
        type: 'close',
        payload: {
          clearedTimestamp: this._clearedTimestamp,
          values: Object.fromEntries(this._storedValues),
        },
      });
    };

    channel.addEventListener('message', channelListener);

    if (supportsVisibilityChange) {
      document.addEventListener('visibilitychange', visibilityListener);
    }
    if (supportsBeforeUnload) {
      document.addEventListener('beforeunload', beforeUnloadListener);
    }

    return {
      cancel: () => {
        if (this._channel) {
          this._channel.removeEventListener('message', channelListener);
        }
        if (supportsVisibilityChange) {
          document.removeEventListener('visibilitychange', visibilityListener);
        }
        if (supportsBeforeUnload) {
          document.removeEventListener('beforeunload', beforeUnloadListener);
        }
      },
    };
  }

  override addEventListener<K extends BroadcastChannelEventTypes>(
    type: K,
    callback: (
      event: BroadcastChannelEvents[K] extends Event
        ? BroadcastChannelEvents[K]
        : never,
    ) => BroadcastChannelEvents[K] extends Event ? void : never,
    options?: AddEventListenerOptions | boolean,
  ): void {
    super.addEventListener(type, callback, options);
    this._listeners.push({
      type,
      callback: callback as unknown as EventListenerOrEventListenerObject,
      options,
    });
  }

  override removeEventListener<K extends BroadcastChannelEventTypes>(
    type: K,
    callback: (
      event: BroadcastChannelEvents[K] extends Event
        ? BroadcastChannelEvents[K]
        : never,
    ) => BroadcastChannelEvents[K] extends Event ? void : never,
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
