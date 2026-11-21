import { appendFile, readFile } from "node:fs/promises";
import { z } from "zod";
import { isoDateSchema } from "./config.js";

const attemptSchema = z.object({
  orgId: z.string(),
  orgName: z.string(),
  sessionId: z.string(),
  /** What the run's init message reported as its credential; null when it never started. */
  apiKeySource: z.string().nullable(),
  model: z.string().nullable(),
  costUsd: z.number(),
  /** False when the run was killed before reporting its cost; costUsd is then its whole budget. */
  costKnown: z.boolean(),
  turns: z.number(),
  durationMs: z.number(),
  subtype: z.string().nullable(),
  isError: z.boolean(),
  stop: z.string().nullable(),
  exitCode: z.number().nullable(),
  timedOut: z.boolean(),
  killedReason: z.string().nullable(),
  permissionDenials: z.array(z.string()),
});

export type Attempt = z.infer<typeof attemptSchema>;

export const OUTCOMES = ["pass", "fail", "rejected", "stopped", "aborted", "setup-failed", "error"] as const;
export type Outcome = (typeof OUTCOMES)[number];

const acceptanceSchema = z.object({
  command: z.string(),
  status: z.enum(["pass", "fail", "timeout", "not-run"]),
  exitCode: z.number().nullable(),
  durationMs: z.number(),
  tail: z.string(),
});

export type AcceptanceResult = z.infer<typeof acceptanceSchema>;

const entrySchema = z.object({
  night: isoDateSchema,
  taskId: z.string(),
  title: z.string(),
  startedAt: z.string(),
  finishedAt: z.string(),
  outcome: z.enum(OUTCOMES),
  reasons: z.array(z.string()),
  branch: z.string(),
  baseRef: z.string(),
  baseSha: z.string(),
  worktree: z.string(),
  model: z.string(),
  effort: z.string(),
  budgetUsd: z.number(),
  attempts: z.array(attemptSchema),
  costUsd: z.number(),
  turns: z.number(),
  acceptance: acceptanceSchema,
  commits: z.array(z.string()),
  filesChanged: z.array(z.string()),
  dirtyFiles: z.array(z.string()),
  violations: z.array(z.string()),
  summary: z.string(),
  logDir: z.string(),
});

export type LedgerEntry = z.infer<typeof entrySchema>;

export interface LedgerRead {
  readonly entries: readonly LedgerEntry[];
  /** Lines that were not valid entries (a crash mid-write, a hand edit). */
  readonly badLines: number;
}

export async function readLedger(file: string): Promise<LedgerRead> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return { entries: [], badLines: 0 };
    throw error;
  }
  const entries: LedgerEntry[] = [];
  let badLines = 0;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const parsed = entrySchema.safeParse(JSON.parse(line));
      if (parsed.success) entries.push(parsed.data);
      else badLines += 1;
    } catch {
      badLines += 1;
    }
  }
  return { entries, badLines };
}

export async function appendLedger(file: string, entry: LedgerEntry): Promise<void> {
  await appendFile(file, `${JSON.stringify(entrySchema.parse(entry))}\n`, "utf8");
}

export function spentOn(entries: readonly LedgerEntry[], night: string): number {
  return entries.filter((entry) => entry.night === night).reduce((sum, entry) => sum + entry.costUsd, 0);
}

export function spentByOrg(entries: readonly LedgerEntry[]): ReadonlyMap<string, number> {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    for (const attempt of entry.attempts) {
      totals.set(attempt.orgId, (totals.get(attempt.orgId) ?? 0) + attempt.costUsd);
    }
  }
  return totals;
}
