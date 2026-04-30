/**
 * Secret-redaction helpers used at every CLI boundary that prints to stderr or
 * persists strings (job logs, error messages, JSON output). The Cursor SDK
 * exposes the API key as a constructor argument; if a thrown error happens to
 * carry a request URL with the key in a query parameter, we don't want it
 * surfacing in `~/.claude/cursor-plugin/<workspace>/<job>.log`.
 */

const PLACEHOLDER = "[REDACTED]";
const MIN_KEY_LENGTH = 8;

/**
 * Replace every occurrence of `secret` in `text` with a placeholder. Empty or
 * implausibly-short secrets are skipped — redacting a 4-char token would chew
 * up unrelated output. Returns the input unchanged when no secret is present.
 */
export function redactSecret(text: string, secret: string | undefined): string {
  if (!secret || secret.length < MIN_KEY_LENGTH) return text;
  return text.split(secret).join(PLACEHOLDER);
}

/**
 * Redact the `CURSOR_API_KEY` env var (when set) from arbitrary text. Safe to
 * call when the env var is unset — returns the input unchanged.
 */
export function redactApiKey(text: string): string {
  return redactSecret(text, process.env.CURSOR_API_KEY);
}

/**
 * Stringify any thrown value, redacting the active API key. Unwraps Error.cause
 * one level deep — the SDK frequently wraps a network error inside a
 * `CursorSdkError`, and the inner cause's message is what carries detail.
 */
export function redactError(error: unknown): string {
  if (error instanceof Error) {
    const parts: string[] = [error.message];
    const cause = (error as { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message && cause.message !== error.message) {
      parts.push(`(cause: ${cause.message})`);
    }
    return redactApiKey(parts.join(" "));
  }
  return redactApiKey(String(error));
}
