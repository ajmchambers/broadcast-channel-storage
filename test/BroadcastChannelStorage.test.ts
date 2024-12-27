import { BroadcastChannelStorageEvent } from '../src/BroadcastChannelStorage.js';
import {
  BroadcastChannelStorage,
  mergeValues,
  getUniqueTimestamp,
} from '../src/BroadcastChannelStorage.js';
import type { InstanceState } from '../src/BroadcastChannelStorage.js';
import { test, expect, describe, vi } from 'vitest';

describe('getUniqueTimestamp', () => {
  test('getUniqueTimestamp run in quick succession in same browser tab instance should produce ascending values.', () => {
    const timestamp1 = getUniqueTimestamp();
    const timestamp2 = getUniqueTimestamp();
    expect(timestamp2).to.be.greaterThan(timestamp1);
  });
});

describe('mergeValues', () => {
  test('mergeValues should prioritize default values from newer instances', () => {
    const instance1: InstanceState = {
      instanceTimestamp: getUniqueTimestamp(),
      values: {
        foo: {
          value: 'bar',
          timestamp: null,
        },
        color: {
          value: 'red',
          timestamp: null,
        },
      },
    };
    const instance2: InstanceState = {
      instanceTimestamp: getUniqueTimestamp(),
      values: {
        foo: {
          value: 'bar',
          timestamp: null,
        },
        color: {
          value: 'green',
          timestamp: null,
        },
      },
    };
    const { changedValues, mergedValues } = mergeValues(instance1, instance2);
    expect(changedValues).toMatchObject({
      color: {
        value: 'green',
        timestamp: null,
      },
    });
    expect(mergedValues).toMatchObject({
      foo: {
        value: 'bar',
        timestamp: null,
      },
      color: {
        value: 'green',
        timestamp: null,
      },
    });
  });

  test('mergeValues should prioritize default values that are larger lexicographically if both instances have identical timestamps.', () => {
    const timestamp = getUniqueTimestamp();
    const instance1: InstanceState = {
      instanceTimestamp: timestamp,
      values: {
        color: {
          value: 'red',
          timestamp: null,
        },
        pet: {
          value: 'cat',
          timestamp: null,
        },
      },
    };
    const instance2: InstanceState = {
      instanceTimestamp: timestamp,
      values: {
        color: {
          value: 'green',
          timestamp: null,
        },
        pet: {
          value: 'dog',
          timestamp: null,
        },
      },
    };
    const { mergedValues } = mergeValues(instance1, instance2);
    expect(mergedValues).toMatchObject({
      color: {
        value: 'red',
        timestamp: null,
      },
      pet: {
        value: 'dog',
        timestamp: null,
      },
    });
  });
});

describe('BroadcastChannelStorage', () => {
  test('instanceCount should return the number of running instances', async () => {
    const storage1 = new BroadcastChannelStorage();
    const storage2 = new BroadcastChannelStorage();
    const storage3 = new BroadcastChannelStorage();
    const instanceCount = await storage3.instanceCount();
    expect(instanceCount).toBe(3);
    storage1.stop();
    storage2.stop();
    storage3.stop();
  });

  test('should only emit a storage event once finished starting', async () => {
    // Get storage1 ready
    const storage1 = new BroadcastChannelStorage();
    await storage1.start();

    // Create a mock event listener
    const eventListener = vi.fn();

    // Quickly create storage2 and set a value in storage 1, storage 2 should receive the change while loading but not emit
    const storage2 = new BroadcastChannelStorage();
    storage2.addEventListener('storage', eventListener);
    storage1.setItem('test', '123');

    await storage2.start();
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

    storage1.stop();
    storage2.stop();
  });

  test('should set and get an item correctly', async () => {
    const storage = new BroadcastChannelStorage();
    await storage.start();
    storage.setItem('test', 'testvalue');
    const value = storage.getItem('test');
    expect(value).toBe('testvalue');
    storage.stop();
  });

  test('should remove an item correctly', async () => {
    const storage = new BroadcastChannelStorage();
    await storage.start();
    storage.setItem('test', 'testvalue');
    storage.removeItem('test');
    const value = storage.getItem('test');
    expect(value).toBeNull();
    storage.stop();
  });

  test('should clear all items correctly', async () => {
    const storage = new BroadcastChannelStorage();
    await storage.start();
    storage.setItem('test', 'testvalue');
    storage.setItem('test2', 'testvalue2');
    storage.clear();
    const value1 = storage.getItem('test');
    const value2 = storage.getItem('test2');
    expect(value1).toBeNull();
    expect(value2).toBeNull();
    storage.stop();
  });

  test('should retrieve a value set in one instance from another instance', async () => {
    const storage1 = new BroadcastChannelStorage();
    const storage2 = new BroadcastChannelStorage();
    let oldValue: string | null = null;
    let newValue: string | null = null;
    const listener = (e: BroadcastChannelStorageEvent) => {
      oldValue = e.oldValue;
      newValue = e.newValue;
    };
    storage2.addEventListener('storage', listener);
    await storage1.start();
    storage1.setItem('test', 'testvalue');
    // Wait for the event to be processed
    await new Promise((resolve) => setTimeout(resolve, 100));
    await storage2.start();
    const value = storage2.getItem('test');
    expect(oldValue).toBeNull();
    expect(newValue).toBe('testvalue');
    expect(value).toBe('testvalue');
    storage1.stop();
    storage2.stop();
  });

  test('should sync values in a predictable way', async () => {
    const storage1 = new BroadcastChannelStorage({
      initialData: {
        unchangedInitialValue: 'red',
        differentInitialValue: 'yellow',
        onlyExistsInOne: 'blue',
      },
    });
    const storage2 = new BroadcastChannelStorage({
      initialData: {
        unchangedInitialValue: 'red',
        differentInitialValue: 'orange',
        onlyExistsInTwo: 'green',
      },
    });
    await Promise.all([storage1.start(), storage2.start()]);
    const expectedResult = {
      unchangedInitialValue: 'red',
      differentInitialValue: 'orange',
      onlyExistsInOne: 'blue',
      onlyExistsInTwo: 'green',
    };
    const storage1Result = storage1.keys().reduce(
      (acc, key) => {
        const value = storage1.getItem(key);
        if (value) {
          acc[key] = value;
        }
        return acc;
      },
      {} as { [key: string]: string | null },
    );
    const storage2Result = storage2.keys().reduce(
      (acc, key) => {
        const value = storage2.getItem(key);
        if (value) {
          acc[key] = value;
        }
        return acc;
      },
      {} as { [key: string]: string | null },
    );
    // const storage1Result = await Promise.all(
    //   storage1.keys().map((key) => storage1.getItem(key)),
    // ).then((resultArray) => {
    //   console.log(resultArray);
    //   let result = {};
    //   keys.forEach((key, i) => (result[key] = resultArray[i]));
    //   return result;
    // });
    // const storage2Result = await Promise.all(
    //   storage2.keys().map((key) => storage2.getItem(key)),
    // ).then((resultArray) => {
    //   console.log(resultArray);
    //   let result = {};
    //   keys.forEach((key, i) => (result[key] = resultArray[i]));
    //   return result;
    // });
    expect(storage1Result).toEqual(expectedResult);
    expect(storage2Result).toEqual(expectedResult);
    storage1.stop();
    storage2.stop();
  });
});
