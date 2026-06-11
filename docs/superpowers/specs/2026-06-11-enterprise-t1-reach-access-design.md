# Enterprise upgrade, sub-project 1: Reach & access — design

**Date:** 2026-06-11 · **Status:** approved · **Owner:** Rabindra + Claude

First of four sub-projects in the enterprise-upgrade arc (1 Reach & access → 2 Triage surfaces →
3 Polish & trust → 4 Enterprise surface; each gets its own spec/plan/PR). This one fixes what is
actually broken: below 768px the app has **no navigation at all** (`Sidebar.tsx` is
`hidden md:block` with no replacement — Users, Audit, theme, and Sign in are unreachable), pages
were never designed for small screens, and accessibility coverage is ad-hoc.

## Decisions made

| Decision | Choice |
|---|---|
| Sequencing | All four sub-projects, in order, separate PRs |
| Mobile navigation | Slim mobile top bar + hamburger → left Sheet drawer (desktop unchanged) |
| A11y CI gate | axe-core in Playwright e2e; **fail on serious + critical**, log the rest |
| Approach | Responsive retrofit inside the existing shell (no AppShell rebuild, no separate mobile views) |

## 1. Mobile navigation & responsive layouts

- **`components/NavContent.tsx` (new):** the sidebar's inner content — brand link, nav items
  (Projects; Users/Audit when signed in as admin), theme toggle, account/sign-in — extracted from
  `Sidebar.tsx` so it renders identically in two hosts. Accepts an `onNavigate?` callback so the
  drawer can close on selection.
- **`Sidebar.tsx`:** unchanged appearance; becomes a thin `<aside className="hidden md:block …">`
  wrapper around `NavContent`.
- **`components/MobileHeader.tsx` (new):** `md:hidden`, sticky top, safe-area padding
  (`pt-[env(safe-area-inset-top)]`), brand wordmark + hamburger button
  (`aria-label="Open navigation"`). Tapping opens a shadcn `Sheet` (`side="left"`) containing
  `NavContent`; the sheet closes on navigation; Radix handles focus trap and return-focus.
  `AppShell` renders it above the page column on mobile.
- **Project page header (`Project.tsx`):** below `md` the controls must fit a 375px viewport with
  no horizontal scroll: controls row wraps; "Upload & generate" shortens to icon + "Upload";
  if wrapping still overflows at 375px, the branch filter moves into a popover behind a filter
  icon. Status-chip row wraps (verify, already `flex-wrap`).
- **Tables → card rows below `sm`:** runs table (`RunsTable.tsx`), users (`Users.tsx`), audit
  (`Audit.tsx`) render stacked card rows on mobile: line 1 = primary identity + status badge,
  line 2 = metadata, actions aligned right. The `<table>` markup remains for `sm:` and up. The
  exact mechanism (a shared `ResponsiveTable` wrapper vs per-table conditional render) is decided
  in the plan after reading the markup; the visual contract is what's specified here. Pagination
  and filters keep working in both renderings.
- **Report iframe (mobile):** gains a "Full screen" expand toggle (icon button, `aria-label`)
  that hides the header cards/chips so the report gets the whole viewport below the mobile
  header; toggling back restores. Deep-link/poll machinery untouched.
- **Projects grid (`Projects.tsx`):** add `xl:grid-cols-3` (currently caps at `sm:grid-cols-2`).

## 2. Accessibility baseline

- **Skip link:** first focusable element in `AppShell` — `sr-only focus:not-sr-only`, targets the
  `<main>` landmark. Verify each page renders exactly one `<main>`.
- **SSE live region:** one visually-hidden `aria-live="polite"` element on the project page,
  fed by the existing SSE handler: announce ready/failed transitions ("Run from 2 minutes ago is
  ready"). No announcement spam for intermediate states.
- **Icon-only control audit:** every icon-only interactive element gets an `aria-label`
  (hamburger, theme toggle trio, settings gear, history, copy, expand). The theme toggle becomes
  a `role="radiogroup"` with `aria-checked` per option (it is a three-state selector styled as
  buttons).
- **Charts:** `PassRateDonut`, `Sparkline`, `TrendBar` get `role="img"` + data-bearing
  `aria-label` (e.g. "Pass rate 88%, 7 of 8 passed"); hover `<title>`s remain for mice.
- **Focus on route change:** `AppShell` moves focus to the main content region when
  `location.pathname` changes (skip on first mount).
- **Out of scope here:** linking charts to data tables (Tier 2), color-blind patterns in charts
  (Tier 2 chart rework).

## 3. Testing

- **`packages/e2e/tests/a11y.spec.ts` (new):** `@axe-core/playwright` scans: projects list,
  project page (Report tab AND Runs tab), project settings, login, users, audit. The Allure
  report iframe subtree is excluded (third-party content). Build fails on `serious`/`critical`
  impact violations; `moderate`/`minor` are logged to the test output. Runs in the existing e2e
  suite and workflow.
- **`packages/e2e/tests/mobile.spec.ts` (new):** viewport 375×812: mobile header visible,
  drawer opens → navigate to Audit (admin seeded) works, no horizontal overflow on projects and
  project pages (`scrollWidth <= innerWidth`), runs view renders card rows, full-screen report
  toggle works.
- Existing unit + e2e suites stay green; desktop visuals unchanged (existing screenshots remain
  valid).

## 4. Documentation

- `design-system/allure-station/pages/app-shell.md` (new): documents the mobile nav pattern,
  breakpoint strategy, card-row table pattern, and the a11y conventions added here (per
  MASTER.md's hierarchical override scheme).
- README Highlights: one line noting responsive/mobile support and the a11y CI gate (in the
  final task of the plan, alongside any user-guide touch-ups).

## Out of scope (later sub-projects)

Home-page overview/sorting (T2) · audit humanization + filters (T2) · sortable tables (T2) ·
real trend chart (T2) · motion tokens/reduced-motion (T3) · error-message mapping (T3) ·
skeletons beyond existing (T3) · absolute-time handling (T3) · account/profile + sessions (T4) ·
token expiry (T4) · density mode (T4) · white-label login (T4) · i18n scaffolding (T4).
