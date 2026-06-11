# Allure Station — End‑User Guide

A hands‑on, screenshot‑by‑screenshot walkthrough of **every feature** in Allure Station, from
opening the UI to wiring up CI tokens, quality gates, notifications, and access control.

This guide assumes the service is **already running on `http://localhost:5050`** (the zero‑config
Docker single‑container setup). If it isn't up yet, jump to
[Appendix A — Bring it up](#appendix-a--bring-it-up) and come back.

> The screenshots below were captured against a demo project named **`demo-web`** with two real
> runs generated from the
> [kotest‑examples‑allure](https://github.com/kotest/kotest-examples-allure) project's Allure
> output (8 Kotlin/Kotest tests) — a green baseline (`commit a1b2c3d`) followed by a run where one
> test (`SquareTest / positive square`) was made to fail (`commit e4f5a6b`). That single regression
> is what lights up Compare, per‑test history, and the "failing since" hint throughout the guide.
> [Reproduce the exact dataset](#appendix-c--reproduce-the-demo-dataset).

---

## Contents

1. [The 60‑second mental model](#1-the-60second-mental-model)
2. [Open the UI — the projects list](#2-open-the-ui--the-projects-list)
3. [Create a project](#3-create-a-project)
4. [Push results & generate a report](#4-push-results--generate-a-report)
5. [Read a report — the project page](#5-read-a-report--the-project-page)
6. [Compare two runs](#6-compare-two-runs)
7. [Per‑test history & the regression "failing since" hint](#7-pertest-history--the-regression-failing-since-hint)
8. [Trends](#8-trends)
9. [Quality gates & the status badge](#9-quality-gates--the-status-badge)
10. [CI tokens (securing writes)](#10-ci-tokens-securing-writes)
11. [Notifications (Slack / webhook)](#11-notifications-slack--webhook)
12. [Turn on accounts & sign in](#12-turn-on-accounts--sign-in)
13. [Project settings — visibility, quality gate, tokens, notifications, members, audit](#13-project-settings--visibility-quality-gate-tokens-notifications-members-audit)
14. [Admin — users & the global audit log](#14-admin--users--the-global-audit-log)
15. [Appendices](#appendix-a--bring-it-up) — bring it up · manage the container · reproduce data · API reference · troubleshooting

---

## 1. The 60‑second mental model

Three nouns explain the whole product:

- **Project** — a logical app/suite (e.g. `demo-web`). Reports are grouped under it. Created once.
- **Run** — one execution's results pushed by CI. A run goes `pending → generating → ready` (or `failed`).
- **Report** — the embedded **Allure 3** report a run produces, served right inside the UI.

The data flow is always the same two steps:

```
send-results  →  stages raw Allure files under a NEW pending run
generate      →  worker builds the Allure report → run becomes "ready"
```

Everything else (trends, compare, per‑test history, quality gates, badges, notifications) is computed
**on top of** those ready runs.

**Access model — secure by default, open in dev.** With no tokens and no accounts, the instance is
fully open so you can try it instantly. The moment you add a CI token or an admin account, writes
start requiring credentials. Reads stay public unless you mark a project private. We exercise both
modes in this guide — the open mode first (steps 2–11), then accounts (steps 12–14).

---

## 2. Open the UI — the projects list

Browse to **http://localhost:5050**. The landing page is the **projects list**: a searchable grid of
cards, each showing the project id, its latest pass ratio, and a pass‑rate sparkline.

![Projects list](images/01-projects-list.png)

The ring on the card (`88%`) and the line under it (`7/8 passed · 1m ago`) are the at‑a‑glance health
of the project's latest run. Click a card to open the project. The top bar has theme toggles
(System / Light / Dark) and a **Sign in** button (used in [step 12](#12-turn-on-accounts--sign-in)).

---

## 3. Create a project

Click **New project** (top‑right). Give it a unique id — this is the id CI will push to. Names are
lowercase‑ish slugs (`my-service`, `demo-web`). Optionally add a **Display name** (e.g. "Demo Web
App") — it shows on the card and in breadcrumbs instead of the raw id, making projects easier to
scan when you have many.

![Create project dialog](images/02-create-project-dialog.png)

The same thing over the API (this is what CI or a script would do):

```bash
curl -XPOST localhost:5050/api/projects \
  -H 'content-type: application/json' \
  -d '{"id":"demo-web","displayName":"Demo Web App"}'
```

To rename a project later, use `PATCH /api/projects/:id` (`{"displayName":"New Name"}`); set it
to `null` to revert to the id. Project ids are immutable once created.

A project starts empty and **public**, with no runs.

---

## 4. Push results & generate a report

A "run" is created by uploading your Allure result files, then asking the server to generate the
report. Allure result files are the `*-result.json` / `*-container.json` (and attachment) files that
any Allure adapter emits — Pytest, Jest, JUnit, Playwright, kotest, etc.

### 4a. From the command line (how CI does it)

```bash
API=localhost:5050/api

# 1) Upload the result files. Returns 202 with a runId. You can attach CI metadata
#    (branch / commit / environment / ciUrl) as plain form fields — these power the
#    branch filter, the run labels, and the regression hint's commit SHAs.
RID=$(curl -s -XPOST $API/projects/demo-web/send-results \
        $(for f in ./allure-results/*; do echo -n " -F files=@$f"; done) \
        -F branch=main -F commit=a1b2c3d4 -F environment=staging \
      | jq -r .runId)

# 2) Generate the report for that specific run (async → 202 Accepted).
curl -XPOST "$API/projects/demo-web/generate?runId=$RID"

# 3) (optional) Poll until the run is ready.
curl -s "$API/projects/demo-web/runs/$RID" | jq '{status}'
```

`send-results` always stages files under a **brand‑new** pending run, so concurrent uploads never
collide. `generate?runId=…` claims that exact run. Omit `runId` to generate the most recent pending
run. The endpoint returns immediately (202) — generation runs in a worker and the UI updates live.

> The `github-action/` folder in the repo wraps these calls (upload → generate → optional gate) into a
> reusable GitHub Action, with GitLab and Jenkins recipes too.

### 4b. From the UI

Inside a project, click **Upload & generate**, pick your result files, then optionally expand the
**Add CI context (optional)** section to fill in Branch, Commit, Environment, and CI build URL.
These fields are **remembered per project** in your browser so repeat uploads are quick — just
change what differs.

![Upload results dialog](images/11-upload-dialog.png)

Either way, the run appears immediately as `generating` and flips to `ready` on its own (the page
streams progress over SSE — no refresh required).

If generation **fails** (e.g. a malformed result set), the run turns `failed` and the project page
shows the captured **error** with a **Retry generation** button — one click re-runs generation against
the results you already uploaded, no re-push needed. (`POST …/runs/:runId/retry` does the same over the
API.)

---

## 5. Read a report — the project page

Open the project. This is the cockpit you'll spend most of your time in.

![Project page overview](images/03-project-overview.png)

Top to bottom:

- **Breadcrumb + run controls** — `Projects / demo-web` (showing the display name when set), a
  **branch filter** (`all branches`), a **run selector** (every run, newest first, labelled with a
  friendly relative time — `3m ago — ready (7/8) — main@e4f5a6b · staging`; hover any option for
  the exact timestamp), and the **Upload & generate** button.
- **Run status header** — `Ready · 7/8 passed · 1 failed · 65.4s`, plus the run's `branch main@e4f5a6b`
  and `env staging` chips (these come from the metadata you sent in step 4). If a
  [quality gate](#9-quality-gates--the-status-badge) is configured, a **Quality gate passed/failed**
  badge appears here too — and on failure it names the rules that tripped (e.g.
  *failures 1 > 0, pass rate 87.5% < 95%*). A **Copy link** button produces a shareable URL that
  encodes the selected run (`?run=`) and the open test (`#report=`), so teammates land on exactly
  what you're looking at.
- **Trend** card (left) and **Compare** card (right) — covered in steps 6–8. The Trend card shows
  an empty‑state hint ("Trends appear after 2 successful runs…") until at least two ready runs exist.
- **Report | Runs tabs** — the lower half of the page has two tabs:
  - **Report** — the embedded Allure 3 report (full official UI, served inline).
  - **Runs** — a paginated table of every run for this project with status, pass/fail stats, gate
    verdict, branch, environment, duration, and age. Filter by status (`all` / `ready` / `failed` /
    `generating`). Each row has three actions: **Open** (switch to the Report tab for that run),
    **Retry** (re-run generation without re-uploading — only on failed runs), and **Delete**
    (permanently removes the run, its report, and its history contribution; guarded by a confirm
    dialog; disabled while a run is generating).

![Runs tab — filterable run table with gate verdicts and per-run actions](images/13-runs-tab.png)

### Drill into a test

Click any test in the report tree. Here's the failing `positive square` — Allure shows the status,
the test body steps, attachments, and the **assertion error + full stack trace**:

![Allure report — failing test detail](images/04-allure-report-test-detail.png)

This is per‑run detail. For the same test's behavior **across runs**, use per‑test history (step 7).

---

## 6. Compare two runs

The **Compare** card (top‑right of the project page) diffs any two runs. Pick a **base** and a
**target** from the dropdowns; the diff is bucketed into mutually‑exclusive groups:

- **Newly failing** — passed in base, failing in target (regressions) ← the one to watch
- **Fixed** — failing in base, passing in target
- **Still failing**, **Added**, **Removed**, and a cross‑cutting **Flaky** annotation

In our demo, comparing the green baseline → the regression run shows exactly one entry:

> **Newly failing (1)** — `positive square` *(passed→failed)*

Each row carries a labelled **🕘 History** control that opens the per‑test history drawer — that's
step 7. (The label was added so the regression timeline is discoverable, not hidden behind a bare icon.)

---

## 7. Per‑test history & the regression "failing since" hint

Click the **🕘 History** control next to any test (in the Compare card, or from a report row). A drawer
slides in with that test's timeline across all ready runs:

![Per-test history drawer with regression hint](images/05-test-history-regression-hint.png)

What you get:

- **Flake rate** — `Flaky 0% over 2 runs` (how often it flipped within the window).
- **The regression bisect hint** — the red line:
  **"Failing since 5m ago · `e4f5a6b` — last passed 6m ago"**. This pinpoints the *first run where the
  test started failing* and the *last run it passed* — i.e. the commit window the regression was
  introduced in. No more manually scanning runs to find when something broke.
- **The timeline** — one entry per run (newest first) with status, relative time (hover for the exact
  timestamp), commit SHA, and the failure message.

Expand **▸ Stack trace** on any failing entry to read the full trace inline:

![History drawer — stack trace expanded](images/06-test-history-trace-expanded.png)

> The hint honors a window (the last N runs). If the test was already failing at the very start of the
> window, the UI says so honestly rather than guessing ("failing since the start of the window").

---

## 8. Trends

The **Trend** card (top‑left of the project page) plots pass‑rate, flakiness, and duration across
runs as a compact sparkline. Hover any bar for that run's exact numbers (e.g.
`10/06/2026, 20:57:49 · 7/8 passed, 1 failed, 0 broken · 65.4s total`). It's the fastest way to spot a slide in
health or a creeping slowdown over time. The raw series is also available at
`GET /api/projects/demo-web/trends`.

---

## 9. Quality gates & the status badge

A **quality gate** turns "is this run acceptable?" into a yes/no, so CI can block on it and the badge
can reflect it. Configure thresholds per project (any subset):

| Rule | Meaning |
|---|---|
| `maxFailures` | Fail the gate if failures exceed this count. |
| `minTests` | Fail if fewer than this many tests ran (catches "0 tests" false‑greens). |
| `minPassRate` | Minimum pass ratio, **0–1** (e.g. `0.95` = 95%). |
| `maxDurationMs` | Fail if the run took longer than this. |

```bash
# Set a gate: zero failures allowed, ≥95% pass rate
curl -XPUT localhost:5050/api/projects/demo-web/quality-gate \
  -H 'content-type: application/json' \
  -d '{"maxFailures":0,"minPassRate":0.95}'
```

Prefer clicking? Once you're signed in, the **Quality gate** card on the project
[Settings page](#13-project-settings--visibility-quality-gate-tokens-notifications-members-audit)
exposes the same four rules as a form — note the UI takes **min pass rate as a percent** (`95`, not
`0.95`) and **max duration in seconds** (not milliseconds). Leave a field blank to disable that rule.

The verdict is attached to each run's summary **and surfaced in the project page's run header** as a
green *Quality gate passed* or red *Quality gate failed* badge (the failed badge spells out which rules
tripped). For our regression run it correctly **fails**:

```jsonc
// GET /api/projects/demo-web/runs/<runId>/summary  → .qualityGate
{
  "configured": true,
  "passed": false,
  "checks": [
    { "rule": "maxFailures",  "actual": 1,     "threshold": 0,    "ok": false },
    { "rule": "minPassRate",  "actual": 0.875, "threshold": 0.95, "ok": false }
  ]
}
```

### The badge

Every project exposes an SVG status badge for your README/dashboards — no auth needed:

```
http://localhost:5050/api/projects/demo-web/badge.svg
```

![Status badge](images/12-badge.png)

```markdown
![tests](http://localhost:5050/api/projects/demo-web/badge.svg)
```

No need to hand-write that: the **Status badge** card on the project
[Settings page](#13-project-settings--visibility-quality-gate-tokens-notifications-members-audit)
shows a live preview plus a one-click **Copy** of the ready-to-paste markdown.

---

## 10. CI tokens (securing writes)

A fresh project is **open for writes**. The moment you mint a token for it, writes to that project
require a token — that's how you lock CI ingestion down without standing up full user accounts.

```bash
curl -XPOST localhost:5050/api/projects/demo-web/tokens \
  -H 'content-type: application/json' \
  -d '{"name":"ci-pipeline"}'
```

```jsonc
{
  "id": "-e0U5ETOrx8y",
  "projectId": "demo-web",
  "name": "ci-pipeline",
  "prefix": "ast_aYEhCrPl",
  "createdAt": "2026-06-08T13:58:39.770Z",
  "lastUsedAt": null,
  "token": "ast_aYEhCrPlK83zOQeSSTTn4N9fKBZcUIgt"   // ← shown ONCE, store it now
}
```

The plaintext `token` is shown **only in this response** (only its sha256 hash is stored). Use it from
CI as a bearer token:

```bash
curl -XPOST $API/projects/demo-web/send-results \
  -H "authorization: Bearer ast_aYEhCrPlK83zOQeSSTTn4N9fKBZcUIgt" \
  -F files=@allure-results/foo-result.json
```

Tokens are **scoped to one project** — a token for `demo-web` can never write to another project.
List/revoke them via `GET` / `DELETE /api/projects/:id/tokens`.

The same lives in the UI: the **CI tokens** card on the project
[Settings page](#13-project-settings--visibility-quality-gate-tokens-notifications-members-audit)
lists existing tokens (name, prefix, last‑used) and lets you create or revoke them. A freshly created
token is **revealed exactly once** with a one‑click **Copy** — dismiss it and only the hash remains.

---

## 11. Notifications (Slack / webhook)

Get pinged when runs finish, fail, trip the gate, or regress. Register a notification per project:

```bash
curl -XPOST localhost:5050/api/projects/demo-web/notifications \
  -H 'content-type: application/json' \
  -d '{
        "kind": "webhook",
        "url": "https://example.com/hooks/allure",
        "events": ["failed", "gate_failed", "regression"]
      }'
```

- **`kind`** — `webhook` or `slack`.
- **`events`** — any of `completed`, `failed`, `gate_failed`, `regression`.

Delivery is **best‑effort** and never blocks or breaks report generation. Outbound URLs are validated
by an SSRF guard (must be http(s); loopback / private / link‑local addresses are rejected).

In the UI, the **Notifications** card on the project
[Settings page](#13-project-settings--visibility-quality-gate-tokens-notifications-members-audit)
does the same: pick the kind (`webhook`/`slack`), paste the URL, tick the event checkboxes
(`completed` · `failed` · `gate_failed` · `regression`), and add it. Each listed hook has a **Test**
button that delivers a one-off message right then — so you can confirm it works before relying on it —
and a **Remove** button. (`POST …/notifications/:id/test` does the same over the API, returning the
delivery result.)

---

## 12. Turn on accounts & sign in

So far everything used the open, zero‑config mode. To use **human accounts, RBAC, project settings,
and the admin screens**, seed an admin by setting `ADMIN_EMAIL` and `ADMIN_PASSWORD` and restarting.
With Docker Compose, add an `environment:` block to the `allure-station` service:

```yaml
# docker/docker-compose.yml
services:
  allure-station:
    # …
    environment:
      ADMIN_EMAIL: admin@example.com
      ADMIN_PASSWORD: a-strong-password   # ≥ 8 chars
```

```bash
docker compose -f docker/docker-compose.yml up -d   # recreate; the named volume keeps all your data
```

Now `GET /api/config` reports `"securityEnabled": true`. Click **Sign in** (or visit `/login`):

![Login page](images/07-login.png)

Sign in with the admin email/password. Email/password is always available; SSO appears here too if
OIDC is configured (`OIDC_*` env vars — auth‑code + PKCE, first‑time users auto‑provisioned by verified
email). After signing in, the sidebar gains **Users** and **Audit**, and your account shows bottom‑left.

> Rotating `ADMIN_PASSWORD` and restarting re‑sets the admin's password (it's an idempotent upsert) —
> a simple recovery path.

---

## 13. Project settings — visibility, quality gate, tokens, notifications, members, audit

Once you're signed in, a **settings** link (⚙) appears on the project page. The page gathers
everything you've configured by hand above into one place:

![Project settings](images/08-project-settings.png)

- **Visibility** — `public` (default) or **private**. Private gates *reads* to `viewer+` members (the
  badge stays public). Public projects are world‑readable; tokens/RBAC protect *integrity*, not
  confidentiality, unless you flip this.
- **Status badge** — a live preview of the project's [badge](#the-badge) and a one‑click copy of the
  markdown snippet for your README.
- **Quality gate** — the four‑rule form from [step 9](#9-quality-gates--the-status-badge)
  (pass rate as a **percent**, duration in **seconds**; blank = disabled).
- **CI tokens** — create/list/revoke project tokens from [step 10](#10-ci-tokens-securing-writes); a new
  token is shown once with a **Copy** button.
- **Notifications** — add/list/remove the Slack & webhook hooks from
  [step 11](#11-notifications-slack--webhook).
- **Members** — grant people per‑project roles: **viewer** (read private), **maintainer** (push/generate
  without a token), **owner** (manage members & tokens). Add by email + role.
- **Audit** — the project‑scoped slice of the audit log (who did what, when).
- **Danger zone** — permanently delete the project (and all its runs, reports, tokens, and settings).
  Guarded by a type‑the‑id confirmation; needs `owner`/admin (or open mode).

**Honest gating** — the page shows only what your context allows, and tells you why:

| You are… | What you see |
|---|---|
| In **open mode** (no accounts) | All functional cards work, topped by an *"Open mode — anyone can manage this project"* banner. Members/Audit are gated with a note to set `ADMIN_EMAIL`/`ADMIN_PASSWORD`. |
| **Security on, not signed in** | A *"Sign in to manage this project's settings"* prompt. |
| **Signed in, not owner/admin** (limited) | Visibility, gate, tokens, notifications work; Members/Audit are gated with a *"you need owner/admin"* note. |
| **Signed in as owner/admin** (manage) | Everything, including Members and Audit. |

**Role cheat‑sheet:** writes need `maintainer+` *or* a token · member/token management needs `owner` or
a global `admin` · global `admin` can do everything everywhere.

---

## 14. Admin — users & the global audit log

These two live in the sidebar and require a global **admin**.

**Users** (`/users`) — create accounts (email + password, role `user` or `admin`), see everyone, and
delete users.

![Users admin](images/09-users-admin.png)

**Audit** (`/audit`) — the append‑only, instance‑wide audit trail: timestamp, actor (a user or
`anonymous`/a token), action, target, project, and a details blob. Paginated. This is your
"who changed what" record for logins, project creation, membership changes, token mints, and more.

![Global audit log](images/10-audit-log.png)

---

You've now touched **every feature**: projects, ingest, the embedded report, compare, per‑test history
with the regression hint, trends, quality gates, badges, CI tokens, notifications, auth/RBAC, settings,
and the admin/audit surface. 🎉

---

# Appendices

## Appendix A — Bring it up

Prerequisite: Docker. From the repo root:

```bash
docker compose -f docker/docker-compose.yml up -d --build
```

The service listens on **`:5050`**, serving the API under `/api` and the UI at `/`. Data persists in
the `allure-data` Docker volume (SQLite + local filesystem, zero‑config). First build takes a few
minutes; later starts are instant.

Or run the published image without cloning:

```bash
docker run -p 5050:5050 -v allure-data:/data ghcr.io/qasecret/allure-station:1
```

Verify:

```bash
curl -s localhost:5050/api/config      # {"securityEnabled":false,...}
curl -s localhost:5050/api/projects    # []   (empty until you create one)
```

## Appendix B — Manage the container

```bash
# tail logs
docker compose -f docker/docker-compose.yml logs -f allure-station

# stop (KEEPS the volume and all your data)
docker compose -f docker/docker-compose.yml down

# stop AND wipe all data (projects, runs, reports)
docker compose -f docker/docker-compose.yml down -v
```

## Appendix C — Reproduce the demo dataset

The exact two‑run dataset behind this guide (green baseline → one‑test regression), so your screens
match. You need any Allure result directory; we use the
[kotest‑examples‑allure](https://github.com/kotest/kotest-examples-allure) sample project (8 tests,
Java 11+ required for the Gradle build):

**Step 0 — produce the result files** (skip if you already have an `allure-results` dir from your
own test run):

```bash
git clone https://github.com/kotest/kotest-examples-allure.git
cd kotest-examples-allure
./gradlew check        # runs the Kotest suite → writes build/allure-results/
```

**Step 1 — push the green baseline** (run 1):

```bash
API=localhost:5050/api
SRC=./build/allure-results           # the directory produced by step 0

curl -XPOST $API/projects -H 'content-type: application/json' -d '{"id":"demo-web","name":"Demo Web App"}'

R1=$(curl -s -XPOST $API/projects/demo-web/send-results \
       $(for f in "$SRC"/*; do echo -n " -F files=@$f"; done) \
       -F branch=main -F commit=a1b2c3d4 -F environment=staging | jq -r .runId)
curl -XPOST "$API/projects/demo-web/generate?runId=$R1"
```

**Step 2 — create the regression** (run 2): copy the result files and flip the
`SquareTest / positive square` test to `failed` with a realistic assertion message + stack trace:

```bash
cp -r "$SRC" /tmp/run2-results

python3 - <<'EOF'
import glob, json
for p in glob.glob('/tmp/run2-results/*-result.json'):
    d = json.load(open(p))
    if d.get('name') == 'positive square':          # the test we break
        d['status'] = 'failed'
        d['statusDetails'] = {
            'message': 'expected:<16> but was:<15>',
            'trace': 'java.lang.AssertionError: expected:<16> but was:<15>\n'
                     '\tat com.sksamuel.kotest.example.allure.SquareTest$1$1.invokeSuspend(SquareTest.kt:12)\n'
                     '\tat io.kotest.core.spec.style.scopes.FunSpecRootContext.test(FunSpecRootContext.kt:84)\n'
                     '\tat io.kotest.engine.test.TestCaseExecutor.execute(TestCaseExecutor.kt:62)',
        }
        json.dump(d, open(p, 'w'))
        print('flipped:', p)
EOF
```

**Step 3 — push the regression under a new commit:**

```bash
R2=$(curl -s -XPOST $API/projects/demo-web/send-results \
       $(for f in /tmp/run2-results/*; do echo -n " -F files=@$f"; done) \
       -F branch=main -F commit=e4f5a6b7 -F environment=staging | jq -r .runId)
curl -XPOST "$API/projects/demo-web/generate?runId=$R2"
```

Open **http://localhost:5050/projects/demo-web** — you should see `7/8 passed · 1 failed`, the
Compare card reporting **Newly failing (1)**, and the history drawer's *failing since* hint, exactly
as in the screenshots. (With the step‑9 quality gate configured, the run header also shows
**Quality gate failed**.)

To remove the demo afterwards: `curl -XDELETE localhost:5050/api/projects/demo-web`
(needs admin/owner once security is on).

## Appendix D — API reference (used in this guide)

All endpoints are under `/api`. Reads are public; writes follow the access model above.

| Area | Endpoints |
|---|---|
| Projects | `GET/POST /projects` · `GET/DELETE /projects/:id` · `PATCH /projects/:id` (rename — body `{"displayName":"…"│null}`) · `PUT /projects/:id/visibility` |
| Results | `POST /projects/:id/send-results` · `POST /projects/:id/generate[?runId=]` · `POST …/runs/:runId/retry` |
| Runs & report | `GET /projects/:id/runs[?status=&limit=&offset=]` · `GET …/runs/:runId` · `DELETE …/runs/:runId` · `GET …/runs/:runId/report/*` · `GET …/runs/:runId/summary` |
| Analytics | `GET /projects/:id/trends` · `GET /projects/:id/compare?base=&target=` · `GET /projects/:id/tests/history?fullName=|historyId=` · `GET /projects/:id/events` (SSE) · `GET /projects/:id/badge.svg` |
| Quality gate | `GET/PUT /projects/:id/quality-gate` |
| Tokens | `GET/POST /projects/:id/tokens` · `DELETE …/tokens/:tokenId` |
| Notifications | `GET/POST /projects/:id/notifications` · `POST …/:notificationId/test` · `DELETE …/:notificationId` |
| Auth | `POST /auth/login` · `POST /auth/logout` · `GET /auth/me` · `GET /auth/oidc/login` · `GET /auth/oidc/callback` |
| Admin | `GET/POST /users` · `DELETE /users/:id` · `GET/PUT/DELETE /projects/:id/members` · `GET /audit` · `GET /projects/:id/audit` |
| Meta | `GET /version` · `GET /config` |

## Appendix E — Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `POST /generate` → `409 no pending run` | You called generate without first uploading via `send-results`, or the run was already claimed. Upload first; pass the returned `runId`. |
| Run stuck on `generating` | Check `docker compose logs -f allure-station`. In the default single‑container mode the in‑process worker runs in the same container. |
| Compare dropdowns empty / no diff | Compare needs **two ready runs**. Push a second run. |
| History drawer / regression hint blank | Needs ≥ 2 ready runs of the *same test* (matched by Allure `historyId`, falling back to `fullName`). |
| `401 unauthorized` on writes after enabling security | Sign in (session cookie) or send a project token as `Authorization: Bearer <token>`. |
| "You don't have access to this project's settings" | Settings need `owner`/admin. Sign in as the seeded admin, or have an owner add you. |
| UI shows no **Sign in** effect | `GET /api/config` must report `securityEnabled:true`; that requires `ADMIN_EMAIL`+`ADMIN_PASSWORD` (or an existing account). |
