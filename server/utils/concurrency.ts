export class Semaphore {
  private readonly waiters: Array<() => void> = [];
  private available: number;

  constructor(capacity: number) {
    this.available = Math.max(0, Math.floor(capacity));
  }

  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) {
      throw new Error('Aborted');
    }

    if (this.available > 0) {
      this.available -= 1;
      return () => this.release();
    }

    return await new Promise<() => void>((resolve, reject) => {
      const onAbort = () => {
        this.removeWaiter(notify);
        reject(new Error('Aborted'));
      };

      const notify = () => {
        if (signal && typeof signal.removeEventListener === 'function') {
          signal.removeEventListener('abort', onAbort);
        }
        this.available -= 1;
        resolve(() => this.release());
      };

      if (signal && typeof signal.addEventListener === 'function') {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      this.waiters.push(notify);
    });
  }

  private removeWaiter(waiter: () => void) {
    const idx = this.waiters.indexOf(waiter);
    if (idx >= 0) {
      this.waiters.splice(idx, 1);
    }
  }

  private release() {
    this.available += 1;
    const next = this.waiters.shift();
    if (next) {
      next();
    }
  }
}
