import type { CommandIO, ExitCode } from "../cursor-companion.mjs";
import { bool, parseArgs, UsageError } from "../lib/args.mjs";
import { cancelJob } from "../lib/job-control.mjs";
import { resolveStateDir } from "../lib/state.mjs";
import { resolveWorkspaceRoot } from "../lib/workspace.mjs";

const HELP = `cursor-companion cancel <job-id> [--json] [--help]

Cancel an active job. If the run is in-process, calls run.cancel() (when
supported). Otherwise marks the persisted job as cancelled with reason
"run-not-active" — the underlying SDK run may still complete.
`;

export async function runCancel(args: readonly string[], io: CommandIO): Promise<ExitCode> {
  const parsed = parseArgs(args, {
    long: { json: "boolean", help: "boolean" },
    short: { h: "help" },
  });
  if (bool(parsed, "help")) {
    io.stdout.write(HELP);
    return 0;
  }
  const jobId = parsed.positionals[0];
  if (!jobId) throw new UsageError("cancel requires a job id");

  const cwd = io.cwd();
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const stateDir = resolveStateDir(workspaceRoot);

  const result = await cancelJob(stateDir, jobId);
  if (bool(parsed, "json")) {
    io.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.cancelled ? 0 : 1;
  }
  if (result.cancelled) {
    io.stdout.write(`cancelled: ${jobId}${result.reason ? ` (${result.reason})` : ""}\n`);
    return 0;
  }
  io.stderr.write(`could not cancel ${jobId}: ${result.reason ?? "unknown"}\n`);
  return 1;
}
