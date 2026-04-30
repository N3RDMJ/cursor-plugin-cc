#!/usr/bin/env node
import { parseHookPayload, readHookStdinSync } from "./lib/hook-payload.mjs";
import {
  clearSession,
  ensureStateDir,
  readSession,
  resolveStateDir,
  type SessionState,
  writeSession,
} from "./lib/state.mjs";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";

const EVENTS = ["SessionStart", "SessionEnd"] as const;
type LifecycleEvent = (typeof EVENTS)[number];

interface SessionStartPayload {
  session_id?: string;
  hook_event_name?: string;
  source?: string;
}

function handleSessionStart(): number {
  const payload = parseHookPayload<SessionStartPayload>(readHookStdinSync());
  const cwd = process.cwd();
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const stateDir = ensureStateDir(resolveStateDir(workspaceRoot));

  const sessionId = payload.session_id ?? `local-${Date.now()}`;
  const session: SessionState = {
    version: 1,
    sessionId,
    startedAt: new Date().toISOString(),
    agentIds: [],
    pluginRoot: process.env.CLAUDE_PLUGIN_ROOT,
  };
  writeSession(stateDir, session);
  return 0;
}

function handleSessionEnd(): number {
  // Drain stdin so Claude Code's writer never blocks on the pipe.
  readHookStdinSync();
  const cwd = process.cwd();
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const stateDir = resolveStateDir(workspaceRoot);
  const session = readSession(stateDir);
  if (!session) return 0;
  // Best-effort: clear the session marker. We don't dispose agents here —
  // background tasks may still be running, and the SDK manages durable agent
  // lifecycle on its own. A future enhancement could iterate `agentIds` and
  // dispose any that are still attached.
  clearSession(stateDir);
  return 0;
}

export function main(argv: readonly string[]): number {
  const event = argv[2] as LifecycleEvent | undefined;
  if (event === undefined || !EVENTS.includes(event)) {
    console.error(`session-lifecycle-hook: expected one of ${EVENTS.join(", ")}`);
    return 2;
  }
  try {
    return event === "SessionStart" ? handleSessionStart() : handleSessionEnd();
  } catch {
    // Hooks must not crash Claude Code — best-effort persistence only.
    return 0;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv));
}
