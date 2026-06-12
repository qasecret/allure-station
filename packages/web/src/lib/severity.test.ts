import { describe, it, expect } from "vitest";
import { severityChipClass } from "./severity.js";

describe("severityChipClass", () => {
  it("returns classes for known levels", () => {
    expect(severityChipClass("blocker")).toContain("text-status-fail-text");
    expect(severityChipClass("critical")).toContain("text-status-fail-text");
    expect(severityChipClass("normal")).toContain("text-status-broken-text");
    expect(severityChipClass("minor")).toContain("text-muted-foreground");
    expect(severityChipClass("trivial")).toContain("text-muted-foreground");
  });
  it("returns null for unknown/absent levels (render nothing)", () => {
    expect(severityChipClass("nope")).toBeNull();
    expect(severityChipClass("constructor")).toBeNull(); // prototype key must not leak
    expect(severityChipClass(null)).toBeNull();
    expect(severityChipClass(undefined)).toBeNull();
  });
});
