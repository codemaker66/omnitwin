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

/** The longest one git call may run before it is stopped. */
export const GIT_TIMEOUT_MS = 120_000;
/** The most a git() call may print before it is stopped. */
export const GIT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

/** What stopped a git call at one of the limits above, in words for a reason; null when it was not a limit. */
function limitHit(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  if ("code" in error && error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return `printed more than ${String(GIT_MAX_OUTPUT_BYTES / 1024 / 1024)} MiB`;
  if ("killed" in error && error.killed === true) return `ran past its ${String(GIT_TIMEOUT_MS / 60_000)}-minute limit`;
  return null;
}

/** The git command `args` run, for a message: the first argument that is neither an option nor the value of a `-c`. */
export function gitCommandName(args: readonly string[]): string {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg === "-c") index += 1;
    else if (!arg.startsWith("-")) return `git ${arg}`;
  }
  return "git";
}

/**
 * The runner's own git calls: never prompt (an expired credential would
 * otherwise open a dialog and stall an unattended run), never hang past
 * GIT_TIMEOUT_MS, print paths unquoted so non-ASCII names parse, and act only
 * on the repository named by cwd (see gitEnv). A call stopped at a limit
 * throws an error that names the limit.
 */
export async function git(cwd: string, args: readonly string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", cwd, "-c", "core.quotePath=false", ...args], {
      maxBuffer: GIT_MAX_OUTPUT_BYTES,
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
      env: gitEnv(),
    });
    // Trailing whitespace only: leading spaces are meaningful in porcelain output.
    return stdout.replace(/\s+$/u, "");
  } catch (error) {
    const limit = limitHit(error);
    if (limit === null) throw error;
    throw new Error(`${gitCommandName(args)} ${limit} and was stopped`, { cause: error });
  }
}

export interface GitResult {
  /** git's exit code; null when it was stopped (see timedOut) or killed by a signal. */
  readonly code: number | null;
  /** Stopped at GIT_TIMEOUT_MS: the code and output are then not git's answer. */
  readonly timedOut: boolean;
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
      env: gitEnv(),
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, GIT_TIMEOUT_MS);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, timedOut, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
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

export interface ProtectedPath {
  /** Matched, ignoring case, against pathForMatching's form of a repo-relative path. */
  readonly pattern: RegExp;
  /** Why the path is protected, as a rejection names it. */
  readonly label: string;
  /** What the pattern covers, in the words the agent's brief uses (a bare file name matches in any folder). */
  readonly paths: string;
}

/**
 * Deploy, environment and install-time config, agent instructions, editor
 * tasks and shared records an unattended run must never change. The brief
 * (brief.ts) names every entry to the agent by its paths and label, so an entry
 * added here reaches the agent's rule and the grader's rubric with it. The
 * first entry that matches gives the label.
 */
export const PROTECTED_PATHS: readonly ProtectedPath[] = [
  { pattern: /(^|\/)\.env($|\.)/iu, label: "environment file", paths: ".env and .env.* files" },
  { pattern: /(^|\/)Dockerfile(\.[^/]*)?$/iu, label: "Dockerfile", paths: "Dockerfile and Dockerfile.*" },
  { pattern: /(^|\/)\.dockerignore$/iu, label: "Docker config", paths: ".dockerignore" },
  {
    pattern: /(^|\/)(railway\.(json|toml)|\.railwayignore)$|^\.railway\//iu,
    label: "Railway config",
    paths: "railway.json, railway.toml, .railwayignore and anything under .railway/",
  },
  { pattern: /(^|\/)nixpacks\.toml$/iu, label: "Nixpacks config", paths: "nixpacks.toml" },
  { pattern: /(^|\/)vercel\.json$/iu, label: "Vercel config", paths: "vercel.json" },
  { pattern: /(^|\/)\.npmrc$/iu, label: "npm config", paths: ".npmrc" },
  { pattern: /^\.github\//iu, label: "GitHub workflow or config", paths: "anything under .github/" },
  { pattern: /^\.husky\//iu, label: "git hook", paths: "anything under .husky/" },
  // Attributes can mark a text file binary, hiding it from diffs and scans, or run filters on checkout.
  { pattern: /(^|\/)\.gitattributes$/iu, label: "git attributes", paths: ".gitattributes" },
  { pattern: /^\.claude\/settings[^/]*\.json$/iu, label: "Claude settings", paths: ".claude/settings*.json" },
  { pattern: /^\.claude\/hooks\//iu, label: "Claude hook", paths: "anything under .claude/hooks/" },
  { pattern: /(^|\/)\.mcp\.json$/iu, label: "MCP config", paths: ".mcp.json" },
  { pattern: /\.(cmd|bat|com|exe)$/iu, label: "Windows executable (could shadow pnpm or vitest)", paths: "any .cmd, .bat, .com or .exe file" },
  { pattern: /^docs\/state\/tasks\.md$/iu, label: "shared task ledger", paths: "docs/state/tasks.md" },
  { pattern: /^docs\/sessions\//iu, label: "session log", paths: "anything under docs/sessions/" },
  // What later agents read as their instructions: the night run's own system
  // prompt is built from AGENTS.md at master, and interactive sessions follow
  // these files too.
  { pattern: /(^|\/)(AGENTS|CLAUDE|CLAUDE\.local)\.md$/iu, label: "agent instructions", paths: "AGENTS.md, CLAUDE.md and CLAUDE.local.md in any folder" },
  // GOAL.md sends agents to the goal cards and the execution board under goals/.
  { pattern: /^(GOAL\.md$|goals\/)/iu, label: "agent goals", paths: "GOAL.md and anything under goals/ at the root" },
  // Agents, skills, commands, conventions and gotchas; in any folder, as a .claude folder below the root can hold the same.
  { pattern: /(^|\/)\.claude\//iu, label: "Claude Code config", paths: "anything else under a .claude/ folder" },
  { pattern: /(^|\/)\.claudeignore$/iu, label: "Claude Code ignore file", paths: ".claudeignore" },
  // Where each installed agent skill is fetched from.
  { pattern: /(^|\/)skills-lock\.json$/iu, label: "agent skills lock", paths: "skills-lock.json" },
  // The GPU pods' image, template and start scripts (which handle the pods' keys) and the dev database's stack.
  { pattern: /^infra\//iu, label: "infrastructure config", paths: "anything under infra/" },
  // Code that runs on whichever machine installs the branch.
  { pattern: /^patches\//iu, label: "pnpm dependency patch, applied at install", paths: "anything under patches/ at the root" },
  { pattern: /(^|\/)\.pnpmfile\.[cm]?js$/iu, label: "pnpm hook file, run at install", paths: ".pnpmfile.cjs, .pnpmfile.mjs or .pnpmfile.js" },
  { pattern: /(^|\/)pnpm-workspace\.yaml$/iu, label: "pnpm workspace config", paths: "pnpm-workspace.yaml" },
  // Editors and dev containers can run tasks when a folder is opened.
  { pattern: /(^|\/)\.vscode\//iu, label: "VS Code config", paths: "anything under a .vscode/ folder" },
  { pattern: /(^|\/)(\.devcontainer\/|\.devcontainer\.json$)/iu, label: "dev container config", paths: "anything under a .devcontainer/ folder, and .devcontainer.json" },
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
