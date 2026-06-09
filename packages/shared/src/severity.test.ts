import { describe, it, expect } from "vitest";
import { severityRank, bySeverity } from "./severity.js";

describe("severity ordering", () => {
  it("ranks known levels blocker→trivial and unknown/null last", () => {
    expect(severityRank("blocker")).toBeLessThan(severityRank("critical"));
    expect(severityRank("critical")).toBeLessThan(severityRank("trivial"));
    expect(severityRank("trivial")).toBeLessThan(severityRank("nope"));
    expect(severityRank(null)).toBe(severityRank("nope"));
    expect(severityRank(undefined)).toBe(severityRank(null));
    // Prototype keys must not leak through the lookup (e.g. "constructor" → Object).
    expect(severityRank("constructor")).toBe(severityRank(null));
  });

  it("bySeverity sorts blocker first, unknown/null last, stable within a rank", () => {
    const items = [
      { severity: null, name: "a" },
      { severity: "critical", name: "b" },
      { severity: "blocker", name: "c" },
      { severity: "critical", name: "d" }, // same rank as b → stable: b stays before d
      { severity: "trivial", name: "e" },
    ];
    const sorted = [...items].sort(bySeverity).map((x) => x.name);
    expect(sorted).toEqual(["c", "b", "d", "e", "a"]);
  });
});
