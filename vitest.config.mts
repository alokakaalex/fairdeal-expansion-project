import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
      "server-only": path.resolve(import.meta.dirname, "test/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    env: { DATABASE_PATH: ":memory:", DATA_DIR: path.resolve(import.meta.dirname, ".test-data"), UPLOAD_CHUNK_MB: "1" },
    // A real Postgres (DATABASE_URL) is one shared database that each test file resets, so run files one at a time.
    fileParallelism: !process.env.DATABASE_URL,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
