import type { AuditAction, AuditActorType } from "@allure-station/shared";
import type { AppDeps } from "./app.js";
import type { Principal } from "./auth.js";

export interface AuditActor {
  actorType: AuditActorType;
  actorId: string | null;
  actorLabel: string;
}

/** Resolve the audit actor fields from a request Principal (email / token prefix / "anonymous"). */
export function actorFromPrincipal(principal: Principal): AuditActor {
  switch (principal.kind) {
    case "user":
      return { actorType: "user", actorId: principal.userId, actorLabel: principal.email };
    case "token":
      return { actorType: "token", actorId: principal.tokenId, actorLabel: `token:${principal.tokenId}` };
    case "anonymous":
      return { actorType: "anonymous", actorId: null, actorLabel: "anonymous" };
  }
}

/**
 * Append an audit entry. Best-effort: a logging failure must never fail the action that was already
 * performed, so errors are swallowed (the audit log is a record, not part of the transaction).
 */
export async function recordAudit(
  deps: AppDeps,
  entry: AuditActor & {
    action: AuditAction;
    targetType?: string | null;
    targetId?: string | null;
    projectId?: string | null;
    metadata?: Record<string, unknown> | null;
  },
): Promise<void> {
  try {
    await deps.audit.record(entry, deps.now());
  } catch {
    // best-effort
  }
}
