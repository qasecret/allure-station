# Enterprise upgrade, sub-project 1: Reach & access — design

**Date:** 2026-06-11 · **Status:** approved · **Owner:** Rabindra + Claude

First of four sub-projects in the enterprise-upgrade arc (1 Reach & access → 2 Triage surfaces →
3 Polish & trust → 4 Enterprise surface; each gets its own spec/plan/PR). This one fixes what is
actually broken on small screens and establishes the accessibility baseline.

> **Correction (verified empirically at 375×812 before planning):** the original premise
> "no navigation below 768px" was wrong — `Topbar.tsx` already ships a `md:hidden` hamburger
> opening a left Sheet with `SidebarContent` (nav, theme, sign-in), and it works. What IS broken
> at 375px on the project page: the topbar's `shrink-0` actions overflow the viewport —
> **"Upload & generate" renders at x=542–719 (untappable)**, the run selector is half-clipped,
> and the title is squeezed to zero width. The runs/users/audit tables horizontally scroll inside
> their containers with row actions hidden off-screen. Scope below reflects this reality.

## Decisions made

| Decision | Choice |
|---|---|
| Sequencing | All four sub-projects, in order, separate PRs |
| Mobile navigation | Keep the existing Topbar hamburger → left Sheet drawer; fix the topbar action overflow (desktop unchanged) |
| A11y CI gate | axe-core in Playwright e2e; **fail on serious + critical**, log the rest |
| Approach | Responsive retrofit inside the existing shell (no AppShell rebuild, no separate mobile views) |

## 1. Mobile navigation & responsive layouts

- **Drawer navigation (existing — verify, don't rebuild):** `Topbar.tsx`'s hamburger + left
  Sheet + `SidebarContent` already provide mobile navigation, theme, and sign-in on every page.
  Tier-1 work here is verification + small polish only: the sheet closes on navigation (the
  page's Topbar unmounts — confirm in the mobile e2e), the trigger keeps a proper `aria-label`,
  and safe-area top padding (`pt-[env(safe-area-inset-top)]`) is added to the sticky header
  (deferred during execution — requires `viewport-fit=cover`; see design-system/allure-station/pages/app-shell.md).
  No `NavContent.tsx` or `MobileHeader.tsx` components are needed.
- **Topbar overflow fix (`Topbar.tsx` + `Project.tsx`) — the real mobile bug:** below `md` the
  header becomes two rows: row 1 = hamburger + title (truncating), row 2 = the actions
  (`flex-wrap`, full width). The run selector gets a mobile width cap (`w-full max-w-full` in
  row 2 instead of fixed `w-[320px]`), and "Upload & generate" shortens to icon + "Upload" below
  `sm`. Acceptance: at 375px every header control is fully inside the viewport and tappable,
  and the title is visible. Desktop (`md:`+) layout is unchanged.
- **Status-chip row (`Project.tsx`):** already wraps (verified at 375px) — no change.
- **Tables → card rows below `sm`:** runs table (`RunsTable.tsx`), users (`Users.tsx`), audit
  (`Audit.tsx`) render stacked card rows on mobile: line 1 = primary identity + status badge,
  line 2 = metadata, actions aligned right. The `<table>` markup remains for `sm:` and up. The
  exact mechanism (a shared `ResponsiveTable` wrapper vs per-table conditional render) is decided
  in the plan after reading the markup; the visual contract is what's specified here. Pagination
  and filters keep working in both renderings.
- **Report iframe (mobile):** gains a "Full screen" expand toggle (icon button, `aria-label`)
  that hides the header cards/chips so the report gets the whole viewport below the topbar;
  toggling back restores. Deep-link/poll machinery untouched.
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
- **`packages/e2e/tests/mobile.spec.ts` (new):** viewport 375×812: hamburger visible,
  drawer opens → navigate to Audit (admin seeded) works, every project-page topbar control is
  fully inside the viewport (boundingBox check on the Upload button), no horizontal overflow on projects and
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
