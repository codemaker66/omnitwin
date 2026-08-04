import { describe, expect, it } from "vitest";
import {
  CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE,
  type CanonicalLayoutSnapshotV0,
  type LayoutSnapshotPlacedObject,
} from "../canonical-layout-snapshot.js";
import {
  LAYOUT_VALIDATOR_DIGEST,
  LayoutValidatorRunSchema,
  runLayoutValidator,
  type LayoutValidatorContext,
  type LayoutValidatorRuleId,
} from "../layout-validator.js";

const BASE_CONTEXT: LayoutValidatorContext = {
  policyBundleId: CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.policyBundle.policyBundleId,
  policyBundleDigest: CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.policyBundle.policyBundleDigest,
  policyBundleVersion: CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.policyBundle.policyBundleVersion,
  minPrimaryFurnitureClearanceM: 1,
  clearanceWarningMarginM: 0.2,
  pricing: null,
};

function witness(
  snapshot: CanonicalLayoutSnapshotV0,
  ruleId: LayoutValidatorRuleId,
  context: LayoutValidatorContext = BASE_CONTEXT,
) {
  const result = runLayoutValidator(snapshot, context).witnesses.find(
    (entry) => entry.ruleId === ruleId,
  );
  if (result === undefined) throw new Error(`missing witness ${ruleId}`);
  return result;
}

function tableObject(
  objectId: string,
  x: number,
  z: number,
  rotationY = 0,
): LayoutSnapshotPlacedObject {
  return {
    objectId,
    assetDefinition: {
      assetDefinitionId: "a1ef4d89-7786-5878-bee1-87b3fac28200",
      category: "table",
      widthM: 1,
      depthM: 1,
      heightM: 0.75,
      seatCount: 10,
      collisionType: "box",
    },
    position: { x, y: 0, z },
    rotation: { x: 0, y: rotationY, z: 0 },
    scale: 1,
    sortOrder: 0,
    groupId: null,
    metadata: null,
  };
}

function withObjects(
  objects: readonly LayoutSnapshotPlacedObject[],
  guestCount = 0,
): CanonicalLayoutSnapshotV0 {
  return {
    ...CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE,
    guestCount,
    eventMetadata: {
      ...CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.eventMetadata,
      guestCount,
    },
    objects: [...objects],
  };
}

describe("layout validator kernel", () => {
  it("is deterministic and returns a schema-valid proof with a frozen validator digest", () => {
    const first = runLayoutValidator(CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE, BASE_CONTEXT);
    const second = runLayoutValidator(CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE, BASE_CONTEXT);

    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first.validatorDigest).toBe(LAYOUT_VALIDATOR_DIGEST);
    expect(LayoutValidatorRunSchema.parse(first)).toEqual(first);
  });

  it("validates canonical pose precision so one snapshot digest cannot yield divergent facts", () => {
    const withinCanonicalPrecision: CanonicalLayoutSnapshotV0 = {
      ...CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE,
      objects: CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.objects.map((object, index) =>
        index === 0
          ? {
              ...object,
              position: { ...object.position, x: 5.12341 },
              rotation: { ...object.rotation, y: 0.1234561 },
            }
          : object
      ),
    };

    expect(runLayoutValidator(withinCanonicalPrecision, BASE_CONTEXT)).toEqual(
      runLayoutValidator(CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE, BASE_CONTEXT),
    );
  });

  it("uses every rotated conservative footprint corner for room containment", () => {
    const snapshot = withObjects([
      tableObject("11111111-1111-4111-8111-111111111119", 0.65, 2, Math.PI / 4),
    ]);
    const result = witness(snapshot, "layout.footprint_containment");

    expect(result.status).toBe("fail");
    expect(result.affectedObjectIds).toEqual(["11111111-1111-4111-8111-111111111119"]);
    expect(result.facts).toMatchObject({
      outsideObjectCount: 1,
      footprintMethod: "oriented_bounding_box",
    });
  });

  it("uses chair objects as the seating basis instead of double-counting table seats", () => {
    const firstChair = CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.objects[1];
    if (firstChair === undefined) throw new Error("fixture chair missing");
    const secondChair: LayoutSnapshotPlacedObject = {
      ...firstChair,
      objectId: "99999999-9999-4999-8999-999999999999",
      position: { x: 8, y: 0, z: 4 },
    };
    const snapshot = withObjects([
      CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.objects[0] as LayoutSnapshotPlacedObject,
      firstChair,
      secondChair,
    ], 2);
    const result = witness(snapshot, "layout.seating_provision");

    expect(result.status).toBe("pass");
    expect(result.facts).toMatchObject({
      seatsProvided: 2,
      basis: "chair_objects",
      basisObjectCount: 2,
    });
  });

  it("reports measured clearance facts at, below, and near the configured threshold", () => {
    const atThreshold = withObjects([
      tableObject("11111111-1111-4111-8111-111111111111", 2, 2),
      tableObject("22222222-2222-4222-8222-222222222222", 4, 2),
    ]);
    const belowThreshold = withObjects([
      tableObject("11111111-1111-4111-8111-111111111111", 2, 2),
      tableObject("22222222-2222-4222-8222-222222222222", 3.9, 2),
    ]);

    expect(witness(atThreshold, "layout.primary_furniture_clearance").status).toBe("warn");
    const exact = witness(atThreshold, "layout.primary_furniture_clearance", {
      ...BASE_CONTEXT,
      clearanceWarningMarginM: 0,
    });
    expect(exact.status).toBe("pass");
    expect(exact.facts).toMatchObject({ measuredM: 1, requiredM: 1, shortfallM: 0 });

    const below = witness(belowThreshold, "layout.primary_furniture_clearance");
    expect(below.status).toBe("fail");
    expect(below.facts).toMatchObject({ measuredM: 0.9, requiredM: 1, shortfallM: 0.1 });
    expect(below.affectedObjectIds).toEqual([
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ]);
  });

  it("fails closed when pricing is missing and compares exact integer minor units when present", () => {
    const missing = witness(
      CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE,
      "layout.budget",
    );
    expect(missing.status).toBe("not_checked");
    expect(missing.dataSufficiency?.outcome).toBe("not_checked");
    expect(missing.reviewGate?.reason).toBe("missing_required_data");

    const exact = witness(CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE, "layout.budget", {
      ...BASE_CONTEXT,
      pricing: {
        currency: "GBP",
        budgetLimitMinor: 125_000,
        projectedTotalMinor: 125_000,
        priceBookRef: "price-book:v1",
      },
    });
    expect(exact.status).toBe("pass");
    expect(exact.facts).toMatchObject({ varianceMinor: 0, overrunMinor: 0 });

    const over = witness(CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE, "layout.budget", {
      ...BASE_CONTEXT,
      pricing: {
        currency: "GBP",
        budgetLimitMinor: 124_999,
        projectedTotalMinor: 125_000,
        priceBookRef: "price-book:v1",
      },
    });
    expect(over.status).toBe("fail");
    expect(over.facts).toMatchObject({ varianceMinor: -1, overrunMinor: 1 });
  });

  it("changes proof identity with snapshot or policy facts and keeps witness payloads machine-safe", () => {
    const baseline = runLayoutValidator(CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE, BASE_CONTEXT);
    const changedPolicy = runLayoutValidator(CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE, {
      ...BASE_CONTEXT,
      minPrimaryFurnitureClearanceM: 1.01,
    });
    const changedSnapshot = runLayoutValidator({
      ...CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE,
      guestCount: 121,
      eventMetadata: {
        ...CANONICAL_LAYOUT_SNAPSHOT_V0_FIXTURE.eventMetadata,
        guestCount: 121,
      },
    }, BASE_CONTEXT);

    expect(changedPolicy.proofDigest).not.toBe(baseline.proofDigest);
    expect(changedSnapshot.proofDigest).not.toBe(baseline.proofDigest);
    const payload = JSON.stringify(baseline.witnesses).toLowerCase();
    for (const unsafePhrase of [
      "certified",
      "legally compliant",
      "fire approved",
      "approved for occupancy",
      "guaranteed accessible",
    ]) {
      expect(payload).not.toContain(unsafePhrase);
    }
  });
});
