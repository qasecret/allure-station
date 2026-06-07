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
    expect(await authorizeProjectWrite(depsWith({ userCount: 0, tokenCount: 1 }), anon, "p")).toBe("unauthorized");
    // Once any account exists, the open-token fallback is closed even for a token-less project.
    expect(await authorizeProjectWrite(depsWith({ userCount: 1, tokenCount: 0 }), anon, "p")).toBe("unauthorized");
  });

  it("a project-scoped token authorizes its own project only", async () => {
    expect(await authorizeProjectWrite(depsWith(), tokenFor("p"), "p")).toBe("ok");
    expect(await authorizeProjectWrite(depsWith(), tokenFor("p"), "other")).toBe("unauthorized");
  });

  it("admin always; member needs maintainer+; viewer cannot write", async () => {
    expect(await authorizeProjectWrite(depsWith({ userCount: 1 }), admin, "p")).toBe("ok");
    expect(await authorizeProjectWrite(depsWith({ userCount: 1, membership: { role: "maintainer" } }), plainUser, "p")).toBe("ok");
    expect(await authorizeProjectWrite(depsWith({ userCount: 1, membership: { role: "owner" } }), plainUser, "p")).toBe("ok");
    expect(await authorizeProjectWrite(depsWith({ userCount: 1, membership: { role: "viewer" } }), plainUser, "p")).toBe("unauthorized");
    expect(await authorizeProjectWrite(depsWith({ userCount: 1, membership: null }), plainUser, "p")).toBe("unauthorized");
  });
});

describe("authorizeProjectOwner", () => {
  it("admin or owner only; tokens never qualify", async () => {
    expect(await authorizeProjectOwner(depsWith(), admin, "p")).toBe("ok");
    expect(await authorizeProjectOwner(depsWith({ membership: { role: "owner" } }), plainUser, "p")).toBe("ok");
    expect(await authorizeProjectOwner(depsWith({ membership: { role: "maintainer" } }), plainUser, "p")).toBe("unauthorized");
    expect(await authorizeProjectOwner(depsWith(), tokenFor("p"), "p")).toBe("unauthorized");
  });
});

describe("authorizeProjectCreate", () => {
  it("admin always; anonymous only in zero-config; tokens never", async () => {
    expect(await authorizeProjectCreate(depsWith({ userCount: 5 }), admin)).toBe("ok");
    expect(await authorizeProjectCreate(depsWith({ userCount: 1 }), plainUser)).toBe("unauthorized");
    expect(await authorizeProjectCreate(depsWith({ userCount: 0 }), anon)).toBe("ok");
    expect(await authorizeProjectCreate(depsWith({ userCount: 1 }), anon)).toBe("unauthorized");
    expect(await authorizeProjectCreate(depsWith(), tokenFor("p"))).toBe("unauthorized");
  });
});

describe("requireAdmin", () => {
  it("only global admins pass", () => {
    expect(requireAdmin(admin)).toBe("ok");
    expect(requireAdmin(plainUser)).toBe("unauthorized");
    expect(requireAdmin(anon)).toBe("unauthorized");
    expect(requireAdmin(tokenFor("p"))).toBe("unauthorized");
  });
});
