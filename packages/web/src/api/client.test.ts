import { describe, it, expect, vi } from "vitest";
import { createClient } from "./client.js";

describe("api client", () => {
  it("lists projects via GET /projects", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, json: async () => [{ id: "p", createdAt: "x", latestRunId: null }],
    });
    const client = createClient("/api", fetchMock as unknown as typeof fetch);
    const projects = await client.listProjects();
    expect(fetchMock).toHaveBeenCalledWith("/api/projects", expect.objectContaining({ method: "GET" }));
    expect(projects[0].id).toBe("p");
  });

  it("throws on non-ok responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "boom" });
    const client = createClient("/api", fetchMock as unknown as typeof fetch);
    await expect(client.listProjects()).rejects.toThrow("500");
  });
});
