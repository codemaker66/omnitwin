import { randomUUID } from "node:crypto";
import {
  CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE,
  canonicalLayoutSnapshotDigest,
  normalizeCanonicalLayoutSnapshot,
  runLayoutValidator,
  type CanonicalLayoutSnapshotV0,
  type InventoryWindow,
} from "@omnitwin/types";
import type { Database } from "../db/client.js";
import * as schema from "../db/schema.js";

export interface InventoryReservationsFixture {
  venueId: string;
  otherVenueId: string;
  adminId: string;
  secondAdminId: string;
  chairId: string;
  unrecordedAssetId: string;
  window: InventoryWindow;
  rooms: Array<{
    spaceId: string;
    eventId: string;
    bookingId: string;
    phaseIds: string[];
    frozenIds: string[];
    configurationId: string;
    canonicalId: string;
    quantity: number;
  }>;
}

/** Real relational test data. Callers must guard the disposable local database. */
export async function seedInventoryReservationsFixture(
  db: Pick<Database, "insert">,
  day = "2031-09-06",
): Promise<InventoryReservationsFixture> {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(day)) throw new Error("Fixture day must be YYYY-MM-DD");
  const at = (hour: number): Date => new Date(`${day}T${String(hour).padStart(2, "0")}:00:00.000Z`);
  if (!Number.isFinite(at(0).getTime())) throw new Error("Invalid fixture day");
  const fixture: InventoryReservationsFixture = {
    venueId: randomUUID(), otherVenueId: randomUUID(), adminId: randomUUID(),
    secondAdminId: randomUUID(), chairId: randomUUID(), unrecordedAssetId: randomUUID(),
    window: { startsAt: at(8).toISOString(), endsAt: at(19).toISOString() }, rooms: [],
  };
  const frozenAt = new Date(Date.now() - 60_000);
  await db.insert(schema.venues).values([
    { id: fixture.venueId, name: "Trades Hall · reservation fixture", slug: `inventory-${fixture.venueId}`, address: "Local integration fixture", timezone: "Europe/London" },
    { id: fixture.otherVenueId, name: "Other venue · reservation fixture", slug: `inventory-${fixture.otherVenueId}`, address: "Local integration fixture" },
  ]);
  await db.insert(schema.users).values([fixture.adminId, fixture.secondAdminId].map((id, index) => ({
    id, name: index === 0 ? "Elaine · local fixture" : "Second admin · local fixture",
    email: `${id}@inventory.local.test`, role: "admin", platformRole: "none", venueId: fixture.venueId,
  })));
  await db.insert(schema.assetDefinitions).values([
    { id: fixture.chairId, name: "Chiavari chair", category: "chair", widthM: "0.450", depthM: "0.450", heightM: "0.900", seatCount: 1, collisionType: "box" },
    { id: fixture.unrecordedAssetId, name: "Unrecorded projector · fixture", category: "av", widthM: "0.300", depthM: "0.200", heightM: "0.120", seatCount: 0 },
  ]);
  await db.insert(schema.venueInventoryStock).values({
    venueId: fixture.venueId, assetDefinitionId: fixture.chairId, revision: 1,
    ownedQuantity: 200, damagedQuantity: 20, unavailableQuantity: 0, hires: [],
    storageLocation: "East store", status: "active", effectiveAt: frozenAt, updatedBy: fixture.adminId,
  });

  for (const [index, quantity] of [120, 70].entries()) {
    const spaceId = randomUUID();
    const eventId = randomUUID();
    const bookingId = randomUUID();
    const configurationId = randomUUID();
    const canonicalId = randomUUID();
    const roomName = index === 0 ? "Grand Hall · fixture" : "Saloon · fixture";
    const eventName = index === 0 ? "Autumn dinner · fixture" : "Client reception · fixture";
    const startHour = index === 0 ? 9 : 10;
    const endHour = index === 0 ? 17 : 16;
    await db.insert(schema.spaces).values({
      id: spaceId, venueId: fixture.venueId, name: roomName, slug: `fixture-${spaceId}`,
      widthM: "30.00", lengthM: "30.00", heightM: "7.00",
      floorPlanOutline: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 }, { x: 0, y: 30 }],
    });
    await db.insert(schema.configurations).values({
      id: configurationId, spaceId, venueId: fixture.venueId, userId: fixture.adminId,
      name: `${String(quantity)} chairs · fixture`, layoutStyle: "theatre", guestCount: quantity,
      visibility: "private", slug: `fixture-${configurationId}`, updatedAt: frozenAt,
    });
    await db.insert(schema.events).values({
      id: eventId, venueId: fixture.venueId, createdBy: fixture.adminId, name: eventName,
      eventType: "conference", status: "confirmed", startsAt: at(startHour + 1),
      endsAt: at(endHour - 1), guestCount: quantity, clientName: "Local test client",
    });
    await db.insert(schema.bookings).values({
      id: bookingId, venueId: fixture.venueId, spaceId, eventId, kind: "ink", status: "active",
      title: eventName, startsAt: at(startHour), endsAt: at(endHour), createdBy: fixture.adminId,
    });
    const base = structuredClone(CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE);
    const payload: CanonicalLayoutSnapshotV0 = normalizeCanonicalLayoutSnapshot({
      ...base, configurationId, venueId: fixture.venueId, spaceId, layoutName: `${String(quantity)} chairs · fixture`,
      layoutStyle: "theatre", guestCount: quantity, createdBy: fixture.adminId,
      createdFromConfigurationUpdatedAt: frozenAt.toISOString(), snapshotCreatedAt: frozenAt.toISOString(),
      eventMetadata: { ...base.eventMetadata, eventType: "conference", guestCount: quantity },
      scenarioAssumptions: [],
      venueRuntime: { ...base.venueRuntime, venueId: fixture.venueId, venueSlug: `inventory-${fixture.venueId}`,
        spaceId, spaceSlug: `fixture-${spaceId}`, spaceName: roomName,
        floorPlanOutline: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 }, { x: 0, y: 30 }],
        spaceDimensions: { width: 30, length: 30, height: 7 } },
      objects: Array.from({ length: quantity }, (_, ordinal) => ({
        objectId: randomUUID(), assetDefinition: { assetDefinitionId: fixture.chairId, category: "chair" as const,
          widthM: 0.45, depthM: 0.45, heightM: 0.9, seatCount: 1, collisionType: "box" as const },
        position: { x: 2 + ordinal % 12 * 2, y: 0, z: 2 + Math.floor(ordinal / 12) * 2 },
        rotation: { x: 0, y: 0, z: 0 }, scale: 1, sortOrder: ordinal, groupId: null, metadata: null,
      })),
    });
    const snapshotDigest = canonicalLayoutSnapshotDigest(payload);
    const proof = runLayoutValidator(payload, {
      policyBundleId: payload.policyBundle.policyBundleId, policyBundleDigest: payload.policyBundle.policyBundleDigest,
      policyBundleVersion: payload.policyBundle.policyBundleVersion, minPrimaryFurnitureClearanceM: 1,
      clearanceWarningMarginM: 0.2, pricing: null,
    });
    await db.insert(schema.canonicalLayoutSnapshots).values({
      id: canonicalId, configurationId, venueId: fixture.venueId, spaceId,
      schemaVersion: payload.schemaVersion, snapshotDigest, payload, createdBy: fixture.adminId, createdAt: frozenAt,
    });
    await db.insert(schema.layoutValidationRuns).values({
      id: randomUUID(), snapshotId: canonicalId, snapshotDigest, validatorVersion: proof.validatorVersion,
      validatorDigest: proof.validatorDigest, contextDigest: proof.contextDigest, proofDigest: proof.proofDigest,
      payload: proof, createdAt: frozenAt,
    });
    const phaseIds: string[] = [];
    const frozenIds: string[] = [];
    const phases = [
      { templateKey: "room-flip", name: "Equipment setup", start: startHour, end: startHour + 1, layout: false },
      { templateKey: "dinner", name: "Main event", start: startHour + 1, end: endHour - 2, layout: true },
      { templateKey: "speeches", name: "Closing session", start: endHour - 2, end: endHour - 1, layout: true },
      { templateKey: "breakdown", name: "Equipment return", start: endHour - 1, end: endHour, layout: false },
    ];
    for (const [sortOrder, phase] of phases.entries()) {
      const phaseId = randomUUID();
      phaseIds.push(phaseId);
      await db.insert(schema.eventPhases).values({
        id: phaseId, eventId, spaceId, templateKey: phase.templateKey, name: phase.name, sortOrder,
        startsAt: at(phase.start), durationMinutes: (phase.end - phase.start) * 60, guestCount: quantity,
      });
      if (phase.layout) {
        const frozenId = randomUUID();
        frozenIds.push(frozenId);
        await db.insert(schema.phaseLayoutSnapshots).values({
          id: frozenId, eventPhaseId: phaseId, configurationId, canonicalSnapshotId: canonicalId,
          proofDigest: proof.proofDigest, frozenBy: fixture.adminId, snapshotHash: snapshotDigest,
          status: "frozen", objectCount: quantity, guestCount: quantity, payload,
          coordinateSpace: "real_m_v1", createdAt: frozenAt, frozenAt,
        });
      }
    }
    fixture.rooms.push({ spaceId, eventId, bookingId, phaseIds, frozenIds, configurationId, canonicalId, quantity });
  }
  return fixture;
}
