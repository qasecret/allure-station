/** RFC4180 CSV: commas, double-quotes, and newlines inside values are escaped.
 *  All rows are terminated with CRLF per the spec. */

function escapeCell(val: unknown): string {
  const s = val == null ? "" : String(val);
  // Guard against CSV formula injection: spreadsheet apps treat cells starting
  // with =, +, -, or @ as formulas. Prefix with a single-quote to neutralise.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  // Must quote if the value contains comma, double-quote, or newline characters
  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

/** Convert an array of plain objects to a RFC4180 CSV string with a header row. */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";

  // Union all keys across all rows, preserving insertion order of first occurrence
  const keySet = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) keySet.add(key);
  }
  const keys = Array.from(keySet);

  const lines: string[] = [keys.map(escapeCell).join(",")];
  for (const row of rows) {
    lines.push(keys.map((k) => escapeCell(row[k])).join(","));
  }
  return lines.join("\r\n");
}

/** Trigger a browser CSV download using a Blob anchor click. */
export function downloadCsv(filename: string, rows: Record<string, unknown>[]): void {
  const content = toCsv(rows);
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
