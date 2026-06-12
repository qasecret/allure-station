import { describe, it, expect } from "vitest";
import { toCsv } from "./csv.js";

describe("toCsv", () => {
  it("emits a header row and data rows with RFC4180 escaping", () => {
    const result = toCsv([{ a: 1, b: 'x,"y"' }]);
    const lines = result.split("\r\n");
    expect(lines[0]).toBe("a,b");
    // The value contains a comma and a double-quote — must be wrapped in quotes with quotes doubled
    expect(lines[1]).toBe('1,"x,""y"""');
  });

  it("returns empty string for an empty array", () => {
    const result = toCsv([]);
    expect(result).toBe("");
  });

  it("escapes newlines inside values", () => {
    const result = toCsv([{ col: "line1\nline2" }]);
    expect(result).toContain('"line1\nline2"');
  });

  it("handles multiple rows and unions all keys", () => {
    const result = toCsv([
      { a: 1, b: 2 },
      { a: 3, b: 4, c: 5 },
    ]);
    const lines = result.split("\r\n");
    expect(lines[0]).toBe("a,b,c");
    expect(lines).toHaveLength(3); // header + 2 rows
  });

  it("uses empty string for missing keys in a row", () => {
    const result = toCsv([{ a: 1 }, { a: 2, b: "hello" }]);
    const lines = result.split("\r\n");
    // row 1: a=1, b=missing → empty
    expect(lines[1]).toBe("1,");
    // row 2: a=2, b=hello
    expect(lines[2]).toBe("2,hello");
  });

  it("prefixes formula-injection characters with a single-quote", () => {
    // Cells starting with =, +, -, or @ must be neutralised so spreadsheet apps
    // do not interpret them as formulas.
    const result = toCsv([{ a: "=SUM(1)", b: "+1", c: "-1", d: "@user" }]);
    const lines = result.split("\r\n");
    expect(lines[1]).toBe("'=SUM(1),'+1,'-1,'@user");
  });
});
