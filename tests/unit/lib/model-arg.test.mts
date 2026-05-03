import { UsageError } from "@plugin/lib/args.mjs";
import { formatModelSelection, optionalModelArg, parseModelArg } from "@plugin/lib/model-arg.mjs";
import { describe, expect, it } from "vitest";

describe("parseModelArg", () => {
  it("parses a bare id as { id }", () => {
    expect(parseModelArg("gpt-5")).toEqual({ id: "gpt-5" });
  });

  it("trims whitespace around the id", () => {
    expect(parseModelArg("  gpt-5  ")).toEqual({ id: "gpt-5" });
  });

  it("parses a single key=value param", () => {
    expect(parseModelArg("gpt-5:reasoning_effort=low")).toEqual({
      id: "gpt-5",
      params: [{ id: "reasoning_effort", value: "low" }],
    });
  });

  it("parses multiple comma-separated params", () => {
    expect(parseModelArg("gpt-5:reasoning_effort=high,verbosity=low")).toEqual({
      id: "gpt-5",
      params: [
        { id: "reasoning_effort", value: "high" },
        { id: "verbosity", value: "low" },
      ],
    });
  });

  it("trims whitespace inside the param spec", () => {
    expect(parseModelArg("gpt-5: reasoning_effort = high , verbosity = low")).toEqual({
      id: "gpt-5",
      params: [
        { id: "reasoning_effort", value: "high" },
        { id: "verbosity", value: "low" },
      ],
    });
  });

  it("rejects an empty input", () => {
    expect(() => parseModelArg("")).toThrow(UsageError);
    expect(() => parseModelArg("   ")).toThrow(UsageError);
  });

  it("rejects a colon with no id", () => {
    expect(() => parseModelArg(":reasoning_effort=low")).toThrow(/missing id/);
  });

  it("rejects a colon with no params", () => {
    expect(() => parseModelArg("gpt-5:")).toThrow(/missing params/);
    expect(() => parseModelArg("gpt-5:   ")).toThrow(/missing params/);
  });

  it("rejects a param missing '='", () => {
    expect(() => parseModelArg("gpt-5:reasoning_effort")).toThrow(/expected key=value/);
  });

  it("rejects a param with an empty key", () => {
    expect(() => parseModelArg("gpt-5:=low")).toThrow(/empty key/);
  });

  it("rejects a param with an empty value", () => {
    expect(() => parseModelArg("gpt-5:reasoning_effort=")).toThrow(/empty value/);
  });

  it("rejects duplicate param keys", () => {
    expect(() => parseModelArg("gpt-5:reasoning_effort=low,reasoning_effort=high")).toThrow(
      /duplicate param/,
    );
  });
});

describe("formatModelSelection", () => {
  it("returns just the id when no params are set", () => {
    expect(formatModelSelection({ id: "gpt-5" })).toBe("gpt-5");
  });

  it("returns just the id when params is an empty array", () => {
    expect(formatModelSelection({ id: "gpt-5", params: [] })).toBe("gpt-5");
  });

  it("renders a single param", () => {
    expect(
      formatModelSelection({ id: "gpt-5", params: [{ id: "reasoning_effort", value: "low" }] }),
    ).toBe("gpt-5:reasoning_effort=low");
  });

  it("renders params sorted by key for stable output", () => {
    expect(
      formatModelSelection({
        id: "gpt-5",
        params: [
          { id: "verbosity", value: "low" },
          { id: "reasoning_effort", value: "high" },
        ],
      }),
    ).toBe("gpt-5:reasoning_effort=high,verbosity=low");
  });

  it("round-trips with parseModelArg", () => {
    const inputs = [
      "gpt-5",
      "gpt-5:reasoning_effort=low",
      "gpt-5:reasoning_effort=high,verbosity=low",
    ];
    for (const input of inputs) {
      expect(formatModelSelection(parseModelArg(input))).toBe(input);
    }
  });
});

describe("optionalModelArg", () => {
  it("returns undefined when the flag is absent", () => {
    expect(optionalModelArg({ positionals: [], flags: {} }, "model")).toBeUndefined();
  });

  it("parses a present value", () => {
    expect(
      optionalModelArg(
        { positionals: [], flags: { model: "gpt-5:reasoning_effort=low" } },
        "model",
      ),
    ).toEqual({ id: "gpt-5", params: [{ id: "reasoning_effort", value: "low" }] });
  });

  it("throws on an explicit empty value (not silent no-op)", () => {
    expect(() => optionalModelArg({ positionals: [], flags: { model: "" } }, "model")).toThrow(
      UsageError,
    );
  });
});
