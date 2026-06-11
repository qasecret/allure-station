import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { Page } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
// Minimal allure-result fixture — one passing test, used to generate a real report.
const FIXTURE = resolve(here, "../fixtures/00000000-0000-0000-0000-000000000001-result.json");

/** Open the New Project dialog, fill in the id (and optional display name), then submit. */
async function createProject(page: Page, id: string, displayName?: string) {
  // When the project list is empty, there are two "New project" buttons (topbar + EmptyState).
  // Use .first() to reliably target the topbar trigger.
  await page.getByRole("button", { name: "New project" }).first().click();
  await page.getByLabel("Project id").fill(id);
  if (displayName) {
    await page.getByLabel("Display name").fill(displayName);
  }
  // Click the "Create" button inside the dialog.
  await page.getByRole("button", { name: "Create" }).click();
  // Wait for the dialog to close.
  await expect(page.getByRole("button", { name: "Create" })).toHaveCount(0);
}

/** Upload the fixture file and submit via the UploadDialog, filling optional CI metadata. */
async function uploadResults(
  page: Page,
  opts: { branch?: string; commit?: string } = {}
) {
  // Click the trigger button to open the Upload dialog.
  await page.getByRole("button", { name: "Upload & generate" }).click();

  // Set the fixture file on the file input.
  await page.getByLabel("Allure result files").setInputFiles(FIXTURE);

  // Open the CI context section and fill in metadata if provided.
  if (opts.branch || opts.commit) {
    await page.getByText("Add CI context (optional)").click();
    if (opts.branch) await page.getByLabel("Branch").fill(opts.branch);
    if (opts.commit) await page.getByLabel("Commit").fill(opts.commit);
  }

  // Click the submit button inside the dialog (same text as the trigger, but inside the dialog overlay).
  // The dialog is open so the DialogContent is mounted — use the button inside the dialog footer.
  await page.getByRole("button", { name: "Upload & generate" }).last().click();
  // Wait for the dialog to close — the file input disappears when the dialog unmounts.
  await expect(page.getByLabel("Allure result files")).toHaveCount(0, { timeout: 10_000 });
}

/** Wait for the run table to show a "Ready" status badge (polls the Runs tab). */
async function waitForReady(page: Page) {
  // The Runs tab auto-refreshes every 5 s while generating; we wait up to 60 s.
  // Use the badge inside the TabsContent for "runs" to avoid matching the filter chip or RunSelector.
  await expect(
    page.getByRole("tabpanel").getByText("Ready", { exact: true }).first()
  ).toBeVisible({ timeout: 60_000 });
}

test("ux fix pack: name, metadata, runs tab, deep link, delete, trend hint", async ({ page }) => {
  // Give this test plenty of room — generation + Allure embed takes a few seconds.
  test.setTimeout(120_000);

  await page.goto("/");

  // ① Create project with a display name.
  const id = `ux-e2e-${Date.now()}`;
  await createProject(page, id, "UX E2E");
  // The card should show the display name prominently.
  await expect(page.getByText("UX E2E")).toBeVisible();

  // Navigate to the project page.
  await page.getByText("UX E2E").click();

  // ⑤ Trend empty-state before any runs.
  await expect(
    page.getByText(/Trends appear after 2 successful runs/)
  ).toBeVisible();

  // ④ Upload with CI context.
  await uploadResults(page, { branch: "main", commit: "e2e1234" });

  // Switch to the Runs tab to watch progress.
  await page.getByRole("tab", { name: "Runs" }).click();

  // Wait for the run to reach "Ready".
  await waitForReady(page);

  // ③ Runs tab lists the run with branch@commit metadata.
  await expect(page.getByRole("cell", { name: /main@e2e1234/ })).toBeVisible();

  // ⑥ Click "Open" — switches to Report tab and sets ?run= in the URL.
  await page.getByRole("button", { name: "Open" }).first().click();
  await expect(page).toHaveURL(/run=/);

  // ⑦ Deep-link restore: capture the URL, navigate away, then navigate back and verify.
  const deepLink = page.url();
  await page.goto("/");
  await page.goto(deepLink);
  // The URL should still carry the ?run= param.
  await expect(page).toHaveURL(/run=/);
  // The branch chip for the run we opened should be visible again.
  await expect(page.getByText(/main@e2e1234/).first()).toBeVisible();

  // Re-acquire the Runs tab locator after the page reload.
  // ② Delete the run from the Runs tab.
  await page.getByRole("tab", { name: "Runs" }).click();
  await page.getByRole("button", { name: "Delete" }).first().click();
  // Confirm the deletion in the dialog.
  await page.getByRole("button", { name: "Delete run" }).click();
  // The table should now be empty.
  await expect(page.getByText(/No runs/)).toBeVisible();
});
