import { compareRuns } from "./compare.js";
import { evaluateGate } from "./gate.js";
import { checkWebhookUrl } from "./safe-url.js";
import type { AppDeps } from "./app.js";
import type { Notification, NotificationTrigger, Run } from "@allure-station/shared";

const ZERO = { total: 0, passed: 0, failed: 0, broken: 0, skipped: 0 };

/** How long to wait on a webhook/Slack POST before aborting — shared by live dispatch and test sends. */
const WEBHOOK_TIMEOUT_MS = 10_000;

/** The one place a notification is actually delivered: POST JSON with the shared timeout. */
function deliver(url: string, body: unknown, fetchImpl: typeof fetch): Promise<Response> {
  return fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
  });
}

export interface NotifyContext {
  project: string;
  run: Run;
  fired: NotificationTrigger[];
  newlyFailing: number;
  reportUrl: string;
}

/** Which triggers fire for a terminal run (pure). */
export function selectTriggers(run: Run, gateBreached: boolean, newlyFailing: number): NotificationTrigger[] {
  const t = new Set<NotificationTrigger>();
  if (run.status === "failed") { t.add("completed"); t.add("failed"); }
  if (run.status === "ready") {
    t.add("completed");
    if (gateBreached) t.add("gate_failed");
    if (newlyFailing > 0) t.add("regression");
  }
  return [...t];
}

export function slackText(ctx: NotifyContext): string {
  const s = ctx.run.stats ?? ZERO;
  const icon = ctx.run.status === "failed" ? "❌"
    : ctx.fired.includes("gate_failed") || ctx.fired.includes("regression") ? "⚠️" : "✅";
  const bits = [`${icon} *${ctx.project}* run \`${ctx.run.status}\` — ${s.passed}/${s.total} passed, ${s.failed} failed, ${s.broken} broken`];
  if (ctx.fired.includes("gate_failed")) bits.push("quality gate *failed*");
  if (ctx.newlyFailing > 0) bits.push(`*${ctx.newlyFailing}* newly failing`);
  return `${bits.join(" · ")}\n${ctx.reportUrl}`;
}

export function webhookPayload(ctx: NotifyContext) {
  return {
    project: ctx.project,
    runId: ctx.run.id,
    status: ctx.run.status,
    stats: ctx.run.stats,
    triggers: ctx.fired,
    newlyFailing: ctx.newlyFailing,
    reportUrl: ctx.reportUrl,
  };
}

async function postOne(sub: Notification, ctx: NotifyContext, fetchImpl: typeof fetch): Promise<void> {
  // Re-check at dispatch (defends pre-guard rows / blocks internal targets the SSRF guard rejects).
  const safe = checkWebhookUrl(sub.url);
  if (!safe.ok) { console.error(`[notify] skipping ${sub.id}: ${safe.reason}`); return; }
  const body = sub.kind === "slack" ? { text: slackText(ctx) } : webhookPayload(ctx);
  try {
    await deliver(sub.url, body, fetchImpl);
  } catch (err) {
    console.error(`[notify] POST to ${sub.kind} (${sub.id}) failed:`, err);
  }
}

/**
 * Best-effort dispatch of a terminal run to the project's matching subscriptions. Called once per run
 * from runGeneration (exactly-once). Never throws — a down webhook must not fail the run.
 */
export async function dispatchNotifications(deps: AppDeps, projectId: string, runId: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  try {
    if ((await deps.notifications.countByProject(projectId)) === 0) return;
    const run = await deps.runs.get(runId);
    if (!run || (run.status !== "ready" && run.status !== "failed")) return;

    let gateBreached = false;
    let newlyFailing = 0;
    if (run.status === "ready" && run.stats) {
      const gate = await deps.projects.getQualityGate(projectId);
      const verdict = evaluateGate(run.stats, gate);
      gateBreached = verdict.configured && !verdict.passed;
      const prev = await deps.runs.previousReadyBefore(projectId, run.createdAt);
      if (prev) {
        const [a, b] = await Promise.all([deps.testResults.listByRun(prev.id), deps.testResults.listByRun(runId)]);
        newlyFailing = compareRuns(
          { runId: prev.id, createdAt: prev.createdAt, tests: a },
          { runId, createdAt: run.createdAt, tests: b },
        ).newlyFailing.length;
      }
    }

    const fired = selectTriggers(run, gateBreached, newlyFailing);
    const reportUrl = `${deps.publicUrl ?? ""}/api/projects/${projectId}/runs/${runId}/report/index.html`;
    const ctx: NotifyContext = { project: projectId, run, fired, newlyFailing, reportUrl };

    const subs = await deps.notifications.listByProject(projectId);
    const targets = subs.filter((s) => s.events.some((e) => fired.includes(e)));
    await Promise.allSettled(targets.map((s) => postOne(s, ctx, fetchImpl)));
  } catch (err) {
    console.error("[notify] dispatch failed:", err);
  }
}

export interface TestSendResult { ok: boolean; status?: number; error?: string }

/**
 * Deliver a one-off test message to a single subscription so a user can verify their webhook works.
 * Unlike dispatchNotifications (best-effort, swallows errors) this is an interactive action, so it
 * surfaces the delivery result — and still re-checks the SSRF guard at send time.
 */
export async function sendTestNotification(sub: Notification, projectId: string, fetchImpl: typeof fetch = fetch): Promise<TestSendResult> {
  const safe = checkWebhookUrl(sub.url);
  if (!safe.ok) return { ok: false, error: `webhook url rejected: ${safe.reason}` };
  const body = sub.kind === "slack"
    ? { text: `🔔 *${projectId}* — test notification from Allure Station. Your Slack webhook is wired up correctly.` }
    : { project: projectId, test: true, message: "Test notification from Allure Station" };
  try {
    const res = await deliver(sub.url, body, fetchImpl);
    return res.ok ? { ok: true, status: res.status } : { ok: false, status: res.status, error: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
