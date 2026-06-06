export type GenerateJobData = { projectId: string; runId: string };
export type JobProcessor = (data: GenerateJobData) => Promise<void>;

export interface JobQueue {
  /** Register the processor. InProcessQueue runs it on enqueue; BullMQ's worker-main calls it. */
  start(processor: JobProcessor): void;
  /** Fire-and-forget enqueue — does NOT await completion. */
  enqueue(data: GenerateJobData): Promise<void>;
  /** Resolves when all in-flight + queued jobs finish (deterministic tests + graceful drain). */
  onIdle(): Promise<void>;
  close(): Promise<void>;
}

/** In-process, concurrency-limited, fire-and-forget. Runs jobs in the API process. */
export class InProcessQueue implements JobQueue {
  #processor?: JobProcessor;
  #active = 0;
  readonly #pending: GenerateJobData[] = [];
  readonly #idleWaiters: Array<() => void> = [];
  #closed = false;
  constructor(private readonly concurrency = 2) {}

  start(processor: JobProcessor): void {
    this.#processor = processor;
  }

  async enqueue(data: GenerateJobData): Promise<void> {
    if (this.#closed) throw new Error("queue is closed");
    if (!this.#processor) throw new Error("queue.start(processor) not called");
    this.#pending.push(data);
    this.#drain();
  }

  #drain(): void {
    while (this.#active < this.concurrency && this.#pending.length > 0) {
      const data = this.#pending.shift()!;
      this.#active += 1;
      // Errors are swallowed: runGeneration already marks the run failed; a failed
      // job must not crash the queue or reject the (already-returned) enqueue.
      Promise.resolve(this.#processor!(data))
        .catch(() => {})
        .finally(() => {
          this.#active -= 1;
          if (this.#active === 0 && this.#pending.length === 0) {
            this.#idleWaiters.splice(0).forEach((r) => r());
          } else {
            this.#drain();
          }
        });
    }
  }

  onIdle(): Promise<void> {
    if (this.#active === 0 && this.#pending.length === 0) return Promise.resolve();
    return new Promise<void>((resolve) => this.#idleWaiters.push(resolve));
  }

  async close(): Promise<void> {
    this.#closed = true;
    await this.onIdle();
  }
}
