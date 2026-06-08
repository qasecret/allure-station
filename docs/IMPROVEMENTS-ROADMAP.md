# Allure Station — Improvements Roadmap (value × effort)

> A senior-automation-engineer brainstorm of functional improvements, **prioritized by
> value/effort and sequenced by dependency**. Companion to `FUTURE-WORK.md`: that doc is the
> gap analysis; this one is the *opinionated ordering* — what to build, in what order, and why.
>
> Framing: the user is an engineer who pushes results from CI and triages failures every day.
> Adoption is won or lost in the **triage loop**, not the feature list.
>
> Last updated: 2026-06-07. No implementation implied — this is a planning artifact.

## How to read this

- **Value** = impact on the daily automation-engineer workflow + adoption.
- **Effort** = relative build cost (S / M / L), accounting for new data models, migrations
  (both dialects!), and UI surface.
- 📋 = already in `FUTURE-WORK.md`; ✨ = net-new here.
- A ⚓ marks a **foundation** others depend on — build these first within their tier.

> **Verified against code (2026-06-07).** A spike of the ingest path + data model confirmed the
> core assumptions and corrected three items — see "Spike findings" below the scorecard. Effort
> ratings reflect those findings.

---

## The one-screen scorecard

| # | Improvement | Value | Effort | Tier | Depends on |
|---|-------------|:-----:|:------:|:----:|------------|
| F1 | ⚓ Per-test history + cross-run search 📋(#3) | ★★★★★ | M–L | 1 | run metadata ✅ |
| F2 | Known-issues / mute / categorization 📋(#4) | ★★★★★ | M | 1 | — |
| F0 | ⚓ Capture error message/trace on ingest ✨ | ★★★★☆ | S–M | 1 | — |
| F3 | Auto failure clustering by error signature ✨ | ★★★★☆ | M | 1 | F0 |
| F4 | First-failed / last-passed bisect hint ✨ | ★★★★☆ | S | 1 | F1 |
| F5 | Flaky-test quarantine lifecycle ✨ | ★★★★☆ | M | 1 | F1 |
| O1 | ⚓ Retention & quotas (auto-prune, caps) 📋 | ★★★★★ | M | 0 | reconciler exists |
| O2 | Observability: /metrics, health/readiness, logs 📋 | ★★★★☆ | S–M | 0 | — |
| O3 | Ingest idempotency (crash-safe already exists) ✨ | ★★★★☆ | S–M | 0 | — |
| O4 | Login rate-limiting 📋 | ★★★☆☆ | S | 0 | — |
| C1 | Language-agnostic CLI + GitLab/Jenkins/Azure recipes 📋(#5) | ★★★★★ | M | 2 | — |
| C2 | Rich PR comment (new-fail/new-pass/flaky diff) ✨ | ★★★★☆ | S–M | 2 | compare exists |
| C3 | Branch/PR-scoped trend deltas ✨ | ★★★☆☆ | S–M | 2 | run metadata ✅ |
| S1 | ⚓ Launches: sharded/parallel run aggregation 📋(#6) | ★★★★★ | L | 3 | — |
| S2 | Retry/attempt merging ✨ | ★★★☆☆ | M | 3 | S1 |
| I1 | Jira: open/link ticket from a failure 📋 | ★★★★☆ | M–L | 4 | F2 |
| I2 | Email/SMTP notifications 📋 | ★★★☆☆ | S–M | 4 | — |
| I3 | Digest vs real-time notification modes ✨ | ★★★☆☆ | M | 4 | — |
| I4 | Shareable read-only links w/ expiry 📋 | ★★★☆☆ | S–M | 4 | visibility ✅ |
| A1 | Slowest-tests & duration-regression report ✨ | ★★★★☆ | S–M | 2 | test data exists |
| A2 | Tag/label analytics (epic/feature/severity) ✨ | ★★★☆☆ | M | 4 | — |
| A3 | Ownership / CODEOWNERS routing ✨ | ★★★☆☆ | M | 4 | — |
| A4 | Time-to-green / MTTR metric ✨ | ★★★☆☆ | S | 5 | F1 |
| X1 | LLM failure summarizer (opt-in, BYO-key) ✨ | ★★★★☆ | M | 5 | F1, F3 |

---

## Spike findings (2026-06-07) — assumptions checked against code

Read: `db/schema.{sqlite,pg}.ts`, `db/test-results-repo.ts`, `shared/contracts.ts`,
`routes/compare.ts`, `compare.ts`, `reconcile.ts`, `runtime.ts`.

- **F1 is sound.** `test_results` already persists `historyId`, `fullName`, `duration`, `status`,
  `flaky`; `replaceForRun` deletes only the *current* run's rows, so cross-run history accumulates
  for free. Only gap: indexes cover `run_id` only — F1 must add a `history_id` (and/or `full_name`)
  index in **both** dialect schemas + regenerate migrations.
- **F0 surfaced as a new prerequisite.** Error message/trace is **not stored** anywhere
  (`test_results` has no `message`/`trace`; `TestSummary` has no error field). Any
  signature-based clustering (F3), error-search (part of F1), or LLM summary (X1) needs F0 first:
  capture error text during generation → new column (both dialects) + contract field.
- **F4 is cheaper than first rated (S, not S–M).** Status-only bisect needs just status history
  (exists) + run metadata (exists ✅) — no F0 dependency. Ship it early.
- **C2 confirmed cheap.** `compareRuns` already yields the base↔target test diff; C2 is formatting
  + a comment hook.
- **A1 confirmed cheap.** Durations are stored; it's analytics + a table.
- **O3 is half-done.** `reconcileStale`/`startReconciler` already fail runs stuck in `generating`.
  Remaining O3 scope is just ingest idempotency (dedup repeated `send-results`).

---

## Sequencing — five tiers + a parallel ops track

### Tier 0 — Production hardening *(parallel track, do continuously)*
Unglamorous, but nobody runs this seriously without it. These don't block the feature tiers
and can be picked up between slices.

- **O1 Retention & quotas** ⚓ — disk grows forever otherwise. Extend the existing
  `startReconciler` sweeper: per-project run/age caps, artifact pruning, storage-cap enforcement.
- **O2 Observability** — Prometheus `/metrics` (ingest rate, queue depth, generation latency,
  failures), `/healthz` + `/readyz`, structured request logs. Needed the day it's multi-replica.
- **O3 Ingest idempotency + crash-safe generation** — content-addressed dedup of repeated
  `send-results`; a run stuck in `generating` after a worker crash must be reclaimable (the
  reconciler already half-does this — make it explicit and tested).
- **O4 Login rate-limiting** — bounds `login_failed` audit growth + brute force.

### Tier 1 — Triage intelligence *(the adoption engine — highest ROI)*
This is where automation engineers live. Ship this tier and the product becomes *sticky*.

0. **F0 Capture error message/trace on ingest** ⚓ — new `message`/`trace` column (both dialects)
   + `TestSummary` field, populated in generation. Small, but unblocks F3, error-search, and X1.
   *Status-only features (F1 timeline, F4) don't need it — sequence F0 alongside, not before, them.*
1. **F1 Per-test history + cross-run search** ⚓ — add a `history_id`/`full_name` index;
   endpoints for name/status/error search and a single test's pass/fail timeline + flake rate;
   a test-detail UI. **Everything else in this tier (and A4, X1) leans on it.**
2. **F2 Known-issues / mute / categorization** — per-project rules (match by test id / error
   signature) with mute + ticket link; gate evaluation skips muted; annotations in run/compare.
   *Can start in parallel with F1 — independent data.*
3. **F3 Auto failure clustering** *(needs F0)* — normalize stack/assertion text (strip line
   numbers, hex, UUIDs, timestamps) into stable signatures; group a run's failures into
   "N failures → K causes." Feeds F2 (bulk-categorize a cluster) and X1.
4. **F4 First-failed bisect hint** — "started failing at commit `abc` (run #481)" with CI link.
   Status-only, so independent of F0; cheap once F1 exists; answers the #1 triage question.
5. **F5 Flaky quarantine lifecycle** — detect (pass-after-retry / alternating across runs),
   propose quarantine, track quarantine age, auto-unmute after N greens, a "flaky debt" view.

### Tier 2 — CI breadth & PR feedback *(unblock non-GitHub shops; close the loop)*
- **C1 Language-agnostic CLI** ⚓ — `upload → generate → poll`, reads token + metadata from env;
  documented GitLab/Jenkins/Azure recipes. Biggest reach-expander in the doc.
- **C2 Rich PR comment** — surface the comparison you already compute as a diff comment:
  *newly failed / newly passed / still failing / flaky*. Low effort, high reviewer value.
- **C3 Branch/PR-scoped trend deltas** — "this PR vs `main`." Unblocked by run metadata (✅).
- **A1 Slowest-tests & duration regression** — data already exists; pure analytics + UI. Quick win.

### Tier 3 — Scale *(matches how suites actually run in CI)*
- **S1 Launches / shard aggregation** ⚓ — an *open* run accepts multiple `send-results` keyed by
  a `launchId`, *sealed* before generation → one report + one stats set for an N-shard matrix.
  Biggest data-model change in the doc; sequence it after Tier 1 so triage views already
  understand aggregated runs.
- **S2 Retry/attempt merging** — merge CI retries into one test with attempt history.

### Tier 4 — Collaboration & integrations
- **I1 Jira** — open/link a ticket from a failure with context auto-attached (pairs with F2).
- **I2 Email/SMTP**, **I3 digest mode**, **I4 shareable links**, **A2 tag analytics**,
  **A3 ownership routing** — breadth features; pick by what your users ask for.

### Tier 5 — AI-assisted & advanced
- **X1 LLM failure summarizer** — opt-in, BYO-key: reads stack + diff + history, proposes
  cause (product bug / flake / env) and a category. Natural successor to F2+F3, not a prerequisite.
- **A4 MTTR / time-to-green** — a real team-health KPI once F1 history exists.

---

## Quick wins (high value / low effort — pull forward opportunistically)

- **C2 Rich PR comment** — comparison logic already exists; mostly formatting + the comment hook.
- **A1 Slowest-tests report** — durations are already stored; analytics + a table.
- **O4 Login rate-limiting** — small, security-positive.
- **F4 Bisect hint** — small *once F1 lands*; outsized triage payoff.

## What I'd deliberately defer (YAGNI / niche)

- **OpenTelemetry / test-trace export** — interesting, but niche until someone asks; M–L effort.
- **Per-user @mention-a-test watches** — nice, but digest mode (I3) covers most of the need.
- **Semantic (embedding) failure grouping** — F3's signature clustering gets ~80% for ~20% cost.
- **ML auto-analysis** of failures — superseded by X1's LLM approach; don't build bespoke ML.

---

## Recommended first three slices

1. **F1 Per-test history** — the foundation that unlocks the whole triage tier (F4, F5, A4, X1).
2. **O1 Retention & quotas** — the prod blocker; runs on the parallel ops track.
3. **C1 CLI + CI recipes** — the reach-expander that gets non-GitHub teams onboard.

Each is a self-contained slice that can go through the normal **spec → plan → implementation**
cycle. Pick one and I'll brainstorm it into a design.
