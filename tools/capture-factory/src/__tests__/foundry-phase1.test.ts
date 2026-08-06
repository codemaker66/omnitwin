import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  CAPTURE_STAGE_SCHEMA_VERSION,
  FOUNDRY_PHASE1_IDENTITY_REVIEW_V0,
  FOUNDRY_PHASE1_PROBE_V0,
  FoundryPhase1IdentityReviewMaterialV0Schema,
  FoundryPhase1IdentityReviewV0Schema,
  FoundryPhase1BundleV0Schema,
  FoundryPhase1ColmapInspectionV0Schema,
  FoundryPhase1E57InspectionV0Schema,
  FoundryPhase1ProbeEnvelopeV0Schema,
  FoundryPhase1ResidualReportV0Schema,
  FoundryPhase1TransformProposalV0Schema,
  computeFoundryPhase1IdentityReviewSha256,
} from "@omnitwin/types";
import {
  __testOnlyRunFoundryPhase1 as runFoundryPhase1,
  type FoundryPhase1Dependencies,
  type FoundryPhase1Options,
} from "../foundry-phase1.js";
import { runCaptureFactoryCli } from "../cli-support.js";
import { sha256File, sha256Text } from "../hash.js";

const NOW = "2026-07-12T20:00:00.000Z";
const FACES = ["back", "down", "front", "left", "right", "up"] as const;
const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

interface Fixture {
  readonly parent: string;
  readonly stage: string;
  readonly colmap: string;
  readonly review: string;
  readonly probe: string;
  readonly output: string;
  readonly imageProbeRecords: readonly Readonly<Record<string, unknown>>[];
}

function buildReview(sourceE57Sha256: string) {
  const faceDigests = [0, 10, 20, 40, 49].flatMap((sweepIndex) =>
    ["front", "back", "left", "right", "up", "down"].map((face) => ({
      sweepIndex,
      face,
      sha256: `sha256:${sha256Text(`${String(sweepIndex)}:${face}`)}`,
      byteLength: 100,
    })),
  );
  const material = FoundryPhase1IdentityReviewMaterialV0Schema.parse({
    schemaVersion: FOUNDRY_PHASE1_IDENTITY_REVIEW_V0,
    reviewId: "grand-hall-identity-review-fixture",
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    sourceE57Sha256,
    evidenceIndexSha256: `sha256:${sha256Text("evidence-index")}`,
    reviewedSweepIndices: [0, 10, 20, 40, 49],
    faceDigests,
    reviewer: {
      actorType: "human",
      reviewerId: "codex-thread-user:fixture",
      reviewerRole: "human_reviewer",
      source: "codex_thread_reply",
      response: "b",
    },
    reviewedAt: NOW,
    decision: {
      code: "B",
      roomIdentityConfirmed: true,
      confirmedIdentitySweepIndices: [0, 10, 20, 40],
      excludedSweeps: [{ sweepIndex: 49, reason: "excluded_adjacent_space" }],
    },
  });
  return FoundryPhase1IdentityReviewV0Schema.parse({
    ...material,
    reviewSha256: computeFoundryPhase1IdentityReviewSha256(material),
  });
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function fixture(): Promise<Fixture> {
  const parent = await mkdtemp(join(tmpdir(), "foundry-phase1-"));
  cleanup.push(parent);
  const stage = join(parent, "stage");
  const colmap = join(parent, "colmap");
  const reviewPath = join(parent, "review.json");
  const probe = join(parent, "probe.py");
  const output = join(parent, "result");
  const e57 = join(stage, "source", "e57", "cloud_0.e57");
  await mkdir(dirname(e57), { recursive: true });
  await writeFile(e57, "ASTM-E57 fixture");
  const digest = await sha256File(e57);
  await writeJson(join(stage, "capture-stage-manifest.json"), {
    schemaVersion: CAPTURE_STAGE_SCHEMA_VERSION,
    sourceRoot: "REDACTED_SOURCE",
    planSha256: sha256Text("plan"),
    fileCount: 1,
    totalBytes: digest.sizeBytes,
    files: [
      {
        sourceRelativePath: "cloud_0.e57",
        targetRelativePath: "source/e57/cloud_0.e57",
        sizeBytes: digest.sizeBytes,
        sha256: digest.sha256,
        role: "primary_capture",
      },
    ],
  });
  const imageProbeRecords: Readonly<Record<string, unknown>>[] = [];
  for (let sweep = 0; sweep < 50; sweep += 1) {
    for (const face of FACES) {
      const name = `scan_${String(sweep).padStart(3, "0")}_${face}.jpg`;
      const path = join(colmap, "images", name);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `jpeg:${name}`);
      const imageDigest = await sha256File(path);
      imageProbeRecords.push({
        name,
        sweepIndex: sweep,
        face,
        byteSize: imageDigest.sizeBytes,
        sha256: imageDigest.sha256,
      });
    }
  }
  for (const name of ["cameras.bin", "frames.bin", "images.bin", "points3D.bin", "rigs.bin"]) {
    const path = join(colmap, "sparse", "0", name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `colmap:${name}`);
  }
  await writeFile(join(colmap, "sparse", "project.ini"), "project");
  await writeFile(join(colmap, "database.db"), "sqlite");
  await writeJson(reviewPath, buildReview(`sha256:${digest.sha256}`));
  await writeFile(probe, "# fixture probe\n");
  return { parent, stage, colmap, review: reviewPath, probe, output, imageProbeRecords };
}

function fixtureMatrix(scale: number): number[] {
  return [scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0, 1, 2, 3, 1];
}

function fixturePoint(sweepIndex: number): [number, number, number] {
  return [sweepIndex / 10, (sweepIndex % 7) / 3, (sweepIndex % 5) / 2];
}

const DOCUMENTED_FULL_FIT_SCALE = 1.7362602880766593;
const FIXTURE_FULL_FIT_RESIDUALS = [
  0.0451408721623258, 0.00472655584904739, 0.00521875458287411, 0.00608297470263102,
  0.00935736729876577, 0.00961651382908124, 0.00601842761817138, 0.00787393651472218,
  0.00695750040440312, 0.0110778768359929, 0.00675719809296735, 0.00489086123778089,
  0.00516099749903878, 0.0164190771130497, 0.00400618819006568, 0.0034170000931957,
  0.00478809117280791, 0.0153196196069408, 0.0249797677482544, 0.00835276873078588,
  0.000770530886731208, 0.00248997699182728, 0.00711294601517265, 0.00320431764696211,
  0.0103956207930381, 0.00618075378101423, 0.0133747018131473, 0.00729530728409582,
  0.00302916446819809, 0.00560827413871734, 0.00819801344272757, 0.00576062746965158,
  0.00432753650347893, 0.00458072819230154, 0.00681082264101229, 0.00104230840962295,
  0.00511062764609946, 0.00598683739972778, 0.00613851659702978, 0.00860711303972871,
  0.00891307584858205, 0.0124907161262134, 0.00833771775331945, 0.00518375210583337,
  0.00400478938265094, 0.00564784526324976, 0.00578165464195527, 0.00839332025583656,
  0.0163771961892046, 0.0132164483409061,
] as const;

function fixtureTarget(point: readonly number[], sweepIndex: number): [number, number, number] {
  return [
    DOCUMENTED_FULL_FIT_SCALE * (point[0] ?? 0) + 1 - (FIXTURE_FULL_FIT_RESIDUALS[sweepIndex] ?? 0),
    DOCUMENTED_FULL_FIT_SCALE * (point[1] ?? 0) + 2,
    DOCUMENTED_FULL_FIT_SCALE * (point[2] ?? 0) + 3,
  ];
}

function fixtureEvaluation(scale: number, sweepIndices: readonly number[]) {
  const perSweep = sweepIndices.map((sweepIndex) => {
    const source = fixturePoint(sweepIndex);
    const target = fixtureTarget(source, sweepIndex);
    const predicted = [scale * source[0] + 1, scale * source[1] + 2, scale * source[2] + 3];
    return { sweepIndex, residualMeters: Math.hypot(
      (predicted[0] ?? 0) - target[0],
      (predicted[1] ?? 0) - target[1],
      (predicted[2] ?? 0) - target[2],
    ) };
  });
  return {
    perSweep,
    statisticsMeters: { count: perSweep.length, maximum: 0, mean: 0, median: 0, p95: 0, rmse: 0 },
  };
}

function fakeProbe(mode: "inspect-e57" | "inspect-colmap" | "align", root: Fixture): unknown {
  const base = {
    schemaVersion: FOUNDRY_PHASE1_PROBE_V0,
    mode,
    status: "ok" as const,
  };
  if (mode === "inspect-e57") {
    return {
      ...base,
      result: {
        adapter: { name: "fixture-e57", version: "1.0.0" },
        openMode: "read-only",
        pointDataRead: false,
        file: { byteSize: 15 },
        scanCount: 50,
        imageCount: 300,
        scans: Array.from({ length: 50 }, (_, index) => ({ index, pointCount: 100 + index })),
      },
    };
  }
  if (mode === "inspect-colmap") {
    const names = root.imageProbeRecords.map((record) => ({
      imageId: Number(record.sweepIndex) * 6 + 1,
      name: record.name,
      cameraId: 1,
    }));
    return {
      ...base,
      result: {
        database: {
          immutable: true,
          queryOnly: true,
          trustedSchema: false,
          walByteSize: 0,
          images: names,
        },
        imageFiles: { count: 300, records: root.imageProbeRecords },
        sparseModel: {
          binaryFormat: { format: "COLMAP sparse binary", endianness: "little" },
          cameras: {
            count: 1,
            records: [{ cameraId: 1, modelName: "PINHOLE", width: 1024, height: 1024, params: [512, 512, 512, 512] }],
          },
          images: { count: 231, records: [] },
          points3D: { count: 1000 },
          registeredSweepGroups: Array.from({ length: 50 }, (_, sweepIndex) => ({ sweepIndex })),
        },
      },
    };
  }
  const allSweeps = Array.from({ length: 50 }, (_, index) => index);
  const candidateSweeps = Array.from({ length: 49 }, (_, index) => index);
  const holdoutSweeps = [5, 15, 25, 35, 44];
  const fitSweeps = candidateSweeps.filter((index) => !holdoutSweeps.includes(index));
  return {
    ...base,
    result: {
      conventions: {
        colmapCameraCenter: "C=-R^T*t",
        colmapPose: "Hamilton qvec [w,x,y,z], world-to-camera",
        correspondenceAggregation: "unweighted arithmetic mean of registered face camera centres per sweep",
        e57ScanCenter: "data3D pose.translation in the E57 root frame",
        matrixLayout: "4x4 column-major; target=scale*rotation*source+translation",
        outlierRejection: "none",
        percentileMethod: "linear",
        reflectionPolicy: "forbidden; determinant(rotation) must be +1",
        similarityMethod: "isotropic Umeyama/SVD, unweighted",
      },
      correspondences: allSweeps.map((sweepIndex) => {
        const center = fixturePoint(sweepIndex);
        return {
          sweepIndex,
          registeredFaceCount: 1,
          registeredFaces: ["front"],
          colmapFaceCenters: [{
            imageName: `scan_${String(sweepIndex).padStart(3, "0")}_front.jpg`,
            face: "front",
            centerColmapWorld: center,
          }],
          colmapMeanCameraCenter: center,
          e57ScanCenter: fixtureTarget(center, sweepIndex),
        };
      }),
      fullFit: {
        fitSweepIndices: allSweeps,
        transform: {
          scale: DOCUMENTED_FULL_FIT_SCALE,
          determinantRotation: 1,
          translation: [1, 2, 3],
          matrixColumnMajor: fixtureMatrix(DOCUMENTED_FULL_FIT_SCALE),
        },
        evaluation: fixtureEvaluation(DOCUMENTED_FULL_FIT_SCALE, allSweeps),
      },
      phase1CandidateWithHoldout: {
        candidateSweepIndices: candidateSweeps,
        fitSweepIndices: fitSweeps,
        heldOutSweepIndices: holdoutSweeps,
        transform: {
          scale: 1.7362,
          determinantRotation: 1,
          translation: [1, 2, 3],
          matrixColumnMajor: fixtureMatrix(1.7362),
        },
        trainingEvaluation: fixtureEvaluation(1.7362, fitSweeps),
        heldOutEvaluation: fixtureEvaluation(1.7362, holdoutSweeps),
        pilotEvaluation: fixtureEvaluation(1.7362, candidateSweeps),
      },
    },
  };
}

function dependencies(root: Fixture): FoundryPhase1Dependencies {
  return {
    hashFile: sha256File,
    resolvePythonExecutable: () => Promise.resolve(root.probe),
    resolvePythonDependencyRoot: () => Promise.resolve(root.parent),
    invokeProbe: (_python, _script, _dependencyRoot, args) => {
      const mode = args[0];
      if (mode !== "inspect-e57" && mode !== "inspect-colmap" && mode !== "align") {
        return Promise.reject(new Error(`unexpected fixture mode: ${String(mode)}`));
      }
      return Promise.resolve(fakeProbe(mode, root));
    },
    validateIdentityReview: (input) => FoundryPhase1IdentityReviewV0Schema.parse(input),
    validateProbe: (input) => {
      const parsed = FoundryPhase1ProbeEnvelopeV0Schema.parse(input);
      if (parsed.status !== "ok") throw new Error(parsed.error.message);
      return parsed;
    },
  };
}

function options(root: Fixture, outputDirectory = root.output): FoundryPhase1Options {
  return {
    identityReviewPath: root.review,
    captureStageRoot: root.stage,
    colmapRoot: root.colmap,
    outputDirectory,
    projectId: "grand-hall-phase1",
    createdBy: "operator-fixture",
    createdAt: NOW,
  };
}

describe("runFoundryPhase1", () => {
  it("emits a deterministic immutable phase-1 package after decision B", async () => {
    const root = await fixture();
    const result = await runFoundryPhase1(options(root), dependencies(root));
    expect(result).toMatchObject({ assetCount: 308, includedSweeps: [0, 10, 20, 40], excludedSweeps: [49] });
    const manifest = JSON.parse(await readFile(join(root.output, "foundry-ingest-manifest-v0.json"), "utf8"));
    expect(manifest).toMatchObject({ legalReviewState: "requires_review", sourceMutationPermitted: false });
    expect(manifest.assets).toHaveLength(308);
    expect(manifest.assets.filter((asset: { relativePath: string }) => asset.relativePath.startsWith("images/"))).toHaveLength(300);
    expect(manifest.assets.find((asset: { relativePath: string }) => asset.relativePath === "database.db")?.inputType).toBe("colmap_database");
    expect(
      manifest.assets
        .filter((asset: { relativePath: string }) => asset.relativePath.startsWith("sparse/"))
        .every((asset: { inputType: string }) => asset.inputType === "colmap_sparse_model"),
    ).toBe(true);
    expect(manifest.assets.find((asset: { relativePath: string }) => asset.relativePath === "database.db-wal")).toBeUndefined();
    expect(manifest.provenanceEdges).toEqual([]);
    const e57Inspection = FoundryPhase1E57InspectionV0Schema.parse(
      JSON.parse(await readFile(join(root.output, "inspections", "e57-inspection.json"), "utf8")),
    );
    const colmapInspection = FoundryPhase1ColmapInspectionV0Schema.parse(
      JSON.parse(await readFile(join(root.output, "inspections", "colmap-inspection.json"), "utf8")),
    );
    expect(e57Inspection.sourceMutationPermitted).toBe(false);
    expect(colmapInspection.registeredSweepIndices).toEqual(Array.from({ length: 50 }, (_, index) => index));
    const residualReport = FoundryPhase1ResidualReportV0Schema.parse(
      JSON.parse(await readFile(join(root.output, "reports", "colmap-to-e57-residual-report.json"), "utf8")),
    );
    expect(residualReport.phase1CandidateWithHoldout.fitSweepIndices).toHaveLength(44);
    const proposal = FoundryPhase1TransformProposalV0Schema.parse(
      JSON.parse(await readFile(join(root.output, "proposals", "colmap-to-e57-transform.json"), "utf8")),
    );
    expect(proposal).toMatchObject({
      state: "proposed",
      reviewer: null,
      reviewerAttestationSha256: null,
      authority: { public: "none", runtime: "none" },
    });
    expect(proposal.scale).toBe(1.7362);
    expect(proposal.fitSweepIndices).toHaveLength(44);
    expect(proposal.fitSweepIndices).not.toContain(49);
    expect(proposal.holdoutSweepIndices).toEqual([5, 15, 25, 35, 44]);
    const scan49 = manifest.assets.filter((asset: { relativePath: string }) =>
      asset.relativePath.startsWith("images/scan_049_"),
    );
    expect(scan49).toHaveLength(6);
    expect(scan49.every((asset: { notes: string[] }) => asset.notes[0]?.includes("Reproduction-only"))).toBe(true);
    expect(
      FoundryPhase1BundleV0Schema.parse(
        JSON.parse(await readFile(join(root.output, "foundry-phase1-bundle-v0.json"), "utf8")),
      ).transformProposal.proposalSha256,
    ).toBe(proposal.proposalSha256);
    const outputIndex = JSON.parse(await readFile(join(root.output, "phase1-output-index.json"), "utf8"));
    expect(outputIndex).toMatchObject({
      probeExecutionPolicy: { bundledProbeOnly: true, inheritedEnvironment: false, isolatedPython: true },
    });
    expect(outputIndex.pythonInterpreterSha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it("produces byte-identical output with a frozen clock", async () => {
    const root = await fixture();
    const first = join(root.parent, "first");
    const second = join(root.parent, "second");
    await runFoundryPhase1(options(root, first), dependencies(root));
    await runFoundryPhase1(options(root, second), dependencies(root));
    for (const relativePath of [
      "foundry-ingest-manifest-v0.json",
      "phase1-output-index.json",
      "reports/alignment-full-fit-residuals.json",
      "reports/alignment-frozen-holdout-residuals.json",
      "proposals/colmap-to-e57-transform.json",
    ]) {
      expect(await readFile(join(first, ...relativePath.split("/")))).toEqual(
        await readFile(join(second, ...relativePath.split("/"))),
      );
    }
  });

  it("refuses missing or rejected human review without creating output", async () => {
    const root = await fixture();
    await rm(root.review);
    await expect(runFoundryPhase1(options(root), dependencies(root))).rejects.toThrow();
    await expect(readFile(join(root.output, "phase1-output-index.json"))).rejects.toMatchObject({ code: "ENOENT" });
    await writeJson(root.review, { schemaVersion: FOUNDRY_PHASE1_IDENTITY_REVIEW_V0, decision: { code: "C" } });
    await expect(runFoundryPhase1(options(root), dependencies(root))).rejects.toThrow();
    await expect(readFile(join(root.output, "phase1-output-index.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses output overlap and linked source roots", async () => {
    const root = await fixture();
    await expect(
      runFoundryPhase1(options(root, join(root.colmap, "output")), dependencies(root)),
    ).rejects.toThrow("must not overlap");
    const linked = join(root.parent, "linked-colmap");
    await symlink(root.colmap, linked, "junction");
    await expect(
      runFoundryPhase1({ ...options(root), colmapRoot: linked }, dependencies(root)),
    ).rejects.toThrow(/link|reparse/u);
  });

  it("refuses repository and UNC output destinations", async () => {
    const root = await fixture();
    const repositoryOutput = join(dirname(fileURLToPath(import.meta.url)), "unsafe-phase1-output");
    await expect(runFoundryPhase1(options(root, repositoryOutput), dependencies(root))).rejects.toThrow(
      "must not overlap",
    );
    await expect(
      runFoundryPhase1(options(root, "\\\\server\\share\\phase1"), dependencies(root)),
    ).rejects.toThrow("local non-UNC");
  });

  it("refuses a staged E57 digest mismatch", async () => {
    const root = await fixture();
    await writeFile(join(root.stage, "source", "e57", "cloud_0.e57"), "changed after staging");
    await expect(runFoundryPhase1(options(root), dependencies(root))).rejects.toThrow("do not match");
  });

  it("refuses an otherwise valid identity review bound to a different E57", async () => {
    const root = await fixture();
    await writeJson(root.review, buildReview(`sha256:${sha256Text("different-e57")}`));
    await expect(runFoundryPhase1(options(root), dependencies(root))).rejects.toThrow(
      "Identity review E57 digest does not match",
    );
    await expect(readFile(join(root.output, "phase1-output-index.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses a nonempty COLMAP WAL and excludes an empty WAL", async () => {
    const root = await fixture();
    const wal = join(root.colmap, "database.db-wal");
    await writeFile(wal, "pending transaction");
    await expect(runFoundryPhase1(options(root), dependencies(root))).rejects.toThrow("nonempty WAL");
    await writeFile(wal, "");
    const result = await runFoundryPhase1(options(root), dependencies(root));
    expect(result.assetCount).toBe(308);
  });

  it("refuses a COLMAP rollback journal", async () => {
    const root = await fixture();
    await writeFile(join(root.colmap, "database.db-journal"), "pending transaction");
    await expect(runFoundryPhase1(options(root), dependencies(root))).rejects.toThrow("rollback journal");
  });

  it("detects a bounded input mutation after hashing and leaves no final output", async () => {
    const root = await fixture();
    const base = dependencies(root);
    const mutating: FoundryPhase1Dependencies = {
      ...base,
      invokeProbe: (_python, _script, _dependencyRoot, args) => {
        const mode = args[0];
        if (mode !== "inspect-e57" && mode !== "inspect-colmap" && mode !== "align") {
          return Promise.reject(new Error(`unexpected fixture mode: ${String(mode)}`));
        }
        if (mode === "align") {
          return writeFile(join(root.colmap, "database.db"), "mutated after hash").then(() => fakeProbe(mode, root));
        }
        return Promise.resolve(fakeProbe(mode, root));
      },
    };
    await expect(runFoundryPhase1(options(root), mutating)).rejects.toThrow("changed after hashing");
    await expect(readFile(join(root.output, "phase1-output-index.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rehashes inputs after probing even when size and mtime appear unchanged", async () => {
    const root = await fixture();
    const base = dependencies(root);
    let changed = false;
    const databasePath = join(root.colmap, "database.db");
    const mutating: FoundryPhase1Dependencies = {
      ...base,
      hashFile: async (path) => {
        const digest = await sha256File(path);
        return changed && path === databasePath
          ? { ...digest, sha256: sha256Text(`changed:${digest.sha256}`) }
          : digest;
      },
      invokeProbe: (_python, _script, _dependencyRoot, args) => {
        const mode = args[0];
        if (mode !== "inspect-e57" && mode !== "inspect-colmap" && mode !== "align") {
          return Promise.reject(new Error(`unexpected fixture mode: ${String(mode)}`));
        }
        if (mode === "align") changed = true;
        return Promise.resolve(fakeProbe(mode, root));
      },
    };
    await expect(runFoundryPhase1(options(root), mutating)).rejects.toThrow("content changed after hashing");
    await expect(readFile(join(root.output, "phase1-output-index.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("atomically refuses an existing final directory", async () => {
    const root = await fixture();
    await mkdir(root.output);
    await writeFile(join(root.output, "owner.txt"), "preserve");
    await expect(runFoundryPhase1(options(root), dependencies(root))).rejects.toThrow("already exists");
    expect(await readFile(join(root.output, "owner.txt"), "utf8")).toBe("preserve");
  });
});

describe("foundry-phase1 CLI boundary", () => {
  it("does not expose caller-controlled Python or probe flags", async () => {
    await expect(runCaptureFactoryCli(["foundry-phase1", "--python", "attacker.exe"])).rejects.toThrow(
      /Unknown option|unknown option/u,
    );
    await expect(runCaptureFactoryCli(["foundry-phase1", "--probe", "attacker.py"])).rejects.toThrow(
      /Unknown option|unknown option/u,
    );
  });
});
