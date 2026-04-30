import { describe, expect, it } from "vitest";

import type { AgentEvent } from "../../../plugins/cursor/scripts/lib/cursor-agent.mjs";
import {
  compactText,
  formatDuration,
  type ReviewOutput,
  renderError,
  renderJobTable,
  renderReviewResult,
  renderStreamEvent,
  summarizeToolArgs,
} from "../../../plugins/cursor/scripts/lib/render.mjs";
import type { JobIndexEntry } from "../../../plugins/cursor/scripts/lib/state.mjs";

describe("formatDuration", () => {
  it("renders sub-second values in ms", () => {
    expect(formatDuration(0)).toBe("0ms");
    expect(formatDuration(42)).toBe("42ms");
    expect(formatDuration(999)).toBe("999ms");
  });

  it("renders >=1s in tenths-of-a-second", () => {
    expect(formatDuration(1000)).toBe("1.0s");
    expect(formatDuration(1500)).toBe("1.5s");
    expect(formatDuration(60000)).toBe("60.0s");
  });

  it("guards bad input", () => {
    expect(formatDuration(Number.NaN)).toBe("0ms");
    expect(formatDuration(-5)).toBe("0ms");
  });
});

describe("compactText", () => {
  it("collapses whitespace and trims", () => {
    expect(compactText("  hello\n   world  ")).toBe("hello world");
    expect(compactText("a\t\tb")).toBe("a b");
  });
});

describe("summarizeToolArgs", () => {
  it("picks path/offset/limit for read tools", () => {
    expect(summarizeToolArgs("read_file", { path: "/x/y", offset: 10, limit: 20 })).toBe(
      "path=/x/y offset=10 limit=20",
    );
  });

  it("picks pattern + path for grep tools", () => {
    expect(summarizeToolArgs("grep_text", { pattern: "foo", path: "src/" })).toBe(
      "pattern=foo path=src/",
    );
  });

  it("picks command for shell tools", () => {
    expect(summarizeToolArgs("run_shell", { command: "ls -la" })).toBe("command=ls -la");
  });

  it("falls back to common keys for unknown tool names", () => {
    expect(summarizeToolArgs("xyz_unknown", { path: "p" })).toBe("path=p");
  });

  it("returns undefined when no relevant keys present", () => {
    expect(summarizeToolArgs("read_file", {})).toBeUndefined();
    expect(summarizeToolArgs("read_file", null)).toBeUndefined();
    expect(summarizeToolArgs("read_file", "string")).toBeUndefined();
  });

  it("shortens overlong string values", () => {
    const long = "x".repeat(200);
    const out = summarizeToolArgs("shell", { command: long }) ?? "";
    expect(out.length).toBeLessThanOrEqual("command=".length + 80);
    expect(out.endsWith("...")).toBe(true);
  });
});

describe("renderStreamEvent", () => {
  it("forwards assistant_text to stdout", () => {
    const e: AgentEvent = { type: "assistant_text", text: "hi" };
    expect(renderStreamEvent(e)).toEqual({ stdout: "hi" });
  });

  it("annotates tool events with status, name, and arg summary", () => {
    const e: AgentEvent = {
      type: "tool",
      callId: "c",
      name: "read_file",
      status: "completed",
      args: { path: "/a" },
    };
    expect(renderStreamEvent(e)).toEqual({
      stderr: "[tool] completed read_file path=/a\n",
    });
  });

  it("renders status events; can suppress 'finished' via quietStatus", () => {
    const e: AgentEvent = { type: "status", status: "finished" };
    expect(renderStreamEvent(e)).toEqual({ stderr: "[status] finished\n" });
    expect(renderStreamEvent(e, { quietStatus: true })).toEqual({});
  });

  it("compacts thinking text and skips empty messages", () => {
    expect(renderStreamEvent({ type: "thinking", text: "  multi\nline " })).toEqual({
      stderr: "[thinking] multi line\n",
    });
    expect(renderStreamEvent({ type: "thinking", text: "  \n  " })).toEqual({});
  });

  it("renders task events with status and text", () => {
    expect(renderStreamEvent({ type: "task", status: "started", text: "doing x" })).toEqual({
      stderr: "[task] started doing x\n",
    });
  });

  it("system events produce no output", () => {
    expect(renderStreamEvent({ type: "system" })).toEqual({});
  });
});

describe("renderJobTable", () => {
  it("returns a hint when there are no jobs", () => {
    expect(renderJobTable([])).toBe("(no jobs)\n");
  });

  it("renders aligned columns with derived ages", () => {
    const now = new Date("2026-04-29T12:00:00Z").getTime();
    const jobs: JobIndexEntry[] = [
      {
        id: "abc123",
        type: "task",
        status: "completed",
        createdAt: new Date(now - 30_000).toISOString(),
        updatedAt: new Date(now - 30_000).toISOString(),
        summary: "hello",
      },
      {
        id: "def456",
        type: "review",
        status: "running",
        createdAt: new Date(now - 3_600_000).toISOString(),
        updatedAt: new Date(now - 3_600_000).toISOString(),
      },
    ];
    const out = renderJobTable(jobs, now);
    expect(out).toContain("ID");
    expect(out).toContain("STATUS");
    expect(out).toContain("abc123");
    expect(out).toContain("30s");
    expect(out).toContain("1h");
  });
});

describe("renderReviewResult", () => {
  it("renders verdict, summary, sorted findings, and next steps", () => {
    const review: ReviewOutput = {
      verdict: "needs-attention",
      summary: "Two issues found.",
      findings: [
        {
          severity: "low",
          title: "naming nit",
          body: "rename foo to bar",
          file: "src/foo.ts",
          line_start: 10,
          line_end: 10,
          confidence: 0.4,
          recommendation: "rename",
        },
        {
          severity: "critical",
          title: "auth bypass",
          body: "missing check",
          file: "src/auth.ts",
          line_start: 1,
          line_end: 4,
          confidence: 0.95,
          recommendation: "add guard",
        },
      ],
      next_steps: ["fix auth", "rename foo"],
    };
    const out = renderReviewResult(review);
    expect(out).toContain("verdict: needs-attention");
    expect(out).toContain("findings: 2");
    expect(out.indexOf("[CRITICAL]")).toBeLessThan(out.indexOf("[LOW]"));
    expect(out).toContain("src/auth.ts:1-4");
    expect(out).toContain("src/foo.ts:10");
    expect(out).toContain("→ add guard");
    expect(out).toContain("- fix auth");
  });

  it("handles empty findings cleanly", () => {
    const out = renderReviewResult({
      verdict: "approve",
      summary: "looks good",
      findings: [],
      next_steps: [],
    });
    expect(out).toContain("findings: (none)");
  });
});

describe("renderError", () => {
  it("uses the message of an Error", () => {
    expect(renderError(new Error("boom"))).toBe("error: boom\n");
  });

  it("falls back to String() for non-Errors", () => {
    expect(renderError("plain")).toBe("error: plain\n");
    expect(renderError(42)).toBe("error: 42\n");
  });

  it("scrubs CURSOR_API_KEY from error messages", () => {
    const original = process.env.CURSOR_API_KEY;
    process.env.CURSOR_API_KEY = "key_supersecret_token_12345";
    try {
      const err = new Error("auth failed for key_supersecret_token_12345");
      expect(renderError(err)).toBe("error: auth failed for [REDACTED]\n");
    } finally {
      if (original === undefined) delete process.env.CURSOR_API_KEY;
      else process.env.CURSOR_API_KEY = original;
    }
  });
});
