import { AlertCircle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { humanizeError } from "@/lib/errors";

/** Inline failure card for page-level queries — replaces empty tables/sections on error.
 *  role="alert" so the failure is announced to screen readers. */
export function QueryErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-xl border bg-card p-8 text-center shadow-sm">
      <AlertCircle className="size-6 text-status-fail-text" aria-hidden />
      <p className="text-sm text-muted-foreground">{humanizeError(error)}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RotateCw className="size-3.5" /> Retry
      </Button>
    </div>
  );
}
