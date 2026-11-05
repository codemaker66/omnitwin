import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { parseFrontmatter } from "./frontmatter.js";

/** Shell commands that only look. */
const INSPECT_COMMANDS: readonly string[] = [
  "Bash(cd *)",
  "Bash(ls*)",
  "Bash(cat *)",
  "Bash(head *)",
  "Bash(tail *)",
  "Bash(wc *)",
  "Bash(grep *)",
  "Bash(rg *)",
  "Bash(git status*)",
  "Bash(git diff*)",
  "Bash(git log*)",
  "Bash(git show*)",
  "Bash(git grep *)",
  "Bash(git ls-files*)",
];

/**
 * Shell commands a coding task may run without asking. Bare mode's built-in
 * tools are only Bash, Edit and Read: Read and Edit inside the worktree are
 * approved by the permission mode itself, and there is deliberately no
 * tool-wide Read or Edit rule, which would also reach files outside it. Anything
 * not allowed is denied, because runs pass `--permission-prompts none`. Deny
 * rules in runner-settings.json win over these, so `git push` stays blocked.
 */
export const DEFAULT_ALLOWED_TOOLS: readonly string[] = [
  ...INSPECT_COMMANDS,
  "Bash(pnpm *)",
  "Bash(node *)",
  "Bash(mkdir *)",
  "Bash(touch *)",
  "Bash(cp *)",
  "Bash(mv *)",
  "Bash(git add *)",
  "Bash(git commit *)",
  "Bash(git rm *)",
  "Bash(git mv *)",
  "Bash(git restore *)",
];

/** A read-only task gets inspection commands only, and runs without Edit at all. */
export const READ_ONLY_TOOLS: readonly string[] = INSPECT_COMMANDS;

export const DEFAULT_MODEL = "claude-opus-5-5";

const toolList = z.array(z.string().min(1));

const frontmatterSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,62}$/u, "id must be lowercase letters, digits and dashes (it names the branch and folder)"),
    title: z.string().min(1).optional(),
    enabled: z.boolean().default(true),
    model: z.string().regex(/^[a-z0-9.\-[\]]+$/u).default(DEFAULT_MODEL),
    effort: z.enum(["low", "medium", "high", "xhigh", "max"]).default("high"),
    budget_usd: z.number().positive().max(50).default(5),
    timeout_minutes: z.number().int().positive().max(240).default(60),
    acceptance: z.string().min(1),
    install: z.boolean().default(true),
    read_only: z.boolean().default(false),
    base: z
      .string()
      .regex(/^(?!-)[A-Za-z0-9._/-]+$/u, "base must be a branch or ref name such as origin/master")
      .optional(),
    allowed_tools: toolList.optional(),
    extra_allowed_tools: toolList.default([]),
  })
  .strict();

export type Effort = z.infer<typeof frontmatterSchema>["effort"];

export interface Task {
  readonly id: string;
  readonly title: string;
  readonly enabled: boolean;
  readonly model: string;
  readonly effort: Effort;
  readonly budgetUsd: number;
  readonly timeoutMinutes: number;
  readonly acceptance: string;
  readonly install: boolean;
  readonly readOnly: boolean;
  readonly base: string | undefined;
  readonly allowedTools: readonly string[];
  readonly spec: string;
  readonly file: string;
}

export function parseTask(text: string, file: string): Task {
  const { data, body } = parseFrontmatter(text);
  const fm = frontmatterSchema.parse(data);
  if (body === "") throw new Error("the task body (the spec) is empty");
  if (fm.read_only && (fm.allowed_tools !== undefined || fm.extra_allowed_tools.length > 0)) {
    throw new Error("a read_only task cannot set allowed_tools or extra_allowed_tools");
  }
  const base = fm.read_only ? READ_ONLY_TOOLS : (fm.allowed_tools ?? DEFAULT_ALLOWED_TOOLS);
  return {
    id: fm.id,
    title: fm.title ?? fm.id,
    enabled: fm.enabled,
    model: fm.model,
    effort: fm.effort,
    budgetUsd: fm.budget_usd,
    timeoutMinutes: fm.timeout_minutes,
    acceptance: fm.acceptance,
    install: fm.install,
    readOnly: fm.read_only,
    base: fm.base,
    allowedTools: [...new Set([...base, ...fm.extra_allowed_tools])],
    spec: body,
    file,
  };
}

export interface QueueProblem {
  readonly file: string;
  readonly message: string;
}

export interface Queue {
  readonly tasks: readonly Task[];
  readonly problems: readonly QueueProblem[];
}

/**
 * Reads every `*.md` in the queue folder except README.md, in file-name order,
 * so a numeric prefix (`010-…`, `020-…`) sets the running order. A broken file
 * is reported and skipped rather than stopping the night.
 */
export async function loadQueue(dir: string): Promise<Queue> {
  const names = (await readdir(dir))
    .filter((name) => name.toLowerCase().endsWith(".md") && name.toLowerCase() !== "readme.md")
    .sort((a, b) => a.localeCompare(b, "en"));
  const tasks: Task[] = [];
  const problems: QueueProblem[] = [];
  const ids = new Set<string>();
  for (const name of names) {
    const file = path.join(dir, name);
    try {
      const task = parseTask(await readFile(file, "utf8"), file);
      if (ids.has(task.id)) throw new Error(`task id '${task.id}' is already used by an earlier file`);
      ids.add(task.id);
      tasks.push(task);
    } catch (error) {
      problems.push({ file, message: describeError(error) });
    }
  }
  return { tasks, problems };
}

export function describeError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}
