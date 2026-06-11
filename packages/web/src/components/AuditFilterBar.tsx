import { useCallback, useEffect, useRef, useState } from "react";
import { auditActionSchema } from "@allure-station/shared";
import type { AuditAction } from "@allure-station/shared";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface AuditFilters {
  action?: AuditAction | "";
  actor?: string;
  from?: string;   // ISO date string (date-only input maps to start-of-day)
  to?: string;     // ISO date string (date-only input maps to end-of-day)
}

interface AuditFilterBarProps {
  filters: AuditFilters;
  onChange: (filters: AuditFilters) => void;
}

const ACTION_OPTIONS = auditActionSchema.options;

/** Pad a date component to two digits. */
function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Round-trip a stored ISO string back to a LOCAL-day "YYYY-MM-DD" value for <input type="date">.
 *  Using .slice(0,10) would give the UTC date which can differ from the local date. */
function isoToLocalDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Reusable filter bar for global and per-project audit logs. */
export function AuditFilterBar({ filters, onChange }: AuditFilterBarProps) {
  const actorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest filters captured at debounce-fire time — avoids stale closure over the actor callback.
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  // Local controlled state for the actor input (debounced upward).
  const [actorLocal, setActorLocal] = useState(filters.actor ?? "");

  // Sync the local actor state when the external filter value changes (e.g. parent reset).
  useEffect(() => {
    setActorLocal(filters.actor ?? "");
  }, [filters.actor]);

  // Clear the actor debounce timer on unmount to prevent calling onChange after the component is gone.
  useEffect(() => () => clearTimeout(actorTimer.current ?? undefined), []);

  const setAction = useCallback(
    (val: string) => onChange({ ...filters, action: val === "__all__" ? "" : (val as AuditAction) }),
    [filters, onChange]
  );

  const handleActorChange = useCallback(
    (val: string) => {
      setActorLocal(val);
      if (actorTimer.current) clearTimeout(actorTimer.current);
      actorTimer.current = setTimeout(() => {
        // Read latest filters at fire time, not the stale captured closure.
        onChange({ ...filtersRef.current, actor: val || undefined });
      }, 300);
    },
    [onChange]
  );

  const setFrom = useCallback(
    (val: string) => {
      if (!val) { onChange({ ...filters, from: undefined }); return; }
      const [y, m, d] = val.split("-").map(Number);
      onChange({ ...filters, from: new Date(y, m - 1, d).toISOString() });
    },
    [filters, onChange]
  );

  const setTo = useCallback(
    (val: string) => {
      if (!val) { onChange({ ...filters, to: undefined }); return; }
      const [y, m, d] = val.split("-").map(Number);
      onChange({ ...filters, to: new Date(y, m - 1, d, 23, 59, 59, 999).toISOString() });
    },
    [filters, onChange]
  );

  return (
    <div className="flex flex-wrap items-center gap-2" role="search" aria-label="Audit log filters">
      <Select value={filters.action || "__all__"} onValueChange={setAction}>
        <SelectTrigger aria-label="Filter by action" className="w-[200px]">
          <SelectValue placeholder="All actions" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">All actions</SelectItem>
          {ACTION_OPTIONS.map((a) => (
            <SelectItem key={a} value={a}>{a.replace(/_/g, " ")}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        aria-label="Filter by actor (email substring)"
        placeholder="Actor email…"
        value={actorLocal}
        onChange={(e) => handleActorChange(e.target.value)}
        className="w-[200px]"
      />
      <Input
        type="date"
        aria-label="From date"
        value={filters.from ? isoToLocalDate(filters.from) : ""}
        onChange={(e) => setFrom(e.target.value)}
        className="w-[160px]"
      />
      <Input
        type="date"
        aria-label="To date"
        value={filters.to ? isoToLocalDate(filters.to) : ""}
        onChange={(e) => setTo(e.target.value)}
        className="w-[160px]"
      />
    </div>
  );
}
