import { z } from "zod";
import { EventIdSchema } from "./event-phase-graph.js";
import { ConfigurationIdSchema } from "./configuration.js";
import { SpaceIdSchema } from "./space.js";
import { TimezoneSchema, VenueIdSchema } from "./venue.js";

// ---------------------------------------------------------------------------
// The client's own home (fix-first 12, 17 October 2026).
//
// A client or planner signs in to their own work: the events the venue has
// linked them to, and the room plans they have saved. Every row is theirs.
// An event appears only while they hold a live link to it, by the same rule
// the event page reads (services/client-event-schedule.ts), so each card here
// opens. Nothing internal travels: no notes, no client label, no status word
// the venue keeps for itself, no other person's plan.
// ---------------------------------------------------------------------------

const HomeVenueSchema = z.object({
  id: VenueIdSchema,
  name: z.string().trim().min(1).max(200),
}).strict();

export const ClientHomeEventSchema = z.object({
  id: EventIdSchema,
  name: z.string().trim().min(1).max(200),
  eventType: z.string().trim().max(80).nullable(),
  startsAt: z.iso.datetime().nullable(),
  endsAt: z.iso.datetime().nullable(),
  guestCount: z.number().int().nonnegative(),
  venue: HomeVenueSchema.extend({ timezone: TimezoneSchema }).strict(),
  /** How many of this person's own saved layouts are linked to the event. */
  layoutCount: z.number().int().positive(),
}).strict();
export type ClientHomeEvent = z.infer<typeof ClientHomeEventSchema>;

export const ClientHomePlanSchema = z.object({
  id: ConfigurationIdSchema,
  name: z.string().trim().min(1).max(200),
  /** When the plan was last saved. */
  updatedAt: z.iso.datetime(),
  space: z.object({ id: SpaceIdSchema, name: z.string().trim().min(1).max(200) }).strict(),
  venue: HomeVenueSchema,
  /** The listed event this plan belongs to, or null while it stands alone. */
  eventId: EventIdSchema.nullable(),
}).strict();
export type ClientHomePlan = z.infer<typeof ClientHomePlanSchema>;

/** The most plans one read returns; `planTotal` says how many there are. */
export const CLIENT_HOME_PLAN_LIMIT = 100;

export const ClientHomeSchema = z.object({
  /** Earliest first; an event without a date comes last. */
  events: z.array(ClientHomeEventSchema),
  /** Most recently saved first, at most CLIENT_HOME_PLAN_LIMIT. */
  plans: z.array(ClientHomePlanSchema).max(CLIENT_HOME_PLAN_LIMIT),
  planTotal: z.number().int().nonnegative(),
}).strict().superRefine((home, context) => {
  for (const key of ["events", "plans"] as const) {
    const ids = home[key].map((row) => row.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: "custom", path: [key], message: "Home identities must be unique" });
    }
  }
  if (home.planTotal < home.plans.length) {
    context.addIssue({ code: "custom", path: ["planTotal"], message: "The plan total cannot be fewer than the plans listed" });
  }
  const eventIds = new Set(home.events.map((event) => event.id));
  home.plans.forEach((plan, index) => {
    if (plan.eventId !== null && !eventIds.has(plan.eventId)) {
      context.addIssue({ code: "custom", path: ["plans", index, "eventId"], message: "A plan may name only a listed event" });
    }
  });
});
export type ClientHome = z.infer<typeof ClientHomeSchema>;
