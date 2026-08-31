import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  GrandHallPoseLineageAuthorityGuardsSchema,
  GrandHallPoseLineageRelativePathSchema,
} from
  "../grand-hall-xgrids-lcc-pose-lineage-contract.js";
import {
  GRAND_HALL_POSE_LINEAGE_EXPECTED_IDENTITIES,
  __testOnlyGrandHallPoseLineage,
  evaluateGrandHallQuaternionPermutations,
  fitGrandHallDiagnosticSimilarity,
  pairGrandHallPoseTrajectories,
  parseGrandHallPoseLineageArguments,
  parseGrandHallProcessedPoseJson,
  parseGrandHallRawPoseCsv,
  parseGrandHallXgridsLccPoseLineage,
  type GrandHallProcessedPoseRow,
  type GrandHallRawPoseRow,
} from "../grand-hall-xgrids-lcc-pose-lineage.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function rawCsv(rows: readonly string[]): Buffer {
  return Buffer.from(`${rows.join("\n")}\n`, "utf8");
}

function syntheticTrajectories(count = 20): {
  readonly raw: readonly GrandHallRawPoseRow[];
  readonly processed: readonly GrandHallProcessedPoseRow[];
} {
  const raw: GrandHallRawPoseRow[] = [];
  const processed: GrandHallProcessedPoseRow[] = [];
  const cosine = Math.cos(Math.PI / 6);
  const sine = Math.sin(Math.PI / 6);
  for (let index = 0; index < count; index += 1) {
    const position = [
      index * 0.37,
      ((index * index + 3) % 11) * 0.41,
      ((index * 7 + 2) % 13) * 0.23,
    ] as const;
    const tuple = [
      0.11 + index * 0.001,
      -0.23 + index * 0.002,
      0.37 - index * 0.0015,
      0.81 + index * 0.0007,
    ] as const;
    const timestamp = 1_000_000_000_000n + BigInt(index) * 200_000_000n;
    raw.push({ timestampNanoseconds: timestamp, position, quaternionTuple: tuple });
    processed.push({
      timestampNanoseconds: timestamp + 10_000n,
      translation: [
        1.75 * (cosine * position[0] - sine * position[1]) + 4,
        1.75 * (sine * position[0] + cosine * position[1]) - 2,
        1.75 * position[2] + 0.5,
      ],
      rotationTuple: [tuple[3], tuple[0], tuple[1], tuple[2]],
    });
  }
  return { raw, processed };
}

function guards() {
  return {
    authority: "none",
    trajectoryLineageAccepted: false,
    quaternionComponentOrderingAccepted: false,
    cameraExtrinsicKnown: false,
    poseDirectionKnown: false,
    handednessKnown: false,
    axisSemanticsKnown: false,
    fovKnown: false,
    intrinsicsKnown: false,
    metricUnitsAccepted: false,
    metricTransformAccepted: false,
    e57ToXgridsTransformAccepted: false,
    roomMembershipAccepted: false,
    generatedContentUsed: false,
    trainingPermitted: false,
    reconstructionPermitted: false,
    providerInputPermitted: false,
    runtimePermitted: false,
    stagingPermitted: false,
    publicationPermitted: false,
    productionTrustPermitted: false,
  } as const;
}

describe("Grand Hall pose-lineage strict parsers", () => {
  it("accepts only normalized traversal-free POSIX evidence paths", () => {
    expect(GrandHallPoseLineageRelativePathSchema.parse(
      "scans_BIG_MODEL_TH_GH_1/lcc2-result/info/poses.json",
    )).toBe("scans_BIG_MODEL_TH_GH_1/lcc2-result/info/poses.json");
    for (const unsafePath of [
      "/absolute/path",
      "../escape",
      "a/../b",
      "./relative",
      "a//b",
      "trailing/",
      "windows\\path",
      "C:/drive/path",
    ]) {
      expect(() => GrandHallPoseLineageRelativePathSchema.parse(unsafePath)).toThrow(
        "normalized, traversal-free POSIX path",
      );
    }
  });

  it("parses finite LF-only raw rows and strict processed pose JSON", () => {
    const raw = parseGrandHallRawPoseCsv(rawCsv([
      "1000.000001,1.000000,2.000000,3.000000,0.100000,0.200000,0.300000,0.900000",
      "1000.100001,1.100000,2.100000,3.100000,0.110000,0.210000,0.310000,0.890000",
    ]));
    expect(raw).toHaveLength(2);
    expect(raw[0]?.timestampNanoseconds).toBe(1_000_000_001_000n);
    expect(Object.isFrozen(raw)).toBe(true);

    const processed = parseGrandHallProcessedPoseJson(Buffer.from(JSON.stringify({
      poses: [
        { ts: "1000.000001001", T: [1, 2, 3], R: [0.9, 0.1, 0.2, 0.3], RGB: null },
        { ts: "1000.100001001", T: [2, 3, 4], R: [0.89, 0.11, 0.21, 0.31], RGB: null },
      ],
      fusionPoses: null,
    })));
    expect(processed).toHaveLength(2);
    expect(processed[0]?.timestampNanoseconds).toBe(1_000_000_001_001n);
  });

  it("rejects malformed UTF-8, non-finite syntax, duplicate time, RGB data, and fusion poses", () => {
    expect(() => parseGrandHallRawPoseCsv(Buffer.from([0xc3, 0x28]))).toThrow("strict UTF-8");
    expect(() => parseGrandHallRawPoseCsv(rawCsv([
      "1000.000001,NaN,2.000000,3.000000,0.100000,0.200000,0.300000,0.900000",
    ]))).toThrow("strict finite decimal");
    expect(() => parseGrandHallRawPoseCsv(rawCsv([
      "1000.000001,1.000000,2.000000,3.000000,0.100000,0.200000,0.300000,0.900000",
      "1000.000001,1.100000,2.100000,3.100000,0.110000,0.210000,0.310000,0.890000",
    ]))).toThrow("strictly increasing");
    expect(() => parseGrandHallProcessedPoseJson(Buffer.from(JSON.stringify({
      poses: [{ ts: "1000.000001", T: [1, 2, 3], R: [1, 0, 0, 0], RGB: [1] }],
      fusionPoses: null,
    })))).toThrow();
    expect(() => parseGrandHallProcessedPoseJson(Buffer.from(JSON.stringify({
      poses: [{ ts: "1000.000001", T: [1, 2, 3], R: [1, 0, 0, 0], RGB: null }],
      fusionPoses: [],
    })))).toThrow();
  });
});

describe("Grand Hall pose-lineage diagnostics", () => {
  it("pairs timestamps deterministically and ranks all 24 sign-invariant permutations", () => {
    const trajectories = syntheticTrajectories();
    const pairs = pairGrandHallPoseTrajectories(trajectories.raw, trajectories.processed);
    expect(pairs).toHaveLength(20);
    expect(pairs.every((pair, index) => pair.rawIndex === index)).toBe(true);
    const diagnostic = evaluateGrandHallQuaternionPermutations(pairs);
    expect(diagnostic.scores).toHaveLength(24);
    expect(new Set(diagnostic.scores.map(
      (score) => score.rawComponentOrderToProcessedTuple,
    )).size).toBe(24);
    expect(diagnostic.uniquelyBestCandidate).toMatchObject({
      rawComponentOrderToProcessedTuple: "wxyz",
      status: "candidate_component_ordering_only",
    });
    expect(diagnostic.scores[0]?.signInvariantAngleDegrees.maximum).toBeLessThan(0.000_01);
  });

  it("fits only the declared 4:1 diagnostic split and generalizes to held-out points", () => {
    const trajectories = syntheticTrajectories(25);
    const pairs = pairGrandHallPoseTrajectories(trajectories.raw, trajectories.processed);
    const fit = fitGrandHallDiagnosticSimilarity(pairs);
    expect(fit.split).toEqual({
      method: "processed_index_modulo_5_equals_0_held_out",
      fitCount: 20,
      heldOutCount: 5,
      splitPredeclaredBeforeFit: true,
    });
    expect(fit.scale).toBeCloseTo(1.75, 9);
    expect(fit.rotationDeterminant).toBeCloseTo(1, 9);
    expect(fit.fitResiduals.rmse).toBeLessThan(1e-8);
    expect(fit.heldOutResiduals.rmse).toBeLessThan(1e-8);
    expect(fit.interpretation).toContain("diagnostic_alignment_only");
  });

  it("keeps every authority and use boundary hard-failed closed", () => {
    expect(GrandHallPoseLineageAuthorityGuardsSchema.parse(guards())).toEqual(guards());
    expect(() => GrandHallPoseLineageAuthorityGuardsSchema.parse({
      ...guards(),
      metricTransformAccepted: true,
    })).toThrow();
    expect(() => GrandHallPoseLineageAuthorityGuardsSchema.parse({
      ...guards(),
      runtimePermitted: true,
    })).toThrow();
  });

  it("parses the checked immutable authority-none receipt and verifies its self-digest", async () => {
    const receiptPath = resolve(
      import.meta.dirname,
      "../../../../docs/operations/grand-hall-xgrids-lcc-pose-lineage-authority-none-v1.json",
    );
    const receipt = parseGrandHallXgridsLccPoseLineage(await readFile(receiptPath));
    expect(receipt.bundleSha256).toBe(
      "sha256:11d5540cf2a22cc8e3c3c2386cd5236cf1d115b2276b0eddc1a58ede2f5f2aec",
    );
    expect(receipt.trajectoryPairing.pairCount).toBe(21_417);
    expect(receipt.quaternionPermutationDiagnostic.uniquelyBestCandidate).toMatchObject({
      rawComponentOrderToProcessedTuple: "wxyz",
      runnerUpRawComponentOrderToProcessedTuple: "xwzy",
    });
    expect(receipt.contract).toMatchObject({
      authority: "none",
      metricTransformAccepted: false,
      runtimePermitted: false,
      publicationPermitted: false,
    });
  });
});

describe("Grand Hall pose-lineage custody and CLI", () => {
  it("reads one direct file stably and catches a mutation during the same read", async () => {
    const root = await mkdtemp(join(tmpdir(), "grand-hall-pose-lineage-"));
    roots.push(root);
    const evidencePath = resolve(root, "evidence.txt");
    await writeFile(evidencePath, "evidence");
    const stable = await __testOnlyGrandHallPoseLineage.stableRead(
      evidencePath,
      "Test evidence",
      64,
    );
    expect(stable.sha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
    await expect(__testOnlyGrandHallPoseLineage.stableRead(
      evidencePath,
      "Test evidence",
      64,
      () => writeFile(evidencePath, "changed-and-longer"),
    )).rejects.toThrow("changed during its stable read");
    await expect(__testOnlyGrandHallPoseLineage.stableRead(
      "relative.txt",
      "Test evidence",
      64,
    )).rejects.toThrow("absolute local");
  });

  it("parses exact CLI options and freezes reviewed source identities", () => {
    expect(parseGrandHallPoseLineageArguments([
      "--check",
      "--raw-root", "F:\\raw",
      "--processed-root", "C:\\processed",
      "--inventory", "C:\\repo\\inventory.json",
      "--out", "C:\\repo\\receipt.json",
    ])).toEqual({
      check: true,
      rawRoot: "F:\\raw",
      processedRoot: "C:\\processed",
      inventoryPath: "C:\\repo\\inventory.json",
      outputPath: "C:\\repo\\receipt.json",
    });
    expect(() => parseGrandHallPoseLineageArguments([
      "--raw-root", "a", "--raw-root", "b",
    ])).toThrow("Duplicate CLI option");
    expect(GRAND_HALL_POSE_LINEAGE_EXPECTED_IDENTITIES).toMatchObject({
      rawPosesCsv: { byteLength: 3_659_287 },
      processedPoses: { byteLength: 2_561_254 },
      processedReport: { byteLength: 607 },
    });
  });
});
