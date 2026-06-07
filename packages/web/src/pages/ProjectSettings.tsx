import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import type { ProjectRole } from "@allure-station/shared";
import { toast } from "sonner";
import { api } from "../main.js";
import { useAuth } from "../auth.js";
import { Topbar } from "@/components/Topbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const PROJECT_ROLES: ProjectRole[] = ["viewer", "maintainer", "owner"];

export function ProjectSettings() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  // Owner-gated members fetch doubles as the capability probe (mirrors the old inline panels).
  const { data: members, isError } = useQuery({
    queryKey: ["members", id], queryFn: () => api.listMembers(id), enabled: !!user, retry: false,
  });
  const denied = !user || isError;
  return (
    <>
      <Topbar title={<span className="flex items-center gap-2"><Link to={`/projects/${id}`} className="text-muted-foreground hover:text-foreground">{id}</Link><span className="text-muted-foreground">/</span>Settings</span>} />
      <main className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {denied ? (
            <p className="text-sm text-muted-foreground">You don't have access to this project's settings.</p>
          ) : (
            <>
              <VisibilityCard projectId={id} />
              <MembersCard projectId={id} members={members ?? []} />
              <AuditCard projectId={id} />
            </>
          )}
        </div>
      </main>
    </>
  );
}

function VisibilityCard({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { data: project } = useQuery({ queryKey: ["project", projectId], queryFn: () => api.getProject(projectId) });
  const setVis = useMutation({
    mutationFn: (visibility: "public" | "private") => api.setVisibility(projectId, visibility),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["project", projectId] }); toast.success("Visibility updated"); },
    onError: (e) => toast.error((e as Error).message),
  });
  if (!project) return null;
  const next = project.visibility === "private" ? "public" : "private";
  return (
    <Card>
      <CardHeader><CardTitle>Visibility</CardTitle></CardHeader>
      <CardContent className="flex items-center gap-3">
        <Badge variant={project.visibility === "private" ? "secondary" : "outline"}>{project.visibility}</Badge>
        <Button variant="outline" size="sm" disabled={setVis.isPending} onClick={() => setVis.mutate(next)}>Make {next}</Button>
        {project.visibility === "private" && <span className="text-sm text-muted-foreground">Reads require viewer+; the badge stays public.</span>}
      </CardContent>
    </Card>
  );
}

function MembersCard({ projectId, members }: { projectId: string; members: { userId: string; email: string; role: string }[] }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ProjectRole>("viewer");
  const setMember = useMutation({
    mutationFn: () => api.setMember(projectId, email, role),
    onSuccess: () => { setEmail(""); qc.invalidateQueries({ queryKey: ["members", projectId] }); toast.success("Member saved"); },
    onError: (e) => toast.error((e as Error).message),
  });
  const removeMember = useMutation({
    mutationFn: (userId: string) => api.removeMember(projectId, userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["members", projectId] }),
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Card>
      <CardHeader><CardTitle>Members ({members.length})</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={(e) => { e.preventDefault(); if (!email || setMember.isPending) return; setMember.mutate(); }} className="flex flex-wrap items-center gap-2">
          <Input aria-label="Member email" type="email" placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="max-w-xs" />
          <Select value={role} onValueChange={(v) => setRole(v as ProjectRole)}>
            <SelectTrigger aria-label="Member role" className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>{PROJECT_ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
          </Select>
          <Button type="submit" disabled={setMember.isPending}>Add / update</Button>
        </form>
        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">No members yet.</p>
        ) : (
          <Table>
            <TableHeader><TableRow><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.userId}>
                  <TableCell>{m.email}</TableCell>
                  <TableCell><Badge variant="secondary">{m.role}</Badge></TableCell>
                  <TableCell className="text-right"><Button variant="ghost" size="sm" disabled={removeMember.isPending} onClick={() => removeMember.mutate(m.userId)}>Remove</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function AuditCard({ projectId }: { projectId: string }) {
  const { data } = useQuery({
    queryKey: ["project-audit", projectId], queryFn: () => api.listProjectAudit(projectId, { limit: 50 }), retry: false,
  });
  if (data === undefined) return null;
  return (
    <Card>
      <CardHeader><CardTitle>Audit ({data.total})</CardTitle></CardHeader>
      <CardContent>
        {data.items.length === 0 ? <p className="text-sm text-muted-foreground">No events yet.</p> : (
          <ul className="max-h-64 space-y-1 overflow-auto text-sm">
            {data.items.map((e) => (
              <li key={e.id}>
                <span className="text-muted-foreground">{new Date(e.at).toLocaleString()}</span>{" "}
                <span className="font-medium">{e.action}</span> by {e.actorLabel}
                {e.metadata ? <span className="text-muted-foreground"> {JSON.stringify(e.metadata)}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
