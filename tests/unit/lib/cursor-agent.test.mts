import type {
  Run,
  RunOperation,
  RunResult,
  RunStatus,
  SDKAgent,
  SDKMessage,
  SDKModel,
} from "@cursor/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdkMocks = vi.hoisted(() => ({
  agentCreate: vi.fn(),
  agentResume: vi.fn(),
  cursorMe: vi.fn(),
  modelsList: vi.fn(),
}));

vi.mock("@cursor/sdk", async () => {
  const actual = await vi.importActual<typeof import("@cursor/sdk")>("@cursor/sdk");
  return {
    ...actual,
    Agent: {
      create: sdkMocks.agentCreate,
      resume: sdkMocks.agentResume,
    },
    Cursor: {
      me: sdkMocks.cursorMe,
      models: { list: sdkMocks.modelsList },
    },
  };
});

import {
  createAgent,
  DEFAULT_MODEL,
  disposeAgent,
  listModels,
  normalizeStreamStatus,
  oneShot,
  resolveApiKey,
  resumeAgent,
  sendTask,
  validateModel,
  whoami,
} from "../../../plugins/cursor/scripts/lib/cursor-agent.mjs";

function makeRun(events: SDKMessage[], result: RunResult): Run {
  let status: RunStatus = "running";
  return {
    id: result.id,
    agentId: "agent-test",
    get status() {
      return status;
    },
    get result() {
      return result.result;
    },
    get model() {
      return result.model;
    },
    get durationMs() {
      return result.durationMs;
    },
    get git() {
      return result.git;
    },
    supports(_op: RunOperation) {
      return true;
    },
    unsupportedReason() {
      return undefined;
    },
    async *stream() {
      for (const event of events) yield event;
    },
    async conversation() {
      return [];
    },
    async wait() {
      status = result.status;
      return result;
    },
    async cancel() {
      status = "cancelled";
    },
    onDidChangeStatus() {
      return () => undefined;
    },
  };
}

function fakeAgent(run: Run): SDKAgent {
  return {
    agentId: run.agentId,
    model: undefined,
    send: vi.fn(async () => run),
    close: vi.fn(),
    reload: vi.fn(),
    listArtifacts: vi.fn(async () => []),
    downloadArtifact: vi.fn(async () => Buffer.alloc(0)),
    [Symbol.asyncDispose]: vi.fn(async () => undefined),
  };
}

beforeEach(() => {
  process.env.CURSOR_API_KEY = "test-key";
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.CURSOR_API_KEY;
});

describe("resolveApiKey", () => {
  it("returns the explicit value when provided", () => {
    expect(resolveApiKey("explicit")).toBe("explicit");
  });

  it("falls back to CURSOR_API_KEY", () => {
    process.env.CURSOR_API_KEY = "from-env";
    expect(resolveApiKey()).toBe("from-env");
  });

  it("throws ConfigurationError when neither is set", () => {
    delete process.env.CURSOR_API_KEY;
    expect(() => resolveApiKey()).toThrow(/CURSOR_API_KEY/);
  });

  it("treats whitespace-only keys as missing", () => {
    expect(() => resolveApiKey("   ")).toThrow(/CURSOR_API_KEY/);
  });
});

describe("normalizeStreamStatus", () => {
  it("lowercases all SDK status-message values", () => {
    expect(normalizeStreamStatus("CREATING")).toBe("creating");
    expect(normalizeStreamStatus("RUNNING")).toBe("running");
    expect(normalizeStreamStatus("FINISHED")).toBe("finished");
    expect(normalizeStreamStatus("ERROR")).toBe("error");
    expect(normalizeStreamStatus("CANCELLED")).toBe("cancelled");
    expect(normalizeStreamStatus("EXPIRED")).toBe("expired");
  });
});

describe("createAgent / resumeAgent", () => {
  it("createAgent forwards cwd, default model, and resolved apiKey", async () => {
    const fake = fakeAgent(makeRun([], { id: "r1", status: "finished" }));
    sdkMocks.agentCreate.mockResolvedValue(fake);

    await createAgent({ cwd: "/tmp/repo" });

    expect(sdkMocks.agentCreate).toHaveBeenCalledTimes(1);
    const call = sdkMocks.agentCreate.mock.calls[0]?.[0];
    expect(call).toMatchObject({
      apiKey: "test-key",
      model: DEFAULT_MODEL,
      local: { cwd: "/tmp/repo" },
    });
  });

  it("createAgent honors model override and settingSources", async () => {
    const fake = fakeAgent(makeRun([], { id: "r1", status: "finished" }));
    sdkMocks.agentCreate.mockResolvedValue(fake);

    await createAgent({
      cwd: "/tmp/repo",
      model: { id: "gpt-5" },
      settingSources: ["project", "user"],
    });

    const call = sdkMocks.agentCreate.mock.calls[0]?.[0];
    expect(call?.model).toEqual({ id: "gpt-5" });
    expect(call?.local).toEqual({ cwd: "/tmp/repo", settingSources: ["project", "user"] });
  });

  it("createAgent forwards mcpServers", async () => {
    const fake = fakeAgent(makeRun([], { id: "r1", status: "finished" }));
    sdkMocks.agentCreate.mockResolvedValue(fake);

    await createAgent({
      cwd: "/tmp/repo",
      mcpServers: { fs: { command: "mcp-fs" } },
    });

    const call = sdkMocks.agentCreate.mock.calls[0]?.[0];
    expect(call?.mcpServers).toEqual({ fs: { command: "mcp-fs" } });
  });

  it("createAgent omits 'name' when not provided", async () => {
    const fake = fakeAgent(makeRun([], { id: "r1", status: "finished" }));
    sdkMocks.agentCreate.mockResolvedValue(fake);

    await createAgent({ cwd: "/tmp/repo" });

    const call = sdkMocks.agentCreate.mock.calls[0]?.[0];
    expect(call).not.toHaveProperty("name");
  });

  it("resumeAgent passes the agentId through", async () => {
    const fake = fakeAgent(makeRun([], { id: "r1", status: "finished" }));
    sdkMocks.agentResume.mockResolvedValue(fake);

    await resumeAgent("agent-xyz", { cwd: "/tmp/repo" });

    expect(sdkMocks.agentResume).toHaveBeenCalledWith(
      "agent-xyz",
      expect.objectContaining({ apiKey: "test-key", local: { cwd: "/tmp/repo" } }),
    );
  });

  it("disposeAgent calls Symbol.asyncDispose", async () => {
    const fake = fakeAgent(makeRun([], { id: "r1", status: "finished" }));
    await disposeAgent(fake);
    expect(fake[Symbol.asyncDispose]).toHaveBeenCalledTimes(1);
  });
});

describe("sendTask", () => {
  it("aggregates assistant text and tool calls, returns the SDK result status", async () => {
    const events: SDKMessage[] = [
      {
        type: "assistant",
        agent_id: "agent-test",
        run_id: "run-1",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "hello " },
            { type: "text", text: "world" },
          ],
        },
      },
      {
        type: "tool_call",
        agent_id: "agent-test",
        run_id: "run-1",
        call_id: "c1",
        name: "edit",
        status: "running",
      },
      {
        type: "tool_call",
        agent_id: "agent-test",
        run_id: "run-1",
        call_id: "c1",
        name: "edit",
        status: "completed",
        result: { ok: true },
      },
    ];
    const run = makeRun(events, {
      id: "run-1",
      status: "finished",
      durationMs: 42,
    });
    const agent = fakeAgent(run);
    const seen: SDKMessage[] = [];

    const result = await sendTask(agent, "do thing", {
      onEvent: (e) => seen.push(e),
    });

    expect(result.status).toBe("finished");
    expect(result.output).toBe("hello world");
    expect(result.toolCalls).toEqual([
      {
        callId: "c1",
        name: "edit",
        status: "completed",
        args: undefined,
        result: { ok: true },
      },
    ]);
    expect(result.runId).toBe("run-1");
    expect(result.durationMs).toBe(42);
    expect(seen).toHaveLength(events.length);
    expect(agent.send).toHaveBeenCalledWith("do thing");
  });

  it("prefers the SDK-provided result string over aggregated text", async () => {
    const events: SDKMessage[] = [
      {
        type: "assistant",
        agent_id: "agent-test",
        run_id: "run-2",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "interim" }],
        },
      },
    ];
    const run = makeRun(events, {
      id: "run-2",
      status: "finished",
      result: "final answer",
    });
    const result = await sendTask(fakeAgent(run), "go");
    expect(result.output).toBe("final answer");
  });

  it("propagates EXPIRED stream status over RunResult.status", async () => {
    const events: SDKMessage[] = [
      {
        type: "status",
        agent_id: "agent-test",
        run_id: "run-3",
        status: "EXPIRED",
      },
    ];
    const run = makeRun(events, { id: "run-3", status: "error" });
    const result = await sendTask(fakeAgent(run), "go");
    expect(result.status).toBe("expired");
  });

  it("cancels the run when the timeout fires and reports cancelled", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });

    const slowEvents: SDKMessage[] = [];
    async function* slowStream(): AsyncGenerator<SDKMessage, void> {
      await blocker;
      for (const e of slowEvents) yield e;
    }

    const run: Run = {
      id: "run-4",
      agentId: "agent-test",
      status: "running",
      result: undefined,
      model: undefined,
      durationMs: undefined,
      git: undefined,
      supports: () => true,
      unsupportedReason: () => undefined,
      stream: slowStream,
      conversation: async () => [],
      wait: async () => ({ id: "run-4", status: "cancelled" }),
      cancel: vi.fn(async () => {
        release();
      }),
      onDidChangeStatus: () => () => undefined,
    };

    const agent = fakeAgent(run);
    const promise = sendTask(agent, "go", { timeoutMs: 10 });
    await vi.advanceTimersByTimeAsync(20);
    const result = await promise;
    vi.useRealTimers();

    expect(run.cancel).toHaveBeenCalled();
    expect(result.status).toBe("cancelled");
    expect(result.timedOut).toBe(true);
  });
});

describe("oneShot", () => {
  it("creates an agent, runs the prompt, and disposes the agent", async () => {
    const events: SDKMessage[] = [
      {
        type: "assistant",
        agent_id: "agent-test",
        run_id: "run-5",
        message: { role: "assistant", content: [{ type: "text", text: "done" }] },
      },
    ];
    const run = makeRun(events, { id: "run-5", status: "finished", durationMs: 5 });
    const fake = fakeAgent(run);
    sdkMocks.agentCreate.mockResolvedValue(fake);

    const result = await oneShot("ping", { cwd: "/tmp/repo" });

    expect(sdkMocks.agentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "test-key",
        model: DEFAULT_MODEL,
        local: { cwd: "/tmp/repo" },
      }),
    );
    expect(fake.send).toHaveBeenCalledWith("ping");
    expect(fake[Symbol.asyncDispose]).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: "finished",
      output: "done",
      agentId: "agent-test",
      runId: "run-5",
      durationMs: 5,
    });
  });

  it("disposes the agent even when the run errors", async () => {
    const fake = fakeAgent(makeRun([], { id: "r", status: "finished" }));
    fake.send = vi.fn(async () => {
      throw new Error("send-blew-up");
    });
    sdkMocks.agentCreate.mockResolvedValue(fake);

    await expect(oneShot("ping", { cwd: "/tmp/repo" })).rejects.toThrow("send-blew-up");
    expect(fake[Symbol.asyncDispose]).toHaveBeenCalledTimes(1);
  });

  it("honors timeoutMs and reports cancellation", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slowEvents: SDKMessage[] = [];
    async function* slowStream(): AsyncGenerator<SDKMessage, void> {
      await blocker;
      for (const e of slowEvents) yield e;
    }
    const run: Run = {
      id: "run-6",
      agentId: "agent-test",
      status: "running",
      result: undefined,
      model: undefined,
      durationMs: undefined,
      git: undefined,
      supports: () => true,
      unsupportedReason: () => undefined,
      stream: slowStream,
      conversation: async () => [],
      wait: async () => ({ id: "run-6", status: "cancelled" }),
      cancel: vi.fn(async () => {
        release();
      }),
      onDidChangeStatus: () => () => undefined,
    };
    const fake = fakeAgent(run);
    sdkMocks.agentCreate.mockResolvedValue(fake);

    const promise = oneShot("ping", { cwd: "/tmp/repo", timeoutMs: 10 });
    await vi.advanceTimersByTimeAsync(20);
    const result = await promise;
    vi.useRealTimers();

    expect(run.cancel).toHaveBeenCalled();
    expect(result.status).toBe("cancelled");
    expect(result.timedOut).toBe(true);
    expect(fake[Symbol.asyncDispose]).toHaveBeenCalledTimes(1);
  });
});

describe("Cursor account helpers", () => {
  it("whoami forwards apiKey", async () => {
    sdkMocks.cursorMe.mockResolvedValue({ apiKeyName: "test", createdAt: "0" });
    await whoami();
    expect(sdkMocks.cursorMe).toHaveBeenCalledWith({ apiKey: "test-key" });
  });

  it("listModels returns the SDK list", async () => {
    const list: SDKModel[] = [{ id: "composer-2", displayName: "Composer 2" }];
    sdkMocks.modelsList.mockResolvedValue(list);
    await expect(listModels()).resolves.toEqual(list);
  });

  it("validateModel returns the matching entry", async () => {
    const list: SDKModel[] = [
      { id: "composer-2", displayName: "Composer 2" },
      { id: "gpt-5", displayName: "GPT 5" },
    ];
    sdkMocks.modelsList.mockResolvedValue(list);
    const found = await validateModel({ id: "gpt-5" });
    expect(found.id).toBe("gpt-5");
  });

  it("validateModel throws ConfigurationError for an unknown model", async () => {
    sdkMocks.modelsList.mockResolvedValue([{ id: "composer-2", displayName: "Composer 2" }]);
    await expect(validateModel({ id: "imaginary" })).rejects.toThrow(/imaginary/);
  });
});
