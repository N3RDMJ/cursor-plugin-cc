#!/usr/bin/env node
import { runCancel } from "./commands/cancel.mjs";
import { runResult } from "./commands/result.mjs";
import { runReview } from "./commands/review.mjs";
import { runSetup } from "./commands/setup.mjs";
import { runStatus } from "./commands/status.mjs";
import { runTask } from "./commands/task.mjs";
import { renderError } from "./lib/render.mjs";

export type ExitCode = 0 | 1 | 2;

interface CommandIO {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  cwd: () => string;
  env: NodeJS.ProcessEnv;
}

const HELP = `cursor-companion <command> [args]

commands:
  task <prompt>          Delegate an implementation task to Cursor
  review                 Review the current diff
  adversarial-review     Challenge design choices, not just defects
  status [<job-id>]      Show job table or single job detail
  result <job-id>        Retrieve a completed job's output
  cancel <job-id>        Cancel an active job
  setup                  Validate API key, list available models

global flags:
  --json                 Machine-readable output where supported
  --help, -h             Show this help

run '<command> --help' for command-specific options.
`;

export async function main(argv: readonly string[], io: CommandIO): Promise<ExitCode> {
  const [, , command, ...rest] = argv;

  if (command === undefined || command === "--help" || command === "-h") {
    io.stdout.write(HELP);
    return 0;
  }

  try {
    switch (command) {
      case "task":
        return await runTask(rest, io);
      case "review":
        return await runReview(rest, io, { adversarial: false });
      case "adversarial-review":
        return await runReview(rest, io, { adversarial: true });
      case "status":
        return await runStatus(rest, io);
      case "result":
        return await runResult(rest, io);
      case "cancel":
        return await runCancel(rest, io);
      case "setup":
        return await runSetup(rest, io);
      default:
        io.stderr.write(`cursor-companion: unknown command '${command}'\n`);
        io.stderr.write(HELP);
        return 2;
    }
  } catch (err) {
    io.stderr.write(renderError(err));
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const code = await main(process.argv, {
    stdout: process.stdout,
    stderr: process.stderr,
    cwd: () => process.cwd(),
    env: process.env,
  });
  process.exit(code);
}

export type { CommandIO };
