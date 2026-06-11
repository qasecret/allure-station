import { test, expect } from "@playwright/test";
import { createProjectWithRun, visible } from "./helpers.js";

test.use({ viewport: { width: 375, height: 812 } });

test("mobile: runs tab renders card rows with reachable actions", async ({ page }) => {
  test.setTimeout(120_000);

  const id = `mobile-runs-${Date.now()}`;
  await createProjectWithRun(page, id);
  // createProjectWithRun already clicks the Runs tab and waits for Ready
  await expect(page.getByRole("table")).toBeHidden();           // table hidden below sm
  const open = visible(page.getByRole("button", { name: "Open" }));
  await expect(open).toBeVisible();
  const box = await open.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(375);          // action on screen, not behind scroll
});

test("mobile: report focus mode hides the header cards", async ({ page }) => {
  test.setTimeout(120_000);

  const id = `mobile-focus-${Date.now()}`;
  await createProjectWithRun(page, id);
  // Switch back to the Report tab (createProjectWithRun ends on Runs tab).
  await page.getByRole("tab", { name: "Report" }).click();
  await expect(visible(page.getByText(/Trends appear/))).toBeVisible();
  await page.getByRole("button", { name: "Focus report" }).click();
  await expect(page.getByText(/Trends appear/)).toBeHidden();
  await page.getByRole("button", { name: "Focus report" }).click();
  await expect(visible(page.getByText(/Trends appear/))).toBeVisible();
});

test("mobile: drawer opens and topbar controls stay tappable", async ({ page }) => {
  test.setTimeout(120_000);

  const id = `mobile-e2e-${Date.now()}`;
  await createProjectWithRun(page, id);

  // Every topbar control must be fully inside the 375 px viewport.
  for (const name of ["Open menu", /Upload/] as const) {
    const el = page.getByRole("button", { name }).first();
    const box = await el.boundingBox();
    expect(box, `button ${String(name)} should be on screen`).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
  }

  // The run selector must also fit within the viewport.
  const selector = page.getByLabel("Select run to view");
  const sbox = await selector.boundingBox();
  expect(sbox, "run selector should be on screen").not.toBeNull();
  expect(sbox!.x).toBeGreaterThanOrEqual(0);
  expect(sbox!.x + sbox!.width).toBeLessThanOrEqual(375);

  // No horizontal page overflow. Strict check across both metrics: with the runs-table scroll
  // wrapper positioned (relative), absolutely-positioned descendants (e.g. sr-only spans) are
  // clipped by it, so documentElement.scrollWidth stays honest too.
  const overflow = await page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // The mobile drawer opens and exposes navigation links.
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByRole("link", { name: "Projects" })).toBeVisible();
  // Click the Projects link — the navigation should close the drawer.
  await page.getByRole("dialog").getByRole("link", { name: "Projects" }).click();
  await expect(page).toHaveURL(/\/$/);
  // After navigating, the drawer dialog should be hidden.
  await expect(page.getByRole("dialog")).toBeHidden();
});
