import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { main as companionMain } from "@plugin/cursor-companion.mjs";
import { createJob, logJobLine, markFailed, markRunning } from "@plugin/lib/job-control.mjs";
import { ensureStateDir, resolveStateDir } from "@plugin/lib/state.mjs";
import { argv, captureIO } from "@test/helpers/io.mjs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let workDir: string;
let stateRoot: string;

beforeEach(() => {
  workDir = mkdtempSync(path.join(tmpdir(), "cursor-status-cwd-"));
  stateRoot = mkdtempSync(path.join(tmpdir(), "cursor-status-state-"));
  process.env.CURSOR_PLUGIN_STATE_ROOT = stateRoot;
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
  rmSync(stateRoot, { recursive: true, force: true });
  delete process.env.CURSOR_PLUGIN_STATE_ROOT;
});

describe("CLI: status --wait", () => {
  it("returns immediately when the job is already terminal", async () => {
    const stateDir = ensureStateDir(resolveStateDir(workDir));
    const job = createJob(stateDir, { type: "task", prompt: "done" });
    markFailed(stateDir, job.id, "boom");

    const io = captureIO(workDir);
    const code = await companionMain(
      argv("status", job.id, "--wait", "--timeout-ms", "5000", "--poll-ms", "10"),
      io,
    );
    expect(code).toBe(0);
    expect(io.captured.stdout.join("")).toContain("status:     failed");
  });

  it("polls until the job becomes terminal", async () => {
    const stateDir = ensureStateDir(resolveStateDir(workDir));
    const job = createJob(stateDir, { type: "task", prompt: "running" });
    markRunning(stateDir, job.id, { agentId: "agent-x", runId: "run-x" });

    setTimeout(() => {
      markFailed(stateDir, job.id, "later failure");
    }, 25);

    const io = captureIO(workDir);
    const code = await companionMain(
      argv("status", job.id, "--wait", "--timeout-ms", "2000", "--poll-ms", "10"),
      io,
    );
    expect(code).toBe(0);
    expect(io.captured.stdout.join("")).toContain("status:     failed");
  });

  it("times out and returns 1 when the job stays non-terminal", async () => {
    const stateDir = ensureStateDir(resolveStateDir(workDir));
    const job = createJob(stateDir, { type: "task", prompt: "stuck" });
    markRunning(stateDir, job.id, { agentId: "agent-y", runId: "run-y" });

    const io = captureIO(workDir);
    const code = await companionMain(
      argv("status", job.id, "--wait", "--timeout-ms", "30", "--poll-ms", "10"),
      io,
    );
    expect(code).toBe(1);
    expect(io.captured.stderr.join("")).toContain("status --wait timed out");
    expect(io.captured.stdout.join("")).toContain("status:     running");
  });

  it("includes a progress tail for a non-terminal job", async () => {
    const stateDir = ensureStateDir(resolveStateDir(workDir));
    const job = createJob(stateDir, { type: "task", prompt: "running" });
    markRunning(stateDir, job.id, { agentId: "agent-x", runId: "run-x" });
    for (const line of ["fetching repo", "running tests", "thinking", "step four", "step five"]) {
      logJobLine(stateDir, job.id, line);
    }

    const io = captureIO(workDir);
    const code = await companionMain(argv("status", job.id), io);
    expect(code).toBe(0);
    const out = io.captured.stdout.join("");
    expect(out).toContain("progress:");
    expect(out).toContain("fetching repo");
    expect(out).toContain("step five");
  });

  it("omits the progress block for terminal jobs", async () => {
    const stateDir = ensureStateDir(resolveStateDir(workDir));
    const job = createJob(stateDir, { type: "task", prompt: "done" });
    logJobLine(stateDir, job.id, "noisy log line");
    markFailed(stateDir, job.id, "boom");

    const io = captureIO(workDir);
    const code = await companionMain(argv("status", job.id), io);
    expect(code).toBe(0);
    expect(io.captured.stdout.join("")).not.toContain("progress:");
  });

  it("includes the progress tail when --wait times out on a running job", async () => {
    const stateDir = ensureStateDir(resolveStateDir(workDir));
    const job = createJob(stateDir, { type: "task", prompt: "stuck" });
    markRunning(stateDir, job.id, { agentId: "agent-y", runId: "run-y" });
    logJobLine(stateDir, job.id, "still cooking");

    const io = captureIO(workDir);
    const code = await companionMain(
      argv("status", job.id, "--wait", "--timeout-ms", "30", "--poll-ms", "10"),
      io,
    );
    expect(code).toBe(1);
    const out = io.captured.stdout.join("");
    expect(out).toContain("progress:");
    expect(out).toContain("still cooking");
  });

  it("--json with --wait emits the final job record on stdout", async () => {
    const stateDir = ensureStateDir(resolveStateDir(workDir));
    const job = createJob(stateDir, { type: "task", prompt: "json" });
    markFailed(stateDir, job.id, "nope");

    const io = captureIO(workDir);
    const code = await companionMain(
      argv("status", job.id, "--wait", "--json", "--timeout-ms", "100", "--poll-ms", "10"),
      io,
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(io.captured.stdout.join(""));
    expect(parsed.id).toBe(job.id);
    expect(parsed.status).toBe("failed");
  });
});
