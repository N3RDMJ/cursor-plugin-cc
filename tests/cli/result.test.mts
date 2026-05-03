import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { main as companionMain } from "@plugin/cursor-companion.mjs";
import { createJob, markFinished, markRunning } from "@plugin/lib/job-control.mjs";
import { ensureStateDir, resolveStateDir } from "@plugin/lib/state.mjs";
import { argv, captureIO } from "@test/helpers/io.mjs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let workDir: string;
let stateRoot: string;
let stateDir: string;

beforeEach(() => {
  workDir = mkdtempSync(path.join(tmpdir(), "cursor-result-cwd-"));
  stateRoot = mkdtempSync(path.join(tmpdir(), "cursor-result-state-"));
  process.env.CURSOR_PLUGIN_STATE_ROOT = stateRoot;
  stateDir = ensureStateDir(resolveStateDir(workDir));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
  rmSync(stateRoot, { recursive: true, force: true });
  delete process.env.CURSOR_PLUGIN_STATE_ROOT;
});

function seedCompletedTask(prompt: string, output: string, agentId = "agent-card") {
  const job = createJob(stateDir, { type: "task", prompt });
  markRunning(stateDir, job.id, { agentId, runId: `${agentId}-r` });
  markFinished(stateDir, job.id, {
    status: "finished",
    output,
    toolCalls: [],
    agentId,
    runId: `${agentId}-r`,
    durationMs: 1234,
  });
  return job.id;
}

describe("CLI: result", () => {
  it("renders the task result card by default with status, duration, agent id, and next steps", async () => {
    const jobId = seedCompletedTask("refactor auth", "the work output");

    const io = captureIO(workDir);
    expect(await companionMain(argv("result", jobId), io)).toBe(0);
    const out = io.captured.stdout.join("");
    expect(out).toContain(`**Job:** \`${jobId}\``);
    expect(out).toContain("**Status:**");
    expect(out).toContain("`completed`");
    expect(out).toContain("duration: 1.2s");
    expect(out).toContain("**Agent:** `agent-card`");
    expect(out).toContain("the work output");
    expect(out).toContain("**Next steps:**");
    expect(out).toContain("/cursor:resume agent-card");
  });

  it("--raw emits just the result text on stdout and a stderr handoff hint", async () => {
    const jobId = seedCompletedTask("noop", "PURE OUTPUT", "agent-raw");

    const io = captureIO(workDir);
    expect(await companionMain(argv("result", jobId, "--raw"), io)).toBe(0);
    const stdout = io.captured.stdout.join("");
    expect(stdout.trim()).toBe("PURE OUTPUT");
    expect(stdout).not.toContain("**Job:**");
    expect(io.captured.stderr.join("")).toContain("/cursor:resume agent-raw");
  });

  it("review jobs render their result verbatim (review formatter wins)", async () => {
    const job = createJob(stateDir, { type: "review", prompt: "review" });
    markRunning(stateDir, job.id, { agentId: "agent-rev", runId: "r-rev" });
    markFinished(stateDir, job.id, {
      status: "finished",
      output: "**Verdict:** approve\n",
      toolCalls: [],
      agentId: "agent-rev",
      runId: "r-rev",
    });

    const io = captureIO(workDir);
    expect(await companionMain(argv("result", job.id), io)).toBe(0);
    const stdout = io.captured.stdout.join("");
    expect(stdout).toContain("**Verdict:** approve");
    expect(stdout).not.toContain("**Job:**");
    expect(stdout).not.toContain("**Next steps:**");
  });

  it("--json emits the full JobRecord and skips the card", async () => {
    const jobId = seedCompletedTask("jsonable", "out");

    const io = captureIO(workDir);
    expect(await companionMain(argv("result", jobId, "--json"), io)).toBe(0);
    const parsed = JSON.parse(io.captured.stdout.join(""));
    expect(parsed.id).toBe(jobId);
    expect(parsed.result).toBe("out");
  });

  it("missing job exits 1 with diagnostic", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("result", "task-doesnotexist"), io)).toBe(1);
    expect(io.captured.stderr.join("")).toContain("job not found");
  });

  it("no terminal jobs in workspace exits 1 with hint", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("result"), io)).toBe(1);
    expect(io.captured.stderr.join("")).toContain("no terminal jobs in this workspace yet");
  });
});
