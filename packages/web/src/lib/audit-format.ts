import type { AuditAction, AuditEntry } from "@allure-station/shared";

type Describer = (e: AuditEntry) => string;

function meta(e: AuditEntry): Record<string, unknown> {
  return (e.metadata ?? {}) as Record<string, unknown>;
}

const DESCRIBERS: Record<AuditAction, Describer> = {
  login: (e) => `${e.actorLabel} logged in`,
  logout: (e) => `${e.actorLabel} logged out`,
  login_failed: (e) => `Failed login attempt for ${e.actorLabel}`,

  user_created: (e) => {
    const m = meta(e);
    const email = typeof m.email === "string" ? m.email : (e.targetId ?? "a user");
    const role = typeof m.role === "string" ? ` (${m.role})` : "";
    return `${e.actorLabel} created user ${email}${role}`;
  },
  user_deleted: (e) => {
    const email = e.targetId ?? "a user";
    return `${e.actorLabel} deleted user ${email}`;
  },

  token_created: (e) => {
    const m = meta(e);
    const name = typeof m.name === "string" ? ` "${m.name}"` : "";
    return `${e.actorLabel} created token${name} in ${e.projectId ?? "a project"}`;
  },
  token_deleted: (e) => {
    const m = meta(e);
    const name = typeof m.name === "string" ? ` "${m.name}"` : "";
    return `${e.actorLabel} revoked token${name} in ${e.projectId ?? "a project"}`;
  },

  member_set: (e) => {
    const m = meta(e);
    const role = typeof m.role === "string" ? ` as ${m.role}` : "";
    const email = e.targetId ?? "a user";
    return `${e.actorLabel} set ${email}${role} in ${e.projectId ?? "a project"}`;
  },
  member_removed: (e) => {
    const email = e.targetId ?? "a user";
    return `${e.actorLabel} removed ${email} from ${e.projectId ?? "a project"}`;
  },

  project_created: (e) => `${e.actorLabel} created project ${e.targetId ?? e.projectId ?? "a project"}`,
  project_deleted: (e) => `${e.actorLabel} deleted project ${e.targetId ?? e.projectId ?? "a project"}`,
  project_renamed: (e) => {
    const m = meta(e);
    const from = e.targetId ?? (typeof m.from === "string" ? m.from : "a project");
    const to = typeof m.to === "string" ? `"${m.to}"` : "a new name";
    return `${e.actorLabel} renamed ${from} to ${to}`;
  },
  project_visibility_set: (e) => {
    const m = meta(e);
    const vis = typeof m.visibility === "string" ? m.visibility : "unknown";
    return `${e.actorLabel} set ${e.projectId ?? e.targetId ?? "project"} visibility to ${vis}`;
  },

  quality_gate_set: (e) => `${e.actorLabel} updated quality gate for ${e.projectId ?? e.targetId ?? "a project"}`,

  notification_created: (e) => {
    const m = meta(e);
    const kind = typeof m.kind === "string" ? ` (${m.kind})` : "";
    return `${e.actorLabel} added notification${kind} to ${e.projectId ?? "a project"}`;
  },
  notification_deleted: (e) => `${e.actorLabel} removed notification from ${e.projectId ?? "a project"}`,

  password_changed: (e) => `${e.actorLabel} changed their password`,
  password_change_failed: (e) => `${e.actorLabel} failed a password change attempt`,
  session_revoked: (e) =>
    e.targetId === "all-others"
      ? `${e.actorLabel} signed out all other sessions${typeof (e.metadata as Record<string, unknown>)?.revoked === "number" ? ` (${(e.metadata as Record<string, unknown>).revoked})` : ""}`
      : `${e.actorLabel} revoked a session`,

  run_pruned: (e) => {
    const m = meta(e);
    const project = e.projectId ?? "a project";
    const reason = typeof m.reason === "string" ? ` (${m.reason === "retention_age" ? "age limit" : "count limit"})` : "";
    return `system pruned run ${e.targetId ?? "unknown"}${reason} in ${project}`;
  },
  retention_updated: (e) => `${e.actorLabel} updated retention policy for ${e.projectId ?? e.targetId ?? "a project"}`,

  run_deleted: (e) => {
    const m = meta(e);
    const project = e.projectId ?? "a project";
    const stats = m.stats as { total?: number; passed?: number; failed?: number } | undefined;
    let detail = "";
    if (stats && typeof stats.passed === "number" && typeof stats.total === "number") {
      detail = ` (${stats.passed}/${stats.total} passed`;
      if (typeof stats.failed === "number" && stats.failed > 0) {
        detail += `, ${stats.failed} failed`;
      }
      detail += ")";
    }
    const branch = typeof m.branch === "string" ? m.branch : null;
    const commit = typeof m.commit === "string" ? m.commit.slice(0, 7) : null;
    const ref = branch ? `, ${branch}${commit ? `@${commit}` : ""}` : "";
    return `${e.actorLabel} deleted run${detail}${ref} in ${project}`;
  },
};

/** Returns a human-readable sentence describing an audit log entry. */
export function describeAuditEntry(e: AuditEntry): string {
  const describer = DESCRIBERS[e.action];
  if (describer) return describer(e);
  // Fallback for unknown future actions
  return `${e.actorLabel} ${e.action.replace(/_/g, " ")}${e.targetId ? ` ${e.targetId}` : ""}`;
}
