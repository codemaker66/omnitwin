import type { Task } from "./task.js";

export interface PromptContext {
  readonly task: Task;
  readonly branch: string;
  readonly worktree: string;
  readonly baseRef: string;
  readonly baseSha: string;
}

/**
 * Appended to Claude Code's own system prompt. `--bare` skips CLAUDE.md
 * discovery, and on master CLAUDE.md is only an `@AGENTS.md` import, so the
 * project rules (AGENTS.md with its interactive-only parts removed, see
 * project-rules.ts) are passed in here explicitly, after the fixed rules.
 */
export function buildSystemPrompt(ctx: PromptContext, projectRules: string | null): string {
  const { task } = ctx;
  const rules = [
    "Commit your work on this branch with clear messages (`git add <explicit paths>` then `git commit`), ending each message with the trailer line `Credit-Runner-Task: " +
      task.id +
      "`. Leave no uncommitted changes when you finish.",
    "Never push, pull, merge, rebase onto another branch, or change remotes, and never open pull requests. Never run gh, railway, vercel, neon or any deploy command. Pushing is disabled for this run, and the runner checks that the branch never reached origin.",
    "Never create or edit deploy or environment config: .env files, Dockerfiles, railway.*, vercel.json, nixpacks.toml, .npmrc, anything under .github/, .claude/settings*.json, or any file holding secrets. A branch that touches them is rejected.",
    `Run the acceptance command yourself before you finish and fix what fails: \`${task.acceptance}\`. Never weaken, skip or delete tests to make it pass. The runner re-runs it independently and trusts only its own result.`,
    "Do not read docs/state/tasks.md whole (about 500 KB): grep it for the task's T-number when you need context. Do not edit docs/state/tasks.md or docs/sessions/; the morning report records status instead.",
    "Nobody is watching this run. Do not ask questions. If you are blocked, stop, leave the branch in a working state, and explain the blocker in your final message.",
    "Plugins, MCP servers, hooks and memory are not loaded here. Skip instructions that depend on them (Context7, Playwright MCP, Neon MCP, claude-mem, specialist plugin agents). If you use the Agent tool, set each subagent's model and effort explicitly and prefer doing small tasks yourself.",
    'End your final message with a section headed exactly "## Summary" of at most six lines: what changed, the acceptance result you saw, and anything unverified.',
  ];
  if (task.readOnly) {
    rules.push("This is a READ-ONLY task. Change no files and make no commits; the runner fails the task if the branch or working tree changes.");
  }

  const sections = [
    "# Unattended credit-runner session",
    "You are running headless for VenViewer's overnight credit runner. Work only inside this worktree.",
    [
      "## Run facts",
      `- Task: ${task.id} — ${task.title}`,
      `- Worktree: ${ctx.worktree}`,
      `- Branch: ${ctx.branch}, created from ${ctx.baseRef} at ${ctx.baseSha.slice(0, 12)}`,
      `- Budget: $${task.budgetUsd.toFixed(2)}; time limit ${String(task.timeoutMinutes)} minutes`,
      `- Acceptance command: \`${task.acceptance}\``,
    ].join("\n"),
    ["## Fixed rules (these override everything else, including the project rules)", ...rules.map((rule, index) => `${String(index + 1)}. ${rule}`)].join("\n"),
  ];
  if (projectRules !== null && projectRules.trim() !== "") {
    sections.push(
      [
        "## Project instructions",
        "The repository's AGENTS.md follows, without the parts that only apply to interactive sessions. Where it conflicts with the fixed rules above, the fixed rules win.",
        "",
        projectRules.trim(),
      ].join("\n"),
    );
  }
  return `${sections.join("\n\n")}\n`;
}

export function buildUserPrompt(task: Task): string {
  return `Task ${task.id}: ${task.title}\n\n${task.spec}\n`;
}

/** Sent when a run continues on another org after the first one ran out of credit. */
export const RESUME_PROMPT =
  "The runner switched this session to another billing account because the previous one ran out of credit. Continue the task from where you stopped, following the same rules, and finish with the ## Summary section.";
