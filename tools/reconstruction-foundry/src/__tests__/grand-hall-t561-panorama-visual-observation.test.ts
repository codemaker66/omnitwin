import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import {
  GRAND_HALL_T554_EXACT_PANORAMA_MANIFEST_SHA256,
  GRAND_HALL_T554_EXPECTED_PANORAMA_INVENTORY_SHA256,
  GRAND_HALL_T554_PANORAMA_SOURCE_LOCATOR,
  parseGrandHallT554PanoramaFilename,
  type GrandHallT554PanoramaInventory,
  type GrandHallT554PanoramaInventoryFile,
} from "../grand-hall-t554-panorama-review.js";
import {
  GRAND_HALL_T561_INSPECTION_DISPLAY_HEIGHT_PX,
  GRAND_HALL_T561_INSPECTION_DISPLAY_WIDTH_PX,
  GRAND_HALL_T561_MANIFEST_FILENAME,
  GRAND_HALL_T561_OBSERVATION_INPUT_SCHEMA,
  GRAND_HALL_T561_RECEIPT_FILENAME,
  GRAND_HALL_T561_REVIEW_AID_HEIGHT_PX,
  GrandHallT561PanoramaVisualObservationError,
  buildGrandHallT561ObservationManifest,
  checkGrandHallT561ObservationPack,
  generateGrandHallT561ObservationPack,
  parseGrandHallT561ObservationInput,
  renderGrandHallT561ReviewAid,
  sealGrandHallT561ObservationInput,
  serializeGrandHallT561ObservationInput,
  type GrandHallT561BuildDependencies,
  type GrandHallT561ObservationInput,
  type GrandHallT561ObservationInputMaterial,
  type GrandHallT561ObservationRecord,
} from "../grand-hall-t561-panorama-visual-observation.js";

const temporaryRoots: string[] = [];
type ObservationMode = "none" | "broad" | "boundary" | "uncertain";

function modesMap(entries: readonly (readonly [number, ObservationMode])[]): ReadonlyMap<number, ObservationMode> {
  return new Map<number, ObservationMode>(entries);
}

function digestFor(value: string | number): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(String(value), "utf8").digest("hex")}`;
}

function sourceBytes(sweepNumber: number): Buffer {
  return Buffer.alloc(1_000 + sweepNumber, sweepNumber % 251);
}

function relativePathFor(sweepNumber: number): string {
  if (sweepNumber === 99 || sweepNumber === 145) {
    return `sweep_${String(sweepNumber).padStart(3, "0")}pg.jpg`;
  }
  const digits = sweepNumber >= 148
    ? String(sweepNumber).padStart(4, "0")
    : String(sweepNumber).padStart(3, "0");
  return `sweep_${digits}jpg.jpg`;
}

function sourceRecord(sweepNumber: number): GrandHallT554PanoramaInventoryFile {
  const relativePath = relativePathFor(sweepNumber);
  const parsed = parseGrandHallT554PanoramaFilename(relativePath);
  return {
    sourceLocator: `${GRAND_HALL_T554_PANORAMA_SOURCE_LOCATOR}/${relativePath}`,
    relativePath,
    sweepNumber,
    digitToken: parsed.digitToken,
    namingAnomalies: parsed.namingAnomalies,
    byteLength: 1_000 + sweepNumber,
    sha256: `sha256:${createHash("sha256").update(sourceBytes(sweepNumber)).digest("hex")}`,
    mediaType: "image/jpeg",
    widthPx: 8_192,
    heightPx: 4_096,
    jpegFrame: "baseline_dct",
    jfifHeaderPresent: true,
    stableDuringRead: true,
  };
}

function fakeInventory(): GrandHallT554PanoramaInventory {
  const files = Array.from({ length: 149 }, (_, index) => index + 1)
    .filter((sweepNumber) => sweepNumber !== 93)
    .map(sourceRecord);
  return {
    sourceLocator: GRAND_HALL_T554_PANORAMA_SOURCE_LOCATOR,
    fileCount: 148,
    totalBytes: files.reduce((total, file) => total + file.byteLength, 0),
    files,
    inventorySha256: GRAND_HALL_T554_EXPECTED_PANORAMA_INVENTORY_SHA256,
    missingSweepNumbersWithin1To149: [93],
    readMode: "read_only",
    sourceMutationPermitted: false,
    networkAccess: "none",
  };
}

function region(sweepNumber: number, wrapsHorizontalSeam = false) {
  return {
    regionId: `s${String(sweepNumber).padStart(3, "0")}-r01`,
    contentHint: "visual_boundary_uncertain" as const,
    coordinateSpace: "source_equirectangular_pixels_top_left_origin" as const,
    coverageIntent: "conservative_attention_area" as const,
    wrapsHorizontalSeam,
    sourcePixelRectangles: wrapsHorizontalSeam
      ? [
          { x: 0, y: 800, width: 400, height: 1_600 },
          { x: 7_800, y: 800, width: 392, height: 1_600 },
        ]
      : [{ x: 1_000, y: 800, width: 1_600, height: 1_600 }],
    authority: "none" as const,
  };
}

function observationRecord(
  source: GrandHallT554PanoramaInventoryFile,
  mode: ObservationMode = "none",
): GrandHallT561ObservationRecord {
  const base = {
    sweepNumber: source.sweepNumber,
    relativePath: source.relativePath,
    byteLength: source.byteLength,
    sha256: source.sha256,
    widthPx: 8_192 as const,
    heightPx: 4_096 as const,
    note: `Agent observation for sweep ${String(source.sweepNumber)}.`,
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
  if (mode === "broad") return {
    ...base,
    observationState: "grand_hall_pixels_observed",
    frameContext: "broad_grand_hall_view",
    boundarySensitive: false,
    attentionRegions: [],
  };
  if (mode === "boundary") return {
    ...base,
    observationState: "grand_hall_pixels_observed",
    frameContext: "mixed_boundary_frame",
    boundarySensitive: true,
    attentionRegions: [region(source.sweepNumber)],
  };
  if (mode === "uncertain") return {
    ...base,
    observationState: "uncertain_possible_grand_hall_pixels",
    frameContext: "uncertain",
    boundarySensitive: true,
    attentionRegions: [region(source.sweepNumber, true)],
  };
  return {
    ...base,
    observationState: "no_grand_hall_pixels_observed",
    frameContext: "no_grand_hall_pixels_observed",
    boundarySensitive: false,
    attentionRegions: [],
  };
}

function inputMaterial(
  modes: ReadonlyMap<number, ObservationMode> = modesMap([[1, "boundary"]]),
): GrandHallT561ObservationInputMaterial {
  return {
    schemaVersion: GRAND_HALL_T561_OBSERVATION_INPUT_SCHEMA,
    subject: {
      venueSlug: "trades-hall",
      roomSlug: "grand-hall",
      taskId: "T-561",
      scope: "agent_visual_observation_of_all_supplied_panoramas",
    },
    authority: "none",
    inspection: {
      method: "agent_visual_review_of_exact_source_file",
      displayedWidthPx: 2_048,
      displayedHeightPx: 1_024,
      displayMayHaveBeenResampled: true,
      nativeResolutionHumanReviewCompleted: false,
      humanAcceptanceRecorded: false,
    },
    sourceBindings: {
      t554PanoramaManifestSha256: GRAND_HALL_T554_EXACT_PANORAMA_MANIFEST_SHA256,
      panoramaInventorySha256: GRAND_HALL_T554_EXPECTED_PANORAMA_INVENTORY_SHA256,
      presentSourceCount: 148,
      absentSweepNumbersWithin1To149: [93],
    },
    records: fakeInventory().files.map((source) =>
      observationRecord(source, modes.get(source.sweepNumber) ?? "none")
    ),
    absentSources: [{
      sweepNumber: 93,
      sourceState: "absent_from_exact_supplied_inventory",
      visualObservationState: "not_observable_source_absent",
      authority: "none",
    }],
  };
}

function serializedInput(input: GrandHallT561ObservationInput): Buffer {
  return serializeGrandHallT561ObservationInput(input);
}

async function tinyJpeg(): Promise<Buffer> {
  return await sharp({
    create: { width: 64, height: 32, channels: 3, background: { r: 90, g: 60, b: 30 } },
  }).jpeg({ quality: 90, chromaSubsampling: "4:4:4" }).toBuffer();
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("T-561 strict observation input", () => {
  it("seals and parses all 148 exact source identities plus the separate absent sweep", () => {
    const sealed = sealGrandHallT561ObservationInput(inputMaterial(modesMap([
      [1, "boundary"],
      [51, "uncertain"],
      [148, "broad"],
    ])));
    const parsed = parseGrandHallT561ObservationInput(serializedInput(sealed));

    expect(parsed.records).toHaveLength(148);
    expect(parsed.records.some((record) => record.sweepNumber === 93)).toBe(false);
    expect(parsed.absentSources).toEqual([{
      sweepNumber: 93,
      sourceState: "absent_from_exact_supplied_inventory",
      visualObservationState: "not_observable_source_absent",
      authority: "none",
    }]);
    expect(parsed.inspection).toMatchObject({
      displayedWidthPx: 2_048,
      displayedHeightPx: 1_024,
      nativeResolutionHumanReviewCompleted: false,
    });
    expect(parsed.records.find((record) => record.sweepNumber === 99)?.relativePath)
      .toBe("sweep_099pg.jpg");
    expect(parsed.records.find((record) => record.sweepNumber === 149)?.relativePath)
      .toBe("sweep_0149jpg.jpg");
  });

  it("rejects reordered coverage, invalid positive-boundary semantics, and a forged digest", () => {
    const reordered = inputMaterial();
    const first = reordered.records[0] as GrandHallT561ObservationRecord;
    const second = reordered.records[1] as GrandHallT561ObservationRecord;
    reordered.records[0] = second;
    reordered.records[1] = first;
    expect(() => sealGrandHallT561ObservationInput(reordered))
      .toThrow(expect.objectContaining({ code: "INPUT_INVALID" }));

    const invalidBoundary = inputMaterial();
    invalidBoundary.records[0] = {
      ...invalidBoundary.records[0] as GrandHallT561ObservationRecord,
      attentionRegions: [],
    };
    expect(() => sealGrandHallT561ObservationInput(invalidBoundary)).toThrow();

    const sealed = sealGrandHallT561ObservationInput(inputMaterial());
    const forged = { ...sealed, observationSetSha256: digestFor("forged") };
    expect(() => parseGrandHallT561ObservationInput(serializedInput(forged)))
      .toThrow(expect.objectContaining({ code: "INPUT_INVALID" }));
  });

  it("rejects malformed seam geometry and duplicate JSON keys", () => {
    const invalidSeam = inputMaterial(modesMap([[1, "uncertain"]]));
    const first = invalidSeam.records[0] as GrandHallT561ObservationRecord;
    invalidSeam.records[0] = {
      ...first,
      attentionRegions: [{
        ...first.attentionRegions[0] as GrandHallT561ObservationRecord["attentionRegions"][number],
        sourcePixelRectangles: [{ x: 0, y: 0, width: 100, height: 100 }],
      }],
    };
    expect(() => sealGrandHallT561ObservationInput(invalidSeam)).toThrow();

    const duplicateKeys = Buffer.from('{"schemaVersion":"a","schemaVersion":"b"}', "utf8");
    expect(() => parseGrandHallT561ObservationInput(duplicateKeys))
      .toThrow(expect.objectContaining({ code: "INPUT_INVALID" }));
  });
});

describe("T-561 review aids and manifest", () => {
  it("renders deterministic RGB8 review-only aids with the fixed inspection disclosure", async () => {
    const record = sealGrandHallT561ObservationInput(inputMaterial()).records[0] as GrandHallT561ObservationRecord;
    const source = await tinyJpeg();
    const first = await renderGrandHallT561ReviewAid(source, record);
    const second = await renderGrandHallT561ReviewAid(source, record);
    const metadata = await sharp(first.bytes).metadata();

    expect(first.bytes.equals(second.bytes)).toBe(true);
    expect(first.sha256).toBe(second.sha256);
    expect(first).toMatchObject({
      sourceDisplayWidthPx: GRAND_HALL_T561_INSPECTION_DISPLAY_WIDTH_PX,
      sourceDisplayHeightPx: GRAND_HALL_T561_INSPECTION_DISPLAY_HEIGHT_PX,
      widthPx: GRAND_HALL_T561_INSPECTION_DISPLAY_WIDTH_PX,
      heightPx: GRAND_HALL_T561_REVIEW_AID_HEIGHT_PX,
      authority: "none",
      maskAuthority: "none",
      reconstructionInputPermitted: false,
    });
    expect(metadata).toMatchObject({ width: 2_048, height: 1_152, channels: 3 });
  }, 60_000);

  it("binds observation counts without granting human or downstream authority", async () => {
    const input = sealGrandHallT561ObservationInput(inputMaterial(modesMap([
      [1, "boundary"],
      [51, "uncertain"],
      [148, "broad"],
    ])));
    const aid = await renderGrandHallT561ReviewAid(await tinyJpeg(), input.records[0] as GrandHallT561ObservationRecord);
    const secondAid = await renderGrandHallT561ReviewAid(
      await tinyJpeg(),
      input.records.find((record) => record.sweepNumber === 51) as GrandHallT561ObservationRecord,
    );
    const inputBytes = serializedInput(input);
    const manifest = buildGrandHallT561ObservationManifest(input, {
      sha256: `sha256:${createHash("sha256").update(inputBytes).digest("hex")}`,
      byteLength: inputBytes.length,
    }, [aid, secondAid]);

    expect(manifest.summary).toMatchObject({
      grandHallPixelsObservedCount: 2,
      uncertainPossibleGrandHallPixelsCount: 1,
      boundarySensitiveRecordCount: 2,
      reviewAidCount: 2,
      outOfCurrentCandidateSetObservedOrUncertainSweeps: [51, 148],
    });
    expect(manifest.guards).toMatchObject({
      humanAcceptanceRecorded: false,
      nativeResolutionHumanReviewCompleted: false,
      roomMembershipAuthority: "none",
      maskGenerated: false,
      trainingAuthorized: false,
      reconstructionAuthorized: false,
      runtimeAuthorized: false,
      stagingAuthorized: false,
    });
  }, 60_000);
});

describe("T-561 no-replace receipt-last generation and independent check", () => {
  it("publishes a complete flat pack and exact-regeneration-checks it", async () => {
    const root = await mkdtemp(join(tmpdir(), "grand-hall-t561-"));
    temporaryRoots.push(root);
    const panoramaRoot = join(root, "panoramas");
    const packRoot = join(root, "t554-pack");
    const outputDirectory = join(root, "output");
    const observationInputPath = join(root, "observations.json");
    await mkdir(panoramaRoot);
    await mkdir(packRoot);
    const input = sealGrandHallT561ObservationInput(inputMaterial());
    await writeFile(observationInputPath, serializedInput(input), { flag: "wx" });
    const inventory = fakeInventory();
    const decodedSweeps: number[] = [];
    const dependencies: GrandHallT561BuildDependencies = {
      verifyPanoramaPack: () => Promise.resolve({
        manifestSha256: GRAND_HALL_T554_EXACT_PANORAMA_MANIFEST_SHA256,
      }),
      collectInventory: () => Promise.resolve(inventory),
      readSourceBytes: (_sourceRoot, record) => Promise.resolve(sourceBytes(record.sweepNumber)),
      verifyDecodedSource: (_bytes, record) => {
        decodedSweeps.push(record.sweepNumber);
        return Promise.resolve();
      },
      renderAid: async (_bytes, record) =>
        await renderGrandHallT561ReviewAid(await tinyJpeg(), record),
    };
    const options = {
      panoramaSourceRoot: panoramaRoot,
      t554PanoramaPackDirectory: packRoot,
      observationInputPath,
      outputDirectory,
    };

    const generated = await generateGrandHallT561ObservationPack(options, dependencies);
    const checked = await checkGrandHallT561ObservationPack(options, dependencies);
    const names = [GRAND_HALL_T561_MANIFEST_FILENAME, GRAND_HALL_T561_RECEIPT_FILENAME,
      "boundary-attention-sweep-001-review-only.png"];

    expect(generated).toMatchObject({
      sourceRecordCount: 148,
      absentSweepNumbersWithin1To149: [93],
      reviewAidCount: 1,
      outputFileCount: 3,
      authority: "none",
      nativeResolutionHumanReviewCompleted: false,
    });
    expect(checked.exactRegenerationVerified).toBe(true);
    expect(decodedSweeps).toHaveLength(296);
    expect(decodedSweeps.slice(0, 148)).toEqual(inventory.files.map((record) => record.sweepNumber));
    expect(decodedSweeps.slice(148)).toEqual(inventory.files.map((record) => record.sweepNumber));
    await expect(Promise.all(names.map((name) => readFile(join(outputDirectory, name)))))
      .resolves.toHaveLength(3);
    await expect(generateGrandHallT561ObservationPack(options, dependencies))
      .rejects.toBeDefined();
  }, 120_000);

  it("rejects an extra persisted output instead of blessing a changed inventory", async () => {
    const root = await mkdtemp(join(tmpdir(), "grand-hall-t561-extra-"));
    temporaryRoots.push(root);
    const panoramaRoot = join(root, "panoramas");
    const packRoot = join(root, "t554-pack");
    const outputDirectory = join(root, "output");
    const observationInputPath = join(root, "observations.json");
    await mkdir(panoramaRoot);
    await mkdir(packRoot);
    await writeFile(
      observationInputPath,
      serializedInput(sealGrandHallT561ObservationInput(inputMaterial(
        modesMap([]),
      ))),
      { flag: "wx" },
    );
    const inventory = fakeInventory();
    const decodedSweeps: number[] = [];
    const dependencies: GrandHallT561BuildDependencies = {
      verifyPanoramaPack: () => Promise.resolve({ manifestSha256: GRAND_HALL_T554_EXACT_PANORAMA_MANIFEST_SHA256 }),
      collectInventory: () => Promise.resolve(inventory),
      readSourceBytes: (_sourceRoot, record) => Promise.resolve(sourceBytes(record.sweepNumber)),
      verifyDecodedSource: (_bytes, record) => {
        decodedSweeps.push(record.sweepNumber);
        return Promise.resolve();
      },
      renderAid: () => Promise.reject(new Error("no boundary aids expected")),
    };
    const options = { panoramaSourceRoot: panoramaRoot, t554PanoramaPackDirectory: packRoot, observationInputPath, outputDirectory };
    await generateGrandHallT561ObservationPack(options, dependencies);
    expect(decodedSweeps).toHaveLength(148);
    await writeFile(join(outputDirectory, "unexpected.txt"), "drift", { flag: "wx" });

    await expect(checkGrandHallT561ObservationPack(options, dependencies))
      .rejects.toBeInstanceOf(GrandHallT561PanoramaVisualObservationError);
  });
});
