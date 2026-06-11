/**
 * Authed admin journey — runs only in the "authed" Playwright project, against the
 * secure-mode server on :5098 (seeded via ADMIN_EMAIL/ADMIN_PASSWORD in
 * playwright.config.ts, with its own DATA_DIR so the open-mode suite is untouched).
 *
 * Discharges the deferrals noted in a11y.spec.ts and triage.spec.ts:
 *   - /users renders for an admin session and passes the axe gate.
 *   - /audit renders humanized audit sentences (lib/audit-format.ts describers:
 *     login → "<email> logged in", user_created → "<actor> created user <email> (role)").
 *   - The audit action filter narrows the list, and the page passes the axe gate.
 */
import { test, expect, type Page } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "../playwright.config.js";
import { expectNoSeriousViolations, visible } from "./helpers.js";

/** Sign in as the seeded admin via the /login form; resolves after the redirect home. */
async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("/");
}

test("authed: users page + audit page render, humanize, filter, and pass axe", async ({ page }) => {
  // The login itself writes a `login` audit entry — that seeds the audit assertions below.
  await login(page);

  // ── /users: admin-gated page renders the seeded admin and the create form ──
  await page.goto("/users");
  await expect(visible(page.getByText(ADMIN_EMAIL))).toBeVisible();
  await expect(page.getByRole("button", { name: "Add user" })).toBeVisible();
  await expectNoSeriousViolations(page, "users");

  // Create a user → writes a `user_created` audit entry, giving the audit page a second
  // action so the filter assertion below can demonstrably narrow. Unique email per run:
  // the authed DATA_DIR persists across un-wiped re-runs and duplicate emails 409.
  const newEmail = `viewer-${Date.now()}@e2e.local`;
  await page.getByLabel("New user email").fill(newEmail);
  await page.getByLabel("New user password").fill("viewer-pass-123");
  await page.getByRole("button", { name: "Add user" }).click();
  await expect(visible(page.getByText(newEmail))).toBeVisible();

  // ── /audit: humanized sentences (describeAuditEntry wording, asserted exactly) ──
  await page.goto("/audit");
  const loginSentence = `${ADMIN_EMAIL} logged in`;
  const createdSentence = `${ADMIN_EMAIL} created user ${newEmail}`;
  await expect(visible(page.getByText(loginSentence))).toBeVisible();
  await expect(visible(page.getByText(createdSentence))).toBeVisible();

  // ── Action filter narrows: keep `login` entries, drop the `user_created` one ──
  await page.getByLabel("Filter by action").click();
  await page.getByRole("option", { name: "login", exact: true }).click();
  // Radix unmounts the Select popper only after its close animation; until then the app
  // root sits behind aria-hidden and the listbox is still in the DOM, which the axe scan
  // below would flag. Wait for the listbox to be gone so the scan sees the settled page.
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(page).toHaveURL(/action=login/);
  await expect(page.getByText(createdSentence)).toHaveCount(0);
  await expect(visible(page.getByText(loginSentence))).toBeVisible();

  await expectNoSeriousViolations(page, "audit");
});
