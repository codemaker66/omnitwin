import { z } from "zod";
import { parseFrontmatter } from "./frontmatter.js";

export const DEFAULT_MODEL = "claude-opus-5-5";

/**
 * Tool rules. The sandbox lane takes none from a spec (its agent has one fixed
 * toolset); the keys still parse so existing specs keep working. A rule is never
 * allowed to start with "-": it would read as a command-line flag.
 */
const toolList = z.array(z.string().regex(/^(?!-)\S/u, "a tool rule must not start with \"-\" or whitespace"));

/** The ceilings a spec sets; the sandbox CLI holds its --budget and --timeout overrides to the same ones. */
export const MAX_BUDGET_USD = 50;
export const MAX_TIMEOUT_MINUTES = 240;

const frontmatterSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,62}$/u, "id must be lowercase letters, digits and dashes (it names the branch and folder)"),
    title: z.string().min(1).optional(),
    enabled: z.boolean().default(true),
    model: z.string().regex(/^[a-z0-9.\-[\]]+$/u).default(DEFAULT_MODEL),
    effort: z.enum(["low", "medium", "high", "xhigh", "max"]).default("high"),
    budget_usd: z.number().positive().max(MAX_BUDGET_USD).default(5),
    timeout_minutes: z.number().int().positive().max(MAX_TIMEOUT_MINUTES).default(60),
    acceptance: z.string().min(1),
    install: z.boolean().default(true),
    read_only: z.boolean().default(false),
    base: z
      .string()
      .regex(/^(?!-)[A-Za-z0-9._/-]+$/u, "base must be a branch or ref name such as origin/master")
      .optional(),
    allowed_tools: toolList.optional(),
    extra_allowed_tools: toolList.default([]),
    /**
     * Sandbox runs: a shell command that breaks the code under test. When a
     * task only adds tests, the verifier applies it and the tests must fail.
     */
    mutation: z.string().min(1).optional(),
    /** Sandbox runs: a cheap check, run right after checkout, that the cited code has not moved. */
    precondition: z.string().min(1).optional(),
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
  readonly mutation?: string | undefined;
  readonly precondition?: string | undefined;
  readonly spec: string;
  readonly file: string;
}

export function parseTask(text: string, file: string): Task {
  const { data, body } = parseFrontmatter(text);
  const fm = frontmatterSchema.parse(data);
  if (body === "") throw new Error("the task body (the spec) is empty");
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
    mutation: fm.mutation,
    precondition: fm.precondition,
    spec: body,
    file,
  };
}

export function describeError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}
