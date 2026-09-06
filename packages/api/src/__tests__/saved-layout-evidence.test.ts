import { describe, expect, it } from "vitest";
import {
  CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE,
  canonicalLayoutSnapshotDigest,
  normalizeCanonicalLayoutSnapshot,
  sha256Hex,
  stableCanonicalJson,
} from "@omnitwin/types";
import { buildSavedLayoutSnapshot } from "../services/saved-layout-evidence.js";
import { PLANNING_POLICY_DIGEST } from "../services/layout-planning-policy.js";

const source = CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE;
function input() {
  return {
    configuration: {
      id: source.configurationId, venueId: source.venueId, spaceId: source.spaceId,
      name: source.layoutName, layoutStyle: source.layoutStyle, visibility: source.visibility,
      guestCount: source.guestCount, updatedAt: new Date(source.createdFromConfigurationUpdatedAt),
      userId: source.createdBy, reviewStatus: "draft", metadata: null,
    },
    persistedObjects: source.objects.map((object) => ({
      id: object.objectId, assetDefinitionId: object.assetDefinition.assetDefinitionId,
      positionX: object.position.x, positionY: object.position.y, positionZ: object.position.z,
      rotationX: object.rotation.x, rotationY: object.rotation.y, rotationZ: object.rotation.z,
      scale: object.scale, sortOrder: object.sortOrder,
      metadata: { ...object.metadata, groupId: object.groupId }, coordinateSpace: "real_m_v1",
      assetCategory: object.assetDefinition.category, assetWidthM: object.assetDefinition.widthM,
      assetDepthM: object.assetDefinition.depthM, assetHeightM: object.assetDefinition.heightM,
      assetSeatCount: object.assetDefinition.seatCount, assetCollisionType: object.assetDefinition.collisionType,
    })),
    room: source.venueRuntime, previous: null, snapshotCreatedAt: source.snapshotCreatedAt,
  };
}

describe("persisted manual layout evidence", () => {
  it("preserves normalized complete placements and deterministic digest independent of DB row order", () => {
    const original = input();
    const first = buildSavedLayoutSnapshot(original);
    const reversed = buildSavedLayoutSnapshot({ ...original, persistedObjects: [...original.persistedObjects].reverse() });
    expect(first.objects).toEqual(normalizeCanonicalLayoutSnapshot(source).objects);
    expect(canonicalLayoutSnapshotDigest(first)).toBe(canonicalLayoutSnapshotDigest(reversed));
    expect(first.generatorProvenance).toMatchObject({ generatorType: "human", generatedAt: null, promptDigest: null });
    expect(first.eventMetadata.eventType).toBeNull();
  });

  it("preserves generated provenance through approval without falsely claiming a human geometry edit", () => {
    const first = buildSavedLayoutSnapshot({ ...input(), previous: source });
    expect(first.generatorProvenance).toEqual(source.generatorProvenance);
    const changed = input();
    const object = changed.persistedObjects[0];
    if (object === undefined) throw new Error("Fixture has no objects");
    object.positionX += 0.1;
    const edited = buildSavedLayoutSnapshot({ ...changed, previous: source });
    expect(edited.generatorProvenance).toEqual({ ...source.generatorProvenance, humanEditedAfterGeneration: true });
  });

  it("binds scale, orientation, catalogue geometry and authored instructions into the digest", () => {
    const base = buildSavedLayoutSnapshot(input());
    for (const key of ["scale", "rotationY", "assetWidthM"] as const) {
      const changed = input();
      const object = changed.persistedObjects[0];
      if (object === undefined) throw new Error("Fixture has no objects");
      object[key] += 0.1;
      expect(canonicalLayoutSnapshotDigest(buildSavedLayoutSnapshot(changed))).not.toBe(canonicalLayoutSnapshotDigest(base));
    }
    const instructions = buildSavedLayoutSnapshot({ ...input(), configuration: { ...input().configuration, metadata: { instructions: { specialInstructions: "Keep this supplied aisle open" } }, reviewStatus: "approved" } });
    expect(instructions.sourceState).toBe("approved_configuration");
    expect(instructions.eventMetadata.specialInstructions).toBe("Keep this supplied aisle open");
  });

  it("rejects unverified coordinates and invalid catalogue dimensions", () => {
    const original = input();
    expect(() => buildSavedLayoutSnapshot({ ...original, persistedObjects: original.persistedObjects.map((object) => ({ ...object, coordinateSpace: "legacy" })) })).toThrow("real-metre");
    expect(() => buildSavedLayoutSnapshot({ ...original, persistedObjects: original.persistedObjects.map((object) => ({ ...object, assetWidthM: 0 })) })).toThrow();
  });

  it("does not resurrect prior instructions after clearing persisted metadata", () => {
    const previous = { ...source, eventMetadata: { ...source.eventMetadata, specialInstructions: "Old instructions" } };
    for (const metadata of [null, {}]) {
      expect(buildSavedLayoutSnapshot({ ...input(), previous, configuration: { ...input().configuration, metadata } }).eventMetadata.specialInstructions).toBeNull();
    }
    expect(buildSavedLayoutSnapshot({ ...input(), previous, configuration: { ...input().configuration, metadata: { instructions: { specialInstructions: "" } } } }).eventMetadata.specialInstructions).toBe("");
  });

  it("keeps the exact existing Event Architect policy definition digest", () => {
    expect(PLANNING_POLICY_DIGEST).toBe(sha256Hex(stableCanonicalJson({
      policyBundleId: "venviewer.internal-planning-policy.v0", policyBundleVersion: "0.1.0",
      minPrimaryFurnitureClearanceM: 1.2, clearanceWarningMarginM: 0.2,
      status: "internal_planning_defaults_requires_human_review",
      humanReviewRequiredFor: ["accessibility route", "door and obstruction state", "egress route", "guest-flow simulation", "pricing approval"],
    })));
  });
});
