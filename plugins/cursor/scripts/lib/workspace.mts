import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * Resolve the workspace root for a given working directory.
 *
 * Returns the git top-level when `cwd` is inside a git working tree, otherwise
 * falls back to `cwd` so the plugin still works in scratch directories that
 * aren't checked into git. The returned path is always absolute.
 */
export function resolveWorkspaceRoot(cwd: string): string {
  try {
    const out = execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const root = out.trim();
    if (root.length > 0) {
      return path.resolve(root);
    }
  } catch {
    // not a git repo, or git not available — fall through
  }
  return path.resolve(cwd);
}
