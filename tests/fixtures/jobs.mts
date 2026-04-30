/**
 * JobRecord factories for tests that need pre-built state files.
 */
import type { JobRecord, JobType } from "@plugin/lib/state.mjs";

interface MakeJobOpts {
  id?: string;
  type?: JobType;
  status?: JobRecord["status"];
  prompt?: string;
  createdAt?: string;
  updatedAt?: string;
  agentId?: string;
  runId?: string;
  result?: string;
  error?: string;
}

export function makeJob(overrides: MakeJobOpts = {}): JobRecord {
  const created = overrides.createdAt ?? "2026-01-01T00:00:00.000Z";
  const type = overrides.type ?? "task";
  return {
    id: overrides.id ?? `${type === "adversarial-review" ? "adv" : type}-abc123`,
    type,
    status: overrides.status ?? "completed",
    prompt: overrides.prompt ?? "do thing",
    createdAt: created,
    updatedAt: overrides.updatedAt ?? created,
    ...(overrides.agentId ? { agentId: overrides.agentId } : {}),
    ...(overrides.runId ? { runId: overrides.runId } : {}),
    ...(overrides.result !== undefined ? { result: overrides.result } : {}),
    ...(overrides.error !== undefined ? { error: overrides.error } : {}),
  };
}

export const COMPLETED_TASK_JOB: JobRecord = makeJob({
  id: "task-completed01",
  status: "completed",
  agentId: "agent-1",
  runId: "run-1",
  result: "task finished successfully",
});

export const RUNNING_TASK_JOB: JobRecord = makeJob({
  id: "task-running01",
  status: "running",
  agentId: "agent-2",
  runId: "run-2",
});

export const FAILED_REVIEW_JOB: JobRecord = makeJob({
  id: "review-failed01",
  type: "review",
  status: "failed",
  prompt: "review of working-tree diff",
  error: "review run did not finish: error",
});
