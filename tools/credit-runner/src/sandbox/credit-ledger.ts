import { appendFile, readFile } from "node:fs/promises";
import { z } from "zod";

/**
 * The credit lanes' shared ledger (the `ledgerFile` in sandbox.config.json):
 * one JSON line per paid job, written by every lane that spends the same
 * credit pot. This lane writes the full shape; other lanes' lines are read for
 * their spend only, so a line needs just its lane, job, time and cost to count.
 */
const lineSchema = z.object({
  ts: z.string(),
  lane: z.string(),
  job: z.string(),
  model: z.string(),
  requests: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  costUsd: z.number(),
  batchId: z.string().nullable(),
  /** Present, and false, when no final cost could be read (the session may not have stopped): costUsd is then the whole budget, or the last figure if higher. */
  costKnown: z.literal(false).optional(),
});

const spendSchema = z.object({
  ts: z.string(),
  lane: z.string(),
  job: z.string(),
  costUsd: z.number().nonnegative(),
});

export type CreditLine = z.infer<typeof lineSchema>;
export type SpendLine = z.infer<typeof spendSchema>;

export interface CreditLedger {
  readonly lines: readonly SpendLine[];
  /** Lines with no readable cost: a crash mid-write, a hand edit, another lane's mistake. */
  readonly badLines: number;
}

export async function readCreditLedger(file: string): Promise<CreditLedger> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return { lines: [], badLines: 0 };
    throw error;
  }
  const lines: SpendLine[] = [];
  let badLines = 0;
  for (const raw of text.split("\n")) {
    if (raw.trim() === "") continue;
    try {
      const parsed = spendSchema.safeParse(JSON.parse(raw));
      if (parsed.success) lines.push(parsed.data);
      else badLines += 1;
    } catch {
      badLines += 1;
    }
  }
  return { lines, badLines };
}

export async function appendCreditLine(file: string, line: CreditLine): Promise<void> {
  await appendFile(file, `${JSON.stringify(lineSchema.parse(line))}\n`, "utf8");
}

/** Whether a ledger line charges this session (its `batchId`), for a collect that must not assume it was charged. */
export async function ledgerHasSession(file: string, sessionId: string): Promise<boolean> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
  return text.split("\n").some((raw) => {
    try {
      const parsed: unknown = JSON.parse(raw);
      return typeof parsed === "object" && parsed !== null && "batchId" in parsed && parsed.batchId === sessionId;
    } catch {
      return false;
    }
  });
}

export function spent(lines: readonly SpendLine[], filter: (line: SpendLine) => boolean = () => true): number {
  return lines.filter(filter).reduce((sum, line) => sum + line.costUsd, 0);
}

export interface SpendLimits {
  /** This lane's whole allowance this cycle. */
  readonly laneCapUsd: number;
  /** Every lane's allowance in the org this cycle. */
  readonly orgCapUsd: number;
  /** This --job label's allowance in this lane: its spend so far plus the budget must fit (--job-cap). */
  readonly jobCapUsd?: number | undefined;
}

export interface SpendCheck {
  readonly ok: boolean;
  readonly reason: string;
}

/**
 * A job may start only if its whole budget fits under every cap at once. A
 * budget that is not a positive finite number is refused (a NaN or a negative
 * one would fit every cap by arithmetic alone), and so is a ledger with
 * unreadable lines: they may hide spend.
 */
export function checkSpend(
  ledger: CreditLedger,
  lane: string,
  budgetUsd: number,
  limits: SpendLimits,
  jobPrefix?: string,
): SpendCheck {
  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) {
    return { ok: false, reason: `the budget must be a positive number of dollars, not ${String(budgetUsd)}` };
  }
  if (ledger.badLines > 0) {
    return { ok: false, reason: `the credit ledger has ${String(ledger.badLines)} unreadable line(s); fix it before spending` };
  }
  const money = (value: number): string => `$${value.toFixed(2)}`;
  const org = spent(ledger.lines);
  const laneSpent = spent(ledger.lines, (line) => line.lane === lane);
  const checks: [number, number, string][] = [
    [org, limits.orgCapUsd, "org"],
    [laneSpent, limits.laneCapUsd, `lane '${lane}'`],
  ];
  if (limits.jobCapUsd !== undefined && jobPrefix !== undefined) {
    const job = spent(ledger.lines, (line) => line.lane === lane && line.job.startsWith(jobPrefix));
    checks.push([job, limits.jobCapUsd, `job '${jobPrefix.replace(/:$/u, "")}'`]);
  }
  for (const [used, cap, label] of checks) {
    if (used + budgetUsd > cap + 1e-9) {
      return { ok: false, reason: `the ${money(budgetUsd)} budget does not fit the ${label} cap: ${money(used)} of ${money(cap)} is spent` };
    }
  }
  return { ok: true, reason: `org ${money(org)} of ${money(limits.orgCapUsd)}, lane ${money(laneSpent)} of ${money(limits.laneCapUsd)} spent` };
}
