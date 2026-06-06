import { describe, it, expect } from "vitest";
import { InProcessQueue } from "./queue.js";

describe("InProcessQueue", () => {
  it("runs jobs and resolves results, honoring concurrency", async () => {
    const q = new InProcessQueue(2);
    let active = 0;
    let maxActive = 0;
    const job = () => async () => {
      active += 1; maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 20));
      active -= 1;
      return "ok";
    };
    const results = await Promise.all([q.add(job()), q.add(job()), q.add(job()), q.add(job())]);
    expect(results).toEqual(["ok", "ok", "ok", "ok"]);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("rejects the caller when a job throws", async () => {
    const q = new InProcessQueue(1);
    await expect(q.add(async () => { throw new Error("nope"); })).rejects.toThrow("nope");
  });
});
