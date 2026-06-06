export interface PageParams { limit?: number; offset?: number; }

const MAX_LIMIT = 200;

/** Parse + validate ?limit/?offset query params. Throws on invalid input (caller returns 400). */
export function parsePage(query: Record<string, unknown>): PageParams {
  const out: PageParams = {};
  for (const key of ["limit", "offset"] as const) {
    const raw = query[key];
    if (raw === undefined || raw === "") continue;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) throw new Error(`${key} must be a non-negative integer`);
    out[key] = key === "limit" ? Math.min(n, MAX_LIMIT) : n;
  }
  return out;
}
