import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { CLIENT_HOME_PLAN_LIMIT, ClientHomeSchema, type ClientHome } from "@omnitwin/types";
import type { Database } from "../db/client.js";
import {
  configurations,
  eventConfigurationLinks,
  events,
  layoutVariants,
  spaces,
  venues,
} from "../db/schema.js";

// ---------------------------------------------------------------------------
// The client's own home (fix-first 12): the events a person holds a live link
// to and the room plans they saved. Only their own rows, by user id; no role
// widens it, so a planner invited at a venue reads exactly what a client
// would, and never the venue's other customers.
//
// An event is listed by the rule the event page itself applies
// (loadClientEventSchedule): one of their own plans, live and not a public
// preview, in a live room of the event's venue, linked as the source, an
// approved snapshot's source, or a live variant of that very event. A card
// here therefore always opens; a revoked link takes the card with it.
// ---------------------------------------------------------------------------

const GRANTING_LINK_TYPES = ["source_configuration", "variant_configuration", "approved_snapshot_source"] as const;
const DIRECT_LINK_TYPES = ["source_configuration", "approved_snapshot_source"] as const;
const LIVE_VARIANT_STATUSES = ["draft", "candidate", "approved"] as const;

/** Both reads share one committed snapshot, so a plan never names an event
 *  the same answer leaves out. */
export async function loadClientHome(db: Database, userId: string): Promise<ClientHome> {
  return db.transaction(async (tx) => {
    const linkRows = await tx.select({
      configurationId: configurations.id,
      event: {
        id: events.id,
        name: events.name,
        eventType: events.eventType,
        startsAt: events.startsAt,
        endsAt: events.endsAt,
        guestCount: events.guestCount,
      },
      venue: { id: venues.id, name: venues.name, timezone: venues.timezone },
    }).from(eventConfigurationLinks)
      .innerJoin(configurations, eq(configurations.id, eventConfigurationLinks.configurationId))
      .innerJoin(events, eq(events.id, eventConfigurationLinks.eventId))
      .innerJoin(venues, eq(venues.id, events.venueId))
      .innerJoin(spaces, and(eq(spaces.id, configurations.spaceId), eq(spaces.venueId, events.venueId)))
      .leftJoin(layoutVariants, eq(layoutVariants.id, eventConfigurationLinks.layoutVariantId))
      .where(and(
        eq(configurations.userId, userId),
        eq(configurations.venueId, events.venueId),
        eq(configurations.isPublicPreview, false),
        isNull(configurations.deletedAt),
        isNull(events.deletedAt),
        isNull(venues.deletedAt),
        isNull(spaces.deletedAt),
        inArray(eventConfigurationLinks.linkType, [...GRANTING_LINK_TYPES]),
        or(
          and(isNull(eventConfigurationLinks.layoutVariantId), inArray(eventConfigurationLinks.linkType, [...DIRECT_LINK_TYPES])),
          and(
            isNotNull(eventConfigurationLinks.layoutVariantId),
            eq(layoutVariants.eventId, events.id),
            eq(layoutVariants.configurationId, configurations.id),
            inArray(layoutVariants.status, [...LIVE_VARIANT_STATUSES]),
          ),
        ),
      ))
      .orderBy(sql`${events.startsAt} asc nulls last`, asc(events.name), asc(events.id), asc(configurations.id));

    // One card per event, in the order read; the plans each event holds are
    // counted once however many link rows name them.
    const eventsById = new Map<string, { row: (typeof linkRows)[number]; plans: Set<string> }>();
    const eventOfPlan = new Map<string, string>();
    for (const row of linkRows) {
      const entry = eventsById.get(row.event.id) ?? { row, plans: new Set<string>() };
      entry.plans.add(row.configurationId);
      eventsById.set(row.event.id, entry);
      // A plan linked to two events names the earlier one.
      if (!eventOfPlan.has(row.configurationId)) eventOfPlan.set(row.configurationId, row.event.id);
    }

    const ownPlans = and(
      eq(configurations.userId, userId),
      eq(configurations.isPublicPreview, false),
      eq(configurations.isTemplate, false),
      isNull(configurations.deletedAt),
      isNull(spaces.deletedAt),
      isNull(venues.deletedAt),
    );
    const [count] = await tx.select({ total: sql<number>`count(*)::int` })
      .from(configurations)
      .innerJoin(spaces, and(eq(spaces.id, configurations.spaceId), eq(spaces.venueId, configurations.venueId)))
      .innerJoin(venues, eq(venues.id, configurations.venueId))
      .where(ownPlans);
    const planRows = await tx.select({
      id: configurations.id,
      name: configurations.name,
      updatedAt: configurations.updatedAt,
      space: { id: spaces.id, name: spaces.name },
      venue: { id: venues.id, name: venues.name },
    }).from(configurations)
      .innerJoin(spaces, and(eq(spaces.id, configurations.spaceId), eq(spaces.venueId, configurations.venueId)))
      .innerJoin(venues, eq(venues.id, configurations.venueId))
      .where(ownPlans)
      .orderBy(desc(configurations.updatedAt), asc(configurations.id))
      .limit(CLIENT_HOME_PLAN_LIMIT);

    return ClientHomeSchema.parse({
      events: [...eventsById.values()].map(({ row, plans }) => ({
        ...row.event,
        startsAt: row.event.startsAt?.toISOString() ?? null,
        endsAt: row.event.endsAt?.toISOString() ?? null,
        venue: row.venue,
        layoutCount: plans.size,
      })),
      plans: planRows.map((plan) => ({
        ...plan,
        updatedAt: plan.updatedAt.toISOString(),
        eventId: eventOfPlan.get(plan.id) ?? null,
      })),
      planTotal: count?.total ?? 0,
    });
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
