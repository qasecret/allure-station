const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ESC[c]);

export const BADGE_GREEN = "#4c1";
export const BADGE_RED = "#e05d44";
export const BADGE_GREY = "#9f9f9f";

/** Minimal flat shields-style badge (no external dependency). Char width approximated at 6.5px. */
export function renderBadge(label: string, message: string, color: string): string {
  const lw = Math.round(label.length * 6.5) + 10;
  const mw = Math.round(message.length * 6.5) + 10;
  const w = lw + mw;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${esc(label)}: ${esc(message)}">
  <rect width="${w}" height="20" rx="3" fill="#555"/>
  <rect x="${lw}" width="${mw}" height="20" rx="3" fill="${color}"/>
  <rect x="${lw}" width="4" height="20" fill="${color}"/>
  <g fill="#fff" font-family="Verdana,DejaVu Sans,Geneva,sans-serif" font-size="11" text-anchor="middle">
    <text x="${(lw / 2).toFixed(1)}" y="14">${esc(label)}</text>
    <text x="${(lw + mw / 2).toFixed(1)}" y="14">${esc(message)}</text>
  </g>
</svg>`;
}
