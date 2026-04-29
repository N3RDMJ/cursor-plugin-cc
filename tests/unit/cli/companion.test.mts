import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { main as companionMain } from "../../../plugins/cursor/scripts/cursor-companion.mjs";

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

let workDir: string;
let stateDir: string;
const argv = (...rest: string[]): string[] => ["node", "cursor-companion", ...rest];

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

  it("status with no jobs prints '(no jobs)'", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("status"), io)).toBe(0);
    expect(io.captured.stdout.join("")).toContain("(no jobs)");
  });

  it("result with missing job id exits non-zero", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("result"), io)).toBe(1);
    expect(io.captured.stderr.join("")).toContain("error: result requires a job id");
  });

  it("cancel of a missing job exits 1", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("cancel", "missing-id"), io)).toBe(1);
    expect(io.captured.stderr.join("")).toContain("could not cancel");
  });

  it("--help on a subcommand prints subcommand help and exits 0", async () => {
    const io = captureIO(workDir);
    expect(await companionMain(argv("task", "--help"), io)).toBe(0);
    expect(io.captured.stdout.join("")).toContain("Delegate an implementation task");
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
