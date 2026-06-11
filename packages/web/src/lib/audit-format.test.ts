import { describe, it, expect } from "vitest";
import { auditActionSchema, type AuditEntry } from "@allure-station/shared";
import { describeAuditEntry } from "./audit-format.js";

const base: AuditEntry = {
  id: "1",
  at: "2026-06-11T00:00:00.000Z",
  actorType: "user",
  actorId: "u1",
  actorLabel: "admin@example.com",
  action: "project_created",
  targetType: "project",
  targetId: "demo-web",
  projectId: "demo-web",
  metadata: null,
};

describe("describeAuditEntry", () => {
  it("has a human sentence for EVERY audit action", () => {
    for (const action of auditActionSchema.options) {
      const s = describeAuditEntry({ ...base, action });
      expect(s, action).toBeTruthy();
      expect(s, action).not.toContain("{");          // no JSON leakage
      expect(s.toLowerCase(), action).toContain(" "); // a sentence, not a token
    }
  });

  it("includes salient metadata", () => {
    expect(
      describeAuditEntry({
        ...base,
        action: "user_created",
        targetId: "u2",
        metadata: { email: "jane@example.com", role: "user" },
      })
    ).toBe("admin@example.com created user jane@example.com (user)");

    expect(
      describeAuditEntry({
        ...base,
        action: "project_renamed",
        metadata: { from: null, to: "Demo Web App" },
      })
    ).toBe('admin@example.com renamed demo-web to "Demo Web App"');
  });

  it("composes run_deleted with stats metadata", () => {
    const s = describeAuditEntry({
      ...base,
      action: "run_deleted",
      targetId: "r-abc",
      projectId: "proj",
      metadata: { status: "ready", stats: { total: 8, passed: 7, failed: 1 }, branch: "main", commit: "abc1234" },
    });
    expect(s).toContain("deleted");
    expect(s).not.toContain("{");
  });

  it("handles null targetId gracefully", () => {
    const s = describeAuditEntry({ ...base, action: "login", targetId: null, metadata: null });
    expect(s).toBeTruthy();
    expect(s).not.toContain("null");
  });
});
