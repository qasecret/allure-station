import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createProject } from "./helpers.js";

// Fails the build on serious/critical violations; logs everything else.
// The embedded Allure report iframe is third-party content — excluded.
// Users/Audit pages join the scan when an authed e2e fixture exists.
// KNOWN DEBT (deferred to the polish sub-project): teal links/text now use the text-safe
// `text-primary-text` token (≥4.5:1 in both modes). Remaining debt is the status swatches
// used as TEXT — `text-status-pass`/`text-status-fail` glyphs and small status text are
// still ~3:1 on light backgrounds and will fail this gate once a scanned page renders them
// (e.g. a project page with failing runs). Fix shape: text-safe status tokens, same as teal.
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
  await createProject(page, id);
  await expectNoSeriousViolations(page, "projects");

  await page.getByText(id).first().click();
  await expectNoSeriousViolations(page, "project:report");
  await page.getByRole("tab", { name: "Runs" }).click();
  await expectNoSeriousViolations(page, "project:runs");

  await page.goto(`/projects/${id}/settings`);
  await expectNoSeriousViolations(page, "settings");
});
