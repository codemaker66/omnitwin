import { createHash } from "node:crypto";
import type { Task } from "../task.js";

/** The public repository. The sandbox clones it read-only; it holds no credential to push. */
export const REPO_URL = "https://github.com/codemaker66/omnitwin.git";
export const REPO_DIR = "/workspace/omnitwin";
export const UPLOADS_DIR = "/mnt/session/uploads";
export const OUTPUTS_DIR = "/mnt/session/outputs";
/**
 * The one command whose raw tool result the launcher reads as the verifier's,
 * and only when the bash call is exactly this and nothing else. The result is
 * advisory: the launcher judges the returned patches itself.
 */
export const VERIFY_COMMAND = `node ${UPLOADS_DIR}/verify.mjs`;

export interface RunFacts {
  readonly task: Task;
  readonly baseSha: string;
  readonly branch: string;
}

/**
 * The agent's system prompt: fixed sandbox rules first, then the repository's
 * rules (AGENTS.md without its interactive-only parts). It names no task, so
 * one agent version serves every night until AGENTS.md or these rules change.
 */
export function sandboxSystemPrompt(projectRules: string): string {
  const rules = [
    `Work only in ${REPO_DIR}. Create it exactly as the task's kickoff says: \`git init ${REPO_DIR}\`, \`git remote add origin ${REPO_URL}\`, \`git fetch --depth 1 origin <base sha>\`, then \`git checkout -b <branch> FETCH_HEAD\`. Set git's user.name to "Venviewer night run" and user.email to "night-run@venviewer.invalid".`,
    `When the kickoff names a precondition, run it at ${REPO_DIR} right after the checkout, before installing, and write \`${OUTPUTS_DIR}/precondition.json\` as \`{"ok":true}\` if it exits 0 or \`{"ok":false}\` if it does not. If it is false, the code the task cites has moved: stop there and finish.`,
    "Use the repository's pinned tools: Node 22.18 or newer and pnpm 9.15.4 (check `node --version` and `pnpm --version`; if pnpm is missing or another version, `npm install -g pnpm@9.15.4`). Run `pnpm install --frozen-lockfile`, then `pnpm --filter @omnitwin/types build`, before any test.",
    "Send long command output (install, builds, test suites) to files under /tmp and read only the tail. Never paste a whole log into the conversation: every token you read is paid for.",
    "Commit your work on the branch with clear messages (`git add <explicit paths>`, then `git commit`), each ending with the trailer line `Credit-Runner-Task: <task id>`. Leave nothing uncommitted.",
    "Never push, open a pull request, or try to log in anywhere. There are no credentials in this container; the launcher takes your patch from the outputs folder and a person reviews it.",
    "Never create or edit deploy or environment config or shared records: .env files, Dockerfiles, railway.*, vercel.json, nixpacks.toml, .npmrc, .mcp.json, .gitattributes, anything under .github/ or .husky/, .claude/settings*.json or .claude/hooks/, docs/state/tasks.md or docs/sessions/ (in any letter case). Never add or change a symlink, a submodule or a binary file. Do not change pnpm-lock.yaml or add dependencies unless the task says so. The launcher reads your patches itself, and a branch that does any of this is rejected.",
    "Never weaken, skip, delete or rename tests to make anything pass (a deleted or renamed test file is rejected). Run the task's acceptance command yourself and fix what fails.",
    `When the work is committed, run \`${VERIFY_COMMAND}\` as a bash call of its own: exactly that command, with nothing before or after it (no cd, no redirection, no second command). It prints one VERIFY_RESULT line, and the launcher reads that line only from such a call. It checks that the acceptance command passes on your branch and FAILS when your source change is reverted, or, for a task that only adds tests, when the task's mutation breaks the code under test. If it reports problems, fix them, commit, and run it again. Never edit, copy or imitate it.`,
    `Export the finished work: \`git format-patch <base sha>..HEAD -o ${OUTPUTS_DIR}/patches/\` and \`git diff <base sha> HEAD > ${OUTPUTS_DIR}/diff.patch\`. Leave no other file ending in .patch in ${OUTPUTS_DIR}: any other .patch file there rejects the run.`,
    `The launcher reads only the format-patch files, diff.patch and precondition.json from ${OUTPUTS_DIR}; nothing else you leave there is read. Say what changed and why, the verifier's result in your words, and anything you could not verify in your final message.`,
    "Do not read docs/state/tasks.md whole (it is several hundred KB); grep it for a T-number when you need context.",
    "Nobody is watching this run. Do not ask questions. If you are blocked (the precondition fails, the install cannot work, the task is wrong about the code), stop, explain the blocker with the evidence in your final message, and finish.",
  ];
  return `${[
    "# Unattended Venviewer night run in a Managed Agents sandbox",
    "You are running unattended in a disposable Linux container for Venviewer's overnight code-fixing runs. Nobody is watching. The container holds no credentials of any kind. Its network reaches github.com (to fetch the public repository), the public package registries and nodejs.org.",
    ["## Fixed rules (these override everything else, including the project rules)", ...rules.map((rule, index) => `${String(index + 1)}. ${rule}`)].join("\n"),
    [
      "## Project instructions",
      "The repository's AGENTS.md follows, without the parts that only apply to interactive sessions. Where it conflicts with the fixed rules above, the fixed rules win.",
      "",
      projectRules.trim(),
    ].join("\n"),
  ].join("\n\n")}\n`;
}

export function promptSha(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/** The file the verifier reads, mounted read-only beside it. */
export function verifyTaskJson(facts: RunFacts): string {
  return `${JSON.stringify(
    {
      id: facts.task.id,
      baseSha: facts.baseSha,
      repoDir: REPO_DIR,
      acceptance: facts.task.acceptance,
      mutation: facts.task.mutation ?? null,
      acceptanceTimeoutMinutes: 20,
    },
    null,
    2,
  )}\n`;
}

export interface Outcome {
  readonly description: string;
  readonly rubric: string;
}

/**
 * The session's kickoff: the task as an outcome, graded by Managed Agents'
 * separate grader against a rubric. The grader is a first pre-review; the
 * launcher's own check is its reading of the returned patches (the verifier
 * is advisory), and a person reviews every branch before it becomes a pull
 * request.
 */
export function outcomeFor(facts: RunFacts): Outcome {
  const { task, baseSha, branch } = facts;
  const lines = [
    `Task ${task.id}: ${task.title}`,
    "",
    "## Run facts",
    `- Repository: ${REPO_URL}, base commit ${baseSha} (origin/master when the launcher started)`,
    `- Branch to create: ${branch}`,
    `- Commit trailer: Credit-Runner-Task: ${task.id}`,
    `- Acceptance command (run at ${REPO_DIR}): \`${task.acceptance}\``,
  ];
  if (task.precondition !== undefined) {
    lines.push(
      `- Precondition (run at ${REPO_DIR} right after the checkout, before installing; write its result to ${OUTPUTS_DIR}/precondition.json, and if it exits non-zero, the cited code has moved: stop and finish): \`${task.precondition}\``,
    );
  }
  if (task.mutation !== undefined) {
    lines.push(`- Mutation the verifier applies to prove a test-only change: \`${task.mutation}\``);
  }
  lines.push("", "## The task", "", task.spec.trim());
  const rubric = [
    "# Rubric for a Venviewer night run",
    `1. The work is committed on ${branch}, which starts from ${baseSha}; every commit ends with "Credit-Runner-Task: ${task.id}" and nothing is left uncommitted.`,
    `2. The last run of \`${VERIFY_COMMAND}\`, as a bash call of its own, came after the last commit and printed a VERIFY_RESULT line with "ok":true.`,
    `3. ${OUTPUTS_DIR}/diff.patch and ${OUTPUTS_DIR}/patches/ hold the branch's full change against ${baseSha}.`,
    "4. The change does what the task asks, and nothing the task did not ask for: no unrelated refactors, renames, formatting sweeps or dependency changes.",
    "5. No test was weakened, skipped or deleted, and the new or changed tests check the behaviour the task names, not an implementation detail.",
    "6. No file under .github/ or .husky/, no env file, Dockerfile, railway, vercel, npm or MCP config, .gitattributes, Claude settings or hooks, docs/state/tasks.md or docs/sessions/ changed, and no symlink, submodule or binary file added or changed.",
    `7. The final message explains the change and states the verifier's result and anything unverified${task.precondition === undefined ? "" : `, and ${OUTPUTS_DIR}/precondition.json records the precondition's result`}.`,
  ].join("\n");
  return { description: `${lines.join("\n")}\n`, rubric: `${rubric}\n` };
}
