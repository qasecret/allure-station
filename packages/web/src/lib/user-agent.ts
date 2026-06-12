/** Tiny UA → "Browser · OS" summary for the sessions list. Deliberately coarse — no dependency,
 *  ordered checks (Edge/Chrome overlap, Safari claims everything WebKit). */
export function describeUserAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  // iOS browsers all wrap WebKit and tag themselves (CriOS/FxiOS/EdgiOS); Edge-Android is EdgA/.
  // Check these brand tokens before the generic chrome/safari rules they'd otherwise fall into.
  const browser = /edg\/|edga\/|edgios\//i.test(ua) ? "Edge"
    : /crios\//i.test(ua) ? "Chrome"
    : /fxios\/|firefox\//i.test(ua) ? "Firefox"
    : /chrome\//i.test(ua) ? "Chrome"
    : /safari\//i.test(ua) && /version\//i.test(ua) ? "Safari"
    : null;
  // iOS before macOS — iPhone UAs contain "like Mac OS X"
  const os = /iphone|ipad|ios/i.test(ua) ? "iOS"
    : /android/i.test(ua) ? "Android"
    : /mac os x|macintosh/i.test(ua) ? "macOS"
    : /windows/i.test(ua) ? "Windows"
    : /linux|x11/i.test(ua) ? "Linux"
    : null;
  if (!browser && !os) return "Unknown device";
  return [browser ?? "Browser", os ?? "Unknown OS"].join(" · ");
}
