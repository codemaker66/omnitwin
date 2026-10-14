import { z } from "zod";
import { BookingKindSchema } from "./booking.js";
import { EventIdSchema, EventPhaseIdSchema, EventStatusSchema } from "./event-phase-graph.js";
import { ConfigurationIdSchema } from "./configuration.js";
import { SpaceIdSchema } from "./space.js";
import { TimezoneSchema, VenueIdSchema } from "./venue.js";

const ScheduleSpaceSchema = z.object({
  id: SpaceIdSchema,
  name: z.string().trim().min(1).max(200),
}).strict();

/** One slot of the client's event (goal 19 S4): the booking the house holds
 *  for it, with its room, window and commitment. The client asks the house
 *  about a slot, so this is where the request composer finds its bookingId.
 *  No notes, no ladder position, no owner, no decision date: the client reads
 *  their when, never the Diary's internals. */
export const ScheduleSlotSchema = z.object({
  bookingId: z.string().uuid(),
  kind: BookingKindSchema,
  title: z.string().trim().min(1).max(200),
  space: ScheduleSpaceSchema,
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
}).strict();
export type ClientEventScheduleSlot = z.infer<typeof ScheduleSlotSchema>;

/** A deliberately narrow shared schedule, never the internal phase graph. */
export const ClientEventScheduleSchema = z.object({
  event: z.object({
    id: EventIdSchema,
    venueId: VenueIdSchema,
    name: z.string().trim().min(1).max(200),
    eventType: z.string().trim().max(80).nullable(),
    status: EventStatusSchema,
    startsAt: z.string().datetime().nullable(),
    endsAt: z.string().datetime().nullable(),
    guestCount: z.number().int().nonnegative(),
  }).strict(),
  venue: z.object({
    id: VenueIdSchema,
    name: z.string().trim().min(1).max(200),
    timezone: TimezoneSchema,
  }).strict(),
  // Timings are live planning data. This does not assert a released or
  // approved schedule, operational readiness, or a confirmed booking.
  scheduleState: z.literal("working"),
  phases: z.array(z.object({
    id: EventPhaseIdSchema,
    name: z.string().trim().min(1).max(100),
    startsAt: z.string().datetime().nullable(),
    durationMinutes: z.number().int().nonnegative(),
    space: ScheduleSpaceSchema.nullable(),
  }).strict()),
  layouts: z.array(z.object({
    id: ConfigurationIdSchema,
    name: z.string().trim().min(1).max(200),
    space: ScheduleSpaceSchema,
  }).strict()),
  // The event's live bookings, earliest first. Empty until the house holds a
  // slot for the event; a departed booking (released, cancelled) never appears.
  slots: z.array(ScheduleSlotSchema),
}).strict().superRefine((schedule, context) => {
  if (schedule.event.venueId !== schedule.venue.id) {
    context.addIssue({ code: "custom", path: ["venue", "id"], message: "Schedule venue must match its event" });
  }
  for (const key of ["phases", "layouts"] as const) {
    const ids = schedule[key].map((row) => row.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: "custom", path: [key], message: "Schedule identities must be unique" });
    }
  }
  const bookingIds = schedule.slots.map((slot) => slot.bookingId);
  if (new Set(bookingIds).size !== bookingIds.length) {
    context.addIssue({ code: "custom", path: ["slots"], message: "Schedule identities must be unique" });
  }
});

export type ClientEventSchedule = z.infer<typeof ClientEventScheduleSchema>;

export const ClientEventScheduleQuerySchema = z.object({
  configurationId: ConfigurationIdSchema.optional(),
}).strict();
export type ClientEventScheduleQuery = z.infer<typeof ClientEventScheduleQuerySchema>;

// ---------------------------------------------------------------------------
// Proposing a window (goal 19 S6, D2). The client's side says WHEN on the
// ribbon; the house holds it as a HOLD the office decides on. One proposal
// per person per event: the same door creates the hold or moves it. Strict:
// nothing here names a rank, an owner, a decision date, a kind or a price.
// ---------------------------------------------------------------------------

export const ProposeWindowSchema = z.object({
  spaceId: SpaceIdSchema,
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  /** Minted once per gesture; a resend after a dropped answer replays. */
  idempotencyKey: z.string().uuid(),
}).strict().refine((window) => Date.parse(window.endsAt) > Date.parse(window.startsAt), {
  message: "endsAt must be after startsAt — a window occupies a real interval.",
  path: ["endsAt"],
});
export type ProposeWindow = z.infer<typeof ProposeWindowSchema>;

// ---------------------------------------------------------------------------
// The room's day as the client's side may see it (goal 19 S6; D6).
//
// Before proposing a time, a client needs to know where the room is already
// spoken for; they never learn who by. Their own event's slots come back by
// name; every other booking in the room is an anonymous span, "held" (the
// office is still deciding) or "busy" (confirmed, or the house has the room).
// The strict span schemas are the privacy pin: a title on an anonymous span
// is a schema failure, not a leak.
// ---------------------------------------------------------------------------

const RoomDayDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, "A day is YYYY-MM-DD");

export const RoomDayQuerySchema = z.object({
  spaceId: SpaceIdSchema,
  day: RoomDayDateSchema,
}).strict();
export type RoomDayQuery = z.infer<typeof RoomDayQuerySchema>;

const RoomDayInstants = { startsAt: z.string().datetime(), endsAt: z.string().datetime() };

export const RoomDaySpanSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("yours"),
    bookingId: z.string().uuid(),
    title: z.string().trim().min(1).max(200),
    ...RoomDayInstants,
  }).strict(),
  z.object({ kind: z.literal("held"), ...RoomDayInstants }).strict(),
  z.object({ kind: z.literal("busy"), ...RoomDayInstants }).strict(),
]);
export type RoomDaySpan = z.infer<typeof RoomDaySpanSchema>;

export const RoomDaySchema = z.object({
  eventId: EventIdSchema,
  space: ScheduleSpaceSchema,
  day: RoomDayDateSchema,
  timezone: TimezoneSchema,
  /** The instants the venue's day covers: 04:00 to 04:00 the next morning on the venue's clock. */
  range: z.object(RoomDayInstants).strict(),
  /** The venue's turnaround for this room and the event's type, in minutes; drawn as the buffers. */
  turnaroundMinutes: z.number().int().min(0).max(1440),
  spans: z.array(RoomDaySpanSchema),
}).strict();
export type RoomDay = z.infer<typeof RoomDaySchema>;
