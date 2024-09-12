import { BroadcastChannelStorage } from './BroadcastChannelStorage.js';
import { test, expect } from 'vitest';

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
  const listener = (e: StorageEvent) => {
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
