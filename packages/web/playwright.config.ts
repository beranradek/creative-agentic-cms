import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  fullyParallel: true,
  use: {
    baseURL: "http://localhost:4173",
  },
  webServer: {
    command: "cd ../.. && pnpm -r build && node scripts/e2e-webserver.mjs",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

