// plugins/cursor/scripts/lib/args.mts
var UsageError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
  }
};
function parseArgs(argv, spec = {}) {
  const long = spec.long ?? {};
  const short = spec.short ?? {};
  const flags = {};
  const positionals = [];
  let stopParsing = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === void 0) continue;
    if (stopParsing) {
      positionals.push(arg);
      continue;
    }
    if (arg === "--") {
      stopParsing = true;
      continue;
    }
    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      const name = eqIdx === -1 ? arg.slice(2) : arg.slice(2, eqIdx);
      const inlineValue = eqIdx === -1 ? void 0 : arg.slice(eqIdx + 1);
      const kind = long[name];
      if (kind === "boolean") {
        if (inlineValue === "false") {
          delete flags[name];
        } else {
          flags[name] = true;
        }
      } else if (kind === "string") {
        if (inlineValue !== void 0) {
          flags[name] = inlineValue;
        } else {
          const next = argv[i + 1];
          if (next === void 0 || next.startsWith("-")) {
            throw new UsageError(`expected value after --${name}`);
          }
          flags[name] = next;
          i += 1;
        }
      } else {
        if (inlineValue !== void 0) flags[name] = inlineValue;
        else flags[name] = true;
      }
      continue;
    }
    if (arg.startsWith("-") && arg.length > 1) {
      const shortName = arg.slice(1);
      const longName = short[shortName];
      if (!longName) {
        throw new UsageError(`unknown short flag: ${arg}`);
      }
      const kind = long[longName];
      if (kind === "string") {
        const next = argv[i + 1];
        if (next === void 0 || next.startsWith("-")) {
          throw new UsageError(`expected value after ${arg}`);
        }
        flags[longName] = next;
        i += 1;
      } else {
        flags[longName] = true;
      }
      continue;
    }
    positionals.push(arg);
  }
  return { positionals, flags };
}
function optionalString(parsed, name) {
  const v = parsed.flags[name];
  return typeof v === "string" ? v : void 0;
}
function bool(parsed, name) {
  return parsed.flags[name] === true;
}

// plugins/cursor/scripts/lib/git.mts
import { execFileSync } from "node:child_process";
function runGit(cwd, args) {
  try {
    const out = execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    return out.replace(/\n+$/, "");
  } catch {
    return void 0;
  }
}
function getDiff(cwd, options = {}) {
  const args = ["diff", "--no-color"];
  if (options.staged) args.push("--cached");
  if (options.baseRef) args.push(options.baseRef);
  return runGit(cwd, args) ?? "";
}
function getStatus(cwd) {
  return runGit(cwd, ["status", "--short"]) ?? "";
}
function isDirty(cwd) {
  return getStatus(cwd).length > 0;
}
function getRecentCommits(cwd, n) {
  if (n <= 0) return [];
  const out = runGit(cwd, ["log", `-${Math.floor(n)}`, "--pretty=format:%H%x09%s"]);
  if (!out) return [];
  return out.split("\n").filter((line) => line.length > 0).map((line) => {
    const [hash, ...rest] = line.split("	");
    return { hash: hash ?? "", subject: rest.join("	") };
  });
}
function getBranch(cwd) {
  const out = runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!out || out === "HEAD") return void 0;
  return out;
}
function detectDefaultBranch(cwd) {
  for (const candidate of ["main", "master", "trunk"]) {
    const local = runGit(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${candidate}`]);
    if (local !== void 0) return candidate;
    const remote = runGit(cwd, [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/remotes/origin/${candidate}`
    ]);
    if (remote !== void 0) return `origin/${candidate}`;
  }
  return void 0;
}
function resolveReviewTarget(cwd, options = {}) {
  const scope = options.scope ?? "auto";
  const baseRef = options.baseRef;
  if (baseRef) {
    return { mode: "branch", baseRef, label: `branch diff against ${baseRef}`, explicit: true };
  }
  if (scope === "working-tree") {
    return { mode: "working-tree", label: "working tree diff", explicit: true };
  }
  if (scope === "branch") {
    const detected2 = detectDefaultBranch(cwd);
    if (!detected2) {
      throw new Error(
        "Unable to detect default branch (looked for main/master/trunk). Pass --base <ref> or use --scope working-tree."
      );
    }
    return {
      mode: "branch",
      baseRef: detected2,
      label: `branch diff against ${detected2}`,
      explicit: true
    };
  }
  if (scope !== "auto") {
    throw new Error(
      `Unsupported review scope "${scope}". Use one of: auto, working-tree, branch, or pass --base <ref>.`
    );
  }
  if (isDirty(cwd)) {
    return { mode: "working-tree", label: "working tree diff", explicit: false };
  }
  const detected = detectDefaultBranch(cwd);
  if (!detected) {
    return {
      mode: "working-tree",
      label: "working tree diff (no default branch)",
      explicit: false
    };
  }
  return {
    mode: "branch",
    baseRef: detected,
    label: `branch diff against ${detected}`,
    explicit: false
  };
}
var SOURCE_EXTS = /\.(mts|ts|tsx)$/;
var DECLARATION_EXTS = /\.d\.(mts|ts)$/;
var TEST_PATTERN = /\.test\.(mts|ts|tsx)$/;
var COMPILED_DIRS = /(?:^|\/)(?:bundle|dist|build|compiled|output)\//;
var COMPILED_EXTS = /\.(mjs|js|cjs)$/;
var MAX_LISTED_FILES = 50;
function getSourceTree(cwd) {
  const out = runGit(cwd, ["ls-files", "--", "*.mts", "*.ts", "*.tsx", "*.mjs", "*.js", "*.cjs"]);
  if (!out) return "";
  const files = out.split("\n").filter((f) => f.length > 0);
  const source = [];
  const tests = [];
  const compiled = [];
  for (const f of files) {
    if (SOURCE_EXTS.test(f) && !DECLARATION_EXTS.test(f)) {
      if (TEST_PATTERN.test(f)) {
        tests.push(f);
      } else {
        source.push(f);
      }
    } else if (COMPILED_EXTS.test(f) && COMPILED_DIRS.test(f)) {
      compiled.push(f);
    }
  }
  if (source.length === 0 && compiled.length === 0) return "";
  const lines = [];
  if (source.length > 0) {
    lines.push("Source files (read these):");
    appendFiles(lines, source);
  }
  if (tests.length > 0) {
    lines.push("Tests:");
    appendFiles(lines, tests);
  }
  if (compiled.length > 0) {
    lines.push("Compiled output (do not read \u2014 use the source files above):");
    appendDirSummary(lines, compiled);
  }
  return lines.join("\n");
}
function appendFiles(lines, files) {
  if (files.length <= MAX_LISTED_FILES) {
    for (const f of files) lines.push(`  ${f}`);
    return;
  }
  appendDirSummary(lines, files);
}
function appendDirSummary(lines, files) {
  const dirs = /* @__PURE__ */ new Map();
  for (const f of files) {
    const dir = f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : ".";
    dirs.set(dir, (dirs.get(dir) ?? 0) + 1);
  }
  for (const [dir, count] of [...dirs.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`  ${dir}/ (${count} ${count === 1 ? "file" : "files"})`);
  }
}
function getRemoteUrl(cwd) {
  return runGit(cwd, ["config", "--get", "remote.origin.url"]) || void 0;
}
function normalizeGitHubRemote(remote) {
  const trimmed = remote.trim().replace(/\.git$/, "");
  const sshMatch = trimmed.match(/^git@github\.com:(.+\/.+)$/);
  const sshUrlMatch = trimmed.match(/^ssh:\/\/git@github\.com\/(.+\/.+)$/);
  const httpsMatch = trimmed.match(/^https:\/\/github\.com\/(.+\/.+)$/);
  const repoPath = sshMatch?.[1] ?? sshUrlMatch?.[1] ?? httpsMatch?.[1];
  return repoPath ? `https://github.com/${repoPath}` : void 0;
}
function detectCloudRepository(cwd) {
  const remote = getRemoteUrl(cwd);
  if (!remote) {
    throw new Error(
      "Cloud mode requires a git repository with remote.origin.url set. Configure a remote or run in --local mode."
    );
  }
  const url = normalizeGitHubRemote(remote);
  if (!url) {
    throw new Error(
      `Cloud mode currently expects remote.origin.url to point at GitHub. Got: ${remote}`
    );
  }
  const branch = getBranch(cwd);
  return branch ? { url, startingRef: branch } : { url };
}

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
function tailJobLog(stateDir, jobId, lines) {
  if (lines <= 0) return void 0;
  const log = readJobLog(stateDir, jobId);
  if (!log) return void 0;
  const body = log.endsWith("\n") ? log.slice(0, -1) : log;
  if (body.length === 0) return void 0;
  const split = body.split("\n");
  return (split.length <= lines ? split : split.slice(-lines)).join("\n");
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

// plugins/cursor/scripts/lib/cursor-agent.mts
import {
  Agent,
  ConfigurationError,
  Cursor
} from "@cursor/sdk";

// plugins/cursor/scripts/lib/credentials.mts
var SERVICE = "cursor-plugin-cc";
var ACCOUNT = "default";
var NativeKeyring = class {
  name = "OS keychain";
  async get() {
    try {
      const Entry = await loadEntry();
      const val = new Entry(SERVICE, ACCOUNT).getPassword();
      return val && val.length > 0 ? val : void 0;
    } catch {
      return void 0;
    }
  }
  async set(secret) {
    const Entry = await loadEntry();
    new Entry(SERVICE, ACCOUNT).setPassword(secret);
  }
  async delete() {
    try {
      const Entry = await loadEntry();
      new Entry(SERVICE, ACCOUNT).deletePassword();
    } catch {
    }
  }
};
var cachedBackend;
var entryPromise;
async function loadEntry() {
  entryPromise ??= import("@napi-rs/keyring").then((mod) => mod.Entry);
  return entryPromise;
}
function detectBackend() {
  if (cachedBackend !== void 0) return cachedBackend;
  const p = process.platform;
  cachedBackend = p === "darwin" || p === "linux" || p === "win32" ? new NativeKeyring() : null;
  return cachedBackend;
}
async function resolveApiKeyFromKeychain() {
  const backend = detectBackend();
  if (!backend) return void 0;
  const secret = await backend.get();
  if (!secret || secret.trim() === "") return void 0;
  return { apiKey: secret, source: "keychain" };
}
async function storeApiKey(secret) {
  const backend = detectBackend();
  if (!backend) {
    throw new Error(
      "No supported keychain backend found. Use CURSOR_API_KEY environment variable instead."
    );
  }
  await backend.set(secret);
}
async function deleteApiKey() {
  const backend = detectBackend();
  if (!backend) {
    throw new Error("No supported keychain backend found.");
  }
  await backend.delete();
}
var activeKeychainSecret;
function getActiveKeychainSecret() {
  return activeKeychainSecret;
}
function setActiveKeychainSecret(secret) {
  activeKeychainSecret = secret;
}

// plugins/cursor/scripts/lib/retry.mts
var DEFAULT_ATTEMPTS = 3;
var DEFAULT_BASE_DELAY_MS = 200;
var DEFAULT_MAX_DELAY_MS = 4e3;
function defaultShouldRetry(error) {
  if (!error || typeof error !== "object") return false;
  return error.isRetryable === true;
}
function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function withRetry(fn, options = {}) {
  const attempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS);
  const base = Math.max(0, options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS);
  const cap = Math.max(base, options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS);
  const shouldRetry = options.shouldRetry ?? defaultShouldRetry;
  const sleep = options.sleep ?? defaultSleep;
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isLast = attempt === attempts - 1;
      if (isLast || !shouldRetry(err)) throw err;
      const delay = Math.min(cap, base * 2 ** attempt);
      await sleep(delay);
    }
  }
  throw lastError;
}

// plugins/cursor/scripts/lib/user-config.mts
import path2 from "node:path";

// plugins/cursor/scripts/lib/model-arg.mts
function parseModelArg(input) {
  const trimmed = input.trim();
  if (!trimmed) throw new UsageError("model selector is empty");
  const colon = trimmed.indexOf(":");
  if (colon === -1) return { id: trimmed };
  const id = trimmed.slice(0, colon).trim();
  const paramSpec = trimmed.slice(colon + 1).trim();
  if (!id) throw new UsageError(`invalid model selector '${input}': missing id before ':'`);
  if (!paramSpec) {
    throw new UsageError(`invalid model selector '${input}': missing params after ':'`);
  }
  const params = paramSpec.split(",").map((pair) => {
    const eq = pair.indexOf("=");
    if (eq === -1) {
      throw new UsageError(
        `invalid model param '${pair}' in '${input}': expected key=value (e.g. reasoning_effort=low)`
      );
    }
    const paramId = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!paramId) throw new UsageError(`invalid model param '${pair}' in '${input}': empty key`);
    if (!value) {
      throw new UsageError(`invalid model param '${pair}' in '${input}': empty value`);
    }
    return { id: paramId, value };
  });
  const seen = /* @__PURE__ */ new Set();
  for (const p of params) {
    if (seen.has(p.id)) {
      throw new UsageError(`invalid model selector '${input}': duplicate param '${p.id}'`);
    }
    seen.add(p.id);
  }
  return { id, params };
}
function formatModelSelection(model) {
  if (!model.params || model.params.length === 0) return model.id;
  const pairs = [...model.params].sort((a, b) => a.id.localeCompare(b.id)).map((p) => `${p.id}=${p.value}`).join(",");
  return `${model.id}:${pairs}`;
}
function optionalModelArg(parsed, name) {
  const raw = optionalString(parsed, name);
  return raw ? parseModelArg(raw) : void 0;
}

// plugins/cursor/scripts/lib/user-config.mts
var USER_CONFIG_ENV_MODEL = "CURSOR_MODEL";
function getUserConfigPath(opts = {}) {
  return path2.join(resolveStateRoot(opts), "config.json");
}
function readUserConfig(opts = {}) {
  const data = readJson(getUserConfigPath(opts));
  if (!data || typeof data !== "object") return { version: 1 };
  const out = { version: 1 };
  if (data.defaultModel && typeof data.defaultModel === "object" && data.defaultModel.id) {
    const next = { id: data.defaultModel.id };
    if (Array.isArray(data.defaultModel.params)) {
      const params = data.defaultModel.params.filter(
        (p) => !!p && typeof p === "object" && typeof p.id === "string" && typeof p.value === "string"
      );
      if (params.length > 0) next.params = params;
    }
    out.defaultModel = next;
  }
  return out;
}
function writeUserConfig(config, opts = {}) {
  writeJsonAtomic(getUserConfigPath(opts), { ...config, version: 1 });
}
function setDefaultModel(model, opts = {}) {
  const next = { ...readUserConfig(opts), defaultModel: model };
  writeUserConfig(next, opts);
  return next;
}
function clearDefaultModel(opts = {}) {
  const { defaultModel: _drop, ...rest } = readUserConfig(opts);
  writeUserConfig(rest, opts);
  return rest;
}
function resolveDefaultModel(fallback, opts = {}) {
  const envValue = process.env[USER_CONFIG_ENV_MODEL]?.trim();
  if (envValue) {
    try {
      return { model: parseModelArg(envValue), source: "env" };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `cursor-plugin: ignoring malformed ${USER_CONFIG_ENV_MODEL}='${envValue}' (${detail})
`
      );
    }
  }
  const cfg = readUserConfig(opts);
  if (cfg.defaultModel) return { model: cfg.defaultModel, source: "config" };
  return { model: fallback, source: "fallback" };
}

// plugins/cursor/scripts/lib/cursor-agent.mts
var DEFAULT_MODEL = { id: "composer-2" };
async function resolveApiKey(apiKey) {
  if (apiKey && apiKey.trim() !== "") {
    return { apiKey, source: "explicit" };
  }
  const env = process.env.CURSOR_API_KEY;
  if (env && env.trim() !== "") {
    return { apiKey: env, source: "env" };
  }
  let keychainResult;
  try {
    keychainResult = await resolveApiKeyFromKeychain();
  } catch {
  }
  if (keychainResult) {
    setActiveKeychainSecret(keychainResult.apiKey);
    return { apiKey: keychainResult.apiKey, source: "keychain" };
  }
  throw new ConfigurationError(
    "No API key found. Run /cursor:setup --login to store one in the OS keychain, or export CURSOR_API_KEY."
  );
}
function buildAgentOptionsFromFlags(workspaceRoot, flags) {
  const opts = { cwd: workspaceRoot };
  if (flags.model) opts.model = flags.model;
  if (flags.cloud) {
    opts.mode = "cloud";
    opts.cloudRepo = detectCloudRepository(workspaceRoot);
  }
  return opts;
}
async function buildAgentOptions(opts) {
  const { apiKey } = await resolveApiKey(opts.apiKey);
  const model = opts.model ?? resolveDefaultModel(DEFAULT_MODEL).model;
  const mode = opts.mode ?? "local";
  const base = {
    apiKey,
    model,
    ...opts.name ? { name: opts.name } : {},
    ...opts.mcpServers ? { mcpServers: opts.mcpServers } : {}
  };
  if (mode === "cloud") {
    if (!opts.cloudRepo) {
      throw new ConfigurationError(
        "Cloud mode requires a cloudRepo (url, optional startingRef). Use detectCloudRepository() from lib/git.mts."
      );
    }
    const repo = { url: opts.cloudRepo.url };
    if (opts.cloudRepo.startingRef) repo.startingRef = opts.cloudRepo.startingRef;
    return { ...base, cloud: { repos: [repo] } };
  }
  return {
    ...base,
    local: {
      cwd: opts.cwd,
      ...opts.settingSources ? { settingSources: opts.settingSources } : {}
    }
  };
}
async function createAgent(opts) {
  return Agent.create(await buildAgentOptions(opts));
}
async function resumeAgent(agentId, opts) {
  return Agent.resume(agentId, await buildAgentOptions(opts));
}
async function disposeAgent(agent) {
  await agent[Symbol.asyncDispose]();
}
async function sendTask(agent, prompt, options = {}) {
  const run = options.force ? await agent.send(prompt, { local: { force: true } }) : await agent.send(prompt);
  options.onRunStart?.(run);
  return collectRunResult(run, options);
}
async function oneShot(prompt, opts) {
  const { timeoutMs, onEvent, onRunStart, force, ...agentOpts } = opts;
  const agent = await createAgent(agentOpts);
  try {
    const sendOpts = {};
    if (timeoutMs !== void 0) sendOpts.timeoutMs = timeoutMs;
    if (onEvent !== void 0) sendOpts.onEvent = onEvent;
    if (onRunStart !== void 0) sendOpts.onRunStart = onRunStart;
    if (force !== void 0) sendOpts.force = force;
    return await sendTask(agent, prompt, sendOpts);
  } finally {
    await disposeAgent(agent).catch(() => {
    });
  }
}
async function cancelRun(run) {
  if (!run.supports("cancel")) {
    const reason = run.unsupportedReason("cancel") ?? "This run cannot be cancelled.";
    return { cancelled: false, reason };
  }
  await run.cancel();
  return { cancelled: true };
}
async function listRemoteAgents(options) {
  const limit = options.limit ?? 25;
  const listOpts = options.runtime === "cloud" ? { runtime: "cloud", limit } : { runtime: "local", cwd: options.cwd, limit };
  const { items } = await Agent.list(listOpts);
  return items.map((info) => ({
    agentId: info.agentId,
    name: info.name,
    summary: info.summary,
    lastModified: info.lastModified,
    ...info.status ? { status: info.status } : {},
    ...info.archived !== void 0 ? { archived: info.archived } : {},
    ...info.runtime ? { runtime: info.runtime } : {}
  }));
}
async function whoami(opts = {}) {
  const { apiKey } = await resolveApiKey(opts.apiKey);
  return withRetry(() => Cursor.me({ apiKey }), opts.retry);
}
async function listModels(opts = {}) {
  const { apiKey } = await resolveApiKey(opts.apiKey);
  return withRetry(() => Cursor.models.list({ apiKey }), opts.retry);
}
async function validateModel(model, opts = {}) {
  const models = opts.catalog ?? await listModels(opts);
  const match = models.find((m) => m.id === model.id);
  if (!match) {
    const known = models.map((m) => m.id).join(", ") || "(none)";
    throw new ConfigurationError(
      `Model '${model.id}' is not available for this API key. Known models: ${known}`
    );
  }
  const params = model.params ?? [];
  if (params.length === 0) return match;
  const definitions = match.parameters;
  if (!definitions || definitions.length === 0) return match;
  for (const p of params) {
    const def = definitions.find((d) => d.id === p.id);
    if (!def) {
      const known = definitions.map((d) => d.id).join(", ") || "(none)";
      throw new ConfigurationError(
        `Model '${model.id}' does not accept param '${p.id}'. Known params: ${known}`
      );
    }
    if (def.values.length > 0 && !def.values.some((v) => v.value === p.value)) {
      const allowed = def.values.map((v) => v.value).join(", ");
      throw new ConfigurationError(
        `Model '${model.id}' param '${p.id}' does not accept value '${p.value}'. Allowed: ${allowed}`
      );
    }
  }
  return match;
}
function normalizeStreamStatus(status) {
  return status.toLowerCase();
}
function toAgentEvents(message) {
  switch (message.type) {
    case "assistant": {
      const events = [];
      for (const block of message.message.content) {
        if (block.type === "text") {
          events.push({ type: "assistant_text", text: block.text });
        } else {
          events.push({
            type: "tool",
            callId: block.id,
            name: block.name,
            status: "requested",
            args: block.input
          });
        }
      }
      return events;
    }
    case "thinking":
      return [{ type: "thinking", text: message.text }];
    case "tool_call":
      return [
        {
          type: "tool",
          callId: message.call_id,
          name: message.name,
          status: message.status,
          args: message.args
        }
      ];
    case "status":
      return [
        {
          type: "status",
          status: normalizeStreamStatus(message.status),
          ...message.message ? { message: message.message } : {}
        }
      ];
    case "task":
      return [
        {
          type: "task",
          ...message.status ? { status: message.status } : {},
          ...message.text ? { text: message.text } : {}
        }
      ];
    case "system":
      return [
        {
          type: "system",
          ...message.model ? { model: message.model } : {},
          ...message.tools ? { tools: message.tools } : {}
        }
      ];
    default:
      return [];
  }
}
async function collectRunResult(run, options) {
  const toolCalls = /* @__PURE__ */ new Map();
  const textParts = [];
  let observedTerminalStatus;
  let timedOut = false;
  const timeout = options.timeoutMs !== void 0 && options.timeoutMs > 0 ? setTimeout(() => {
    timedOut = true;
    if (run.supports("cancel")) {
      run.cancel().catch(() => {
      });
    }
  }, options.timeoutMs) : void 0;
  try {
    for await (const event of run.stream()) {
      options.onEvent?.(event);
      ingestEvent(event, textParts, toolCalls);
      if (event.type === "status") {
        const normalized = normalizeStreamStatus(event.status);
        if (normalized === "finished" || normalized === "error" || normalized === "cancelled" || normalized === "expired") {
          observedTerminalStatus = normalized;
        }
      }
    }
    if (timeout) clearTimeout(timeout);
    const result = await run.wait();
    const status = timedOut ? "cancelled" : observedTerminalStatus ?? result.status;
    return {
      status,
      output: result.result ?? textParts.join(""),
      toolCalls: [...toolCalls.values()],
      agentId: run.agentId,
      runId: run.id,
      durationMs: result.durationMs,
      ...timedOut ? { timedOut: true } : {}
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
function ingestEvent(event, textParts, toolCalls) {
  if (event.type === "assistant") {
    for (const block of event.message.content) {
      if (block.type === "text") textParts.push(block.text);
    }
    return;
  }
  if (event.type === "tool_call") {
    toolCalls.set(event.call_id, {
      callId: event.call_id,
      name: event.name,
      status: event.status,
      args: event.args,
      result: event.result
    });
  }
}

// plugins/cursor/scripts/lib/job-control.mts
import crypto2 from "node:crypto";

// plugins/cursor/scripts/lib/redact.mts
var PLACEHOLDER = "[REDACTED]";
var MIN_KEY_LENGTH = 8;
function redactSecret(text, secret) {
  if (!secret || secret.length < MIN_KEY_LENGTH) return text;
  return text.split(secret).join(PLACEHOLDER);
}
function redactApiKey(text) {
  let result = redactSecret(text, process.env.CURSOR_API_KEY);
  result = redactSecret(result, getActiveKeychainSecret());
  return result;
}
function redactError(error) {
  if (error instanceof Error) {
    const parts = [error.message];
    const cause = error.cause;
    if (cause instanceof Error && cause.message && cause.message !== error.message) {
      parts.push(`(cause: ${cause.message})`);
    }
    return redactApiKey(parts.join(" "));
  }
  return redactApiKey(String(error));
}

// plugins/cursor/scripts/lib/job-control.mts
var TERMINAL_STATUSES = /* @__PURE__ */ new Set([
  "completed",
  "failed",
  "cancelled"
]);
var RUN_NOT_ACTIVE_REASON = "run-not-active";
var STALE_JOB_TTL_MS = 30 * 60 * 1e3;
var JOB_ID_BYTES = 6;
function newJobId(type) {
  const prefix = type === "adversarial-review" ? "adv" : type;
  return `${prefix}-${crypto2.randomBytes(JOB_ID_BYTES).toString("hex")}`;
}
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function summarize(prompt, max = 80) {
  const compact = prompt.replace(/\s+/g, " ").trim();
  return compact.length <= max ? compact : `${compact.slice(0, max - 3)}...`;
}
function indexEntry(record) {
  const entry = {
    id: record.id,
    type: record.type,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
  if (record.startedAt) entry.startedAt = record.startedAt;
  if (record.finishedAt) entry.finishedAt = record.finishedAt;
  const summary = record.metadata && typeof record.metadata.summary === "string" ? record.metadata.summary : summarize(record.prompt);
  if (summary) entry.summary = summary;
  if (record.phase) entry.phase = record.phase;
  return entry;
}
function upsertIndex(stateDir, record) {
  const idx = readStateIndex(stateDir);
  const entry = indexEntry(record);
  const i = idx.jobs.findIndex((j) => j.id === record.id);
  if (i === -1) {
    idx.jobs.unshift(entry);
  } else {
    idx.jobs[i] = entry;
  }
  writeStateIndex(stateDir, idx);
}
function createJob(stateDir, input) {
  const id = newJobId(input.type);
  const created = nowIso();
  const metadata = input.metadata || input.summary ? { ...input.metadata ?? {}, ...input.summary ? { summary: input.summary } : {} } : void 0;
  const record = {
    id,
    type: input.type,
    status: "pending",
    prompt: input.prompt,
    createdAt: created,
    updatedAt: created,
    ...metadata ? { metadata } : {}
  };
  writeJob(stateDir, record);
  upsertIndex(stateDir, record);
  return record;
}
function getJob(stateDir, jobId) {
  return readJob(stateDir, jobId);
}
function listJobs(stateDir, filter = {}) {
  const idx = readStateIndex(stateDir);
  let entries = [...idx.jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (filter.type) entries = entries.filter((j) => j.type === filter.type);
  if (filter.status) entries = entries.filter((j) => j.status === filter.status);
  if (typeof filter.limit === "number" && filter.limit >= 0) {
    entries = entries.slice(0, Math.floor(filter.limit));
  }
  return entries;
}
function findRecentTaskAgents(stateDir, limit = 10, lookahead = Math.max(limit * 2, 20)) {
  const recent = listJobs(stateDir, { type: "task", limit: lookahead });
  const out = [];
  for (const entry of recent) {
    if (out.length >= limit) break;
    const job = readJob(stateDir, entry.id);
    if (!job?.agentId) continue;
    const ref = {
      jobId: job.id,
      agentId: job.agentId,
      createdAt: job.createdAt
    };
    if (entry.summary) ref.summary = entry.summary;
    out.push(ref);
  }
  return out;
}
function update(stateDir, jobId, input) {
  const existing = readJob(stateDir, jobId);
  if (!existing) {
    throw new Error(`job not found: ${jobId}`);
  }
  if (TERMINAL_STATUSES.has(existing.status)) {
    return existing;
  }
  const next = {
    ...existing,
    ...input,
    metadata: input.metadata ? { ...existing.metadata ?? {}, ...input.metadata } : existing.metadata,
    updatedAt: nowIso()
  };
  writeJob(stateDir, next);
  upsertIndex(stateDir, next);
  return next;
}
function markRunning(stateDir, jobId, refs) {
  return update(stateDir, jobId, {
    status: "running",
    startedAt: nowIso(),
    agentId: refs.agentId,
    runId: refs.runId
  });
}
function markFinished(stateDir, jobId, result) {
  let status;
  let extraMetadata;
  switch (result.status) {
    case "finished":
      status = "completed";
      break;
    case "error":
      status = "failed";
      break;
    case "cancelled":
      status = "cancelled";
      break;
    case "expired":
      status = "cancelled";
      extraMetadata = { expired: true };
      break;
  }
  const updates = {
    status,
    finishedAt: nowIso(),
    agentId: result.agentId,
    runId: result.runId,
    result: result.output
  };
  if (typeof result.durationMs === "number") updates.durationMs = result.durationMs;
  if (result.timedOut || extraMetadata) {
    updates.metadata = { ...result.timedOut ? { timedOut: true } : {}, ...extraMetadata };
  }
  return update(stateDir, jobId, updates);
}
function markFailed(stateDir, jobId, error) {
  return update(stateDir, jobId, {
    status: "failed",
    finishedAt: nowIso(),
    error: redactApiKey(error)
  });
}
var PHASE_MAX_LENGTH = 80;
function normalizePhase(raw) {
  const compact = raw.replace(/\s+/g, " ").trim();
  if (compact.length <= PHASE_MAX_LENGTH) return compact;
  return `${compact.slice(0, PHASE_MAX_LENGTH - 3)}...`;
}
function markPhase(stateDir, jobId, phase) {
  const normalized = normalizePhase(phase);
  if (!normalized) return void 0;
  const existing = readJob(stateDir, jobId);
  if (!existing) return void 0;
  if (TERMINAL_STATUSES.has(existing.status)) return existing;
  if (existing.phase === normalized) return existing;
  return update(stateDir, jobId, { phase: normalized });
}
function markCancelled(stateDir, jobId, reason) {
  const updates = {
    status: "cancelled",
    finishedAt: nowIso()
  };
  if (reason) updates.metadata = { cancelReason: reason };
  return update(stateDir, jobId, updates);
}
var activeRuns = /* @__PURE__ */ new Map();
function registerActiveRun(jobId, run) {
  activeRuns.set(jobId, run);
}
function unregisterActiveRun(jobId) {
  activeRuns.delete(jobId);
}
async function cancelJob(stateDir, jobId) {
  const job = readJob(stateDir, jobId);
  if (!job) {
    return { cancelled: false, reason: `job not found: ${jobId}` };
  }
  if (job.status !== "pending" && job.status !== "running") {
    return { cancelled: false, reason: `job is ${job.status}`, job };
  }
  const run = activeRuns.get(jobId);
  if (!run) {
    const updated2 = markCancelled(stateDir, jobId, RUN_NOT_ACTIVE_REASON);
    return { cancelled: true, reason: RUN_NOT_ACTIVE_REASON, job: updated2 };
  }
  const result = await cancelRun(run);
  if (!result.cancelled) {
    return { cancelled: false, reason: result.reason, job };
  }
  const updated = markCancelled(stateDir, jobId, result.reason);
  activeRuns.delete(jobId);
  return { cancelled: true, ...result.reason ? { reason: result.reason } : {}, job: updated };
}
function logJobLine(stateDir, jobId, line) {
  const scrubbed = redactApiKey(line);
  const text = scrubbed.endsWith("\n") ? scrubbed : `${scrubbed}
`;
  appendJobLog(stateDir, jobId, text);
}
function reconcileStaleJobs(stateDir, ttlMs = STALE_JOB_TTL_MS) {
  const idx = readStateIndex(stateDir);
  const now = Date.now();
  const reconciled = [];
  for (const entry of idx.jobs) {
    if (TERMINAL_STATUSES.has(entry.status)) continue;
    if (activeRuns.has(entry.id)) continue;
    const age = now - new Date(entry.updatedAt).getTime();
    if (age < ttlMs) continue;
    if (entry.status === "running") {
      const logMtime = jobLogMtimeMs(stateDir, entry.id);
      if (logMtime !== void 0 && now - logMtime < ttlMs) continue;
    }
    markFailed(stateDir, entry.id, `stale: no update for ${Math.round(age / 6e4)} minutes`);
    reconciled.push(entry.id);
  }
  return reconciled;
}

// plugins/cursor/scripts/lib/workspace.mts
import { execFileSync as execFileSync2 } from "node:child_process";
import path3 from "node:path";
function resolveWorkspaceRoot(cwd) {
  try {
    const out = execFileSync2("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    const root = out.trim();
    if (root.length > 0) {
      return path3.resolve(root);
    }
  } catch {
  }
  return path3.resolve(cwd);
}

export {
  UsageError,
  parseArgs,
  optionalString,
  bool,
  detectBackend,
  storeApiKey,
  deleteApiKey,
  getDiff,
  getStatus,
  getRecentCommits,
  getBranch,
  resolveReviewTarget,
  getSourceTree,
  parseModelArg,
  formatModelSelection,
  optionalModelArg,
  resolveStateDir,
  ensureStateDir,
  writeJsonAtomic,
  readJson,
  readJobLog,
  tailJobLog,
  readSession,
  writeSession,
  clearSession,
  setDefaultModel,
  clearDefaultModel,
  resolveDefaultModel,
  DEFAULT_MODEL,
  resolveApiKey,
  buildAgentOptionsFromFlags,
  createAgent,
  resumeAgent,
  disposeAgent,
  sendTask,
  oneShot,
  listRemoteAgents,
  whoami,
  listModels,
  validateModel,
  toAgentEvents,
  redactError,
  TERMINAL_STATUSES,
  RUN_NOT_ACTIVE_REASON,
  createJob,
  getJob,
  listJobs,
  findRecentTaskAgents,
  markRunning,
  markFinished,
  markFailed,
  markPhase,
  markCancelled,
  registerActiveRun,
  unregisterActiveRun,
  cancelJob,
  logJobLine,
  reconcileStaleJobs,
  resolveWorkspaceRoot
};
