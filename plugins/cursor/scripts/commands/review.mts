import type { ModelSelection } from "@cursor/sdk";

import type { CommandIO, ExitCode } from "../cursor-companion.mjs";
import { bool, optionalString, parseArgs, UsageError } from "../lib/args.mjs";
import { oneShot } from "../lib/cursor-agent.mjs";
import { getDiff, getStatus, type ReviewScope, resolveReviewTarget } from "../lib/git.mjs";
import { createJob, markFailed, markFinished, markRunning } from "../lib/job-control.mjs";
import { type ReviewOutput, renderReviewResult } from "../lib/render.mjs";
import { ensureStateDir, resolveStateDir } from "../lib/state.mjs";
import { resolveWorkspaceRoot } from "../lib/workspace.mjs";

const HELP = `cursor-companion review [flags]
cursor-companion adversarial-review [flags] [focus text...]

Review a git diff. Returns a structured ReviewOutput JSON: verdict, summary,
findings[], next_steps[]. Adversarial-review additionally accepts free-form
focus text as positional arguments — those are passed to the reviewer as the
priority axis.

flags:
  --staged             Review staged changes only (git diff --cached)
  --scope <auto|working-tree|branch>
                       Review scope. 'auto' (default) picks working-tree when
                       the tree is dirty, otherwise branch-vs-default-branch.
                       Mutually exclusive with --staged.
  --base <ref>         Diff against this ref. Implies branch scope.
  --model <id>         Override the default model
  --timeout <ms>       Cancel the review if it exceeds this duration
  --json               Print the raw structured review JSON
  --help, -h
`;

const VALID_SCOPES = new Set<ReviewScope>(["auto", "working-tree", "branch"]);

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
  scope: ReviewScope;
  baseRef?: string;
  model?: ModelSelection;
  timeoutMs?: number;
  json: boolean;
  focus: string;
}

class HelpRequested extends Error {}

function parseFlags(args: readonly string[]): ReviewFlags {
  const parsed = parseArgs(args, {
    long: {
      staged: "boolean",
      scope: "string",
      base: "string",
      model: "string",
      timeout: "string",
      json: "boolean",
      help: "boolean",
    },
    short: { h: "help", m: "model" },
  });
  if (bool(parsed, "help")) throw new HelpRequested();
  const staged = bool(parsed, "staged");
  const scopeRaw = optionalString(parsed, "scope");
  if (scopeRaw && !VALID_SCOPES.has(scopeRaw as ReviewScope)) {
    throw new UsageError(
      `invalid --scope: ${scopeRaw} (expected one of ${[...VALID_SCOPES].join(", ")})`,
    );
  }
  if (staged && scopeRaw && scopeRaw !== "working-tree") {
    throw new UsageError("--staged is only compatible with --scope working-tree");
  }
  const flags: ReviewFlags = {
    staged,
    scope: (scopeRaw as ReviewScope | undefined) ?? "auto",
    json: bool(parsed, "json"),
    focus: parsed.positionals.join(" ").trim(),
  };
  const base = optionalString(parsed, "base");
  if (base) flags.baseRef = base;
  const modelId = optionalString(parsed, "model");
  if (modelId) flags.model = { id: modelId };
  const timeout = optionalString(parsed, "timeout");
  if (timeout) {
    const ms = Number(timeout);
    if (!Number.isFinite(ms) || ms <= 0) throw new UsageError(`invalid --timeout: ${timeout}`);
    flags.timeoutMs = ms;
  }
  return flags;
}

interface ReviewPromptInput {
  diff: string;
  status: string;
  instructions: string;
  targetLabel: string;
  focus: string;
}

function buildReviewPrompt(input: ReviewPromptInput): string {
  const sections: string[] = [
    input.instructions,
    "",
    "Output schema:",
    SCHEMA,
    "",
    `Review target: ${input.targetLabel}`,
    "",
  ];
  if (input.focus) {
    sections.push("Reviewer focus (priority axis):", input.focus, "");
  }
  sections.push("Working-tree status:", input.status || "(clean)", "");
  sections.push("Diff to review:", input.diff);
  return sections.join("\n");
}

/**
 * Tolerant JSON extraction: agents sometimes wrap output in ```json fences
 * despite instructions. Strip surrounding fences before parsing.
 */
export function extractJson(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenced) return fenced[1] ?? trimmed;
  return trimmed;
}

export function parseReview(raw: string): ReviewOutput {
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

  if (flags.focus && !options.adversarial) {
    throw new UsageError(
      "free-form focus text is only accepted for adversarial-review (got positional args)",
    );
  }

  const cwd = io.cwd();
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const stateDir = ensureStateDir(resolveStateDir(workspaceRoot));

  const diffOpts: { staged?: boolean; baseRef?: string } = {};
  let targetLabel: string;
  if (flags.staged) {
    diffOpts.staged = true;
    targetLabel = "staged diff";
  } else {
    const target = resolveReviewTarget(workspaceRoot, {
      scope: flags.scope,
      ...(flags.baseRef ? { baseRef: flags.baseRef } : {}),
    });
    if (target.baseRef) diffOpts.baseRef = target.baseRef;
    targetLabel = target.label;
  }
  const diff = getDiff(workspaceRoot, diffOpts);
  if (!diff) {
    io.stderr.write("nothing to review (empty diff)\n");
    return 0;
  }

  const instructions = options.adversarial ? ADVERSARIAL_INSTRUCTIONS : REVIEW_INSTRUCTIONS;
  const prompt = buildReviewPrompt({
    diff,
    status: getStatus(workspaceRoot),
    instructions,
    targetLabel,
    focus: flags.focus,
  });

  const job = createJob(stateDir, {
    type: options.adversarial ? "adversarial-review" : "review",
    prompt: `${options.adversarial ? "adversarial-" : ""}review (${targetLabel})`,
  });

  const oneShotOpts: Parameters<typeof oneShot>[1] = {
    cwd: workspaceRoot,
    onRunStart: (run) => {
      markRunning(stateDir, job.id, { agentId: run.agentId, runId: run.id });
    },
  };
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
