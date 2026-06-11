/** Mirror the embedded Allure report's internal hash into the parent URL fragment and back.
 *  Parent fragment shape: #report=<urlencoded allure hash>. */
export function buildReportFragment(allureHash: string): string {
  return `#report=${encodeURIComponent(allureHash)}`;
}

export function parseReportFragment(fragment: string): string | null {
  const m = /^#report=(.+)$/.exec(fragment);
  if (!m) return null;
  try {
    const decoded = decodeURIComponent(m[1]);
    return decoded.startsWith("#") ? decoded : null;
  } catch {
    return null; // malformed percent-encoding in a hand-edited URL must never crash the page
  }
}

export function withReportHash(src: string, allureHash: string | null): string {
  return allureHash ? `${src}${allureHash}` : src;
}
