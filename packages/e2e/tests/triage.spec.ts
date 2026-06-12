/**
 * Triage journey: instance status strip → worst-first sort → project stats tiles →
 * trend chart → sortable runs table.
 *
 * NOTE — audit legs omitted:
 * The global audit (/audit) and the per-project audit card in ProjectSettings are
 * both gated behind an admin session in secure mode.  In OPEN mode (no
 * ADMIN_EMAIL/ADMIN_PASSWORD) the settings page shows all functional cards but
 * Members and Audit are displayed with an "enable accounts" note — there is no
 * renderable audit table to assert against without an authenticated session.
 * The humanized audit sentence (describeAuditEntry) and filter/CSV logic are
 * fully covered by the audit-format unit tests in packages/web/src/lib.
 * The audit leg lives in authed.spec.ts (the "authed" Playwright project, which runs
 * against a secure-mode server with a seeded admin): humanized sentences + action filter.
 */
import { test, expect } from "@playwright/test";
import { createProjectWithRun, uploadResults, waitForReadyCount, visible, expectNoSeriousViolations } from "./helpers.js";

test.setTimeout(120_000);

test("triage: strip → worst-first sort → stats tiles → trend chart → sorted runs", async ({ page }) => {
  // --- Project A: healthy baseline (passing fixture) ---
  const idA = `triage-a-${Date.now()}`;
  await createProjectWithRun(page, idA);
  // Upload a second result so the trend chart renders (needs ≥2 ready runs).
  // waitForReadyCount is deterministic: waitForReady would match run 1's badge and return early.
  await uploadResults(page);
  await waitForReadyCount(page, 2);

  // --- Project B: separate project (also passing fixture — sort is structural not failure-based) ---
  const idB = `triage-b-${Date.now()}`;
  await page.goto("/");
  await createProjectWithRun(page, idB);

  // ── Home page: Instance status strip ──────────────────────────────────────────
  await page.goto("/");
  await expect(page.getByRole("group", { name: "Instance status" })).toBeVisible();
  // The strip tiles render with numbers (data loaded within timeout)
  const strip = page.getByRole("group", { name: "Instance status" });
  await expect(strip.getByText("Runs (24h)")).toBeVisible();
  await expect(strip.getByText("Generating")).toBeVisible();

  // ── Sort select: write sort=worst to the URL ────────────────────────────────
  // The SelectTrigger carries aria-label="Sort projects"
  await page.getByLabel("Sort projects").click();
  await page.getByRole("option", { name: "Worst first" }).click();
  await expect(page).toHaveURL(/sort=worst/);

  // Verify the project cards are rendered (both projects present after sort)
  await expect(page.getByText(idA)).toBeVisible();
  await expect(page.getByText(idB)).toBeVisible();

  // ── Navigate into project A (has 2 runs → stats row + trend chart visible) ──
  await page.getByText(idA).first().click();

  // Stats row tiles — use exact:true to avoid matching the chart SVG title
  await expect(page.getByText("Pass rate", { exact: true })).toBeVisible();
  await expect(page.getByText("Failures", { exact: true })).toBeVisible();
  await expect(page.getByText("Duration", { exact: true })).toBeVisible();
  await expect(page.getByText("Flaky", { exact: true })).toBeVisible();

  // ── Trend chart visible (2 runs uploaded above) ─────────────────────────────
  // Navigate to Report tab where TrendChart lives
  await page.getByRole("tab", { name: "Report" }).click();
  await expect(page.locator('svg[role="group"]')).toBeVisible();

  // ── Runs tab: Duration sort toggles aria-sort on the <th> ───────────────────
  await page.getByRole("tab", { name: "Runs" }).click();

  // Click the "Sort by Duration" button (inside the SortTh <th>)
  await page.getByRole("button", { name: "Sort by Duration" }).click();

  // The columnheader th for Duration should now carry aria-sort="descending"
  // (first click → desc per the nextSort cycle).
  await expect(
    page.getByRole("columnheader", { name: /Duration/ })
  ).toHaveAttribute("aria-sort", "descending");

  // Second click flips to ascending
  await page.getByRole("button", { name: "Sort by Duration" }).click();
  await expect(
    page.getByRole("columnheader", { name: /Duration/ })
  ).toHaveAttribute("aria-sort", "ascending");
});

test("triage: sort=name (default) renders project cards without ?sort param", async ({ page }) => {
  await page.goto("/");
  // Default sort=name does not write the param to the URL
  await expect(page).not.toHaveURL(/sort=/);
  // Sort select exists and shows the Name option as default
  await expect(page.getByLabel("Sort projects")).toBeVisible();
});

test("a missing project shows a humanized inline error with retry", async ({ page }) => {
  await page.goto("/projects/does-not-exist-xyz");
  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(/private or doesn't exist/i);
  await expect(alert.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(alert.getByRole("link", { name: "Sign in" })).toBeVisible();
  await expectNoSeriousViolations(page, "project:error-state");
});
