#!/usr/bin/env node
const SUBCOMMANDS = ["task", "review", "adversarial-review", "status", "result", "cancel", "setup"];

export function main(argv: readonly string[]): number {
  const command = argv[2];
  if (command === undefined) {
    console.log(`cursor-companion <command>\n\ncommands:\n  ${SUBCOMMANDS.join("\n  ")}`);
    return 0;
  }
  if (!SUBCOMMANDS.includes(command)) {
    console.error(`cursor-companion: unknown command '${command}'`);
    return 2;
  }
  console.error(`cursor-companion: '${command}' is not implemented yet.`);
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv));
}
