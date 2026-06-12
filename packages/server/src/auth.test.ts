import { describe, it, expect } from "vitest";
import {
  generateToken, hashToken, tokenPrefix,
  authorizeProjectWrite, authorizeProjectOwner, authorizeProjectCreate, requireAdmin,
  type Principal,
} from "./auth.js";
import type { ProjectRole } from "@allure-station/shared";
import type { AppDeps } from "./app.js";

describe("token helpers", () => {
  it("generates a prefixed high-entropy token; hash is stable; prefix is the first 12 chars", () => {
    const t = generateToken();
    expect(t.startsWith("ast_")).toBe(true);
    expect(t.length).toBeGreaterThan(20);
    expect(generateToken()).not.toBe(t); // random
    expect(hashToken(t)).toBe(hashToken(t)); // deterministic
    expect(hashToken(t)).not.toBe(t); // hashed, not plaintext
    expect(tokenPrefix(t)).toBe(t.slice(0, 12));
  });
});

// Minimal deps stub: users.count, tokens.countByProject, and one membership(project,user)->role.
function depsWith(opts: { userCount?: number; tokenCount?: number; membership?: { role: ProjectRole } | null } = {}): AppDeps {
  return {
    users: { count: async () => opts.userCount ?? 0 },
    tokens: { countByProject: async () => opts.tokenCount ?? 0 },
    memberships: { find: async () => (opts.membership ? { role: opts.membership.role } : null) },
  } as unknown as AppDeps;
}

const anon: Principal = { kind: "anonymous" };
const admin: Principal = { kind: "user", userId: "a", email: "a@x", role: "admin", createdAt: "t" };
const plainUser: Principal = { kind: "user", userId: "u", email: "u@x", role: "user", createdAt: "t" };
const tokenFor = (projectId: string): Principal => ({ kind: "token", projectId, tokenId: "t1" });

describe("authorizeProjectWrite", () => {
  it("zero-config: anonymous is allowed only when no users AND no tokens exist", async () => {
    expect(await authorizeProjectWrite(depsWith({ userCount: 0, tokenCount: 0 }), anon, "p")).toBe("ok");
    // Anonymous with a token-protected project → unauthenticated (no-oracle: "is there a token here?" hidden)
    expect(await authorizeProjectWrite(depsWith({ userCount: 0, tokenCount: 1 }), anon, "p")).toBe("unauthenticated");
    // Once any account exists, the open-token fallback is closed → anonymous is unauthenticated
    expect(await authorizeProjectWrite(depsWith({ userCount: 1, tokenCount: 0 }), anon, "p")).toBe("unauthenticated");
  });

  it("a project-scoped token authorizes its own project only", async () => {
    expect(await authorizeProjectWrite(depsWith(), tokenFor("p"), "p")).toBe("ok");
    // valid token used on a different project → forbidden (holder knows their token is valid)
    expect(await authorizeProjectWrite(depsWith(), tokenFor("p"), "other")).toBe("forbidden");
  });

  it("admin always; member needs maintainer+; viewer cannot write", async () => {
    expect(await authorizeProjectWrite(depsWith({ userCount: 1 }), admin, "p")).toBe("ok");
    expect(await authorizeProjectWrite(depsWith({ userCount: 1, membership: { role: "maintainer" } }), plainUser, "p")).toBe("ok");
    expect(await authorizeProjectWrite(depsWith({ userCount: 1, membership: { role: "owner" } }), plainUser, "p")).toBe("ok");
    // signed-in user with insufficient role → forbidden
    expect(await authorizeProjectWrite(depsWith({ userCount: 1, membership: { role: "viewer" } }), plainUser, "p")).toBe("forbidden");
    expect(await authorizeProjectWrite(depsWith({ userCount: 1, membership: null }), plainUser, "p")).toBe("forbidden");
  });
});

describe("authorizeProjectOwner", () => {
  it("admin or owner only; tokens and non-owners get forbidden; anonymous gets unauthenticated", async () => {
    expect(await authorizeProjectOwner(depsWith(), admin, "p")).toBe("ok");
    expect(await authorizeProjectOwner(depsWith({ membership: { role: "owner" } }), plainUser, "p")).toBe("ok");
    // signed-in maintainer (insufficient role) → forbidden
    expect(await authorizeProjectOwner(depsWith({ membership: { role: "maintainer" } }), plainUser, "p")).toBe("forbidden");
    // token principal → forbidden (project-scoped, not a person)
    expect(await authorizeProjectOwner(depsWith(), tokenFor("p"), "p")).toBe("forbidden");
    // anonymous → unauthenticated
    expect(await authorizeProjectOwner(depsWith(), anon, "p")).toBe("unauthenticated");
  });
});

describe("authorizeProjectCreate", () => {
  it("admin always; anonymous only in zero-config; tokens and non-admins get forbidden/unauthenticated", async () => {
    expect(await authorizeProjectCreate(depsWith({ userCount: 5 }), admin)).toBe("ok");
    // signed-in non-admin → forbidden
    expect(await authorizeProjectCreate(depsWith({ userCount: 1 }), plainUser)).toBe("forbidden");
    // anonymous in zero-config → ok
    expect(await authorizeProjectCreate(depsWith({ userCount: 0 }), anon)).toBe("ok");
    // anonymous with accounts → unauthenticated
    expect(await authorizeProjectCreate(depsWith({ userCount: 1 }), anon)).toBe("unauthenticated");
    // token → forbidden (project-scoped, cannot create projects)
    expect(await authorizeProjectCreate(depsWith(), tokenFor("p"))).toBe("forbidden");
  });
});

describe("requireAdmin", () => {
  it("only global admins pass; non-admin signed-in → forbidden; anonymous → unauthenticated", () => {
    expect(requireAdmin(admin)).toBe("ok");
    expect(requireAdmin(plainUser)).toBe("forbidden");
    expect(requireAdmin(anon)).toBe("unauthenticated");
    // tokens are not admins → forbidden (they are a known principal type, just not admin)
    expect(requireAdmin(tokenFor("p"))).toBe("forbidden");
  });
});
