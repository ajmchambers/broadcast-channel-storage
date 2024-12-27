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
  timestamp: number | null; // will be null if an initial value
};

export type InstanceState = {
  instanceTimestamp: number;
  values: Record<string, StoredValue>;
};

export function mergeValues(current: InstanceState, incoming: InstanceState) {
  const { instanceTimestamp: currentInstanceTimestamp, values: mergedValues } =
    current;
  const {
    instanceTimestamp: incomingInstanceTimestamp,
    values: incomingValues,
  } = incoming;
  const changedValues: Record<string, StoredValue> = {};

  for (const key in incomingValues) {
    const incomingValue = incomingValues[key]!;
    const currentValue = mergedValues[key];

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

    // values differ

    if (!currentValue.timestamp && !incomingValue.timestamp) {
      // Both values have no timestamp (initial values for their instance)
      if (incomingInstanceTimestamp > currentInstanceTimestamp) {
        // incoming initial value is from newer instance
        mergedValues[key] = incomingValue;
        changedValues[key] = incomingValue;
      } else if (incomingInstanceTimestamp === currentInstanceTimestamp) {
        // identical instance timestamp
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
      continue;
    }

    if (
      currentValue.timestamp &&
      incomingValue.timestamp &&
      incomingValue.timestamp > currentValue.timestamp
    ) {
      // both values have a timestamp and the incoming value's is newer
      mergedValues[key] = incomingValue;
      changedValues[key] = incomingValue;
    } else if (currentValue.timestamp === null) {
      // the incoming value has a timestamp and the current value has no timestamp
      mergedValues[key] = incomingValue;
      changedValues[key] = incomingValue;
    }
  }

  return {
    mergedValues,
    changedValues,
  };
}

export type BroadcastChannelStorageMessage =
  | {
      type: 'request';
      payload: InstanceState;
    }
  | {
      type: 'values';
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
      };
    }
  | {
      type: 'remove';
      payload: string;
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
  /** initial data */
  initialData?: Record<string, string | null>;
  /** channel */
  channel?: BroadcastChannel | null;
  /** sessionKeys */
  sessionKeys?: string[];
};

const DEFAULT_CHANNEL_NAME = '__broadcast_channel-storage';
const DEFAULT_RESPONSE_TIMEOUT = 50;

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
  private _channel: BroadcastChannel | null = null;
  private _storedValues: Map<string, StoredValue> = new Map();
  private _startTimestamp: number | null = null;
  private _startPromise: Promise<void> | null = null;
  private _startController: AbortController | null = null;
  private _channelListener: { cancel: () => void } | null = null;
  private _listeners: {
    type: string;
    callback: EventListenerOrEventListenerObject;
  }[] = [];
  private _started: boolean = false;

  constructor(options: BroadcastChannelStorageOptions = {}) {
    super();
    const {
      channelName = DEFAULT_CHANNEL_NAME,
      responseTimeoutMs = DEFAULT_RESPONSE_TIMEOUT,
      initialData = {},
      channel = null,
      sessionKeys = []
    } = options;
    this._options = {
      channelName,
      responseTimeoutMs,
      initialData,
      channel,
      sessionKeys
    };
    if (channel) {
      this._channel = channel;
    }
    this.start();
  }

  private _cleanup() {
    this._started = false;
    if (this._listeners.length > 0) {
      for (const { type, callback } of this._listeners) {
        super.removeEventListener(type, callback);
      }
      this._listeners = [];
    }
    if (this._startController) {
      this._startController.abort();
      this._startController = null;
    }
    if (this._channelListener) {
      this._channelListener.cancel();
    }
    if (!this._options.channel && this._channel) {
      this._channel.close();
      this._channel = null;
    }
    if (this._startPromise) {
      this._startPromise = null;
    }
    if (this._startTimestamp) {
      this._startTimestamp = null;
    }
    this._storedValues.clear();
  }

  keys() {
    return Array.from(this._storedValues.keys());
  }

  start() {
    if (this._startPromise) {
      return this._startPromise;
    }

    this._startController = new AbortController();
    const { signal } = this._startController;

    this._startPromise = new Promise<void>((resolve, reject) => {
      this._startTimestamp = getUniqueTimestamp();
      this._storedValues.clear();
      this._channel =
        this._options.channel ??
        new BroadcastChannel(this._options.channelName);

      const initialData = this._options.initialData;
      for (const key in initialData) {
        this._storedValues.set(key, {
          value: initialData[key] ?? null,
          timestamp: null,
        });
      }

      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const current: InstanceState = {
        instanceTimestamp: this._startTimestamp,
        values: Object.fromEntries(this._storedValues),
      };

      const handleTimeout = () => {
        const channel = this._channel;
        if (channel) {
          channel.removeEventListener('message', handleValuesResponse);
          this._started = true;
          resolve();
        } else {
          reject('Channel does not exist!');
        }
      };

      const handleValuesResponse = (
        event: MessageEvent<BroadcastChannelStorageMessage>,
      ) => {
        const action = event.data;
        if (action.type !== 'values') return;
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        timeoutId = setTimeout(handleTimeout, this._options.responseTimeoutMs);
      };

      this._channelListener = this._listen() || null;
      this._channel.addEventListener('message', handleValuesResponse, {
        signal,
      });

      this._postMessage({ type: 'request', payload: current });

      timeoutId = setTimeout(handleTimeout, this._options.responseTimeoutMs);

      signal.addEventListener('abort', () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        if (this._channel) {
          this._channel.removeEventListener('message', handleValuesResponse);
        }
        this._cleanup();
        reject('Instance was stopped');
      });
    });
    return this._startPromise;
  }

  stop() {
    this._cleanup();
  }

  instanceCount = async () => {
    const channel = this._channel;
    if (!channel) return;
    if (!this._startPromise) {
      throw new Error('Not started');
    }
    await this._startPromise;
    return new Promise<number>((resolve, reject) => {
      const timestamp = getUniqueTimestamp();
      let timerId: ReturnType<typeof setTimeout> | null = null;
      let instanceCount: number = 1;

      const handleTimeout = () => {
        const channel = this._channel;
        if (channel) {
          channel.removeEventListener('message', handlePongEvent);
          resolve(instanceCount);
        } else {
          reject('Channel does not exist!');
        }
      };

      const handlePongEvent = (
        event: MessageEvent<BroadcastChannelStorageMessage>,
      ) => {
        const action = event.data;
        if (action.type !== 'pong' || action.payload !== timestamp) return;
        instanceCount++;
        if (timerId) {
          clearTimeout(timerId);
        }
        timerId = setTimeout(handleTimeout, this._options.responseTimeoutMs);
      };

      channel.addEventListener('message', handlePongEvent);
      this._postMessage({ type: 'ping', payload: timestamp });

      timerId = setTimeout(handleTimeout, this._options.responseTimeoutMs);
    });
  };

  getItem = (key: string) => {
    if (!this._startPromise) {
      throw new Error('Instance not started');
    }
    if (!this._started) {
      throw new Error('Instance start incomplete');
    }
    if (typeof key !== 'string' || key.length === 0) {
      throw new Error('invalid key');
    }
    const value = this._storedValues.get(key)?.value || null;
    return value;
  };

  setItem = (key: string, value: string) => {
    if (!this._startPromise) {
      throw new Error('Instance not started');
    }
    if (!this._started) {
      throw new Error('Instance start incomplete');
    }
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
      },
    });
  };

  removeItem = (key: string) => {
    if (!this._startPromise) {
      throw new Error('Instance not started');
    }
    if (!this._started) {
      throw new Error('Instance start incomplete');
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
    if (newValue.value === oldValue.value) return;
    this._storedValues.set(key, newValue);
    this._postMessage({
      type: 'remove',
      payload: key,
    });
  };

  clear = () => {
    if (!this._startPromise) {
      throw new Error('Instance not started');
    }
    if (!this._started) {
      throw new Error('Instance start incomplete');
    }
    this._storedValues.clear();
    this._postMessage({
      type: 'clear',
      payload: getUniqueTimestamp(),
    });
  };

  private _postMessage(message: BroadcastChannelStorageMessage) {
    if (this._channel) {
      // if user supplied channel has been closed, it will fail to post a message
      try {
        this._channel.postMessage(message);
      } catch (error) {
        this._cleanup();
        throw error;
      }
    }
  }

  private _merge(incoming: InstanceState) {
    const startTimestamp = this._startTimestamp;
    if (!startTimestamp) {
      throw new Error('Instance not started');
    }
    const current: InstanceState = {
      instanceTimestamp: startTimestamp,
      values: Object.fromEntries(this._storedValues),
    };
    const { mergedValues, changedValues } = mergeValues(current, incoming);
    for (const key in changedValues) {
      const oldValue = this._storedValues.get('key') || {
        value: null,
        timestamp: null,
      };
      const newValue = changedValues[key]!;
      this._storedValues.set(key, newValue);
      if (this._started && oldValue.value !== newValue.value) {
        const storageEvent = new BroadcastChannelStorageEvent('storage', {
          key,
          oldValue: oldValue.value,
          newValue: newValue.value,
        });
        this.dispatchEvent(storageEvent);
      }
    }
    return { mergedValues, changedValues };
  }

  private _listen() {
    const channel = this._channel;
    const startTimestamp = this._startTimestamp;
    if (!channel) {
      return;
    }
    if (!startTimestamp) {
      return;
    }

    const listener = (event: MessageEvent<BroadcastChannelStorageMessage>) => {
      const action = event.data;

      if (action.type === 'ping') {
        this._postMessage({ type: 'pong', payload: action.payload });
      }

      if (action.type === 'request' || action.type === 'values') {
        const incoming = action.payload;
        this._merge(incoming);

        // const current: InstanceState = {
        //   instanceTimestamp: startTimestamp,
        //   values: Object.fromEntries(this._storedValues),
        // };

        // const { mergedValues, changedValues } = mergeValues(current, incoming);

        // for (const key in changedValues) {
        //   const oldValue = this._storedValues.get('key') || {
        //     value: null,
        //     timestamp: null,
        //   };
        //   const newValue = changedValues[key]!;
        //   this._storedValues.set(key, newValue);
        //   if (this._started && oldValue.value !== newValue.value) {
        //     const storageEvent = new BroadcastChannelStorageEvent('storage', {
        //       key,
        //       oldValue: oldValue.value,
        //       newValue: newValue.value,
        //     });
        //     this.dispatchEvent(storageEvent);
        //   }
        // }

        if (action.type === 'request') {
          this._postMessage({
            type: 'values',
            payload: {
              instanceTimestamp: startTimestamp,
              values: Object.fromEntries(this._storedValues),
            },
          });
        }
      }

      if (action.type === 'set') {
        const { key, value, timestamp } = action.payload;
        const newValue = { value, timestamp };
        const oldValue = this._storedValues.get(key) || {
          value: null,
          timestamp: null,
        };
        this._storedValues.set(key, newValue);
        if (!this._started || oldValue.value === newValue.value) return;
        const storageEvent = new BroadcastChannelStorageEvent('storage', {
          key,
          oldValue: oldValue.value,
          newValue: newValue.value,
        });
        this.dispatchEvent(storageEvent);
        return;
      }

      if (action.type === 'remove') {
        const key = action.payload;
        const oldValue = this._storedValues.get(key) || {
          value: null,
          timestamp: null,
        };
        this._storedValues.delete(key);
        if (!this._started || oldValue.value === null) return;
        const storageEvent = new BroadcastChannelStorageEvent('storage', {
          key,
          oldValue: oldValue.value,
          newValue: null,
        });
        this.dispatchEvent(storageEvent);
        return;
      }

      if (action.type === 'clear') {
        this._storedValues.clear();
        if (!this._started) return;
        const storageEvent = new BroadcastChannelStorageEvent('storage', {
          key: null,
          oldValue: null,
          newValue: null,
        });
        this.dispatchEvent(storageEvent);
        return;
      }
    };

    channel.addEventListener('message', listener);
    return {
      cancel: () => channel.removeEventListener('message', listener),
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
