import { BroadcastChannelStorage } from '../../src/index.js';

const test = () => {
  const storage1 = new BroadcastChannelStorage({
    initialData: {
      color: 'green',
      animal: 'cat',
    },
  });
  storage1.addEventListener('storage', (event) =>
    console.log('storage1', event),
  );

  const storage2 = new BroadcastChannelStorage({
    initialData: {
      color: 'green',
      animal: 'dog',
      food: 'watermelon',
    },
  });
  storage2.addEventListener('storage', (event) =>
    console.log('storage2', event),
  );

  (window as any)['storage1'] = storage1;
  (window as any)['storage2'] = storage2;

  return {
    storage1,
    storage2,
  };
};

const test2 = () => {
  const now = Date.now(); // Current time in milliseconds since Unix epoch
  const preciseTime = performance.now(); // High-resolution time in milliseconds

  // Combine them to get a precise datetime
  const preciseDatetime = new Date(now + preciseTime);

  console.log('Current DateTime:', new Date(now).toISOString());
  console.log('Precise DateTime:', preciseDatetime.toISOString());
};

test();
test2();

console.log('yeooo');
(window as any)['BroadcastChannelStorage'] = BroadcastChannelStorage;
