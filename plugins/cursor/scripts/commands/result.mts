import type { CommandIO, ExitCode } from "../cursor-companion.mjs";
import { bool, parseArgs } from "../lib/args.mjs";
import { getJob, listJobs, TERMINAL_STATUSES } from "../lib/job-control.mjs";
import { jobAgentHandoffLines, renderTaskResultCard } from "../lib/render.mjs";
import { readJobLog, resolveStateDir } from "../lib/state.mjs";
import { resolveWorkspaceRoot } from "../lib/workspace.mjs";

const HELP = `cursor-companion result [<job-id>] [--raw] [--log] [--json] [--help]

Print a completed job's result text. Without a job id, defaults to the most
recent terminal job for the current workspace.

By default tasks render as a Markdown card (status, duration, agent id, fenced
output, and resume hints) so the result is self-describing. Pass --raw to get
the unwrapped output text on stdout — useful for piping into other tools.
Reviews always render through the structured review formatter and ignore --raw.

flags:
  --raw   Emit just the result text on stdout (no card, no header)
  --log   Print the streaming log captured while the run was alive
  --json  Emit the full JobRecord
  --help, -h
`;

export async function runResult(args: readonly string[], io: CommandIO): Promise<ExitCode> {
  const parsed = parseArgs(args, {
    long: { raw: "boolean", log: "boolean", json: "boolean", help: "boolean" },
    short: { h: "help" },
  });
  if (bool(parsed, "help")) {
    io.stdout.write(HELP);
    return 0;
  }

  const cwd = io.cwd();
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const stateDir = resolveStateDir(workspaceRoot);

  let jobId = parsed.positionals[0];
  if (!jobId) {
    const recent = listJobs(stateDir).find((j) => TERMINAL_STATUSES.has(j.status));
    if (!recent) {
      io.stderr.write("no terminal jobs in this workspace yet — pass a job id\n");
      return 1;
    }
    jobId = recent.id;
  }

  const job = getJob(stateDir, jobId);
  if (!job) {
    io.stderr.write(`job not found: ${jobId}\n`);
    return 1;
  }

  if (bool(parsed, "json")) {
    io.stdout.write(`${JSON.stringify(job, null, 2)}\n`);
    return 0;
  }

  if (bool(parsed, "log")) {
    const log = readJobLog(stateDir, jobId);
    if (!log) {
      io.stderr.write(`no log for job ${jobId}\n`);
      return 1;
    }
    io.stdout.write(log);
    if (!log.endsWith("\n")) io.stdout.write("\n");
    return 0;
  }

  if (!job.result) {
    if (job.error) io.stderr.write(`job failed: ${job.error}\n`);
    else io.stderr.write(`no result for job ${jobId} (status: ${job.status})\n`);
    return 1;
  }

  if (bool(parsed, "raw")) {
    io.stdout.write(job.result);
    if (!job.result.endsWith("\n")) io.stdout.write("\n");
    // Even in raw mode, surface handoff hints on stderr so users can find the
    // resume command without reparsing — stderr stays out of stdin pipelines.
    const handoff = jobAgentHandoffLines(job.agentId);
    if (handoff.length > 0) {
      io.stderr.write(`\nContinue this Cursor agent:\n${handoff.join("\n")}\n`);
    }
    return 0;
  }

  // Reviews already get their own structured card from `runReview`; reprint the
  // raw result here so re-reading via `/cursor:result <id>` matches the original.
  if (job.type === "review" || job.type === "adversarial-review") {
    io.stdout.write(job.result);
    if (!job.result.endsWith("\n")) io.stdout.write("\n");
    return 0;
  }

  io.stdout.write(renderTaskResultCard(job));
  return 0;
}
