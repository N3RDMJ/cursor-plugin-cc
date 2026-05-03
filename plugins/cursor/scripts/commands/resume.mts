import type { ModelSelection, SDKAgent } from "@cursor/sdk";

import type { CommandIO, ExitCode } from "../cursor-companion.mjs";
import { bool, optionalString, parseArgs, UsageError } from "../lib/args.mjs";
import {
  buildAgentOptionsFromFlags,
  listRemoteAgents,
  type RemoteAgentRow,
  resumeAgent,
} from "../lib/cursor-agent.mjs";
import {
  createJob,
  findRecentTaskAgents,
  markFailed,
  type RecentTaskAgent,
} from "../lib/job-control.mjs";
import { optionalModelArg } from "../lib/model-arg.mjs";
import { interpolateTemplate, loadPromptTemplate } from "../lib/prompts.mjs";
import { ageFromIso, compactText } from "../lib/render.mjs";
import { runAgentTaskBackground, runAgentTaskForeground } from "../lib/run-agent-task.mjs";
import { ensureStateDir, resolveStateDir } from "../lib/state.mjs";
import { resolveWorkspaceRoot } from "../lib/workspace.mjs";

const HELP = `cursor-companion resume <agent-id> <prompt> [flags]
cursor-companion resume --last <prompt> [flags]
cursor-companion resume --list [--local|--remote] [--limit <n>] [--json]

Reattach to an existing Cursor agent and continue the conversation. The agent
keeps its prior context, so follow-up prompts are cheaper than starting fresh.

flags:
  --last               Resume the most recent task agent (no agent-id needed)
  --list               Print known agent ids — merges this workspace's local
                       index with the SDK's durable agent list (local runtime).
                       Soft-fails on SDK errors with a footer note. Use
                       --local or --remote to scope to one source.
  --local              With --list: only show this workspace's job index
  --remote             With --list: only show the SDK's durable agents
                       (combine with --cloud to list cloud-runtime agents —
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

const DEFAULT_LIST_LIMIT = 10;

type ListSource = "merged" | "local" | "remote";

interface ListFlags {
  kind: "list";
  limit: number;
  json: boolean;
  source: ListSource;
  cloud: boolean;
}

interface RunFlags {
  kind: "run";
  prompt: string;
  /** Either an explicit id (positional) or "last" — resolved at execution time. */
  target: { kind: "id"; agentId: string } | { kind: "last" };
  write: boolean;
  background: boolean;
  force: boolean;
  cloud: boolean;
  model?: ModelSelection;
  timeoutMs?: number;
  json: boolean;
}

type ResumeFlags = ListFlags | RunFlags;

class HelpRequested extends Error {}

function parseFlags(args: readonly string[]): ResumeFlags {
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
      help: "boolean",
    },
    short: { h: "help", m: "model" },
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
    if (limitArg !== undefined) {
      const n = Number(limitArg);
      if (!Number.isFinite(n) || n < 0) throw new UsageError(`invalid --limit: ${limitArg}`);
      limit = Math.floor(n);
    }
    if (cloud && !remote) {
      throw new UsageError("--list --cloud requires --remote (cloud listing goes through the SDK)");
    }
    const source: ListSource = local ? "local" : remote ? "remote" : "merged";
    return { kind: "list", limit, json, source, cloud };
  }

  if (remote) throw new UsageError("--remote requires --list");
  if (local) throw new UsageError("--local requires --list");

  if (optionalString(parsed, "limit") !== undefined) {
    throw new UsageError("--limit requires --list");
  }

  const positionals = [...parsed.positionals];
  let target: RunFlags["target"];
  if (last) {
    target = { kind: "last" };
  } else {
    const agentId = positionals.shift();
    if (!agentId) {
      throw new UsageError(
        "resume requires <agent-id> (or --last to pick the most recent, or --list to discover ids)",
      );
    }
    target = { kind: "id", agentId };
  }

  const prompt = positionals.join(" ").trim();
  if (!prompt) throw new UsageError("resume requires a prompt to send to the agent");

  const flags: RunFlags = {
    kind: "run",
    prompt,
    target,
    write: bool(parsed, "write"),
    background: bool(parsed, "background"),
    force: bool(parsed, "force"),
    cloud,
    json,
  };
  flags.model = optionalModelArg(parsed, "model");
  const timeout = optionalString(parsed, "timeout");
  if (timeout) {
    const ms = Number(timeout);
    if (!Number.isFinite(ms) || ms <= 0) throw new UsageError(`invalid --timeout: ${timeout}`);
    flags.timeoutMs = ms;
  }
  return flags;
}

function renderListText(rows: RecentTaskAgent[], now: number = Date.now()): string {
  if (rows.length === 0) return "(no resumable agents)\n";
  const formatted = rows.map((r) => ({
    agentId: r.agentId,
    jobId: r.jobId,
    age: ageFromIso(r.createdAt, now),
    summary: r.summary ? compactText(r.summary).slice(0, 60) : "",
  }));
  const widths = {
    agentId: Math.max("agent-id".length, ...formatted.map((r) => r.agentId.length)),
    jobId: Math.max("job-id".length, ...formatted.map((r) => r.jobId.length)),
    age: Math.max("age".length, ...formatted.map((r) => r.age.length)),
  };
  const header = `${"AGENT-ID".padEnd(widths.agentId)}  ${"JOB-ID".padEnd(widths.jobId)}  ${"AGE".padEnd(widths.age)}  SUMMARY`;
  const separator = `${"-".repeat(widths.agentId)}  ${"-".repeat(widths.jobId)}  ${"-".repeat(widths.age)}  -------`;
  const body = formatted
    .map((r) =>
      `${r.agentId.padEnd(widths.agentId)}  ${r.jobId.padEnd(widths.jobId)}  ${r.age.padEnd(widths.age)}  ${r.summary}`.trimEnd(),
    )
    .join("\n");
  return `${header}\n${separator}\n${body}\n`;
}

export function renderRemoteListText(rows: RemoteAgentRow[], now: number = Date.now()): string {
  if (rows.length === 0) return "(no durable agents reported by the SDK)\n";
  const formatted = rows.map((r) => ({
    agentId: r.agentId,
    age: ageFromIso(new Date(r.lastModified).toISOString(), now),
    status: r.status ?? "—",
    summary: r.summary ? compactText(r.summary).slice(0, 60) : compactText(r.name).slice(0, 60),
  }));
  const widths = {
    agentId: Math.max("agent-id".length, ...formatted.map((r) => r.agentId.length)),
    age: Math.max("age".length, ...formatted.map((r) => r.age.length)),
    status: Math.max("status".length, ...formatted.map((r) => r.status.length)),
  };
  const header = `${"AGENT-ID".padEnd(widths.agentId)}  ${"AGE".padEnd(widths.age)}  ${"STATUS".padEnd(widths.status)}  SUMMARY`;
  const separator = `${"-".repeat(widths.agentId)}  ${"-".repeat(widths.age)}  ${"-".repeat(widths.status)}  -------`;
  const body = formatted
    .map((r) =>
      `${r.agentId.padEnd(widths.agentId)}  ${r.age.padEnd(widths.age)}  ${r.status.padEnd(widths.status)}  ${r.summary}`.trimEnd(),
    )
    .join("\n");
  return `${header}\n${separator}\n${body}\n`;
}

async function runList(flags: ListFlags, workspaceRoot: string, io: CommandIO): Promise<ExitCode> {
  if (flags.source === "remote") {
    const rows = await listRemoteAgents(
      flags.cloud
        ? { runtime: "cloud", limit: flags.limit }
        : { cwd: workspaceRoot, limit: flags.limit },
    );
    if (flags.json) {
      io.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
    } else {
      io.stdout.write(renderRemoteListText(rows));
    }
    return 0;
  }

  const stateDir = resolveStateDir(workspaceRoot);
  const localRows = findRecentTaskAgents(stateDir, flags.limit);

  if (flags.source === "local") {
    if (flags.json) {
      io.stdout.write(`${JSON.stringify(localRows, null, 2)}\n`);
    } else {
      io.stdout.write(renderListText(localRows));
    }
    return 0;
  }

  // Merged view (default): union local index with the SDK's local-runtime
  // durable agents, deduplicated by agentId. Local entries win on conflict
  // because they carry job-id + summary that the SDK list lacks. SDK errors
  // are non-fatal — most users care about local agents and the remote query
  // is an enrichment.
  let remoteRows: RemoteAgentRow[] = [];
  let remoteError: string | undefined;
  try {
    remoteRows = await listRemoteAgents({ cwd: workspaceRoot, limit: flags.limit });
  } catch (err) {
    remoteError = err instanceof Error ? err.message : String(err);
  }
  const seenLocal = new Set(localRows.map((r) => r.agentId));
  const remoteOnly = remoteRows.filter((r) => !seenLocal.has(r.agentId));

  if (flags.json) {
    io.stdout.write(
      `${JSON.stringify({ local: localRows, remoteOnly, remoteError: remoteError ?? null }, null, 2)}\n`,
    );
    return 0;
  }

  io.stdout.write(renderListText(localRows));
  if (remoteOnly.length > 0) {
    io.stdout.write(`\nAdditional durable agents reported by the SDK (${remoteOnly.length}):\n`);
    io.stdout.write(renderRemoteListText(remoteOnly));
  } else if (!remoteError && localRows.length > 0) {
    io.stdout.write("\n(no additional durable agents reported by the SDK)\n");
  }
  if (remoteError) {
    io.stderr.write(
      `\nnote: SDK agent list failed (${remoteError}); showing local index only. ` +
        "Pass --local to suppress this lookup.\n",
    );
  }
  return 0;
}

export async function runResume(args: readonly string[], io: CommandIO): Promise<ExitCode> {
  let flags: ResumeFlags;
  try {
    flags = parseFlags(args);
  } catch (err) {
    if (err instanceof HelpRequested) {
      io.stdout.write(HELP);
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

  let agentId: string;
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

  const writePolicy = flags.write
    ? "You may modify files in the workspace."
    : "Do NOT modify files. Read and analyze only.";
  const template = loadPromptTemplate("task");
  const fullPrompt = interpolateTemplate(template, {
    USER_PROMPT: flags.prompt,
    WRITE_POLICY: writePolicy,
    WORKSPACE_CONTEXT: "(resumed agent — prior context preserved)",
  });

  const job = createJob(stateDir, {
    type: "task",
    prompt: flags.prompt,
    metadata: { resumedAgentId: agentId },
  });

  let agent: SDKAgent;
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
    io.stdout.write(`${job.id}\n`);
    return 0;
  }

  return runAgentTaskForeground({
    agent,
    prompt: fullPrompt,
    flags: runFlags,
    io,
    stateDir,
    jobId: job.id,
  });
}
