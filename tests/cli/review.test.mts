import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import {
  FENCED_APPROVE,
  NEEDS_ATTENTION_REVIEW,
  NOT_JSON,
  RAW_APPROVE,
} from "@test/fixtures/reviews.mjs";

import { assistantText, fakeAgent, makeRun } from "@test/helpers/sdk-mock.mjs";
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

function captureIO(cwd: string) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const sink = (sink: string[]): NodeJS.WritableStream =>
    new Writable({
      write(chunk, _enc, cb) {
        sink.push(chunk.toString());
        cb();
      },
    });
  return {
    stdout: sink(stdout),
    stderr: sink(stderr),
    cwd: () => cwd,
    env: process.env,
    captured: { stdout, stderr },
  };
}

const argv = (...rest: string[]): string[] => ["node", "cursor-companion", ...rest];

let workDir: string;
let stateRoot: string;

function initRepoWithDirtyFile(): void {
  // A real git repo so getDiff() returns non-empty output. We disable GPG
  // signing because some sandboxed environments (Cursor / Claude Code on the
  // web) configure a sign hook that breaks for bare-bones tests.
  const env = {
    ...process.env,
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "t@e",
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "t@e",
  };
  execFileSync("git", ["init", "-q"], { cwd: workDir, env });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: workDir, env });
  execFileSync("git", ["config", "tag.gpgsign", "false"], { cwd: workDir, env });
  writeFileSync(path.join(workDir, "foo.ts"), "export const x = 1;\n");
  execFileSync("git", ["add", "-A"], { cwd: workDir, env });
  execFileSync(
    "git",
    ["-c", "commit.gpgsign=false", "commit", "-q", "--no-gpg-sign", "-m", "init"],
    { cwd: workDir, env },
  );
  writeFileSync(path.join(workDir, "foo.ts"), "export const x = 2;\n");
}

beforeEach(() => {
  workDir = mkdtempSync(path.join(tmpdir(), "cursor-review-cwd-"));
  stateRoot = mkdtempSync(path.join(tmpdir(), "cursor-review-state-"));
  process.env.CURSOR_PLUGIN_STATE_ROOT = stateRoot;
  process.env.CURSOR_API_KEY = "test-key";
  vi.clearAllMocks();
  initRepoWithDirtyFile();
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
  rmSync(stateRoot, { recursive: true, force: true });
  delete process.env.CURSOR_PLUGIN_STATE_ROOT;
  delete process.env.CURSOR_API_KEY;
});

describe("CLI: review", () => {
  it("approve verdict exits 0 and renders summary", async () => {
    const run = makeRun({
      events: [assistantText("run-review-1", RAW_APPROVE)],
      result: { id: "run-review-1", status: "finished", result: RAW_APPROVE },
    });
    sdkMocks.agentCreate.mockResolvedValue(fakeAgent(run));

    const io = captureIO(workDir);
    expect(await companionMain(argv("review"), io)).toBe(0);
    const stdout = io.captured.stdout.join("");
    expect(stdout).toContain("approve");
    expect(stdout).toContain("Change is small and correct");
  });

  it("strips ```json fences before parsing", async () => {
    const run = makeRun({
      events: [],
      result: { id: "run-review-2", status: "finished", result: FENCED_APPROVE },
    });
    sdkMocks.agentCreate.mockResolvedValue(fakeAgent(run));

    const io = captureIO(workDir);
    expect(await companionMain(argv("review"), io)).toBe(0);
  });

  it("needs-attention verdict exits 1 with --json passes through structured payload", async () => {
    const payload = JSON.stringify(NEEDS_ATTENTION_REVIEW);
    const run = makeRun({
      events: [],
      result: { id: "run-review-3", status: "finished", result: payload },
    });
    sdkMocks.agentCreate.mockResolvedValue(fakeAgent(run));

    const io = captureIO(workDir);
    expect(await companionMain(argv("review", "--json"), io)).toBe(1);
    const stdout = io.captured.stdout.join("");
    const parsed = JSON.parse(stdout);
    expect(parsed.verdict).toBe("needs-attention");
    expect(parsed.findings).toHaveLength(1);
  });

  it("non-JSON agent output exits 1 and surfaces raw text on stderr", async () => {
    const run = makeRun({
      events: [],
      result: { id: "run-review-4", status: "finished", result: NOT_JSON },
    });
    sdkMocks.agentCreate.mockResolvedValue(fakeAgent(run));

    const io = captureIO(workDir);
    expect(await companionMain(argv("review"), io)).toBe(1);
    const stderr = io.captured.stderr.join("");
    expect(stderr).toContain("failed to parse review output");
    expect(stderr).toContain(NOT_JSON);
  });

  it("empty diff exits 0 without contacting the SDK", async () => {
    // Reset the working tree so the diff is empty.
    writeFileSync(path.join(workDir, "foo.ts"), "export const x = 1;\n");

    const io = captureIO(workDir);
    expect(await companionMain(argv("review"), io)).toBe(0);
    expect(sdkMocks.agentCreate).not.toHaveBeenCalled();
    expect(io.captured.stderr.join("")).toContain("nothing to review");
  });

  it("adversarial-review uses challenge-the-design instructions", async () => {
    const run = makeRun({
      events: [],
      result: { id: "run-review-5", status: "finished", result: RAW_APPROVE },
    });
    const agent = fakeAgent(run);
    sdkMocks.agentCreate.mockResolvedValue(agent);

    const io = captureIO(workDir);
    expect(await companionMain(argv("adversarial-review"), io)).toBe(0);
    const sent = vi.mocked(agent.send).mock.calls[0]?.[0] as string;
    expect(sent).toContain("adversarial reviewer");
    expect(sent).toContain("challenge design choices");
  });
});
