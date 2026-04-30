#!/usr/bin/env node
import { readFileSync } from "node:fs";

import type { ModelSelection } from "@cursor/sdk";

import { parseReview } from "./commands/review.mjs";
import { oneShot } from "./lib/cursor-agent.mjs";
import { DEFAULT_GATE_TIMEOUT_MS, readGateConfig } from "./lib/gate.mjs";
import { getDiff, getStatus } from "./lib/git.mjs";
import { type ReviewOutput, renderReviewResult } from "./lib/render.mjs";
import { resolveStateDir } from "./lib/state.mjs";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";

/**
 * Stop hook payload as documented for Claude Code. Only the fields we use
 * are typed — the SDK may add more over time.
 */
interface StopHookPayload {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  hook_event_name?: string;
  /** True when Claude was already blocked once this turn — never block again. */
  stop_hook_active?: boolean;
}

export interface StopHookIO {
  /** Synchronously read the hook's stdin (returns "" on TTY / errors). */
  readStdin: () => string;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  cwd: () => string;
}

export interface BlockDecision {
  decision: "block";
  reason: string;
}

const GATE_INSTRUCTIONS = [
  "You are an automated review gate. Claude Code is about to stop and return",
  "  control to the user. Independently review the working-tree diff for",
  "  issues that would be unsafe to merge as-is.",
  "Be conservative: do NOT flag style nits, refactors, or speculative concerns.",
  "Set verdict='needs-attention' ONLY when there is at least one finding with",
  "  severity 'critical' or 'high'. Otherwise set verdict='approve'.",
  "Cite file:line for each finding so Claude can locate it.",
  "Output ONLY a single JSON object matching the schema below — no prose,",
  "  no markdown fences.",
].join("\n");

const SCHEMA = `{
  "verdict": "approve" | "needs-attention",
  "summary": string,
  "findings": [{
    "severity": "critical" | "high" | "medium" | "low",
    "title": string,
    "body": string,
    "file": string,
    "line_start": number,
    "line_end": number,
    "confidence": number,
    "recommendation": string
  }],
  "next_steps": string[]
}`;

function parsePayload(raw: string): StopHookPayload {
  if (!raw.trim()) return {};
  try {
    const data = JSON.parse(raw);
    if (data && typeof data === "object") return data as StopHookPayload;
  } catch {
    // ignore malformed payloads — fail open
  }
  return {};
}

function readStdinSync(): string {
  // readFileSync(0) blocks on a TTY waiting for input. Claude Code always
  // pipes JSON via stdin for hooks; guard the interactive case so a
  // developer running the hook by hand doesn't hang forever.
  if (process.stdin.isTTY) return "";
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function buildPrompt(diff: string, status: string): string {
  return [
    GATE_INSTRUCTIONS,
    "",
    "Output schema:",
    SCHEMA,
    "",
    "Working-tree status:",
    status || "(clean)",
    "",
    "Diff to review:",
    diff,
  ].join("\n");
}

/**
 * Build the `reason` string Claude sees when the gate blocks. We use the
 * same renderer as the `review` subcommand so Claude gets a familiar
 * verdict/findings/next-steps layout.
 */
export function formatBlockReason(review: ReviewOutput): string {
  const header =
    "cursor-plugin-cc Stop review gate found issues that should be addressed " +
    "before stopping. Review the findings, fix them (or explain why they are " +
    "not blocking), then stop again.\n\n";
  return header + renderReviewResult(review);
}

/**
 * Main entry point. Returns the process exit code. Always 0 — the hook
 * communicates block/allow via stdout JSON, never via exit codes (which
 * would be interpreted as infrastructure failures by Claude Code).
 */
export async function main(io: StopHookIO): Promise<number> {
  const payload = parsePayload(io.readStdin());

  // Avoid infinite loops: if Claude was already blocked once, allow.
  if (payload.stop_hook_active === true) return 0;

  const cwd = payload.cwd ?? io.cwd();
  let workspaceRoot: string;
  try {
    workspaceRoot = resolveWorkspaceRoot(cwd);
  } catch {
    return 0;
  }

  const stateDir = resolveStateDir(workspaceRoot);
  const config = readGateConfig(stateDir);
  if (!config.enabled) return 0;

  let diff: string;
  try {
    diff = getDiff(workspaceRoot);
  } catch {
    return 0;
  }
  if (!diff) return 0;

  const prompt = buildPrompt(diff, getStatus(workspaceRoot));

  const oneShotOpts: {
    cwd: string;
    timeoutMs: number;
    model?: ModelSelection;
  } = {
    cwd: workspaceRoot,
    timeoutMs: config.timeoutMs ?? DEFAULT_GATE_TIMEOUT_MS,
  };
  if (config.model) oneShotOpts.model = config.model;

  let result: Awaited<ReturnType<typeof oneShot>>;
  try {
    result = await oneShot(prompt, oneShotOpts);
  } catch (err) {
    // Never block on infra failure — surface to stderr so the user can see
    // why the gate didn't run, then allow.
    io.stderr.write(
      `cursor-plugin-cc gate: review failed (${err instanceof Error ? err.message : String(err)}); allowing.\n`,
    );
    return 0;
  }

  if (result.status !== "finished") {
    io.stderr.write(`cursor-plugin-cc gate: review did not finish (${result.status}); allowing.\n`);
    return 0;
  }

  let review: ReviewOutput;
  try {
    review = parseReview(result.output);
  } catch (err) {
    io.stderr.write(
      `cursor-plugin-cc gate: could not parse review output (${err instanceof Error ? err.message : String(err)}); allowing.\n`,
    );
    return 0;
  }

  if (review.verdict === "approve") return 0;

  const decision: BlockDecision = {
    decision: "block",
    reason: formatBlockReason(review),
  };
  io.stdout.write(JSON.stringify(decision));
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const code = await main({
    readStdin: readStdinSync,
    stdout: process.stdout,
    stderr: process.stderr,
    cwd: () => process.cwd(),
  });
  process.exit(code);
}
