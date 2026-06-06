export interface PageParams { limit?: number; offset?: number; }

const MAX_LIMIT = 200;

/** Parse + validate ?limit/?offset query params. Throws on invalid input (caller returns 400). */
export function parsePage(query: Record<string, unknown>): PageParams {
  const out: PageParams = {};
  for (const key of ["limit", "offset"] as const) {
    const raw = query[key];
    if (raw === undefined || raw === "") continue;
    // Strict decimal digits only — rejects arrays (duplicate params), hex ("0x10"), whitespace,
    // floats, and negatives, all of which Number() would otherwise silently coerce.
    if (typeof raw !== "string" || !/^\d+$/.test(raw)) throw new Error(`${key} must be a non-negative integer`);
    const n = Number(raw);
    out[key] = key === "limit" ? Math.min(n, MAX_LIMIT) : n;
  }
  return out;
}
