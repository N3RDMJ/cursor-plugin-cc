import { describe, expect, it } from "vitest";

import {
  bool,
  optionalString,
  parseArgs,
  requireString,
} from "../../../plugins/cursor/scripts/lib/args.mjs";

describe("parseArgs", () => {
  it("collects positionals and known boolean flags", () => {
    const r = parseArgs(["a", "--write", "b"], { long: { write: "boolean" } });
    expect(r.positionals).toEqual(["a", "b"]);
    expect(r.flags.write).toBe(true);
  });

  it("supports --flag=value form", () => {
    const r = parseArgs(["--model=gpt-5"], { long: { model: "string" } });
    expect(r.flags.model).toBe("gpt-5");
  });

  it("supports --flag value form", () => {
    const r = parseArgs(["--model", "gpt-5"], { long: { model: "string" } });
    expect(r.flags.model).toBe("gpt-5");
  });

  it("supports short alias", () => {
    const r = parseArgs(["-m", "gpt-5"], {
      long: { model: "string" },
      short: { m: "model" },
    });
    expect(r.flags.model).toBe("gpt-5");
  });

  it("treats -- as end-of-flags", () => {
    const r = parseArgs(["--write", "--", "--not-a-flag", "x"], {
      long: { write: "boolean" },
    });
    expect(r.flags.write).toBe(true);
    expect(r.positionals).toEqual(["--not-a-flag", "x"]);
  });

  it("throws when a string flag is missing its value", () => {
    expect(() => parseArgs(["--model"], { long: { model: "string" } })).toThrow(/--model/);
    expect(() => parseArgs(["--model", "--other"], { long: { model: "string" } })).toThrow(
      /--model/,
    );
  });

  it("throws on unknown short flags (would silently swallow next token otherwise)", () => {
    expect(() => parseArgs(["-x"], {})).toThrow(/unknown short flag/);
  });

  it("records unknown long flags as boolean by default", () => {
    const r = parseArgs(["--frob"], {});
    expect(r.flags.frob).toBe(true);
  });

  it("--flag=false unsets a boolean flag", () => {
    const r = parseArgs(["--write=false"], { long: { write: "boolean" } });
    expect(r.flags.write).toBeUndefined();
  });
});

describe("flag accessors", () => {
  it("requireString throws when missing", () => {
    expect(() => requireString({ positionals: [], flags: {} }, "model")).toThrow(/--model/);
  });

  it("optionalString returns undefined when missing", () => {
    expect(optionalString({ positionals: [], flags: { model: true } }, "model")).toBeUndefined();
    expect(optionalString({ positionals: [], flags: { model: "x" } }, "model")).toBe("x");
  });

  it("bool returns true only when explicitly set", () => {
    expect(bool({ positionals: [], flags: {} }, "write")).toBe(false);
    expect(bool({ positionals: [], flags: { write: true } }, "write")).toBe(true);
    expect(bool({ positionals: [], flags: { write: "x" } }, "write")).toBe(false);
  });
});
