import { setTimeout as sleep } from "node:timers/promises";

import type { CommandIO, ExitCode } from "../cursor-companion.mjs";
import { bool, optionalString, parseArgs, UsageError } from "../lib/args.mjs";
import { getJob, type ListJobsFilter, listJobs, reconcileStaleJobs } from "../lib/job-control.mjs";
import { formatJobActions, jobAgentHandoffLines, renderJobTable } from "../lib/render.mjs";
import { type JobStatus, type JobType, resolveStateDir, tailJobLog } from "../lib/state.mjs";
import { resolveWorkspaceRoot } from "../lib/workspace.mjs";

const VALID_TYPES = new Set<string>(["task", "review", "adversarial-review"]);
const VALID_STATUSES = new Set<string>(["pending", "running", "completed", "failed", "cancelled"]);
const TERMINAL_STATUSES: ReadonlySet<JobStatus> = new Set(["completed", "failed", "cancelled"]);

const DEFAULT_WAIT_TIMEOUT_MS = 240_000;
const DEFAULT_WAIT_POLL_MS = 1_000;
const PROGRESS_TAIL_LINES = 15;

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

  reconcileStaleJobs(stateDir);

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
          io.stdout.write(renderJobDetail(job, stateDir));
        }
        return 1;
      }
    }
    if (json) {
      io.stdout.write(`${JSON.stringify(job, null, 2)}\n`);
    } else {
      io.stdout.write(renderJobDetail(job, stateDir));
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

function renderJobDetail(job: ReturnType<typeof getJob>, stateDir: string): string {
  if (!job) return "";
  const lines: string[] = [];
  lines.push(`# Job \`${job.id}\``);
  lines.push("");
  lines.push("| Field | Value |");
  lines.push("| --- | --- |");
  const row = (label: string, value: string): void => {
    lines.push(`| ${label} | ${value.replace(/\|/g, "\\|")} |`);
  };
  row("id", `\`${job.id}\``);
  row("type", `\`${job.type}\``);
  row("status", `\`${job.status}\``);
  if (job.phase) row("phase", job.phase);
  row("createdAt", job.createdAt);
  row("updatedAt", job.updatedAt);
  if (job.startedAt) row("startedAt", job.startedAt);
  if (job.finishedAt) row("finishedAt", job.finishedAt);
  if (typeof job.durationMs === "number") row("durationMs", String(job.durationMs));
  if (job.agentId) row("agentId", `\`${job.agentId}\``);
  if (job.runId) row("runId", `\`${job.runId}\``);
  if (job.metadata && Object.keys(job.metadata).length > 0) {
    row("metadata", `\`${JSON.stringify(job.metadata)}\``);
  }
  const actions = formatJobActions({
    id: job.id,
    type: job.type,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  });
  if (actions) row("actions", actions);

  const handoff = jobAgentHandoffLines(job.agentId);
  if (handoff.length > 0) {
    lines.push("", "**Continue this Cursor agent:**", ...handoff);
  }

  if (job.error) {
    lines.push("", "**Error:**", "", "```", job.error, "```");
  }
  if (job.prompt) {
    lines.push("", "**Prompt:**", "", "```", job.prompt, "```");
  }
  // Surface a tail of the streaming log for non-terminal jobs so users can
  // peek at progress without `result --log`.
  if (!TERMINAL_STATUSES.has(job.status)) {
    const tail = tailJobLog(stateDir, job.id, PROGRESS_TAIL_LINES);
    if (tail) {
      lines.push(
        "",
        `**Progress** _(last ${PROGRESS_TAIL_LINES} log lines)_:`,
        "",
        "```",
        tail,
        "```",
      );
    }
  }
  return `${lines.join("\n")}\n`;
}
