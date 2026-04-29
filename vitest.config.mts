import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.mts", "plugins/cursor/scripts/**/*.test.mts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
