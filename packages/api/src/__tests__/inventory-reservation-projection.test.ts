import { describe, expect, it } from "vitest";
import { CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE as payload, canonicalLayoutSnapshotDigest, runLayoutValidator } from "@omnitwin/types";
import { projectInventorySource, type InventorySourceInput } from "../services/inventory-reservation-projection.js";

const eventId = "66666666-6666-4666-8666-666666666666";
const phaseId = "77777777-7777-4777-8777-777777777777";
const canonicalId = "88888888-8888-4888-8888-888888888888";
const snapshotId = "99999999-9999-4999-8999-999999999999";
const digest = canonicalLayoutSnapshotDigest(payload);
const proof = runLayoutValidator(payload, { policyBundleId: payload.policyBundle.policyBundleId,
  policyBundleDigest: payload.policyBundle.policyBundleDigest, policyBundleVersion: payload.policyBundle.policyBundleVersion,
  minPrimaryFurnitureClearanceM: 1, clearanceWarningMarginM: 0.2, pricing: null });
function input(): InventorySourceInput {
  const snapshot = { id: snapshotId, eventPhaseId: phaseId, configurationId: payload.configurationId,
    canonicalSnapshotId: canonicalId, proofDigest: proof.proofDigest, supersedesSnapshotId: null,
    frozenBy: snapshotId, canonicalRowId: canonicalId, canonicalConfigurationId: payload.configurationId,
    canonicalVenueId: payload.venueId, canonicalSpaceId: payload.spaceId, canonicalSnapshotDigest: digest,
    canonicalPayload: payload, proofSnapshotId: canonicalId, proofSnapshotDigest: digest, proofRowDigest: proof.proofDigest,
    proofPayload: proof, predecessor: null, snapshotHash: digest, status: "frozen", objectCount: payload.objects.length,
    guestCount: payload.guestCount, payload, coordinateSpace: "real_m_v1", createdAt: new Date("2030-01-01T00:00:00Z"),
    frozenAt: new Date("2030-01-01T00:00:00Z"), configurationSpaceId: payload.spaceId, configurationVenueId: payload.venueId };
  return { venueId: payload.venueId, eventId, spaceId: payload.spaceId, eventName: "Dinner", eventStatus: "confirmed",
    eventUpdatedAt: "2030-01-01T00:00:00Z", eventDeleted: false, spaceName: "Hall", spaceDeleted: false,
    bookings: [{ id: eventId, window: { startsAt: "2031-09-06T08:00:00.000Z", endsAt: "2031-09-06T23:00:00.000Z" }, updatedAt: "2030-01-01T00:00:00.000Z" }],
    phases: [{ id: phaseId, name: "Dinner", templateKey: "dinner", spaceId: payload.spaceId,
      startsAt: "2031-09-06T12:00:00.000Z", durationMinutes: 60, updatedAt: "2030-01-01T00:00:00.000Z", snapshots: [snapshot] }],
    catalogue: payload.objects.map((object) => ({ id: object.assetDefinition.assetDefinitionId, name: "Placed item", category: object.assetDefinition.category })),
    accessoryParentIds: [], latestRelease: null };
}
describe("verified inventory source projection", () => {
  it("counts exact objects and keeps a room peak through consecutive layouts and transition gaps", () => {
    const value = input();
    const phase = value.phases[0]!;
    value.phases.push({ ...phase, id: canonicalId, startsAt: "2031-09-06T14:00:00.000Z",
      snapshots: phase.snapshots.map((row) => ({ ...row, id: canonicalId, eventPhaseId: canonicalId })) });
    value.phases.push({ ...phase, id: snapshotId, templateKey: "room-flip", startsAt: "2031-09-06T08:00:00.000Z", snapshots: [] });
    const source = projectInventorySource(value);
    expect(source.state).toBe("unapproved");
    expect(source.demands.reduce((sum, row) => sum + row.quantity, 0)).toBe(payload.objects.length);
    expect(source.occupiedWindow).toEqual(value.bookings[0]!.window);
    expect(source.phases.some((row) => row.mode === "room_flip_carry")).toBe(true);
  });
  it("does not drop untimed, unscoped or missing custom phases", () => {
    for (const patch of [{ startsAt: null }, { spaceId: null }, { snapshots: [], templateKey: null }]) {
      const value = input(); value.phases.push({ ...value.phases[0]!, id: canonicalId, ...patch });
      expect(projectInventorySource(value).state).toBe("incomplete");
    }
  });
  it("does not infer safe demand from an invalid winning snapshot or contradictory overlap", () => {
    const value = input();
    value.phases[0]!.snapshots = value.phases[0]!.snapshots.map((row) => ({ ...row, snapshotHash: "a".repeat(64) }));
    expect(projectInventorySource(value).state).toBe("incomplete");
    const overlap = input(); overlap.phases.push({ ...overlap.phases[0]!, id: canonicalId });
    expect(projectInventorySource(overlap).issues.some((row) => row.code === "PHASE_OVERLAP")).toBe(true);
  });
  it("rejects a snapshot from another phase and canonicalizes candidate membership order", () => {
    const invalid = input(); invalid.phases[0]!.snapshots = invalid.phases[0]!.snapshots.map((row) => ({ ...row, eventPhaseId: canonicalId }));
    expect(projectInventorySource(invalid).issues.some((row) => row.code === "SNAPSHOT_PHASE_MISMATCH")).toBe(true);
    const first = input(); const original = first.phases[0]!.snapshots[0]!;
    first.phases[0]!.snapshots.push({ ...original, id: canonicalId, status: "draft" });
    const before = projectInventorySource(first);
    first.phases[0]!.snapshots.reverse();
    expect(projectInventorySource(first).sourceDigest).toBe(before.sourceDigest);
  });
  it("permits only terminal explicit breakdown carry and exposes unmapped accessories", () => {
    const value = input(); const phase = value.phases[0]!;
    value.phases.push({ ...phase, id: canonicalId, templateKey: "breakdown", startsAt: "2031-09-06T22:00:00.000Z", snapshots: [] });
    value.accessoryParentIds.push(payload.objects[0]!.assetDefinition.assetDefinitionId);
    const source = projectInventorySource(value);
    expect(source.phases.some((row) => row.mode === "breakdown_carry")).toBe(true);
    expect(source.issues.some((row) => row.code === "ACCESSORIES_UNMAPPED")).toBe(true);
  });
  it("makes cancelled events incomplete while no active booking is inactive", () => {
    const value = input(); value.eventStatus = "cancelled";
    expect(projectInventorySource(value).state).toBe("incomplete");
    value.bookings = [];
    expect(projectInventorySource(value).state).toBe("inactive");
  });
});
