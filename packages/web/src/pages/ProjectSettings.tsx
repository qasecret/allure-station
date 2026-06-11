import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { ProjectRole, CreatedToken, NotificationKind, NotificationTrigger } from "@allure-station/shared";
import { relativeTime } from "@/lib/format";
import { toast } from "sonner";
import { api } from "../main.js";
import { useAuth } from "../auth.js";
import { settingsState } from "@/lib/settings-access";
import { Topbar } from "@/components/Topbar";
import { CopyButton } from "@/components/CopyButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { qgConfigToForm, qgFormToConfig, type QgForm } from "@/lib/quality-gate-form";

const PROJECT_ROLES: ProjectRole[] = ["viewer", "maintainer", "owner"];

export function ProjectSettings() {
  const { id = "" } = useParams();
  const { user, isLoading: authLoading } = useAuth();
  const { data: project } = useQuery({ queryKey: ["project", id], queryFn: () => api.getProject(id), retry: false });
  const { data: config, isLoading: configLoading } = useQuery({ queryKey: ["config"], queryFn: () => api.getConfig() });
  // Owner-gated members fetch doubles as the capability probe.
  const { data: members, isError } = useQuery({
    queryKey: ["members", id], queryFn: () => api.listMembers(id), enabled: !!user, retry: false,
  });
  const canManageMembers = !!user && !isError && members !== undefined;
  const state = settingsState({ securityEnabled: !!config?.securityEnabled, signedIn: !!user, canManageMembers });

  return (
    <>
      <Topbar title={<span className="flex items-center gap-2"><Link to={`/projects/${id}`} className="text-muted-foreground hover:text-foreground">{project?.displayName ?? id}</Link><span className="text-muted-foreground">/</span>Settings</span>} />
      <main className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {(configLoading || authLoading) ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : state === "signin" ? (
            <p className="text-sm text-muted-foreground">
              <Link to="/login" className="text-primary-text hover:underline">Sign in</Link> to manage this project's settings.
            </p>
          ) : (
            <>
              {state === "open" && (
                <Card><CardContent className="p-4 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Open mode.</span> Anyone can manage this project.
                  Set <code>ADMIN_EMAIL</code> and <code>ADMIN_PASSWORD</code> to require sign-in.
                </CardContent></Card>
              )}
              <ProjectNameCard projectId={id} />
              <VisibilityCard projectId={id} />
              <BadgeCard projectId={id} />
              <QualityGateCard projectId={id} />
              <TokensCard projectId={id} />
              <NotificationsCard projectId={id} />
              {state === "manage" ? (
                <>
                  <MembersCard projectId={id} members={members ?? []} />
                  <AuditCard projectId={id} enabled />
                </>
              ) : (
                <Card><CardContent className="p-4 text-sm text-muted-foreground">
                  {state === "open"
                    ? "Enable accounts (set ADMIN_EMAIL / ADMIN_PASSWORD) to manage members and view the audit log."
                    : "You need the owner or admin role to manage members and view the audit log."}
                </CardContent></Card>
              )}
              <DangerZoneCard projectId={id} />
            </>
          )}
        </div>
      </main>
    </>
  );
}

function ProjectNameCard({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { data: project } = useQuery({ queryKey: ["project", projectId], queryFn: () => api.getProject(projectId) });
  const [name, setName] = useState(project?.displayName ?? "");
  useEffect(() => { setName(project?.displayName ?? ""); }, [project?.displayName]);
  const save = useMutation({
    mutationFn: () => api.updateProject(projectId, { displayName: name.trim() || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Project name saved");
    },
    onError: (e) => toast.error((e as Error).message),
  });
  if (!project) return null;
  return (
    <Card>
      <CardHeader><CardTitle>Project name</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input aria-label="Display name" value={name} onChange={(e) => setName(e.target.value)} placeholder={projectId} />
          <Button disabled={save.isPending} onClick={() => save.mutate()}>Save</Button>
        </div>
        <p className="text-sm text-muted-foreground">Shown instead of the id. Leave blank to clear. The id <code>{projectId}</code> never changes.</p>
      </CardContent>
    </Card>
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

function BadgeCard({ projectId }: { projectId: string }) {
  const path = `/api/projects/${projectId}/badge.svg`;
  // Absolute URL so the snippet works when pasted into a README/dashboard off-site.
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const markdown = `![tests](${origin}${path})`;
  return (
    <Card>
      <CardHeader><CardTitle>Status badge</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <img src={path} alt={`${projectId} status badge`} className="h-5" />
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs">{markdown}</code>
          <CopyButton value={markdown} />
        </div>
        <p className="text-xs text-muted-foreground">Public SVG of the latest run's pass/fail count — embed it in a README or dashboard. No auth required.</p>
      </CardContent>
    </Card>
  );
}

function DangerZoneCard({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const del = useMutation({
    mutationFn: () => api.deleteProject(projectId),
    onSuccess: () => {
      // Drop every cache entry scoped to this project (keys are [name, projectId, …]) so a
      // browser-back to the deleted project can't render stale runs/report; then refresh the list.
      qc.removeQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[1] === projectId });
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success(`Deleted ${projectId}`);
      navigate("/");
    },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <Card className="border-destructive/40">
      <CardHeader><CardTitle className="text-destructive">Danger zone</CardTitle></CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Permanently delete <code className="font-medium text-foreground">{projectId}</code> — every run, report, token, and setting. This can't be undone.
        </p>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setConfirm(""); }}>
          <DialogTrigger asChild><Button variant="destructive" size="sm">Delete project</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete {projectId}?</DialogTitle>
              <DialogDescription>
                This removes all of its runs, reports, tokens, and settings for good. Type <code className="font-medium">{projectId}</code> to confirm.
              </DialogDescription>
            </DialogHeader>
            <Input aria-label="Type the project id to confirm" autoFocus value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={projectId} />
            <DialogFooter>
              <Button variant="destructive" disabled={confirm !== projectId || del.isPending} onClick={() => del.mutate()}>
                {del.isPending ? "Deleting…" : "Delete permanently"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["members", projectId] }); toast.success("Member removed"); },
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
                  <TableCell className="text-right"><Button variant="ghost" size="sm" disabled={removeMember.isPending && removeMember.variables === m.userId} onClick={() => removeMember.mutate(m.userId)}>Remove</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function AuditCard({ projectId, enabled }: { projectId: string; enabled: boolean }) {
  const { data } = useQuery({
    queryKey: ["project-audit", projectId], queryFn: () => api.listProjectAudit(projectId, { limit: 50 }), retry: false, enabled,
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

function QualityGateCard({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["quality-gate", projectId], queryFn: () => api.getQualityGate(projectId) });
  const [form, setForm] = useState<QgForm>({ maxFailures: "", minTests: "", minPassRate: "", maxDurationSec: "" });
  useEffect(() => { if (data) setForm(qgConfigToForm(data)); }, [data]);
  const save = useMutation({
    mutationFn: () => api.setQualityGate(projectId, qgFormToConfig(form)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["quality-gate", projectId] }); toast.success("Quality gate saved"); },
    onError: (e) => toast.error((e as Error).message),
  });
  const field = (key: keyof QgForm, label: string, hint: string) => (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Input type="number" min={0} step={1} value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} placeholder={hint} className="max-w-[160px]" />
    </label>
  );
  if (data === undefined) return null;
  return (
    <Card>
      <CardHeader><CardTitle>Quality gate</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={(e) => { e.preventDefault(); if (!save.isPending) save.mutate(); }} className="space-y-4">
          <div className="flex flex-wrap gap-4">
            {field("maxFailures", "Max failures", "e.g. 0")}
            {field("minTests", "Min tests", "e.g. 1")}
            {field("minPassRate", "Min pass rate (%)", "e.g. 95")}
            {field("maxDurationSec", "Max duration (s)", "e.g. 600")}
          </div>
          <Button type="submit" size="sm" disabled={save.isPending}>Save gate</Button>
        </form>
        <p className="text-xs text-muted-foreground">Leave a field blank to disable that rule. The run header and run summary reflect the verdict.</p>
      </CardContent>
    </Card>
  );
}

function TokensCard({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [created, setCreated] = useState<CreatedToken | null>(null);
  // Drop a revealed token if we navigate to another project (the route reuses this component).
  useEffect(() => { setCreated(null); }, [projectId]);
  const { data: tokens } = useQuery({ queryKey: ["tokens", projectId], queryFn: () => api.listTokens(projectId) });
  const create = useMutation({
    mutationFn: () => api.createToken(projectId, name),
    onSuccess: (t) => { setCreated(t); setName(""); qc.invalidateQueries({ queryKey: ["tokens", projectId] }); },
    onError: (e) => toast.error((e as Error).message),
  });
  const remove = useMutation({
    mutationFn: (tokenId: string) => api.deleteToken(projectId, tokenId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tokens", projectId] }); toast.success("Token revoked"); },
    onError: (e) => toast.error((e as Error).message),
  });
  if (tokens === undefined) return null;
  return (
    <Card>
      <CardHeader><CardTitle>CI tokens ({tokens.length})</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={(e) => { e.preventDefault(); if (!name || create.isPending) return; create.mutate(); }} className="flex flex-wrap items-center gap-2">
          <Input aria-label="Token name" placeholder="token name (e.g. ci-pipeline)" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} required className="max-w-xs" />
          <Button type="submit" disabled={create.isPending}>Create token</Button>
        </form>
        {created && (
          <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
            <p className="font-medium">Copy this token now — it won't be shown again.</p>
            <div className="mt-1 flex items-center gap-2">
              <code className="break-all rounded bg-muted px-2 py-1">{created.token}</code>
              <CopyButton value={created.token} />
              <Button size="sm" variant="ghost" onClick={() => setCreated(null)}>Dismiss</Button>
            </div>
          </div>
        )}
        {tokens.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tokens yet — this project's writes are open until you add one.</p>
        ) : (
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Prefix</TableHead><TableHead>Last used</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {tokens.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>{t.name}</TableCell>
                  <TableCell><code className="text-xs text-muted-foreground">{t.prefix}…</code></TableCell>
                  <TableCell className="text-muted-foreground">{t.lastUsedAt ? relativeTime(t.lastUsedAt) : "never"}</TableCell>
                  <TableCell className="text-right"><Button variant="ghost" size="sm" disabled={remove.isPending && remove.variables === t.id} onClick={() => remove.mutate(t.id)}>Revoke</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
const NOTIF_EVENTS: NotificationTrigger[] = ["completed", "failed", "gate_failed", "regression"];

function NotificationsCard({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<NotificationKind>("webhook");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<NotificationTrigger[]>(["failed", "gate_failed", "regression"]);
  // Clear a half-typed URL if we navigate to another project (the route reuses this component).
  useEffect(() => { setUrl(""); }, [projectId]);
  const { data: notifs } = useQuery({ queryKey: ["notifications", projectId], queryFn: () => api.listNotifications(projectId) });
  const create = useMutation({
    mutationFn: () => api.createNotification(projectId, { kind, url, events }),
    onSuccess: () => { setUrl(""); qc.invalidateQueries({ queryKey: ["notifications", projectId] }); toast.success("Notification added"); },
    onError: (e) => toast.error((e as Error).message),
  });
  const remove = useMutation({
    mutationFn: (notificationId: string) => api.deleteNotification(projectId, notificationId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["notifications", projectId] }); toast.success("Notification removed"); },
    onError: (e) => toast.error((e as Error).message),
  });
  const test = useMutation({
    mutationFn: (notificationId: string) => api.testNotification(projectId, notificationId),
    onSuccess: (r) => r.ok ? toast.success("Test notification sent") : toast.error(`Test failed: ${r.error ?? `HTTP ${r.status}`}`),
    onError: (e) => toast.error((e as Error).message),
  });
  const toggle = (ev: NotificationTrigger) => setEvents((cur) => cur.includes(ev) ? cur.filter((x) => x !== ev) : [...cur, ev]);
  if (notifs === undefined) return null;
  return (
    <Card>
      <CardHeader><CardTitle>Notifications ({notifs.length})</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={(e) => { e.preventDefault(); if (!url || events.length === 0 || create.isPending) return; create.mutate(); }} className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={kind} onValueChange={(v) => setKind(v as NotificationKind)}>
              <SelectTrigger aria-label="Notification kind" className="w-[130px]"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="webhook">webhook</SelectItem><SelectItem value="slack">slack</SelectItem></SelectContent>
            </Select>
            <Input aria-label="Notification URL" type="url" placeholder="https://hooks.example.com/…" value={url} onChange={(e) => setUrl(e.target.value)} required className="max-w-sm" />
            <Button type="submit" disabled={create.isPending}>Add</Button>
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            {NOTIF_EVENTS.map((ev) => (
              <label key={ev} className="flex items-center gap-1">
                <input type="checkbox" checked={events.includes(ev)} onChange={() => toggle(ev)} aria-label={ev} />
                <span className="text-muted-foreground">{ev}</span>
              </label>
            ))}
          </div>
        </form>
        {notifs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No notifications configured.</p>
        ) : (
          <Table>
            <TableHeader><TableRow><TableHead>Kind</TableHead><TableHead>URL</TableHead><TableHead>Events</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {notifs.map((n) => (
                <TableRow key={n.id}>
                  <TableCell><Badge variant="secondary">{n.kind}</Badge></TableCell>
                  <TableCell className="max-w-[220px] truncate text-muted-foreground">{n.url}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{n.events.join(", ")}</TableCell>
                  <TableCell className="space-x-1 text-right">
                    <Button variant="ghost" size="sm" disabled={test.isPending && test.variables === n.id} onClick={() => test.mutate(n.id)}>{test.isPending && test.variables === n.id ? "Sending…" : "Test"}</Button>
                    <Button variant="ghost" size="sm" disabled={remove.isPending && remove.variables === n.id} onClick={() => remove.mutate(n.id)}>Remove</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
