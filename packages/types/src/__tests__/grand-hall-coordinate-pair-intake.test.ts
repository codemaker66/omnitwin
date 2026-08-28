import { describe, expect, it } from "vitest";

import {
  GRAND_HALL_ARF_CVF_COORDINATE_PAIR_INTAKE_V1,
  GRAND_HALL_CONTROL_DISTRIBUTION_TAGS,
  GrandHallCoordinatePairIntakeV1MaterialSchema,
  GrandHallCoordinatePairIntakeV1Schema,
  computeGrandHallCoordinatePairIntakeV1Sha256,
  computeGrandHallCoordinatePairInventorySha256,
  computeGrandHallCoordinatePairNominationInventorySha256,
  computeGrandHallCoordinatePairSplitSha256,
  verifyGrandHallCoordinatePairIntakeV1Successor,
  type GrandHallCoordinatePairIntakeV1,
  type GrandHallCoordinatePairIntakeV1Material,
  type GrandHallCoordinatePairObjAnchorV1,
  type GrandHallCoordinatePairQ9Vec3,
} from "../grand-hall-coordinate-pair-intake.js";

function digest(seed: number): `sha256:${string}` {
  return `sha256:${seed.toString(16).padStart(64, "0")}`;
}

const sourceEvidence = [
  { role: "source_view" as const, sha256: digest(30), byteLength: 100, mimeType: "image/png" as const },
  { role: "target_view" as const, sha256: digest(31), byteLength: 101, mimeType: "image/png" as const },
];

const fitPositions: readonly GrandHallCoordinatePairQ9Vec3[] = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1],
  [1, 1, 0], [1, 0, 1], [0, 1, 1], [1, 1, 1],
];
const heldOutPositions: readonly GrandHallCoordinatePairQ9Vec3[] = [
  [10, 0, 0], [11, 0, 0], [10, 1, 0], [10, 0, 1], [11, 1, 0], [11, 1, 1],
];
const positions = [...fitPositions, ...heldOutPositions];

function translated(point: GrandHallCoordinatePairQ9Vec3): GrandHallCoordinatePairQ9Vec3 {
  return [point[0] + 2, point[1] + 3, point[2] + 4];
}

function anchor(
  objSha256: `sha256:${string}`,
  faceOrdinal: number,
  point: GrandHallCoordinatePairQ9Vec3,
  expectedGroupName: string | null,
): GrandHallCoordinatePairObjAnchorV1 {
  return {
    objSha256,
    sourceFaceOrdinal0Based: faceOrdinal,
    resolvedVertexIndices0Based: [faceOrdinal * 3, faceOrdinal * 3 + 1, faceOrdinal * 3 + 2],
    vertexPositionsQ9: [
      point,
      [point[0] + 0.1, point[1], point[2]],
      [point[0], point[1] + 0.1, point[2]],
    ],
    barycentricWeightsQ9: [1_000_000_000, 0, 0],
    positionQ9: point,
    expectedGroupName,
    expectedMaterialName: expectedGroupName === null ? null : "room9.jpg",
  };
}

function nominations() {
  return positions.map((_, index) => ({
    nominationId: `nom-${index.toString().padStart(2, "0")}`,
    status: "candidate_visible_only" as const,
    label: `Control ${index.toString().padStart(2, "0")}`,
    featureClass: "architectural_detail" as const,
    seedRank: index + 1,
    evidenceRefs: sourceEvidence,
  }));
}

function pairs() {
  return positions.map((point, index) => ({
    pairId: `pair-${index.toString().padStart(2, "0")}`,
    nominationId: `nom-${index.toString().padStart(2, "0")}`,
    label: `Control ${index.toString().padStart(2, "0")}`,
    featureClass: "architectural_detail" as const,
    splitRole: index < 8 ? "fit" as const : "held_out" as const,
    distributionTags: [...GRAND_HALL_CONTROL_DISTRIBUTION_TAGS],
    sourcePoint: {
      frame: "ARF" as const,
      anchor: anchor(digest(10), index, point, null),
    },
    targetPoint: {
      frame: "CVF" as const,
      anchor: anchor(digest(20), index, translated(point), "chunk000_group001_sub009"),
      e57PointSupport: null,
    },
    recordedAt: "2026-08-28T10:00:00.000Z",
    recordedBy: "human-operator",
    evidenceRefs: [{
      role: "measurement_record" as const,
      sha256: digest(100 + index),
      byteLength: 200 + index,
      mimeType: "application/json" as const,
    }],
    note: "Human-recorded exact OBJ surface anchors; diagnostic use only.",
  }));
}

function frozenSplit(coordinatePairs: ReturnType<typeof pairs>) {
  const material = {
    frozenBeforeSolve: true as const,
    fitPairIds: coordinatePairs.filter((pair) => pair.splitRole === "fit").map((pair) => pair.pairId),
    heldOutPairIds: coordinatePairs.filter((pair) => pair.splitRole === "held_out").map((pair) => pair.pairId),
  };
  return { ...material, splitSha256: computeGrandHallCoordinatePairSplitSha256(material) };
}

function baseMaterial(
  state: GrandHallCoordinatePairIntakeV1["state"] = "nomination_only",
  revision = state === "nomination_only" ? 1 : 2,
  predecessorArtifactSha256: string | null = state === "nomination_only"
    ? null
    : initialArtifactSha256(),
): GrandHallCoordinatePairIntakeV1Material {
  const visible = nominations();
  const coordinatePairs = state === "nomination_only" ? [] : pairs();
  const material = {
    schemaVersion: GRAND_HALL_ARF_CVF_COORDINATE_PAIR_INTAKE_V1,
    packetId: "grand-hall-control-intake-001",
    revision,
    predecessorArtifactSha256,
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    authority: "none",
    productionTrust: null,
    sourceBindings: {
      frame: "ARF",
      coordinateConvention: "xgrids_big_obj_native_source_z_up",
      metricAuthority: false,
      rawXgridsReceiptSha256: digest(1),
      rawXgridsInventorySha256: digest(2),
      rawXgridsXbinSha256: digest(3),
      processedBigModelGuid: "2d483e031ad40e259c75f765d6f5fcbb",
      processedBigInventorySha256: digest(4),
      historicalSogCoreInventorySha256: digest(5),
      historicalSogManifestSha256: digest(6),
      historicalFrontierReceiptSha256: digest(7),
      exactAcceptedOutputInventorySha256: null,
      bigObj: {
        sha256: digest(10), byteLength: 1_000, vertexRecordCount: 100, faceRecordCount: 50,
        bounds: { min: [-10, -10, -10], max: [20, 20, 20] },
      },
    },
    targetBindings: {
      frame: "CVF",
      coordinateConvention: "matterpak_local_metres_right_handed_z_up",
      crosswalkAuthority: "diagnostic_only",
      metricControlAuthority: false,
      matterPakE57ReceiptSha256: digest(11),
      boundaryEvidenceSha256: digest(12),
      boundaryManifestSha256: digest(13),
      interfaceAtlasSha256: digest(14),
      scopeReviewPackSha256: digest(15),
      matterPakObj: {
        sha256: digest(20), byteLength: 2_000, vertexRecordCount: 200, faceRecordCount: 100,
        bounds: { min: [-20, -20, -20], max: [30, 30, 30] },
      },
      room9: {
        groupIndex: 1,
        subIndex: 9,
        exactObjGroupSuffix: "_group001_sub009",
        faceCount: 60,
        evidenceFaceOrdinalsSha256: digest(16),
        verifiedFaceOrdinalInventorySha256: digest(17),
        sharedVertexCount: 4,
        sharedVertexInventorySha256: digest(18),
        interfaceFaceCount: 2,
        interfaceFaceOrdinalInventorySha256: digest(19),
      },
      e57: {
        sha256: digest(21),
        byteLength: 20_518_437_888,
        rootGuid: "424ff41f6e5d41969c635fcd61be9b3f",
        scanCount: 149,
        data3DGuidSha256: digest(22),
        poseSha256: digest(23),
        coordinateConvention: "E57 data3D pose; quaternion [w,x,y,z], translation [x,y,z] metres, Z-up",
      },
      e57PointSupport: null,
    },
    nominationSeed: {
      authority: "none",
      seedArtifactSha256: digest(24),
      implementationSha256: digest(25),
      configurationSha256: digest(26),
      sourceSelectionInventorySha256: digest(27),
      targetSelectionInventorySha256: digest(28),
      sourceSelectionCount: 24_977,
      targetSelectionCount: 59_049,
      method: "mutual_nearest_neighbor_point_to_point_icp",
      permittedUse: "review_overlay_candidate_nomination_only",
      matrixStoredOnlyInSeedArtifact: true,
      matrixUsedAsMeasurement: false,
      matrixUsedAsSolverInput: false,
    },
    state,
    nominations: visible,
    nominationInventorySha256: computeGrandHallCoordinatePairNominationInventorySha256(visible),
    coordinatePairs,
    coordinatePairInventorySha256: computeGrandHallCoordinatePairInventorySha256(coordinatePairs),
    split: coordinatePairs.length === 0 ? null : frozenSplit(coordinatePairs),
    humanReview: state === "human_review_complete" ? {
      state: "human_review_complete",
      reviewerType: "human",
      reviewerId: "registration-reviewer",
      reviewerRole: "survey_or_registration_reviewer",
      decision: "accept_all_recorded_pairs_for_diagnostic_fit_only",
      reviewedAt: "2026-08-28T11:00:00.000Z",
      evidenceRefs: [{
        role: "measurement_record",
        sha256: digest(29),
        byteLength: 500,
        mimeType: "application/json",
      }],
      note: "Reviewed for diagnostic fitting only; no transform or runtime authority.",
    } : null,
    rejection: state === "rejected" ? {
      state: "rejected",
      reviewerType: "human",
      reviewerId: "registration-reviewer",
      reviewerRole: "survey_or_registration_reviewer",
      rejectedAt: "2026-08-28T11:00:00.000Z",
      reason: "Candidate evidence is not suitable for coordinate collection.",
      evidenceRefs: [{
        role: "measurement_record",
        sha256: digest(29),
        byteLength: 500,
        mimeType: "application/json",
      }],
    } : null,
    guardrails: {
      sourceBytesMutated: false,
      targetBytesMutated: false,
      coordinatesGenerated: false,
      candidateLandmarksGenerated: false,
      icpPromoted: false,
      icpMatrixUsedAsMeasurement: false,
      icpMatrixUsedAsSolverInput: false,
      solverOutputCreated: false,
      transformArtifactCreated: false,
      e57PointAuthorityClaimed: false,
      operationalGeometryCreated: false,
      runtimeAuthorityGranted: false,
      publicExposureChanged: false,
    },
  };
  return GrandHallCoordinatePairIntakeV1MaterialSchema.parse(material);
}

function initialArtifactSha256(): string {
  return computeGrandHallCoordinatePairIntakeV1Sha256(baseMaterial("nomination_only", 1, null));
}

function artifact(material: GrandHallCoordinatePairIntakeV1Material): GrandHallCoordinatePairIntakeV1 {
  return GrandHallCoordinatePairIntakeV1Schema.parse({
    ...material,
    artifactSha256: computeGrandHallCoordinatePairIntakeV1Sha256(material),
  });
}

describe("GrandHallCoordinatePairIntakeV1", () => {
  it("accepts a digest-bound authority-none nomination packet with no coordinates", () => {
    const parsed = artifact(baseMaterial());
    expect(parsed.state).toBe("nomination_only");
    expect(parsed.coordinatePairs).toEqual([]);
    expect(parsed.split).toBeNull();
    expect(parsed.targetBindings.e57PointSupport).toBeNull();
    expect(parsed.authority).toBe("none");
    expect(parsed.guardrails.transformArtifactCreated).toBe(false);
  });

  it("requires the coordinate-free nomination packet to be revision 1", () => {
    expect(() => baseMaterial("coordinates_recorded", 1, null)).toThrow(
      /revision 1 must be the coordinate-free nomination-only root/u,
    );
    expect(() => baseMaterial("rejected", 1, null)).toThrow(
      /revision 1 must be the coordinate-free nomination-only root/u,
    );
  });

  it("accepts a later human-recorded 8-fit/6-held-out non-coplanar packet without residuals", () => {
    const parsed = artifact(baseMaterial("coordinates_recorded"));
    expect(parsed.coordinatePairs.filter((pair) => pair.splitRole === "fit")).toHaveLength(8);
    expect(parsed.coordinatePairs.filter((pair) => pair.splitRole === "held_out")).toHaveLength(6);
    expect("residualM" in parsed.coordinatePairs[0]!).toBe(false);
  });

  it("forbids coordinates and a split in nomination-only state", () => {
    const recorded = baseMaterial("coordinates_recorded");
    const invalid = {
      ...recorded,
      state: "nomination_only",
      humanReview: null,
    };
    expect(GrandHallCoordinatePairIntakeV1MaterialSchema.safeParse(invalid).success).toBe(false);
  });

  it("requires explicit raw XBIN, historical SOG core, and SOG manifest identities", () => {
    const valid = baseMaterial();
    const { rawXgridsXbinSha256: _removed, ...sourceBindings } = valid.sourceBindings;
    expect(GrandHallCoordinatePairIntakeV1MaterialSchema.safeParse({ ...valid, sourceBindings }).success).toBe(false);
    expect(valid.sourceBindings.historicalSogCoreInventorySha256).toBe(digest(5));
    expect(valid.sourceBindings.historicalSogManifestSha256).toBe(digest(6));
  });

  it("requires distinct image bytes for source and target visible nominations", () => {
    const invalid = structuredClone(baseMaterial());
    invalid.nominations[0]!.evidenceRefs = [
      { role: "source_view", sha256: digest(99), byteLength: 99, mimeType: "application/json" },
      { role: "target_view", sha256: digest(99), byteLength: 99, mimeType: "application/json" },
    ];
    const result = GrandHallCoordinatePairIntakeV1MaterialSchema.safeParse(invalid);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("invalid visible-only evidence unexpectedly passed");
    expect(result.error.issues.map((issue) => issue.message)).toContain(
      "source and target views must bind distinct visual evidence bytes",
    );
    expect(result.error.issues.map((issue) => issue.message)).toContain(
      "visual evidence must be image/png or image/jpeg",
    );

    const measurementSmuggle = structuredClone(baseMaterial());
    measurementSmuggle.nominations[0]!.evidenceRefs.push({
      role: "measurement_record",
      sha256: digest(98),
      byteLength: 98,
      mimeType: "application/json",
    });
    const measurementResult = GrandHallCoordinatePairIntakeV1MaterialSchema.safeParse(
      measurementSmuggle,
    );
    expect(measurementResult.success).toBe(false);
    if (measurementResult.success) throw new Error("measurement-bearing nomination unexpectedly passed");
    expect(measurementResult.error.issues.map((issue) => issue.message)).toContain(
      "visible-only nominations cannot carry measurement records",
    );
  });

  it("rejects non-Q9 coordinates, negative zero, and inexact barycentric sums", () => {
    const recorded = baseMaterial("coordinates_recorded");
    const nonQ9 = structuredClone(recorded);
    nonQ9.coordinatePairs[0]!.sourcePoint.anchor.positionQ9[0] = 0.0000000001;
    expect(GrandHallCoordinatePairIntakeV1MaterialSchema.safeParse(nonQ9).success).toBe(false);

    const negativeZero = structuredClone(recorded);
    negativeZero.coordinatePairs[0]!.sourcePoint.anchor.positionQ9[0] = -0;
    expect(GrandHallCoordinatePairIntakeV1MaterialSchema.safeParse(negativeZero).success).toBe(false);

    const collapsedHighMagnitude = structuredClone(recorded);
    const binary64CollapsedValue = Number("999999999.999999999");
    expect(binary64CollapsedValue).toBe(1_000_000_000);
    collapsedHighMagnitude.coordinatePairs[0]!.sourcePoint.anchor.positionQ9[0] = binary64CollapsedValue;
    expect(GrandHallCoordinatePairIntakeV1MaterialSchema.safeParse(collapsedHighMagnitude).success).toBe(false);

    const weights = structuredClone(recorded);
    weights.coordinatePairs[0]!.sourcePoint.anchor.barycentricWeightsQ9 = [999_999_999, 0, 0];
    expect(GrandHallCoordinatePairIntakeV1MaterialSchema.safeParse(weights).success).toBe(false);
  });

  it("rejects duplicate seed ranks, reused anchors, and fit/held-out underfill", () => {
    const nominationOnly = baseMaterial();
    const duplicateRank = structuredClone(nominationOnly);
    duplicateRank.nominations[1]!.seedRank = duplicateRank.nominations[0]!.seedRank;
    duplicateRank.nominationInventorySha256 = computeGrandHallCoordinatePairNominationInventorySha256(
      duplicateRank.nominations,
    );
    expect(GrandHallCoordinatePairIntakeV1MaterialSchema.safeParse(duplicateRank).success).toBe(false);

    const recorded = baseMaterial("coordinates_recorded");
    const reused = structuredClone(recorded);
    reused.coordinatePairs[1]!.sourcePoint.anchor = reused.coordinatePairs[0]!.sourcePoint.anchor;
    reused.coordinatePairInventorySha256 = computeGrandHallCoordinatePairInventorySha256(reused.coordinatePairs);
    expect(GrandHallCoordinatePairIntakeV1MaterialSchema.safeParse(reused).success).toBe(false);

    const underfilled = structuredClone(recorded);
    underfilled.coordinatePairs = underfilled.coordinatePairs.slice(1);
    underfilled.coordinatePairInventorySha256 = computeGrandHallCoordinatePairInventorySha256(underfilled.coordinatePairs);
    underfilled.split = frozenSplit(underfilled.coordinatePairs as ReturnType<typeof pairs>);
    expect(GrandHallCoordinatePairIntakeV1MaterialSchema.safeParse(underfilled).success).toBe(false);
  });

  it("rejects coplanar and distribution-incomplete fit or held-out controls", () => {
    const recorded = baseMaterial("coordinates_recorded");
    const coplanar = structuredClone(recorded);
    for (const pair of coplanar.coordinatePairs.filter((item) => item.splitRole === "held_out")) {
      pair.sourcePoint.anchor.positionQ9[2] = 0;
    }
    coplanar.coordinatePairInventorySha256 = computeGrandHallCoordinatePairInventorySha256(coplanar.coordinatePairs);
    expect(GrandHallCoordinatePairIntakeV1MaterialSchema.safeParse(coplanar).success).toBe(false);

    const incomplete = structuredClone(recorded);
    for (const pair of incomplete.coordinatePairs.filter((item) => item.splitRole === "fit")) {
      pair.distributionTags = ["floor"];
    }
    incomplete.coordinatePairInventorySha256 = computeGrandHallCoordinatePairInventorySha256(incomplete.coordinatePairs);
    expect(GrandHallCoordinatePairIntakeV1MaterialSchema.safeParse(incomplete).success).toBe(false);
  });

  it("forces E57 point support and accepted output inventory to remain null", () => {
    const valid = baseMaterial();
    expect(GrandHallCoordinatePairIntakeV1MaterialSchema.safeParse({
      ...valid,
      targetBindings: { ...valid.targetBindings, e57PointSupport: { scanIndex: 0, pointIndex: 1 } },
    }).success).toBe(false);
    expect(GrandHallCoordinatePairIntakeV1MaterialSchema.safeParse({
      ...valid,
      sourceBindings: { ...valid.sourceBindings, exactAcceptedOutputInventorySha256: digest(40) },
    }).success).toBe(false);
  });

  it("binds every field into a domain-separated artifact digest", () => {
    const parsed = artifact(baseMaterial());
    expect(GrandHallCoordinatePairIntakeV1Schema.safeParse({
      ...parsed,
      nominationSeed: { ...parsed.nominationSeed, sourceSelectionCount: 24_976 },
    }).success).toBe(false);
  });

  it("accepts only exact immutable successor transitions", () => {
    const first = artifact(baseMaterial());
    const second = artifact(baseMaterial("coordinates_recorded", 2, first.artifactSha256));
    expect(verifyGrandHallCoordinatePairIntakeV1Successor(first, second)).toEqual(second);

    const third = artifact(baseMaterial("human_review_complete", 3, second.artifactSha256));
    expect(verifyGrandHallCoordinatePairIntakeV1Successor(second, third)).toEqual(third);

    const changedPairMaterial = structuredClone(
      baseMaterial("human_review_complete", 3, second.artifactSha256),
    );
    changedPairMaterial.coordinatePairs[0]!.note = "A successor cannot revise a recorded control.";
    changedPairMaterial.coordinatePairInventorySha256 = computeGrandHallCoordinatePairInventorySha256(
      changedPairMaterial.coordinatePairs,
    );
    const changedPair = artifact(GrandHallCoordinatePairIntakeV1MaterialSchema.parse(changedPairMaterial));
    expect(() => verifyGrandHallCoordinatePairIntakeV1Successor(second, changedPair)).toThrow(
      /immutable coordinatePairs/u,
    );

    const changedBindingsMaterial = {
      ...baseMaterial("coordinates_recorded", 2, first.artifactSha256),
      sourceBindings: {
        ...first.sourceBindings,
        rawXgridsReceiptSha256: digest(99),
      },
    };
    const changedBindings = artifact(
      GrandHallCoordinatePairIntakeV1MaterialSchema.parse(changedBindingsMaterial),
    );
    expect(() => verifyGrandHallCoordinatePairIntakeV1Successor(first, changedBindings)).toThrow(
      /immutable sourceBindings/u,
    );
  });

  it("does not let nomination-only rejection smuggle in coordinate pairs", () => {
    const first = artifact(baseMaterial());
    const recorded = baseMaterial("coordinates_recorded", 2, first.artifactSha256);
    const invalidRejectedMaterial = GrandHallCoordinatePairIntakeV1MaterialSchema.parse({
      ...recorded,
      state: "rejected",
      rejection: baseMaterial("rejected").rejection,
    });
    const rejected = artifact(invalidRejectedMaterial);
    expect(() => verifyGrandHallCoordinatePairIntakeV1Successor(first, rejected)).toThrow(
      /cannot introduce coordinate pairs/u,
    );

    const invalidUnderfilled = structuredClone(baseMaterial("rejected"));
    invalidUnderfilled.coordinatePairs = invalidUnderfilled.coordinatePairs.slice(0, 1);
    invalidUnderfilled.coordinatePairInventorySha256 = computeGrandHallCoordinatePairInventorySha256(
      invalidUnderfilled.coordinatePairs,
    );
    invalidUnderfilled.split = null;
    expect(GrandHallCoordinatePairIntakeV1MaterialSchema.safeParse(invalidUnderfilled).success).toBe(false);
  });
});
