import { eq } from "drizzle-orm";
import type { Booking, DiaryCommand, DiaryCommandAck } from "@omnitwin/types";
import { bookings, diaryCommands } from "../db/schema.js";
import type { Database } from "../db/client.js";
import {
  createBookingCore,
  pgErrorCode,
  PG_UNIQUE_VIOLATION,
  serializeBooking,
  transitionBookingCore,
  updateBookingCore,
  type BookingDbConn,
  type BookingMutationResult,
  type BookingRow,
  type MutationActor,
} from "./booking-mutations.js";

// ---------------------------------------------------------------------------
// Diary command dispatch (T-537; Canon §9): "Mutations = commands validated
// in a Neon transaction (exclusion constraint = final arbiter) → commit →
// broadcast."
//
// executeDiaryCommand runs a command's mutation core and its diary_commands
// ledger row in ONE transaction — they commit or vanish together, so the
// client-minted commandId is an exactly-once identity. A resend whose id is
// already recorded aborts the fresh attempt on the ledger's primary key
// (the abort rolls back everything, including any re-executed mutation)
// and replays the recorded outcome (`replay: true`).
//
// The dispatcher itself is transport-neutral and dependency-injected; the
// /ws/diary wiring supplies the real cores + ledger I/O and broadcasts the
// returned `changed` descriptor AFTER this function resolves (commit →
// broadcast, never the other way round).
// ---------------------------------------------------------------------------

export interface RecordedCommand {
  readonly commandId: string;
  readonly outcome: string;
  readonly statusCode: number;
  readonly errorCode: string | null;
  readonly bookingId: string | null;
}

export interface CommandRecord {
  readonly commandId: string;
  readonly venueId: string;
  readonly userId: string;
  readonly kind: DiaryCommand["kind"];
  readonly bookingId: string | null;
  readonly outcome: "applied" | "rejected";
  readonly statusCode: number;
  readonly errorCode: string | null;
}

export interface DiaryChangedDescriptor {
  readonly kind: "booking.created" | "booking.updated" | "booking.transitioned";
  readonly bookingId: string;
}

export interface DiaryCommandExecution {
  readonly ack: DiaryCommandAck;
  /** Non-null when a FRESH mutation committed — the transport broadcasts
   *  this AFTER receiving the result. Replays broadcast nothing. */
  readonly changed: DiaryChangedDescriptor | null;
}

/** Every collaborator injected — the unit tests own each branch. */
export interface DiaryCommandDeps {
  runInTransaction: <T>(work: (tx: BookingDbConn) => Promise<T>) => Promise<T>;
  recordCommand: (tx: BookingDbConn, record: CommandRecord) => Promise<"recorded" | "duplicate">;
  readRecordedCommand: (db: Database, commandId: string) => Promise<RecordedCommand | null>;
  createBooking: typeof createBookingCore;
  updateBooking: typeof updateBookingCore;
  transitionBooking: typeof transitionBookingCore;
  serialize: (row: BookingRow) => Booking;
  loadBookingById: (db: Database, bookingId: string) => Promise<BookingRow | null>;
}

/** Thrown inside the command transaction to abort a duplicate's fresh
 *  attempt — the rollback un-does any re-executed mutation. */
class DuplicateCommandSignal extends Error {
  constructor() {
    super("duplicate command");
  }
}

/** Control-flow signal: a core DENY must roll its savepoint back (a 23P01
 *  puts the sub-transaction in aborted state even though the core catches
 *  the exception in JS) so the OUTER transaction stays healthy for the
 *  ledger write. Carries the deny out of the rollback. */
class CoreDenySignal extends Error {
  constructor(readonly deny: Extract<BookingMutationResult, { ok: false }>) {
    super("core deny");
  }
}

const DIARY_COMMAND_WRITE_ROLES: ReadonlySet<string> = new Set(["staff", "admin"]);

function rejectedAck(
  command: DiaryCommand,
  status: number,
  code: string,
  error: string,
): DiaryCommandAck {
  return {
    type: "diary.ack",
    commandId: command.commandId,
    outcome: "rejected",
    replay: false,
    status,
    code,
    error,
  };
}

export async function executeDiaryCommand(
  db: Database,
  actor: MutationActor,
  connectionVenueId: string,
  command: DiaryCommand,
  deps: DiaryCommandDeps,
): Promise<DiaryCommandExecution> {
  // Role gate first — the live channel admits read-facing roles that must
  // never write (mirrors the REST surface's DIARY_WRITE_ROLES).
  if (!DIARY_COMMAND_WRITE_ROLES.has(actor.role)) {
    return {
      ack: rejectedAck(command, 403, "FORBIDDEN", "Your role cannot write to the diary"),
      changed: null,
    };
  }

  // A create names its venue; the connection is venue-scoped — they must
  // agree. Update/transition resolve venue scope through the row inside
  // their cores (canManageVenue against the booking's venue).
  if (command.kind === "booking.create" && command.payload.venueId !== connectionVenueId) {
    return {
      ack: rejectedAck(
        command,
        403,
        "VENUE_SCOPE_MISMATCH",
        "This connection is scoped to another venue",
      ),
      changed: null,
    };
  }

  try {
    const fresh = await deps.runInTransaction(async (tx) => {
      // The core runs in a SAVEPOINT: when the exclusion constraint fires
      // (23P01 — the ink race, arbitrated by Postgres), the sub-transaction
      // is aborted even though the core returns a calm deny. Rolling the
      // savepoint back keeps THIS transaction healthy, so the ledger can
      // still record the rejected outcome and the ack carries the true
      // code — never a generic failure.
      let result: BookingMutationResult;
      try {
        result = await tx.transaction(async (inner) => {
          const coreResult: BookingMutationResult =
            command.kind === "booking.create"
              ? await deps.createBooking(inner, actor, command.payload)
              : command.kind === "booking.update"
                ? await deps.updateBooking(inner, actor, command.bookingId, command.payload)
                : await deps.transitionBooking(inner, actor, command.bookingId, command.payload);
          if (!coreResult.ok) throw new CoreDenySignal(coreResult);
          return coreResult;
        });
      } catch (error) {
        if (!(error instanceof CoreDenySignal)) throw error;
        result = error.deny;
      }

      const recorded = await deps.recordCommand(tx, {
        commandId: command.commandId,
        venueId: connectionVenueId,
        userId: actor.id,
        kind: command.kind,
        bookingId: result.ok ? result.booking.id : null,
        outcome: result.ok ? "applied" : "rejected",
        statusCode: result.status,
        errorCode: result.ok ? null : result.code,
      });
      // Duplicate id: abort so the whole attempt — including any mutation
      // the core just performed — rolls back; the recorded outcome wins.
      if (recorded === "duplicate") throw new DuplicateCommandSignal();
      return result;
    });

    if (fresh.ok) {
      return {
        ack: {
          type: "diary.ack",
          commandId: command.commandId,
          outcome: "applied",
          replay: false,
          status: fresh.status,
          booking: deps.serialize(fresh.booking),
          // Fresh mutable arrays for the wire shape (the core's result is
          // deliberately readonly).
          resequence:
            fresh.resequence === null || fresh.resequence === undefined
              ? null
              : {
                  changes: [...fresh.resequence.changes],
                  promotedToFirst: [...fresh.resequence.promotedToFirst],
                },
        },
        changed: { kind: fresh.changeKind, bookingId: fresh.booking.id },
      };
    }
    return {
      ack: {
        type: "diary.ack",
        commandId: command.commandId,
        outcome: "rejected",
        replay: false,
        status: fresh.status,
        code: fresh.code,
        error: fresh.error,
        ...(fresh.details === undefined ? {} : { details: fresh.details }),
      },
      changed: null,
    };
  } catch (error) {
    if (error instanceof DuplicateCommandSignal || pgErrorCode(error) === PG_UNIQUE_VIOLATION) {
      // Resend of a completed command: replay the recorded outcome.
      const recorded = await deps.readRecordedCommand(db, command.commandId);
      if (recorded !== null) {
        const row =
          recorded.bookingId === null
            ? null
            : await deps.loadBookingById(db, recorded.bookingId);
        return {
          ack: {
            type: "diary.ack",
            commandId: command.commandId,
            outcome: recorded.outcome === "applied" ? "applied" : "rejected",
            replay: true,
            status: recorded.statusCode,
            ...(row === null ? {} : { booking: deps.serialize(row) }),
            ...(recorded.errorCode === null ? {} : { code: recorded.errorCode }),
          },
          changed: null,
        };
      }
    }
    return {
      ack: rejectedAck(
        command,
        500,
        "COMMAND_FAILED",
        "The command could not be completed — reload the diary and try again",
      ),
      changed: null,
    };
  }
}

// --- the real (non-test) dependency wiring --------------------------------

export function realDiaryCommandDeps(db: Database): DiaryCommandDeps {
  return {
    runInTransaction: (work) => db.transaction((tx) => work(tx)),
    recordCommand: async (tx, record) => {
      try {
        await tx.insert(diaryCommands).values({
          commandId: record.commandId,
          venueId: record.venueId,
          userId: record.userId,
          kind: record.kind,
          bookingId: record.bookingId,
          outcome: record.outcome,
          statusCode: record.statusCode,
          errorCode: record.errorCode,
        });
        return "recorded";
      } catch (error) {
        if (pgErrorCode(error) === PG_UNIQUE_VIOLATION) return "duplicate";
        throw error;
      }
    },
    readRecordedCommand: async (database, commandId) => {
      const [row] = await database
        .select()
        .from(diaryCommands)
        .where(eq(diaryCommands.commandId, commandId))
        .limit(1);
      if (row === undefined) return null;
      return {
        commandId: row.commandId,
        outcome: row.outcome,
        statusCode: row.statusCode,
        errorCode: row.errorCode,
        bookingId: row.bookingId,
      };
    },
    createBooking: createBookingCore,
    updateBooking: updateBookingCore,
    transitionBooking: transitionBookingCore,
    serialize: serializeBooking,
    // Replay re-serialization loads the row directly by id: the ledger row
    // proves this exact actor already completed a command against it, so an
    // access re-check would only re-verify what the record establishes.
    loadBookingById: async (database, bookingId) => {
      const [row] = await database
        .select()
        .from(bookings)
        .where(eq(bookings.id, bookingId))
        .limit(1);
      return row ?? null;
    },
  };
}
