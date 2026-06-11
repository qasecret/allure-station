import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { Page } from "@playwright/test";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, "../fixtures/00000000-0000-0000-0000-000000000001-result.json");

test.use({ viewport: { width: 375, height: 812 } });

/** Create a project, upload fixture, wait for Ready. Mirrors ux-fixes.spec.ts helper style. */
async function createProjectWithRun(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "New project" }).first().click();
  await page.getByLabel("Project id").fill("mobile-e2e");
  await page.getByRole("button", { name: "Create" }).click();
  // Wait for the dialog to close.
  await expect(page.getByRole("button", { name: "Create" })).toHaveCount(0);
  // Navigate to the newly-created project.
  await page.getByText("mobile-e2e").first().click();
  // Open the Upload dialog via the trigger button.
  await page.getByRole("button", { name: /Upload/ }).first().click();
  // Set the fixture file on the labelled file input.
  await page.getByLabel("Allure result files").setInputFiles(FIXTURE);
  // Submit via the dialog's internal footer button (last "Upload" button on the page).
  await page.getByRole("button", { name: /Upload & generate/ }).last().click();
  // Wait for the dialog to close.
  await expect(page.getByLabel("Allure result files")).toHaveCount(0, { timeout: 10_000 });
  // Switch to the Runs tab and wait for the run to reach "Ready".
  await page.getByRole("tab", { name: "Runs" }).click();
  await expect(
    page.getByRole("tabpanel").getByText("Ready", { exact: true }).first()
  ).toBeVisible({ timeout: 60_000 });
}

test("mobile: drawer navigates and topbar controls stay tappable", async ({ page }) => {
  test.setTimeout(120_000);

  await createProjectWithRun(page);

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
  expect(sbox!.x + sbox!.width).toBeLessThanOrEqual(375);

  // No horizontal page overflow — body.scrollWidth is the authoritative measure;
  // documentElement.scrollWidth can be inflated by overflow:auto scroll containers (Chromium quirk).
  const overflow = await page.evaluate(
    () => document.body.scrollWidth - window.innerWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // The mobile drawer opens and exposes navigation links.
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByRole("link", { name: "Projects" })).toBeVisible();
  await page.keyboard.press("Escape");
});
