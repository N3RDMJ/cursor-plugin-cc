import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import type { SDKMessage } from "@cursor/sdk";
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
import { readJob } from "@plugin/lib/state.mjs";

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
    const code = await companionMain(argv("task", "refactor", "auth"), io);
    expect(code).toBe(0);

    const stdout = io.captured.stdout.join("");
    expect(stdout).toContain("all good");

    expect(agent.send).toHaveBeenCalledTimes(1);
    const sentPrompt = vi.mocked(agent.send).mock.calls[0]?.[0] as string;
    expect(sentPrompt).toContain("refactor auth");
    expect(sentPrompt).toContain("Do NOT modify files");
    expect(agent[Symbol.asyncDispose]).toHaveBeenCalledTimes(1);

    const jobs = listJobs(path.join(stateRoot, listFirstWorkspaceSlug(stateRoot)));
    expect(jobs.length).toBe(1);
    expect(jobs[0]?.type).toBe("task");
    expect(jobs[0]?.status).toBe("completed");

    const job = readJob(path.join(stateRoot, listFirstWorkspaceSlug(stateRoot)), jobs[0]?.id ?? "");
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

    const sent = vi.mocked(agent.send).mock.calls[0]?.[0] as string;
    expect(sent).toContain("You may modify files");
    expect(sent).not.toContain("Do NOT modify files");
  });

  it("--background returns the job id immediately and the agent is created", async () => {
    const run = makeRun({
      events: [assistantText("run-bg", "later")],
      result: { id: "run-bg", status: "finished" },
    });
    const agent = fakeAgent(run);
    sdkMocks.agentCreate.mockResolvedValue(agent);

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
});

/**
 * Find the single workspace state slug created by a task run inside the
 * isolated stateRoot. Since each test uses a fresh stateRoot containing one
 * workspace, returning the first entry is unambiguous.
 */
function listFirstWorkspaceSlug(stateRoot: string): string {
  const entries = readdirSync(stateRoot);
  if (entries.length === 0) throw new Error("no workspace slug created");
  return entries[0] ?? "";
}
