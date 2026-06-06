import { describe, it } from "vitest";
import { InProcessBus, RedisBus } from "./bus.js";
import { runBusConformance } from "./conformance.js";

describe("InProcessBus", () => {
  it("passes bus conformance", async () => {
    await runBusConformance(() => new InProcessBus());
  });
});

const redisUrl = process.env.REDIS_TEST_URL;
(redisUrl ? describe : describe.skip)("RedisBus (requires REDIS_TEST_URL)", () => {
  it("passes bus conformance across two Redis connections", async () => {
    await runBusConformance(() => new RedisBus(redisUrl!));
  });
});
