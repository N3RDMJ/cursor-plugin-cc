/**
 * Sample review outputs (raw JSON strings as a Cursor agent would emit them)
 * used to exercise the parseReview / extractJson code paths.
 */
import type { ReviewOutput } from "@plugin/lib/render.mjs";

const APPROVE_REVIEW: ReviewOutput = {
  verdict: "approve",
  summary: "Change is small and correct.",
  findings: [],
  next_steps: ["ship it"],
};

export const NEEDS_ATTENTION_REVIEW: ReviewOutput = {
  verdict: "needs-attention",
  summary: "Debug log left in production code.",
  findings: [
    {
      severity: "medium",
      title: "Stray console.log",
      body: "A debug log was added that will run in production.",
      file: "src/foo.ts",
      line_start: 2,
      line_end: 2,
      confidence: 0.9,
      recommendation: "Remove the console.log call.",
    },
  ],
  next_steps: ["remove debug log"],
};

export const RAW_APPROVE = JSON.stringify(APPROVE_REVIEW);

/** Wrapped in ```json fences (agents do this despite instructions). */
export const FENCED_APPROVE = `\`\`\`json\n${JSON.stringify(APPROVE_REVIEW, null, 2)}\n\`\`\``;

export const NOT_JSON = "the agent decided to talk instead of producing JSON";
