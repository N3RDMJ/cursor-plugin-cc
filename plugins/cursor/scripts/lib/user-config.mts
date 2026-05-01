import path from "node:path";

import type { ModelSelection } from "@cursor/sdk";

import { readJson, resolveStateRoot, type StateLocator, writeJsonAtomic } from "./state.mjs";

export interface UserConfig {
  version: 1;
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
  const next: UserConfig = { ...readUserConfig(opts), defaultModel: model };
  writeUserConfig(next, opts);
  return next;
}

export function clearDefaultModel(opts: StateLocator = {}): UserConfig {
  const { defaultModel: _drop, ...rest } = readUserConfig(opts);
  writeUserConfig(rest, opts);
  return rest;
}

export type DefaultModelSource = "env" | "config" | "fallback";

export interface ResolvedDefaultModel {
  model: ModelSelection;
  source: DefaultModelSource;
}

export function resolveDefaultModel(
  fallback: ModelSelection,
  opts: StateLocator = {},
): ResolvedDefaultModel {
  const envId = process.env[USER_CONFIG_ENV_MODEL]?.trim();
  if (envId) return { model: { id: envId }, source: "env" };

  const cfg = readUserConfig(opts);
  if (cfg.defaultModel) return { model: cfg.defaultModel, source: "config" };

  return { model: fallback, source: "fallback" };
}
