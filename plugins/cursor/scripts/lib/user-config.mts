import path from "node:path";

import type { ModelSelection } from "@cursor/sdk";

import { parseModelArg } from "./model-arg.mjs";
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
    const next: ModelSelection = { id: data.defaultModel.id };
    if (Array.isArray(data.defaultModel.params)) {
      const params = data.defaultModel.params.filter(
        (p): p is { id: string; value: string } =>
          !!p && typeof p === "object" && typeof p.id === "string" && typeof p.value === "string",
      );
      if (params.length > 0) next.params = params;
    }
    out.defaultModel = next;
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
  const envValue = process.env[USER_CONFIG_ENV_MODEL]?.trim();
  if (envValue) {
    try {
      return { model: parseModelArg(envValue), source: "env" };
    } catch (err) {
      // Don't crash every command on a typo — fall through to the persisted
      // default, but warn so the user knows their env var was ignored.
      const detail = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `cursor-plugin: ignoring malformed ${USER_CONFIG_ENV_MODEL}='${envValue}' (${detail})\n`,
      );
    }
  }

  const cfg = readUserConfig(opts);
  if (cfg.defaultModel) return { model: cfg.defaultModel, source: "config" };

  return { model: fallback, source: "fallback" };
}
