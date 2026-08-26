import { createHash } from "node:crypto";
import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import {
  GRAND_HALL_T554_EXACT_PANORAMA_MANIFEST_SHA256,
  GRAND_HALL_T554_EXPECTED_PANORAMA_INVENTORY_SHA256,
  collectGrandHallT554PanoramaInventory,
  type GrandHallT554PanoramaInventory,
  type GrandHallT554PanoramaInventoryFile,
} from "./grand-hall-t554-panorama-review.js";
import {
  GRAND_HALL_T561_OBSERVATION_INPUT_SCHEMA,
  GrandHallT561ObservationInputMaterialSchema,
  parseGrandHallT561ObservationInput,
  sealGrandHallT561ObservationInput,
  serializeGrandHallT561ObservationInput,
  type GrandHallT561AttentionRegion,
  type GrandHallT561ObservationInput,
  type GrandHallT561ObservationInputMaterial,
  type GrandHallT561ObservationRecord,
} from "./grand-hall-t561-panorama-visual-observation.js";

type Rectangle = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

interface RegionSpec {
  readonly contentHint: GrandHallT561AttentionRegion["contentHint"];
  readonly wrapsHorizontalSeam: boolean;
  readonly rectangles: readonly Rectangle[];
}

const POSITIVE_SWEEPS = Object.freeze([
  ...Array.from({ length: 61 }, (_, index) => index + 1),
  ...Array.from({ length: 11 }, (_, index) => index + 65),
  148,
  149,
]);
const POSITIVE_SET = new Set<number>(POSITIVE_SWEEPS);
const BROAD_GRAND_HALL_SWEEPS = new Set<number>([28, 34, 35, 36]);
const MIXED_BOUNDARY_SWEEPS = new Set<number>([1, 18, 49]);

function rectangleFromBounds(
  x0: number,
  y0: number,
  x1Exclusive: number,
  y1Exclusive: number,
): Rectangle {
  return { x: x0, y: y0, width: x1Exclusive - x0, height: y1Exclusive - y0 };
}

function singleXRange(x0: number, x1Exclusive: number): RegionSpec {
  return {
    contentHint: "non_grand_hall_or_unknown_pixels",
    wrapsHorizontalSeam: false,
    rectangles: [rectangleFromBounds(x0, 1_300, x1Exclusive, 3_050)],
  };
}

const ATTENTION_BY_SWEEP = new Map<number, RegionSpec>([
  [1, {
    contentHint: "non_grand_hall_or_unknown_pixels",
    wrapsHorizontalSeam: false,
    rectangles: [rectangleFromBounds(560, 1_180, 1_940, 3_500)],
  }],
  [2, singleXRange(0, 450)],
  [3, singleXRange(0, 680)],
  [4, singleXRange(0, 560)],
  [5, singleXRange(0, 500)],
  [6, singleXRange(7_850, 8_192)],
  [7, singleXRange(7_850, 8_192)],
  [8, singleXRange(7_700, 8_180)],
  [9, singleXRange(7_180, 7_650)],
  [10, singleXRange(3_480, 3_920)],
  [11, singleXRange(1_860, 2_320)],
  [12, singleXRange(1_750, 2_240)],
  [13, singleXRange(2_200, 2_580)],
  [14, singleXRange(2_020, 2_400)],
  [15, singleXRange(2_120, 2_660)],
  [16, singleXRange(2_050, 2_740)],
  [17, singleXRange(1_980, 3_010)],
  [18, {
    contentHint: "non_grand_hall_or_unknown_pixels",
    wrapsHorizontalSeam: false,
    rectangles: [rectangleFromBounds(500, 850, 3_420, 3_420)],
  }],
  [19, {
    contentHint: "grand_hall_pixels",
    wrapsHorizontalSeam: false,
    rectangles: [rectangleFromBounds(4_270, 1_200, 6_200, 3_450)],
  }],
  [20, {
    contentHint: "non_grand_hall_or_unknown_pixels",
    wrapsHorizontalSeam: true,
    rectangles: [
      rectangleFromBounds(0, 1_300, 420, 3_050),
      rectangleFromBounds(7_540, 1_300, 8_192, 3_050),
    ],
  }],
  [21, singleXRange(0, 400)],
  [22, singleXRange(0, 300)],
  [23, singleXRange(0, 260)],
  [24, singleXRange(0, 190)],
  [25, singleXRange(7_920, 8_192)],
  [26, singleXRange(7_800, 8_192)],
  [27, singleXRange(6_900, 7_480)],
  [29, singleXRange(7_120, 7_540)],
  [30, singleXRange(2_140, 2_560)],
  [31, singleXRange(180, 560)],
  [32, singleXRange(0, 340)],
  [33, singleXRange(0, 220)],
  [37, {
    contentHint: "non_grand_hall_or_unknown_pixels",
    wrapsHorizontalSeam: true,
    rectangles: [
      rectangleFromBounds(0, 1_300, 140, 3_050),
      rectangleFromBounds(7_720, 1_300, 8_192, 3_050),
    ],
  }],
  [38, singleXRange(1_480, 1_980)],
  [39, singleXRange(980, 1_520)],
  [40, singleXRange(1_680, 2_160)],
  [41, singleXRange(2_920, 3_460)],
  [42, singleXRange(2_460, 2_990)],
  [43, singleXRange(2_220, 2_640)],
  [44, singleXRange(1_680, 2_200)],
  [45, singleXRange(1_680, 2_160)],
  [46, singleXRange(3_460, 3_860)],
  [47, singleXRange(2_460, 3_040)],
  [48, singleXRange(1_160, 1_740)],
  [49, {
    contentHint: "grand_hall_pixels",
    wrapsHorizontalSeam: true,
    rectangles: [
      rectangleFromBounds(0, 900, 820, 3_550),
      rectangleFromBounds(7_350, 900, 8_192, 3_550),
    ],
  }],
  [50, {
    contentHint: "grand_hall_pixels",
    wrapsHorizontalSeam: true,
    rectangles: [
      rectangleFromBounds(0, 1_050, 700, 3_500),
      rectangleFromBounds(7_480, 1_050, 8_192, 3_500),
    ],
  }],
  ...([
    [51, 7_700, 0, 350, 1_450, 3_100],
    [52, 7_700, 0, 350, 1_500, 3_050],
    [53, 7_700, 0, 330, 1_500, 3_000],
    [54, 7_700, 0, 330, 1_500, 3_000],
    [55, 7_750, 0, 300, 1_550, 3_000],
    [56, 7_850, 0, 400, 1_550, 3_000],
  ] as const).map(([sweep, rightX, leftX, leftEnd, y0, y1]) => [sweep, {
    contentHint: "grand_hall_pixels" as const,
    wrapsHorizontalSeam: true,
    rectangles: [
      rectangleFromBounds(leftX, y0, leftEnd, y1),
      rectangleFromBounds(rightX, y0, 8_192, y1),
    ],
  }] as const),
  ...([
    [57, 1_750, 2_150, 1_750, 2_750],
    [58, 3_350, 3_800, 1_700, 2_850],
    [59, 3_500, 3_975, 1_650, 2_900],
    [60, 3_500, 3_975, 1_650, 2_900],
    [61, 3_050, 3_500, 1_650, 2_850],
    [65, 6_830, 7_100, 1_650, 2_850],
    [66, 6_880, 7_120, 1_650, 2_800],
    [67, 7_240, 7_580, 1_600, 2_850],
    [68, 7_220, 7_580, 1_600, 2_850],
    [69, 7_480, 7_850, 1_600, 2_900],
    [70, 6_350, 6_700, 1_600, 2_850],
    [71, 3_950, 4_350, 1_600, 2_900],
    [72, 4_200, 4_650, 1_600, 2_900],
    [73, 4_000, 4_525, 1_550, 2_950],
    [74, 3_950, 4_650, 1_500, 3_000],
    [75, 4_250, 5_150, 1_400, 3_100],
  ] as const).map(([sweep, x0, x1, y0, y1]) => [sweep, {
    contentHint: "grand_hall_pixels" as const,
    wrapsHorizontalSeam: false,
    rectangles: [rectangleFromBounds(x0, y0, x1, y1)],
  }] as const),
  [148, {
    contentHint: "visual_boundary_uncertain",
    wrapsHorizontalSeam: false,
    rectangles: [rectangleFromBounds(2_200, 1_450, 3_320, 3_020)],
  }],
  [149, {
    contentHint: "visual_boundary_uncertain",
    wrapsHorizontalSeam: false,
    rectangles: [rectangleFromBounds(7_100, 1_400, 8_192, 3_020)],
  }],
]);

function makeAttentionRegion(sweepNumber: number, spec: RegionSpec): GrandHallT561AttentionRegion {
  return {
    regionId: `s${String(sweepNumber).padStart(3, "0")}-r01`,
    contentHint: spec.contentHint,
    coordinateSpace: "source_equirectangular_pixels_top_left_origin",
    coverageIntent: "conservative_attention_area",
    wrapsHorizontalSeam: spec.wrapsHorizontalSeam,
    sourcePixelRectangles: [...spec.rectangles],
    authority: "none",
  };
}

function sharedRecordFields(source: GrandHallT554PanoramaInventoryFile) {
  return {
    sweepNumber: source.sweepNumber,
    relativePath: source.relativePath,
    byteLength: source.byteLength,
    sha256: source.sha256,
    widthPx: 8_192 as const,
    heightPx: 4_096 as const,
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

function buildObservationRecord(
  source: GrandHallT554PanoramaInventoryFile,
): GrandHallT561ObservationRecord {
  const common = sharedRecordFields(source);
  if (!POSITIVE_SET.has(source.sweepNumber)) {
    return {
      ...common,
      observationState: "no_grand_hall_pixels_observed",
      frameContext: "no_grand_hall_pixels_observed",
      boundarySensitive: false,
      attentionRegions: [],
      note: "No identifiable Grand Hall pixels were observed at the disclosed 2048x1024 display resolution; this is not proof of absence or a human exclusion.",
    };
  }
  if (BROAD_GRAND_HALL_SWEEPS.has(source.sweepNumber)) {
    return {
      ...common,
      observationState: "grand_hall_pixels_observed",
      frameContext: "broad_grand_hall_view",
      boundarySensitive: false,
      attentionRegions: [],
      note: "A broad Grand Hall view was observed. No obvious open-portal bleed was noticed at 2048x1024, but native-grid human review remains required.",
    };
  }
  const spec = ATTENTION_BY_SWEEP.get(source.sweepNumber);
  if (spec === undefined) {
    throw new Error(`Positive sweep ${String(source.sweepNumber)} lacks an attention region.`);
  }
  const mixed = MIXED_BOUNDARY_SWEEPS.has(source.sweepNumber) ||
    (source.sweepNumber >= 2 && source.sweepNumber <= 48 && source.sweepNumber !== 19);
  return {
    ...common,
    observationState: "grand_hall_pixels_observed",
    frameContext: mixed ? "mixed_boundary_frame" : "localized_grand_hall_pixels",
    boundarySensitive: true,
    attentionRegions: [makeAttentionRegion(source.sweepNumber, spec)],
    note: mixed
      ? "Grand Hall pixels and possible beyond-room or unknown portal pixels were observed; the conservative rectangle is a review aid, not a mask."
      : "Localized Grand Hall pixels were observed through a portal from an adjacent or circulation view; the conservative rectangle is a review aid, not a mask.",
  };
}

function assertFixedPartition(records: readonly GrandHallT561ObservationRecord[]): void {
  const positive = records.filter((record) => record.observationState === "grand_hall_pixels_observed");
  const negative = records.filter((record) => record.observationState === "no_grand_hall_pixels_observed");
  const uncertain = records.filter(
    (record) => record.observationState === "uncertain_possible_grand_hall_pixels",
  );
  if (positive.length !== 74 || negative.length !== 74 || uncertain.length !== 0) {
    throw new Error("The fixed T-561 agent observation partition must remain exactly 74/74/0.");
  }
  if (ATTENTION_BY_SWEEP.size !== 70 || positive.filter((record) => record.boundarySensitive).length !== 70) {
    throw new Error("The fixed T-561 boundary-attention inventory must contain exactly 70 records.");
  }
}

export function buildGrandHallT561RealObservationInputMaterial(
  inventory: GrandHallT554PanoramaInventory,
): GrandHallT561ObservationInputMaterial {
  if (
    inventory.fileCount !== 148 ||
    inventory.inventorySha256 !== GRAND_HALL_T554_EXPECTED_PANORAMA_INVENTORY_SHA256 ||
    inventory.missingSweepNumbersWithin1To149.join(",") !== "93"
  ) {
    throw new Error("The real T-561 input builder requires the exact bound 148-file panorama inventory.");
  }
  const records = inventory.files.map(buildObservationRecord);
  assertFixedPartition(records);
  return GrandHallT561ObservationInputMaterialSchema.parse({
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
    records,
    absentSources: [{
      sweepNumber: 93,
      sourceState: "absent_from_exact_supplied_inventory",
      visualObservationState: "not_observable_source_absent",
      authority: "none",
    }],
  });
}

export interface AuthorGrandHallT561RealObservationInputOptions {
  readonly panoramaSourceRoot: string;
  readonly outputPath: string;
}

export interface AuthoredGrandHallT561RealObservationInput {
  readonly outputPath: string;
  readonly byteLength: number;
  readonly sha256: `sha256:${string}`;
  readonly observationSetSha256: `sha256:${string}`;
  readonly presentSourceCount: 148;
  readonly observedCount: 74;
  readonly noObservedCount: 74;
  readonly uncertainCount: 0;
  readonly authority: "none";
}

function comparablePath(path: string): string {
  const normalized = resolve(path).replaceAll("/", "\\").replace(/[\\]+$/u, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export async function authorGrandHallT561RealObservationInput(
  options: AuthorGrandHallT561RealObservationInputOptions,
): Promise<AuthoredGrandHallT561RealObservationInput> {
  if (!isAbsolute(options.panoramaSourceRoot) || !isAbsolute(options.outputPath)) {
    throw new Error("T-561 input authoring paths must be absolute.");
  }
  const outputPath = resolve(options.outputPath);
  const parent = resolve(dirname(outputPath));
  const parentStat = await lstat(parent);
  if (
    !parentStat.isDirectory() ||
    parentStat.isSymbolicLink() ||
    comparablePath(await realpath(parent)) !== comparablePath(parent)
  ) {
    throw new Error("T-561 input output parent must be one direct existing directory.");
  }
  const inventory = await collectGrandHallT554PanoramaInventory({
    sourceRoot: options.panoramaSourceRoot,
  });
  const material = buildGrandHallT561RealObservationInputMaterial(inventory);
  const sealed: GrandHallT561ObservationInput = sealGrandHallT561ObservationInput(material);
  const bytes = serializeGrandHallT561ObservationInput(sealed);
  await writeFile(outputPath, bytes, { flag: "wx" });
  const persisted = await readFile(outputPath);
  const parsed = parseGrandHallT561ObservationInput(persisted);
  if (!persisted.equals(bytes) || parsed.observationSetSha256 !== sealed.observationSetSha256) {
    throw new Error("Persisted T-561 observation input differs from its exact sealed bytes.");
  }
  return {
    outputPath,
    byteLength: bytes.byteLength,
    sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    observationSetSha256: sealed.observationSetSha256,
    presentSourceCount: 148,
    observedCount: 74,
    noObservedCount: 74,
    uncertainCount: 0,
    authority: "none",
  };
}
