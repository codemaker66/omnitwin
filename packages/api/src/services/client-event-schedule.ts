import { and, asc, eq, isNotNull, isNull, or } from "drizzle-orm";
import {
  ClientEventScheduleSchema,
  PlatformRoleSchema,
  type ClientEventSchedule,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import {
  configurations,
  eventConfigurationLinks,
  eventPhases,
  events,
  layoutVariants,
  spaces,
  users,
  venues,
} from "../db/schema.js";
import { canManageVenue } from "../utils/query.js";

/**
 * Authorization and projection share one committed database snapshot. No
 * creator, email, CRM label, public-preview flag, or historical snapshot is an
 * event participant grant. Reads starting after a committed link/owner/role
 * change must observe the changed access; an already-started read is scoped to
 * its repeatable-read snapshot.
 */
export async function loadClientEventSchedule(
  db: Database,
  userId: string,
  eventId: string,
  configurationId?: string,
): Promise<ClientEventSchedule | null> {
  return db.transaction(async (tx) => {
    const [actor] = await tx.select({
      role: users.role,
      platformRole: users.platformRole,
      venueId: users.venueId,
    }).from(users).where(eq(users.id, userId)).limit(1);
    if (actor === undefined) return null;
    const platformRole = PlatformRoleSchema.safeParse(actor.platformRole);
    if (!platformRole.success) return null;

    const [context] = await tx.select({
      event: {
        id: events.id,
        venueId: events.venueId,
        name: events.name,
        eventType: events.eventType,
        status: events.status,
        startsAt: events.startsAt,
        endsAt: events.endsAt,
        guestCount: events.guestCount,
      },
      venue: { id: venues.id, name: venues.name, timezone: venues.timezone },
    }).from(events)
      .innerJoin(venues, eq(venues.id, events.venueId))
      .where(and(eq(events.id, eventId), isNull(events.deletedAt), isNull(venues.deletedAt)))
      .limit(1);
    if (context === undefined) return null;
    const managesVenue = canManageVenue({ ...actor, platformRole: platformRole.data }, context.venue.id);
    if (!managesVenue && actor.role !== "client" && actor.role !== "planner") return null;

    const links = await tx.select({
      id: configurations.id,
      name: configurations.name,
      space: { id: spaces.id, name: spaces.name },
    }).from(eventConfigurationLinks)
      .innerJoin(configurations, eq(configurations.id, eventConfigurationLinks.configurationId))
      .innerJoin(spaces, and(eq(spaces.id, configurations.spaceId), eq(spaces.venueId, context.venue.id)))
      .leftJoin(layoutVariants, eq(layoutVariants.id, eventConfigurationLinks.layoutVariantId))
      .where(and(
        eq(eventConfigurationLinks.eventId, context.event.id),
        eq(configurations.venueId, context.venue.id),
        isNull(configurations.deletedAt),
        isNull(spaces.deletedAt),
        eq(configurations.isPublicPreview, false),
        configurationId === undefined ? undefined : eq(configurations.id, configurationId),
        // Sharing a layout changes its audience, not its owner's independent
        // event relationship. Public viewers still have no ownership grant.
        managesVenue ? undefined : eq(configurations.userId, userId),
        or(
          eq(eventConfigurationLinks.linkType, "source_configuration"),
          eq(eventConfigurationLinks.linkType, "variant_configuration"),
          eq(eventConfigurationLinks.linkType, "approved_snapshot_source"),
        ),
        // A variant link without its live variant is not a current grant.
        or(
          and(isNull(eventConfigurationLinks.layoutVariantId), or(
            eq(eventConfigurationLinks.linkType, "source_configuration"),
            eq(eventConfigurationLinks.linkType, "approved_snapshot_source"),
          )),
          and(
            isNotNull(eventConfigurationLinks.layoutVariantId),
            eq(layoutVariants.eventId, context.event.id),
            eq(layoutVariants.configurationId, configurations.id),
            or(eq(layoutVariants.status, "draft"), eq(layoutVariants.status, "candidate"), eq(layoutVariants.status, "approved")),
          ),
        ),
      ))
      .orderBy(asc(configurations.name), asc(configurations.id));
    if ((!managesVenue || configurationId !== undefined) && links.length === 0) return null;

    const phases = await tx.select({
      id: eventPhases.id,
      name: eventPhases.name,
      startsAt: eventPhases.startsAt,
      durationMinutes: eventPhases.durationMinutes,
      space: { id: spaces.id, name: spaces.name },
    }).from(eventPhases)
      .leftJoin(spaces, and(
        eq(spaces.id, eventPhases.spaceId), eq(spaces.venueId, context.venue.id), isNull(spaces.deletedAt),
      ))
      .where(and(eq(eventPhases.eventId, context.event.id), or(isNull(eventPhases.spaceId), isNotNull(spaces.id))))
      .orderBy(asc(eventPhases.sortOrder), asc(eventPhases.id));

    return ClientEventScheduleSchema.parse({
      event: {
        ...context.event,
        startsAt: context.event.startsAt?.toISOString() ?? null,
        endsAt: context.event.endsAt?.toISOString() ?? null,
      },
      venue: context.venue,
      scheduleState: "working",
      phases: phases.map((phase) => ({ ...phase, startsAt: phase.startsAt?.toISOString() ?? null })),
      layouts: [...new Map(links.map((layout) => [layout.id, layout])).values()],
    });
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
