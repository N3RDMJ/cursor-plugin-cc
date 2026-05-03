import type { CommandIO, ExitCode } from "../cursor-companion.mjs";
import { bool, parseArgs, UsageError } from "../lib/args.mjs";
import { cancelJob, RUN_NOT_ACTIVE_REASON } from "../lib/job-control.mjs";
import { resolveStateDir } from "../lib/state.mjs";
import { resolveWorkspaceRoot } from "../lib/workspace.mjs";

const HELP = `cursor-companion cancel <job-id> [--json] [--help]

Cancel an active job. If the run was started in this CLI process, calls
run.cancel() (capability-checked) and the job stops cleanly.

LIMITATION: when the job was started in a different CLI process (e.g. via
\`/cursor:task --background\` from a previous Claude Code turn), the in-memory
Run object is not reachable and we cannot signal the SDK to stop. The job
record is marked cancelled with reason="${RUN_NOT_ACTIVE_REASON}" but the
underlying SDK run may keep going to completion. Track that run via
\`/cursor:resume <agent-id>\` if you need to stop it.
`;

function runNotActiveHint(agentId: string | undefined): string {
  const resumeTarget = agentId ?? "<agent-id>";
  return [
    "warning: this CLI process did not own the in-memory Run object, so the",
    "underlying SDK run was NOT signalled. The job record is marked cancelled",
    "but the Cursor agent may keep working until it finishes on its own.",
    `Use \`/cursor:resume ${resumeTarget}\` to reattach and observe / send a stop prompt.`,
  ].join("\n");
}

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
  const splitBrain = result.cancelled && result.reason === RUN_NOT_ACTIVE_REASON;

  if (bool(parsed, "json")) {
    const payload = { ...result, splitBrain };
    io.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return result.cancelled ? 0 : 1;
  }
  if (result.cancelled) {
    io.stdout.write(`cancelled: ${jobId}${result.reason ? ` (${result.reason})` : ""}\n`);
    if (splitBrain) {
      io.stderr.write(`${runNotActiveHint(result.job?.agentId)}\n`);
    }
    return 0;
  }
  io.stderr.write(`could not cancel ${jobId}: ${result.reason ?? "unknown"}\n`);
  return 1;
}
