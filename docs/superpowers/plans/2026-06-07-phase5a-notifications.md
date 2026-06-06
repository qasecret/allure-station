# Phase 5a — Notifications Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** Per-project notification subscriptions (Slack + generic webhook) fired on run completion, quality-gate breaches, and new regressions.

**Architecture:** Subscriptions live in a `notifications` table per project. Dispatch happens **inline in `runGeneration`** (the generation job runs exactly once → exactly-once delivery; a bus subscriber would double-send across API replicas + worker). Trigger selection is a pure function over the run's status + gate verdict + regression count (computed via the existing `evaluateGate` + `compareRuns`). Sending is best-effort HTTP POST (Slack `{text}` or a generic JSON payload), parallel, timeout-bounded, never failing the run.

## Design decisions
- **Channels:** `slack` (POST `{text}` to an incoming-webhook URL) and `webhook` (POST a JSON payload). **Email/SMTP deferred** (documented) — generic webhook covers it.
- **Triggers:** `completed` (any terminal), `failed` (generation failed), `gate_failed` (ready but gate breached), `regression` (ready + ≥1 newly-failing test vs previous ready run). A subscription stores the subset it wants (default `["failed","gate_failed","regression"]`).
- **Exactly-once:** dispatch from `runGeneration` after markReady/markFailed, wrapped best-effort (errors logged, never thrown).
- **No work when unconfigured:** skip entirely if the project has no subscriptions.
- **`PUBLIC_URL`** (optional config) → absolute report links in payloads; else the relative path.

---

### Task 1: shared contracts
**Files:** `packages/shared/src/contracts.ts`
```ts
export const notificationTriggerSchema = z.enum(["completed", "failed", "gate_failed", "regression"]);
export const notificationKindSchema = z.enum(["slack", "webhook"]);
export const notificationSchema = z.object({
  id: z.string(),
  projectId: projectIdSchema,
  kind: notificationKindSchema,
  url: z.string().url(),
  events: z.array(notificationTriggerSchema).min(1),
  createdAt: z.string(),
});
export const createNotificationRequestSchema = z.object({
  kind: notificationKindSchema,
  url: z.string().url(),
  events: z.array(notificationTriggerSchema).min(1).default(["failed", "gate_failed", "regression"]),
});
```
Types `NotificationTrigger`, `NotificationKind`, `Notification`. Commit `feat(shared): notification contracts`.

---

### Task 2: notifications table + migration
**Files:** `schema.sqlite.ts`, `schema.pg.ts`
```ts
export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),     // slack|webhook
  url: text("url").notNull(),
  events: text("events").notNull(), // JSON string[] of triggers
  createdAt: text("created_at").notNull(),
}, (t) => ({ byProject: index("idx_notifications_project").on(t.projectId) }));
```
pg analogous. Generate migrations. Commit `feat(db): notifications table`.

---

### Task 3: NotificationRepository + cascade
**Files:** Create `db/notifications-repo.ts`; modify `repositories.ts` (cascade) + tests.
- [ ] Repo: `create(projectId, kind, url, events[], now)`, `listByProject(projectId)` (parse events JSON), `remove(projectId, id)→bool`, `countByProject`.
- [ ] `ProjectRepository.remove`: also `delete(notifications).where(projectId)` (libsql no-cascade) — add to the deepest-first deletes.
- [ ] Repo tests in repositories.test.ts harness (add `notifications` + pg TRUNCATE list): create→list (events round-trip), remove project-scoped, cascade on project remove. Commit `feat(db): NotificationRepository`.

---

### Task 4: notify module (pure trigger selection + dispatch)
**Files:** Create `notify.ts`, `notify.test.ts`.
```ts
import { compareRuns } from "./compare.js";
import { evaluateGate } from "./gate.js";
import type { AppDeps } from "./app.js";
import type { Notification, NotificationTrigger, Run } from "@allure-station/shared";

/** Which triggers fire for a terminal run (pure). */
export function selectTriggers(run: Run, gateBreached: boolean, newlyFailing: number): Set<NotificationTrigger> {
  const t = new Set<NotificationTrigger>();
  if (run.status === "failed") { t.add("completed"); t.add("failed"); }
  if (run.status === "ready") {
    t.add("completed");
    if (gateBreached) t.add("gate_failed");
    if (newlyFailing > 0) t.add("regression");
  }
  return t;
}

export function slackText(p: { project: string; run: Run; fired: NotificationTrigger[]; newlyFailing: number; reportUrl: string }): string { ... }
export function webhookPayload(...) { ... }

/** Best-effort: load subs, compute triggers, POST matching ones. Never throws. */
export async function dispatchNotifications(deps: AppDeps, projectId: string, runId: string, fetchImpl = fetch): Promise<void> {
  try {
    const subs = await deps.notifications.listByProject(projectId);
    if (subs.length === 0) return;
    const run = await deps.runs.get(runId);
    if (!run || (run.status !== "ready" && run.status !== "failed")) return;
    let gateBreached = false, newlyFailing = 0;
    if (run.status === "ready" && run.stats) {
      const gate = await deps.projects.getQualityGate(projectId);
      const v = evaluateGate(run.stats, gate);
      gateBreached = v.configured && !v.passed;
      const prev = await deps.runs.previousReadyBefore(projectId, run.createdAt);
      if (prev) {
        const [a, b] = await Promise.all([deps.testResults.listByRun(prev.id), deps.testResults.listByRun(runId)]);
        newlyFailing = compareRuns({ runId: prev.id, createdAt: prev.createdAt, tests: a }, { runId, createdAt: run.createdAt, tests: b }).newlyFailing.length;
      }
    }
    const fired = [...selectTriggers(run, gateBreached, newlyFailing)];
    const reportUrl = `${deps.publicUrl ?? ""}/api/projects/${projectId}/runs/${runId}/report/index.html`;
    const targets = subs.filter((s) => s.events.some((e) => fired.includes(e)));
    await Promise.allSettled(targets.map((s) => postOne(s, { project: projectId, run, fired, newlyFailing, reportUrl }, fetchImpl)));
  } catch (err) { console.error("[notify] dispatch failed:", err); }
}
```
`postOne` builds the slack/webhook body and POSTs with `AbortSignal.timeout(10000)`, catching per-target.
- [ ] `notify.test.ts`: selectTriggers matrix (failed; ready clean; ready+gate; ready+regression); dispatch with a fake fetch + fake deps — asserts only matching subs are POSTed, slack vs webhook body shapes, and that a throwing fetch doesn't propagate. Commit `feat: notification trigger selection + best-effort dispatch`.

---

### Task 5: wire into generation + deps + config
**Files:** `generation.ts`, `deps.ts`, `app.ts`, `config.ts`, `test-helpers.ts`.
- [ ] `AppDeps`: add `notifications: NotificationRepository` + `publicUrl: string | undefined`. buildDeps constructs the repo + passes `config.publicUrl`; test-helpers add both (publicUrl undefined).
- [ ] `config.ts`: `publicUrl: env.PUBLIC_URL` (optional, no trailing slash — strip).
- [ ] `generation.ts` `runGeneration`: after `publishRun` on the ready path AND after `publishRun` in the catch (failed), `await dispatchNotifications(deps, projectId, runId)`. (Best-effort inside; the run is already terminal.)
- [ ] Commit `feat: dispatch notifications on run completion`.

---

### Task 6: notification routes
**Files:** Create `routes/notifications.ts`; modify app.ts; tests.
- [ ] `POST /projects/:id/notifications` (auth-gated) — validate `createNotificationRequestSchema`, create, return it. `GET /projects/:id/notifications` (auth-gated — reveals webhook URLs) → list. `DELETE /projects/:id/notifications/:nid` (auth-gated) → 204/404.
- [ ] Register. Tests (`routes/notifications.test.ts`): create→list→delete; invalid url/empty events → 400; auth-gated (401 when project tokened, no token); plus an integration test: configure a webhook (use a fake by pointing at a captured fetch? routes use real generation...) — keep routes test to CRUD + auth; trigger dispatch is covered in notify.test. Commit `feat(api): notification subscription routes`.

---

### Task 7: README
- [ ] Notifications section: kinds, triggers, payload shapes, `PUBLIC_URL`, email-deferred note, curl example. Commit `docs: notifications`.

---

## Final verification
- [ ] `pnpm -r typecheck` + `pnpm -r test`; pg conformance (notifications table + cascade); e2e green.
- [ ] Live smoke: configure a webhook pointing at a local capture server, generate from fixtures, assert the POST arrives with the right payload (validates the real dispatch path).
- [ ] Code-review; fix; push.

## Self-review notes
- Dispatch is exactly-once via generation (not the bus) and best-effort (try/catch, per-target timeout) — a down webhook never fails a run.
- `GET /notifications` is auth-gated because it exposes webhook URLs (unlike most reads).
- regression = newlyFailing vs previousReadyBefore using the persisted test_results + compareRuns (3a).
- AppDeps gains `notifications` + `publicUrl`; update buildDeps + test-helpers (grep).
- ProjectRepository.remove must delete notifications too (libsql no-cascade) — cover with the cascade test.
