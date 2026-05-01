import {
  parseHookPayload,
  readHookStdinSync
} from "./chunk-TKO2YPM2.mjs";
import {
  clearSession,
  ensureStateDir,
  readSession,
  resolveStateDir,
  resolveWorkspaceRoot,
  writeSession
} from "./chunk-PI7XIE4N.mjs";

// plugins/cursor/scripts/session-lifecycle-hook.mts
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
