import { execFile as execFileCallback } from "node:child_process";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { safeGitChildEnvironment } from "./safe-git-child-environment.js";

export const GRAND_HALL_REVIEWED_GIT_SHA_ENV =
  "VENVIEWER_GRAND_HALL_REVIEWED_GIT_SHA";

const REVIEWED_GIT_SHA = /^[a-f0-9]{40,64}$/u;
const GIT_COMMAND_DEADLINE_MS = 30_000;
const GIT_COMMAND_MAX_BUFFER_BYTES = 1_048_576;
const execFile = promisify(execFileCallback);

export interface GrandHallReviewedCheckoutState {
  readonly repositoryRoot: string;
  readonly headSha: string;
  readonly reviewedCommitExists: boolean;
  readonly statusPorcelain: string;
}

async function runGitCommand(args: readonly string[]): Promise<string> {
  try {
    const result = await execFile("git", [...args], {
      cwd: tmpdir(),
      encoding: "utf8",
      env: safeGitChildEnvironment(process.env),
      windowsHide: true,
      timeout: GIT_COMMAND_DEADLINE_MS,
      maxBuffer: GIT_COMMAND_MAX_BUFFER_BYTES,
    });
    return String(result.stdout).trim();
  } catch {
    throw new Error("Reviewed Grand Hall Git state could not be established locally");
  }
}

export function reviewedGrandHallGitShaFromEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): string {
  const reviewedGitSha = env[GRAND_HALL_REVIEWED_GIT_SHA_ENV];
  if (reviewedGitSha === undefined || !REVIEWED_GIT_SHA.test(reviewedGitSha)) {
    throw new Error(
      `${GRAND_HALL_REVIEWED_GIT_SHA_ENV} must be the exact lowercase reviewed commit SHA`,
    );
  }
  return reviewedGitSha;
}

export async function inspectGrandHallReviewedCheckout(
  reviewedGitSha: string,
  scriptFilePath: string,
  dependencies: {
    readonly resolveRealPath?: (path: string) => Promise<string>;
    readonly executeGit?: (args: readonly string[]) => Promise<string>;
  } = {},
): Promise<GrandHallReviewedCheckoutState> {
  const resolveRealPath = dependencies.resolveRealPath ?? realpath;
  const executeGit = dependencies.executeGit ?? runGitCommand;
  const canonicalScriptPath = await resolveRealPath(scriptFilePath);
  const discoveredRoot = await executeGit([
    "-C",
    dirname(canonicalScriptPath),
    "rev-parse",
    "--show-toplevel",
  ]);
  const repositoryRoot = await resolveRealPath(discoveredRoot);
  const scriptRelativePath = relative(repositoryRoot, canonicalScriptPath);
  if (
    scriptRelativePath.length === 0 ||
    isAbsolute(scriptRelativePath) ||
    scriptRelativePath === ".." ||
    scriptRelativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  ) {
    throw new Error("The guarded Grand Hall script is outside its Git repository");
  }

  const headSha = await executeGit([
    "-C",
    repositoryRoot,
    "rev-parse",
    "--verify",
    "HEAD^{commit}",
  ]);
  let reviewedCommitExists = false;
  try {
    reviewedCommitExists = await executeGit([
      "-C",
      repositoryRoot,
      "rev-parse",
      "--verify",
      `${reviewedGitSha}^{commit}`,
    ]) === reviewedGitSha;
  } catch {
    reviewedCommitExists = false;
  }
  const statusPorcelain = await executeGit([
    "-C",
    repositoryRoot,
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--ignore-submodules=none",
  ]);
  return {
    repositoryRoot,
    headSha,
    reviewedCommitExists,
    statusPorcelain,
  };
}

export function assertGrandHallReviewedCheckoutState(
  state: GrandHallReviewedCheckoutState,
  reviewedGitSha: string,
): void {
  if (
    !isAbsolute(state.repositoryRoot) ||
    resolve(state.repositoryRoot) !== state.repositoryRoot ||
    !state.reviewedCommitExists ||
    state.headSha !== reviewedGitSha ||
    state.statusPorcelain.length !== 0
  ) {
    throw new Error(
      "Grand Hall staging mutations require the exact reviewed clean Git checkout",
    );
  }
}

export async function assertGrandHallReviewedCheckout(input: {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly scriptFilePath: string;
}): Promise<void> {
  const reviewedGitSha = reviewedGrandHallGitShaFromEnvironment(input.env);
  const state = await inspectGrandHallReviewedCheckout(
    reviewedGitSha,
    input.scriptFilePath,
  );
  assertGrandHallReviewedCheckoutState(state, reviewedGitSha);
}
