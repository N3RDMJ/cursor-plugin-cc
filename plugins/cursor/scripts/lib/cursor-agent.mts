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
  type SettingSource,
} from "@cursor/sdk";

export const DEFAULT_MODEL: ModelSelection = { id: "composer-2" };

export type CursorAgentStatus = "finished" | "error" | "cancelled" | "expired";

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
}

export interface SendTaskOptions {
  /** Cancel the run if it does not complete within this many milliseconds. */
  timeoutMs?: number;
  /** Invoked once for every SDKMessage emitted while the run streams. */
  onEvent?: (event: SDKMessage) => void;
}

export type OneShotOptions = CursorAgentOptions & SendTaskOptions;

interface RequestOptions {
  apiKey?: string;
}

/**
 * Resolve a Cursor API key from the supplied option or `CURSOR_API_KEY`.
 * Throws a ConfigurationError when neither is set so callers fail fast with
 * a clear message instead of a generic 401 from the SDK.
 */
export function resolveApiKey(apiKey?: string): string {
  const resolved = apiKey ?? process.env.CURSOR_API_KEY;
  if (!resolved || resolved.trim() === "") {
    throw new ConfigurationError(
      "CURSOR_API_KEY is not set. Export your Cursor API key or pass apiKey explicitly.",
    );
  }
  return resolved;
}

function buildAgentOptions(opts: CursorAgentOptions): AgentOptions {
  return {
    apiKey: resolveApiKey(opts.apiKey),
    model: opts.model ?? DEFAULT_MODEL,
    local: {
      cwd: opts.cwd,
      ...(opts.settingSources ? { settingSources: opts.settingSources } : {}),
    },
    ...(opts.name ? { name: opts.name } : {}),
    ...(opts.mcpServers ? { mcpServers: opts.mcpServers } : {}),
  };
}

export async function createAgent(opts: CursorAgentOptions): Promise<SDKAgent> {
  return Agent.create(buildAgentOptions(opts));
}

export async function resumeAgent(agentId: string, opts: CursorAgentOptions): Promise<SDKAgent> {
  return Agent.resume(agentId, buildAgentOptions(opts));
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
  const run = await agent.send(prompt);
  return collectRunResult(run, options);
}

/**
 * One-shot helper: create + send + dispose. Built on the same pipeline as
 * `sendTask` so streaming, tool-call aggregation, and timeoutMs all apply.
 * Disposal failures are swallowed so the run's result remains the primary
 * signal to callers.
 */
export async function oneShot(prompt: string, opts: OneShotOptions): Promise<CursorRunResult> {
  const { timeoutMs, onEvent, ...agentOpts } = opts;
  const agent = await createAgent(agentOpts);
  try {
    const sendOpts: SendTaskOptions = {};
    if (timeoutMs !== undefined) sendOpts.timeoutMs = timeoutMs;
    if (onEvent !== undefined) sendOpts.onEvent = onEvent;
    return await sendTask(agent, prompt, sendOpts);
  } finally {
    await disposeAgent(agent).catch(() => {
      /* dispose is best-effort; primary result is what callers care about */
    });
  }
}

export async function listArtifacts(agent: SDKAgent): Promise<SDKArtifact[]> {
  return agent.listArtifacts();
}

export async function downloadArtifact(agent: SDKAgent, path: string): Promise<Buffer> {
  return agent.downloadArtifact(path);
}

/** Verify CURSOR_API_KEY by hitting the account endpoint. */
export async function whoami(opts: RequestOptions = {}): Promise<SDKUser> {
  return Cursor.me({ apiKey: resolveApiKey(opts.apiKey) });
}

export async function listModels(opts: RequestOptions = {}): Promise<SDKModel[]> {
  return Cursor.models.list({ apiKey: resolveApiKey(opts.apiKey) });
}

/** Confirm a ModelSelection.id is in the catalog. Throws on miss. */
export async function validateModel(
  model: ModelSelection,
  opts: RequestOptions = {},
): Promise<SDKModel> {
  const models = await listModels(opts);
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

async function collectRunResult(run: Run, options: SendTaskOptions): Promise<CursorRunResult> {
  const toolCalls = new Map<string, ToolCallEvent>();
  const textParts: string[] = [];
  let observedTerminalStatus: CursorAgentStatus | undefined;
  let timedOut = false;

  const timeout =
    options.timeoutMs !== undefined && options.timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          run.cancel().catch(() => {
            /* run may already be terminal; swallow */
          });
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
