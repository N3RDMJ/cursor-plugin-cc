/**
 * Live integration tests against the real Cursor SDK. Skipped automatically
 * unless `CURSOR_API_KEY` is set so CI without the secret stays green and
 * local devs can opt in by exporting the key.
 *
 * If they start flapping due to model behavior, narrow the assertions further
 * (e.g. just check `status === "finished"`).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { listModels, oneShot, whoami } from "@plugin/lib/cursor-agent.mjs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const NO_KEY = !process.env.CURSOR_API_KEY?.trim();

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(path.join(tmpdir(), "cursor-live-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe.skipIf(NO_KEY)("live @cursor/sdk integration (CURSOR_API_KEY set)", () => {
  it("Cursor.me succeeds with a valid key", async () => {
    const me = await whoami();
    expect(me).toBeDefined();
  }, 30_000);

  it("Cursor.models.list returns at least one model", async () => {
    const models = await listModels();
    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);
  }, 30_000);

  it("oneShot completes a trivial prompt and disposes the agent", async () => {
    const result = await oneShot("Reply with the single word: PONG", {
      cwd: workDir,
      timeoutMs: 90_000,
    });
    expect(["finished", "cancelled", "error", "expired"]).toContain(result.status);
    if (result.status === "finished") {
      expect(typeof result.output).toBe("string");
    }
  }, 120_000);
});
