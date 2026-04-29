#!/usr/bin/env node
/**
 * cursor-companion — CLI entry point for the Cursor plugin.
 *
 * Phase 1 stub: subcommand dispatch is wired up in Phase 3
 * (see PLAN.md §3.1).
 */

const SUBCOMMANDS = [
  "task",
  "review",
  "adversarial-review",
  "status",
  "result",
  "cancel",
  "setup",
] as const;

type Subcommand = (typeof SUBCOMMANDS)[number];

function isSubcommand(value: string | undefined): value is Subcommand {
  return value !== undefined && (SUBCOMMANDS as readonly string[]).includes(value);
}

function printUsage(): void {
  process.stdout.write(
    `cursor-companion <command> [args...]\n\ncommands:\n  ${SUBCOMMANDS.join("\n  ")}\n`,
  );
}

function main(argv: readonly string[]): number {
  const [, , command] = argv;
  if (!isSubcommand(command)) {
    printUsage();
    return command === undefined ? 0 : 2;
  }
  process.stderr.write(`cursor-companion: '${command}' is not implemented yet (Phase 3).\n`);
  return 1;
}

process.exit(main(process.argv));
