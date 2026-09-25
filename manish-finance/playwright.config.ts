import { defineConfig, devices } from "@playwright/test";

/** End-to-end journeys against the built release in the simulated host (workerd + in-memory D1). */
const PORT = 8790;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"], ["json", { outputFile: "release/reports/e2e-results.json" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
  },
  webServer: {
    command: "node scripts/serve.mjs",
    url: `http://localhost:${PORT}/api/finance/status`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { PORT: String(PORT), FINANCE_E2E_FIXTURE_SOURCES: "1" },
  },
});
