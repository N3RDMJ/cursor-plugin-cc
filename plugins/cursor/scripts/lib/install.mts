import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readJson, writeJsonAtomic } from "./state.mjs";

export const BOOTSTRAP_STATUS_FILENAME = ".bootstrap-status.json";
export const BOOTSTRAP_SENTINEL_FILENAME = ".bootstrap-ok";

export interface BootstrapStatus {
  ok: boolean;
  attemptedAt: string;
  error?: string;
  durationMs?: number;
  command?: string;
}

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
 * Direct `node_modules/@cursor/sdk` lookup first (the production layout written
 * by bootstrap.mjs), then Node.js resolution for hoisted/monorepo installs.
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
  timeoutMs?: number;
  onOutput?: (chunk: string) => void;
}

export interface InstallResult {
  ok: boolean;
  error?: string;
  durationMs: number;
  command: string;
}

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

    // npm puts diagnostics on both streams (ERR! lines on stderr, but progress
    // and some failures on stdout); merge them so the persisted error tail
    // doesn't drop one half.
    let outputTail = "";
    const collect = (chunk: Buffer): void => {
      const text = chunk.toString("utf8");
      outputTail = (outputTail + text).slice(-2048);
      options.onOutput?.(text);
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);

    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {}
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
        const detail = outputTail.trim();
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
    ...(result.error ? { error: result.error } : {}),
  };
  try {
    writeBootstrapStatus(pluginRoot, status);
    if (result.ok) writeBootstrapSentinel(pluginRoot);
  } catch {}
  return result;
}
