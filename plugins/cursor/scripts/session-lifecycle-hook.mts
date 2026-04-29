#!/usr/bin/env node
const EVENTS = ["SessionStart", "SessionEnd"];

export function main(argv: readonly string[]): number {
  const event = argv[2];
  if (event === undefined || !EVENTS.includes(event)) {
    console.error(`session-lifecycle-hook: expected one of ${EVENTS.join(", ")}`);
    return 2;
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv));
}
