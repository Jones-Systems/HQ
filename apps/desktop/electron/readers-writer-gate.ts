/** Writer-fair gate. A callback must not reacquire this gate. */
export class ReadersWriterGate {
  private readers = 0;
  private writer = false;
  private readonly queue: { exclusive: boolean; start(): void }[] = [];
  shared<T>(run: () => Promise<T>): Promise<T> { return this.enter(false, run); }
  exclusive<T>(run: () => Promise<T>): Promise<T> { return this.enter(true, run); }
  private enter<T>(exclusive: boolean, run: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({ exclusive, start: () => {
        if (exclusive) this.writer = true; else this.readers++;
        void Promise.resolve().then(run).then(resolve, reject).finally(() => {
          if (exclusive) this.writer = false; else this.readers--;
          this.drain();
        });
      } });
      this.drain();
    });
  }
  private drain() {
    if (this.writer) return;
    while (this.queue.length) {
      const next = this.queue[0]!;
      if (next.exclusive && this.readers) return;
      this.queue.shift(); next.start();
      if (next.exclusive) return;
    }
  }
}
