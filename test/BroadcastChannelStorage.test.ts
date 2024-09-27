import type { BroadcastChannelStorageEvent } from '../src/BroadcastChannelStorage.js';
import {
  BroadcastChannelStorage,
  consolidateValues,
} from '../src/BroadcastChannelStorage.js';
import { test, expect } from 'vitest';

test('should consolidate separate sets of values', () => {
  const now = new Date();
  const pre15min = new Date(Date.now() - 15 * 60 * 1000); // 15 minutes ago
  const pre30min = new Date(Date.now() - 30 * 60 * 1000); // 30 minutes ago
  const instance1 = {
    instanceTimestamp: pre30min,
    values: {
      unchangedInitialValue: {
        value: 'red',
        timestamp: null,
      },
      differentInitialValue: {
        value: 'yellow',
        timestamp: null,
      },
      newerInOne: {
        value: 'green',
        timestamp: now,
      },
      newerInTwo: {
        value: 'blue',
        timestamp: pre15min,
      },
    },
  };
  const instance2 = {
    instanceTimestamp: now,
    values: {
      unchangedInitialValue: {
        value: 'red',
        timestamp: null,
      },
      differentInitialValue: {
        value: 'orange',
        timestamp: null,
      },
      newerInOne: {
        value: null,
        timestamp: null,
      },
      newerInTwo: {
        value: 'pink',
        timestamp: now,
      },
      onlyExistsInTwo: {
        value: 'cyan',
        timestamp: null,
      },
    },
  };
  const { changedCurrentValues, changedIncomingValues } = consolidateValues(
    instance1,
    instance2,
  );
  expect(changedCurrentValues).toMatchObject({
    differentInitialValue: {
      value: 'orange',
      timestamp: null,
    },
    newerInTwo: {
      value: 'pink',
      timestamp: now,
    },
    onlyExistsInTwo: {
      value: 'cyan',
      timestamp: null,
    },
  });
  expect(changedIncomingValues).toMatchObject({
    newerInOne: {
      value: 'green',
      timestamp: now,
    },
  });
});

test('should set and get an item correctly', async () => {
  const storage = new BroadcastChannelStorage();
  await storage.setItem('test', 'testvalue');
  const value = await storage.getItem('test');
  expect(value).toBe('testvalue');
  storage.destroy();
});

test('should remove an item correctly', async () => {
  const storage = new BroadcastChannelStorage();
  await storage.setItem('test', 'testvalue');
  await storage.removeItem('test');
  const value = await storage.getItem('test');
  expect(value).toBeNull();
  storage.destroy();
});

test('should clear all items correctly', async () => {
  const storage = new BroadcastChannelStorage();
  await storage.setItem('test', 'testvalue');
  await storage.setItem('test2', 'testvalue2');
  await storage.clear();
  const value1 = await storage.getItem('test');
  const value2 = await storage.getItem('test2');
  expect(value1).toBeNull();
  expect(value2).toBeNull();
  storage.destroy();
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
  await storage1.setItem('test', 'testvalue');
  // Wait for the event to be processed
  await new Promise((resolve) => setTimeout(resolve, 100));
  const value = await storage2.getItem('test');
  expect(oldValue).toBeNull();
  expect(newValue).toBe('testvalue');
  expect(value).toBe('testvalue');
  storage1.destroy();
  storage2.destroy();
});

test('should sync values in a predictable way', async () => {
  const storage1Events: any[] = [];
  const storage2Events: any[] = [];
  const storage1 = new BroadcastChannelStorage({
    initialData: {
      unchangedInitialValue: 'red',
      differentInitialValue: 'yellow',
      onlyExistsInOne: 'blue',
    },
  });
  (storage1 as any)._channel.addEventListener('message', (event) => {
    console.log('storage1', event.detail);
    storage1Events.push(event.detail);
  });
  storage1.addEventListener('storage', (event) => {
    console.log('storage1', event);
    storage1Events.push(event);
  });
  const storage2 = new BroadcastChannelStorage({
    initialData: {
      unchangedInitialValue: 'red',
      differentInitialValue: 'orange',
      onlyExistsInTwo: 'green',
    },
  });
  (storage2 as any)._channel.addEventListener('message', (event) => {
    console.log('storage2', event.detail);
    storage2Events.push(event.detail);
  });
  storage2.addEventListener('storage', (event) => {
    console.log('storage2', event);
    storage2Events.push(event);
  });
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const value = await storage2.getItem('test');
  expect(storage1Events.length).toBeGreaterThan(0);
  expect(storage2Events.length).toBeGreaterThan(0);
  storage1.destroy();
  storage2.destroy();
});
