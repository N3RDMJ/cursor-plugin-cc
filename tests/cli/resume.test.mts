import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { argv, captureIO, sentPrompt } from "@test/helpers/io.mjs";
import { assistantText, fakeAgent, makeRun } from "@test/helpers/sdk-mock.mjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdkMocks = vi.hoisted(() => ({
  agentCreate: vi.fn(),
  agentResume: vi.fn(),
  agentList: vi.fn(),
  cursorMe: vi.fn(),
  modelsList: vi.fn(),
}));

vi.mock("@cursor/sdk", async () => {
  const actual = await vi.importActual<typeof import("@cursor/sdk")>("@cursor/sdk");
  return {
    ...actual,
    Agent: {
      create: sdkMocks.agentCreate,
      resume: sdkMocks.agentResume,
      list: sdkMocks.agentList,
    },
    Cursor: { me: sdkMocks.cursorMe, models: { list: sdkMocks.modelsList } },
  };
});

import { main as companionMain } from "@plugin/cursor-companion.mjs";
import { createJob, listJobs, markRunning } from "@plugin/lib/job-control.mjs";
import { ensureStateDir, readJob, resolveStateDir } from "@plugin/lib/state.mjs";

let workDir: string;
let stateRoot: string;
let stateDir: string;

beforeEach(() => {
  workDir = mkdtempSync(path.join(tmpdir(), "cursor-resume-cwd-"));
  stateRoot = mkdtempSync(path.join(tmpdir(), "cursor-resume-state-"));
  process.env.CURSOR_PLUGIN_STATE_ROOT = stateRoot;
  process.env.CURSOR_API_KEY = "test-key";
  stateDir = ensureStateDir(resolveStateDir(workDir));
  vi.clearAllMocks();
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
  rmSync(stateRoot, { recursive: true, force: true });
  delete process.env.CURSOR_PLUGIN_STATE_ROOT;
  delete process.env.CURSOR_API_KEY;
});

function seedAgent(jobPrompt: string, agentId: string): string {
  const job = createJob(stateDir, { type: "task", prompt: jobPrompt });
  markRunning(stateDir, job.id, { agentId, runId: `${agentId}-r` });
  return job.id;
}

describe("CLI: resume", () => {
  it("resumes the supplied agent id and streams the follow-up output", async () => {
    seedAgent("first turn", "agent-keep-going");

    const run = makeRun({
      events: [assistantText("run-resume-1", "continued")],
      result: { id: "run-resume-1", status: "finished", durationMs: 7 },
    });
    const agent = fakeAgent(run);
    sdkMocks.agentResume.mockResolvedValue(agent);

    const io = captureIO(workDir);
    expect(await companionMain(argv("resume", "agent-keep-going", "next", "step"), io)).toBe(0);

    expect(sdkMocks.agentResume).toHaveBeenCalledTimes(1);
    expect(sdkMocks.agentResume.mock.calls[0]?.[0]).toBe("agent-keep-going");
    expect(io.captured.stdout.join("")).toContain("continued");

    const prompt = sentPrompt(agent);
    expect(prompt).toContain("next step");
    expect(prompt).toContain("Do NOT modify files");

    const resumeJob = listJobs(stateDir).find((j) => j.summary === "next step");
    expect(resumeJob?.status).toBe("completed");
    const persisted = readJob(stateDir, resumeJob?.id ?? "");
    expect(persisted?.metadata?.resumedAgentId).toBe("agent-keep-going");
    expect(persisted?.agentId).toBe("agent-test");
  });

  it("--last picks the most recent task agent for this workspace", async () => {
    seedAgent("first", "agent-old");
    await new Promise((r) => setTimeout(r, 5));
    seedAgent("second", "agent-new");

    const run = makeRun({
      events: [assistantText("run-last", "ok")],
      result: { id: "run-last", status: "finished" },
    });
    sdkMocks.agentResume.mockResolvedValue(fakeAgent(run));

    const io = captureIO(workDir);
    expect(await companionMain(argv("resume", "--last", "follow", "up"), io)).toBe(0);

    expect(sdkMocks.agentResume).toHaveBeenCalledTimes(1);
    expect(sdkMocks.agentResume.mock.calls[0]?.[0]).toBe("agent-new");
  });

  it("--last with no prior agents exits 1 with a diagnostic", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("resume", "--last", "anything"), io)).toBe(1);
    expect(io.captured.stderr.join("")).toContain("no previous task agent to resume");
    expect(sdkMocks.agentResume).not.toHaveBeenCalled();
  });

  it("--list --local prints recent agent ids and skips the SDK", async () => {
    seedAgent("alpha", "agent-alpha");
    await new Promise((r) => setTimeout(r, 5));
    seedAgent("beta", "agent-beta");

    const io = captureIO(workDir);
    expect(await companionMain(argv("resume", "--list", "--local"), io)).toBe(0);
    const out = io.captured.stdout.join("");
    expect(out).toContain("AGENT-ID");
    expect(out).toContain("agent-alpha");
    expect(out).toContain("agent-beta");
    expect(sdkMocks.agentResume).not.toHaveBeenCalled();
    expect(sdkMocks.agentList).not.toHaveBeenCalled();
  });

  it("--list --local --json emits a flat array of local rows", async () => {
    seedAgent("alpha", "agent-alpha");

    const io = captureIO(workDir);
    expect(await companionMain(argv("resume", "--list", "--local", "--json"), io)).toBe(0);
    const parsed = JSON.parse(io.captured.stdout.join(""));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].agentId).toBe("agent-alpha");
    expect(parsed[0].summary).toBe("alpha");
  });

  it("--list (default) merges local with SDK durable agents not in the local index", async () => {
    seedAgent("alpha", "agent-alpha");
    sdkMocks.agentList.mockResolvedValue({
      items: [
        {
          agentId: "agent-alpha", // dup with local — should be filtered
          name: "dup",
          summary: "dup",
          lastModified: 1_700_000_000_000,
        },
        {
          agentId: "agent-only-sdk",
          name: "Remote A",
          summary: "From the SDK",
          lastModified: 1_700_000_000_000,
        },
      ],
    });

    const io = captureIO(workDir);
    expect(await companionMain(argv("resume", "--list"), io)).toBe(0);
    expect(sdkMocks.agentList).toHaveBeenCalledTimes(1);
    const out = io.captured.stdout.join("");
    expect(out).toContain("agent-alpha");
    expect(out).toContain("agent-only-sdk");
    expect(out).toContain("Additional durable agents reported by the SDK (1)");
  });

  it("--list (default) soft-fails when SDK list throws and notes it on stderr", async () => {
    seedAgent("alpha", "agent-alpha");
    sdkMocks.agentList.mockRejectedValue(new Error("network down"));

    const io = captureIO(workDir);
    expect(await companionMain(argv("resume", "--list"), io)).toBe(0);
    expect(io.captured.stdout.join("")).toContain("agent-alpha");
    expect(io.captured.stderr.join("")).toContain("SDK agent list failed");
    expect(io.captured.stderr.join("")).toContain("network down");
  });

  it("--list --json emits the merged structured shape", async () => {
    seedAgent("alpha", "agent-alpha");
    sdkMocks.agentList.mockResolvedValue({
      items: [
        {
          agentId: "agent-only-sdk",
          name: "x",
          summary: "y",
          lastModified: 1,
        },
      ],
    });

    const io = captureIO(workDir);
    expect(await companionMain(argv("resume", "--list", "--json"), io)).toBe(0);
    const parsed = JSON.parse(io.captured.stdout.join(""));
    expect(Array.isArray(parsed.local)).toBe(true);
    expect(parsed.local[0].agentId).toBe("agent-alpha");
    expect(Array.isArray(parsed.remoteOnly)).toBe(true);
    expect(parsed.remoteOnly[0].agentId).toBe("agent-only-sdk");
    expect(parsed.remoteError).toBeNull();
  });

  it("--list with no local jobs prints '(no resumable agents)'", async () => {
    sdkMocks.agentList.mockResolvedValue({ items: [] });
    const io = captureIO(workDir);
    expect(await companionMain(argv("resume", "--list"), io)).toBe(0);
    expect(io.captured.stdout.join("")).toContain("(no resumable agents)");
  });

  it("--list --local --remote is rejected", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("resume", "--list", "--local", "--remote"), io)).toBe(2);
    expect(io.captured.stderr.join("")).toContain("mutually exclusive");
  });

  it("--local without --list is rejected", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("resume", "--local", "agent-x", "go"), io)).toBe(2);
    expect(io.captured.stderr.join("")).toContain("--local requires --list");
  });

  it("--write flips the policy and is reflected in the prompt", async () => {
    seedAgent("first", "agent-x");
    const run = makeRun({
      events: [assistantText("run-write", "edited")],
      result: { id: "run-write", status: "finished" },
    });
    const agent = fakeAgent(run);
    sdkMocks.agentResume.mockResolvedValue(agent);

    const io = captureIO(workDir);
    expect(
      await companionMain(argv("resume", "agent-x", "fix", "the", "thing", "--write"), io),
    ).toBe(0);
    const prompt = sentPrompt(agent);
    expect(prompt).toContain("You may modify files");
  });

  it("--background returns the new job id immediately", async () => {
    seedAgent("first", "agent-bg");
    const run = makeRun({
      events: [assistantText("run-bg", "later")],
      result: { id: "run-bg", status: "finished" },
    });
    sdkMocks.agentResume.mockResolvedValue(fakeAgent(run));

    const io = captureIO(workDir);
    expect(await companionMain(argv("resume", "agent-bg", "--background", "go"), io)).toBe(0);
    const out = io.captured.stdout.join("").trim();
    expect(out).toMatch(/^task-[a-f0-9]+$/);
  });

  it("missing agent-id without --last/--list exits 2 (UsageError)", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("resume"), io)).toBe(2);
    expect(io.captured.stderr.join("")).toContain("resume requires <agent-id>");
  });

  it("agent-id without a prompt exits 2 (UsageError)", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("resume", "agent-x"), io)).toBe(2);
    expect(io.captured.stderr.join("")).toContain("requires a prompt");
  });

  it("--list and --last together exit 2", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("resume", "--list", "--last", "x"), io)).toBe(2);
    expect(io.captured.stderr.join("")).toContain("mutually exclusive");
  });

  it("--limit without --list is rejected", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("resume", "agent-x", "--limit", "3", "go"), io)).toBe(2);
    expect(io.captured.stderr.join("")).toContain("--limit requires --list");
  });

  it("propagates a non-finished status as exit 1", async () => {
    seedAgent("first", "agent-err");
    const run = makeRun({
      events: [],
      result: { id: "run-err", status: "error" },
    });
    sdkMocks.agentResume.mockResolvedValue(fakeAgent(run));

    const io = captureIO(workDir);
    expect(await companionMain(argv("resume", "agent-err", "do", "x"), io)).toBe(1);
  });

  it("records markFailed when SDK Agent.resume throws", async () => {
    seedAgent("first", "agent-bad");
    sdkMocks.agentResume.mockRejectedValue(new Error("session expired"));

    const io = captureIO(workDir);
    expect(await companionMain(argv("resume", "agent-bad", "go"), io)).toBe(1);
    const err = io.captured.stderr.join("");
    expect(err).toContain("session expired");

    const failed = listJobs(stateDir).find((j) => j.status === "failed");
    expect(failed).toBeDefined();
    const persisted = readJob(stateDir, failed?.id ?? "");
    expect(persisted?.error).toContain("resume failed for agent-bad");
  });

  it("--list --remote queries the SDK and renders the durable rows", async () => {
    sdkMocks.agentList.mockResolvedValue({
      items: [
        {
          agentId: "agent-remote-1",
          name: "Remote agent A",
          summary: "Refactor module foo",
          lastModified: 1_700_000_000_000,
          status: "finished",
          runtime: "local",
        },
      ],
    });

    const io = captureIO(workDir);
    expect(await companionMain(argv("resume", "--list", "--remote"), io)).toBe(0);
    expect(sdkMocks.agentList).toHaveBeenCalledTimes(1);
    expect(sdkMocks.agentList).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: "local", cwd: workDir }),
    );
    const stdout = io.captured.stdout.join("");
    expect(stdout).toContain("agent-remote-1");
    expect(stdout).toContain("Refactor module foo");
    expect(stdout).toContain("finished");
  });

  it("--list --remote --json passes through the SDK rows as JSON", async () => {
    sdkMocks.agentList.mockResolvedValue({
      items: [
        {
          agentId: "agent-remote-json",
          name: "x",
          summary: "y",
          lastModified: 1,
        },
      ],
    });

    const io = captureIO(workDir);
    expect(await companionMain(argv("resume", "--list", "--remote", "--json"), io)).toBe(0);
    const parsed = JSON.parse(io.captured.stdout.join(""));
    expect(parsed[0].agentId).toBe("agent-remote-json");
  });

  it("--list --remote --cloud passes runtime: cloud to Agent.list", async () => {
    sdkMocks.agentList.mockResolvedValue({ items: [] });

    const io = captureIO(workDir);
    expect(await companionMain(argv("resume", "--list", "--remote", "--cloud"), io)).toBe(0);
    expect(sdkMocks.agentList).toHaveBeenCalledWith(expect.objectContaining({ runtime: "cloud" }));
    expect(io.captured.stdout.join("")).toContain("(no durable agents reported by the SDK)");
  });

  it("--remote without --list is rejected", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("resume", "--remote", "agent-x", "go"), io)).toBe(2);
    expect(io.captured.stderr.join("")).toContain("--remote requires --list");
  });

  it("--list --cloud without --remote is rejected", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("resume", "--list", "--cloud"), io)).toBe(2);
    expect(io.captured.stderr.join("")).toContain("--list --cloud requires --remote");
  });
});
