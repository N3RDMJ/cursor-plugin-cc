import { setTimeout as sleep } from "node:timers/promises";

import type { CommandIO, ExitCode } from "../cursor-companion.mjs";
import { bool, optionalString, parseArgs, UsageError } from "../lib/args.mjs";
import { getJob, type ListJobsFilter, listJobs } from "../lib/job-control.mjs";
import { renderJobTable } from "../lib/render.mjs";
import { type JobStatus, type JobType, resolveStateDir } from "../lib/state.mjs";
import { resolveWorkspaceRoot } from "../lib/workspace.mjs";

const VALID_TYPES = new Set<string>(["task", "review", "adversarial-review"]);
const VALID_STATUSES = new Set<string>(["pending", "running", "completed", "failed", "cancelled"]);
const TERMINAL_STATUSES: ReadonlySet<JobStatus> = new Set(["completed", "failed", "cancelled"]);

const DEFAULT_WAIT_TIMEOUT_MS = 240_000;
const DEFAULT_WAIT_POLL_MS = 1_000;

const HELP = `cursor-companion status [<job-id>] [flags]

Show the job table for the current workspace, or detail for one job. With
a job id, --wait polls until the job reaches a terminal state.

flags:
  --type <task|review|adversarial-review>  Filter by type
  --status <pending|running|completed|failed|cancelled>
  --limit <n>                              Cap number of rows
  --wait                                   With <job-id>: block until terminal
  --timeout-ms <ms>                        Max time to wait (default 240000)
  --poll-ms <ms>                           Poll interval (default 1000)
  --json                                   Print as JSON
  --help, -h
`;

function parsePositiveMs(parsed: ReturnType<typeof parseArgs>, key: string): number | undefined {
  const raw = optionalString(parsed, key);
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new UsageError(`invalid --${key}: ${raw}`);
  return Math.floor(n);
}

export async function runStatus(args: readonly string[], io: CommandIO): Promise<ExitCode> {
  const parsed = parseArgs(args, {
    long: {
      type: "string",
      status: "string",
      limit: "string",
      wait: "boolean",
      "timeout-ms": "string",
      "poll-ms": "string",
      json: "boolean",
      help: "boolean",
    },
    short: { h: "help" },
  });
  if (bool(parsed, "help")) {
    io.stdout.write(HELP);
    return 0;
  }

  const cwd = io.cwd();
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const stateDir = resolveStateDir(workspaceRoot);
  const json = bool(parsed, "json");
  const wait = bool(parsed, "wait");
  const timeoutMs = parsePositiveMs(parsed, "timeout-ms");
  const pollMs = parsePositiveMs(parsed, "poll-ms");

  const jobId = parsed.positionals[0];
  if (jobId) {
    let job = getJob(stateDir, jobId);
    if (!job) {
      io.stderr.write(`job not found: ${jobId}\n`);
      return 1;
    }
    if (wait && !TERMINAL_STATUSES.has(job.status)) {
      const deadline = Date.now() + (timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS);
      const interval = pollMs ?? DEFAULT_WAIT_POLL_MS;
      while (Date.now() < deadline) {
        await sleep(interval);
        const fresh = getJob(stateDir, jobId);
        if (fresh) job = fresh;
        if (TERMINAL_STATUSES.has(job.status)) break;
      }
      if (!TERMINAL_STATUSES.has(job.status)) {
        io.stderr.write(`status --wait timed out (job still ${job.status})\n`);
        if (json) {
          io.stdout.write(`${JSON.stringify(job, null, 2)}\n`);
        } else {
          io.stdout.write(renderJobDetail(job));
        }
        return 1;
      }
    }
    if (json) {
      io.stdout.write(`${JSON.stringify(job, null, 2)}\n`);
    } else {
      io.stdout.write(renderJobDetail(job));
    }
    return 0;
  }

  if (wait || timeoutMs || pollMs) {
    throw new UsageError("--wait/--timeout-ms/--poll-ms require a positional <job-id>");
  }

  const filter: ListJobsFilter = {};
  const type = optionalString(parsed, "type");
  if (type) {
    if (!VALID_TYPES.has(type)) {
      throw new UsageError(
        `invalid --type: ${type} (expected one of ${[...VALID_TYPES].join(", ")})`,
      );
    }
    filter.type = type as JobType;
  }
  const status = optionalString(parsed, "status");
  if (status) {
    if (!VALID_STATUSES.has(status)) {
      throw new UsageError(
        `invalid --status: ${status} (expected one of ${[...VALID_STATUSES].join(", ")})`,
      );
    }
    filter.status = status as JobStatus;
  }
  const limit = optionalString(parsed, "limit");
  if (limit) {
    const n = Number(limit);
    if (!Number.isFinite(n) || n < 0) throw new UsageError(`invalid --limit: ${limit}`);
    filter.limit = Math.floor(n);
  }
  const jobs = listJobs(stateDir, filter);

  if (json) {
    io.stdout.write(`${JSON.stringify(jobs, null, 2)}\n`);
  } else {
    io.stdout.write(renderJobTable(jobs));
  }
  return 0;
}

function renderJobDetail(job: ReturnType<typeof getJob>): string {
  if (!job) return "";
  const lines: string[] = [];
  lines.push(`id:         ${job.id}`);
  lines.push(`type:       ${job.type}`);
  lines.push(`status:     ${job.status}`);
  lines.push(`createdAt:  ${job.createdAt}`);
  lines.push(`updatedAt:  ${job.updatedAt}`);
  if (job.startedAt) lines.push(`startedAt:  ${job.startedAt}`);
  if (job.finishedAt) lines.push(`finishedAt: ${job.finishedAt}`);
  if (typeof job.durationMs === "number") lines.push(`durationMs: ${job.durationMs}`);
  if (job.agentId) lines.push(`agentId:    ${job.agentId}`);
  if (job.runId) lines.push(`runId:      ${job.runId}`);
  if (job.metadata && Object.keys(job.metadata).length > 0) {
    lines.push(`metadata:   ${JSON.stringify(job.metadata)}`);
  }
  if (job.error) {
    lines.push("", "error:", job.error);
  }
  if (job.prompt) {
    lines.push("", "prompt:", job.prompt);
  }
  return `${lines.join("\n")}\n`;
}
