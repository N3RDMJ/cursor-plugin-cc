import path from "node:path";

import type { ModelSelection } from "@cursor/sdk";

import { readJson, writeJsonAtomic } from "./state.mjs";

/**
 * Per-workspace configuration for the Stop review gate. Persisted as
 * `gate.json` next to `state.json` in the workspace state directory. The
 * Stop hook short-circuits to "allow" when this file is missing or
 * `enabled === false`, so the gate stays opt-in even though its hook is
 * always installed by the plugin manifest.
 */
export interface GateConfig {
  version: 1;
  enabled: boolean;
  /** Optional model override for the gate review. Defaults to composer-2. */
  model?: ModelSelection;
  /** Cancel the gate review if it exceeds this duration (default: 600s). */
  timeoutMs?: number;
}

export const DEFAULT_GATE_CONFIG: GateConfig = { version: 1, enabled: false };
export const DEFAULT_GATE_TIMEOUT_MS = 600_000;

export function getGatePath(stateDir: string): string {
  return path.join(stateDir, "gate.json");
}

export function readGateConfig(stateDir: string): GateConfig {
  const cfg = readJson<GateConfig>(getGatePath(stateDir));
  if (!cfg || typeof cfg !== "object") return { ...DEFAULT_GATE_CONFIG };
  return {
    version: 1,
    enabled: cfg.enabled === true,
    ...(cfg.model ? { model: cfg.model } : {}),
    ...(typeof cfg.timeoutMs === "number" && cfg.timeoutMs > 0 ? { timeoutMs: cfg.timeoutMs } : {}),
  };
}

export function writeGateConfig(stateDir: string, config: GateConfig): void {
  writeJsonAtomic(getGatePath(stateDir), { ...config, version: 1 });
}

export function setGateEnabled(stateDir: string, enabled: boolean): GateConfig {
  const current = readGateConfig(stateDir);
  const next: GateConfig = { ...current, version: 1, enabled };
  writeGateConfig(stateDir, next);
  return next;
}
