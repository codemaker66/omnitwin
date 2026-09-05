import { and, asc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { InventoryRemedySchema, InventoryReservationReleaseSchema, InventoryStockSchema,
  type InventoryAssessmentIssue, type InventoryReservationRelease, type InventoryWindow } from "@omnitwin/types";
import type { Database } from "../db/client.js";
import { assetAccessories, assetDefinitions, bookings, canonicalLayoutSnapshots, configurations, eventPhases, events,
  inventoryRemedyRequests, inventoryReservationReleases, layoutValidationRuns, phaseLayoutSnapshots, spaces,
  venueInventoryStock, venues } from "../db/schema.js";
import { inventoryWindowsOverlap, projectInventorySource, type InventorySourceInput } from "./inventory-reservation-projection.js";
import type { LayoutTimelineSnapshotCandidate } from "./room-layout-timeline.js";

export type InventoryReader = Pick<Database, "select" | "execute">;
export class InventoryDecisionError extends Error {
  constructor(readonly status: number, readonly code: string, message: string,
    readonly details?: Record<string, unknown>) { super(message); this.name = "InventoryDecisionError"; }
}
function bounded(size: number, limit: number): void {
  if (size > limit) throw new InventoryDecisionError(422, "INVENTORY_SOURCE_LIMIT", "The venue has more source records than this assessment can safely verify.");
}

async function readSnapshots(db: InventoryReader, phaseIds: string[]): Promise<Map<string, LayoutTimelineSnapshotCandidate[]>> {
  const byPhase = new Map<string, LayoutTimelineSnapshotCandidate[]>();
  if (phaseIds.length === 0) return byPhase;
  const ranked = db.select({ id: phaseLayoutSnapshots.id, rank: sql<number>`row_number() over (
    partition by ${phaseLayoutSnapshots.eventPhaseId} order by
      case ${phaseLayoutSnapshots.status} when 'frozen' then 0 when 'draft' then 1 when 'stale' then 2 when 'superseded' then 3 else 2147483647 end,
      coalesce(${phaseLayoutSnapshots.frozenAt}, ${phaseLayoutSnapshots.createdAt}) desc, ${phaseLayoutSnapshots.id} asc)`.as("rank") })
    .from(phaseLayoutSnapshots).where(inArray(phaseLayoutSnapshots.eventPhaseId, phaseIds)).as("ranked_inventory_snapshots");
  const rows = await db.select({ id: phaseLayoutSnapshots.id, eventPhaseId: phaseLayoutSnapshots.eventPhaseId,
    configurationId: phaseLayoutSnapshots.configurationId, canonicalSnapshotId: phaseLayoutSnapshots.canonicalSnapshotId,
    proofDigest: phaseLayoutSnapshots.proofDigest, supersedesSnapshotId: phaseLayoutSnapshots.supersedesSnapshotId,
    frozenBy: phaseLayoutSnapshots.frozenBy, canonicalRowId: canonicalLayoutSnapshots.id,
    canonicalConfigurationId: canonicalLayoutSnapshots.configurationId, canonicalVenueId: canonicalLayoutSnapshots.venueId,
    canonicalSpaceId: canonicalLayoutSnapshots.spaceId, canonicalSnapshotDigest: canonicalLayoutSnapshots.snapshotDigest,
    canonicalPayload: canonicalLayoutSnapshots.payload, proofSnapshotId: layoutValidationRuns.snapshotId,
    proofSnapshotDigest: layoutValidationRuns.snapshotDigest, proofRowDigest: layoutValidationRuns.proofDigest,
    proofPayload: layoutValidationRuns.payload, snapshotHash: phaseLayoutSnapshots.snapshotHash, status: phaseLayoutSnapshots.status,
    objectCount: phaseLayoutSnapshots.objectCount, guestCount: phaseLayoutSnapshots.guestCount, payload: phaseLayoutSnapshots.payload,
    coordinateSpace: phaseLayoutSnapshots.coordinateSpace, createdAt: phaseLayoutSnapshots.createdAt, frozenAt: phaseLayoutSnapshots.frozenAt,
    configurationSpaceId: configurations.spaceId, configurationVenueId: configurations.venueId })
    .from(ranked).innerJoin(phaseLayoutSnapshots, eq(phaseLayoutSnapshots.id, ranked.id))
    .leftJoin(configurations, eq(configurations.id, phaseLayoutSnapshots.configurationId))
    .leftJoin(canonicalLayoutSnapshots, eq(canonicalLayoutSnapshots.id, phaseLayoutSnapshots.canonicalSnapshotId))
    .leftJoin(layoutValidationRuns, eq(layoutValidationRuns.proofDigest, phaseLayoutSnapshots.proofDigest))
    .where(eq(ranked.rank, 1)).orderBy(asc(phaseLayoutSnapshots.eventPhaseId));
  bounded(rows.reduce((sum, row) => sum + row.objectCount, 0), 50_000);
  bounded(Buffer.byteLength(JSON.stringify(rows), "utf8"), 32 * 1024 * 1024);
  const predecessorIds = rows.flatMap((row) => row.supersedesSnapshotId === null ? [] : [row.supersedesSnapshotId]);
  const predecessors = predecessorIds.length === 0 ? [] : await db.select({ id: phaseLayoutSnapshots.id,
    eventPhaseId: phaseLayoutSnapshots.eventPhaseId, status: phaseLayoutSnapshots.status,
    createdAt: phaseLayoutSnapshots.createdAt, frozenAt: phaseLayoutSnapshots.frozenAt }).from(phaseLayoutSnapshots)
    .where(inArray(phaseLayoutSnapshots.id, predecessorIds));
  const predecessorMap = new Map(predecessors.map((row) => [row.id, row]));
  for (const row of rows) byPhase.set(row.eventPhaseId, [{ ...row,
    predecessor: row.supersedesSnapshotId === null ? null : predecessorMap.get(row.supersedesSnapshotId) ?? null }]);
  return byPhase;
}

export async function loadInventorySources(db: InventoryReader, venueId: string, window: InventoryWindow) {
  const [venue] = await db.select({ timeZone: venues.timezone }).from(venues)
    .where(and(eq(venues.id, venueId), isNull(venues.deletedAt))).limit(1);
  if (venue === undefined) throw new InventoryDecisionError(404, "NOT_FOUND", "Venue not found");
  const ranked = db.select({ id: inventoryReservationReleases.id, rank: sql<number>`row_number() over (
    partition by ${inventoryReservationReleases.eventId}, ${inventoryReservationReleases.spaceId}
    order by ${inventoryReservationReleases.revision} desc)`.as("rank") }).from(inventoryReservationReleases)
    .where(eq(inventoryReservationReleases.venueId, venueId)).as("ranked_inventory_releases");
  const activeInk = and(eq(bookings.venueId, venueId), eq(bookings.kind, "ink"), eq(bookings.status, "active"), isNull(bookings.deletedAt));
  const from = new Date(window.startsAt); const to = new Date(window.endsAt);
  const observedBookings = await db.select().from(bookings).where(and(activeInk, lt(bookings.startsAt, to), gt(bookings.endsAt, from))).limit(2001);
  const observedPhases = await db.select({ eventId: eventPhases.eventId }).from(eventPhases).innerJoin(events, eq(events.id, eventPhases.eventId))
    .where(and(eq(events.venueId, venueId), lt(eventPhases.startsAt, to),
      gt(sql`${eventPhases.startsAt} + make_interval(mins => ${eventPhases.durationMinutes})`, from))).limit(4001);
  const releaseOverlap = (range: InventoryWindow) => and(
    sql`(${inventoryReservationReleases.payload}->'occupiedWindow'->>'startsAt')::timestamptz < ${range.endsAt}::timestamptz`,
    sql`(${inventoryReservationReleases.payload}->'occupiedWindow'->>'endsAt')::timestamptz > ${range.startsAt}::timestamptz`);
  const readReleases = async (range: InventoryWindow, ids: string[] = []) => {
    const rows = await db.select({ payload: inventoryReservationReleases.payload }).from(ranked)
      .innerJoin(inventoryReservationReleases, eq(inventoryReservationReleases.id, ranked.id))
      .where(and(eq(ranked.rank, 1), ids.length === 0 ? releaseOverlap(range)
        : or(releaseOverlap(range), inArray(inventoryReservationReleases.eventId, ids)))).limit(2001);
    bounded(rows.length, 2000);
    return rows.map((row) => InventoryReservationReleaseSchema.parse(row.payload));
  };
  const observedReleases = await readReleases(window);
  bounded(observedBookings.length, 2000); bounded(observedPhases.length, 4000);
  const seedIds = [...new Set([...observedBookings.flatMap((row) => row.eventId === null ? [] : [row.eventId]),
    ...observedPhases.map((row) => row.eventId), ...observedReleases.map((row) => row.eventId)])];
  bounded(seedIds.length, 1000);
  // Observation selects candidates; full recorded membership establishes their
  // footprint. Other approved releases anywhere in that footprint participate
  // in proposal impact, even when they are outside the visible observation.
  const seedBookings = seedIds.length === 0 ? [] : await db.select().from(bookings).where(and(activeInk, inArray(bookings.eventId, seedIds))).limit(2001);
  const seedPhases = seedIds.length === 0 ? [] : await db.select().from(eventPhases).where(inArray(eventPhases.eventId, seedIds)).limit(4001);
  bounded(seedBookings.length, 2000); bounded(seedPhases.length, 4000);
  const occupied = [...seedBookings.map((row) => ({ startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString() })),
    ...observedReleases.map((row) => row.occupiedWindow), ...seedPhases.flatMap((row) => row.startsAt === null || row.durationMinutes <= 0 ? []
      : [{ startsAt: row.startsAt.toISOString(), endsAt: new Date(row.startsAt.getTime() + row.durationMinutes * 60_000).toISOString() }]), window];
  const expanded = { startsAt: new Date(Math.min(...occupied.map((row) => Date.parse(row.startsAt)))).toISOString(),
    endsAt: new Date(Math.max(...occupied.map((row) => Date.parse(row.endsAt)))).toISOString() };
  const releases = await readReleases(expanded, seedIds);
  const eventIds = [...new Set([...seedIds, ...releases.map((row) => row.eventId)])];
  bounded(eventIds.length, 1000);
  const currentBookings = eventIds.length === 0 ? [] : await db.select().from(bookings).where(and(activeInk, inArray(bookings.eventId, eventIds))).orderBy(asc(bookings.id)).limit(2001);
  bounded(currentBookings.length, 2000);
  const bookingRows = [...currentBookings, ...observedBookings.filter((row) => row.eventId === null)];
  const eventRows = eventIds.length === 0 ? [] : await db.select().from(events).where(and(eq(events.venueId, venueId), inArray(events.id, eventIds)));
  const phaseRows = eventIds.length === 0 ? [] : await db.select().from(eventPhases).where(inArray(eventPhases.eventId, eventIds)).orderBy(asc(eventPhases.id)).limit(4001);
  bounded(phaseRows.length, 4000);
  const roomRows = await db.select({ id: spaces.id, name: spaces.name, deletedAt: spaces.deletedAt }).from(spaces).where(eq(spaces.venueId, venueId));
  const catalogue = await db.select({ id: assetDefinitions.id, name: assetDefinitions.name, category: assetDefinitions.category }).from(assetDefinitions).orderBy(asc(assetDefinitions.id)).limit(10001);
  bounded(catalogue.length, 10000);
  const stockRows = await db.select().from(venueInventoryStock).where(eq(venueInventoryStock.venueId, venueId)).orderBy(asc(venueInventoryStock.assetDefinitionId));
  const stock = stockRows.map(({ updatedBy: _updatedBy, ...row }) => InventoryStockSchema.parse({ ...row, effectiveAt: row.effectiveAt.toISOString() }));
  const accessories = await db.select({ parentAssetId: assetAccessories.parentAssetId }).from(assetAccessories);
  const snapshots = await readSnapshots(db, phaseRows.map((row) => row.id));
  const eventMap = new Map(eventRows.map((row) => [row.id, row]));
  const roomMap = new Map(roomRows.map((row) => [row.id, row]));
  const scope = new Map<string, { eventId: string; spaceId: string; latest: InventoryReservationRelease | null }>();
  for (const row of releases) scope.set(`${row.eventId}:${row.spaceId}`, { eventId: row.eventId, spaceId: row.spaceId, latest: row });
  for (const row of [...bookingRows, ...phaseRows]) {
    if (row.eventId === null || row.spaceId === null) continue;
    const key = `${row.eventId}:${row.spaceId}`;
    if (!scope.has(key)) scope.set(key, { eventId: row.eventId, spaceId: row.spaceId, latest: null });
  }
  const inputs: InventorySourceInput[] = [];
  for (const entry of [...scope.values()].sort((left, right) => `${left.eventId}:${left.spaceId}`.localeCompare(`${right.eventId}:${right.spaceId}`))) {
    const event = eventMap.get(entry.eventId); const room = roomMap.get(entry.spaceId);
    if (event === undefined || room === undefined) throw new InventoryDecisionError(500, "INVENTORY_SCOPE_INTEGRITY", "Stored reservation scope is inconsistent");
    inputs.push({ venueId, eventId: entry.eventId, spaceId: entry.spaceId, eventName: event.name, eventStatus: event.status,
      eventUpdatedAt: event.updatedAt.toISOString(), eventDeleted: event.deletedAt !== null, spaceName: room.name, spaceDeleted: room.deletedAt !== null,
      bookings: bookingRows.filter((row) => row.eventId === entry.eventId && row.spaceId === entry.spaceId).map((row) => ({
        id: row.id, window: { startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString() }, updatedAt: row.updatedAt.toISOString() })),
      phases: phaseRows.filter((row) => row.eventId === entry.eventId).map((row) => ({ id: row.id, name: row.name, templateKey: row.templateKey,
        spaceId: row.spaceId, startsAt: row.startsAt?.toISOString() ?? null, durationMinutes: row.durationMinutes,
        updatedAt: row.updatedAt.toISOString(), snapshots: snapshots.get(row.id) ?? [] })), catalogue,
      accessoryParentIds: accessories.map((row) => row.parentAssetId), latestRelease: entry.latest });
  }
  const issues: InventoryAssessmentIssue[] = bookingRows.filter((row) => row.eventId === null
    && inventoryWindowsOverlap(window, { startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString() })).map((row) => ({
    code: "BOOKING_EVENT_MISSING", message: `Active ink booking ${row.title} has no linked event demand.`, eventId: null, spaceId: row.spaceId, phaseId: null }));
  const remedyRows = await db.select({ payload: inventoryRemedyRequests.payload }).from(inventoryRemedyRequests)
    .where(and(eq(inventoryRemedyRequests.venueId, venueId),
      sql`(${inventoryRemedyRequests.payload}->'window'->>'startsAt')::timestamptz < ${window.endsAt}::timestamptz`,
      sql`(${inventoryRemedyRequests.payload}->'window'->>'endsAt')::timestamptz > ${window.startsAt}::timestamptz`))
    .orderBy(asc(inventoryRemedyRequests.id)).limit(2001);
  bounded(remedyRows.length, 2000);
  return { timeZone: venue.timeZone, catalogue, stock, inputs, issues,
    sources: inputs.map(projectInventorySource), remedies: remedyRows.map((row) => InventoryRemedySchema.parse(row.payload)) };
}
