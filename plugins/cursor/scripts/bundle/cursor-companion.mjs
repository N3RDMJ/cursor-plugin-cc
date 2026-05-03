import {
  ageFromIso,
  compactText,
  escapeMarkdownCell,
  fenceCodeBlock,
  formatJobActions,
  interpolateTemplate,
  jobAgentHandoffLines,
  loadPromptTemplate,
  readGateConfig,
  renderError,
  renderJobTable,
  renderStreamEvent,
  renderTaskResultCard,
  runReview,
  setGateEnabled
} from "./chunk-GFSYWFX6.mjs";
import {
  DEFAULT_MODEL,
  RUN_NOT_ACTIVE_REASON,
  TERMINAL_STATUSES,
  UsageError,
  bool,
  buildAgentOptionsFromFlags,
  cancelJob,
  clearDefaultModel,
  createAgent,
  createJob,
  deleteApiKey,
  detectBackend,
  disposeAgent,
  ensureStateDir,
  findRecentTaskAgents,
  formatModelSelection,
  getBranch,
  getJob,
  getRecentCommits,
  getSourceTree,
  listJobs,
  listModels,
  listRemoteAgents,
  logJobLine,
  markFailed,
  markFinished,
  markPhase,
  markRunning,
  optionalModelArg,
  optionalString,
  parseArgs,
  parseModelArg,
  readJobLog,
  readJson,
  reconcileStaleJobs,
  registerActiveRun,
  resolveApiKey,
  resolveDefaultModel,
  resolveStateDir,
  resolveWorkspaceRoot,
  resumeAgent,
  sendTask,
  setDefaultModel,
  storeApiKey,
  tailJobLog,
  toAgentEvents,
  unregisterActiveRun,
  validateModel,
  whoami,
  writeJsonAtomic
} from "./chunk-5GJCFYFO.mjs";

// plugins/cursor/scripts/commands/cancel.mts
var HELP = `cursor-companion cancel <job-id> [--json] [--help]

Cancel an active job. If the run was started in this CLI process, calls
run.cancel() (capability-checked) and the job stops cleanly.

LIMITATION: when the job was started in a different CLI process (e.g. via
\`/cursor:task --background\` from a previous Claude Code turn), the in-memory
Run object is not reachable and we cannot signal the SDK to stop. The job
record is marked cancelled with reason="${RUN_NOT_ACTIVE_REASON}" but the
underlying SDK run may keep going to completion. Track that run via
\`/cursor:resume <agent-id>\` if you need to stop it.
`;
function runNotActiveHint(agentId) {
  const resumeTarget = agentId ?? "<agent-id>";
  return [
    "warning: this CLI process did not own the in-memory Run object, so the",
    "underlying SDK run was NOT signalled. The job record is marked cancelled",
    "but the Cursor agent may keep working until it finishes on its own.",
    `Use \`/cursor:resume ${resumeTarget}\` to reattach and observe / send a stop prompt.`
  ].join("\n");
}
async function runCancel(args, io) {
  const parsed = parseArgs(args, {
    long: { json: "boolean", help: "boolean" },
    short: { h: "help" }
  });
  if (bool(parsed, "help")) {
    io.stdout.write(HELP);
    return 0;
  }
  const jobId = parsed.positionals[0];
  if (!jobId) throw new UsageError("cancel requires a job id");
  const cwd = io.cwd();
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const stateDir = resolveStateDir(workspaceRoot);
  const result = await cancelJob(stateDir, jobId);
  const splitBrain = result.cancelled && result.reason === RUN_NOT_ACTIVE_REASON;
  if (bool(parsed, "json")) {
    const payload = { ...result, splitBrain };
    io.stdout.write(`${JSON.stringify(payload, null, 2)}
`);
    return result.cancelled ? 0 : 1;
  }
  if (result.cancelled) {
    io.stdout.write(`cancelled: ${jobId}${result.reason ? ` (${result.reason})` : ""}
`);
    if (splitBrain) {
      io.stderr.write(`${runNotActiveHint(result.job?.agentId)}
`);
    }
    return 0;
  }
  io.stderr.write(`could not cancel ${jobId}: ${result.reason ?? "unknown"}
`);
  return 1;
}

// plugins/cursor/scripts/commands/result.mts
var HELP2 = `cursor-companion result [<job-id>] [--raw] [--log] [--json] [--help]

Print a completed job's result text. Without a job id, defaults to the most
recent terminal job for the current workspace.

By default tasks render as a Markdown card (status, duration, agent id, fenced
output, and resume hints) so the result is self-describing. Pass --raw to get
the unwrapped output text on stdout \u2014 useful for piping into other tools.
Reviews always render through the structured review formatter and ignore --raw.

flags:
  --raw   Emit just the result text on stdout (no card, no header)
  --log   Print the streaming log captured while the run was alive
  --json  Emit the full JobRecord
  --help, -h
`;
async function runResult(args, io) {
  const parsed = parseArgs(args, {
    long: { raw: "boolean", log: "boolean", json: "boolean", help: "boolean" },
    short: { h: "help" }
  });
  if (bool(parsed, "help")) {
    io.stdout.write(HELP2);
    return 0;
  }
  const cwd = io.cwd();
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const stateDir = resolveStateDir(workspaceRoot);
  let jobId = parsed.positionals[0];
  if (!jobId) {
    const recent = listJobs(stateDir).find((j) => TERMINAL_STATUSES.has(j.status));
    if (!recent) {
      io.stderr.write("no terminal jobs in this workspace yet \u2014 pass a job id\n");
      return 1;
    }
    jobId = recent.id;
  }
  const job = getJob(stateDir, jobId);
  if (!job) {
    io.stderr.write(`job not found: ${jobId}
`);
    return 1;
  }
  if (bool(parsed, "json")) {
    io.stdout.write(`${JSON.stringify(job, null, 2)}
`);
    return 0;
  }
  if (bool(parsed, "log")) {
    const log = readJobLog(stateDir, jobId);
    if (!log) {
      io.stderr.write(`no log for job ${jobId}
`);
      return 1;
    }
    io.stdout.write(log);
    if (!log.endsWith("\n")) io.stdout.write("\n");
    return 0;
  }
  if (!job.result) {
    if (job.error) io.stderr.write(`job failed: ${job.error}
`);
    else io.stderr.write(`no result for job ${jobId} (status: ${job.status})
`);
    return 1;
  }
  if (bool(parsed, "raw")) {
    io.stdout.write(job.result);
    if (!job.result.endsWith("\n")) io.stdout.write("\n");
    const handoff = jobAgentHandoffLines(job.agentId);
    if (handoff.length > 0) {
      io.stderr.write(`
Continue this Cursor agent:
${handoff.join("\n")}
`);
    }
    return 0;
  }
  if (job.type === "review" || job.type === "adversarial-review") {
    io.stdout.write(job.result);
    if (!job.result.endsWith("\n")) io.stdout.write("\n");
    return 0;
  }
  io.stdout.write(renderTaskResultCard(job));
  return 0;
}

// plugins/cursor/scripts/lib/run-agent-task.mts
function phaseFromEvent(event) {
  if (event.type !== "task") return void 0;
  const candidate = event.text ?? event.status;
  return candidate && candidate.trim() !== "" ? candidate : void 0;
}
async function runAgentTaskForeground(opts) {
  const { agent, prompt, flags, io, stateDir, jobId } = opts;
  try {
    const result = await sendTask(agent, prompt, {
      ...flags.timeoutMs !== void 0 ? { timeoutMs: flags.timeoutMs } : {},
      ...flags.force ? { force: true } : {},
      onRunStart: (run) => {
        markRunning(stateDir, jobId, { agentId: run.agentId, runId: run.id });
        registerActiveRun(jobId, run);
      },
      onEvent: (event) => {
        for (const ae of toAgentEvents(event)) {
          const phase = phaseFromEvent(ae);
          if (phase) markPhase(stateDir, jobId, phase);
          const rendered = renderStreamEvent(ae, { quietStatus: true, quietThinking: true });
          if (rendered.stdout) io.stdout.write(rendered.stdout);
          if (rendered.stderr) {
            io.stderr.write(rendered.stderr);
            logJobLine(stateDir, jobId, rendered.stderr.replace(/\n$/, ""));
          }
        }
      }
    });
    markFinished(stateDir, jobId, result);
    if (flags.json) {
      io.stdout.write(`${JSON.stringify({ jobId, ...result })}
`);
    } else if (!result.output.endsWith("\n")) {
      io.stdout.write("\n");
    }
    return result.status === "finished" ? 0 : 1;
  } catch (err) {
    markFailed(stateDir, jobId, err instanceof Error ? err.message : String(err));
    throw err;
  } finally {
    unregisterActiveRun(jobId);
    await disposeAgent(agent).catch(() => void 0);
  }
}
function runAgentTaskBackground(opts) {
  const { agent, prompt, flags, stateDir, jobId } = opts;
  void (async () => {
    try {
      const result = await sendTask(agent, prompt, {
        ...flags.timeoutMs ? { timeoutMs: flags.timeoutMs } : {},
        ...flags.force ? { force: true } : {},
        onRunStart: (run) => {
          markRunning(stateDir, jobId, { agentId: run.agentId, runId: run.id });
          registerActiveRun(jobId, run);
        },
        onEvent: (event) => {
          for (const ae of toAgentEvents(event)) {
            const phase = phaseFromEvent(ae);
            if (phase) markPhase(stateDir, jobId, phase);
            const rendered = renderStreamEvent(ae);
            if (rendered.stdout) logJobLine(stateDir, jobId, rendered.stdout.replace(/\n$/, ""));
            if (rendered.stderr) logJobLine(stateDir, jobId, rendered.stderr.replace(/\n$/, ""));
          }
        }
      });
      markFinished(stateDir, jobId, result);
    } catch (err) {
      markFailed(stateDir, jobId, err instanceof Error ? err.message : String(err));
    } finally {
      unregisterActiveRun(jobId);
      await disposeAgent(agent).catch(() => void 0);
    }
  })();
}

// plugins/cursor/scripts/commands/resume.mts
var HELP3 = `cursor-companion resume <agent-id> <prompt> [flags]
cursor-companion resume --last <prompt> [flags]
cursor-companion resume --list [--local|--remote] [--limit <n>] [--json]

Reattach to an existing Cursor agent and continue the conversation. The agent
keeps its prior context, so follow-up prompts are cheaper than starting fresh.

flags:
  --last               Resume the most recent task agent (no agent-id needed)
  --list               Print known agent ids \u2014 merges this workspace's local
                       index with the SDK's durable agent list (local runtime).
                       Soft-fails on SDK errors with a footer note. Use
                       --local or --remote to scope to one source.
  --local              With --list: only show this workspace's job index
  --remote             With --list: only show the SDK's durable agents
                       (combine with --cloud to list cloud-runtime agents \u2014
                       requires CURSOR_API_KEY)
  --limit <n>          With --list: cap the number of rows per source (default 10)
  --write              Allow file modifications (default: read-only)
  --background         Start the run and exit, returning the job id
  --force              Expire any wedged active local run before sending
  --cloud              Use Cursor cloud against the detected GitHub origin
  --model <id[:k=v,...]>, -m
                       Override the default model. Append \`:key=value\`
                       pairs to set variant params, e.g.
                       --model gpt-5:reasoning_effort=low
  --timeout <ms>       Cancel the run if it exceeds this duration
  --json               Print the final result as JSON (single line)
  --help, -h
`;
var DEFAULT_LIST_LIMIT = 10;
var HelpRequested = class extends Error {
};
function parseFlags(args) {
  const parsed = parseArgs(args, {
    long: {
      last: "boolean",
      list: "boolean",
      local: "boolean",
      remote: "boolean",
      limit: "string",
      write: "boolean",
      background: "boolean",
      force: "boolean",
      cloud: "boolean",
      model: "string",
      timeout: "string",
      json: "boolean",
      help: "boolean"
    },
    short: { h: "help", m: "model" }
  });
  if (bool(parsed, "help")) throw new HelpRequested();
  const last = bool(parsed, "last");
  const list = bool(parsed, "list");
  const json = bool(parsed, "json");
  const local = bool(parsed, "local");
  const remote = bool(parsed, "remote");
  const cloud = bool(parsed, "cloud");
  if (list) {
    if (last) throw new UsageError("--list and --last are mutually exclusive");
    if (local && remote) throw new UsageError("--local and --remote are mutually exclusive");
    let limit = DEFAULT_LIST_LIMIT;
    const limitArg = optionalString(parsed, "limit");
    if (limitArg !== void 0) {
      const n = Number(limitArg);
      if (!Number.isFinite(n) || n < 0) throw new UsageError(`invalid --limit: ${limitArg}`);
      limit = Math.floor(n);
    }
    if (cloud && !remote) {
      throw new UsageError("--list --cloud requires --remote (cloud listing goes through the SDK)");
    }
    const source = local ? "local" : remote ? "remote" : "merged";
    return { kind: "list", limit, json, source, cloud };
  }
  if (remote) throw new UsageError("--remote requires --list");
  if (local) throw new UsageError("--local requires --list");
  if (optionalString(parsed, "limit") !== void 0) {
    throw new UsageError("--limit requires --list");
  }
  const positionals = [...parsed.positionals];
  let target;
  if (last) {
    target = { kind: "last" };
  } else {
    const agentId = positionals.shift();
    if (!agentId) {
      throw new UsageError(
        "resume requires <agent-id> (or --last to pick the most recent, or --list to discover ids)"
      );
    }
    target = { kind: "id", agentId };
  }
  const prompt = positionals.join(" ").trim();
  if (!prompt) throw new UsageError("resume requires a prompt to send to the agent");
  const flags = {
    kind: "run",
    prompt,
    target,
    write: bool(parsed, "write"),
    background: bool(parsed, "background"),
    force: bool(parsed, "force"),
    cloud,
    json
  };
  const model = optionalModelArg(parsed, "model");
  if (model) flags.model = model;
  const timeout = optionalString(parsed, "timeout");
  if (timeout) {
    const ms = Number(timeout);
    if (!Number.isFinite(ms) || ms <= 0) throw new UsageError(`invalid --timeout: ${timeout}`);
    flags.timeoutMs = ms;
  }
  return flags;
}
function renderListText(rows, now = Date.now()) {
  if (rows.length === 0) return "(no resumable agents)\n";
  const formatted = rows.map((r) => ({
    agentId: r.agentId,
    jobId: r.jobId,
    age: ageFromIso(r.createdAt, now),
    summary: r.summary ? compactText(r.summary).slice(0, 60) : ""
  }));
  const widths = {
    agentId: Math.max("agent-id".length, ...formatted.map((r) => r.agentId.length)),
    jobId: Math.max("job-id".length, ...formatted.map((r) => r.jobId.length)),
    age: Math.max("age".length, ...formatted.map((r) => r.age.length))
  };
  const header = `${"AGENT-ID".padEnd(widths.agentId)}  ${"JOB-ID".padEnd(widths.jobId)}  ${"AGE".padEnd(widths.age)}  SUMMARY`;
  const separator = `${"-".repeat(widths.agentId)}  ${"-".repeat(widths.jobId)}  ${"-".repeat(widths.age)}  -------`;
  const body = formatted.map(
    (r) => `${r.agentId.padEnd(widths.agentId)}  ${r.jobId.padEnd(widths.jobId)}  ${r.age.padEnd(widths.age)}  ${r.summary}`.trimEnd()
  ).join("\n");
  return `${header}
${separator}
${body}
`;
}
function renderRemoteListText(rows, now = Date.now()) {
  if (rows.length === 0) return "(no durable agents reported by the SDK)\n";
  const formatted = rows.map((r) => ({
    agentId: r.agentId,
    age: ageFromIso(new Date(r.lastModified).toISOString(), now),
    status: r.status ?? "\u2014",
    summary: r.summary ? compactText(r.summary).slice(0, 60) : compactText(r.name).slice(0, 60)
  }));
  const widths = {
    agentId: Math.max("agent-id".length, ...formatted.map((r) => r.agentId.length)),
    age: Math.max("age".length, ...formatted.map((r) => r.age.length)),
    status: Math.max("status".length, ...formatted.map((r) => r.status.length))
  };
  const header = `${"AGENT-ID".padEnd(widths.agentId)}  ${"AGE".padEnd(widths.age)}  ${"STATUS".padEnd(widths.status)}  SUMMARY`;
  const separator = `${"-".repeat(widths.agentId)}  ${"-".repeat(widths.age)}  ${"-".repeat(widths.status)}  -------`;
  const body = formatted.map(
    (r) => `${r.agentId.padEnd(widths.agentId)}  ${r.age.padEnd(widths.age)}  ${r.status.padEnd(widths.status)}  ${r.summary}`.trimEnd()
  ).join("\n");
  return `${header}
${separator}
${body}
`;
}
async function runList(flags, workspaceRoot, io) {
  if (flags.source === "remote") {
    const rows = await listRemoteAgents(
      flags.cloud ? { runtime: "cloud", limit: flags.limit } : { cwd: workspaceRoot, limit: flags.limit }
    );
    if (flags.json) {
      io.stdout.write(`${JSON.stringify(rows, null, 2)}
`);
    } else {
      io.stdout.write(renderRemoteListText(rows));
    }
    return 0;
  }
  const stateDir = resolveStateDir(workspaceRoot);
  const localRows = findRecentTaskAgents(stateDir, flags.limit);
  if (flags.source === "local") {
    if (flags.json) {
      io.stdout.write(`${JSON.stringify(localRows, null, 2)}
`);
    } else {
      io.stdout.write(renderListText(localRows));
    }
    return 0;
  }
  let remoteRows = [];
  let remoteError;
  try {
    remoteRows = await listRemoteAgents({ cwd: workspaceRoot, limit: flags.limit });
  } catch (err) {
    remoteError = err instanceof Error ? err.message : String(err);
  }
  const seenLocal = new Set(localRows.map((r) => r.agentId));
  const remoteOnly = remoteRows.filter((r) => !seenLocal.has(r.agentId));
  if (flags.json) {
    io.stdout.write(
      `${JSON.stringify({ local: localRows, remoteOnly, remoteError: remoteError ?? null }, null, 2)}
`
    );
    return 0;
  }
  io.stdout.write(renderListText(localRows));
  if (remoteOnly.length > 0) {
    io.stdout.write(`
Additional durable agents reported by the SDK (${remoteOnly.length}):
`);
    io.stdout.write(renderRemoteListText(remoteOnly));
  } else if (!remoteError && localRows.length > 0) {
    io.stdout.write("\n(no additional durable agents reported by the SDK)\n");
  }
  if (remoteError) {
    io.stderr.write(
      `
note: SDK agent list failed (${remoteError}); showing local index only. Pass --local to suppress this lookup.
`
    );
  }
  return 0;
}
async function runResume(args, io) {
  let flags;
  try {
    flags = parseFlags(args);
  } catch (err) {
    if (err instanceof HelpRequested) {
      io.stdout.write(HELP3);
      return 0;
    }
    throw err;
  }
  const cwd = io.cwd();
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  if (flags.kind === "list") {
    return runList(flags, workspaceRoot, io);
  }
  const stateDir = ensureStateDir(resolveStateDir(workspaceRoot));
  let agentId;
  if (flags.target.kind === "last") {
    const top = findRecentTaskAgents(stateDir, 1)[0]?.agentId;
    if (!top) {
      io.stderr.write("no previous task agent to resume\n");
      return 1;
    }
    agentId = top;
  } else {
    agentId = flags.target.agentId;
  }
  const writePolicy = flags.write ? "You may modify files in the workspace." : "Do NOT modify files. Read and analyze only.";
  const template = loadPromptTemplate("task");
  const fullPrompt = interpolateTemplate(template, {
    USER_PROMPT: flags.prompt,
    WRITE_POLICY: writePolicy,
    WORKSPACE_CONTEXT: "(resumed agent \u2014 prior context preserved)"
  });
  const job = createJob(stateDir, {
    type: "task",
    prompt: flags.prompt,
    metadata: { resumedAgentId: agentId }
  });
  let agent;
  try {
    agent = await resumeAgent(agentId, buildAgentOptionsFromFlags(workspaceRoot, flags));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    markFailed(stateDir, job.id, `resume failed for ${agentId}: ${message}`);
    throw err;
  }
  const runFlags = { timeoutMs: flags.timeoutMs, force: flags.force, json: flags.json };
  if (flags.background) {
    runAgentTaskBackground({ agent, prompt: fullPrompt, flags: runFlags, stateDir, jobId: job.id });
    io.stdout.write(`${job.id}
`);
    return 0;
  }
  return runAgentTaskForeground({
    agent,
    prompt: fullPrompt,
    flags: runFlags,
    io,
    stateDir,
    jobId: job.id
  });
}

// plugins/cursor/scripts/lib/install.mts
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
var BOOTSTRAP_STATUS_FILENAME = ".bootstrap-status.json";
var BOOTSTRAP_SENTINEL_FILENAME = ".bootstrap-ok";
function resolvePluginRoot() {
  const envRoot = process.env.CLAUDE_PLUGIN_ROOT;
  if (envRoot && envRoot.trim() !== "") return path.resolve(envRoot);
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..");
}
function pluginNodeModules(pluginRoot) {
  return path.join(pluginRoot, "node_modules");
}
function statusPath(pluginRoot) {
  return path.join(pluginNodeModules(pluginRoot), BOOTSTRAP_STATUS_FILENAME);
}
function sentinelPath(pluginRoot) {
  return path.join(pluginNodeModules(pluginRoot), BOOTSTRAP_SENTINEL_FILENAME);
}
function isSdkInstalled(pluginRoot) {
  const direct = path.join(pluginNodeModules(pluginRoot), "@cursor", "sdk", "package.json");
  if (fs.existsSync(direct)) return true;
  try {
    const require2 = createRequire(import.meta.url);
    require2.resolve("@cursor/sdk");
    return true;
  } catch {
    return false;
  }
}
function readBootstrapStatus(pluginRoot) {
  return readJson(statusPath(pluginRoot));
}
function writeBootstrapStatus(pluginRoot, status) {
  writeJsonAtomic(statusPath(pluginRoot), status);
}
function writeBootstrapSentinel(pluginRoot) {
  fs.mkdirSync(pluginNodeModules(pluginRoot), { recursive: true });
  fs.writeFileSync(sentinelPath(pluginRoot), (/* @__PURE__ */ new Date()).toISOString(), "utf8");
}
function runNpmInstall(pluginRoot, options = {}) {
  const command = "npm install --omit=dev";
  const timeoutMs = options.timeoutMs ?? 12e4;
  const start = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    let child;
    try {
      child = spawn("npm", ["install", "--omit=dev"], {
        cwd: pluginRoot,
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env
      });
    } catch (err) {
      finish({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
        command
      });
      return;
    }
    let outputTail = "";
    const collect = (chunk) => {
      const text = chunk.toString("utf8");
      outputTail = (outputTail + text).slice(-2048);
      options.onOutput?.(text);
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
      }
      finish({
        ok: false,
        error: `npm install timed out after ${timeoutMs}ms`,
        durationMs: Date.now() - start,
        command
      });
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      finish({
        ok: false,
        error: err.message,
        durationMs: Date.now() - start,
        command
      });
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        finish({ ok: true, durationMs: Date.now() - start, command });
      } else {
        const reason = signal ? `npm install terminated by signal ${signal}` : `npm install exited with code ${code}`;
        const detail = outputTail.trim();
        finish({
          ok: false,
          error: detail ? `${reason}: ${detail}` : reason,
          durationMs: Date.now() - start,
          command
        });
      }
    });
  });
}
async function installAndRecord(pluginRoot, options = {}) {
  const result = await runNpmInstall(pluginRoot, options);
  const status = {
    ok: result.ok,
    attemptedAt: (/* @__PURE__ */ new Date()).toISOString(),
    durationMs: result.durationMs,
    command: result.command,
    ...result.error ? { error: result.error } : {}
  };
  try {
    writeBootstrapStatus(pluginRoot, status);
    if (result.ok) writeBootstrapSentinel(pluginRoot);
  } catch {
  }
  return result;
}

// plugins/cursor/scripts/commands/setup.mts
var NODE_MIN_MAJOR = 18;
var HELP4 = `cursor-companion setup [flags]

Validates the plugin runtime:
  - Node.js >= ${NODE_MIN_MAJOR}
  - @cursor/sdk is installed (bootstrap.mjs ran successfully)
  - API key is available (env or keychain)
  - Cursor.me() succeeds (key is valid)
  - Cursor.models.list() returns at least one model

SDK installation:
  --install            Run \`npm install --omit=dev\` in the plugin root.
                       Use this when bootstrap reports a failure or the
                       SDK row in the report is "fail".

Credential management:
  --login              Store a Cursor API key in the OS keychain.
                       Reads from stdin (pipe or interactive TTY; input masked as *).
                       Validates via Cursor.me() before storing.
  --logout             Remove the stored key from the OS keychain.

Stop review gate (per workspace, opt-in):
  --enable-gate        Turn on the Stop review gate for this workspace
  --disable-gate       Turn off the Stop review gate for this workspace

Default model (user-wide, used when --model is not passed):
  --set-model <id[:k=v,...]>
                       Persist a model selection as the default for new
                       agent runs. Append \`:key=value,key=value\` to set
                       variant params (e.g. effort level):
                         --set-model gpt-5
                         --set-model gpt-5:reasoning_effort=low
                         --set-model gpt-5:reasoning_effort=high,verbosity=low
                       Validated against Cursor.models.list() \u2014 the id and
                       any param keys/values must be in the catalog.
  --clear-model        Remove the persisted default (revert to ${DEFAULT_MODEL.id}).
                       Resolution order: --model flag > CURSOR_MODEL env >
                       persisted default > ${DEFAULT_MODEL.id} fallback.

flags:
  --json               Machine-readable output
  --help, -h
`;
function nodeMajor() {
  const m = process.versions.node.match(/^(\d+)\./);
  return m ? Number(m[1]) : 0;
}
function modelChoices(models) {
  const choices = [];
  const seen = /* @__PURE__ */ new Set();
  for (const model of models) {
    const baseLabel = model.displayName || model.id;
    const variants = model.variants ?? [];
    if (variants.length === 0) {
      const key = model.id;
      if (seen.has(key)) continue;
      seen.add(key);
      const choice = { label: baseLabel, selection: { id: model.id } };
      if (model.description) choice.description = model.description;
      choices.push(choice);
      continue;
    }
    for (const variant of variants) {
      const selection = { id: model.id, params: variant.params };
      const key = formatModelSelection(selection);
      if (seen.has(key)) continue;
      seen.add(key);
      const variantLabel = variant.displayName.trim();
      const label = !variantLabel || variantLabel.toLowerCase() === baseLabel.toLowerCase() ? baseLabel : `${baseLabel} - ${variantLabel}`;
      const choice = { label, selection };
      const description = variant.description ?? model.description;
      if (description) choice.description = description;
      choices.push(choice);
    }
  }
  return choices;
}
var INSTALL_REMEDIATION = "Run /cursor:setup --install to (re)install the SDK.";
function buildSdkReport() {
  const pluginRoot = resolvePluginRoot();
  const ok = isSdkInstalled(pluginRoot);
  const bootstrap = readBootstrapStatus(pluginRoot);
  const sdk = { ok, pluginRoot };
  if (bootstrap) sdk.bootstrap = bootstrap;
  return sdk;
}
function errorMessage(reason) {
  return reason instanceof Error ? reason.message : String(reason);
}
async function buildReport(input) {
  const resolved = resolveDefaultModel(DEFAULT_MODEL);
  const report = {
    node: { ok: nodeMajor() >= NODE_MIN_MAJOR, version: process.versions.node },
    sdk: buildSdkReport(),
    apiKey: { ok: false },
    account: { ok: false },
    models: { ok: false, choices: [] },
    defaultModel: {
      id: resolved.model.id,
      selector: formatModelSelection(resolved.model),
      source: resolved.source
    },
    gate: { enabled: input.gateEnabled, workspaceRoot: input.workspaceRoot }
  };
  try {
    const { source } = await resolveApiKey();
    report.apiKey.ok = true;
    report.apiKey.source = source;
  } catch (err) {
    report.apiKey.error = errorMessage(err);
    return report;
  }
  const modelsPromise = input.prefetchedCatalog ? Promise.resolve(input.prefetchedCatalog) : listModels();
  const [accountResult, modelsResult] = await Promise.allSettled([whoami(), modelsPromise]);
  if (accountResult.status === "fulfilled") {
    report.account.ok = true;
    report.account.apiKeyName = accountResult.value.apiKeyName;
  } else {
    report.account.error = errorMessage(accountResult.reason);
  }
  if (modelsResult.status === "fulfilled") {
    report.models.choices = modelChoices(modelsResult.value);
    report.models.ok = report.models.choices.length > 0;
  } else {
    report.models.error = errorMessage(modelsResult.reason);
  }
  return report;
}
function renderReport(report) {
  const lines = [];
  const yes = (ok) => ok ? "ok" : "fail";
  lines.push("# Cursor Setup");
  lines.push("");
  lines.push("| Check | Result | Detail |");
  lines.push("| --- | --- | --- |");
  const row = (label, result, detail) => {
    lines.push(
      `| ${escapeMarkdownCell(label)} | ${escapeMarkdownCell(result)} | ${escapeMarkdownCell(detail)} |`
    );
  };
  row("Node.js", yes(report.node.ok), report.node.version);
  row("SDK", yes(report.sdk.ok), describeSdk(report.sdk));
  const keyDetail = report.apiKey.ok ? `source: ${report.apiKey.source}` : report.apiKey.error ?? "";
  row("API key", yes(report.apiKey.ok), keyDetail);
  if (report.account.ok) {
    row("Account", "ok", `key: ${report.account.apiKeyName ?? "?"}`);
  } else if (report.account.error) {
    row("Account", "fail", report.account.error);
  }
  if (report.models.ok) {
    row("Models", "ok", `${report.models.choices.length} available`);
  } else if (report.models.error) {
    row("Models", "fail", report.models.error);
  }
  row("Default", report.defaultModel.selector, describeSource(report.defaultModel.source));
  row("Stop gate", report.gate.enabled ? "on" : "off", `workspace: ${report.gate.workspaceRoot}`);
  if (report.models.ok && report.models.choices.length > 0) {
    lines.push("");
    lines.push("**Available models:**");
    for (const choice of report.models.choices) {
      lines.push(`- ${choice.label} \`[${formatModelSelection(choice.selection)}]\``);
    }
  }
  if (!report.sdk.ok) {
    lines.push("");
    lines.push(`> ${INSTALL_REMEDIATION}`);
  }
  return `${lines.join("\n")}
`;
}
function describeSdk(sdk) {
  if (sdk.ok) {
    if (sdk.bootstrap?.ok) return `installed (last bootstrap: ${sdk.bootstrap.attemptedAt})`;
    return "installed";
  }
  if (sdk.bootstrap?.error) return `bootstrap failed: ${sdk.bootstrap.error}`;
  return "not installed";
}
function describeSource(source) {
  switch (source) {
    case "env":
      return "from CURSOR_MODEL env";
    case "config":
      return "from persisted default";
    case "fallback":
      return "built-in fallback";
  }
}
async function readHiddenInput(io) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      let data = "";
      stdin.setEncoding("utf8");
      stdin.on("data", (chunk) => {
        data += chunk;
      });
      stdin.on("end", () => resolve(data.trim()));
      stdin.on("error", reject);
      stdin.resume();
      return;
    }
    io.stderr.write("Enter Cursor API key: ");
    const prev = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();
    let buf = "";
    const onData = (chunk) => {
      const str = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
      for (const ch of str) {
        if (ch === "\n" || ch === "\r" || ch === "") {
          stdin.setRawMode(!!prev);
          stdin.pause();
          stdin.removeListener("data", onData);
          io.stderr.write("\n");
          resolve(buf.trim());
          return;
        }
        if (ch === "") {
          stdin.setRawMode(!!prev);
          stdin.pause();
          stdin.removeListener("data", onData);
          reject(new Error("Aborted"));
          return;
        }
        if (ch === "\x7F" || ch === "\b") {
          if (buf.length > 0) {
            buf = buf.slice(0, -1);
            io.stderr.write("\b \b");
          }
          continue;
        }
        const code = ch.codePointAt(0) ?? 0;
        if (code < 32 && ch !== "	") continue;
        buf += ch;
        io.stderr.write("*");
      }
    };
    stdin.on("data", onData);
  });
}
function keychainUnavailableMessage(detail) {
  const lines = [
    "Could not store the Cursor API key in the OS keychain.",
    "",
    "Recommended:",
    "  1. Run the local keychain helper from a normal terminal:",
    "     ~/.claude/cursor-login",
    "  2. If keychain storage is not available, use CURSOR_API_KEY instead:",
    `     echo 'export CURSOR_API_KEY="YOUR_CURSOR_API_KEY_HERE"' >> ~/.bashrc`,
    "",
    "On WSL/Linux, the keychain backend requires Secret Service. Install it with:",
    "  sudo apt-get install gnome-keyring libsecret-tools dbus-user-session"
  ];
  if (detail) {
    lines.push("", `Underlying error: ${detail}`);
  }
  return lines.join("\n");
}
async function runLogin(io, json) {
  const backend = detectBackend();
  if (!backend) {
    const msg = keychainUnavailableMessage("No supported keychain backend on this platform.");
    if (json) {
      io.stdout.write(`${JSON.stringify({ ok: false, error: msg })}
`);
    } else {
      io.stderr.write(`${msg}
`);
    }
    return 1;
  }
  const key = await readHiddenInput(io);
  if (!key) {
    const msg = "No key provided.";
    if (json) {
      io.stdout.write(`${JSON.stringify({ ok: false, error: msg })}
`);
    } else {
      io.stderr.write(`${msg}
`);
    }
    return 1;
  }
  let apiKeyName;
  try {
    const user = await whoami({ apiKey: key, retry: { attempts: 1 } });
    apiKeyName = user.apiKeyName;
  } catch (err) {
    const msg = `Validation failed: ${errorMessage(err)}`;
    if (json) {
      io.stdout.write(`${JSON.stringify({ ok: false, error: msg })}
`);
    } else {
      io.stderr.write(`${msg}
`);
    }
    return 1;
  }
  try {
    await storeApiKey(key);
  } catch (err) {
    const msg = keychainUnavailableMessage(errorMessage(err));
    if (json) {
      io.stdout.write(`${JSON.stringify({ ok: false, error: msg })}
`);
    } else {
      io.stderr.write(`${msg}
`);
    }
    return 1;
  }
  if (json) {
    io.stdout.write(
      `${JSON.stringify({ ok: true, source: "keychain", backend: backend.name, apiKeyName })}
`
    );
  } else {
    io.stdout.write(`Key stored in ${backend.name}${apiKeyName ? ` (${apiKeyName})` : ""}
`);
  }
  return 0;
}
async function runInstall(io, json) {
  const pluginRoot = resolvePluginRoot();
  if (!json) {
    io.stdout.write(`Installing @cursor/sdk in ${pluginRoot}
`);
  }
  const result = await installAndRecord(pluginRoot, {
    onOutput: json ? void 0 : (chunk) => io.stderr.write(chunk)
  });
  if (json) {
    io.stdout.write(
      `${JSON.stringify(
        {
          ok: result.ok,
          pluginRoot,
          durationMs: result.durationMs,
          command: result.command,
          ...result.error ? { error: result.error } : {}
        },
        null,
        2
      )}
`
    );
  } else if (result.ok) {
    io.stdout.write(`Install succeeded in ${result.durationMs}ms.
`);
  } else {
    io.stderr.write(`Install failed: ${result.error ?? "unknown error"}
`);
  }
  return result.ok ? 0 : 1;
}
async function runLogout(io, json) {
  const backend = detectBackend();
  if (!backend) {
    const msg = "No supported keychain backend on this platform.";
    if (json) {
      io.stdout.write(`${JSON.stringify({ ok: false, error: msg })}
`);
    } else {
      io.stderr.write(`${msg}
`);
    }
    return 1;
  }
  await deleteApiKey();
  if (json) {
    io.stdout.write(`${JSON.stringify({ ok: true, backend: backend.name })}
`);
  } else {
    io.stdout.write(`Key removed from ${backend.name}
`);
  }
  return 0;
}
async function runSetup(args, io) {
  const parsed = parseArgs(args, {
    long: {
      json: "boolean",
      help: "boolean",
      install: "boolean",
      login: "boolean",
      logout: "boolean",
      "enable-gate": "boolean",
      "disable-gate": "boolean",
      "set-model": "string",
      "clear-model": "boolean"
    },
    short: { h: "help" }
  });
  if (bool(parsed, "help")) {
    io.stdout.write(HELP4);
    return 0;
  }
  const jsonFlag = bool(parsed, "json");
  const exclusive = ["install", "login", "logout"].filter((flag) => bool(parsed, flag));
  if (exclusive.length > 1) {
    throw new UsageError(`${exclusive.map((f) => `--${f}`).join(" and ")} are mutually exclusive`);
  }
  if (bool(parsed, "install")) return runInstall(io, jsonFlag);
  if (bool(parsed, "login")) return runLogin(io, jsonFlag);
  if (bool(parsed, "logout")) return runLogout(io, jsonFlag);
  const enableGate = bool(parsed, "enable-gate");
  const disableGate = bool(parsed, "disable-gate");
  if (enableGate && disableGate) {
    throw new UsageError("--enable-gate and --disable-gate are mutually exclusive");
  }
  const setModelArg = optionalString(parsed, "set-model");
  const clearModel = bool(parsed, "clear-model");
  if (setModelArg && clearModel) {
    throw new UsageError("--set-model and --clear-model are mutually exclusive");
  }
  if (setModelArg !== void 0 && setModelArg.trim() === "") {
    throw new UsageError("--set-model requires a non-empty model id");
  }
  let prefetchedCatalog;
  if (setModelArg) {
    const selection = parseModelArg(setModelArg);
    prefetchedCatalog = await listModels();
    await validateModel(selection, { catalog: prefetchedCatalog });
    setDefaultModel(selection);
  } else if (clearModel) {
    clearDefaultModel();
  }
  const workspaceRoot = resolveWorkspaceRoot(io.cwd());
  const stateDir = resolveStateDir(workspaceRoot);
  const togglingGate = enableGate || disableGate;
  const gateEnabled = togglingGate ? setGateEnabled(stateDir, enableGate).enabled : readGateConfig(stateDir).enabled;
  const report = await buildReport({
    workspaceRoot,
    gateEnabled,
    ...prefetchedCatalog ? { prefetchedCatalog } : {}
  });
  if (jsonFlag) {
    io.stdout.write(`${JSON.stringify(report, null, 2)}
`);
  } else {
    io.stdout.write(renderReport(report));
  }
  const allOk = report.node.ok && report.sdk.ok && report.apiKey.ok && report.account.ok && report.models.ok;
  return allOk ? 0 : 1;
}

// plugins/cursor/scripts/commands/status.mts
import { setTimeout as sleep } from "node:timers/promises";
var VALID_TYPES = /* @__PURE__ */ new Set(["task", "review", "adversarial-review"]);
var VALID_STATUSES = /* @__PURE__ */ new Set(["pending", "running", "completed", "failed", "cancelled"]);
var DEFAULT_WAIT_TIMEOUT_MS = 24e4;
var DEFAULT_WAIT_POLL_MS = 1e3;
var PROGRESS_TAIL_LINES = 15;
var HELP5 = `cursor-companion status [<job-id>] [flags]

Show the job table for the current workspace, or detail for one job. With
a job id, --wait polls until the job reaches a terminal state.

flags:
  --type <task|review|adversarial-review>  Filter by type
  --status <pending|running|completed|failed|cancelled>
  --limit <n>                              Cap number of rows
  --wait                                   With <job-id>: block until terminal
  --timeout-ms <ms>                        Max time to wait (default 240000)
  --poll-ms <ms>                           Poll interval (default 1000)
  --json                                   Print as JSON
  --help, -h
`;
function parsePositiveMs(parsed, key) {
  const raw = optionalString(parsed, key);
  if (!raw) return void 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new UsageError(`invalid --${key}: ${raw}`);
  return Math.floor(n);
}
async function runStatus(args, io) {
  const parsed = parseArgs(args, {
    long: {
      type: "string",
      status: "string",
      limit: "string",
      wait: "boolean",
      "timeout-ms": "string",
      "poll-ms": "string",
      json: "boolean",
      help: "boolean"
    },
    short: { h: "help" }
  });
  if (bool(parsed, "help")) {
    io.stdout.write(HELP5);
    return 0;
  }
  const cwd = io.cwd();
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const stateDir = resolveStateDir(workspaceRoot);
  const json = bool(parsed, "json");
  const wait = bool(parsed, "wait");
  const timeoutMs = parsePositiveMs(parsed, "timeout-ms");
  const pollMs = parsePositiveMs(parsed, "poll-ms");
  reconcileStaleJobs(stateDir);
  const jobId = parsed.positionals[0];
  if (jobId) {
    let job = getJob(stateDir, jobId);
    if (!job) {
      io.stderr.write(`job not found: ${jobId}
`);
      return 1;
    }
    if (wait && !TERMINAL_STATUSES.has(job.status)) {
      const deadline = Date.now() + (timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS);
      const interval = pollMs ?? DEFAULT_WAIT_POLL_MS;
      while (Date.now() < deadline) {
        await sleep(interval);
        const fresh = getJob(stateDir, jobId);
        if (fresh) job = fresh;
        if (TERMINAL_STATUSES.has(job.status)) break;
      }
      if (!TERMINAL_STATUSES.has(job.status)) {
        io.stderr.write(`status --wait timed out (job still ${job.status})
`);
        if (json) {
          io.stdout.write(`${JSON.stringify(job, null, 2)}
`);
        } else {
          io.stdout.write(renderJobDetail(job, stateDir));
        }
        return 1;
      }
    }
    if (json) {
      io.stdout.write(`${JSON.stringify(job, null, 2)}
`);
    } else {
      io.stdout.write(renderJobDetail(job, stateDir));
    }
    return 0;
  }
  if (wait || timeoutMs || pollMs) {
    throw new UsageError("--wait/--timeout-ms/--poll-ms require a positional <job-id>");
  }
  const filter = {};
  const type = optionalString(parsed, "type");
  if (type) {
    if (!VALID_TYPES.has(type)) {
      throw new UsageError(
        `invalid --type: ${type} (expected one of ${[...VALID_TYPES].join(", ")})`
      );
    }
    filter.type = type;
  }
  const status = optionalString(parsed, "status");
  if (status) {
    if (!VALID_STATUSES.has(status)) {
      throw new UsageError(
        `invalid --status: ${status} (expected one of ${[...VALID_STATUSES].join(", ")})`
      );
    }
    filter.status = status;
  }
  const limit = optionalString(parsed, "limit");
  if (limit) {
    const n = Number(limit);
    if (!Number.isFinite(n) || n < 0) throw new UsageError(`invalid --limit: ${limit}`);
    filter.limit = Math.floor(n);
  }
  const jobs = listJobs(stateDir, filter);
  if (json) {
    io.stdout.write(`${JSON.stringify(jobs, null, 2)}
`);
  } else {
    io.stdout.write(renderJobTable(jobs));
  }
  return 0;
}
function renderJobDetail(job, stateDir) {
  if (!job) return "";
  const lines = [];
  lines.push(`# Job \`${job.id}\``);
  lines.push("");
  lines.push("| Field | Value |");
  lines.push("| --- | --- |");
  const row = (label, value) => {
    lines.push(`| ${label} | ${escapeMarkdownCell(value)} |`);
  };
  row("id", `\`${job.id}\``);
  row("type", `\`${job.type}\``);
  row("status", `\`${job.status}\``);
  if (job.phase) row("phase", job.phase);
  row("createdAt", job.createdAt);
  row("updatedAt", job.updatedAt);
  if (job.startedAt) row("startedAt", job.startedAt);
  if (job.finishedAt) row("finishedAt", job.finishedAt);
  if (typeof job.durationMs === "number") row("durationMs", String(job.durationMs));
  if (job.agentId) row("agentId", `\`${job.agentId}\``);
  if (job.runId) row("runId", `\`${job.runId}\``);
  if (job.metadata && Object.keys(job.metadata).length > 0) {
    row("metadata", `\`${JSON.stringify(job.metadata)}\``);
  }
  const actions = formatJobActions(job);
  if (actions) row("actions", actions);
  const handoff = jobAgentHandoffLines(job.agentId);
  if (handoff.length > 0) {
    lines.push("", "**Continue this Cursor agent:**", ...handoff);
  }
  if (job.error) {
    lines.push("", "**Error:**", "", ...fenceCodeBlock(job.error));
  }
  if (job.prompt) {
    lines.push("", "**Prompt:**", "", ...fenceCodeBlock(job.prompt));
  }
  if (!TERMINAL_STATUSES.has(job.status)) {
    const tail = tailJobLog(stateDir, job.id, PROGRESS_TAIL_LINES);
    if (tail) {
      lines.push(
        "",
        `**Progress** _(last ${PROGRESS_TAIL_LINES} log lines)_:`,
        "",
        ...fenceCodeBlock(tail)
      );
    }
  }
  return `${lines.join("\n")}
`;
}

// plugins/cursor/scripts/commands/task.mts
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
var HELP6 = `cursor-companion task <prompt> [flags]

Delegate an implementation task to a Cursor agent. Streams events to stdout
(assistant text) and stderr (annotations).

flags:
  --write              Allow file modifications (default: read-only)
  --resume-last        Resume the most-recent task agent for this workspace
  --background         Start the run and exit, returning the job id
  --force              Expire any wedged active local run before sending
  --cloud              Use Cursor cloud against the detected GitHub origin
  --prompt-file <path> Read the prompt from a file. Concatenated with any
                       positional prompt text (positional first, file body
                       second, separated by a blank line).
  --model <id[:k=v,...]>
                       Override the default model. Append \`:key=value\`
                       pairs to set variant params, e.g.
                       --model gpt-5:reasoning_effort=low
  -m <id[:k=v,...]>
  --timeout <ms>       Cancel the run if it exceeds this duration
  --json               Print the final result as JSON (single line)
  --help, -h
`;
var HelpRequested2 = class extends Error {
};
function readPromptFile(cwd, filePath) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const abs = resolvePath(cwd, filePath);
  if (!abs.startsWith(`${workspaceRoot}/`) && abs !== workspaceRoot) {
    throw new UsageError(`--prompt-file must reference a path within the workspace`);
  }
  try {
    return readFileSync(abs, "utf8").trim();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new UsageError(`failed to read --prompt-file ${filePath}: ${detail}`);
  }
}
function parseFlags2(args, cwd) {
  const parsed = parseArgs(args, {
    long: {
      write: "boolean",
      "resume-last": "boolean",
      background: "boolean",
      force: "boolean",
      cloud: "boolean",
      "prompt-file": "string",
      model: "string",
      timeout: "string",
      json: "boolean",
      help: "boolean"
    },
    short: { h: "help", m: "model" }
  });
  if (bool(parsed, "help")) throw new HelpRequested2();
  const positionalPrompt = parsed.positionals.join(" ").trim();
  const promptFilePath = optionalString(parsed, "prompt-file");
  const filePrompt = promptFilePath ? readPromptFile(cwd, promptFilePath) : "";
  const prompt = [positionalPrompt, filePrompt].filter((s) => s.length > 0).join("\n\n");
  if (!prompt) throw new UsageError("task requires a prompt argument or --prompt-file");
  const flags = {
    prompt,
    write: bool(parsed, "write"),
    resumeLast: bool(parsed, "resume-last"),
    background: bool(parsed, "background"),
    force: bool(parsed, "force"),
    cloud: bool(parsed, "cloud"),
    json: bool(parsed, "json")
  };
  const model = optionalModelArg(parsed, "model");
  if (model) flags.model = model;
  const timeout = optionalString(parsed, "timeout");
  if (timeout) {
    const ms = Number(timeout);
    if (!Number.isFinite(ms) || ms <= 0) throw new UsageError(`invalid --timeout: ${timeout}`);
    flags.timeoutMs = ms;
  }
  return flags;
}
function buildContextHeader(workspaceRoot) {
  const lines = [];
  const branch = getBranch(workspaceRoot);
  if (branch) lines.push(`Current branch: ${branch}`);
  const commits = getRecentCommits(workspaceRoot, 3);
  if (commits.length > 0) {
    lines.push("Recent commits:");
    for (const c of commits) {
      lines.push(`  ${c.hash.slice(0, 8)} ${c.subject}`);
    }
  }
  const sourceTree = getSourceTree(workspaceRoot);
  if (sourceTree) {
    lines.push("");
    lines.push(sourceTree);
  }
  return lines.join("\n");
}
async function resolveTaskAgent(flags, stateDir, agentOpts, io) {
  if (!flags.resumeLast) return createAgent(agentOpts);
  const agentId = findRecentTaskAgents(stateDir, 1)[0]?.agentId;
  if (!agentId) {
    io.stderr.write("no previous task agent to resume \u2014 starting fresh\n");
    return createAgent(agentOpts);
  }
  try {
    return await resumeAgent(agentId, agentOpts);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    io.stderr.write(`resume failed (${message}); starting fresh
`);
    return createAgent(agentOpts);
  }
}
async function runTask(args, io) {
  const cwd = io.cwd();
  let flags;
  try {
    flags = parseFlags2(args, cwd);
  } catch (err) {
    if (err instanceof HelpRequested2) {
      io.stdout.write(HELP6);
      return 0;
    }
    throw err;
  }
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const stateDir = ensureStateDir(resolveStateDir(workspaceRoot));
  const workspaceContext = flags.cloud ? "" : buildContextHeader(workspaceRoot);
  const writePolicy = flags.write ? "You may modify files in the workspace." : "Do NOT modify files. Read and analyze only.";
  const template = loadPromptTemplate("task");
  const fullPrompt = interpolateTemplate(template, {
    USER_PROMPT: flags.prompt,
    WRITE_POLICY: writePolicy,
    WORKSPACE_CONTEXT: workspaceContext || "(no local context \u2014 cloud mode)"
  });
  const job = createJob(stateDir, { type: "task", prompt: flags.prompt });
  const agentOpts = buildAgentOptionsFromFlags(workspaceRoot, flags);
  let agent;
  try {
    agent = await resolveTaskAgent(flags, stateDir, agentOpts, io);
  } catch (err) {
    markFailed(stateDir, job.id, err instanceof Error ? err.message : String(err));
    throw err;
  }
  const runFlags = { timeoutMs: flags.timeoutMs, force: flags.force, json: flags.json };
  if (flags.background) {
    runAgentTaskBackground({ agent, prompt: fullPrompt, flags: runFlags, stateDir, jobId: job.id });
    io.stdout.write(`${job.id}
`);
    return 0;
  }
  return runAgentTaskForeground({
    agent,
    prompt: fullPrompt,
    flags: runFlags,
    io,
    stateDir,
    jobId: job.id
  });
}

// plugins/cursor/scripts/cursor-companion.mts
var HELP7 = `cursor-companion <command> [args]

commands:
  task <prompt>          Delegate an implementation task to Cursor
  resume <agent-id|--last|--list> [prompt]
                         Reattach to an existing Cursor agent and continue
  review                 Review the current diff
  adversarial-review     Challenge design choices, not just defects
  status [<job-id>]      Show job table or single job detail
  result <job-id>        Retrieve a completed job's output
  cancel <job-id>        Cancel an active job
  setup                  Validate API key, list available models

global flags:
  --json                 Machine-readable output where supported
  --help, -h             Show this help

run '<command> --help' for command-specific options.
`;
async function main(argv, io) {
  const [, , command, ...rest] = argv;
  if (command === void 0 || command === "--help" || command === "-h") {
    io.stdout.write(HELP7);
    return 0;
  }
  try {
    switch (command) {
      case "task":
        return await runTask(rest, io);
      case "resume":
        return await runResume(rest, io);
      case "review":
        return await runReview(rest, io, { adversarial: false });
      case "adversarial-review":
        return await runReview(rest, io, { adversarial: true });
      case "status":
        return await runStatus(rest, io);
      case "result":
        return await runResult(rest, io);
      case "cancel":
        return await runCancel(rest, io);
      case "setup":
        return await runSetup(rest, io);
      default:
        io.stderr.write(`cursor-companion: unknown command '${command}'
`);
        io.stderr.write(HELP7);
        return 2;
    }
  } catch (err) {
    io.stderr.write(renderError(err));
    return err instanceof UsageError ? 2 : 1;
  }
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const code = await main(process.argv, {
    stdout: process.stdout,
    stderr: process.stderr,
    cwd: () => process.cwd(),
    env: process.env
  });
  process.exit(code);
}
export {
  main
};
