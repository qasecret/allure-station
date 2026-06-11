import { test, expect } from "@playwright/test";
import { createProject, uploadResults, waitForReady, visible } from "./helpers.js";

test("ux fix pack: name, metadata, runs tab, deep link, delete, trend hint", async ({ page }) => {
  // Give this test plenty of room — generation + Allure embed takes a few seconds.
  test.setTimeout(120_000);

  await page.goto("/");

  // ① Create project with a display name — unique per run to prevent strict-mode
  //   duplicates on unwiped .e2e-data (re-run isolation).
  const id = `ux-e2e-${Date.now()}`;
  const name = `UX E2E ${Date.now()}`;
  await createProject(page, id, name);
  // The card should show the display name prominently.
  await expect(page.getByText(name)).toBeVisible();

  // Navigate to the project page.
  await page.getByText(name).click();

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
  await visible(page.getByRole("button", { name: "Open" })).click();
  await expect(page).toHaveURL(/run=/);

  // ⑦ Deep-link restore: capture the URL, navigate away, then navigate back and verify.
  const deepLink = page.url();
  await page.goto("/");
  await page.goto(deepLink);
  // The URL should still carry the ?run= param.
  await expect(page).toHaveURL(/run=/);
  // The branch chip for the run we opened should be visible again.
  await expect(visible(page.getByText(/main@e2e1234/))).toBeVisible();

  // Re-acquire the Runs tab locator after the page reload.
  // ② Delete the run from the Runs tab.
  await page.getByRole("tab", { name: "Runs" }).click();
  await visible(page.getByRole("button", { name: "Delete" })).click();
  // Confirm the deletion in the dialog.
  await page.getByRole("button", { name: "Delete run" }).click();
  // The table should now be empty.
  await expect(visible(page.getByText(/No runs/))).toBeVisible();
});
