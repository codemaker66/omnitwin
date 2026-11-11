import { eq, inArray } from "drizzle-orm";
import { toEventPlanAudienceRole, type EventPlanChangeSurface } from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { spaces, users, venues } from "../db/schema.js";
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

/** "30 min", "1 h", "1 h 30", "2 days 1 h": how far a time moved. */
export function shiftAmount(ms: number): string {
  const minutes = Math.round(Math.abs(ms) / 60_000);
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

/** How the hours moved, in words: "30 min later", "starts an hour earlier". */
export function shiftWords(before: { readonly startsAt: Date; readonly endsAt: Date }, after: { readonly startsAt: Date; readonly endsAt: Date }): string {
  const start = after.startsAt.getTime() - before.startsAt.getTime();
  const end = after.endsAt.getTime() - before.endsAt.getTime();
  const way = (ms: number): string => `${shiftAmount(ms)} ${ms > 0 ? "later" : "earlier"}`;
  if (start === end) return way(start);
  if (end === 0) return `starts ${way(start)}`;
  if (start === 0) return `ends ${way(end)}`;
  return `starts ${way(start)}, ends ${way(end)}`;
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
}): { readonly title: string; readonly summary: string; readonly beforeSummary: string; readonly afterSummary: string; readonly surfaces: EventPlanChangeSurface[] } {
  const timesMoved = input.before.startsAt.getTime() !== input.after.startsAt.getTime()
    || input.before.endsAt.getTime() !== input.after.endsAt.getTime();
  const roomMoved = input.before.spaceId !== input.after.spaceId;
  const was = wallRange(input.before, input.timeZone);
  const now = wallRange(input.after, input.timeZone);
  const title = roomMoved && timesMoved ? "Room and times changed" : roomMoved ? "Room changed" : "Times moved";
  const summary = roomMoved
    ? `${input.roomBefore} to ${input.roomAfter}${timesMoved ? `, ${shiftWords(input.before, input.after)}` : ""}.`
    : `${input.roomAfter}: ${shiftWords(input.before, input.after)}.`;
  const surfaces: EventPlanChangeSurface[] = [];
  if (timesMoved) surfaces.push("timings");
  if (roomMoved) surfaces.push("layout");
  return {
    title,
    summary: summary.slice(0, 1000),
    beforeSummary: `${input.roomBefore}, ${was}`.slice(0, 1000),
    afterSummary: `${input.roomAfter}, ${now}`.slice(0, 1000),
    surfaces,
  };
}

/**
 * Records the move in the event's change feed, needing the floor's
 * acknowledgement. A booking already over by its new end tells no one: an
 * administrative correction of history is not news to the floor.
 */
export async function recordBookingMove(db: Connection, input: BookingMoveInput): Promise<boolean> {
  if (input.after.endsAt.getTime() <= input.now.getTime()) return false;
  const [venue] = await db.select({ timezone: venues.timezone }).from(venues).where(eq(venues.id, input.venueId)).limit(1);
  const rooms = await db.select({ id: spaces.id, name: spaces.name }).from(spaces)
    .where(inArray(spaces.id, [...new Set([input.before.spaceId, input.after.spaceId])]));
  const roomName = (id: string): string => rooms.find((room) => room.id === id)?.name ?? "The room";
  const [actor] = await db.select({ name: users.name, displayName: users.displayName }).from(users)
    .where(eq(users.id, input.actor.id)).limit(1);
  const actorLabel = ((actor?.displayName ?? "").trim() || (actor?.name ?? "").trim() || "The Diary").slice(0, 160);
  const words = describeBookingMove({
    before: input.before,
    after: input.after,
    roomBefore: roomName(input.before.spaceId),
    roomAfter: roomName(input.after.spaceId),
    timeZone: venue?.timezone ?? "Europe/London",
  });
  if (words.surfaces.length === 0) return false;
  await recordEventPlanChange(db, {
    eventId: input.eventId,
    venueId: input.venueId,
    actorUserId: input.actor.id,
    actorRole: toEventPlanAudienceRole(input.actor.role),
    actorLabel,
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
  });
  return true;
}
