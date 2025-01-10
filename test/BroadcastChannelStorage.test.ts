import {
  BroadcastChannelStorageEvent,
  BroadcastChannelStorage,
  mergeValues,
  getUniqueTimestamp,
  BroadcastChannelClosedEvent,
} from '../src/BroadcastChannelStorage.js';
import {
  BroadcastChannelReadyEvent,
  InstanceState,
} from '../src/BroadcastChannelStorage.js';
import { it, expect, describe, vi, afterEach } from 'vitest';

describe('getUniqueTimestamp', () => {
  it('should produce ascending timestamp values if getUniqueTimestamp is run in quick succession in same process.', () => {
    const timestamp1 = getUniqueTimestamp();
    const timestamp2 = getUniqueTimestamp();
    expect(timestamp2).to.be.greaterThan(timestamp1);
  });
});

describe('mergeValues', () => {
  it('should combine values', () => {
    const timestamp1 = getUniqueTimestamp();
    const timestamp2 = getUniqueTimestamp();
    const current: InstanceState = {
      clearedTimestamp: null,
      values: {
        test: {
          value: '123',
          timestamp: timestamp1,
        },
      },
    };
    const incoming: InstanceState = {
      clearedTimestamp: null,
      values: {
        test2: {
          value: '456',
          timestamp: timestamp2,
        },
      },
    };
    const { mergedValues, changedValues } = mergeValues(current, incoming);
    expect(changedValues).toEqual({
      test2: {
        value: '456',
        timestamp: timestamp2,
      },
    });
    expect(mergedValues).toEqual({
      test: {
        value: '123',
        timestamp: timestamp1,
      },
      test2: {
        value: '456',
        timestamp: timestamp2,
      },
    });
  });
  it('should change values', () => {
    const timestamp1 = getUniqueTimestamp();
    const timestamp2 = getUniqueTimestamp();
    const current: InstanceState = {
      clearedTimestamp: null,
      values: {
        test1: {
          value: '123',
          timestamp: timestamp1,
        },
        test2: {
          value: '456',
          timestamp: timestamp1,
        },
        test3: {
          value: 'bbbb',
          timestamp: timestamp1,
        },
      },
    };
    // note since test3 value has same timestamp, the larger value lexicographically will win: 'bbbb'
    const incoming: InstanceState = {
      clearedTimestamp: null,
      values: {
        test1: {
          value: null,
          timestamp: timestamp2,
        },
        test2: {
          value: '012',
          timestamp: timestamp2,
        },
        test3: {
          value: 'aaaa',
          timestamp: timestamp1,
        },
      },
    };
    const { mergedValues, changedValues, clearedValues } = mergeValues(
      current,
      incoming,
    );
    expect(changedValues).toEqual({
      test1: {
        value: null,
        timestamp: timestamp2,
      },
      test2: {
        value: '012',
        timestamp: timestamp2,
      },
    });
    expect(clearedValues.length).toBe(0);
    expect(mergedValues).toEqual({
      test1: {
        value: null,
        timestamp: timestamp2,
      },
      test2: {
        value: '012',
        timestamp: timestamp2,
      },
      test3: {
        value: 'bbbb',
        timestamp: timestamp1,
      },
    });
  });
  it('should handle cleared values', () => {
    const timestamp1 = getUniqueTimestamp();
    const timestamp2 = getUniqueTimestamp();
    const timestamp3 = getUniqueTimestamp();
    const current: InstanceState = {
      clearedTimestamp: null,
      values: {
        test1: {
          value: '123',
          timestamp: timestamp1,
        },
        test2: {
          value: '456',
          timestamp: timestamp2,
        },
        test3: {
          value: '789',
          timestamp: timestamp3,
        },
      },
    };
    const incoming: InstanceState = {
      clearedTimestamp: timestamp2,
      values: {
        test4: {
          value: 'aaaa',
          timestamp: timestamp3,
        },
      },
    };
    const { clearedTimestamp, mergedValues, changedValues, clearedValues } =
      mergeValues(current, incoming);
    expect(changedValues).toEqual({
      test4: {
        value: 'aaaa',
        timestamp: timestamp3,
      },
    });
    expect(clearedTimestamp).toBe(timestamp2);
    expect(clearedValues.length).toBe(2);
    expect(clearedValues.includes('test1')).toBeTruthy;
    expect(clearedValues.includes('test2')).toBeTruthy;
    expect(mergedValues).toEqual({
      test3: {
        value: '789',
        timestamp: timestamp3,
      },
      test4: {
        value: 'aaaa',
        timestamp: timestamp3,
      },
    });
  });
});

describe('BroadcastChannelStorage', () => {
  let storage: BroadcastChannelStorage | null = null;
  let storage1: BroadcastChannelStorage | null = null;
  let storage2: BroadcastChannelStorage | null = null;

  afterEach(() => {
    if (storage) {
      storage.close();
      storage = null;
    }
    if (storage1) {
      storage1.close();
      storage1 = null;
    }
    if (storage2) {
      storage2.close();
      storage2 = null;
    }
  });

  it("should dispatch 'ready' and 'closed' events", async () => {
    // Create a mock event listener
    const readyEventListener = vi.fn();
    const closedEventListener = vi.fn();

    storage = new BroadcastChannelStorage({ responseTimeoutMs: 50 });
    storage.addEventListener('ready', readyEventListener);
    storage.addEventListener('closed', closedEventListener);
    await storage.ready();
    await storage.ready();
    await storage.sync();

    const readyEvent: BroadcastChannelReadyEvent =
      readyEventListener.mock.calls[0][0];
    expect(readyEventListener).toHaveBeenCalledOnce();
    expect(readyEvent).toBeInstanceOf(BroadcastChannelReadyEvent);

    storage.close();
    storage.close();

    const closedEvent: BroadcastChannelClosedEvent =
      closedEventListener.mock.calls[0][0];
    expect(closedEventListener).toHaveBeenCalledOnce();
    expect(closedEvent).toBeInstanceOf(BroadcastChannelClosedEvent);
  });

  it('should reject `ready()` with an error if the instance was closed before finishing', async () => {
    // large response time so the `close()` will happen before the `ready()` completes
    storage = new BroadcastChannelStorage({ responseTimeoutMs: 500 });
    const result = storage.ready();
    storage.close();
    await expect(result).rejects.toThrowError('Channel is closed');
  });

  it('should know when last instance', async () => {
    storage1 = new BroadcastChannelStorage();
    await storage1.ready();
    expect(storage1.isLastInstance).toBe(true);
    storage2 = new BroadcastChannelStorage();
    await storage2.ready();
    expect(storage1.isLastInstance).toBe(false);
    expect(storage2.isLastInstance).toBe(false);
    storage2.close();
    await storage1.sync();
    expect(storage1.isLastInstance).toBe(true);
  });

  it('should only emit a storage event once finished starting', async () => {
    // Create a mock event listener
    const eventListener = vi.fn();

    // Get storage1 ready
    storage1 = new BroadcastChannelStorage({ responseTimeoutMs: 0 });
    await storage1.ready();

    // Quickly create storage2 and set a value in storage 1, storage 2 should receive the change while loading but not emit
    storage2 = new BroadcastChannelStorage({ responseTimeoutMs: 500 });
    storage2.addEventListener('storage', eventListener);
    storage1.setItem('test', '123');

    await storage2.ready();
    storage1.setItem('test', '456');

    // Wait for the event to be processed
    await new Promise((resolve) => setTimeout(resolve, 100));

    const eventObject: BroadcastChannelStorageEvent =
      eventListener.mock.calls[0][0];

    expect(eventListener).toHaveBeenCalledOnce();
    expect(eventObject).toBeInstanceOf(BroadcastChannelStorageEvent);
    expect(eventObject.key).toBe('test');
    expect(eventObject.oldValue).toBe('123');
    expect(eventObject.newValue).toBe('456');
  });

  it('should set and get an item correctly', async () => {
    storage = new BroadcastChannelStorage();
    await storage.ready();
    storage.setItem('test', 'testvalue');
    const value = storage.getItem('test');
    expect(value).toBe('testvalue');
  });

  it('should remove an item correctly', async () => {
    storage = new BroadcastChannelStorage();
    await storage.ready();
    storage.setItem('test', 'testvalue');
    storage.removeItem('test');
    const value = storage.getItem('test');
    expect(value).toBeNull();
  });

  it('should clear all items correctly', async () => {
    storage = new BroadcastChannelStorage();
    await storage.ready();
    storage.setItem('test', 'testvalue');
    storage.setItem('test2', 'testvalue2');
    storage.clear();
    const value1 = storage.getItem('test');
    const value2 = storage.getItem('test2');
    expect(value1).toBeNull();
    expect(value2).toBeNull();
  });

  it('should retrieve a value set in one instance from another instance', async () => {
    const testValue = 'value set in first instance';
    storage1 = new BroadcastChannelStorage();
    storage2 = new BroadcastChannelStorage();
    let oldValue: string | null = null;
    let newValue: string | null = null;
    const listener = (e: BroadcastChannelStorageEvent) => {
      oldValue = e.oldValue;
      newValue = e.newValue;
    };
    storage2.addEventListener('storage', listener);
    await storage1.ready();
    storage1.setItem('test', testValue);
    // Wait for the event to be processed
    await new Promise((resolve) => setTimeout(resolve, 100));
    await storage2.ready();
    const value = storage2.getItem('test');

    expect(oldValue).toBeNull();
    expect(newValue).toBe(testValue);
    expect(value).toBe(testValue);
  });

  it('should sync values in a predictable way', async () => {
    storage1 = new BroadcastChannelStorage();
    storage1.setItem('unchanged', 'red');
    storage1.setItem('changed', 'yellow');
    storage1.setItem('setInOne', 'blue');
    storage2 = new BroadcastChannelStorage();
    storage2.setItem('unchanged', 'red');
    storage2.setItem('changed', 'orange');
    storage2.setItem('setInTwo', 'green');
    await Promise.all([storage1.ready(), storage2.ready()]);
    await Promise.all([storage1.sync(), storage2.sync()]);
    const expectedResult = {
      unchanged: 'red',
      changed: 'orange',
      setInOne: 'blue',
      setInTwo: 'green',
    };
    const storage1Result = storage1.values;
    const storage2Result = storage2.values;

    expect(storage1Result).toEqual(expectedResult);
    expect(storage2Result).toEqual(expectedResult);
  });
});
