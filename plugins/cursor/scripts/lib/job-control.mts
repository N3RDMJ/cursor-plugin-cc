import crypto from "node:crypto";
import type { Run } from "@cursor/sdk";

import { type CursorRunResult, cancelRun } from "./cursor-agent.mjs";
import { redactApiKey } from "./redact.mjs";
import {
  appendJobLog,
  type JobIndex,
  type JobIndexEntry,
  type JobRecord,
  type JobStatus,
  type JobType,
  pruneJobIndex,
  readJob,
  readStateIndex,
  writeJob,
  writeStateIndex,
} from "./state.mjs";

const JOB_ID_BYTES = 6; // 12 hex chars — short, collision-resistant enough for ~50 retained jobs

interface CreateJobInput {
  type: JobType;
  prompt: string;
  summary?: string;
  metadata?: Record<string, unknown>;
}

/** Generate a fresh, unique-enough job id (`<type-prefix><hex>`). */
function newJobId(type: JobType): string {
  const prefix = type === "adversarial-review" ? "adv" : type;
  return `${prefix}-${crypto.randomBytes(JOB_ID_BYTES).toString("hex")}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function summarize(prompt: string, max = 80): string {
  const compact = prompt.replace(/\s+/g, " ").trim();
  return compact.length <= max ? compact : `${compact.slice(0, max - 3)}...`;
}

function indexEntry(record: JobRecord): JobIndexEntry {
  const entry: JobIndexEntry = {
    id: record.id,
    type: record.type,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
  const summary =
    record.metadata && typeof record.metadata.summary === "string"
      ? record.metadata.summary
      : summarize(record.prompt);
  if (summary) entry.summary = summary;
  return entry;
}

function upsertIndex(stateDir: string, record: JobRecord): void {
  const idx: JobIndex = readStateIndex(stateDir);
  const entry = indexEntry(record);
  const i = idx.jobs.findIndex((j) => j.id === record.id);
  if (i === -1) {
    idx.jobs.unshift(entry);
  } else {
    idx.jobs[i] = entry;
  }
  writeStateIndex(stateDir, idx);
}

/**
 * Create a new job in `pending` state. Returns the full record so callers
 * can pass it straight into `markRunning` once the agent run starts.
 *
 * `input.metadata` is shallow-copied — we never hold a reference to the
 * caller's object so subsequent updates can't leak back into their state.
 */
export function createJob(stateDir: string, input: CreateJobInput): JobRecord {
  const id = newJobId(input.type);
  const created = nowIso();
  const metadata: Record<string, unknown> | undefined =
    input.metadata || input.summary
      ? { ...(input.metadata ?? {}), ...(input.summary ? { summary: input.summary } : {}) }
      : undefined;
  const record: JobRecord = {
    id,
    type: input.type,
    status: "pending",
    prompt: input.prompt,
    createdAt: created,
    updatedAt: created,
    ...(metadata ? { metadata } : {}),
  };
  writeJob(stateDir, record);
  upsertIndex(stateDir, record);
  return record;
}

/** Read a job by id. Returns undefined when the file does not exist. */
export function getJob(stateDir: string, jobId: string): JobRecord | undefined {
  return readJob(stateDir, jobId);
}

export interface ListJobsFilter {
  type?: JobType;
  status?: JobStatus;
  /** Cap returned entries (most recent first). */
  limit?: number;
}

/** Read the index, optionally filtered. Sorted most-recent-first by `createdAt`. */
export function listJobs(stateDir: string, filter: ListJobsFilter = {}): JobIndexEntry[] {
  const idx = readStateIndex(stateDir);
  let entries = [...idx.jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (filter.type) entries = entries.filter((j) => j.type === filter.type);
  if (filter.status) entries = entries.filter((j) => j.status === filter.status);
  if (typeof filter.limit === "number" && filter.limit >= 0) {
    entries = entries.slice(0, Math.floor(filter.limit));
  }
  return entries;
}

export interface RecentTaskAgent {
  jobId: string;
  agentId: string;
  createdAt: string;
  summary?: string;
}

/**
 * Walk the most-recent task jobs (newest first) and return entries that have
 * a stamped agentId. Used by `task --resume-last` and `/cursor:resume`
 * (`--last` / `--list`). Reads at most `lookahead` job json files from disk
 * to find `limit` agentIds.
 */
export function findRecentTaskAgents(
  stateDir: string,
  limit: number = 10,
  lookahead: number = Math.max(limit * 2, 20),
): RecentTaskAgent[] {
  const recent = listJobs(stateDir, { type: "task", limit: lookahead });
  const out: RecentTaskAgent[] = [];
  for (const entry of recent) {
    if (out.length >= limit) break;
    const job = readJob(stateDir, entry.id);
    if (!job?.agentId) continue;
    const ref: RecentTaskAgent = {
      jobId: job.id,
      agentId: job.agentId,
      createdAt: job.createdAt,
    };
    if (entry.summary) ref.summary = entry.summary;
    out.push(ref);
  }
  return out;
}

interface UpdateInput {
  status?: JobStatus;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  agentId?: string;
  runId?: string;
  result?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

function update(stateDir: string, jobId: string, input: UpdateInput): JobRecord {
  const existing = readJob(stateDir, jobId);
  if (!existing) {
    throw new Error(`job not found: ${jobId}`);
  }
  const next: JobRecord = {
    ...existing,
    ...input,
    metadata: input.metadata
      ? { ...(existing.metadata ?? {}), ...input.metadata }
      : existing.metadata,
    updatedAt: nowIso(),
  };
  writeJob(stateDir, next);
  upsertIndex(stateDir, next);
  return next;
}

/** Transition a job to `running` and stamp its agent/run identifiers. */
export function markRunning(
  stateDir: string,
  jobId: string,
  refs: { agentId: string; runId: string },
): JobRecord {
  return update(stateDir, jobId, {
    status: "running",
    startedAt: nowIso(),
    agentId: refs.agentId,
    runId: refs.runId,
  });
}

/**
 * Persist a successful run result. Maps `CursorAgentStatus` to our `JobStatus`
 * (`finished` → `completed`, `error` → `failed`, others pass through).
 */
export function markFinished(stateDir: string, jobId: string, result: CursorRunResult): JobRecord {
  let status: JobStatus;
  let extraMetadata: Record<string, unknown> | undefined;
  switch (result.status) {
    case "finished":
      status = "completed";
      break;
    case "error":
      status = "failed";
      break;
    case "cancelled":
      status = "cancelled";
      break;
    case "expired":
      // SDK reports a wedged local run as "expired". From the plugin's view
      // it's a non-success terminal — treat it as cancelled and tag the
      // metadata so /cursor:status can show why.
      status = "cancelled";
      extraMetadata = { expired: true };
      break;
  }
  const updates: UpdateInput = {
    status,
    finishedAt: nowIso(),
    agentId: result.agentId,
    runId: result.runId,
    result: result.output,
  };
  if (typeof result.durationMs === "number") updates.durationMs = result.durationMs;
  if (result.timedOut || extraMetadata) {
    updates.metadata = { ...(result.timedOut ? { timedOut: true } : {}), ...extraMetadata };
  }
  return update(stateDir, jobId, updates);
}

/**
 * Mark a job as failed, recording the error message. Scrubs `CURSOR_API_KEY`
 * before persistence so a thrown SDK error that happens to embed the key in
 * a request URL doesn't end up on disk in the per-job json file.
 */
export function markFailed(stateDir: string, jobId: string, error: string): JobRecord {
  return update(stateDir, jobId, {
    status: "failed",
    finishedAt: nowIso(),
    error: redactApiKey(error),
  });
}

/** Mark a job as cancelled (without an associated Run). */
export function markCancelled(stateDir: string, jobId: string, reason?: string): JobRecord {
  const updates: UpdateInput = {
    status: "cancelled",
    finishedAt: nowIso(),
  };
  if (reason) updates.metadata = { cancelReason: reason };
  return update(stateDir, jobId, updates);
}

/* -------------------------------------------------------------------------
 * In-memory active-run registry — scoped to a single CLI process. The Run
 * object can't be persisted across processes, so background-job cancellation
 * works only within the process that started the run. Cross-process cancel
 * relies on SDK-side state (and would call `Agent.resume` to reach the run).
 * ----------------------------------------------------------------------- */

const activeRuns = new Map<string, Run>();

export function registerActiveRun(jobId: string, run: Run): void {
  activeRuns.set(jobId, run);
}

export function unregisterActiveRun(jobId: string): void {
  activeRuns.delete(jobId);
}

export function getActiveRun(jobId: string): Run | undefined {
  return activeRuns.get(jobId);
}

export interface CancelJobResult {
  cancelled: boolean;
  reason?: string;
  job?: JobRecord;
}

/**
 * Cancel a job by id. When an in-memory `Run` is registered, calls
 * `cancelRun(run)` (capability-checked); otherwise marks the persisted record
 * as cancelled with reason="run-not-active".
 */
export async function cancelJob(stateDir: string, jobId: string): Promise<CancelJobResult> {
  const job = readJob(stateDir, jobId);
  if (!job) {
    return { cancelled: false, reason: `job not found: ${jobId}` };
  }
  if (job.status !== "pending" && job.status !== "running") {
    return { cancelled: false, reason: `job is ${job.status}`, job };
  }

  const run = activeRuns.get(jobId);
  if (!run) {
    const updated = markCancelled(stateDir, jobId, "run-not-active");
    return { cancelled: true, reason: "run-not-active", job: updated };
  }

  const result = await cancelRun(run);
  if (!result.cancelled) {
    return { cancelled: false, reason: result.reason, job };
  }
  const updated = markCancelled(stateDir, jobId, result.reason);
  activeRuns.delete(jobId);
  return { cancelled: true, ...(result.reason ? { reason: result.reason } : {}), job: updated };
}

/**
 * Append a line to the per-job streaming log. Defensive: scrubs the API key
 * even though stream events normally carry only LLM-emitted text — it's cheap
 * and removes a class of "did the model echo my key back?" worries.
 */
export function logJobLine(stateDir: string, jobId: string, line: string): void {
  const scrubbed = redactApiKey(line);
  const text = scrubbed.endsWith("\n") ? scrubbed : `${scrubbed}\n`;
  appendJobLog(stateDir, jobId, text);
}

/**
 * Trim the index to keep the most recent `maxEntries`. Thin wrapper over
 * `pruneJobIndex` for symmetry — callers don't have to import from state.mts.
 */
export function pruneJobs(stateDir: string, maxEntries?: number): void {
  pruneJobIndex(stateDir, maxEntries);
}
