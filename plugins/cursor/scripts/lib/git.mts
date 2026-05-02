import { execFileSync } from "node:child_process";

/**
 * Run a `git` command in the given working directory and return trimmed stdout.
 * Returns `undefined` when the process exits non-zero or git is not installed
 * — callers can treat absent/error as "not in a repo" or "no info".
 */
function runGit(cwd: string, args: string[]): string | undefined {
  try {
    const out = execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    // Only strip trailing newlines — porcelain status lines have a leading
    // space that encodes index-vs-worktree state, so a generic .trim() loses
    // information.
    return out.replace(/\n+$/, "");
  } catch {
    return undefined;
  }
}

export interface DiffOptions {
  /** When true, only return staged changes (`git diff --cached`). */
  staged?: boolean;
  /**
   * When set, diff against this ref (e.g. `main`). Falls back to working-tree
   * diff when omitted. Mutually compatible with `staged`.
   */
  baseRef?: string;
}

/**
 * Return the git diff for the working tree. The shape mirrors what `git diff`
 * prints — multi-file unified diff, suitable for sending to a review agent.
 */
export function getDiff(cwd: string, options: DiffOptions = {}): string {
  const args = ["diff", "--no-color"];
  if (options.staged) args.push("--cached");
  if (options.baseRef) args.push(options.baseRef);
  return runGit(cwd, args) ?? "";
}

/** `git status --short` — one line per changed file. Empty string when clean. */
export function getStatus(cwd: string): string {
  return runGit(cwd, ["status", "--short"]) ?? "";
}

/** True when the working tree has uncommitted changes (staged or unstaged). */
export function isDirty(cwd: string): boolean {
  return getStatus(cwd).length > 0;
}

export interface CommitInfo {
  hash: string;
  subject: string;
}

/**
 * Last `n` commits on HEAD, oldest first reversed (so most recent is first).
 * Returns an empty array on a fresh repo with no commits.
 */
export function getRecentCommits(cwd: string, n: number): CommitInfo[] {
  if (n <= 0) return [];
  const out = runGit(cwd, ["log", `-${Math.floor(n)}`, "--pretty=format:%H%x09%s"]);
  if (!out) return [];
  return out
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const [hash, ...rest] = line.split("\t");
      return { hash: hash ?? "", subject: rest.join("\t") };
    });
}

/** Current branch name, or `undefined` when HEAD is detached or not a repo. */
export function getBranch(cwd: string): string | undefined {
  const out = runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!out || out === "HEAD") return undefined;
  return out;
}

/**
 * Detect the repository default branch (`main`, `master`, `trunk`), preferring
 * a local ref over `origin/<name>`. Returns `undefined` when none of the
 * conventional names resolve — callers should treat that as "pass an explicit
 * --base ref or fall back to working-tree review".
 *
 * Mirrors the codex-plugin-cc heuristic so review-scope behavior stays in
 * sync between the two plugins.
 */
export function detectDefaultBranch(cwd: string): string | undefined {
  for (const candidate of ["main", "master", "trunk"]) {
    const local = runGit(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${candidate}`]);
    if (local !== undefined) return candidate;
    const remote = runGit(cwd, [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/remotes/origin/${candidate}`,
    ]);
    if (remote !== undefined) return `origin/${candidate}`;
  }
  return undefined;
}

export type ReviewScope = "auto" | "working-tree" | "branch";

export interface ReviewTarget {
  /** "working-tree" → diff against index/HEAD; "branch" → diff against baseRef. */
  mode: "working-tree" | "branch";
  /** Set when `mode === "branch"`. */
  baseRef?: string;
  /** Human-readable label, e.g. "branch diff against main". */
  label: string;
  /** False when auto-resolved, true when the user passed --base or --scope explicitly. */
  explicit: boolean;
}

/**
 * Resolve what a review should diff. Mirrors codex-plugin-cc's `resolveReviewTarget`:
 *
 *   - explicit `baseRef`         → branch mode against that ref
 *   - `scope === "working-tree"` → working-tree (staged + unstaged)
 *   - `scope === "branch"`       → branch mode against detected default branch
 *   - `scope === "auto"`         → working-tree if dirty, else branch against default
 *
 * Throws on unsupported scope or when branch mode can't find a default branch.
 */
export function resolveReviewTarget(
  cwd: string,
  options: { scope?: ReviewScope; baseRef?: string } = {},
): ReviewTarget {
  const scope = options.scope ?? "auto";
  const baseRef = options.baseRef;

  if (baseRef) {
    return { mode: "branch", baseRef, label: `branch diff against ${baseRef}`, explicit: true };
  }

  if (scope === "working-tree") {
    return { mode: "working-tree", label: "working tree diff", explicit: true };
  }

  if (scope === "branch") {
    const detected = detectDefaultBranch(cwd);
    if (!detected) {
      throw new Error(
        "Unable to detect default branch (looked for main/master/trunk). " +
          "Pass --base <ref> or use --scope working-tree.",
      );
    }
    return {
      mode: "branch",
      baseRef: detected,
      label: `branch diff against ${detected}`,
      explicit: true,
    };
  }

  if (scope !== "auto") {
    throw new Error(
      `Unsupported review scope "${scope}". Use one of: auto, working-tree, branch, or pass --base <ref>.`,
    );
  }

  if (isDirty(cwd)) {
    return { mode: "working-tree", label: "working tree diff", explicit: false };
  }
  const detected = detectDefaultBranch(cwd);
  if (!detected) {
    return {
      mode: "working-tree",
      label: "working tree diff (no default branch)",
      explicit: false,
    };
  }
  return {
    mode: "branch",
    baseRef: detected,
    label: `branch diff against ${detected}`,
    explicit: false,
  };
}

const SOURCE_EXTS = /\.(mts|ts|tsx)$/;
const DECLARATION_EXTS = /\.d\.(mts|ts)$/;
const TEST_PATTERN = /\.test\.(mts|ts|tsx)$/;
const COMPILED_DIRS = /(?:^|\/)(?:bundle|dist|build|compiled|output)\//;
const COMPILED_EXTS = /\.(mjs|js|cjs)$/;
const MAX_LISTED_FILES = 50;

export function getSourceTree(cwd: string): string {
  // Pathspec pre-filter keeps the JS-side scan to candidate extensions
  // only — important for monorepos where most tracked files are neither
  // TypeScript nor compiled output.
  const out = runGit(cwd, ["ls-files", "--", "*.mts", "*.ts", "*.tsx", "*.mjs", "*.js", "*.cjs"]);
  if (!out) return "";

  const files = out.split("\n").filter((f) => f.length > 0);

  const source: string[] = [];
  const tests: string[] = [];
  const compiled: string[] = [];

  for (const f of files) {
    if (SOURCE_EXTS.test(f) && !DECLARATION_EXTS.test(f)) {
      if (TEST_PATTERN.test(f)) {
        tests.push(f);
      } else {
        source.push(f);
      }
    } else if (COMPILED_EXTS.test(f) && COMPILED_DIRS.test(f)) {
      compiled.push(f);
    }
  }

  if (source.length === 0 && compiled.length === 0) return "";

  const lines: string[] = [];

  if (source.length > 0) {
    lines.push("Source files (read these):");
    appendFiles(lines, source);
  }
  if (tests.length > 0) {
    lines.push("Tests:");
    appendFiles(lines, tests);
  }
  if (compiled.length > 0) {
    // Listing every compiled artifact baits the agent into reading them.
    lines.push("Compiled output (do not read — use the source files above):");
    appendDirSummary(lines, compiled);
  }

  return lines.join("\n");
}

function appendFiles(lines: string[], files: string[]): void {
  if (files.length <= MAX_LISTED_FILES) {
    for (const f of files) lines.push(`  ${f}`);
    return;
  }
  appendDirSummary(lines, files);
}

function appendDirSummary(lines: string[], files: string[]): void {
  const dirs = new Map<string, number>();
  for (const f of files) {
    const dir = f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : ".";
    dirs.set(dir, (dirs.get(dir) ?? 0) + 1);
  }
  for (const [dir, count] of [...dirs.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`  ${dir}/ (${count} ${count === 1 ? "file" : "files"})`);
  }
}

/** `remote.origin.url` if set; otherwise `undefined`. */
export function getRemoteUrl(cwd: string): string | undefined {
  return runGit(cwd, ["config", "--get", "remote.origin.url"]) || undefined;
}

/**
 * Files changed against HEAD (or against `baseRef` when provided). Returns
 * one entry per file with the porcelain status code (`M`, `A`, `D`, `R`...).
 */
export interface ChangedFile {
  status: string;
  path: string;
}

export function getChangedFiles(cwd: string, options: { baseRef?: string } = {}): ChangedFile[] {
  const args = options.baseRef
    ? ["diff", "--name-status", options.baseRef]
    : ["status", "--porcelain"];
  const out = runGit(cwd, args);
  if (!out) return [];
  return out
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      // status --porcelain uses 2-char status; diff --name-status uses TAB
      if (options.baseRef) {
        const [status, ...rest] = line.split("\t");
        return { status: status ?? "?", path: rest.join("\t") };
      }
      const status = line.slice(0, 2).trim() || "?";
      const path = line.slice(3);
      return { status, path };
    });
}

export interface CloudRepoRef {
  url: string;
  startingRef?: string;
}

/**
 * Normalize a git remote URL to the canonical `https://github.com/<owner>/<repo>`
 * form. Returns `undefined` when the remote isn't a recognizable GitHub URL.
 * Ported from cursor/cookbook coding-agent-cli — keeps cloud-mode startup
 * simple by accepting the three forms developers typically have configured.
 */
export function normalizeGitHubRemote(remote: string): string | undefined {
  const trimmed = remote.trim().replace(/\.git$/, "");
  const sshMatch = trimmed.match(/^git@github\.com:(.+\/.+)$/);
  const sshUrlMatch = trimmed.match(/^ssh:\/\/git@github\.com\/(.+\/.+)$/);
  const httpsMatch = trimmed.match(/^https:\/\/github\.com\/(.+\/.+)$/);
  const repoPath = sshMatch?.[1] ?? sshUrlMatch?.[1] ?? httpsMatch?.[1];
  return repoPath ? `https://github.com/${repoPath}` : undefined;
}

/**
 * Resolve the cloud-repository descriptor used by `Agent.create({ cloud })`.
 * Throws when `cwd` is not in a git repo with a recognizable GitHub origin —
 * cloud mode currently only works against GitHub-hosted repos.
 */
export function detectCloudRepository(cwd: string): CloudRepoRef {
  const remote = getRemoteUrl(cwd);
  if (!remote) {
    throw new Error(
      "Cloud mode requires a git repository with remote.origin.url set. " +
        "Configure a remote or run in --local mode.",
    );
  }
  const url = normalizeGitHubRemote(remote);
  if (!url) {
    throw new Error(
      `Cloud mode currently expects remote.origin.url to point at GitHub. Got: ${remote}`,
    );
  }
  const branch = getBranch(cwd);
  return branch ? { url, startingRef: branch } : { url };
}
