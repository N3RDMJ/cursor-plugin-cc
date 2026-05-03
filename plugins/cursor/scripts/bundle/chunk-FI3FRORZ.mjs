import {
  TERMINAL_STATUSES,
  UsageError,
  bool,
  createJob,
  ensureStateDir,
  getDiff,
  getStatus,
  markFailed,
  markFinished,
  markRunning,
  oneShot,
  optionalModelArg,
  optionalString,
  parseArgs,
  readJson,
  redactError,
  resolveReviewTarget,
  resolveStateDir,
  resolveWorkspaceRoot,
  writeJsonAtomic
} from "./chunk-MTISK4JK.mjs";

// plugins/cursor/scripts/lib/render.mts
function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "0ms";
  if (ms < 1e3) return `${Math.round(ms)}ms`;
  return `${(ms / 1e3).toFixed(1)}s`;
}
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
var TABLE_HEADERS = [
  { key: "id", label: "ID" },
  { key: "type", label: "Type" },
  { key: "status", label: "Status" },
  { key: "phase", label: "Phase" },
  { key: "time", label: "Elapsed/Duration" },
  { key: "summary", label: "Summary" },
  { key: "actions", label: "Actions" }
];
function formatJobTime(entry, now) {
  if (TERMINAL_STATUSES.has(entry.status)) {
    const start = entry.startedAt ? Date.parse(entry.startedAt) : Number.NaN;
    const finish = entry.finishedAt ? Date.parse(entry.finishedAt) : Number.NaN;
    if (Number.isFinite(start) && Number.isFinite(finish) && finish >= start) {
      return `duration: ${formatAge(finish - start)}`;
    }
    const created2 = Date.parse(entry.createdAt);
    const updated = Date.parse(entry.updatedAt);
    if (Number.isFinite(created2) && Number.isFinite(updated) && updated >= created2) {
      return `duration: ${formatAge(updated - created2)}`;
    }
    return "duration: ?";
  }
  if (entry.status === "running" && entry.startedAt) {
    const start = Date.parse(entry.startedAt);
    if (Number.isFinite(start)) {
      return `elapsed: ${formatAge(now - start)}`;
    }
  }
  const created = Date.parse(entry.createdAt);
  const ageMs = Number.isFinite(created) ? now - created : 0;
  return `age: ${formatAge(ageMs)}`;
}
function formatJobActions(entry) {
  if (TERMINAL_STATUSES.has(entry.status)) {
    return `/cursor:result ${entry.id}`;
  }
  return `/cursor:status ${entry.id} \u2022 /cursor:cancel ${entry.id}`;
}
function rowsFromJobs(jobs, now) {
  return jobs.map((job) => ({
    id: job.id,
    type: job.type,
    status: job.status,
    phase: job.phase ? compactText(job.phase).slice(0, 40) : "",
    time: formatJobTime(job, now),
    summary: job.summary ? compactText(job.summary).slice(0, 60) : "",
    actions: formatJobActions(job)
  }));
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
function escapeMarkdownCell(value) {
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}
function fenceCodeBlock(content) {
  const longestRun = (content.match(/`+/g) ?? []).reduce((max, m) => Math.max(max, m.length), 0);
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return [fence, content, fence];
}
function renderJobTable(jobs, now = Date.now()) {
  if (jobs.length === 0) return "_(no jobs)_\n";
  const rows = rowsFromJobs(jobs, now);
  const header = `| ${TABLE_HEADERS.map((h) => h.label).join(" | ")} |`;
  const separator = `| ${TABLE_HEADERS.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${TABLE_HEADERS.map((h) => escapeMarkdownCell(r[h.key] ?? "")).join(" | ")} |`).join("\n");
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
  lines.push(`**Verdict:** \`${review.verdict}\``);
  if (review.summary) lines.push("", review.summary);
  const findings = [...review.findings].sort((a, b) => {
    const sev = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sev !== 0) return sev;
    return a.file.localeCompare(b.file);
  });
  if (findings.length === 0) {
    lines.push("", "**Findings:** _(none)_");
  } else {
    lines.push("", `**Findings:** ${findings.length}`);
    for (const f of findings) {
      const loc = f.line_start === f.line_end ? `\`${f.file}:${f.line_start}\`` : `\`${f.file}:${f.line_start}-${f.line_end}\``;
      const conf = Number.isFinite(f.confidence) ? ` _(confidence ${f.confidence.toFixed(2)})_` : "";
      lines.push(
        "",
        `### [${f.severity.toUpperCase()}] ${f.title} \u2014 ${loc}${conf}`.trim(),
        "",
        f.body
      );
      if (f.recommendation) {
        lines.push("", `**Recommendation:** ${f.recommendation}`);
      }
    }
  }
  if (review.next_steps.length > 0) {
    lines.push("", "**Next steps:**");
    for (const step of review.next_steps) {
      lines.push(`- ${step}`);
    }
  }
  return `${lines.join("\n")}
`;
}
function jobAgentHandoffLines(agentId) {
  if (!agentId) return [];
  return [
    `- Continue from Claude Code: \`/cursor:resume ${agentId}\``,
    `- Continue from the Cursor CLI: \`cursor-agent resume ${agentId}\``
  ];
}
function renderTaskResultCard(job) {
  const lines = [];
  lines.push(`**Job:** \`${job.id}\` _(type: ${job.type})_`);
  const statusBits = [`\`${job.status}\``];
  if (typeof job.durationMs === "number") {
    statusBits.push(`duration: ${formatDuration(job.durationMs)}`);
  } else if (job.startedAt && job.finishedAt) {
    const start = Date.parse(job.startedAt);
    const finish = Date.parse(job.finishedAt);
    if (Number.isFinite(start) && Number.isFinite(finish) && finish >= start) {
      statusBits.push(`duration: ${formatDuration(finish - start)}`);
    }
  }
  lines.push(`**Status:** ${statusBits.join(" \u2014 ")}`);
  if (job.agentId) lines.push(`**Agent:** \`${job.agentId}\``);
  if (job.runId) lines.push(`**Run:** \`${job.runId}\``);
  const meta = job.metadata;
  if (meta) {
    if (meta.timedOut === true) {
      lines.push("**Note:** run exceeded its timeout and was cancelled by the plugin.");
    }
    if (meta.expired === true) {
      lines.push("**Note:** SDK reported the run as expired (wedged local agent).");
    }
    if (typeof meta.cancelReason === "string" && meta.cancelReason) {
      lines.push(`**Cancel reason:** \`${meta.cancelReason}\``);
    }
  }
  const body = job.result ?? "";
  lines.push("", "**Output:**", "", ...fenceCodeBlock(body));
  if (job.error) {
    lines.push("", "**Error:**", "", ...fenceCodeBlock(job.error));
  }
  const handoff = jobAgentHandoffLines(job.agentId);
  if (handoff.length > 0) {
    lines.push("", "**Next steps:**", ...handoff);
  } else {
    lines.push(
      "",
      "**Next steps:**",
      "- No agent id was recorded for this job \u2014 start a new run with `/cursor:task`."
    );
  }
  return `${lines.join("\n")}
`;
}
function renderError(error) {
  return `error: ${redactError(error)}
`;
}

// plugins/cursor/scripts/lib/prompts.mts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
var PROMPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "prompts");
function loadPromptTemplate(name) {
  const promptPath = join(PROMPTS_DIR, `${name}.md`);
  return readFileSync(promptPath, "utf8");
}
function interpolateTemplate(template, variables) {
  return template.replace(
    /\{\{([A-Z_]+)\}\}/g,
    (_, key) => Object.hasOwn(variables, key) ? variables[key] ?? "" : ""
  );
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
  --model <id[:k=v,...]>
                       Override the default model. Append \`:key=value\`
                       pairs to set variant params, e.g.
                       --model gpt-5:reasoning_effort=low
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
  flags.model = optionalModelArg(parsed, "model");
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
import path from "node:path";
var DEFAULT_GATE_CONFIG = { version: 1, enabled: false };
var DEFAULT_GATE_TIMEOUT_MS = 6e5;
function getGatePath(stateDir) {
  return path.join(stateDir, "gate.json");
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
  compactText,
  renderStreamEvent,
  formatJobActions,
  ageFromIso,
  escapeMarkdownCell,
  fenceCodeBlock,
  renderJobTable,
  renderReviewResult,
  jobAgentHandoffLines,
  renderTaskResultCard,
  renderError,
  loadPromptTemplate,
  interpolateTemplate,
  parseReview,
  runReview,
  DEFAULT_GATE_TIMEOUT_MS,
  readGateConfig,
  setGateEnabled
};
