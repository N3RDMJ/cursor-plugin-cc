import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { main as companionMain } from "@plugin/cursor-companion.mjs";
import { createJob, markFinished, markRunning } from "@plugin/lib/job-control.mjs";
import { ensureStateDir, resolveStateDir } from "@plugin/lib/state.mjs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
let stateDir: string;

beforeEach(() => {
  workDir = mkdtempSync(path.join(tmpdir(), "cursor-cancel-cwd-"));
  stateRoot = mkdtempSync(path.join(tmpdir(), "cursor-cancel-state-"));
  process.env.CURSOR_PLUGIN_STATE_ROOT = stateRoot;
  stateDir = ensureStateDir(resolveStateDir(workDir));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
  rmSync(stateRoot, { recursive: true, force: true });
  delete process.env.CURSOR_PLUGIN_STATE_ROOT;
});

describe("CLI: cancel", () => {
  it("cancels a running job (no active run) with reason=run-not-active", async () => {
    const job = createJob(stateDir, { type: "task", prompt: "do thing" });
    markRunning(stateDir, job.id, { agentId: "a-1", runId: "r-1" });

    const io = captureIO(workDir);
    expect(await companionMain(argv("cancel", job.id), io)).toBe(0);
    expect(io.captured.stdout.join("")).toContain("run-not-active");
  });

  it("refuses to cancel a completed job (exit 1, reason='job is completed')", async () => {
    const job = createJob(stateDir, { type: "task", prompt: "do thing" });
    markRunning(stateDir, job.id, { agentId: "a-2", runId: "r-2" });
    markFinished(stateDir, job.id, {
      status: "finished",
      output: "done",
      toolCalls: [],
      agentId: "a-2",
      runId: "r-2",
    });

    const io = captureIO(workDir);
    expect(await companionMain(argv("cancel", job.id), io)).toBe(1);
    expect(io.captured.stderr.join("")).toContain("job is completed");
  });

  it("--json mode emits the structured CancelJobResult", async () => {
    const job = createJob(stateDir, { type: "task", prompt: "x" });
    markRunning(stateDir, job.id, { agentId: "a-3", runId: "r-3" });

    const io = captureIO(workDir);
    expect(await companionMain(argv("cancel", job.id, "--json"), io)).toBe(0);
    const parsed = JSON.parse(io.captured.stdout.join(""));
    expect(parsed.cancelled).toBe(true);
    expect(parsed.reason).toBe("run-not-active");
    expect(parsed.job.id).toBe(job.id);
    expect(parsed.job.status).toBe("cancelled");
  });
});
