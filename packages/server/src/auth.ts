import { createHash, randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { GlobalRole, ProjectRole, ProjectVisibility } from "@allure-station/shared";
import type { AppDeps } from "./app.js";
import type { VisibilityScope } from "./db/repositories.js";

export const SESSION_COOKIE = "as_session";

/** Authorization verdict: distinguish "who are you?" (401) from "you may not" (403).
 *  Anonymous principals (including invalid/expired bearer tokens, which authenticate()
 *  resolves to anonymous — deliberate no-oracle) → unauthenticated. A known principal
 *  (session user or valid token) with insufficient role/scope → forbidden. */
export type AuthzVerdict = "ok" | "unauthenticated" | "forbidden";

/** Map a non-ok verdict onto the HTTP reply. Usage: if (v !== "ok") return denyAuth(reply, v); */
export function denyAuth(reply: FastifyReply, verdict: Exclude<AuthzVerdict, "ok">) {
  return verdict === "unauthenticated"
    ? reply.code(401).send({ error: "unauthenticated" })
    : reply.code(403).send({ error: "forbidden" });
}

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
    if (token && (token.expiresAt === null || token.expiresAt > deps.now())) {
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
): Promise<AuthzVerdict> {
  switch (principal.kind) {
    case "user":
      if (principal.role === "admin") return "ok";
      return (await userProjectRank(deps, principal.userId, projectId)) >= PROJECT_RANK.maintainer ? "ok" : "forbidden";
    case "token":
      return principal.projectId === projectId ? "ok" : "forbidden";
    case "anonymous": {
      if ((await deps.users.count()) > 0) return "unauthenticated";
      return (await deps.tokens.countByProject(projectId)) === 0 ? "ok" : "unauthenticated";
    }
  }
}

/** Authorize member management — owner-level, session-only (API tokens never manage members). */
export async function authorizeProjectOwner(
  deps: AppDeps,
  principal: Principal,
  projectId: string,
): Promise<AuthzVerdict> {
  if (principal.kind === "anonymous") return "unauthenticated";
  if (principal.kind === "token") return "forbidden"; // tokens are project-scoped credentials, cannot manage members
  if (principal.role === "admin") return "ok";
  return (await userProjectRank(deps, principal.userId, projectId)) >= PROJECT_RANK.owner ? "ok" : "forbidden";
}

/**
 * Authorize project creation. Global admin always; anonymous only in zero-config mode (no accounts).
 * Tokens are project-scoped credentials and cannot create projects.
 */
export async function authorizeProjectCreate(deps: AppDeps, principal: Principal): Promise<AuthzVerdict> {
  if (principal.kind === "user") return principal.role === "admin" ? "ok" : "forbidden";
  if (principal.kind === "token") return "forbidden"; // tokens are project-scoped, cannot create projects
  return (await deps.users.count()) === 0 ? "ok" : "unauthenticated";
}

/** Global-admin gate (user management). */
export function requireAdmin(principal: Principal): AuthzVerdict {
  if (principal.kind === "anonymous") return "unauthenticated";
  return principal.kind === "user" && principal.role === "admin" ? "ok" : "forbidden";
}

/**
 * Authorize READING a project. Public projects are readable by anyone; a private project requires a
 * global admin, a member (viewer+), or a project token scoped to it. Anonymous is denied.
 */
export async function authorizeProjectRead(
  deps: AppDeps,
  principal: Principal,
  project: { id: string; visibility: ProjectVisibility },
): Promise<"ok" | "unauthorized"> {
  if (project.visibility !== "private") return "ok";
  switch (principal.kind) {
    case "user":
      return principal.role === "admin" || (await userProjectRank(deps, principal.userId, project.id)) >= PROJECT_RANK.viewer ? "ok" : "unauthorized";
    case "token":
      return principal.projectId === project.id ? "ok" : "unauthorized";
    case "anonymous":
      return "unauthorized";
  }
}

/** The set of projects a principal may see in a listing (drives ProjectRepository list/count filter). */
export async function visibilityScopeFor(deps: AppDeps, principal: Principal): Promise<VisibilityScope> {
  if (principal.kind === "user") {
    if (principal.role === "admin") return { mode: "all" };
    return { mode: "member", projectIds: await deps.memberships.listProjectIdsForUser(principal.userId) };
  }
  return { mode: "public" }; // anonymous or token
}

// --- Request-level convenience wrappers (authenticate + authorize in one call) ---

export async function requireProjectWrite(deps: AppDeps, req: FastifyRequest, projectId: string): Promise<AuthzVerdict> {
  return authorizeProjectWrite(deps, await authenticate(deps, req), projectId);
}

export async function requireProjectOwner(deps: AppDeps, req: FastifyRequest, projectId: string): Promise<AuthzVerdict> {
  return authorizeProjectOwner(deps, await authenticate(deps, req), projectId);
}
