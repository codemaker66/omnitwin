import { and, eq } from "drizzle-orm";
import type {
  ConversationCommand,
  ConversationCommandAck,
  Message,
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
    };

export interface ConversationCommandExecution {
  readonly ack: ConversationCommandAck;
  /** Non-null when a FRESH effect committed. Replays carry null. */
  readonly changed: ConversationChanged | null;
}

interface Recorded {
  readonly venueId: string;
  readonly outcome: string;
  readonly statusCode: number;
  readonly errorCode: string | null;
}

function isDeny(value: unknown): value is ConversationDeny | RequestDeny {
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

async function readRecorded(db: Database, commandId: string): Promise<Recorded | null> {
  const [row] = await db.select().from(diaryCommands).where(eq(diaryCommands.commandId, commandId)).limit(1);
  if (row === undefined) return null;
  return { venueId: row.venueId, outcome: row.outcome, statusCode: row.statusCode, errorCode: row.errorCode };
}

/** Write the ledger row; "duplicate" when the id was already recorded. */
async function record(
  db: Database,
  command: ConversationCommand,
  venueId: string,
  actor: RequestActor,
  outcome: "applied" | "rejected",
  statusCode: number,
  errorCode: string | null,
): Promise<"recorded" | "duplicate"> {
  try {
    await db.insert(diaryCommands).values({
      commandId: command.commandId,
      venueId,
      userId: actor.id,
      kind: command.kind,
      bookingId: null,
      outcome,
      statusCode,
      errorCode,
    });
    return "recorded";
  } catch (error) {
    if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) return "duplicate";
    throw error;
  }
}

/** The fresh state a replayed ack carries, read from the rows by the
 *  command's own key; nothing is invented when the rows are gone. */
async function freshState(
  db: Database,
  actor: RequestActor,
  command: ConversationCommand,
): Promise<{ readonly message?: Message; readonly request?: VenueRequest } | ConversationDeny> {
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
  const requestId = command.kind === "request.create" ? null : command.requestId;
  const [row] = await db
    .select({ request: requests, roomName: spaces.name })
    .from(requests)
    .leftJoin(spaces, eq(spaces.id, requests.roomId))
    .where(
      requestId === null
        ? eq(requests.idempotencyKey, command.payload.idempotencyKey)
        : eq(requests.id, requestId),
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
  const state = await freshState(db, actor, command);
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
  readonly ack: { readonly message?: Message; readonly request?: VenueRequest };
}

async function runCore(
  db: Database,
  actor: RequestActor,
  connectionVenueId: string,
  command: ConversationCommand,
): Promise<Applied | ConversationDeny | RequestDeny> {
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
    case "request.reopen": {
      const transition = command.kind === "request.acknowledge" ? { to: "acknowledged" as const }
        : command.kind === "request.accept" ? { to: "accepted" as const }
          : command.kind === "request.underway" ? { to: "underway" as const }
            : command.kind === "request.handover" ? { to: "handed-over" as const, toUserId: command.payload.toUserId }
              : command.kind === "request.resolve"
                ? { to: "resolved" as const, outcome: command.payload.outcome, note: command.payload.note }
                : { to: "reopened" as const, note: command.payload.note };
      const result = await transitionRequestCore(db, actor, command.requestId, transition);
      if (isDeny(result)) return result;
      return {
        ok: true,
        status: 200,
        replay: false,
        changed: { kind: "request.updated", request: result.request, notificationIds: [] },
        ack: { request: result.request },
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
  const already = await readRecorded(db, command.commandId);
  if (already !== null) return replay(db, actor, command, already, now());

  const outcome = await runCore(db, actor, connectionVenueId, command);
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
  return {
    ack: {
      type: "conversation.ack",
      commandId: command.commandId,
      outcome: "applied",
      replay: outcome.replay,
      status: outcome.status,
      ...(outcome.ack.message === undefined ? {} : { message: outcome.ack.message }),
      ...(outcome.ack.request === undefined ? {} : { request: outcome.ack.request }),
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
