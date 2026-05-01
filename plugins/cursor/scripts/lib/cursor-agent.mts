import {
  Agent,
  type AgentOptions,
  ConfigurationError,
  Cursor,
  type McpServerConfig,
  type ModelSelection,
  type Run,
  type SDKAgent,
  type SDKArtifact,
  type SDKMessage,
  type SDKModel,
  type SDKStatusMessage,
  type SDKUser,
  type SendOptions,
  type SettingSource,
} from "@cursor/sdk";

import {
  type KeySource,
  type ResolvedKey,
  resolveApiKeyFromKeychain,
  setActiveKeychainSecret,
} from "./credentials.mjs";
import { detectCloudRepository } from "./git.mjs";
import { type RetryOptions, withRetry } from "./retry.mjs";
import { resolveDefaultModel } from "./user-config.mjs";

export const DEFAULT_MODEL: ModelSelection = { id: "composer-2" };

export type CursorAgentStatus = "finished" | "error" | "cancelled" | "expired";

export type AgentMode = "local" | "cloud";

export interface CloudRepo {
  url: string;
  startingRef?: string;
}

export interface ToolCallEvent {
  callId: string;
  name: string;
  status: "running" | "completed" | "error";
  args?: unknown;
  result?: unknown;
}

export interface CursorRunResult {
  status: CursorAgentStatus;
  output: string;
  toolCalls: ToolCallEvent[];
  agentId: string;
  runId: string;
  durationMs?: number;
  /** Set when the run was terminated by our local timeout. */
  timedOut?: boolean;
}

export interface CursorAgentOptions {
  cwd: string;
  apiKey?: string;
  model?: ModelSelection;
  mcpServers?: Record<string, McpServerConfig>;
  settingSources?: SettingSource[];
  name?: string;
  /** Execution mode. Defaults to "local". */
  mode?: AgentMode;
  /** Required when mode === "cloud". */
  cloudRepo?: CloudRepo;
}

export interface SendTaskOptions {
  /** Cancel the run if it does not complete within this many milliseconds. */
  timeoutMs?: number;
  /** Invoked once for every SDKMessage emitted while the run streams. */
  onEvent?: (event: SDKMessage) => void;
  /**
   * Fires once `agent.send` resolves and we have a `Run` — before any events
   * are streamed. Lets callers stamp job state to "running" and register the
   * Run for capability-checked cancellation while the work is in flight.
   */
  onRunStart?: (run: Run) => void;
  /**
   * Local-only: expire the agent's currently-active persisted run before
   * starting this one. Recovery path when a previous CLI process crashed
   * mid-run and left the agent wedged.
   */
  force?: boolean;
}

export type OneShotOptions = CursorAgentOptions & SendTaskOptions;

export interface CancelResult {
  cancelled: boolean;
  reason?: string;
}

export interface RequestOptions {
  apiKey?: string;
  /**
   * Override the default retry policy used for short-lived SDK calls
   * (whoami, listModels, validateModel). Pass `{ attempts: 1 }` to disable.
   */
  retry?: RetryOptions;
}

/**
 * Synchronous fast-path: resolve from explicit value or env var. Does not
 * check the keychain — use `resolveApiKeyAsync` when the full chain is needed.
 */
export function resolveApiKeySync(apiKey?: string): string | undefined {
  const resolved = apiKey ?? process.env.CURSOR_API_KEY;
  if (resolved && resolved.trim() !== "") return resolved;
  return undefined;
}

export interface ResolvedApiKey {
  apiKey: string;
  source: KeySource;
}

/**
 * Resolve a Cursor API key: explicit → env → OS keychain → error.
 * The keychain lookup is async (shells out to secret-tool / security).
 * Stamps the keychain secret into the redaction registry when used.
 */
export async function resolveApiKey(apiKey?: string): Promise<ResolvedApiKey> {
  if (apiKey && apiKey.trim() !== "") {
    return { apiKey, source: "explicit" };
  }
  const env = process.env.CURSOR_API_KEY;
  if (env && env.trim() !== "") {
    return { apiKey: env, source: "env" };
  }
  let keychainResult: ResolvedKey | undefined;
  try {
    keychainResult = await resolveApiKeyFromKeychain();
  } catch {
    /* keychain unavailable — fall through to error */
  }
  if (keychainResult) {
    setActiveKeychainSecret(keychainResult.apiKey);
    return { apiKey: keychainResult.apiKey, source: "keychain" };
  }
  throw new ConfigurationError(
    "No API key found. Run /cursor:setup --login to store one in the OS keychain, " +
      "or export CURSOR_API_KEY.",
  );
}

/**
 * Build `CursorAgentOptions` from the subset of flags that command parsers
 * expose to the user (`--model`, `--cloud`). Centralized so task and resume
 * don't carry byte-identical copies. Cloud mode auto-detects the repo via
 * `detectCloudRepository(workspaceRoot)`.
 */
export interface AgentOptionFlagInputs {
  model?: ModelSelection;
  cloud?: boolean;
}

export function buildAgentOptionsFromFlags(
  workspaceRoot: string,
  flags: AgentOptionFlagInputs,
): CursorAgentOptions {
  const opts: CursorAgentOptions = { cwd: workspaceRoot };
  if (flags.model) opts.model = flags.model;
  if (flags.cloud) {
    opts.mode = "cloud";
    opts.cloudRepo = detectCloudRepository(workspaceRoot);
  }
  return opts;
}

async function buildAgentOptions(opts: CursorAgentOptions): Promise<AgentOptions> {
  const { apiKey } = await resolveApiKey(opts.apiKey);
  const model = opts.model ?? resolveDefaultModel(DEFAULT_MODEL).model;
  const mode: AgentMode = opts.mode ?? "local";

  const base: AgentOptions = {
    apiKey,
    model,
    ...(opts.name ? { name: opts.name } : {}),
    ...(opts.mcpServers ? { mcpServers: opts.mcpServers } : {}),
  };

  if (mode === "cloud") {
    if (!opts.cloudRepo) {
      throw new ConfigurationError(
        "Cloud mode requires a cloudRepo (url, optional startingRef). " +
          "Use detectCloudRepository() from lib/git.mts.",
      );
    }
    const repo: { url: string; startingRef?: string } = { url: opts.cloudRepo.url };
    if (opts.cloudRepo.startingRef) repo.startingRef = opts.cloudRepo.startingRef;
    return { ...base, cloud: { repos: [repo] } };
  }

  return {
    ...base,
    local: {
      cwd: opts.cwd,
      ...(opts.settingSources ? { settingSources: opts.settingSources } : {}),
    },
  };
}

export async function createAgent(opts: CursorAgentOptions): Promise<SDKAgent> {
  return Agent.create(await buildAgentOptions(opts));
}

export async function resumeAgent(agentId: string, opts: CursorAgentOptions): Promise<SDKAgent> {
  return Agent.resume(agentId, await buildAgentOptions(opts));
}

export async function disposeAgent(agent: SDKAgent): Promise<void> {
  await agent[Symbol.asyncDispose]();
}

/** Send a prompt, stream events, and resolve to a normalized result. */
export async function sendTask(
  agent: SDKAgent,
  prompt: string,
  options: SendTaskOptions = {},
): Promise<CursorRunResult> {
  const run = options.force
    ? await agent.send(prompt, { local: { force: true } } satisfies SendOptions)
    : await agent.send(prompt);
  options.onRunStart?.(run);
  return collectRunResult(run, options);
}

/**
 * One-shot helper: create + send + dispose. Built on the same pipeline as
 * `sendTask` so streaming, tool-call aggregation, and timeoutMs all apply.
 * Disposal failures are swallowed so the run's result remains the primary
 * signal to callers.
 */
export async function oneShot(prompt: string, opts: OneShotOptions): Promise<CursorRunResult> {
  const { timeoutMs, onEvent, onRunStart, force, ...agentOpts } = opts;
  const agent = await createAgent(agentOpts);
  try {
    const sendOpts: SendTaskOptions = {};
    if (timeoutMs !== undefined) sendOpts.timeoutMs = timeoutMs;
    if (onEvent !== undefined) sendOpts.onEvent = onEvent;
    if (onRunStart !== undefined) sendOpts.onRunStart = onRunStart;
    if (force !== undefined) sendOpts.force = force;
    return await sendTask(agent, prompt, sendOpts);
  } finally {
    await disposeAgent(agent).catch(() => {
      /* dispose is best-effort; primary result is what callers care about */
    });
  }
}

/**
 * Cancel a running operation, checking `run.supports("cancel")` first so the
 * caller gets a clean reason instead of a thrown UnsupportedRunOperationError
 * on agents that can't be cancelled.
 */
export async function cancelRun(run: Run): Promise<CancelResult> {
  if (!run.supports("cancel")) {
    const reason = run.unsupportedReason("cancel") ?? "This run cannot be cancelled.";
    return { cancelled: false, reason };
  }
  await run.cancel();
  return { cancelled: true };
}

export async function listArtifacts(agent: SDKAgent): Promise<SDKArtifact[]> {
  return agent.listArtifacts();
}

export interface RemoteAgentRow {
  agentId: string;
  name: string;
  summary: string;
  /** ms since epoch from the SDK; pass through unchanged. */
  lastModified: number;
  status?: "running" | "finished" | "error";
  archived?: boolean;
  runtime?: "local" | "cloud";
}

/**
 * Enumerate durable agents the SDK knows about for this workspace. Used by
 * `/cursor:resume --list --remote` to surface agents that aren't in our local
 * job index (e.g. created by a previous cursor-plugin-cc install or directly
 * via the SDK).
 *
 * `runtime` defaults to "local" + the supplied cwd. Use `runtime: "cloud"` to
 * list cloud agents — note cloud listing always requires `CURSOR_API_KEY`.
 */
export async function listRemoteAgents(
  options:
    | { cwd: string; runtime?: "local"; limit?: number }
    | { runtime: "cloud"; limit?: number },
): Promise<RemoteAgentRow[]> {
  const limit = options.limit ?? 25;
  const listOpts =
    options.runtime === "cloud"
      ? ({ runtime: "cloud", limit } as const)
      : ({ runtime: "local", cwd: options.cwd, limit } as const);
  const { items } = await Agent.list(listOpts);
  return items.map((info) => ({
    agentId: info.agentId,
    name: info.name,
    summary: info.summary,
    lastModified: info.lastModified,
    ...(info.status ? { status: info.status } : {}),
    ...(info.archived !== undefined ? { archived: info.archived } : {}),
    ...(info.runtime ? { runtime: info.runtime } : {}),
  }));
}

export async function downloadArtifact(agent: SDKAgent, path: string): Promise<Buffer> {
  return agent.downloadArtifact(path);
}

/**
 * Verify CURSOR_API_KEY by hitting the account endpoint. Retries transient
 * network/rate-limit errors via `withRetry`; auth failures (401) propagate
 * unchanged because the SDK marks them non-retryable.
 */
export async function whoami(opts: RequestOptions = {}): Promise<SDKUser> {
  const { apiKey } = await resolveApiKey(opts.apiKey);
  return withRetry(() => Cursor.me({ apiKey }), opts.retry);
}

export async function listModels(opts: RequestOptions = {}): Promise<SDKModel[]> {
  const { apiKey } = await resolveApiKey(opts.apiKey);
  return withRetry(() => Cursor.models.list({ apiKey }), opts.retry);
}

/**
 * Confirm a ModelSelection.id is in the catalog. Throws on miss. Pass
 * `catalog` when you've already fetched the list (e.g. to share one fetch
 * between validation and a subsequent report) — otherwise the catalog is
 * fetched fresh.
 */
export async function validateModel(
  model: ModelSelection,
  opts: RequestOptions & { catalog?: SDKModel[] } = {},
): Promise<SDKModel> {
  const models = opts.catalog ?? (await listModels(opts));
  const match = models.find((m) => m.id === model.id);
  if (!match) {
    const known = models.map((m) => m.id).join(", ") || "(none)";
    throw new ConfigurationError(
      `Model '${model.id}' is not available for this API key. Known models: ${known}`,
    );
  }
  return match;
}

/** Normalize the uppercase status emitted on SDKStatusMessage to our enum. */
export function normalizeStreamStatus(
  status: SDKStatusMessage["status"],
): CursorAgentStatus | "creating" | "running" {
  return status.toLowerCase() as CursorAgentStatus | "creating" | "running";
}

/**
 * Flat representation of a stream event for terminal/UI consumers. One
 * `SDKMessage` may produce 0+ `AgentEvent`s — assistant messages with
 * multiple content blocks emit one per text/tool_use block.
 */
export type AgentEvent =
  | { type: "assistant_text"; text: string }
  | { type: "thinking"; text: string }
  | {
      type: "tool";
      callId: string;
      name: string;
      status: "requested" | "running" | "completed" | "error";
      args?: unknown;
    }
  | {
      type: "status";
      status: CursorAgentStatus | "creating" | "running";
      message?: string;
    }
  | { type: "task"; status?: string; text?: string }
  | { type: "system"; model?: ModelSelection; tools?: string[] };

/**
 * Map a single `SDKMessage` to flat `AgentEvent`s. Inspired by the cookbook's
 * `emitSdkMessage`. Unknown event types are dropped (forward-compatible).
 */
export function toAgentEvents(message: SDKMessage): AgentEvent[] {
  switch (message.type) {
    case "assistant": {
      const events: AgentEvent[] = [];
      for (const block of message.message.content) {
        if (block.type === "text") {
          events.push({ type: "assistant_text", text: block.text });
        } else {
          events.push({
            type: "tool",
            callId: block.id,
            name: block.name,
            status: "requested",
            args: block.input,
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
          args: message.args,
        },
      ];
    case "status":
      return [
        {
          type: "status",
          status: normalizeStreamStatus(message.status),
          ...(message.message ? { message: message.message } : {}),
        },
      ];
    case "task":
      return [
        {
          type: "task",
          ...(message.status ? { status: message.status } : {}),
          ...(message.text ? { text: message.text } : {}),
        },
      ];
    case "system":
      return [
        {
          type: "system",
          ...(message.model ? { model: message.model } : {}),
          ...(message.tools ? { tools: message.tools } : {}),
        },
      ];
    default:
      return [];
  }
}

async function collectRunResult(run: Run, options: SendTaskOptions): Promise<CursorRunResult> {
  const toolCalls = new Map<string, ToolCallEvent>();
  const textParts: string[] = [];
  let observedTerminalStatus: CursorAgentStatus | undefined;
  let timedOut = false;

  const timeout =
    options.timeoutMs !== undefined && options.timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          if (run.supports("cancel")) {
            run.cancel().catch(() => {
              /* run may already be terminal; swallow */
            });
          }
        }, options.timeoutMs)
      : undefined;

  try {
    for await (const event of run.stream()) {
      options.onEvent?.(event);
      ingestEvent(event, textParts, toolCalls);
      if (event.type === "status") {
        const normalized = normalizeStreamStatus(event.status);
        if (
          normalized === "finished" ||
          normalized === "error" ||
          normalized === "cancelled" ||
          normalized === "expired"
        ) {
          observedTerminalStatus = normalized;
        }
      }
    }
    // Stream is drained — clear the timer before awaiting wait() so a
    // late-firing timeout can't flip a naturally-finished run to cancelled.
    if (timeout) clearTimeout(timeout);
    const result = await run.wait();
    const status: CursorAgentStatus = timedOut
      ? "cancelled"
      : (observedTerminalStatus ?? result.status);
    return {
      status,
      output: result.result ?? textParts.join(""),
      toolCalls: [...toolCalls.values()],
      agentId: run.agentId,
      runId: run.id,
      durationMs: result.durationMs,
      ...(timedOut ? { timedOut: true } : {}),
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function ingestEvent(
  event: SDKMessage,
  textParts: string[],
  toolCalls: Map<string, ToolCallEvent>,
): void {
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
      result: event.result,
    });
  }
}
