import { describe, it, expect } from "vitest";
import { settingsState } from "./settings-access.js";

describe("settingsState", () => {
  it("open mode when security is disabled (regardless of sign-in)", () => {
    expect(settingsState({ securityEnabled: false, signedIn: false, canManageMembers: false })).toBe("open");
    expect(settingsState({ securityEnabled: false, signedIn: true, canManageMembers: true })).toBe("open");
  });
  it("prompts sign-in when security is on and not signed in", () => {
    expect(settingsState({ securityEnabled: true, signedIn: false, canManageMembers: false })).toBe("signin");
  });
  it("full manage when signed in and members are manageable", () => {
    expect(settingsState({ securityEnabled: true, signedIn: true, canManageMembers: true })).toBe("manage");
  });
  it("limited when signed in but not an owner/admin", () => {
    expect(settingsState({ securityEnabled: true, signedIn: true, canManageMembers: false })).toBe("limited");
  });
});
