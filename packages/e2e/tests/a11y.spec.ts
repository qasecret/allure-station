import { test, expect } from "@playwright/test";
import { createProjectWithRun, expectNoSeriousViolations, uploadResults, waitForReadyCount } from "./helpers.js";

// Fails the build on serious/critical violations (expectNoSeriousViolations in helpers.ts);
// the embedded Allure report iframe is third-party content — excluded.
// Users/Audit pages are scanned by authed.spec.ts (the "authed" Playwright project, which
// runs against a secure-mode server with a seeded admin).
// Status-as-text debt resolved: all three status-*-text tokens (pass/fail/broken) were
// darkened to meet WCAG AA (≥4.5:1) in both themes (2026-06-11, axe scan on a populated
// project page). The gate now scans a project page with two real runs — trend chart, status
// badges, and run rows are all present. No known remaining a11y debt.

test("a11y: core pages have no serious violations", async ({ page }) => {
  await page.goto("/login");
  await expectNoSeriousViolations(page, "login");

  await page.goto("/");
  const id = `a11y-e2e-${Date.now()}`;

  // Create project with TWO runs so the TrendChart renders (requires ≥2 runs).
  // createProjectWithRun ends on the Runs tab with one Ready run.
  await createProjectWithRun(page, id);

  // Upload and wait for a second run so the trend chart is visible.
  // waitForReadyCount is deterministic: waitForReady would match run 1's badge and return early.
  await uploadResults(page);
  await waitForReadyCount(page, 2);

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
