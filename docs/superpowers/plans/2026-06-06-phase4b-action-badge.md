# Phase 4b — GitHub Action + status badge Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** Make Allure Station first-class in CI: a reusable GitHub Action that uploads results → triggers generation → polls for the report (authenticating with a 4a token), and a shields-style SVG badge endpoint for embedding latest-run status.

**Architecture:** The badge is a public read route (`GET /api/projects/:id/badge.svg`) rendering a hand-rolled flat SVG from the latest ready run's stats — no external dep, embeddable in READMEs. The Action is a top-level `github-action/` composite action (bash + curl + jq) consumed as `uses: qasecret/allure-station/github-action@v1`; it reuses the existing API (send-results/generate/runs) so its logic is the same path the server tests + e2e already cover.

## Design decisions
- **Badge:** label `tests`, message `<passed>/<total>` from the newest ready run; green (#4c1) if no failures/broken, red (#e05d44) if any, grey (#9f9f9f) for missing project / no ready run. Always 200 SVG (badges must always render). `Cache-Control: no-cache, max-age=60`.
- **Action inputs:** `url`, `project`, `token` (optional — only needed if the project is token-protected), `results` (dir, default `allure-results`), `wait` (default true), `timeout` (default 300s). Outputs: `run-id`, `status`, `report-url`. Exits non-zero only on terminal `failed`.
- **Action placement:** top-level `github-action/` (no package.json → ignored by pnpm/turbo).
- **Recipes:** the action README documents the equivalent GitLab/Jenkins curl sequence.

---

### Task 1: badge renderer + route

**Files:** Create `packages/server/src/badge.ts`, `routes/badge.ts`, `badge.test.ts`; modify `app.ts`.

- [ ] **badge.ts:**

```ts
const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ESC[c]);

/** Minimal flat shields-style badge (no external dep). Char width approximated at 6.5px. */
export function renderBadge(label: string, message: string, color: string): string {
  const lw = Math.round(label.length * 6.5) + 10;
  const mw = Math.round(message.length * 6.5) + 10;
  const w = lw + mw;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${esc(label)}: ${esc(message)}">
  <rect width="${w}" height="20" rx="3" fill="#555"/>
  <rect x="${lw}" width="${mw}" height="20" rx="3" fill="${color}"/>
  <rect x="${lw}" width="4" height="20" fill="${color}"/>
  <g fill="#fff" font-family="Verdana,DejaVu Sans,Geneva,sans-serif" font-size="11" text-anchor="middle">
    <text x="${(lw / 2).toFixed(1)}" y="14">${esc(label)}</text>
    <text x="${(lw + mw / 2).toFixed(1)}" y="14">${esc(message)}</text>
  </g>
</svg>`;
}

export const BADGE_GREEN = "#4c1";
export const BADGE_RED = "#e05d44";
export const BADGE_GREY = "#9f9f9f";
```

- [ ] **routes/badge.ts:**

```ts
import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app.js";
import { renderBadge, BADGE_GREEN, BADGE_RED, BADGE_GREY } from "../badge.js";

export function registerBadgeRoutes(app: FastifyInstance, deps: AppDeps): void {
  // Public SVG badge for the latest ready run — always renders (200), so embeds never break.
  app.get("/projects/:projectId/badge.svg", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    let message = "no data", color = BADGE_GREY;
    if (await deps.projects.get(projectId)) {
      const [latest] = await deps.runs.listReadyByProject(projectId, 1); // newest ready
      if (latest?.stats) {
        const s = latest.stats;
        message = `${s.passed}/${s.total}`;
        color = s.failed + s.broken > 0 ? BADGE_RED : BADGE_GREEN;
      }
    }
    reply.header("content-type", "image/svg+xml; charset=utf-8");
    reply.header("cache-control", "no-cache, max-age=60");
    return renderBadge("tests", message, color);
  });
}
```

- [ ] Register `registerBadgeRoutes(api, deps)` in app.ts.

- [ ] **badge.test.ts:** unknown project → 200 svg + "no data" + grey; project with an all-passed ready run → message "2/2" + green (#4c1); a run with a failure → red (#e05d44); content-type is `image/svg+xml`. Build app + seed via `deps.runs.create/claimPending/markReady` (stats with/without failures). `renderBadge` unit: width scales with text, escapes `<`.

- [ ] Typecheck + test; commit `feat(api): shields-style status badge endpoint`.

---

### Task 2: reusable GitHub Action

**Files:** Create `github-action/action.yml`, `github-action/README.md`.

- [ ] **action.yml** (composite):

```yaml
name: "Allure Station Upload"
description: "Upload Allure results to an Allure Station instance, trigger report generation, and optionally wait."
branding: { icon: "upload-cloud", color: "purple" }
inputs:
  url: { description: "Base URL of the Allure Station instance", required: true }
  project: { description: "Project id", required: true }
  token: { description: "API token (required only if the project is token-protected)", required: false, default: "" }
  results: { description: "Directory of Allure result files", required: false, default: "allure-results" }
  wait: { description: "Wait for generation to reach a terminal status", required: false, default: "true" }
  timeout: { description: "Max seconds to wait when wait=true", required: false, default: "300" }
outputs:
  run-id: { description: "Created run id", value: "${{ steps.run.outputs.run-id }}" }
  status: { description: "ready|failed when wait=true, else generating", value: "${{ steps.run.outputs.status }}" }
  report-url: { description: "URL to the generated report", value: "${{ steps.run.outputs.report-url }}" }
runs:
  using: "composite"
  steps:
    - id: run
      shell: bash
      env:
        URL: ${{ inputs.url }}
        PROJECT: ${{ inputs.project }}
        TOKEN: ${{ inputs.token }}
        RESULTS: ${{ inputs.results }}
        WAIT: ${{ inputs.wait }}
        TIMEOUT: ${{ inputs.timeout }}
      run: |
        set -euo pipefail
        base="${URL%/}"
        auth=(); [ -n "$TOKEN" ] && auth=(-H "Authorization: Bearer $TOKEN")
        shopt -s nullglob
        curlfiles=(); for f in "$RESULTS"/*; do [ -f "$f" ] && curlfiles+=(-F "files=@$f"); done
        if [ ${#curlfiles[@]} -eq 0 ]; then echo "::error::no result files in $RESULTS"; exit 1; fi
        resp=$(curl -fsS "${auth[@]}" "${curlfiles[@]}" "$base/api/projects/$PROJECT/send-results")
        run_id=$(echo "$resp" | jq -r .runId)
        echo "run-id=$run_id" >> "$GITHUB_OUTPUT"
        report_url="$base/api/projects/$PROJECT/runs/$run_id/report/index.html"
        echo "report-url=$report_url" >> "$GITHUB_OUTPUT"
        curl -fsS -X POST "${auth[@]}" "$base/api/projects/$PROJECT/generate" >/dev/null
        status="generating"
        if [ "$WAIT" = "true" ]; then
          deadline=$(( $(date +%s) + TIMEOUT ))
          while :; do
            status=$(curl -fsS "${auth[@]}" "$base/api/projects/$PROJECT/runs/$run_id" | jq -r .status)
            [ "$status" = "ready" ] && { echo "✅ $report_url"; break; }
            [ "$status" = "failed" ] && { echo "::error::generation failed"; break; }
            [ "$(date +%s)" -ge "$deadline" ] && { echo "::warning::timed out after ${TIMEOUT}s (status=$status)"; break; }
            sleep 3
          done
        fi
        echo "status=$status" >> "$GITHUB_OUTPUT"
        [ "$status" = "failed" ] && exit 1 || true
```

- [ ] **README.md** for the action: usage example (with `secrets.ALLURE_TOKEN`), the inputs/outputs table, a note that `jq`+`curl` are required (present on GitHub-hosted runners), and equivalent **GitLab CI** + **Jenkins** curl recipes (upload → generate → poll).

- [ ] Commit `feat(ci): reusable GitHub Action (upload→generate→poll) + CI recipes`.

---

### Task 3: README

- [ ] Add a "CI integration" section: the badge embed (`![tests](URL/api/projects/<id>/badge.svg)`) and a pointer to `github-action/`. Commit `docs: CI badge + GitHub Action`.

---

## Final verification
- [ ] `pnpm -r typecheck` + `pnpm -r test` green.
- [ ] **Live action smoke:** start the server, then run the action's bash sequence (upload fixtures → generate → poll) against it with curl+jq, assert it reaches `ready` and the badge endpoint returns the right color. (Validates the action's real curl logic without GitHub.)
- [ ] Code-review; fix; push.

## Self-review notes
- Badge always returns 200 SVG (even unknown project) so embeds never 404 — intentional.
- Badge route is a READ → stays open (no auth), correct for embedding.
- `listReadyByProject(id, 1)` returns the single newest ready run (desc+limit then reverse) — [0] is newest.
- The Action reuses the exact API path covered by server tests/e2e; its risk surface is bash quoting/jq, validated by the live smoke.
- `set -euo pipefail` + `curl -fsS` make HTTP errors (401 on a protected project without a token) fail the step loudly.
