import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Real format-patch files, made by git from a throwaway repository, so the
// review reads exactly what a session's outputs would hold. The repository
// also stands in for the public one: the review fetches the base from it.

export const PAGE_CHECK = "packages/api/src/services/page-check.ts";
export const PAGE_CHECK_TEST = "packages/api/src/__tests__/page-check.test.ts";

export const BASE_FILES: Readonly<Record<string, string>> = {
  [PAGE_CHECK]: 'export function matches(rule: string, url: string): boolean {\n  return new RegExp(rule.split("*").join(".*")).test(url);\n}\n',
  [PAGE_CHECK_TEST]: 'import { matches } from "../services/page-check";\n\nit("matches a plain rule", () => expect(matches("/a", "/a")).toBe(true));\n',
  ".github/workflows/ci.yml": "on: push\n",
  "README.md": "# Fixture\n",
};

export interface Commit {
  readonly subject: string;
  readonly body?: string;
  readonly write?: Readonly<Record<string, string | Buffer>>;
  readonly remove?: readonly string[];
  readonly rename?: Readonly<Record<string, string>>;
  /** Path to target, staged through the index: no symlink is made on disk. */
  readonly symlink?: Readonly<Record<string, string>>;
  /** Path to commit id, a submodule link staged through the index. */
  readonly gitlink?: Readonly<Record<string, string>>;
  /** Paths made executable (mode 100755) through the index. */
  readonly chmodX?: readonly string[];
  /** Index entries moved to a new path with their mode and object: a gitlink, which `git mv` cannot move without a checkout. */
  readonly moveEntry?: Readonly<Record<string, string>>;
}

/** Links in the base commit itself, staged through the index (nothing is made on disk). */
export interface BaseLinks {
  /** Path to target. */
  readonly symlink?: Readonly<Record<string, string>>;
  /** Path to commit id. */
  readonly gitlink?: Readonly<Record<string, string>>;
}

/** The fix most tests use: the source and its test, in one commit. */
export const FIX: Commit = {
  subject: "Match robots",
  write: {
    [PAGE_CHECK]:
      'export function matches(rule: string, url: string): boolean {\n  return rule === url || rule === "*";\n}\n',
    [PAGE_CHECK_TEST]:
      'import { matches } from "../services/page-check";\n\nit("matches a plain rule", () => expect(matches("/a", "/a")).toBe(true));\nit("matches a lone wildcard", () => expect(matches("*", "/b")).toBe(true));\n',
  },
};

export interface PatchFixture {
  /** A file:// URL the review can fetch the base from. */
  readonly url: string;
  readonly base: string;
  /** Oldest first, the order format-patch numbers them. */
  readonly commits: readonly string[];
  readonly head: string;
  /** Format-patch file name to its text. */
  readonly patches: Readonly<Record<string, string>>;
  readonly diff: string;
}

function git(cwd: string, args: readonly string[], input?: string): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", input, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }).trim();
}

function stageLinks(repo: string, links: BaseLinks): void {
  for (const [file, target] of Object.entries(links.symlink ?? {})) {
    const blob = git(repo, ["hash-object", "-w", "--stdin"], target);
    git(repo, ["update-index", "--add", "--cacheinfo", `120000,${blob},${file}`]);
  }
  for (const [file, sha] of Object.entries(links.gitlink ?? {})) {
    git(repo, ["update-index", "--add", "--cacheinfo", `160000,${sha},${file}`]);
  }
}

async function writeFiles(repo: string, files: Readonly<Record<string, string | Buffer>>): Promise<void> {
  for (const [file, data] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(repo, file)), { recursive: true });
    await writeFile(path.join(repo, file), data);
  }
}

/**
 * Builds a repository at `root` whose master is the base, commits `commits` on
 * a branch, and returns the branch's format-patch files and diff.
 * `localAttributes` goes in .git/info/attributes: attributes the agent could set
 * in its container without committing them. `baseLinks` puts symlinks and
 * gitlinks in the base commit. `formatPatchArgs` are added to `git format-patch`
 * (`--text`, say, to write a file the attributes call binary as text).
 */
export async function patchFixture(
  root: string,
  commits: readonly Commit[],
  options: {
    readonly baseFiles?: Readonly<Record<string, string>>;
    readonly baseLinks?: BaseLinks;
    readonly localAttributes?: string;
    readonly formatPatchArgs?: readonly string[];
  } = {},
): Promise<PatchFixture> {
  const repo = path.join(root, "origin");
  await mkdir(repo, { recursive: true });
  git(repo, ["init", "--quiet", "-b", "master"]);
  git(repo, ["config", "user.email", "night-run@example.invalid"]);
  git(repo, ["config", "user.name", "Night Run"]);
  git(repo, ["config", "core.autocrlf", "false"]);
  // The review fetches the base's trees only, as it does from GitHub.
  git(repo, ["config", "uploadpack.allowFilter", "true"]);
  await writeFiles(repo, options.baseFiles ?? BASE_FILES);
  git(repo, ["add", "."]);
  stageLinks(repo, options.baseLinks ?? {});
  git(repo, ["commit", "--quiet", "-m", "base"]);
  const base = git(repo, ["rev-parse", "HEAD"]);
  if (options.localAttributes !== undefined) await writeFile(path.join(repo, ".git", "info", "attributes"), options.localAttributes);

  git(repo, ["checkout", "--quiet", "-b", "credit/fixture"]);
  for (const commit of commits) {
    if (commit.write !== undefined) {
      await writeFiles(repo, commit.write);
      git(repo, ["add", "--", ...Object.keys(commit.write)]);
    }
    for (const file of commit.remove ?? []) git(repo, ["rm", "--quiet", "--", file]);
    for (const [from, to] of Object.entries(commit.rename ?? {})) {
      await mkdir(path.dirname(path.join(repo, to)), { recursive: true });
      git(repo, ["mv", from, to]);
    }
    stageLinks(repo, { symlink: commit.symlink ?? {}, gitlink: commit.gitlink ?? {} });
    for (const file of commit.chmodX ?? []) git(repo, ["update-index", "--chmod=+x", "--", file]);
    for (const [from, to] of Object.entries(commit.moveEntry ?? {})) {
      const [mode = "", object = ""] = git(repo, ["ls-files", "--stage", "--", from]).split(/\s+/u);
      git(repo, ["update-index", "--force-remove", "--", from]);
      git(repo, ["update-index", "--add", "--cacheinfo", `${mode},${object},${to}`]);
    }
    const body = commit.body === undefined ? "" : `${commit.body}\n\n`;
    git(repo, ["commit", "--quiet", "-m", `${commit.subject}\n\n${body}Credit-Runner-Task: robots-wildcards`]);
  }
  const head = git(repo, ["rev-parse", "HEAD"]);
  const commitList = git(repo, ["rev-list", "--reverse", `${base}..${head}`]).split("\n").filter((line) => line !== "");

  const patchDir = path.join(root, "patches");
  git(repo, ["format-patch", "--quiet", ...(options.formatPatchArgs ?? []), `${base}..${head}`, "-o", patchDir]);
  const patches: Record<string, string> = {};
  for (const name of (await readdir(patchDir)).sort()) patches[name] = await readFile(path.join(patchDir, name), "utf8");
  const diff = `${git(repo, ["diff", base, head])}\n`;
  return { url: pathToFileURL(repo).href, base, commits: commitList, head, patches, diff };
}
