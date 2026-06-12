import { describe, it, expect } from "vitest";
import { describeUserAgent } from "./user-agent";

describe("describeUserAgent", () => {
  it.each([
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36", "Chrome · macOS"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0", "Firefox · Windows"],
    ["Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36", "Chrome · Linux"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15", "Safari · macOS"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1", "Safari · iOS"],
    ["curl/8.4.0", "Unknown device"],
  ])("parses %s", (ua, expected) => expect(describeUserAgent(ua)).toBe(expected));
  it("null/empty → Unknown device", () => {
    expect(describeUserAgent(null)).toBe("Unknown device");
    expect(describeUserAgent("")).toBe("Unknown device");
  });
});
