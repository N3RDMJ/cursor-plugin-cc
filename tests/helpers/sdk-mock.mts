/**
 * Shared @cursor/sdk mock factory.
 *
 * Builders only — the `vi.mock("@cursor/sdk", ...)` call has to live in the
 * test file because Vitest hoists it. Tests typically use `vi.hoisted` to
 * declare the mock state, then wire `Agent.create` / `Cursor.me` to it.
 */

import type {
  Run,
  RunOperation,
  RunResult,
  RunStatus,
  SDKAgent,
  SDKMessage,
  SDKToolUseMessage,
} from "@cursor/sdk";
import { vi } from "vitest";

export interface MakeRunOptions {
  events?: SDKMessage[];
  result: RunResult;
  /** Override `run.supports(op)`. Default: always true. */
  supports?: (op: RunOperation) => boolean;
  unsupportedReason?: string;
}

export function makeRun(opts: MakeRunOptions): Run {
  let status: RunStatus = "running";
  const events = opts.events ?? [];
  return {
    id: opts.result.id,
    agentId: "agent-test",
    get status() {
      return status;
    },
    get result() {
      return opts.result.result;
    },
    get model() {
      return opts.result.model;
    },
    get durationMs() {
      return opts.result.durationMs;
    },
    get git() {
      return opts.result.git;
    },
    supports: opts.supports ?? (() => true),
    unsupportedReason: () => opts.unsupportedReason,
    async *stream() {
      for (const event of events) yield event;
    },
    async conversation() {
      return [];
    },
    async wait() {
      status = opts.result.status;
      return opts.result;
    },
    async cancel() {
      status = "cancelled";
    },
    onDidChangeStatus() {
      return () => undefined;
    },
  };
}

export function fakeAgent(run: Run, agentId = run.agentId): SDKAgent {
  return {
    agentId,
    model: undefined,
    send: vi.fn(async () => run),
    close: vi.fn(),
    reload: vi.fn(),
    listArtifacts: vi.fn(async () => []),
    downloadArtifact: vi.fn(async () => Buffer.alloc(0)),
    [Symbol.asyncDispose]: vi.fn(async () => undefined),
  };
}

export function assistantText(runId: string, ...chunks: string[]): SDKMessage {
  return {
    type: "assistant",
    agent_id: "agent-test",
    run_id: runId,
    message: {
      role: "assistant",
      content: chunks.map((text) => ({ type: "text" as const, text })),
    },
  };
}

export function toolCallEvent(
  runId: string,
  callId: string,
  name: string,
  status: "running" | "completed" | "error",
  extra: { args?: unknown; result?: unknown } = {},
): SDKToolUseMessage {
  const msg: SDKToolUseMessage = {
    type: "tool_call",
    agent_id: "agent-test",
    run_id: runId,
    call_id: callId,
    name,
    status,
  };
  if (extra.args !== undefined) msg.args = extra.args;
  if (extra.result !== undefined) msg.result = extra.result;
  return msg;
}
