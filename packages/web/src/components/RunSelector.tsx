import type { Run } from "@allure-station/shared";
import { runLabel } from "@/lib/format";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const DOT: Record<string, string> = { ready: "bg-status-pass", failed: "bg-status-fail", generating: "bg-status-broken animate-pulse", pending: "bg-status-skip" };

export function RunSelector({ runs, value, onChange }: { runs: Run[]; value: string; onChange: (id: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label="Select run to view" className="w-[320px] max-w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        {runs.map((r) => (
          <SelectItem key={r.id} value={r.id}>
            <span className="flex items-center gap-2" title={r.createdAt}>
              <span className={`size-2 rounded-full ${DOT[r.status] ?? "bg-status-skip"}`} />
              <span className="truncate">{runLabel(r)}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
