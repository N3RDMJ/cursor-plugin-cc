import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { STATE_ROOT_ENV } from "@plugin/lib/state.mjs";
import {
  clearDefaultModel,
  getUserConfigPath,
  readUserConfig,
  resolveDefaultModel,
  setDefaultModel,
  USER_CONFIG_ENV_MODEL,
  writeUserConfig,
} from "@plugin/lib/user-config.mjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let stateRoot: string;
let savedRoot: string | undefined;
let savedModelEnv: string | undefined;

beforeEach(() => {
  stateRoot = mkdtempSync(path.join(tmpdir(), "cursor-user-config-"));
  savedRoot = process.env[STATE_ROOT_ENV];
  savedModelEnv = process.env[USER_CONFIG_ENV_MODEL];
  process.env[STATE_ROOT_ENV] = stateRoot;
  delete process.env[USER_CONFIG_ENV_MODEL];
});

afterEach(() => {
  rmSync(stateRoot, { recursive: true, force: true });
  if (savedRoot === undefined) delete process.env[STATE_ROOT_ENV];
  else process.env[STATE_ROOT_ENV] = savedRoot;
  if (savedModelEnv === undefined) delete process.env[USER_CONFIG_ENV_MODEL];
  else process.env[USER_CONFIG_ENV_MODEL] = savedModelEnv;
});

describe("user-config persistence", () => {
  it("returns the empty default when config.json is missing", () => {
    expect(readUserConfig()).toEqual({ version: 1 });
  });

  it("getUserConfigPath sits at the root state dir", () => {
    expect(getUserConfigPath()).toBe(path.join(stateRoot, "config.json"));
  });

  it("setDefaultModel persists and round-trips via readUserConfig", () => {
    setDefaultModel({ id: "gpt-5" });
    expect(readUserConfig()).toEqual({ version: 1, defaultModel: { id: "gpt-5" } });
  });

  it("setDefaultModel overwrites a previous default", () => {
    setDefaultModel({ id: "gpt-5" });
    setDefaultModel({ id: "composer-2" });
    expect(readUserConfig().defaultModel).toEqual({ id: "composer-2" });
  });

  it("clearDefaultModel removes the persisted default", () => {
    setDefaultModel({ id: "gpt-5" });
    clearDefaultModel();
    expect(readUserConfig().defaultModel).toBeUndefined();
  });

  it("treats malformed config.json as the empty default", () => {
    writeFileSync(getUserConfigPath(), "{ not json");
    expect(readUserConfig()).toEqual({ version: 1 });
  });

  it("ignores defaultModel entries that lack an id", () => {
    writeUserConfig({ version: 1, defaultModel: { id: "" } as { id: string } });
    expect(readUserConfig().defaultModel).toBeUndefined();
  });

  it("persists params on the default model and reads them back", () => {
    setDefaultModel({
      id: "gpt-5",
      params: [{ id: "reasoning_effort", value: "low" }],
    });
    expect(readUserConfig().defaultModel).toEqual({
      id: "gpt-5",
      params: [{ id: "reasoning_effort", value: "low" }],
    });
  });

  it("strips malformed param entries from disk", () => {
    writeUserConfig({
      version: 1,
      defaultModel: {
        id: "gpt-5",
        params: [
          { id: "reasoning_effort", value: "low" },
          { id: "verbosity", value: 7 } as unknown as { id: string; value: string },
          { id: 42 as unknown as string, value: "low" },
        ],
      },
    });
    expect(readUserConfig().defaultModel).toEqual({
      id: "gpt-5",
      params: [{ id: "reasoning_effort", value: "low" }],
    });
  });

  it("drops the params field when no entries survive validation", () => {
    writeUserConfig({
      version: 1,
      defaultModel: {
        id: "gpt-5",
        params: [{ id: "verbosity", value: 7 } as unknown as { id: string; value: string }],
      },
    });
    const cfg = readUserConfig();
    expect(cfg.defaultModel).toEqual({ id: "gpt-5" });
    expect(cfg.defaultModel?.params).toBeUndefined();
  });
});

describe("resolveDefaultModel resolution order", () => {
  const fallback = { id: "composer-2" };

  it("uses CURSOR_MODEL when set", () => {
    setDefaultModel({ id: "from-config" });
    process.env[USER_CONFIG_ENV_MODEL] = "from-env";
    const resolved = resolveDefaultModel(fallback);
    expect(resolved).toEqual({ model: { id: "from-env" }, source: "env" });
  });

  it("falls through to persisted config when env is unset", () => {
    setDefaultModel({ id: "from-config" });
    const resolved = resolveDefaultModel(fallback);
    expect(resolved).toEqual({ model: { id: "from-config" }, source: "config" });
  });

  it("returns the fallback when nothing else is configured", () => {
    const resolved = resolveDefaultModel(fallback);
    expect(resolved).toEqual({ model: fallback, source: "fallback" });
  });

  it("treats whitespace-only CURSOR_MODEL as unset", () => {
    process.env[USER_CONFIG_ENV_MODEL] = "   ";
    const resolved = resolveDefaultModel(fallback);
    expect(resolved.source).toBe("fallback");
  });

  it("parses CURSOR_MODEL params via the same selector syntax", () => {
    process.env[USER_CONFIG_ENV_MODEL] = "gpt-5:reasoning_effort=high";
    const resolved = resolveDefaultModel(fallback);
    expect(resolved).toEqual({
      model: { id: "gpt-5", params: [{ id: "reasoning_effort", value: "high" }] },
      source: "env",
    });
  });

  it("falls through to config when CURSOR_MODEL is malformed and warns on stderr", () => {
    setDefaultModel({ id: "from-config" });
    process.env[USER_CONFIG_ENV_MODEL] = "gpt-5:bad-param-no-equals";
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      const resolved = resolveDefaultModel(fallback);
      expect(resolved).toEqual({ model: { id: "from-config" }, source: "config" });
      expect(stderr).toHaveBeenCalledTimes(1);
      const warning = String(stderr.mock.calls[0]?.[0] ?? "");
      expect(warning).toContain("CURSOR_MODEL");
      expect(warning).toContain("gpt-5:bad-param-no-equals");
    } finally {
      stderr.mockRestore();
    }
  });
});
