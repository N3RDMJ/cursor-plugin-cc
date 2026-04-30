import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CursorRunResult } from "../../../plugins/cursor/scripts/lib/cursor-agent.mjs";
import {
  cancelJob,
  createJob,
  findRecentTaskAgents,
  getActiveRun,
  getJob,
  listJobs,
  logJobLine,
  markFailed,
  markFinished,
  markRunning,
  registerActiveRun,
  unregisterActiveRun,
} from "../../../plugins/cursor/scripts/lib/job-control.mjs";
import { readJobLog } from "../../../plugins/cursor/scripts/lib/state.mjs";

let stateDir: string;

beforeEach(() => {
  stateDir = mkdtempSync(path.join(tmpdir(), "cursor-jobctl-"));
});

afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

describe("createJob / getJob / listJobs", () => {
  it("creates a pending job, persists it, and exposes it via list", () => {
    const job = createJob(stateDir, { type: "task", prompt: "do thing" });
    expect(job.status).toBe("pending");
    expect(job.id.startsWith("task-")).toBe(true);
    const fetched = getJob(stateDir, job.id);
    expect(fetched?.id).toBe(job.id);
    const listed = listJobs(stateDir);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(job.id);
    expect(listed[0]?.summary).toBe("do thing");
  });

  it("uses an 'adv-' prefix for adversarial-review jobs", () => {
    const job = createJob(stateDir, { type: "adversarial-review", prompt: "challenge" });
    expect(job.id.startsWith("adv-")).toBe(true);
  });

  it("does not mutate the caller's metadata object when summary is also passed", () => {
    const callerMetadata = { tag: "regression" };
    const job = createJob(stateDir, {
      type: "task",
      prompt: "x",
      summary: "explicit summary",
      metadata: callerMetadata,
    });
    expect(callerMetadata).toEqual({ tag: "regression" });
    expect(job.metadata).toEqual({ tag: "regression", summary: "explicit summary" });
  });

  it("filters by type and status, and respects limit", () => {
    createJob(stateDir, { type: "task", prompt: "a" });
    const r = createJob(stateDir, { type: "review", prompt: "b" });
    createJob(stateDir, { type: "task", prompt: "c" });

    expect(listJobs(stateDir, { type: "review" })).toHaveLength(1);
    expect(listJobs(stateDir, { status: "pending" })).toHaveLength(3);
    expect(listJobs(stateDir, { limit: 1 })).toHaveLength(1);

    markFinished(stateDir, r.id, fakeResult({ status: "finished" }));
    expect(listJobs(stateDir, { status: "completed" })).toHaveLength(1);
  });
});

describe("state transitions", () => {
  it("markRunning stamps agent/run ids and startedAt", () => {
    const job = createJob(stateDir, { type: "task", prompt: "x" });
    const after = markRunning(stateDir, job.id, { agentId: "a-1", runId: "r-1" });
    expect(after.status).toBe("running");
    expect(after.agentId).toBe("a-1");
    expect(after.runId).toBe("r-1");
    expect(after.startedAt).toBeDefined();
  });

  it("markFinished maps CursorAgentStatus to JobStatus", () => {
    const j1 = createJob(stateDir, { type: "task", prompt: "1" });
    expect(markFinished(stateDir, j1.id, fakeResult({ status: "finished" })).status).toBe(
      "completed",
    );

    const j2 = createJob(stateDir, { type: "task", prompt: "2" });
    expect(markFinished(stateDir, j2.id, fakeResult({ status: "error" })).status).toBe("failed");

    const j3 = createJob(stateDir, { type: "task", prompt: "3" });
    expect(markFinished(stateDir, j3.id, fakeResult({ status: "cancelled" })).status).toBe(
      "cancelled",
    );

    const j4 = createJob(stateDir, { type: "task", prompt: "4" });
    const expired = markFinished(stateDir, j4.id, fakeResult({ status: "expired" }));
    expect(expired.status).toBe("cancelled");
    expect(expired.metadata?.expired).toBe(true);
  });

  it("markFinished records timedOut metadata", () => {
    const job = createJob(stateDir, { type: "task", prompt: "to" });
    const after = markFinished(
      stateDir,
      job.id,
      fakeResult({ status: "cancelled", timedOut: true }),
    );
    expect(after.metadata?.timedOut).toBe(true);
  });

  it("markFailed records the error message", () => {
    const job = createJob(stateDir, { type: "task", prompt: "broken" });
    const after = markFailed(stateDir, job.id, "boom");
    expect(after.status).toBe("failed");
    expect(after.error).toBe("boom");
  });

  it("markFailed scrubs CURSOR_API_KEY from the persisted error", () => {
    const original = process.env.CURSOR_API_KEY;
    process.env.CURSOR_API_KEY = "key_persistedsecret_98765";
    try {
      const job = createJob(stateDir, { type: "task", prompt: "broken" });
      const after = markFailed(stateDir, job.id, "auth=key_persistedsecret_98765 failed");
      expect(after.error).toBe("auth=[REDACTED] failed");
    } finally {
      if (original === undefined) delete process.env.CURSOR_API_KEY;
      else process.env.CURSOR_API_KEY = original;
    }
  });

  it("update of a missing id throws", () => {
    expect(() => markFailed(stateDir, "missing-job", "x")).toThrow(/job not found/);
  });
});

describe("cancelJob", () => {
  it("returns cancelled=false with a reason when the job does not exist", async () => {
    const r = await cancelJob(stateDir, "missing-job");
    expect(r.cancelled).toBe(false);
    expect(r.reason).toMatch(/not found/);
  });

  it("returns cancelled=false when the job is already terminal", async () => {
    const job = createJob(stateDir, { type: "task", prompt: "x" });
    markFinished(stateDir, job.id, fakeResult({ status: "finished" }));
    const r = await cancelJob(stateDir, job.id);
    expect(r.cancelled).toBe(false);
    expect(r.reason).toMatch(/completed/);
  });

  it("marks pending+no-active-run as cancelled with run-not-active", async () => {
    const job = createJob(stateDir, { type: "task", prompt: "x" });
    const r = await cancelJob(stateDir, job.id);
    expect(r.cancelled).toBe(true);
    expect(r.reason).toBe("run-not-active");
    expect(r.job?.status).toBe("cancelled");
  });

  it("calls run.cancel() when an active run is registered", async () => {
    const job = createJob(stateDir, { type: "task", prompt: "x" });
    markRunning(stateDir, job.id, { agentId: "a", runId: "r" });
    const cancel = vi.fn(async () => undefined);
    registerActiveRun(job.id, {
      supports: () => true,
      unsupportedReason: () => undefined,
      cancel,
    } as unknown as Parameters<typeof registerActiveRun>[1]);

    const r = await cancelJob(stateDir, job.id);
    expect(cancel).toHaveBeenCalled();
    expect(r.cancelled).toBe(true);
    expect(r.job?.status).toBe("cancelled");
    expect(getActiveRun(job.id)).toBeUndefined();
  });

  it("propagates the SDK reason when the run cannot be cancelled", async () => {
    const job = createJob(stateDir, { type: "task", prompt: "x" });
    markRunning(stateDir, job.id, { agentId: "a", runId: "r" });
    registerActiveRun(job.id, {
      supports: () => false,
      unsupportedReason: () => "already finished",
      cancel: vi.fn(),
    } as unknown as Parameters<typeof registerActiveRun>[1]);

    const r = await cancelJob(stateDir, job.id);
    expect(r.cancelled).toBe(false);
    expect(r.reason).toBe("already finished");
    unregisterActiveRun(job.id);
  });
});

describe("findRecentTaskAgents", () => {
  it("returns empty when there are no task jobs with agent ids", () => {
    expect(findRecentTaskAgents(stateDir)).toEqual([]);
    createJob(stateDir, { type: "task", prompt: "no-agent-yet" });
    expect(findRecentTaskAgents(stateDir)).toEqual([]);
  });

  it("returns task jobs with agent ids, newest first, capped by limit", async () => {
    const a = createJob(stateDir, { type: "task", prompt: "first" });
    markRunning(stateDir, a.id, { agentId: "agent-a", runId: "run-a" });
    await new Promise((r) => setTimeout(r, 5));
    const b = createJob(stateDir, { type: "task", prompt: "second" });
    markRunning(stateDir, b.id, { agentId: "agent-b", runId: "run-b" });
    await new Promise((r) => setTimeout(r, 5));
    const c = createJob(stateDir, { type: "task", prompt: "third" });
    markRunning(stateDir, c.id, { agentId: "agent-c", runId: "run-c" });

    const all = findRecentTaskAgents(stateDir, 5);
    expect(all.map((r) => r.agentId)).toEqual(["agent-c", "agent-b", "agent-a"]);
    expect(all[0]?.summary).toBe("third");

    const top1 = findRecentTaskAgents(stateDir, 1);
    expect(top1).toHaveLength(1);
    expect(top1[0]?.agentId).toBe("agent-c");
  });

  it("ignores non-task jobs", () => {
    const r = createJob(stateDir, { type: "review", prompt: "diff" });
    markRunning(stateDir, r.id, { agentId: "agent-review", runId: "run-r" });
    expect(findRecentTaskAgents(stateDir)).toEqual([]);
  });
});

describe("logJobLine", () => {
  it("appends to the job log file with a trailing newline", () => {
    const job = createJob(stateDir, { type: "task", prompt: "x" });
    logJobLine(stateDir, job.id, "hello");
    logJobLine(stateDir, job.id, "world\n");
    expect(readJobLog(stateDir, job.id)).toBe("hello\nworld\n");
  });

  it("scrubs CURSOR_API_KEY from logged lines before they hit disk", () => {
    const original = process.env.CURSOR_API_KEY;
    process.env.CURSOR_API_KEY = "key_loglinesecret_55555";
    try {
      const job = createJob(stateDir, { type: "task", prompt: "x" });
      logJobLine(stateDir, job.id, "tool key_loglinesecret_55555 invoked");
      expect(readJobLog(stateDir, job.id)).toBe("tool [REDACTED] invoked\n");
    } finally {
      if (original === undefined) delete process.env.CURSOR_API_KEY;
      else process.env.CURSOR_API_KEY = original;
    }
  });
});

function fakeResult(overrides: Partial<CursorRunResult>): CursorRunResult {
  return {
    status: "finished",
    output: "ok",
    toolCalls: [],
    agentId: "a",
    runId: "r",
    ...overrides,
  };
}
