import {
  appendJobLog,
  ensureStateDir,
  readJob,
  readJson,
  readStateIndex,
  resolveStateDir,
  resolveStateRoot,
  resolveWorkspaceRoot,
  writeJob,
  writeJsonAtomic,
  writeStateIndex
} from "./chunk-P7QODZNJ.mjs";

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

// plugins/cursor/scripts/lib/cursor-agent.mts
import {
  Agent,
  ConfigurationError,
  Cursor
} from "@cursor/sdk";

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
import path from "node:path";
var USER_CONFIG_ENV_MODEL = "CURSOR_MODEL";
function getUserConfigPath(opts = {}) {
  return path.join(resolveStateRoot(opts), "config.json");
}
function readUserConfig(opts = {}) {
  const data = readJson(getUserConfigPath(opts));
  if (!data || typeof data !== "object") return { version: 1 };
  const out = { version: 1 };
  if (data.defaultModel && typeof data.defaultModel === "object" && data.defaultModel.id) {
    out.defaultModel = data.defaultModel;
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
  const envId = process.env[USER_CONFIG_ENV_MODEL]?.trim();
  if (envId) return { model: { id: envId }, source: "env" };
  const cfg = readUserConfig(opts);
  if (cfg.defaultModel) return { model: cfg.defaultModel, source: "config" };
  return { model: fallback, source: "fallback" };
}

// plugins/cursor/scripts/lib/cursor-agent.mts
var DEFAULT_MODEL = { id: "composer-2" };
function resolveApiKey(apiKey) {
  const resolved = apiKey ?? process.env.CURSOR_API_KEY;
  if (!resolved || resolved.trim() === "") {
    throw new ConfigurationError(
      "CURSOR_API_KEY is not set. Export your Cursor API key or pass apiKey explicitly."
    );
  }
  return resolved;
}
var DEFAULT_AGENT_INSTRUCTIONS = [
  "You are a coding agent invoked by Claude Code via the cursor-plugin-cc plugin.",
  "Operate in the configured workspace.",
  "Make focused, well-scoped changes; preserve unrelated user work.",
  "Before changing files, understand the surrounding code.",
  "Keep progress updates concise and summarize the result clearly at the end."
].join("\n");
function buildAgentOptionsFromFlags(workspaceRoot, flags) {
  const opts = { cwd: workspaceRoot };
  if (flags.model) opts.model = flags.model;
  if (flags.cloud) {
    opts.mode = "cloud";
    opts.cloudRepo = detectCloudRepository(workspaceRoot);
  }
  return opts;
}
function buildAgentOptions(opts) {
  const apiKey = resolveApiKey(opts.apiKey);
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
  return Agent.create(buildAgentOptions(opts));
}
async function resumeAgent(agentId, opts) {
  return Agent.resume(agentId, buildAgentOptions(opts));
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
  const apiKey = resolveApiKey(opts.apiKey);
  return withRetry(() => Cursor.me({ apiKey }), opts.retry);
}
async function listModels(opts = {}) {
  const apiKey = resolveApiKey(opts.apiKey);
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

// plugins/cursor/scripts/lib/prompts.mts
import { readFileSync } from "node:fs";
import { join } from "node:path";
var PROMPTS_DIR = join(import.meta.dirname, "..", "..", "prompts");
function loadPromptTemplate(name) {
  const promptPath = join(PROMPTS_DIR, `${name}.md`);
  return readFileSync(promptPath, "utf8");
}
function interpolateTemplate(template, variables) {
  return template.replace(
    /\{\{([A-Z_]+)\}\}/g,
    (_, key) => Object.prototype.hasOwnProperty.call(variables, key) ? variables[key] ?? "" : ""
  );
}

// plugins/cursor/scripts/lib/redact.mts
var PLACEHOLDER = "[REDACTED]";
var MIN_KEY_LENGTH = 8;
function redactSecret(text, secret) {
  if (!secret || secret.length < MIN_KEY_LENGTH) return text;
  return text.split(secret).join(PLACEHOLDER);
}
function redactApiKey(text) {
  return redactSecret(text, process.env.CURSOR_API_KEY);
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

// plugins/cursor/scripts/lib/render.mts
function compactText(text) {
  return text.replace(/\s+/g, " ").trim();
}
var TOOL_SUMMARY_KEYS = {
  read: [["path", "filePath", "target_file", "absolutePath"], ["offset"], ["limit"]],
  glob: [
    ["pattern", "glob", "glob_pattern"],
    ["path", "cwd", "target_directory"]
  ],
  grep: [["pattern", "query"], ["path"], ["glob"], ["type"]],
  search: [["pattern", "query"], ["path"], ["glob"], ["type"]],
  shell: [
    ["command", "cmd"],
    ["cwd", "working_directory"]
  ],
  terminal: [
    ["command", "cmd"],
    ["cwd", "working_directory"]
  ],
  command: [
    ["command", "cmd"],
    ["cwd", "working_directory"]
  ],
  edit: [["path", "target_file", "file"], ["instruction"]],
  write: [["path", "target_file", "file"], ["instruction"]],
  patch: [["path", "target_file", "file"], ["instruction"]]
};
var TOOL_SUMMARY_FALLBACK = [
  ["path", "file", "target_file"],
  ["pattern", "query", "command"]
];
function getToolSummaryKeys(toolName) {
  const lower = toolName.toLowerCase();
  for (const [needle, keys] of Object.entries(TOOL_SUMMARY_KEYS)) {
    if (lower.includes(needle)) return keys;
  }
  return TOOL_SUMMARY_FALLBACK;
}
function shortenValue(value, maxLength = 80) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}
function formatArgValue(value) {
  if (typeof value === "string") return shortenValue(value.replace(/\s+/g, " ").trim());
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const items = value.slice(0, 3).map(formatArgValue).filter(Boolean);
    return items.length > 0 ? `[${items.join(",")}]` : void 0;
  }
  return void 0;
}
function summarizeToolArgs(toolName, args) {
  if (!args || typeof args !== "object") return void 0;
  const record = args;
  const groups = getToolSummaryKeys(toolName);
  const parts = [];
  for (const keys of groups) {
    for (const key of keys) {
      const value = record[key];
      const formatted = formatArgValue(value);
      if (formatted) {
        parts.push(`${key}=${formatted}`);
        break;
      }
    }
  }
  return parts.length > 0 ? parts.join(" ") : void 0;
}
function renderStreamEvent(event, options = {}) {
  switch (event.type) {
    case "assistant_text":
      return { stdout: event.text };
    case "thinking": {
      if (options.quietThinking) return {};
      const t = compactText(event.text);
      return t ? { stderr: `[thinking] ${t}
` } : {};
    }
    case "tool": {
      const summary = summarizeToolArgs(event.name, event.args);
      const tail = summary ? ` ${summary}` : "";
      return { stderr: `[tool] ${event.status} ${event.name}${tail}
` };
    }
    case "status": {
      if (options.quietStatus && event.status === "finished") return {};
      const msg = event.message ? ` ${compactText(event.message)}` : "";
      return { stderr: `[status] ${event.status}${msg}
` };
    }
    case "task": {
      const head = [event.status, event.text].filter((s) => Boolean(s));
      if (head.length === 0) return {};
      return { stderr: `[task] ${compactText(head.join(" "))}
` };
    }
    case "system":
      return {};
  }
}
var TABLE_HEADERS = ["id", "type", "status", "age", "summary"];
function rowsFromJobs(jobs, now) {
  return jobs.map((job) => {
    const created = Date.parse(job.createdAt);
    const ageMs = Number.isFinite(created) ? now - created : 0;
    return {
      id: job.id,
      type: job.type,
      status: job.status,
      age: formatAge(ageMs),
      summary: job.summary ? compactText(job.summary).slice(0, 60) : ""
    };
  });
}
function formatAge(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "?";
  const sec = Math.floor(ms / 1e3);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}
function ageFromIso(iso, now = Date.now()) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? formatAge(now - t) : "?";
}
function renderJobTable(jobs, now = Date.now()) {
  if (jobs.length === 0) return "(no jobs)\n";
  const rows = rowsFromJobs(jobs, now);
  const widths = {
    id: "id".length,
    type: "type".length,
    status: "status".length,
    age: "age".length,
    summary: "summary".length
  };
  for (const r of rows) {
    for (const key of TABLE_HEADERS) {
      widths[key] = Math.max(widths[key], r[key].length);
    }
  }
  const header = TABLE_HEADERS.map((k) => k.toUpperCase().padEnd(widths[k])).join("  ");
  const separator = TABLE_HEADERS.map((k) => "-".repeat(widths[k])).join("  ");
  const body = rows.map((r) => TABLE_HEADERS.map((k) => r[k].padEnd(widths[k])).join("  ")).join("\n");
  return `${header}
${separator}
${body}
`;
}
var SEVERITY_ORDER = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3
};
function renderReviewResult(review) {
  const lines = [];
  lines.push(`verdict: ${review.verdict}`);
  if (review.summary) lines.push("", review.summary);
  const findings = [...review.findings].sort((a, b) => {
    const sev = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sev !== 0) return sev;
    return a.file.localeCompare(b.file);
  });
  if (findings.length === 0) {
    lines.push("", "findings: (none)");
  } else {
    lines.push("", `findings: ${findings.length}`);
    for (const f of findings) {
      const loc = f.line_start === f.line_end ? `${f.file}:${f.line_start}` : `${f.file}:${f.line_start}-${f.line_end}`;
      const conf = Number.isFinite(f.confidence) ? `(confidence ${f.confidence.toFixed(2)})` : "";
      lines.push("", `[${f.severity.toUpperCase()}] ${f.title} \u2014 ${loc} ${conf}`.trim(), f.body);
      if (f.recommendation) {
        lines.push(`  \u2192 ${f.recommendation}`);
      }
    }
  }
  if (review.next_steps.length > 0) {
    lines.push("", "next steps:");
    for (const step of review.next_steps) {
      lines.push(`  - ${step}`);
    }
  }
  return `${lines.join("\n")}
`;
}
function renderError(error) {
  return `error: ${redactError(error)}
`;
}

// plugins/cursor/scripts/lib/job-control.mts
import crypto from "node:crypto";
var JOB_ID_BYTES = 6;
function newJobId(type) {
  const prefix = type === "adversarial-review" ? "adv" : type;
  return `${prefix}-${crypto.randomBytes(JOB_ID_BYTES).toString("hex")}`;
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
  const summary = record.metadata && typeof record.metadata.summary === "string" ? record.metadata.summary : summarize(record.prompt);
  if (summary) entry.summary = summary;
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
    const updated2 = markCancelled(stateDir, jobId, "run-not-active");
    return { cancelled: true, reason: "run-not-active", job: updated2 };
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

// plugins/cursor/scripts/commands/review.mts
var HELP = `cursor-companion review [flags]
cursor-companion adversarial-review [flags] [focus text...]

Review a git diff. Returns a structured ReviewOutput JSON: verdict, summary,
findings[], next_steps[]. Adversarial-review additionally accepts free-form
focus text as positional arguments \u2014 those are passed to the reviewer as the
priority axis.

flags:
  --staged             Review staged changes only (git diff --cached)
  --scope <auto|working-tree|branch>
                       Review scope. 'auto' (default) picks working-tree when
                       the tree is dirty, otherwise branch-vs-default-branch.
                       Mutually exclusive with --staged.
  --base <ref>         Diff against this ref. Implies branch scope.
  --model <id>         Override the default model
  --timeout <ms>       Cancel the review if it exceeds this duration
  --json               Print the raw structured review JSON
  --help, -h
`;
var VALID_SCOPES = /* @__PURE__ */ new Set(["auto", "working-tree", "branch"]);
var SCHEMA = `{
  "verdict": "approve" | "needs-attention",
  "summary": string,
  "findings": [{
    "severity": "critical" | "high" | "medium" | "low",
    "title": string,
    "body": string,
    "file": string,
    "line_start": number,
    "line_end": number,
    "confidence": number,
    "recommendation": string
  }],
  "next_steps": string[]
}`;
var HelpRequested = class extends Error {
};
function parseFlags(args) {
  const parsed = parseArgs(args, {
    long: {
      staged: "boolean",
      scope: "string",
      base: "string",
      model: "string",
      timeout: "string",
      json: "boolean",
      help: "boolean"
    },
    short: { h: "help", m: "model" }
  });
  if (bool(parsed, "help")) throw new HelpRequested();
  const staged = bool(parsed, "staged");
  const scopeRaw = optionalString(parsed, "scope");
  if (scopeRaw && !VALID_SCOPES.has(scopeRaw)) {
    throw new UsageError(
      `invalid --scope: ${scopeRaw} (expected one of ${[...VALID_SCOPES].join(", ")})`
    );
  }
  if (staged && scopeRaw && scopeRaw !== "working-tree") {
    throw new UsageError("--staged is only compatible with --scope working-tree");
  }
  const flags = {
    staged,
    scope: scopeRaw ?? "auto",
    json: bool(parsed, "json"),
    focus: parsed.positionals.join(" ").trim()
  };
  const base = optionalString(parsed, "base");
  if (base) flags.baseRef = base;
  const modelId = optionalString(parsed, "model");
  if (modelId) flags.model = { id: modelId };
  const timeout = optionalString(parsed, "timeout");
  if (timeout) {
    const ms = Number(timeout);
    if (!Number.isFinite(ms) || ms <= 0) throw new UsageError(`invalid --timeout: ${timeout}`);
    flags.timeoutMs = ms;
  }
  return flags;
}
function buildReviewPrompt(opts) {
  const templateName = opts.adversarial ? "adversarial-review" : "review";
  const focusSection = opts.focus ? `Reviewer focus (priority axis): ${opts.focus}` : "";
  return interpolateTemplate(loadPromptTemplate(templateName), {
    TARGET_LABEL: opts.targetLabel,
    FOCUS_SECTION: focusSection,
    SCHEMA,
    STATUS: opts.status || "(clean)",
    DIFF: opts.diff
  });
}
function extractJson(raw) {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenced) return fenced[1] ?? trimmed;
  return trimmed;
}
function parseReview(raw) {
  const text = extractJson(raw);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `review output was not valid JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!parsed || typeof parsed !== "object") throw new Error("review output is not an object");
  const obj = parsed;
  if (obj.verdict !== "approve" && obj.verdict !== "needs-attention") {
    throw new Error(`review verdict is invalid: ${JSON.stringify(obj.verdict)}`);
  }
  if (typeof obj.summary !== "string") throw new Error("review summary missing");
  if (!Array.isArray(obj.findings)) throw new Error("review findings must be an array");
  if (!Array.isArray(obj.next_steps)) throw new Error("review next_steps must be an array");
  return parsed;
}
async function runReview(args, io, options) {
  let flags;
  try {
    flags = parseFlags(args);
  } catch (err) {
    if (err instanceof HelpRequested) {
      io.stdout.write(HELP);
      return 0;
    }
    throw err;
  }
  if (flags.focus && !options.adversarial) {
    throw new UsageError(
      "free-form focus text is only accepted for adversarial-review (got positional args)"
    );
  }
  const cwd = io.cwd();
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const stateDir = ensureStateDir(resolveStateDir(workspaceRoot));
  const diffOpts = {};
  let targetLabel;
  if (flags.staged) {
    diffOpts.staged = true;
    targetLabel = "staged diff";
  } else {
    const target = resolveReviewTarget(workspaceRoot, {
      scope: flags.scope,
      ...flags.baseRef ? { baseRef: flags.baseRef } : {}
    });
    if (target.baseRef) diffOpts.baseRef = target.baseRef;
    targetLabel = target.label;
  }
  const diff = getDiff(workspaceRoot, diffOpts);
  if (!diff) {
    io.stderr.write("nothing to review (empty diff)\n");
    return 0;
  }
  const prompt = buildReviewPrompt({
    diff,
    status: getStatus(workspaceRoot),
    targetLabel,
    focus: flags.focus,
    adversarial: Boolean(options.adversarial)
  });
  const job = createJob(stateDir, {
    type: options.adversarial ? "adversarial-review" : "review",
    prompt: `${options.adversarial ? "adversarial-" : ""}review (${targetLabel})`
  });
  const oneShotOpts = {
    cwd: workspaceRoot,
    onRunStart: (run) => {
      markRunning(stateDir, job.id, { agentId: run.agentId, runId: run.id });
    }
  };
  if (flags.model) oneShotOpts.model = flags.model;
  if (flags.timeoutMs) oneShotOpts.timeoutMs = flags.timeoutMs;
  let result;
  try {
    result = await oneShot(prompt, oneShotOpts);
  } catch (err) {
    markFailed(stateDir, job.id, err instanceof Error ? err.message : String(err));
    throw err;
  }
  markFinished(stateDir, job.id, result);
  if (result.status !== "finished") {
    io.stderr.write(`review run did not finish: ${result.status}
`);
    return 1;
  }
  let review;
  try {
    review = parseReview(result.output);
  } catch (err) {
    io.stderr.write(
      `failed to parse review output: ${err instanceof Error ? err.message : String(err)}
`
    );
    io.stderr.write("raw output:\n");
    io.stderr.write(result.output);
    if (!result.output.endsWith("\n")) io.stderr.write("\n");
    return 1;
  }
  if (flags.json) {
    io.stdout.write(`${JSON.stringify(review, null, 2)}
`);
  } else {
    io.stdout.write(renderReviewResult(review));
  }
  return review.verdict === "approve" ? 0 : 1;
}

// plugins/cursor/scripts/lib/gate.mts
import path2 from "node:path";
var DEFAULT_GATE_CONFIG = { version: 1, enabled: false };
var DEFAULT_GATE_TIMEOUT_MS = 6e5;
function getGatePath(stateDir) {
  return path2.join(stateDir, "gate.json");
}
function readGateConfig(stateDir) {
  const cfg = readJson(getGatePath(stateDir));
  if (!cfg || typeof cfg !== "object") return { ...DEFAULT_GATE_CONFIG };
  return {
    version: 1,
    enabled: cfg.enabled === true,
    ...cfg.model ? { model: cfg.model } : {},
    ...typeof cfg.timeoutMs === "number" && cfg.timeoutMs > 0 ? { timeoutMs: cfg.timeoutMs } : {}
  };
}
function writeGateConfig(stateDir, config) {
  writeJsonAtomic(getGatePath(stateDir), { ...config, version: 1 });
}
function setGateEnabled(stateDir, enabled) {
  const current = readGateConfig(stateDir);
  const next = { ...current, version: 1, enabled };
  writeGateConfig(stateDir, next);
  return next;
}

export {
  UsageError,
  parseArgs,
  optionalString,
  bool,
  getDiff,
  getStatus,
  getRecentCommits,
  getBranch,
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
  createJob,
  getJob,
  listJobs,
  findRecentTaskAgents,
  markRunning,
  markFinished,
  markFailed,
  registerActiveRun,
  unregisterActiveRun,
  cancelJob,
  logJobLine,
  loadPromptTemplate,
  interpolateTemplate,
  compactText,
  renderStreamEvent,
  ageFromIso,
  renderJobTable,
  renderReviewResult,
  renderError,
  parseReview,
  runReview,
  DEFAULT_GATE_TIMEOUT_MS,
  readGateConfig,
  setGateEnabled
};
