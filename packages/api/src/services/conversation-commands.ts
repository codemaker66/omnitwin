import { and, eq } from "drizzle-orm";
import type {
  ConversationCommand,
  ConversationCommandAck,
  Message,
  RequestTransition,
  SlotObservation,
  Thread,
  VenueRequest,
} from "@omnitwin/types";
import { diaryCommands, messages, requests, spaces, threads } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { canManageVenue } from "../utils/query.js";
import { PG_UNIQUE_VIOLATION, pgErrorCode } from "./booking-mutations.js";
import {
  readThreadCore,
  sendMessageCore,
  serializeMessage,
  serializeThread,
  type ConversationDeny,
} from "./conversations.js";
import {
  createRequestCore,
  serializeRequest,
  transitionRequestCore,
  type RequestActor,
  type RequestDeny,
} from "./requests.js";
import { readObservationByKey, recordObservationCore, type ObservationDeny } from "./observations.js";
import { pushForReply, pushForRequestLanded, tell } from "./push-triggers.js";
import { pokeEscalationScheduler } from "./escalation-wake.js";

// ---------------------------------------------------------------------------
// Conversation command dispatch (goal 19 S2; D5).
//
// `conversation.command` rides the same /ws/diary socket and the same
// diary_commands ledger as the Diary's booking commands, so a message sent
// over a dying socket and resent over REST is ONE logical message:
//
//   1. The ledger is read first. A commandId already recorded replays its
//      recorded outcome — after proving THIS actor may see the recorded
//      venue AND, for a send, that the thread's audience still admits them
//      (the replay-authorisation lesson from T-537: a commandId is a bare
//      global key and must never hand another venue's words to a stranger).
//   2. Otherwise the core runs. Every core here is idempotent on its own
//      key (a message by thread + idempotencyKey, a request by venue +
//      idempotencyKey, a request step by the ladder in the UPDATE's WHERE),
//      so two executions of the same command are one effect.
//   3. The ledger row is written. A unique violation means the same id was
//      recorded by a racing transport a moment ago: its outcome replays.
//
// The fresh state in a replayed ack is read from the rows, never from the
// ledger (snapshot doctrine). The transport broadcasts the `changed`
// descriptor AFTER this resolves; replays broadcast nothing.
// ---------------------------------------------------------------------------

export type ConversationChanged =
  | { readonly kind: "message.sent"; readonly thread: Thread; readonly message: Message }
  | {
      readonly kind: "request.created" | "request.updated";
      readonly request: VenueRequest;
      readonly notificationIds: readonly string[];
    }
  /** Goal 19 S5: a fact about the room landed; the floor refetches. */
  | { readonly kind: "observation.recorded"; readonly observation: SlotObservation };

export interface ConversationCommandExecution {
  readonly ack: ConversationCommandAck;
  /** Non-null when a FRESH effect committed. Replays carry null. */
  readonly changed: ConversationChanged | null;
}

interface Recorded {
  readonly venueId: string;
  readonly userId: string | null;
  readonly kind: string;
  readonly outcome: string;
  readonly statusCode: number;
  readonly errorCode: string | null;
}

/** A Database, or the transaction a request step runs in. */
type LedgerConn = Pick<Database, "select" | "insert">;

type Deny = ConversationDeny | RequestDeny | ObservationDeny;

function isDeny(value: unknown): value is Deny {
  return typeof value === "object" && value !== null && "ok" in value && (value as { readonly ok: unknown }).ok === false;
}

function rejected(
  command: ConversationCommand,
  status: number,
  code: string,
  error: string,
  nowMs: number,
  replay = false,
  ownerName?: string,
): ConversationCommandAck {
  return {
    type: "conversation.ack",
    commandId: command.commandId,
    outcome: "rejected",
    replay,
    status,
    code,
    error,
    ...(ownerName === undefined ? {} : { ownerName }),
    serverNowMs: nowMs,
  };
}

async function readRecorded(db: LedgerConn, commandId: string): Promise<Recorded | null> {
  const [row] = await db.select().from(diaryCommands).where(eq(diaryCommands.commandId, commandId)).limit(1);
  if (row === undefined) return null;
  return {
    venueId: row.venueId, userId: row.userId, kind: row.kind,
    outcome: row.outcome, statusCode: row.statusCode, errorCode: row.errorCode,
  };
}

/** Write the ledger row; "duplicate" when the id was already recorded. */
async function record(
  db: LedgerConn,
  command: ConversationCommand,
  venueId: string,
  actor: RequestActor,
  outcome: "applied" | "rejected",
  statusCode: number,
  errorCode: string | null,
): Promise<"recorded" | "duplicate"> {
  try {
    await db.insert(diaryCommands).values(ledgerRow(command, venueId, actor, outcome, statusCode, errorCode));
    return "recorded";
  } catch (error) {
    if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) return "duplicate";
    throw error;
  }
}

interface FreshState {
  readonly message?: Message;
  readonly request?: VenueRequest;
  readonly observation?: SlotObservation;
}

/** The fresh state a replayed ack carries, read from the rows by the
 *  command's own key; nothing is invented when the rows are gone. */
async function freshState(
  db: Database,
  actor: RequestActor,
  command: ConversationCommand,
  recordedVenueId: string,
): Promise<FreshState | ConversationDeny> {
  if (command.kind === "observation.record") {
    const observation = await readObservationByKey(db, recordedVenueId, command.payload.idempotencyKey);
    return observation === null ? {} : { observation };
  }
  if (command.kind === "message.send") {
    const thread = await readThreadCore(db, actor, command.threadId);
    if (isDeny(thread)) return thread;
    const [row] = await db
      .select()
      .from(messages)
      .where(and(eq(messages.threadId, command.threadId), eq(messages.idempotencyKey, command.payload.idempotencyKey)))
      .limit(1);
    return row === undefined ? {} : { message: serializeMessage(row, []) };
  }
  // Narrow on the kind itself: a separate flag cannot narrow the payload.
  const [row] = await db
    .select({ request: requests, roomName: spaces.name })
    .from(requests)
    .leftJoin(spaces, eq(spaces.id, requests.roomId))
    .where(
      command.kind === "request.create"
        ? eq(requests.idempotencyKey, command.payload.idempotencyKey)
        : eq(requests.id, command.requestId),
    )
    .limit(1);
  if (row === undefined) return {};
  if (!canManageVenue(actor, row.request.venueId)) return { ok: false, status: 403, code: "FORBIDDEN", error: "Forbidden" };
  return { request: serializeRequest(row.request, row.roomName) };
}

async function replay(
  db: Database,
  actor: RequestActor,
  command: ConversationCommand,
  recorded: Recorded,
  nowMs: number,
): Promise<ConversationCommandExecution> {
  // The ledger key is global: prove this actor may see the recorded venue
  // before any row is read, and re-check the audience through freshState.
  if (!canManageVenue(actor, recorded.venueId)) {
    return { ack: rejected(command, 403, "FORBIDDEN", "Forbidden", nowMs, true), changed: null };
  }
  // A key belongs to the press that minted it: the same person, the same
  // command. Anyone else sending it is told so, never handed that outcome.
  if (recorded.userId !== actor.id || recorded.kind !== command.kind) {
    return {
      ack: rejected(command, 409, "IDEMPOTENCY_KEY_REUSED", "This key was already used for a different step.", nowMs, true),
      changed: null,
    };
  }
  const state = await freshState(db, actor, command, recorded.venueId);
  if (isDeny(state)) {
    return { ack: rejected(command, state.status, state.code, state.error, nowMs, true), changed: null };
  }
  return {
    ack: {
      type: "conversation.ack",
      commandId: command.commandId,
      outcome: recorded.outcome === "applied" ? "applied" : "rejected",
      replay: true,
      status: recorded.statusCode,
      ...(state.message === undefined ? {} : { message: state.message }),
      ...(state.request === undefined ? {} : { request: state.request }),
      ...(state.observation === undefined ? {} : { observation: state.observation }),
      ...(recorded.errorCode === null ? {} : { code: recorded.errorCode }),
      serverNowMs: nowMs,
    },
    changed: null,
  };
}

interface Applied {
  readonly ok: true;
  readonly status: number;
  readonly replay: boolean;
  readonly changed: ConversationChanged | null;
  readonly ack: FreshState;
}

type RequestStepCommand = Extract<ConversationCommand, { readonly requestId: string }>;

function isRequestStep(command: ConversationCommand): command is RequestStepCommand {
  return "requestId" in command;
}

/** The step a request command takes, with the state it was pressed against. */
function transitionOf(command: RequestStepCommand): RequestTransition {
  const expected = command.expectedState === undefined ? {} : { expectedState: command.expectedState };
  switch (command.kind) {
    case "request.acknowledge": return { to: "acknowledged", ...expected };
    case "request.accept": return { to: "accepted", ...expected };
    case "request.underway": return { to: "underway", ...expected };
    case "request.handover": return { to: "handed-over", toUserId: command.payload.toUserId, ...expected };
    case "request.resolve": return { to: "resolved", outcome: command.payload.outcome, note: command.payload.note, ...expected };
    case "request.reopen": return { to: "reopened", note: command.payload.note, ...expected };
    default: {
      const exhausted: never = command;
      throw new Error(`Unhandled request step ${String(exhausted)}`);
    }
  }
}

type StepRun =
  | { readonly kind: "recorded"; readonly recorded: Recorded }
  | { readonly kind: "applied"; readonly request: VenueRequest }
  | { readonly kind: "denied"; readonly deny: RequestDeny };

/**
 * A request step (L9). Reading the ledger, taking the step and recording it
 * happen in ONE transaction, behind a lock on the request's row: the same key
 * sent twice at once (two tabs replaying one offline queue, a socket and a
 * REST retry) is one step, a crash cannot leave a step taken and unrecorded,
 * and an accept that landed is never recorded as refused. A handover is not
 * idempotent through the ladder (handed-over → handed-over is a step), so the
 * ladder alone could not promise this.
 */
async function executeRequestStep(
  db: Database,
  actor: RequestActor,
  connectionVenueId: string,
  command: RequestStepCommand,
  now: () => number,
): Promise<ConversationCommandExecution> {
  let run: StepRun;
  try {
    run = await db.transaction(async (tx): Promise<StepRun> => {
      await tx.select({ id: requests.id }).from(requests).where(eq(requests.id, command.requestId)).for("update");
      const already = await readRecorded(tx, command.commandId);
      if (already !== null) return { kind: "recorded", recorded: already };
      const result = await transitionRequestCore(tx, actor, command.requestId, transitionOf(command));
      if (isDeny(result)) {
        await tx.insert(diaryCommands).values(ledgerRow(command, connectionVenueId, actor, "rejected", result.status, result.code));
        return { kind: "denied", deny: result };
      }
      await tx.insert(diaryCommands).values(ledgerRow(command, connectionVenueId, actor, "applied", 200, null));
      return { kind: "applied", request: result.request };
    });
  } catch (error) {
    // The key was recorded by another request's step in the meantime (a
    // reused key): its outcome is replayed, or refused, never re-run.
    if (pgErrorCode(error) !== PG_UNIQUE_VIOLATION) throw error;
    const recorded = await readRecorded(db, command.commandId);
    if (recorded === null) throw error;
    run = { kind: "recorded", recorded };
  }
  const nowMs = now();
  if (run.kind === "recorded") return replay(db, actor, command, run.recorded, nowMs);
  if (run.kind === "denied") {
    const ownerName = run.deny.ownerName;
    return { ack: rejected(command, run.deny.status, run.deny.code, run.deny.error, nowMs, false, ownerName), changed: null };
  }
  // Committed: a handover's relief deadline is now there for the scheduler.
  if (command.kind === "request.handover") pokeEscalationScheduler();
  return {
    ack: {
      type: "conversation.ack",
      commandId: command.commandId,
      outcome: "applied",
      replay: false,
      status: 200,
      request: run.request,
      serverNowMs: nowMs,
    },
    changed: { kind: "request.updated", request: run.request, notificationIds: [] },
  };
}

function ledgerRow(
  command: ConversationCommand,
  venueId: string,
  actor: RequestActor,
  outcome: "applied" | "rejected",
  statusCode: number,
  errorCode: string | null,
): typeof diaryCommands.$inferInsert {
  return {
    commandId: command.commandId,
    venueId,
    userId: actor.id,
    kind: command.kind,
    // Provenance for a fact about the room (D11): the booking it was
    // seen against, with the actor and the time the ledger already keeps.
    bookingId: command.kind === "observation.record" ? command.payload.bookingId : null,
    outcome,
    statusCode,
    errorCode,
  };
}

async function runCore(
  db: Database,
  actor: RequestActor,
  connectionVenueId: string,
  command: ConversationCommand,
  now: () => number,
): Promise<Applied | Deny> {
  switch (command.kind) {
    case "message.send": {
      const result = await sendMessageCore(db, actor, command.threadId, command.payload);
      if (isDeny(result)) return result;
      return {
        ok: true,
        status: result.replay ? 200 : 201,
        replay: result.replay,
        changed: result.replay ? null : { kind: "message.sent", thread: result.thread, message: result.message },
        ack: { message: result.message },
      };
    }
    case "request.create": {
      const result = await createRequestCore(db, actor, connectionVenueId, command.payload);
      if (isDeny(result)) return result;
      return {
        ok: true,
        status: result.replay ? 200 : 201,
        replay: result.replay,
        changed: result.replay
          ? null
          : { kind: "request.created", request: result.request, notificationIds: result.notificationIds },
        ack: { request: result.request },
      };
    }
    case "request.acknowledge":
    case "request.accept":
    case "request.underway":
    case "request.handover":
    case "request.resolve":
    case "request.reopen":
      // Request steps run in executeRequestStep, in one transaction with
      // their ledger row; nothing reaches here with one.
      throw new Error(`${command.kind} runs in executeRequestStep`);
    case "observation.record": {
      // A fact about the room (goal 19 S5): the core is idempotent on
      // (venue, key), so the same tap over a dying socket and over REST is
      // one fact, and a replay announces nothing.
      const result = await recordObservationCore(db, actor, connectionVenueId, command.payload, now);
      if (isDeny(result)) return result;
      return {
        ok: true,
        status: result.replay ? 200 : 201,
        replay: result.replay,
        changed: result.replay ? null : { kind: "observation.recorded", observation: result.observation },
        ack: { observation: result.observation },
      };
    }
    default: {
      const exhausted: never = command;
      throw new Error(`Unhandled command ${String(exhausted)}`);
    }
  }
}

export async function executeConversationCommand(
  db: Database,
  actor: RequestActor,
  connectionVenueId: string,
  command: ConversationCommand,
  now: () => number = () => Date.now(),
): Promise<ConversationCommandExecution> {
  if (isRequestStep(command)) return executeRequestStep(db, actor, connectionVenueId, command, now);

  const already = await readRecorded(db, command.commandId);
  if (already !== null) return replay(db, actor, command, already, now());

  const outcome = await runCore(db, actor, connectionVenueId, command, now);
  const nowMs = now();

  if (isDeny(outcome)) {
    const written = await record(db, command, connectionVenueId, actor, "rejected", outcome.status, outcome.code);
    if (written === "duplicate") {
      const recorded = await readRecorded(db, command.commandId);
      if (recorded !== null) return replay(db, actor, command, recorded, nowMs);
    }
    const ownerName = "ownerName" in outcome ? outcome.ownerName : undefined;
    return { ack: rejected(command, outcome.status, outcome.code, outcome.error, nowMs, false, ownerName), changed: null };
  }

  const written = await record(db, command, connectionVenueId, actor, "applied", outcome.status, null);
  if (written === "duplicate") {
    const recorded = await readRecorded(db, command.commandId);
    if (recorded !== null) return replay(db, actor, command, recorded, nowMs);
  }
  // Committed and recorded: tell the devices that asked (S7). Never a
  // replay, never the author of their own words, never a failure here.
  if (outcome.changed?.kind === "request.created") {
    tell(pushForRequestLanded(db, outcome.changed.request), undefined, "request.landed");
  } else if (outcome.changed?.kind === "message.sent" && outcome.changed.thread.requestId !== null) {
    tell(pushForReply(db, {
      requestId: outcome.changed.thread.requestId,
      messageId: outcome.changed.message.id,
      authorUserId: outcome.changed.message.authorUserId,
      authorName: outcome.changed.message.authorName,
      body: outcome.changed.message.body,
    }), undefined, "request.replied");
  }
  return {
    ack: {
      type: "conversation.ack",
      commandId: command.commandId,
      outcome: "applied",
      replay: outcome.replay,
      status: outcome.status,
      ...(outcome.ack.message === undefined ? {} : { message: outcome.ack.message }),
      ...(outcome.ack.request === undefined ? {} : { request: outcome.ack.request }),
      ...(outcome.ack.observation === undefined ? {} : { observation: outcome.ack.observation }),
      serverNowMs: nowMs,
    },
    changed: outcome.changed,
  };
}

/** The thread a committed message belongs to, for the transport's frame. */
export async function threadForFrame(db: Database, threadId: string): Promise<Thread | null> {
  const [row] = await db.select().from(threads).where(eq(threads.id, threadId)).limit(1);
  return row === undefined ? null : serializeThread(row);
}
