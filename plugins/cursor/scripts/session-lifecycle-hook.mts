#!/usr/bin/env node
import { readFileSync } from "node:fs";
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

function readStdinSync(): string {
  // readFileSync(0) blocks on a TTY waiting for input. Claude Code always
  // pipes JSON via stdin for hooks, but a developer running the hook by hand
  // would otherwise hang forever — guard the interactive case.
  if (process.stdin.isTTY) return "";
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function parseStdin(raw: string): SessionStartPayload {
  if (!raw.trim()) return {};
  try {
    const data = JSON.parse(raw);
    if (data && typeof data === "object") return data as SessionStartPayload;
  } catch {
    // ignore malformed payloads
  }
  return {};
}

function handleSessionStart(): number {
  const payload = parseStdin(readStdinSync());
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
  // Reading stdin is harmless if Claude Code didn't send anything.
  parseStdin(readStdinSync());
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
