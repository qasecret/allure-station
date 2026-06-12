# Allure Station — Design System (Master)

> **LOGIC:** When building a specific page, first check `design-system/allure-station/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file. Otherwise, follow the rules below.
>
> **Source of truth for code:** the canonical token values live in
> [`packages/web/src/styles.css`](../../packages/web/src/styles.css) and
> [`packages/web/tailwind.config.ts`](../../packages/web/tailwind.config.ts).
> This document explains *intent and conventions*; if a value here ever disagrees with
> `styles.css`, the CSS wins — update this file to match.

**Project:** Allure Station — self-hosted, multi-project Allure 3 report hub
**Category:** B2B developer-tooling SaaS dashboard
**Validated style:** *Trust & Authority* (ui-ux-pro-max) — enterprise software / premium, WCAG-AA+ target
**Reference:** premium enterprise re-skin (Geist + teal + cool-slate), 2026-06

---

## Tech & conventions (read first)

- **Stack:** React 18 + Vite 5 + TypeScript (ESM), **Tailwind CSS v3** + **shadcn/ui** (Radix), TanStack Query, React Router 6, `lucide-react` icons, `sonner` toasts.
- **Theming:** semantic **CSS-variable tokens** in `styles.css` as **HSL triplets**, mapped to Tailwind colors as `hsl(var(--token))`. **Never hardcode hex in components** — use token classes (`bg-primary`, `text-muted-foreground`, `border-border`, `bg-sidebar`, …). The only sanctioned literal hex are the fixed **status/brand** swatches in `tailwind.config.ts` and the SVG chart strokes.
- **Dark mode:** class-based (`.dark` on `<html>`), driven by `theme.ts` (`system | light | dark`). Light and dark are authored **together**; both must be tested.
- **Utility merge:** compose classes with `cn()` (`@/lib/utils`).
- **Icons:** `lucide-react` only. **No emojis as icons.** One icon family, consistent stroke.
- **Fonts:** loaded via Google Fonts `<link>` in `index.html`; family set on `--font-sans` / `--font-mono` and `tailwind.config.ts` `fontFamily`.

---

## Color palette

Teal-emerald accent on cool-slate neutrals. Values below are the canonical roles; full light+dark HSL sets are in `styles.css`.

| Role | Token (class) | Light | Dark | Notes |
|------|---------------|-------|------|-------|
| Primary / CTA | `primary` | `#1DB980` (`158 73% 42%`) | brighter teal (`159 64% 50%`) | buttons, active nav, fills/tiles — NOT text/links |
| Primary as text | `primary-text` | darker teal (`158 75% 26%`, 5.77:1 on white — same value as the sidebar active tokens) | reuses dark primary (`159 64% 50%`, 9.60:1 on slate-950) | teal-as-TEXT: links, text labels (light `--primary` is only ~2.5:1 on white) |
| On primary | `primary-foreground` | dark slate (`222 47% 11%`) | dark slate (`222 47% 9%`) | text on teal in BOTH modes — AA 7:1; flipped 2026-06-11 by the axe gate work |
| Background (canvas) | `background` | cool slate `#f3f6fa` (`210 33% 97%`) | slate-950 (`222 47% 8%`) | app canvas / topbar |
| Foreground | `foreground` | slate-900 `#0F172A` | slate-100 | primary text |
| Card surface | `card` | `#FFFFFF` | slate-900 (`222 47% 11%`) | cards, report frame |
| Sidebar | `sidebar` | light-blue `#e8f1fa` (`208 60% 95%`) | slate-900 | left rail |
| Muted text | `muted-foreground` | slate-500 `#64748B` (45% lightness — slightly darker than stock slate-500 for AA) | slate-400 | secondary text |
| Border | `border` | slate-200 `#E2E8F0` | slate-800 | hairlines, dividers |
| Input border | `input` | slate-300 | slate-700 | form fields (stronger than card border) |
| Ring (focus) | `ring` | `158 73% 30%` (darker than primary — 3:1 non-text contrast vs canvas; 42% is ~2.4:1) | brighter teal (`159 64% 50%`) | keyboard focus |

**Sidebar active token:** `--sidebar-accent-foreground` and `--sidebar-primary` are darkened to 26% lightness (from 30–33%) so active nav text reaches ≥4.5:1 against the light sidebar-accent background (#d8f3e9).

**Fixed status swatches** (in `tailwind.config.ts`, used by donut/badges/trend — semantic, not theme-swapped):

| Meaning | Token | Hex |
|---|---|---|
| Pass / healthy (≥90%) | `status.pass` / `brand` | `#1DB980` |
| Warn / flaky / broken (60–89%) | `status.broken` | `#F59E0B` |
| Fail (<60%) | `status.fail` / `destructive` | `#EF4444` |
| Skipped / muted | `status.skip` | `#94A3B8` |

**Text-safe status tokens** (`--status-*-text` CSS variables, added 2026-06-11 by the populated axe scan): fills, bars, and badge backgrounds keep the bright hex swatches above; only text rendered *as* status (labels, count strings, inline status glyphs) should use the darkened tokens below. Both meet WCAG AA (≥4.5:1) in their respective themes.

| Token | Light value (HSL) | Light ratio vs white | Dark value (HSL) | Dark ratio vs slate-950 |
|---|---|---|---|---|
| `--status-pass-text` | `158 75% 26%` | 5.77:1 | `159 64% 50%` | 9.64:1 |
| `--status-fail-text` | `0 72% 38%` | 7.47:1 | `0 85% 65%` | 5.74:1 |
| `--status-broken-text` | `32 95% 31%` | 5.76:1 | `43 96% 56%` | 11.19:1 |

> Use `text-[hsl(var(--status-pass-text))]` (or equivalent Tailwind utility if mapped) for status labels. Never use `text-status-pass` (the bright swatch) for body text — it is only ~3:1 on light backgrounds.

**Color notes:** Code-dark + run-green heritage; the teal reads as "passing/healthy" and doubles as the brand. Pass-rate donut thresholds: **≥90 teal, ≥60 amber, else red**.

---

## Typography

- **Sans (UI):** **Geist** — `--font-sans`, `tailwind` `font-sans`. Weights 300–800.
- **Mono (code/IDs/timestamps):** **Geist Mono** — `--font-mono`, `font-mono`.
- **Mood:** enterprise, SaaS, B2B, modern, legible (Vercel/Linear lineage).
- **Scale:** Tailwind defaults; page titles `text-[15px]/lg font-semibold tracking-tight`, headings 600–700, body 400, labels/medium 500. Use **tabular figures** for data/counts.
- **Load:** `index.html` Google Fonts link (`Geist` + `Geist Mono`, `display=swap`).

---

## Spacing, radius, elevation

- **Spacing:** 4 / 8 px rhythm (Tailwind scale). Content padding `p-6`; card padding `p-4`–`p-5`; gaps `gap-2`/`gap-3`/`gap-4`.
- **Container:** centered content with `max-w-3xl` (forms/settings) to `max-w-5xl` (dashboards).
- **Radius:** `--radius: 0.625rem`. Cards `rounded-xl`; buttons/inputs/badges `rounded-lg`; pills/dots `rounded-full`.
- **Elevation:** subtle only — `shadow-sm` resting, `hover:shadow-md` on interactive cards. No heavy/colored shadows.
- **Header:** sticky topbar `min-h-16 px-6 border-b bg-background/80 backdrop-blur`.

---

## Component conventions (shadcn-first)

Prefer the shadcn primitives in `@/components/ui/*`; only add bespoke markup for app-specific pieces.

- **Buttons:** shadcn `<Button>`. Primary = teal (`default`); secondary = `outline` (slate border + white). One **primary CTA per view**. Icon-only buttons need `aria-label`.
- **Cards:** `<Card>` → `rounded-xl border bg-card shadow-sm`; interactive cards add `transition-shadow hover:border-primary/40 hover:shadow-md` and a `focus-visible` ring.
- **Inputs/selects:** shadcn `<Input>` / `<Select>` — slate border, **teal focus ring**. Always a visible `<Label>` (never placeholder-only). Selects use real enum values (never empty-string — Radix-safe).
- **Status pill:** `inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-semibold text-primary` + Lucide icon (status by **icon + text**, not color alone). See `StatusBadge`.
- **Icon badge** (card headers): `flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary` wrapping a `size-5` icon. Used on Trend / Compare cards.
- **Dialogs/sheets:** shadcn `<Dialog>` / `<Sheet>`; scrim dims background; provide a clear close affordance; guard unsaved/in-flight submits.
- **Toasts:** `sonner` (`<Toaster richColors position="top-right" />`); success/error on mutations; `aria-live` (don't steal focus).
- **Tables:** shadcn `<Table>` for Users / Audit / Members; disable only the in-flight row's action button.
- **Empty states:** `EmptyState` (dashed border, icon, copy, optional action).
- **Charts/data-viz** (`PassRateDonut`, `Sparkline`, trend bars): SVG; **value always shown as text** (e.g. `87%` in donut center) + `role="img"` + `aria-label`; never color-alone. Donut track = `border` token; arc color by threshold.

---

## App shell & navigation

- **Layout:** persistent left **Sidebar** (`bg-sidebar`, `md:` only) + **Topbar** per page (breadcrumb/title + right-aligned actions). Mobile: sidebar collapses to a **Sheet** via a hamburger in the topbar.
- **Sidebar nav:** Lucide icon + text label; active = `bg-sidebar-accent text-sidebar-primary`; admin-only links gated on role. User menu (avatar + theme switcher + sign-out) pinned bottom.
- **Routing:** layout route `<Route element={<AppShell><Outlet/></AppShell>}>`; `/login` lives outside the shell. Every key screen is URL-addressable.

---

## Accessibility (must-pass)

- **Contrast:** body/UI text ≥ 4.5:1 in **both** themes (slate-900/slate-500 on light; slate-100/slate-400 on dark).
- **Focus:** visible focus ring on every interactive element. shadcn controls self-ring; a global `a:focus-visible` ring covers links/nav (in `styles.css`).
- **Reduced motion:** `@media (prefers-reduced-motion: reduce)` neutralizes transitions/animations app-wide (in `styles.css`). Respect it for any new motion.
- **Color not alone:** pair status color with icon + text everywhere (badges, buckets, donut value).
- **Semantics:** real `<label htmlFor>`; `aria-label` on icon-only controls; `role="alert"`/`aria-live` for errors/toasts; logical tab order.
- **Motion budget:** 150–300ms, `ease-out` enter / `ease-in` exit; animate `transform`/`opacity` only; 1–2 elements per view.

---

## Anti-patterns (do NOT use)

- ❌ Playful design, AI purple/pink gradients, hidden credentials (off-brand for *Trust & Authority*)
- ❌ Emojis as icons — use Lucide
- ❌ Raw hex in components — use semantic tokens
- ❌ Pure green `#22C55E` as the brand accent — our accent is teal `#1DB980` (keep status-pass aligned)
- ❌ DM Sans / other UI fonts — the UI font is **Geist**
- ❌ Removing focus outlines without a replacement ring
- ❌ Layout-shifting hover transforms; instant (0ms) state changes
- ❌ Empty-string values in Radix `Select`; placeholder-only labels
- ❌ Replacing the embedded **real Allure 3 report** (`<iframe>`) with a mock — restyle the chrome around it only

---

## Pre-delivery checklist

- [ ] No emojis as icons; one Lucide family, consistent stroke
- [ ] Semantic tokens only (no raw hex) in components
- [ ] `cursor-pointer` on all clickable elements
- [ ] Hover/press states, smooth 150–300ms transitions
- [ ] Text contrast ≥ 4.5:1 in **light and dark**
- [ ] Visible keyboard focus on all interactive elements (incl. links/cards)
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive at 375 / 768 / 1024 / 1440; no horizontal scroll on mobile
- [ ] No content hidden behind the sticky topbar
- [ ] Light **and** dark verified (not inferred from one)
- [ ] `pnpm --filter @allure-station/web typecheck && test && build` green
