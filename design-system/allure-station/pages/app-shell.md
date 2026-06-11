# App shell — page overrides & conventions

> Overrides/extends [`../MASTER.md`](../MASTER.md) for the shell (sidebar, topbar, navigation)
> and codifies the responsive + a11y conventions introduced by the Reach & Access slice
> (spec: docs/superpowers/specs/2026-06-11-enterprise-t1-reach-access-design.md).

## Breakpoint strategy

- **`md` (768px)** is the shell boundary: desktop sidebar (`hidden md:block`) vs topbar hamburger
  + left Sheet drawer (`md:hidden`). Never introduce a third navigation pattern.
- **`sm` (640px)** is the data-density boundary: `<table>` markup at `sm:`+, stacked card rows
  below. Pattern: wrap the table in `hidden sm:block`, render a sibling `sm:hidden` `role="list"`
  card list with the same data, filters, pagination, and actions — share action/mark components
  (see `RowActions`/`GateMark` in `RunsTable.tsx`) so behavior can't drift. No inner horizontal
  scrolling on mobile.
- Topbar: single row at `md:`+; below `md` it stacks — row 1 hamburger + truncating title,
  row 2 full-width wrapping actions. Sticky. (Safe-area insets deferred — needs
  `viewport-fit=cover` first.)
- e2e visibility rule: dual-rendered content means locators must scope with
  `.locator("visible=true")` before `.first()` — hidden twins hijack bare locators.

## A11y conventions (apply to all new UI)

- Skip link + `#main-content` focus target live in `AppShell`; focus moves to content on route
  change. Don't add competing focus management per page.
- Every icon-only control has an `aria-label`. State-toggles use `aria-pressed`; multi-option
  selectors styled as button groups use `role="radiogroup"`/`role="radio"` + `aria-checked`
  (theme toggle in `UserMenu`). Note: arrow-key roving tabindex for the radiogroup is deferred.
- SVG charts: `role="img"` + a data-bearing `aria-label` (numbers, not just a title).
- Async page updates that change visible state (SSE run transitions) announce via a single
  `aria-live="polite"` region per page; terminal states only.
- Mobile card lists: `role="list"` on the `ul` (Tailwind preflight strips list semantics in
  WebKit).
- CI gate: `packages/e2e/tests/a11y.spec.ts` fails on serious/critical axe violations on core
  pages (light mode; report iframe excluded). New pages must be added to that scan. Known debt:
  teal-as-text contrast (see the spec header comment in that file).
