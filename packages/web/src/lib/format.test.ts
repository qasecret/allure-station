import { describe, it, expect } from "vitest";
import { passRate, relativeTime } from "./format.js";

describe("passRate", () => {
  it("returns rounded percent passed/total", () => {
    expect(passRate({ passed: 7, total: 8 })).toBe(88);
    expect(passRate({ passed: 0, total: 0 })).toBe(0);
    expect(passRate({ passed: 3, total: 3 })).toBe(100);
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-06-07T12:00:00Z").getTime();
  it("formats recent times", () => {
    expect(relativeTime("2026-06-07T11:59:30Z", now)).toBe("just now");
    expect(relativeTime("2026-06-07T11:30:00Z", now)).toBe("30m ago");
    expect(relativeTime("2026-06-07T09:00:00Z", now)).toBe("3h ago");
    expect(relativeTime("2026-06-05T12:00:00Z", now)).toBe("2d ago");
  });
});
