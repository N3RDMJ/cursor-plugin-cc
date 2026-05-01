import {
  DEFAULT_GATE_TIMEOUT_MS,
  getDiff,
  getStatus,
  oneShot,
  parseReview,
  readGateConfig,
  renderReviewResult
} from "./chunk-AUSOW76U.mjs";
import {
  parseHookPayload,
  readHookStdinSync
} from "./chunk-TKO2YPM2.mjs";
import {
  resolveStateDir,
  resolveWorkspaceRoot
} from "./chunk-P7QODZNJ.mjs";

// plugins/cursor/scripts/stop-review-gate-hook.mts
var GATE_INSTRUCTIONS = [
  "You are an automated review gate. Claude Code is about to stop and return",
  "  control to the user. Independently review the working-tree diff for",
  "  issues that would be unsafe to merge as-is.",
  "Be conservative: do NOT flag style nits, refactors, or speculative concerns.",
  "Set verdict='needs-attention' ONLY when there is at least one finding with",
  "  severity 'critical' or 'high'. Otherwise set verdict='approve'.",
  "Cite file:line for each finding so Claude can locate it.",
  "Output ONLY a single JSON object matching the schema below \u2014 no prose,",
  "  no markdown fences."
].join("\n");
var SCHEMA = `{
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
function buildPrompt(diff, status) {
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
    diff
  ].join("\n");
}
function formatBlockReason(review) {
  const header = "cursor-plugin-cc Stop review gate found issues that should be addressed before stopping. Review the findings, fix them (or explain why they are not blocking), then stop again.\n\n";
  return header + renderReviewResult(review);
}
async function main(io) {
  const payload = parseHookPayload(io.readStdin());
  if (payload.stop_hook_active === true) return 0;
  const cwd = payload.cwd ?? io.cwd();
  let workspaceRoot;
  try {
    workspaceRoot = resolveWorkspaceRoot(cwd);
  } catch {
    return 0;
  }
  const stateDir = resolveStateDir(workspaceRoot);
  const config = readGateConfig(stateDir);
  if (!config.enabled) return 0;
  let diff;
  try {
    diff = getDiff(workspaceRoot);
  } catch {
    return 0;
  }
  if (!diff) return 0;
  const prompt = buildPrompt(diff, getStatus(workspaceRoot));
  const oneShotOpts = {
    cwd: workspaceRoot,
    timeoutMs: config.timeoutMs ?? DEFAULT_GATE_TIMEOUT_MS
  };
  if (config.model) oneShotOpts.model = config.model;
  let result;
  try {
    result = await oneShot(prompt, oneShotOpts);
  } catch (err) {
    io.stderr.write(
      `cursor-plugin-cc gate: review failed (${err instanceof Error ? err.message : String(err)}); allowing.
`
    );
    return 0;
  }
  if (result.status !== "finished") {
    io.stderr.write(`cursor-plugin-cc gate: review did not finish (${result.status}); allowing.
`);
    return 0;
  }
  let review;
  try {
    review = parseReview(result.output);
  } catch (err) {
    io.stderr.write(
      `cursor-plugin-cc gate: could not parse review output (${err instanceof Error ? err.message : String(err)}); allowing.
`
    );
    return 0;
  }
  if (review.verdict === "approve") return 0;
  const decision = {
    decision: "block",
    reason: formatBlockReason(review)
  };
  io.stdout.write(JSON.stringify(decision));
  return 0;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const code = await main({
    readStdin: readHookStdinSync,
    stdout: process.stdout,
    stderr: process.stderr,
    cwd: () => process.cwd()
  });
  process.exit(code);
}
export {
  formatBlockReason,
  main
};
