import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  FOUNDRY_POTREE_V2_HIERARCHY_RECORD_BYTES,
  FOUNDRY_POTREE_V2_POINT_RECORD_BYTES,
  FOUNDRY_POTREE_V2_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE,
  FoundryPotreeV2BundleFactsSchema,
  createPotreeV2SourceFactsCollector,
  discoverPotreeV2BundleCandidates,
  type FoundryPotreeV2BundleMemberIdentity,
  type FoundryPotreeV2BundleMemberRole,
  type FoundryPotreeV2SourceFactsFailureCode,
  type FoundryPotreeV2SourceFactsOutcome,
} from "../potree-v2-source-facts.js";

interface HierarchyRecord {
  readonly type: 0 | 1 | 2;
  readonly childMask: number;
  readonly pointCount: number;
  readonly byteOffset: number;
  readonly byteSize: number;
}

interface BundleFixture {
  readonly bundleRoot: string;
  readonly metadata: Buffer;
  readonly hierarchy: Buffer;
  readonly octree: Buffer;
}

function hierarchyRecord(record: HierarchyRecord): Buffer {
  const bytes = Buffer.alloc(FOUNDRY_POTREE_V2_HIERARCHY_RECORD_BYTES);
  bytes.writeUInt8(record.type, 0);
  bytes.writeUInt8(record.childMask, 1);
  bytes.writeUInt32LE(record.pointCount, 2);
  bytes.writeBigUInt64LE(BigInt(record.byteOffset), 6);
  bytes.writeBigUInt64LE(BigInt(record.byteSize), 14);
  return bytes;
}

function metadataBytes(pointCount: number, firstChunkSize: number): Buffer {
  return Buffer.from(JSON.stringify({
    version: "2.0",
    name: "potree",
    description: "",
    points: pointCount,
    projection: "",
    hierarchy: { firstChunkSize, stepSize: 4, depth: 0 },
    offset: [-7, -13, -2],
    scale: [0.0001, 0.0001, 0.0001],
    spacing: 0.125,
    boundingBox: { min: [-7, -13, -2], max: [9, 3, 14] },
    encoding: "DEFAULT",
    attributes: [
      {
        name: "position",
        description: "",
        size: 12,
        numElements: 3,
        elementSize: 4,
        type: "int32",
        min: [-7, -13, -2],
        max: [8, 3, 2],
        scale: [1, 1, 1],
        offset: [0, 0, 0],
      },
      {
        name: "intensity",
        description: "",
        size: 1,
        numElements: 1,
        elementSize: 1,
        type: "uint8",
        min: [1],
        max: [255],
        scale: [1],
        offset: [0],
      },
      {
        name: "lcc prediction",
        description: "",
        size: 1,
        numElements: 1,
        elementSize: 1,
        type: "uint8",
        min: [20],
        max: [100],
        scale: [1],
        offset: [0],
      },
    ],
  }), "utf8");
}

function proxyFixture(
  proxyChildMask = 0,
  proxyPointCount = 1,
): BundleFixture {
  const firstChunkSize = 2 * FOUNDRY_POTREE_V2_HIERARCHY_RECORD_BYTES;
  const hierarchy = Buffer.concat([
    hierarchyRecord({ type: 0, childMask: 0b00000001, pointCount: 1, byteOffset: 0, byteSize: 14 }),
    hierarchyRecord({
      type: 2,
      childMask: proxyChildMask,
      pointCount: proxyPointCount,
      byteOffset: firstChunkSize,
      byteSize: 22,
    }),
    hierarchyRecord({ type: 1, childMask: 0, pointCount: 1, byteOffset: 14, byteSize: 14 }),
  ]);
  return {
    bundleRoot: "project_data/model",
    metadata: metadataBytes(2, firstChunkSize),
    hierarchy,
    octree: Buffer.alloc(2 * FOUNDRY_POTREE_V2_POINT_RECORD_BYTES, 0x5a),
  };
}

function threeNodeFixture(records?: readonly HierarchyRecord[], pointCount = 3): BundleFixture {
  const rows = records ?? [
    { type: 0, childMask: 0b00000011, pointCount: 1, byteOffset: 0, byteSize: 14 },
    { type: 1, childMask: 0, pointCount: 1, byteOffset: 14, byteSize: 14 },
    { type: 1, childMask: 0, pointCount: 1, byteOffset: 28, byteSize: 14 },
  ];
  const hierarchy = Buffer.concat(rows.map(hierarchyRecord));
  return {
    bundleRoot: "model",
    metadata: metadataBytes(pointCount, hierarchy.length),
    hierarchy,
    octree: Buffer.alloc(pointCount * FOUNDRY_POTREE_V2_POINT_RECORD_BYTES, 0x2c),
  };
}

function receptionStyleFixture(): BundleFixture {
  const nodeCount = 93;
  const pointCount = 175_237;
  const basePoints = Math.floor(pointCount / nodeCount);
  const remainder = pointCount % nodeCount;
  let byteOffset = 0;
  const rows: HierarchyRecord[] = [];
  for (let index = 0; index < nodeCount; index += 1) {
    const childMask = index === 0 || (index >= 1 && index <= 8)
      ? 0xff
      : index >= 9 && index <= 28 ? 0x01 : 0;
    const points = basePoints + (index < remainder ? 1 : 0);
    const byteSize = points * FOUNDRY_POTREE_V2_POINT_RECORD_BYTES;
    rows.push({ type: childMask === 0 ? 1 : 0, childMask, pointCount: points, byteOffset, byteSize });
    byteOffset += byteSize;
  }
  const hierarchy = Buffer.concat(rows.map(hierarchyRecord));
  return {
    bundleRoot: "project_data/model",
    metadata: metadataBytes(pointCount, hierarchy.length),
    hierarchy,
    octree: Buffer.alloc(byteOffset, 0x6d),
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function memberBytes(fixture: BundleFixture, role: FoundryPotreeV2BundleMemberRole): Buffer {
  return fixture[role];
}

function identities(fixture: BundleFixture): FoundryPotreeV2BundleMemberIdentity[] {
  return (["metadata", "hierarchy", "octree"] as const).map((role) => {
    const bytes = memberBytes(fixture, role);
    const name = role === "metadata" ? "metadata.json" : `${role}.bin`;
    return {
      role,
      path: fixture.bundleRoot === "" ? name : `${fixture.bundleRoot}/${name}`,
      sizeBytes: bytes.length,
      sha256: sha256(bytes),
    };
  });
}

function inspect(
  fixture: BundleFixture,
  options: {
    readonly signal?: AbortSignal;
    readonly transformIdentities?: (
      members: FoundryPotreeV2BundleMemberIdentity[],
    ) => FoundryPotreeV2BundleMemberIdentity[];
  } = {},
): FoundryPotreeV2SourceFactsOutcome {
  const collector = createPotreeV2SourceFactsCollector(fixture.bundleRoot, options.signal);
  for (const role of ["metadata", "hierarchy", "octree"] as const) {
    const bytes = memberBytes(fixture, role);
    const chunkSize = role === "octree" ? 65_537 : 7;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      collector.observeMember(role, bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)), offset);
    }
  }
  const bound = identities(fixture);
  return collector.finalize(options.transformIdentities?.(bound) ?? bound);
}

function expectFailure(
  outcome: FoundryPotreeV2SourceFactsOutcome,
  code: FoundryPotreeV2SourceFactsFailureCode,
): void {
  expect(outcome).toMatchObject({
    state: "facts_not_established",
    category: FOUNDRY_POTREE_V2_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE[code],
    code,
  });
}

describe("XGRIDS Potree v2 bundle Source Facts", () => {
  it("establishes a recursive proxy bundle using official chunk-local BFS semantics", () => {
    const outcome = inspect(proxyFixture());
    expect(outcome).toMatchObject({
      bundleRoot: "project_data/model",
      state: "established",
      facts: {
        format: "potree_v2_three_member_bundle",
        profile: "xgrids_default_position_intensity_lcc_prediction_14_byte",
        metadata: {
          pointCount: 2,
          recordStrideBytes: 14,
          attributes: [
            { name: "position", declaredMin: [-7, -13, -2], declaredMax: [8, 3, 2] },
            { name: "intensity", declaredMin: [1], declaredMax: [255] },
            { name: "lcc prediction", declaredMin: [20], declaredMax: [100] },
          ],
        },
        hierarchy: {
          reachableChunkCount: 2,
          reachableRecordCount: 3,
          logicalNodeCount: 2,
          normalNodeCount: 1,
          leafNodeCount: 1,
          proxyReferenceCount: 1,
          proxyReplacementChildMaskMismatchCount: 0,
          proxyReplacementPointCountMismatchCount: 0,
          pointCountSum: 2,
          unreferencedHierarchyBytes: 0,
        },
        octree: {
          sourceSizeBytes: 28,
          payloadRangeCount: 2,
          coveredBytes: 28,
          payloadRangesDisjointAndGapless: true,
        },
        compatibility: { proxyReplacementDeclarations: "all_match" },
      },
    });
  });

  it("retains proxy declaration mismatches that the official loader overwrites", () => {
    const outcome = inspect(proxyFixture(0b10000000, 99));
    expect(outcome).toMatchObject({
      state: "established",
      facts: {
        hierarchy: {
          proxyReferenceCount: 1,
          proxyReplacementChildMaskMismatchCount: 1,
          proxyReplacementPointCountMismatchCount: 1,
          logicalNodeCount: 2,
          pointCountSum: 2,
        },
        compatibility: {
          proxyReplacementDeclarations:
            "target_record_overwrite_mismatches_observed_and_accepted",
        },
      },
    });
  });

  it("establishes a Reception-shaped 93-node, 175237-point no-proxy bundle", () => {
    const fixture = receptionStyleFixture();
    expect(fixture.hierarchy).toHaveLength(2_046);
    expect(fixture.octree).toHaveLength(2_453_318);
    const outcome = inspect(fixture);
    expect(outcome).toMatchObject({
      state: "established",
      facts: {
        hierarchy: {
          reachableChunkCount: 1,
          reachableRecordCount: 93,
          logicalNodeCount: 93,
          proxyReferenceCount: 0,
          proxyReplacementChildMaskMismatchCount: 0,
          proxyReplacementPointCountMismatchCount: 0,
          pointCountSum: 175_237,
          declaredDepthMatchesObservedMaximum: false,
          maximumObservedDepth: 3,
        },
        compatibility: {
          declaredHierarchyDepth: "differs_from_observed_accepted",
          proxyReplacementDeclarations: "no_proxies",
          attributeHistograms: "omitted_and_accepted",
        },
      },
    });
  });

  it("accepts and reports a leaf record with children as the official viewer does", () => {
    const fixture = threeNodeFixture([
      { type: 1, childMask: 0b00000001, pointCount: 1, byteOffset: 0, byteSize: 14 },
      { type: 1, childMask: 0, pointCount: 1, byteOffset: 14, byteSize: 14 },
    ], 2);
    const outcome = inspect(fixture);
    expect(outcome).toMatchObject({
      state: "established",
      facts: {
        hierarchy: { leafRecordsWithChildren: 1, logicalNodeCount: 2 },
        compatibility: { leafChildMasks: "observed_and_accepted_by_official_loader_semantics" },
      },
    });
  });

  it("rejects contradictory established fact equations and compatibility labels", () => {
    const outcome = inspect(proxyFixture(0b10000000, 99));
    if (outcome.state !== "established") throw new Error("expected facts");

    const pointContradiction = structuredClone(outcome.facts);
    pointContradiction.metadata.pointCount += 1;
    expect(FoundryPotreeV2BundleFactsSchema.safeParse(pointContradiction).success)
      .toBe(false);

    const hierarchyContradiction = structuredClone(outcome.facts);
    hierarchyContradiction.hierarchy.logicalNodeCount += 1;
    expect(
      FoundryPotreeV2BundleFactsSchema.safeParse(hierarchyContradiction).success,
    ).toBe(false);

    const compatibilityContradiction = structuredClone(outcome.facts);
    compatibilityContradiction.compatibility.proxyReplacementDeclarations =
      "all_match";
    expect(
      FoundryPotreeV2BundleFactsSchema.safeParse(compatibilityContradiction)
        .success,
    ).toBe(false);

    const attributeContradiction = structuredClone(outcome.facts);
    const intensity = attributeContradiction.metadata.attributes[1];
    if (intensity === undefined) throw new Error("expected intensity attribute");
    intensity.declaredMin = [0, 1, 2];
    expect(
      FoundryPotreeV2BundleFactsSchema.safeParse(attributeContradiction).success,
    ).toBe(false);
  });

  it("rejects metadata, hierarchy, and octree point-count contradictions", () => {
    expectFailure(inspect(threeNodeFixture(undefined, 4)), "POTREE_V2_HIERARCHY_POINT_COUNT_MISMATCH");
  });

  it("distinguishes octree gaps from overlaps", () => {
    const gap = threeNodeFixture([
      { type: 0, childMask: 3, pointCount: 1, byteOffset: 0, byteSize: 14 },
      { type: 1, childMask: 0, pointCount: 1, byteOffset: 15, byteSize: 14 },
      { type: 1, childMask: 0, pointCount: 1, byteOffset: 28, byteSize: 14 },
    ]);
    const overlap = threeNodeFixture([
      { type: 0, childMask: 3, pointCount: 1, byteOffset: 0, byteSize: 14 },
      { type: 1, childMask: 0, pointCount: 1, byteOffset: 13, byteSize: 14 },
      { type: 1, childMask: 0, pointCount: 1, byteOffset: 28, byteSize: 14 },
    ]);
    expectFailure(inspect(gap), "POTREE_V2_OCTREE_RANGE_GAP");
    expectFailure(inspect(overlap), "POTREE_V2_OCTREE_RANGE_OVERLAP");
  });

  it("rejects proxy cycles and out-of-bounds hierarchy chunk references", () => {
    const firstChunkSize = 44;
    const root = hierarchyRecord({ type: 0, childMask: 1, pointCount: 1, byteOffset: 0, byteSize: 14 });
    const cycle: BundleFixture = {
      bundleRoot: "model",
      metadata: metadataBytes(2, firstChunkSize),
      hierarchy: Buffer.concat([
        root,
        hierarchyRecord({ type: 2, childMask: 0, pointCount: 1, byteOffset: 0, byteSize: firstChunkSize }),
      ]),
      octree: Buffer.alloc(28),
    };
    const outOfBounds: BundleFixture = {
      ...cycle,
      hierarchy: Buffer.concat([
        root,
        hierarchyRecord({ type: 2, childMask: 0, pointCount: 1, byteOffset: firstChunkSize, byteSize: 22 }),
      ]),
    };
    expectFailure(inspect(cycle), "POTREE_V2_HIERARCHY_PROXY_CYCLE");
    expectFailure(inspect(outOfBounds), "POTREE_V2_HIERARCHY_CHUNK_RANGE_INVALID");
  });

  it("fails closed on unreachable hierarchy bytes while reporting bounded reachability", () => {
    const fixture: BundleFixture = {
      bundleRoot: "model",
      metadata: metadataBytes(1, 22),
      hierarchy: Buffer.concat([
        hierarchyRecord({ type: 1, childMask: 0, pointCount: 1, byteOffset: 0, byteSize: 14 }),
        Buffer.alloc(22, 0x7f),
      ]),
      octree: Buffer.alloc(14),
    };
    const outcome = inspect(fixture);
    expectFailure(outcome, "POTREE_V2_HIERARCHY_UNREACHABLE_BYTES");
    expect(outcome).toMatchObject({
      observations: {
        kind: "hierarchy_reachability",
        hierarchySizeBytes: 44,
        reachableHierarchyBytes: 22,
        unreferencedHierarchyBytes: 22,
      },
    });
  });

  it("rejects decoded duplicate JSON keys, including escape-equivalent keys", () => {
    const fixture = proxyFixture();
    const text = fixture.metadata.toString("utf8").replace(
      '"version":"2.0"',
      '"version":"2.0","\\u0076ersion":"2.0"',
    );
    expectFailure(inspect({ ...fixture, metadata: Buffer.from(text, "utf8") }), "POTREE_V2_METADATA_JSON_DUPLICATE_KEY");
  });

  it("binds every observed byte to the three supplied identities and supports cancellation", () => {
    const mismatch = inspect(proxyFixture(), {
      transformIdentities: (members) => members.map((member) =>
        member.role === "metadata" ? { ...member, sha256: "0".repeat(64) } : member),
    });
    expectFailure(mismatch, "POTREE_V2_MEMBER_SHA256_MISMATCH");

    const controller = new AbortController();
    controller.abort();
    expectFailure(inspect(proxyFixture(), { signal: controller.signal }), "POTREE_V2_INSPECTION_CANCELLED");
  });

  it("discovers complete and partial candidates from full receipt-like identities and ignores ancillary files", () => {
    const complete = identities(proxyFixture()).map((identity) => ({
      ...identity,
      detection: { candidates: [] },
      magicHex: "00",
    }));
    const receiptLike = [
      ...complete,
      { path: "project_data/model/log.txt", sizeBytes: 4, sha256: "a".repeat(64), detection: {} },
      { path: "second/metadata.json", sizeBytes: 1, sha256: "b".repeat(64), detection: {} },
    ];
    const candidates = discoverPotreeV2BundleCandidates(receiptLike);
    expect(candidates).toEqual([
      expect.objectContaining({ bundleRoot: "project_data/model", missingRoles: [], duplicateRoles: [] }),
      expect.objectContaining({ bundleRoot: "second", missingRoles: ["hierarchy", "octree"], duplicateRoles: [] }),
    ]);
  });
});
