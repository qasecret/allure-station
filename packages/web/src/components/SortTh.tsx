import React from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";

type SortOrder = "asc" | "desc";

function SortIcon({ active, order }: { active: boolean; order: SortOrder | null }) {
  if (!active) return <ChevronsUpDown className="ml-1 inline h-3 w-3 opacity-50" aria-hidden />;
  return order === "asc"
    ? <ChevronUp className="ml-1 inline h-3 w-3" aria-hidden />
    : <ChevronDown className="ml-1 inline h-3 w-3" aria-hidden />;
}

export interface SortThProps {
  /** Column label shown to the user. */
  label: string;
  /** The sort key this column represents. */
  sortKey: string;
  /** The currently active sort key across the table (may differ from this column's sortKey). */
  activeSortKey: string | null;
  /** The current sort order (only meaningful when activeSortKey === sortKey). */
  sortOrder: SortOrder | null;
  /**
   * Called when the user clicks the sort button. Receives no argument — the
   * caller already knows which key it passed as `sortKey`, so there is no need
   * to thread it back through the callback type (which would force callers to
   * widen their handler signature from a specific union to `string`).
   */
  onSort: () => void;
  /** Optional extra className applied to the th/wrapper element. */
  className?: string;
  /**
   * Element type to render as. Use the shadcn `TableHead` component when inside
   * a shadcn Table; otherwise defaults to a plain `<th>`.
   */
  as?: React.ElementType;
}

/**
 * Module-scope sortable table header cell — hoisted out of any render function
 * so its identity is stable and React does NOT remount it on re-renders, which
 * would cause keyboard focus loss after every sort click.
 */
export function SortTh({
  label,
  sortKey,
  activeSortKey,
  sortOrder,
  onSort,
  className,
  as: As = "th",
}: SortThProps) {
  const isActive = activeSortKey === sortKey;
  const effectiveOrder = isActive ? sortOrder : null;
  return (
    <As
      scope="col"
      className={className ?? "p-2"}
      aria-sort={isActive && sortOrder ? (sortOrder === "asc" ? "ascending" : "descending") : undefined}
    >
      <button
        type="button"
        className="flex items-center whitespace-nowrap font-medium hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onSort}
        aria-label={`Sort by ${label}`}
      >
        {label}
        <SortIcon active={isActive} order={effectiveOrder} />
      </button>
    </As>
  );
}
