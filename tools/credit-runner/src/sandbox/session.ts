import { randomUUID } from "node:crypto";
import { appendFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BetaManagedAgentsSession, SessionCreateParams } from "@anthropic-ai/sdk/resources/beta/sessions/sessions";
import { MAX_TIMEOUT_MINUTES } from "../task.js";
import { isAmbiguousFailure, type OutputFile, type SandboxApi, type SessionEvent, type SessionRef } from "./api.js";
import { outcomeFor, type RunFacts, VERIFY_COMMAND, verifyTaskJson } from "./brief.js";
import { OUTPUT_CAPS, type OutputCaps, OutputTimeoutError, OutputTooLargeError, planOutputs } from "./outputs.js";
import type { SandboxState } from "./setup.js";

export interface SessionRunOptions {
  readonly api: SandboxApi;
  readonly state: SandboxState;
  readonly facts: RunFacts;
  /** Hard cap on the session's list-priced spend, enforced by the platform. */
  readonly budgetUsd: number;
  /** After this the launcher interrupts the agent; a grace period later it stops waiting. */
  readonly timeoutMinutes: number;
  /** Local folder for this run's event log, outputs and result. */
  readonly runDir: string;
  readonly verifyScript: string;
  readonly title: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly maxIterations?: number;
  readonly log?: (line: string) => void;
  /** Called as soon as the session exists, so a later failure can still be charged to it. */
  readonly onSessionCreated?: (sessionId: string) => void;
  /**
   * Called once, as soon as the platform's final status and cost are read and
   * before any output is downloaded, so the run can be booked even if a
   * download then stalls or fails. A throw from it fails the run.
   */
  readonly onCostKnown?: (totals: RunTotals) => Promise<void>;
  /** Test seams: every wait (back-off, polls, lookups) goes through `sleep`. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** How long after the deadline's interrupt the launcher keeps following (default DEFAULT_GRACE_MS, at most MAX_GRACE_MS). */
  readonly graceMs?: number;
  /** Test seam: the byte caps on what comes back (default OUTPUT_CAPS). */
  readonly outputCaps?: OutputCaps;
}

/**
 * The verifier's own line, as printed in the container. The agent controls
 * that container, so this is evidence, not proof: the review decides from the
 * returned patches, and CI is the acceptance authority.
 */
export interface VerifyReport {
  readonly ok: boolean;
  readonly head: string;
  readonly problems: readonly string[];
  /** The branch's commits, oldest first (the order format-patch numbers them); null if not reported. */
  readonly commits: readonly string[] | null;
  /** Things to look at that do not fail the check, such as a change that only adds lines. */
  readonly flags: readonly string[];
  /** The end of the acceptance command's output with the fix taken away. */
  readonly baseTail: string | null;
  readonly [key: string]: unknown;
}

export interface SessionRunResult {
  readonly sessionId: string;
  /** The platform's status when the launcher read its totals. */
  readonly status: string;
  /** The platform said idle or terminated: the cost figure is final. Otherwise it is a snapshot of a session that may still spend. */
  readonly stopped: boolean;
  /** The session would not stop, so the launcher archived it. */
  readonly archived: boolean;
  /** The stream said the session had finished, but the platform's first status read said it was still running. */
  readonly runningAfterFinish: boolean;
  /** When the launcher had to stop the session itself, whether its interrupt reached the session. */
  readonly stopInterrupted: boolean;
  readonly stopReason: string | null;
  readonly timedOut: boolean;
  readonly listCostUsd: number | null;
  readonly activeSeconds: number | null;
  readonly requests: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
  /** The last verifier run, parsed from that bash call's own tool result. */
  readonly verify: VerifyReport | null;
  readonly verifyRuns: number;
  readonly outcome: { readonly result: string; readonly explanation: string; readonly iteration: number } | null;
  readonly errors: readonly string[];
  readonly deniedAsks: number;
  /** The outputs downloaded, as local paths under launcher-chosen names (outputs.ts). */
  readonly outputs: readonly string[];
  /** Each downloaded output's local path, and the name it had in the sandbox. */
  readonly outputNames: Readonly<Record<string, string>>;
  /** Why outputs the review would read were not downloaded (a name it cannot account for, a size over the cap, a deadline passed, the API would not serve it); each rejects the run. */
  readonly refusedOutputs: readonly string[];
  /** Outputs the review does not read, left in the sandbox and never requested (the report, logs, the session's copies of its inputs). */
  readonly leftOutputs: readonly string[];
}

/**
 * Everything in a run's result that is known once the platform's final status
 * is read, before any output is downloaded: the status, the cost (final when
 * `stopped`) and the token counts, which is all a ledger line needs.
 */
export type RunTotals = Omit<SessionRunResult, "outputs" | "outputNames" | "refusedOutputs" | "leftOutputs">;

/**
 * Any line that claims to be the verifier's: only one may appear in its call's
 * result. Lines end at CR LF, a lone CR or LF only (JSON escapes both, so the
 * verifier's own line holds neither): U+2028 and U+2029, which JSON leaves
 * unescaped, can sit inside that line (in a test's output tail).
 */
const VERIFY_CLAIM = /^\s*VERIFY_RESULT\b/u;
const VERIFY_LINE = /^VERIFY_RESULT (\{.*\})\s*$/su;

/**
 * A bash call whose whole command is exactly VERIFY_COMMAND. This rejects a
 * command with anything appended or wrapped around it (a `cd`, a redirection,
 * an `echo` after it, a function defined on the same line). It cannot rule out
 * a function or alias named node defined in an earlier call of a persistent
 * shell, or a replaced node binary: the agent controls the container. That is
 * why the verifier's result stays advisory and the review reads the patches.
 * Only the spaces, tabs and newlines bash itself skips around a command are
 * trimmed: a command wrapped in any other space (a no-break space, say) names
 * another program, which the agent could have put on the path.
 */
export function invokesVerifier(command: string): boolean {
  return command.replace(/^[ \t\n]+|[ \t\n]+$/gu, "") === VERIFY_COMMAND;
}

/** Cents as an integer string, as session budgets take them. */
export function centsString(usd: number): string {
  const cents = Math.floor(usd * 100 + 1e-9);
  if (cents < 1) throw new Error(`a budget must be at least one cent, not $${String(usd)}`);
  return String(cents);
}

export function listCostUsd(session: Pick<BetaManagedAgentsSession, "usage">): number | null {
  const amount = session.usage.list_cost?.amount;
  return amount === undefined ? null : Number(amount) / 100;
}

function textOf(content: readonly { readonly type: string }[] | undefined): string {
  return (content ?? [])
    .map((block) => ("text" in block && typeof block.text === "string" ? block.text : ""))
    .join("\n");
}

function stringList(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? [...value] : null;
}

/**
 * The verifier call's VERIFY_RESULT line, if it is the only line in the result
 * that claims to be one and it reads as one. A second claim (a forged line
 * echoed beside the real one) makes the whole result unreadable.
 */
export function parseVerifyOutput(text: string): VerifyReport | null {
  const claims = text.split(/\r\n?|\n/u).filter((line) => VERIFY_CLAIM.test(line));
  if (claims.length !== 1) return null;
  const json = VERIFY_LINE.exec(claims[0] ?? "")?.[1];
  if (json === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.ok !== "boolean" || typeof record.head !== "string" || !Array.isArray(record.problems)) return null;
    const base: unknown = record.base;
    const baseTail = typeof base === "object" && base !== null && "tail" in base && typeof base.tail === "string" ? base.tail : null;
    return {
      ...record,
      ok: record.ok,
      head: record.head,
      problems: record.problems.map(String),
      commits: stringList(record.commits),
      flags: stringList(record.flags) ?? [],
      baseTail,
    };
  } catch {
    return null;
  }
}

/**
 * Everything the launcher learns from a session's events. The live stream and
 * a replay of the session's history feed the same tally; each event counts
 * once, however often it arrives, and only once its handler has succeeded: a
 * deny that could not be sent leaves its ask unseen, so the next connection's
 * replay sends it again.
 */
class EventTally {
  readonly errors: string[] = [];
  requests = 0;
  inputTokens = 0;
  outputTokens = 0;
  cacheReadTokens = 0;
  cacheCreationTokens = 0;
  verify: VerifyReport | null = null;
  verifyRuns = 0;
  outcome: SessionRunResult["outcome"] = null;
  deniedAsks = 0;
  stopReason: string | null = null;
  finished = false;
  /** Events counted so far: a connection that raised this delivered something. */
  handled = 0;
  private readonly seen = new Set<string>();
  private readonly logged = new Set<string>();
  /** Asks that already have a user.tool_confirmation in the history. */
  private readonly answered = new Set<string>();
  private readonly bashCommands = new Map<string, string>();
  /** Off from the deadline's interrupt on, and while the launcher stops a session: a confirmation then could wake an idle session waiting on it. */
  answering = true;

  constructor(
    private readonly eventsFile: string,
    private readonly onAsk: (toolUseEventId: string) => Promise<void>,
    private readonly log: (line: string) => void,
  ) {}

  /** The session's history: its confirmations are read first, so an ask that was answered is not answered twice. */
  async replay(events: AsyncIterable<SessionEvent>): Promise<void> {
    const history: SessionEvent[] = [];
    for await (const event of events) history.push(event);
    for (const event of history) {
      if (event.type === "user.tool_confirmation") this.answered.add(event.tool_use_id);
    }
    for (const event of history) await this.handle(event);
  }

  async handle(event: SessionEvent): Promise<void> {
    if (!("id" in event) || typeof event.id !== "string" || event.id === "") return; // live previews carry no id of their own
    if (this.seen.has(event.id)) return;
    if (!this.logged.has(event.id)) {
      await appendFile(this.eventsFile, `${JSON.stringify(event)}\n`, "utf8");
      this.logged.add(event.id);
    }
    switch (event.type) {
      case "span.model_request_end":
        this.requests += 1;
        this.inputTokens += event.model_usage.input_tokens;
        this.outputTokens += event.model_usage.output_tokens;
        this.cacheReadTokens += event.model_usage.cache_read_input_tokens;
        this.cacheCreationTokens += event.model_usage.cache_creation_input_tokens;
        break;
      case "user.tool_confirmation":
        this.answered.add(event.tool_use_id);
        break;
      case "agent.tool_use": {
        const command = event.input.command;
        if (event.name === "bash" && typeof command === "string") this.bashCommands.set(event.id, command);
        if (event.evaluated_permission === "ask" && (this.answering || this.answered.has(event.id))) {
          // May throw: the event then stays unseen and the deny is sent again on reconnect.
          if (!this.answered.has(event.id)) await this.onAsk(event.id);
          this.answered.add(event.id);
          this.deniedAsks += 1;
        }
        break;
      }
      case "agent.tool_result": {
        const command = this.bashCommands.get(event.tool_use_id);
        if (command !== undefined && invokesVerifier(command)) {
          this.verifyRuns += 1;
          this.verify = parseVerifyOutput(textOf(event.content));
        }
        break;
      }
      case "span.outcome_evaluation_end":
        this.outcome = { result: event.result, explanation: event.explanation, iteration: event.iteration };
        this.log(`Grader, iteration ${String(event.iteration)}: ${event.result}.`);
        break;
      case "session.error":
        this.errors.push(JSON.stringify(event.error));
        break;
      case "session.status_idle":
        if (event.stop_reason.type !== "requires_action") {
          this.stopReason = event.stop_reason.type;
          this.finished = true;
        }
        break;
      case "session.status_terminated":
        this.stopReason = this.stopReason ?? "terminated";
        this.finished = true;
        break;
      default:
        break;
    }
    this.seen.add(event.id);
    this.handled += 1;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The platform's totals and the files the agent left, once the launcher has
 * stopped following the session. The totals come first: `onCostKnown` hears
 * them before any output is downloaded, so a download that stalls (up to
 * DOWNLOAD_TIMEOUT_MS each) or fails cannot hold back the booking.
 */
async function finishRun(
  api: SandboxApi,
  sessionId: string,
  runDir: string,
  tally: EventTally,
  timedOut: boolean,
  stopping: Stopping,
  sleep: (ms: number) => Promise<void>,
  caps: OutputCaps = OUTPUT_CAPS,
  onCostKnown?: (totals: RunTotals) => Promise<void>,
): Promise<SessionRunResult> {
  // The platform's own totals: the cost includes the session-hour fee. It is
  // final only if the session has stopped.
  const final = await api.retrieveSession(sessionId);
  const totals: RunTotals = {
    sessionId,
    status: final.status,
    stopped: isStopped(final.status),
    archived: stopping.archived,
    runningAfterFinish: stopping.runningAfterFinish,
    stopInterrupted: stopping.interrupted,
    stopReason: tally.stopReason,
    timedOut,
    listCostUsd: listCostUsd(final),
    activeSeconds: final.usage.active_seconds ?? null,
    requests: tally.requests,
    inputTokens: final.usage.input_tokens ?? tally.inputTokens,
    outputTokens: final.usage.output_tokens ?? tally.outputTokens,
    cacheReadTokens: final.usage.cache_read_input_tokens ?? tally.cacheReadTokens,
    cacheCreationTokens:
      final.usage.cache_creation === undefined
        ? tally.cacheCreationTokens
        : (final.usage.cache_creation.ephemeral_5m_input_tokens ?? 0) + (final.usage.cache_creation.ephemeral_1h_input_tokens ?? 0),
    verify: tally.verify,
    verifyRuns: tally.verifyRuns,
    outcome: tally.outcome,
    errors: tally.errors,
    deniedAsks: tally.deniedAsks,
  };
  await onCostKnown?.(totals);
  await writeFile(path.join(runDir, "session.json"), `${JSON.stringify(final, null, 2)}\n`, "utf8");
  let files: OutputFile[] = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    files = await api.listOutputFiles(sessionId);
    if (files.length > 0) break;
    if (attempt < 5) await sleep(2000); // indexing lags the idle event by a second or two
  }
  // Only what the review reads comes to this machine, under the launcher's names (outputs.ts).
  const plan = planOutputs(files, caps);
  const outputs: string[] = [];
  const outputNames: Record<string, string> = {};
  const refusedOutputs = [...plan.refused];
  // What the run may still bring back, counted on the bytes actually saved, whatever the listing said.
  let room = caps.total;
  for (const { file, localName } of plan.downloads) {
    const local = path.join(runDir, "outputs", localName);
    try {
      const saved = await api.downloadFile(file.id, local, Math.min(caps.perOutput, room));
      if (saved === "not-downloadable") {
        // The review would read it, so a missing one is a reason, never a quiet gap in the series.
        refusedOutputs.push(`${JSON.stringify(file.filename)} is listed, but the API would not serve it; not downloaded`);
        continue;
      }
    } catch (error) {
      // Past its cap or its deadline: a reason the review rejects on, not a failed run.
      if (error instanceof OutputTooLargeError) refusedOutputs.push(`${JSON.stringify(file.filename)} ran past its size limit while downloading; cut off and removed`);
      else if (error instanceof OutputTimeoutError) refusedOutputs.push(`${JSON.stringify(file.filename)} took longer than ${String(error.minutes)} min to download; abandoned`);
      else throw error;
      continue;
    }
    room -= (await stat(local)).size;
    outputs.push(local);
    outputNames[local] = file.filename;
  }
  return { ...totals, outputs, outputNames, refusedOutputs, leftOutputs: plan.left };
}

/** Idle (waiting for input, spending nothing) or terminated: the platform's cost figure is then final. */
export function isStopped(status: string): boolean {
  return status === "idle" || status === "terminated";
}

const defaultSleep = (ms: number): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Connections in a row that deliver nothing new before the launcher stops following. */
const MAX_IDLE_CONNECTIONS = 30;
const INTERRUPT_ATTEMPTS = 5;
/** How long an interrupted session gets to stop before it is archived: 18 polls 10 s apart. */
const STOP_POLLS = 18;
const STOP_POLL_MS = 10_000;
const ARCHIVE_ATTEMPTS = 3;
/** Waits before each metadata lookup after an unclear create: the API may still be making the session. */
const LOOKUP_WAITS_MS = [0, 5_000, 15_000, 30_000] as const;
/**
 * How long before its create the lookup after an unclear create starts
 * listing sessions: slack for a clock on this machine that runs ahead of the
 * API's, so the session's own created_at still falls inside the listing.
 */
export const LOOKUP_CLOCK_SKEW_MS = 10 * 60_000;
/** How long after the deadline's interrupt the launcher keeps following a session: by default, and at most. */
export const DEFAULT_GRACE_MS = 10 * 60_000;
export const MAX_GRACE_MS = 60 * 60_000;

/** Sends the interrupt, retrying with back-off; false if every attempt failed. */
async function sendInterrupt(api: SandboxApi, sessionId: string, tally: EventTally, sleep: (ms: number) => Promise<void>): Promise<boolean> {
  for (let attempt = 0; attempt < INTERRUPT_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1));
    try {
      await api.sendEvents(sessionId, [{ type: "user.interrupt" }]);
      return true;
    } catch (error) {
      tally.errors.push(`interrupt failed: ${describe(error)}`);
    }
  }
  return false;
}

/** What stopping a session took. */
interface Stopping {
  readonly archived: boolean;
  /** The stream had said the session finished, and the platform's first status read said it was still running. */
  readonly runningAfterFinish: boolean;
  /** The launcher's own interrupt, when stopping needed one, reached the session. */
  readonly interrupted: boolean;
}

/**
 * The launcher has stopped following a session (it saw it stop, gave up at the
 * deadline plus the grace period, ran out of reconnects, or hit an error).
 * Before anything is booked, the platform's own status decides: a session it
 * does not report idle or terminated is interrupted again, waited for and, if
 * it still runs, archived. A session that stops without the launcher having
 * seen it stop has its history replayed, so the tally is complete; that replay
 * answers no ask, since a confirmation could wake a session waiting on one.
 * Never throws.
 */
async function stopSession(
  api: SandboxApi,
  sessionId: string,
  tally: EventTally,
  sleep: (ms: number) => Promise<void>,
  log: (line: string) => void,
): Promise<Stopping> {
  /** The platform's status: stopped (and the tally then completed), running, or unknown when the read failed. */
  const read = async (): Promise<"stopped" | "running" | "unknown"> => {
    const status = await api.retrieveSession(sessionId).then(
      (session) => session.status,
      (error: unknown) => {
        tally.errors.push(`status check failed: ${describe(error)}`);
        return null;
      },
    );
    if (status === null) return "unknown";
    if (!isStopped(status)) return "running";
    if (!tally.finished) {
      tally.answering = false;
      try {
        await tally.replay(api.listEvents(sessionId));
      } catch (error) {
        tally.errors.push(`history after the stop: ${describe(error)}`);
      }
    }
    return "stopped";
  };
  const first = await read();
  if (first === "stopped") return { archived: false, runningAfterFinish: false, interrupted: false };
  // Only a read that said running counts: a failed read says nothing about the session.
  const runningAfterFinish = tally.finished && first === "running";
  log(`Session ${sessionId} has not been seen to stop; interrupting it again.`);
  const interrupted = await sendInterrupt(api, sessionId, tally, sleep);
  for (let poll = 0; poll < STOP_POLLS; poll += 1) {
    if (poll > 0) await sleep(STOP_POLL_MS);
    if ((await read()) === "stopped") return { archived: false, runningAfterFinish, interrupted };
  }
  for (let attempt = 0; attempt < ARCHIVE_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await sleep(2000 * attempt);
    try {
      await api.archiveSession(sessionId);
      log(`Session ${sessionId} would not stop; archived it.`);
      return { archived: true, runningAfterFinish, interrupted };
    } catch (error) {
      tally.errors.push(`archive failed: ${describe(error)}`);
    }
  }
  return { archived: false, runningAfterFinish, interrupted };
}

/**
 * Creation failed in a way that does not say whether the session exists, and
 * the lookup did not find it: the lookup failed, or a create still in flight
 * may start the session later. One may be running and spending. The message
 * and `runId` give the per-run id its metadata carries (kickoff.md in the run
 * folder holds it too), so the session can be found later.
 */
export class SessionMayExistError extends Error {
  readonly runId: string;
  constructor(message: string, options: { readonly cause: unknown; readonly runId: string }) {
    super(message, { cause: options.cause });
    this.name = "SessionMayExistError";
    this.runId = options.runId;
  }
}

async function findSession(api: SandboxApi, metadata: Readonly<Record<string, string>>, createdSince: string): Promise<SessionRef | null> {
  for await (const session of api.listSessions(createdSince)) {
    if (Object.entries(metadata).every(([key, value]) => session.metadata[key] === value)) return { id: session.id, status: session.status };
  }
  return null;
}

/**
 * One create, never retried. Unless the server refused it (isAmbiguousFailure:
 * a 4xx other than 408), a failed create may have made the session anyway (the
 * connection broke or timed out, the server failed, or a 2xx body broke or
 * stalled): it is looked up by its metadata, which carries a per-run id, and
 * followed if found. If it is not found, the failure is a SessionMayExistError,
 * which the launcher charges at the whole budget.
 */
async function createOrFind(
  api: SandboxApi,
  params: SessionCreateParams & { readonly metadata: Readonly<Record<string, string>> & { readonly run: string } },
  sleep: (ms: number) => Promise<void>,
  log: (line: string) => void,
): Promise<SessionRef> {
  const createdSince = new Date(Date.now() - LOOKUP_CLOCK_SKEW_MS).toISOString();
  try {
    return await api.createSession(params);
  } catch (error) {
    if (!isAmbiguousFailure(error)) throw error;
    log(`Creating the session failed (${describe(error)}); looking for it by its metadata before giving up.`);
    let lastLookup: unknown = null;
    for (const wait of LOOKUP_WAITS_MS) {
      if (wait > 0) await sleep(wait);
      try {
        const found = await findSession(api, params.metadata, createdSince);
        if (found !== null) {
          log(`Found session ${found.id}, which the failed create had started.`);
          return found;
        }
        lastLookup = null;
      } catch (lookupError) {
        lastLookup = lookupError;
      }
    }
    const lookup = lastLookup === null ? "no session carries its metadata yet" : `the lookup failed too (${describe(lastLookup)})`;
    const runId = params.metadata.run;
    throw new SessionMayExistError(
      `creating the session failed (${describe(error)}) and ${lookup}; a session may still be running, with run ${runId} in its metadata (kickoff.md in the run folder holds it too)`,
      { cause: error, runId },
    );
  }
}

/**
 * Runs one task in one Managed Agents session and collects what it left. The
 * session is created with its kickoff in `initial_events`, so it is running
 * before the stream opens; every (re)connection therefore reads the history
 * first and drops events it has already seen. However the following ends, a
 * session that has not reported a stop is interrupted, waited for and, if it
 * still runs, archived before the result is read.
 */
export async function runSession(options: SessionRunOptions): Promise<SessionRunResult> {
  const { api, state, facts, runDir, timeoutMinutes } = options;
  // The timers' bounds, checked before anything is uploaded or created: a NaN,
  // a negative or an out-of-range delay would make setTimeout fire at once.
  // The time limit has the spec's ceiling (task.ts), fractional allowed here.
  if (!Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0 || timeoutMinutes > MAX_TIMEOUT_MINUTES) {
    throw new RangeError(`timeoutMinutes must be more than 0 and at most ${String(MAX_TIMEOUT_MINUTES)}, not ${String(timeoutMinutes)}`);
  }
  const graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
  if (!Number.isFinite(graceMs) || graceMs < 0 || graceMs > MAX_GRACE_MS) {
    throw new RangeError(`graceMs must be from 0 to ${String(MAX_GRACE_MS)}, not ${String(graceMs)}`);
  }
  const log = options.log ?? (() => undefined);
  const sleep = options.sleep ?? defaultSleep;
  await mkdir(path.join(runDir, "outputs"), { recursive: true });

  const verifyFileId = await api.uploadFile("verify.mjs", options.verifyScript);
  const taskFileId = await api.uploadFile("task.json", verifyTaskJson(facts));
  const outcome = outcomeFor(facts);
  // `run` makes the metadata unique, so a lookup after an unclear create finds
  // this session and no other; kickoff.md keeps it, so a session that may have
  // started can be found by it later.
  const runId = randomUUID();
  await writeFile(path.join(runDir, "kickoff.md"), `Run id (the session's metadata \`run\`): ${runId}\n\n${outcome.description}\n---\n\n${outcome.rubric}`, "utf8");

  const session = await createOrFind(
    api,
    {
      agent: { type: "agent", id: state.agentId, version: state.agentVersion },
      environment_id: state.environmentId,
      title: options.title,
      metadata: { ...options.metadata, run: runId },
      resources: [
        { type: "file", file_id: verifyFileId, mount_path: "/verify.mjs" },
        { type: "file", file_id: taskFileId, mount_path: "/task.json" },
      ],
      budget: { type: "limit", max_list_cost: { amount: centsString(options.budgetUsd), currency: "USD" } },
      initial_events: [
        {
          type: "user.define_outcome",
          description: outcome.description,
          rubric: { type: "text", content: outcome.rubric },
          max_iterations: options.maxIterations ?? 2,
        },
      ],
    },
    sleep,
    log,
  );
  const sessionId = session.id;
  options.onSessionCreated?.(sessionId);
  log(`Session ${sessionId} is ${session.status}.`);

  const tally = new EventTally(
    path.join(runDir, "events.jsonl"),
    // Nobody is watching: a call that needs a person is denied, with the reason.
    (toolUseEventId) =>
      api.sendEvents(sessionId, [
        {
          type: "user.tool_confirmation",
          tool_use_id: toolUseEventId,
          result: "deny",
          deny_message: "This run is unattended, so calls that need approval are denied. Find another way or report the blocker.",
        },
      ]),
    log,
  );

  // Set by the timers, read by the loop: kept in one object so the compiler
  // does not narrow them to their first values.
  const run: { timedOut: boolean; giveUp: boolean; current: { close(): void } | null } = { timedOut: false, giveUp: false, current: null };
  // Interrupt at the deadline (retried); stop waiting a grace period later, whatever happens.
  const interruptTimer = setTimeout(() => {
    run.timedOut = true;
    // From the interrupt on, an ask is left unanswered: a confirmation would wake the interrupted agent.
    tally.answering = false;
    log(`Time limit reached; interrupting ${sessionId}.`);
    void sendInterrupt(api, sessionId, tally, sleep);
  }, timeoutMinutes * 60_000);
  const giveUpTimer = setTimeout(() => {
    run.giveUp = true;
    run.current?.close();
  }, timeoutMinutes * 60_000 + graceMs);
  // Read through functions: the handler and the timers change these between reads.
  const done = (): boolean => tally.finished || run.giveUp;
  const givenUp = (): boolean => run.giveUp;

  let stopping: Stopping = { archived: false, runningAfterFinish: false, interrupted: false };
  try {
    // Only connections that deliver nothing new count towards the limit; one
    // that delivered events resets it.
    let idleConnections = 0;
    for (let first = true; !done() && idleConnections < MAX_IDLE_CONNECTIONS; first = false) {
      if (!first) await sleep(Math.min(30_000, 1000 * 2 ** Math.min(idleConnections, 5)));
      if (done()) break;
      const before = tally.handled;
      try {
        const stream = await api.openStream(sessionId);
        run.current = stream;
        try {
          await tally.replay(api.listEvents(sessionId));
          if (!done()) {
            for await (const event of stream.events) {
              await tally.handle(event);
              if (done()) break;
            }
          }
        } finally {
          stream.close();
        }
      } catch (error) {
        if (!givenUp()) tally.errors.push(`stream: ${describe(error)}`);
      } finally {
        run.current = null;
      }
      idleConnections = tally.handled > before ? 0 : idleConnections + 1;
    }
  } finally {
    clearTimeout(interruptTimer);
    clearTimeout(giveUpTimer);
    // Even a session the stream said had stopped is checked: one the platform still reports running is stopped too.
    stopping = await stopSession(api, sessionId, tally, sleep, log);
  }

  return finishRun(api, sessionId, runDir, tally, run.timedOut, stopping, sleep, options.outputCaps, options.onCostKnown);
}

/**
 * Rebuilds a finished session's result from its history and fetches its
 * outputs again, without starting anything: for a run whose launcher stopped
 * after the session did (as the A4 trial's did, on an output it could not
 * download).
 */
export async function recollectSession(api: SandboxApi, sessionId: string, runDir: string, log: (line: string) => void = () => undefined): Promise<SessionRunResult> {
  await mkdir(path.join(runDir, "outputs"), { recursive: true });
  const eventsFile = path.join(runDir, "events.jsonl");
  await rm(eventsFile, { force: true });
  const tally = new EventTally(eventsFile, () => Promise.resolve(), log);
  await tally.replay(api.listEvents(sessionId));
  if (!tally.finished) throw new Error(`session ${sessionId} has not stopped; nothing to collect yet`);
  return finishRun(api, sessionId, runDir, tally, false, { archived: false, runningAfterFinish: false, interrupted: false }, defaultSleep);
}
