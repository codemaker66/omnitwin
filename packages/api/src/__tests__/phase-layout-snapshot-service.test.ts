import { describe, expect, it } from "vitest";
import {
  CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE,
  canonicalLayoutSnapshotDigest,
  runLayoutValidator,
} from "@omnitwin/types";
import {
  PhaseLayoutSnapshotConflictError,
  nextPhaseLayoutSnapshotFrozenAt,
  phaseLayoutSnapshotAppendId,
  verifyFreezablePhaseLayoutSnapshot,
  type PhaseLayoutSnapshotConflictCode,
  type VerifyFreezablePhaseLayoutSnapshotInput,
} from "../services/phase-layout-snapshot.js";

const SNAPSHOT = CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE;
const EVENT_ID = "99999999-9999-4999-8999-999999999999";
const PHASE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CANONICAL_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DIGEST = canonicalLayoutSnapshotDigest(SNAPSHOT);
const PROOF = runLayoutValidator(SNAPSHOT, {
  policyBundleId: SNAPSHOT.policyBundle.policyBundleId,
  policyBundleDigest: SNAPSHOT.policyBundle.policyBundleDigest,
  policyBundleVersion: SNAPSHOT.policyBundle.policyBundleVersion,
  minPrimaryFurnitureClearanceM: 1,
  clearanceWarningMarginM: 0.2,
  pricing: null,
});

function source(): VerifyFreezablePhaseLayoutSnapshotInput {
  return {
    event: { id: EVENT_ID, venueId: SNAPSHOT.venueId },
    phase: {
      id: PHASE_ID,
      eventId: EVENT_ID,
      spaceId: SNAPSHOT.spaceId,
      templateKey: "dinner",
      name: "Dinner service",
    },
    configuration: {
      id: SNAPSHOT.configurationId,
      venueId: SNAPSHOT.venueId,
      spaceId: SNAPSHOT.spaceId,
      name: SNAPSHOT.layoutName,
      layoutStyle: SNAPSHOT.layoutStyle,
      visibility: SNAPSHOT.visibility,
      guestCount: SNAPSHOT.guestCount,
      updatedAt: new Date(SNAPSHOT.createdFromConfigurationUpdatedAt),
    },
    canonicalSnapshot: {
      id: CANONICAL_ID,
      configurationId: SNAPSHOT.configurationId,
      venueId: SNAPSHOT.venueId,
      spaceId: SNAPSHOT.spaceId,
      snapshotDigest: DIGEST,
      payload: SNAPSHOT,
    },
    proof: {
      snapshotId: CANONICAL_ID,
      snapshotDigest: DIGEST,
      proofDigest: PROOF.proofDigest,
      payload: PROOF,
    },
    persistedObjects: SNAPSHOT.objects.map((object) => ({
      id: object.objectId,
      assetDefinitionId: object.assetDefinition.assetDefinitionId,
      positionX: Math.round(object.position.x * 1_000) / 1_000,
      positionY: Math.round(object.position.y * 1_000) / 1_000,
      positionZ: Math.round(object.position.z * 1_000) / 1_000,
      rotationX: Math.round(object.rotation.x * 100_000) / 100_000,
      rotationY: Math.round(object.rotation.y * 100_000) / 100_000,
      rotationZ: Math.round(object.rotation.z * 100_000) / 100_000,
      scale: Math.round(object.scale * 1_000) / 1_000,
      sortOrder: object.sortOrder,
      metadata: {
        ...(object.metadata ?? {}),
        groupId: object.groupId,
        eventArchitectCandidateId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      },
      coordinateSpace: "real_m_v1",
      assetCategory: object.assetDefinition.category,
      assetWidthM: object.assetDefinition.widthM,
      assetDepthM: object.assetDefinition.depthM,
      assetHeightM: object.assetDefinition.heightM,
      assetSeatCount: object.assetDefinition.seatCount,
      assetCollisionType: object.assetDefinition.collisionType,
    })),
  };
}

function expectConflict(
  input: VerifyFreezablePhaseLayoutSnapshotInput,
  code: PhaseLayoutSnapshotConflictCode,
): void {
  try {
    verifyFreezablePhaseLayoutSnapshot(input);
    throw new Error("Expected verification to reject the source.");
  } catch (error) {
    expect(error).toBeInstanceOf(PhaseLayoutSnapshotConflictError);
    expect((error as PhaseLayoutSnapshotConflictError).code).toBe(code);
  }
}

describe("verifyFreezablePhaseLayoutSnapshot", () => {
  it("accepts only the current proof-carrying canonical saved configuration", () => {
    expect(verifyFreezablePhaseLayoutSnapshot(source())).toEqual({
      canonicalSnapshotId: CANONICAL_ID,
      payload: SNAPSHOT,
      snapshotHash: DIGEST,
      proofDigest: PROOF.proofDigest,
      objectCount: SNAPSHOT.objects.length,
      guestCount: SNAPSHOT.guestCount,
    });
  });

  it("enforces phase/event identity and treats room flips as gaps", () => {
    const mismatch = source();
    expectConflict({
      ...mismatch,
      phase: { ...mismatch.phase, eventId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
    }, "PHASE_EVENT_MISMATCH");

    const roomFlip = source();
    expectConflict({
      ...roomFlip,
      phase: { ...roomFlip.phase, templateKey: "room-flip", name: "Room flip" },
    }, "ROOM_FLIP_NOT_LAYOUT_PHASE");

    const unscoped = source();
    expectConflict({
      ...unscoped,
      phase: { ...unscoped.phase, spaceId: null },
    }, "PHASE_ROOM_UNSCOPED");
  });

  it("rejects venue, room, canonical identity, and canonical schema mismatches", () => {
    const venue = source();
    expectConflict({
      ...venue,
      configuration: {
        ...venue.configuration,
        venueId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      },
    }, "CONFIGURATION_VENUE_MISMATCH");

    const room = source();
    expectConflict({
      ...room,
      configuration: {
        ...room.configuration,
        spaceId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      },
    }, "CONFIGURATION_SPACE_MISMATCH");

    const missing = source();
    expectConflict({ ...missing, canonicalSnapshot: null }, "CONFIGURATION_CANONICAL_SNAPSHOT_MISSING");

    const malformed = source();
    expectConflict({
      ...malformed,
      canonicalSnapshot: malformed.canonicalSnapshot === null ? null : {
        ...malformed.canonicalSnapshot,
        payload: { schemaVersion: "layout_snapshot.v0" },
      },
    }, "CONFIGURATION_CANONICAL_SNAPSHOT_INVALID");

    const identity = source();
    expectConflict({
      ...identity,
      canonicalSnapshot: identity.canonicalSnapshot === null ? null : {
        ...identity.canonicalSnapshot,
        configurationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      },
    }, "CONFIGURATION_IDENTITY_MISMATCH");
  });

  it("checks the canonical digest, current save timestamp, and layout counts", () => {
    const digest = source();
    expectConflict({
      ...digest,
      canonicalSnapshot: digest.canonicalSnapshot === null ? null : {
        ...digest.canonicalSnapshot,
        snapshotDigest: "0".repeat(64),
      },
    }, "CONFIGURATION_CANONICAL_SNAPSHOT_DIGEST_MISMATCH");

    const stale = source();
    expectConflict({
      ...stale,
      configuration: { ...stale.configuration, updatedAt: new Date("2026-06-07T10:01:00.000Z") },
    }, "CONFIGURATION_CANONICAL_SNAPSHOT_STALE");

    const metadata = source();
    expectConflict({
      ...metadata,
      configuration: { ...metadata.configuration, guestCount: SNAPSHOT.guestCount + 1 },
    }, "CONFIGURATION_LAYOUT_MISMATCH");

    const count = source();
    expectConflict({
      ...count,
      persistedObjects: count.persistedObjects.slice(1),
    }, "CONFIGURATION_OBJECT_COUNT_MISMATCH");
  });

  it("checks real-metre storage and the exact persisted object identities", () => {
    const coordinates = source();
    expectConflict({
      ...coordinates,
      persistedObjects: coordinates.persistedObjects.map((object, index) => ({
        ...object,
        coordinateSpace: index === 0 ? "legacy_render_v0" : object.coordinateSpace,
      })),
    }, "CONFIGURATION_COORDINATE_SPACE_INVALID");

    const identity = source();
    expectConflict({
      ...identity,
      persistedObjects: identity.persistedObjects.map((object, index) => ({
        ...object,
        id: index === 0 ? "cccccccc-cccc-4ccc-8ccc-cccccccccccc" : object.id,
      })),
    }, "CONFIGURATION_OBJECT_ID_MISMATCH");
  });

  it("rejects stale geometry, asset facts, and validator-relevant metadata even when IDs and counts match", () => {
    const moved = source();
    expectConflict({
      ...moved,
      persistedObjects: moved.persistedObjects.map((object, index) => ({
        ...object,
        positionX: index === 0 ? object.positionX + 0.5 : object.positionX,
      })),
    }, "CONFIGURATION_OBJECT_CONTENT_MISMATCH");

    const changedAsset = source();
    expectConflict({
      ...changedAsset,
      persistedObjects: changedAsset.persistedObjects.map((object, index) => ({
        ...object,
        assetSeatCount: index === 0 ? (object.assetSeatCount ?? 0) + 1 : object.assetSeatCount,
      })),
    }, "CONFIGURATION_OBJECT_CONTENT_MISMATCH");

    const changedMetadata = source();
    expectConflict({
      ...changedMetadata,
      persistedObjects: changedMetadata.persistedObjects.map((object, index) => ({
        ...object,
        metadata: index === 0 ? { phase: "party", groupId: object.id } : object.metadata,
      })),
    }, "CONFIGURATION_OBJECT_CONTENT_MISMATCH");
  });

  it("requires a structurally and cryptographically valid proof run", () => {
    const missing = source();
    expectConflict({ ...missing, proof: null }, "CONFIGURATION_PROOF_MISSING");

    const malformed = source();
    expectConflict({
      ...malformed,
      proof: malformed.proof === null ? null : { ...malformed.proof, payload: {} },
    }, "CONFIGURATION_PROOF_INVALID");

    const tampered = source();
    expectConflict({
      ...tampered,
      proof: tampered.proof === null ? null : {
        ...tampered.proof,
        payload: { ...PROOF, proofDigest: "0".repeat(64) },
      },
    }, "CONFIGURATION_PROOF_INVALID");
  });
});

describe("phase snapshot append lifecycle", () => {
  it("derives stable append IDs from the immutable predecessor", () => {
    const root = phaseLayoutSnapshotAppendId(PHASE_ID, DIGEST, null);
    expect(root).toMatch(/^[a-f0-9-]{36}$/u);
    expect(phaseLayoutSnapshotAppendId(PHASE_ID, DIGEST, null)).toBe(root);
    expect(phaseLayoutSnapshotAppendId(PHASE_ID, DIGEST, root)).not.toBe(root);
  });

  it("makes every append strictly newer than its predecessor", () => {
    const predecessor = {
      createdAt: new Date("2026-07-18T10:00:00.000Z"),
      frozenAt: new Date("2026-07-18T10:00:00.500Z"),
    };
    expect(nextPhaseLayoutSnapshotFrozenAt(
      new Date("2026-07-18T09:00:00.000Z"),
      predecessor,
    ).toISOString()).toBe("2026-07-18T10:00:00.501Z");
  });
});
