import { describe, it, expect, vi } from "vitest";
import { InProcessQueue, BullMQQueue, type GenerateJobData } from "./queue.js";

describe("InProcessQueue", () => {
  it("runs enqueued jobs via the registered processor, honoring concurrency, and onIdle waits", async () => {
    const q = new InProcessQueue(2);
    let active = 0, maxActive = 0;
    const done: string[] = [];
    q.start(async (d) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
      done.push(d.runId);
    });
    for (const id of ["a", "b", "c", "d"]) await q.enqueue({ projectId: "p", runId: id });
    await q.onIdle();
    expect(done.sort()).toEqual(["a", "b", "c", "d"]);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("a throwing processor does not reject enqueue and does not stall the queue", async () => {
    const q = new InProcessQueue(1);
    const seen: string[] = [];
    q.start(async (d) => {
      if (d.runId === "boom") throw new Error("x");
      seen.push(d.runId);
    });
    await q.enqueue({ projectId: "p", runId: "boom" });
    await q.enqueue({ projectId: "p", runId: "ok" });
    await q.onIdle();
    expect(seen).toEqual(["ok"]); // boom failed silently, ok still ran
  });

  it("enqueue before start throws", async () => {
    const q = new InProcessQueue(1);
    await expect(q.enqueue({ projectId: "p", runId: "x" } as GenerateJobData)).rejects.toThrow(/start/);
  });
});

const url = process.env.REDIS_TEST_URL;
(url ? describe : describe.skip)("BullMQQueue (requires REDIS_TEST_URL)", () => {
  it("enqueued data is processed by a started worker", async () => {
    const producer = new BullMQQueue({ url: url!, concurrency: 2 });
    const consumer = new BullMQQueue({ url: url!, concurrency: 2 });
    const seen: string[] = [];
    consumer.start(async (d) => {
      seen.push(d.runId);
    });
    await producer.enqueue({ projectId: "p", runId: "r1" });
    await vi.waitFor(() => expect(seen).toContain("r1"), { timeout: 5000 });
    await producer.close();
    await consumer.close();
  });
});
