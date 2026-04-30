import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NEEDS_ATTENTION_REVIEW, RAW_APPROVE } from "@test/fixtures/reviews.mjs";
import { captureHookIO } from "@test/helpers/io.mjs";
import { fakeAgent, makeRun } from "@test/helpers/sdk-mock.mjs";
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

import { setGateEnabled } from "@plugin/lib/gate.mjs";
import { ensureStateDir, resolveStateDir } from "@plugin/lib/state.mjs";
import { main as gateMain } from "@plugin/stop-review-gate-hook.mjs";

let workDir: string;
let stateRoot: string;

const FOO_TS = "foo.ts";
const ORIGINAL = "export const x = 1;\n";
const DIRTY = "export const x = 2;\n";

function initRepo(): void {
  const env = {
    ...process.env,
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "t@e",
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "t@e",
  };
  execFileSync("git", ["init", "-q"], { cwd: workDir, env });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: workDir, env });
  writeFileSync(path.join(workDir, FOO_TS), ORIGINAL);
  execFileSync("git", ["add", "-A"], { cwd: workDir, env });
  execFileSync(
    "git",
    ["-c", "commit.gpgsign=false", "commit", "-q", "--no-gpg-sign", "-m", "init"],
    { cwd: workDir, env },
  );
}

const captureIO = (stdin: string, cwd: string = workDir) => captureHookIO(stdin, cwd);

beforeEach(() => {
  workDir = mkdtempSync(path.join(tmpdir(), "cursor-gate-cwd-"));
  stateRoot = mkdtempSync(path.join(tmpdir(), "cursor-gate-state-"));
  process.env.CURSOR_PLUGIN_STATE_ROOT = stateRoot;
  process.env.CURSOR_API_KEY = "test-key";
  initRepo();
  vi.clearAllMocks();
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
  rmSync(stateRoot, { recursive: true, force: true });
  delete process.env.CURSOR_PLUGIN_STATE_ROOT;
  delete process.env.CURSOR_API_KEY;
});

describe("stop-review-gate-hook", () => {
  it("allows when the gate is disabled (default)", async () => {
    writeFileSync(path.join(workDir, FOO_TS), DIRTY);
    const io = captureIO(JSON.stringify({ cwd: workDir }));
    expect(await gateMain(io)).toBe(0);
    expect(io.captured.stdout.join("")).toBe("");
    expect(sdkMocks.agentCreate).not.toHaveBeenCalled();
  });

  it("allows when the working tree has no diff", async () => {
    const stateDir = resolveStateDir(workDir);
    ensureStateDir(stateDir);
    setGateEnabled(stateDir, true);
    const io = captureIO(JSON.stringify({ cwd: workDir }));
    expect(await gateMain(io)).toBe(0);
    expect(io.captured.stdout.join("")).toBe("");
    expect(sdkMocks.agentCreate).not.toHaveBeenCalled();
  });

  it("allows when stop_hook_active is true (no infinite loop)", async () => {
    writeFileSync(path.join(workDir, FOO_TS), DIRTY);
    const stateDir = resolveStateDir(workDir);
    ensureStateDir(stateDir);
    setGateEnabled(stateDir, true);
    const io = captureIO(JSON.stringify({ cwd: workDir, stop_hook_active: true }));
    expect(await gateMain(io)).toBe(0);
    expect(io.captured.stdout.join("")).toBe("");
    expect(sdkMocks.agentCreate).not.toHaveBeenCalled();
  });

  it("allows on approve verdict", async () => {
    writeFileSync(path.join(workDir, FOO_TS), DIRTY);
    const stateDir = resolveStateDir(workDir);
    ensureStateDir(stateDir);
    setGateEnabled(stateDir, true);
    const run = makeRun({
      events: [],
      result: { id: "run-gate-1", status: "finished", result: RAW_APPROVE },
    });
    sdkMocks.agentCreate.mockResolvedValue(fakeAgent(run));

    const io = captureIO(JSON.stringify({ cwd: workDir }));
    expect(await gateMain(io)).toBe(0);
    expect(io.captured.stdout.join("")).toBe("");
    expect(sdkMocks.agentCreate).toHaveBeenCalledTimes(1);
  });

  it("blocks on needs-attention verdict with structured decision JSON", async () => {
    writeFileSync(path.join(workDir, FOO_TS), DIRTY);
    const stateDir = resolveStateDir(workDir);
    ensureStateDir(stateDir);
    setGateEnabled(stateDir, true);
    const payload = JSON.stringify(NEEDS_ATTENTION_REVIEW);
    const run = makeRun({
      events: [],
      result: { id: "run-gate-2", status: "finished", result: payload },
    });
    sdkMocks.agentCreate.mockResolvedValue(fakeAgent(run));

    const io = captureIO(JSON.stringify({ cwd: workDir }));
    expect(await gateMain(io)).toBe(0);
    const stdout = io.captured.stdout.join("");
    expect(stdout.length).toBeGreaterThan(0);
    const decision = JSON.parse(stdout);
    expect(decision.decision).toBe("block");
    expect(decision.reason).toContain("needs-attention");
    expect(decision.reason).toContain("Stray console.log");
  });

  it("fail-opens (allows + warns on stderr) when the SDK throws", async () => {
    writeFileSync(path.join(workDir, FOO_TS), DIRTY);
    const stateDir = resolveStateDir(workDir);
    ensureStateDir(stateDir);
    setGateEnabled(stateDir, true);
    sdkMocks.agentCreate.mockRejectedValue(new Error("network down"));

    const io = captureIO(JSON.stringify({ cwd: workDir }));
    expect(await gateMain(io)).toBe(0);
    expect(io.captured.stdout.join("")).toBe("");
    expect(io.captured.stderr.join("")).toContain("network down");
    expect(io.captured.stderr.join("")).toContain("allowing");
  });

  it("fail-opens when the agent output is not parseable JSON", async () => {
    writeFileSync(path.join(workDir, FOO_TS), DIRTY);
    const stateDir = resolveStateDir(workDir);
    ensureStateDir(stateDir);
    setGateEnabled(stateDir, true);
    const run = makeRun({
      events: [],
      result: { id: "run-gate-3", status: "finished", result: "not json at all" },
    });
    sdkMocks.agentCreate.mockResolvedValue(fakeAgent(run));

    const io = captureIO(JSON.stringify({ cwd: workDir }));
    expect(await gateMain(io)).toBe(0);
    expect(io.captured.stdout.join("")).toBe("");
    expect(io.captured.stderr.join("")).toContain("could not parse review");
  });

  it("fail-opens when the run does not finish", async () => {
    writeFileSync(path.join(workDir, FOO_TS), DIRTY);
    const stateDir = resolveStateDir(workDir);
    ensureStateDir(stateDir);
    setGateEnabled(stateDir, true);
    const run = makeRun({
      events: [],
      result: { id: "run-gate-4", status: "error" },
    });
    sdkMocks.agentCreate.mockResolvedValue(fakeAgent(run));

    const io = captureIO(JSON.stringify({ cwd: workDir }));
    expect(await gateMain(io)).toBe(0);
    expect(io.captured.stdout.join("")).toBe("");
    expect(io.captured.stderr.join("")).toContain("did not finish");
  });
});
