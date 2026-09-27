import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import type { Database } from "../db/client.js";
import {
  bookings,
  configurationReviewHistory,
  eventConfigurationLinks,
  layoutVariants,
  spaces,
  users,
} from "../db/schema.js";

// ---------------------------------------------------------------------------
// What the Layout reviews desk shows on each row of its queue (roadmap X2):
// the room, the planner, the event's date, and who moved the review into
// the stage it is in, and when. A reviewer weighs a submission by "which
// day, which room, whose plan, how long has it waited".
//
// The event date follows the setup sheet's own rule (resolveTiming in
// hallkeeper-sheet-v2-data.ts): the earliest live booking that holds this
// layout's room in its venue, for an event the layout is linked to, either
// directly or as a layout variant that is not archived. Prospect bookings
// (the sales pipeline) and released or cancelled rows are not the event.
//
// Four queries for the whole queue rather than four per row.
// ---------------------------------------------------------------------------

export interface PendingReviewRow {
  readonly id: string;
  readonly venueId: string;
  readonly spaceId: string;
  readonly userId: string | null;
  readonly reviewStatus: string;
}

export interface PendingReviewFacts {
  /** The room's name, or null if the room has gone. */
  readonly spaceName: string | null;
  /** The planner's display name, or null when the layout has no planner account. */
  readonly plannerName: string | null;
  /** When the event starts, or null when no live booking holds the room for it. */
  readonly eventStartsAt: string | null;
  /** When the review entered the stage it is in, or null when unrecorded. */
  readonly stageSince: string | null;
  /** Who moved it there, or null for a system move or a removed account. */
  readonly stageByName: string | null;
}

const NO_FACTS: PendingReviewFacts = {
  spaceName: null, plannerName: null, eventStartsAt: null, stageSince: null, stageByName: null,
};

export async function pendingReviewFacts(
  db: Database,
  rows: readonly PendingReviewRow[],
): Promise<ReadonlyMap<string, PendingReviewFacts>> {
  if (rows.length === 0) return new Map();
  const configIds = rows.map((row) => row.id);
  const spaceIds = [...new Set(rows.map((row) => row.spaceId))];
  const plannerIds = [...new Set(rows.flatMap((row) => row.userId === null ? [] : [row.userId]))];

  const [roomRows, plannerRows, linkRows, variantRows, historyRows] = await Promise.all([
    db.select({ id: spaces.id, name: spaces.name }).from(spaces).where(inArray(spaces.id, spaceIds)),
    plannerIds.length === 0 ? [] : db.select({ id: users.id, name: users.name, displayName: users.displayName })
      .from(users).where(inArray(users.id, plannerIds)),
    db.select({ configurationId: eventConfigurationLinks.configurationId, eventId: eventConfigurationLinks.eventId })
      .from(eventConfigurationLinks).where(inArray(eventConfigurationLinks.configurationId, configIds)),
    db.select({ configurationId: layoutVariants.configurationId, eventId: layoutVariants.eventId })
      .from(layoutVariants)
      .where(and(inArray(layoutVariants.configurationId, configIds), ne(layoutVariants.status, "archived"))),
    // Newest first, so the first row into a review's current stage is the
    // move that put it there.
    db.select({
      configurationId: configurationReviewHistory.configurationId,
      toStatus: configurationReviewHistory.toStatus,
      createdAt: configurationReviewHistory.createdAt,
      changedByDisplayName: users.displayName,
      changedByName: users.name,
    })
      .from(configurationReviewHistory)
      .leftJoin(users, eq(configurationReviewHistory.changedBy, users.id))
      .where(inArray(configurationReviewHistory.configurationId, configIds))
      .orderBy(desc(configurationReviewHistory.createdAt)),
  ]);

  const eventIdsByConfig = new Map<string, Set<string>>();
  for (const link of [...linkRows, ...variantRows]) {
    if (link.configurationId === null) continue;
    const events = eventIdsByConfig.get(link.configurationId) ?? new Set<string>();
    events.add(link.eventId);
    eventIdsByConfig.set(link.configurationId, events);
  }
  const eventIds = [...new Set([...eventIdsByConfig.values()].flatMap((events) => [...events]))];
  const bookingRows = eventIds.length === 0 ? [] : await db.select({
    eventId: bookings.eventId,
    spaceId: bookings.spaceId,
    venueId: bookings.venueId,
    startsAt: bookings.startsAt,
  })
    .from(bookings)
    .where(and(
      inArray(bookings.eventId, eventIds),
      eq(bookings.status, "active"),
      ne(bookings.kind, "prospect"),
      isNull(bookings.deletedAt),
    ));

  const roomName = new Map(roomRows.map((room) => [room.id, room.name]));
  const plannerName = new Map(plannerRows.map((planner) => [planner.id, planner.displayName ?? planner.name]));

  const facts = new Map<string, PendingReviewFacts>();
  for (const row of rows) {
    const events = eventIdsByConfig.get(row.id);
    let earliest: Date | null = null;
    if (events !== undefined) {
      for (const booking of bookingRows) {
        if (booking.eventId === null || !events.has(booking.eventId)) continue;
        if (booking.spaceId !== row.spaceId || booking.venueId !== row.venueId) continue;
        if (earliest === null || booking.startsAt < earliest) earliest = booking.startsAt;
      }
    }
    const move = historyRows.find((entry) => entry.configurationId === row.id && entry.toStatus === row.reviewStatus);
    facts.set(row.id, {
      ...NO_FACTS,
      spaceName: roomName.get(row.spaceId) ?? null,
      plannerName: row.userId === null ? null : plannerName.get(row.userId) ?? null,
      eventStartsAt: earliest === null ? null : earliest.toISOString(),
      stageSince: move === undefined ? null : move.createdAt.toISOString(),
      stageByName: move === undefined ? null : move.changedByDisplayName ?? move.changedByName,
    });
  }
  return facts;
}
