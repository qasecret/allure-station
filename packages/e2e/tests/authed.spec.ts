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
 *   - Account page: sessions list with Current badge, password change, branding (BRAND_NAME=Acme QA).
 *   - Project settings: token expiry select visible with "90 days" default.
 */
import { test, expect, type Page } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "../playwright.config.js";
import { expectNoSeriousViolations, visible, createProject } from "./helpers.js";

/** Sign in as the seeded admin via the /login form; resolves after the redirect home. */
async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("/");
}

/**
 * Sign out the current user via the user-menu dropdown in the sidebar.
 * Opens the trigger (shows the user's email), then clicks Sign out.
 * UserMenu.tsx navigates to "/" after logout — wait for the "/" navigation,
 * then check that the "Sign in" button appears (confirming the session was cleared).
 */
async function logout(page: Page) {
  // The UserMenu trigger button shows the logged-in user's email (any @-containing text)
  await page.getByRole("button", { name: /\w+@\w+/ }).last().click();
  await page.getByRole("menuitem", { name: /Sign out/i }).click();
  // After logout, UserMenu.navigate("/") — wait for the sign-in button to confirm session cleared.
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 10_000 });
}

/** Sign in as any user via the /login form; resolves after redirect to home. */
async function loginAs(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("/");
}

/**
 * Create a user via the /users admin UI. Caller must already be logged in as admin
 * and navigated (or will navigate here). Returns when the new email is visible in the list.
 */
async function createUserViaUI(page: Page, email: string, password: string) {
  await page.goto("/users");
  await page.getByLabel("New user email").fill(email);
  await page.getByLabel("New user password").fill(password);
  await page.getByRole("button", { name: "Add user" }).click();
  await expect(visible(page.getByText(email))).toBeVisible();
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

test("account: sessions visible, password change works, branding applied", async ({ page }) => {
  test.setTimeout(60_000);

  // ── Branding: authed server has BRAND_NAME=Acme QA ──
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: /Sign in to Acme QA/ })).toBeVisible();

  // ── Create a dedicated test user — never mutate the seeded admin ──
  // (Each run uses a timestamped email; un-wiped re-runs don't conflict because
  //  we never try to re-create an existing account.)
  await login(page);
  const email = `account-${Date.now()}@e2e.local`;
  await createUserViaUI(page, email, "first-pass-123");

  // Sign out admin, sign in as the dedicated user
  await logout(page);
  await loginAs(page, email, "first-pass-123");

  // ── Account page: current session badge is visible ──
  await page.goto("/account");
  await expect(page.getByText("Current", { exact: true })).toBeVisible();
  await expectNoSeriousViolations(page, "account");

  // ── Password change ──
  await page.getByLabel("Current password").fill("first-pass-123");
  await page.getByLabel("New password", { exact: true }).fill("second-pass-456");
  await page.getByLabel("Confirm new password").fill("second-pass-456");
  await page.getByRole("button", { name: /change password/i }).click();
  // Success toast from PasswordCard
  await expect(page.getByText(/Password changed/)).toBeVisible();

  // ── New password works for sign-in ──
  // Navigate to login and sign in with the new password
  await page.goto("/login");
  await loginAs(page, email, "second-pass-456");
  await expect(page).toHaveURL("/");
});

test("project settings: token expiry select visible with 90-day default", async ({ page }) => {
  test.setTimeout(60_000);

  await login(page);

  // Create a project so we can navigate to its settings
  const id = `expiry-e2e-${Date.now()}`;
  await createProject(page, id);

  // Navigate to the project's settings page
  await page.goto(`/projects/${id}/settings`);

  // Wait for the settings page to settle (auth loads, config loads)
  // The TokensCard renders a Select with aria-label "Expires"
  await expect(page.getByLabel("Expires")).toBeVisible();
  // Default value is "90 days"
  await expect(page.getByLabel("Expires")).toContainText("90 days");
});
