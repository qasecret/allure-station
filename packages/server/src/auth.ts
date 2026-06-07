import { createHash, randomBytes } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { GlobalRole, ProjectRole } from "@allure-station/shared";
import type { AppDeps } from "./app.js";

export const SESSION_COOKIE = "as_session";

/** Who is making a request, resolved by {@link authenticate} from cookie session or bearer token. */
export type Principal =
  | { kind: "anonymous" }
  | { kind: "token"; projectId: string; tokenId: string }
  | { kind: "user"; userId: string; email: string; role: GlobalRole; createdAt: string };

/** Generate a new plaintext API token. High-entropy → safe to compare via sha256 hash equality. */
export function generateToken(): string {
  return `ast_${randomBytes(24).toString("base64url")}`;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** First 12 chars, stored for display ("which token is this") without revealing the secret. */
export function tokenPrefix(token: string): string {
  return token.slice(0, 12);
}

/** Opaque, high-entropy session cookie value. Stored hashed in the DB (see {@link hashSessionToken}). */
export function generateSessionToken(): string {
  return randomBytes(24).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function parseBearer(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1] : null;
}

const PROJECT_RANK: Record<ProjectRole, number> = { viewer: 1, maintainer: 2, owner: 3 };

/**
 * Resolve the principal for a request. Cookie session wins over bearer token (a logged-in human acts
 * as themselves even if a stray Authorization header is present). Anonymous when neither is valid.
 */
export async function authenticate(deps: AppDeps, req: FastifyRequest): Promise<Principal> {
  const cookie = req.cookies?.[SESSION_COOKIE];
  if (cookie) {
    const session = await deps.sessions.findByHash(hashSessionToken(cookie));
    if (session && session.expiresAt > deps.now()) {
      const user = await deps.users.findById(session.userId);
      if (user) return { kind: "user", userId: user.id, email: user.email, role: user.role, createdAt: user.createdAt };
    }
  }
  const bearer = parseBearer(req.headers.authorization);
  if (bearer) {
    const token = await deps.tokens.findByHash(hashToken(bearer));
    if (token) {
      void deps.tokens.touchLastUsed(token.id, deps.now()).catch(() => {});
      return { kind: "token", projectId: token.projectId, tokenId: token.id };
    }
  }
  return { kind: "anonymous" };
}

async function userProjectRank(deps: AppDeps, userId: string, projectId: string): Promise<number> {
  const m = await deps.memberships.find(projectId, userId);
  return m ? PROJECT_RANK[m.role] : 0;
}

/**
 * Authorize a project write/management action (send-results, generate, quality-gate, notifications,
 * token CRUD, project delete). Granted to: a global admin, a member with maintainer+ on the project,
 * a valid API token scoped to the project, or — only when NO accounts exist and the project has no
 * tokens — anonymous (zero-config dev mode, preserving pre-5b behavior). Once any user exists, the
 * open-token fallback is disabled so a token-less project isn't world-writable.
 */
export async function authorizeProjectWrite(
  deps: AppDeps,
  principal: Principal,
  projectId: string,
): Promise<"ok" | "unauthorized"> {
  switch (principal.kind) {
    case "user":
      if (principal.role === "admin") return "ok";
      return (await userProjectRank(deps, principal.userId, projectId)) >= PROJECT_RANK.maintainer ? "ok" : "unauthorized";
    case "token":
      return principal.projectId === projectId ? "ok" : "unauthorized";
    case "anonymous": {
      if ((await deps.users.count()) > 0) return "unauthorized";
      return (await deps.tokens.countByProject(projectId)) === 0 ? "ok" : "unauthorized";
    }
  }
}

/** Authorize member management — owner-level, session-only (API tokens never manage members). */
export async function authorizeProjectOwner(
  deps: AppDeps,
  principal: Principal,
  projectId: string,
): Promise<"ok" | "unauthorized"> {
  if (principal.kind !== "user") return "unauthorized";
  if (principal.role === "admin") return "ok";
  return (await userProjectRank(deps, principal.userId, projectId)) >= PROJECT_RANK.owner ? "ok" : "unauthorized";
}

/**
 * Authorize project creation. Global admin always; anonymous only in zero-config mode (no accounts).
 * Tokens are project-scoped credentials and cannot create projects.
 */
export async function authorizeProjectCreate(deps: AppDeps, principal: Principal): Promise<"ok" | "unauthorized"> {
  if (principal.kind === "user") return principal.role === "admin" ? "ok" : "unauthorized";
  if (principal.kind === "token") return "unauthorized";
  return (await deps.users.count()) === 0 ? "ok" : "unauthorized";
}

/** Global-admin gate (user management). */
export function requireAdmin(principal: Principal): "ok" | "unauthorized" {
  return principal.kind === "user" && principal.role === "admin" ? "ok" : "unauthorized";
}

// --- Request-level convenience wrappers (authenticate + authorize in one call) ---

export async function requireProjectWrite(deps: AppDeps, req: FastifyRequest, projectId: string): Promise<"ok" | "unauthorized"> {
  return authorizeProjectWrite(deps, await authenticate(deps, req), projectId);
}

export async function requireProjectOwner(deps: AppDeps, req: FastifyRequest, projectId: string): Promise<"ok" | "unauthorized"> {
  return authorizeProjectOwner(deps, await authenticate(deps, req), projectId);
}
