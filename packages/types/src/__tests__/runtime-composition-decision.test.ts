import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  RUNTIME_COMPOSITION_DECISION_V0_SCHEMA_VERSION,
  RUNTIME_COMPOSITION_DECISION_V1_SCHEMA_VERSION,
  RuntimeCompositionDecisionV0Schema,
  RuntimeCompositionDecisionV1Schema,
  type RuntimeCompositionDecisionV0,
  type RuntimeCompositionDecisionV1,
} from "../runtime-composition-decision.js";

const QUALITY_HIERARCHY_SHA256 =
  "f0a4c782cc0f031830404d409f5c0accdc30ed501fa562169206962ceee64f3e";

type NodeRangeSeed = readonly [nodePath: string, count: number];

function contiguousNodeRanges(seeds: readonly NodeRangeSeed[]) {
  let start = 0;
  return seeds.map(([nodePath, count]) => {
    const range = { nodePath, start, count };
    start += count;
    return range;
  });
}

const QUALITY_SELECTED_MEMBERS: RuntimeCompositionDecisionV1["frontier"]["orderedMembers"] =
  [
    {
      order: 0,
      role: "frontier_member" as const,
      assetVersionId: "00000000-0000-4000-8000-000000000001",
      fileName: "0_15_0_0.sog",
      sha256:
        "111a47f7470fc83d1dc7f0bf2e1d3aa96943dd5a453005b840597e8c491d2368",
      sizeBytes: 10_279_160,
      gaussianCount: 602_409,
      sourceHierarchySha256: QUALITY_HIERARCHY_SHA256,
      hierarchyLevel: 3,
      nodeRanges: contiguousNodeRanges([
        ["0_0_0_0", 3_369],
        ["0_10_0_0", 42_764],
        ["0_11_0_0", 92_554],
        ["0_12_0_0", 55_883],
        ["0_12_0_1", 103_345],
        ["0_12_1_0", 62_915],
        ["0_13_0_0", 59_048],
        ["0_14_0_0", 41_400],
        ["0_15_0_0", 141_131],
      ]),
    },
    {
      order: 1,
      role: "frontier_member" as const,
      assetVersionId: "00000000-0000-4000-8000-000000000002",
      fileName: "0_1_0_5.sog",
      sha256:
        "559dd375950966f8d1aa088a391b7105e364abc5013e7d29ea573728ab208fe1",
      sizeBytes: 10_047_085,
      gaussianCount: 577_816,
      sourceHierarchySha256: QUALITY_HIERARCHY_SHA256,
      hierarchyLevel: 3,
      nodeRanges: contiguousNodeRanges([
        ["0_15_0_1", 34_023],
        ["0_16_0_0", 98_036],
        ["0_17_0_0", 82_831],
        ["0_18_0_0", 120_561],
        ["0_19_0_0", 20_922],
        ["0_1_0_0", 4_304],
        ["0_1_0_1", 34],
        ["0_1_0_2", 51],
        ["0_1_0_3", 9_170],
        ["0_1_0_4", 86_194],
        ["0_1_0_5", 121_690],
      ]),
    },
    {
      order: 2,
      role: "frontier_member" as const,
      assetVersionId: "00000000-0000-4000-8000-000000000003",
      fileName: "0_6_0_0.sog",
      sha256:
        "182525354cd14fa6bc8f6a54c0cbe0e39b5d5c216dd27e2cc4d44d1458ba8238",
      sizeBytes: 10_368_228,
      gaussianCount: 599_740,
      sourceHierarchySha256: QUALITY_HIERARCHY_SHA256,
      hierarchyLevel: 3,
      nodeRanges: contiguousNodeRanges([
        ["0_20_0_0", 114_797],
        ["0_20_1_0", 117_198],
        ["0_2_0_0", 107_591],
        ["0_3_0_0", 276],
        ["0_4_0_0", 138],
        ["0_5_0_0", 120_119],
        ["0_6_0_0", 139_621],
      ]),
    },
    {
      order: 3,
      role: "frontier_member" as const,
      assetVersionId: "00000000-0000-4000-8000-000000000004",
      fileName: "0_7_0_0.sog",
      sha256:
        "3b68d24538523a559730e14d5ed1733f67d9894354e26322e20cf5f4458ccebf",
      sizeBytes: 5_040_628,
      gaussianCount: 222_044,
      sourceHierarchySha256: QUALITY_HIERARCHY_SHA256,
      hierarchyLevel: 3,
      nodeRanges: contiguousNodeRanges([
        ["0_7_0_0", 143_741],
        ["0_8_0_0", 11_250],
        ["0_9_0_0", 67_053],
      ]),
    },
  ];

const QUALITY_EXCLUDED_ANCESTORS: RuntimeCompositionDecisionV1["excludedAncestors"] =
  [
    {
      exclusion: "replaced_by_selected_descendants" as const,
      assetVersionId: "00000000-0000-4000-8000-000000000005",
      fileName: "0_0.sog",
      sha256:
        "0a5b8c21327be7c747087baab237d1907e0a0277b0d019300e0d6b2e7eba0a16",
      sizeBytes: 9_017_864,
      gaussianCount: 496_034,
      sourceHierarchySha256: QUALITY_HIERARCHY_SHA256,
      hierarchyLevel: 1,
      nodeRanges: contiguousNodeRanges([
        ["0_0", 268],
        ["0_1", 42_237],
        ["0_10", 9_824],
        ["0_11", 23_459],
        ["0_12", 49_775],
        ["0_13", 18_000],
        ["0_14", 12_940],
        ["0_15", 43_666],
        ["0_16", 20_969],
        ["0_17", 24_747],
        ["0_18", 27_562],
        ["0_19", 3_761],
        ["0_2", 36_733],
        ["0_20", 47_720],
        ["0_3", 72],
        ["0_4", 33],
        ["0_5", 39_605],
        ["0_6", 31_971],
        ["0_7", 34_859],
        ["0_8", 2_276],
        ["0_9", 25_557],
      ]),
    },
    {
      exclusion: "replaced_by_selected_descendants" as const,
      assetVersionId: "00000000-0000-4000-8000-000000000006",
      fileName: "0_1_0.sog",
      sha256:
        "08c928b2556e2ba38cdf1777c806bb6b7ece249d5e7c442d20c0232ca703005c",
      sizeBytes: 9_845_814,
      gaussianCount: 561_053,
      sourceHierarchySha256: QUALITY_HIERARCHY_SHA256,
      hierarchyLevel: 2,
      nodeRanges: contiguousNodeRanges([
        ["0_0_0", 645],
        ["0_10_0", 21_274],
        ["0_11_0", 45_337],
        ["0_12_0", 72_241],
        ["0_12_1", 30_419],
        ["0_13_0", 32_977],
        ["0_14_0", 23_922],
        ["0_15_0", 93_642],
        ["0_16_0", 42_000],
        ["0_17_0", 44_558],
        ["0_18_0", 57_290],
        ["0_19_0", 8_704],
        ["0_1_0", 88_044],
      ]),
    },
    {
      exclusion: "replaced_by_selected_descendants" as const,
      assetVersionId: "00000000-0000-4000-8000-000000000007",
      fileName: "0_20_0.sog",
      sha256:
        "72664ef164df58e88e018ab455f67de8c985de4e5f799fc6b45041aa804af2e4",
      sizeBytes: 8_106_037,
      gaussianCount: 432_226,
      sourceHierarchySha256: QUALITY_HIERARCHY_SHA256,
      hierarchyLevel: 2,
      nodeRanges: contiguousNodeRanges([
        ["0_20_0", 53_374],
        ["0_20_1", 48_466],
        ["0_2_0", 68_837],
        ["0_3_0", 109],
        ["0_4_0", 76],
        ["0_5_0", 72_217],
        ["0_6_0", 64_741],
        ["0_7_0", 74_279],
        ["0_8_0", 4_386],
        ["0_9_0", 45_741],
      ]),
    },
  ];

function qualityFrontierDecision(): RuntimeCompositionDecisionV1 {
  const selectedMembers = structuredClone(QUALITY_SELECTED_MEMBERS);
  const excludedAncestors = structuredClone(QUALITY_EXCLUDED_ANCESTORS);

  return {
    schemaVersion: RUNTIME_COMPOSITION_DECISION_V1_SCHEMA_VERSION,
    decisionId: "reception-room-quality-fixed-frontier-test",
    venueSlug: "trades-hall",
    roomSlug: "reception-room",
    runtimePackage: {
      runtimePackageId: "71687e9e-c23d-4f51-b3dd-a6a82c97978d",
      revision: 2,
      contentDigest:
        "9999999999999999999999999999999999999999999999999999999999999999",
      primaryVisualAssetVersionId: "00000000-0000-4000-8000-000000000001",
    },
    decidedAt: "2026-07-13T12:00:00.000Z",
    decidedBy: "runtime-quality-review",
    decision: "serve_reviewed_fixed_frontier",
    hierarchy: {
      format: "lcc2",
      fileName: "Reception Room.lcc2",
      formatVersion: "0.0.3",
      sha256: QUALITY_HIERARCHY_SHA256,
      firstDataLevel: 1,
      highestDataLevel: 3,
      allLevels: {
        scope: "all_room_hierarchy_levels_excluding_environment",
        roomAssetCount: 7,
        gaussianCount: 3_491_322,
        payloadBytes: 62_704_816,
        levelTotals: [
          {
            level: 1,
            assetCount: 1,
            gaussianCount: 496_034,
            payloadBytes: 9_017_864,
          },
          {
            level: 2,
            assetCount: 2,
            gaussianCount: 993_279,
            payloadBytes: 17_951_851,
          },
          {
            level: 3,
            assetCount: 4,
            gaussianCount: 2_002_009,
            payloadBytes: 35_735_101,
          },
        ],
      },
    },
    frontier: {
      strategy: "fixed_non_overlapping_frontier",
      format: "sog",
      selectedLevel: 3,
      totals: {
        scope: "selected_room_frontier_excluding_environment",
        assetCount: 4,
        gaussianCount: 2_002_009,
        payloadBytes: 35_735_101,
      },
      orderedMembers: selectedMembers,
    },
    excludedAncestors,
    environment: {
      disposition: "excluded_from_room_frontier",
      includedInRoomHierarchyTotals: false,
      asset: {
        assetVersionId: "00000000-0000-4000-8000-000000000008",
        fileName: "env.sog",
        sha256:
          "1b6927a6d883634d93cc59294c77f2acc02b55da1092bdd6bd637765e8b3f7f8",
        sizeBytes: 129_565,
        gaussianCount: 3_604,
      },
      reason: "Environment inclusion still requires a fixed-view comparison.",
    },
    limitations: [
      "This contract records runtime composition, not physical alignment.",
    ],
    evidenceRefs: [
      {
        label: "Quality hierarchy inspection",
        ref: "reception-room-hd-evidence.json#quality-sh3-lcc2-container",
      },
    ],
  };
}

function loadDocsArtifact(relativePath: string): unknown {
  const fixturePath = fileURLToPath(new URL(relativePath, import.meta.url));
  return JSON.parse(readFileSync(fixturePath, "utf-8")) as unknown;
}

function loadReceptionRoomRuntimeCompositionDecision(): unknown {
  return loadDocsArtifact(
    "../../../../docs/operations/reception-room-runtime-composition-decision-2026-06-16.json",
  );
}

function parsedDecision(): RuntimeCompositionDecisionV0 {
  return RuntimeCompositionDecisionV0Schema.parse(
    loadReceptionRoomRuntimeCompositionDecision(),
  );
}

describe("Runtime composition decision", () => {
  it("validates the Reception Room direct SOG chunk composition decision artifact", () => {
    const decision = parsedDecision();

    expect(decision.schemaVersion).toBe(
      RUNTIME_COMPOSITION_DECISION_V0_SCHEMA_VERSION,
    );
    expect(decision.decisionId).toBe(
      "reception-room-runtime-composition-2026-06-16",
    );
    expect(decision.runtimePackageId).toBe(
      "71687e9e-c23d-4f51-b3dd-a6a82c97978d",
    );
    expect(decision.decision).toBe("serve_manifest_room_sog_chunks");
    expect(decision.lcc2Manifest.authority).toBe("not_runtime_authoritative");
    expect(decision.runtimeLoading.visualAssetUrlsExpectedCount).toBe(7);
    expect(decision.runtimeLoading.loadedSplatsExpected).toBe(3491322);
    expect(
      decision.runtimeLoading.servedRoomChunks.map((chunk) => chunk.fileName),
    ).toEqual([
      "0_0.sog",
      "0_15_0_0.sog",
      "0_1_0.sog",
      "0_1_0_5.sog",
      "0_20_0.sog",
      "0_6_0_0.sog",
      "0_7_0_0.sog",
    ]);
    expect(
      decision.runtimeLoading.excludedChunks.map((chunk) => chunk.fileName),
    ).toEqual(["env.sog"]);
    expect(decision.guardrails).toEqual({
      lcc2DirectLoaderEnabled: false,
      signedTransformCreated: false,
      publicExposureChanged: false,
      operationalGeometryCreated: false,
    });
  });

  it("rejects direct chunk-serving decisions that claim LCC2 graph runtime authority", () => {
    const decision = parsedDecision();

    const result = RuntimeCompositionDecisionV0Schema.safeParse({
      ...decision,
      lcc2Manifest: {
        ...decision.lcc2Manifest,
        authority: "runtime_authoritative",
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects served chunk totals that drift from the LCC2 room total", () => {
    const decision = parsedDecision();

    const result = RuntimeCompositionDecisionV0Schema.safeParse({
      ...decision,
      runtimeLoading: {
        ...decision.runtimeLoading,
        servedRoomChunks: decision.runtimeLoading.servedRoomChunks.map(
          (chunk, index) =>
            index === 0
              ? { ...chunk, loadedSplats: chunk.loadedSplats + 1 }
              : chunk,
        ),
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects chunks that are both served and excluded", () => {
    const decision = parsedDecision();
    const servedChunk = decision.runtimeLoading.servedRoomChunks[0];

    if (servedChunk === undefined) {
      throw new Error(
        "Expected Reception Room decision to include served chunks.",
      );
    }

    const result = RuntimeCompositionDecisionV0Schema.safeParse({
      ...decision,
      runtimeLoading: {
        ...decision.runtimeLoading,
        excludedChunks: [
          {
            ...servedChunk,
            role: "environment_chunk",
          },
        ],
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects composition decisions that create public exposure side effects", () => {
    const decision = parsedDecision();

    const result = RuntimeCompositionDecisionV0Schema.safeParse({
      ...decision,
      guardrails: {
        ...decision.guardrails,
        publicExposureChanged: true,
      },
    });

    expect(result.success).toBe(false);
  });
});

describe("Runtime composition decision v1 fixed frontier", () => {
  it("accepts the four-member Quality SOG frontier without counting its ancestors twice", () => {
    const decision = RuntimeCompositionDecisionV1Schema.parse(
      qualityFrontierDecision(),
    );

    expect(decision.schemaVersion).toBe(
      RUNTIME_COMPOSITION_DECISION_V1_SCHEMA_VERSION,
    );
    expect(
      decision.frontier.orderedMembers.map((member) => member.fileName),
    ).toEqual(["0_15_0_0.sog", "0_1_0_5.sog", "0_6_0_0.sog", "0_7_0_0.sog"]);
    expect(decision.frontier.totals.gaussianCount).toBe(2_002_009);
    expect(
      decision.hierarchy.allLevels.levelTotals.map(
        (level) => level.gaussianCount,
      ),
    ).toEqual([496_034, 993_279, 2_002_009]);
    expect(decision.hierarchy.allLevels.gaussianCount).toBe(3_491_322);
    if (decision.environment.disposition === "not_present") {
      throw new Error("Expected the Quality environment asset disposition.");
    }
    expect(decision.environment.asset.gaussianCount).toBe(3_604);
  });

  it("accepts an SPZ frontier when every room and environment asset uses SPZ", () => {
    const decision = qualityFrontierDecision();
    decision.frontier.format = "spz";
    for (const member of decision.frontier.orderedMembers) {
      member.fileName = member.fileName.replace(/\.sog$/u, ".spz");
    }
    for (const ancestor of decision.excludedAncestors) {
      ancestor.fileName = ancestor.fileName.replace(/\.sog$/u, ".spz");
    }
    if (decision.environment.disposition !== "not_present") {
      decision.environment.asset.fileName =
        decision.environment.asset.fileName.replace(/\.sog$/u, ".spz");
    }

    expect(RuntimeCompositionDecisionV1Schema.safeParse(decision).success).toBe(
      true,
    );
  });

  it("rejects a selected ancestor and descendant mounted in the same frontier", () => {
    const decision = qualityFrontierDecision();
    const descendant = decision.frontier.orderedMembers[0];
    const ancestor = decision.frontier.orderedMembers[1];
    if (descendant === undefined || ancestor === undefined) {
      throw new Error("Expected at least two Quality frontier members.");
    }
    ancestor.hierarchyLevel = 2;
    ancestor.nodeRanges = contiguousNodeRanges([
      ["0_0_0", ancestor.gaussianCount],
    ]);

    expect(RuntimeCompositionDecisionV1Schema.safeParse(decision).success).toBe(
      false,
    );
  });

  it.each([
    ["asset version id", "assetVersionId"],
    ["file name", "fileName"],
    ["payload hash", "sha256"],
  ] as const)("rejects a duplicate %s", (_label, key) => {
    const decision = qualityFrontierDecision();
    const first = decision.frontier.orderedMembers[0];
    const second = decision.frontier.orderedMembers[1];
    if (first === undefined || second === undefined) {
      throw new Error("Expected at least two Quality frontier members.");
    }
    second[key] = first[key];

    expect(RuntimeCompositionDecisionV1Schema.safeParse(decision).success).toBe(
      false,
    );
  });

  it("rejects a hierarchy node path assigned to more than one runtime asset", () => {
    const decision = qualityFrontierDecision();
    const first = decision.frontier.orderedMembers[0];
    const second = decision.frontier.orderedMembers[1];
    const firstRange = first?.nodeRanges[0];
    const secondRange = second?.nodeRanges[0];
    if (firstRange === undefined || secondRange === undefined) {
      throw new Error("Expected node ranges in the Quality frontier fixture.");
    }
    secondRange.nodePath = firstRange.nodePath;

    expect(RuntimeCompositionDecisionV1Schema.safeParse(decision).success).toBe(
      false,
    );
  });

  it("rejects non-contiguous node ranges and per-file Gaussian drift", () => {
    const decision = qualityFrontierDecision();
    const member = decision.frontier.orderedMembers[0];
    const range = member?.nodeRanges[1];
    if (range === undefined) {
      throw new Error(
        "Expected multiple node ranges in the first Quality frontier member.",
      );
    }
    range.start += 1;

    expect(RuntimeCompositionDecisionV1Schema.safeParse(decision).success).toBe(
      false,
    );
  });

  it("rejects frontier Gaussian and byte totals that do not equal its members", () => {
    const gaussianDrift = qualityFrontierDecision();
    gaussianDrift.frontier.totals.gaussianCount += 1;

    const byteDrift = qualityFrontierDecision();
    byteDrift.frontier.totals.payloadBytes += 1;

    expect(
      RuntimeCompositionDecisionV1Schema.safeParse(gaussianDrift).success,
    ).toBe(false);
    expect(
      RuntimeCompositionDecisionV1Schema.safeParse(byteDrift).success,
    ).toBe(false);
  });

  it("rejects all-level totals copied into the selected-frontier fields", () => {
    const decision = qualityFrontierDecision();
    decision.frontier.totals.gaussianCount =
      decision.hierarchy.allLevels.gaussianCount;
    decision.frontier.totals.payloadBytes =
      decision.hierarchy.allLevels.payloadBytes;

    expect(RuntimeCompositionDecisionV1Schema.safeParse(decision).success).toBe(
      false,
    );
  });

  it("rejects all-level totals that do not partition into frontier and excluded ancestors", () => {
    const decision = qualityFrontierDecision();
    decision.hierarchy.allLevels.gaussianCount =
      decision.frontier.totals.gaussianCount;
    decision.hierarchy.allLevels.payloadBytes =
      decision.frontier.totals.payloadBytes;

    expect(RuntimeCompositionDecisionV1Schema.safeParse(decision).success).toBe(
      false,
    );
  });

  it("rejects an all-level room total that incorrectly includes the environment asset", () => {
    const decision = qualityFrontierDecision();
    if (decision.environment.disposition === "not_present") {
      throw new Error("Expected the Quality environment asset disposition.");
    }
    decision.hierarchy.allLevels.gaussianCount +=
      decision.environment.asset.gaussianCount;
    decision.hierarchy.allLevels.payloadBytes +=
      decision.environment.asset.sizeBytes;

    expect(RuntimeCompositionDecisionV1Schema.safeParse(decision).success).toBe(
      false,
    );
  });

  it("rejects invalid package revision and manifest-digest metadata", () => {
    const invalidRevision = qualityFrontierDecision();
    invalidRevision.runtimePackage.revision = 0;

    const invalidDigest = qualityFrontierDecision();
    invalidDigest.runtimePackage.contentDigest = "not-a-sha256";

    expect(
      RuntimeCompositionDecisionV1Schema.safeParse(invalidRevision).success,
    ).toBe(false);
    expect(
      RuntimeCompositionDecisionV1Schema.safeParse(invalidDigest).success,
    ).toBe(false);
  });

  it("rejects a runtime filename whose extension disagrees with the frontier format", () => {
    const decision = qualityFrontierDecision();
    const member = decision.frontier.orderedMembers[0];
    if (member === undefined) {
      throw new Error("Expected a Quality frontier member.");
    }
    member.fileName = "0_15_0_0.spz";

    expect(RuntimeCompositionDecisionV1Schema.safeParse(decision).success).toBe(
      false,
    );
  });

  it("rejects an asset bound to a different hierarchy hash", () => {
    const decision = qualityFrontierDecision();
    const member = decision.frontier.orderedMembers[0];
    if (member === undefined) {
      throw new Error("Expected a Quality frontier member.");
    }
    member.sourceHierarchySha256 =
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    expect(RuntimeCompositionDecisionV1Schema.safeParse(decision).success).toBe(
      false,
    );
  });

  it("rejects a primary visual asset that is not a selected frontier member", () => {
    const decision = qualityFrontierDecision();
    decision.runtimePackage.primaryVisualAssetVersionId =
      "00000000-0000-4000-8000-000000000008";

    expect(RuntimeCompositionDecisionV1Schema.safeParse(decision).success).toBe(
      false,
    );
  });

  it("rejects missing ancestor range evidence for a selected leaf", () => {
    const decision = qualityFrontierDecision();
    const mediumAncestor = decision.excludedAncestors[1];
    if (mediumAncestor === undefined) {
      throw new Error("Expected a medium Quality ancestor asset.");
    }
    mediumAncestor.nodeRanges = mediumAncestor.nodeRanges.filter(
      (range) => range.nodePath !== "0_0_0",
    );

    expect(RuntimeCompositionDecisionV1Schema.safeParse(decision).success).toBe(
      false,
    );
  });

  it("rejects an out-of-order frontier member ordinal", () => {
    const decision = qualityFrontierDecision();
    const member = decision.frontier.orderedMembers[1];
    if (member === undefined) {
      throw new Error("Expected a second Quality frontier member.");
    }
    member.order = 7;

    expect(RuntimeCompositionDecisionV1Schema.safeParse(decision).success).toBe(
      false,
    );
  });
});
