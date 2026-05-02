import type { CommandIO, ExitCode } from "../cursor-companion.mjs";
import { bool, parseArgs } from "../lib/args.mjs";
import { getJob, listJobs, TERMINAL_STATUSES } from "../lib/job-control.mjs";
import { jobAgentHandoffLines } from "../lib/render.mjs";
import { readJobLog, resolveStateDir } from "../lib/state.mjs";
import { resolveWorkspaceRoot } from "../lib/workspace.mjs";

const HELP = `cursor-companion result [<job-id>] [--log] [--json] [--help]

Print a completed job's result text. Without a job id, defaults to the most
recent terminal job for the current workspace. With --log, print the
streaming log captured while the run was alive. With --json, emit the full
JobRecord.
`;

export async function runResult(args: readonly string[], io: CommandIO): Promise<ExitCode> {
  const parsed = parseArgs(args, {
    long: { log: "boolean", json: "boolean", help: "boolean" },
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
  io.stdout.write(job.result);
  if (!job.result.endsWith("\n")) io.stdout.write("\n");
  // Surface handoff hints on stderr so the result text on stdout stays
  // clean for downstream consumers (pipes, --json, programmatic callers).
  const handoff = jobAgentHandoffLines(job.agentId);
  if (handoff.length > 0) {
    io.stderr.write(`\nContinue this Cursor agent:\n${handoff.join("\n")}\n`);
  }
  return 0;
}
