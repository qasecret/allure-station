# Allure Station — UI Redesign Design

**Date:** 2026-06-07
**Status:** Approved (pending spec review)
**Scope:** `packages/web` only. Presentational redesign of the Allure Station *shell*. No API, contract, auth, or behavior changes. The embedded Allure 3 report (`<iframe>`) is untouched.

## Goal

Turn the barebones Allure Station chrome (bulleted links, unstyled inputs, inline styles) into a clean, beautiful, ultra-modern SaaS dashboard that **respects Allure 3's design language**, so the shell and the embedded report feel like one cohesive product.

## Decisions (locked)

| Decision | Choice |
| --- | --- |
| Styling stack | **Tailwind CSS + shadcn/ui** |
| Layout | **Sidebar + topbar** dashboard shell |
| Visual direction | **Allure-native** (teal brand + violet accent + status colors) |
| Project settings (members/visibility/audit) | **Dedicated page** at `/projects/:id/settings` |
| Scope | **All surfaces**, implemented in slices |

## Design system

### Tech setup
Add to `packages/web`:
- `tailwindcss`, `postcss`, `autoprefixer` (+ `tailwind.config.ts`, `postcss.config.js`)
- shadcn/ui scaffolding: `class-variance-authority`, `clsx`, `tailwind-merge`, `tailwindcss-animate`, `lucide-react`, and per-component `@radix-ui/*` (added on demand as components are generated)
- `components.json` for shadcn, with `@/` path alias wired in `vite.config` + `tsconfig`
- A `cn()` util (`src/lib/utils.ts`)

Tokens live as CSS variables (shadcn convention: `--background`, `--foreground`, `--primary`, `--border`, `--ring`, etc.) in `styles.css`, mapped in `tailwind.config`. This **replaces** the current ad-hoc `--bg/--fg/--muted/...` variables, but keeps the same idea.

### Palette (Allure-native)
- **Brand (teal)** — identity only (logo/wordmark, brand accents): `#1ED6B2 → #12B58F → #0A916F` (from `favicon.svg`).
- **Primary / accent (violet)** — primary buttons, active nav, links, focus ring: base `~#7C5CFF` (matches Allure 3's interactive purple). Mapped to shadcn `--primary`.
- **Status** — passed `#22C55E`, failed `#EF4444`, broken/flaky `#F59E0B`, skipped/muted slate. These match the existing compare buckets and trend bar, so the shell and report agree.
- **Neutrals** — a slate surface/border/text scale, light + dark.

### Dark mode
Keep the existing `system | light | dark` model in [theme.ts](../../../packages/web/src/theme.ts). Switch the toggle target to shadcn's `.dark` class on `<html>` (instead of `data-theme`), driven by the existing `applyTheme()`. The floating `ThemeToggle` widget moves into the sidebar user menu.

## App shell

A new `AppShell` layout component wraps all authenticated routes.

- **Sidebar** (left, collapsible; a Radix `Sheet` slide-over on mobile):
  - Logo + "Allure Station" wordmark (links home)
  - Primary nav: **Projects** (home). Admin-only: **Users**, **Audit**.
  - Pinned bottom: **user menu** (email, theme toggle, sign out) or a **Sign in** link when anonymous.
- **Topbar** (slim, sticky): breadcrumbs + page title (left); page-level actions (right) — search / "New project" on the dashboard; run selector + Upload on a project.

This replaces the current full-width `TopBar` component. RBAC-gated links (Users/Audit) keep their existing `user.role === "admin"` checks.

## Page redesigns

### Projects (home) — `/`
Card-grid dashboard.
- Header: title + **"New project"** button → opens a **dialog** (replaces the inline `new project id` input).
- Search input (debounced, same query behavior as today).
- Responsive **grid of project cards**. Each card: name, mini pass-rate **donut**, last-run relative time, run count, a small **trend sparkline**, visibility badge, "(no runs yet)" state.
- Real **empty state** (no projects / no search matches) and **skeleton** cards while loading.
- Pagination preserved (same `PAGE_SIZE`, offset logic).

### Project — `/projects/:id`
Report workspace.
- Toolbar: project name + breadcrumb; **run selector** as a styled dropdown with status dots and the existing `runLabel` metadata; **branch filter**; **Upload & generate** as a drag-and-drop **dialog**; a **Settings** link (owner/admin) to `/projects/:id/settings`.
- Run metadata row (branch@commit, env, CI link) restyled as chips/badges.
- **Summary strip**: pass-rate donut + totals + duration for the current run.
- **Trend chart** (`TrendBar`): keep the SVG logic, restyle into a card with a legend.
- **Compare runs** (`ComparePanel`): restyle into a card; buckets become labeled, color+icon coded lists. Same compare query/logic.
- The Allure report **`<iframe>`** sits in a clean framed container (rounded, bordered, fills remaining height). The "No ready report yet" state gets an illustrated empty state.
- SSE live-update, refetch, and status-rank logic are **unchanged**.

### Project settings — `/projects/:id/settings` (NEW route)
Owner/admin only (same detection: the owner-gated fetches error for everyone else and the page shows an "unavailable" state). Sections, lifted out of the old inline `<details>`:
- **Members** — table + add/update form + remove (from `MembersPanel`).
- **Visibility** — public/private toggle (from `VisibilityControl`).
- **Audit** — project audit list (from `AuditPanel`).
All existing queries/mutations and RBAC behavior preserved; only the presentation moves.

### Login — `/login`
Centered card on a brand-gradient panel. OIDC button(s) + credential form. Same auth flow.

### Users (admin) — `/users`
Real **data table**: columns for email/role/actions, search, add-user form, role editing. Same admin API calls.

### Audit (admin) — `/audit`
**Timeline / table** of audit events with readable actor/action/metadata and filtering. Same data source.

## Cross-cutting polish

- **Toasts** (shadcn `sonner`) for mutation success/error — replaces inline error `<p>` blocks.
- **Skeletons** for all loading states.
- **Empty states** with icon + copy for every list/grid.
- **Focus-visible** rings everywhere (keyboard a11y).
- **Responsive**: sidebar collapses to a sheet; grids reflow; toolbars wrap.
- **Status never by color alone** — pair status colors with icons + text.
- Preserve all existing `aria-label`s and semantics.

## Component inventory (shadcn)

Button, Input, Dialog, Sheet, DropdownMenu, Select, Table, Card, Badge, Tabs, Tooltip, Skeleton, Sonner (toaster), Avatar, ScrollArea. Plus app components: `AppShell`, `Sidebar`, `Topbar`, `UserMenu`, `ProjectCard`, `PassRateDonut`, `TrendChart`, `RunSelector`, `UploadDialog`, `CompareCard`, `EmptyState`.

## Out of scope

- No changes to server, shared contracts, queue, storage, auth logic, or the Allure report itself.
- No new product features — purely a visual/UX redesign of existing functionality.
- No router data-loading rearchitecture; TanStack Query usage stays as-is.

## Implementation slices

0. **Foundation** — Tailwind + shadcn setup, tokens/palette, dark-mode wiring (`.dark` + `theme.ts`), `cn()` util, base primitives, `@/` alias. Verify: app still boots, theme toggle works.
1. **App shell** — `AppShell` + Sidebar + Topbar; mount in `main.tsx` around routes; retire old `TopBar`/floating `ThemeToggle`. Verify: nav + admin gating + responsive sheet.
2. **Projects dashboard** — card grid, donut, sparkline, New-project dialog, search, skeletons, empty state, pagination.
3. **Project workspace** — toolbar, run selector, summary strip, trend card, compare card, iframe frame, upload dialog. Preserve SSE/refetch logic.
4. **Project settings page** — new route; move Members/Visibility/Audit; preserve RBAC gating.
5. **Login, Users, Audit** — login card, users table, audit timeline.
6. **Polish & QA** — toasts, skeletons, empty states, full responsive pass, **Playwright screenshot verification** of every surface (light + dark).

Each slice is independently verifiable and ends with a screenshot check.

## Verification

- `pnpm --filter @allure-station/web typecheck` and `build` pass after each slice.
- Existing web unit tests (`client.test.ts`) still pass.
- Playwright: capture screenshots of Projects, Project, Settings, Login, Users, Audit in light and dark; visually confirm against this design.
