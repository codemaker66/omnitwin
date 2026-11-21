import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * The runner's own git calls: never prompt (an expired credential would
 * otherwise open a dialog and stall an unattended night), never hang past two
 * minutes, and print paths unquoted so non-ASCII names parse.
 */
export async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, "-c", "core.quotePath=false", ...args], {
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120_000,
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" },
  });
  // Trailing whitespace only: leading spaces are meaningful in porcelain output.
  return stdout.replace(/\s+$/u, "");
}

export async function branchExists(repo: string, branch: string): Promise<boolean> {
  try {
    await git(repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetches the base (when it is a remote branch) and adds a worktree on a new
 * branch at the fetched commit. Basing on origin/master after a fetch avoids the
 * stale-local-master trap that bit earlier app worktrees.
 */
export async function prepareWorktree(
  repo: string,
  worktree: string,
  branch: string,
  baseRef: string,
): Promise<{ baseSha: string }> {
  const remote = /^origin\/(.+)$/u.exec(baseRef);
  // baseRef is validated in task.ts, so it can never start with "-".
  if (remote?.[1] !== undefined) await git(repo, ["fetch", "--quiet", "origin", remote[1]]);
  const baseSha = await git(repo, ["rev-parse", "--verify", "--end-of-options", `${baseRef}^{commit}`]);
  await git(repo, ["worktree", "add", "--quiet", "-b", branch, worktree, baseSha]);
  return { baseSha };
}

export interface BranchState {
  readonly commits: readonly string[];
  /** Every path the branch added, changed or deleted (renames count as both names). */
  readonly filesChanged: readonly string[];
  readonly filesDeleted: readonly string[];
  readonly dirtyFiles: readonly string[];
}

/** Splits `git … -z` output on NUL. */
function nulFields(text: string): string[] {
  return text.split("\0").filter((field) => field !== "");
}

export async function inspectBranch(worktree: string, baseSha: string): Promise<BranchState> {
  const commits = (await git(worktree, ["log", "--format=%h %s", `${baseSha}..HEAD`]))
    .split("\n")
    .filter((line) => line.trim() !== "");

  // --no-renames reports a move as a delete plus an add, so both names are checked.
  const diff = nulFields(await git(worktree, ["diff", "--name-status", "--no-renames", "-z", `${baseSha}..HEAD`]));
  const filesChanged: string[] = [];
  const filesDeleted: string[] = [];
  for (let index = 0; index + 1 < diff.length; index += 2) {
    const status = diff[index] ?? "";
    const file = diff[index + 1] ?? "";
    filesChanged.push(file);
    if (status.startsWith("D")) filesDeleted.push(file);
  }

  const status = nulFields(await git(worktree, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames"]));
  const dirtyFiles = status.map((entry) => entry.slice(3));
  return { commits, filesChanged, filesDeleted, dirtyFiles };
}

/** Every ref on origin and the commit it points at. */
export async function remoteRefs(repo: string): Promise<ReadonlyMap<string, string>> {
  const refs = new Map<string, string>();
  for (const line of (await git(repo, ["ls-remote", "origin"])).split("\n")) {
    const [sha, ref] = line.split("\t");
    if (sha !== undefined && ref !== undefined && sha !== "") refs.set(ref, sha);
  }
  return refs;
}

/** Refs that appeared, moved or vanished on origin between two snapshots. */
export function changedRefs(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): string[] {
  const changed: string[] = [];
  for (const [ref, sha] of after) {
    if (before.get(ref) !== sha) changed.push(ref);
  }
  for (const ref of before.keys()) {
    if (!after.has(ref)) changed.push(ref);
  }
  return changed.sort();
}

/**
 * A fingerprint of the shared `.git` config and hooks. Every worktree shares
 * them with Blake's own checkouts, so a planted hook, fsmonitor or filter would
 * run in his sessions; any change during a run rejects it.
 */
export async function gitIntegrity(repo: string): Promise<string> {
  const commonDir = path.resolve(repo, await git(repo, ["rev-parse", "--git-common-dir"]));
  const hash = createHash("sha256");
  const add = async (file: string): Promise<void> => {
    hash.update(`${path.relative(commonDir, file)}\0`);
    try {
      hash.update(await readFile(file));
    } catch {
      hash.update("(missing)");
    }
  };
  await add(path.join(commonDir, "config"));
  try {
    const hooks = (await readdir(path.join(commonDir, "hooks"))).filter((name) => !name.endsWith(".sample")).sort();
    for (const name of hooks) await add(path.join(commonDir, "hooks", name));
  } catch {
    hash.update("(no hooks folder)");
  }
  return hash.digest("hex");
}

const KEY_SHAPE = /sk-ant-[A-Za-z0-9_-]{16,}/u;

/**
 * Files on the branch or left in the worktree that hold something shaped like
 * an Anthropic API key. Only added lines of the diff and untracked files count,
 * so documentation that merely mentions the `sk-ant-` prefix does not trip it.
 */
export async function findKeyShapedStrings(worktree: string, baseSha: string, untracked: readonly string[]): Promise<string[]> {
  const found = new Set<string>();
  let current = "";
  for (const line of (await git(worktree, ["diff", "--no-color", "--no-renames", "-U0", baseSha])).split("\n")) {
    if (line.startsWith("+++ ")) current = line.replace(/^\+\+\+ (b\/)?/u, "");
    else if (line.startsWith("+") && KEY_SHAPE.test(line)) found.add(current);
  }
  for (const file of untracked) {
    const full = path.join(worktree, file);
    try {
      if ((await stat(full)).size > 2 * 1024 * 1024) continue;
      if (KEY_SHAPE.test(await readFile(full, "utf8"))) found.add(file);
    } catch {
      // A folder or a file that vanished; nothing to scan.
    }
  }
  return [...found].sort();
}

const TEST_FILE = /(^|\/)(__tests__\/|[^/]+\.(test|spec)\.[cm]?[jt]sx?$)/u;

export function deletedTests(filesDeleted: readonly string[]): string[] {
  return filesDeleted.filter((file) => TEST_FILE.test(file.replace(/\\/gu, "/")));
}

/**
 * Deploy, environment and tooling config an unattended run must never change.
 * Matched against repo-relative paths with forward slashes.
 */
const PROTECTED_PATHS: readonly { readonly pattern: RegExp; readonly label: string }[] = [
  { pattern: /(^|\/)\.env($|\.)/u, label: "environment file" },
  { pattern: /(^|\/)Dockerfile[^/]*$/u, label: "Dockerfile" },
  { pattern: /(^|\/)\.dockerignore$/u, label: "Docker config" },
  { pattern: /(^|\/)railway\.(json|toml)$/u, label: "Railway config" },
  { pattern: /(^|\/)nixpacks\.toml$/u, label: "Nixpacks config" },
  { pattern: /(^|\/)vercel\.json$/u, label: "Vercel config" },
  { pattern: /(^|\/)\.npmrc$/u, label: "npm config" },
  { pattern: /^\.github\//u, label: "GitHub workflow or config" },
  { pattern: /^\.husky\//u, label: "git hook" },
  { pattern: /^\.claude\/settings[^/]*\.json$/u, label: "Claude settings" },
  { pattern: /^\.claude\/hooks\//u, label: "Claude hook" },
  { pattern: /(^|\/)\.mcp\.json$/u, label: "MCP config" },
  { pattern: /\.(cmd|bat|com|exe)$/iu, label: "Windows executable (could shadow pnpm or vitest)" },
  { pattern: /^docs\/state\/tasks\.md$/u, label: "shared task ledger" },
  { pattern: /^docs\/sessions\//u, label: "session log" },
];

export function protectedPathViolations(files: readonly string[]): string[] {
  const found: string[] = [];
  for (const file of files) {
    const normalized = file.replace(/\\/gu, "/");
    const hit = PROTECTED_PATHS.find(({ pattern }) => pattern.test(normalized));
    if (hit !== undefined) found.push(`${normalized} (${hit.label})`);
  }
  return [...new Set(found)];
}

/** Removes a runner worktree and its branch. Refuses anything outside the runner's branch prefix. */
export async function removeRun(repo: string, worktree: string, branch: string, prefix: string): Promise<void> {
  if (!branch.startsWith(prefix)) throw new Error(`refusing to delete '${branch}': not a ${prefix} branch`);
  try {
    await git(repo, ["worktree", "remove", "--force", worktree]);
  } catch {
    // Already removed, or never created; prune below tidies git's records.
  }
  await git(repo, ["worktree", "prune"]);
  if (await branchExists(repo, branch)) await git(repo, ["branch", "-D", branch]);
}
