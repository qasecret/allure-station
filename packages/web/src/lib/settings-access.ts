export type SettingsState = "open" | "signin" | "manage" | "limited";

/**
 * What the project Settings page should render.
 * - open:    zero-config mode (no accounts) — writes are open; show functional cards + a banner.
 * - signin:  security on, not signed in — prompt to sign in.
 * - manage:  signed in with owner/admin — show everything.
 * - limited: signed in but not owner/admin — functional cards only; members/audit gated.
 */
export function settingsState(
  { securityEnabled, signedIn, canManageMembers }:
  { securityEnabled: boolean; signedIn: boolean; canManageMembers: boolean },
): SettingsState {
  if (!securityEnabled) return "open";
  if (!signedIn) return "signin";
  return canManageMembers ? "manage" : "limited";
}
