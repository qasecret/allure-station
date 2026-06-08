import { describe, it, expect } from "vitest";
import { qgConfigToForm, qgFormToConfig } from "./quality-gate-form.js";

describe("quality-gate form conversion", () => {
  it("config → form: fraction→percent, ms→seconds, missing→empty string", () => {
    expect(qgConfigToForm({ maxFailures: 0, minTests: 5, minPassRate: 0.95, maxDurationMs: 30000 }))
      .toEqual({ maxFailures: "0", minTests: "5", minPassRate: "95", maxDurationSec: "30" });
    expect(qgConfigToForm({})).toEqual({ maxFailures: "", minTests: "", minPassRate: "", maxDurationSec: "" });
  });

  it("form → config: percent→fraction, seconds→ms, empty→omitted", () => {
    expect(qgFormToConfig({ maxFailures: "0", minTests: "5", minPassRate: "95", maxDurationSec: "30" }))
      .toEqual({ maxFailures: 0, minTests: 5, minPassRate: 0.95, maxDurationMs: 30000 });
    expect(qgFormToConfig({ maxFailures: "", minTests: "", minPassRate: "", maxDurationSec: "" })).toEqual({});
  });

  it("round-trips", () => {
    const cfg = { maxFailures: 2, minPassRate: 0.8 };
    expect(qgFormToConfig(qgConfigToForm(cfg))).toEqual(cfg);
  });
});
