import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  redactApiKey,
  redactError,
  redactSecret,
} from "../../../plugins/cursor/scripts/lib/redact.mjs";

const ORIGINAL_KEY = process.env.CURSOR_API_KEY;

beforeEach(() => {
  process.env.CURSOR_API_KEY = "key_abcdefghij1234567890";
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.CURSOR_API_KEY;
  else process.env.CURSOR_API_KEY = ORIGINAL_KEY;
});

describe("redactSecret", () => {
  it("replaces every occurrence of the secret", () => {
    expect(redactSecret("hello key_abcdefghij1234567890 world", "key_abcdefghij1234567890")).toBe(
      "hello [REDACTED] world",
    );
  });

  it("returns the input unchanged when secret is missing or short", () => {
    expect(redactSecret("hello key", undefined)).toBe("hello key");
    expect(redactSecret("hello short", "short")).toBe("hello short");
    expect(redactSecret("hello", "")).toBe("hello");
  });
});

describe("redactApiKey", () => {
  it("scrubs the active CURSOR_API_KEY env var from arbitrary text", () => {
    expect(redactApiKey("auth=key_abcdefghij1234567890&q=x")).toBe("auth=[REDACTED]&q=x");
  });

  it("is a no-op when CURSOR_API_KEY is unset", () => {
    delete process.env.CURSOR_API_KEY;
    expect(redactApiKey("auth=key_abcdefghij1234567890")).toBe("auth=key_abcdefghij1234567890");
  });
});

describe("redactError", () => {
  it("scrubs the API key from an Error message", () => {
    const err = new Error("request failed for key_abcdefghij1234567890");
    expect(redactError(err)).toBe("request failed for [REDACTED]");
  });

  it("unwraps Error.cause one level deep and scrubs both", () => {
    const cause = new Error("inner: key_abcdefghij1234567890");
    const outer = Object.assign(new Error("outer wrap"), { cause });
    expect(redactError(outer)).toBe("outer wrap (cause: inner: [REDACTED])");
  });

  it("collapses identical inner cause messages", () => {
    const cause = new Error("same");
    const outer = Object.assign(new Error("same"), { cause });
    expect(redactError(outer)).toBe("same");
  });

  it("stringifies non-Error values", () => {
    expect(redactError("plain key_abcdefghij1234567890")).toBe("plain [REDACTED]");
    expect(redactError(42)).toBe("42");
  });
});
