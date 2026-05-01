import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Force a single copy of @cursor/sdk so vi.mock intercepts all usages
      // (the plugin sub-package installs its own copy under plugins/cursor/node_modules).
      "@cursor/sdk": here("./plugins/cursor/node_modules/@cursor/sdk/dist/esm/index.js"),
      "@plugin": here("./plugins/cursor/scripts"),
      "@test": here("./tests"),
    },
  },
  test: {
    include: ["tests/**/*.test.mts", "plugins/cursor/scripts/**/*.test.mts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
