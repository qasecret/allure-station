import { describe, it, expect } from "vitest";
import { checkWebhookUrl } from "./safe-url.js";

describe("checkWebhookUrl", () => {
  it("allows public http(s) URLs (by host name)", () => {
    expect(checkWebhookUrl("https://hooks.slack.com/services/x").ok).toBe(true);
    expect(checkWebhookUrl("http://example.com/hook").ok).toBe(true);
  });

  it("rejects non-http(s) schemes", () => {
    expect(checkWebhookUrl("file:///etc/passwd").ok).toBe(false);
    expect(checkWebhookUrl("gopher://x/").ok).toBe(false);
    expect(checkWebhookUrl("not a url").ok).toBe(false);
  });

  it("rejects loopback / private / link-local IP literals and localhost", () => {
    for (const u of [
      "http://localhost:5095/h",
      "http://127.0.0.1/h",
      "http://169.254.169.254/latest/meta-data/", // cloud metadata
      "http://10.0.0.5/h",
      "http://172.16.0.1/h",
      "http://192.168.1.1/h",
      "http://100.64.0.1/h", // CGNAT
      "http://[::1]/h",
      "http://[fd00::1]/h",  // ULA
    ]) {
      expect(checkWebhookUrl(u), u).toMatchObject({ ok: false });
    }
  });

  it("allows public IP literals", () => {
    expect(checkWebhookUrl("https://8.8.8.8/h").ok).toBe(true);
    expect(checkWebhookUrl("http://172.32.0.1/h").ok).toBe(true); // just outside 172.16/12
  });
});
