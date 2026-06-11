import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Fails the build on serious/critical violations; logs everything else.
// The embedded Allure report iframe is third-party content — excluded.
// Users/Audit pages join the scan when an authed e2e fixture exists.
async function expectNoSeriousViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .exclude('iframe[title="report"]')
    .analyze();
  const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const minor = results.violations.filter((v) => v.impact !== "serious" && v.impact !== "critical");
  if (minor.length) console.log(`[a11y:${label}] non-blocking:`, minor.map((v) => `${v.id}(${v.impact}) ×${v.nodes.length}`).join(", "));
  expect(blocking.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target).slice(0, 3) })),
    `${label}: serious/critical a11y violations`).toEqual([]);
}

test("a11y: core pages have no serious violations", async ({ page }) => {
  await page.goto("/login");
  await expectNoSeriousViolations(page, "login");

  await page.goto("/");
  const id = `a11y-e2e-${Date.now()}`;
  await page.getByRole("button", { name: "New project" }).first().click();
  await page.getByLabel("Project id").fill(id);
  await page.getByRole("button", { name: "Create" }).click();
  // Wait for the dialog to close (the Create button disappears)
  await expect(page.getByRole("button", { name: "Create" })).toHaveCount(0);
  await expectNoSeriousViolations(page, "projects");

  await page.getByText(id).first().click();
  await expectNoSeriousViolations(page, "project:report");
  await page.getByRole("tab", { name: "Runs" }).click();
  await expectNoSeriousViolations(page, "project:runs");

  await page.goto(`/projects/${id}/settings`);
  await expectNoSeriousViolations(page, "settings");
});
