import type { CommandIO, ExitCode } from "../cursor-companion.mjs";
import { bool, optionalString, parseArgs } from "../lib/args.mjs";
import { getJob, type ListJobsFilter, listJobs } from "../lib/job-control.mjs";
import { renderJobTable } from "../lib/render.mjs";
import { type JobStatus, type JobType, resolveStateDir } from "../lib/state.mjs";
import { resolveWorkspaceRoot } from "../lib/workspace.mjs";

const HELP = `cursor-companion status [<job-id>] [flags]

Show the job table for the current workspace, or detail for one job.

flags:
  --type <task|review|adversarial-review>  Filter by type
  --status <pending|running|completed|failed|cancelled>
  --limit <n>                              Cap number of rows
  --json                                   Print as JSON
  --help, -h
`;

export async function runStatus(args: readonly string[], io: CommandIO): Promise<ExitCode> {
  const parsed = parseArgs(args, {
    long: {
      type: "string",
      status: "string",
      limit: "string",
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

  const jobId = parsed.positionals[0];
  if (jobId) {
    const job = getJob(stateDir, jobId);
    if (!job) {
      io.stderr.write(`job not found: ${jobId}\n`);
      return 1;
    }
    if (json) {
      io.stdout.write(`${JSON.stringify(job, null, 2)}\n`);
    } else {
      io.stdout.write(renderJobDetail(job));
    }
    return 0;
  }

  const filter: ListJobsFilter = {};
  const type = optionalString(parsed, "type");
  if (type) filter.type = type as JobType;
  const status = optionalString(parsed, "status");
  if (status) filter.status = status as JobStatus;
  const limit = optionalString(parsed, "limit");
  if (limit) {
    const n = Number(limit);
    if (!Number.isFinite(n) || n < 0) throw new Error(`invalid --limit: ${limit}`);
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
