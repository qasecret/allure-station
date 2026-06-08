import { describe, it, expect } from "vitest";
import { classifyStatus, isFailingStatus, isIgnoredStatus } from "./status.js";

describe("classifyStatus", () => {
  it("buckets every TestStatus", () => {
    expect(classifyStatus("failed")).toBe("failing");
    expect(classifyStatus("broken")).toBe("failing");
    expect(classifyStatus("passed")).toBe("passing");
    expect(classifyStatus("skipped")).toBe("ignored");
    expect(classifyStatus("unknown")).toBe("ignored");
  });

  it("derives the predicates", () => {
    expect(isFailingStatus("broken")).toBe(true);
    expect(isFailingStatus("passed")).toBe(false);
    expect(isIgnoredStatus("skipped")).toBe(true);
    expect(isIgnoredStatus("failed")).toBe(false);
  });
});
