import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type BootstrapStatus,
  hasBootstrapSentinel,
  isSdkInstalled,
  readBootstrapStatus,
  resolvePluginRoot,
  runNpmInstall,
  writeBootstrapSentinel,
  writeBootstrapStatus,
} from "@plugin/lib/install.mjs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let pluginRoot: string;
let savedEnv: string | undefined;

beforeEach(() => {
  pluginRoot = mkdtempSync(path.join(tmpdir(), "cursor-install-"));
  savedEnv = process.env.CLAUDE_PLUGIN_ROOT;
  process.env.CLAUDE_PLUGIN_ROOT = pluginRoot;
});

afterEach(() => {
  rmSync(pluginRoot, { recursive: true, force: true });
  if (savedEnv === undefined) delete process.env.CLAUDE_PLUGIN_ROOT;
  else process.env.CLAUDE_PLUGIN_ROOT = savedEnv;
});

describe("install.mts", () => {
  it("resolvePluginRoot returns CLAUDE_PLUGIN_ROOT when set", () => {
    expect(resolvePluginRoot()).toBe(path.resolve(pluginRoot));
  });

  it("isSdkInstalled returns true when @cursor/sdk is in plugin node_modules", () => {
    const sdkDir = path.join(pluginRoot, "node_modules", "@cursor", "sdk");
    mkdirSync(sdkDir, { recursive: true });
    writeFileSync(path.join(sdkDir, "package.json"), '{"name":"@cursor/sdk"}');
    expect(isSdkInstalled(pluginRoot)).toBe(true);
  });

  it("isSdkInstalled returns true via Node.js resolution when not in plugin node_modules", () => {
    // The repo has @cursor/sdk hoisted in the root node_modules; require.resolve
    // from install.mts's location finds it even when pluginRoot is bare.
    expect(isSdkInstalled(pluginRoot)).toBe(true);
  });

  it("writeBootstrapStatus + readBootstrapStatus round-trip", () => {
    const status: BootstrapStatus = {
      ok: false,
      attemptedAt: "2026-05-03T00:00:00Z",
      error: "boom",
      durationMs: 12,
      source: "bootstrap",
      command: "npm install --omit=dev",
    };
    writeBootstrapStatus(pluginRoot, status);
    expect(readBootstrapStatus(pluginRoot)).toEqual(status);
  });

  it("readBootstrapStatus returns undefined when the file is missing", () => {
    expect(readBootstrapStatus(pluginRoot)).toBeUndefined();
  });

  it("writeBootstrapSentinel creates node_modules/.bootstrap-ok", () => {
    expect(hasBootstrapSentinel(pluginRoot)).toBe(false);
    writeBootstrapSentinel(pluginRoot);
    expect(hasBootstrapSentinel(pluginRoot)).toBe(true);
    const contents = readFileSync(path.join(pluginRoot, "node_modules", ".bootstrap-ok"), "utf8");
    expect(contents).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("runNpmInstall returns a structured failure when npm exits non-zero", async () => {
    // Bare temp dir with no package.json — npm install will exit non-zero.
    const result = await runNpmInstall(pluginRoot, { timeoutMs: 30_000 });
    expect(result.ok).toBe(false);
    expect(result.command).toBe("npm install --omit=dev");
    expect(typeof result.durationMs).toBe("number");
    expect(typeof result.error).toBe("string");
  }, 60_000);
});
