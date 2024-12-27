import { BroadcastChannelStorage } from '../../src/index.js';
// import { BroadcastChannel as BC, createLeaderElection } from 'broadcast-channel';
import { SessionSync } from './test.js';

const BCSS = SessionSync(['password']);
BCSS.storage.addEventListener('storage', (event) => {
  if (event.key === 'password') {
    console.log(`password changed from ${event.oldValue} to ${event.newValue}`);
  }
});
BCSS.getItem('password').then(password => console.log(`password is ${password}`));

(window as any)['BCSS'] = BCSS;


const test2 = async () => {
  const channel1 = new BroadcastChannel('test');

  // Get storage1 ready
  const storage1 = new BroadcastChannelStorage({
    channel: channel1
  });
  storage1.addEventListener('storage', (event) => console.log('[storage1] event received', event));
  await storage1.start();

  // Quickly create storage2 and set a value in storage 1, storage 2 should receive the change while loading but not emit
  const storage2 = new BroadcastChannelStorage({
    channelName: 'test'
  });
  storage2.addEventListener('storage', (event) => console.log('[storage2] event received', event));
  storage1.setItem('test', '123');

  await storage2.start();
  storage2.setItem('test', '456');
  storage1.setItem('test', '789');

  (window as any)['storage1'] = storage1;
  (window as any)['storage2'] = storage2;
};

// const test = () => {
//   const storage1 = new BroadcastChannelStorage({
//     initialData: {
//       color: 'green',
//       animal: 'cat',
//     },
//   });
//   storage1.addEventListener('storage', (event) =>
//     console.log('storage1', event),
//   );

//   const storage2 = new BroadcastChannelStorage({
//     initialData: {
//       color: 'green',
//       animal: 'dog',
//       food: 'watermelon',
//     },
//   });
//   storage2.addEventListener('storage', (event) =>
//     console.log('storage2', event),
//   );

//   (window as any)['storage1'] = storage1;
//   (window as any)['storage2'] = storage2;

//   return {
//     storage1,
//     storage2,
//   };
// };

// const test2 = () => {
//   const now = Date.now(); // Current time in milliseconds since Unix epoch
//   const preciseTime = performance.now(); // High-resolution time in milliseconds

//   // Combine them to get a precise datetime
//   const preciseDatetime = new Date(now + preciseTime);

//   console.log('Current DateTime:', new Date(now).toISOString());
//   console.log('Precise DateTime:', preciseDatetime.toISOString());
// };

// test();
test2();

// console.log('yeooo');
// (window as any)['Test'] = Test;
