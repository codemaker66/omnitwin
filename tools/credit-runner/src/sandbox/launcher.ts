import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Task } from "../task.js";
import type { SandboxApi } from "./api.js";
import { sandboxSystemPrompt } from "./brief.js";
import { appendCreditLine, checkSpend, readCreditLedger } from "./credit-ledger.js";
import { reviewRun, type Review } from "./review.js";
import { isStopped, listCostUsd, recollectSession, runSession, SessionMayExistError, type SessionRunResult } from "./session.js";
import { AGENT_MODEL, ensureSandbox } from "./setup.js";

export interface LauncherConfig {
  /** Run records, state and specs live here (outside the repository). */
  readonly workRoot: string;
  /** The credit lanes' shared ledger. */
  readonly ledgerFile: string;
  readonly lane: string;
  readonly laneCapUsd: number;
  readonly orgCapUsd: number;
}

export interface JobOptions {
  readonly api: SandboxApi;
  readonly config: LauncherConfig;
  readonly task: Task;
  /** Groups runs in the ledger, e.g. "a4-trial" or "night-2026-11-06". */
  readonly job: string;
  readonly budgetUsd: number;
  readonly timeoutMinutes: number;
  readonly nightCapUsd?: number | undefined;
  readonly baseSha: string;
  /** AGENTS.md at the base commit, already filtered by nightRulesFromAgentsMd. */
  readonly projectRules: string;
  readonly verifyScript: string;
  /** Where the review fetches the base from to read the patches (default: the public repository). */
  readonly repoUrl?: string | undefined;
  readonly now?: () => Date;
  readonly log?: (line: string) => void;
  /** Test seams, passed to runSession: every wait, and the time allowed after the interrupt. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly graceMs?: number;
}

/**
 * What a session is booked at. The platform's figure, once the platform says
 * the session has stopped; otherwise the larger of that snapshot and the whole
 * budget (which the platform's cap bounds), marked unknown, so the ledger never
 * under-counts a session that may still be spending.
 */
export function bookedCost(stopped: boolean, snapshotUsd: number | null, budgetUsd: number): { readonly costUsd: number; readonly costKnown: boolean } {
  if (stopped && snapshotUsd !== null) return { costUsd: snapshotUsd, costKnown: true };
  return { costUsd: Math.max(snapshotUsd ?? 0, budgetUsd), costKnown: false };
}

export type JobRecord =
  | { readonly kind: "skipped"; readonly taskId: string; readonly reason: string }
  | {
      readonly kind: "ran";
      readonly taskId: string;
      readonly runDir: string;
      readonly branch: string;
      readonly baseSha: string;
      readonly costUsd: number;
      readonly costKnown: boolean;
      readonly result: SessionRunResult;
      readonly review: Review;
    };

function stamp(date: Date): string {
  return date.toISOString().replace(/[:.]/gu, "-");
}

export function reviewMarkdown(task: Task, record: Extract<JobRecord, { kind: "ran" }>): string {
  const { result, review } = record;
  const lines = [
    `# ${review.verdict === "ready-for-review" ? "READY FOR REVIEW" : "REJECTED"} · ${task.id} — ${task.title}`,
    "",
    `- Session: ${result.sessionId} (${result.status}, stopped: ${result.stopReason ?? "unknown"})`,
    `- Base: ${record.baseSha}; branch to open: ${record.branch}`,
    `- Cost: $${record.costUsd.toFixed(2)}${record.costKnown ? " (platform list cost, includes the session-hour fee)" : " (unknown: counted at the whole budget, or the last figure if higher)"}; ${String(result.requests)} model requests; ${String(result.activeSeconds ?? "?")} active seconds`,
    `- Tokens: ${String(result.inputTokens)} uncached in, ${String(result.cacheReadTokens)} cache read, ${String(result.cacheCreationTokens)} cache written, ${String(result.outputTokens)} out`,
    `- Verifier (advisory): ${result.verify === null ? "no readable result" : result.verify.ok ? "ok" : "failed"} (${String(result.verifyRuns)} run(s))`,
    `- Grader: ${result.outcome === null ? "no verdict" : `${result.outcome.result} after iteration ${String(result.outcome.iteration)}`}`,
    "",
    "This verdict is this machine's reading of the returned patches. The verifier ran inside the agent's own container, so its result is advisory: it can reject a run but never clears one. CI on the pull request is the acceptance authority.",
  ];
  // Reasons, flags and paths can carry text the agent wrote (the verifier's
  // problems, file names): each stays on its one bullet line.
  if (review.reasons.length > 0) lines.push("", "## Why it is rejected", ...review.reasons.map((reason) => `- ${oneLine(reason)}`));
  if (review.flags.length > 0) lines.push("", "## Look closely", ...review.flags.map((flag) => `- ${oneLine(flag)}`));
  lines.push(
    "",
    "## Changed files, read from the patches (A added or a rename's target, M modified, D deleted, R renamed or copied from)",
    ...(review.changed.length === 0 ? ["- (none read)"] : review.changed.map((entry) => `- ${oneLine(entry)}`)),
  );
  const baseTail = result.verify?.baseTail ?? null;
  if (baseTail !== null && baseTail.trim() !== "") {
    lines.push("", "## The acceptance command without the fix (verifier's output, last lines)", "", ...fenced(baseTail));
  }
  if (result.outcome !== null) lines.push("", "## Grader's explanation", "", ...fenced(result.outcome.explanation));
  return `${lines.join("\n")}\n`;
}

/**
 * Characters that can break or reorder a line: C0 and C1 controls, DEL, the
 * line and paragraph separators, and the bidirectional embeddings, overrides
 * and isolates.
 */
function isLineBreaking(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029 || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
}

/** Text that may come from the agent, on one line: newlines and other line-breaking or reordering characters become spaces. */
function oneLine(text: string): string {
  return Array.from(text, (char) => (isLineBreaking(char) ? " " : char))
    .join("")
    .replace(/ {2,}/gu, " ")
    .trim();
}

/** Text that may come from the agent, quoted as a block: fenced with more backticks than it holds, so it cannot close the fence. */
function fenced(text: string): string[] {
  const fence = "`".repeat(Math.max(3, ...[...text.matchAll(/`+/gu)].map((run) => run[0].length + 1)));
  return [fence, text.trimEnd(), fence];
}

/**
 * One task, one session: check the spend, run, record the spend, review.
 * Spend is recorded even when the run fails after its session started.
 */
export async function runSandboxJob(options: JobOptions): Promise<JobRecord> {
  const { api, config, task } = options;
  const now = options.now ?? (() => new Date());
  const log = options.log ?? (() => undefined);

  const ledger = await readCreditLedger(config.ledgerFile);
  const check = checkSpend(
    ledger,
    config.lane,
    options.budgetUsd,
    { laneCapUsd: config.laneCapUsd, orgCapUsd: config.orgCapUsd, nightCapUsd: options.nightCapUsd },
    `${options.job}:`,
  );
  if (!check.ok) return { kind: "skipped", taskId: task.id, reason: check.reason };
  log(`Spend check passed: ${check.reason}.`);

  const state = await ensureSandbox(api, path.join(config.workRoot, "state.json"), sandboxSystemPrompt(options.projectRules), log);
  const branch = `credit/${task.id}`;
  const runDir = path.join(config.workRoot, "runs", task.id, stamp(now()));
  await mkdir(runDir, { recursive: true });

  const emptyLine = (sessionId: string | null) => ({
    ts: now().toISOString(),
    lane: config.lane,
    job: `${options.job}:${task.id}`,
    model: AGENT_MODEL,
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    batchId: sessionId,
  });

  let result: SessionRunResult;
  // Set from runSession's callback; an object so the compiler does not narrow it to null.
  const started: { sessionId: string | null } = { sessionId: null };
  try {
    result = await runSession({
      api,
      state,
      facts: { task, baseSha: options.baseSha, branch },
      budgetUsd: options.budgetUsd,
      timeoutMinutes: options.timeoutMinutes,
      runDir,
      verifyScript: options.verifyScript,
      title: `${options.job}: ${task.title}`.slice(0, 200),
      metadata: { lane: config.lane, job: options.job, task: task.id },
      log,
      onSessionCreated: (id) => {
        started.sessionId = id;
      },
      ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
      ...(options.graceMs === undefined ? {} : { graceMs: options.graceMs }),
    });
  } catch (error) {
    // Nothing is spent before a session exists. Once one does (or may), it is
    // charged: the platform's figure if the session has stopped, or else the
    // whole budget, marked unknown. runSession has already tried to stop it.
    const sessionId = started.sessionId;
    if (sessionId !== null) {
      const snapshot = await api.retrieveSession(sessionId).catch(() => null);
      const cost = bookedCost(snapshot !== null && isStopped(snapshot.status), snapshot === null ? null : listCostUsd(snapshot), options.budgetUsd);
      await appendCreditLine(config.ledgerFile, { ...emptyLine(sessionId), ...ledgerCost(cost) });
    } else if (error instanceof SessionMayExistError) {
      await appendCreditLine(config.ledgerFile, { ...emptyLine(null), ...ledgerCost(bookedCost(false, null, options.budgetUsd)) });
    }
    throw error;
  }

  const cost = bookedCost(result.stopped, result.listCostUsd, options.budgetUsd);
  await appendCreditLine(config.ledgerFile, {
    ...emptyLine(result.sessionId),
    requests: result.requests,
    inputTokens: result.inputTokens + result.cacheReadTokens + result.cacheCreationTokens,
    outputTokens: result.outputTokens,
    ...ledgerCost(cost),
  });
  const { costUsd, costKnown } = cost;

  return writeRecord(task, runDir, branch, options.baseSha, options.repoUrl, result, costUsd, costKnown, log);
}

/** A known cost is a plain figure; an unknown one says so, for whoever reads the ledger. */
function ledgerCost(cost: { readonly costUsd: number; readonly costKnown: boolean }): { costUsd: number; costKnown?: false } {
  return cost.costKnown ? { costUsd: cost.costUsd } : { costUsd: cost.costUsd, costKnown: false };
}

async function writeRecord(
  task: Task,
  runDir: string,
  branch: string,
  baseSha: string,
  repoUrl: string | undefined,
  result: SessionRunResult,
  costUsd: number,
  costKnown: boolean,
  log?: (line: string) => void,
): Promise<Extract<JobRecord, { kind: "ran" }>> {
  const review = await reviewRun(result, { baseSha, repoUrl, log });
  const record = { kind: "ran", taskId: task.id, runDir, branch, baseSha, costUsd, costKnown, result, review } as const;
  await writeFile(path.join(runDir, "result.json"), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await writeFile(path.join(runDir, "review.md"), reviewMarkdown(task, record), "utf8");
  return record;
}

/**
 * Rebuilds the record and review of a session that already ran, from its
 * history and outputs. It starts nothing and writes no ledger line. Whether the
 * session was charged is not assumed: a launcher that died may have left no
 * line, so the CLI looks the session up in the ledger (ledgerHasSession) and
 * says which.
 */
export async function collectSandboxJob(options: {
  readonly api: SandboxApi;
  readonly task: Task;
  readonly sessionId: string;
  readonly runDir: string;
  readonly baseSha: string;
  /** What the run was charged when its cost could not be read: its whole budget (default: the spec's). */
  readonly budgetUsd?: number | undefined;
  readonly repoUrl?: string | undefined;
  readonly log?: (line: string) => void;
}): Promise<Extract<JobRecord, { kind: "ran" }>> {
  const result = await recollectSession(options.api, options.sessionId, options.runDir, options.log);
  // An unknown cost is counted at the whole budget, as runSandboxJob booked it; never shown as $0.
  const { costUsd, costKnown } = bookedCost(result.stopped, result.listCostUsd, options.budgetUsd ?? options.task.budgetUsd);
  return writeRecord(options.task, options.runDir, `credit/${options.task.id}`, options.baseSha, options.repoUrl, result, costUsd, costKnown, options.log);
}
