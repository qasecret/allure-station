import { EventEmitter } from "node:events";
import { Redis } from "ioredis";
import type { RunEvent } from "@allure-station/shared";

export interface EventBus {
  /** Fire-and-forget publish. In RedisBus, local subscribers are notified via the round-trip too. */
  publish(event: RunEvent): void;
  /** Subscribe to all events. Returns an unsubscribe function. */
  subscribe(listener: (event: RunEvent) => void): () => void;
  close(): Promise<void>;
}

const CHANNEL = "allure-station:run-events";

/** Single-process bus. Publisher and subscribers share one EventEmitter. */
export class InProcessBus implements EventBus {
  readonly #emitter = new EventEmitter();
  constructor() {
    // SSE fans out to one listener per connected client; lift the default cap.
    this.#emitter.setMaxListeners(0);
  }
  publish(event: RunEvent): void {
    this.#emitter.emit(CHANNEL, event);
  }
  subscribe(listener: (event: RunEvent) => void): () => void {
    this.#emitter.on(CHANNEL, listener);
    return () => this.#emitter.off(CHANNEL, listener);
  }
  async close(): Promise<void> {
    this.#emitter.removeAllListeners();
  }
}

/**
 * Cross-process bus via Redis pub/sub. Used in bullmq mode so the worker's ready/failed
 * transitions reach SSE clients on every API replica. Redis requires a dedicated connection
 * in subscribe mode, so we hold two clients. publish() goes only to Redis; the subscriber
 * connection drives local listeners — one path, correct multi-replica fan-out (including self).
 */
export class RedisBus implements EventBus {
  readonly #pub: Redis;
  readonly #sub: Redis;
  readonly #listeners = new Set<(event: RunEvent) => void>();
  readonly #ready: Promise<void>;

  constructor(url: string) {
    this.#pub = new Redis(url, { maxRetriesPerRequest: null });
    this.#sub = new Redis(url, { maxRetriesPerRequest: null });
    this.#pub.on("error", (err) => console.error("[events] redis pub error:", err));
    this.#sub.on("error", (err) => console.error("[events] redis sub error:", err));
    this.#sub.on("message", (_channel, message) => {
      let event: RunEvent;
      try {
        event = JSON.parse(message) as RunEvent;
      } catch (err) {
        console.error("[events] dropping malformed run event:", err);
        return;
      }
      for (const l of this.#listeners) l(event);
    });
    this.#ready = this.#sub.subscribe(CHANNEL).then(() => undefined);
  }

  publish(event: RunEvent): void {
    // Ensure the channel is subscribed before publishing in fast test/startup paths,
    // then publish. Errors are logged, never thrown into the caller (fire-and-forget).
    this.#ready
      .then(() => this.#pub.publish(CHANNEL, JSON.stringify(event)))
      .catch((err) => console.error("[events] publish failed:", err));
  }

  subscribe(listener: (event: RunEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async close(): Promise<void> {
    this.#listeners.clear();
    this.#pub.disconnect();
    this.#sub.disconnect();
  }
}
