import { readFileSync } from "node:fs";

/**
 * Synchronously read the hook's stdin (returns "" on TTY / read errors).
 *
 * `readFileSync(0)` blocks on a TTY waiting for input. Claude Code always
 * pipes JSON via stdin for hooks; the TTY guard keeps a developer running
 * the hook by hand from hanging forever.
 */
export function readHookStdinSync(): string {
  if (process.stdin.isTTY) return "";
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/**
 * Parse a hook payload from raw stdin text. Tolerates empty input and
 * malformed JSON by returning an empty object — hooks must never crash
 * Claude Code, so unknown payload shapes degrade gracefully.
 */
export function parseHookPayload<T extends object>(raw: string): T {
  if (!raw.trim()) return {} as T;
  try {
    const data = JSON.parse(raw);
    if (data && typeof data === "object") return data as T;
  } catch {
    // ignore — fall through to empty payload
  }
  return {} as T;
}
