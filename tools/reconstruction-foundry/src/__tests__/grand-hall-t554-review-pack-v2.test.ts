import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { link, mkdir, mkdtemp, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  GRAND_HALL_AGENT_OBSERVED_POSITIVE_SWEEP_NUMBERS,
  GrandHallScopeReviewPackV1Schema,
  type GrandHallScopeReviewPackV1,
} from "@omnitwin/types";
import { afterEach, describe, expect, it } from "vitest";

import {
  GRAND_HALL_T554_V2_CLOSED_VOLUME_TEMPLATE_FILENAME,
  GRAND_HALL_T554_V2_HUMAN_DECISIONS_FILENAME,
  GRAND_HALL_T554_V2_PUBLICATION_RECEIPT_FILENAME,
  GRAND_HALL_T554_V2_REVIEW_PACK_FILENAME,
  GrandHallT554ReviewPackV2Error,
  assertGrandHallT554ReviewPackV2T561Bindings,
  buildGrandHallT554ReviewPackV2,
  checkGrandHallT554ReviewPackV2,
  generateGrandHallT554ReviewPackV2,
  type GrandHallT554ReviewPackV2Dependencies,
  type GrandHallT554ReviewPackV2Options,
  type GrandHallT554ReviewPackV2SourceBundle,
} from "../grand-hall-t554-review-pack-v2.js";
import {
  GRAND_HALL_T554_EXPECTED_PANORAMA_INVENTORY_SHA256,
  GRAND_HALL_T554_EXACT_PANORAMA_MANIFEST_SHA256,
} from "../grand-hall-t554-panorama-review.js";
import {
  GRAND_HALL_T561_OBSERVATION_INPUT_SCHEMA,
  GRAND_HALL_T561_OBSERVATION_RECEIPT_SCHEMA,
  buildGrandHallT561ObservationManifest,
  sealGrandHallT561ObservationInput,
  serializeGrandHallT561ObservationInput,
  type GrandHallT561ObservationReceipt,
  type GrandHallT561ObservationInputMaterial,
} from "../grand-hall-t561-panorama-visual-observation.js";

const roots: string[] = [];
const POSITIVE_SWEEPS = new Set<number>(GRAND_HALL_AGENT_OBSERVED_POSITIVE_SWEEP_NUMBERS);

function sha(bytes: Buffer | string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function predecessor(): GrandHallScopeReviewPackV1 {
  const path = resolve(
    process.cwd(),
    "../../docs/operations/grand-hall-t554-review-pack/review-pack.json",
  );
  return GrandHallScopeReviewPackV1Schema.parse(JSON.parse(readFileSync(path, "utf8")) as unknown);
}

function observationRecord(file: GrandHallScopeReviewPackV1["panoramaDirectoryFiles"][number]) {
  const observed = POSITIVE_SWEEPS.has(file.embeddedSweepNumber ?? -1);
  return {
    sweepNumber: file.embeddedSweepNumber as number,
    relativePath: file.fileName,
    byteLength: file.byteLength,
    sha256: file.sha256 as `sha256:${string}`,
    widthPx: 8_192 as const,
    heightPx: 4_096 as const,
    observationState: observed
      ? "grand_hall_pixels_observed" as const
      : "no_grand_hall_pixels_observed" as const,
    frameContext: observed ? "broad_grand_hall_view" as const : "no_grand_hall_pixels_observed" as const,
    boundarySensitive: false,
    attentionRegions: [],
    note: `Authority-none observation of sweep ${String(file.embeddedSweepNumber)}.`,
    authority: "none" as const,
    humanReviewState: "pending" as const,
    roomMembershipAuthority: "none" as const,
    cameraPoseAuthority: "none" as const,
    maskAuthority: "none" as const,
    trainingInputPermitted: false as const,
    reconstructionInputPermitted: false as const,
    runtimeInputPermitted: false as const,
    publicEvidencePermitted: false as const,
  };
}

function t561Receipt(
  manifestSha256: `sha256:${string}`,
  observationSetSha256: `sha256:${string}`,
): GrandHallT561ObservationReceipt {
  return {
    schemaVersion: GRAND_HALL_T561_OBSERVATION_RECEIPT_SCHEMA,
    state: "complete",
    authority: "none",
    manifestSha256,
    panoramaInventorySha256: GRAND_HALL_T554_EXPECTED_PANORAMA_INVENTORY_SHA256,
    observationSetSha256,
    payloadFileCount: 1,
    outputFileCount: 2,
    payloads: [{
      relativePath: "panorama-visual-observations-authority-none.json",
      byteLength: 100,
      sha256: sha("manifest-file"),
    }],
    guards: {
      sourceMutationPermitted: false,
      humanAcceptanceRecorded: false,
      nativeResolutionHumanReviewCompleted: false,
      roomMembershipAuthority: "none",
      cameraStationInferred: false,
      cameraPoseAuthority: "none",
      maskGenerated: false,
      maskAuthority: "none",
      t550CandidateSetChanged: false,
      t554AcceptanceAuthorized: false,
      trainingAuthorized: false,
      reconstructionAuthorized: false,
      runtimeAuthorized: false,
      stagingAuthorized: false,
      publicEvidenceAuthorized: false,
      generatedContentUsed: false,
    },
    receiptSha256: sha("t561-receipt"),
  };
}

function sourceBundle(): GrandHallT554ReviewPackV2SourceBundle {
  const v1 = predecessor();
  const material: GrandHallT561ObservationInputMaterial = {
    schemaVersion: GRAND_HALL_T561_OBSERVATION_INPUT_SCHEMA,
    subject: {
      venueSlug: "trades-hall" as const,
      roomSlug: "grand-hall" as const,
      taskId: "T-561" as const,
      scope: "agent_visual_observation_of_all_supplied_panoramas" as const,
    },
    authority: "none" as const,
    inspection: {
      method: "agent_visual_review_of_exact_source_file" as const,
      displayedWidthPx: 2_048 as const,
      displayedHeightPx: 1_024 as const,
      displayMayHaveBeenResampled: true as const,
      nativeResolutionHumanReviewCompleted: false as const,
      humanAcceptanceRecorded: false as const,
    },
    sourceBindings: {
      t554PanoramaManifestSha256: GRAND_HALL_T554_EXACT_PANORAMA_MANIFEST_SHA256,
      panoramaInventorySha256: GRAND_HALL_T554_EXPECTED_PANORAMA_INVENTORY_SHA256,
      presentSourceCount: 148 as const,
      absentSweepNumbersWithin1To149: [93] as [93],
    },
    records: v1.panoramaDirectoryFiles.map(observationRecord),
    absentSources: [{
      sweepNumber: 93 as const,
      sourceState: "absent_from_exact_supplied_inventory" as const,
      visualObservationState: "not_observable_source_absent" as const,
      authority: "none" as const,
    }] as const,
  };
  const input = sealGrandHallT561ObservationInput(material);
  const inputBytes = serializeGrandHallT561ObservationInput(input);
  const manifest = buildGrandHallT561ObservationManifest(
    input,
    { sha256: sha(inputBytes), byteLength: inputBytes.length },
    [],
  );
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const receipt = t561Receipt(manifest.manifestSha256, input.observationSetSha256);
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  const predecessorBytes = Buffer.from(`${JSON.stringify(v1, null, 2)}\n`, "utf8");
  return {
    predecessor: v1,
    predecessorFile: { bytes: predecessorBytes, sha256: sha(predecessorBytes) },
    observationInput: input,
    observationInputFile: { bytes: inputBytes, sha256: sha(inputBytes) },
    observationManifest: manifest,
    observationManifestFile: { bytes: manifestBytes, sha256: sha(manifestBytes) },
    observationReceipt: receipt,
    observationReceiptFile: { bytes: receiptBytes, sha256: sha(receiptBytes) },
  };
}

async function harness(): Promise<{
  readonly options: GrandHallT554ReviewPackV2Options;
  readonly dependencies: GrandHallT554ReviewPackV2Dependencies;
}> {
  const root = await mkdtemp(join(tmpdir(), "grand-hall-t554-v2-"));
  roots.push(root);
  const predecessorReviewRoot = join(root, "v1");
  const t561ObservationPackDirectory = join(root, "t561");
  await mkdir(predecessorReviewRoot);
  await mkdir(t561ObservationPackDirectory);
  const t561ObservationInputPath = join(root, "observations.json");
  await writeFile(t561ObservationInputPath, "test-only", { flag: "wx" });
  return {
    options: {
      predecessorReviewRoot,
      t561ObservationInputPath,
      t561ObservationPackDirectory,
      outputDirectory: join(root, "v2"),
    },
    dependencies: { loadSources: () => Promise.resolve(sourceBundle()) },
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("T-554 v2 exact human-pending artifacts", () => {
  it("compares ordered T-561 observations by canonical value rather than object identity", () => {
    const bundle = sourceBundle();
    const verified = {
      manifestSha256: bundle.observationManifest.manifestSha256,
      receiptSha256: bundle.observationReceipt.receiptSha256,
    };
    expect(() => {
      assertGrandHallT554ReviewPackV2T561Bindings(
        bundle.observationInput,
        bundle.observationInputFile,
        bundle.observationManifest,
        bundle.observationReceipt,
        verified,
      );
    }).not.toThrow();

    const first = bundle.observationManifest.records[0];
    if (first === undefined) throw new Error("Synthetic T-561 fixture is empty.");
    const changedManifest = {
      ...bundle.observationManifest,
      records: [{ ...first, note: `${first.note} drift` }, ...bundle.observationManifest.records.slice(1)],
    };
    expect(() => {
      assertGrandHallT554ReviewPackV2T561Bindings(
        bundle.observationInput,
        bundle.observationInputFile,
        changedManifest,
        bundle.observationReceipt,
        verified,
      );
    }).toThrow("ordered observations mismatch");
  });

  it("keeps 148 source observations distinct from blank human decisions", () => {
    const built = buildGrandHallT554ReviewPackV2(sourceBundle());

    expect(built.reviewPack.panoramaRecords).toHaveLength(148);
    expect(built.reviewPack.observationSummary).toEqual({
      sourceRecordCount: 148,
      grandHallPixelsObservedHumanPendingCount: 74,
      noGrandHallPixelsObservedHumanPendingCount: 74,
      humanPendingCount: 148,
    });
    expect(built.reviewPack.interfaceCandidates).toHaveLength(8);
    expect(built.humanDecisions.panoramaDecisions.every((decision) =>
      decision.result === "UNSURE" && decision.maskFileName === null && !decision.maskReviewed
    )).toBe(true);
    expect(built.humanDecisions.interfaceDecisions).toHaveLength(8);
    expect(built.humanDecisions.cleanupArtifactInspections.map((row) => row.artifactClass))
      .toEqual(["Window", "Mirror"]);
    expect(built.humanDecisions.matterPakRoomDecision.result).toBe("UNSURE");
    expect(built.closedVolumeTemplate).toMatchObject({
      reviewState: "human_pending",
      footprintXY: [],
      zMin: null,
      zMax: null,
      rendered: false,
    });
    expect(built.reviewPack.sourceEvidence.t561AuthorityNoneObservation.inspection)
      .toMatchObject({ displayedWidthPx: 2_048, displayedHeightPx: 1_024, nativeResolutionHumanReviewCompleted: false });
  });

  it("publishes receipt last, refuses replacement, and checks with zero writes", async () => {
    const { options, dependencies } = await harness();
    const generated = await generateGrandHallT554ReviewPackV2(options, dependencies);
    const names = [
      GRAND_HALL_T554_V2_CLOSED_VOLUME_TEMPLATE_FILENAME,
      GRAND_HALL_T554_V2_HUMAN_DECISIONS_FILENAME,
      GRAND_HALL_T554_V2_PUBLICATION_RECEIPT_FILENAME,
      GRAND_HALL_T554_V2_REVIEW_PACK_FILENAME,
    ];
    const before = await Promise.all(names.map(async (name) => ({
      name,
      bytes: await readFile(join(options.outputDirectory, name)),
      modified: (await stat(join(options.outputDirectory, name), { bigint: true })).mtimeNs,
    })));
    const checked = await checkGrandHallT554ReviewPackV2(options, dependencies);
    const after = await Promise.all(names.map(async (name) => ({
      name,
      bytes: await readFile(join(options.outputDirectory, name)),
      modified: (await stat(join(options.outputDirectory, name), { bigint: true })).mtimeNs,
    })));

    expect(generated).toMatchObject({ panoramaDecisionCount: 148, interfaceDecisionCount: 8, authority: "none" });
    expect(checked.exactRegenerationVerified).toBe(true);
    expect(after.map((row) => [row.name, row.modified, sha(row.bytes)]))
      .toEqual(before.map((row) => [row.name, row.modified, sha(row.bytes)]));
    await expect(generateGrandHallT554ReviewPackV2(options, dependencies)).rejects.toBeDefined();
  });

  it("rejects missing, extra, changed, and hard-linked output artifacts", async () => {
    for (const attack of ["missing", "extra", "changed", "hardlink"] as const) {
      const { options, dependencies } = await harness();
      await generateGrandHallT554ReviewPackV2(options, dependencies);
      const reviewPath = join(options.outputDirectory, GRAND_HALL_T554_V2_REVIEW_PACK_FILENAME);
      if (attack === "missing") await unlink(reviewPath);
      if (attack === "extra") await writeFile(join(options.outputDirectory, "extra.json"), "{}", { flag: "wx" });
      if (attack === "changed") await writeFile(reviewPath, "{}", { flag: "w" });
      if (attack === "hardlink") await link(reviewPath, join(options.predecessorReviewRoot, "alias.json"));
      await expect(checkGrandHallT554ReviewPackV2(options, dependencies))
        .rejects.toBeInstanceOf(GrandHallT554ReviewPackV2Error);
    }
  });
});
