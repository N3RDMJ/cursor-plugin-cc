import { describe, expect, it } from "vitest";

import {
  interpolateTemplate,
  loadPromptTemplate,
} from "../../../plugins/cursor/scripts/lib/prompts.mjs";

describe("loadPromptTemplate", () => {
  it("loads the task template", () => {
    const template = loadPromptTemplate("task");
    expect(template).toContain("{{USER_PROMPT}}");
    expect(template).toContain("{{WRITE_POLICY}}");
    expect(template).toContain("{{WORKSPACE_CONTEXT}}");
  });

  it("loads the investigation template", () => {
    const template = loadPromptTemplate("investigation");
    expect(template).toContain("read-only investigation mode");
    expect(template).toContain("Do NOT modify");
  });

  it("loads the review template", () => {
    const template = loadPromptTemplate("review");
    expect(template).toContain("{{TARGET_LABEL}}");
    expect(template).toContain("{{SCHEMA}}");
  });

  it("loads the adversarial-review template", () => {
    const template = loadPromptTemplate("adversarial-review");
    expect(template).toContain("adversarial");
    expect(template).toContain("{{DIFF}}");
  });

  it("loads the stop-review-gate template", () => {
    const template = loadPromptTemplate("stop-review-gate");
    expect(template).toContain("{{DIFF}}");
    expect(template).toContain("{{STATUS}}");
  });

  it("throws for a nonexistent template", () => {
    expect(() => loadPromptTemplate("nonexistent-xyz")).toThrow();
  });
});

describe("interpolateTemplate", () => {
  it("replaces known variables", () => {
    const result = interpolateTemplate("Hello {{NAME}}, you are {{ROLE}}", {
      NAME: "Alice",
      ROLE: "admin",
    });
    expect(result).toBe("Hello Alice, you are admin");
  });

  it("replaces unknown variables with empty string", () => {
    const result = interpolateTemplate("{{KNOWN}} and {{UNKNOWN}}", { KNOWN: "yes" });
    expect(result).toBe("yes and ");
  });

  it("handles templates with no variables", () => {
    expect(interpolateTemplate("no vars here", {})).toBe("no vars here");
  });

  it("replaces multiple occurrences of the same variable", () => {
    const result = interpolateTemplate("{{X}} then {{X}}", { X: "val" });
    expect(result).toBe("val then val");
  });
});
