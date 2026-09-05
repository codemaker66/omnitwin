import { describe, expect, it } from "vitest";
import { InventoryReservationApprovalInputSchema, InventoryRemedyPrepareInputSchema,
  InventoryAssessmentQuerySchema, InventoryAssessmentItemSchema, InventoryReservationPhaseSchema,
  InventoryReservationReleaseSchema, InventoryRemedySchema, InventoryAvailabilityResultSchema } from "../inventory-reservations.js";

const id = "ABCDEFAB-1234-4123-8123-ABCDEFABCDEF";
const window = { startsAt: "2026-09-08T08:00:00Z", endsAt: "2026-09-08T20:00:00Z" };
const approval = { commandId: id, eventId: id, spaceId: id, window,
  expectedSourceDigest: "a".repeat(64), expectedAssessmentDigest: "b".repeat(64),
  occupiedWindowConfirmed: true, reason: "Confirmed setup through return" };
describe("inventory reservation approval contracts", () => {
  it("requires explicit occupied-window confirmation and canonicalizes identity", () => {
    expect(InventoryReservationApprovalInputSchema.parse(approval).eventId).toBe(id.toLowerCase());
    expect(InventoryReservationApprovalInputSchema.safeParse({ ...approval, occupiedWindowConfirmed: false }).success).toBe(false);
    expect(InventoryReservationApprovalInputSchema.safeParse({ ...approval, actorUserId: id }).success).toBe(false);
  });
  it("rejects missing reasoning, reversed windows, and oversized assessment windows", () => {
    expect(InventoryReservationApprovalInputSchema.safeParse({ ...approval, reason: " " }).success).toBe(false);
    expect(InventoryReservationApprovalInputSchema.safeParse({ ...approval, window: { ...window, endsAt: window.startsAt } }).success).toBe(false);
    expect(InventoryAssessmentQuerySchema.safeParse({ from: window.startsAt, to: "2027-09-08T20:00:00Z" }).success).toBe(false);
  });
  it("requires an idempotent positive integral internal request, without invented supply fields", () => {
    const command = { commandId: id, kind: "hire_request", assetDefinitionId: id, window, quantity: 10,
      expectedAssessmentDigest: "a".repeat(64), reason: "Shortage" };
    expect(InventoryRemedyPrepareInputSchema.parse(command).quantity).toBe(10);
    for (const quantity of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(InventoryRemedyPrepareInputSchema.safeParse({ ...command, quantity }).success).toBe(false);
    }
    expect(InventoryRemedyPrepareInputSchema.safeParse({ ...command, supplyConfirmed: true }).success).toBe(false);
  });
  it("rejects frozen evidence without lineage and repeated physical object identities", () => {
    const phase = { phaseId: id, name: "Dinner", window, mode: "frozen_layout", snapshotId: null,
      canonicalSnapshotId: null, proofDigest: null, snapshotDigest: null, objects: [] };
    expect(InventoryReservationPhaseSchema.safeParse(phase).success).toBe(false);
    expect(InventoryReservationPhaseSchema.safeParse({ ...phase, mode: "room_flip_carry" }).success).toBe(true);
    expect(InventoryReservationPhaseSchema.safeParse({ ...phase, snapshotId: id, canonicalSnapshotId: id,
      proofDigest: "a".repeat(64), snapshotDigest: "b".repeat(64), objects: [
        { objectId: id, assetDefinitionId: id }, { objectId: id.toLowerCase(), assetDefinitionId: id }] }).success).toBe(false);
  });
  it("requires at least one frozen layout while permitting verified zero placed objects", () => {
    const phase = { phaseId: id, name: "Empty layout", window, mode: "frozen_layout", snapshotId: id,
      canonicalSnapshotId: id, proofDigest: "a".repeat(64), snapshotDigest: "b".repeat(64), objects: [] };
    const release = { id, venueId: id, eventId: id, spaceId: id, revision: 1, action: "approved",
      supersedesReleaseId: null, sourceDigest: "a".repeat(64), occupiedWindow: window, occupiedWindowConfirmed: true,
      demands: [], bookings: [{ id, window, updatedAt: window.startsAt }], phases: [phase], actorUserId: id,
      recordedAt: window.startsAt, reason: "An empty room is intentional" };
    expect(InventoryReservationReleaseSchema.safeParse(release).success).toBe(true);
    expect(InventoryReservationReleaseSchema.safeParse({ ...release, phases: [{ ...phase, mode: "room_flip_carry",
      snapshotId: null, canonicalSnapshotId: null, proofDigest: null, snapshotDigest: null }] }).success).toBe(false);
    expect(InventoryReservationReleaseSchema.safeParse({ ...release, demands: [{ assetDefinitionId: id, name: "Chair", category: "chair", quantity: 1 }] }).success).toBe(false);
  });
  it("distinguishes unrecorded stock from unsupported historical stock", () => {
    const item = { assetDefinitionId: id, name: "Chair", category: "chair", stockRevision: null, availability: null, unavailableReason: null };
    expect(InventoryAssessmentItemSchema.safeParse(item).success).toBe(false);
    expect(InventoryAssessmentItemSchema.safeParse({ ...item, unavailableReason: "historical_unsupported" }).success).toBe(false);
    expect(InventoryAssessmentItemSchema.safeParse({ ...item, unavailableReason: "stock_unrecorded" }).success).toBe(true);
  });
  it("requires coherent signed shortage intervals and summary totals", () => {
    const segment = { ...window, ownedQuantity: 20, hiredQuantity: 0, totalQuantity: 20, usableQuantity: 18,
      reservedQuantity: 20, remainingQuantity: -2, shortageQuantity: 2, commitmentIds: [id], eventIds: [id] };
    const result = { venueId: id, assetDefinitionId: id, stockRevision: 1, minimumRemainingQuantity: -2,
      maximumShortageQuantity: 2, segments: [segment] };
    expect(InventoryAvailabilityResultSchema.safeParse(result).success).toBe(true);
    expect(InventoryAvailabilityResultSchema.safeParse({ ...result, maximumShortageQuantity: 0 }).success).toBe(false);
    expect(InventoryAvailabilityResultSchema.safeParse({ ...result, segments: [{ ...segment, remainingQuantity: 2 }] }).success).toBe(false);
  });
  it("cannot claim a request was approved without actor and timestamp evidence", () => {
    const request = { id, venueId: id, kind: "hire_request", assetDefinitionId: id, assetName: "Chair", quantity: 2, window,
      status: "approved", assessmentDigest: "a".repeat(64), reason: "Shortage", preparedBy: id, preparedAt: window.startsAt,
      approvedBy: null, approvedAt: null, effect: "internal_request_only", check: "current",
      evidence: { stockRevision: 1, shortageSegments: [], affectedReservations: [], missingFacts: ["Supplier unconfirmed"] } };
    expect(InventoryRemedySchema.safeParse(request).success).toBe(false);
    expect(InventoryRemedySchema.safeParse({ ...request, approvedBy: id, approvedAt: window.startsAt }).success).toBe(true);
  });
});
