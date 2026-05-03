import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readJson, writeJsonAtomic } from "./state.mjs";

export const BOOTSTRAP_STATUS_FILENAME = ".bootstrap-status.json";
export const BOOTSTRAP_SENTINEL_FILENAME = ".bootstrap-ok";

export interface BootstrapStatus {
  /** True when the most recent install completed and the SDK is loadable. */
  ok: boolean;
  /** Error message captured from the failing command (stderr tail or thrown reason). */
  error?: string;
  /** ISO timestamp of the most recent attempt. */
  attemptedAt: string;
  /** Wall-clock duration of the install in milliseconds, when measured. */
  durationMs?: number;
  /** Origin tag — `bootstrap` (SessionStart) vs `setup --install` (interactive). */
  source?: "bootstrap" | "setup";
  /** The npm command that was run, for the user to repeat manually. */
  command?: string;
}

/**
 * Resolve the plugin root from the env (set by Claude Code) or by walking up
 * from this module's location. Used by both bootstrap.mjs and setup.
 */
export function resolvePluginRoot(): string {
  const envRoot = process.env.CLAUDE_PLUGIN_ROOT;
  if (envRoot && envRoot.trim() !== "") return path.resolve(envRoot);
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..");
}

function pluginNodeModules(pluginRoot: string): string {
  return path.join(pluginRoot, "node_modules");
}

function statusPath(pluginRoot: string): string {
  return path.join(pluginNodeModules(pluginRoot), BOOTSTRAP_STATUS_FILENAME);
}

function sentinelPath(pluginRoot: string): string {
  return path.join(pluginNodeModules(pluginRoot), BOOTSTRAP_SENTINEL_FILENAME);
}

/**
 * True when `@cursor/sdk` is resolvable. Checks the plugin's local
 * `node_modules` first (the production layout written by bootstrap.mjs), then
 * falls back to Node.js's normal resolution from this module's location, which
 * picks up hoisted/monorepo installs (dev and test environments).
 */
export function isSdkInstalled(pluginRoot: string): boolean {
  const direct = path.join(pluginNodeModules(pluginRoot), "@cursor", "sdk", "package.json");
  if (fs.existsSync(direct)) return true;
  try {
    const require = createRequire(import.meta.url);
    require.resolve("@cursor/sdk");
    return true;
  } catch {
    return false;
  }
}

/** True when the bootstrap sentinel was written by a previous successful install. */
export function hasBootstrapSentinel(pluginRoot: string): boolean {
  return fs.existsSync(sentinelPath(pluginRoot));
}

export function readBootstrapStatus(pluginRoot: string): BootstrapStatus | undefined {
  return readJson<BootstrapStatus>(statusPath(pluginRoot));
}

export function writeBootstrapStatus(pluginRoot: string, status: BootstrapStatus): void {
  writeJsonAtomic(statusPath(pluginRoot), status);
}

export function writeBootstrapSentinel(pluginRoot: string): void {
  fs.mkdirSync(pluginNodeModules(pluginRoot), { recursive: true });
  fs.writeFileSync(sentinelPath(pluginRoot), new Date().toISOString(), "utf8");
}

export interface InstallOptions {
  /** Per-attempt timeout in milliseconds. Defaults to 120s. */
  timeoutMs?: number;
  /** Tag stored on the resulting status. */
  source?: "bootstrap" | "setup";
  /** When provided, install output is teed to this stream (line-buffered). */
  onOutput?: (chunk: string) => void;
}

export interface InstallResult {
  ok: boolean;
  error?: string;
  durationMs: number;
  command: string;
}

/**
 * Run `npm install --omit=dev` in the plugin root. Captures stdout+stderr,
 * forwards both to `onOutput` when provided, and resolves with a structured
 * result. Never throws — the caller decides how to surface a failed install.
 */
export function runNpmInstall(
  pluginRoot: string,
  options: InstallOptions = {},
): Promise<InstallResult> {
  const command = "npm install --omit=dev";
  const timeoutMs = options.timeoutMs ?? 120_000;
  const start = Date.now();

  return new Promise<InstallResult>((resolve) => {
    let settled = false;
    const finish = (result: InstallResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("npm", ["install", "--omit=dev"], {
        cwd: pluginRoot,
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });
    } catch (err) {
      finish({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
        command,
      });
      return;
    }

    let stderrTail = "";
    const collect = (chunk: Buffer): void => {
      const text = chunk.toString("utf8");
      stderrTail = (stderrTail + text).slice(-2048);
      options.onOutput?.(text);
    };
    child.stdout?.on("data", (chunk: Buffer) => options.onOutput?.(chunk.toString("utf8")));
    child.stderr?.on("data", collect);

    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* best-effort */
      }
      finish({
        ok: false,
        error: `npm install timed out after ${timeoutMs}ms`,
        durationMs: Date.now() - start,
        command,
      });
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      finish({
        ok: false,
        error: err.message,
        durationMs: Date.now() - start,
        command,
      });
    });

    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        finish({ ok: true, durationMs: Date.now() - start, command });
      } else {
        const reason = signal
          ? `npm install terminated by signal ${signal}`
          : `npm install exited with code ${code}`;
        const detail = stderrTail.trim();
        finish({
          ok: false,
          error: detail ? `${reason}: ${detail}` : reason,
          durationMs: Date.now() - start,
          command,
        });
      }
    });
  });
}

/** Convenience: install + persist status + write sentinel on success. */
export async function installAndRecord(
  pluginRoot: string,
  options: InstallOptions = {},
): Promise<InstallResult> {
  const result = await runNpmInstall(pluginRoot, options);
  const status: BootstrapStatus = {
    ok: result.ok,
    attemptedAt: new Date().toISOString(),
    durationMs: result.durationMs,
    command: result.command,
    ...(options.source ? { source: options.source } : {}),
    ...(result.error ? { error: result.error } : {}),
  };
  try {
    writeBootstrapStatus(pluginRoot, status);
    if (result.ok) writeBootstrapSentinel(pluginRoot);
  } catch {
    /* status is best-effort; the install result is the primary signal */
  }
  return result;
}
