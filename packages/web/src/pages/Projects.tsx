import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Search, FolderOpen } from "lucide-react";
import { projectSortSchema } from "@allure-station/shared";
import type { ProjectSort } from "@allure-station/shared";
import { api } from "../main.js";
import { Topbar } from "@/components/Topbar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProjectCard } from "@/components/ProjectCard";
import { NewProjectDialog } from "@/components/NewProjectDialog";
import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 20;

function OverviewStrip({ onTriage }: { onTriage: () => void }) {
  const { data } = useQuery({ queryKey: ["overview"], queryFn: () => api.getOverview(), refetchInterval: 30_000 });
  if (!data) return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[72px] rounded-xl" />)}
    </div>
  );
  const Tile = ({ label, value, accent, onClick }: { label: string; value: number; accent?: string; onClick?: () => void }) => (
    <button type="button" disabled={!onClick} onClick={onClick}
      className={cn("rounded-xl border bg-card p-3 text-left shadow-sm", onClick && "cursor-pointer hover:shadow-md")}>
      <div className={cn("text-2xl font-semibold tabular-nums", accent)}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </button>
  );
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" role="group" aria-label="Instance status">
      <Tile label="Failing projects" value={data.failing} accent={data.failing > 0 ? "text-status-fail-text" : undefined} onClick={data.failing > 0 ? onTriage : undefined} />
      <Tile label="Gate breaches" value={data.gateBreached} accent={data.gateBreached > 0 ? "text-status-broken-text" : undefined} onClick={data.gateBreached > 0 ? onTriage : undefined} />
      <Tile label="Runs (24h)" value={data.runsLast24h} />
      <Tile label="Generating" value={data.generating} accent={data.generating > 0 ? "animate-pulse text-primary-text" : undefined} />
    </div>
  );
}

export function Projects() {
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get("q") ?? "";
  const sort = projectSortSchema.safeParse(searchParams.get("sort")).data ?? "name";
  const [page, setPage] = useState(0);

  const onSearch = (v: string) => {
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      if (v) next.set("q", v); else next.delete("q");
      return next;
    }, { replace: true });
    setPage(0);
  };

  const onSortChange = (v: string) => {
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      if (v && v !== "name") next.set("sort", v); else next.delete("sort");
      return next;
    }, { replace: true });
    setPage(0);
  };

  const onTriage = () => {
    setSearchParams((p) => {
      const next = new URLSearchParams(p);
      next.set("sort", "worst");
      return next;
    }, { replace: true });
    setPage(0);
  };

  const { data, isLoading } = useQuery({
    queryKey: ["projects", q, page, sort],
    queryFn: () => api.listProjects({ q, sort, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  return (
    <>
      <Topbar title="Projects" actions={<NewProjectDialog />} />
      <main className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-5xl space-y-6">
          <OverviewStrip onTriage={onTriage} />

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative max-w-sm flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input aria-label="Search projects" placeholder="Search projects…" className="pl-9"
                value={q} onChange={(e) => onSearch(e.target.value)} />
            </div>
            <Select value={sort} onValueChange={onSortChange}>
              <SelectTrigger className="w-[160px]" aria-label="Sort projects">
                <SelectValue placeholder="Sort…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Name</SelectItem>
                <SelectItem value="worst">Worst first</SelectItem>
                <SelectItem value="active">Recently active</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[104px] rounded-xl" />)}
            </div>
          ) : items.length === 0 ? (
            <EmptyState icon={FolderOpen}
              title={q ? `No projects matching "${q}"` : "No projects yet"}
              description={q ? "Try a different search." : "Create a project, then push results from CI."}
              action={!q ? <NewProjectDialog /> : undefined} />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((p) => <ProjectCard key={p.id} p={p} />)}
            </div>
          )}

          {total > PAGE_SIZE && (
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>← Prev</Button>
              <span className="text-sm text-muted-foreground">Page {page + 1} of {maxPage + 1} · {total} total</span>
              <Button variant="outline" size="sm" disabled={page >= maxPage} onClick={() => setPage((p) => p + 1)}>Next →</Button>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
