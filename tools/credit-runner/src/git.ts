import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * The environment for the runner's git calls: never prompt, and none of the
 * caller's GIT_* variables (GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE and the rest
 * would point a call at another repository, for instance from inside a hook).
 */
export function gitEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.toUpperCase().startsWith("GIT_")) env[key] = value;
  }
  return { ...env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" };
}

/**
 * The runner's own git calls: never prompt (an expired credential would
 * otherwise open a dialog and stall an unattended run), never hang past two
 * minutes, print paths unquoted so non-ASCII names parse, and act only on the
 * repository named by cwd (see gitEnv).
 */
export async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, "-c", "core.quotePath=false", ...args], {
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120_000,
    windowsHide: true,
    env: gitEnv(),
  });
  // Trailing whitespace only: leading spaces are meaningful in porcelain output.
  return stdout.replace(/\s+$/u, "");
}

export interface GitResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * The same call as git(), for a command whose failure is an answer rather than
 * an error (`git apply --check`) or that reads stdin (`git mailinfo`). It never
 * throws for a non-zero exit. stdin is opened only when there is input; git
 * may exit before reading all of it (it failed early, or the command reads no
 * stdin), and the failed write that follows (EPIPE on Linux, EOF on Windows)
 * is not git's answer: its exit code and stderr are.
 */
export function gitResult(cwd: string, args: readonly string[], input?: Buffer): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["-C", cwd, "-c", "core.quotePath=false", ...args], {
      windowsHide: true,
      timeout: 120_000,
      env: gitEnv(),
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
    });
    if (child.stdin !== null) {
      child.stdin.on("error", () => undefined);
      child.stdin.end(input);
    }
  });
}

const TEST_FILE = /(^|\/)(__tests__\/|[^/]+\.(test|spec)\.[cm]?[jt]sx?$)/u;

export function isTestFile(file: string): boolean {
  return TEST_FILE.test(file.replace(/\\/gu, "/"));
}

export function deletedTests(filesDeleted: readonly string[]): string[] {
  return filesDeleted.filter(isTestFile);
}

/**
 * A repo-relative path as a Windows checkout would resolve it, for matching:
 * forward slashes, NFC, and no trailing dots or spaces on a segment (NTFS drops
 * them). The patterns that test it ignore case, as NTFS does.
 */
export function pathForMatching(file: string): string {
  return file
    .replace(/\\/gu, "/")
    .normalize("NFC")
    .split("/")
    .map((segment) => segment.replace(/[. ]+$/u, ""))
    .join("/");
}

/**
 * Deploy, environment and tooling config an unattended run must never change.
 * Matched, ignoring case, against pathForMatching's form of a repo-relative path.
 */
export const PROTECTED_PATHS: readonly { readonly pattern: RegExp; readonly label: string }[] = [
  { pattern: /(^|\/)\.env($|\.)/iu, label: "environment file" },
  { pattern: /(^|\/)Dockerfile(\.[^/]*)?$/iu, label: "Dockerfile" },
  { pattern: /(^|\/)\.dockerignore$/iu, label: "Docker config" },
  { pattern: /(^|\/)railway\.(json|toml)$/iu, label: "Railway config" },
  { pattern: /(^|\/)nixpacks\.toml$/iu, label: "Nixpacks config" },
  { pattern: /(^|\/)vercel\.json$/iu, label: "Vercel config" },
  { pattern: /(^|\/)\.npmrc$/iu, label: "npm config" },
  { pattern: /^\.github\//iu, label: "GitHub workflow or config" },
  { pattern: /^\.husky\//iu, label: "git hook" },
  // Attributes can mark a text file binary, hiding it from diffs and scans, or run filters on checkout.
  { pattern: /(^|\/)\.gitattributes$/iu, label: "git attributes" },
  { pattern: /^\.claude\/settings[^/]*\.json$/iu, label: "Claude settings" },
  { pattern: /^\.claude\/hooks\//iu, label: "Claude hook" },
  { pattern: /(^|\/)\.mcp\.json$/iu, label: "MCP config" },
  { pattern: /\.(cmd|bat|com|exe)$/iu, label: "Windows executable (could shadow pnpm or vitest)" },
  { pattern: /^docs\/state\/tasks\.md$/iu, label: "shared task ledger" },
  { pattern: /^docs\/sessions\//iu, label: "session log" },
];

/**
 * A segment in NTFS 8.3 short-name form (`CLAUDE~1`, `SETTIN~1.JSO`): Windows
 * can resolve it to a long name such as `.claude`, so no pattern above can be
 * trusted to see what it names. Git applies the same rule to `.git` (`GIT~1`).
 */
const SHORT_NAME = /~\d+(\.[^.]{1,3})?$/u;

/**
 * The protected paths among `files`, each with why. A path with a segment in
 * 8.3 short-name form counts as protected whatever it names.
 */
export function protectedPathViolations(files: readonly string[]): string[] {
  const found: string[] = [];
  for (const file of files) {
    const matchable = pathForMatching(file);
    const shown = file.replace(/\\/gu, "/");
    const hit = PROTECTED_PATHS.find(({ pattern }) => pattern.test(matchable));
    if (hit !== undefined) found.push(`${shown} (${hit.label})`);
    else if (matchable.split("/").some((segment) => SHORT_NAME.test(segment))) {
      found.push(`${shown} (8.3 short name, which Windows can resolve to a protected file or folder)`);
    }
  }
  return [...new Set(found)];
}
