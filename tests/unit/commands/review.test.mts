import { describe, expect, it } from "vitest";

import { extractJson, parseReview } from "../../../plugins/cursor/scripts/commands/review.mjs";

describe("extractJson", () => {
  it("returns the input unchanged when no fences are present", () => {
    expect(extractJson('{"verdict":"approve"}')).toBe('{"verdict":"approve"}');
  });

  it("strips ```json fences", () => {
    const wrapped = '```json\n{"verdict":"approve"}\n```';
    expect(extractJson(wrapped)).toBe('{"verdict":"approve"}');
  });

  it("strips bare ``` fences", () => {
    const wrapped = '```\n{"verdict":"approve"}\n```';
    expect(extractJson(wrapped)).toBe('{"verdict":"approve"}');
  });

  it("trims surrounding whitespace", () => {
    expect(extractJson('   {"x":1}   ')).toBe('{"x":1}');
  });
});

const VALID_REVIEW = JSON.stringify({
  verdict: "needs-attention",
  summary: "two findings",
  findings: [
    {
      severity: "high",
      title: "uh-oh",
      body: "...",
      file: "src/x.ts",
      line_start: 10,
      line_end: 12,
      confidence: 0.8,
      recommendation: "fix it",
    },
  ],
  next_steps: ["fix the bug"],
});

describe("parseReview", () => {
  it("parses a valid structured review", () => {
    const parsed = parseReview(VALID_REVIEW);
    expect(parsed.verdict).toBe("needs-attention");
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.next_steps).toEqual(["fix the bug"]);
  });

  it("accepts a fence-wrapped review", () => {
    const wrapped = `\`\`\`json\n${VALID_REVIEW}\n\`\`\``;
    expect(parseReview(wrapped).verdict).toBe("needs-attention");
  });

  it("throws on malformed JSON", () => {
    expect(() => parseReview("not json at all")).toThrow(/not valid JSON/);
  });

  it("throws when verdict is missing or invalid", () => {
    expect(() => parseReview('{"summary":"","findings":[],"next_steps":[]}')).toThrow(/verdict/);
    expect(() =>
      parseReview('{"verdict":"maybe","summary":"","findings":[],"next_steps":[]}'),
    ).toThrow(/verdict/);
  });

  it("throws when findings is not an array", () => {
    expect(() =>
      parseReview('{"verdict":"approve","summary":"ok","findings":{},"next_steps":[]}'),
    ).toThrow(/findings/);
  });

  it("throws when next_steps is not an array", () => {
    expect(() =>
      parseReview('{"verdict":"approve","summary":"ok","findings":[],"next_steps":"go"}'),
    ).toThrow(/next_steps/);
  });
});
