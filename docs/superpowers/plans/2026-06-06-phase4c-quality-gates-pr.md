# Phase 4c — Quality gates + PR status checks/comments Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** A configurable per-project quality gate (pass/fail verdict from run stats), a run summary endpoint bundling verdict + report link + previous-run pointer, and a GitHub Action step that posts a PR **commit status** + **comment** (pass/fail, gate verdict, stats, trend delta vs the previous run, report link).

**Architecture:** Gate verdicts are computed over the `RunStats` we already persist (spike: Allure's meaningful rules — maxFailures/minTests/successRate/maxDuration — are all aggregate-expressible; Allure's `QualityGate.validate` needs full `TestResult[]` we don't hold). Gate config is stored per project. The server exposes a stateless **summary** endpoint; **GitHub posting happens in the Action** (an `actions/github-script` step with the workflow `GITHUB_TOKEN`), so no GitHub credentials live on the server. "Trend delta vs base" = delta vs the previous ready run via the existing `/compare`.

## Design decisions
- **Gate rules** (all optional; gate passes if all configured checks pass): `maxFailures` (failed+broken ≤ N), `minTests` (total ≥ N), `minPassRate` (passed/total ≥ r, 0..1), `maxDurationMs` (durationMs ≤ N). No gate configured ⇒ verdict `configured:false, passed:true`.
- **Gate config stored per project** (`projects.quality_gate` JSON text column); GET open, PUT auth-gated (a write).
- **Verdict computed on-demand** (summary endpoint) from `run.stats` + project gate — so changing the gate re-evaluates; no run schema change.
- **Summary** = `{ run, reportPath, previousReadyRunId, qualityGate: verdict }`. The Action calls `/compare?base=previousReadyRunId&target=runId` for the delta.
- **Action posting** via `actions/github-script@v7`, guarded to `pull_request` events with a token; posts a commit status on the PR head SHA + an upserted PR comment.

---

### Task 1: shared contracts
**Files:** `packages/shared/src/contracts.ts`
- [ ] Add:
```ts
export const qualityGateConfigSchema = z.object({
  maxFailures: z.number().int().nonnegative().optional(),
  minTests: z.number().int().nonnegative().optional(),
  minPassRate: z.number().min(0).max(1).optional(),
  maxDurationMs: z.number().int().nonnegative().optional(),
});
export const qualityGateCheckSchema = z.object({
  rule: z.string(), ok: z.boolean(), actual: z.number(), threshold: z.number(),
});
export const qualityGateVerdictSchema = z.object({
  configured: z.boolean(), passed: z.boolean(), checks: z.array(qualityGateCheckSchema),
});
export const runSummarySchema = z.object({
  run: runSchema,
  reportPath: z.string(),
  previousReadyRunId: z.string().nullable(),
  qualityGate: qualityGateVerdictSchema,
});
```
Types: `QualityGateConfig`, `QualityGateVerdict`, `RunSummary`. Commit `feat(shared): quality-gate + run-summary contracts`.

---

### Task 2: projects.quality_gate column + migration
**Files:** `schema.sqlite.ts`, `schema.pg.ts`
- [ ] Add `qualityGate: text("quality_gate")` (nullable JSON) to the `projects` table in both dialects. Generate migrations. Commit `feat(db): projects.quality_gate column`.

---

### Task 3: gate evaluation + repo methods
**Files:** Create `packages/server/src/gate.ts`, `gate.test.ts`; modify `repositories.ts`.
- [ ] `gate.ts`:
```ts
import type { QualityGateConfig, QualityGateVerdict, RunStats } from "@allure-station/shared";
export function evaluateGate(stats: RunStats, config: QualityGateConfig | null): QualityGateVerdict {
  if (!config || Object.keys(config).length === 0) return { configured: false, passed: true, checks: [] };
  const checks: QualityGateVerdict["checks"] = [];
  const failures = stats.failed + stats.broken;
  if (config.maxFailures !== undefined) checks.push({ rule: "maxFailures", actual: failures, threshold: config.maxFailures, ok: failures <= config.maxFailures });
  if (config.minTests !== undefined) checks.push({ rule: "minTests", actual: stats.total, threshold: config.minTests, ok: stats.total >= config.minTests });
  if (config.minPassRate !== undefined) {
    const rate = stats.total ? stats.passed / stats.total : 0;
    checks.push({ rule: "minPassRate", actual: rate, threshold: config.minPassRate, ok: rate >= config.minPassRate });
  }
  if (config.maxDurationMs !== undefined) {
    const dur = stats.durationMs ?? 0;
    checks.push({ rule: "maxDurationMs", actual: dur, threshold: config.maxDurationMs, ok: dur <= config.maxDurationMs });
  }
  return { configured: true, passed: checks.every((c) => c.ok), checks };
}
```
- [ ] `gate.test.ts`: no config → configured:false passed:true; maxFailures pass/fail; minPassRate (0 total → rate 0); combined all-must-pass; maxDurationMs with undefined durationMs → 0.
- [ ] `ProjectRepository`: add `getQualityGate(id): Promise<QualityGateConfig | null>` (read+JSON.parse the column) and `setQualityGate(id, config): Promise<void>` (JSON.stringify, or null to clear). `RunRepository`: add `previousReadyBefore(projectId, createdAt, id)` → newest ready run with (createdAt < given) — `#selectRuns({readyOnly, order desc})` filtered; simplest: query ready runs ordered desc and pick first with createdAt<target (or id≠). Implement a focused query.
- [ ] Repo tests in repositories.test.ts harness: setQualityGate→getQualityGate round-trip + null clear; previousReadyBefore returns the prior ready run.
- [ ] Commit `feat: quality-gate evaluation + project gate config + previous-ready-run query`.

---

### Task 4: quality-gate routes + summary route
**Files:** Create `routes/quality-gate.ts`, `routes/summary.ts` (or fold into runs.ts); modify app.ts; tests.
- [ ] `GET /projects/:id/quality-gate` → config or `{}`; `PUT /projects/:id/quality-gate` (auth-gated via authorizeProjectWrite) validates `qualityGateConfigSchema`, stores it.
- [ ] `GET /projects/:projectId/runs/:runId/summary` → 404 if run missing/wrong project; build `{ run, reportPath: "/api/projects/:id/runs/:runId/report/index.html", previousReadyRunId, qualityGate: evaluateGate(run.stats ?? zero, gateConfig) }`. (If run.stats null — not ready — gate evaluates over zeroed stats; verdict still returned, mainly meaningful once ready.)
- [ ] Register routes. Tests (`routes/summary.test.ts`): summary for a ready run reflects gate pass/fail; previousReadyRunId points to the prior ready run; PUT gate is auth-gated (401 when project tokened, no auth); GET gate returns stored config.
- [ ] Commit `feat(api): quality-gate config + run summary endpoints`.

---

### Task 5: Action — PR status + comment
**Files:** `github-action/action.yml`, `github-action/README.md`
- [ ] Add inputs: `github-token` (default `${{ github.token }}`), `comment` (default "true"). Add a step AFTER the bash step:
```yaml
    - name: PR status + comment
      if: ${{ inputs.comment == 'true' && github.event_name == 'pull_request' && steps.run.outputs.status != 'generating' }}
      uses: actions/github-script@v7
      with:
        github-token: ${{ inputs.github-token }}
        script: |
          const base = "${{ inputs.url }}".replace(/\/$/, "");
          const project = "${{ inputs.project }}";
          const runId = "${{ steps.run.outputs.run-id }}";
          const token = "${{ inputs.token }}";
          const headers = token ? { authorization: `Bearer ${token}` } : {};
          const summary = await (await fetch(`${base}/api/projects/${project}/runs/${runId}/summary`, { headers })).json();
          const s = summary.run.stats ?? { total: 0, passed: 0, failed: 0, broken: 0, skipped: 0 };
          const gate = summary.qualityGate;
          let delta = "";
          if (summary.previousReadyRunId) {
            const cmp = await (await fetch(`${base}/api/projects/${project}/compare?base=${summary.previousReadyRunId}&target=${runId}`, { headers })).json();
            delta = `\n**Δ vs previous:** ${cmp.newlyFailing.length} new failing · ${cmp.fixed.length} fixed · ${cmp.flaky.length} flaky`;
          }
          const ok = summary.run.status === "ready" && (!gate.configured || gate.passed);
          const reportUrl = `${base}${summary.reportPath}`;
          const body = [
            `### Allure report — ${ok ? "✅ passed" : "❌ failed"}`,
            `${s.passed}/${s.total} passed · ${s.failed} failed · ${s.broken} broken · ${s.skipped} skipped${s.flaky ? ` · ${s.flaky} flaky` : ""}`,
            gate.configured ? `**Quality gate:** ${gate.passed ? "pass" : "fail"} — ${gate.checks.map(c => `${c.rule} ${c.ok ? "✓" : "✗"}`).join(", ")}` : "",
            delta,
            `\n[View report](${reportUrl})`,
          ].filter(Boolean).join("\n");
          const sha = context.payload.pull_request.head.sha;
          await github.rest.repos.createCommitStatus({ ...context.repo, sha, state: ok ? "success" : "failure", context: `allure/${project}`, target_url: reportUrl, description: `${s.passed}/${s.total} passed` });
          // Upsert a single comment (find a prior one by marker).
          const marker = `<!-- allure-station:${project} -->`;
          const { data: comments } = await github.rest.issues.listComments({ ...context.repo, issue_number: context.payload.pull_request.number });
          const existing = comments.find(c => c.body?.includes(marker));
          const full = `${marker}\n${body}`;
          if (existing) await github.rest.issues.updateComment({ ...context.repo, comment_id: existing.id, body: full });
          else await github.rest.issues.createComment({ ...context.repo, issue_number: context.payload.pull_request.number, body: full });
```
- [ ] README: document `github-token`/`comment` inputs, required permissions (`pull-requests: write`, `statuses: write`), and that it posts on `pull_request` events. Commit `feat(ci): PR commit status + comment (quality gate + trend delta)`.

---

### Task 6: README
- [ ] Quality-gate section (config endpoints + rules) and a note the Action posts PR status/comments. Commit `docs: quality gates + PR checks`.

---

## Final verification
- [ ] `pnpm -r typecheck` + `pnpm -r test`; pg conformance (quality_gate column + gate round-trip); e2e still green.
- [ ] Live: set a gate via PUT, generate, GET summary → verdict reflects stats; (GitHub-script step is review-only — no live GitHub).
- [ ] action.yml YAML parses. Code-review; fix; push.

## Self-review notes
- Gate verdict is on-demand (not stored on the run) → no run schema change; changing the gate re-evaluates. Acceptable for PR-time checks.
- `Project` domain type is NOT extended with qualityGate (avoids rippling); gate lives in its own column + repo methods.
- summary `reportPath` is a path; the Action prefixes the base URL.
- Action's github-script step is guarded (pull_request + token + non-generating); needs `pull-requests: write` + `statuses: write` permissions — document.
- The compare delta reuses /compare (3a); previousReadyRunId excludes the current run.
