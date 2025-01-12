**broadcast-channel-storage**

localStorage-like API to share temporary state across tabs using Broadcast Channel.

## Installation

```bash
npm install broadcast-channel-storage
```

## Usage

### Importing the Library

```javascript
import BroadcastChannelStorage from 'broadcast-channel-storage';
```

### Creating an Instance

```javascript
const storage = new BroadcastChannelStorage();
```

You can also provide optional values to the constructor:

```javascript
const storage = new BroadcastChannelStorage({
  channelName: 'my-channel', // BroadcastChannel name. Default is '__broadcast-channel-storage'
  responseTimeoutMs: 200, // Timeout while waiting for response from sync/ready. Default is 200ms
});
```

### Setting an Item

```javascript
storage.setItem('key', 'value');
```

### Getting an Item

```javascript
const value = storage.getItem('key');
```

### Removing an Item

```javascript
storage.removeItem('key');
```

### Clearing All Items

```javascript
storage.clear();
```

### Listening for Changes

```javascript
storage.addEventListener('storage', (event) => {
  console.log(
    `Key ${event.key} changed from ${event.oldValue} to ${event.newValue}`,
  );
});
```

Note: Similar to the original localStorage storage event, changes made in one `BroadcastChannelStorage` instance will emit storage events for other instances, but not for the instance where the change was made.

### Waiting for Ready State

On initialization, it may not have synced yet. You can wait until it's ready before reading a value:

```javascript
await storage.ready();
const value = storage.getItem('key');
console.log(value);
```

### Forcing a Sync

You can force a sync using the `sync()` method:

```javascript
await storage.sync();
```

### Properties

- `length`: Gets the number of values.
- `values`: Returns all the values.
- `isReady`: A flag that is true when the initial sync has happened.
- `isClosed`: A flag that is true when the channel is closed.
- `isLastInstance`: A flag that is true when it is known that this is the final `BroadcastChannelStorage` instance.

To force updating the `isLastInstance` property:

```javascript
await storage.sync();
console.log(storage.isLastInstance);
```

### Events

The library extends `EventTarget` and emits the following events:

- `storage`: Emitted when a storage item is changed.
- `ready`: Emitted when the initial sync has completed.
- `closed`: Emitted when the storage instance is closed.

## API

### `setItem(key: string, value: any): void`

Sets the value for the specified key.

### `getItem(key: string): any`

Gets the value for the specified key.

### `removeItem(key: string): void`

Removes the specified key.

### `clear(): void`

Clears all keys.

### `addEventListener(event: string, callback: Function): void`

Registers an event listener for the specified event.

### `ready(): Promise<void>`

Waits until the initial sync has happened.

### `sync(): Promise<void>`

Forces a sync with other instances.
