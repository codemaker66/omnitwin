#!/usr/bin/env node
// The sandbox launcher's verifier, run inside the Managed Agents sandbox.
//
// It is uploaded read-only to /mnt/session/uploads/ with task.json beside it,
// and the agent runs it with exactly `node /mnt/session/uploads/verify.mjs`.
// The launcher reads this script's raw output from the session's tool result,
// never the agent's account of it. It checks, on the agent's final commit:
//
//   1. the branch sits on the base commit the launcher chose, is clean, and
//      every commit carries the task trailer;
//   2. the acceptance command passes on the branch;
//   3. the acceptance command FAILS when the fix is taken away: every changed
//      non-test file is put back to the base commit (a fix), or, when only
//      tests changed (a pinning test), the task's mutation breaks the code
//      under test. Only a numeric, non-zero exit that did not time out counts
//      as failing: a timeout, a signal or a command that never started proves
//      nothing.
//
// It runs in a container the agent controls, so the launcher treats its line
// as advisory evidence: the launcher reads the returned patches itself, and CI
// on the pull request is the acceptance authority.
//
// The repository is restored to the branch's commit before it exits.
// Output: one line `VERIFY_RESULT {json}` on stdout, and the same JSON in
// /mnt/session/outputs/verify.json when that folder exists.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const TEST_FILE = /(^|\/)(__tests__\/|[^/]+\.(test|spec)\.[cm]?[jt]sx?$)/u;
// JavaScript or TypeScript: the files whose new names a test can fail on.
const CODE_FILE = /\.[cm]?[jt]sx?$/iu;
// Node in the sandbox image writes its compile cache into the working
// directory (seen on the A4 trial); it is not the agent's work.
const NOT_WORK = /^\?\? node-compile-cache\//u;
const TAIL_CHARS = 3000;
const OUTPUTS = process.env.VERIFY_OUTPUTS_DIR ?? "/mnt/session/outputs";

const taskFile = process.argv[2] ?? "/mnt/session/uploads/task.json";
/**
 * @typedef {object} VerifyTask
 * @property {string} id
 * @property {string} baseSha
 * @property {string} repoDir
 * @property {string} acceptance
 * @property {number} [acceptanceTimeoutMinutes]
 * @property {string} [mutation]
 */
/** @type {unknown} */
const rawTask = JSON.parse(readFileSync(taskFile, "utf8"));
const task = /** @type {VerifyTask} */ (rawTask);
const repo = task.repoDir;
const timeoutMs = (task.acceptanceTimeoutMinutes ?? 20) * 60_000;
const shell = process.platform === "win32" ? "bash" : "/bin/bash";

/**
 * Paths are printed unquoted, so a non-ASCII name is checked out by its real name.
 * @param {...string} args
 */
function git(...args) {
  return execFileSync("git", ["-c", "core.quotePath=false", ...args], { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
}

/** @param {...string} args */
function gitOk(...args) {
  return spawnSync("git", args, { cwd: repo, encoding: "utf8" }).status === 0;
}

/** Uncommitted changes and untracked files, apart from the compile cache. */
function dirtyLines() {
  return git("status", "--porcelain", "--untracked-files=all")
    .split("\n")
    .filter((line) => line !== "" && !NOT_WORK.test(line));
}

/** @typedef {{ exitCode: number | null, timedOut: boolean, ms: number, tail: string }} RunOutcome */

/**
 * @param {string} command
 * @returns {RunOutcome}
 */
function run(command) {
  const started = Date.now();
  const child = spawnSync(command, { cwd: repo, shell, encoding: "utf8", timeout: timeoutMs, maxBuffer: 256 * 1024 * 1024 });
  // The typings say a string; a child that never started leaves these null at run time.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const output = `${child.stdout ?? ""}${child.stderr ?? ""}`;
  return {
    exitCode: child.status,
    timedOut: /** @type {NodeJS.ErrnoException | undefined} */ (child.error)?.code === "ETIMEDOUT",
    ms: Date.now() - started,
    tail: output.slice(-TAIL_CHARS),
  };
}

/** Back to the branch's own commit, keeping ignored files such as node_modules. */
/** @param {string} head */
function restore(head) {
  git("reset", "--quiet", "--hard", head);
  git("clean", "-fdq");
}

/** @type {string[]} */
const problems = [];
/** Worth a reviewer's look, but not a failure. @type {string[]} */
const flags = [];

/**
 * @typedef {Partial<RunOutcome> & { mode: string, mutation?: string, mutationExit?: number | null }} BaseRun
 * @typedef {object} VerifyResult
 * @property {string} taskId
 * @property {string} baseSha
 * @property {string[]} problems
 * @property {string[]} flags
 * @property {string} [head]
 * @property {string[]} [dirty]
 * @property {string[]} [commits] oldest first, the order format-patch numbers them
 * @property {string[]} [changed]
 * @property {string[]} [tests]
 * @property {string[]} [sources]
 * @property {RunOutcome} [branch]
 * @property {BaseRun} [base]
 * @property {boolean} [ok]
 */
/** @type {VerifyResult} */
const result = { taskId: task.id, baseSha: task.baseSha, problems, flags };

const head = git("rev-parse", "HEAD");
result.head = head;
if (!gitOk("merge-base", "--is-ancestor", task.baseSha, head)) problems.push(`HEAD ${head} does not descend from the base ${task.baseSha}`);

const dirty = dirtyLines();
result.dirty = dirty;
if (dirty.length > 0) problems.push("the working tree has uncommitted changes");

const log = git("log", "--reverse", "--format=%H%x1f%B%x1e", `${task.baseSha}..${head}`);
const commits = log
  .split("\x1e")
  .map((entry) => entry.trim())
  .filter((entry) => entry !== "")
  .map((entry) => {
    const [sha = "", body = ""] = entry.split("\x1f");
    return { sha, trailer: body.includes(`Credit-Runner-Task: ${task.id}`) };
  });
result.commits = commits.map((commit) => commit.sha);
if (commits.length === 0) problems.push("the branch has no commits on top of the base");
if (commits.some((commit) => !commit.trailer)) problems.push(`a commit lacks the trailer "Credit-Runner-Task: ${task.id}"`);

const status = git("diff", "--name-status", "--no-renames", task.baseSha, head)
  .split("\n")
  .filter((line) => line !== "")
  .map((line) => {
    const [kind = "", file = ""] = line.split("\t");
    return { kind, file };
  });
result.changed = status.map(({ kind, file }) => `${kind} ${file}`);
const sources = status.filter(({ file }) => !TEST_FILE.test(file));
const tests = status.filter(({ file }) => TEST_FILE.test(file));
result.tests = tests.map(({ file }) => file);
result.sources = sources.map(({ file }) => file);
if (tests.length === 0) problems.push("no test file changed, so nothing proves the change");

// A new non-test file, or a code file that only gains lines (a new
// function), makes the without-fix run fail on a missing name whatever the
// test checks: the revert removes the file or the lines. Each code file is
// judged on its own, so a line removed elsewhere (a README, say) hides nothing.
const addedSources = sources.filter(({ kind }) => kind === "A").map(({ file }) => file);
const addOnlyCode = git("diff", "--numstat", "--no-renames", task.baseSha, head)
  .split("\n")
  .filter((line) => line !== "")
  .map((line) => {
    const [added = "", removed = "", file = ""] = line.split("\t");
    return { added, removed, file };
  })
  .filter(({ added, removed, file }) => !TEST_FILE.test(file) && CODE_FILE.test(file) && !addedSources.includes(file) && added !== "-" && added !== "0" && removed === "0")
  .map(({ file }) => file);
if (addedSources.length > 0) {
  flags.push(
    `the change adds non-test file(s) ${addedSources.join(", ")}, so the run without it removes them and a test may fail on the missing module rather than on the behaviour it checks`,
  );
}
if (addOnlyCode.length > 0) {
  flags.push(`the change only adds lines to ${addOnlyCode.join(", ")}, so the run without it may fail on a missing name rather than on the behaviour the tests check`);
}

if (dirty.length === 0 && commits.length > 0) {
  result.branch = run(task.acceptance);
  if (result.branch.exitCode !== 0) problems.push("the acceptance command fails on the branch");

  /** @type {BaseRun} */
  let base = { mode: "none" };
  if (sources.length > 0) {
    // Take the fix away and keep the new tests: modified and deleted files go
    // back to the base, added non-test files are removed.
    base = { mode: "revert-source" };
    for (const { kind, file } of sources) {
      if (kind === "A") rmSync(path.join(repo, file), { force: true });
      else git("checkout", task.baseSha, "--", file);
    }
  } else if (typeof task.mutation === "string" && task.mutation.trim() !== "") {
    base = { mode: "mutation", mutation: task.mutation };
    const mutated = run(task.mutation);
    base.mutationExit = mutated.exitCode;
    if (mutated.exitCode !== 0) problems.push("the mutation command failed, so the code under test was not broken");
    if (git("status", "--porcelain") === "") problems.push("the mutation changed no file");
  } else {
    base = { mode: "none" };
    problems.push("only tests changed and the task names no mutation, so the tests cannot be shown to catch a fault");
  }

  result.base = base;
  if (base.mode !== "none") {
    // The run's exit, timing and output tail stay in the result for the review.
    Object.assign(base, run(task.acceptance));
    if (base.timedOut === true) {
      problems.push("the acceptance command timed out without the fix, which proves nothing about the tests");
    } else if (typeof base.exitCode !== "number") {
      problems.push("the acceptance command without the fix ended with no exit code (a signal, or it never started), which proves nothing about the tests");
    } else if (base.exitCode === 0) {
      problems.push("the acceptance command still passes without the fix, so the tests do not prove it");
    }
  }
  restore(head);
  if (git("rev-parse", "HEAD") !== head || dirtyLines().length > 0) {
    problems.push("the repository could not be restored to the branch's commit");
  }
}

result.ok = problems.length === 0;
if (existsSync(OUTPUTS)) writeFileSync(path.join(OUTPUTS, "verify.json"), `${JSON.stringify(result, null, 2)}\n`);
// One line: JSON leaves U+2028 and U+2029 (which test output can hold) unescaped.
const line = JSON.stringify(result).replace(/\u2028/gu, "\\u2028").replace(/\u2029/gu, "\\u2029");
process.stdout.write(`VERIFY_RESULT ${line}\n`);
process.exit(result.ok ? 0 : 1);
