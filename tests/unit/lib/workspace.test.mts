import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveWorkspaceRoot } from "../../../plugins/cursor/scripts/lib/workspace.mjs";

function makeTmpDir(prefix: string): string {
  return realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));
}

describe("resolveWorkspaceRoot", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = makeTmpDir("cursor-plugin-workspace-");
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("returns the git top-level for a path inside a git repo", () => {
    execFileSync("git", ["init", "-q", tmpRoot]);
    const nested = path.join(tmpRoot, "a", "b");
    execFileSync("mkdir", ["-p", nested]);

    expect(resolveWorkspaceRoot(nested)).toBe(tmpRoot);
    expect(resolveWorkspaceRoot(tmpRoot)).toBe(tmpRoot);
  });

  it("falls back to the provided cwd when not inside a git repo", () => {
    expect(resolveWorkspaceRoot(tmpRoot)).toBe(tmpRoot);
  });

  it("returns an absolute path even for a relative cwd fallback", () => {
    const result = resolveWorkspaceRoot(".");
    expect(path.isAbsolute(result)).toBe(true);
  });
});
