import { describe, it, expect, vi } from "vitest";
import type { DiaryCommand } from "@omnitwin/types";
import {
  executeDiaryCommand,
  type DiaryCommandDeps,
} from "../../services/diary-commands.js";
import type { MutationActor } from "../../services/booking-mutations.js";
import type { Database } from "../../db/client.js";

// ---------------------------------------------------------------------------
// Diary command dispatch (T-537; Canon §9) — tests written FIRST.
//
// executeDiaryCommand is the transport-neutral heart of the /ws/diary
// command channel: venue/role gating, atomic ledger + mutation execution,
// and replay acks for resends. The mutation cores and the ledger I/O are
// injected so every branch is unit-testable without sockets or Postgres.
// ---------------------------------------------------------------------------

const VENUE = "00000000-0000-4000-8000-00000000aaaa";
const ACTOR: MutationActor = {
  id: "00000000-0000-4000-8000-00000000bbbb",
  role: "staff",
  venueId: VENUE,
  platformRole: "none",
};

const CREATE_COMMAND: DiaryCommand = {
  kind: "booking.create",
  commandId: "00000000-0000-4000-8000-00000000cccc",
  payload: {
    venueId: VENUE,
    spaceId: "00000000-0000-4000-8000-00000000dddd",
    kind: "internal_block",
    title: "Deep clean",
    startsAt: "2026-08-01T08:00:00.000Z",
    endsAt: "2026-08-01T10:00:00.000Z",
  },
};

const BOOKING_ROW = {
  id: "00000000-0000-4000-8000-00000000eeee",
  venueId: VENUE,
} as never;

function deps(overrides: Partial<DiaryCommandDeps> = {}): DiaryCommandDeps {
  return {
    runInTransaction: vi.fn(async (work) => work({} as never)),
    recordCommand: vi.fn().mockResolvedValue("recorded"),
    readRecordedCommand: vi.fn().mockResolvedValue(null),
    createBooking: vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      booking: BOOKING_ROW,
      changeKind: "booking.created",
    }),
    updateBooking: vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      booking: BOOKING_ROW,
      changeKind: "booking.updated",
    }),
    transitionBooking: vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      booking: BOOKING_ROW,
      changeKind: "booking.transitioned",
      resequence: null,
    }),
    serialize: vi.fn().mockReturnValue({ id: BOOKING_ROW.id } as never),
    loadBookingById: vi.fn().mockResolvedValue(BOOKING_ROW),
    ...overrides,
  };
}

const DB = {} as Database;

describe("executeDiaryCommand", () => {
  it("rejects non-writing roles before touching the database", async () => {
    const d = deps();
    const result = await executeDiaryCommand(
      DB,
      { ...ACTOR, role: "hallkeeper" },
      VENUE,
      CREATE_COMMAND,
      d,
    );
    expect(result.ack.outcome).toBe("rejected");
    expect(result.ack.status).toBe(403);
    expect(result.ack.code).toBe("FORBIDDEN");
    expect(result.ack.replay).toBe(false);
    expect(d.runInTransaction).not.toHaveBeenCalled();
    expect(result.changed).toBeNull();
  });

  it("rejects a create aimed at another venue than the connection's", async () => {
    const d = deps();
    const foreign: DiaryCommand = {
      ...CREATE_COMMAND,
      payload: { ...CREATE_COMMAND.payload, venueId: "00000000-0000-4000-8000-00000000ffff" },
    };
    const result = await executeDiaryCommand(DB, ACTOR, VENUE, foreign, d);
    expect(result.ack.outcome).toBe("rejected");
    expect(result.ack.status).toBe(403);
    expect(result.ack.code).toBe("VENUE_SCOPE_MISMATCH");
    expect(d.runInTransaction).not.toHaveBeenCalled();
  });

  it("applies a create atomically: core + ledger row in ONE transaction, ack carries the booking", async () => {
    const d = deps();
    const result = await executeDiaryCommand(DB, ACTOR, VENUE, CREATE_COMMAND, d);

    expect(d.runInTransaction).toHaveBeenCalledTimes(1);
    expect(d.createBooking).toHaveBeenCalledTimes(1);
    expect(d.recordCommand).toHaveBeenCalledTimes(1);
    const recorded = (d.recordCommand as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as {
      commandId: string;
      outcome: string;
      statusCode: number;
      bookingId: string | null;
    };
    expect(recorded.commandId).toBe(CREATE_COMMAND.commandId);
    expect(recorded.outcome).toBe("applied");
    expect(recorded.statusCode).toBe(201);
    expect(recorded.bookingId).toBe(BOOKING_ROW.id);

    expect(result.ack).toMatchObject({
      type: "diary.ack",
      commandId: CREATE_COMMAND.commandId,
      outcome: "applied",
      replay: false,
      status: 201,
    });
    expect(result.ack.booking).toEqual({ id: BOOKING_ROW.id });
    expect(result.changed).toEqual({ kind: "booking.created", bookingId: BOOKING_ROW.id });
  });

  it("records rejected outcomes too — a deny is a completed command", async () => {
    const d = deps({
      createBooking: vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        code: "INK_SLOT_TAKEN",
        error: "taken",
      }),
    });
    const result = await executeDiaryCommand(DB, ACTOR, VENUE, CREATE_COMMAND, d);
    expect(result.ack).toMatchObject({ outcome: "rejected", status: 409, code: "INK_SLOT_TAKEN" });
    const recorded = (d.recordCommand as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as {
      outcome: string;
      statusCode: number;
      errorCode: string | null;
    };
    expect(recorded.outcome).toBe("rejected");
    expect(recorded.statusCode).toBe(409);
    expect(recorded.errorCode).toBe("INK_SLOT_TAKEN");
    expect(result.changed).toBeNull();
  });

  it("a resend replays the recorded outcome instead of re-executing", async () => {
    const d = deps({
      recordCommand: vi.fn().mockResolvedValue("duplicate"),
      readRecordedCommand: vi.fn().mockResolvedValue({
        commandId: CREATE_COMMAND.commandId,
        outcome: "applied",
        statusCode: 201,
        errorCode: null,
        bookingId: BOOKING_ROW.id,
      }),
    });
    const result = await executeDiaryCommand(DB, ACTOR, VENUE, CREATE_COMMAND, d);
    expect(result.ack).toMatchObject({
      outcome: "applied",
      status: 201,
      replay: true,
      commandId: CREATE_COMMAND.commandId,
    });
    // Fresh state on replays (snapshot doctrine) — loaded, not re-created.
    expect(d.loadBookingById).toHaveBeenCalledWith(DB, BOOKING_ROW.id);
    expect(result.ack.booking).toEqual({ id: BOOKING_ROW.id });
    // The mutation must NOT have run again, and nothing new to broadcast.
    expect(d.createBooking).toHaveBeenCalledTimes(1); // first (aborted) tx attempt only
    expect(result.changed).toBeNull();
  });

  it("routes update and transition commands to their cores with the bookingId", async () => {
    const d = deps();
    const update: DiaryCommand = {
      kind: "booking.update",
      commandId: "00000000-0000-4000-8000-000000000010",
      bookingId: BOOKING_ROW.id,
      payload: { title: "New title" },
    };
    const transition: DiaryCommand = {
      kind: "booking.transition",
      commandId: "00000000-0000-4000-8000-000000000011",
      bookingId: BOOKING_ROW.id,
      payload: { toState: "released" },
    };
    const u = await executeDiaryCommand(DB, ACTOR, VENUE, update, d);
    const t = await executeDiaryCommand(DB, ACTOR, VENUE, transition, d);
    expect(d.updateBooking).toHaveBeenCalledWith(expect.anything(), ACTOR, BOOKING_ROW.id, update.payload);
    expect(d.transitionBooking).toHaveBeenCalledWith(expect.anything(), ACTOR, BOOKING_ROW.id, transition.payload);
    expect(u.changed).toEqual({ kind: "booking.updated", bookingId: BOOKING_ROW.id });
    expect(t.changed).toEqual({ kind: "booking.transitioned", bookingId: BOOKING_ROW.id });
    expect(t.ack.resequence).toBeNull();
  });

  it("an unexpected throw becomes a calm rejected ack, never an unhandled rejection", async () => {
    const d = deps({
      runInTransaction: vi.fn().mockRejectedValue(new Error("connection lost")),
    });
    const result = await executeDiaryCommand(DB, ACTOR, VENUE, CREATE_COMMAND, d);
    expect(result.ack).toMatchObject({
      outcome: "rejected",
      status: 500,
      code: "COMMAND_FAILED",
      replay: false,
    });
    expect(result.changed).toBeNull();
  });
});
