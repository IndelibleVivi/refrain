import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/mcp-host",
  testMatch: "**/*.pw.ts",
  outputDir: "output/playwright/mcp-host/results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [["line"]],
  use: {
    ...devices["Desktop Chrome"],
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
});
