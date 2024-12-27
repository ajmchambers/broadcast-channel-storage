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
  const {
    clearedTimestamp: currentClearedTimestamp,
    values: mergedValues,
  } = current;
  const {
    clearedTimestamp: incomingClearedTimestamp,
    values: incomingValues,
  } = incoming;
  const changedValues: Record<string, StoredValue> = {};
  const clearedValues: string[] = [];

  const clearedTimestamp: number | null =
    incomingClearedTimestamp === currentClearedTimestamp
      ? currentClearedTimestamp
      : Math.max(
          incomingClearedTimestamp ?? -Infinity,
          currentClearedTimestamp ?? -Infinity,
        );

  // if cleared timestamp has changed, then clear any values older
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
    if (clearedTimestamp && clearedTimestamp !== incomingClearedTimestamp && incomingValue.timestamp <= clearedTimestamp) {
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
    if (currentValue.timestamp === incomingValue.timestamp && currentValue.value !== incomingValue.value) {
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
    clearedValues
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
      type: 'ping';
      payload: number;
    }
  | {
      type: 'pong';
      payload: number;
    };

export type BroadcastChannelStorageOptions = {
  /** Name for the broadcast-channel, default is "__broadcast_channel-storage" */
  channelName?: string;
  /** Timeout cutoff to get a response from channel */
  responseTimeoutMs?: number;
};

const DEFAULT_CHANNEL_NAME = '__broadcast_channel-storage';
const DEFAULT_RESPONSE_TIMEOUT = 30;

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
  private _options: Required<BroadcastChannelStorageOptions>;
  private _storedValues: Map<string, StoredValue> = new Map();
  private _clearedTimestamp: number | null = null;
  private _channel: BroadcastChannel;
  private _readyPromise: Promise<void>;
  private _ready: boolean = false;
  private _listeners: {
    type: string;
    callback: EventListenerOrEventListenerObject;
  }[] = [];
  private _lastInstance: boolean = false;

  constructor(options: BroadcastChannelStorageOptions = {}) {
    super();
    const {
      channelName = DEFAULT_CHANNEL_NAME,
      responseTimeoutMs = DEFAULT_RESPONSE_TIMEOUT
    } = options;
    this._options = {
      channelName,
      responseTimeoutMs
    };
    this._channel = new BroadcastChannel(channelName);
    this._listen();
    this._readyPromise = this.ready();
  }

  get values() {
    let storedValues: Record<string, string> = {}
    for (const key of this._storedValues.keys()) {
      const value = this._storedValues.get(key)?.value;
      if (value) {
        storedValues[key] = value;
      }
    }
    return storedValues;
  }

  get length() {
    return Object.keys(this.values).length;
  }

  get isReady() {
    return this._ready;
  }

  get isLastInstance() {
    return this._lastInstance;
  }

  ready() {
    if (this._readyPromise) {
      return this._readyPromise;
    }

    return this.sync().then(() => {
      this._ready = true;
    })
  }

  // OLD SYNC, waited until time had completed with no further responses.
  // sync() {
  //   if (!this._ready && this._readyPromise) {
  //     return this._readyPromise;
  //   }

  //   return new Promise<void>((resolve, reject) => {
  //     let timeoutId: ReturnType<typeof setTimeout> | null = null;

  //     const handleTimeout = () => {
  //       this._channel.removeEventListener('message', handleValuesResponse);
  //       resolve();
  //     };

  //     const handleValuesResponse = (
  //       event: MessageEvent<BroadcastChannelStorageMessage>,
  //     ) => {
  //       const action = event.data;
  //       if (action.type !== 'state') return;
  //       if (timeoutId) {
  //         clearTimeout(timeoutId);
  //       }
  //       timeoutId = setTimeout(handleTimeout, this._options.responseTimeoutMs);
  //     };

  //     this._channel.addEventListener('message', handleValuesResponse);
  //     timeoutId = setTimeout(handleTimeout, this._options.responseTimeoutMs);

  //     const current: InstanceState = {
  //       clearedTimestamp: this._clearedTimestamp,
  //       values: Object.fromEntries(this._storedValues),
  //     };
  //     this._postMessage({ type: 'request', payload: current });
  //   }) 
  // }

  sync() {
    if (!this._ready && this._readyPromise) {
      return this._readyPromise;
    }

    return new Promise<void>((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const handleTimeout = () => {
        this._channel.removeEventListener('message', handleValuesResponse);
        this._lastInstance = true;
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
        this._lastInstance = false;
        resolve();
      };

      this._channel.addEventListener('message', handleValuesResponse, { once: true });
      timeoutId = setTimeout(handleTimeout, this._options.responseTimeoutMs);

      const current: InstanceState = {
        clearedTimestamp: this._clearedTimestamp,
        values: Object.fromEntries(this._storedValues),
      };
      this._postMessage({ type: 'request', payload: current });
    }) 
  }

  getItem = (key: string) => {
    if (typeof key !== 'string' || key.length === 0) {
      throw new Error('invalid key');
    }
    const value = this._storedValues.get(key)?.value || null;
    return value;
  };

  setItem = (key: string, value: string) => {
    if (typeof key !== 'string' || key.length === 0) {
      throw new Error('invalid key');
    }
    const newValue = {
      value,
      timestamp: getUniqueTimestamp(),
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
        clearedTimestamp: this._clearedTimestamp
      },
    });
  };

  removeItem = (key: string) => {
    if (typeof key !== 'string' || key.length === 0) {
      throw new Error('invalid key');
    }
    const newValue = {
      value: null,
      timestamp: getUniqueTimestamp(),
    };
    this._storedValues.set(key, newValue);
    this._postMessage({
      type: 'remove',
      payload: {
        key,
        timestamp: newValue.timestamp,
        clearedTimestamp: this._clearedTimestamp
      },
    });
  };

  clear = () => {
    const clearedTimestamp = getUniqueTimestamp();
    this._storedValues.clear();
    this._clearedTimestamp = clearedTimestamp;
    this._postMessage({
      type: 'clear',
      payload: clearedTimestamp,
    });
  };

  // instanceCount = async () => {
  //   await this._readyPromise;
  //   return new Promise<number>((resolve) => {
  //     const channel = this._channel;
  //     const timestamp = getUniqueTimestamp();
  //     let timerId: ReturnType<typeof setTimeout> | null = null;
  //     let instanceCount: number = 1;

  //     const handleTimeout = () => {
  //       channel.removeEventListener('message', handlePongEvent);
  //       resolve(instanceCount);
  //     };

  //     const handlePongEvent = (
  //       event: MessageEvent<BroadcastChannelStorageMessage>,
  //     ) => {
  //       const action = event.data;
  //       if (action.type !== 'pong' || action.payload !== timestamp) return;
  //       instanceCount++;
  //       if (timerId) {
  //         clearTimeout(timerId);
  //       }
  //       timerId = setTimeout(handleTimeout, this._options.responseTimeoutMs);
  //     };

  //     channel.addEventListener('message', handlePongEvent);
  //     this._postMessage({ type: 'ping', payload: timestamp });

  //     timerId = setTimeout(handleTimeout, this._options.responseTimeoutMs);
  //   });
  // };

  private _postMessage(message: BroadcastChannelStorageMessage) {
    this._channel.postMessage(message);
  }

  private _merge(incoming: InstanceState, dispatchEvents = false) {
    const current: InstanceState = {
      clearedTimestamp: this._clearedTimestamp,
      values: Object.fromEntries(this._storedValues),
    };
    const { clearedTimestamp, mergedValues, changedValues, clearedValues } = mergeValues(current, incoming);

    // Update cleared timestamp
    if (this._clearedTimestamp !== clearedTimestamp) {
      this._clearedTimestamp = clearedTimestamp;
    }
    
    if (Object.keys(mergedValues).length === 0 && clearedValues.length > 0) {
      // Handle when all keys are cleared
      this._storedValues.clear();
      const storageEvent = new BroadcastChannelStorageEvent('storage', {
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
          value: null
        };
        const newValue = changedValues[key]!;
        this._storedValues.set(key, newValue);
        if (oldValue.value !== newValue.value) {
          const storageEvent = new BroadcastChannelStorageEvent('storage', {
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
      clearedValues.forEach(key => {
        const oldValue = this._storedValues.get(key)!;
        this._storedValues.delete(key);
        if (oldValue.value !== null) {
          const storageEvent = new BroadcastChannelStorageEvent('storage', {
            key,
            oldValue: oldValue.value,
            newValue: null,
          });
          if (dispatchEvents) {
            this.dispatchEvent(storageEvent);
          }
        }
      })
    }

    return { clearedTimestamp, mergedValues, changedValues, clearedValues };
  }

  private _listen() {
    const channel = this._channel;

    const supportsVisibilityChange = typeof document !== 'undefined' && 'visibilityState' in document;

    const visibilityListener = () => {
      if (supportsVisibilityChange && document.visibilityState === "visible") {
        const current: InstanceState = {
          clearedTimestamp: this._clearedTimestamp,
          values: Object.fromEntries(this._storedValues),
        };
        this._postMessage({ type: 'request', payload: current });
      }
    }
    
    const channelListener = (event: MessageEvent<BroadcastChannelStorageMessage>) => {
      const action = event.data;

      if (action.type === 'ping') {
        this._lastInstance = false;
        this._postMessage({ type: 'pong', payload: action.payload });
      }

      if (action.type === 'request' || action.type === 'state') {
        const incoming = action.payload;
        this._merge(incoming, true);

        if (action.type === 'request') {
          this._postMessage({
            type: 'state',
            payload: {
              clearedTimestamp: this._clearedTimestamp,
              values: Object.fromEntries(this._storedValues),
            },
          });
        }
      }

      if (action.type === 'set') {
        const { key, value, timestamp, clearedTimestamp } = action.payload;
        const incoming: InstanceState = {
          clearedTimestamp,
          values: {
            [key]: { value, timestamp }
          }
        };
        this._merge(incoming, true);
        return;
      }

      if (action.type === 'remove') {
        const { key, timestamp, clearedTimestamp } = action.payload;
        const incoming: InstanceState = {
          clearedTimestamp,
          values: {
            [key]: { value: null, timestamp }
          }
        };
        this._merge(incoming, true);
        return;
      }

      if (action.type === 'clear') {
        const clearedTimestamp = action.payload;
        const incoming: InstanceState = {
          clearedTimestamp,
          values: {}
        };
        this._merge(incoming, true);
        return;
      }
    };

    channel.addEventListener('message', channelListener);
    if (supportsVisibilityChange) { 
      document.addEventListener('visibilitychange', visibilityListener);
    }

    return {
      cancel: () => {
        channel.removeEventListener('message', channelListener);
        if (supportsVisibilityChange) { 
          document.removeEventListener('visibilitychange', visibilityListener);
        }
      },
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
