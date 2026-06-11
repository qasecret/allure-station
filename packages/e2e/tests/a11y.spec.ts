import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createProjectWithRun, uploadResults, waitForReady } from "./helpers.js";

// Fails the build on serious/critical violations; logs everything else.
// The embedded Allure report iframe is third-party content — excluded.
// Users/Audit pages join the scan when an authed e2e fixture exists.
// Status-as-text debt resolved: all three status-*-text tokens (pass/fail/broken) were
// darkened to meet WCAG AA (≥4.5:1) in both themes (2026-06-11, axe scan on a populated
// project page). The gate now scans a project page with two real runs — trend chart, status
// badges, and run rows are all present. No known remaining a11y debt.
async function expectNoSeriousViolations(page: Page, label: string) {
  await page.mouse.move(0, 0);
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

  // Create project with TWO runs so the TrendChart renders (requires ≥2 runs).
  // createProjectWithRun ends on the Runs tab with one Ready run.
  await createProjectWithRun(page, id);

  // Upload and wait for a second run so the trend chart is visible.
  await uploadResults(page);
  await waitForReady(page);

  // Navigate to the project Report tab — trend chart now renders with ≥2 runs.
  await page.getByRole("tab", { name: "Report" }).click();
  // Assert the chart is present before scanning, not race-dependent.
  await expect(page.locator('svg[role="group"]')).toBeVisible();
  await expectNoSeriousViolations(page, "project:report");

  // Projects list scan
  await page.goto("/");
  await expectNoSeriousViolations(page, "projects");

  // Runs tab scan
  await page.getByText(id).first().click();
  await page.getByRole("tab", { name: "Runs" }).click();
  await expectNoSeriousViolations(page, "project:runs");

  await page.goto(`/projects/${id}/settings`);
  await expectNoSeriousViolations(page, "settings");
});
