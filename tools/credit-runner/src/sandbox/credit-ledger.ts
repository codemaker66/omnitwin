import { appendFileSync, closeSync, fstatSync, openSync, readFileSync, readSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { z } from "zod";

/**
 * The credit lanes' shared ledger (the `ledgerFile` in sandbox.config.json):
 * one JSON line per paid job, written by every lane that spends the same
 * credit pot. This lane writes the full shape; other lanes' lines are read for
 * their spend only, so a line needs just its lane, job, time and cost to count.
 */
const lineSchema = z.strictObject({
  ts: z.string(),
  lane: z.string(),
  job: z.string(),
  model: z.string(),
  requests: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  costUsd: z.number(),
  /** The session the line charges; null when its id is not known (a create whose outcome was unclear). */
  batchId: z.string().nullable(),
  /**
   * The run's own id, the session's metadata `run`: on every line this lane
   * writes, so a line booked before the session's id was known still names the
   * session it charges (ledgerHasSession).
   */
  runId: z.string().optional(),
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

/** Whether the file exists, is not empty and does not end in a newline (a line torn by a hard kill, or saved by hand without one). */
function endsMidLine(file: string): boolean {
  let fd: number;
  try {
    fd = openSync(file, "r");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
  try {
    const { size } = fstatSync(fd);
    if (size === 0) return false;
    const last = Buffer.alloc(1);
    readSync(fd, last, 0, 1, size - 1);
    return last[0] !== 0x0a;
  } finally {
    closeSync(fd);
  }
}

/**
 * Appends one line, synchronously: a signal handler (the launcher's at-once
 * booking) then never runs while a line is half written. When the ledger ends
 * part-way through a line, the new line starts on a line of its own, so it is
 * read even though the torn one before it is not.
 */
export function appendCreditLineSync(file: string, line: CreditLine): void {
  const text = `${JSON.stringify(lineSchema.parse(line))}\n`;
  appendFileSync(file, endsMidLine(file) ? `\n${text}` : text, "utf8");
}

/** appendCreditLineSync behind a promise: the write is done, or has failed, before the call returns. */
export async function appendCreditLine(file: string, line: CreditLine): Promise<void> {
  appendCreditLineSync(file, line);
  return Promise.resolve();
}

/** The sessions (`batchId`) and runs (`runId`) the ledger's lines charge, read from every line that parses as JSON. */
export interface LedgerBookings {
  readonly sessionIds: ReadonlySet<string>;
  readonly runIds: ReadonlySet<string>;
}

export function bookingsIn(text: string): LedgerBookings {
  const sessionIds = new Set<string>();
  const runIds = new Set<string>();
  for (const raw of text.split("\n")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    if ("batchId" in parsed && typeof parsed.batchId === "string") sessionIds.add(parsed.batchId);
    if ("runId" in parsed && typeof parsed.runId === "string") runIds.add(parsed.runId);
  }
  return { sessionIds, runIds };
}

/** Whether a line charges the session: by its id, or by its run id (the session's metadata `run`) against a line's runId. */
export function charges(bookings: LedgerBookings, sessionId: string | null, runId?: string | null): boolean {
  return (sessionId !== null && bookings.sessionIds.has(sessionId)) || (typeof runId === "string" && bookings.runIds.has(runId));
}

/** readLedgerBookings for a signal handler, which cannot wait. */
export function readLedgerBookingsSync(file: string): LedgerBookings {
  try {
    return bookingsIn(readFileSync(file, "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return bookingsIn("");
    throw error;
  }
}

export async function readLedgerBookings(file: string): Promise<LedgerBookings> {
  try {
    return bookingsIn(await readFile(file, "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return bookingsIn("");
    throw error;
  }
}

/**
 * Whether a ledger line charges this session, by its id or by its run id (see
 * charges), for a collect or a run that must not assume it was charged.
 */
export async function ledgerHasSession(file: string, sessionId: string, runId?: string): Promise<boolean> {
  return charges(await readLedgerBookings(file), sessionId, runId);
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
