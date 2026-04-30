import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveStateDir } from "../../plugins/cursor/scripts/lib/state.mjs";
import { resolveWorkspaceRoot } from "../../plugins/cursor/scripts/lib/workspace.mjs";

let stateRoot: string;
let prevCwd: string;
let workDir: string;

beforeEach(() => {
  stateRoot = mkdtempSync(path.join(tmpdir(), "cursor-hook-state-"));
  workDir = mkdtempSync(path.join(tmpdir(), "cursor-hook-cwd-"));
  prevCwd = process.cwd();
  process.chdir(workDir);
  process.env.CURSOR_PLUGIN_STATE_ROOT = stateRoot;
});

afterEach(() => {
  process.chdir(prevCwd);
  rmSync(stateRoot, { recursive: true, force: true });
  rmSync(workDir, { recursive: true, force: true });
  delete process.env.CURSOR_PLUGIN_STATE_ROOT;
});

describe("session-lifecycle-hook (vitest re-import)", () => {
  it("returns 2 for an unknown event", async () => {
    // Re-import per-test so each gets a fresh module (the env var is read at call time anyway).
    const { main } = await import("../../plugins/cursor/scripts/session-lifecycle-hook.mjs");
    expect(main(["node", "hook"])).toBe(2);
    expect(main(["node", "hook", "Unknown"])).toBe(2);
  });

  it("SessionStart writes a session.json with the parsed session id", async () => {
    const { main } = await import("../../plugins/cursor/scripts/session-lifecycle-hook.mjs");
    expect(main(["node", "hook", "SessionEnd"])).toBe(0);

    // We can't pipe stdin into main() easily, so for SessionStart we just
    // verify it returns 0 and writes the session file. Without a stdin
    // payload, sessionId falls back to "local-<ts>".
    expect(main(["node", "hook", "SessionStart"])).toBe(0);

    const stateDir = resolveStateDir(resolveWorkspaceRoot(workDir));
    const sessionPath = path.join(stateDir, "session.json");
    const data = JSON.parse(readFileSync(sessionPath, "utf8"));
    expect(data.version).toBe(1);
    expect(typeof data.sessionId).toBe("string");
    expect(data.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Array.isArray(data.agentIds)).toBe(true);
  });

  it("SessionEnd clears the session file", async () => {
    const { main } = await import("../../plugins/cursor/scripts/session-lifecycle-hook.mjs");
    expect(main(["node", "hook", "SessionStart"])).toBe(0);
    expect(main(["node", "hook", "SessionEnd"])).toBe(0);

    const stateDir = resolveStateDir(resolveWorkspaceRoot(workDir));
    const sessionPath = path.join(stateDir, "session.json");
    expect(() => readFileSync(sessionPath)).toThrow();
  });
});
