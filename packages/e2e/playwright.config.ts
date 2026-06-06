import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 5099;

// Full-stack e2e: build the web bundle, then start the real allure-station server with WEB_DIST
// pointing at it (default sqlite/local/inprocess — zero external deps). Playwright drives a browser
// against the served SPA. Run with: pnpm --filter @allure-station/e2e test:e2e
// (requires `playwright install chromium` once).
export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  fullyParallel: false,
  use: { baseURL: `http://127.0.0.1:${PORT}` },
  webServer: {
    command: "pnpm --filter @allure-station/web build && pnpm --filter @allure-station/server start",
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      WEB_DIST: resolve(here, "../web/dist"),
      DATA_DIR: resolve(here, ".e2e-data"),
      PORT: String(PORT),
    },
  },
});
