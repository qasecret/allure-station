import { describe, it, expect, vi } from "vitest";
import { generateToken, hashToken, tokenPrefix, authorizeProjectWrite } from "./auth.js";
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

// Minimal deps stub exposing just the token surface authorizeProjectWrite uses.
function depsWith(tokensForHash: Record<string, { id: string; projectId: string }>, count: number): AppDeps {
  return {
    tokens: {
      countByProject: async () => count,
      findByHash: async (h: string) => tokensForHash[h] ?? null,
      touchLastUsed: vi.fn(async () => {}),
    },
    now: () => "2026-06-06T00:00:00.000Z",
  } as unknown as AppDeps;
}

describe("authorizeProjectWrite", () => {
  it("is open when the project has no tokens", async () => {
    expect(await authorizeProjectWrite(depsWith({}, 0), "p", undefined)).toBe("ok");
  });

  it("requires a token once any exist", async () => {
    const deps = depsWith({}, 1);
    expect(await authorizeProjectWrite(deps, "p", undefined)).toBe("unauthorized");
    expect(await authorizeProjectWrite(deps, "p", "Bearer nope")).toBe("unauthorized");
  });

  it("accepts a valid token scoped to the project and rejects a foreign-project token", async () => {
    const token = "ast_secret";
    const deps = depsWith({ [hashToken(token)]: { id: "t1", projectId: "p" } }, 1);
    expect(await authorizeProjectWrite(deps, "p", `Bearer ${token}`)).toBe("ok");
    expect(await authorizeProjectWrite(deps, "other", `Bearer ${token}`)).toBe("unauthorized");
  });
});
