import { expect } from "vitest";
import type { EventBus } from "./bus.js";
import type { RunEvent } from "@allure-station/shared";

const sample = (id: string, status: RunEvent["run"]["status"]): RunEvent => ({
  type: "run",
  projectId: "p",
  run: { id, projectId: "p", status, reportName: "R", createdAt: "2026-06-06T00:00:00.000Z", finishedAt: null, stats: null },
});

async function waitFor<T>(get: () => T[], n: number, timeoutMs = 2000): Promise<T[]> {
  const start = Date.now();
  while (get().length < n) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${n} events (got ${get().length})`);
    await new Promise((r) => setTimeout(r, 10));
  }
  return get();
}

/** Run the shared bus conformance assertions against a freshly-built bus. */
export async function runBusConformance(makeBus: () => EventBus): Promise<void> {
  // delivers a published event to a subscriber
  {
    const bus = makeBus();
    const got: RunEvent[] = [];
    const unsub = bus.subscribe((e) => got.push(e));
    bus.publish(sample("r1", "generating"));
    await waitFor(() => got, 1);
    expect(got[0].run.id).toBe("r1");
    unsub();
    await bus.close();
  }
  // unsubscribe stops delivery
  {
    const bus = makeBus();
    const got: RunEvent[] = [];
    const unsub = bus.subscribe((e) => got.push(e));
    unsub();
    bus.publish(sample("r2", "ready"));
    await new Promise((r) => setTimeout(r, 100));
    expect(got).toHaveLength(0);
    await bus.close();
  }
}
