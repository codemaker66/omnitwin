import { createHash } from "node:crypto";
import { isSharedArrayBuffer } from "node:util/types";
import { runInNewContext } from "node:vm";

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
  computeGrandHallRoom9FaceOrdinalInventorySha256,
  computeGrandHallRoom9InterfaceFaceOrdinalInventorySha256,
  computeGrandHallRoom9SharedVertexInventorySha256,
  type GrandHallCoordinatePairIntakeV1,
  type GrandHallCoordinatePairIntakeV1Material,
  type GrandHallCoordinatePairObjAnchorV1,
  type GrandHallCoordinatePairQ9Vec3,
} from "@omnitwin/types";

import {
  GrandHallCoordinatePairIntakeObjVerificationError,
  verifyGrandHallCoordinatePairIntakeObjs,
} from "../grand-hall-coordinate-pair-intake-verifier.js";

function digest(seed: number): `sha256:${string}` {
  return `sha256:${seed.toString(16).padStart(64, "0")}`;
}

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function sha256(value: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

const fitPositions: readonly GrandHallCoordinatePairQ9Vec3[] = [
  [-1, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1],
  [1, 1, 0], [1, 0, 1], [0, 1, 1], [1, 1, 1],
];
const heldOutPositions: readonly GrandHallCoordinatePairQ9Vec3[] = [
  [10, 0, 0], [11, 0, 0], [10, 1, 0], [10, 0, 1], [11, 1, 0], [11, 1, 1],
];
const sourceControlPositions = [...fitPositions, ...heldOutPositions];

function translated(point: GrandHallCoordinatePairQ9Vec3): GrandHallCoordinatePairQ9Vec3 {
  return [point[0] + 2, point[1] + 3, point[2] + 4];
}

interface ObjFixture {
  readonly bytes: Uint8Array;
  readonly vertices: readonly GrandHallCoordinatePairQ9Vec3[];
  readonly faceCount: number;
  readonly bounds: {
    readonly min: GrandHallCoordinatePairQ9Vec3;
    readonly max: GrandHallCoordinatePairQ9Vec3;
  };
}

function bounds(vertices: readonly GrandHallCoordinatePairQ9Vec3[]): ObjFixture["bounds"] {
  const min: [number, number, number] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max: [number, number, number] = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const vertex of vertices) {
    for (const axis of [0, 1, 2] as const) {
      min[axis] = Math.min(min[axis], vertex[axis]);
      max[axis] = Math.max(max[axis], vertex[axis]);
    }
  }
  return { min, max };
}

function triangleVertices(point: GrandHallCoordinatePairQ9Vec3): readonly GrandHallCoordinatePairQ9Vec3[] {
  return [point, [point[0] + 0.25, point[1], point[2]], [point[0], point[1] + 0.25, point[2]]];
}

function sourceObjFixture(): ObjFixture {
  const vertices: GrandHallCoordinatePairQ9Vec3[] = sourceControlPositions
    .flatMap(triangleVertices)
    .map((vertex, index) => index === 3 ? [1.000000002, vertex[1], vertex[2]] : vertex);
  const lines = [
    ...vertices.map((vertex, index) => {
      if (index === 0) return "v -0.9999999995 0 0";
      if (index === 3) return "v 1.0000000015 0 0";
      return `v ${String(vertex[0])} ${String(vertex[1])} ${String(vertex[2])}`;
    }),
    ...sourceControlPositions.map((_, index) => {
      const first = index * 3 + 1;
      return `f ${String(first)} ${String(first + 1)} ${String(first + 2)}`;
    }),
    "",
  ];
  return { bytes: bytes(lines.join("\n")), vertices, faceCount: sourceControlPositions.length, bounds: bounds(vertices) };
}

function targetObjFixture(): ObjFixture {
  const controlVertices = sourceControlPositions.map(translated).flatMap(triangleVertices);
  const interfaceVertices: readonly GrandHallCoordinatePairQ9Vec3[] = [
    [20, 0, 0], [20.25, 0, 0], [20, 0.25, 0],
  ];
  const outsideOnlyVertices: readonly GrandHallCoordinatePairQ9Vec3[] = [[20, -1, 0], [20, -1, 1]];
  const vertices = [...controlVertices, ...interfaceVertices, ...outsideOnlyVertices];
  const lines = [
    ...vertices.map((vertex) => `v ${String(vertex[0])} ${String(vertex[1])} ${String(vertex[2])}`),
    "g chunk000_group001_sub009",
    "usemtl room9.jpg",
    ...sourceControlPositions.map((_, index) => {
      const first = index * 3 + 1;
      return `f ${String(first)} ${String(first + 1)} ${String(first + 2)}`;
    }),
    "f 43 44 45",
    "g chunk001_group001_sub010",
    "usemtl room10.jpg",
    "f 43 46 47",
    "",
  ];
  return { bytes: bytes(lines.join("\n")), vertices, faceCount: 16, bounds: bounds(vertices) };
}

const sourceFixture = sourceObjFixture();
const targetFixture = targetObjFixture();

function evidence(role: "source_view" | "target_view" | "measurement_record", seed: number) {
  return {
    role,
    sha256: digest(seed),
    byteLength: 100 + seed,
    mimeType: role === "measurement_record" ? "application/json" as const : "image/png" as const,
  };
}

function nominations() {
  return sourceControlPositions.map((_, index) => ({
    nominationId: `nom-${index.toString().padStart(2, "0")}`,
    status: "candidate_visible_only" as const,
    label: `Control ${index.toString().padStart(2, "0")}`,
    featureClass: "architectural_detail" as const,
    seedRank: index + 1,
    evidenceRefs: [evidence("source_view", 100 + index), evidence("target_view", 200 + index)],
  }));
}

function anchor(
  objSha256: `sha256:${string}`,
  faceOrdinal: number,
  vertices: readonly GrandHallCoordinatePairQ9Vec3[],
  groupName: string | null,
  materialName: string | null,
): GrandHallCoordinatePairObjAnchorV1 {
  const first = faceOrdinal * 3;
  const a = vertices[first];
  const b = vertices[first + 1];
  const c = vertices[first + 2];
  if (a === undefined || b === undefined || c === undefined) throw new Error("test anchor vertices missing");
  return {
    objSha256,
    sourceFaceOrdinal0Based: faceOrdinal,
    resolvedVertexIndices0Based: [first, first + 1, first + 2],
    vertexPositionsQ9: [a, b, c],
    barycentricWeightsQ9: [1_000_000_000, 0, 0],
    positionQ9: a,
    expectedGroupName: groupName,
    expectedMaterialName: materialName,
  };
}

function coordinatePairs() {
  return sourceControlPositions.map((_, index) => ({
    pairId: `pair-${index.toString().padStart(2, "0")}`,
    nominationId: `nom-${index.toString().padStart(2, "0")}`,
    label: `Control ${index.toString().padStart(2, "0")}`,
    featureClass: "architectural_detail" as const,
    splitRole: index < 8 ? "fit" as const : "held_out" as const,
    distributionTags: [...GRAND_HALL_CONTROL_DISTRIBUTION_TAGS],
    sourcePoint: {
      frame: "ARF" as const,
      anchor: anchor(sha256(sourceFixture.bytes), index, sourceFixture.vertices, null, null),
    },
    targetPoint: {
      frame: "CVF" as const,
      anchor: anchor(
        sha256(targetFixture.bytes), index, targetFixture.vertices,
        "chunk000_group001_sub009", "room9.jpg",
      ),
      e57PointSupport: null,
    },
    recordedAt: "2026-08-28T10:00:00.000Z",
    recordedBy: "human-operator",
    evidenceRefs: [evidence("measurement_record", 300 + index)],
    note: "Human-recorded exact source face and barycentric coordinate.",
  }));
}

function split(pairs: ReturnType<typeof coordinatePairs>) {
  const material = {
    frozenBeforeSolve: true as const,
    fitPairIds: pairs.filter((pair) => pair.splitRole === "fit").map((pair) => pair.pairId),
    heldOutPairIds: pairs.filter((pair) => pair.splitRole === "held_out").map((pair) => pair.pairId),
  };
  return { ...material, splitSha256: computeGrandHallCoordinatePairSplitSha256(material) };
}

function packetMaterial(
  state: "nomination_only" | "coordinates_recorded" = "nomination_only",
  revision = state === "nomination_only" ? 1 : 2,
  predecessorArtifactSha256: string | null = state === "nomination_only"
    ? null
    : initialPacket().artifactSha256,
): GrandHallCoordinatePairIntakeV1Material {
  const visible = nominations();
  const pairs = state === "nomination_only" ? [] : coordinatePairs();
  const room9FaceOrdinals = Array.from({ length: 15 }, (_, index) => index);
  const material = {
    schemaVersion: GRAND_HALL_ARF_CVF_COORDINATE_PAIR_INTAKE_V1,
    packetId: "grand-hall-verifier-fixture",
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
        sha256: sha256(sourceFixture.bytes),
        byteLength: sourceFixture.bytes.byteLength,
        vertexRecordCount: sourceFixture.vertices.length,
        faceRecordCount: sourceFixture.faceCount,
        bounds: sourceFixture.bounds,
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
        sha256: sha256(targetFixture.bytes),
        byteLength: targetFixture.bytes.byteLength,
        vertexRecordCount: targetFixture.vertices.length,
        faceRecordCount: targetFixture.faceCount,
        bounds: targetFixture.bounds,
      },
      room9: {
        groupIndex: 1,
        subIndex: 9,
        exactObjGroupSuffix: "_group001_sub009",
        faceCount: room9FaceOrdinals.length,
        evidenceFaceOrdinalsSha256: digest(16),
        verifiedFaceOrdinalInventorySha256: computeGrandHallRoom9FaceOrdinalInventorySha256(room9FaceOrdinals),
        sharedVertexCount: 1,
        sharedVertexInventorySha256: computeGrandHallRoom9SharedVertexInventorySha256([42]),
        interfaceFaceCount: 1,
        interfaceFaceOrdinalInventorySha256: computeGrandHallRoom9InterfaceFaceOrdinalInventorySha256([14]),
      },
      e57: {
        sha256: digest(20), byteLength: 20_518_437_888,
        rootGuid: "424ff41f6e5d41969c635fcd61be9b3f",
        scanCount: 149, data3DGuidSha256: digest(21), poseSha256: digest(22),
        coordinateConvention: "E57 data3D pose; quaternion [w,x,y,z], translation [x,y,z] metres, Z-up",
      },
      e57PointSupport: null,
    },
    nominationSeed: {
      authority: "none",
      seedArtifactSha256: digest(23), implementationSha256: digest(24), configurationSha256: digest(25),
      sourceSelectionInventorySha256: digest(26), targetSelectionInventorySha256: digest(27),
      sourceSelectionCount: 24_977, targetSelectionCount: 59_049,
      method: "mutual_nearest_neighbor_point_to_point_icp",
      permittedUse: "review_overlay_candidate_nomination_only",
      matrixStoredOnlyInSeedArtifact: true,
      matrixUsedAsMeasurement: false,
      matrixUsedAsSolverInput: false,
    },
    state,
    nominations: visible,
    nominationInventorySha256: computeGrandHallCoordinatePairNominationInventorySha256(visible),
    coordinatePairs: pairs,
    coordinatePairInventorySha256: computeGrandHallCoordinatePairInventorySha256(pairs),
    split: pairs.length === 0 ? null : split(pairs),
    humanReview: null,
    rejection: null,
    guardrails: {
      sourceBytesMutated: false, targetBytesMutated: false,
      coordinatesGenerated: false, candidateLandmarksGenerated: false,
      icpPromoted: false, icpMatrixUsedAsMeasurement: false, icpMatrixUsedAsSolverInput: false,
      solverOutputCreated: false, transformArtifactCreated: false, e57PointAuthorityClaimed: false,
      operationalGeometryCreated: false, runtimeAuthorityGranted: false, publicExposureChanged: false,
    },
  };
  return GrandHallCoordinatePairIntakeV1MaterialSchema.parse(material);
}

function packet(material: GrandHallCoordinatePairIntakeV1Material): GrandHallCoordinatePairIntakeV1 {
  return GrandHallCoordinatePairIntakeV1Schema.parse({
    ...material,
    artifactSha256: computeGrandHallCoordinatePairIntakeV1Sha256(material),
  });
}

function initialPacket(): GrandHallCoordinatePairIntakeV1 {
  return packet(packetMaterial("nomination_only", 1, null));
}

function expectCode(
  action: () => unknown,
  code: GrandHallCoordinatePairIntakeObjVerificationError["code"],
): void {
  try {
    action();
    throw new Error("expected verifier failure");
  } catch (error) {
    expect(error).toBeInstanceOf(GrandHallCoordinatePairIntakeObjVerificationError);
    expect((error as GrandHallCoordinatePairIntakeObjVerificationError).code).toBe(code);
  }
}

describe("Grand Hall coordinate-pair OBJ verifier", () => {
  it("verifies exact OBJ identities for a coordinate-free nomination packet", () => {
    const result = verifyGrandHallCoordinatePairIntakeObjs({
      packet: packet(packetMaterial()),
      sourceBigObjBytes: sourceFixture.bytes,
      targetMatterPakObjBytes: targetFixture.bytes,
    });
    expect(result).toMatchObject({
      authority: "none",
      packetState: "nomination_only",
      sourceAnchorCount: 0,
      targetAnchorCount: 0,
      room9FaceCount: 15,
      room9SharedVertexCount: 1,
      rejectedInterfaceFaceCount: 1,
      cleanupMarkerFacesVerified: false,
      e57PointSupportVerified: false,
      transformCreated: false,
    });
  });

  it("verifies exact positive/negative half-away Q9 tokens and fourteen anchors", () => {
    const result = verifyGrandHallCoordinatePairIntakeObjs({
      packet: packet(packetMaterial("coordinates_recorded")),
      predecessor: initialPacket(),
      sourceBigObjBytes: sourceFixture.bytes,
      targetMatterPakObjBytes: targetFixture.bytes,
    });
    expect(result.sourceAnchorCount).toBe(14);
    expect(result.targetAnchorCount).toBe(14);
    expect(result.transformCreated).toBe(false);
  });

  it("rejects a same-count spatial OBJ swap through exact byte identity", () => {
    const swapped = bytes(
      new TextDecoder().decode(sourceFixture.bytes).replace("-0.9999999995", "-9.9999999995"),
    );
    expectCode(() => verifyGrandHallCoordinatePairIntakeObjs({
      packet: packet(packetMaterial()),
      sourceBigObjBytes: swapped,
      targetMatterPakObjBytes: targetFixture.bytes,
    }), "OBJ_IDENTITY_MISMATCH");
  });

  it("rejects a forged barycentric position even when the packet digest is recomputed", () => {
    const material = structuredClone(packetMaterial("coordinates_recorded"));
    material.coordinatePairs[0]!.sourcePoint.anchor.positionQ9 = [0.001, 0, 0];
    material.coordinatePairInventorySha256 = computeGrandHallCoordinatePairInventorySha256(material.coordinatePairs);
    const forged = packet(GrandHallCoordinatePairIntakeV1MaterialSchema.parse(material));
    expectCode(() => verifyGrandHallCoordinatePairIntakeObjs({
      packet: forged,
      predecessor: initialPacket(),
      sourceBigObjBytes: sourceFixture.bytes,
      targetMatterPakObjBytes: targetFixture.bytes,
    }), "ANCHOR_MISMATCH");
  });

  it("uses exact integer Q9 accumulation and half-away-from-zero rounding", () => {
    const material = structuredClone(packetMaterial("coordinates_recorded"));
    const pair = material.coordinatePairs[0]!;
    pair.sourcePoint.anchor.barycentricWeightsQ9 = [999_999_998, 2, 0];
    pair.sourcePoint.anchor.positionQ9 = [-1, 0, 0];
    pair.targetPoint.anchor.barycentricWeightsQ9 = [999_999_998, 2, 0];
    pair.targetPoint.anchor.positionQ9 = [1.000000001, 3, 4];
    material.coordinatePairInventorySha256 = computeGrandHallCoordinatePairInventorySha256(material.coordinatePairs);
    const exactHalfPacket = packet(GrandHallCoordinatePairIntakeV1MaterialSchema.parse(material));
    expect(() => verifyGrandHallCoordinatePairIntakeObjs({
      packet: exactHalfPacket,
      predecessor: initialPacket(),
      sourceBigObjBytes: sourceFixture.bytes,
      targetMatterPakObjBytes: targetFixture.bytes,
    })).not.toThrow();
    expect(Object.is(pair.sourcePoint.anchor.positionQ9[0], -0)).toBe(false);
  });

  it("rejects reordered face vertices even with matching stored vertex positions", () => {
    const material = structuredClone(packetMaterial("coordinates_recorded"));
    const anchor = material.coordinatePairs[0]!.sourcePoint.anchor;
    anchor.resolvedVertexIndices0Based = [1, 0, 2];
    anchor.vertexPositionsQ9 = [anchor.vertexPositionsQ9[1], anchor.vertexPositionsQ9[0], anchor.vertexPositionsQ9[2]];
    anchor.positionQ9 = anchor.vertexPositionsQ9[0];
    material.coordinatePairInventorySha256 = computeGrandHallCoordinatePairInventorySha256(material.coordinatePairs);
    const forged = packet(GrandHallCoordinatePairIntakeV1MaterialSchema.parse(material));
    expectCode(() => verifyGrandHallCoordinatePairIntakeObjs({
      packet: forged,
      predecessor: initialPacket(),
      sourceBigObjBytes: sourceFixture.bytes,
      targetMatterPakObjBytes: targetFixture.bytes,
    }), "ANCHOR_MISMATCH");
  });

  it("rejects a room-9 target face sharing a source vertex with another room", () => {
    const material = structuredClone(packetMaterial("coordinates_recorded"));
    const targetAnchor = anchor(
      sha256(targetFixture.bytes), 14, targetFixture.vertices,
      "chunk000_group001_sub009", "room9.jpg",
    );
    material.coordinatePairs[0]!.targetPoint.anchor = targetAnchor;
    material.coordinatePairInventorySha256 = computeGrandHallCoordinatePairInventorySha256(material.coordinatePairs);
    const interfacePacket = packet(GrandHallCoordinatePairIntakeV1MaterialSchema.parse(material));
    expectCode(() => verifyGrandHallCoordinatePairIntakeObjs({
      packet: interfacePacket,
      predecessor: initialPacket(),
      sourceBigObjBytes: sourceFixture.bytes,
      targetMatterPakObjBytes: targetFixture.bytes,
    }), "INTERFACE_ANCHOR_REJECTED");
  });

  it("rejects a target face that is outside exact room 9", () => {
    const material = structuredClone(packetMaterial("coordinates_recorded"));
    material.coordinatePairs[0]!.targetPoint.anchor = {
      ...anchor(sha256(targetFixture.bytes), 14, targetFixture.vertices, "chunk000_group001_sub009", "room9.jpg"),
      sourceFaceOrdinal0Based: 15,
      resolvedVertexIndices0Based: [42, 45, 46],
      vertexPositionsQ9: [targetFixture.vertices[42]!, targetFixture.vertices[45]!, targetFixture.vertices[46]!],
      positionQ9: targetFixture.vertices[42]!,
    };
    material.coordinatePairInventorySha256 = computeGrandHallCoordinatePairInventorySha256(material.coordinatePairs);
    const outsidePacket = packet(GrandHallCoordinatePairIntakeV1MaterialSchema.parse(material));
    expectCode(() => verifyGrandHallCoordinatePairIntakeObjs({
      packet: outsidePacket,
      predecessor: initialPacket(),
      sourceBigObjBytes: sourceFixture.bytes,
      targetMatterPakObjBytes: targetFixture.bytes,
    }), "ANCHOR_MISMATCH");
  });

  it("rejects forged room-9 shared/interface inventories", () => {
    const material = packetMaterial();
    const forged = packet(GrandHallCoordinatePairIntakeV1MaterialSchema.parse({
      ...material,
      targetBindings: {
        ...material.targetBindings,
        room9: { ...material.targetBindings.room9, sharedVertexCount: 0 },
      },
    }));
    expectCode(() => verifyGrandHallCoordinatePairIntakeObjs({
      packet: forged,
      sourceBigObjBytes: sourceFixture.bytes,
      targetMatterPakObjBytes: targetFixture.bytes,
    }), "ROOM9_INVENTORY_MISMATCH");
  });

  it("requires the exact predecessor for every later packet", () => {
    const first = packet(packetMaterial());
    const second = packet(packetMaterial("coordinates_recorded", 2, first.artifactSha256));
    expect(() => verifyGrandHallCoordinatePairIntakeObjs({
      packet: second,
      predecessor: first,
      sourceBigObjBytes: sourceFixture.bytes,
      targetMatterPakObjBytes: targetFixture.bytes,
    })).not.toThrow();
    expectCode(() => verifyGrandHallCoordinatePairIntakeObjs({
      packet: second,
      sourceBigObjBytes: sourceFixture.bytes,
      targetMatterPakObjBytes: targetFixture.bytes,
    }), "INVALID_SUCCESSOR");
  });

  it("rejects non-triangular OBJ input instead of inventing a triangulation", () => {
    const invalid = bytes("v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n");
    expectCode(() => verifyGrandHallCoordinatePairIntakeObjs({
      packet: packet(packetMaterial()),
      sourceBigObjBytes: invalid,
      targetMatterPakObjBytes: targetFixture.bytes,
    }), "INVALID_OBJ");
  });

  it("rejects non-decimal and out-of-domain OBJ coordinate tokens", () => {
    const sourceText = new TextDecoder().decode(sourceFixture.bytes);
    for (const invalidToken of ["0x1", "1000000.000000001"]) {
      const invalid = bytes(sourceText.replace("-0.9999999995", invalidToken));
      expectCode(() => verifyGrandHallCoordinatePairIntakeObjs({
        packet: packet(packetMaterial()),
        sourceBigObjBytes: invalid,
        targetMatterPakObjBytes: targetFixture.bytes,
      }), "INVALID_OBJ");
    }
  });

  it("snapshots ordinary caller bytes before packet access can mutate them", () => {
    const mutableSource = sourceFixture.bytes.slice();
    const exactPacket = packet(packetMaterial());
    const input = {
      get packet(): GrandHallCoordinatePairIntakeV1 {
        mutableSource[0] = (mutableSource[0] ?? 0) ^ 0xff;
        return exactPacket;
      },
      sourceBigObjBytes: mutableSource,
      targetMatterPakObjBytes: targetFixture.bytes,
    };
    expect(() => verifyGrandHallCoordinatePairIntakeObjs(input)).not.toThrow();
    expect(mutableSource).not.toEqual(sourceFixture.bytes);
  });

  it("rejects SharedArrayBuffer-backed source views before hashing or parsing", () => {
    const shared = new Uint8Array(new SharedArrayBuffer(sourceFixture.bytes.byteLength));
    shared.set(sourceFixture.bytes);
    expectCode(() => verifyGrandHallCoordinatePairIntakeObjs({
      packet: packet(packetMaterial()),
      sourceBigObjBytes: shared,
      targetMatterPakObjBytes: targetFixture.bytes,
    }), "INVALID_OBJ");
  });

  it("rejects a cross-realm SharedArrayBuffer that defeats instanceof", () => {
    const crossRealmValue: unknown = runInNewContext(
      `new SharedArrayBuffer(${String(sourceFixture.bytes.byteLength)})`,
    );
    if (!isSharedArrayBuffer(crossRealmValue)) throw new Error("cross-realm test fixture is not SharedArrayBuffer");
    expect(crossRealmValue instanceof SharedArrayBuffer).toBe(false);
    const shared = new Uint8Array(crossRealmValue);
    shared.set(sourceFixture.bytes);
    expectCode(() => verifyGrandHallCoordinatePairIntakeObjs({
      packet: packet(packetMaterial()),
      sourceBigObjBytes: shared,
      targetMatterPakObjBytes: targetFixture.bytes,
    }), "INVALID_OBJ");
  });
});
