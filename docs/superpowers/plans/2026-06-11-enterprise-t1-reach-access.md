# Enterprise T1: Reach & Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make allure-station fully usable at 375px (fix the topbar action overflow, card-row tables, report full-screen) and establish an enforced accessibility baseline (inline a11y fixes + axe CI gate).

**Architecture:** Responsive retrofit inside the existing shell per `docs/superpowers/specs/2026-06-11-enterprise-t1-reach-access-design.md` (read it first — note the Correction block: the mobile drawer already exists in `Topbar.tsx`; the real bug is topbar action overflow). Each feature task carries its own e2e coverage TDD-style: write the spec assertions first, watch them fail, implement, watch them pass. Desktop (`md:`+) visuals must not change.

**Tech Stack:** React 18 + Tailwind v3 + shadcn/Radix (`packages/web`), Playwright e2e (`packages/e2e`), `@axe-core/playwright` (new dev-dependency).

**Verification commands:**
```bash
pnpm --filter @allure-station/web test && pnpm typecheck     # fast gate
rm -rf packages/e2e/.e2e-data && pnpm --filter @allure-station/e2e test:e2e   # full e2e
```
e2e facts: config `packages/e2e/playwright.config.ts` (boots the real server on :5099, `fullyParallel: false`); existing specs in `packages/e2e/tests/` (`smoke.spec.ts`, `ux-fixes.spec.ts`) show the create-project/upload helpers and fixture (`packages/e2e/fixtures/…-result.json`). Mirror their style.

---

### Task 1: Topbar mobile layout + project-header fixes (with mobile e2e)

**Files:**
- Create: `packages/e2e/tests/mobile.spec.ts`
- Modify: `packages/web/src/components/Topbar.tsx`
- Modify: `packages/web/src/pages/Project.tsx` (RunSelector width via prop or class; Upload label)
- Modify: `packages/web/src/components/RunSelector.tsx` (width class becomes responsive)
- Modify: `packages/web/src/components/UploadDialog.tsx` (trigger label shortens below sm)

- [ ] **Step 1: Write the failing e2e spec** — `packages/e2e/tests/mobile.spec.ts`. Reuse the helper conventions from `ux-fixes.spec.ts` (read it; it has project-creation + upload helpers — import or duplicate its small `createProject` helper per current suite style):

```ts
import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 375, height: 812 } });

// Helper mirrors ux-fixes.spec.ts — adapt if that file's helper differs.
async function createProjectWithRun(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New project" }).first().click();
  await page.getByLabel("Project id").fill("mobile-e2e");
  await page.getByRole("button", { name: "Create" }).click();
  await page.getByText("mobile-e2e").first().click();
  await page.getByRole("button", { name: /Upload/ }).click();
  await page.locator('input[type="file"]').setInputFiles("fixtures/00000000-0000-0000-0000-000000000001-result.json");
  await page.getByRole("button", { name: /Upload & generate/ }).last().click();
  await expect(page.getByText("Ready").first()).toBeVisible({ timeout: 60_000 });
}

test("mobile: drawer navigates and topbar controls stay tappable", async ({ page }) => {
  await createProjectWithRun(page);

  // every topbar control fully inside the viewport
  for (const name of ["Open menu", /Upload/]) {
    const el = page.getByRole("button", { name }).first();
    const box = await el.boundingBox();
    expect(box, `button ${String(name)} should be on screen`).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
  }
  const selector = page.getByLabel("Select run to view");
  const sbox = await selector.boundingBox();
  expect(sbox!.x + sbox!.width).toBeLessThanOrEqual(375);

  // no horizontal page overflow
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // drawer opens and shows nav
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByRole("link", { name: "Projects" })).toBeVisible();
  await page.keyboard.press("Escape");
});
```

Note the fixture path: Playwright resolves relative to the test file's package CWD — check how `ux-fixes.spec.ts` references the fixture and copy that exact form.

- [ ] **Step 2: Run to verify failure**

Run: `rm -rf packages/e2e/.e2e-data && pnpm --filter @allure-station/e2e test:e2e -- mobile.spec.ts`
(Args after `--` reach playwright; if the script doesn't forward args, run `pnpm --filter @allure-station/e2e exec playwright test mobile.spec.ts`.)
Expected: FAIL — Upload button boundingBox x+width > 375 (it currently renders at x≈542).

- [ ] **Step 3: Make the Topbar stack on mobile** — `packages/web/src/components/Topbar.tsx`, replace the header layout (keep the Sheet block exactly as is):

```tsx
export function Topbar({ title, actions }: { title: ReactNode; actions?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 flex min-h-16 flex-wrap items-center gap-x-3 gap-y-2 border-b bg-background/80 px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur md:flex-nowrap md:px-6">
      {/* hamburger + Sheet block — unchanged */}
      <div className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight">{title}</div>
      <div className="flex w-full min-w-0 flex-wrap items-center gap-2 md:w-auto md:flex-nowrap">{actions}</div>
    </header>
  );
}
```
Mechanics: below `md` the actions div is `w-full` so it wraps to its own row(s) under the title; `flex-wrap` lets individual controls wrap further. At `md:`+ everything is one row exactly as today (`md:w-auto md:flex-nowrap`). Title keeps `flex-1 truncate` so it never collapses to zero on mobile (it owns row 1 with the hamburger).

- [ ] **Step 4: Cap the run selector width on mobile** — `packages/web/src/components/RunSelector.tsx`: change the trigger class `w-[320px] max-w-full` to `w-full max-w-full md:w-[320px]`.

- [ ] **Step 5: Shorten the upload trigger below sm** — `packages/web/src/components/UploadDialog.tsx`, the DialogTrigger button:

```tsx
      <DialogTrigger asChild>
        <Button>
          <Upload className="size-4" />
          <span className="hidden sm:inline">Upload &amp; generate</span>
          <span className="sm:hidden">Upload</span>
        </Button>
      </DialogTrigger>
```
The dialog-internal submit button keeps its full label (the e2e helper clicks `.last()`).

- [ ] **Step 6: Run the spec to verify it passes**

Run: `pnpm --filter @allure-station/e2e exec playwright test mobile.spec.ts`
Expected: PASS. Also eyeball desktop: `pnpm --filter @allure-station/e2e exec playwright test` (all specs) — smoke/ux-fixes must still pass (they exercise desktop default viewport).

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "fix(web): topbar stacks on mobile — actions reachable at 375px"
```

---

### Task 2: Card rows below `sm` for runs / users / audit tables

**Files:**
- Modify: `packages/web/src/components/RunsTable.tsx`
- Modify: `packages/web/src/pages/Users.tsx`
- Modify: `packages/web/src/pages/Audit.tsx`
- Modify: `packages/e2e/tests/mobile.spec.ts` (append)

Decision locked here (spec deferred it): per-table conditional render — each table wraps its `<table>` container in `hidden sm:block` and adds a sibling `sm:hidden` stacked list. Three different row shapes don't justify a shared abstraction (YAGNI).

- [ ] **Step 1: Append the failing e2e assertions** to `mobile.spec.ts`:

```ts
test("mobile: runs tab renders card rows with reachable actions", async ({ page }) => {
  await page.goto("/projects/mobile-e2e"); // project from the previous test (fullyParallel:false, same DATA_DIR)
  await page.getByRole("tab", { name: "Runs" }).click();
  await expect(page.getByRole("table")).toBeHidden();           // table hidden below sm
  const open = page.getByRole("button", { name: "Open" }).first();
  await expect(open).toBeVisible();
  const box = await open.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(375);          // action on screen, not behind scroll
});
```
If test isolation makes reusing the project flaky (read how the suite handles state — `.e2e-data` persists within a run), create a fresh project in this test instead using the same helper.

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @allure-station/e2e exec playwright test mobile.spec.ts` → FAIL (table visible, Open button off-viewport behind the inner horizontal scroll).

- [ ] **Step 3: RunsTable card rows** — in `RunsTable.tsx`, wrap the existing table container div with `hidden sm:block` and add the mobile list before it (same data, same `verdict` computation, same action handlers — extract the row actions into a small local component so both renderings share them):

```tsx
function RowActions({ r, canWrite, onOpenRun, retry, setConfirming }: {
  r: Run; canWrite: boolean; onOpenRun: (id: string) => void;
  retry: { isPending: boolean; mutate: (id: string) => void };
  setConfirming: (r: Run) => void;
}) {
  return (
    <span className="flex justify-end gap-1">
      <Button size="sm" variant="outline" onClick={() => onOpenRun(r.id)}>Open</Button>
      {r.status === "failed" && canWrite && <Button size="sm" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate(r.id)}>Retry</Button>}
      {canWrite && <Button size="sm" variant="outline" className="text-status-fail" disabled={r.status === "generating"} onClick={() => setConfirming(r)}>Delete</Button>}
    </span>
  );
}
```
Replace the actions `<td>` content with `<RowActions r={r} … />`, then add the mobile list (immediately before the `hidden sm:block` table wrapper):

```tsx
      <ul className="space-y-2 sm:hidden">
        {items.map((r) => {
          const verdict = gate && r.stats ? evaluateGate(gate, r.stats) : null;
          return (
            <li key={r.id} className="rounded-xl border bg-card p-3 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <StatusBadge status={r.status} />
                  {r.stats && <span className="text-sm">{r.stats.passed}/{r.stats.total}{r.stats.failed ? <span className="text-status-fail"> · {r.stats.failed} failed</span> : null}</span>}
                  {verdict && (verdict.passed
                    ? <span aria-label="Gate passed" className="text-status-pass">✓</span>
                    : <span aria-label={`Gate failed: ${verdict.reasons.join(", ")}`} className="text-status-fail">✗</span>)}
                </span>
                <span title={r.createdAt} className="text-xs text-muted-foreground">{relativeTime(r.createdAt)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="truncate text-xs text-muted-foreground">
                  {r.branch ? `${r.branch}${r.commit ? `@${r.commit.slice(0, 7)}` : ""}` : "—"}
                  {r.environment ? ` · ${r.environment}` : ""}
                  {r.stats?.durationMs ? ` · ${formatDurationSec(r.stats.durationMs)}` : ""}
                </span>
                <RowActions r={r} canWrite={canWrite} onOpenRun={onOpenRun} retry={retry} setConfirming={setConfirming} />
              </div>
            </li>
          );
        })}
        {items.length === 0 && <li className="rounded-xl border p-6 text-center text-sm text-muted-foreground">No runs{status ? ` with status ${status}` : ""}.</li>}
      </ul>
```
Filter chips, pager, and the confirm Dialog already live outside the table wrapper — they serve both renderings unchanged.

- [ ] **Step 4: Users card rows** — `Users.tsx`: wrap `<Table>…</Table>` in `<div className="hidden sm:block">…</div>` and add before it:

```tsx
              <ul className="divide-y sm:hidden">
                {users.map((u) => (
                  <li key={u.id} className="flex items-center justify-between gap-2 p-3">
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{u.email}</span>
                      <Badge variant="secondary" className="mt-0.5">{u.role}</Badge>
                    </span>
                    {u.id !== user.id && <Button variant="ghost" size="sm" disabled={remove.isPending && remove.variables === u.id} onClick={() => remove.mutate(u.id)}>Remove</Button>}
                  </li>
                ))}
              </ul>
```

- [ ] **Step 5: Audit card rows** — `Audit.tsx`: same wrapper pattern; mobile list:

```tsx
              <ul className="divide-y sm:hidden">
                {items.map((e) => (
                  <li key={e.id} className="space-y-0.5 p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{e.action}</span>
                      <span className="whitespace-nowrap text-xs text-muted-foreground">{new Date(e.at).toLocaleString()}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">{e.actorLabel}{e.projectId ? ` · ${e.projectId}` : ""}{target(e) ? ` · ${target(e)}` : ""}</div>
                    {e.metadata ? <div className="truncate text-xs text-muted-foreground">{JSON.stringify(e.metadata)}</div> : null}
                  </li>
                ))}
              </ul>
```

- [ ] **Step 6: Verify** — `pnpm --filter @allure-station/e2e exec playwright test mobile.spec.ts` → PASS; `pnpm --filter @allure-station/web test && pnpm typecheck` → PASS.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(web): card-row rendering for runs/users/audit tables below sm"
```

---

### Task 3: Report full-screen toggle (mobile focus mode)

**Files:**
- Modify: `packages/web/src/pages/Project.tsx`
- Modify: `packages/e2e/tests/mobile.spec.ts` (append)

- [ ] **Step 1: Failing e2e assertions** (append):

```ts
test("mobile: report full-screen toggle hides the header cards", async ({ page }) => {
  await page.goto("/projects/mobile-e2e");
  await expect(page.getByText(/Trends appear|duration/).first()).toBeVisible();
  await page.getByRole("button", { name: "Expand report" }).click();
  await expect(page.getByText(/Trends appear|duration/)).toBeHidden();
  await page.getByRole("button", { name: "Collapse report" }).click();
  await expect(page.getByText(/Trends appear|duration/).first()).toBeVisible();
});
```

- [ ] **Step 2: Run to verify failure** → FAIL ("Expand report" button not found).

- [ ] **Step 3: Implement** — in `Project.tsx`:
- State: `const [focusReport, setFocusReport] = useState(false);` reset in the existing `[id]` effect.
- Wrap the status-chip row and the trend/compare card row each with `className={cn(..., focusReport && "hidden")}` (import `cn` from `@/lib/utils`; apply to their existing wrapper divs).
- Add the toggle button inside the `TabsList` row, right-aligned (visible all breakpoints — it's harmless on desktop, valuable on mobile):

```tsx
          <div className="flex items-center justify-between">
            <TabsList className="self-start">…existing triggers…</TabsList>
            <Button variant="ghost" size="icon" aria-label={focusReport ? "Collapse report" : "Expand report"}
              onClick={() => setFocusReport((v) => !v)}>
              {focusReport ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </Button>
          </div>
```
(`Maximize2`, `Minimize2` from lucide-react — add to the existing import.) The failed-run banner stays visible regardless (don't hide failures).

- [ ] **Step 4: Verify + commit**

Run: `pnpm --filter @allure-station/e2e exec playwright test mobile.spec.ts && pnpm typecheck` → PASS.
```bash
git add -A && git commit -m "feat(web): report focus mode — hide header cards to give the report the viewport"
```

---

### Task 4: Inline accessibility fixes

**Files:**
- Modify: `packages/web/src/components/AppShell.tsx` (skip link + focus-on-route-change)
- Modify: `packages/web/src/pages/Project.tsx` (SSE live region)
- Modify: `packages/web/src/components/UserMenu.tsx` (theme radiogroup — the System/Light/Dark trio lives here; read the file first)
- Modify: `packages/web/src/components/PassRateDonut.tsx`, `Sparkline.tsx` (chart labels; `TrendBar` in Project.tsx already has an aria-label — enrich it with numbers)

No new unit tests in this task (markup/ARIA); Task 5's axe gate and a vitest snapshot-free check below verify it.

- [ ] **Step 1: Skip link + focus management** — `AppShell.tsx`:

```tsx
import { useEffect, useRef, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { Sidebar } from "@/components/Sidebar";

/** Frame for all routes: persistent sidebar + a per-page topbar (rendered by each page). */
export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);
  // Move focus to the content region on route change so screen-reader users land on the new page.
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    mainRef.current?.focus();
  }, [pathname]);
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow">
        Skip to main content
      </a>
      <Sidebar />
      <div id="main-content" ref={mainRef} tabIndex={-1} className="flex min-w-0 flex-1 flex-col outline-none">{children}</div>
    </div>
  );
}
```

- [ ] **Step 2: SSE live region** — `Project.tsx`: add state `const [announcement, setAnnouncement] = useState("");` and in the SSE handler's terminal branch (where trends are invalidated) set it:

```ts
        setAnnouncement(event.run.status === "ready"
          ? `Run from ${relativeTime(event.run.createdAt)} is ready`
          : `Run from ${relativeTime(event.run.createdAt)} failed to generate`);
```
Render once near the top of the page JSX: `<p aria-live="polite" role="status" className="sr-only">{announcement}</p>`. Do NOT announce intermediate (`generating`) states.

- [ ] **Step 3: Theme toggle radiogroup** — in `UserMenu.tsx`, find the three theme buttons (System/Light/Dark). Give the wrapping div `role="radiogroup" aria-label="Color theme"` and each button `role="radio" aria-checked={theme === value}` (the component already tracks the current theme to style the active one — reuse that state; buttons keep their existing `aria-label`s).

- [ ] **Step 4: Chart labels** —
- `PassRateDonut.tsx`: ensure the root SVG has `role="img"` and `aria-label={\`Pass rate ${pct}%\`}` (it has an img role per the snapshot — verify and enrich the label to include the number).
- `Sparkline.tsx`: root SVG `role="img" aria-label="Pass-rate trend over recent runs"`.
- `TrendBar` (in `Project.tsx`): extend the existing `aria-label` to include data: `` aria-label={`Pass-rate and duration trend across ${points.length} runs; latest ${points.at(-1)!.stats.passed}/${points.at(-1)!.stats.total} passed`} `` (guarded — only when `points.length >= 2`, which is true in that branch).

- [ ] **Step 5: Verify + commit**

Run: `pnpm --filter @allure-station/web test && pnpm typecheck` → PASS. Quick manual sanity: `pnpm --filter @allure-station/e2e exec playwright test` → all PASS (focus change must not break existing specs).
```bash
git add -A && git commit -m "feat(web): a11y baseline — skip link, route focus, SSE live region, radiogroup theme, chart labels"
```

---

### Task 5: axe-core CI gate

**Files:**
- Modify: `packages/e2e/package.json` (add dev-dependency)
- Create: `packages/e2e/tests/a11y.spec.ts`

- [ ] **Step 1: Install the dependency**

```bash
pnpm --filter @allure-station/e2e add -D @axe-core/playwright
```

- [ ] **Step 2: Write the spec** — `packages/e2e/tests/a11y.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Fails the build on serious/critical violations; logs everything else.
// The embedded Allure report iframe is third-party content — excluded.
async function expectNoSeriousViolations(page, label: string) {
  const results = await new AxeBuilder({ page })
    .exclude('iframe[title="report"]')
    .analyze();
  const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const minor = results.violations.filter((v) => v.impact !== "serious" && v.impact !== "critical");
  if (minor.length) console.log(`[a11y:${label}] non-blocking:`, minor.map((v) => `${v.id}(${v.impact}) ×${v.nodes.length}`).join(", "));
  expect(blocking.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target).slice(0, 3) })),
    `${label}: serious/critical a11y violations`).toEqual([]);
}

test("a11y: core pages have no serious violations", async ({ page }) => {
  // login (security off → page still renders at /login)
  await page.goto("/login");
  await expectNoSeriousViolations(page, "login");

  // projects list (+ create a project so the page has content)
  await page.goto("/");
  await page.getByRole("button", { name: "New project" }).first().click();
  await page.getByLabel("Project id").fill("a11y-e2e");
  await page.getByRole("button", { name: "Create" }).click();
  await expectNoSeriousViolations(page, "projects");

  // project page — Report and Runs tabs
  await page.getByText("a11y-e2e").first().click();
  await expectNoSeriousViolations(page, "project:report");
  await page.getByRole("tab", { name: "Runs" }).click();
  await expectNoSeriousViolations(page, "project:runs");

  // settings (open mode → accessible)
  await page.goto("/projects/a11y-e2e/settings");
  await expectNoSeriousViolations(page, "settings");
});
```
Users/Audit pages need an admin session; the open-mode suite has no login flow today. Check whether `smoke.spec.ts`/`ux-fixes.spec.ts` seed users — if not, scope this spec to the five surfaces above and leave a one-line comment that Users/Audit join the scan when an authed e2e fixture exists (do NOT build a login fixture in this task).

- [ ] **Step 3: Run it**

Run: `rm -rf packages/e2e/.e2e-data && pnpm --filter @allure-station/e2e test:e2e`
Expected: a11y.spec may legitimately FAIL on real findings. **Fix every serious/critical finding it reports** (these will be in our markup — e.g. contrast tokens, missing labels, landmark issues). Iterate: fix → re-run → green. Document anything surprising in the commit message. If a finding is in shadcn primitive markup, fix at the component level (`components/ui/*`), not per-page.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "test(e2e): axe-core a11y gate — fails CI on serious/critical violations"
```

---

### Task 6: Design-system docs + README + final gates

**Files:**
- Create: `design-system/allure-station/pages/app-shell.md`
- Modify: `README.md` (Highlights table)

- [ ] **Step 1: Write `design-system/allure-station/pages/app-shell.md`:**

```markdown
# App shell — page overrides & conventions

> Overrides/extends [`../MASTER.md`](../MASTER.md) for the shell (sidebar, topbar, navigation)
> and codifies the responsive + a11y conventions introduced by the Reach & Access slice
> (spec: docs/superpowers/specs/2026-06-11-enterprise-t1-reach-access-design.md).

## Breakpoint strategy

- **`md` (768px)** is the shell boundary: desktop sidebar (`hidden md:block`) vs topbar hamburger
  + left Sheet drawer (`md:hidden`). Never introduce a third navigation pattern.
- **`sm` (640px)** is the data-density boundary: `<table>` markup at `sm:`+, stacked card rows
  below. Pattern: wrap the table in `hidden sm:block`, render a sibling `sm:hidden` list with the
  same data, filters, pagination, and actions. No inner horizontal scrolling on mobile.
- Topbar: single row at `md:`+; below `md` it stacks — row 1 hamburger + truncating title,
  row 2 full-width wrapping actions. Sticky, safe-area padded
  (`pt-[max(0.75rem,env(safe-area-inset-top))]`).

## A11y conventions (apply to all new UI)

- Skip link + `#main-content` focus target live in `AppShell`; focus moves to content on route
  change. Don't add competing focus management per page.
- Every icon-only control has an `aria-label`. Multi-state toggles styled as button groups use
  `role="radiogroup"`/`role="radio"` + `aria-checked` (see the theme toggle in `UserMenu`).
- SVG charts: `role="img"` + a data-bearing `aria-label` (numbers, not just a title).
- Async page updates that change visible state (SSE run transitions) announce via a single
  `aria-live="polite"` region per page.
- CI gate: `packages/e2e/tests/a11y.spec.ts` fails on serious/critical axe violations on core
  pages. New pages must be added to that scan.
```

- [ ] **Step 2: README Highlights** — add one row to the Highlights table (keep voice/length consistent):

```markdown
| **Responsive &amp; accessible** | Full mobile support (drawer nav, adaptive tables) with an axe-core accessibility gate in CI. |
```

- [ ] **Step 3: Final gates**

```bash
pnpm test && pnpm typecheck
rm -rf packages/e2e/.e2e-data && pnpm --filter @allure-station/e2e test:e2e
```
Expected: everything green (unit suites, typecheck, smoke + ux-fixes + mobile + a11y e2e).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "docs: app-shell design-system conventions; README highlights responsive + a11y gate"
```

---

## Self-review notes (already applied)

- **Spec coverage:** drawer verification + safe-area (Task 1), topbar overflow (Task 1), card-row tables (Task 2), report full-screen (Task 3), skip link / focus / live region / radiogroup / chart labels (Task 4), axe gate with iframe exclusion + serious/critical threshold (Task 5), mobile e2e incl. boundingBox check (Tasks 1–3), docs (Task 6). Users/Audit axe scan is consciously deferred until an authed e2e fixture exists — noted inline, matches the spec's "core pages" intent.
- **Type consistency:** `RowActions` props mirror the existing mutation/handler shapes in `RunsTable.tsx`; `focusReport`/`announcement` are page-local state; no cross-task symbol drift.
- **Desktop invariance:** every responsive change is gated behind `md:`/`sm:` variants preserving current desktop classes; existing e2e specs act as the regression net.
