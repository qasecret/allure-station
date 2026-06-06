import { isIP } from "node:net";

/**
 * Guard for user-supplied webhook URLs the SERVER fetches (SSRF mitigation). Enforces http(s) and
 * rejects loopback / private / link-local IP literals and `localhost` — the realistic SSRF vectors
 * (cloud metadata 169.254.169.254, 127.0.0.1 port scans, RFC1918). Synchronous (no DNS) so it stays
 * hermetic and doesn't block legitimate internal *hostnames* on a self-hosted network; DNS-rebinding
 * to a private IP via a hostname is a residual risk (document + restrict who can configure webhooks).
 */
export function checkWebhookUrl(raw: string): { ok: true } | { ok: false; reason: string } {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid URL" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, reason: "URL must be http(s)" };
  // URL.hostname wraps IPv6 in brackets ([::1]); strip them before the IP-family check.
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "" || host === "localhost" || host.endsWith(".localhost")) return { ok: false, reason: "host not allowed" };
  const fam = isIP(host);
  if (fam === 4 && isPrivateV4(host)) return { ok: false, reason: "private/reserved address not allowed" };
  if (fam === 6 && isPrivateV6(host)) return { ok: false, reason: "private/reserved address not allowed" };
  return { ok: true };
}

function isPrivateV4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true; // malformed → block
  const [a, b] = p;
  return (
    a === 0 ||        // 0.0.0.0/8
    a === 10 ||       // private
    a === 127 ||      // loopback
    (a === 169 && b === 254) ||           // link-local / cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||  // private
    (a === 192 && b === 168) ||           // private
    (a === 100 && b >= 64 && b <= 127)    // CGNAT
  );
}

function isPrivateV6(ip: string): boolean {
  const h = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "::1" || h === "::") return true;                 // loopback / unspecified
  if (h.startsWith("fe8") || h.startsWith("fe9") || h.startsWith("fea") || h.startsWith("feb")) return true; // fe80::/10 link-local
  if (h.startsWith("fc") || h.startsWith("fd")) return true;  // fc00::/7 unique-local
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(h);     // IPv4-mapped
  if (mapped) return isPrivateV4(mapped[1]);
  return false;
}
