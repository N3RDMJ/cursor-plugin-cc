import type { ModelSelection } from "@cursor/sdk";

import type { CommandIO, ExitCode } from "../cursor-companion.mjs";
import { bool, optionalString, parseArgs } from "../lib/args.mjs";
import { oneShot } from "../lib/cursor-agent.mjs";
import { getDiff, getStatus } from "../lib/git.mjs";
import { createJob, markFailed, markFinished } from "../lib/job-control.mjs";
import { type ReviewOutput, renderReviewResult } from "../lib/render.mjs";
import { ensureStateDir, resolveStateDir } from "../lib/state.mjs";
import { resolveWorkspaceRoot } from "../lib/workspace.mjs";

const HELP = `cursor-companion review [flags]
cursor-companion adversarial-review [flags]

Review the working-tree diff (or staged diff with --staged). Returns a
structured ReviewOutput JSON: verdict, summary, findings[], next_steps[].

flags:
  --staged             Review staged changes only (git diff --cached)
  --base <ref>         Diff against this ref instead of working tree
  --model <id>         Override the default model
  --timeout <ms>       Cancel the review if it exceeds this duration
  --json               Print the raw structured review JSON
  --help, -h
`;

const REVIEW_INSTRUCTIONS = [
  "You are a senior code reviewer doing a focused review of a small change.",
  "Be precise and concrete. Cite the exact file:line that triggers each finding.",
  "Distinguish severity: critical (likely to break prod), high (clear bug or security issue),",
  "  medium (correctness/design concern), low (style/nit).",
  "Confidence is 0.0–1.0; be honest, do not bluff at 1.0.",
  "Output ONLY a single JSON object matching the schema below — no prose, no markdown fences.",
].join("\n");

const ADVERSARIAL_INSTRUCTIONS = [
  "You are an adversarial reviewer. Your job is to challenge design choices,",
  "  not just hunt for defects. Push back on premature abstractions, hidden coupling,",
  "  unnecessary state, brittle assumptions, and missing edge cases.",
  "Be precise: cite file:line for each finding. Don't manufacture issues — if the",
  "  change is genuinely simple and correct, say so and approve.",
  "Output ONLY a single JSON object matching the schema below — no prose, no markdown fences.",
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

interface ReviewFlags {
  staged: boolean;
  baseRef?: string;
  model?: ModelSelection;
  timeoutMs?: number;
  json: boolean;
}

class HelpRequested extends Error {}

function parseFlags(args: readonly string[]): ReviewFlags {
  const parsed = parseArgs(args, {
    long: {
      staged: "boolean",
      base: "string",
      model: "string",
      timeout: "string",
      json: "boolean",
      help: "boolean",
    },
    short: { h: "help", m: "model" },
  });
  if (bool(parsed, "help")) throw new HelpRequested();
  const flags: ReviewFlags = {
    staged: bool(parsed, "staged"),
    json: bool(parsed, "json"),
  };
  const base = optionalString(parsed, "base");
  if (base) flags.baseRef = base;
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

function buildReviewPrompt(diff: string, status: string, instructions: string): string {
  return [
    instructions,
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
 * Tolerant JSON extraction: agents sometimes wrap output in ```json fences
 * despite instructions. Strip surrounding fences before parsing.
 */
function extractJson(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenced) return fenced[1] ?? trimmed;
  return trimmed;
}

function parseReview(raw: string): ReviewOutput {
  const text = extractJson(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `review output was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!parsed || typeof parsed !== "object") throw new Error("review output is not an object");
  const obj = parsed as Record<string, unknown>;
  if (obj.verdict !== "approve" && obj.verdict !== "needs-attention") {
    throw new Error(`review verdict is invalid: ${JSON.stringify(obj.verdict)}`);
  }
  if (typeof obj.summary !== "string") throw new Error("review summary missing");
  if (!Array.isArray(obj.findings)) throw new Error("review findings must be an array");
  if (!Array.isArray(obj.next_steps)) throw new Error("review next_steps must be an array");
  return parsed as ReviewOutput;
}

export interface RunReviewOptions {
  adversarial: boolean;
}

export async function runReview(
  args: readonly string[],
  io: CommandIO,
  options: RunReviewOptions,
): Promise<ExitCode> {
  let flags: ReviewFlags;
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

  const diffOpts: { staged?: boolean; baseRef?: string } = {};
  if (flags.staged) diffOpts.staged = true;
  if (flags.baseRef) diffOpts.baseRef = flags.baseRef;
  const diff = getDiff(workspaceRoot, diffOpts);
  if (!diff) {
    io.stderr.write("nothing to review (empty diff)\n");
    return 0;
  }

  const instructions = options.adversarial ? ADVERSARIAL_INSTRUCTIONS : REVIEW_INSTRUCTIONS;
  const prompt = buildReviewPrompt(diff, getStatus(workspaceRoot), instructions);

  const job = createJob(stateDir, {
    type: options.adversarial ? "adversarial-review" : "review",
    prompt: `${options.adversarial ? "adversarial-" : ""}review of ${flags.staged ? "staged" : "working-tree"} diff`,
  });

  const oneShotOpts: Parameters<typeof oneShot>[1] = { cwd: workspaceRoot };
  if (flags.model) oneShotOpts.model = flags.model;
  if (flags.timeoutMs) oneShotOpts.timeoutMs = flags.timeoutMs;

  let result: Awaited<ReturnType<typeof oneShot>>;
  try {
    result = await oneShot(prompt, oneShotOpts);
  } catch (err) {
    markFailed(stateDir, job.id, err instanceof Error ? err.message : String(err));
    throw err;
  }

  markFinished(stateDir, job.id, result);

  if (result.status !== "finished") {
    io.stderr.write(`review run did not finish: ${result.status}\n`);
    return 1;
  }

  let review: ReviewOutput;
  try {
    review = parseReview(result.output);
  } catch (err) {
    io.stderr.write(
      `failed to parse review output: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    io.stderr.write("raw output:\n");
    io.stderr.write(result.output);
    if (!result.output.endsWith("\n")) io.stderr.write("\n");
    return 1;
  }

  if (flags.json) {
    io.stdout.write(`${JSON.stringify(review, null, 2)}\n`);
  } else {
    io.stdout.write(renderReviewResult(review));
  }
  return review.verdict === "approve" ? 0 : 1;
}
