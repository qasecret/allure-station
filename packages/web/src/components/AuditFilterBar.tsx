import { useCallback, useEffect, useRef } from "react";
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

/** Reusable filter bar for global and per-project audit logs. */
export function AuditFilterBar({ filters, onChange }: AuditFilterBarProps) {
  const actorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setAction = useCallback(
    (val: string) => onChange({ ...filters, action: val === "__all__" ? "" : (val as AuditAction) }),
    [filters, onChange]
  );

  const setActor = useCallback(
    (val: string) => {
      if (actorTimer.current) clearTimeout(actorTimer.current);
      actorTimer.current = setTimeout(() => {
        onChange({ ...filters, actor: val || undefined });
      }, 300);
    },
    [filters, onChange]
  );

  // Clear the actor debounce timer on unmount to prevent calling onChange after the component is gone
  useEffect(() => () => clearTimeout(actorTimer.current ?? undefined), []);

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
        defaultValue={filters.actor ?? ""}
        onChange={(e) => setActor(e.target.value)}
        className="w-[200px]"
      />
      <Input
        type="date"
        aria-label="From date"
        defaultValue={filters.from ? filters.from.slice(0, 10) : ""}
        onChange={(e) => setFrom(e.target.value)}
        className="w-[160px]"
      />
      <Input
        type="date"
        aria-label="To date"
        defaultValue={filters.to ? filters.to.slice(0, 10) : ""}
        onChange={(e) => setTo(e.target.value)}
        className="w-[160px]"
      />
    </div>
  );
}
