import { CheckCircle2, XCircle, Loader2, Clock } from "lucide-react";
import type { RunStatus } from "@allure-station/shared";
import { Badge } from "@/components/ui/badge";

const MAP: Record<RunStatus, { label: string; icon: typeof CheckCircle2; cls: string }> = {
  ready: { label: "Ready", icon: CheckCircle2, cls: "bg-status-pass/15 text-status-pass border-status-pass/30" },
  failed: { label: "Failed", icon: XCircle, cls: "bg-status-fail/15 text-status-fail border-status-fail/30" },
  generating: { label: "Generating", icon: Loader2, cls: "bg-status-broken/15 text-status-broken border-status-broken/30" },
  pending: { label: "Pending", icon: Clock, cls: "bg-muted text-muted-foreground border-border" },
};

export function StatusBadge({ status }: { status: RunStatus }) {
  const m = MAP[status];
  const Icon = m.icon;
  return (
    <Badge variant="outline" className={m.cls}>
      <Icon className={status === "generating" ? "size-3 animate-spin" : "size-3"} />
      {m.label}
    </Badge>
  );
}
