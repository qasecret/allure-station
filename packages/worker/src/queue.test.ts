import { describe, it, expect } from "vitest";
import { InProcessQueue, type GenerateJobData } from "./queue.js";

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
