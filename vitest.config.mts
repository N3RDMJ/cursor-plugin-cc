import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@plugin": here("./plugins/cursor/scripts"),
      "@test": here("./tests"),
    },
  },
  test: {
    include: ["tests/**/*.test.mts", "plugins/cursor/scripts/**/*.test.mts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
