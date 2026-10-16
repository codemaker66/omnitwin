import { and, asc, eq, gt, isNull, lt } from "drizzle-orm";
import {
  bookingRoomStatus,
  resolveRotaTimeZone,
  type PlatformRole,
  type RoomDay,
  type RoomDayQuery,
  type RoomDaySpan,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { bookings, events, spaces, turnaroundRules, venues } from "../db/schema.js";
import { canReadRoomDay, isClientSideRole } from "../utils/query.js";
import { resolveTurnaroundRule } from "./calendar-conflicts.js";
import { clientHoldsEventLink } from "./conversations.js";
import { isCalendarDate, venueDayWindow } from "./public-discovery.js";

// ---------------------------------------------------------------------------
// The room's day for the When ribbon (goal 19 S6; D6).
//
// Before the client's side proposes a time they see where the room is already
// spoken for, never who by: their own event's slots by name, every other
// booking in the room as an anonymous span, held or busy, decided by the same
// bookingRoomStatus the public discovery door uses. The day is the venue's
// own: 04:00 to 04:00 the next morning on the venue's clock, as the Diary
// counts it. The venue's turnaround for the room and this event's type comes
// along so the ribbon can draw the buffers.
//
// Who: the client's side (client, planner) by the live event link, re-read
// from the rows on every call so a revoked plan closes the door the same
// instant (goal 15); the venue's floor at its own venue; a platform admin.
// ---------------------------------------------------------------------------

export interface RoomDayActor {
  readonly id: string;
  readonly role: string;
  readonly venueId: string | null;
  readonly platformRole: PlatformRole;
}

export interface RoomDayDeny {
  readonly ok: false;
  readonly status: 400 | 403 | 404;
  readonly code: string;
  readonly error: string;
}

function deny(status: 400 | 403 | 404, code: string, error: string): RoomDayDeny {
  return { ok: false, status, code, error };
}

export async function loadRoomDay(
  db: Database,
  actor: RoomDayActor,
  eventId: string,
  query: RoomDayQuery,
): Promise<RoomDay | RoomDayDeny> {
  if (!isCalendarDate(query.day)) return deny(400, "INVALID_DAY", "A day is a real calendar date, YYYY-MM-DD.");

  const [context] = await db.select({
    venueId: events.venueId,
    eventType: events.eventType,
    timezone: venues.timezone,
  }).from(events)
    .innerJoin(venues, eq(venues.id, events.venueId))
    .where(and(eq(events.id, eventId), isNull(events.deletedAt), isNull(venues.deletedAt)))
    .limit(1);
  if (context === undefined) return deny(404, "EVENT_NOT_FOUND", "No such event.");

  const holdsEventLink = isClientSideRole(actor.role) ? await clientHoldsEventLink(db, actor.id, eventId) : false;
  if (!canReadRoomDay(actor, context.venueId, holdsEventLink)) {
    return deny(403, "FORBIDDEN", "Only the client's side on this event and the venue's own people read a room's day.");
  }

  const [space] = await db.select({ id: spaces.id, name: spaces.name }).from(spaces)
    .where(and(eq(spaces.id, query.spaceId), eq(spaces.venueId, context.venueId), isNull(spaces.deletedAt)))
    .limit(1);
  if (space === undefined) return deny(404, "SPACE_NOT_FOUND", "That room is not at this venue.");

  const timeZone = resolveRotaTimeZone(context.timezone);
  const { startMs, endMs } = venueDayWindow(query.day, timeZone);

  const rows = await db.select({
    id: bookings.id,
    eventId: bookings.eventId,
    kind: bookings.kind,
    status: bookings.status,
    deletedAt: bookings.deletedAt,
    title: bookings.title,
    startsAt: bookings.startsAt,
    endsAt: bookings.endsAt,
  }).from(bookings)
    .where(and(
      eq(bookings.venueId, context.venueId),
      eq(bookings.spaceId, space.id),
      eq(bookings.status, "active"),
      isNull(bookings.deletedAt),
      lt(bookings.startsAt, new Date(endMs)),
      gt(bookings.endsAt, new Date(startMs)),
    ))
    .orderBy(asc(bookings.startsAt), asc(bookings.id));

  const rules = await db.select({
    spaceId: turnaroundRules.spaceId,
    eventType: turnaroundRules.eventType,
    name: turnaroundRules.name,
    minutes: turnaroundRules.minutes,
    isActive: turnaroundRules.isActive,
  }).from(turnaroundRules)
    .where(and(
      eq(turnaroundRules.venueId, context.venueId),
      eq(turnaroundRules.isActive, true),
      isNull(turnaroundRules.deletedAt),
    ));

  const spans: RoomDaySpan[] = [];
  for (const row of rows) {
    const instants = { startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString() };
    if (row.eventId === eventId) {
      spans.push({ kind: "yours", bookingId: row.id, title: row.title, ...instants });
      continue;
    }
    const effect = bookingRoomStatus(row);
    if (effect !== null) spans.push({ kind: effect, ...instants });
  }

  const rule = resolveTurnaroundRule(rules, space.id, context.eventType);
  return {
    eventId,
    space,
    day: query.day,
    timezone: timeZone,
    range: { startsAt: new Date(startMs).toISOString(), endsAt: new Date(endMs).toISOString() },
    turnaroundMinutes: rule?.minutes ?? 0,
    spans,
  };
}
