import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SDKMessage } from "@cursor/sdk";
import { argv, captureIO, sentPrompt } from "@test/helpers/io.mjs";
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
import { listJobs } from "@plugin/lib/job-control.mjs";
import { readJob, resolveStateDir } from "@plugin/lib/state.mjs";

let workDir: string;
let stateRoot: string;

beforeEach(() => {
  workDir = mkdtempSync(path.join(tmpdir(), "cursor-task-cwd-"));
  stateRoot = mkdtempSync(path.join(tmpdir(), "cursor-task-state-"));
  process.env.CURSOR_PLUGIN_STATE_ROOT = stateRoot;
  process.env.CURSOR_API_KEY = "test-key";
  vi.clearAllMocks();
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
  rmSync(stateRoot, { recursive: true, force: true });
  delete process.env.CURSOR_PLUGIN_STATE_ROOT;
  delete process.env.CURSOR_API_KEY;
});

describe("CLI: task", () => {
  it("streams agent output, marks the job completed, exits 0", async () => {
    const events: SDKMessage[] = [assistantText("run-task-1", "all good")];
    const run = makeRun({
      events,
      result: { id: "run-task-1", status: "finished", durationMs: 12 },
    });
    const agent = fakeAgent(run);
    sdkMocks.agentCreate.mockResolvedValue(agent);

    const io = captureIO(workDir);
    expect(await companionMain(argv("task", "refactor", "auth"), io)).toBe(0);
    expect(io.captured.stdout.join("")).toContain("all good");

    expect(agent.send).toHaveBeenCalledTimes(1);
    const prompt = sentPrompt(agent);
    expect(prompt).toContain("refactor auth");
    expect(prompt).toContain("Do NOT modify files");
    expect(agent[Symbol.asyncDispose]).toHaveBeenCalledTimes(1);

    const stateDir = resolveStateDir(workDir);
    const jobs = listJobs(stateDir);
    expect(jobs.length).toBe(1);
    expect(jobs[0]?.type).toBe("task");
    expect(jobs[0]?.status).toBe("completed");

    const job = readJob(stateDir, jobs[0]?.id ?? "");
    expect(job?.result).toBe("all good");
    expect(job?.agentId).toBe("agent-test");
    expect(job?.runId).toBe("run-task-1");
  });

  it("--write flips the policy to allow edits", async () => {
    const run = makeRun({
      events: [assistantText("run-write", "changes applied")],
      result: { id: "run-write", status: "finished" },
    });
    const agent = fakeAgent(run);
    sdkMocks.agentCreate.mockResolvedValue(agent);

    const io = captureIO(workDir);
    expect(await companionMain(argv("task", "fix", "the", "bug", "--write"), io)).toBe(0);

    const prompt = sentPrompt(agent);
    expect(prompt).toContain("You may modify files");
    expect(prompt).not.toContain("Do NOT modify files");
  });

  it("--background returns the job id immediately and the agent is created", async () => {
    const run = makeRun({
      events: [assistantText("run-bg", "later")],
      result: { id: "run-bg", status: "finished" },
    });
    sdkMocks.agentCreate.mockResolvedValue(fakeAgent(run));

    const io = captureIO(workDir);
    expect(await companionMain(argv("task", "long task", "--background"), io)).toBe(0);

    const out = io.captured.stdout.join("").trim();
    expect(out).toMatch(/^task-[a-f0-9]+$/);
    expect(sdkMocks.agentCreate).toHaveBeenCalledTimes(1);
  });

  it("propagates a non-finished status as exit 1", async () => {
    const run = makeRun({
      events: [],
      result: { id: "run-err", status: "error" },
    });
    sdkMocks.agentCreate.mockResolvedValue(fakeAgent(run));

    const io = captureIO(workDir);
    expect(await companionMain(argv("task", "do thing"), io)).toBe(1);
  });

  it("--prompt-file reads the prompt body from disk", async () => {
    const promptPath = path.join(workDir, "prompt.txt");
    writeFileSync(promptPath, "Body from file: refactor module X\n");

    const run = makeRun({
      events: [assistantText("run-pfile", "ok")],
      result: { id: "run-pfile", status: "finished" },
    });
    const agent = fakeAgent(run);
    sdkMocks.agentCreate.mockResolvedValue(agent);

    const io = captureIO(workDir);
    expect(await companionMain(argv("task", "--prompt-file", promptPath), io)).toBe(0);
    expect(sentPrompt(agent)).toContain("Body from file: refactor module X");
  });

  it("--prompt-file concatenates with positional prompt (positional first)", async () => {
    const promptPath = path.join(workDir, "tail.txt");
    writeFileSync(promptPath, "FILE-BODY-MARKER");

    const run = makeRun({
      events: [],
      result: { id: "run-pfile-cat", status: "finished" },
    });
    const agent = fakeAgent(run);
    sdkMocks.agentCreate.mockResolvedValue(agent);

    const io = captureIO(workDir);
    expect(
      await companionMain(argv("task", "POS-PROMPT-MARKER", "--prompt-file", promptPath), io),
    ).toBe(0);
    const prompt = sentPrompt(agent);
    const posIdx = prompt.indexOf("POS-PROMPT-MARKER");
    const fileIdx = prompt.indexOf("FILE-BODY-MARKER");
    expect(posIdx).toBeGreaterThanOrEqual(0);
    expect(fileIdx).toBeGreaterThan(posIdx);
  });

  it("--prompt-file outside workspace exits 2 with traversal error", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("task", "--prompt-file", "../../etc/passwd"), io)).toBe(2);
    expect(io.captured.stderr.join("")).toContain("must reference a path within the workspace");
  });

  it("--prompt-file with a missing path exits 2 with usage error", async () => {
    const io = captureIO(workDir);
    expect(
      await companionMain(argv("task", "--prompt-file", path.join(workDir, "nope.txt")), io),
    ).toBe(2);
    expect(io.captured.stderr.join("")).toContain("failed to read --prompt-file");
  });

  it("no prompt and no --prompt-file exits 2", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("task"), io)).toBe(2);
    expect(io.captured.stderr.join("")).toContain(
      "task requires a prompt argument or --prompt-file",
    );
  });

  it("--model id:k=v forwards variant params to Agent.create", async () => {
    const run = makeRun({
      events: [assistantText("run-model", "ok")],
      result: { id: "run-model", status: "finished" },
    });
    sdkMocks.agentCreate.mockResolvedValue(fakeAgent(run));

    const io = captureIO(workDir);
    expect(
      await companionMain(argv("task", "do thing", "--model", "gpt-5:reasoning_effort=low"), io),
    ).toBe(0);

    const call = sdkMocks.agentCreate.mock.calls[0]?.[0];
    expect(call?.model).toEqual({
      id: "gpt-5",
      params: [{ id: "reasoning_effort", value: "low" }],
    });
  });

  it("--model rejects malformed selector syntax with exit code 2", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("task", "do thing", "--model", "gpt-5:no-equals"), io)).toBe(2);
    expect(io.captured.stderr.join("")).toContain("expected key=value");
  });
});
