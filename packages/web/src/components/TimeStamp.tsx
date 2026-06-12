import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatAbsolute, relativeTime } from "@/lib/format";

/** App-wide time convention: relative text with the full local timestamp in an accessible
 *  tooltip (keyboard-focusable trigger — the title attribute is not reachable by keyboard).
 *  `dense` renders both inline for audit/compliance surfaces where hovering is unacceptable. */
export function TimeStamp({ iso, dense = false, className }: { iso: string; dense?: boolean; className?: string }) {
  if (dense) {
    return <span className={className}>{relativeTime(iso)} · {formatAbsolute(iso)}</span>;
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className={className}>{relativeTime(iso)}</span>
      </TooltipTrigger>
      <TooltipContent>{formatAbsolute(iso)}</TooltipContent>
    </Tooltip>
  );
}
