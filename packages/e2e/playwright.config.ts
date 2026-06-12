import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 5099; // open mode — zero-config server (no accounts, public writes)
const AUTHED_PORT = 5098; // secure mode — seeded admin (sessions, RBAC, audit UI)
const WEB_DIST = resolve(here, "../web/dist");

/** Credentials the secure-mode server is seeded with; authed.spec.ts logs in with these. */
export const ADMIN_EMAIL = "admin@e2e.local";
export const ADMIN_PASSWORD = "e2e-password-123";

// Full-stack e2e: build the web bundle, then start the real allure-station server with WEB_DIST
// pointing at it (default sqlite/local/inprocess — zero external deps). Playwright drives a browser
// against the served SPA. Run with: pnpm --filter @allure-station/e2e test:e2e
// (requires `playwright install chromium` once).
//
// Two Playwright projects against two servers:
//   open   (:5099) — the original zero-config suite, untouched semantics.
//   authed (:5098) — secure mode via ADMIN_EMAIL/ADMIN_PASSWORD, own DATA_DIR; covers the
//                    admin-gated Users/Audit pages that open mode can't render.
export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  fullyParallel: false,
  projects: [
    {
      name: "open",
      testIgnore: "**/authed.spec.ts",
      use: { baseURL: `http://127.0.0.1:${PORT}` },
    },
    {
      name: "authed",
      testMatch: "**/authed.spec.ts",
      use: { baseURL: `http://127.0.0.1:${AUTHED_PORT}` },
    },
  ],
  webServer: [
    {
      command: "pnpm --filter @allure-station/web build && pnpm --filter @allure-station/server start",
      url: `http://127.0.0.1:${PORT}/`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        WEB_DIST,
        DATA_DIR: resolve(here, ".e2e-data"),
        PORT: String(PORT),
      },
    },
    {
      // Secure-mode server for authed.spec.ts. Both webServer commands launch in parallel and
      // the web build happens (once) in the first entry — but app.ts only registers the SPA
      // static handler when WEB_DIST exists at boot, so this server must not start before the
      // bundle is on disk. Poll for index.html, then start.
      command: `while [ ! -f "${WEB_DIST}/index.html" ]; do sleep 1; done; pnpm --filter @allure-station/server start`,
      url: `http://127.0.0.1:${AUTHED_PORT}/`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        WEB_DIST,
        DATA_DIR: resolve(here, ".e2e-data-authed"),
        PORT: String(AUTHED_PORT),
        ADMIN_EMAIL,
        ADMIN_PASSWORD,
        BRAND_NAME: "Acme QA",
      },
    },
  ],
});
