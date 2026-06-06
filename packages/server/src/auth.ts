import { createHash, randomBytes } from "node:crypto";
import type { AppDeps } from "./app.js";

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

function parseBearer(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1] : null;
}

/**
 * Opt-in per-project authorization. A project with no tokens is open (zero-config dev mode); once it
 * has any token, writes require a valid bearer token scoped to that project. A token for project A
 * cannot authorize a write to project B.
 */
export async function authorizeProjectWrite(
  deps: AppDeps,
  projectId: string,
  header: string | undefined,
): Promise<"ok" | "unauthorized"> {
  if ((await deps.tokens.countByProject(projectId)) === 0) return "ok";
  const presented = parseBearer(header);
  if (!presented) return "unauthorized";
  const found = await deps.tokens.findByHash(hashToken(presented));
  if (!found || found.projectId !== projectId) return "unauthorized";
  void deps.tokens.touchLastUsed(found.id, deps.now()).catch(() => {});
  return "ok";
}
