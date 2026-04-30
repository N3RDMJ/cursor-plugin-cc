import type { CommandIO, ExitCode } from "../cursor-companion.mjs";
import { bool, parseArgs, UsageError } from "../lib/args.mjs";
import { getJob } from "../lib/job-control.mjs";
import { readJobLog, resolveStateDir } from "../lib/state.mjs";
import { resolveWorkspaceRoot } from "../lib/workspace.mjs";

const HELP = `cursor-companion result <job-id> [--log] [--json] [--help]

Print a completed job's result text. With --log, print the streaming log
captured while the run was alive. With --json, emit the full JobRecord.
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

  const jobId = parsed.positionals[0];
  if (!jobId) throw new UsageError("result requires a job id");

  const cwd = io.cwd();
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const stateDir = resolveStateDir(workspaceRoot);

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
  return 0;
}
