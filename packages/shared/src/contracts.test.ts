import { describe, it, expect } from "vitest";
import { createProjectSchema, projectIdSchema, testDiffSchema } from "./contracts.js";

describe("testDiffSchema", () => {
  it("carries the slice-able dimensions", () => {
    const parsed = testDiffSchema.parse({
      historyId: "h", name: "t", fullName: "s#t",
      baseStatus: "passed", targetStatus: "failed", flaky: false,
      severity: "blocker", suite: "checkout", owner: "alice", tags: ["smoke"],
    });
    expect(parsed).toMatchObject({ severity: "blocker", suite: "checkout", owner: "alice", tags: ["smoke"] });
  });

  it("still parses a diff without the dimensions (back-compat)", () => {
    const parsed = testDiffSchema.parse({
      historyId: "h", name: "t", fullName: "s#t",
      baseStatus: "passed", targetStatus: "failed", flaky: false,
    });
    expect(parsed.severity).toBeUndefined();
    expect(parsed.tags).toBeUndefined();
  });
});

describe("createProjectSchema", () => {
  it("accepts a valid kebab-case id", () => {
    expect(createProjectSchema.parse({ id: "my-team" })).toEqual({ id: "my-team" });
  });
  it("rejects ids with slashes or spaces", () => {
    expect(() => createProjectSchema.parse({ id: "a/b" })).toThrow();
    expect(() => createProjectSchema.parse({ id: "a b" })).toThrow();
  });
  it("projectIdSchema enforces the same rule", () => {
    expect(() => projectIdSchema.parse("..")).toThrow();
  });
});
