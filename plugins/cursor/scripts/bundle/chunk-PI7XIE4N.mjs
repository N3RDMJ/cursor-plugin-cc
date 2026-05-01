// plugins/cursor/scripts/lib/state.mts
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
var STATE_ROOT_ENV = "CURSOR_PLUGIN_STATE_ROOT";
var SLUG_HASH_LENGTH = 16;
var SLUG_NAME_MAX = 32;
var FILE_MODE = 384;
var DIR_MODE = 448;
function computeWorkspaceSlug(workspaceRoot) {
  const canonical = path.resolve(workspaceRoot);
  const hash = crypto.createHash("sha256").update(canonical).digest("hex").slice(0, SLUG_HASH_LENGTH);
  const base = path.basename(canonical);
  const sanitized = base.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, SLUG_NAME_MAX) || "workspace";
  return `${sanitized}-${hash}`;
}
function resolveStateRoot(opts = {}) {
  if (opts.root && opts.root.trim().length > 0) return path.resolve(opts.root);
  const env = process.env[STATE_ROOT_ENV];
  if (env && env.trim().length > 0) return path.resolve(env);
  return path.join(os.homedir(), ".claude", "cursor-plugin");
}
function resolveStateDir(workspaceRoot, opts = {}) {
  return path.join(resolveStateRoot(opts), computeWorkspaceSlug(workspaceRoot));
}
function ensureStateDir(stateDir) {
  fs.mkdirSync(stateDir, { recursive: true, mode: DIR_MODE });
  return stateDir;
}
function getStateIndexPath(stateDir) {
  return path.join(stateDir, "state.json");
}
function assertSafeJobId(jobId) {
  if (jobId.length === 0 || jobId.includes("/") || jobId.includes("\\") || jobId.includes("\0") || jobId === "." || jobId === "..") {
    throw new Error(`invalid jobId: ${JSON.stringify(jobId)}`);
  }
}
function getJobJsonPath(stateDir, jobId) {
  assertSafeJobId(jobId);
  return path.join(stateDir, `${jobId}.json`);
}
function getJobLogPath(stateDir, jobId) {
  assertSafeJobId(jobId);
  return path.join(stateDir, `${jobId}.log`);
}
function getSessionPath(stateDir) {
  return path.join(stateDir, "session.json");
}
function writeJsonAtomic(filePath, data) {
  ensureStateDir(path.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}
`, { mode: FILE_MODE });
  try {
    fs.renameSync(tmp, filePath);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}
function readJson(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return void 0;
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return void 0;
  }
}
function readStateIndex(stateDir) {
  const data = readJson(getStateIndexPath(stateDir));
  if (!data || !Array.isArray(data.jobs)) return { version: 1, jobs: [] };
  return data;
}
function writeStateIndex(stateDir, index) {
  writeJsonAtomic(getStateIndexPath(stateDir), index);
}
function readJob(stateDir, jobId) {
  return readJson(getJobJsonPath(stateDir, jobId));
}
function writeJob(stateDir, record) {
  writeJsonAtomic(getJobJsonPath(stateDir, record.id), record);
}
function appendJobLog(stateDir, jobId, text) {
  ensureStateDir(stateDir);
  fs.appendFileSync(getJobLogPath(stateDir, jobId), text, { mode: FILE_MODE });
}
function jobLogMtimeMs(stateDir, jobId) {
  try {
    return fs.statSync(getJobLogPath(stateDir, jobId)).mtimeMs;
  } catch {
    return void 0;
  }
}
function readJobLog(stateDir, jobId) {
  try {
    return fs.readFileSync(getJobLogPath(stateDir, jobId), "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return void 0;
    throw err;
  }
}
function readSession(stateDir) {
  return readJson(getSessionPath(stateDir));
}
function writeSession(stateDir, session) {
  writeJsonAtomic(getSessionPath(stateDir), session);
}
function clearSession(stateDir) {
  fs.rmSync(getSessionPath(stateDir), { force: true });
}

// plugins/cursor/scripts/lib/workspace.mts
import { execFileSync } from "node:child_process";
import path2 from "node:path";
function resolveWorkspaceRoot(cwd) {
  try {
    const out = execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    const root = out.trim();
    if (root.length > 0) {
      return path2.resolve(root);
    }
  } catch {
  }
  return path2.resolve(cwd);
}

export {
  resolveStateRoot,
  resolveStateDir,
  ensureStateDir,
  writeJsonAtomic,
  readJson,
  readStateIndex,
  writeStateIndex,
  readJob,
  writeJob,
  appendJobLog,
  jobLogMtimeMs,
  readJobLog,
  readSession,
  writeSession,
  clearSession,
  resolveWorkspaceRoot
};
