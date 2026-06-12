import { AlertCircle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { humanizeError } from "@/lib/errors";

/** Inline failure card for page-level queries — replaces empty tables/sections on error.
 *  role="alert" so the failure is announced to screen readers.
 *  Pass `message` to override the default humanizeError text (e.g. for read-gated pages where
 *  the raw 404 message would be misleading). Pass `actions` to render additional buttons
 *  alongside Retry. */
export function QueryErrorState({
  error,
  onRetry,
  message,
  actions,
}: {
  error: unknown;
  onRetry: () => void;
  /** When provided, shown instead of humanizeError(error). */
  message?: string;
  /** Additional action elements rendered alongside the Retry button. */
  actions?: React.ReactNode;
}) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-xl border bg-card p-8 text-center shadow-sm">
      <AlertCircle className="size-6 text-status-fail-text" aria-hidden />
      <p className="text-sm text-muted-foreground">{message ?? humanizeError(error)}</p>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCw className="size-3.5" /> Retry
        </Button>
        {actions}
      </div>
    </div>
  );
}
