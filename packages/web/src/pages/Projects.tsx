import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Search, FolderOpen } from "lucide-react";
import { api } from "../main.js";
import { Topbar } from "@/components/Topbar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ProjectCard } from "@/components/ProjectCard";
import { NewProjectDialog } from "@/components/NewProjectDialog";
import { EmptyState } from "@/components/EmptyState";

const PAGE_SIZE = 20;

export function Projects() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const onSearch = (v: string) => { setQ(v); setPage(0); };

  const { data, isLoading } = useQuery({
    queryKey: ["projects", q, page],
    queryFn: () => api.listProjects({ q, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
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
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input aria-label="Search projects" placeholder="Search projects…" className="pl-9"
              value={q} onChange={(e) => onSearch(e.target.value)} />
          </div>

          {isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[104px] rounded-xl" />)}
            </div>
          ) : items.length === 0 ? (
            <EmptyState icon={FolderOpen}
              title={q ? `No projects matching "${q}"` : "No projects yet"}
              description={q ? "Try a different search." : "Create a project, then push results from CI."}
              action={!q ? <NewProjectDialog /> : undefined} />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
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
