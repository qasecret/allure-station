import { test, expect } from "@playwright/test";

test("create a project and open its (empty) page", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Allure Station" })).toBeVisible();

  // Unique id per run (Date.now is fine in the test runtime).
  const id = `e2e-${Date.now()}`;
  await page.getByLabel("New project id").fill(id);
  await page.getByRole("button", { name: "Create" }).click();

  // The new project appears in the list and is navigable.
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
    await page.getByLabel("New project id").fill(id);
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByRole("link", { name: id })).toBeVisible();
  }
  await page.getByLabel("Search projects").fill("alpha");
  await expect(page.getByRole("link", { name: a })).toBeVisible();
  await expect(page.getByRole("link", { name: b })).toHaveCount(0);
});
