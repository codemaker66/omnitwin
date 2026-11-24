import { writeSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { AGENT_EFFORT, AGENT_MODEL, type Task } from "../task.js";
import type { SandboxApi } from "./api.js";
import { sandboxSystemPrompt } from "./brief.js";
import { appendCreditLine, appendCreditLineSync, charges, checkSpend, type CreditLine, readCreditLedger, readLedgerBookingsSync } from "./credit-ledger.js";
import type { OutputCaps } from "./outputs.js";
import { reviewRun, type Review } from "./review.js";
import { checkRunBounds, isStopped, listCostUsd, recollectSession, RunStoppedError, type RunTotals, runSession, SessionMayExistError, type SessionRunResult } from "./session.js";
import { ensureSandbox } from "./setup.js";

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
  /** Groups runs in the ledger, e.g. "trial-1". */
  readonly job: string;
  readonly budgetUsd: number;
  readonly timeoutMinutes: number;
  /** The --job label's own cap: its spend so far in the ledger plus this budget must fit (--job-cap). */
  readonly jobCapUsd?: number | undefined;
  readonly baseSha: string;
  /** AGENTS.md at the base commit, already filtered by nightRulesFromAgentsMd. */
  readonly projectRules: string;
  readonly verifyScript: string;
  /** Where the review fetches the base from to read the patches (default: the public repository). */
  readonly repoUrl?: string | undefined;
  readonly now?: () => Date;
  readonly log?: (line: string) => void;
  /** Test seams, passed to runSession: every wait, the time allowed after the interrupt, and the byte caps on what comes back. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly graceMs?: number;
  readonly outputCaps?: OutputCaps;
  /** Stops the run as its deadline does (runSession's signal). With stopOnSignals, the first stop signal stops it the same way. */
  readonly signal?: AbortSignal | undefined;
  /**
   * Handles STOP_SIGNALS while the run lasts, as the CLI's `run` does: the
   * first stops the run as its deadline does; a second, or a SIGHUP at any
   * point, books it at once and ends the process (see runSandboxJob).
   */
  readonly stopOnSignals?: StopOnSignals | undefined;
}

/** The base a spec may name: every run starts from master. */
const MASTER_REFS = new Set(["master", "origin/master", "refs/heads/master", "refs/remotes/origin/master"]);

/**
 * Spec keys this lane would otherwise ignore: it runs every spec it is given,
 * from master, on one agent with one model and effort and its full toolset, and
 * the agent always installs. A spec asking for anything else is refused, never
 * run as something it did not ask for.
 */
export function unhonouredSpecKeys(task: Task): string[] {
  const keys: string[] = [];
  if (!task.enabled) keys.push("enabled: false (this lane runs every spec it is given)");
  if (task.readOnly) keys.push("read_only: true (the sandbox agent always has its full toolset)");
  if (task.model !== AGENT_MODEL) keys.push(`model: ${task.model} (the sandbox agent runs ${AGENT_MODEL})`);
  if (task.effort !== AGENT_EFFORT) keys.push(`effort: ${task.effort} (the sandbox agent runs at ${AGENT_EFFORT})`);
  if (task.base !== undefined && !MASTER_REFS.has(task.base)) keys.push(`base: ${task.base} (every run starts from master)`);
  if (!task.install) keys.push("install: false (the sandbox agent always installs)");
  if (task.allowedTools !== undefined) keys.push("allowed_tools (the sandbox agent has one fixed toolset)");
  if (task.extraAllowedTools !== undefined) keys.push("extra_allowed_tools (the sandbox agent has one fixed toolset)");
  return keys;
}

function refuseUnhonouredSpec(task: Task): void {
  const keys = unhonouredSpecKeys(task);
  if (keys.length > 0) {
    throw new Error(`the spec sets ${keys.join("; ")}; remove these keys or set them to what the sandbox lane runs`);
  }
}

/**
 * What a session is booked at. The platform's figure, once the platform says
 * the session has stopped; otherwise the larger of that snapshot and the whole
 * budget, marked unknown. The platform checks its cap before each model
 * request, so one request already in flight can still take a session that may
 * be spending past max(snapshot, budget): the booking is the bound the cap
 * gives, not a strict upper bound.
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
    `- Session: ${inlineCode(result.sessionId)} (${inlineCode(result.status)}, stopped: ${result.stopReason === null ? "unknown" : inlineCode(result.stopReason)})`,
    `- Base: ${record.baseSha}; branch to open: ${record.branch}`,
    `- Cost: $${record.costUsd.toFixed(2)}${record.costKnown ? " (platform list cost, includes the session-hour fee)" : " (unknown: counted at the whole budget, or the last figure if higher)"}; ${String(result.requests)} model requests; ${String(result.activeSeconds ?? "?")} active seconds`,
    `- Tokens: ${String(result.inputTokens)} uncached in, ${String(result.cacheReadTokens)} cache read, ${String(result.cacheCreationTokens)} cache written, ${String(result.outputTokens)} out`,
    `- Verifier (advisory): ${result.verify === null ? "no readable result" : result.verify.ok ? "ok" : "failed"} (${String(result.verifyRuns)} run(s))`,
    `- Grader: ${result.outcome === null ? "no verdict" : `${inlineCode(result.outcome.result)} after iteration ${String(result.outcome.iteration)}`}`,
    "",
    "This verdict is this machine's reading of the returned patches. The verifier ran, and precondition.json was written, inside the agent's own container, so both are advisory: a failing or unreadable result rejects the run, a passing one proves nothing. CI on the pull request is the acceptance authority.",
  ];
  // Reasons, flags and changed entries can carry text the agent wrote (the
  // verifier's problems, file names, output names): each is one code span on
  // its own bullet line, so none renders as a tag, link, image or heading.
  if (review.reasons.length > 0) lines.push("", "## Why it is rejected", ...review.reasons.map((reason) => `- ${inlineCode(reason)}`));
  if (review.flags.length > 0) lines.push("", "## Look closely", ...review.flags.map((flag) => `- ${inlineCode(flag)}`));
  lines.push(
    "",
    "## Changed files, read from the patches (A added or a rename's target, M modified, D deleted, R renamed or copied from)",
    ...(review.changed.length === 0 ? ["- (none read)"] : review.changed.map((entry) => `- ${inlineCode(entry)}`)),
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
 * line and paragraph separators, and the bidirectional embeddings, overrides,
 * isolates and marks (LRM, RLM, ALM).
 */
function isLineBreaking(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (
    code < 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x061c ||
    code === 0x200e ||
    code === 0x200f ||
    code === 0x2028 ||
    code === 0x2029 ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

/** Text that may come from the agent, on one line: newlines and other line-breaking or reordering characters become spaces. */
function oneLine(text: string): string {
  return Array.from(text, (char) => (isLineBreaking(char) ? " " : char))
    .join("")
    .replace(/ {2,}/gu, " ")
    .trim();
}

/** The longest run of backticks in `text`, counted in a loop (a long text spread into Math.max would overflow the stack). */
function longestBacktickRun(text: string): number {
  let longest = 0;
  for (const run of text.matchAll(/`+/gu)) longest = Math.max(longest, run[0].length);
  return longest;
}

/**
 * Text that may come from the agent or the session, as one inline code span:
 * on one line (oneLine), fenced with one backtick more than its longest run of
 * backticks, so no run inside can close it, and padded with a space where it
 * starts or ends with a backtick or a space (CommonMark then drops one space
 * from each end). CommonMark and GitHub show a code span's content as written:
 * never a tag, link, image, comment, emphasis or mention.
 */
export function inlineCode(text: string): string {
  const line = oneLine(text);
  if (line === "") return "` `";
  const fence = "`".repeat(longestBacktickRun(line) + 1);
  const pad = /^[` ]|[` ]$/u.test(line) ? " " : "";
  return `${fence}${pad}${line}${pad}${fence}`;
}

/**
 * What fenced() makes a space: controls (C0, DEL and C1), the line and
 * paragraph separators, and format characters (Unicode category Cf: the
 * bidirectional marks, embeddings, overrides and isolates, zero-width and tag
 * characters). These are isLineBreaking's characters and the invisible ones.
 */
const HIDDEN_IN_BLOCK = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/**
 * Text that may come from the agent, quoted as a block: line by line, with each
 * HIDDEN_IN_BLOCK character made a space (the newlines between lines kept, a
 * carriage return dropped at a line's end), so nothing in the block is
 * invisible or reorders the text around it; fenced with more backticks than
 * it holds, so it cannot close the fence.
 */
function fenced(text: string): string[] {
  const body = text
    .split("\n")
    .map((line) => line.replace(HIDDEN_IN_BLOCK, " ").trimEnd())
    .join("\n")
    .trimEnd();
  const fence = "`".repeat(Math.max(3, longestBacktickRun(body) + 1));
  return [fence, body, fence];
}

/** The signals that stop a run (stopOnSignals): Ctrl-C (SIGINT), a kill (SIGTERM), a closed console window (SIGHUP, which Windows follows with a forced end a few seconds later) and Ctrl-Break (SIGBREAK). */
export const STOP_SIGNALS: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"];

/** What the at-once booking does with the process (stopOnSignals): the CLI takes the defaults; tests pass seams. */
export interface StopOnSignals {
  /** Ends the process once a second signal, or a SIGHUP, has been handled (default process.exit). */
  readonly exit?: (code: number) => void;
  /** Says what that signal did (default: written to stderr at once, synchronously). */
  readonly print?: (line: string) => void;
}

/** The command that books a session the ledger has no line for, as the launcher names it. */
export function bookCommand(sessionId: string): string {
  return `pnpm --filter @omnitwin/credit-runner sandbox collect ${sessionId} --book`;
}

/** Writes a line to stderr synchronously: the process ends right after, so a buffered write could be lost. */
function printNow(line: string): void {
  try {
    writeSync(2, `${line}\n`);
  } catch {
    // The console is gone (a closed window): the ledger line, written first, is what matters.
  }
}

/**
 * Installs a handler for each of STOP_SIGNALS and returns what removes them
 * all. The first signal goes to `first`, unless it is a SIGHUP; every later
 * one, and a SIGHUP at any point, goes to `atOnce`.
 */
function handleStopSignals(first: (name: NodeJS.Signals) => void, atOnce: (name: NodeJS.Signals) => void): () => void {
  let received = 0;
  const installed = STOP_SIGNALS.map((name) => {
    const handler = (): void => {
      received += 1;
      if (received === 1 && name !== "SIGHUP") first(name);
      else atOnce(name);
    };
    process.on(name, handler);
    return { name, handler };
  });
  return () => {
    for (const { name, handler } of installed) process.off(name, handler);
  };
}

/**
 * One task, one session: check the bounds and the spend, run, record the
 * spend, review. The budget, time limit, grace period and output caps are
 * checked first (checkRunBounds, as runSession checks them), before the ledger
 * is read or the sandbox set up. The spend is recorded once, as soon as the
 * platform's final figure is read and before any output is downloaded, and
 * even when the run fails after its session started.
 *
 * Stopping (`signal`, or with stopOnSignals the first stop signal) takes the
 * deadline's path: runSession interrupts the session, waits for it or archives
 * it, and its cost is booked here as at any other end; the run then fails with
 * a RunStoppedError. Before the create, nothing is created. A second signal,
 * or a SIGHUP, has no time for that: once a create has been sent, the run is
 * booked at once at its whole budget as unknown, unless it is booked already,
 * and the process ends. The handlers are removed when the run ends.
 */
export async function runSandboxJob(options: JobOptions): Promise<JobRecord> {
  const { api, config, task } = options;
  const now = options.now ?? (() => new Date());
  const log = options.log ?? (() => undefined);
  checkRunBounds(options);
  refuseUnhonouredSpec(task);

  // Set from runSession's callbacks and read by the signal handlers; an object so the compiler does not narrow it to its first values.
  const started: { runId: string | null; creating: boolean; sessionId: string | null; booked: boolean } = { runId: null, creating: false, sessionId: null, booked: false };
  // Every line names the run beside the session, so a line booked before the session's id was known still finds it.
  const emptyLine = (sessionId: string | null): Omit<CreditLine, "costUsd"> => ({
    ts: now().toISOString(),
    lane: config.lane,
    job: `${options.job}:${task.id}`,
    model: AGENT_MODEL,
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    batchId: sessionId,
    ...(started.runId === null ? {} : { runId: started.runId }),
  });
  /**
   * The run's one ledger line. `booked` is set before the write starts and
   * cleared if it fails, and the write is synchronous (appendCreditLine), so a
   * signal handler never meets a write under way: it sees the line written, or
   * no line and no write.
   */
  const bookOnce = async (line: CreditLine): Promise<void> => {
    if (started.booked) return;
    started.booked = true;
    try {
      await appendCreditLine(config.ledgerFile, line);
    } catch (error) {
      started.booked = false;
      throw error;
    }
  };

  const stop = new AbortController();
  const signal = options.signal === undefined ? stop.signal : AbortSignal.any([options.signal, stop.signal]);
  const seams = options.stopOnSignals;
  // Read through a function: a signal handler changes it between reads.
  const stopped = (): boolean => signal.aborted;
  /**
   * A second stop signal, or a SIGHUP: no time to wait for the session to
   * stop. Once a create has been sent, a run not yet booked is booked now,
   * synchronously, at its whole budget as unknown, unless the ledger already
   * has a line for its session or run; then the process ends.
   */
  const bookAtOnce = (by: NodeJS.Signals): void => {
    const exit = seams?.exit ?? ((code: number) => process.exit(code));
    const print = seams?.print ?? printNow;
    stop.abort(by);
    if (!started.creating) {
      print(`${by}: no session was created, so nothing was spent or booked`);
      exit(1);
      return;
    }
    const session = started.sessionId ?? `with run id ${started.runId ?? "unknown"}`;
    let wrote = false;
    if (!started.booked) {
      started.booked = true;
      try {
        if (!charges(readLedgerBookingsSync(config.ledgerFile), started.sessionId, started.runId)) {
          appendCreditLineSync(config.ledgerFile, { ...emptyLine(started.sessionId), ...ledgerCost(bookedCost(false, null, options.budgetUsd)) });
          wrote = true;
        }
      } catch (error) {
        started.booked = false;
        const how = started.sessionId === null ? "book it with collect --book once its id is known" : `book it with ${bookCommand(started.sessionId)}`;
        print(`session ${session} may still be running, and booking it failed (${error instanceof Error ? error.message : String(error)}); ${how}`);
        exit(1);
        return;
      }
    }
    print(
      wrote
        ? `session ${session} may still be running; booked at its whole budget as unknown; collect it when it has stopped`
        : `session ${session} may still be running; it is booked already, so nothing more was written; collect it when it has stopped`,
    );
    exit(1);
  };
  const removeHandlers =
    seams === undefined
      ? () => undefined
      : handleStopSignals((name) => {
          log(`${name}: stopping the run as at its deadline (interrupt, wait, archive if need be, book); a second signal books it at once and exits.`);
          stop.abort(name);
        }, bookAtOnce);

  try {
    const ledger = await readCreditLedger(config.ledgerFile);
    const check = checkSpend(
      ledger,
      config.lane,
      options.budgetUsd,
      { laneCapUsd: config.laneCapUsd, orgCapUsd: config.orgCapUsd, jobCapUsd: options.jobCapUsd },
      `${options.job}:`,
    );
    if (!check.ok) return { kind: "skipped", taskId: task.id, reason: check.reason };
    log(`Spend check passed: ${check.reason}.`);
    if (stopped()) throw new RunStoppedError(signal, null);

    const state = await ensureSandbox(api, path.join(config.workRoot, "state.json"), sandboxSystemPrompt(options.projectRules), log);
    const branch = `credit/${task.id}`;
    const runDir = path.join(config.workRoot, "runs", task.id, stamp(now()));
    await mkdir(runDir, { recursive: true });

    // The session's one ledger line, from the platform's figure. runSession
    // hands the totals over (onCostKnown) as soon as the final status is read,
    // before any output is downloaded, so a download that stalls or fails cannot
    // hold the line back; every later path sees `booked` and writes no second one.
    const bookTotals = (totals: RunTotals): Promise<void> =>
      bookOnce({
        ...emptyLine(totals.sessionId),
        requests: totals.requests,
        inputTokens: totals.inputTokens + totals.cacheReadTokens + totals.cacheCreationTokens,
        outputTokens: totals.outputTokens,
        ...ledgerCost(bookedCost(totals.stopped, totals.listCostUsd, options.budgetUsd)),
      });

    let result: SessionRunResult;
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
        signal,
        // Synchronously before the create is sent: from here a second signal books the run.
        beforeCreate: (runId) => {
          started.runId = runId;
          started.creating = true;
        },
        onSessionCreated: (id) => {
          started.sessionId = id;
        },
        onCostKnown: bookTotals,
        ...(options.sleep === undefined ? {} : { sleep: options.sleep }),
        ...(options.graceMs === undefined ? {} : { graceMs: options.graceMs }),
        ...(options.outputCaps === undefined ? {} : { outputCaps: options.outputCaps }),
      });
    } catch (error) {
      // Nothing is spent before a session exists. Once one does (or may), it is
      // charged once: already, when the failure came after the platform's figure
      // was read (a download, say, or a stop); otherwise the platform's figure if
      // the session has stopped, or else the whole budget, marked unknown.
      // runSession has already tried to stop it. A booking that fails here never
      // hides the run's own error: both are reported, that one first.
      const sessionId = started.sessionId;
      try {
        if (started.booked) {
          // Booked from the platform's figure before the failure, or at once by a second signal.
        } else if (sessionId !== null) {
          const snapshot = await api.retrieveSession(sessionId).catch(() => null);
          const cost = bookedCost(snapshot !== null && isStopped(snapshot.status), snapshot === null ? null : listCostUsd(snapshot), options.budgetUsd);
          await bookOnce({ ...emptyLine(sessionId), ...ledgerCost(cost) });
        } else if (error instanceof SessionMayExistError) {
          // Booked under the run id it carries, so the session, should it turn up, is found by its metadata `run`.
          await bookOnce({ ...emptyLine(null), runId: error.runId, ...ledgerCost(bookedCost(false, null, options.budgetUsd)) });
        }
      } catch (bookingError) {
        throw new BookingFailedError(error, bookingError);
      }
      throw error;
    }

    // runSession booked it before the downloads; this covers only a runSession that did not call back.
    if (!started.booked) await bookTotals(result);
    // A stop that came during the last download: the run is booked, and is not reviewed.
    if (stopped()) throw new RunStoppedError(signal, result);
    const { costUsd, costKnown } = bookedCost(result.stopped, result.listCostUsd, options.budgetUsd);

    return await writeRecord(task, runDir, branch, options.baseSha, options.repoUrl, result, costUsd, costKnown, log);
  } finally {
    removeHandlers();
  }
}

/**
 * A run failed, and booking it on the failure path failed too: the message
 * holds both, the run's own error first, and `errors` keeps both errors.
 */
export class BookingFailedError extends AggregateError {
  constructor(original: unknown, bookingError: unknown) {
    const messageOf = (value: unknown): string => (value instanceof Error ? value.message : String(value));
    super([original, bookingError], `${messageOf(original)}; booking it in the credit ledger failed too: ${messageOf(bookingError)}`);
    this.name = "BookingFailedError";
  }
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
  const review = await reviewRun(result, { baseSha, repoUrl, log, preconditionExpected: task.precondition !== undefined });
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
  refuseUnhonouredSpec(options.task);
  const result = await recollectSession(options.api, options.sessionId, options.runDir, options.log);
  // An unknown cost is counted at the whole budget, as runSandboxJob booked it; never shown as $0.
  const { costUsd, costKnown } = bookedCost(result.stopped, result.listCostUsd, options.budgetUsd ?? options.task.budgetUsd);
  return writeRecord(options.task, options.runDir, `credit/${options.task.id}`, options.baseSha, options.repoUrl, result, costUsd, costKnown, options.log);
}
