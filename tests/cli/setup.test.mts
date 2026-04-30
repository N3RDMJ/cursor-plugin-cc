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

import { main as companionMain } from "@plugin/cursor-companion.mjs";
import { readGateConfig } from "@plugin/lib/gate.mjs";
import { resolveStateDir } from "@plugin/lib/state.mjs";

let workDir: string;
let stateRoot: string;

beforeEach(() => {
  workDir = mkdtempSync(path.join(tmpdir(), "cursor-setup-cwd-"));
  stateRoot = mkdtempSync(path.join(tmpdir(), "cursor-setup-state-"));
  process.env.CURSOR_PLUGIN_STATE_ROOT = stateRoot;
  process.env.CURSOR_API_KEY = "test-key";
  vi.clearAllMocks();
  sdkMocks.cursorMe.mockResolvedValue({ apiKeyName: "test-key", userId: "u" });
  sdkMocks.modelsList.mockResolvedValue([
    { id: "composer-2", displayName: "Composer 2", variants: [] },
  ]);
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
  rmSync(stateRoot, { recursive: true, force: true });
  delete process.env.CURSOR_PLUGIN_STATE_ROOT;
  delete process.env.CURSOR_API_KEY;
});

describe("CLI: setup", () => {
  it("reports gate state in the default report (off by default)", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("setup"), io)).toBe(0);
    expect(io.captured.stdout.join("")).toContain("Stop gate   off");
  });

  it("--enable-gate persists enabled=true and reports 'on'", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("setup", "--enable-gate"), io)).toBe(0);
    expect(io.captured.stdout.join("")).toContain("Stop gate   on");
    const cfg = readGateConfig(resolveStateDir(workDir));
    expect(cfg.enabled).toBe(true);
  });

  it("--disable-gate persists enabled=false and reports 'off'", async () => {
    const ioOn = captureIO(workDir);
    await companionMain(argv("setup", "--enable-gate"), ioOn);
    const ioOff = captureIO(workDir);
    expect(await companionMain(argv("setup", "--disable-gate"), ioOff)).toBe(0);
    expect(ioOff.captured.stdout.join("")).toContain("Stop gate   off");
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
});
