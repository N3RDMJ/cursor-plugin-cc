#!/usr/bin/env node
/**
 * session-lifecycle-hook — handler for SessionStart / SessionEnd events.
 *
 * Phase 1 stub: real session/agent state management lands in Phase 4
 * (see PLAN.md §4.3).
 */

const EVENTS = ["SessionStart", "SessionEnd"] as const;
type Event = (typeof EVENTS)[number];

function isEvent(value: string | undefined): value is Event {
  return value !== undefined && (EVENTS as readonly string[]).includes(value);
}

function main(argv: readonly string[]): number {
  const [, , event] = argv;
  if (!isEvent(event)) {
    process.stderr.write(`session-lifecycle-hook: expected one of ${EVENTS.join(", ")}\n`);
    return 2;
  }
  // No-op until Phase 4 wires up state persistence + agent disposal.
  return 0;
}

process.exit(main(process.argv));
