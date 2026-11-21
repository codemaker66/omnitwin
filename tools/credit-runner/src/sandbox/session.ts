import { appendFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BetaManagedAgentsSession } from "@anthropic-ai/sdk/resources/beta/sessions/sessions";
import type { SandboxApi, SessionEvent } from "./api.js";
import { outcomeFor, type RunFacts, verifyTaskJson } from "./brief.js";
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
  /** Test seams. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly graceMs?: number;
}

export interface VerifyReport {
  readonly ok: boolean;
  readonly head: string;
  readonly problems: readonly string[];
  readonly changed: readonly string[];
  readonly [key: string]: unknown;
}

export interface SessionRunResult {
  readonly sessionId: string;
  readonly status: string;
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
  readonly outputs: readonly string[];
  /** Listed outputs the API would not serve (the session's copies of its inputs). */
  readonly skippedOutputs: readonly string[];
}

const VERIFY_LINE = /^VERIFY_RESULT (\{.*\})\s*$/gmu;
/**
 * A bash call that runs the verifier: `node /mnt/session/uploads/verify.mjs`
 * as one command of the line, perhaps after a `cd` and with its output sent to
 * a log that a later command of the same call prints (as the agent did in the
 * A4 trial). The call's tool result must still carry the VERIFY_RESULT line.
 */
const VERIFY_INVOCATION = /(?:^|[;&|(]\s*)node\s+\/mnt\/session\/uploads\/verify\.mjs(?=$|[\s;&|)>])/u;

export function invokesVerifier(command: string): boolean {
  return VERIFY_INVOCATION.test(command);
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

/** The last VERIFY_RESULT line in a tool result, if it reads as one. */
export function parseVerifyOutput(text: string): VerifyReport | null {
  const matches = [...text.matchAll(VERIFY_LINE)];
  const last = matches[matches.length - 1];
  if (last === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(last[1] ?? "");
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.ok !== "boolean" || typeof record.head !== "string" || !Array.isArray(record.problems)) return null;
    return {
      ...record,
      ok: record.ok,
      head: record.head,
      problems: record.problems.map(String),
      changed: Array.isArray(record.changed) ? record.changed.map(String) : [],
    };
  } catch {
    return null;
  }
}

/** Output file names come from the sandbox: keep them inside the run folder. */
export function safeOutputName(filename: string): string {
  const flat = filename
    .replace(/\\/gu, "/")
    .split("/")
    .filter((part) => part !== "" && part !== "." && part !== "..")
    .join("__");
  return flat.replace(/[^A-Za-z0-9._-]/gu, "_") || "unnamed";
}

/**
 * Everything the launcher learns from a session's events. The live stream and
 * a replay of the session's history feed the same tally; each event counts
 * once, however often it arrives.
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
  private readonly seen = new Set<string>();
  private readonly bashCommands = new Map<string, string>();

  constructor(
    private readonly eventsFile: string,
    private readonly onAsk: (toolUseEventId: string) => Promise<void>,
    private readonly log: (line: string) => void,
  ) {}

  async handle(event: SessionEvent): Promise<void> {
    if (!("id" in event) || typeof event.id !== "string" || event.id === "") return; // live previews carry no id of their own
    if (this.seen.has(event.id)) return;
    this.seen.add(event.id);
    await appendFile(this.eventsFile, `${JSON.stringify(event)}\n`, "utf8");
    switch (event.type) {
      case "span.model_request_end":
        this.requests += 1;
        this.inputTokens += event.model_usage.input_tokens;
        this.outputTokens += event.model_usage.output_tokens;
        this.cacheReadTokens += event.model_usage.cache_read_input_tokens;
        this.cacheCreationTokens += event.model_usage.cache_creation_input_tokens;
        break;
      case "agent.tool_use": {
        const command = event.input.command;
        if (event.name === "bash" && typeof command === "string") this.bashCommands.set(event.id, command);
        if (event.evaluated_permission === "ask") {
          this.deniedAsks += 1;
          await this.onAsk(event.id);
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
  }
}

/** The platform's totals and the files the agent left, after the session stopped. */
async function finishRun(
  api: SandboxApi,
  sessionId: string,
  runDir: string,
  tally: EventTally,
  timedOut: boolean,
  sleep: (ms: number) => Promise<void>,
): Promise<SessionRunResult> {
  // The platform's own totals: the cost includes the session-hour fee.
  const final = await api.retrieveSession(sessionId);
  await writeFile(path.join(runDir, "session.json"), `${JSON.stringify(final, null, 2)}\n`, "utf8");
  const outputs: string[] = [];
  const skippedOutputs: string[] = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const files = await api.listOutputFiles(sessionId);
    if (files.length > 0 || attempt === 5) {
      for (const file of files) {
        const data = await api.downloadFile(file.id);
        if (data === null) {
          skippedOutputs.push(file.filename);
          continue;
        }
        const local = path.join(runDir, "outputs", safeOutputName(file.filename));
        await writeFile(local, data);
        outputs.push(local);
      }
      break;
    }
    await sleep(2000); // indexing lags the idle event by a second or two
  }
  return {
    sessionId,
    status: final.status,
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
    outputs,
    skippedOutputs,
  };
}

const defaultSleep = (ms: number): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs one task in one Managed Agents session and collects what it left. The
 * session is created with its kickoff in `initial_events`, so it is running
 * before the stream opens; every (re)connection therefore reads the history
 * first and drops events it has already seen.
 */
export async function runSession(options: SessionRunOptions): Promise<SessionRunResult> {
  const { api, state, facts, runDir } = options;
  const log = options.log ?? (() => undefined);
  const sleep = options.sleep ?? defaultSleep;
  await mkdir(path.join(runDir, "outputs"), { recursive: true });

  const verifyFileId = await api.uploadFile("verify.mjs", options.verifyScript);
  const taskFileId = await api.uploadFile("task.json", verifyTaskJson(facts));
  const outcome = outcomeFor(facts);
  await writeFile(path.join(runDir, "kickoff.md"), `${outcome.description}\n---\n\n${outcome.rubric}`, "utf8");

  const session = await api.createSession({
    agent: { type: "agent", id: state.agentId, version: state.agentVersion },
    environment_id: state.environmentId,
    title: options.title,
    metadata: { ...options.metadata },
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
  });
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
  // Interrupt at the deadline; stop waiting a grace period later, whatever happens.
  const interruptTimer = setTimeout(() => {
    run.timedOut = true;
    log(`Time limit reached; interrupting ${sessionId}.`);
    api.sendEvents(sessionId, [{ type: "user.interrupt" }]).catch((error: unknown) => tally.errors.push(`interrupt failed: ${String(error)}`));
  }, options.timeoutMinutes * 60_000);
  const giveUpTimer = setTimeout(() => {
    run.giveUp = true;
    run.current?.close();
  }, options.timeoutMinutes * 60_000 + (options.graceMs ?? 10 * 60_000));
  // Read through functions: the handler and the timers change these between reads.
  const done = (): boolean => tally.finished || run.giveUp;
  const givenUp = (): boolean => run.giveUp;

  try {
    for (let attempt = 0; !done() && attempt < 30; attempt += 1) {
      if (attempt > 0) await sleep(Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)));
      try {
        const stream = await api.openStream(sessionId);
        run.current = stream;
        for await (const event of api.listEvents(sessionId)) await tally.handle(event);
        if (done()) {
          stream.close();
          break;
        }
        for await (const event of stream.events) {
          await tally.handle(event);
          if (done()) break;
        }
        stream.close();
      } catch (error) {
        if (!givenUp()) tally.errors.push(`stream: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        run.current = null;
      }
    }
  } finally {
    clearTimeout(interruptTimer);
    clearTimeout(giveUpTimer);
  }

  return finishRun(api, sessionId, runDir, tally, run.timedOut, sleep);
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
  for await (const event of api.listEvents(sessionId)) await tally.handle(event);
  if (!tally.finished) throw new Error(`session ${sessionId} has not stopped; nothing to collect yet`);
  return finishRun(api, sessionId, runDir, tally, false, defaultSleep);
}
