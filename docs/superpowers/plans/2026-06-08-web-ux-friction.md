# Web UX Friction Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Allure Station's power features discoverable and the UI consistent — add Quality Gate / Tokens / Notifications cards with honest access gating, surface the regression hint, and use friendly relative timestamps in run selectors.

**Architecture:** All changes live in `packages/web` plus additive methods on the web API client. No server or contract changes — every endpoint and zod schema already exists. Decision logic is extracted into pure, unit-tested helpers (the repo has no DOM-render test infra; it tests pure functions + fetch mocks). Cards reuse the existing shadcn `Card` pattern and the `MembersCard` structure.

**Tech Stack:** React 18, TanStack Query 5, shadcn/Radix UI, `sonner` toasts, Vitest (node env, `vi.fn()` fetch mocks). Spec: `docs/superpowers/specs/2026-06-08-web-ux-friction-design.md`.

**Reference patterns to copy:**
- API client + tests: `packages/web/src/api/client.ts`, `packages/web/src/api/client.test.ts`
- Settings cards: `packages/web/src/pages/ProjectSettings.tsx` (`MembersCard` is the template)
- Pure-helper test style: `packages/web/src/lib/format.test.ts`
- Selectors: `packages/web/src/components/RunSelector.tsx`, `ComparePanel` in `packages/web/src/pages/Project.tsx`

**Verify after each task:** `pnpm --filter @allure-station/web test` and `pnpm --filter @allure-station/web typecheck`.

---

## Task 1: Web API client methods (quality gate, tokens, notifications)

**Files:**
- Modify: `packages/web/src/api/client.ts` (the `ApiClient` interface + the returned object in `createClient`)
- Test: `packages/web/src/api/client.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/web/src/api/client.test.ts` (inside the existing `describe("api client", …)` block, reusing the `headers` helper already defined at the top):

```ts
it("getQualityGate GETs /quality-gate", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ maxFailures: 0 }) });
  const client = createClient("/api", fetchMock as unknown as typeof fetch);
  await client.getQualityGate("p");
  expect(fetchMock).toHaveBeenCalledWith("/api/projects/p/quality-gate", expect.objectContaining({ method: "GET" }));
});

it("setQualityGate PUTs the config as JSON", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ minPassRate: 0.95 }) });
  const client = createClient("/api", fetchMock as unknown as typeof fetch);
  await client.setQualityGate("p", { minPassRate: 0.95 });
  expect(fetchMock).toHaveBeenCalledWith("/api/projects/p/quality-gate",
    expect.objectContaining({ method: "PUT", body: JSON.stringify({ minPassRate: 0.95 }) }));
});

it("listTokens GETs /tokens", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
  const client = createClient("/api", fetchMock as unknown as typeof fetch);
  await client.listTokens("p");
  expect(fetchMock).toHaveBeenCalledWith("/api/projects/p/tokens", expect.objectContaining({ method: "GET" }));
});

it("createToken POSTs the name and surfaces the plaintext token", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "t1", token: "ast_secret" }) });
  const client = createClient("/api", fetchMock as unknown as typeof fetch);
  const created = await client.createToken("p", "ci");
  expect(fetchMock).toHaveBeenCalledWith("/api/projects/p/tokens",
    expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "ci" }) }));
  expect(created.token).toBe("ast_secret");
});

it("deleteToken DELETEs via the no-body path", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
  const client = createClient("/api", fetchMock as unknown as typeof fetch);
  await client.deleteToken("p", "t1");
  expect(fetchMock).toHaveBeenCalledWith("/api/projects/p/tokens/t1", expect.objectContaining({ method: "DELETE" }));
});

it("listNotifications GETs /notifications", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
  const client = createClient("/api", fetchMock as unknown as typeof fetch);
  await client.listNotifications("p");
  expect(fetchMock).toHaveBeenCalledWith("/api/projects/p/notifications", expect.objectContaining({ method: "GET" }));
});

it("createNotification POSTs kind/url/events", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "n1" }) });
  const client = createClient("/api", fetchMock as unknown as typeof fetch);
  const body = { kind: "webhook" as const, url: "https://x.test/h", events: ["failed" as const] };
  await client.createNotification("p", body);
  expect(fetchMock).toHaveBeenCalledWith("/api/projects/p/notifications",
    expect.objectContaining({ method: "POST", body: JSON.stringify(body) }));
});

it("deleteNotification DELETEs via the no-body path", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
  const client = createClient("/api", fetchMock as unknown as typeof fetch);
  await client.deleteNotification("p", "n1");
  expect(fetchMock).toHaveBeenCalledWith("/api/projects/p/notifications/n1", expect.objectContaining({ method: "DELETE" }));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @allure-station/web exec vitest run src/api/client.test.ts`
Expected: FAIL — `client.getQualityGate is not a function` (methods don't exist yet).

- [ ] **Step 3: Add the types to the import and the methods to the interface**

In `packages/web/src/api/client.ts`, extend the existing `import type { … } from "@allure-station/shared";` to also import `ApiToken, CreatedToken, QualityGateConfig, Notification, NotificationKind, NotificationTrigger`.

Add to the `ApiClient` interface (after `setVisibility`, grouped logically):

```ts
  getQualityGate(projectId: string): Promise<QualityGateConfig>;
  setQualityGate(projectId: string, cfg: QualityGateConfig): Promise<QualityGateConfig>;
  listTokens(projectId: string): Promise<ApiToken[]>;
  createToken(projectId: string, name: string): Promise<CreatedToken>;
  deleteToken(projectId: string, tokenId: string): Promise<void>;
  listNotifications(projectId: string): Promise<Notification[]>;
  createNotification(projectId: string, body: { kind: NotificationKind; url: string; events: NotificationTrigger[] }): Promise<Notification>;
  deleteNotification(projectId: string, notificationId: string): Promise<void>;
```

- [ ] **Step 4: Implement the methods in the returned object**

In the object returned by `createClient` (after `setVisibility:`), add:

```ts
    getQualityGate: (projectId) => json<QualityGateConfig>(`/projects/${projectId}/quality-gate`, { method: "GET" }),
    setQualityGate: (projectId, cfg) =>
      json<QualityGateConfig>(`/projects/${projectId}/quality-gate`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(cfg) }),
    listTokens: (projectId) => json<ApiToken[]>(`/projects/${projectId}/tokens`, { method: "GET" }),
    createToken: (projectId, name) =>
      json<CreatedToken>(`/projects/${projectId}/tokens`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) }),
    deleteToken: (projectId, tokenId) => noContent(`/projects/${projectId}/tokens/${tokenId}`, { method: "DELETE" }),
    listNotifications: (projectId) => json<Notification[]>(`/projects/${projectId}/notifications`, { method: "GET" }),
    createNotification: (projectId, body) =>
      json<Notification>(`/projects/${projectId}/notifications`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    deleteNotification: (projectId, notificationId) => noContent(`/projects/${projectId}/notifications/${notificationId}`, { method: "DELETE" }),
```

- [ ] **Step 5: Run tests + typecheck to verify they pass**

Run: `pnpm --filter @allure-station/web exec vitest run src/api/client.test.ts && pnpm --filter @allure-station/web typecheck`
Expected: PASS (all new cases green, no type errors).

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/api/client.ts packages/web/src/api/client.test.ts
git commit -m "feat(web): API client methods for quality gate, tokens, notifications"
```

---

## Task 2: Friendly run-selector timestamps (shared `runLabel`)

**Files:**
- Modify: `packages/web/src/lib/format.ts` (add exported `runLabel`)
- Modify: `packages/web/src/components/RunSelector.tsx` (use the shared `runLabel`, add `title`)
- Modify: `packages/web/src/pages/Project.tsx` (`ComparePanel` reuses `runLabel`)
- Test: `packages/web/src/lib/format.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/web/src/lib/format.test.ts`:

```ts
import { runLabel } from "./format.js"; // add to the existing import from "./format.js"

describe("runLabel", () => {
  const now = new Date("2026-06-08T12:00:30Z").getTime(); // 30s after the run below
  const run = {
    id: "r1", projectId: "p", status: "ready", createdAt: "2026-06-08T12:00:00Z",
    stats: { passed: 7, total: 8, failed: 1, broken: 0, skipped: 0, flaky: 0, durationMs: 1000 },
    branch: "main", commit: "e4f5a6b7c8d9", environment: "staging",
  } as unknown as import("@allure-station/shared").Run;

  it("leads with relative time and includes status, ratio, short sha, env", () => {
    expect(runLabel(run, now)).toBe("just now — ready (7/8) — main@e4f5a6b · staging");
  });

  it("falls back cleanly with no branch/env", () => {
    const bare = { ...run, branch: null, commit: null, environment: null } as unknown as import("@allure-station/shared").Run;
    expect(runLabel(bare, now)).toBe("just now — ready (7/8)");
  });

  it("omits the ratio when stats are absent", () => {
    const noStats = { ...run, stats: null, branch: null, commit: null, environment: null } as unknown as import("@allure-station/shared").Run;
    expect(runLabel(noStats, now)).toBe("just now — ready");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @allure-station/web exec vitest run src/lib/format.test.ts`
Expected: FAIL — `runLabel is not exported`.

- [ ] **Step 3: Implement `runLabel` in `lib/format.ts`**

Append to `packages/web/src/lib/format.ts`:

```ts
import type { Run } from "@allure-station/shared";

/** Human-friendly run label for selectors: relative time, status, pass ratio, branch@sha · env. */
export function runLabel(r: Run, now: number = Date.now()): string {
  const base = `${relativeTime(r.createdAt, now)} — ${r.status}${r.stats ? ` (${r.stats.passed}/${r.stats.total})` : ""}`;
  const meta = [
    r.branch ? `${r.branch}${r.commit ? `@${r.commit.slice(0, 7)}` : ""}` : null,
    r.environment || null,
  ].filter(Boolean).join(" · ");
  return meta ? `${base} — ${meta}` : base;
}
```

- [ ] **Step 4: Use `runLabel` in `RunSelector.tsx` and keep exact time on hover**

In `packages/web/src/components/RunSelector.tsx`: delete the local `runLabel` function (lines 4–11), import the shared one, and set the exact ISO as a `title`:

```ts
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
```

- [ ] **Step 5: Reuse `runLabel` in `ComparePanel`**

In `packages/web/src/pages/Project.tsx`, add `runLabel` to the existing `import { relativeTime } from "@/lib/format";` (make it `import { relativeTime, runLabel } from "@/lib/format";`). Replace the `runItems` definition inside `ComparePanel`:

```tsx
  const runItems = readyRuns.map((r) => (
    <SelectItem key={r.id} value={r.id}><span title={r.createdAt}>{runLabel(r)}</span></SelectItem>
  ));
```

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm --filter @allure-station/web exec vitest run src/lib/format.test.ts && pnpm --filter @allure-station/web typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/lib/format.ts packages/web/src/lib/format.test.ts packages/web/src/components/RunSelector.tsx packages/web/src/pages/Project.tsx
git commit -m "feat(web): friendly relative-time run labels in selectors (shared runLabel)"
```

---

## Task 3: Surface the regression hint (labelled history affordance)

**Files:**
- Modify: `packages/web/src/pages/Project.tsx` (the `Bucket` component)

No new test: this is a presentational change to an existing, behavior-tested affordance (the click handler and `aria-label` are unchanged). Verified by typecheck + manual.

- [ ] **Step 1: Replace the bare icon button with a labelled control**

In `packages/web/src/pages/Project.tsx`, in the `Bucket` component, replace the history `<button>` (the one with `aria-label={`History for ${t.name}`}`) with a labelled version:

```tsx
            {(t.historyId ?? t.fullName) ? (
              <button type="button" onClick={() => onOpen(t)} aria-label={`History for ${t.name}`}
                className="ml-1 inline-flex items-center gap-1 rounded px-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                <History className="size-3.5" />
                <span>History</span>
              </button>
            ) : null}
```

- [ ] **Step 2: Typecheck and eyeball**

Run: `pnpm --filter @allure-station/web typecheck`
Expected: PASS. The `History` icon import already exists in `Project.tsx`.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/pages/Project.tsx
git commit -m "feat(web): label the per-test history control on compare rows (discoverable regression hint)"
```

---

## Task 4: Settings access state helper + gating rewrite + open-mode banner

**Files:**
- Create: `packages/web/src/lib/settings-access.ts`
- Create: `packages/web/src/lib/settings-access.test.ts`
- Modify: `packages/web/src/pages/ProjectSettings.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/web/src/lib/settings-access.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { settingsState } from "./settings-access.js";

describe("settingsState", () => {
  it("open mode when security is disabled (regardless of sign-in)", () => {
    expect(settingsState({ securityEnabled: false, signedIn: false, canManageMembers: false })).toBe("open");
    expect(settingsState({ securityEnabled: false, signedIn: true, canManageMembers: true })).toBe("open");
  });
  it("prompts sign-in when security is on and not signed in", () => {
    expect(settingsState({ securityEnabled: true, signedIn: false, canManageMembers: false })).toBe("signin");
  });
  it("full manage when signed in and members are manageable", () => {
    expect(settingsState({ securityEnabled: true, signedIn: true, canManageMembers: true })).toBe("manage");
  });
  it("limited when signed in but not an owner/admin", () => {
    expect(settingsState({ securityEnabled: true, signedIn: true, canManageMembers: false })).toBe("limited");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @allure-station/web exec vitest run src/lib/settings-access.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `packages/web/src/lib/settings-access.ts`:

```ts
export type SettingsState = "open" | "signin" | "manage" | "limited";

/**
 * What the project Settings page should render.
 * - open:   zero-config mode (no accounts) — writes are open; show functional cards + a banner.
 * - signin: security on, not signed in — prompt to sign in.
 * - manage: signed in with owner/admin — show everything.
 * - limited: signed in but not owner/admin — functional cards only; members/audit gated.
 */
export function settingsState(
  { securityEnabled, signedIn, canManageMembers }:
  { securityEnabled: boolean; signedIn: boolean; canManageMembers: boolean },
): SettingsState {
  if (!securityEnabled) return "open";
  if (!signedIn) return "signin";
  return canManageMembers ? "manage" : "limited";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @allure-station/web exec vitest run src/lib/settings-access.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewrite `ProjectSettings` to use the state**

Replace the body of `ProjectSettings` in `packages/web/src/pages/ProjectSettings.tsx` (keep `VisibilityCard`, `MembersCard`, `AuditCard` below it unchanged for now; new cards are added in Tasks 5–7). Add imports at the top: `import { Link } from "react-router-dom";` is already present; add `import { settingsState } from "@/lib/settings-access";`.

```tsx
export function ProjectSettings() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const { data: config } = useQuery({ queryKey: ["config"], queryFn: () => api.getConfig() });
  // Owner-gated members fetch doubles as the capability probe.
  const { data: members, isError } = useQuery({
    queryKey: ["members", id], queryFn: () => api.listMembers(id), enabled: !!user, retry: false,
  });
  const canManageMembers = !!user && !isError && members !== undefined;
  const state = settingsState({ securityEnabled: !!config?.securityEnabled, signedIn: !!user, canManageMembers });

  return (
    <>
      <Topbar title={<span className="flex items-center gap-2"><Link to={`/projects/${id}`} className="text-muted-foreground hover:text-foreground">{id}</Link><span className="text-muted-foreground">/</span>Settings</span>} />
      <main className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {state === "signin" ? (
            <p className="text-sm text-muted-foreground">
              <Link to="/login" className="text-primary hover:underline">Sign in</Link> to manage this project's settings.
            </p>
          ) : (
            <>
              {state === "open" && (
                <Card><CardContent className="p-4 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">Open mode.</span> Anyone can manage this project.
                  Set <code>ADMIN_EMAIL</code> and <code>ADMIN_PASSWORD</code> to require sign-in.
                </CardContent></Card>
              )}
              <VisibilityCard projectId={id} />
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
            </>
          )}
        </div>
      </main>
    </>
  );
}
```

> Note: `QualityGateCard`, `TokensCard`, and `NotificationsCard` are added in Tasks 5–7. To keep this task compiling on its own, add temporary stub components at the bottom of the file now and replace them in the later tasks:
> ```tsx
> function QualityGateCard(_: { projectId: string }) { return null; }
> function TokensCard(_: { projectId: string }) { return null; }
> function NotificationsCard(_: { projectId: string }) { return null; }
> ```

- [ ] **Step 6: Typecheck + run the helper test**

Run: `pnpm --filter @allure-station/web typecheck && pnpm --filter @allure-station/web exec vitest run src/lib/settings-access.test.ts`
Expected: PASS (stubs satisfy the compiler; helper test green).

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/lib/settings-access.ts packages/web/src/lib/settings-access.test.ts packages/web/src/pages/ProjectSettings.tsx
git commit -m "feat(web): honest settings gating (open-mode banner, sign-in/limited states)"
```

---

## Task 5: QualityGateCard + percent↔fraction form helpers

**Files:**
- Create: `packages/web/src/lib/quality-gate-form.ts`
- Create: `packages/web/src/lib/quality-gate-form.test.ts`
- Modify: `packages/web/src/pages/ProjectSettings.tsx` (replace the `QualityGateCard` stub)

- [ ] **Step 1: Write the failing test for the conversion helpers**

Create `packages/web/src/lib/quality-gate-form.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { qgConfigToForm, qgFormToConfig } from "./quality-gate-form.js";

describe("quality-gate form conversion", () => {
  it("config → form: fraction→percent, ms→seconds, missing→empty string", () => {
    expect(qgConfigToForm({ maxFailures: 0, minTests: 5, minPassRate: 0.95, maxDurationMs: 30000 }))
      .toEqual({ maxFailures: "0", minTests: "5", minPassRate: "95", maxDurationSec: "30" });
    expect(qgConfigToForm({})).toEqual({ maxFailures: "", minTests: "", minPassRate: "", maxDurationSec: "" });
  });

  it("form → config: percent→fraction, seconds→ms, empty→omitted", () => {
    expect(qgFormToConfig({ maxFailures: "0", minTests: "5", minPassRate: "95", maxDurationSec: "30" }))
      .toEqual({ maxFailures: 0, minTests: 5, minPassRate: 0.95, maxDurationMs: 30000 });
    expect(qgFormToConfig({ maxFailures: "", minTests: "", minPassRate: "", maxDurationSec: "" })).toEqual({});
  });

  it("round-trips", () => {
    const cfg = { maxFailures: 2, minPassRate: 0.8 };
    expect(qgFormToConfig(qgConfigToForm(cfg))).toEqual(cfg);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @allure-station/web exec vitest run src/lib/quality-gate-form.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helpers**

Create `packages/web/src/lib/quality-gate-form.ts`:

```ts
import type { QualityGateConfig } from "@allure-station/shared";

export interface QgForm {
  maxFailures: string;
  minTests: string;
  minPassRate: string;   // percent, e.g. "95"
  maxDurationSec: string; // seconds
}

export function qgConfigToForm(cfg: QualityGateConfig): QgForm {
  const s = (n: number | undefined) => (n === undefined ? "" : String(n));
  return {
    maxFailures: s(cfg.maxFailures),
    minTests: s(cfg.minTests),
    minPassRate: cfg.minPassRate === undefined ? "" : String(Math.round(cfg.minPassRate * 100)),
    maxDurationSec: cfg.maxDurationMs === undefined ? "" : String(Math.round(cfg.maxDurationMs / 1000)),
  };
}

export function qgFormToConfig(form: QgForm): QualityGateConfig {
  const cfg: QualityGateConfig = {};
  if (form.maxFailures !== "") cfg.maxFailures = Number(form.maxFailures);
  if (form.minTests !== "") cfg.minTests = Number(form.minTests);
  if (form.minPassRate !== "") cfg.minPassRate = Number(form.minPassRate) / 100;
  if (form.maxDurationSec !== "") cfg.maxDurationMs = Number(form.maxDurationSec) * 1000;
  return cfg;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @allure-station/web exec vitest run src/lib/quality-gate-form.test.ts`
Expected: PASS.

- [ ] **Step 5: Replace the `QualityGateCard` stub with the real card**

In `packages/web/src/pages/ProjectSettings.tsx`, remove the `QualityGateCard` stub and add (also add to the top imports: `import { useEffect } from "react";` merged into the existing `react` import, and `import { qgConfigToForm, qgFormToConfig, type QgForm } from "@/lib/quality-gate-form";`):

```tsx
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
      <Input type="number" min={0} value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} placeholder={hint} className="max-w-[160px]" />
    </label>
  );
  if (data === undefined) return null;
  return (
    <Card>
      <CardHeader><CardTitle>Quality gate</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-4">
          {field("maxFailures", "Max failures", "e.g. 0")}
          {field("minTests", "Min tests", "e.g. 1")}
          {field("minPassRate", "Min pass rate (%)", "e.g. 95")}
          {field("maxDurationSec", "Max duration (s)", "e.g. 600")}
        </div>
        <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>Save gate</Button>
        <p className="text-xs text-muted-foreground">Leave a field blank to disable that rule. The badge and run summary reflect the verdict.</p>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 6: Typecheck + tests**

Run: `pnpm --filter @allure-station/web exec vitest run src/lib/quality-gate-form.test.ts && pnpm --filter @allure-station/web typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/lib/quality-gate-form.ts packages/web/src/lib/quality-gate-form.test.ts packages/web/src/pages/ProjectSettings.tsx
git commit -m "feat(web): quality gate settings card (percent/seconds form)"
```

---

## Task 6: TokensCard

**Files:**
- Modify: `packages/web/src/pages/ProjectSettings.tsx` (replace the `TokensCard` stub)

No new pure logic; covered by Task 1 client tests + manual verification.

- [ ] **Step 1: Replace the `TokensCard` stub with the real card**

In `packages/web/src/pages/ProjectSettings.tsx`, remove the `TokensCard` stub and add it. Add `import type { CreatedToken } from "@allure-station/shared";` and `import { relativeTime } from "@/lib/format";` to the top imports.

```tsx
function TokensCard({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [created, setCreated] = useState<CreatedToken | null>(null);
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
              <Button size="sm" variant="outline" onClick={() => { void navigator.clipboard?.writeText(created.token); toast.success("Copied"); }}>Copy</Button>
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
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @allure-station/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/pages/ProjectSettings.tsx
git commit -m "feat(web): CI tokens settings card (create-reveals-once, list, revoke)"
```

---

## Task 7: NotificationsCard

**Files:**
- Modify: `packages/web/src/pages/ProjectSettings.tsx` (replace the `NotificationsCard` stub)

- [ ] **Step 1: Replace the `NotificationsCard` stub with the real card**

In `packages/web/src/pages/ProjectSettings.tsx`, remove the `NotificationsCard` stub and add it. Add `import type { NotificationKind, NotificationTrigger } from "@allure-station/shared";` to the top imports.

```tsx
const NOTIF_EVENTS: NotificationTrigger[] = ["completed", "failed", "gate_failed", "regression"];

function NotificationsCard({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<NotificationKind>("webhook");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<NotificationTrigger[]>(["failed", "gate_failed", "regression"]);
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
                  <TableCell className="text-right"><Button variant="ghost" size="sm" disabled={remove.isPending && remove.variables === n.id} onClick={() => remove.mutate(n.id)}>Remove</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Typecheck + full web test run**

Run: `pnpm --filter @allure-station/web typecheck && pnpm --filter @allure-station/web test`
Expected: PASS (all web tests green).

- [ ] **Step 3: Manual verification against the running app**

With the admin-enabled container (security on, `admin@demo.local` / `allure-admin-123`) and the `demo-web` project:
- `/projects/demo-web/settings` signed in as admin → all cards (Visibility, Quality gate, CI tokens, Notifications, Members, Audit).
- Set a gate (Max failures 0, Min pass rate 95) → save → toast; reload prefilled.
- Create a token → plaintext revealed once → appears in the list → revoke.
- Add a webhook notification → appears → remove.
- Sign out / open-mode instance → banner + functional cards, Members/Audit show the "enable accounts" note.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/pages/ProjectSettings.tsx
git commit -m "feat(web): notifications settings card (slack/webhook, events, list, remove)"
```

---

## Final verification (after all tasks)

```bash
pnpm --filter @allure-station/web test
pnpm --filter @allure-station/web typecheck
pnpm --filter @allure-station/web build
```

All green → use **superpowers:finishing-a-development-branch**.

## Self-review notes (planner)

- **Spec coverage:** Settings cards (Tasks 5–7), honest gating + banner (Task 4), surfaced regression (Task 3), friendly timestamps (Task 2), client methods (Task 1). Item #4 (layout) intentionally dropped per spec (measured already correct). ✓
- **Type consistency:** `QgForm` keys (`maxDurationSec`) match between `quality-gate-form.ts` and `QualityGateCard`; `settingsState` returns `"open"|"signin"|"manage"|"limited"` used verbatim in `ProjectSettings`; client method names match Task 1 ↔ card call sites. ✓
- **No placeholders:** every code step is concrete; Task 4 introduces compiling stubs explicitly replaced in Tasks 5–7 (called out so out-of-order reading is safe). ✓
