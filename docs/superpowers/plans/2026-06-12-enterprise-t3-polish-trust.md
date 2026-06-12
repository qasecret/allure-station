# Enterprise T3: Polish & Trust Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Human error messages with recovery paths, no blank-page crash mode, one time convention with accessible absolute tooltips, motion tokens, and layout-stable loading skeletons across every surface.

**Architecture:** Per `docs/superpowers/specs/2026-06-12-enterprise-t3-polish-trust-design.md` (read it first). Primitives first — `ApiError`/`humanizeError`, `ErrorBoundary`/`QueryErrorState`, `TimeStamp`, motion tokens, `TableSkeleton`/`CardSkeleton` — each in one owner file with unit tests, then a mechanical sweep of pages onto them. **Client-side only**; no server or contract changes, no migrations.

**Tech Stack:** React 18 + TanStack Query v5, Radix tooltip (shadcn `ui/tooltip.tsx`, currently unused — no Provider mounted anywhere), Tailwind + CSS vars, vitest, Playwright e2e (10 specs across `open` + `authed` projects).

**Verification commands:**
```bash
pnpm --filter @allure-station/web test
pnpm test && pnpm typecheck
rm -rf packages/e2e/.e2e-data packages/e2e/.e2e-data-authed && pnpm --filter @allure-station/e2e test:e2e   # 10/10 + new legs
```

**Key existing code facts (verified):** `api/client.ts` has THREE sites throwing `new Error(\`${res.status}: ${await res.text()}\`)` — `json()` (~line 63), `noContent()` (~69), `listWithTotal()` (~74). `main.tsx:19` is `new QueryClient()` bare; routes at lines 33–41; `<Toaster>` inside `AuthProvider`. `lib/format.ts` has `relativeTime(iso, now?)` (caps at "Nd ago"), `formatPercent`, `formatDurationSec`, `runLabel`. Global reduced-motion guard at `styles.css:148-155` (keep; covers everything new). Time sites: `RunsTable.tsx:130,171` (`title={r.createdAt}` + relativeTime), `Audit.tsx:164,188` + `ProjectSettings.tsx:275` (`new Date(e.at).toLocaleString()`), `ProjectCard.tsx:61`, `ProjectSettings.tsx:374` (token lastUsedAt). `ui/skeleton.tsx` exists (pulse div). Only `Projects.tsx` uses skeletons today. ~15 `toast.error((e as Error).message)` sites (grep before sweeping). `Users.tsx` (~55) parses `e.message.includes("409")` — delete with the sweep. `trend-geometry.ts` `xAxisLabels(points)` emits first/last + every day boundary (overlaps when dense). e2e helpers: `expectNoSeriousViolations` + `visible()` in `tests/helpers.ts`.

---

### Task 1: ApiError + humanizeError

**Files:**
- Create: `packages/web/src/lib/errors.ts` (+ `errors.test.ts`)
- Modify: `packages/web/src/api/client.ts` (3 throw sites)
- Test: extend `packages/web/src/api/client.test.ts`

- [ ] **Step 1: Failing tests** — `src/lib/errors.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ApiError, humanizeError } from "./errors";

describe("humanizeError", () => {
  const cases: Array<[number, string | RegExp]> = [
    [0, /can't reach the server/i],
    [401, /session has expired/i],
    [403, /don't have permission/i],
    [404, /no longer exists/i],
    [409, /conflicts with something/i],
    [413, /too large/i],
    [500, /went wrong on the server/i],
    [502, /went wrong on the server/i],
    [503, /went wrong on the server/i],
  ];
  it.each(cases)("maps status %i", (status, expected) => {
    const msg = humanizeError(new ApiError(status, "raw server text"));
    expect(msg).toMatch(expected);
    expect(msg).not.toMatch(/^\d/); // never leads with a bare status code
  });
  it("409 uses context when given", () => {
    expect(humanizeError(new ApiError(409, "exists"), "user")).toBe("That email is already in use.");
    expect(humanizeError(new ApiError(409, "exists"), "project")).toBe("A project with that id already exists.");
    expect(humanizeError(new ApiError(409, "exists"), "token")).toBe("A token with that name already exists.");
  });
  it("400/422 prefers a sentence-like server message", () => {
    expect(humanizeError(new ApiError(400, 'invalid sort "bogus"'))).toBe('invalid sort "bogus"');
    expect(humanizeError(new ApiError(422, "{}"))).toMatch(/wasn't valid/i); // JSON-ish → generic
    expect(humanizeError(new ApiError(400, ""))).toMatch(/wasn't valid/i);
  });
  it("unwraps {error} JSON envelopes from the body", () => {
    expect(humanizeError(new ApiError(400, '{"error":"branch name too long"}'))).toBe("branch name too long");
  });
  it("non-ApiError unknowns get the generic fallback, never undefined", () => {
    expect(humanizeError(new Error("boom"))).toMatch(/something went wrong/i);
    expect(humanizeError(undefined)).toMatch(/something went wrong/i);
    expect(humanizeError({ weird: true })).toMatch(/something went wrong/i);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @allure-station/web test src/lib/errors.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/errors.ts`:**

```ts
/** Structured API failure thrown by api/client.ts. status 0 = network failure (fetch rejected). */
export class ApiError extends Error {
  constructor(public readonly status: number, public readonly serverMessage: string) {
    super(`${status}: ${serverMessage}`);
    this.name = "ApiError";
  }
}

const CONFLICTS: Record<string, string> = {
  user: "That email is already in use.",
  project: "A project with that id already exists.",
  token: "A token with that name already exists.",
};

/** Server bodies may be plain text or a JSON {error} envelope — extract the human part. */
function serverText(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { error?: unknown };
    return typeof parsed?.error === "string" ? parsed.error : "";
  } catch {
    return raw;
  }
}

/** True for short prose the server wrote for humans (zod/validation messages qualify). */
function readsLikeSentence(s: string): boolean {
  return s.length > 0 && s.length < 200 && !s.trimStart().startsWith("{") && !s.trimStart().startsWith("<");
}

/** Map any thrown value to a human sentence with a recovery hint. Never returns raw "409: …". */
export function humanizeError(e: unknown, context?: keyof typeof CONFLICTS | string): string {
  if (!(e instanceof ApiError)) return "Something went wrong — try again.";
  const { status } = e;
  if (status === 0) return "Can't reach the server — check your connection and try again.";
  if (status === 401) return "Your session has expired — sign in again.";
  if (status === 403) return "You don't have permission to do that.";
  if (status === 404) return "That no longer exists — it may have been deleted.";
  if (status === 409) return (context && CONFLICTS[context]) || "That conflicts with something that already exists.";
  if (status === 413) return "That upload is too large.";
  if (status === 400 || status === 422) {
    const text = serverText(e.serverMessage);
    return readsLikeSentence(text) ? text : "That request wasn't valid — check the form and try again.";
  }
  if (status >= 500) return "Something went wrong on the server — try again in a moment.";
  const text = serverText(e.serverMessage);
  return readsLikeSentence(text) ? text : "Something went wrong — try again.";
}
```

- [ ] **Step 4: Client throws ApiError** — in `api/client.ts`, import `ApiError` from `../lib/errors.js` and replace ALL THREE `throw new Error(\`${res.status}: ...\`)` sites with `throw new ApiError(res.status, await res.text())`. Wrap each `await f(...)` so network rejections become `ApiError(0, ...)` — add one helper above `json()` and use it in all three functions:

```ts
  async function send(path: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await f(`${base}${path}`, { credentials: "include", ...init });
    } catch (e) {
      throw new ApiError(0, e instanceof Error ? e.message : "network failure");
    }
    if (!res.ok) throw new ApiError(res.status, await res.text());
    return res;
  }
```
`json()` becomes `const res = await send(path, init); return res.json() as Promise<T>;` — `noContent()` and `listWithTotal()` likewise call `send`.

- [ ] **Step 5: Client test** — append to `client.test.ts`:

```ts
it("throws ApiError with status and serverMessage on failure, status 0 on network reject", async () => {
  const failing = (async () => new Response("nope", { status: 403 })) as unknown as typeof fetch;
  const c1 = createClient("/api", failing);
  await expect(c1.listProjects({})).rejects.toMatchObject({ name: "ApiError", status: 403, serverMessage: "nope" });
  const rejecting = (async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
  const c2 = createClient("/api", rejecting);
  await expect(c2.listProjects({})).rejects.toMatchObject({ status: 0 });
});
```

- [ ] **Step 6: Green + commit** — `pnpm --filter @allure-station/web test && pnpm typecheck` →
`git add -A && git commit -m "feat(web): structured ApiError + humanizeError mapping"`

---

### Task 2: ErrorBoundary + QueryErrorState + QueryClient defaults

**Files:**
- Create: `packages/web/src/components/ErrorBoundary.tsx` (+ `ErrorBoundary.test.tsx`)
- Create: `packages/web/src/components/QueryErrorState.tsx`
- Modify: `packages/web/src/main.tsx`

- [ ] **Step 1: Failing test** — `ErrorBoundary.test.tsx` (the repo has no React Testing Library — keep it dependency-free with react-dom/server, which exercises `getDerivedStateFromError` via a manual render of the fallback; the boundary's catch path is a thin class wrapper):

```tsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ErrorFallback } from "./ErrorBoundary";

describe("ErrorFallback", () => {
  it("renders the branded card with message and reload action", () => {
    const html = renderToStaticMarkup(<ErrorFallback error={new Error("kaput")} />);
    expect(html).toContain("Something went wrong");
    expect(html).toContain("kaput");
    expect(html).toContain("Reload");
  });
});
```

- [ ] **Step 2: Implement `ErrorBoundary.tsx`:**

```tsx
import React from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Rendered when the React tree below the boundary throws — the app must never blank. */
export function ErrorFallback({ error }: { error: Error }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 text-center shadow-sm">
        <AlertTriangle className="mx-auto size-8 text-status-broken-text" aria-hidden />
        <h1 className="mt-3 text-lg font-semibold">Something went wrong</h1>
        <p className="mt-1 text-sm text-muted-foreground">The page hit an unexpected error. Reloading usually fixes it.</p>
        <details className="mt-3 text-left text-xs text-muted-foreground">
          <summary className="cursor-pointer">Technical details</summary>
          <pre className="mt-1 overflow-auto whitespace-pre-wrap">{error.message}</pre>
        </details>
        <Button className="mt-4" onClick={() => location.reload()}>Reload</Button>
      </div>
    </div>
  );
}

interface State { error: Error | null }

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  render() {
    if (this.state.error) return <ErrorFallback error={this.state.error} />;
    return this.props.children;
  }
}
```

- [ ] **Step 3: Implement `QueryErrorState.tsx`:**

```tsx
import { AlertCircle, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { humanizeError } from "@/lib/errors";

/** Inline failure card for page-level queries — replaces empty tables/sections on error.
 *  role="alert" so the failure is announced to screen readers. */
export function QueryErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-xl border bg-card p-8 text-center shadow-sm">
      <AlertCircle className="size-6 text-status-fail-text" aria-hidden />
      <p className="text-sm text-muted-foreground">{humanizeError(error)}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RotateCw className="size-3.5" /> Retry
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Wire `main.tsx`** — `const qc = new QueryClient({ defaultOptions: { queries: { retry: 1 }, mutations: { retry: 0 } } });` (one comment: "retry once on transient query failures; mutations never auto-retry"). Wrap the router: `<ErrorBoundary><BrowserRouter>…</BrowserRouter></ErrorBoundary>` (inside QueryClientProvider so a remount keeps the cache). Import from `@/components/ErrorBoundary`.

- [ ] **Step 5: Green + commit** — unit + typecheck + quick e2e smoke (`pnpm --filter @allure-station/e2e exec playwright test smoke.spec.ts --project=open`) →
`git commit -m "feat(web): ErrorBoundary, QueryErrorState, explicit QueryClient defaults"`

---

### Task 3: Error sweep (toasts + inline states)

**Files:**
- Modify: every `toast.error((e as Error).message)` site (grep `toast.error` across `packages/web/src` — ~15 in RunsTable, UploadDialog, NewProjectDialog, ProjectSettings, Project, Users, Audit)
- Modify: `packages/web/src/pages/{Projects,Users,Audit}.tsx`, `packages/web/src/components/RunsTable.tsx`, settings cards + ComparePanel/TestHistorySheet in `Project.tsx`/`ProjectSettings.tsx` (inline error states)

- [ ] **Step 1: Toast sweep** — every `toast.error((e as Error).message)` → `toast.error(humanizeError(e))`, passing context where the mutation maps to a CONFLICTS key: user creation → `humanizeError(e, "user")`, project creation → `"project"`, token creation → `"token"`. DELETE `Users.tsx`'s manual `e.message.includes("409")` branch — the mapping replaces it. No `(e as Error)` casts remain in toast calls (grep to confirm).

- [ ] **Step 2: Inline error states** — for each page-level `useQuery` powering a primary surface, render `<QueryErrorState error={query.error} onRetry={() => query.refetch()} />` when `query.isError`, in the spot the table/grid/section renders. Surfaces (from the spec): Projects grid (`Projects.tsx` — between the `isLoading` and empty-state branches), RunsTable (`["runs-page"...]` query), Audit table, Users table, ProjectSettings (page-level project query → full-width card), ComparePanel (compare query), TestHistorySheet (history query). Keep dialogs/mutations on toasts.

- [ ] **Step 3: Verify behaviorally** — temporary manual check is fine, but the durable assertion lands in Task 7's e2e leg. Run full unit + typecheck + full wiped e2e (10/10).

- [ ] **Step 4: Commit** — `git commit -m "feat(web): humanized error toasts + inline query error states with retry"`

---

### Task 4: TimeStamp + relativeTime fallover

**Files:**
- Modify: `packages/web/src/lib/format.ts` (+ `format.test.ts`)
- Create: `packages/web/src/components/TimeStamp.tsx`
- Modify: `packages/web/src/components/RunsTable.tsx:130,171`, `packages/web/src/pages/Audit.tsx:164,188`, `packages/web/src/pages/ProjectSettings.tsx:275,374`, `packages/web/src/components/ProjectCard.tsx:61`, `packages/web/src/components/TrendChart.tsx` (absolute formatter reuse)
- Modify: `packages/web/src/main.tsx` (TooltipProvider)

- [ ] **Step 1: Failing tests** — append to `format.test.ts`:

```ts
describe("relativeTime fallover", () => {
  const now = Date.parse("2026-06-12T12:00:00.000Z");
  it("keeps compact forms under 7 days", () => {
    expect(relativeTime("2026-06-12T11:59:30.000Z", now)).toBe("just now");
    expect(relativeTime("2026-06-10T12:00:00.000Z", now)).toBe("2d ago");
  });
  it("falls over to a date beyond 7 days, with year beyond a year", () => {
    expect(relativeTime("2026-06-01T12:00:00.000Z", now)).toBe(absoluteDate("2026-06-01T12:00:00.000Z"));
    expect(relativeTime("2024-12-25T12:00:00.000Z", now)).toBe(absoluteDate("2024-12-25T12:00:00.000Z", { year: true }));
  });
});
describe("formatAbsolute", () => {
  it("renders a full local timestamp", () => {
    // local-TZ dependent — assert shape, not exact text
    expect(formatAbsolute("2026-06-12T06:44:11.000Z")).toMatch(/2026/);
    expect(formatAbsolute("2026-06-12T06:44:11.000Z")).toMatch(/\d{1,2}:\d{2}/);
  });
});
```

- [ ] **Step 2: Implement in `format.ts`:**

```ts
/** Short local date: "Jun 5", with year when requested or differing: "Dec 25, 2024". */
export function absoluteDate(iso: string, opts: { year?: boolean } = {}): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", ...(opts.year ? { year: "numeric" } : {}) });
}

/** Full local timestamp for tooltips and dense audit rows: "Jun 12, 2026, 06:44:11". */
export function formatAbsolute(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
```
Extend `relativeTime`: after the `hr < 24` branch — `const day = Math.round(hr / 24); if (day <= 7) return \`${day}d ago\`;` then `const then = new Date(iso); const yearApart = now - then.getTime() > 365 * 24 * 3600 * 1000; return absoluteDate(iso, { year: yearApart });`

- [ ] **Step 3: Implement `TimeStamp.tsx`:**

```tsx
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatAbsolute, relativeTime } from "@/lib/format";

/** App-wide time convention: relative text with the full local timestamp in an accessible
 *  tooltip (keyboard-focusable trigger — the title attribute is not reachable by keyboard).
 *  `dense` renders both inline for audit/compliance surfaces where hovering is unacceptable. */
export function TimeStamp({ iso, dense = false, className }: { iso: string; dense?: boolean; className?: string }) {
  if (dense) {
    return <span className={className}>{relativeTime(iso)} · {formatAbsolute(iso)}</span>;
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className={className}>{relativeTime(iso)}</span>
      </TooltipTrigger>
      <TooltipContent>{formatAbsolute(iso)}</TooltipContent>
    </Tooltip>
  );
}
```
Mount ONE `<TooltipProvider delayDuration={300}>` in `main.tsx` wrapping the routes (inside AuthProvider), imported from `@/components/ui/tooltip`.

- [ ] **Step 4: Sweep** — RunsTable 130/171: `<span title=…>…</span>` → `<TimeStamp iso={r.createdAt} className="text-xs text-muted-foreground" />` (drop the title attr); Audit.tsx 164 (desktop Time cell) and 188 (mobile card) → `<TimeStamp iso={e.at} dense className="whitespace-nowrap text-xs text-muted-foreground" />`; ProjectSettings 275 (audit card) → dense TimeStamp; ProjectSettings 374 (token lastUsedAt) → `{t.lastUsedAt ? <TimeStamp iso={t.lastUsedAt} /> : "never"}`; ProjectCard 61 keeps plain `relativeTime` text (a tooltip inside a Link is a focus trap — note the exception with a comment); TrendChart's tooltip/aria date strings switch to `formatAbsolute(p.createdAt)` (delete its inline `toLocaleDateString`+`toLocaleTimeString` recipe).

- [ ] **Step 5: e2e guard** — the runs-table e2e assertions don't reference `title=` (verify by grep in packages/e2e — adjust if any do). Run full wiped e2e (10/10), unit, typecheck.

- [ ] **Step 6: Commit** — `git commit -m "feat(web): TimeStamp with accessible absolute tooltip; relativeTime date fallover"`

---

### Task 5: Motion tokens + targeted polish

**Files:**
- Modify: `packages/web/src/styles.css`, `packages/web/tailwind.config.ts`
- Modify: `packages/web/src/components/ui/{sheet,dialog,select,dropdown-menu,tooltip}.tsx`
- Modify: `design-system/allure-station/MASTER.md`

- [ ] **Step 1: Tokens** — in `styles.css` `:root` (single block, light/dark agnostic):

```css
  /* Motion scale — all UI animation durations come from these (MASTER.md "Motion"). */
  --motion-fast: 150ms;
  --motion-base: 200ms;
  --motion-slow: 300ms;
```
In `tailwind.config.ts` `theme.extend`:

```ts
      transitionDuration: { fast: "var(--motion-fast)", base: "var(--motion-base)", slow: "var(--motion-slow)" },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in var(--motion-fast) ease-out",
      },
      keyframes: {
        // keep existing accordion keyframes, add:
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
      },
```

- [ ] **Step 2: Migrate ad-hoc durations** — in the five `ui/*.tsx` files, replace `duration-200` → `duration-base`, `duration-300` → `duration-slow`, `duration-500` → `duration-slow` (sheet's 500ms close intentionally normalizes to the slow token — note in the commit message). Grep `duration-[0-9]` under `src/` afterwards: zero matches outside tailwind keyframe definitions.

- [ ] **Step 3: Targeted polish** — add `animate-fade-in` to: the Projects grid container (the `div.grid` rendering cards once loaded), RunsTable's table+mobile list containers, Audit table container, the project page's StatsRow wrapper. Press feedback: `active:scale-[0.98] transition-transform duration-fast` on `ProjectCard`'s Card (inside the Link) and the OverviewStrip `Tile` button. Nothing animates width/height/position.

- [ ] **Step 4: MASTER.md** — add a "Motion" section: the three tokens + easing rule (ease-out enter / ease-in exit), "no raw `duration-N` classes outside `ui/` — use `duration-fast|base|slow`", the global reduced-motion guard location, and "transform/opacity only".

- [ ] **Step 5: Verify + commit** — unit + typecheck + full wiped e2e (the a11y scans confirm reduced-motion didn't regress; animate-fade-in must not break `visible()` locators — it doesn't, opacity-only). `git commit -m "feat(web): motion duration tokens, migrated component durations, fade-in polish"`

---

### Task 6: Trend-chart x-axis label thinning (carried debt)

**Files:**
- Modify: `packages/web/src/lib/trend-geometry.ts` (+ `trend-geometry.test.ts`)
- Modify: `packages/web/src/components/TrendChart.tsx` (pass plot width)

- [ ] **Step 1: Failing tests** — append to `trend-geometry.test.ts`:

```ts
describe("xAxisLabels thinning", () => {
  const mkPts = (days: number) =>
    Array.from({ length: days }, (_, i) => ({
      runId: `r${i}`,
      createdAt: `2026-05-${String(i + 1).padStart(2, "0")}T10:00:00.000Z`,
      stats: { total: 4, passed: 4, failed: 0, broken: 0, skipped: 0, durationMs: 1000 },
    }));
  it("keeps first and last, drops intermediates that would collide", () => {
    const labels = xAxisLabels(mkPts(30), { plotWidth: 300, labelWidth: 70 });
    expect(labels[0].index).toBe(0);
    expect(labels[labels.length - 1].index).toBe(29);
    expect(labels.length).toBeLessThanOrEqual(Math.floor(300 / 70) + 1); // budget honored
  });
  it("keeps all day boundaries when there is room", () => {
    const labels = xAxisLabels(mkPts(3), { plotWidth: 600, labelWidth: 70 });
    expect(labels).toHaveLength(3);
  });
  it("is backward compatible without a budget (no thinning)", () => {
    expect(xAxisLabels(mkPts(3))).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Implement** — extend the signature: `xAxisLabels(points, budget?: { plotWidth: number; labelWidth: number })`. After building the existing boundary list, when `budget` is given and `labels.length * labelWidth > plotWidth`: keep first and last, and from the intermediates keep every `k`-th where `k = Math.ceil((labels.length - 2) / Math.max(1, Math.floor(plotWidth / labelWidth) - 2))`, preserving original order. Pure function, no rendering knowledge.

- [ ] **Step 3: Wire TrendChart** — call `xAxisLabels(points, { plotWidth, labelWidth: 70 })` (70px ≈ the rendered `2026-06-12` at text-[10px] mono; measure once and put the real number in a named const `X_LABEL_WIDTH`).

- [ ] **Step 4: Green + commit** — unit + typecheck + e2e a11y/triage specs. `git commit -m "fix(web): thin trend-chart x-axis labels to the available width"`

---

### Task 7: Skeleton sweep + e2e error leg + docs

**Files:**
- Create: `packages/web/src/components/skeletons.tsx` (+ `skeletons.test.tsx`)
- Modify: `packages/web/src/components/RunsTable.tsx`, `packages/web/src/pages/{Audit,Users,ProjectSettings,Project}.tsx` (ComparePanel, TestHistorySheet, report iframe)
- Modify: `packages/e2e/tests/authed.spec.ts` or a new leg in `triage.spec.ts` (inline-error e2e)
- Modify: `design-system/allure-station/MASTER.md` (Time section), `docs/user-guide/README.md` (only if visuals changed)

- [ ] **Step 1: Failing test** — `skeletons.test.tsx` (renderToStaticMarkup, same pattern as Task 2):

```tsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TableSkeleton, CardSkeleton } from "./skeletons";

describe("skeletons", () => {
  it("TableSkeleton renders rows × cols cells", () => {
    const html = renderToStaticMarkup(<TableSkeleton rows={3} cols={4} />);
    expect(html.match(/data-skeleton-cell/g)).toHaveLength(12);
  });
  it("CardSkeleton renders a card shell", () => {
    expect(renderToStaticMarkup(<CardSkeleton />)).toContain("rounded-xl");
  });
});
```

- [ ] **Step 2: Implement `skeletons.tsx`:**

```tsx
import { Skeleton } from "@/components/ui/skeleton";

/** Layout-matched table placeholder: heights mirror real rows so content settles without shift. */
export function TableSkeleton({ rows, cols }: { rows: number; cols: number }) {
  return (
    <div aria-hidden className="space-y-2">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} data-skeleton-cell className="h-8 flex-1 rounded-md" />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Settings-card placeholder matching the card shell (title line + two content lines). */
export function CardSkeleton() {
  return (
    <div aria-hidden className="rounded-xl border bg-card p-4 shadow-sm">
      <Skeleton className="h-5 w-40 rounded-md" />
      <Skeleton className="mt-3 h-4 w-full rounded-md" />
      <Skeleton className="mt-2 h-4 w-2/3 rounded-md" />
    </div>
  );
}
```

- [ ] **Step 3: Sweep** — render on `query.isLoading` ONLY (not `isFetching` — paged tables keep `keepPreviousData` behavior): RunsTable → `<TableSkeleton rows={5} cols={6} />` before the table/cards; Audit → `rows={8} cols={3}`; Users → `rows={3} cols={3}`; ProjectSettings → one `<CardSkeleton />` per card while its query loads (and the page-level "Loading…" text becomes two CardSkeletons); ComparePanel result area → `rows={4} cols={3}`; TestHistorySheet → `rows={6} cols={2}`; report iframe: render an absolutely-positioned `<Skeleton className="absolute inset-0" />` over the iframe container until the iframe `onLoad` fires (state in the existing iframe wrapper in Project.tsx).

- [ ] **Step 4: e2e inline-error leg** — in the OPEN project (reads are public; no auth needed), append to `triage.spec.ts`:

```ts
test("a missing project shows a humanized inline error with retry", async ({ page }) => {
  await page.goto("/projects/does-not-exist-xyz");
  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(/no longer exists/i);
  await expect(alert.getByRole("button", { name: "Retry" })).toBeVisible();
  await expectNoSeriousViolations(page, "project:error-state");
});
```
(Prereq: the Project page's project query must surface `isError` — it sets `retry: false` already; render `QueryErrorState` from Task 3. Import `expectNoSeriousViolations` from `./helpers`.)

- [ ] **Step 5: Docs** — MASTER.md "Time" section (convention, TimeStamp usage, dense rule for audit, ProjectCard exception); user-guide: §14 audit Time column note ("relative · absolute"); screenshots NOT refreshed in this PR (post-merge if visibly changed).

- [ ] **Step 6: Final gates**

```bash
pnpm test && pnpm typecheck
rm -rf packages/e2e/.e2e-data packages/e2e/.e2e-data-authed && pnpm --filter @allure-station/e2e test:e2e   # 11/11 (10 + error leg)
pnpm --filter @allure-station/e2e test:e2e   # un-wiped isolation re-run
```

- [ ] **Step 7: Commit** — `git commit -m "feat(web): skeleton sweep, report shimmer; test(e2e): inline-error leg; docs: motion+time conventions"`

---

## Self-review notes (already applied)

- **Spec coverage:** §1 errors → Tasks 1–3 (+ e2e leg in 7); §2 time → Task 4; §3 motion → Tasks 5–6 (tokens/migration/polish + the carried x-label debt); §4 skeletons → Task 7; §5 testing/docs → per-task TDD + Task 7. Reduced-motion: covered by the existing global guard (spec) — Task 5 Step 5 verifies via the a11y suite, no new code.
- **Judgment points left to the implementer, explicitly marked:** the exact `X_LABEL_WIDTH` measurement (Task 6 Step 3), e2e `title=` locator grep (Task 4 Step 5), per-card query wiring in ProjectSettings (Task 7 Step 3 — read the card components for their query names).
- **Type consistency:** `ApiError(status, serverMessage)` shape used identically in Tasks 1–3; `humanizeError(e, context?)` context keys = CONFLICTS keys = the three sweep call sites; `TimeStamp` props (`iso`, `dense`, `className`) match all Task 4 sweep usages; `xAxisLabels` budget param optional → Task 6's backward-compat test pins TrendChart's existing no-budget callers safe during the transition.
