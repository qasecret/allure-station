import { test, expect } from "@playwright/test";

/** Open the New Project dialog, fill in the id, and submit. Waits for the dialog to close. */
async function createProject(page: import("@playwright/test").Page, id: string) {
  // When the project list is empty an EmptyState also renders a "New project" button.
  // Always use .first() to target the topbar trigger reliably.
  await page.getByRole("button", { name: "New project" }).first().click();
  await page.getByLabel("Project id").fill(id);
  await page.getByRole("button", { name: "Create" }).click();
  // Wait for the dialog to close (the Create button disappears)
  await expect(page.getByRole("button", { name: "Create" })).toHaveCount(0);
}

test("create a project and open its (empty) page", async ({ page }) => {
  await page.goto("/");
  // The sidebar nav-link carries the accessible name "Allure Station home"; wait for it
  // to confirm the SPA has mounted before interacting.
  await expect(page.getByRole("link", { name: "Allure Station home" })).toBeVisible();

  // Unique id per run (Date.now is fine in the test runtime).
  const id = `e2e-${Date.now()}`;
  await createProject(page, id);

  // The new project card appears in the list and is navigable.
  const link = page.getByRole("link", { name: id });
  await expect(link).toBeVisible();
  await link.click();

  await expect(page.getByText("No ready report yet")).toBeVisible();
});

test("search filters the project list", async ({ page }) => {
  await page.goto("/");
  const a = `find-${Date.now()}-alpha`;
  const b = `find-${Date.now()}-beta`;
  for (const id of [a, b]) {
    await createProject(page, id);
    await expect(page.getByRole("link", { name: id })).toBeVisible();
  }
  await page.getByLabel("Search projects").fill("alpha");
  await expect(page.getByRole("link", { name: a })).toBeVisible();
  await expect(page.getByRole("link", { name: b })).toHaveCount(0);
});
