import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  FENCED_APPROVE,
  NEEDS_ATTENTION_REVIEW,
  NOT_JSON,
  RAW_APPROVE,
} from "@test/fixtures/reviews.mjs";
import { argv, captureIO, sentPrompt } from "@test/helpers/io.mjs";

import { assistantText, fakeAgent, makeRun } from "@test/helpers/sdk-mock.mjs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

let workDir: string;
let stateRoot: string;

const FOO_TS = "foo.ts";
const ORIGINAL = "export const x = 1;\n";
const DIRTY = "export const x = 2;\n";

// GPG signing is force-disabled because some sandboxed environments install
// a sign hook that breaks bare-bones test commits.
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

beforeAll(() => {
  workDir = mkdtempSync(path.join(tmpdir(), "cursor-review-cwd-"));
  initRepo();
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

beforeEach(() => {
  stateRoot = mkdtempSync(path.join(tmpdir(), "cursor-review-state-"));
  process.env.CURSOR_PLUGIN_STATE_ROOT = stateRoot;
  process.env.CURSOR_API_KEY = "test-key";
  vi.clearAllMocks();
  writeFileSync(path.join(workDir, FOO_TS), DIRTY);
});

afterEach(() => {
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
    const parsed = JSON.parse(io.captured.stdout.join(""));
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
    writeFileSync(path.join(workDir, FOO_TS), ORIGINAL);

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
    const prompt = sentPrompt(agent);
    expect(prompt).toContain("adversarial reviewer");
    expect(prompt).toContain("Challenge design choices");
  });

  it("adversarial-review forwards positional focus text to the prompt", async () => {
    const run = makeRun({
      events: [],
      result: { id: "run-review-6", status: "finished", result: RAW_APPROVE },
    });
    const agent = fakeAgent(run);
    sdkMocks.agentCreate.mockResolvedValue(agent);

    const io = captureIO(workDir);
    expect(
      await companionMain(argv("adversarial-review", "concurrency", "and", "atomicity"), io),
    ).toBe(0);
    const prompt = sentPrompt(agent);
    expect(prompt).toContain("Reviewer focus (priority axis):");
    expect(prompt).toContain("concurrency and atomicity");
  });

  it("review rejects positional focus text (only adversarial-review accepts it)", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("review", "look", "at", "auth"), io)).toBe(2);
    expect(io.captured.stderr.join("")).toContain("focus text is only accepted");
    expect(sdkMocks.agentCreate).not.toHaveBeenCalled();
  });

  it("--scope working-tree is honored even on a clean tree (forces working-tree mode)", async () => {
    const run = makeRun({
      events: [],
      result: { id: "run-review-scope-wt", status: "finished", result: RAW_APPROVE },
    });
    const agent = fakeAgent(run);
    sdkMocks.agentCreate.mockResolvedValue(agent);

    const io = captureIO(workDir);
    expect(await companionMain(argv("review", "--scope", "working-tree"), io)).toBe(0);
    const prompt = sentPrompt(agent);
    expect(prompt).toContain("Review target: working tree diff");
  });

  it("--scope branch picks the detected default branch as the diff base", async () => {
    // commit the dirty change so working tree is clean — branch mode then
    // diffs against detected default branch (master/main)
    const env = {
      ...process.env,
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "t@e",
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "t@e",
    };
    execFileSync("git", ["checkout", "-q", "-b", "feature"], {
      cwd: workDir,
      env,
      stdio: "ignore",
    });
    execFileSync("git", ["add", "-A"], { cwd: workDir, env, stdio: "ignore" });
    execFileSync(
      "git",
      ["-c", "commit.gpgsign=false", "commit", "-q", "--no-gpg-sign", "-m", "feat"],
      { cwd: workDir, env, stdio: "ignore" },
    );

    const run = makeRun({
      events: [],
      result: { id: "run-review-scope-br", status: "finished", result: RAW_APPROVE },
    });
    const agent = fakeAgent(run);
    sdkMocks.agentCreate.mockResolvedValue(agent);

    const io = captureIO(workDir);
    try {
      expect(await companionMain(argv("review", "--scope", "branch"), io)).toBe(0);
      const prompt = sentPrompt(agent);
      expect(prompt).toMatch(/Review target: branch diff against (main|master|trunk)/);
    } finally {
      // restore master/main as HEAD so other tests in this suite are unaffected
      execFileSync("git", ["checkout", "-q", "-"], { cwd: workDir, env, stdio: "ignore" });
      execFileSync("git", ["branch", "-q", "-D", "feature"], {
        cwd: workDir,
        env,
        stdio: "ignore",
      });
    }
  });

  it("--scope rejects an invalid value", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("review", "--scope", "bogus"), io)).toBe(2);
    expect(io.captured.stderr.join("")).toContain("invalid --scope");
  });

  it("--staged is mutually exclusive with --scope branch", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("review", "--staged", "--scope", "branch"), io)).toBe(2);
    expect(io.captured.stderr.join("")).toContain("--staged is only compatible");
  });
});
