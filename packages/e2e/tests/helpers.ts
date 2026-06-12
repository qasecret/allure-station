import { expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
/** Minimal allure-result fixture — one passing test, used to generate a real report. */
export const FIXTURE = resolve(here, "../fixtures/00000000-0000-0000-0000-000000000001-result.json");

/** Dual-render rule: some views render desktop (table) and mobile (card) copies of the
 *  same content in the DOM simultaneously, toggled purely with CSS (`sm:hidden` /
 *  `hidden sm:block`). `visible=true` scopes a locator to the DOM-visible copy only, so
 *  assertions don't trip Playwright strict mode on the hidden duplicate — and stay
 *  honest at any viewport. */
export function visible(locator: Locator): Locator {
  return locator.locator("visible=true").first();
}

/** Open the New Project dialog, fill in the id (and optional display name), then submit.
 *  Waits for the dialog to close. */
export async function createProject(page: Page, id: string, displayName?: string) {
  // When the project list is empty an EmptyState also renders a "New project" button.
  // Always use .first() to target the topbar trigger reliably.
  await page.getByRole("button", { name: "New project" }).first().click();
  await page.getByLabel("Project id").fill(id);
  if (displayName) {
    await page.getByLabel("Display name").fill(displayName);
  }
  await page.getByRole("button", { name: "Create" }).click();
  // Wait for the dialog to close (the Create button disappears).
  await expect(page.getByRole("button", { name: "Create" })).toHaveCount(0);
}

/** Upload the fixture file and submit via the UploadDialog, filling optional CI metadata.
 *  The trigger button reads "Upload & generate" on desktop but just "Upload" below `sm`,
 *  so the trigger is matched with /Upload/ to work at any viewport. */
export async function uploadResults(
  page: Page,
  opts: { branch?: string; commit?: string } = {}
) {
  // Click the trigger button to open the Upload dialog.
  await page.getByRole("button", { name: /Upload/ }).first().click();

  // Set the fixture file on the labelled file input.
  await page.getByLabel("Allure result files").setInputFiles(FIXTURE);

  // Open the CI context section and fill in metadata if provided.
  if (opts.branch || opts.commit) {
    await page.getByText("Add CI context (optional)").click();
    if (opts.branch) await page.getByLabel("Branch").fill(opts.branch);
    if (opts.commit) await page.getByLabel("Commit").fill(opts.commit);
  }

  // Submit via the dialog's internal footer button (same text as the desktop trigger,
  // but inside the dialog overlay — use .last() to pick the footer button).
  await page.getByRole("button", { name: /Upload & generate/ }).last().click();
  // Wait for the dialog to close — the file input disappears when the dialog unmounts.
  await expect(page.getByLabel("Allure result files")).toHaveCount(0, { timeout: 10_000 });
}

/** Wait for the run table to show a "Ready" status badge (the Runs tab must be active).
 *  The Runs tab auto-refreshes every 5 s while generating; we wait up to 60 s.
 *  Scoped to the tabpanel to avoid matching the filter chip or RunSelector. */
export async function waitForReady(page: Page) {
  await expect(
    visible(page.getByRole("tabpanel").getByText("Ready", { exact: true }))
  ).toBeVisible({ timeout: 60_000 });
}

/** Wait until the Runs tab lists exactly `n` Ready runs — deterministic across multiple
 *  uploads (waitForReady alone matches the FIRST badge and returns early for run 2+).
 *  Clicks onto the Runs tab itself, counts the DOM-visible "Ready" badges in the tabpanel
 *  (so the hidden mobile/desktop duplicate and the filter chip / RunSelector don't count),
 *  then clicks back to the Report tab. */
export async function waitForReadyCount(page: Page, n: number): Promise<void> {
  await page.getByRole("tab", { name: "Runs" }).click();
  await expect(
    page.getByRole("tabpanel").getByText("Ready", { exact: true }).locator("visible=true")
  ).toHaveCount(n, { timeout: 60_000 });
  await page.getByRole("tab", { name: "Report" }).click();
}

/** Axe gate: fails the test on serious/critical violations; logs everything else.
 *  The embedded Allure report iframe is third-party content — excluded.
 *  Shared by a11y.spec.ts (open mode) and authed.spec.ts (users/audit pages).
 *  Waits for CSS animations to complete (fade-in: --motion-fast = 150 ms) before
 *  scanning so opacity keyframes don't artificially fail contrast checks. */
export async function expectNoSeriousViolations(page: Page, label: string) {
  await page.mouse.move(0, 0);
  // Let enter-animations (--motion-fast = 150 ms) finish before axe measures contrast.
  // Infinite-iteration animations (animate-pulse, animate-spin) are never "done" — exclude
  // them from the "still running" check so we don't silently degrade to a 2 s sleep.
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => {
      if (a.playState !== "running") return true;
      return a.effect?.getTiming().iterations === Infinity; // pulse/spin never end — ignore
    }),
  { timeout: 2000 }).catch(() => {});
  const results = await new AxeBuilder({ page })
    .exclude('iframe[title="report"]')
    .analyze();
  const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const minor = results.violations.filter((v) => v.impact !== "serious" && v.impact !== "critical");
  if (minor.length) console.log(`[a11y:${label}] non-blocking:`, minor.map((v) => `${v.id}(${v.impact}) ×${v.nodes.length}`).join(", "));
  expect(blocking.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target).slice(0, 3) })),
    `${label}: serious/critical a11y violations`).toEqual([]);
}

/** Create a project, upload the fixture, and wait for the run to reach "Ready".
 *  Ends on the Runs tab. */
export async function createProjectWithRun(page: Page, id: string) {
  await page.goto("/");
  await createProject(page, id);
  // Navigate to the newly-created project.
  await page.getByText(id).first().click();
  await uploadResults(page);
  // Switch to the Runs tab and wait for the run to reach "Ready".
  await page.getByRole("tab", { name: "Runs" }).click();
  await waitForReady(page);
}
