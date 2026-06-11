import { useState, useCallback, useRef } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { auditActionSchema } from "@allure-station/shared";
import type { AuditAction, AuditEntry } from "@allure-station/shared";
import { api } from "../main.js";
import { useAuth } from "../auth.js";
import { describeAuditEntry } from "@/lib/audit-format";
import { downloadCsv } from "@/lib/csv";
import { AuditFilterBar } from "@/components/AuditFilterBar";
import type { AuditFilters } from "@/components/AuditFilterBar";
import { Topbar } from "@/components/Topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const PAGE = 50;
const CSV_PAGE = 200;
const CSV_MAX = 10_000;

function MetadataDisclosure({ entry }: { entry: AuditEntry }) {
  if (!entry.metadata) return null;
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">Details</summary>
      <pre className="mt-1 max-h-24 overflow-auto rounded bg-muted p-2 text-[10px] leading-tight">{JSON.stringify(entry.metadata, null, 2)}</pre>
    </details>
  );
}

export function Audit() {
  const { user, isLoading } = useAuth();
  const [page, setPage] = useState(0);
  const [searchParams, setSearchParams] = useSearchParams();
  const [exporting, setExporting] = useState(false);

  // Read filters from URL params
  const urlAction = searchParams.get("action");
  const urlActor = searchParams.get("actor") ?? undefined;
  const urlFrom = searchParams.get("from") ?? undefined;
  const urlTo = searchParams.get("to") ?? undefined;

  const filters: AuditFilters = {
    action: (urlAction && auditActionSchema.safeParse(urlAction).success ? urlAction as AuditAction : "") || "",
    actor: urlActor,
    from: urlFrom,
    to: urlTo,
  };

  const onFiltersChange = useCallback((f: AuditFilters) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (f.action) next.set("action", f.action); else next.delete("action");
      if (f.actor) next.set("actor", f.actor); else next.delete("actor");
      if (f.from) next.set("from", f.from); else next.delete("from");
      if (f.to) next.set("to", f.to); else next.delete("to");
      return next;
    }, { replace: true });
    setPage(0);
  }, [setSearchParams]);

  const queryOpts = {
    limit: PAGE,
    offset: page * PAGE,
    ...(filters.action ? { action: filters.action } : {}),
    ...(filters.actor ? { actor: filters.actor } : {}),
    ...(filters.from ? { from: filters.from } : {}),
    ...(filters.to ? { to: filters.to } : {}),
  };

  const { data } = useQuery({
    queryKey: ["audit", page, filters.action, filters.actor, filters.from, filters.to],
    queryFn: () => api.listAudit(queryOpts),
    enabled: user?.role === "admin",
    placeholderData: keepPreviousData,
  });

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const allRows: AuditEntry[] = [];
      let offset = 0;
      let truncated = false;

      while (true) {
        const page = await api.listAudit({
          ...queryOpts,
          limit: CSV_PAGE,
          offset,
        });
        allRows.push(...page.items);
        offset += page.items.length;
        if (page.items.length < CSV_PAGE || offset >= page.total) break;
        if (allRows.length >= CSV_MAX) {
          truncated = true;
          break;
        }
      }

      if (truncated) {
        toast.warning(`Export truncated to ${CSV_MAX.toLocaleString()} rows. Refine filters to export all.`);
      }

      const csvRows = allRows.map((e) => ({
        id: e.id,
        at: e.at,
        actorType: e.actorType,
        actorId: e.actorId ?? "",
        actorLabel: e.actorLabel,
        action: e.action,
        targetType: e.targetType ?? "",
        targetId: e.targetId ?? "",
        projectId: e.projectId ?? "",
        event: describeAuditEntry(e),
        metadata: e.metadata ? JSON.stringify(e.metadata) : "",
      }));

      downloadCsv(`audit-${new Date().toISOString().slice(0, 10)}.csv`, csvRows);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExporting(false);
    }
  };

  if (isLoading) return null;
  if (user?.role !== "admin") {
    return (
      <>
        <Topbar title="Audit" />
        <main className="grid flex-1 place-items-center p-6">
          <p className="text-sm text-muted-foreground">Admins only.</p>
        </main>
      </>
    );
  }

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  return (
    <>
      <Topbar title="Audit log" />
      <main className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-5xl space-y-4">
          {/* Filter bar + export */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <AuditFilterBar filters={filters} onChange={onFiltersChange} />
            <Button variant="outline" size="sm" disabled={exporting || total === 0} onClick={handleExport}>
              {exporting ? "Exporting…" : "Export CSV"}
            </Button>
          </div>

          <Card>
            <CardContent className="p-0">
              {/* Mobile list — visible below sm */}
              <ul role="list" className="divide-y sm:hidden">
                {items.map((e) => (
                  <li key={e.id} className="space-y-0.5 p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{describeAuditEntry(e)}</span>
                      <span className="whitespace-nowrap text-xs text-muted-foreground">{new Date(e.at).toLocaleString()}</span>
                    </div>
                    {e.projectId && <div className="text-xs text-muted-foreground">{e.projectId}</div>}
                    <MetadataDisclosure entry={e} />
                  </li>
                ))}
                {items.length === 0 && (
                  <li className="p-6 text-center text-sm text-muted-foreground">No audit events.</li>
                )}
              </ul>
              {/* Desktop table — hidden below sm */}
              <div className="hidden sm:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Event</TableHead>
                      <TableHead>Project</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="whitespace-nowrap align-top text-muted-foreground">
                          {new Date(e.at).toLocaleString()}
                        </TableCell>
                        <TableCell className="align-top">
                          <span className="font-medium">{describeAuditEntry(e)}</span>
                          <MetadataDisclosure entry={e} />
                        </TableCell>
                        <TableCell className="align-top text-muted-foreground">{e.projectId ?? ""}</TableCell>
                      </TableRow>
                    ))}
                    {items.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={3} className="p-6 text-center text-muted-foreground">No audit events.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
          <div className="flex items-center gap-3 text-sm">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Prev</Button>
            <span className="text-muted-foreground">{total === 0 ? 0 : page * PAGE + 1}–{Math.min((page + 1) * PAGE, total)} of {total}</span>
            <Button variant="outline" size="sm" disabled={(page + 1) * PAGE >= total} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      </main>
    </>
  );
}
