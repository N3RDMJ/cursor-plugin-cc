import path from "node:path";

import type { ModelSelection } from "@cursor/sdk";

import { readJson, resolveStateRoot, type StateLocator, writeJsonAtomic } from "./state.mjs";

/**
 * User-wide plugin config. Persisted as `config.json` at the root of the
 * state tree (sibling to per-workspace directories), so settings set by
 * `/cursor:setup --set-model` apply across every workspace until cleared.
 *
 * Workspace-scoped settings (gate enabled flag, gate model override) live
 * in `gate.json` inside each workspace directory; this file is the place
 * for cross-workspace user preferences.
 */
export interface UserConfig {
  version: 1;
  /** Default model for new agent runs when no per-invocation override is set. */
  defaultModel?: ModelSelection;
}

export const USER_CONFIG_ENV_MODEL = "CURSOR_MODEL";

export function getUserConfigPath(opts: StateLocator = {}): string {
  return path.join(resolveStateRoot(opts), "config.json");
}

export function readUserConfig(opts: StateLocator = {}): UserConfig {
  const data = readJson<UserConfig>(getUserConfigPath(opts));
  if (!data || typeof data !== "object") return { version: 1 };
  const out: UserConfig = { version: 1 };
  if (data.defaultModel && typeof data.defaultModel === "object" && data.defaultModel.id) {
    out.defaultModel = data.defaultModel;
  }
  return out;
}

export function writeUserConfig(config: UserConfig, opts: StateLocator = {}): void {
  writeJsonAtomic(getUserConfigPath(opts), { ...config, version: 1 });
}

export function setDefaultModel(model: ModelSelection, opts: StateLocator = {}): UserConfig {
  const next: UserConfig = { ...readUserConfig(opts), version: 1, defaultModel: model };
  writeUserConfig(next, opts);
  return next;
}

export function clearDefaultModel(opts: StateLocator = {}): UserConfig {
  const { defaultModel: _drop, ...rest } = readUserConfig(opts);
  const next: UserConfig = { ...rest, version: 1 };
  writeUserConfig(next, opts);
  return next;
}

export type DefaultModelSource = "flag" | "env" | "config" | "fallback";

export interface ResolvedDefaultModel {
  model: ModelSelection;
  source: DefaultModelSource;
}

/**
 * Resolve the default model honoring (in order): explicit flag override,
 * `CURSOR_MODEL` env var, persisted user config, and a hardcoded fallback.
 * The flag path is only used by callers that want to surface the resolution
 * source — runtime callers normally only pass `fallback`.
 */
export function resolveDefaultModel(
  fallback: ModelSelection,
  opts: { override?: ModelSelection } & StateLocator = {},
): ResolvedDefaultModel {
  if (opts.override) return { model: opts.override, source: "flag" };

  const envId = process.env[USER_CONFIG_ENV_MODEL]?.trim();
  if (envId) return { model: { id: envId }, source: "env" };

  const cfg = readUserConfig(opts);
  if (cfg.defaultModel) return { model: cfg.defaultModel, source: "config" };

  return { model: fallback, source: "fallback" };
}
