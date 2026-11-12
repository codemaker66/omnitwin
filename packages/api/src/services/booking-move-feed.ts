import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  BOOKING_MOVE_TITLES,
  toEventPlanAudienceRole,
  type BookingMoveTitle,
  type EventPlanChangeSurface,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { eventPlanChangeAcknowledgements, eventPlanChanges, eventPlanNotifications } from "../db/schema.js";
import { recordEventPlanChange } from "./event-plan-lifecycle.js";

// ---------------------------------------------------------------------------
// A Diary move, told to the floor.
//
// Moving a booking moves the hours (and sometimes the room) the floor sets
// for. The sheet and the Day Board already follow the Diary, but a hallkeeper
// who read the day at seven had no way to see at ten that the dinner now
// starts an hour later. Each move of a booking bound to an event that is not
// over goes into that event's change feed for the floor to acknowledge once,
// beside the event edits already there (services/event-mutations.ts).
//
// A booking moved again before anyone acknowledged its last move is one
// change, not a pile: the earlier unacknowledged moves stay in the feed as
// history the floor need not acknowledge, and one change carries the place the
// floor last knew (its Was) to where the booking stands now. A move straight
// back to that place (the Diary's Undo) tells the floor nothing.
// ---------------------------------------------------------------------------

type Connection = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface BookingPlace {
  readonly spaceId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

export interface BookingMoveInput {
  readonly bookingId: string;
  readonly eventId: string;
  readonly venueId: string;
  readonly actor: { readonly id: string; readonly role: string };
  readonly before: BookingPlace;
  readonly after: BookingPlace;
  readonly now: Date;
}

function wallDay(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short" }).format(at);
}

function wallTime(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
}

/** "Sat 14 Nov, 18:00 – 23:00", naming the end's day when it is another. */
export function wallRange(place: { readonly startsAt: Date; readonly endsAt: Date }, timeZone: string): string {
  const startDay = wallDay(place.startsAt, timeZone);
  const endDay = wallDay(place.endsAt, timeZone);
  const end = wallTime(place.endsAt, timeZone);
  return `${startDay}, ${wallTime(place.startsAt, timeZone)} – ${endDay === startDay ? end : `${endDay}, ${end}`}`;
}

/** The venue's wall clock as a count of minutes, so a move across a clock
 *  change reads as the clock on the wall reads it. */
function wallMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((entry) => entry.type === type)?.value ?? "0");
  return Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute")) / 60_000;
}

/** "30 min", "1 h", "1 h 30", "2 days 1 h": how far a time moved. */
export function shiftAmount(minutesMoved: number): string {
  const minutes = Math.round(Math.abs(minutesMoved));
  const days = Math.floor(minutes / (24 * 60));
  const hours = Math.floor((minutes % (24 * 60)) / 60);
  const rest = minutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${String(days)} ${days === 1 ? "day" : "days"}`);
  if (hours > 0) parts.push(rest > 0 && days === 0 ? `${String(hours)} h ${String(rest).padStart(2, "0")}` : `${String(hours)} h`);
  if (hours === 0 && rest > 0) parts.push(`${String(rest)} min`);
  else if (days > 0 && hours > 0 && rest > 0) parts.push(`${String(rest)} min`);
  return parts.length === 0 ? "less than a minute" : parts.join(" ");
}

/** How the hours moved on the venue's clock: "30 min later", "starts 1 h earlier". */
export function shiftWords(
  before: { readonly startsAt: Date; readonly endsAt: Date },
  after: { readonly startsAt: Date; readonly endsAt: Date },
  timeZone: string,
): string {
  const start = wallMinutes(after.startsAt, timeZone) - wallMinutes(before.startsAt, timeZone);
  const end = wallMinutes(after.endsAt, timeZone) - wallMinutes(before.endsAt, timeZone);
  const way = (minutes: number): string => `${shiftAmount(minutes)} ${minutes > 0 ? "later" : "earlier"}`;
  if (start === end) return start === 0 ? "the same hours" : way(start);
  if (end === 0) return `starts ${way(start)}`;
  if (start === 0) return `ends ${way(end)}`;
  return `starts ${way(start)}, ends ${way(end)}`;
}

/** The place a booking stands, as its Was and Now read: "Grand Hall, Sat 14 Nov, 18:00 – 23:00". */
export function placeWords(room: string, place: { readonly startsAt: Date; readonly endsAt: Date }, timeZone: string): string {
  return `${room}, ${wallRange(place, timeZone)}`.slice(0, 1000);
}

/** A place's hours begin with the day: "Sat 14 Nov, ". */
const DAY_START = /^\p{L}{3} \d{1,2} \p{L}{3}, /u;

function moveTitle(timesMoved: boolean, roomMoved: boolean): BookingMoveTitle {
  return roomMoved && timesMoved ? "Room and times changed" : roomMoved ? "Room changed" : "Times moved";
}

/**
 * The words for a move: what moved, how far, and where it stood and stands
 * now (the before and after carry the exact hours, so the summary says only
 * how they moved). Pure, so the floor's wording is tested without a database.
 */
export function describeBookingMove(input: {
  readonly before: BookingPlace;
  readonly after: BookingPlace;
  readonly roomBefore: string;
  readonly roomAfter: string;
  readonly timeZone: string;
}): { readonly title: BookingMoveTitle; readonly summary: string; readonly beforeSummary: string; readonly afterSummary: string; readonly surfaces: EventPlanChangeSurface[] } {
  const timesMoved = input.before.startsAt.getTime() !== input.after.startsAt.getTime()
    || input.before.endsAt.getTime() !== input.after.endsAt.getTime();
  const roomMoved = input.before.spaceId !== input.after.spaceId;
  const summary = roomMoved
    ? `${input.roomBefore} to ${input.roomAfter}${timesMoved ? `, ${shiftWords(input.before, input.after, input.timeZone)}` : ""}.`
    : `${input.roomAfter}: ${shiftWords(input.before, input.after, input.timeZone)}.`;
  const surfaces: EventPlanChangeSurface[] = [];
  if (timesMoved) surfaces.push("timings");
  if (roomMoved) surfaces.push("layout");
  return {
    title: moveTitle(timesMoved, roomMoved),
    summary: summary.slice(0, 1000),
    beforeSummary: placeWords(input.roomBefore, input.before, input.timeZone),
    afterSummary: placeWords(input.roomAfter, input.after, input.timeZone),
    surfaces,
  };
}

const NamesSchema = z.object({
  timezone: z.string().nullable(),
  actor: z.string().nullable(),
  room_before: z.string().nullable(),
  room_after: z.string().nullable(),
});

/** The venue's clock, the mover's name and both rooms' names, in one read. */
async function moveNames(db: Connection, input: BookingMoveInput): Promise<z.infer<typeof NamesSchema>> {
  const result = await db.execute(sql`
    select
      (select v.timezone from venues v where v.id = ${input.venueId}) as timezone,
      (select coalesce(nullif(btrim(u.display_name), ''), nullif(btrim(u.name), '')) from users u where u.id = ${input.actor.id}) as actor,
      (select s.name from spaces s where s.id = ${input.before.spaceId}) as room_before,
      (select s.name from spaces s where s.id = ${input.after.spaceId}) as room_after
  `);
  return NamesSchema.parse(result.rows[0] ?? { timezone: null, actor: null, room_before: null, room_after: null });
}

/**
 * Records the move in the event's change feed, needing the floor's
 * acknowledgement, folding in any earlier move of this booking nobody has
 * acknowledged yet. A booking already over by its new end tells no one: an
 * administrative correction of history is not news to the floor. Returns
 * whether a change now waits for the floor.
 */
export async function recordBookingMove(db: Connection, input: BookingMoveInput): Promise<boolean> {
  if (input.after.endsAt.getTime() <= input.now.getTime()) return false;
  const names = await moveNames(db, input);
  const timeZone = names.timezone ?? "Europe/London";
  const roomBefore = names.room_before ?? "The room";
  const roomAfter = names.room_after ?? "The room";
  const words = describeBookingMove({ before: input.before, after: input.after, roomBefore, roomAfter, timeZone });
  if (words.surfaces.length === 0) return false;

  // This booking's earlier moves still waiting for the floor, oldest first.
  const waiting = await db.select({
    id: eventPlanChanges.id,
    title: eventPlanChanges.title,
    beforeSummary: eventPlanChanges.beforeSummary,
    affectedSurfaces: eventPlanChanges.affectedSurfaces,
  })
    .from(eventPlanChanges)
    .leftJoin(eventPlanChangeAcknowledgements, eq(eventPlanChangeAcknowledgements.changeId, eventPlanChanges.id))
    .where(and(
      eq(eventPlanChanges.eventId, input.eventId),
      eq(eventPlanChanges.sourceKind, "event"),
      eq(eventPlanChanges.sourceId, input.bookingId),
      inArray(eventPlanChanges.title, [...BOOKING_MOVE_TITLES]),
      eq(eventPlanChanges.requiresHallkeeperAcknowledgement, true),
      isNull(eventPlanChangeAcknowledgements.id),
    ))
    .orderBy(asc(eventPlanChanges.createdAt));

  let { title, summary, beforeSummary } = words;
  let surfaces = words.surfaces;
  const first = waiting[0];
  if (first !== undefined) {
    // Kept as history; the floor reads the one change below instead, and the
    // bells that announced the earlier moves go with them.
    const ids = waiting.map((change) => change.id);
    await db.update(eventPlanChanges)
      .set({ requiresHallkeeperAcknowledgement: false, riskLevel: "info" })
      .where(inArray(eventPlanChanges.id, ids));
    await db.delete(eventPlanNotifications).where(inArray(eventPlanNotifications.changeId, ids));
    const known = first.beforeSummary;
    // Straight back to where the floor last knew it: nothing to read.
    if (known !== null && known === words.afterSummary) return false;
    const hours = wallRange(input.after, timeZone);
    if (known !== null) {
      beforeSummary = known;
      // What differs between the place the floor knew and the place now.
      const sameRoom = known.startsWith(`${roomAfter}, `) && DAY_START.test(known.slice(roomAfter.length + 2));
      const sameHours = known.endsWith(`, ${hours}`);
      surfaces = [...(sameHours ? [] : ["timings" as const]), ...(sameRoom ? [] : ["layout" as const])];
      if (surfaces.length === 0) surfaces = words.surfaces;
      title = moveTitle(surfaces.includes("timings"), surfaces.includes("layout"));
    }
    summary = `${roomAfter}: now ${hours}.`.slice(0, 1000);
  }

  await recordEventPlanChange(db, {
    eventId: input.eventId,
    venueId: input.venueId,
    actorUserId: input.actor.id,
    actorRole: toEventPlanAudienceRole(input.actor.role),
    actorLabel: (names.actor ?? "The Diary").slice(0, 160),
    sourceKind: "event",
    sourceId: input.bookingId,
    title,
    summary,
    beforeSummary,
    afterSummary: words.afterSummary,
    affectedSurfaces: surfaces,
    audienceRoles: ["staff", "hallkeeper"],
    riskLevel: "attention",
    requiresHallkeeperAcknowledgement: true,
    actionPath: `/ops/events/${input.eventId}`,
  });
  return true;
}
