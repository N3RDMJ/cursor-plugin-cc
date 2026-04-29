import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendJobLog,
  clearSession,
  computeWorkspaceSlug,
  DEFAULT_MAX_JOBS,
  ensureStateDir,
  getJobJsonPath,
  getJobLogPath,
  getSessionPath,
  getStateIndexPath,
  type JobIndex,
  type JobIndexEntry,
  type JobRecord,
  pruneJobIndex,
  readJob,
  readJobLog,
  readJson,
  readSession,
  readStateIndex,
  resolveStateDir,
  resolveStateRoot,
  STATE_ROOT_ENV,
  writeJob,
  writeJsonAtomic,
  writeSession,
  writeStateIndex,
} from "../../../plugins/cursor/scripts/lib/state.mjs";

function makeTmpDir(prefix: string): string {
  return realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));
}

function entry(
  id: string,
  createdAt: string,
  status: JobIndexEntry["status"] = "completed",
): JobIndexEntry {
  return { id, type: "task", status, createdAt, updatedAt: createdAt };
}

describe("computeWorkspaceSlug", () => {
  it("appends a 16-char sha256 prefix to the sanitized basename", () => {
    const slug = computeWorkspaceSlug("/tmp/My Project!");
    expect(slug).toMatch(/^my-project-[0-9a-f]{16}$/);
  });

  it("returns distinct slugs for paths that share a basename", () => {
    expect(computeWorkspaceSlug("/a/repo")).not.toBe(computeWorkspaceSlug("/b/repo"));
  });

  it("returns the same slug for the same canonical path", () => {
    expect(computeWorkspaceSlug("/tmp/foo")).toBe(computeWorkspaceSlug("/tmp/foo"));
  });

  it("falls back to 'workspace' when the basename sanitizes to empty", () => {
    expect(computeWorkspaceSlug("/")).toMatch(/^workspace-[0-9a-f]{16}$/);
  });

  it("truncates very long basenames", () => {
    const long = `/tmp/${"a".repeat(200)}`;
    const slug = computeWorkspaceSlug(long);
    const [name] = slug.split(/-(?=[0-9a-f]{16}$)/);
    expect(name?.length).toBeLessThanOrEqual(32);
  });
});

describe("resolveStateRoot / resolveStateDir", () => {
  const originalEnv = process.env[STATE_ROOT_ENV];

  afterEach(() => {
    if (originalEnv === undefined) delete process.env[STATE_ROOT_ENV];
    else process.env[STATE_ROOT_ENV] = originalEnv;
  });

  it("uses the explicit override when provided", () => {
    expect(resolveStateRoot({ root: "/tmp/override" })).toBe("/tmp/override");
  });

  it("falls back to the env override when no explicit root", () => {
    process.env[STATE_ROOT_ENV] = "/tmp/from-env";
    expect(resolveStateRoot()).toBe("/tmp/from-env");
  });

  it("composes the workspace slug under the resolved root", () => {
    const dir = resolveStateDir("/repo/foo", { root: "/tmp/root" });
    expect(dir.startsWith("/tmp/root/")).toBe(true);
    expect(path.basename(dir)).toMatch(/^foo-[0-9a-f]{16}$/);
  });
});

describe("filesystem primitives", () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = path.join(makeTmpDir("cursor-plugin-state-"), "ws-slug");
  });

  afterEach(() => {
    rmSync(path.dirname(stateDir), { recursive: true, force: true });
  });

  it("ensureStateDir creates the directory if missing and is idempotent", () => {
    ensureStateDir(stateDir);
    ensureStateDir(stateDir);
    expect(statSync(stateDir).isDirectory()).toBe(true);
  });

  it("writeJsonAtomic writes JSON and creates parent dirs", () => {
    const target = path.join(stateDir, "nested", "data.json");
    writeJsonAtomic(target, { hello: "world" });
    expect(JSON.parse(readFileSync(target, "utf8"))).toEqual({ hello: "world" });
  });

  it("writeJsonAtomic does not leave .tmp files behind on success", () => {
    const target = getStateIndexPath(stateDir);
    writeJsonAtomic(target, { ok: true });
    const dir = path.dirname(target);
    const leftovers = readDirRecursive(dir).filter((f) => f.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("readJson returns undefined for missing files", () => {
    expect(readJson(path.join(stateDir, "nope.json"))).toBeUndefined();
  });

  it("readJson returns undefined for malformed JSON", () => {
    ensureStateDir(stateDir);
    const target = path.join(stateDir, "bad.json");
    writeFileSync(target, "{ not valid json");
    expect(readJson(target)).toBeUndefined();
  });
});

describe("state index", () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = path.join(makeTmpDir("cursor-plugin-state-"), "ws");
  });

  afterEach(() => {
    rmSync(path.dirname(stateDir), { recursive: true, force: true });
  });

  it("readStateIndex returns an empty index when the file is missing", () => {
    expect(readStateIndex(stateDir)).toEqual({ version: 1, jobs: [] });
  });

  it("readStateIndex recovers from a corrupt index file", () => {
    ensureStateDir(stateDir);
    writeFileSync(getStateIndexPath(stateDir), "garbage");
    expect(readStateIndex(stateDir)).toEqual({ version: 1, jobs: [] });
  });

  it("write/readStateIndex round-trips", () => {
    const index: JobIndex = {
      version: 1,
      jobs: [entry("a", "2026-01-01T00:00:00Z")],
    };
    writeStateIndex(stateDir, index);
    expect(readStateIndex(stateDir)).toEqual(index);
  });
});

describe("job records and logs", () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = path.join(makeTmpDir("cursor-plugin-state-"), "ws");
  });

  afterEach(() => {
    rmSync(path.dirname(stateDir), { recursive: true, force: true });
  });

  it("writeJob/readJob round-trips a record", () => {
    const record: JobRecord = {
      id: "job-1",
      type: "task",
      status: "completed",
      prompt: "do the thing",
      createdAt: "2026-04-29T10:00:00Z",
      updatedAt: "2026-04-29T10:01:00Z",
      result: "done",
    };
    writeJob(stateDir, record);
    expect(readJob(stateDir, "job-1")).toEqual(record);
  });

  it("appendJobLog appends in order across calls", () => {
    appendJobLog(stateDir, "job-1", "first\n");
    appendJobLog(stateDir, "job-1", "second\n");
    expect(readJobLog(stateDir, "job-1")).toBe("first\nsecond\n");
  });

  it("readJobLog returns undefined when no log exists", () => {
    expect(readJobLog(stateDir, "ghost")).toBeUndefined();
  });
});

describe("session state", () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = path.join(makeTmpDir("cursor-plugin-state-"), "ws");
  });

  afterEach(() => {
    rmSync(path.dirname(stateDir), { recursive: true, force: true });
  });

  it("write/readSession round-trips", () => {
    writeSession(stateDir, {
      version: 1,
      sessionId: "sess-1",
      startedAt: "2026-04-29T00:00:00Z",
      agentIds: ["agent-1"],
    });
    expect(readSession(stateDir)?.sessionId).toBe("sess-1");
  });

  it("clearSession removes the session file", () => {
    writeSession(stateDir, {
      version: 1,
      sessionId: "sess-1",
      startedAt: "2026-04-29T00:00:00Z",
      agentIds: [],
    });
    clearSession(stateDir);
    expect(readSession(stateDir)).toBeUndefined();
  });

  it("clearSession is a no-op when the file is missing", () => {
    expect(() => clearSession(stateDir)).not.toThrow();
  });
});

describe("pruneJobIndex", () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = path.join(makeTmpDir("cursor-plugin-state-"), "ws");
  });

  afterEach(() => {
    rmSync(path.dirname(stateDir), { recursive: true, force: true });
  });

  it("is a no-op when the index already fits", () => {
    const index: JobIndex = {
      version: 1,
      jobs: [entry("a", "2026-01-01T00:00:00Z")],
    };
    writeStateIndex(stateDir, index);
    const result = pruneJobIndex(stateDir, 5);
    expect(result).toEqual({ removed: [], kept: 1 });
    expect(readStateIndex(stateDir)).toEqual(index);
  });

  it("drops the oldest jobs by createdAt and removes their on-disk files", () => {
    const jobs: JobIndexEntry[] = [
      entry("old1", "2026-01-01T00:00:00Z"),
      entry("old2", "2026-01-02T00:00:00Z"),
      entry("new1", "2026-02-01T00:00:00Z"),
      entry("new2", "2026-02-02T00:00:00Z"),
    ];
    writeStateIndex(stateDir, { version: 1, jobs });
    for (const e of jobs) {
      writeJob(stateDir, {
        id: e.id,
        type: "task",
        status: "completed",
        prompt: "p",
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
      });
      appendJobLog(stateDir, e.id, "log\n");
    }

    const result = pruneJobIndex(stateDir, 2);

    expect(result.kept).toBe(2);
    expect(new Set(result.removed)).toEqual(new Set(["old1", "old2"]));
    const remainingIds = readStateIndex(stateDir).jobs.map((j) => j.id);
    expect(new Set(remainingIds)).toEqual(new Set(["new1", "new2"]));

    expect(readJob(stateDir, "old1")).toBeUndefined();
    expect(readJobLog(stateDir, "old1")).toBeUndefined();
    expect(readJob(stateDir, "new2")).toBeDefined();
    expect(readJobLog(stateDir, "new2")).toBe("log\n");
  });

  it("defaults to DEFAULT_MAX_JOBS when no limit is supplied", () => {
    const jobs: JobIndexEntry[] = Array.from({ length: DEFAULT_MAX_JOBS + 3 }, (_, i) =>
      entry(`j${i}`, `2026-01-01T00:00:${String(i).padStart(2, "0")}Z`),
    );
    writeStateIndex(stateDir, { version: 1, jobs });
    const result = pruneJobIndex(stateDir);
    expect(result.kept).toBe(DEFAULT_MAX_JOBS);
    expect(result.removed.length).toBe(3);
  });
});

describe("path helpers", () => {
  it("compose paths under the state directory", () => {
    const dir = "/tmp/state";
    expect(getStateIndexPath(dir)).toBe("/tmp/state/state.json");
    expect(getJobJsonPath(dir, "abc")).toBe("/tmp/state/abc.json");
    expect(getJobLogPath(dir, "abc")).toBe("/tmp/state/abc.log");
    expect(getSessionPath(dir)).toBe("/tmp/state/session.json");
  });

  it.each([
    ["empty", ""],
    ["dot", "."],
    ["dotdot", ".."],
    ["forward slash", "../etc/passwd"],
    ["nested forward slash", "foo/bar"],
    ["backslash", "foo\\bar"],
    ["nul byte", "foo\0bar"],
  ])("rejects unsafe jobId (%s)", (_label, jobId) => {
    expect(() => getJobJsonPath("/tmp/state", jobId)).toThrow(/invalid jobId/);
    expect(() => getJobLogPath("/tmp/state", jobId)).toThrow(/invalid jobId/);
  });

  it("accepts safe jobIds with hyphens, underscores, and dots", () => {
    expect(() => getJobJsonPath("/tmp/state", "job-2026-04-29_a1b2.x")).not.toThrow();
  });
});

describe("pruneJobIndex edge cases", () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = path.join(makeTmpDir("cursor-plugin-state-"), "ws");
  });

  afterEach(() => {
    rmSync(path.dirname(stateDir), { recursive: true, force: true });
  });

  it("treats negative or fractional limits as zero", () => {
    const jobs: JobIndexEntry[] = [
      entry("a", "2026-01-01T00:00:00Z"),
      entry("b", "2026-01-02T00:00:00Z"),
    ];
    writeStateIndex(stateDir, { version: 1, jobs });
    const result = pruneJobIndex(stateDir, -5);
    expect(result.kept).toBe(0);
    expect(new Set(result.removed)).toEqual(new Set(["a", "b"]));
    expect(readStateIndex(stateDir).jobs).toEqual([]);
  });
});

function readDirRecursive(dir: string): string[] {
  const out: string[] = [];
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    let names: string[];
    try {
      names = readdirSync(current);
    } catch {
      continue;
    }
    for (const name of names) {
      const full = path.join(current, name);
      if (statSync(full).isDirectory()) stack.push(full);
      else out.push(full);
    }
  }
  return out;
}
