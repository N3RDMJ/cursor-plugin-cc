import type { ModelSelection } from "@cursor/sdk";

import { type ParsedArgs, UsageError } from "./args.mjs";

/** Parse an `id[:k=v,k=v]` selector (e.g. `gpt-5:reasoning_effort=low`). */
export function parseModelArg(input: string): ModelSelection {
  const trimmed = input.trim();
  if (!trimmed) throw new UsageError("model selector is empty");

  const colon = trimmed.indexOf(":");
  if (colon === -1) return { id: trimmed };

  const id = trimmed.slice(0, colon).trim();
  const paramSpec = trimmed.slice(colon + 1).trim();
  if (!id) throw new UsageError(`invalid model selector '${input}': missing id before ':'`);
  if (!paramSpec) {
    throw new UsageError(`invalid model selector '${input}': missing params after ':'`);
  }

  const params = paramSpec.split(",").map((pair) => {
    const eq = pair.indexOf("=");
    if (eq === -1) {
      throw new UsageError(
        `invalid model param '${pair}' in '${input}': expected key=value (e.g. reasoning_effort=low)`,
      );
    }
    const paramId = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!paramId) throw new UsageError(`invalid model param '${pair}' in '${input}': empty key`);
    if (!value) {
      throw new UsageError(`invalid model param '${pair}' in '${input}': empty value`);
    }
    return { id: paramId, value };
  });

  const seen = new Set<string>();
  for (const p of params) {
    if (seen.has(p.id)) {
      throw new UsageError(`invalid model selector '${input}': duplicate param '${p.id}'`);
    }
    seen.add(p.id);
  }

  return { id, params };
}

/** Render `ModelSelection` to canonical `id[:k=v,k=v]` form. Sorts params for stable dedup keys. */
export function formatModelSelection(model: ModelSelection): string {
  if (!model.params || model.params.length === 0) return model.id;
  const pairs = [...model.params]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((p) => `${p.id}=${p.value}`)
    .join(",");
  return `${model.id}:${pairs}`;
}

/**
 * Pull a `--model`-style flag off `ParsedArgs` and parse it. Distinguishes
 * "flag absent" (returns undefined) from "flag passed with empty value"
 * (`parseModelArg` throws a UsageError) so a typo'd `--model ""` surfaces.
 */
export function optionalModelArg(parsed: ParsedArgs, name: string): ModelSelection | undefined {
  const raw = parsed.flags[name];
  if (typeof raw !== "string") return undefined;
  return parseModelArg(raw);
}
