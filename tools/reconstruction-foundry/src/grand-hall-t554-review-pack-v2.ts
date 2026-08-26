import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";

import {
  GRAND_HALL_MATTERPAK_ROOM_KEY,
  GRAND_HALL_MATTERPAK_E57_SOURCE_FRAME,
  GRAND_HALL_SCOPE_REVIEW_PACK_V1,
  GRAND_HALL_SCOPE_REVIEW_PACK_V2,
  GRAND_HALL_T554_CLOSED_VOLUME_REVIEW_V1,
  GRAND_HALL_T554_HUMAN_DECISIONS_V2,
  GrandHallScopeReviewPackMaterialV2Schema,
  GrandHallScopeReviewPackV1Schema,
  GrandHallScopeReviewPackV2Schema,
  GrandHallT554ClosedVolumeReviewV1Schema,
  GrandHallT554HumanDecisionsV2Schema,
  computeGrandHallPanoramaObservationInventoryV2Sha256,
  computeGrandHallPanoramaSourceInventoryV3Sha256,
  computeGrandHallScopeReviewPackV2Sha256,
  computeGrandHallT554ClosedVolumeReviewV1Sha256,
  computeGrandHallT554HumanDecisionsV2Sha256,
  computeGrandHallInterfaceInventorySha256,
  type GrandHallScopeReviewPackV1,
  type GrandHallScopeReviewPackV2,
  type GrandHallT554ClosedVolumeReviewV1,
  type GrandHallT554HumanDecisionsV2,
} from "@omnitwin/types";
import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "@omnitwin/reconstruction-foundry";
import { z } from "zod";

import {
  GRAND_HALL_T554_ROOT_REVIEW_PACK_FILENAME,
  verifyPersistedGrandHallT554RootReviewPack,
} from "./grand-hall-t554-review-pack.js";
import {
  GRAND_HALL_T561_MANIFEST_FILENAME,
  GRAND_HALL_T561_RECEIPT_FILENAME,
  parseGrandHallT561ObservationInput,
  parseGrandHallT561ObservationManifest,
  parseGrandHallT561ObservationReceipt,
  verifyPersistedGrandHallT561ObservationPack,
  type GrandHallT561ObservationInput,
  type GrandHallT561ObservationManifest,
  type GrandHallT561ObservationReceipt,
} from "./grand-hall-t561-panorama-visual-observation.js";
import {
  assertGrandHallT554ExistingReviewOutputSafety,
  assertGrandHallT554ReviewOutputSafety,
} from "./grand-hall-t554-panorama-review.js";
import { parseGrandHallT554StrictJson } from "./grand-hall-t554-strict-json.js";

export const GRAND_HALL_T554_V2_REVIEW_PACK_FILENAME = "review-pack-v2.json";
export const GRAND_HALL_T554_V2_HUMAN_DECISIONS_FILENAME = "human-decisions-v2.json";
export const GRAND_HALL_T554_V2_CLOSED_VOLUME_TEMPLATE_FILENAME =
  "closed-selection-volume-review-template.json";
export const GRAND_HALL_T554_V2_PUBLICATION_RECEIPT_FILENAME = "publication-receipt-v2.json";
export const GRAND_HALL_T554_V2_CREATED_AT = "2026-08-26T00:00:00.000Z";
export const GRAND_HALL_T554_V2_CREATED_BY = "venviewer-t554-v2-human-pending-generator-v1";
export const GRAND_HALL_T554_V2_RECEIPT_SCHEMA =
  "omnitwin.foundry.grand-hall-t554-human-pending-review-pack-receipt.v1";

const RECEIPT_DOMAIN = "OMNITWIN_GRAND_HALL_T554_HUMAN_PENDING_REVIEW_PACK_RECEIPT_V1";
const MAX_JSON_BYTES = 16 * 1_024 * 1_024;
type Sha256 = `sha256:${string}`;

const Sha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/u)
  .transform((value): Sha256 => value as Sha256);
const PayloadSchema = z.object({
  relativePath: z.enum([
    GRAND_HALL_T554_V2_CLOSED_VOLUME_TEMPLATE_FILENAME,
    GRAND_HALL_T554_V2_HUMAN_DECISIONS_FILENAME,
    GRAND_HALL_T554_V2_REVIEW_PACK_FILENAME,
  ]),
  byteLength: z.number().int().positive().max(MAX_JSON_BYTES),
  sha256: Sha256Schema,
}).strict();
const ReceiptMaterialSchema = z.object({
  schemaVersion: z.literal(GRAND_HALL_T554_V2_RECEIPT_SCHEMA),
  state: z.literal("complete_human_pending"),
  authority: z.literal("none"),
  sourceBindings: z.object({
    predecessorReviewPackArtifactSha256: Sha256Schema,
    predecessorReviewPackFileSha256: Sha256Schema,
    t561ObservationInputFileSha256: Sha256Schema,
    t561ObservationInputFileByteLength: z.number().int().positive().max(MAX_JSON_BYTES),
    t561ObservationSetSha256: Sha256Schema,
    t561ManifestSha256: Sha256Schema,
    t561ManifestFileSha256: Sha256Schema,
    t561ReceiptSha256: Sha256Schema,
    t561ReceiptFileSha256: Sha256Schema,
  }).strict(),
  reviewPackSha256: Sha256Schema,
  humanDecisionsSha256: Sha256Schema,
  closedVolumeReviewSha256: Sha256Schema,
  payloadFileCount: z.literal(3),
  outputFileCount: z.literal(4),
  payloads: z.array(PayloadSchema).length(3),
  guards: z.object({
    humanAcceptanceRecorded: z.literal(false),
    nativeResolutionHumanReviewCompleted: z.literal(false),
    masksAuthored: z.literal(false),
    roomMembershipAuthority: z.literal("none"),
    interfaceAuthority: z.literal("none"),
    closedVolumeAuthority: z.literal("none"),
    trainingAuthorized: z.literal(false),
    reconstructionAuthorized: z.literal(false),
    runtimeAuthorized: z.literal(false),
    generatedContentAuthorized: z.literal(false),
    publicEvidenceAuthorized: z.literal(false),
  }).strict(),
}).strict();
const ReceiptSchema = ReceiptMaterialSchema.extend({ receiptSha256: Sha256Schema }).strict();
export type GrandHallT554ReviewPackV2PublicationReceipt = z.infer<typeof ReceiptSchema>;

const FIXED_GUARDS = Object.freeze({
  humanAcceptanceRecorded: false,
  nativeResolutionHumanReviewCompleted: false,
  masksAuthored: false,
  roomMembershipAuthority: "none",
  interfaceAuthority: "none",
  closedVolumeAuthority: "none",
  trainingAuthorized: false,
  reconstructionAuthorized: false,
  runtimeAuthorized: false,
  generatedContentAuthorized: false,
  publicEvidenceAuthorized: false,
} as const);

export class GrandHallT554ReviewPackV2Error extends Error {
  public constructor(
    public readonly code:
      | "ARGUMENT_INVALID"
      | "SOURCE_INVALID"
      | "OUTPUT_UNSAFE"
      | "OUTPUT_PUBLISH_FAILED"
      | "OUTPUT_VERIFICATION_FAILED",
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GrandHallT554ReviewPackV2Error";
  }
}

interface StableJsonFile {
  readonly bytes: Buffer;
  readonly sha256: Sha256;
}

function comparablePath(path: string): string {
  const normalized = resolve(path).replaceAll("/", "\\").replace(/[\\]+$/u, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function requireAbsolute(path: string, label: string): string {
  if (!isAbsolute(path)) throw new GrandHallT554ReviewPackV2Error("SOURCE_INVALID", `${label} must be absolute.`);
  return resolve(path);
}

async function readStableDirectJson(path: string, label: string): Promise<StableJsonFile> {
  const absolute = requireAbsolute(path, label);
  const before = await lstat(absolute, { bigint: true });
  const canonical = await realpath(absolute);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || comparablePath(canonical) !== comparablePath(absolute)) {
    throw new GrandHallT554ReviewPackV2Error("SOURCE_INVALID", `${label} must be one direct single-link regular file.`);
  }
  if (before.size < 1n || before.size > BigInt(MAX_JSON_BYTES)) {
    throw new GrandHallT554ReviewPackV2Error("SOURCE_INVALID", `${label} has an invalid bounded size.`);
  }
  const bytes = await readFile(absolute);
  const after = await lstat(absolute, { bigint: true });
  if (
    before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
    before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || after.nlink !== 1n
  ) throw new GrandHallT554ReviewPackV2Error("SOURCE_INVALID", `${label} changed during its stable read.`);
  return { bytes, sha256: fileSha256(bytes) };
}

function fileSha256(bytes: Buffer): Sha256 {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function semanticSha256(domain: string, value: unknown): Sha256 {
  return `sha256:${domainSeparatedSha256(domain, toCanonicalJson(value))}`;
}

function canonicalJsonEqual(left: unknown, right: unknown): boolean {
  return stableCanonicalJson(toCanonicalJson(left)) === stableCanonicalJson(toCanonicalJson(right));
}

function serialize(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export interface GrandHallT554ReviewPackV2SourceBundle {
  readonly predecessor: GrandHallScopeReviewPackV1;
  readonly predecessorFile: StableJsonFile;
  readonly observationInput: GrandHallT561ObservationInput;
  readonly observationInputFile: StableJsonFile;
  readonly observationManifest: GrandHallT561ObservationManifest;
  readonly observationManifestFile: StableJsonFile;
  readonly observationReceipt: GrandHallT561ObservationReceipt;
  readonly observationReceiptFile: StableJsonFile;
}

export interface GrandHallT554ReviewPackV2Options {
  readonly predecessorReviewRoot: string;
  readonly t561ObservationInputPath: string;
  readonly t561ObservationPackDirectory: string;
  readonly outputDirectory: string;
}

function assertInputsOutsideOutput(options: GrandHallT554ReviewPackV2Options): void {
  const output = comparablePath(options.outputDirectory);
  for (const input of [
    options.predecessorReviewRoot,
    options.t561ObservationInputPath,
    options.t561ObservationPackDirectory,
  ]) {
    const comparable = comparablePath(input);
    if (comparable === output || comparable.startsWith(`${output}\\`) || output.startsWith(`${comparable}\\`)) {
      throw new GrandHallT554ReviewPackV2Error("OUTPUT_UNSAFE", "T-554 v2 output must be disjoint from every input.");
    }
  }
}

function parsePredecessor(bytes: Buffer): GrandHallScopeReviewPackV1 {
  try {
    return GrandHallScopeReviewPackV1Schema.parse(parseGrandHallT554StrictJson(bytes));
  } catch (error) {
    throw new GrandHallT554ReviewPackV2Error("SOURCE_INVALID", "The predecessor T-554 v1 review pack is invalid.", error);
  }
}

async function loadPredecessor(root: string): Promise<{
  readonly artifact: GrandHallScopeReviewPackV1;
  readonly file: StableJsonFile;
}> {
  const first = await verifyPersistedGrandHallT554RootReviewPack(root);
  const file = await readStableDirectJson(
    resolve(root, GRAND_HALL_T554_ROOT_REVIEW_PACK_FILENAME),
    "T-554 v1 predecessor review pack",
  );
  const artifact = parsePredecessor(file.bytes);
  const final = await verifyPersistedGrandHallT554RootReviewPack(root);
  const finalFile = await readStableDirectJson(
    resolve(root, GRAND_HALL_T554_ROOT_REVIEW_PACK_FILENAME),
    "T-554 v1 predecessor review pack",
  );
  if (
    first.artifactSha256 !== final.artifactSha256 || first.fileSha256 !== final.fileSha256 ||
    artifact.artifactSha256 !== final.artifactSha256 || file.sha256 !== final.fileSha256 ||
    finalFile.sha256 !== file.sha256 || !finalFile.bytes.equals(file.bytes)
  ) throw new GrandHallT554ReviewPackV2Error("SOURCE_INVALID", "The predecessor review pack changed during verification.");
  return { artifact, file };
}

async function loadT561(
  inputPath: string,
  packDirectory: string,
): Promise<Omit<GrandHallT554ReviewPackV2SourceBundle, "predecessor" | "predecessorFile">> {
  const first = await verifyPersistedGrandHallT561ObservationPack(packDirectory);
  const inputFile = await readStableDirectJson(inputPath, "T-561 observation input");
  const manifestFile = await readStableDirectJson(resolve(packDirectory, GRAND_HALL_T561_MANIFEST_FILENAME), "T-561 manifest");
  const receiptFile = await readStableDirectJson(resolve(packDirectory, GRAND_HALL_T561_RECEIPT_FILENAME), "T-561 publication receipt");
  const observationInput = parseGrandHallT561ObservationInput(inputFile.bytes);
  const observationManifest = parseGrandHallT561ObservationManifest(manifestFile.bytes);
  const observationReceipt = parseGrandHallT561ObservationReceipt(receiptFile.bytes);
  const final = await verifyPersistedGrandHallT561ObservationPack(packDirectory);
  const [finalInputFile, finalManifestFile, finalReceiptFile] = await Promise.all([
    readStableDirectJson(inputPath, "T-561 observation input"),
    readStableDirectJson(resolve(packDirectory, GRAND_HALL_T561_MANIFEST_FILENAME), "T-561 manifest"),
    readStableDirectJson(resolve(packDirectory, GRAND_HALL_T561_RECEIPT_FILENAME), "T-561 publication receipt"),
  ]);
  if (first.manifestSha256 !== final.manifestSha256 || first.receiptSha256 !== final.receiptSha256) {
    throw new GrandHallT554ReviewPackV2Error("SOURCE_INVALID", "The T-561 observation pack changed during verification.");
  }
  if (
    !finalInputFile.bytes.equals(inputFile.bytes) || !finalManifestFile.bytes.equals(manifestFile.bytes) ||
    !finalReceiptFile.bytes.equals(receiptFile.bytes)
  ) throw new GrandHallT554ReviewPackV2Error("SOURCE_INVALID", "A T-561 bound file changed during verification.");
  assertGrandHallT554ReviewPackV2T561Bindings(
    observationInput,
    inputFile,
    observationManifest,
    observationReceipt,
    final,
  );
  return {
    observationInput,
    observationInputFile: inputFile,
    observationManifest,
    observationManifestFile: manifestFile,
    observationReceipt,
    observationReceiptFile: receiptFile,
  };
}

export function assertGrandHallT554ReviewPackV2T561Bindings(
  input: GrandHallT561ObservationInput,
  inputFile: StableJsonFile,
  manifest: GrandHallT561ObservationManifest,
  receipt: GrandHallT561ObservationReceipt,
  verified: { readonly manifestSha256: Sha256; readonly receiptSha256: Sha256 },
): void {
  const bindings = [
    ["verified manifest self-digest", manifest.manifestSha256 === verified.manifestSha256],
    ["verified receipt self-digest", receipt.receiptSha256 === verified.receiptSha256],
    ["receipt-to-manifest self-digest", receipt.manifestSha256 === manifest.manifestSha256],
    ["receipt-to-input observation-set digest", receipt.observationSetSha256 === input.observationSetSha256],
    ["manifest-to-input observation-set digest", manifest.sourceBindings.observationSetSha256 === input.observationSetSha256],
    ["manifest-to-input serialized-file digest", manifest.sourceBindings.observationInputFileSha256 === inputFile.sha256],
    ["manifest-to-input serialized byte length", manifest.sourceBindings.observationInputFileByteLength === inputFile.bytes.length],
    ["manifest-to-input ordered observations", canonicalJsonEqual(manifest.records, input.records)],
    ["manifest-to-input absent-source record", canonicalJsonEqual(manifest.absentSources, input.absentSources)],
  ] as const;
  const failed = bindings.find(([, matches]) => !matches);
  if (failed !== undefined) {
    throw new GrandHallT554ReviewPackV2Error(
      "SOURCE_INVALID",
      `T-561 input, manifest, and receipt do not exact-cross-bind: ${failed[0]} mismatch.`,
    );
  }
  if (
    manifest.summary.grandHallPixelsObservedCount !== 74 ||
    manifest.summary.noGrandHallPixelsObservedCount !== 74 ||
    manifest.summary.uncertainPossibleGrandHallPixelsCount !== 0
  ) throw new GrandHallT554ReviewPackV2Error("SOURCE_INVALID", "T-561 is not the exact human-pending 74/74 observation surface.");
}

export async function loadGrandHallT554ReviewPackV2Sources(
  options: GrandHallT554ReviewPackV2Options,
): Promise<GrandHallT554ReviewPackV2SourceBundle> {
  const predecessor = await loadPredecessor(requireAbsolute(options.predecessorReviewRoot, "T-554 v1 root"));
  const t561 = await loadT561(
    requireAbsolute(options.t561ObservationInputPath, "T-561 observation input"),
    requireAbsolute(options.t561ObservationPackDirectory, "T-561 observation pack"),
  );
  return { predecessor: predecessor.artifact, predecessorFile: predecessor.file, ...t561 };
}

function panoramaRecords(bundle: GrandHallT554ReviewPackV2SourceBundle) {
  return bundle.observationInput.records.map((record, inventoryIndex) => {
    const observation = record.observationState === "grand_hall_pixels_observed"
      ? {
          state: "grand_hall_pixels_observed_human_pending" as const,
          proposedDisposition: "include_with_binary_pixel_mask" as const,
          maskAuthoringState: "required_not_authored" as const,
        }
      : record.observationState === "no_grand_hall_pixels_observed"
      ? {
          state: "no_grand_hall_pixels_observed_human_pending" as const,
          proposedDisposition: "exclude_whole_frame" as const,
          maskAuthoringState: "not_required_if_human_confirms_exclusion" as const,
        }
      : null;
    if (observation === null) {
      throw new GrandHallT554ReviewPackV2Error("SOURCE_INVALID", "Uncertain T-561 observations cannot enter the exact v2 decision surface.");
    }
    return {
      source: {
        inventoryIndex,
        sweepNumber: record.sweepNumber,
        fileName: record.relativePath,
        sha256: record.sha256,
        byteLength: record.byteLength,
        widthPx: record.widthPx,
        heightPx: record.heightPx,
      },
      observation,
      observationBasis: "agent_visual_inspection_of_digest_bound_source_panorama" as const,
      humanReviewState: "pending" as const,
      authority: "none" as const,
      trainingAuthorized: false as const,
      reconstructionAuthorized: false as const,
      runtimeAuthorized: false as const,
      publicEvidenceAuthorized: false as const,
    };
  });
}

function t561SourceEvidence(bundle: GrandHallT554ReviewPackV2SourceBundle) {
  return {
    inputSchemaVersion: bundle.observationInput.schemaVersion,
    manifestSchemaVersion: bundle.observationManifest.schemaVersion,
    receiptSchemaVersion: bundle.observationReceipt.schemaVersion,
    manifestSha256: bundle.observationManifest.manifestSha256,
    receiptSha256: bundle.observationReceipt.receiptSha256,
    observationSetSha256: bundle.observationInput.observationSetSha256,
    sourceRecordCount: 148 as const,
    absentSweepNumbersWithin1To149: [93] as const,
    grandHallPixelsObservedCount: 74 as const,
    noGrandHallPixelsObservedCount: 74 as const,
    uncertainPossibleGrandHallPixelsCount: 0 as const,
    authority: "none" as const,
    reviewState: "agent_observation_complete_human_pending" as const,
    inspection: bundle.observationInput.inspection,
  };
}

function buildReviewPack(bundle: GrandHallT554ReviewPackV2SourceBundle): GrandHallScopeReviewPackV2 {
  const records = panoramaRecords(bundle);
  const sources = records.map((record) => record.source);
  const bindings = records.map((record) => ({ source: record.source, observation: record.observation }));
  const material = GrandHallScopeReviewPackMaterialV2Schema.parse({
    schemaVersion: GRAND_HALL_SCOPE_REVIEW_PACK_V2,
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    createdAt: GRAND_HALL_T554_V2_CREATED_AT,
    createdBy: GRAND_HALL_T554_V2_CREATED_BY,
    authority: "none",
    reviewState: "human_pending",
    runtimeAuthorized: false,
    trainingAuthorized: false,
    generatedContentAuthorized: false,
    productionTrust: null,
    sourceEvidence: {
      predecessorReviewPack: {
        schemaVersion: GRAND_HALL_SCOPE_REVIEW_PACK_V1,
        artifactSha256: bundle.predecessor.artifactSha256,
        relationship: "immutable_predecessor_lineage_only",
      },
      ...bundle.predecessor.sourceEvidence,
      t561AuthorityNoneObservation: t561SourceEvidence(bundle),
      legacy50By98PartitionUsed: false,
    },
    panoramaRecords: records,
    panoramaSourceInventorySha256: computeGrandHallPanoramaSourceInventoryV3Sha256(sources),
    panoramaObservationInventorySha256: computeGrandHallPanoramaObservationInventoryV2Sha256(bindings),
    observationSummary: {
      sourceRecordCount: 148,
      grandHallPixelsObservedHumanPendingCount: 74,
      noGrandHallPixelsObservedHumanPendingCount: 74,
      humanPendingCount: 148,
    },
    interfaceCandidates: bundle.predecessor.interfaceCandidates,
    interfaceInventorySha256: computeGrandHallInterfaceInventorySha256(bundle.predecessor.interfaceCandidates),
    requiredHumanDecisions: [
      "accept_or_reject_room_membership",
      "resolve_every_interface",
      "accept_or_reject_closed_selection_volume",
      "resolve_all_148_panorama_sources",
      "accept_or_reject_every_included_panorama_mask",
    ],
  });
  return GrandHallScopeReviewPackV2Schema.parse({
    ...material,
    artifactSha256: computeGrandHallScopeReviewPackV2Sha256(material),
  });
}

function pendingPanoramaDecisions(reviewPack: GrandHallScopeReviewPackV2) {
  return reviewPack.panoramaRecords.map((record) => ({
    source: record.source,
    sourceObservation: record.observation,
    result: "UNSURE" as const,
    classification: null,
    maskFileName: null,
    reviewedMaskBinding: null,
    maskReviewed: false,
    maskReasonCodes: [],
    note: null,
  }));
}

function pendingInterfaceDecisions(reviewPack: GrandHallScopeReviewPackV2) {
  return reviewPack.interfaceCandidates.map((source) => ({
    source,
    result: "UNSURE" as const,
    note: null,
  }));
}

function buildHumanDecisions(
  reviewPack: GrandHallScopeReviewPackV2,
  predecessor: GrandHallScopeReviewPackV1,
): GrandHallT554HumanDecisionsV2 {
  return GrandHallT554HumanDecisionsV2Schema.parse({
    schemaVersion: GRAND_HALL_T554_HUMAN_DECISIONS_V2,
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    reviewPackSchemaVersion: GRAND_HALL_SCOPE_REVIEW_PACK_V2,
    reviewPackSha256: reviewPack.artifactSha256,
    sourcePanoramaInventorySha256: reviewPack.panoramaSourceInventorySha256,
    sourceObservationInventorySha256: reviewPack.panoramaObservationInventorySha256,
    authority: "none",
    reviewState: "human_pending",
    finalDecision: "PENDING",
    reviewer: null,
    generatedFillPermitted: false,
    geometricCameraAuthority: "none",
    matterPakRoomDecision: {
      sourceRoomKey: GRAND_HALL_MATTERPAK_ROOM_KEY,
      sourceMembershipV1Sha256: predecessor.sourceEvidence.t550PendingMembershipV1Sha256,
      sourceBoundaryEvidenceSha256: predecessor.sourceEvidence.boundaryReviewManifestSha256,
      result: "UNSURE",
      note: null,
    },
    cleanupArtifactInspections: (["Window", "Mirror"] as const).map((artifactClass) => ({
      artifactClass,
      sourceBoundaryEvidenceSha256: predecessor.sourceEvidence.boundaryReviewManifestSha256,
      result: "UNSURE" as const,
      note: null,
    })),
    closedSelectionVolumeDecision: {
      reviewSchemaVersion: GRAND_HALL_T554_CLOSED_VOLUME_REVIEW_V1,
      reviewArtifactSha256: null,
      result: "UNSURE",
      note: null,
    },
    panoramaDecisionCount: 148,
    panoramaDecisions: pendingPanoramaDecisions(reviewPack),
    interfaceDecisions: pendingInterfaceDecisions(reviewPack),
    sourceInterfaceInventorySha256: reviewPack.interfaceInventorySha256,
  });
}

function buildClosedVolumeTemplate(reviewPack: GrandHallScopeReviewPackV2): GrandHallT554ClosedVolumeReviewV1 {
  return GrandHallT554ClosedVolumeReviewV1Schema.parse({
    schemaVersion: GRAND_HALL_T554_CLOSED_VOLUME_REVIEW_V1,
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    reviewPackSha256: reviewPack.artifactSha256,
    authority: "none",
    reviewState: "human_pending",
    finalDecision: "PENDING",
    reviewer: null,
    sourceFrame: GRAND_HALL_MATTERPAK_E57_SOURCE_FRAME,
    units: "meters",
    geometryRole: "non_rendered_selection_volume",
    construction: "extruded_simple_xy_polygon",
    footprintXY: [],
    zMin: null,
    zMax: null,
    rendered: false,
    collisionGeometry: false,
    exportedAsArchitecture: false,
    generatedGeometryCreated: false,
    note: null,
  });
}

interface BuiltPackV2 {
  readonly reviewPack: GrandHallScopeReviewPackV2;
  readonly humanDecisions: GrandHallT554HumanDecisionsV2;
  readonly closedVolumeTemplate: GrandHallT554ClosedVolumeReviewV1;
  readonly payloads: ReadonlyMap<string, Buffer>;
  readonly receipt: GrandHallT554ReviewPackV2PublicationReceipt;
  readonly receiptBytes: Buffer;
}

function payloadEvidence(relativePath: string, bytes: Buffer) {
  return PayloadSchema.parse({ relativePath, byteLength: bytes.length, sha256: fileSha256(bytes) });
}

export function buildGrandHallT554ReviewPackV2(
  bundle: GrandHallT554ReviewPackV2SourceBundle,
): BuiltPackV2 {
  const reviewPack = buildReviewPack(bundle);
  const humanDecisions = buildHumanDecisions(reviewPack, bundle.predecessor);
  const closedVolumeTemplate = buildClosedVolumeTemplate(reviewPack);
  const payloads = new Map<string, Buffer>([
    [GRAND_HALL_T554_V2_CLOSED_VOLUME_TEMPLATE_FILENAME, serialize(closedVolumeTemplate)],
    [GRAND_HALL_T554_V2_HUMAN_DECISIONS_FILENAME, serialize(humanDecisions)],
    [GRAND_HALL_T554_V2_REVIEW_PACK_FILENAME, serialize(reviewPack)],
  ]);
  const payloadEvidenceRows = [...payloads].map(([path, bytes]) => payloadEvidence(path, bytes))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath, "en"));
  const receiptMaterial = ReceiptMaterialSchema.parse({
    schemaVersion: GRAND_HALL_T554_V2_RECEIPT_SCHEMA,
    state: "complete_human_pending",
    authority: "none",
    sourceBindings: {
      predecessorReviewPackArtifactSha256: bundle.predecessor.artifactSha256,
      predecessorReviewPackFileSha256: bundle.predecessorFile.sha256,
      t561ObservationInputFileSha256: bundle.observationInputFile.sha256,
      t561ObservationInputFileByteLength: bundle.observationInputFile.bytes.length,
      t561ObservationSetSha256: bundle.observationInput.observationSetSha256,
      t561ManifestSha256: bundle.observationManifest.manifestSha256,
      t561ManifestFileSha256: bundle.observationManifestFile.sha256,
      t561ReceiptSha256: bundle.observationReceipt.receiptSha256,
      t561ReceiptFileSha256: bundle.observationReceiptFile.sha256,
    },
    reviewPackSha256: reviewPack.artifactSha256,
    humanDecisionsSha256: computeGrandHallT554HumanDecisionsV2Sha256(humanDecisions),
    closedVolumeReviewSha256: computeGrandHallT554ClosedVolumeReviewV1Sha256(closedVolumeTemplate),
    payloadFileCount: 3,
    outputFileCount: 4,
    payloads: payloadEvidenceRows,
    guards: FIXED_GUARDS,
  });
  const receipt = ReceiptSchema.parse({
    ...receiptMaterial,
    receiptSha256: semanticSha256(RECEIPT_DOMAIN, receiptMaterial),
  });
  return { reviewPack, humanDecisions, closedVolumeTemplate, payloads, receipt, receiptBytes: serialize(receipt) };
}

function parseReceipt(bytes: Buffer): GrandHallT554ReviewPackV2PublicationReceipt {
  const receipt = ReceiptSchema.parse(parseGrandHallT554StrictJson(bytes));
  const { receiptSha256, ...material } = receipt;
  if (receiptSha256 !== semanticSha256(RECEIPT_DOMAIN, material)) throw new Error("receipt digest mismatch");
  return receipt;
}

export interface VerifiedGrandHallT554ReviewPackV2 {
  readonly outputDirectory: string;
  readonly reviewPackSha256: Sha256;
  readonly receiptSha256: Sha256;
  readonly panoramaDecisionCount: 148;
  readonly interfaceDecisionCount: 8;
  readonly cleanupInspectionCount: 2;
  readonly authority: "none";
  readonly reviewState: "human_pending";
  readonly nativeResolutionHumanReviewCompleted: false;
}

function assertBlankHumanDecisions(decisions: GrandHallT554HumanDecisionsV2): void {
  const roomBlank = decisions.matterPakRoomDecision.result === "UNSURE" &&
    decisions.matterPakRoomDecision.note === null;
  const cleanupBlank = decisions.cleanupArtifactInspections.every((row) =>
    row.result === "UNSURE" && row.note === null
  );
  const panoramasBlank = decisions.panoramaDecisions.every((row) =>
    row.result === "UNSURE" && row.note === null && row.maskFileName === null &&
    row.reviewedMaskBinding === null && !row.maskReviewed && row.maskReasonCodes.length === 0
  );
  const interfacesBlank = decisions.interfaceDecisions.every((row) =>
    row.result === "UNSURE" && row.note === null
  );
  if (!roomBlank || !cleanupBlank || !panoramasBlank || !interfacesBlank) {
    throw new GrandHallT554ReviewPackV2Error(
      "OUTPUT_VERIFICATION_FAILED",
      "T-554 v2 human decisions must remain entirely blank and pending.",
    );
  }
}

async function inspectPersisted(outputDirectory: string): Promise<VerifiedGrandHallT554ReviewPackV2> {
  const entries = await readdir(outputDirectory, { withFileTypes: true });
  const expectedNames = [
    GRAND_HALL_T554_V2_CLOSED_VOLUME_TEMPLATE_FILENAME,
    GRAND_HALL_T554_V2_HUMAN_DECISIONS_FILENAME,
    GRAND_HALL_T554_V2_PUBLICATION_RECEIPT_FILENAME,
    GRAND_HALL_T554_V2_REVIEW_PACK_FILENAME,
  ].sort((left, right) => left.localeCompare(right, "en"));
  const names = entries.map((entry) => entry.name).sort((left, right) => left.localeCompare(right, "en"));
  if (entries.some((entry) => !entry.isFile()) || names.join("\n") !== expectedNames.join("\n")) {
    throw new GrandHallT554ReviewPackV2Error("OUTPUT_VERIFICATION_FAILED", "T-554 v2 output inventory is not exact and flat.");
  }
  const files = new Map<string, StableJsonFile>();
  for (const name of expectedNames) files.set(name, await readStableDirectJson(resolve(outputDirectory, name), `T-554 v2 output ${name}`));
  try {
    const reviewPack = GrandHallScopeReviewPackV2Schema.parse(parseGrandHallT554StrictJson(files.get(GRAND_HALL_T554_V2_REVIEW_PACK_FILENAME)?.bytes ?? Buffer.alloc(0)));
    const decisions = GrandHallT554HumanDecisionsV2Schema.parse(parseGrandHallT554StrictJson(files.get(GRAND_HALL_T554_V2_HUMAN_DECISIONS_FILENAME)?.bytes ?? Buffer.alloc(0)));
    const closed = GrandHallT554ClosedVolumeReviewV1Schema.parse(parseGrandHallT554StrictJson(files.get(GRAND_HALL_T554_V2_CLOSED_VOLUME_TEMPLATE_FILENAME)?.bytes ?? Buffer.alloc(0)));
    const receipt = parseReceipt(files.get(GRAND_HALL_T554_V2_PUBLICATION_RECEIPT_FILENAME)?.bytes ?? Buffer.alloc(0));
    assertPersistedCrossBindings(reviewPack, decisions, closed, receipt, files);
    return {
      outputDirectory,
      reviewPackSha256: reviewPack.artifactSha256 as Sha256,
      receiptSha256: receipt.receiptSha256,
      panoramaDecisionCount: 148,
      interfaceDecisionCount: 8,
      cleanupInspectionCount: 2,
      authority: "none",
      reviewState: "human_pending",
      nativeResolutionHumanReviewCompleted: false,
    };
  } catch (error) {
    if (error instanceof GrandHallT554ReviewPackV2Error) throw error;
    throw new GrandHallT554ReviewPackV2Error("OUTPUT_VERIFICATION_FAILED", "T-554 v2 persisted artifacts are invalid.", error);
  }
}

function assertPersistedCrossBindings(
  reviewPack: GrandHallScopeReviewPackV2,
  decisions: GrandHallT554HumanDecisionsV2,
  closed: GrandHallT554ClosedVolumeReviewV1,
  receipt: GrandHallT554ReviewPackV2PublicationReceipt,
  files: ReadonlyMap<string, StableJsonFile>,
): void {
  const t561 = reviewPack.sourceEvidence.t561AuthorityNoneObservation;
  assertBlankHumanDecisions(decisions);
  if (
    decisions.reviewPackSha256 !== reviewPack.artifactSha256 || closed.reviewPackSha256 !== reviewPack.artifactSha256 ||
    receipt.reviewPackSha256 !== reviewPack.artifactSha256 || decisions.reviewState !== "human_pending" ||
    decisions.finalDecision !== "PENDING" || decisions.reviewer !== null || closed.reviewState !== "human_pending" ||
    closed.footprintXY.length !== 0 || closed.zMin !== null || closed.zMax !== null ||
    receipt.humanDecisionsSha256 !== computeGrandHallT554HumanDecisionsV2Sha256(decisions) ||
    receipt.closedVolumeReviewSha256 !== computeGrandHallT554ClosedVolumeReviewV1Sha256(closed) ||
    receipt.sourceBindings.predecessorReviewPackArtifactSha256 !== reviewPack.sourceEvidence.predecessorReviewPack.artifactSha256 ||
    receipt.sourceBindings.t561ObservationSetSha256 !== t561.observationSetSha256 ||
    receipt.sourceBindings.t561ManifestSha256 !== t561.manifestSha256 ||
    receipt.sourceBindings.t561ReceiptSha256 !== t561.receiptSha256
  ) throw new GrandHallT554ReviewPackV2Error("OUTPUT_VERIFICATION_FAILED", "T-554 v2 human-pending cross-bindings disagree.");
  const expectedPayloadNames = [
    GRAND_HALL_T554_V2_CLOSED_VOLUME_TEMPLATE_FILENAME,
    GRAND_HALL_T554_V2_HUMAN_DECISIONS_FILENAME,
    GRAND_HALL_T554_V2_REVIEW_PACK_FILENAME,
  ].sort((left, right) => left.localeCompare(right, "en"));
  if (receipt.payloads.map((payload) => payload.relativePath).join("\n") !== expectedPayloadNames.join("\n")) {
    throw new GrandHallT554ReviewPackV2Error("OUTPUT_VERIFICATION_FAILED", "T-554 v2 receipt payload order or coverage is invalid.");
  }
  for (const payload of receipt.payloads) {
    const file = files.get(payload.relativePath);
    if (file === undefined || file.sha256 !== payload.sha256 || file.bytes.length !== payload.byteLength) {
      throw new GrandHallT554ReviewPackV2Error("OUTPUT_VERIFICATION_FAILED", `${payload.relativePath} differs from its receipt binding.`);
    }
  }
}

export interface GrandHallT554ReviewPackV2Dependencies {
  readonly loadSources: (options: GrandHallT554ReviewPackV2Options) => Promise<GrandHallT554ReviewPackV2SourceBundle>;
}

const DEFAULT_DEPENDENCIES: GrandHallT554ReviewPackV2Dependencies = {
  loadSources: loadGrandHallT554ReviewPackV2Sources,
};

async function publish(outputDirectory: string, outputParent: string, built: BuiltPackV2): Promise<void> {
  const temporary = resolve(outputParent, `.${basename(outputDirectory)}.partial-${String(process.pid)}-${randomUUID()}`);
  try {
    await mkdir(temporary, { recursive: false });
    for (const [name, bytes] of built.payloads) await writeFile(resolve(temporary, name), bytes, { flag: "wx" });
    await writeFile(resolve(temporary, GRAND_HALL_T554_V2_PUBLICATION_RECEIPT_FILENAME), built.receiptBytes, { flag: "wx" });
    await inspectPersisted(temporary);
    await rename(temporary, outputDirectory);
    await inspectPersisted(outputDirectory);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    if (error instanceof GrandHallT554ReviewPackV2Error) throw error;
    throw new GrandHallT554ReviewPackV2Error("OUTPUT_PUBLISH_FAILED", "T-554 v2 pack could not be published.", error);
  }
}

export async function generateGrandHallT554ReviewPackV2(
  options: GrandHallT554ReviewPackV2Options,
  dependencies: GrandHallT554ReviewPackV2Dependencies = DEFAULT_DEPENDENCIES,
): Promise<VerifiedGrandHallT554ReviewPackV2> {
  assertInputsOutsideOutput(options);
  const safety = await assertGrandHallT554ReviewOutputSafety({
    sourceRoots: [options.predecessorReviewRoot, options.t561ObservationPackDirectory],
    outputDirectory: options.outputDirectory,
  });
  const built = buildGrandHallT554ReviewPackV2(await dependencies.loadSources(options));
  await publish(safety.outputDirectory, safety.outputParent, built);
  return inspectPersisted(safety.outputDirectory);
}

export async function verifyPersistedGrandHallT554ReviewPackV2(
  outputDirectory: string,
): Promise<VerifiedGrandHallT554ReviewPackV2> {
  const safety = await assertGrandHallT554ExistingReviewOutputSafety({ sourceRoots: [], outputDirectory });
  return inspectPersisted(safety.outputDirectory);
}

async function compareExact(outputDirectory: string, built: BuiltPackV2): Promise<void> {
  const expected = new Map(built.payloads);
  expected.set(GRAND_HALL_T554_V2_PUBLICATION_RECEIPT_FILENAME, built.receiptBytes);
  for (const [name, bytes] of expected) {
    const persisted = await readStableDirectJson(resolve(outputDirectory, name), `T-554 v2 output ${name}`);
    if (!persisted.bytes.equals(bytes)) {
      throw new GrandHallT554ReviewPackV2Error("OUTPUT_VERIFICATION_FAILED", `${name} differs from exact regeneration.`);
    }
  }
}

export async function checkGrandHallT554ReviewPackV2(
  options: GrandHallT554ReviewPackV2Options,
  dependencies: GrandHallT554ReviewPackV2Dependencies = DEFAULT_DEPENDENCIES,
): Promise<VerifiedGrandHallT554ReviewPackV2 & { readonly exactRegenerationVerified: true }> {
  assertInputsOutsideOutput(options);
  const safety = await assertGrandHallT554ExistingReviewOutputSafety({
    sourceRoots: [options.predecessorReviewRoot, options.t561ObservationPackDirectory],
    outputDirectory: options.outputDirectory,
  });
  const before = await inspectPersisted(safety.outputDirectory);
  const built = buildGrandHallT554ReviewPackV2(await dependencies.loadSources(options));
  await compareExact(safety.outputDirectory, built);
  const after = await inspectPersisted(safety.outputDirectory);
  if (before.receiptSha256 !== after.receiptSha256 || before.reviewPackSha256 !== after.reviewPackSha256) {
    throw new GrandHallT554ReviewPackV2Error("OUTPUT_VERIFICATION_FAILED", "T-554 v2 output changed during zero-write check.");
  }
  return { ...after, exactRegenerationVerified: true };
}
