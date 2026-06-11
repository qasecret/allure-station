import { describe, it, expect } from "vitest";
import { parseReportFragment, buildReportFragment, withReportHash } from "./report-deep-link.js";

describe("report deep-link helpers", () => {
  it("round-trips a report hash through the parent fragment", () => {
    const frag = buildReportFragment("#/testresult/42");
    expect(frag).toBe("#report=%23%2Ftestresult%2F42");
    expect(parseReportFragment(frag)).toBe("#/testresult/42");
  });
  it("parse returns null for absent/foreign fragments", () => {
    expect(parseReportFragment("")).toBeNull();
    expect(parseReportFragment("#other=1")).toBeNull();
  });
  it("withReportHash appends the hash to the iframe src", () => {
    expect(withReportHash("/api/projects/p/runs/r/report/index.html", "#/testresult/42"))
      .toBe("/api/projects/p/runs/r/report/index.html#/testresult/42");
    expect(withReportHash("/api/projects/p/runs/r/report/index.html", null))
      .toBe("/api/projects/p/runs/r/report/index.html");
  });
});
