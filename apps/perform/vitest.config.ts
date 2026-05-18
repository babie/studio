import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    includeSource: ["src/**/*.ts"],
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
  define: {
    "import.meta.vitest": "undefined",
  },
});
