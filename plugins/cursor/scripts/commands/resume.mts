import type { ModelSelection } from "@cursor/sdk";

import type { CommandIO, ExitCode } from "../cursor-companion.mjs";
import { bool, optionalString, parseArgs, UsageError } from "../lib/args.mjs";
import {
  buildPrompt,
  type CursorAgentOptions,
  resumeAgent,
  writePolicyText,
} from "../lib/cursor-agent.mjs";
import { detectCloudRepository } from "../lib/git.mjs";
import {
  createJob,
  findRecentTaskAgents,
  markFailed,
  type RecentTaskAgent,
} from "../lib/job-control.mjs";
import { runAgentTaskBackground, runAgentTaskForeground } from "../lib/run-agent-task.mjs";
import { ensureStateDir, resolveStateDir } from "../lib/state.mjs";
import { resolveWorkspaceRoot } from "../lib/workspace.mjs";

const HELP = `cursor-companion resume <agent-id> <prompt> [flags]
cursor-companion resume --last <prompt> [flags]
cursor-companion resume --list [--limit <n>] [--json]

Reattach to an existing Cursor agent and continue the conversation. The agent
keeps its prior context, so follow-up prompts are cheaper than starting fresh.

flags:
  --last               Resume the most recent task agent (no agent-id needed)
  --list               Print known agent ids from this workspace, then exit
  --limit <n>          With --list: cap the number of rows (default 10)
  --write              Allow file modifications (default: read-only)
  --background         Start the run and exit, returning the job id
  --force              Expire any wedged active local run before sending
  --cloud              Use Cursor cloud against the detected GitHub origin
  --model <id>, -m
  --timeout <ms>       Cancel the run if it exceeds this duration
  --json               Print the final result as JSON (single line)
  --help, -h
`;

const DEFAULT_LIST_LIMIT = 10;

interface ListFlags {
  kind: "list";
  limit: number;
  json: boolean;
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

  if (list) {
    if (last) throw new UsageError("--list and --last are mutually exclusive");
    let limit = DEFAULT_LIST_LIMIT;
    const limitArg = optionalString(parsed, "limit");
    if (limitArg !== undefined) {
      const n = Number(limitArg);
      if (!Number.isFinite(n) || n < 0) throw new UsageError(`invalid --limit: ${limitArg}`);
      limit = Math.floor(n);
    }
    return { kind: "list", limit, json };
  }

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
    cloud: bool(parsed, "cloud"),
    json,
  };
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

function buildAgentOptionsForFlags(flags: RunFlags, workspaceRoot: string): CursorAgentOptions {
  const opts: CursorAgentOptions = { cwd: workspaceRoot };
  if (flags.model) opts.model = flags.model;
  if (flags.cloud) {
    opts.mode = "cloud";
    opts.cloudRepo = detectCloudRepository(workspaceRoot);
  }
  return opts;
}

function renderListText(rows: RecentTaskAgent[]): string {
  if (rows.length === 0) return "(no resumable agents)\n";
  const widths = {
    agentId: "agent-id".length,
    jobId: "job-id".length,
    created: "created".length,
  };
  for (const r of rows) {
    widths.agentId = Math.max(widths.agentId, r.agentId.length);
    widths.jobId = Math.max(widths.jobId, r.jobId.length);
    widths.created = Math.max(widths.created, r.createdAt.length);
  }
  const header = `${"AGENT-ID".padEnd(widths.agentId)}  ${"JOB-ID".padEnd(widths.jobId)}  ${"CREATED".padEnd(widths.created)}  SUMMARY`;
  const separator = `${"-".repeat(widths.agentId)}  ${"-".repeat(widths.jobId)}  ${"-".repeat(widths.created)}  -------`;
  const body = rows
    .map((r) => {
      const line = `${r.agentId.padEnd(widths.agentId)}  ${r.jobId.padEnd(widths.jobId)}  ${r.createdAt.padEnd(widths.created)}  ${r.summary ?? ""}`;
      return line.trimEnd();
    })
    .join("\n");
  return `${header}\n${separator}\n${body}\n`;
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
    const stateDir = resolveStateDir(workspaceRoot);
    const rows = findRecentTaskAgents(stateDir, flags.limit);
    if (flags.json) {
      io.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
    } else {
      io.stdout.write(renderListText(rows));
    }
    return 0;
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

  const fullPrompt = buildPrompt(`${writePolicyText(flags.write)}\n\n${flags.prompt}`);

  const job = createJob(stateDir, {
    type: "task",
    prompt: flags.prompt,
    metadata: { resumed: true, resumedAgentId: agentId },
  });

  let agent: Awaited<ReturnType<typeof resumeAgent>>;
  try {
    agent = await resumeAgent(agentId, buildAgentOptionsForFlags(flags, workspaceRoot));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    markFailed(stateDir, job.id, `resume failed for ${agentId}: ${message}`);
    throw err;
  }

  const runFlags = {
    ...(flags.timeoutMs !== undefined ? { timeoutMs: flags.timeoutMs } : {}),
    ...(flags.force ? { force: true } : {}),
    json: flags.json,
  };

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
