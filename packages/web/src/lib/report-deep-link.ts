/** Mirror the embedded Allure report's internal hash into the parent URL fragment and back.
 *  Parent fragment shape: #report=<urlencoded allure hash>. */
export function buildReportFragment(allureHash: string): string {
  return `#report=${encodeURIComponent(allureHash)}`;
}

export function parseReportFragment(fragment: string): string | null {
  const m = /^#report=(.+)$/.exec(fragment);
  return m ? decodeURIComponent(m[1]) : null;
}

export function withReportHash(src: string, allureHash: string | null): string {
  return allureHash ? `${src}${allureHash}` : src;
}
