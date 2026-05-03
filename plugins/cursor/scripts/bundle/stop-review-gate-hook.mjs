import {
  DEFAULT_GATE_TIMEOUT_MS,
  interpolateTemplate,
  loadPromptTemplate,
  parseReview,
  readGateConfig,
  renderReviewResult
} from "./chunk-XYYKXIND.mjs";
import {
  parseHookPayload,
  readHookStdinSync
} from "./chunk-TKO2YPM2.mjs";
import {
  getDiff,
  getStatus,
  oneShot,
  resolveStateDir,
  resolveWorkspaceRoot
} from "./chunk-3FBBFC2X.mjs";

// plugins/cursor/scripts/stop-review-gate-hook.mts
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
  return interpolateTemplate(loadPromptTemplate("stop-review-gate"), {
    SCHEMA,
    STATUS: status || "(clean)",
    DIFF: diff
  });
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
