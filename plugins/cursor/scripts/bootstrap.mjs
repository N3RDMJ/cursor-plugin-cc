#!/usr/bin/env node
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot =
  process.env.CLAUDE_PLUGIN_ROOT ?? dirname(dirname(fileURLToPath(import.meta.url)));

const sdkDir = join(pluginRoot, "node_modules", "@cursor", "sdk");
const sentinel = join(pluginRoot, "node_modules", ".bootstrap-ok");

const needsInstall = !existsSync(sdkDir) || !existsSync(sentinel);

if (needsInstall) {
  try {
    execSync("npm install --omit=dev", {
      cwd: pluginRoot,
      stdio: "pipe",
      timeout: 120_000,
    });
    execSync(`node -e "require('sqlite3')"`, {
      cwd: pluginRoot,
      stdio: "pipe",
      timeout: 10_000,
    });
    const { writeFileSync } = await import("node:fs");
    writeFileSync(sentinel, new Date().toISOString(), "utf8");
  } catch {
    // Best-effort — hooks must never crash Claude Code.
  }
}
