import { Skeleton } from "@/components/ui/skeleton";

/** Layout-matched table placeholder: heights mirror real rows so content settles without shift. */
export function TableSkeleton({ rows, cols }: { rows: number; cols: number }) {
  return (
    <div aria-hidden className="space-y-2">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} data-skeleton-cell className="h-8 flex-1 rounded-md" />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Settings-card placeholder matching the card shell (title line + two content lines). */
export function CardSkeleton() {
  return (
    <div aria-hidden className="rounded-xl border bg-card p-4 shadow-sm">
      <Skeleton className="h-5 w-40 rounded-md" />
      <Skeleton className="mt-3 h-4 w-full rounded-md" />
      <Skeleton className="mt-2 h-4 w-2/3 rounded-md" />
    </div>
  );
}
