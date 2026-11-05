#!/usr/bin/env node
// The night launcher's own check, run inside the Managed Agents sandbox.
//
// It is uploaded read-only to /mnt/session/uploads/ with task.json beside it,
// and the agent runs it with exactly `node /mnt/session/uploads/verify.mjs`.
// The launcher reads this script's raw output from the session's tool result,
// never the agent's account of it. It proves, on the agent's final commit:
//
//   1. the branch sits on the base commit the launcher chose, is clean, and
//      every commit carries the task trailer;
//   2. the acceptance command passes on the branch;
//   3. the acceptance command FAILS when the fix is taken away: every changed
//      non-test file is put back to the base commit (a fix), or, when only
//      tests changed (a pinning test), the task's mutation breaks the code
//      under test.
//
// The repository is restored to the branch's commit before it exits.
// Output: one line `VERIFY_RESULT {json}` on stdout, and the same JSON in
// /mnt/session/outputs/verify.json when that folder exists.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const TEST_FILE = /(^|\/)(__tests__\/|[^/]+\.(test|spec)\.[cm]?[jt]sx?$)/u;
const TAIL_CHARS = 3000;
const OUTPUTS = process.env.VERIFY_OUTPUTS_DIR ?? "/mnt/session/outputs";

const taskFile = process.argv[2] ?? "/mnt/session/uploads/task.json";
const task = JSON.parse(readFileSync(taskFile, "utf8"));
const repo = task.repoDir;
const timeoutMs = (task.acceptanceTimeoutMinutes ?? 20) * 60_000;
const shell = process.platform === "win32" ? "bash" : "/bin/bash";

function git(...args) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
}

function gitOk(...args) {
  return spawnSync("git", args, { cwd: repo, encoding: "utf8" }).status === 0;
}

function run(command) {
  const started = Date.now();
  const child = spawnSync(command, { cwd: repo, shell, encoding: "utf8", timeout: timeoutMs, maxBuffer: 256 * 1024 * 1024 });
  const output = `${child.stdout ?? ""}${child.stderr ?? ""}`;
  return {
    exitCode: child.status,
    timedOut: child.error?.code === "ETIMEDOUT",
    ms: Date.now() - started,
    tail: output.slice(-TAIL_CHARS),
  };
}

/** Back to the branch's own commit, keeping ignored files such as node_modules. */
function restore(head) {
  git("reset", "--quiet", "--hard", head);
  git("clean", "-fdq");
}

const problems = [];
const result = { taskId: task.id, baseSha: task.baseSha, problems };

const head = git("rev-parse", "HEAD");
result.head = head;
if (!gitOk("merge-base", "--is-ancestor", task.baseSha, head)) problems.push(`HEAD ${head} does not descend from the base ${task.baseSha}`);

const dirty = git("status", "--porcelain", "--untracked-files=all");
result.dirty = dirty === "" ? [] : dirty.split("\n");
if (dirty !== "") problems.push("the working tree has uncommitted changes");

const log = git("log", "--format=%H%x1f%B%x1e", `${task.baseSha}..${head}`);
const commits = log
  .split("\x1e")
  .map((entry) => entry.trim())
  .filter((entry) => entry !== "")
  .map((entry) => {
    const [sha, body = ""] = entry.split("\x1f");
    return { sha, trailer: body.includes(`Credit-Runner-Task: ${task.id}`) };
  });
result.commits = commits.map((commit) => commit.sha);
if (commits.length === 0) problems.push("the branch has no commits on top of the base");
if (commits.some((commit) => !commit.trailer)) problems.push(`a commit lacks the trailer "Credit-Runner-Task: ${task.id}"`);

const status = git("diff", "--name-status", "--no-renames", task.baseSha, head)
  .split("\n")
  .filter((line) => line !== "")
  .map((line) => {
    const [kind, file] = line.split("\t");
    return { kind, file };
  });
result.changed = status.map(({ kind, file }) => `${kind} ${file}`);
const sources = status.filter(({ file }) => !TEST_FILE.test(file));
const tests = status.filter(({ file }) => TEST_FILE.test(file));
result.tests = tests.map(({ file }) => file);
result.sources = sources.map(({ file }) => file);
if (tests.length === 0) problems.push("no test file changed, so nothing proves the change");

if (dirty === "" && commits.length > 0) {
  result.branch = run(task.acceptance);
  if (result.branch.exitCode !== 0) problems.push("the acceptance command fails on the branch");

  if (sources.length > 0) {
    // Take the fix away and keep the new tests: modified and deleted files go
    // back to the base, added non-test files are removed.
    result.base = { mode: "revert-source" };
    for (const { kind, file } of sources) {
      if (kind === "A") rmSync(path.join(repo, file), { force: true });
      else git("checkout", task.baseSha, "--", file);
    }
  } else if (typeof task.mutation === "string" && task.mutation.trim() !== "") {
    result.base = { mode: "mutation", mutation: task.mutation };
    const mutated = run(task.mutation);
    result.base.mutationExit = mutated.exitCode;
    if (mutated.exitCode !== 0) problems.push("the mutation command failed, so the code under test was not broken");
    if (git("status", "--porcelain") === "") problems.push("the mutation changed no file");
  } else {
    result.base = { mode: "none" };
    problems.push("only tests changed and the task names no mutation, so the tests cannot be shown to catch a fault");
  }

  if (result.base.mode !== "none") {
    Object.assign(result.base, run(task.acceptance));
    if (result.base.exitCode === 0) problems.push("the acceptance command still passes without the fix, so the tests do not prove it");
  }
  restore(head);
  if (git("rev-parse", "HEAD") !== head || git("status", "--porcelain", "--untracked-files=all") !== "") {
    problems.push("the repository could not be restored to the branch's commit");
  }
}

result.ok = problems.length === 0;
if (existsSync(OUTPUTS)) writeFileSync(path.join(OUTPUTS, "verify.json"), `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`VERIFY_RESULT ${JSON.stringify(result)}\n`);
process.exit(result.ok ? 0 : 1);
