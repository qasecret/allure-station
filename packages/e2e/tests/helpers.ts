import { expect, type Locator, type Page } from "@playwright/test";
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
