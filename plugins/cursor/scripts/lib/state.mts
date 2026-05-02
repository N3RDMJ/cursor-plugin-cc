import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_MAX_JOBS = 50;
export const STATE_ROOT_ENV = "CURSOR_PLUGIN_STATE_ROOT";

const SLUG_HASH_LENGTH = 16;
const SLUG_NAME_MAX = 32;
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

export type JobType = "task" | "review" | "adversarial-review";
export type JobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface JobIndexEntry {
  id: string;
  type: JobType;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  summary?: string;
  /** Most recent task-event description ("what is it doing right now"). */
  phase?: string;
}

export interface JobIndex {
  version: 1;
  jobs: JobIndexEntry[];
}

export interface JobRecord {
  id: string;
  type: JobType;
  status: JobStatus;
  prompt: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  agentId?: string;
  runId?: string;
  result?: string;
  error?: string;
  metadata?: Record<string, unknown>;
  /** Most recent task-event description ("what is it doing right now"). */
  phase?: string;
}

export interface SessionState {
  version: 1;
  sessionId: string;
  startedAt: string;
  agentIds: string[];
  pluginRoot?: string;
}

export interface StateLocator {
  /** Override the state root (defaults to $CURSOR_PLUGIN_STATE_ROOT or ~/.claude/cursor-plugin). */
  root?: string;
}

export interface PruneResult {
  removed: string[];
  kept: number;
}

/**
 * Build the workspace slug as `<sanitized-basename>-<sha256(root)[:16]>`. The
 * canonical absolute path is hashed so two checkouts at different paths get
 * distinct slugs even when their basenames collide.
 */
export function computeWorkspaceSlug(workspaceRoot: string): string {
  const canonical = path.resolve(workspaceRoot);
  const hash = crypto
    .createHash("sha256")
    .update(canonical)
    .digest("hex")
    .slice(0, SLUG_HASH_LENGTH);
  const base = path.basename(canonical);
  const sanitized =
    base
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .slice(0, SLUG_NAME_MAX) || "workspace";
  return `${sanitized}-${hash}`;
}

export function resolveStateRoot(opts: StateLocator = {}): string {
  if (opts.root && opts.root.trim().length > 0) return path.resolve(opts.root);
  const env = process.env[STATE_ROOT_ENV];
  if (env && env.trim().length > 0) return path.resolve(env);
  return path.join(os.homedir(), ".claude", "cursor-plugin");
}

export function resolveStateDir(workspaceRoot: string, opts: StateLocator = {}): string {
  return path.join(resolveStateRoot(opts), computeWorkspaceSlug(workspaceRoot));
}

export function ensureStateDir(stateDir: string): string {
  fs.mkdirSync(stateDir, { recursive: true, mode: DIR_MODE });
  return stateDir;
}

export function getStateIndexPath(stateDir: string): string {
  return path.join(stateDir, "state.json");
}

/**
 * Reject job ids that would let `path.join(stateDir, id)` escape the state
 * directory. The CLI surfaces ids from user input (`/cursor:result <id>`,
 * `/cursor:cancel <id>`), so this is the boundary where untrusted strings
 * become file paths — validating here keeps callers from having to remember.
 */
function assertSafeJobId(jobId: string): void {
  if (
    jobId.length === 0 ||
    jobId.includes("/") ||
    jobId.includes("\\") ||
    jobId.includes("\0") ||
    jobId === "." ||
    jobId === ".."
  ) {
    throw new Error(`invalid jobId: ${JSON.stringify(jobId)}`);
  }
}

export function getJobJsonPath(stateDir: string, jobId: string): string {
  assertSafeJobId(jobId);
  return path.join(stateDir, `${jobId}.json`);
}

export function getJobLogPath(stateDir: string, jobId: string): string {
  assertSafeJobId(jobId);
  return path.join(stateDir, `${jobId}.log`);
}

export function getSessionPath(stateDir: string): string {
  return path.join(stateDir, "session.json");
}

/**
 * Atomically write JSON: write to a uniquely-named tmp file in the same
 * directory, then rename onto the target. `rename(2)` is atomic within a
 * filesystem, so concurrent readers either see the previous version or the
 * new one — never a partial write.
 */
export function writeJsonAtomic(filePath: string, data: unknown): void {
  ensureStateDir(path.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: FILE_MODE });
  try {
    fs.renameSync(tmp, filePath);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

/** Read JSON, returning undefined if the file is missing or unparseable. */
export function readJson<T>(filePath: string): T | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export function readStateIndex(stateDir: string): JobIndex {
  const data = readJson<JobIndex>(getStateIndexPath(stateDir));
  if (!data || !Array.isArray(data.jobs)) return { version: 1, jobs: [] };
  return data;
}

export function writeStateIndex(stateDir: string, index: JobIndex): void {
  writeJsonAtomic(getStateIndexPath(stateDir), index);
}

export function readJob(stateDir: string, jobId: string): JobRecord | undefined {
  return readJson<JobRecord>(getJobJsonPath(stateDir, jobId));
}

export function writeJob(stateDir: string, record: JobRecord): void {
  writeJsonAtomic(getJobJsonPath(stateDir, record.id), record);
}

export function appendJobLog(stateDir: string, jobId: string, text: string): void {
  ensureStateDir(stateDir);
  fs.appendFileSync(getJobLogPath(stateDir, jobId), text, { mode: FILE_MODE });
}

export function jobLogMtimeMs(stateDir: string, jobId: string): number | undefined {
  try {
    return fs.statSync(getJobLogPath(stateDir, jobId)).mtimeMs;
  } catch {
    return undefined;
  }
}

export function readJobLog(stateDir: string, jobId: string): string | undefined {
  try {
    return fs.readFileSync(getJobLogPath(stateDir, jobId), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
}

/**
 * Return the last `lines` lines of the per-job log, joined by `\n` with no
 * trailing newline. Returns undefined when the log is missing or empty so
 * callers can omit the section entirely.
 */
export function tailJobLog(stateDir: string, jobId: string, lines: number): string | undefined {
  if (lines <= 0) return undefined;
  const log = readJobLog(stateDir, jobId);
  if (!log) return undefined;
  const body = log.endsWith("\n") ? log.slice(0, -1) : log;
  if (body.length === 0) return undefined;
  const split = body.split("\n");
  return (split.length <= lines ? split : split.slice(-lines)).join("\n");
}

export function readSession(stateDir: string): SessionState | undefined {
  return readJson<SessionState>(getSessionPath(stateDir));
}

export function writeSession(stateDir: string, session: SessionState): void {
  writeJsonAtomic(getSessionPath(stateDir), session);
}

export function clearSession(stateDir: string): void {
  fs.rmSync(getSessionPath(stateDir), { force: true });
}

/**
 * Trim the index to at most `maxEntries` jobs, keeping the most-recently
 * created and deleting the on-disk per-job json/log files for evicted jobs.
 * Safe to call when the index already fits — it short-circuits.
 */
export function pruneJobIndex(
  stateDir: string,
  maxEntries: number = DEFAULT_MAX_JOBS,
): PruneResult {
  const limit = Math.max(0, Math.floor(maxEntries));
  const index = readStateIndex(stateDir);
  if (index.jobs.length <= limit) {
    return { removed: [], kept: index.jobs.length };
  }
  const sorted = [...index.jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const kept = sorted.slice(0, limit);
  const dropped = sorted.slice(limit);
  for (const job of dropped) {
    fs.rmSync(getJobJsonPath(stateDir, job.id), { force: true });
    fs.rmSync(getJobLogPath(stateDir, job.id), { force: true });
  }
  writeStateIndex(stateDir, { version: 1, jobs: kept });
  return { removed: dropped.map((j) => j.id), kept: kept.length };
}
