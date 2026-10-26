import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import type { ClientEventScheduleSlot, PlatformRole, ProposeWindow } from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { bookings, diaryCommands, events, spaces, users } from "../db/schema.js";
import { canProposeWindow, isClientSideRole } from "../utils/query.js";
import { canWriteBookings, ownerWorksAtVenue, PG_UNIQUE_VIOLATION } from "./booking-mutations.js";
import { clientHoldsEventLink } from "./conversations.js";
import { movePhasesWithBooking, syncEventStatus } from "./event-binding.js";

// ---------------------------------------------------------------------------
// Proposing a window (goal 19 S6; D1, D2, D5).
//
// The client says WHEN on the ribbon and the house holds it: a HOLD on the
// Diary ladder, linked to the event, owned by the office, carrying the hygiene
// every hold carries (a decision date, an owner, a next action and its due
// date). Nothing here inks: the office decides on the Diary, and inking the
// hold is the approval. One proposal per person per event, so the same door
// creates the hold or moves it; a window the office has inked is no longer
// the proposer's to move.
//
// Who: the client's side (client, planner) by the live event link, re-read
// from the rows on every call so a revoked plan closes the door the same
// instant (goal 15); the office (staff, admin) at its venue; nobody else.
//
// Idempotency: the diary_commands ledger, keyed by the gesture's
// idempotencyKey, with the venue taken from the event because the client has
// none. A replayed key answers the recorded outcome and never writes twice.
// ---------------------------------------------------------------------------

export interface ProposalActor {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly venueId: string | null;
  readonly platformRole: PlatformRole;
}

export interface ProposalDeny {
  readonly ok: false;
  readonly status: number;
  readonly code: string;
  readonly error: string;
}

export interface ProposalOk {
  readonly ok: true;
  readonly status: 200 | 201;
  readonly replay: boolean;
  readonly venueId: string;
  readonly changeKind: "booking.created" | "booking.updated";
  readonly slot: ClientEventScheduleSlot;
}

/** The database or the transaction the booking helpers already accept. */
type Conn = Parameters<typeof ownerWorksAtVenue>[0];
type BookingRow = typeof bookings.$inferSelect;

const COMMAND_KIND = "window.propose";
const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

function deny(status: number, code: string, error: string): ProposalDeny {
  return { ok: false, status, code, error };
}

function slotOf(row: BookingRow, space: { readonly id: string; readonly name: string }): ClientEventScheduleSlot {
  return {
    bookingId: row.id,
    kind: row.kind,
    title: row.title,
    space: { id: space.id, name: space.name },
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
  };
}

/** The office account that owns a proposed hold: the event's creator when
 *  they still work the Diary at the venue, else the venue's longest-standing
 *  admin, else its longest-standing staff member. */
async function officeOwnerFor(conn: Conn, venueId: string, createdBy: string | null): Promise<string | null> {
  if (createdBy !== null && (await ownerWorksAtVenue(conn, createdBy, venueId))) return createdBy;
  for (const role of ["admin", "staff"]) {
    const [owner] = await conn.select({ id: users.id }).from(users)
      .where(and(eq(users.venueId, venueId), eq(users.role, role))).orderBy(users.createdAt).limit(1);
    if (owner !== undefined) return owner.id;
  }
  return null;
}

/** The next free rung of the ladder the window lands on. Holds never
 *  conflict at the database; the ladder orders them. */
async function nextRank(conn: Conn, spaceId: string, startsAt: Date, endsAt: Date, except: string | null): Promise<number> {
  const [top] = await conn.select({ rank: sql<number | null>`max(${bookings.rank})` }).from(bookings)
    .where(and(
      eq(bookings.spaceId, spaceId), eq(bookings.kind, "hold"), eq(bookings.status, "active"), isNull(bookings.deletedAt),
      lt(bookings.startsAt, endsAt), gt(bookings.endsAt, startsAt),
      ...(except === null ? [] : [sql`${bookings.id} <> ${except}`]),
    ));
  return (top?.rank ?? 0) + 1;
}

/** A decision date before the window and never in the past: a day before
 *  doors, at most a week from now, at least an hour from now. */
function decisionDateFor(startsAt: Date, now: Date): Date {
  const latest = startsAt.getTime() - 60_000;
  const preferred = Math.min(startsAt.getTime() - DAY_MS, now.getTime() + 7 * DAY_MS);
  return new Date(Math.min(latest, Math.max(now.getTime() + HOUR_MS, preferred)));
}

async function readSlot(conn: Conn, bookingId: string): Promise<ClientEventScheduleSlot | null> {
  const [found] = await conn.select({ booking: bookings, spaceId: spaces.id, spaceName: spaces.name }).from(bookings)
    .innerJoin(spaces, eq(spaces.id, bookings.spaceId))
    .where(and(eq(bookings.id, bookingId), isNull(bookings.deletedAt))).limit(1);
  if (found === undefined) return null;
  return slotOf(found.booking, { id: found.spaceId, name: found.spaceName });
}

export async function proposeWindowCore(
  db: Database,
  actor: ProposalActor,
  eventId: string,
  input: ProposeWindow,
  now: Date = new Date(),
): Promise<ProposalOk | ProposalDeny> {
  const [eventRow] = await db
    .select({ id: events.id, venueId: events.venueId, name: events.name, eventType: events.eventType, createdBy: events.createdBy })
    .from(events).where(and(eq(events.id, eventId), isNull(events.deletedAt))).limit(1);
  if (eventRow === undefined) return deny(404, "EVENT_NOT_FOUND", "That event does not exist.");

  const holdsEventLink = isClientSideRole(actor.role) ? await clientHoldsEventLink(db, actor.id, eventId) : false;
  if (!canProposeWindow(actor, eventRow.venueId, holdsEventLink)) {
    return deny(403, "FORBIDDEN", "This event is not linked to your account.");
  }

  // The ledger first: a replayed gesture answers what it answered before.
  const [recorded] = await db.select().from(diaryCommands).where(eq(diaryCommands.commandId, input.idempotencyKey)).limit(1);
  if (recorded !== undefined) {
    if (recorded.userId !== actor.id || recorded.kind !== COMMAND_KIND) {
      return deny(409, "IDEMPOTENCY_KEY_REUSED", "That key was already used for something else.");
    }
    if (recorded.outcome !== "applied" || recorded.bookingId === null) {
      return deny(recorded.statusCode, recorded.errorCode ?? "REJECTED", "That proposal was refused before.");
    }
    const replayed = await readSlot(db, recorded.bookingId);
    if (replayed === null) return deny(404, "BOOKING_NOT_FOUND", "That proposal no longer exists.");
    return { ok: true, status: 200, replay: true, venueId: eventRow.venueId, changeKind: "booking.updated", slot: replayed };
  }

  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  if (endsAt.getTime() <= now.getTime()) return deny(400, "WINDOW_PAST", "That time has already passed.");
  const [space] = await db.select({ id: spaces.id, name: spaces.name, venueId: spaces.venueId }).from(spaces)
    .where(and(eq(spaces.id, input.spaceId), isNull(spaces.deletedAt))).limit(1);
  if (space === undefined || space.venueId !== eventRow.venueId) {
    return deny(400, "SPACE_VENUE_MISMATCH", "That room is not at this venue.");
  }

  // One proposal per person per event: move the live one, or make the first.
  const [mine] = await db.select().from(bookings)
    .where(and(eq(bookings.eventId, eventId), eq(bookings.createdBy, actor.id), eq(bookings.status, "active"), isNull(bookings.deletedAt)))
    .orderBy(desc(bookings.createdAt)).limit(1);
  if (mine !== undefined && mine.kind !== "hold") {
    return deny(409, "WINDOW_DECIDED", "The office has confirmed this time; ask them to move it.");
  }

  return db.transaction(async (tx): Promise<ProposalOk | ProposalDeny> => {
    let row: BookingRow | undefined;
    let changeKind: ProposalOk["changeKind"];
    if (mine !== undefined) {
      const unchanged = mine.spaceId === space.id && mine.startsAt.getTime() === startsAt.getTime() && mine.endsAt.getTime() === endsAt.getTime();
      const rank = unchanged ? mine.rank : await nextRank(tx, space.id, startsAt, endsAt, mine.id);
      [row] = await tx.update(bookings)
        .set({ spaceId: space.id, startsAt, endsAt, rank, updatedAt: now })
        .where(and(eq(bookings.id, mine.id), eq(bookings.kind, "hold"), eq(bookings.status, "active")))
        .returning();
      if (row === undefined) return deny(409, "WINDOW_DECIDED", "The office has confirmed this time; ask them to move it.");
      changeKind = "booking.updated";
      // A moved proposal reaches its event as a Diary move does: its phases
      // on the day follow it, and the event's dates follow its bookings.
      if (!unchanged) {
        await movePhasesWithBooking(tx, {
          bookingId: mine.id,
          eventId,
          from: { spaceId: mine.spaceId, startsAt: mine.startsAt, endsAt: mine.endsAt },
          to: { spaceId: space.id, startsAt },
        });
        await syncEventStatus(tx, eventId);
      }
    } else {
      // The office owns its own proposal, as it owns a hold it pencils on the
      // Diary; a client's proposal is owned by the office on their behalf.
      const ownerUserId = canWriteBookings(actor, eventRow.venueId) ? actor.id : await officeOwnerFor(tx, eventRow.venueId, eventRow.createdBy);
      if (ownerUserId === null) return deny(409, "NO_OFFICE_OWNER", "The venue has no office account to own a proposal.");
      const decisionAt = decisionDateFor(startsAt, now);
      [row] = await tx.insert(bookings).values({
        venueId: eventRow.venueId, spaceId: space.id, eventId, kind: "hold", status: "active",
        title: eventRow.name, eventType: eventRow.eventType, startsAt, endsAt,
        rank: await nextRank(tx, space.id, startsAt, endsAt, null),
        jointFlag: false, decisionAt, ownerUserId,
        nextAction: `Decide ${actor.name}'s proposed time for ${eventRow.name}`.slice(0, 500),
        nextActionDueAt: decisionAt, createdBy: actor.id,
      }).returning();
      if (row === undefined) return deny(500, "BOOKING_CREATE_FAILED", "The proposal could not be kept.");
      changeKind = "booking.created";
      // The bind: the hold names its event, and the event's status follows
      // its bookings (a lost event held again is a draft once more).
      await syncEventStatus(tx, eventId);
    }
    try {
      await tx.insert(diaryCommands).values({
        commandId: input.idempotencyKey, venueId: eventRow.venueId, userId: actor.id, kind: COMMAND_KIND,
        bookingId: row.id, outcome: "applied", statusCode: changeKind === "booking.created" ? 201 : 200, errorCode: null,
      });
    } catch (error) {
      if ((error as { readonly code?: string }).code === PG_UNIQUE_VIOLATION) {
        return deny(409, "IDEMPOTENCY_KEY_REUSED", "That key was already used for something else.");
      }
      throw error;
    }
    return { ok: true, status: changeKind === "booking.created" ? 201 : 200, replay: false, venueId: eventRow.venueId, changeKind, slot: slotOf(row, space) };
  });
}
