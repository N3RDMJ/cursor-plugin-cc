import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DEFAULT_GATE_CONFIG,
  getGatePath,
  readGateConfig,
  setGateEnabled,
  writeGateConfig,
} from "@plugin/lib/gate.mjs";
import { ensureStateDir } from "@plugin/lib/state.mjs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let stateDir: string;

beforeEach(() => {
  stateDir = mkdtempSync(path.join(tmpdir(), "cursor-gate-"));
  ensureStateDir(stateDir);
});

afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

describe("gate config", () => {
  it("returns the disabled default when gate.json is missing", () => {
    expect(readGateConfig(stateDir)).toEqual(DEFAULT_GATE_CONFIG);
  });

  it("round-trips a written config", () => {
    writeGateConfig(stateDir, { version: 1, enabled: true, timeoutMs: 12_345 });
    const cfg = readGateConfig(stateDir);
    expect(cfg.enabled).toBe(true);
    expect(cfg.timeoutMs).toBe(12_345);
  });

  it("setGateEnabled flips the flag without losing other fields", () => {
    writeGateConfig(stateDir, {
      version: 1,
      enabled: true,
      model: { id: "composer-2" },
      timeoutMs: 5000,
    });
    const next = setGateEnabled(stateDir, false);
    expect(next.enabled).toBe(false);
    expect(next.model).toEqual({ id: "composer-2" });
    expect(next.timeoutMs).toBe(5000);
  });

  it("treats malformed gate.json as disabled default", () => {
    writeFileSync(getGatePath(stateDir), "{ not json");
    expect(readGateConfig(stateDir)).toEqual(DEFAULT_GATE_CONFIG);
  });

  it("rejects negative timeouts (treated as absent)", () => {
    writeGateConfig(stateDir, { version: 1, enabled: true, timeoutMs: -1 });
    const cfg = readGateConfig(stateDir);
    expect(cfg.enabled).toBe(true);
    expect(cfg.timeoutMs).toBeUndefined();
  });

  it("coerces non-boolean enabled values to false", () => {
    writeFileSync(getGatePath(stateDir), JSON.stringify({ version: 1, enabled: "yes" }));
    expect(readGateConfig(stateDir).enabled).toBe(false);
  });
});
