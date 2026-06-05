import { describe, it, expect } from "vitest";
import { createProjectSchema, projectIdSchema } from "./contracts.js";

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
