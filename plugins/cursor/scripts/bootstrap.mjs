#!/usr/bin/env node
import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot =
  process.env.CLAUDE_PLUGIN_ROOT ?? dirname(dirname(fileURLToPath(import.meta.url)));

const nodeModules = join(pluginRoot, "node_modules");
const sdkDir = join(nodeModules, "@cursor", "sdk");
const sentinel = join(nodeModules, ".bootstrap-ok");
const statusFile = join(nodeModules, ".bootstrap-status.json");

// Place a convenience symlink at ~/.claude/cursor-login so users can
// store their API key from any terminal without knowing the plugin path.
try {
  const loginScript = join(pluginRoot, "scripts", "cursor-login.sh");
  const link = join(homedir(), ".claude", "cursor-login");
  if (existsSync(loginScript)) {
    try {
      unlinkSync(link);
    } catch {
      /* not present */
    }
    symlinkSync(loginScript, link);
  }
} catch {
  // Best-effort — non-critical.
}

const needsInstall = !existsSync(sdkDir) || !existsSync(sentinel);

if (needsInstall) {
  const command = "npm install --omit=dev";
  const startedAt = Date.now();
  let ok = false;
  let error;
  try {
    execSync(command, {
      cwd: pluginRoot,
      stdio: "pipe",
      timeout: 120_000,
    });
    execSync(`node -e "require('sqlite3')"`, {
      cwd: pluginRoot,
      stdio: "pipe",
      timeout: 10_000,
    });
    writeFileSync(sentinel, new Date().toISOString(), "utf8");
    ok = true;
  } catch (err) {
    const stderr = err?.stderr ? err.stderr.toString("utf8").trim() : "";
    const message = err instanceof Error ? err.message : String(err);
    error = stderr ? `${message}: ${stderr.slice(-1024)}` : message;
  }

  // /cursor:setup reads this file to surface bootstrap failures.
  try {
    mkdirSync(nodeModules, { recursive: true });
    const status = {
      ok,
      attemptedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      command,
      ...(error ? { error } : {}),
    };
    const tmp = `${statusFile}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(status, null, 2)}\n`, { mode: 0o600 });
    try {
      renameSync(tmp, statusFile);
    } catch (renameErr) {
      rmSync(tmp, { force: true });
      throw renameErr;
    }
  } catch {
    // Best-effort — hooks must never crash Claude Code.
  }
}
