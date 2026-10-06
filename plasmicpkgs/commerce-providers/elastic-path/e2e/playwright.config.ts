import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  // Not *.spec.ts: the repository-wide jest run matches that by name, and its
  // ignore list is overridden on the CI command line.
  testMatch: "*.e2e.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 180_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: process.env.EP_E2E_BASE_URL ?? "http://localhost:3466",
    trace: "retain-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], channel: "chromium" },
    },
  ],
});
