import { z } from "zod";
import { EventIdSchema, EventPhaseIdSchema, EventStatusSchema } from "./event-phase-graph.js";
import { ConfigurationIdSchema } from "./configuration.js";
import { SpaceIdSchema } from "./space.js";
import { TimezoneSchema, VenueIdSchema } from "./venue.js";

const ScheduleSpaceSchema = z.object({
  id: SpaceIdSchema,
  name: z.string().trim().min(1).max(200),
}).strict();

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
});

export type ClientEventSchedule = z.infer<typeof ClientEventScheduleSchema>;

export const ClientEventScheduleQuerySchema = z.object({
  configurationId: ConfigurationIdSchema.optional(),
}).strict();
export type ClientEventScheduleQuery = z.infer<typeof ClientEventScheduleQuerySchema>;
