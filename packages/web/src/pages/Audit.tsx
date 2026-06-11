import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { api } from "../main.js";
import { useAuth } from "../auth.js";
import { Topbar } from "@/components/Topbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const PAGE = 50;

export function Audit() {
  const { user, isLoading } = useAuth();
  const [page, setPage] = useState(0);
  const { data } = useQuery({
    queryKey: ["audit", page],
    queryFn: () => api.listAudit({ limit: PAGE, offset: page * PAGE }),
    enabled: user?.role === "admin",
    placeholderData: keepPreviousData,
  });

  if (isLoading) return null;
  if (user?.role !== "admin") return (<><Topbar title="Audit" /><main className="grid flex-1 place-items-center p-6"><p className="text-sm text-muted-foreground">Admins only.</p></main></>);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const target = (e: { targetType: string | null; targetId: string | null }) =>
    e.targetType ? `${e.targetType}${e.targetId ? `:${e.targetId}` : ""}` : "";

  return (
    <>
      <Topbar title="Audit log" />
      <main className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-5xl space-y-4">
          <Card>
            <CardContent className="p-0">
              {/* Mobile list — visible below sm */}
              <ul role="list" className="divide-y sm:hidden">
                {items.map((e) => (
                  <li key={e.id} className="space-y-0.5 p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{e.action}</span>
                      <span className="whitespace-nowrap text-xs text-muted-foreground">{new Date(e.at).toLocaleString()}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">{e.actorLabel}{e.projectId ? ` · ${e.projectId}` : ""}{target(e) ? ` · ${target(e)}` : ""}</div>
                    {e.metadata ? <div className="truncate text-xs text-muted-foreground">{JSON.stringify(e.metadata)}</div> : null}
                  </li>
                ))}
              </ul>
              {/* Desktop table — hidden below sm */}
              <div className="hidden sm:block">
                <Table>
                  <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Actor</TableHead><TableHead>Action</TableHead><TableHead>Target</TableHead><TableHead>Project</TableHead><TableHead>Details</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {items.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{new Date(e.at).toLocaleString()}</TableCell>
                        <TableCell>{e.actorLabel}</TableCell>
                        <TableCell><span className="font-medium">{e.action}</span></TableCell>
                        <TableCell className="text-muted-foreground">{target(e)}</TableCell>
                        <TableCell>{e.projectId ?? ""}</TableCell>
                        <TableCell className="max-w-[280px] truncate text-muted-foreground">{e.metadata ? JSON.stringify(e.metadata) : ""}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
          {items.length === 0 && <p className="text-sm text-muted-foreground">No audit events yet.</p>}
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
