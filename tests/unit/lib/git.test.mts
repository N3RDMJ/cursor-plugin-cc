import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  detectCloudRepository,
  detectDefaultBranch,
  getBranch,
  getChangedFiles,
  getDiff,
  getRecentCommits,
  getRemoteUrl,
  getSourceTree,
  getStatus,
  isDirty,
  normalizeGitHubRemote,
  resolveReviewTarget,
} from "../../../plugins/cursor/scripts/lib/git.mjs";

function git(cwd: string, args: string[]): void {
  execFileSync("git", ["-C", cwd, ...args], { stdio: "ignore" });
}

function makeRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "cursor-git-test-"));
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  return dir;
}

describe("normalizeGitHubRemote", () => {
  it("accepts SSH form", () => {
    expect(normalizeGitHubRemote("git@github.com:foo/bar.git")).toBe("https://github.com/foo/bar");
  });

  it("accepts ssh:// form", () => {
    expect(normalizeGitHubRemote("ssh://git@github.com/foo/bar.git")).toBe(
      "https://github.com/foo/bar",
    );
  });

  it("accepts https form and strips .git", () => {
    expect(normalizeGitHubRemote("https://github.com/foo/bar.git")).toBe(
      "https://github.com/foo/bar",
    );
  });

  it("returns undefined for non-GitHub remotes", () => {
    expect(normalizeGitHubRemote("https://gitlab.com/foo/bar")).toBeUndefined();
    expect(normalizeGitHubRemote("git@bitbucket.org:foo/bar.git")).toBeUndefined();
  });
});

describe("git helpers (in a real temp repo)", () => {
  let repo: string;

  beforeEach(() => {
    repo = makeRepo();
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("getBranch returns the current branch on a fresh repo with one commit", () => {
    writeFileSync(path.join(repo, "a.txt"), "hello\n");
    git(repo, ["add", "a.txt"]);
    git(repo, ["commit", "-q", "-m", "init"]);
    expect(getBranch(repo)).toBe("main");
  });

  it("getRemoteUrl returns origin when set, undefined when absent", () => {
    expect(getRemoteUrl(repo)).toBeUndefined();
    git(repo, ["remote", "add", "origin", "git@github.com:foo/bar.git"]);
    expect(getRemoteUrl(repo)).toBe("git@github.com:foo/bar.git");
  });

  it("getStatus and isDirty reflect uncommitted changes", () => {
    writeFileSync(path.join(repo, "a.txt"), "x\n");
    git(repo, ["add", "a.txt"]);
    git(repo, ["commit", "-q", "-m", "init"]);
    expect(isDirty(repo)).toBe(false);
    writeFileSync(path.join(repo, "a.txt"), "modified\n");
    expect(isDirty(repo)).toBe(true);
    expect(getStatus(repo)).toContain("a.txt");
  });

  it("getDiff returns the working-tree diff", () => {
    writeFileSync(path.join(repo, "a.txt"), "one\n");
    git(repo, ["add", "a.txt"]);
    git(repo, ["commit", "-q", "-m", "init"]);
    writeFileSync(path.join(repo, "a.txt"), "two\n");
    const diff = getDiff(repo);
    expect(diff).toContain("a.txt");
    expect(diff).toContain("-one");
    expect(diff).toContain("+two");
  });

  it("getDiff with staged=true only includes staged changes", () => {
    writeFileSync(path.join(repo, "a.txt"), "one\n");
    git(repo, ["add", "a.txt"]);
    git(repo, ["commit", "-q", "-m", "init"]);
    writeFileSync(path.join(repo, "a.txt"), "two\n");
    git(repo, ["add", "a.txt"]);
    writeFileSync(path.join(repo, "a.txt"), "three\n");
    const staged = getDiff(repo, { staged: true });
    expect(staged).toContain("+two");
    expect(staged).not.toContain("+three");
  });

  it("getRecentCommits returns hash + subject pairs", () => {
    writeFileSync(path.join(repo, "a.txt"), "x\n");
    git(repo, ["add", "a.txt"]);
    git(repo, ["commit", "-q", "-m", "first commit"]);
    writeFileSync(path.join(repo, "b.txt"), "y\n");
    git(repo, ["add", "b.txt"]);
    git(repo, ["commit", "-q", "-m", "second commit"]);

    const commits = getRecentCommits(repo, 5);
    expect(commits).toHaveLength(2);
    expect(commits[0]?.subject).toBe("second commit");
    expect(commits[1]?.subject).toBe("first commit");
    expect(commits[0]?.hash).toMatch(/^[0-9a-f]{40}$/);
  });

  it("getChangedFiles returns porcelain status when no baseRef given", () => {
    writeFileSync(path.join(repo, "a.txt"), "x\n");
    git(repo, ["add", "a.txt"]);
    git(repo, ["commit", "-q", "-m", "init"]);
    writeFileSync(path.join(repo, "a.txt"), "modified\n");
    writeFileSync(path.join(repo, "b.txt"), "new\n");
    const files = getChangedFiles(repo);
    const paths = files.map((f) => f.path);
    expect(paths).toContain("a.txt");
    expect(paths).toContain("b.txt");
    const aFile = files.find((f) => f.path === "a.txt");
    const bFile = files.find((f) => f.path === "b.txt");
    expect(aFile?.status).toBe("M");
    expect(bFile?.status).toBe("??");
  });

  it("detectCloudRepository succeeds when origin points at GitHub", () => {
    writeFileSync(path.join(repo, "a.txt"), "x\n");
    git(repo, ["add", "a.txt"]);
    git(repo, ["commit", "-q", "-m", "init"]);
    git(repo, ["remote", "add", "origin", "git@github.com:foo/bar.git"]);
    expect(detectCloudRepository(repo)).toEqual({
      url: "https://github.com/foo/bar",
      startingRef: "main",
    });
  });

  it("detectCloudRepository throws when there is no origin", () => {
    expect(() => detectCloudRepository(repo)).toThrow(/remote\.origin\.url/);
  });

  it("detectCloudRepository throws on non-GitHub origins", () => {
    git(repo, ["remote", "add", "origin", "https://gitlab.com/foo/bar"]);
    expect(() => detectCloudRepository(repo)).toThrow(/GitHub/);
  });
});

describe("resolveReviewTarget", () => {
  let repo: string;

  beforeEach(() => {
    repo = makeRepo();
    writeFileSync(path.join(repo, "f.txt"), "1\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("auto + clean tree → branch mode against detected default branch", () => {
    const t = resolveReviewTarget(repo, { scope: "auto" });
    expect(t.mode).toBe("branch");
    expect(t.baseRef).toBe("main");
    expect(t.explicit).toBe(false);
  });

  it("auto + dirty tree → working-tree mode (implicit)", () => {
    writeFileSync(path.join(repo, "f.txt"), "2\n");
    const t = resolveReviewTarget(repo, { scope: "auto" });
    expect(t.mode).toBe("working-tree");
    expect(t.baseRef).toBeUndefined();
    expect(t.explicit).toBe(false);
  });

  it("explicit working-tree forces working-tree even when clean", () => {
    const t = resolveReviewTarget(repo, { scope: "working-tree" });
    expect(t.mode).toBe("working-tree");
    expect(t.explicit).toBe(true);
  });

  it("explicit baseRef wins over scope", () => {
    const t = resolveReviewTarget(repo, { scope: "auto", baseRef: "HEAD~0" });
    expect(t.mode).toBe("branch");
    expect(t.baseRef).toBe("HEAD~0");
    expect(t.explicit).toBe(true);
  });

  it("scope=branch detects default branch", () => {
    const t = resolveReviewTarget(repo, { scope: "branch" });
    expect(t.mode).toBe("branch");
    expect(t.baseRef).toBe("main");
  });

  it("rejects an unknown scope", () => {
    // @ts-expect-error testing runtime guard
    expect(() => resolveReviewTarget(repo, { scope: "yolo" })).toThrow(/Unsupported review scope/);
  });

  it("detectDefaultBranch returns 'main' for the conventional repo", () => {
    expect(detectDefaultBranch(repo)).toBe("main");
  });
});

describe("getSourceTree", () => {
  let repo: string;

  beforeEach(() => {
    repo = makeRepo();
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  it("categorizes .mts source, tests, and bundle .mjs files", () => {
    mkdirSync(path.join(repo, "src"), { recursive: true });
    mkdirSync(path.join(repo, "src/bundle"), { recursive: true });
    mkdirSync(path.join(repo, "tests"), { recursive: true });
    writeFileSync(path.join(repo, "src/main.mts"), "export {};");
    writeFileSync(path.join(repo, "src/util.mts"), "export {};");
    writeFileSync(path.join(repo, "src/bundle/main.mjs"), "export {};");
    writeFileSync(path.join(repo, "tests/main.test.mts"), "import 'vitest';");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);

    const tree = getSourceTree(repo);
    expect(tree).toContain("Source files (read these):");
    expect(tree).toContain("src/main.mts");
    expect(tree).toContain("src/util.mts");
    expect(tree).toContain("Tests:");
    expect(tree).toContain("tests/main.test.mts");
    expect(tree).toContain("Compiled output (do not read");
    expect(tree).toContain("src/bundle/ (1 file)");
    expect(tree).not.toContain("src/bundle/main.mjs");
  });

  it("returns empty string for repos with no source or bundle files", () => {
    writeFileSync(path.join(repo, "README.md"), "# hello");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);
    expect(getSourceTree(repo)).toBe("");
  });

  it("excludes .d.ts and .d.mts declaration files from source", () => {
    mkdirSync(path.join(repo, "src"), { recursive: true });
    writeFileSync(path.join(repo, "src/main.mts"), "export {};");
    writeFileSync(path.join(repo, "src/main.d.mts"), "export {};");
    writeFileSync(path.join(repo, "src/types.d.ts"), "export {};");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);

    const tree = getSourceTree(repo);
    expect(tree).toContain("src/main.mts");
    expect(tree).not.toContain("main.d.mts");
    expect(tree).not.toContain("types.d.ts");
  });

  it("ignores .mjs files outside bundle/dist/build directories", () => {
    mkdirSync(path.join(repo, "src"), { recursive: true });
    writeFileSync(path.join(repo, "src/main.mts"), "export {};");
    writeFileSync(path.join(repo, "src/bootstrap.mjs"), "import('./main.mjs');");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);

    const tree = getSourceTree(repo);
    expect(tree).not.toContain("bootstrap.mjs");
    expect(tree).not.toContain("Compiled output");
  });

  it("returns empty string in non-git directory", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cursor-no-git-"));
    try {
      expect(getSourceTree(dir)).toBe("");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("git helpers in a non-git directory", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "cursor-non-git-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("getDiff/getStatus/getBranch/getRemoteUrl all return empty/undefined", () => {
    expect(getDiff(dir)).toBe("");
    expect(getStatus(dir)).toBe("");
    expect(getBranch(dir)).toBeUndefined();
    expect(getRemoteUrl(dir)).toBeUndefined();
    expect(isDirty(dir)).toBe(false);
    expect(getRecentCommits(dir, 5)).toEqual([]);
    expect(getChangedFiles(dir)).toEqual([]);
  });
});
