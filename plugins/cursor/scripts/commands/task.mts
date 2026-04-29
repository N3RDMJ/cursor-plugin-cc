import type { ModelSelection, SDKMessage } from "@cursor/sdk";

import type { CommandIO, ExitCode } from "../cursor-companion.mjs";
import { bool, optionalString, parseArgs } from "../lib/args.mjs";
import {
  buildPrompt,
  type CursorAgentOptions,
  createAgent,
  disposeAgent,
  resumeAgent,
  sendTask,
  toAgentEvents,
} from "../lib/cursor-agent.mjs";
import { detectCloudRepository, getBranch, getRecentCommits } from "../lib/git.mjs";
import {
  createJob,
  listJobs,
  logJobLine,
  markFailed,
  markFinished,
  markRunning,
} from "../lib/job-control.mjs";
import { renderStreamEvent } from "../lib/render.mjs";
import { ensureStateDir, readJob, resolveStateDir } from "../lib/state.mjs";
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
  if (!prompt) throw new Error("task requires a prompt argument");

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
    if (!Number.isFinite(ms) || ms <= 0) throw new Error(`invalid --timeout: ${timeout}`);
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
  const recent = listJobs(stateDir, { type: "task", limit: 10 });
  for (const entry of recent) {
    const job = readJob(stateDir, entry.id);
    if (job?.agentId) return job.agentId;
  }
  return undefined;
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

  const writePolicy = flags.write
    ? "You may modify files in the workspace."
    : "Do NOT modify files. Read and analyze only — produce diffs/suggestions in your response, but do not write to disk.";
  const fullPrompt = buildPrompt(
    [buildContextHeader(workspaceRoot), "", writePolicy, "", flags.prompt]
      .filter((line) => line.length > 0 || line === "")
      .join("\n"),
  );

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

  if (flags.background) {
    detachBackgroundRun(agent, fullPrompt, flags, stateDir, job.id);
    io.stdout.write(`${job.id}\n`);
    return 0;
  }

  try {
    const result = await sendTask(agent, fullPrompt, {
      ...(flags.timeoutMs ? { timeoutMs: flags.timeoutMs } : {}),
      ...(flags.force ? { force: true } : {}),
      onEvent: (event: SDKMessage) => {
        for (const ae of toAgentEvents(event)) {
          const rendered = renderStreamEvent(ae, { quietStatus: true });
          if (rendered.stdout) io.stdout.write(rendered.stdout);
          if (rendered.stderr) {
            io.stderr.write(rendered.stderr);
            logJobLine(stateDir, job.id, rendered.stderr.replace(/\n$/, ""));
          }
        }
      },
    });

    markRunning(stateDir, job.id, { agentId: result.agentId, runId: result.runId });
    markFinished(stateDir, job.id, result);

    if (flags.json) {
      io.stdout.write(`${JSON.stringify({ jobId: job.id, ...result })}\n`);
    } else if (!result.output.endsWith("\n")) {
      io.stdout.write("\n");
    }

    return result.status === "finished" ? 0 : 1;
  } catch (err) {
    markFailed(stateDir, job.id, err instanceof Error ? err.message : String(err));
    throw err;
  } finally {
    await disposeAgent(agent).catch(() => undefined);
  }
}

/**
 * Background mode: kick off the run, persist its events to the per-job log,
 * and return immediately. The CLI process exits right after; the run keeps
 * going under the SDK's local runtime. Cancellation of a background run
 * falls back to `run-not-active` + persisted-mark in the calling process.
 */
function detachBackgroundRun(
  agent: Awaited<ReturnType<typeof createAgent>>,
  prompt: string,
  flags: TaskFlags,
  stateDir: string,
  jobId: string,
): void {
  void (async () => {
    try {
      const result = await sendTask(agent, prompt, {
        ...(flags.timeoutMs ? { timeoutMs: flags.timeoutMs } : {}),
        ...(flags.force ? { force: true } : {}),
        onEvent: (event: SDKMessage) => {
          for (const ae of toAgentEvents(event)) {
            const rendered = renderStreamEvent(ae);
            if (rendered.stdout) logJobLine(stateDir, jobId, rendered.stdout.replace(/\n$/, ""));
            if (rendered.stderr) logJobLine(stateDir, jobId, rendered.stderr.replace(/\n$/, ""));
          }
        },
      });
      markRunning(stateDir, jobId, { agentId: result.agentId, runId: result.runId });
      markFinished(stateDir, jobId, result);
    } catch (err) {
      markFailed(stateDir, jobId, err instanceof Error ? err.message : String(err));
    } finally {
      await disposeAgent(agent).catch(() => undefined);
    }
  })();
}
