import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "forks",
    fileParallelism: false,
    testTimeout: 20_000,
    exclude: ["**/dist/**", "**/node_modules/**", "tests/e2e-ui/**", "tests/e2e-unified/real-apps.spec.ts"],
  },
});
