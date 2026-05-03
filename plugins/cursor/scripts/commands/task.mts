import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

import type { ModelSelection, SDKAgent } from "@cursor/sdk";

import type { CommandIO, ExitCode } from "../cursor-companion.mjs";
import { bool, optionalString, parseArgs, UsageError } from "../lib/args.mjs";
import {
  buildAgentOptionsFromFlags,
  type CursorAgentOptions,
  createAgent,
  resumeAgent,
} from "../lib/cursor-agent.mjs";
import { getBranch, getRecentCommits, getSourceTree } from "../lib/git.mjs";
import { createJob, findRecentTaskAgents, markFailed } from "../lib/job-control.mjs";
import { optionalModelArg } from "../lib/model-arg.mjs";
import { interpolateTemplate, loadPromptTemplate } from "../lib/prompts.mjs";
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

function readPromptFile(cwd: string, filePath: string): string {
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

function parseFlags(args: readonly string[], cwd: string): TaskFlags {
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
      help: "boolean",
    },
    short: { h: "help", m: "model" },
  });
  if (bool(parsed, "help")) throw new HelpRequested();

  const positionalPrompt = parsed.positionals.join(" ").trim();
  const promptFilePath = optionalString(parsed, "prompt-file");
  const filePrompt = promptFilePath ? readPromptFile(cwd, promptFilePath) : "";
  const prompt = [positionalPrompt, filePrompt].filter((s) => s.length > 0).join("\n\n");
  if (!prompt) throw new UsageError("task requires a prompt argument or --prompt-file");

  const flags: TaskFlags = {
    prompt,
    write: bool(parsed, "write"),
    resumeLast: bool(parsed, "resume-last"),
    background: bool(parsed, "background"),
    force: bool(parsed, "force"),
    cloud: bool(parsed, "cloud"),
    json: bool(parsed, "json"),
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

function buildContextHeader(workspaceRoot: string): string {
  const lines: string[] = [];
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

async function resolveTaskAgent(
  flags: TaskFlags,
  stateDir: string,
  agentOpts: CursorAgentOptions,
  io: CommandIO,
): Promise<SDKAgent> {
  if (!flags.resumeLast) return createAgent(agentOpts);
  const agentId = findRecentTaskAgents(stateDir, 1)[0]?.agentId;
  if (!agentId) {
    io.stderr.write("no previous task agent to resume — starting fresh\n");
    return createAgent(agentOpts);
  }
  try {
    return await resumeAgent(agentId, agentOpts);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    io.stderr.write(`resume failed (${message}); starting fresh\n`);
    return createAgent(agentOpts);
  }
}

export async function runTask(args: readonly string[], io: CommandIO): Promise<ExitCode> {
  const cwd = io.cwd();
  let flags: TaskFlags;
  try {
    flags = parseFlags(args, cwd);
  } catch (err) {
    if (err instanceof HelpRequested) {
      io.stdout.write(HELP);
      return 0;
    }
    throw err;
  }

  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const stateDir = ensureStateDir(resolveStateDir(workspaceRoot));

  const workspaceContext = flags.cloud ? "" : buildContextHeader(workspaceRoot);
  const writePolicy = flags.write
    ? "You may modify files in the workspace."
    : "Do NOT modify files. Read and analyze only.";
  const template = loadPromptTemplate("task");
  const fullPrompt = interpolateTemplate(template, {
    USER_PROMPT: flags.prompt,
    WRITE_POLICY: writePolicy,
    WORKSPACE_CONTEXT: workspaceContext || "(no local context — cloud mode)",
  });

  const job = createJob(stateDir, { type: "task", prompt: flags.prompt });

  const agentOpts = buildAgentOptionsFromFlags(workspaceRoot, flags);
  let agent: SDKAgent;
  try {
    agent = await resolveTaskAgent(flags, stateDir, agentOpts, io);
  } catch (err) {
    markFailed(stateDir, job.id, err instanceof Error ? err.message : String(err));
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
