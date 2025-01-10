import {
  BroadcastChannelStorageEvent,
  BroadcastChannelStorage,
  mergeValues,
  getUniqueTimestamp,
} from '../src/BroadcastChannelStorage.js';
import type { InstanceState } from '../src/BroadcastChannelStorage.js';
import { it, expect, describe, vi } from 'vitest';

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
  it('should reject `ready()` with an error if the instance was closed before finishing', async () => {
    // large response time so the `close()` will happen before the `ready()` completes
    const storage1 = new BroadcastChannelStorage({ responseTimeoutMs: 500 });
    const result = storage1.ready();
    storage1.close();
    await expect(result).rejects.toThrowError('Channel is closed');
  });

  it('should know when last instance', async () => {
    const storage1 = new BroadcastChannelStorage();
    await storage1.ready();
    expect(storage1.isLastInstance).toBe(true);
    const storage2 = new BroadcastChannelStorage();
    await storage2.ready();
    expect(storage1.isLastInstance).toBe(false);
    expect(storage2.isLastInstance).toBe(false);
    storage2.close();
    await storage1.sync();
    expect(storage1.isLastInstance).toBe(true);
    storage1.close();
  });

  it('should only emit a storage event once finished starting', async () => {
    // Create a mock event listener
    const eventListener = vi.fn();

    // Get storage1 ready
    const storage1 = new BroadcastChannelStorage({ responseTimeoutMs: 0 });
    await storage1.ready();

    // Quickly create storage2 and set a value in storage 1, storage 2 should receive the change while loading but not emit
    const storage2 = new BroadcastChannelStorage({ responseTimeoutMs: 500 });
    storage2.addEventListener('storage', eventListener);
    storage1.setItem('test', '123');

    await storage2.ready();
    storage1.setItem('test', '456');

    // Wait for the event to be processed
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(eventListener).toHaveBeenCalledOnce();
    const eventObject: BroadcastChannelStorageEvent =
      eventListener.mock.calls[0][0];
    expect(eventObject).toBeInstanceOf(BroadcastChannelStorageEvent);
    expect(eventObject.key).toBe('test');
    expect(eventObject.oldValue).toBe('123');
    expect(eventObject.newValue).toBe('456');

    storage1.close();
    storage2.close();
  });

  it('should set and get an item correctly', async () => {
    const storage = new BroadcastChannelStorage();
    await storage.ready();
    storage.setItem('test', 'testvalue');
    const value = storage.getItem('test');
    expect(value).toBe('testvalue');

    storage.close();
  });

  it('should remove an item correctly', async () => {
    const storage = new BroadcastChannelStorage();
    await storage.ready();
    storage.setItem('test', 'testvalue');
    storage.removeItem('test');
    const value = storage.getItem('test');
    expect(value).toBeNull();

    storage.close();
  });

  it('should clear all items correctly', async () => {
    const storage = new BroadcastChannelStorage();
    await storage.ready();
    storage.setItem('test', 'testvalue');
    storage.setItem('test2', 'testvalue2');
    storage.clear();
    const value1 = storage.getItem('test');
    const value2 = storage.getItem('test2');
    expect(value1).toBeNull();
    expect(value2).toBeNull();

    storage.close();
  });

  it('should retrieve a value set in one instance from another instance', async () => {
    const testValue = 'value set in first instance';
    const storage1 = new BroadcastChannelStorage();
    const storage2 = new BroadcastChannelStorage();
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

    storage1.close();
    storage2.close();
  });

  it('should sync values in a predictable way', async () => {
    const storage1 = new BroadcastChannelStorage();
    storage1.setItem('unchanged', 'red');
    storage1.setItem('changed', 'yellow');
    storage1.setItem('setInOne', 'blue');
    const storage2 = new BroadcastChannelStorage();
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
    storage1.close();
    storage2.close();
  });
});
