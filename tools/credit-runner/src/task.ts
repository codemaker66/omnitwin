import { z } from "zod";
import { parseFrontmatter } from "./frontmatter.js";

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

/**
 * The sandbox agent's model and effort: one source for the agent setup.ts
 * creates, a spec's defaults, and the only values the lane runs.
 */
export const AGENT_MODEL = "claude-opus-5-5";
export const AGENT_EFFORT: Effort = "high";

/**
 * Tool rules. The sandbox lane honours none (its agent has one fixed toolset),
 * so it refuses a spec that sets them; they still parse, for a clear refusal. A
 * rule is never allowed to start with "-": it would read as a command-line flag.
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
    model: z.string().regex(/^[a-z0-9.\-[\]]+$/u).default(AGENT_MODEL),
    effort: z.enum(EFFORTS).default(AGENT_EFFORT),
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
    extra_allowed_tools: toolList.optional(),
    /**
     * Sandbox runs: a shell command that breaks the code under test. When a
     * task only adds tests, the verifier applies it and the tests must fail.
     */
    mutation: z.string().min(1).optional(),
    /** Sandbox runs: a cheap check, run right after checkout, that the cited code has not moved. */
    precondition: z.string().min(1).optional(),
  })
  .strict();

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
  /** As the spec set them (undefined when it did not, so an empty list is told from no key): the sandbox lane refuses either key being present. */
  readonly allowedTools: readonly string[] | undefined;
  readonly extraAllowedTools: readonly string[] | undefined;
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
    allowedTools: fm.allowed_tools,
    extraAllowedTools: fm.extra_allowed_tools,
    mutation: fm.mutation,
    precondition: fm.precondition,
    spec: body,
    file,
  };
}

/** How many causes describeError follows before it stops. */
const MAX_CAUSES = 4;

/**
 * How many characters of each message describeError keeps: room for the
 * launcher's longest refusal (setup's list of what differs, then its remedy),
 * not for a server's whole error body.
 */
const MAX_MESSAGE_CHARS = 2000;

/**
 * `text` on one line for a terminal: line breaks and tabs become spaces, every
 * other control character (C0, DEL and C1, so no escape sequence) is left out,
 * and past MAX_MESSAGE_CHARS it is cut, never inside a surrogate pair, and
 * marked "...". A server's text can reach a message (an error answer's body).
 */
function terminalLine(text: string): string {
  const line = text
    .replace(/\s*\r?\n\s*/gu, " ")
    .replace(/[\t\v\f\r]/gu, " ")
    .replace(/\p{Cc}/gu, "")
    .trim();
  if (line.length <= MAX_MESSAGE_CHARS) return line;
  const cut = line.slice(0, MAX_MESSAGE_CHARS);
  return `${/[\uD800-\uDBFF]$/u.test(cut) ? cut.slice(0, -1) : cut}...`;
}

/**
 * One line for the CLI: the error's message, then its cause chain (the SDK's
 * "Connection error." keeps the real reason in its cause), each message once,
 * at most MAX_CAUSES deep, each through terminalLine.
 */
export function describeError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => terminalLine(`${issue.path.join(".") || "(root)"}: ${issue.message}`)).join("; ");
  }
  const messageOf = (value: unknown): string => terminalLine(value instanceof Error ? value.message : String(value));
  const first = messageOf(error);
  const causes: string[] = [];
  const seen = new Set<unknown>([error]);
  let cause: unknown = error instanceof Error ? error.cause : undefined;
  let more = false;
  for (let depth = 0; cause !== undefined && cause !== null && !seen.has(cause); depth += 1) {
    if (depth === MAX_CAUSES) {
      more = true;
      break;
    }
    seen.add(cause);
    const text = messageOf(cause);
    if (text !== "" && text !== first && !causes.includes(text)) causes.push(text);
    cause = cause instanceof Error ? cause.cause : undefined;
  }
  return causes.length === 0 ? first : `${first} (caused by: ${causes.join("; caused by: ")}${more ? "; ..." : ""})`;
}
