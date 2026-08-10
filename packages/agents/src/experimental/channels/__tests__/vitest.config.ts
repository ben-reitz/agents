import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "experimental-channels",
    environment: "node",
    include: [path.join(import.meta.dirname, "**/*.test.ts")]
  }
});
