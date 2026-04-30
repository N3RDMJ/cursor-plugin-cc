/**
 * Minimal argv parser. Distinguishes:
 *  - boolean flags: `--write`, `-w`
 *  - value flags: `--model x`, `--model=x`, `-m x`
 *  - positionals (everything else)
 *  - `--`: stop flag-parsing; remainder is treated as positionals
 *
 * Unknown long flags are still parsed (recorded in `flags`) — the caller
 * decides whether they are valid for the active subcommand. Unknown short
 * flags throw because they would otherwise silently swallow the next token.
 */

/**
 * Thrown for any user-supplied argv defect: missing required value, unknown
 * short flag, missing positional, invalid filter value, etc. The CLI router
 * maps this to exit code 2 (per the documented convention) instead of the
 * generic exit 1 used for runtime failures.
 */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export interface ParsedArgs {
  /** Positional arguments, in order. */
  positionals: string[];
  /** Boolean flags that were present (true), and value flags as strings. */
  flags: Record<string, string | true>;
}

export interface ArgSpec {
  /** Long names → kind. Always include without leading `--`. */
  long?: Record<string, "boolean" | "string">;
  /** Short alias → long name (without leading `-` / `--`). */
  short?: Record<string, string>;
}

export function parseArgs(argv: readonly string[], spec: ArgSpec = {}): ParsedArgs {
  const long = spec.long ?? {};
  const short = spec.short ?? {};
  const flags: Record<string, string | true> = {};
  const positionals: string[] = [];
  let stopParsing = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (stopParsing) {
      positionals.push(arg);
      continue;
    }
    if (arg === "--") {
      stopParsing = true;
      continue;
    }

    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      const name = eqIdx === -1 ? arg.slice(2) : arg.slice(2, eqIdx);
      const inlineValue = eqIdx === -1 ? undefined : arg.slice(eqIdx + 1);
      const kind = long[name];
      if (kind === "boolean") {
        if (inlineValue === "false") {
          delete flags[name];
        } else {
          flags[name] = true;
        }
      } else if (kind === "string") {
        if (inlineValue !== undefined) {
          flags[name] = inlineValue;
        } else {
          const next = argv[i + 1];
          if (next === undefined || next.startsWith("-")) {
            throw new UsageError(`expected value after --${name}`);
          }
          flags[name] = next;
          i += 1;
        }
      } else {
        // Unknown long flag — record as boolean if no value, else as string.
        if (inlineValue !== undefined) flags[name] = inlineValue;
        else flags[name] = true;
      }
      continue;
    }

    if (arg.startsWith("-") && arg.length > 1) {
      const shortName = arg.slice(1);
      const longName = short[shortName];
      if (!longName) {
        throw new UsageError(`unknown short flag: ${arg}`);
      }
      const kind = long[longName];
      if (kind === "string") {
        const next = argv[i + 1];
        if (next === undefined || next.startsWith("-")) {
          throw new UsageError(`expected value after ${arg}`);
        }
        flags[longName] = next;
        i += 1;
      } else {
        flags[longName] = true;
      }
      continue;
    }

    positionals.push(arg);
  }

  return { positionals, flags };
}

/** Convenience: extract a string flag, throwing if missing. */
export function requireString(parsed: ParsedArgs, name: string): string {
  const v = parsed.flags[name];
  if (typeof v !== "string") throw new UsageError(`missing required --${name}`);
  return v;
}

/** Convenience: extract an optional string flag. */
export function optionalString(parsed: ParsedArgs, name: string): string | undefined {
  const v = parsed.flags[name];
  return typeof v === "string" ? v : undefined;
}

/** Convenience: presence-check a boolean flag (or absent → false). */
export function bool(parsed: ParsedArgs, name: string): boolean {
  return parsed.flags[name] === true;
}
