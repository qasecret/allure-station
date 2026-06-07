import { describe, it, expect } from "vitest";
import { donutDash } from "./PassRateDonut.js";

describe("donutDash", () => {
  it("computes stroke-dasharray for the passed arc", () => {
    const c = 2 * Math.PI * 16;
    expect(donutDash(100, 16).dash).toBeCloseTo(c, 3);
    expect(donutDash(0, 16).dash).toBeCloseTo(0, 3);
    expect(donutDash(50, 16).dash).toBeCloseTo(c / 2, 3);
  });
  it("treats non-finite input as 0", () => {
    expect(donutDash(NaN, 16).dash).toBe(0);
  });
});
