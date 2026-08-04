import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./packages/server/tests/e2e-ui",
  fullyParallel: false,
  retries: 0,
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:0",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
