import type { SDKAgent, SDKMessage } from "@cursor/sdk";

import { disposeAgent, sendTask, toAgentEvents } from "./cursor-agent.mjs";
import {
  logJobLine,
  markFailed,
  markFinished,
  markRunning,
  registerActiveRun,
  unregisterActiveRun,
} from "./job-control.mjs";
import { renderStreamEvent } from "./render.mjs";

export interface IOSink {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

export interface AgentTaskFlags {
  timeoutMs?: number;
  force?: boolean;
  json?: boolean;
}

export interface RunAgentTaskOptions {
  agent: SDKAgent;
  prompt: string;
  flags: AgentTaskFlags;
  io: IOSink;
  stateDir: string;
  jobId: string;
}

/**
 * Foreground run: stream the agent's events to stdout/stderr, persist job
 * transitions, dispose the agent on exit. Ownership of the agent passes to
 * this helper — callers must not dispose it themselves.
 *
 * Returns 0 when the SDK reports `finished`, 1 otherwise. `markFailed` is
 * stamped on the job record before any thrown error is re-raised, so the
 * persisted state always reflects the failure even when the caller re-throws.
 */
export async function runAgentTaskForeground(opts: RunAgentTaskOptions): Promise<0 | 1> {
  const { agent, prompt, flags, io, stateDir, jobId } = opts;
  try {
    const result = await sendTask(agent, prompt, {
      ...(flags.timeoutMs !== undefined ? { timeoutMs: flags.timeoutMs } : {}),
      ...(flags.force ? { force: true } : {}),
      onRunStart: (run) => {
        markRunning(stateDir, jobId, { agentId: run.agentId, runId: run.id });
        registerActiveRun(jobId, run);
      },
      onEvent: (event: SDKMessage) => {
        for (const ae of toAgentEvents(event)) {
          const rendered = renderStreamEvent(ae, { quietStatus: true });
          if (rendered.stdout) io.stdout.write(rendered.stdout);
          if (rendered.stderr) {
            io.stderr.write(rendered.stderr);
            logJobLine(stateDir, jobId, rendered.stderr.replace(/\n$/, ""));
          }
        }
      },
    });

    markFinished(stateDir, jobId, result);

    if (flags.json) {
      io.stdout.write(`${JSON.stringify({ jobId, ...result })}\n`);
    } else if (!result.output.endsWith("\n")) {
      io.stdout.write("\n");
    }

    return result.status === "finished" ? 0 : 1;
  } catch (err) {
    markFailed(stateDir, jobId, err instanceof Error ? err.message : String(err));
    throw err;
  } finally {
    unregisterActiveRun(jobId);
    await disposeAgent(agent).catch(() => undefined);
  }
}

/**
 * Background run: kick off the agent, route both stdout and stderr renderings
 * into the per-job log file, dispose the agent in the IIFE's finally. The
 * caller has already returned the job id to the user, so this is fire-and-
 * forget — Node keeps the process alive until the IIFE resolves.
 */
export function runAgentTaskBackground(opts: Omit<RunAgentTaskOptions, "io">): void {
  const { agent, prompt, flags, stateDir, jobId } = opts;
  void (async () => {
    try {
      const result = await sendTask(agent, prompt, {
        ...(flags.timeoutMs ? { timeoutMs: flags.timeoutMs } : {}),
        ...(flags.force ? { force: true } : {}),
        onRunStart: (run) => {
          markRunning(stateDir, jobId, { agentId: run.agentId, runId: run.id });
          registerActiveRun(jobId, run);
        },
        onEvent: (event: SDKMessage) => {
          for (const ae of toAgentEvents(event)) {
            const rendered = renderStreamEvent(ae);
            if (rendered.stdout) logJobLine(stateDir, jobId, rendered.stdout.replace(/\n$/, ""));
            if (rendered.stderr) logJobLine(stateDir, jobId, rendered.stderr.replace(/\n$/, ""));
          }
        },
      });
      markFinished(stateDir, jobId, result);
    } catch (err) {
      markFailed(stateDir, jobId, err instanceof Error ? err.message : String(err));
    } finally {
      unregisterActiveRun(jobId);
      await disposeAgent(agent).catch(() => undefined);
    }
  })();
}
