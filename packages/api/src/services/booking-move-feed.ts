import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, notExists, sql } from "drizzle-orm";
import { z } from "zod";
import {
  toEventPlanAudienceRole,
  type BookingMoveTitle,
  type EventPlanChangeSurface,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import {
  eventPlanChangeAcknowledgements,
  eventPlanChanges,
  eventPlanNotificationReads,
  eventPlanNotifications,
  spaces,
} from "../db/schema.js";
import { recordEventPlanChange } from "./event-plan-lifecycle.js";

// ---------------------------------------------------------------------------
// A Diary move, told to the floor.
//
// Moving a booking moves the hours (and sometimes the room) the floor sets
// for. The sheet and the Day Board already follow the Diary, but a hallkeeper
// who read the day at seven had no way to see at ten that the dinner now
// starts an hour later. Each move of a booking bound to an event goes into
// that event's change feed for the floor to acknowledge once, beside the event
// edits already there (services/event-mutations.ts).
//
// A booking moved again before anyone acknowledged its last move is one
// change, not a pile: the earlier unacknowledged moves stay in the feed as
// history the floor need not acknowledge, and one change carries the place the
// floor last knew (its Was) to where the booking stands now. Every change
// keeps its places as data (the room's id and the instants; migration
// floor_change_move_places), so the next move is compared with them, never
// with its words read back.
//
// A move straight back to the place the floor last knew is the Diary's Undo,
// and tells the floor nothing, only while it is quick (QUIET_UNDO_MS) and
// nobody has opened a bell of the moves it takes back. Otherwise the floor may
// have acted on the move away, and is told the booking is back.
// ---------------------------------------------------------------------------

type Connection = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface BookingPlace {
  readonly spaceId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

export interface BookingMoveInput {
  readonly bookingId: string;
  /** The event the booking is bound to now, which the floor reads it on. */
  readonly eventId: string;
  readonly venueId: string;
  readonly actor: { readonly id: string; readonly role: string };
  readonly before: BookingPlace;
  readonly after: BookingPlace;
  readonly now: Date;
}

/**
 * How soon a move straight back may follow the run of moves it takes back
 * and still tell the floor nothing, provided nobody has opened a bell of
 * them. The Diary's Undo toast stands for seven seconds and its Ctrl+Z takes a
 * move back at any time; two minutes covers the toast and a quick Ctrl+Z.
 * Later than this, the floor may already have acted on the move away.
 */
export const QUIET_UNDO_MS = 2 * 60_000;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

function wallDay(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short" }).format(at);
}

/** The venue's wall clock as a count of minutes, so a move across a clock
 *  change reads as the clock on the wall reads it. */
function wallMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((entry) => entry.type === type)?.value ?? "0");
  return Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute")) / MINUTE_MS;
}

/** The venue's offset from UTC at an instant, in minutes. */
function offsetMinutes(at: Date, timeZone: string): number {
  return wallMinutes(at, timeZone) - Math.floor(at.getTime() / MINUTE_MS);
}

/**
 * Whether the venue's clock shows this time twice that night: the hour the
 * clocks go back, when 01:30 comes once in summer time and again in winter
 * time. The time alone does not say which, so the words name the zone.
 */
export function isRepeatedWallTime(at: Date, timeZone: string): boolean {
  const here = offsetMinutes(at, timeZone);
  for (const probe of [-6 * HOUR_MS, 6 * HOUR_MS]) {
    const there = offsetMinutes(new Date(at.getTime() + probe), timeZone);
    if (there === here) continue;
    // The same clock reading in the other offset, if the clock passes it.
    const twin = new Date(at.getTime() + (here - there) * MINUTE_MS);
    if (wallMinutes(twin, timeZone) === wallMinutes(at, timeZone)) return true;
  }
  return false;
}

/** The zone's short name at an instant: "BST", "GMT", or an offset ("GMT+2"). */
function zoneName(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "short" }).formatToParts(at)
    .find((part) => part.type === "timeZoneName")?.value ?? "";
}

/** "18:00", or "01:30 BST" for a time the clocks show twice that night. */
function wallTime(at: Date, timeZone: string): string {
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
  const zone = isRepeatedWallTime(at, timeZone) ? zoneName(at, timeZone) : "";
  return zone === "" ? time : `${time} ${zone}`;
}

/** "Sat 14 Nov, 18:00 – 23:00", naming the end's day when it is another. */
export function wallRange(place: { readonly startsAt: Date; readonly endsAt: Date }, timeZone: string): string {
  const startDay = wallDay(place.startsAt, timeZone);
  const endDay = wallDay(place.endsAt, timeZone);
  const end = wallTime(place.endsAt, timeZone);
  return `${startDay}, ${wallTime(place.startsAt, timeZone)} – ${endDay === startDay ? end : `${endDay}, ${end}`}`;
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

/**
 * Minutes from one time to another as the venue's clock reads them, so a
 * move across a clock change reads as the wall does ("1 day later", not
 * "1 day 1 h later"). Where either time is one the clocks show twice, the
 * wall cannot tell how far it moved, so the real minutes are counted.
 */
function minutesMoved(from: Date, to: Date, timeZone: string): number {
  if (isRepeatedWallTime(from, timeZone) || isRepeatedWallTime(to, timeZone)) return (to.getTime() - from.getTime()) / MINUTE_MS;
  return wallMinutes(to, timeZone) - wallMinutes(from, timeZone);
}

/** How the hours moved on the venue's clock: "30 min later", "starts 1 h earlier". */
export function shiftWords(
  before: { readonly startsAt: Date; readonly endsAt: Date },
  after: { readonly startsAt: Date; readonly endsAt: Date },
  timeZone: string,
): string {
  const start = minutesMoved(before.startsAt, after.startsAt, timeZone);
  const end = minutesMoved(before.endsAt, after.endsAt, timeZone);
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

/** The same room (by id) at the same instants. */
export function samePlace(a: BookingPlace, b: BookingPlace): boolean {
  return a.spaceId === b.spaceId && a.startsAt.getTime() === b.startsAt.getTime() && a.endsAt.getTime() === b.endsAt.getTime();
}

/** What differs between two places: the hours by instant, the room by id. */
function differences(from: BookingPlace, to: BookingPlace): { readonly times: boolean; readonly room: boolean; readonly surfaces: EventPlanChangeSurface[] } {
  const times = from.startsAt.getTime() !== to.startsAt.getTime() || from.endsAt.getTime() !== to.endsAt.getTime();
  const room = from.spaceId !== to.spaceId;
  return { times, room, surfaces: [...(times ? ["timings" as const] : []), ...(room ? ["layout" as const] : [])] };
}

function moveTitle(times: boolean, room: boolean): BookingMoveTitle {
  return room && times ? "Room and times changed" : room ? "Room changed" : "Times moved";
}

function backTitle(times: boolean, room: boolean): BookingMoveTitle {
  return room && times ? "Back to the original room and hours" : room ? "Back to the original room" : "Back to the original hours";
}

export interface MoveWords {
  readonly title: BookingMoveTitle;
  readonly summary: string;
  readonly beforeSummary: string;
  readonly afterSummary: string;
  readonly surfaces: EventPlanChangeSurface[];
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
}): MoveWords {
  const what = differences(input.before, input.after);
  const summary = what.room
    ? `${input.roomBefore} to ${input.roomAfter}${what.times ? `, ${shiftWords(input.before, input.after, input.timeZone)}` : ""}.`
    : `${input.roomAfter}: ${shiftWords(input.before, input.after, input.timeZone)}.`;
  return {
    title: moveTitle(what.times, what.room),
    summary: summary.slice(0, 1000),
    beforeSummary: placeWords(input.roomBefore, input.before, input.timeZone),
    afterSummary: placeWords(input.roomAfter, input.after, input.timeZone),
    surfaces: what.surfaces,
  };
}

/**
 * The words for moves folded into one: from the place the floor last knew to
 * where the booking stands now, the room compared by id and the hours by
 * instant. Both places are named as their rooms are called now, so a room
 * renamed between two moves reads as the one room it is.
 */
export function describeFoldedMove(input: {
  readonly known: BookingPlace;
  readonly after: BookingPlace;
  readonly roomKnown: string;
  readonly roomAfter: string;
  readonly timeZone: string;
}): MoveWords {
  const what = differences(input.known, input.after);
  return {
    title: moveTitle(what.times, what.room),
    summary: `${input.roomAfter}: now ${wallRange(input.after, input.timeZone)}.`.slice(0, 1000),
    beforeSummary: placeWords(input.roomKnown, input.known, input.timeZone),
    afterSummary: placeWords(input.roomAfter, input.after, input.timeZone),
    surfaces: what.surfaces,
  };
}

/**
 * The words for a move straight back to the place the floor last knew, told
 * because the floor may have acted on the move away: Was is the place given
 * up, Now the original.
 */
export function describeMoveBack(input: {
  readonly before: BookingPlace;
  readonly after: BookingPlace;
  readonly roomBefore: string;
  readonly roomAfter: string;
  readonly timeZone: string;
}): MoveWords {
  const what = differences(input.before, input.after);
  return {
    title: backTitle(what.times, what.room),
    summary: `${input.roomAfter}: back to ${wallRange(input.after, input.timeZone)}.`.slice(0, 1000),
    beforeSummary: placeWords(input.roomBefore, input.before, input.timeZone),
    afterSummary: placeWords(input.roomAfter, input.after, input.timeZone),
    surfaces: what.surfaces,
  };
}

const NamesSchema = z.object({
  timezone: z.string().nullable(),
  actor: z.string().nullable(),
});

/** The venue's clock, the mover's name and the rooms' names as they are called now. */
async function moveNames(db: Connection, input: BookingMoveInput, spaceIds: readonly string[]): Promise<{
  readonly timeZone: string;
  readonly actor: string | null;
  readonly room: (spaceId: string) => string;
}> {
  const result = await db.execute(sql`
    select
      (select v.timezone from venues v where v.id = ${input.venueId}) as timezone,
      (select coalesce(nullif(btrim(u.display_name), ''), nullif(btrim(u.name), '')) from users u where u.id = ${input.actor.id}) as actor
  `);
  const names = NamesSchema.parse(result.rows[0] ?? { timezone: null, actor: null });
  const rooms = await db.select({ id: spaces.id, name: spaces.name }).from(spaces).where(inArray(spaces.id, [...new Set(spaceIds)]));
  const byId = new Map(rooms.map((room) => [room.id, room.name]));
  return { timeZone: names.timezone ?? "Europe/London", actor: names.actor, room: (spaceId) => byId.get(spaceId) ?? "The room" };
}

/** A stored place, whole, or null (the table's CHECK keeps the parts together). */
function storedPlace(spaceId: string | null, startsAt: Date | null, endsAt: Date | null): BookingPlace | null {
  return spaceId === null || startsAt === null || endsAt === null ? null : { spaceId, startsAt, endsAt };
}

/**
 * Whether a move back is the Diary's quick Undo: the run of moves it takes
 * back began within QUIET_UNDO_MS, and nobody has opened a bell of any of
 * them. The run's bells are held first, so a read being written now lands
 * before the look, and none can start until this commits.
 */
async function quietUndo(db: Connection, input: BookingMoveInput, chainIds: readonly string[]): Promise<boolean> {
  const run = await db.select({ id: eventPlanChanges.id, createdAt: eventPlanChanges.createdAt })
    .from(eventPlanChanges)
    .where(and(
      eq(eventPlanChanges.venueId, input.venueId),
      eq(eventPlanChanges.sourceId, input.bookingId),
      inArray(eventPlanChanges.moveChainId, [...chainIds]),
    ));
  if (run.length === 0) return false;
  const began = Math.min(...run.map((change) => change.createdAt.getTime()));
  if (input.now.getTime() - began > QUIET_UNDO_MS) return false;
  const bells = await db.select({ id: eventPlanNotifications.id })
    .from(eventPlanNotifications)
    .where(inArray(eventPlanNotifications.changeId, run.map((change) => change.id)))
    .for("update");
  if (bells.length === 0) return true;
  const [read] = await db.select({ id: eventPlanNotificationReads.id })
    .from(eventPlanNotificationReads)
    .where(inArray(eventPlanNotificationReads.notificationId, bells.map((bell) => bell.id)))
    .limit(1);
  return read === undefined;
}

/**
 * Takes away the bells of replaced moves that nobody has opened: what they
 * announced is no longer true, and the change that replaced them (if any)
 * rings its own. A bell someone has opened stays, with its reads, as the
 * record that they read it. Held first, as in quietUndo.
 */
async function dropUnreadBells(db: Connection, changeIds: readonly string[]): Promise<void> {
  if (changeIds.length === 0) return;
  const bells = await db.select({ id: eventPlanNotifications.id })
    .from(eventPlanNotifications)
    .where(inArray(eventPlanNotifications.changeId, [...changeIds]))
    .for("update");
  if (bells.length === 0) return;
  await db.delete(eventPlanNotifications).where(and(
    inArray(eventPlanNotifications.id, bells.map((bell) => bell.id)),
    notExists(db.select({ id: eventPlanNotificationReads.id })
      .from(eventPlanNotificationReads)
      .where(eq(eventPlanNotificationReads.notificationId, eventPlanNotifications.id))),
  ));
}

/**
 * Records the move in the event's change feed, needing the floor's
 * acknowledgement, folding in any earlier move of this booking nobody has
 * acknowledged yet (on whichever event it was told). A booking already over
 * by its new end tells no one: an administrative correction of history is not
 * news to the floor; nor does a quick Undo nobody has read of. Either way the
 * moves it replaces leave the floor's list. Returns whether a change now
 * waits for the floor.
 *
 * Runs inside the move's own transaction, after the booking's row is locked,
 * so two moves of one booking fold one after the other.
 */
export async function recordBookingMove(db: Connection, input: BookingMoveInput): Promise<boolean> {
  if (samePlace(input.before, input.after)) return false;

  // This booking's moves still waiting for the floor, oldest first, held: a
  // Got it racing this move either commits first (and is seen just below) or
  // waits for this to commit and finds its change replaced.
  const candidates = await db.select({
    id: eventPlanChanges.id,
    chainId: eventPlanChanges.moveChainId,
    knownSpaceId: eventPlanChanges.moveKnownSpaceId,
    knownStartsAt: eventPlanChanges.moveKnownStartsAt,
    knownEndsAt: eventPlanChanges.moveKnownEndsAt,
  })
    .from(eventPlanChanges)
    .where(and(
      eq(eventPlanChanges.venueId, input.venueId),
      eq(eventPlanChanges.sourceKind, "event"),
      eq(eventPlanChanges.sourceId, input.bookingId),
      isNotNull(eventPlanChanges.moveChainId),
      eq(eventPlanChanges.requiresHallkeeperAcknowledgement, true),
    ))
    .orderBy(asc(eventPlanChanges.createdAt), asc(eventPlanChanges.id))
    .for("update");
  // Its own statement, after the lock: an acknowledgement that committed while
  // this waited is read here.
  const acknowledged = candidates.length === 0
    ? new Set<string>()
    : new Set((await db.select({ changeId: eventPlanChangeAcknowledgements.changeId })
      .from(eventPlanChangeAcknowledgements)
      .where(inArray(eventPlanChangeAcknowledgements.changeId, candidates.map((change) => change.id))))
      .map((row) => row.changeId));
  const waiting = candidates.flatMap((change) => {
    const known = storedPlace(change.knownSpaceId, change.knownStartsAt, change.knownEndsAt);
    return acknowledged.has(change.id) || change.chainId === null || known === null
      ? []
      : [{ id: change.id, chainId: change.chainId, known }];
  });

  const first = waiting[0];
  // Where the floor last knew the booking, and the run this move joins.
  const known = first?.known ?? input.before;
  const chainId = first?.chainId ?? randomUUID();
  const replaced = waiting.map((change) => change.id);
  if (replaced.length > 0) {
    // Kept in the feed as history; the floor reads one change instead.
    await db.update(eventPlanChanges)
      .set({ requiresHallkeeperAcknowledgement: false, riskLevel: "info" })
      .where(inArray(eventPlanChanges.id, replaced));
  }

  const back = first !== undefined && samePlace(known, input.after);
  if (input.after.endsAt.getTime() <= input.now.getTime()
    || (back && await quietUndo(db, input, [...new Set(waiting.map((change) => change.chainId))]))) {
    await dropUnreadBells(db, replaced);
    return false;
  }

  const names = await moveNames(db, input, [known.spaceId, input.before.spaceId, input.after.spaceId]);
  const roomBefore = names.room(input.before.spaceId);
  const roomAfter = names.room(input.after.spaceId);
  const words = back
    ? describeMoveBack({ before: input.before, after: input.after, roomBefore, roomAfter, timeZone: names.timeZone })
    : first !== undefined
      ? describeFoldedMove({ known, after: input.after, roomKnown: names.room(known.spaceId), roomAfter, timeZone: names.timeZone })
      : describeBookingMove({ before: input.before, after: input.after, roomBefore, roomAfter, timeZone: names.timeZone });

  await recordEventPlanChange(db, {
    eventId: input.eventId,
    venueId: input.venueId,
    actorUserId: input.actor.id,
    actorRole: toEventPlanAudienceRole(input.actor.role),
    actorLabel: (names.actor ?? "The Diary").slice(0, 160),
    sourceKind: "event",
    sourceId: input.bookingId,
    title: words.title,
    summary: words.summary,
    beforeSummary: words.beforeSummary,
    afterSummary: words.afterSummary,
    affectedSurfaces: words.surfaces,
    audienceRoles: ["staff", "hallkeeper"],
    riskLevel: "attention",
    requiresHallkeeperAcknowledgement: true,
    actionPath: `/ops/events/${input.eventId}`,
    bookingMove: { known, to: input.after, chainId },
  });
  await dropUnreadBells(db, replaced);
  return true;
}
