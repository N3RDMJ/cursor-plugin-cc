import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { argv, captureIO } from "@test/helpers/io.mjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdkMocks = vi.hoisted(() => ({
  agentCreate: vi.fn(),
  agentResume: vi.fn(),
  cursorMe: vi.fn(),
  modelsList: vi.fn(),
}));

vi.mock("@cursor/sdk", async () => {
  const actual = await vi.importActual<typeof import("@cursor/sdk")>("@cursor/sdk");
  return {
    ...actual,
    Agent: { create: sdkMocks.agentCreate, resume: sdkMocks.agentResume },
    Cursor: { me: sdkMocks.cursorMe, models: { list: sdkMocks.modelsList } },
  };
});

const installMocks = vi.hoisted(() => ({
  installAndRecord: vi.fn(),
  isSdkInstalled: vi.fn(),
  readBootstrapStatus: vi.fn(),
}));

vi.mock("@plugin/lib/install.mjs", async () => {
  const actual =
    await vi.importActual<typeof import("@plugin/lib/install.mjs")>("@plugin/lib/install.mjs");
  return {
    ...actual,
    installAndRecord: installMocks.installAndRecord,
    isSdkInstalled: installMocks.isSdkInstalled,
    readBootstrapStatus: installMocks.readBootstrapStatus,
  };
});

import { main as companionMain } from "@plugin/cursor-companion.mjs";
import { setBackendForTesting } from "@plugin/lib/credentials.mjs";
import { readGateConfig } from "@plugin/lib/gate.mjs";
import { resolveStateDir } from "@plugin/lib/state.mjs";
import { readUserConfig, USER_CONFIG_ENV_MODEL } from "@plugin/lib/user-config.mjs";

let workDir: string;
let stateRoot: string;

let savedModelEnv: string | undefined;

beforeEach(() => {
  workDir = mkdtempSync(path.join(tmpdir(), "cursor-setup-cwd-"));
  stateRoot = mkdtempSync(path.join(tmpdir(), "cursor-setup-state-"));
  process.env.CURSOR_PLUGIN_STATE_ROOT = stateRoot;
  process.env.CURSOR_API_KEY = "test-key";
  savedModelEnv = process.env[USER_CONFIG_ENV_MODEL];
  delete process.env[USER_CONFIG_ENV_MODEL];
  setBackendForTesting(null);
  vi.clearAllMocks();
  sdkMocks.cursorMe.mockResolvedValue({ apiKeyName: "test-key", userId: "u" });
  sdkMocks.modelsList.mockResolvedValue([
    { id: "composer-2", displayName: "Composer 2", variants: [] },
    { id: "gpt-5", displayName: "GPT 5", variants: [] },
  ]);
  installMocks.isSdkInstalled.mockReturnValue(true);
  installMocks.readBootstrapStatus.mockReturnValue(undefined);
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
  rmSync(stateRoot, { recursive: true, force: true });
  delete process.env.CURSOR_PLUGIN_STATE_ROOT;
  delete process.env.CURSOR_API_KEY;
  if (savedModelEnv === undefined) delete process.env[USER_CONFIG_ENV_MODEL];
  else process.env[USER_CONFIG_ENV_MODEL] = savedModelEnv;
  setBackendForTesting(null);
});

describe("CLI: setup", () => {
  it("reports gate state in the default report (off by default)", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("setup"), io)).toBe(0);
    expect(io.captured.stdout.join("")).toContain("| Stop gate | off |");
  });

  it("--enable-gate persists enabled=true and reports 'on'", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("setup", "--enable-gate"), io)).toBe(0);
    expect(io.captured.stdout.join("")).toContain("| Stop gate | on |");
    const cfg = readGateConfig(resolveStateDir(workDir));
    expect(cfg.enabled).toBe(true);
  });

  it("--disable-gate persists enabled=false and reports 'off'", async () => {
    const ioOn = captureIO(workDir);
    await companionMain(argv("setup", "--enable-gate"), ioOn);
    const ioOff = captureIO(workDir);
    expect(await companionMain(argv("setup", "--disable-gate"), ioOff)).toBe(0);
    expect(ioOff.captured.stdout.join("")).toContain("| Stop gate | off |");
    expect(readGateConfig(resolveStateDir(workDir)).enabled).toBe(false);
  });

  it("rejects --enable-gate together with --disable-gate", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("setup", "--enable-gate", "--disable-gate"), io)).toBe(2);
    expect(io.captured.stderr.join("")).toContain("mutually exclusive");
  });

  it("--json includes gate state", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("setup", "--enable-gate", "--json"), io)).toBe(0);
    const report = JSON.parse(io.captured.stdout.join(""));
    expect(report.gate.enabled).toBe(true);
    expect(typeof report.gate.workspaceRoot).toBe("string");
  });

  it("reports the built-in default model when nothing is configured", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("setup"), io)).toBe(0);
    const out = io.captured.stdout.join("");
    expect(out).toContain("| Default | composer-2 |");
    expect(out).toContain("built-in fallback");
  });

  it("--set-model validates the id and persists the default", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("setup", "--set-model", "gpt-5"), io)).toBe(0);
    expect(readUserConfig().defaultModel).toEqual({ id: "gpt-5" });
    const out = io.captured.stdout.join("");
    expect(out).toContain("| Default | gpt-5 |");
    expect(out).toContain("from persisted default");
  });

  it("--set-model rejects ids absent from the catalog", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("setup", "--set-model", "imaginary"), io)).toBe(1);
    expect(io.captured.stderr.join("")).toContain("imaginary");
    expect(readUserConfig().defaultModel).toBeUndefined();
  });

  it("--set-model persists variant params from the id:k=v selector syntax", async () => {
    sdkMocks.modelsList.mockResolvedValue([
      {
        id: "gpt-5",
        displayName: "GPT 5",
        parameters: [
          {
            id: "reasoning_effort",
            values: [{ value: "low" }, { value: "medium" }, { value: "high" }],
          },
        ],
      },
    ]);
    const io = captureIO(workDir);
    expect(
      await companionMain(argv("setup", "--set-model", "gpt-5:reasoning_effort=low"), io),
    ).toBe(0);
    expect(readUserConfig().defaultModel).toEqual({
      id: "gpt-5",
      params: [{ id: "reasoning_effort", value: "low" }],
    });
    const out = io.captured.stdout.join("");
    expect(out).toContain("| Default | gpt-5:reasoning_effort=low |");
  });

  it("--set-model rejects param values absent from the catalog", async () => {
    sdkMocks.modelsList.mockResolvedValue([
      {
        id: "gpt-5",
        displayName: "GPT 5",
        parameters: [
          {
            id: "reasoning_effort",
            values: [{ value: "low" }, { value: "high" }],
          },
        ],
      },
    ]);
    const io = captureIO(workDir);
    expect(
      await companionMain(argv("setup", "--set-model", "gpt-5:reasoning_effort=extreme"), io),
    ).toBe(1);
    expect(io.captured.stderr.join("")).toContain("extreme");
    expect(readUserConfig().defaultModel).toBeUndefined();
  });

  it("--set-model rejects malformed selector syntax", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("setup", "--set-model", "gpt-5:reasoning_effort"), io)).toBe(2);
    expect(io.captured.stderr.join("")).toContain("expected key=value");
    expect(readUserConfig().defaultModel).toBeUndefined();
  });

  it("--set-model rejects an explicit empty value instead of silently no-op'ing", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("setup", "--set-model", ""), io)).toBe(2);
    expect(io.captured.stderr.join("")).toContain("model selector is empty");
    expect(readUserConfig().defaultModel).toBeUndefined();
  });

  it("--clear-model removes the persisted default", async () => {
    const setIo = captureIO(workDir);
    await companionMain(argv("setup", "--set-model", "gpt-5"), setIo);
    expect(readUserConfig().defaultModel).toEqual({ id: "gpt-5" });

    const clearIo = captureIO(workDir);
    expect(await companionMain(argv("setup", "--clear-model"), clearIo)).toBe(0);
    expect(readUserConfig().defaultModel).toBeUndefined();
    expect(clearIo.captured.stdout.join("")).toContain("built-in fallback");
  });

  it("rejects --set-model together with --clear-model", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("setup", "--set-model", "gpt-5", "--clear-model"), io)).toBe(2);
    expect(io.captured.stderr.join("")).toContain("mutually exclusive");
  });

  it("CURSOR_MODEL env var wins over the persisted default", async () => {
    const setIo = captureIO(workDir);
    await companionMain(argv("setup", "--set-model", "gpt-5"), setIo);

    process.env[USER_CONFIG_ENV_MODEL] = "composer-2";
    const io = captureIO(workDir);
    expect(await companionMain(argv("setup"), io)).toBe(0);
    const out = io.captured.stdout.join("");
    expect(out).toContain("| Default | composer-2 |");
    expect(out).toContain("from CURSOR_MODEL env");
  });

  it("reports apiKey source as 'env' when using CURSOR_API_KEY", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("setup"), io)).toBe(0);
    expect(io.captured.stdout.join("")).toContain("source: env");
  });

  it("--json report includes apiKey.source", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("setup", "--json"), io)).toBe(0);
    const report = JSON.parse(io.captured.stdout.join(""));
    expect(report.apiKey.source).toBe("env");
  });

  it("rejects --login together with --logout", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("setup", "--login", "--logout"), io)).toBe(2);
    expect(io.captured.stderr.join("")).toContain("mutually exclusive");
  });

  it("--login explains keychain setup alternatives when no backend is available", async () => {
    setBackendForTesting(null);
    const io = captureIO(workDir);
    expect(await companionMain(argv("setup", "--login"), io)).toBe(1);
    const err = io.captured.stderr.join("");
    expect(err).toContain("~/.claude/cursor-login");
    expect(err).toContain("CURSOR_API_KEY");
    expect(err).toContain("gnome-keyring");
  });

  it("--logout fails gracefully when no backend", async () => {
    setBackendForTesting(null);
    const io = captureIO(workDir);
    expect(await companionMain(argv("setup", "--logout"), io)).toBe(1);
    expect(io.captured.stderr.join("")).toContain("No supported keychain backend");
  });

  it("--logout --json returns structured error when no backend", async () => {
    setBackendForTesting(null);
    const io = captureIO(workDir);
    expect(await companionMain(argv("setup", "--logout", "--json"), io)).toBe(1);
    const parsed = JSON.parse(io.captured.stdout.join(""));
    expect(parsed.ok).toBe(false);
  });

  it("default report includes an SDK row marked ok when the SDK is installed", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("setup"), io)).toBe(0);
    const out = io.captured.stdout.join("");
    expect(out).toContain("| SDK | ok |");
  });

  it("default report marks SDK fail and shows remediation when SDK is missing", async () => {
    installMocks.isSdkInstalled.mockReturnValue(false);
    const io = captureIO(workDir);
    expect(await companionMain(argv("setup"), io)).toBe(1);
    const out = io.captured.stdout.join("");
    expect(out).toContain("| SDK | fail |");
    expect(out).toContain("/cursor:setup --install");
  });

  it("default report surfaces a bootstrap failure error from .bootstrap-status.json", async () => {
    installMocks.isSdkInstalled.mockReturnValue(false);
    installMocks.readBootstrapStatus.mockReturnValue({
      ok: false,
      attemptedAt: "2026-05-03T00:00:00Z",
      error: "ENETUNREACH: network unreachable",
      command: "npm install --omit=dev",
    });
    const io = captureIO(workDir);
    expect(await companionMain(argv("setup"), io)).toBe(1);
    const out = io.captured.stdout.join("");
    expect(out).toContain("bootstrap failed: ENETUNREACH: network unreachable");
  });

  it("a stale ok=false bootstrap status is overridden when the SDK is loadable", async () => {
    installMocks.isSdkInstalled.mockReturnValue(true);
    installMocks.readBootstrapStatus.mockReturnValue({
      ok: false,
      attemptedAt: "2026-05-01T00:00:00Z",
      error: "old failure the user fixed manually",
    });
    const io = captureIO(workDir);
    expect(await companionMain(argv("setup"), io)).toBe(0);
    expect(io.captured.stdout.join("")).toContain("| SDK | ok |");
  });

  it("--json includes the sdk and bootstrap fields", async () => {
    installMocks.isSdkInstalled.mockReturnValue(false);
    installMocks.readBootstrapStatus.mockReturnValue({
      ok: false,
      attemptedAt: "2026-05-03T00:00:00Z",
      error: "boom",
    });
    const io = captureIO(workDir);
    expect(await companionMain(argv("setup", "--json"), io)).toBe(1);
    const report = JSON.parse(io.captured.stdout.join(""));
    expect(report.sdk.ok).toBe(false);
    expect(report.sdk.bootstrap.error).toBe("boom");
  });

  it("--install runs the installer and reports success", async () => {
    installMocks.installAndRecord.mockResolvedValue({
      ok: true,
      durationMs: 42,
      command: "npm install --omit=dev",
    });
    const io = captureIO(workDir);
    expect(await companionMain(argv("setup", "--install"), io)).toBe(0);
    expect(installMocks.installAndRecord).toHaveBeenCalledTimes(1);
    expect(io.captured.stdout.join("")).toContain("Install succeeded");
  });

  it("--install reports failure with exit code 1", async () => {
    installMocks.installAndRecord.mockResolvedValue({
      ok: false,
      durationMs: 7,
      command: "npm install --omit=dev",
      error: "exit code 1",
    });
    const io = captureIO(workDir);
    expect(await companionMain(argv("setup", "--install"), io)).toBe(1);
    expect(io.captured.stderr.join("")).toContain("Install failed");
  });

  it("--install --json emits structured output", async () => {
    installMocks.installAndRecord.mockResolvedValue({
      ok: true,
      durationMs: 100,
      command: "npm install --omit=dev",
    });
    const io = captureIO(workDir);
    expect(await companionMain(argv("setup", "--install", "--json"), io)).toBe(0);
    const parsed = JSON.parse(io.captured.stdout.join(""));
    expect(parsed.ok).toBe(true);
    expect(parsed.command).toBe("npm install --omit=dev");
  });

  it("rejects --install together with --login", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("setup", "--install", "--login"), io)).toBe(2);
    expect(io.captured.stderr.join("")).toContain("mutually exclusive");
  });
});
