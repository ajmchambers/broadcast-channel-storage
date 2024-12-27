export class Test {
  private _startPromise: Promise<void> | null = null;
  private _abortController: AbortController | null = null;
  private _channel: BroadcastChannel | null = null;

  constructor() {

  }

  start() {
    console.log('start()');
    if (this._startPromise) {
      console.log('start() - returning existing promise');
      return this._startPromise;
    }

    const abortController = new AbortController();
    this._abortController = abortController;
    const { signal } = abortController;

    const startPromise = new Promise<void>((resolve, reject) => {
      console.log('start() - creating and storing channel');
      const channel = new BroadcastChannel('test');
      this._channel = channel;

      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      
      const handleTimeout = () => {
        console.log('start() - timeout completed successfully, start finished');
        resolve();
      };

      timeoutId = setTimeout(handleTimeout, 3000);

      signal.addEventListener("abort", () => {
        console.log('start() - received abort signal, clearing timeout and running cleanup');
        if (timeoutId) clearTimeout(timeoutId)
        clearTimeout(timeoutId);
        this._cleanup();
        reject('Instance was stopped');
      });
    });

    console.log('start() - storing promise');
    this._startPromise = startPromise;
    
    return startPromise;
  }

  stop() {
    console.log('stop()');
    this._cleanup();
  }

  private _cleanup() {
    console.log('_cleanup()');
    if (this._abortController) {
      console.log('_cleanup() - sending abort signal and setting to null');
      this._abortController.abort();
      this._abortController = null;
    }
    if (this._channel) {
      console.log('_cleanup() - closing channel and setting to null');
      this._channel.close();
      this._channel = null;
    }
    if (this._startPromise) {
      console.log('_cleanup() - setting promise to null');
      this._startPromise = null;
    }
  }
}