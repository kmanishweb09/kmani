import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Build-time virtual modules resolve to the compiled archive written by scripts/build.mjs (run in globalSetup).
    alias: {
      "virtual:finance-archive": fileURLToPath(new URL("./.local/build/archive.json", import.meta.url)),
      "virtual:finance-build-info": fileURLToPath(new URL("./tests/support/build-info.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/worker/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 120_000,
    pool: "forks",
    globalSetup: ["tests/worker/global-setup.ts"],
  },
});
