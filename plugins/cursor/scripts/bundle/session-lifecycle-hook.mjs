import {
  parseHookPayload,
  readHookStdinSync
} from "./chunk-TKO2YPM2.mjs";
import {
  clearSession,
  ensureStateDir,
  listJobs,
  markCancelled,
  readSession,
  resolveStateDir,
  resolveWorkspaceRoot,
  writeSession
} from "./chunk-5GJCFYFO.mjs";

// plugins/cursor/scripts/session-lifecycle-hook.mts
var SESSION_END_KEEP_ENV = "CURSOR_PLUGIN_KEEP_BACKGROUND_JOBS";
var EVENTS = ["SessionStart", "SessionEnd"];
function handleSessionStart() {
  const payload = parseHookPayload(readHookStdinSync());
  const cwd = process.cwd();
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const stateDir = ensureStateDir(resolveStateDir(workspaceRoot));
  const sessionId = payload.session_id ?? `local-${Date.now()}`;
  const session = {
    version: 1,
    sessionId,
    startedAt: (/* @__PURE__ */ new Date()).toISOString(),
    agentIds: [],
    pluginRoot: process.env.CLAUDE_PLUGIN_ROOT
  };
  writeSession(stateDir, session);
  return 0;
}
function handleSessionEnd() {
  readHookStdinSync();
  const cwd = process.cwd();
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const stateDir = resolveStateDir(workspaceRoot);
  const session = readSession(stateDir);
  if (!session) return 0;
  const keep = process.env[SESSION_END_KEEP_ENV];
  if (!keep || keep === "0" || keep === "false") {
    for (const entry of listJobs(stateDir)) {
      if (entry.status === "pending" || entry.status === "running") {
        try {
          markCancelled(stateDir, entry.id, "session-ended");
        } catch {
        }
      }
    }
  }
  clearSession(stateDir);
  return 0;
}
function main(argv) {
  const event = argv[2];
  if (event === void 0 || !EVENTS.includes(event)) {
    console.error(`session-lifecycle-hook: expected one of ${EVENTS.join(", ")}`);
    return 2;
  }
  try {
    return event === "SessionStart" ? handleSessionStart() : handleSessionEnd();
  } catch {
    return 0;
  }
}
if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv));
}
export {
  main
};
