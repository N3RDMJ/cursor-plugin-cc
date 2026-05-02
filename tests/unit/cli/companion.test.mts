import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { main as companionMain } from "../../../plugins/cursor/scripts/cursor-companion.mjs";
import { argv, captureIO } from "../../helpers/io.mjs";

let workDir: string;
let stateDir: string;

beforeEach(() => {
  workDir = mkdtempSync(path.join(tmpdir(), "cursor-cli-cwd-"));
  stateDir = mkdtempSync(path.join(tmpdir(), "cursor-cli-state-"));
  process.env.CURSOR_PLUGIN_STATE_ROOT = stateDir;
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
  rmSync(stateDir, { recursive: true, force: true });
  delete process.env.CURSOR_PLUGIN_STATE_ROOT;
});

describe("cursor-companion router", () => {
  it("prints help and exits 0 with no args", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv(), io)).toBe(0);
    expect(io.captured.stdout.join("")).toContain("cursor-companion <command>");
  });

  it("returns 2 for unknown commands", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("bogus"), io)).toBe(2);
    expect(io.captured.stderr.join("")).toContain("unknown command");
  });

  it("status with no jobs prints '_(no jobs)_'", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("status"), io)).toBe(0);
    expect(io.captured.stdout.join("")).toContain("_(no jobs)_");
  });

  it("result without a job id and no terminal jobs exits 1 with a hint", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("result"), io)).toBe(1);
    expect(io.captured.stderr.join("")).toContain("no terminal jobs");
  });

  it("result without a job id resolves to the most recent terminal job", async () => {
    const { createJob, markFailed, markFinished, markRunning } = await import(
      "../../../plugins/cursor/scripts/lib/job-control.mjs"
    );
    const { ensureStateDir, resolveStateDir } = await import(
      "../../../plugins/cursor/scripts/lib/state.mjs"
    );
    const sd = ensureStateDir(resolveStateDir(workDir));
    const a = createJob(sd, { type: "task", prompt: "first" });
    markRunning(sd, a.id, { agentId: "agent-a", runId: "run-a" });
    markFinished(sd, a.id, {
      status: "finished",
      output: "first result\n",
      toolCalls: [],
      agentId: "agent-a",
      runId: "run-a",
      durationMs: 1000,
    });

    const b = createJob(sd, { type: "task", prompt: "second" });
    markRunning(sd, b.id, { agentId: "agent-b", runId: "run-b" });
    markFailed(sd, b.id, "boom");

    const stillRunning = createJob(sd, { type: "task", prompt: "running" });
    markRunning(sd, stillRunning.id, { agentId: "agent-r", runId: "run-r" });

    const io = captureIO(workDir);
    expect(await companionMain(argv("result"), io)).toBe(1);
    expect(io.captured.stderr.join("")).toContain("job failed: boom");
  });

  it("cancel without a job id exits 2 (UsageError)", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("cancel"), io)).toBe(2);
    expect(io.captured.stderr.join("")).toContain("cancel requires a job id");
  });

  it("cancel of a missing job exits 1 (runtime error, not usage)", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("cancel", "missing-id"), io)).toBe(1);
    expect(io.captured.stderr.join("")).toContain("could not cancel");
  });

  it("task without a prompt exits 2 (UsageError)", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("task"), io)).toBe(2);
    expect(io.captured.stderr.join("")).toContain("task requires a prompt");
  });

  it("--help on a subcommand prints subcommand help and exits 0", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("task", "--help"), io)).toBe(0);
    expect(io.captured.stdout.join("")).toContain("Delegate an implementation task");
  });

  it("status rejects invalid --type with exit 2", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("status", "--type", "bogus"), io)).toBe(2);
    const err = io.captured.stderr.join("");
    expect(err).toContain("invalid --type");
    expect(err).toContain("task");
  });

  it("status rejects invalid --status with exit 2", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("status", "--status", "weird"), io)).toBe(2);
    expect(io.captured.stderr.join("")).toContain("invalid --status");
  });

  it("status accepts a valid --type filter", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("status", "--type", "task"), io)).toBe(0);
  });

  it("resume without args exits 2 (UsageError)", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("resume"), io)).toBe(2);
    expect(io.captured.stderr.join("")).toContain("resume requires <agent-id>");
  });

  it("--help on resume prints subcommand help and exits 0", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("resume", "--help"), io)).toBe(0);
    expect(io.captured.stdout.join("")).toContain("Reattach to an existing Cursor agent");
  });

  it("status --wait without a job-id exits 2 (UsageError)", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("status", "--wait"), io)).toBe(2);
    expect(io.captured.stderr.join("")).toContain("--wait/--timeout-ms/--poll-ms require");
  });

  it("status <missing-id> --wait exits 1 with not-found diagnostic", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("status", "no-such-job", "--wait"), io)).toBe(1);
    expect(io.captured.stderr.join("")).toContain("job not found");
  });

  it("setup without API key exits 1 with diagnostic", async () => {
    const io = captureIO(workDir);
    const original = process.env.CURSOR_API_KEY;
    delete process.env.CURSOR_API_KEY;
    try {
      const code = await companionMain(argv("setup"), io);
      expect(code).toBe(1);
      expect(io.captured.stdout.join("")).toContain("API key");
      expect(io.captured.stdout.join("")).toContain("fail");
    } finally {
      if (original !== undefined) process.env.CURSOR_API_KEY = original;
    }
  });
});
