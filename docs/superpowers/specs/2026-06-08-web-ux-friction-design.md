# Web UX Friction Bundle — Design

**Date:** 2026-06-08
**Status:** Approved (pending spec review)
**Slice:** 1 of 2 (the CLI is a separate follow-up slice, not covered here)

## Goal

Remove five end-user friction points in the web UI that surfaced during a full click-through of the
product, so the "power" features are discoverable and the UI is consistent and honest about access.

## Background

A walkthrough of every screen found that three documented features — **quality gates, CI tokens, and
notifications** — have no UI at all (they exist only as API endpoints), the project Settings page shows
a misleading "no access" message in zero-config mode, the regression "failing since" hint is hidden
behind a tiny unlabelled icon, the project page has a fighting double-scroll, and run selectors render
raw ISO timestamps while the rest of the app uses friendly relative time.

## Scope

In scope (all in `packages/web`, plus additive web-API-client methods):

1. **Settings cards** — add Quality Gate, Tokens, and Notifications cards to `ProjectSettings`.
2. **Honest access gating** — replace the misleading message with accurate, state-specific copy.
3. **Surface the regression hint** — make the per-test history affordance on Compare rows discoverable.
4. **Layout / double-scroll** — single outer scroll; report iframe fills remaining height.
5. **Friendly timestamps** — run + compare selectors use `relativeTime()` with exact time on hover.

Explicitly **out of scope**:

- The CLI (next slice).
- **No server or contract changes.** Every endpoint and every zod schema this work needs already
  exists in `@allure-station/shared` and `packages/server`.
- Removing Allure's *internal* theme/language toggles — those live inside the generated Allure 3 report
  iframe and are not ours to strip.

## Constraints & existing building blocks

- `api.getConfig()` already returns `{ securityEnabled, oidc, allure }`.
- The web API client (`packages/web/src/api/client.ts`) currently has **no** methods for tokens,
  quality-gate, or notifications — these are added here.
- `relativeTime(iso)` already exists in `packages/web/src/lib/format.ts` and is already used in the
  history drawer.
- `RegressionHint` and the history `Sheet`/drawer already exist in `Project.tsx`; we only change the
  affordance that opens the drawer, not the drawer itself.
- The `MembersCard` in `ProjectSettings.tsx` is the structural template for the three new cards
  (read query + mutation + `toast` + table/list).

### Relevant contracts (already defined — do not redefine)

```ts
// quality gate
qualityGateConfigSchema = { maxFailures?, minTests?, minPassRate?(0..1), maxDurationMs? } (.strict())
// tokens
apiTokenSchema       = { id, projectId, name, prefix, createdAt, lastUsedAt }
createdTokenSchema   = apiTokenSchema + { token }   // plaintext, returned ONCE
createTokenRequest   = { name: string (1..64) }
// notifications
notificationSchema   = { id, projectId, kind: "slack"|"webhook", url, events[], createdAt }
createNotificationRequest = { kind, url, events: ("completed"|"failed"|"gate_failed"|"regression")[] }
```

### Relevant endpoint auth (already implemented — informs the gating)

| Endpoint | Open mode (security off, no token) | Once a token exists / security on |
|---|---|---|
| `GET /projects/:id/quality-gate` | public | public |
| `PUT /projects/:id/quality-gate` | open (authorizeProjectWrite → open) | token or maintainer+ |
| `GET/POST/DELETE …/tokens` | open (requireProjectWrite → open) | token or maintainer+ |
| `GET/POST/DELETE …/notifications` | open | token or maintainer+ |
| `GET/PUT/DELETE …/members`, `…/audit` | **needs an account** (owner/admin) → 401 | owner/admin |

## Detailed design

### 1 + 2. Settings page rewrite (`ProjectSettings.tsx`)

Fetch `api.getConfig()` alongside the existing members probe. Compute the page state:

- **`openMode`** = `!config.securityEnabled`
- **`signedIn`** = `!!user`
- **`canManageMembers`** = members fetch succeeded (the existing owner/admin probe)

Render by state:

| Condition | Render |
|---|---|
| `openMode` | **Open-mode banner** + `VisibilityCard`, `QualityGateCard`, `TokensCard`, `NotificationsCard`. `MembersCard` and `AuditCard` are replaced by a muted note: *"Enable accounts (set `ADMIN_EMAIL` / `ADMIN_PASSWORD`) to manage members and view the audit log."* |
| `!openMode && !signedIn` | Single message + link: *"Sign in to manage this project's settings."* → `/login` |
| `!openMode && signedIn && canManageMembers` | All cards: Visibility, Quality Gate, Tokens, Notifications, Members, Audit. |
| `!openMode && signedIn && !canManageMembers` | The functional cards that the user *can* use are still shown (Visibility/Gate/Tokens/Notifications attempt their reads; if a read 401s the card shows an inline "needs maintainer+/owner" note), and Members/Audit show: *"You need the owner or admin role to manage members."* |

**Open-mode banner copy:** *"Open mode — anyone can manage this project. Set `ADMIN_EMAIL` and
`ADMIN_PASSWORD` to require sign-in."* Rendered as a muted `Card`/callout above the cards.

**Open-mode token caveat (must be handled, not worked around):** in open mode, creating the first
token flips the project to token-protected; subsequent browser writes (no token, no session) then
return 401. Each card's mutation `onError` shows a toast; for this specific case the Tokens card's copy
notes: *"This project is now token-protected — sign in to keep managing it here."* This is the intended
security progression, surfaced honestly.

#### `QualityGateCard`

- `useQuery(["quality-gate", id], api.getQualityGate)` to prefill.
- Controlled form with four optional numeric inputs: **Max failures**, **Min tests**,
  **Min pass rate (%)**, **Max duration (s)**.
- **Unit conversion:** the API stores `minPassRate` as a fraction `0..1` and `maxDurationMs` in ms. The
  UI shows pass rate as a **percent** (e.g. `95`) and duration in **seconds**. Convert on load
  (×100, ÷1000) and on save (÷100, ×1000). Empty input = field omitted (the rule is unset).
- Save = `useMutation(api.setQualityGate)`, invalidates the query, `toast.success("Quality gate saved")`.

#### `TokensCard`

- `useQuery(["tokens", id], api.listTokens)`.
- Create form: a name `Input` (1–64 chars) + **Create token** button → `api.createToken`. On success,
  show the returned **plaintext token once** in a copyable, dismissible callout
  (*"Copy this now — it won't be shown again."* with a copy button), then invalidate the list.
- Table: name, `prefix…` (masked), created (relative), last used (relative or "never"), Delete button →
  `api.deleteToken`.

#### `NotificationsCard`

- `useQuery(["notifications", id], api.listNotifications)`.
- Create form: `kind` select (`webhook`|`slack`), `url` input, `events` multi-select among
  `completed`, `failed`, `gate_failed`, `regression` (default `failed, gate_failed, regression`) →
  `api.createNotification`.
- List: kind, url, event chips, Delete → `api.deleteNotification`.

#### New web-API-client methods (`api/client.ts` + `ApiClient` interface)

```ts
getQualityGate(projectId): Promise<QualityGateConfig>           // GET  /projects/:id/quality-gate
setQualityGate(projectId, cfg: QualityGateConfig): Promise<QualityGateConfig>  // PUT
listTokens(projectId): Promise<ApiToken[]>                      // GET  /projects/:id/tokens
createToken(projectId, name): Promise<CreatedToken>            // POST /projects/:id/tokens
deleteToken(projectId, tokenId): Promise<void>                 // DELETE …/tokens/:tokenId
listNotifications(projectId): Promise<Notification[]>          // GET  /projects/:id/notifications
createNotification(projectId, body: CreateNotificationRequest): Promise<Notification>  // POST
deleteNotification(projectId, id): Promise<void>               // DELETE …/notifications/:id
```

Types imported from `@allure-station/shared`. Use the existing `json` / `noContent` helpers.

### 3. Surface the regression hint (`Project.tsx` → `Bucket`)

The Compare `Bucket` renders each test with a bare icon button that opens the history drawer. Change it
to a **labelled** affordance: an icon **+ the text "History"** (small, `variant="ghost"`/`size="sm"`),
keeping the existing `aria-label={`History for ${test.name}`}`. The drawer and `RegressionHint`
component are unchanged. Applies to all buckets for consistency; most valuable on **Newly failing**.

### 4. Layout / double-scroll (`Project.tsx`)

The project content column should be a single flex-column scroll container: the status header +
analytics strip (Trend/Compare) scroll normally, and the report `iframe` occupies the remaining height
(`flex-1 min-h-0`) so it scrolls **internally only** (its own Allure content), with no competing outer
scrollbar on our wrapper. Verify there is one vertical scrollbar for our chrome and one inside the
report, not two fighting on the same region. No change to the iframe `src` or Allure output.

### 5. Friendly timestamps (shared run-label builder)

Today the run `<select>` uses a `runLabel(r)` helper in `components/RunSelector.tsx` that **leads with
raw `r.createdAt`**; `ComparePanel`'s base/target `<select>`s (in `Project.tsx`) build their own inline
label, also raw ISO. Both already short-SHA the commit elsewhere via `commit.slice(0, 7)` (the status
header pattern).

Fix: make `runLabel(r)` lead with `relativeTime(r.createdAt)` instead of the ISO string, keeping status,
`(passed/total)`, and `branch@<7-char sha>` · `env`. Example: `just now — ready (7/8) — main@e4f5a6b ·
staging`. Set the exact ISO string as the `title` on the option's inner span (hover-for-exact). Export
the helper (or a small `runShortLabel`) and **reuse it in `ComparePanel`** so both selectors share one
implementation. Reuses `relativeTime()` from `lib/format.ts`.

Because `runLabel` becomes a pure exported function, it gets a direct unit test (relative-time lead,
short SHA, env, and the no-metadata fallback).

## Testing

- **`client.test.ts`** — add cases for the 8 new methods using the existing `vi.fn()` fetch-mock
  pattern (assert method, path, body; assert plaintext token surfaced from `createToken`).
- **`ProjectSettings` component tests** (Testing Library + mocked `api`):
  - open mode → banner + 4 functional cards visible, Members/Audit show the "enable accounts" note;
  - security-on + not signed in → "Sign in" message;
  - security-on + signed-in owner → all cards;
  - QualityGateCard percent↔fraction conversion on load and save;
  - TokensCard shows plaintext token once after create.
- **`runLabel` unit test** — the exported pure helper: relative-time lead, `branch@<7-char>`, env, and
  the no-metadata fallback (`just now — ready (7/8)`).

## Risks / notes

- **Open-mode token lock-out** is inherent to the security model; handled via graceful 401 toasts and
  banner guidance (above), not by changing server behavior.
- **Allure iframe chrome** (its own theme/language toggles) remains; only our outer layout changes.
- Bundle size: three new cards are small and reuse existing shadcn primitives; negligible.
