import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "packages/**/*.test.mjs", "apps/worker/src/**/*.test.ts", "apps/web/src/**/*.test.ts", "tests/**/*.test.ts", "tests/**/*.test.mjs", "installer/**/*.test.mjs", "scripts/**/*.test.mjs"],
    environment: "node",
  },
});
