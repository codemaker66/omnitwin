import type { InventoryAssessment, InventoryRemedy, InventoryReservationRelease, InventoryReservationPhase } from "@omnitwin/types";

export const demandIds = { venue: "00000000-0000-4000-8000-000000000001", actor: "00000000-0000-4000-8000-000000000003",
  asset: "00000000-0000-4000-8000-000000000002", event: "00000000-0000-4000-8000-000000000004", space: "00000000-0000-4000-8000-000000000005",
  release: "00000000-0000-4000-8000-000000000006", remedy: "00000000-0000-4000-8000-000000000007" };
export const observationWindow = { startsAt: "2026-09-06T10:00:00.000Z", endsAt: "2026-09-06T20:00:00.000Z" };
export const occupiedWindow = { startsAt: "2026-09-06T08:00:00.000Z", endsAt: "2026-09-06T22:00:00.000Z" };
const phase: InventoryReservationPhase = { phaseId: "00000000-0000-4000-8000-000000000008", name: "Wedding dinner", window: occupiedWindow,
  mode: "frozen_layout", snapshotId: "00000000-0000-4000-8000-000000000009", canonicalSnapshotId: "00000000-0000-4000-8000-000000000010",
  proofDigest: "c".repeat(64), snapshotDigest: "d".repeat(64), objects: Array.from({ length: 120 }, (_, index) => ({
    objectId: `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`, assetDefinitionId: demandIds.asset })) };
export const demandAssessment: InventoryAssessment = {
  venueId: demandIds.venue, timeZone: "Europe/London", window: observationWindow, assessedAt: "2026-09-05T10:00:00.000Z",
  assessmentDigest: "a".repeat(64), coverage: "partial", demandScope: "frozen_placed_catalogue_objects_only",
  scopeDisclosure: "Only placed catalogue objects in verified frozen layouts are counted. Accessories are not mapped.",
  issues: [{ code: "missing_phase", message: "Reception room has no timed layout.", eventId: null, spaceId: null, phaseId: null }],
  items: [{ assetDefinitionId: demandIds.asset, name: "Chiavari chair", category: "chair", stockRevision: 3, unavailableReason: null,
    availability: { venueId: demandIds.venue, assetDefinitionId: demandIds.asset, stockRevision: 3, minimumRemainingQuantity: 100,
      maximumShortageQuantity: 0, segments: [{ ...observationWindow, ownedQuantity: 100, hiredQuantity: 0, totalQuantity: 100,
        usableQuantity: 100, reservedQuantity: 0, remainingQuantity: 100, shortageQuantity: 0, eventIds: [], commitmentIds: [] }] } }],
  sources: [{ eventId: demandIds.event, spaceId: demandIds.space, eventName: "McLaren wedding", spaceName: "Grand Hall", bookingIds: [],
    occupiedWindow, sourceDigest: "b".repeat(64), state: "unapproved", issues: [],
    demands: [{ assetDefinitionId: demandIds.asset, name: "Chiavari chair", category: "chair", quantity: 120 }], phases: [phase],
    approvedRelease: null, latestReleaseId: null, releaseRevision: 0, proposalImpact: [{ assetDefinitionId: demandIds.asset,
      name: "Chiavari chair", category: "chair", stockRevision: 3, unavailableReason: null, availability: {
        venueId: demandIds.venue, assetDefinitionId: demandIds.asset, stockRevision: 3, minimumRemainingQuantity: -20,
        maximumShortageQuantity: 20, segments: [{ ...occupiedWindow, ownedQuantity: 100, hiredQuantity: 0, totalQuantity: 100,
          usableQuantity: 100, reservedQuantity: 120, remainingQuantity: -20, shortageQuantity: 20,
          eventIds: [demandIds.event], commitmentIds: [demandIds.release] }] } }] }], remedies: [],
};
export const demandRelease: InventoryReservationRelease = { id: demandIds.release, venueId: demandIds.venue,
  eventId: demandIds.event, spaceId: demandIds.space, revision: 1, action: "approved", supersedesReleaseId: null,
  sourceDigest: "b".repeat(64), occupiedWindow, occupiedWindowConfirmed: true,
  demands: demandAssessment.sources[0]?.demands ?? [], bookings: [{ id: "00000000-0000-4000-8000-000000000011", window: occupiedWindow, updatedAt: "2026-09-05T09:00:00.000Z" }], phases: [phase], actorUserId: demandIds.actor,
  recordedAt: "2026-09-05T10:01:00.000Z", reason: "Reviewed room setup" };
export const demandRemedy: InventoryRemedy = { id: demandIds.remedy, venueId: demandIds.venue, kind: "hire_request",
  assetDefinitionId: demandIds.asset, assetName: "Chiavari chair", quantity: 20, window: observationWindow, status: "prepared",
  assessmentDigest: "a".repeat(64), reason: "Cover shortage", preparedBy: demandIds.actor, preparedAt: "2026-09-05T10:01:00.000Z",
  approvedBy: null, approvedAt: null, effect: "internal_request_only", check: "current",
  evidence: { stockRevision: 3, shortageSegments: [], affectedReservations: [], missingFacts: ["Supplier availability is unconfirmed."] } };
