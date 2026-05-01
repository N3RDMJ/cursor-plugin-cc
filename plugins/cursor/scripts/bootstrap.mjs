#!/usr/bin/env node
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot =
  process.env.CLAUDE_PLUGIN_ROOT ?? dirname(dirname(fileURLToPath(import.meta.url)));

const marker = join(pluginRoot, "node_modules", "@cursor", "sdk");

if (!existsSync(marker)) {
  try {
    execSync("npm install --omit=dev --ignore-scripts", {
      cwd: pluginRoot,
      stdio: "pipe",
      timeout: 60_000,
    });
  } catch {
    // Best-effort — hooks must never crash Claude Code.
  }
}
