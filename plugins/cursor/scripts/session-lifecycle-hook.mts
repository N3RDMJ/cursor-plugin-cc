#!/usr/bin/env node
import { parseHookPayload, readHookStdinSync } from "./lib/hook-payload.mjs";
import { listJobs, markCancelled } from "./lib/job-control.mjs";
import {
  clearSession,
  ensureStateDir,
  readSession,
  resolveStateDir,
  type SessionState,
  writeSession,
} from "./lib/state.mjs";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";

const SESSION_END_KEEP_ENV = "CURSOR_PLUGIN_KEEP_BACKGROUND_JOBS";

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

  // Mark every still-active job for this workspace as cancelled. The owning
  // CLI process started in --background mode is gone, so the in-memory Run
  // can't be reached for a clean cancel — we record the intent and let the
  // SDK time out the underlying agent. Set CURSOR_PLUGIN_KEEP_BACKGROUND_JOBS=1
  // to opt out and keep them running until the 30-min stale-job reconciler
  // catches them.
  const keep = process.env[SESSION_END_KEEP_ENV];
  if (!keep || keep === "0" || keep === "false") {
    for (const entry of listJobs(stateDir)) {
      if (entry.status === "pending" || entry.status === "running") {
        try {
          markCancelled(stateDir, entry.id, "session-ended");
        } catch {
          // Best-effort: continue even if a single job's persistence fails.
        }
      }
    }
  }
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
