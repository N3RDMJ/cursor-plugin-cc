import type { ModelSelection } from "@cursor/sdk";

import type { CommandIO, ExitCode } from "../cursor-companion.mjs";
import { bool, optionalString, parseArgs, UsageError } from "../lib/args.mjs";
import {
  buildPrompt,
  type CursorAgentOptions,
  createAgent,
  resumeAgent,
  writePolicyText,
} from "../lib/cursor-agent.mjs";
import { detectCloudRepository, getBranch, getRecentCommits } from "../lib/git.mjs";
import { createJob, findRecentTaskAgents } from "../lib/job-control.mjs";
import { runAgentTaskBackground, runAgentTaskForeground } from "../lib/run-agent-task.mjs";
import { ensureStateDir, resolveStateDir } from "../lib/state.mjs";
import { resolveWorkspaceRoot } from "../lib/workspace.mjs";

const HELP = `cursor-companion task <prompt> [flags]

Delegate an implementation task to a Cursor agent. Streams events to stdout
(assistant text) and stderr (annotations).

flags:
  --write              Allow file modifications (default: read-only)
  --resume-last        Resume the most-recent task agent for this workspace
  --background         Start the run and exit, returning the job id
  --force              Expire any wedged active local run before sending
  --cloud              Use Cursor cloud against the detected GitHub origin
  --model <id>         Override the default model
  -m <id>
  --timeout <ms>       Cancel the run if it exceeds this duration
  --json               Print the final result as JSON (single line)
  --help, -h
`;

interface TaskFlags {
  prompt: string;
  write: boolean;
  resumeLast: boolean;
  background: boolean;
  force: boolean;
  cloud: boolean;
  model?: ModelSelection;
  timeoutMs?: number;
  json: boolean;
}

class HelpRequested extends Error {}

function parseFlags(args: readonly string[]): TaskFlags {
  const parsed = parseArgs(args, {
    long: {
      write: "boolean",
      "resume-last": "boolean",
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

  const prompt = parsed.positionals.join(" ").trim();
  if (!prompt) throw new UsageError("task requires a prompt argument");

  const flags: TaskFlags = {
    prompt,
    write: bool(parsed, "write"),
    resumeLast: bool(parsed, "resume-last"),
    background: bool(parsed, "background"),
    force: bool(parsed, "force"),
    cloud: bool(parsed, "cloud"),
    json: bool(parsed, "json"),
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

function buildContextHeader(workspaceRoot: string): string {
  const lines: string[] = [];
  const branch = getBranch(workspaceRoot);
  if (branch) lines.push(`Current branch: ${branch}`);
  const commits = getRecentCommits(workspaceRoot, 5);
  if (commits.length > 0) {
    lines.push("Recent commits:");
    for (const c of commits) {
      lines.push(`  ${c.hash.slice(0, 8)} ${c.subject}`);
    }
  }
  return lines.join("\n");
}

function buildAgentOptionsForFlags(flags: TaskFlags, workspaceRoot: string): CursorAgentOptions {
  const opts: CursorAgentOptions = { cwd: workspaceRoot };
  if (flags.model) opts.model = flags.model;
  if (flags.cloud) {
    opts.mode = "cloud";
    opts.cloudRepo = detectCloudRepository(workspaceRoot);
  }
  return opts;
}

function findResumeAgentId(stateDir: string): string | undefined {
  return findRecentTaskAgents(stateDir, 1)[0]?.agentId;
}

export async function runTask(args: readonly string[], io: CommandIO): Promise<ExitCode> {
  let flags: TaskFlags;
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
  const stateDir = ensureStateDir(resolveStateDir(workspaceRoot));

  // Skip local-workspace context in cloud mode: the cloud agent runs against
  // `startingRef` of the remote, so local uncommitted state would mislead it.
  const contextHeader = flags.cloud ? "" : buildContextHeader(workspaceRoot);
  const sections = [contextHeader, writePolicyText(flags.write), flags.prompt].filter(
    (s) => s.length > 0,
  );
  const fullPrompt = buildPrompt(sections.join("\n\n"));

  const job = createJob(stateDir, { type: "task", prompt: flags.prompt });

  const agentOpts = buildAgentOptionsForFlags(flags, workspaceRoot);
  let agent: Awaited<ReturnType<typeof createAgent>>;
  if (flags.resumeLast) {
    const agentId = findResumeAgentId(stateDir);
    if (!agentId) {
      io.stderr.write("no previous task agent to resume — starting fresh\n");
      agent = await createAgent(agentOpts);
    } else {
      try {
        agent = await resumeAgent(agentId, agentOpts);
      } catch (err) {
        io.stderr.write(
          `resume failed (${err instanceof Error ? err.message : String(err)}); starting fresh\n`,
        );
        agent = await createAgent(agentOpts);
      }
    }
  } else {
    agent = await createAgent(agentOpts);
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
