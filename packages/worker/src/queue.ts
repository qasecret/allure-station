export type Job<T> = () => Promise<T>;

/** Minimal concurrency-limited queue. Phase 2 swaps this for a BullMQ-backed impl. */
export interface JobQueue {
  add<T>(job: Job<T>): Promise<T>;
}

export class InProcessQueue implements JobQueue {
  #active = 0;
  readonly #pending: Array<() => void> = [];
  constructor(private readonly concurrency = 2) {}

  add<T>(job: Job<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        this.#active += 1;
        job().then(resolve, reject).finally(() => {
          this.#active -= 1;
          const next = this.#pending.shift();
          if (next) next();
        });
      };
      if (this.#active < this.concurrency) run();
      else this.#pending.push(run);
    });
  }
}
