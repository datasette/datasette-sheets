import { defineConfig, devices } from "@playwright/test";

const PORT = 8484;
const DB_PATH = "/tmp/datasette-sheets-e2e-test.db";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `rm -f ${DB_PATH} && touch ${DB_PATH} && uv run datasette ${DB_PATH} -s permissions.datasette-sheets-access true -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 15000,
  },
});
