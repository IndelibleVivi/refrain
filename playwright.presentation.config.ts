import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/presentation",
  testMatch: "**/*.pw.ts",
  outputDir: "output/playwright/presentation/results",
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [["line"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:4326/refrain/",
    locale: "en-US",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "npm exec --workspace @refrain/presentation -- vite preview --mode try --base /refrain/ --host 127.0.0.1 --port 4326 --strictPort",
    url: "http://127.0.0.1:4326/refrain/",
    reuseExistingServer: false,
  },
});
