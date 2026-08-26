/**
 * Read-only, authority-none inventory of MatterPak cleanup-marker evidence.
 *
 * This module deliberately does not remove faces, infer Window absence, or
 * create replacement geometry. It binds source-explicit `mirror*` OBJ groups
 * and records that Window localization remains metadata-inconclusive.
 */

import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  type FileHandle,
} from "node:fs/promises";
import type { BigIntStats } from "node:fs";
import { TextDecoder } from "node:util";
import { basename, dirname, isAbsolute, resolve } from "node:path";

import {
  domainSeparatedSha256,
  toCanonicalJson,
} from "@omnitwin/reconstruction-foundry";
import { z } from "zod";

import {
  GRAND_HALL_ROOM_9,
  computeGrandHallRoom9EvidenceSha256,
  parseMatterportObjText,
  type AxisAlignedBounds3,
  type MatterportObjTriangle,
  type ParsedMatterportObj,
} from "./grand-hall-room9-boundary.js";
import {
  assertGrandHallT554ExistingReviewOutputSafety,
  assertGrandHallT554ReviewOutputSafety,
} from "./grand-hall-t554-panorama-review.js";
import { parseGrandHallT554StrictJson } from "./grand-hall-t554-strict-json.js";

export const GRAND_HALL_T554_CLEANUP_MARKER_EVIDENCE_SCHEMA =
  "omnitwin.foundry.grand-hall-t554-cleanup-marker-evidence.v2";
export const GRAND_HALL_T554_CLEANUP_MARKER_RECEIPT_SCHEMA =
  "omnitwin.foundry.grand-hall-t554-cleanup-marker-evidence-receipt.v2";
export const GRAND_HALL_T554_CLEANUP_MARKER_EVIDENCE_FILENAME =
  "cleanup-marker-evidence-v2.json";
export const GRAND_HALL_T554_CLEANUP_MARKER_RECEIPT_FILENAME =
  "publication-receipt-v2.json";

export const GRAND_HALL_T554_WINDOW_LOCALIZATION_STATE =
  "metadata_inconclusive_no_explicit_source_locator";
export const GRAND_HALL_T554_MIRROR_LOCALIZATION_STATE =
  "literal_mirror_groups_localized_by_source_group_name_visual_effect_unverified";
export const GRAND_HALL_T554_MIRROR_TARGET_DISPOSITION =
  "source_group_key_differs_from_selected_room_key_physical_relevance_unresolved";

export const GRAND_HALL_T554_CLEANUP_MARKER_EVIDENCE_DOMAIN =
  "OMNITWIN_GRAND_HALL_T554_CLEANUP_MARKER_EVIDENCE_V2";
export const GRAND_HALL_T554_CLEANUP_MARKER_RECEIPT_DOMAIN =
  "OMNITWIN_GRAND_HALL_T554_CLEANUP_MARKER_EVIDENCE_RECEIPT_V2";
export const GRAND_HALL_T554_CLEANUP_TARGET_INVENTORY_DOMAIN =
  "OMNITWIN_GRAND_HALL_T554_CLEANUP_TARGET_INVENTORY_V2";
const GROUP_INVENTORY_DOMAIN =
  "OMNITWIN_GRAND_HALL_T554_CLEANUP_MARKER_GROUP_INVENTORY_V1";
const FACE_ORDINAL_INVENTORY_DOMAIN =
  "OMNITWIN_GRAND_HALL_T554_CLEANUP_MARKER_FACE_ORDINALS_V1";
const FACE_RECORD_INVENTORY_DOMAIN =
  "OMNITWIN_GRAND_HALL_T554_CLEANUP_MARKER_FACE_RECORDS_V1";
const VERTEX_INDEX_INVENTORY_DOMAIN =
  "OMNITWIN_GRAND_HALL_T554_CLEANUP_MARKER_VERTEX_INDICES_V1";

const EXACT_STAGE_MANIFEST_SCHEMA = "venviewer.capture-stage.v1";
const EXACT_STAGE_PLAN_SHA256 =
  "sha256:d9a75df3ffaf2706d97f454cbfae9a5c47ce0719c83af7f56da391ce0def3729";
const EXACT_STAGE_MANIFEST_SHA256 =
  "sha256:c044823c232dae518df84140c90004a1c17dc682c84885d6f36848933d72ddff";
const EXACT_STAGE_MANIFEST_BYTE_LENGTH = 50_122;
const EXACT_STAGE_FILE_COUNT = 156;
const EXACT_STAGE_TOTAL_BYTES = 22_277_494_876;

const EXACT_BOUNDARY_EVIDENCE_SCHEMA =
  "omnitwin.foundry.grand-hall-room9-source-boundary-evidence.v1";
const EXACT_BOUNDARY_EVIDENCE_SHA256 =
  "sha256:7ab3490a55f67d700a8ab84581e53c69e66b3dc831256bc9b70350d43f8b41c4";
const EXACT_BOUNDARY_EVIDENCE_FILE_SHA256 =
  "sha256:dd4e3348ffaf164de62497dd659b317b7c4e3ee761144417b8dff8f43b181f6d";
const EXACT_BOUNDARY_EVIDENCE_BYTE_LENGTH = 19_200;

const OBJ_RELATIVE_PATH =
  "source/matterpak/424ff41f6e5d41969c635fcd61be9b3f.obj";
const MTL_RELATIVE_PATH =
  "source/matterpak/424ff41f6e5d41969c635fcd61be9b3f.mtl";
const README_RELATIVE_PATH = "source/matterpak/readme.pdf";
const POINT_CLOUD_RELATIVE_PATH = "source/matterpak/cloud.xyz";
const STAGE_MANIFEST_RELATIVE_PATH = "capture-stage-manifest.json";

const OBJ_BYTE_LENGTH = 38_381_816;
const OBJ_SHA256 =
  "sha256:cf7247b5343fe719dc0f1aaf6b64c667d238c69133b71c44ccd9f5c67b5878c7";
const MTL_BYTE_LENGTH = 20_879;
const MTL_SHA256 =
  "sha256:8e43085c90e40e2e76b7e221038c13bd65f17893a3d097eb12ffea5445f85d7a";
const README_BYTE_LENGTH = 197_005;
const README_SHA256 =
  "sha256:fed6e334ea3a3a7eb769c5d67df75a3389d8b18891cec8f137fc9010925ab048";
const POINT_CLOUD_BYTE_LENGTH = 1_611_296_012;
const POINT_CLOUD_SHA256 =
  "sha256:a1e5fc55f62897e4cd08851f4e7e07e3949cc8e1894fbc6c02d029863b821144";

const MAX_STAGE_MANIFEST_BYTES = 1 * 1_024 * 1_024;
const MAX_BOUNDARY_EVIDENCE_BYTES = 2 * 1_024 * 1_024;
const MAX_OBJ_BYTES = 64 * 1_024 * 1_024;
const MAX_MTL_BYTES = 1 * 1_024 * 1_024;
const MAX_README_BYTES = 1 * 1_024 * 1_024;
const MAX_EVIDENCE_BYTES = 4 * 1_024 * 1_024;
const MAX_RECEIPT_BYTES = 1 * 1_024 * 1_024;

type Sha256 = `sha256:${string}`;
const Sha256Schema = z.string()
  .regex(/^sha256:[0-9a-f]{64}$/u)
  .transform((value): Sha256 => value as Sha256);

const RoomKeySchema = z.object({
  groupIndex: z.number().int().min(0).max(999),
  subIndex: z.number().int().min(0).max(999),
}).strict();

const BoundsSchema = z.object({
  min: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
  max: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
}).strict().superRefine((bounds, context) => {
  bounds.min.forEach((value, index) => {
    const maximum = bounds.max[index];
    if (maximum === undefined || value > maximum) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Bounds minimum exceeds maximum.",
      });
    }
  });
});

export const GrandHallT554CleanupTargetSchema = z.object({
  targetId: z.string().regex(
    /^matterpak-obj-group:mirror\d+_group\d{3}_sub\d{3}$/u,
  ),
  artifactClass: z.literal("Mirror"),
  localizationBasis: z.literal("exact_literal_mirror_prefixed_obj_group"),
  sourceGroupName: z.string().regex(/^mirror\d+_group\d{3}_sub\d{3}$/u),
  zeroBasedGroupOrdinal: z.number().int().min(0).max(999),
  sourceLineRangeOneBasedInclusive: z.object({
    start: z.number().int().positive(),
    end: z.number().int().positive(),
  }).strict(),
  sourceRoomKey: RoomKeySchema,
  sourceFaceOrdinalRangeZeroBasedInclusive: z.object({
    start: z.number().int().min(0),
    end: z.number().int().min(0),
  }).strict(),
  sourceFaceCount: z.number().int().positive(),
  sourceFaceOrdinalSha256: Sha256Schema,
  sourceFaceRecordSha256: Sha256Schema,
  uniqueVertexCount: z.number().int().positive(),
  uniqueVertexIndexSha256: Sha256Schema,
  materialNames: z.array(z.string().min(1).max(255)).min(1).max(16),
  boundsMeters: BoundsSchema,
  selectedRoomMatch: z.literal(false),
  uniqueVerticesSharedWithSelectedRoom: z.literal(0),
  disposition: z.literal(GRAND_HALL_T554_MIRROR_TARGET_DISPOSITION),
  cleanupDecision: z.literal("not_made_human_review_required"),
  faceRemovalAuthorized: z.literal(false),
  generatedGeometryUsed: z.literal(false),
}).strict().superRefine((target, context) => {
  if (target.targetId !== `matterpak-obj-group:${target.sourceGroupName}`) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Cleanup target id must contain the exact source group name.",
    });
  }
  if (
    target.sourceLineRangeOneBasedInclusive.start >
      target.sourceLineRangeOneBasedInclusive.end ||
    target.sourceFaceOrdinalRangeZeroBasedInclusive.start >
      target.sourceFaceOrdinalRangeZeroBasedInclusive.end ||
    target.sourceFaceOrdinalRangeZeroBasedInclusive.end -
      target.sourceFaceOrdinalRangeZeroBasedInclusive.start + 1 !==
      target.sourceFaceCount
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Cleanup target ranges are inconsistent.",
    });
  }
});

export type GrandHallT554CleanupTarget = z.infer<
  typeof GrandHallT554CleanupTargetSchema
>;

const SourceFileBindingSchema = z.object({
  sourceLocator: z.string().min(1).max(256),
  byteLength: z.number().int().positive(),
  sha256: Sha256Schema,
  sourceBytesReadThisRun: z.literal(true),
}).strict();

const FIXED_GUARDS = Object.freeze({
  sourceMutationPermitted: false,
  cleanupApplied: false,
  sourceFacesRemoved: false,
  windowAbsenceClaimed: false,
  humanAcceptanceRecorded: false,
  nativeSourceReviewCompleted: false,
  architecturalAuthority: "none",
  roomBoundaryAuthority: "none",
  replacementGeometryGenerated: false,
  generatedContentUsed: false,
  trainingAuthorized: false,
  reconstructionAuthorized: false,
  runtimeAuthorized: false,
  stagingAuthorized: false,
  deploymentAuthorized: false,
  publicEvidenceAuthorized: false,
} as const);

const GuardSchema = z.object({
  sourceMutationPermitted: z.literal(false),
  cleanupApplied: z.literal(false),
  sourceFacesRemoved: z.literal(false),
  windowAbsenceClaimed: z.literal(false),
  humanAcceptanceRecorded: z.literal(false),
  nativeSourceReviewCompleted: z.literal(false),
  architecturalAuthority: z.literal("none"),
  roomBoundaryAuthority: z.literal("none"),
  replacementGeometryGenerated: z.literal(false),
  generatedContentUsed: z.literal(false),
  trainingAuthorized: z.literal(false),
  reconstructionAuthorized: z.literal(false),
  runtimeAuthorized: z.literal(false),
  stagingAuthorized: z.literal(false),
  deploymentAuthorized: z.literal(false),
  publicEvidenceAuthorized: z.literal(false),
}).strict();

const WindowClassEvidenceSchema = z.object({
  artifactClass: z.literal("Window"),
  localizationState: z.literal(GRAND_HALL_T554_WINDOW_LOCALIZATION_STATE),
  sourceLiteralGroupMatchRule: z.literal("case_sensitive_window_prefix"),
  literalNamedGroupCount: z.literal(0),
  localizedTargetIds: z.tuple([]),
  absenceOfMarkerEffectClaimed: z.literal(false),
  completenessScope: z.literal("literal_obj_group_names_only"),
  nativeSourceReviewCompleted: z.literal(false),
  humanReviewRequired: z.literal(true),
}).strict();

const MirrorClassEvidenceSchema = z.object({
  artifactClass: z.literal("Mirror"),
  localizationState: z.literal(GRAND_HALL_T554_MIRROR_LOCALIZATION_STATE),
  sourceLiteralGroupMatchRule: z.literal("case_sensitive_mirror_prefix"),
  literalNamedGroupCount: z.literal(5),
  localizedTargetIds: z.array(
    z.string().regex(/^matterpak-obj-group:mirror\d+_group\d{3}_sub\d{3}$/u),
  ).length(5),
  absenceOfMarkerEffectClaimed: z.literal(false),
  completenessScope: z.literal(
    "every_obj_group_name_matching_exact_literal_mirror_prefix_in_bound_obj",
  ),
  nativeSourceReviewCompleted: z.literal(false),
  humanReviewRequired: z.literal(true),
}).strict();

const LIMITATIONS = Object.freeze([
  "Literal OBJ group names provide exact source locators for five Mirror-labelled groups, but neither their non-selected group keys nor their separate vertex indices prove physical exclusion from the Grand Hall or their visual effect.",
  "No literal Window-prefixed OBJ group exists in the bound OBJ; this is metadata-inconclusive and is not evidence that Window marker effects are absent.",
  "The bound MatterPak README describes marker-driven closure walls and mesh removal generally but provides no per-marker manifest or group-naming guarantee.",
  "The staged point cloud is marker-affected according to the vendor documentation and was not used to localize cleanup targets in this run.",
  "Every cleanup decision, any face removal, and native-source visual review remain human-pending.",
] as const);

export const GrandHallT554CleanupMarkerEvidenceMaterialSchema = z.object({
  schemaVersion: z.literal(GRAND_HALL_T554_CLEANUP_MARKER_EVIDENCE_SCHEMA),
  subject: z.object({
    venueId: z.literal("trades-hall"),
    roomId: z.literal("grand-hall"),
    taskId: z.literal("T-554"),
    scope: z.literal("source_explicit_cleanup_marker_localization_only"),
    selectedMatterpakRoomKey: z.object({
      groupIndex: z.literal(1),
      subIndex: z.literal(9),
      exactObjGroupSuffix: z.literal("_group001_sub009"),
    }).strict(),
  }).strict(),
  authority: z.literal("none"),
  reviewState: z.literal("machine_inventory_complete_human_pending"),
  sourceBindings: z.object({
    captureStageManifest: z.object({
      sourceLocator: z.literal("CAPTURE_STAGE_ROOT/capture-stage-manifest.json"),
      byteLength: z.literal(EXACT_STAGE_MANIFEST_BYTE_LENGTH),
      sha256: z.literal(EXACT_STAGE_MANIFEST_SHA256),
      schemaVersion: z.literal(EXACT_STAGE_MANIFEST_SCHEMA),
      planSha256: z.literal(EXACT_STAGE_PLAN_SHA256),
      fileCount: z.literal(EXACT_STAGE_FILE_COUNT),
      totalBytes: z.literal(EXACT_STAGE_TOTAL_BYTES),
      sourceBytesReadThisRun: z.literal(true),
    }).strict(),
    room9SourceBoundaryEvidence: z.object({
      sourceLocator: z.literal(
        "REPOSITORY/docs/operations/grand-hall-room9-source-boundary-evidence-v1.json",
      ),
      byteLength: z.literal(EXACT_BOUNDARY_EVIDENCE_BYTE_LENGTH),
      serializedFileSha256: z.literal(EXACT_BOUNDARY_EVIDENCE_FILE_SHA256),
      evidenceSha256: z.literal(EXACT_BOUNDARY_EVIDENCE_SHA256),
      sourceBytesReadThisRun: z.literal(true),
    }).strict(),
    obj: SourceFileBindingSchema.extend({
      sourceLocator: z.literal(`CAPTURE_STAGE_ROOT/${OBJ_RELATIVE_PATH}`),
      byteLength: z.literal(OBJ_BYTE_LENGTH),
      sha256: z.literal(OBJ_SHA256),
    }).strict(),
    mtl: SourceFileBindingSchema.extend({
      sourceLocator: z.literal(`CAPTURE_STAGE_ROOT/${MTL_RELATIVE_PATH}`),
      byteLength: z.literal(MTL_BYTE_LENGTH),
      sha256: z.literal(MTL_SHA256),
    }).strict(),
    matterpakReadme: SourceFileBindingSchema.extend({
      sourceLocator: z.literal(`CAPTURE_STAGE_ROOT/${README_RELATIVE_PATH}`),
      byteLength: z.literal(README_BYTE_LENGTH),
      sha256: z.literal(README_SHA256),
    }).strict(),
    pointCloud: z.object({
      sourceLocator: z.literal(`CAPTURE_STAGE_ROOT/${POINT_CLOUD_RELATIVE_PATH}`),
      byteLength: z.literal(POINT_CLOUD_BYTE_LENGTH),
      sha256: z.literal(POINT_CLOUD_SHA256),
      bindingBasis: z.literal("exact_capture_stage_manifest_entry"),
      sourceBytesReadThisRun: z.literal(false),
      usedForLocalization: z.literal(false),
    }).strict(),
  }).strict(),
  vendorMarkerSemantics: z.object({
    evidenceBasis: z.literal(
      "human_reviewed_paraphrase_of_exact_hash_bound_matterpak_readme",
    ),
    referencedPagesOneBased: z.tuple([z.literal(2), z.literal(4)]),
    objMarkerEffect: z.literal(
      "Window and Mirror markers may add triangular closure walls and remove mesh behind the marker line.",
    ),
    pointCloudMarkerEffect: z.literal(
      "The XYZ export has points removed behind marker classes and does not contain the OBJ closure-wall triangles.",
    ),
    perMarkerManifestPresentInBoundEvidence: z.literal(false),
    objGroupNamingGuaranteePresentInBoundEvidence: z.literal(false),
    architecturalAuthority: z.literal("none"),
  }).strict(),
  objInventory: z.object({
    vertexRecordCount: z.literal(237_561),
    textureCoordinateRecordCount: z.literal(531_888),
    faceRecordCount: z.literal(474_049),
    groupRecordCount: z.literal(159),
    useMaterialRecordCount: z.literal(159),
    literalChunkNamedGroupCount: z.literal(154),
    literalMirrorNamedGroupCount: z.literal(5),
    literalWindowNamedGroupCount: z.literal(0),
    otherGroupNameCount: z.literal(0),
    groupInventorySha256: Sha256Schema,
    selectedRoomGroupCount: z.literal(43),
    selectedRoomFaceCount: z.literal(119_564),
    selectedRoomUniqueVertexCount: z.literal(59_049),
  }).strict(),
  targetIdRule: z.literal("matterpak-obj-group:<exact-source-group-name>"),
  explicitCleanupTargets: z.array(GrandHallT554CleanupTargetSchema).length(5),
  cleanupTargetInventorySha256: Sha256Schema,
  classEvidence: z.tuple([
    WindowClassEvidenceSchema,
    MirrorClassEvidenceSchema,
  ]),
  guards: GuardSchema,
  limitations: z.tuple([
    z.literal(LIMITATIONS[0]),
    z.literal(LIMITATIONS[1]),
    z.literal(LIMITATIONS[2]),
    z.literal(LIMITATIONS[3]),
    z.literal(LIMITATIONS[4]),
  ]),
}).strict();

export const GrandHallT554CleanupMarkerEvidenceSchema =
  GrandHallT554CleanupMarkerEvidenceMaterialSchema.extend({
    evidenceSha256: Sha256Schema,
  }).strict();

export type GrandHallT554CleanupMarkerEvidenceMaterial = z.infer<
  typeof GrandHallT554CleanupMarkerEvidenceMaterialSchema
>;
export type GrandHallT554CleanupMarkerEvidence = z.infer<
  typeof GrandHallT554CleanupMarkerEvidenceSchema
>;

const ReceiptMaterialSchema = z.object({
  schemaVersion: z.literal(GRAND_HALL_T554_CLEANUP_MARKER_RECEIPT_SCHEMA),
  state: z.literal("complete"),
  authority: z.literal("none"),
  evidenceSha256: Sha256Schema,
  cleanupTargetInventorySha256: Sha256Schema,
  payload: z.object({
    relativePath: z.literal(GRAND_HALL_T554_CLEANUP_MARKER_EVIDENCE_FILENAME),
    byteLength: z.number().int().positive().max(MAX_EVIDENCE_BYTES),
    sha256: Sha256Schema,
  }).strict(),
  outputFileCount: z.literal(2),
  explicitCleanupTargetCount: z.literal(5),
  windowLocalizedTargetCount: z.literal(0),
  mirrorLocalizedTargetCount: z.literal(5),
  windowLocalizationState: z.literal(GRAND_HALL_T554_WINDOW_LOCALIZATION_STATE),
  mirrorLocalizationState: z.literal(GRAND_HALL_T554_MIRROR_LOCALIZATION_STATE),
  guards: GuardSchema,
  receiptWrittenLast: z.literal(true),
}).strict();

export const GrandHallT554CleanupMarkerReceiptSchema =
  ReceiptMaterialSchema.extend({ receiptSha256: Sha256Schema }).strict();

export type GrandHallT554CleanupMarkerReceipt = z.infer<
  typeof GrandHallT554CleanupMarkerReceiptSchema
>;

export class GrandHallT554CleanupMarkerEvidenceError extends Error {
  public constructor(
    public readonly code:
      | "ARGUMENT_INVALID"
      | "INPUT_INVALID"
      | "SOURCE_MISMATCH"
      | "OUTPUT_UNSAFE"
      | "OUTPUT_PUBLISH_FAILED"
      | "OUTPUT_VERIFICATION_FAILED",
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GrandHallT554CleanupMarkerEvidenceError";
  }
}

function digestMaterial(domain: string, value: unknown): Sha256 {
  return `sha256:${domainSeparatedSha256(domain, toCanonicalJson(value))}`;
}

export function grandHallT554CleanupMarkerTargetId(groupName: string): string {
  if (!/^mirror\d+_group\d{3}_sub\d{3}$/u.test(groupName)) {
    throw new GrandHallT554CleanupMarkerEvidenceError(
      "INPUT_INVALID",
      "A cleanup target id can only be derived from an exact literal mirror-prefixed source group.",
    );
  }
  return `matterpak-obj-group:${groupName}`;
}

export function computeGrandHallT554CleanupTargetInventorySha256(
  targets: readonly GrandHallT554CleanupTarget[],
): Sha256 {
  return digestMaterial(GRAND_HALL_T554_CLEANUP_TARGET_INVENTORY_DOMAIN, targets);
}

interface ObjGroupScan {
  readonly zeroBasedGroupOrdinal: number;
  readonly name: string;
  readonly groupIndex: number;
  readonly subIndex: number;
  readonly startLine: number;
  readonly endLine: number;
  readonly faceOrdinals: readonly number[];
}

interface MutableObjGroupScan {
  zeroBasedGroupOrdinal: number;
  name: string;
  groupIndex: number;
  subIndex: number;
  startLine: number;
  endLine: number;
  faceOrdinals: number[];
}

interface ObjScanState {
  readonly groups: MutableObjGroupScan[];
  activeGroup: MutableObjGroupScan | undefined;
  faceOrdinal: number;
  vertex: number;
  textureCoordinate: number;
  useMaterial: number;
}

export interface GrandHallT554CleanupMarkerObjAnalysis {
  readonly objInventory: {
    readonly vertexRecordCount: number;
    readonly textureCoordinateRecordCount: number;
    readonly faceRecordCount: number;
    readonly groupRecordCount: number;
    readonly useMaterialRecordCount: number;
    readonly literalChunkNamedGroupCount: number;
    readonly literalMirrorNamedGroupCount: number;
    readonly literalWindowNamedGroupCount: number;
    readonly otherGroupNameCount: number;
    readonly groupInventorySha256: Sha256;
    readonly selectedRoomGroupCount: number;
    readonly selectedRoomFaceCount: number;
    readonly selectedRoomUniqueVertexCount: number;
  };
  readonly explicitCleanupTargets: readonly GrandHallT554CleanupTarget[];
  readonly cleanupTargetInventorySha256: Sha256;
  readonly windowLocalizationState: typeof GRAND_HALL_T554_WINDOW_LOCALIZATION_STATE;
  readonly mirrorLocalizationState: typeof GRAND_HALL_T554_MIRROR_LOCALIZATION_STATE;
}

const SOURCE_GROUP_PATTERN =
  /^(chunk|mirror)(\d+)_group(\d{3})_sub(\d{3})$/u;

function scanSourceGroupRecord(
  state: ObjScanState,
  fields: readonly string[],
  lineNumber: number,
  finalLineNumber: number,
): void {
  if (fields.length !== 2 || fields[1] === undefined) {
    throw new Error(`OBJ line ${String(lineNumber)} has an ambiguous group record.`);
  }
  const match = SOURCE_GROUP_PATTERN.exec(fields[1]);
  if (match === null) {
    throw new Error(
      `OBJ line ${String(lineNumber)} has an unsupported group name ${JSON.stringify(fields[1])}.`,
    );
  }
  if (state.activeGroup !== undefined) state.activeGroup.endLine = lineNumber - 1;
  state.activeGroup = {
    zeroBasedGroupOrdinal: state.groups.length,
    name: fields[1],
    groupIndex: Number.parseInt(match[3] ?? "", 10),
    subIndex: Number.parseInt(match[4] ?? "", 10),
    startLine: lineNumber,
    endLine: finalLineNumber,
    faceOrdinals: [],
  };
  state.groups.push(state.activeGroup);
}

function scanSourceObjLine(
  state: ObjScanState,
  rawLine: string,
  lineNumber: number,
  finalLineNumber: number,
): void {
  const line = rawLine.trim();
  if (line.length === 0 || line.startsWith("#")) return;
  const fields = line.split(/\s+/u);
  const type = fields[0];
  if (type === "v") state.vertex += 1;
  if (type === "vt") state.textureCoordinate += 1;
  if (type === "usemtl") state.useMaterial += 1;
  if (type === "g") scanSourceGroupRecord(state, fields, lineNumber, finalLineNumber);
  if (type !== "f") return;
  if (state.activeGroup === undefined) {
    throw new Error(`OBJ line ${String(lineNumber)} has a face before a source group.`);
  }
  state.activeGroup.faceOrdinals.push(state.faceOrdinal);
  state.faceOrdinal += 1;
}

function parseSourceGroups(text: string): {
  readonly groups: readonly ObjGroupScan[];
  readonly recordCounts: {
    readonly vertex: number;
    readonly textureCoordinate: number;
    readonly face: number;
    readonly useMaterial: number;
  };
} {
  const lines = text.split(/\r?\n/u);
  const state: ObjScanState = {
    groups: [],
    activeGroup: undefined,
    faceOrdinal: 0,
    vertex: 0,
    textureCoordinate: 0,
    useMaterial: 0,
  };
  lines.forEach((line, index) => {
    scanSourceObjLine(state, line, index + 1, lines.length);
  });
  const names = state.groups.map((group) => group.name);
  if (new Set(names).size !== names.length) {
    throw new Error("OBJ source group names must be unique for deterministic localization.");
  }
  return {
    groups: state.groups,
    recordCounts: {
      vertex: state.vertex,
      textureCoordinate: state.textureCoordinate,
      face: state.faceOrdinal,
      useMaterial: state.useMaterial,
    },
  };
}

function lexicalOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function boundsForIndices(
  model: ParsedMatterportObj,
  indices: ReadonlySet<number>,
): AxisAlignedBounds3 {
  let minimum: [number, number, number] = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ];
  let maximum: [number, number, number] = [
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  for (const index of indices) {
    const vertex = model.vertices[index];
    if (vertex === undefined) throw new Error(`Missing OBJ vertex ${String(index)}.`);
    minimum = [
      Math.min(minimum[0], vertex[0]),
      Math.min(minimum[1], vertex[1]),
      Math.min(minimum[2], vertex[2]),
    ];
    maximum = [
      Math.max(maximum[0], vertex[0]),
      Math.max(maximum[1], vertex[1]),
      Math.max(maximum[2], vertex[2]),
    ];
  }
  if (indices.size === 0) throw new Error("A cleanup target cannot have empty bounds.");
  return { min: minimum, max: maximum };
}

interface DerivedCleanupTargetFacts {
  readonly ordinals: readonly number[];
  readonly firstFaceOrdinal: number;
  readonly lastFaceOrdinal: number;
  readonly vertices: ReadonlySet<number>;
  readonly materials: ReadonlySet<string>;
  readonly sharedVertexCount: number;
}

function deriveCleanupTargetFacts(
  group: ObjGroupScan,
  triangles: readonly MatterportObjTriangle[],
  selectedRoomVertices: ReadonlySet<number>,
): DerivedCleanupTargetFacts {
  if (triangles.length === 0 || triangles.length !== group.faceOrdinals.length) {
    throw new Error(`Source group ${group.name} has an inconsistent face inventory.`);
  }
  const actualOrdinals = triangles.map((triangle) => triangle.sourceFaceOrdinal);
  if (actualOrdinals.some((ordinal, index) => ordinal !== group.faceOrdinals[index])) {
    throw new Error(`Source group ${group.name} face order differs between parsers.`);
  }
  const first = actualOrdinals[0];
  const last = actualOrdinals.at(-1);
  if (first === undefined || last === undefined || last - first + 1 !== triangles.length) {
    throw new Error(`Source group ${group.name} faces are not contiguous.`);
  }
  const vertices = new Set<number>();
  const materials = new Set<string>();
  for (const triangle of triangles) {
    triangle.vertexIndices.forEach((index) => vertices.add(index));
    if (triangle.material !== null) materials.add(triangle.material);
  }
  let shared = 0;
  for (const index of vertices) if (selectedRoomVertices.has(index)) shared += 1;
  return {
    ordinals: actualOrdinals,
    firstFaceOrdinal: first,
    lastFaceOrdinal: last,
    vertices,
    materials,
    sharedVertexCount: shared,
  };
}

function buildCleanupTarget(
  model: ParsedMatterportObj,
  group: ObjGroupScan,
  triangles: readonly MatterportObjTriangle[],
  selectedRoomVertices: ReadonlySet<number>,
): GrandHallT554CleanupTarget {
  const facts = deriveCleanupTargetFacts(group, triangles, selectedRoomVertices);
  return GrandHallT554CleanupTargetSchema.parse({
    targetId: grandHallT554CleanupMarkerTargetId(group.name),
    artifactClass: "Mirror",
    localizationBasis: "exact_literal_mirror_prefixed_obj_group",
    sourceGroupName: group.name,
    zeroBasedGroupOrdinal: group.zeroBasedGroupOrdinal,
    sourceLineRangeOneBasedInclusive: { start: group.startLine, end: group.endLine },
    sourceRoomKey: { groupIndex: group.groupIndex, subIndex: group.subIndex },
    sourceFaceOrdinalRangeZeroBasedInclusive: {
      start: facts.firstFaceOrdinal,
      end: facts.lastFaceOrdinal,
    },
    sourceFaceCount: triangles.length,
    sourceFaceOrdinalSha256: digestMaterial(FACE_ORDINAL_INVENTORY_DOMAIN, facts.ordinals),
    sourceFaceRecordSha256: digestMaterial(
      FACE_RECORD_INVENTORY_DOMAIN,
      triangles.map((triangle) => ({
        sourceFaceOrdinal: triangle.sourceFaceOrdinal,
        vertexIndices: triangle.vertexIndices,
        material: triangle.material,
      })),
    ),
    uniqueVertexCount: facts.vertices.size,
    uniqueVertexIndexSha256: digestMaterial(
      VERTEX_INDEX_INVENTORY_DOMAIN,
      [...facts.vertices].sort((left, right) => left - right),
    ),
    materialNames: [...facts.materials].sort(lexicalOrder),
    boundsMeters: boundsForIndices(model, facts.vertices),
    selectedRoomMatch:
      group.groupIndex === GRAND_HALL_ROOM_9.groupIndex &&
      group.subIndex === GRAND_HALL_ROOM_9.subIndex,
    uniqueVerticesSharedWithSelectedRoom: facts.sharedVertexCount,
    disposition: GRAND_HALL_T554_MIRROR_TARGET_DISPOSITION,
    cleanupDecision: "not_made_human_review_required",
    faceRemovalAuthorized: false,
    generatedGeometryUsed: false,
  });
}

function isSelectedRoomKey(group: { readonly groupIndex: number; readonly subIndex: number }): boolean {
  return group.groupIndex === GRAND_HALL_ROOM_9.groupIndex &&
    group.subIndex === GRAND_HALL_ROOM_9.subIndex;
}

function indexObjTriangles(model: ParsedMatterportObj): {
  readonly groupTriangles: ReadonlyMap<string, readonly MatterportObjTriangle[]>;
  readonly selectedRoomVertices: ReadonlySet<number>;
  readonly selectedRoomFaceCount: number;
} {
  const groupTriangles = new Map<string, MatterportObjTriangle[]>();
  const selectedRoomVertices = new Set<number>();
  let selectedRoomFaceCount = 0;
  for (const triangle of model.triangles) {
    const list = groupTriangles.get(triangle.group.name) ?? [];
    list.push(triangle);
    groupTriangles.set(triangle.group.name, list);
    if (!isSelectedRoomKey(triangle.group)) continue;
    selectedRoomFaceCount += 1;
    triangle.vertexIndices.forEach((index) => selectedRoomVertices.add(index));
  }
  return { groupTriangles, selectedRoomVertices, selectedRoomFaceCount };
}

function groupInventoryMaterial(
  groups: readonly ObjGroupScan[],
): readonly Record<string, unknown>[] {
  return groups.map((group) => ({
    zeroBasedGroupOrdinal: group.zeroBasedGroupOrdinal,
    name: group.name,
    groupIndex: group.groupIndex,
    subIndex: group.subIndex,
    sourceLineRangeOneBasedInclusive: { start: group.startLine, end: group.endLine },
    sourceFaceOrdinalRangeZeroBasedInclusive: group.faceOrdinals.length === 0
      ? null
      : { start: group.faceOrdinals[0] ?? 0, end: group.faceOrdinals.at(-1) ?? 0 },
    sourceFaceCount: group.faceOrdinals.length,
  }));
}

function parseCleanupMarkerObj(objText: string): {
  readonly model: ParsedMatterportObj;
  readonly scan: ReturnType<typeof parseSourceGroups>;
} {
  try {
    const model = parseMatterportObjText(objText);
    const scan = parseSourceGroups(objText);
    if (
      model.vertices.length !== scan.recordCounts.vertex ||
      model.triangles.length !== scan.recordCounts.face
    ) throw new Error("Independent OBJ record inventories disagree.");
    return { model, scan };
  } catch (error) {
    throw new GrandHallT554CleanupMarkerEvidenceError(
      "INPUT_INVALID",
      "MatterPak OBJ cleanup-marker inventory could not be parsed safely.",
      error,
    );
  }
}

function cleanupObjInventory(
  scan: ReturnType<typeof parseSourceGroups>,
  indexed: ReturnType<typeof indexObjTriangles>,
  mirrorGroupCount: number,
): GrandHallT554CleanupMarkerObjAnalysis["objInventory"] {
  const chunkCount = scan.groups.filter((group) => group.name.startsWith("chunk")).length;
  const windowCount = scan.groups.filter((group) => group.name.startsWith("window")).length;
  return {
    vertexRecordCount: scan.recordCounts.vertex,
    textureCoordinateRecordCount: scan.recordCounts.textureCoordinate,
    faceRecordCount: scan.recordCounts.face,
    groupRecordCount: scan.groups.length,
    useMaterialRecordCount: scan.recordCounts.useMaterial,
    literalChunkNamedGroupCount: chunkCount,
    literalMirrorNamedGroupCount: mirrorGroupCount,
    literalWindowNamedGroupCount: windowCount,
    otherGroupNameCount: scan.groups.length - chunkCount - mirrorGroupCount - windowCount,
    groupInventorySha256: digestMaterial(
      GROUP_INVENTORY_DOMAIN,
      groupInventoryMaterial(scan.groups),
    ),
    selectedRoomGroupCount: scan.groups.filter(isSelectedRoomKey).length,
    selectedRoomFaceCount: indexed.selectedRoomFaceCount,
    selectedRoomUniqueVertexCount: indexed.selectedRoomVertices.size,
  };
}

export function analyzeGrandHallT554CleanupMarkerObj(
  objText: string,
): GrandHallT554CleanupMarkerObjAnalysis {
  const { model, scan } = parseCleanupMarkerObj(objText);
  const indexed = indexObjTriangles(model);
  const mirrorGroups = scan.groups.filter((group) => group.name.startsWith("mirror"));
  const explicitCleanupTargets = mirrorGroups.map((group) =>
    buildCleanupTarget(
      model,
      group,
      indexed.groupTriangles.get(group.name) ?? [],
      indexed.selectedRoomVertices,
    )
  );
  return {
    objInventory: cleanupObjInventory(scan, indexed, mirrorGroups.length),
    explicitCleanupTargets,
    cleanupTargetInventorySha256:
      computeGrandHallT554CleanupTargetInventorySha256(explicitCleanupTargets),
    windowLocalizationState: GRAND_HALL_T554_WINDOW_LOCALIZATION_STATE,
    mirrorLocalizationState: GRAND_HALL_T554_MIRROR_LOCALIZATION_STATE,
  };
}

const EXPECTED_GROUP_INVENTORY_SHA256 =
  "sha256:d0c82ec4789345762238f73b928afc2b5dc6f05773bac06958e0c33e17786fb7";

const EXPECTED_MIRROR_FACTS = Object.freeze([
  {
    name: "mirror130_group000_sub002",
    ordinal: 130,
    startLine: 1_120_640,
    endLine: 1_121_258,
    firstFace: 350_795,
    lastFace: 351_410,
    faceCount: 616,
    faceOrdinalSha256: "sha256:e220ad2146e2f7858009d53cd5c9407160693b3f449863a977b05836435a3eef",
    faceRecordSha256: "sha256:778d4dea4d94101c44a11dcea4fe5d657001b810c7b25babfa767f5983a5baf2",
    vertexCount: 592,
    vertexIndexSha256: "sha256:2b5d007fbe89e48f5dbcf52300b00c5a7fa73db0583f2718f22cab1276fb5af4",
    material: "424ff41f6e5d41969c635fcd61be9b3f_123.jpg",
    min: [-1.72, -0.423, -2.968],
    max: [1.682, 0.545, -0.894],
  },
  {
    name: "mirror131_group000_sub002",
    ordinal: 131,
    startLine: 1_121_259,
    endLine: 1_121_267,
    firstFace: 351_411,
    lastFace: 351_416,
    faceCount: 6,
    faceOrdinalSha256: "sha256:53f8d3c7e8a10912218d4a2e23fce01ba5bb8a9bd8c3c883b9228edb119513ee",
    faceRecordSha256: "sha256:657b9285314a66f2217595da6b8c2dd811b5e3b91714884fc67c6c5ad3b192ee",
    vertexCount: 8,
    vertexIndexSha256: "sha256:baa5d8a2274797bd98bb28357a9741a2b4957f6eb1cdb5e7e3105a709c2c0406",
    material: "424ff41f6e5d41969c635fcd61be9b3f_123.jpg",
    min: [1.628, -0.578, -1.947],
    max: [1.634, -0.372, -1.587],
  },
  {
    name: "mirror136_group000_sub002",
    ordinal: 136,
    startLine: 1_140_397,
    endLine: 1_142_522,
    firstFace: 370_534,
    lastFace: 372_656,
    faceCount: 2_123,
    faceOrdinalSha256: "sha256:a138f1fc09a98cb60eaafcab5b8d384186ea5a893612639264d550a089eb9736",
    faceRecordSha256: "sha256:32f8e72b817ca7a3f6fd243e7c75b5637c5cda563d41aa8a1bb231c5e80edcd6",
    vertexCount: 1_797,
    vertexIndexSha256: "sha256:a15dcd0bd814376ffdf5781c9478ae42f5b0a51ae5d06ad5cbd948b1ca3eea89",
    material: "424ff41f6e5d41969c635fcd61be9b3f_127.jpg",
    min: [-1.803, -1.173352, -3.589],
    max: [1.693, 0.5705, -0.368],
  },
  {
    name: "mirror142_group000_sub002",
    ordinal: 142,
    startLine: 1_184_055,
    endLine: 1_184_223,
    firstFace: 414_174,
    lastFace: 414_339,
    faceCount: 166,
    faceOrdinalSha256: "sha256:b284bded47d3617f0c552ecda2ec3e6e682251719a34b8759635304c04a5a605",
    faceRecordSha256: "sha256:406acfb31927b82506e4c96660fa8c91d2a48d3c6858ea21616df94d8a2adb4d",
    vertexCount: 195,
    vertexIndexSha256: "sha256:65d565a20706f88064cc1dfd72533cd07bff6c2903c7db56fefcdc203493a9f0",
    material: "424ff41f6e5d41969c635fcd61be9b3f_132.jpg",
    min: [1.188, -0.671, -3.349],
    max: [1.682, 0.763, -0.438625],
  },
  {
    name: "mirror143_group000_sub002",
    ordinal: 143,
    startLine: 1_184_224,
    endLine: 1_184_242,
    firstFace: 414_340,
    lastFace: 414_355,
    faceCount: 16,
    faceOrdinalSha256: "sha256:b9380aed44a0af5499eef225d757cda67f017bc2db83076fc96f8f5637815939",
    faceRecordSha256: "sha256:1911462e0a00b0113b8a0bb6e374ce7b9458079664a76dab5b110f4761d4313e",
    vertexCount: 15,
    vertexIndexSha256: "sha256:8acf3744f4d56f43885dc6003d54dbcf4e65f2ad9f68686298ff7683da945a61",
    material: "424ff41f6e5d41969c635fcd61be9b3f_132.jpg",
    min: [1.518, -1.22, -0.498],
    max: [1.684, -1.08, -0.402],
  },
] as const);

function hasExactCleanupInventory(
  analysis: GrandHallT554CleanupMarkerObjAnalysis,
): boolean {
  const inventory = analysis.objInventory;
  return (
    inventory.vertexRecordCount === 237_561 &&
    inventory.textureCoordinateRecordCount === 531_888 &&
    inventory.faceRecordCount === 474_049 &&
    inventory.groupRecordCount === 159 &&
    inventory.useMaterialRecordCount === 159 &&
    inventory.literalChunkNamedGroupCount === 154 &&
    inventory.literalMirrorNamedGroupCount === 5 &&
    inventory.literalWindowNamedGroupCount === 0 &&
    inventory.otherGroupNameCount === 0 &&
    inventory.groupInventorySha256 === EXPECTED_GROUP_INVENTORY_SHA256 &&
    inventory.selectedRoomGroupCount === 43 &&
    inventory.selectedRoomFaceCount === 119_564 &&
    inventory.selectedRoomUniqueVertexCount === 59_049
  );
}

function assertExactMirrorTarget(
  target: GrandHallT554CleanupTarget,
  index: number,
): void {
  const expected = EXPECTED_MIRROR_FACTS[index];
  const parsedTarget = GrandHallT554CleanupTargetSchema.safeParse(target);
  if (
    expected === undefined ||
    !parsedTarget.success ||
    target.sourceGroupName !== expected.name ||
    target.zeroBasedGroupOrdinal !== expected.ordinal ||
    target.sourceLineRangeOneBasedInclusive.start !== expected.startLine ||
    target.sourceLineRangeOneBasedInclusive.end !== expected.endLine ||
    target.sourceFaceOrdinalRangeZeroBasedInclusive.start !== expected.firstFace ||
    target.sourceFaceOrdinalRangeZeroBasedInclusive.end !== expected.lastFace ||
    target.sourceFaceCount !== expected.faceCount ||
    target.sourceFaceOrdinalSha256 !== expected.faceOrdinalSha256 ||
    target.sourceFaceRecordSha256 !== expected.faceRecordSha256 ||
    target.uniqueVertexCount !== expected.vertexCount ||
    target.uniqueVertexIndexSha256 !== expected.vertexIndexSha256 ||
    target.materialNames.length !== 1 ||
    target.materialNames[0] !== expected.material ||
    JSON.stringify(target.boundsMeters.min) !== JSON.stringify(expected.min) ||
    JSON.stringify(target.boundsMeters.max) !== JSON.stringify(expected.max) ||
    target.sourceRoomKey.groupIndex !== 0 ||
    target.sourceRoomKey.subIndex !== 2
  ) {
    throw new GrandHallT554CleanupMarkerEvidenceError(
      "SOURCE_MISMATCH",
      `Mirror target ${String(index)} differs from the reviewed source inventory.`,
    );
  }
}

export function assertExactGrandHallT554CleanupMarkerAnalysis(
  analysis: GrandHallT554CleanupMarkerObjAnalysis,
): void {
  if (!hasExactCleanupInventory(analysis) || analysis.explicitCleanupTargets.length !== 5) {
    throw new GrandHallT554CleanupMarkerEvidenceError(
      "SOURCE_MISMATCH",
      "Bound OBJ inventory is not the reviewed exact Grand Hall cleanup-marker source.",
    );
  }
  analysis.explicitCleanupTargets.forEach(assertExactMirrorTarget);
  const faceCount = analysis.explicitCleanupTargets.reduce(
    (total, target) => total + target.sourceFaceCount,
    0,
  );
  if (faceCount !== 2_927) {
    throw new GrandHallT554CleanupMarkerEvidenceError(
      "SOURCE_MISMATCH",
      "Mirror target face total differs from the reviewed source inventory.",
    );
  }
  if (
    analysis.cleanupTargetInventorySha256 !==
      computeGrandHallT554CleanupTargetInventorySha256(analysis.explicitCleanupTargets)
  ) {
    throw new GrandHallT554CleanupMarkerEvidenceError(
      "SOURCE_MISMATCH",
      "Mirror target inventory digest differs from the reviewed target records.",
    );
  }
}

function assertArtifactCrossBindings(
  evidence: GrandHallT554CleanupMarkerEvidence,
): void {
  const targets = evidence.explicitCleanupTargets;
  assertExactGrandHallT554CleanupMarkerAnalysis({
    objInventory: evidence.objInventory,
    explicitCleanupTargets: targets,
    cleanupTargetInventorySha256: evidence.cleanupTargetInventorySha256,
    windowLocalizationState: GRAND_HALL_T554_WINDOW_LOCALIZATION_STATE,
    mirrorLocalizationState: GRAND_HALL_T554_MIRROR_LOCALIZATION_STATE,
  });
  if (
    new Set(targets.map((target) => target.targetId)).size !== targets.length ||
    targets.some(
      (target, index) =>
        index > 0 &&
        target.zeroBasedGroupOrdinal <=
          (targets[index - 1]?.zeroBasedGroupOrdinal ?? Number.NEGATIVE_INFINITY),
    )
  ) throw new Error("Cleanup target identifiers and source order must be unique.");
  if (
    evidence.cleanupTargetInventorySha256 !==
      computeGrandHallT554CleanupTargetInventorySha256(targets)
  ) throw new Error("Cleanup target inventory digest mismatch.");
  const [, mirrorEvidence] = evidence.classEvidence;
  if (
    mirrorEvidence.localizedTargetIds.join("\n") !==
      targets.map((target) => target.targetId).join("\n")
  ) throw new Error("Class evidence does not exactly bind the cleanup target inventory.");
}

export function sealGrandHallT554CleanupMarkerEvidence(
  material: GrandHallT554CleanupMarkerEvidenceMaterial,
): GrandHallT554CleanupMarkerEvidence {
  try {
    const parsed = GrandHallT554CleanupMarkerEvidenceMaterialSchema.parse(material);
    const evidence = GrandHallT554CleanupMarkerEvidenceSchema.parse({
      ...parsed,
      evidenceSha256: digestMaterial(
        GRAND_HALL_T554_CLEANUP_MARKER_EVIDENCE_DOMAIN,
        parsed,
      ),
    });
    assertArtifactCrossBindings(evidence);
    return evidence;
  } catch (error) {
    if (error instanceof GrandHallT554CleanupMarkerEvidenceError) throw error;
    throw new GrandHallT554CleanupMarkerEvidenceError(
      "INPUT_INVALID",
      "Cleanup-marker evidence material is invalid.",
      error,
    );
  }
}

export function serializeGrandHallT554CleanupMarkerEvidence(
  evidence: GrandHallT554CleanupMarkerEvidence,
): Buffer {
  return Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

export function parseGrandHallT554CleanupMarkerEvidence(
  bytes: Buffer,
): GrandHallT554CleanupMarkerEvidence {
  try {
    const evidence = GrandHallT554CleanupMarkerEvidenceSchema.parse(
      parseGrandHallT554StrictJson(bytes),
    );
    const { evidenceSha256, ...material } = evidence;
    if (
      evidenceSha256 !==
      digestMaterial(GRAND_HALL_T554_CLEANUP_MARKER_EVIDENCE_DOMAIN, material)
    ) throw new Error("Cleanup-marker evidence self-digest mismatch.");
    assertArtifactCrossBindings(evidence);
    return evidence;
  } catch (error) {
    throw new GrandHallT554CleanupMarkerEvidenceError(
      "OUTPUT_VERIFICATION_FAILED",
      "Persisted cleanup-marker evidence is invalid.",
      error,
    );
  }
}

export function buildGrandHallT554CleanupMarkerReceipt(
  evidence: GrandHallT554CleanupMarkerEvidence,
  evidenceBytes: Buffer,
): GrandHallT554CleanupMarkerReceipt {
  const material = ReceiptMaterialSchema.parse({
    schemaVersion: GRAND_HALL_T554_CLEANUP_MARKER_RECEIPT_SCHEMA,
    state: "complete",
    authority: "none",
    evidenceSha256: evidence.evidenceSha256,
    cleanupTargetInventorySha256: evidence.cleanupTargetInventorySha256,
    payload: {
      relativePath: GRAND_HALL_T554_CLEANUP_MARKER_EVIDENCE_FILENAME,
      byteLength: evidenceBytes.length,
      sha256: `sha256:${createHash("sha256").update(evidenceBytes).digest("hex")}`,
    },
    outputFileCount: 2,
    explicitCleanupTargetCount: 5,
    windowLocalizedTargetCount: 0,
    mirrorLocalizedTargetCount: 5,
    windowLocalizationState: GRAND_HALL_T554_WINDOW_LOCALIZATION_STATE,
    mirrorLocalizationState: GRAND_HALL_T554_MIRROR_LOCALIZATION_STATE,
    guards: FIXED_GUARDS,
    receiptWrittenLast: true,
  });
  return GrandHallT554CleanupMarkerReceiptSchema.parse({
    ...material,
    receiptSha256: digestMaterial(
      GRAND_HALL_T554_CLEANUP_MARKER_RECEIPT_DOMAIN,
      material,
    ),
  });
}

export function serializeGrandHallT554CleanupMarkerReceipt(
  receipt: GrandHallT554CleanupMarkerReceipt,
): Buffer {
  return Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
}

export function parseGrandHallT554CleanupMarkerReceipt(
  bytes: Buffer,
): GrandHallT554CleanupMarkerReceipt {
  try {
    const receipt = GrandHallT554CleanupMarkerReceiptSchema.parse(
      parseGrandHallT554StrictJson(bytes),
    );
    const { receiptSha256, ...material } = receipt;
    if (
      receiptSha256 !==
      digestMaterial(GRAND_HALL_T554_CLEANUP_MARKER_RECEIPT_DOMAIN, material)
    ) throw new Error("Cleanup-marker receipt self-digest mismatch.");
    return receipt;
  } catch (error) {
    throw new GrandHallT554CleanupMarkerEvidenceError(
      "OUTPUT_VERIFICATION_FAILED",
      "Persisted cleanup-marker receipt is invalid.",
      error,
    );
  }
}

interface StableFileBytes {
  readonly absolutePath: string;
  readonly bytes: Buffer;
  readonly sha256: Sha256;
  readonly stats: BigIntStats;
}

function comparablePath(path: string): string {
  const normalized = resolve(path).replaceAll("/", "\\").replace(/[\\]+$/u, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

async function readHandleExactly(handle: FileHandle, sizeBytes: number): Promise<Buffer> {
  const bytes = Buffer.allocUnsafe(sizeBytes);
  let offset = 0;
  while (offset < sizeBytes) {
    const result = await handle.read(bytes, offset, sizeBytes - offset, offset);
    if (result.bytesRead < 1) throw new Error("File ended during bounded stable read.");
    offset += result.bytesRead;
  }
  return bytes;
}

function sameFileIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode &&
    left.nlink === right.nlink && left.size === right.size && left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs;
}

function assertReadableDirectFileStats(
  path: string,
  canonical: string,
  stats: BigIntStats,
  maximumBytes: number,
  label: string,
): void {
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    stats.nlink !== 1n ||
    comparablePath(canonical) !== comparablePath(path) ||
    stats.size < 1n ||
    stats.size > BigInt(maximumBytes)
  ) throw new Error(`${label} must be one bounded direct regular file with one link.`);
}

function assertStableFileIdentity(
  before: BigIntStats,
  descriptorBefore: BigIntStats,
  descriptorAfter: BigIntStats,
  pathAfter: BigIntStats,
  label: string,
): void {
  if (
    !sameFileIdentity(before, descriptorBefore) ||
    !sameFileIdentity(descriptorBefore, descriptorAfter) ||
    !sameFileIdentity(before, pathAfter) ||
    pathAfter.isSymbolicLink()
  ) throw new Error(`${label} changed during its stable read.`);
}

function assertOpenedFileIdentity(before: BigIntStats, opened: BigIntStats, label: string): void {
  if (!sameFileIdentity(before, opened)) {
    throw new Error(`${label} identity changed before its bounded read.`);
  }
}

async function readStableOpenedFile(
  handle: FileHandle,
  absolutePath: string,
  canonicalBefore: string,
  pathBefore: BigIntStats,
  maximumBytes: number,
  label: string,
): Promise<{ readonly bytes: Buffer; readonly stats: BigIntStats }> {
  const descriptorBefore = await handle.stat({ bigint: true });
  assertReadableDirectFileStats(
    absolutePath,
    canonicalBefore,
    descriptorBefore,
    maximumBytes,
    label,
  );
  assertOpenedFileIdentity(pathBefore, descriptorBefore, label);
  const bytes = await readHandleExactly(handle, Number(descriptorBefore.size));
  const descriptorAfter = await handle.stat({ bigint: true });
  const pathAfter = await lstat(absolutePath, { bigint: true });
  const canonicalAfter = await realpath(absolutePath);
  assertReadableDirectFileStats(
    absolutePath,
    canonicalAfter,
    descriptorAfter,
    maximumBytes,
    label,
  );
  assertReadableDirectFileStats(absolutePath, canonicalAfter, pathAfter, maximumBytes, label);
  assertStableFileIdentity(
    pathBefore,
    descriptorBefore,
    descriptorAfter,
    pathAfter,
    label,
  );
  return { bytes, stats: pathAfter };
}

async function readStableDirectFile(
  path: string,
  maximumBytes: number,
  label: string,
): Promise<StableFileBytes> {
  if (!isAbsolute(path)) {
    throw new GrandHallT554CleanupMarkerEvidenceError(
      "INPUT_INVALID",
      `${label} path must be absolute.`,
    );
  }
  const absolutePath = resolve(path);
  let handle: FileHandle | undefined;
  try {
    const pathBefore = await lstat(absolutePath, { bigint: true });
    const canonical = await realpath(absolutePath);
    assertReadableDirectFileStats(absolutePath, canonical, pathBefore, maximumBytes, label);
    handle = await open(absolutePath, "r");
    const stable = await readStableOpenedFile(
      handle,
      absolutePath,
      canonical,
      pathBefore,
      maximumBytes,
      label,
    );
    return {
      absolutePath,
      bytes: stable.bytes,
      sha256: `sha256:${createHash("sha256").update(stable.bytes).digest("hex")}`,
      stats: stable.stats,
    };
  } catch (error) {
    if (error instanceof GrandHallT554CleanupMarkerEvidenceError) throw error;
    throw new GrandHallT554CleanupMarkerEvidenceError(
      "INPUT_INVALID",
      `${label} could not be read as a stable direct source file.`,
      error,
    );
  } finally {
    await handle?.close();
  }
}

function decodeUtf8(bytes: Buffer, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new GrandHallT554CleanupMarkerEvidenceError(
      "INPUT_INVALID",
      `${label} is not valid UTF-8.`,
      error,
    );
  }
}

const StageFileSchema = z.object({
  sourceRelativePath: z.string().min(1).max(512),
  targetRelativePath: z.string().min(1).max(512),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  role: z.string().min(1).max(80),
}).strict();
const StageManifestSchema = z.object({
  schemaVersion: z.literal(EXACT_STAGE_MANIFEST_SCHEMA),
  sourceRoot: z.string().min(1).max(1_024),
  planSha256: z.literal(EXACT_STAGE_PLAN_SHA256.slice("sha256:".length)),
  fileCount: z.literal(EXACT_STAGE_FILE_COUNT),
  totalBytes: z.literal(EXACT_STAGE_TOTAL_BYTES),
  files: z.array(StageFileSchema).length(EXACT_STAGE_FILE_COUNT),
}).strict();

type StageManifest = z.infer<typeof StageManifestSchema>;

const BoundaryProjectionSchema = z.object({
  schemaVersion: z.literal(EXACT_BOUNDARY_EVIDENCE_SCHEMA),
  evidenceSha256: z.literal(EXACT_BOUNDARY_EVIDENCE_SHA256),
  subject: z.object({
    venueId: z.literal("trades-hall"),
    roomId: z.literal("grand-hall"),
    matterpakRoomKey: z.object({
      groupIndex: z.literal(1),
      subIndex: z.literal(9),
      exactObjGroupSuffix: z.literal("_group001_sub009"),
    }).passthrough(),
  }).passthrough(),
  sourceBindings: z.object({
    obj: z.object({
      byteLength: z.literal(OBJ_BYTE_LENGTH),
      sha256: z.literal(OBJ_SHA256),
    }).passthrough(),
    mtl: z.object({
      byteLength: z.literal(MTL_BYTE_LENGTH),
      sha256: z.literal(MTL_SHA256),
    }).passthrough(),
    matterpakReadme: z.object({
      byteLength: z.literal(README_BYTE_LENGTH),
      sha256: z.literal(README_SHA256),
    }).passthrough(),
  }).passthrough(),
  objInventory: z.object({
    vertexRecordCount: z.literal(237_561),
    textureCoordinateRecordCount: z.literal(531_888),
    faceRecordCount: z.literal(474_049),
    groupRecordCount: z.literal(159),
    useMaterialRecordCount: z.literal(159),
  }).passthrough(),
  room9FaceSelection: z.object({
    groupCount: z.literal(43),
    faceCount: z.literal(119_564),
    uniqueVertexCount: z.literal(59_049),
  }).passthrough(),
}).passthrough();

function parseStageManifest(file: StableFileBytes): StageManifest {
  if (
    file.bytes.length !== EXACT_STAGE_MANIFEST_BYTE_LENGTH ||
    file.sha256 !== EXACT_STAGE_MANIFEST_SHA256
  ) throw new GrandHallT554CleanupMarkerEvidenceError(
    "SOURCE_MISMATCH",
    "Capture-stage manifest is not the exact reviewed manifest.",
  );
  try {
    const manifest = StageManifestSchema.parse(parseGrandHallT554StrictJson(file.bytes));
    const uniqueTargets = new Set(manifest.files.map((entry) => entry.targetRelativePath));
    const totalBytes = manifest.files.reduce((total, entry) => total + entry.sizeBytes, 0);
    if (uniqueTargets.size !== manifest.files.length || totalBytes !== manifest.totalBytes) {
      throw new Error("Stage manifest inventory is not unique or internally balanced.");
    }
    return manifest;
  } catch (error) {
    throw new GrandHallT554CleanupMarkerEvidenceError(
      "SOURCE_MISMATCH",
      "Capture-stage manifest is structurally invalid.",
      error,
    );
  }
}

function requireStageEntry(
  manifest: StageManifest,
  relativePath: string,
  byteLength: number,
  sha256: Sha256,
): void {
  const entries = manifest.files.filter((entry) => entry.targetRelativePath === relativePath);
  if (
    entries.length !== 1 ||
    entries[0]?.sizeBytes !== byteLength ||
    `sha256:${entries[0]?.sha256 ?? ""}` !== sha256
  ) throw new GrandHallT554CleanupMarkerEvidenceError(
    "SOURCE_MISMATCH",
    `Capture-stage entry ${relativePath} differs from its pinned identity.`,
  );
}

function parseAndVerifyBoundaryEvidence(file: StableFileBytes): void {
  if (
    file.bytes.length !== EXACT_BOUNDARY_EVIDENCE_BYTE_LENGTH ||
    file.sha256 !== EXACT_BOUNDARY_EVIDENCE_FILE_SHA256
  ) throw new GrandHallT554CleanupMarkerEvidenceError(
    "SOURCE_MISMATCH",
    "Room-9 boundary evidence is not the exact reviewed artifact.",
  );
  try {
    const raw = parseGrandHallT554StrictJson(file.bytes);
    BoundaryProjectionSchema.parse(raw);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new Error("Boundary evidence root must be an object.");
    }
    const { evidenceSha256, ...material } = raw as Record<string, unknown>;
    if (
      evidenceSha256 !== EXACT_BOUNDARY_EVIDENCE_SHA256 ||
      computeGrandHallRoom9EvidenceSha256(toCanonicalJson(material)) !==
        EXACT_BOUNDARY_EVIDENCE_SHA256
    ) throw new Error("Boundary evidence semantic self-digest mismatch.");
  } catch (error) {
    throw new GrandHallT554CleanupMarkerEvidenceError(
      "SOURCE_MISMATCH",
      "Room-9 boundary evidence could not be verified.",
      error,
    );
  }
}

function assertSourceFileIdentity(
  file: StableFileBytes,
  byteLength: number,
  sha256: Sha256,
  label: string,
): void {
  if (file.bytes.length !== byteLength || file.sha256 !== sha256) {
    throw new GrandHallT554CleanupMarkerEvidenceError(
      "SOURCE_MISMATCH",
      `${label} differs from the exact capture-stage identity.`,
    );
  }
}

function assertSameStableRead(
  before: StableFileBytes,
  after: StableFileBytes,
  label: string,
): void {
  if (
    before.sha256 !== after.sha256 ||
    !before.bytes.equals(after.bytes) ||
    !sameFileIdentity(before.stats, after.stats)
  ) throw new GrandHallT554CleanupMarkerEvidenceError(
    "SOURCE_MISMATCH",
    `${label} changed during cleanup-marker evidence generation.`,
  );
}

export interface GenerateGrandHallT554CleanupMarkerEvidenceOptions {
  readonly captureStageRoot: string;
  readonly sourceBoundaryEvidencePath: string;
  readonly outputDirectory: string;
}

export interface GrandHallT554CleanupMarkerBuiltPack {
  readonly evidence: GrandHallT554CleanupMarkerEvidence;
  readonly evidenceBytes: Buffer;
  readonly receipt: GrandHallT554CleanupMarkerReceipt;
  readonly receiptBytes: Buffer;
}

interface CleanupSourcePaths {
  readonly stageManifest: string;
  readonly boundary: string;
  readonly obj: string;
  readonly mtl: string;
  readonly readme: string;
}

interface CleanupSourceFiles {
  readonly stageManifest: StableFileBytes;
  readonly boundary: StableFileBytes;
  readonly obj: StableFileBytes;
  readonly mtl: StableFileBytes;
  readonly readme: StableFileBytes;
}

function cleanupSourcePaths(
  options: GenerateGrandHallT554CleanupMarkerEvidenceOptions,
): CleanupSourcePaths {
  return {
    stageManifest: resolve(options.captureStageRoot, STAGE_MANIFEST_RELATIVE_PATH),
    boundary: options.sourceBoundaryEvidencePath,
    obj: resolve(options.captureStageRoot, OBJ_RELATIVE_PATH),
    mtl: resolve(options.captureStageRoot, MTL_RELATIVE_PATH),
    readme: resolve(options.captureStageRoot, README_RELATIVE_PATH),
  };
}

async function readCleanupSourceFiles(paths: CleanupSourcePaths): Promise<CleanupSourceFiles> {
  const [stageManifest, boundary, obj, mtl, readme] = await Promise.all([
    readStableDirectFile(
      paths.stageManifest,
      MAX_STAGE_MANIFEST_BYTES,
      "Capture-stage manifest",
    ),
    readStableDirectFile(
      paths.boundary,
      MAX_BOUNDARY_EVIDENCE_BYTES,
      "Room-9 source-boundary evidence",
    ),
    readStableDirectFile(paths.obj, MAX_OBJ_BYTES, "MatterPak OBJ"),
    readStableDirectFile(paths.mtl, MAX_MTL_BYTES, "MatterPak MTL"),
    readStableDirectFile(paths.readme, MAX_README_BYTES, "MatterPak README"),
  ]);
  return { stageManifest, boundary, obj, mtl, readme };
}

function verifyCleanupSourceFiles(
  files: CleanupSourceFiles,
): GrandHallT554CleanupMarkerObjAnalysis {
  const stageManifest = parseStageManifest(files.stageManifest);
  parseAndVerifyBoundaryEvidence(files.boundary);
  requireStageEntry(stageManifest, OBJ_RELATIVE_PATH, OBJ_BYTE_LENGTH, OBJ_SHA256);
  requireStageEntry(stageManifest, MTL_RELATIVE_PATH, MTL_BYTE_LENGTH, MTL_SHA256);
  requireStageEntry(stageManifest, README_RELATIVE_PATH, README_BYTE_LENGTH, README_SHA256);
  requireStageEntry(
    stageManifest,
    POINT_CLOUD_RELATIVE_PATH,
    POINT_CLOUD_BYTE_LENGTH,
    POINT_CLOUD_SHA256,
  );
  assertSourceFileIdentity(files.obj, OBJ_BYTE_LENGTH, OBJ_SHA256, "MatterPak OBJ");
  assertSourceFileIdentity(files.mtl, MTL_BYTE_LENGTH, MTL_SHA256, "MatterPak MTL");
  assertSourceFileIdentity(files.readme, README_BYTE_LENGTH, README_SHA256, "MatterPak README");
  const analysis = analyzeGrandHallT554CleanupMarkerObj(
    decodeUtf8(files.obj.bytes, "MatterPak OBJ"),
  );
  assertExactGrandHallT554CleanupMarkerAnalysis(analysis);
  decodeUtf8(files.mtl.bytes, "MatterPak MTL");
  return analysis;
}

function cleanupSourceBindings(): GrandHallT554CleanupMarkerEvidenceMaterial["sourceBindings"] {
  return {
    captureStageManifest: {
      sourceLocator: "CAPTURE_STAGE_ROOT/capture-stage-manifest.json",
      byteLength: EXACT_STAGE_MANIFEST_BYTE_LENGTH,
      sha256: EXACT_STAGE_MANIFEST_SHA256,
      schemaVersion: EXACT_STAGE_MANIFEST_SCHEMA,
      planSha256: EXACT_STAGE_PLAN_SHA256,
      fileCount: EXACT_STAGE_FILE_COUNT,
      totalBytes: EXACT_STAGE_TOTAL_BYTES,
      sourceBytesReadThisRun: true,
    },
    room9SourceBoundaryEvidence: {
      sourceLocator:
        "REPOSITORY/docs/operations/grand-hall-room9-source-boundary-evidence-v1.json",
      byteLength: EXACT_BOUNDARY_EVIDENCE_BYTE_LENGTH,
      serializedFileSha256: EXACT_BOUNDARY_EVIDENCE_FILE_SHA256,
      evidenceSha256: EXACT_BOUNDARY_EVIDENCE_SHA256,
      sourceBytesReadThisRun: true,
    },
    obj: sourceFileBinding(OBJ_RELATIVE_PATH, OBJ_BYTE_LENGTH, OBJ_SHA256),
    mtl: sourceFileBinding(MTL_RELATIVE_PATH, MTL_BYTE_LENGTH, MTL_SHA256),
    matterpakReadme: sourceFileBinding(
      README_RELATIVE_PATH,
      README_BYTE_LENGTH,
      README_SHA256,
    ),
    pointCloud: {
      sourceLocator: `CAPTURE_STAGE_ROOT/${POINT_CLOUD_RELATIVE_PATH}`,
      byteLength: POINT_CLOUD_BYTE_LENGTH,
      sha256: POINT_CLOUD_SHA256,
      bindingBasis: "exact_capture_stage_manifest_entry",
      sourceBytesReadThisRun: false,
      usedForLocalization: false,
    },
  };
}

function sourceFileBinding<
  const RelativePath extends string,
  const ByteLength extends number,
  const Digest extends Sha256,
>(
  relativePath: RelativePath,
  byteLength: ByteLength,
  sha256: Digest,
): {
  readonly sourceLocator: `CAPTURE_STAGE_ROOT/${RelativePath}`;
  readonly byteLength: ByteLength;
  readonly sha256: Digest;
  readonly sourceBytesReadThisRun: true;
} {
  return {
    sourceLocator: `CAPTURE_STAGE_ROOT/${relativePath}`,
    byteLength,
    sha256,
    sourceBytesReadThisRun: true,
  };
}

function cleanupClassEvidence(
  analysis: GrandHallT554CleanupMarkerObjAnalysis,
): GrandHallT554CleanupMarkerEvidenceMaterial["classEvidence"] {
  return [
    {
      artifactClass: "Window",
      localizationState: GRAND_HALL_T554_WINDOW_LOCALIZATION_STATE,
      sourceLiteralGroupMatchRule: "case_sensitive_window_prefix",
      literalNamedGroupCount: 0,
      localizedTargetIds: [],
      absenceOfMarkerEffectClaimed: false,
      completenessScope: "literal_obj_group_names_only",
      nativeSourceReviewCompleted: false,
      humanReviewRequired: true,
    },
    {
      artifactClass: "Mirror",
      localizationState: GRAND_HALL_T554_MIRROR_LOCALIZATION_STATE,
      sourceLiteralGroupMatchRule: "case_sensitive_mirror_prefix",
      literalNamedGroupCount: 5,
      localizedTargetIds: analysis.explicitCleanupTargets.map((target) => target.targetId),
      absenceOfMarkerEffectClaimed: false,
      completenessScope:
        "every_obj_group_name_matching_exact_literal_mirror_prefix_in_bound_obj",
      nativeSourceReviewCompleted: false,
      humanReviewRequired: true,
    },
  ];
}

function cleanupEvidenceMaterial(
  analysis: GrandHallT554CleanupMarkerObjAnalysis,
): GrandHallT554CleanupMarkerEvidenceMaterial {
  return GrandHallT554CleanupMarkerEvidenceMaterialSchema.parse({
    schemaVersion: GRAND_HALL_T554_CLEANUP_MARKER_EVIDENCE_SCHEMA,
    subject: {
      venueId: "trades-hall",
      roomId: "grand-hall",
      taskId: "T-554",
      scope: "source_explicit_cleanup_marker_localization_only",
      selectedMatterpakRoomKey: {
        groupIndex: 1,
        subIndex: 9,
        exactObjGroupSuffix: "_group001_sub009",
      },
    },
    authority: "none",
    reviewState: "machine_inventory_complete_human_pending",
    sourceBindings: cleanupSourceBindings(),
    vendorMarkerSemantics: {
      evidenceBasis:
        "human_reviewed_paraphrase_of_exact_hash_bound_matterpak_readme",
      referencedPagesOneBased: [2, 4],
      objMarkerEffect:
        "Window and Mirror markers may add triangular closure walls and remove mesh behind the marker line.",
      pointCloudMarkerEffect:
        "The XYZ export has points removed behind marker classes and does not contain the OBJ closure-wall triangles.",
      perMarkerManifestPresentInBoundEvidence: false,
      objGroupNamingGuaranteePresentInBoundEvidence: false,
      architecturalAuthority: "none",
    },
    objInventory: analysis.objInventory,
    targetIdRule: "matterpak-obj-group:<exact-source-group-name>",
    explicitCleanupTargets: analysis.explicitCleanupTargets,
    cleanupTargetInventorySha256: analysis.cleanupTargetInventorySha256,
    classEvidence: cleanupClassEvidence(analysis),
    guards: FIXED_GUARDS,
    limitations: LIMITATIONS,
  });
}

function builtCleanupPack(
  material: GrandHallT554CleanupMarkerEvidenceMaterial,
): GrandHallT554CleanupMarkerBuiltPack {
  const evidence = sealGrandHallT554CleanupMarkerEvidence(material);
  const evidenceBytes = serializeGrandHallT554CleanupMarkerEvidence(evidence);
  const receipt = buildGrandHallT554CleanupMarkerReceipt(evidence, evidenceBytes);
  const receiptBytes = serializeGrandHallT554CleanupMarkerReceipt(receipt);
  return { evidence, evidenceBytes, receipt, receiptBytes };
}

function assertCleanupSourceReadsStable(
  before: CleanupSourceFiles,
  after: CleanupSourceFiles,
): void {
  const pairs = [
    [before.stageManifest, after.stageManifest],
    [before.boundary, after.boundary],
    [before.obj, after.obj],
    [before.mtl, after.mtl],
    [before.readme, after.readme],
  ] as const;
  for (const [initial, final] of pairs) {
    assertSameStableRead(initial, final, basename(initial.absolutePath));
  }
}

export async function buildGrandHallT554CleanupMarkerEvidencePack(
  options: GenerateGrandHallT554CleanupMarkerEvidenceOptions,
): Promise<GrandHallT554CleanupMarkerBuiltPack> {
  const paths = cleanupSourcePaths(options);
  const initialFiles = await readCleanupSourceFiles(paths);
  const analysis = verifyCleanupSourceFiles(initialFiles);
  const built = builtCleanupPack(cleanupEvidenceMaterial(analysis));
  const finalFiles = await readCleanupSourceFiles(paths);
  assertCleanupSourceReadsStable(initialFiles, finalFiles);
  return built;
}

interface GrandHallT554CleanupMarkerEvidencePackSummary {
  readonly outputDirectory: string;
  readonly evidenceSha256: Sha256;
  readonly cleanupTargetInventorySha256: Sha256;
  readonly receiptSha256: Sha256;
  readonly evidenceFileSha256: Sha256;
  readonly receiptFileSha256: Sha256;
  readonly explicitCleanupTargetCount: 5;
  readonly windowLocalizedTargetCount: 0;
  readonly mirrorLocalizedTargetCount: 5;
  readonly windowLocalizationState: typeof GRAND_HALL_T554_WINDOW_LOCALIZATION_STATE;
  readonly mirrorLocalizationState: typeof GRAND_HALL_T554_MIRROR_LOCALIZATION_STATE;
  readonly outputFileCount: 2;
  readonly authority: "none";
  readonly cleanupApplied: false;
  readonly sourceFacesRemoved: false;
}

export interface StructurallyInspectedGrandHallT554CleanupMarkerEvidencePack
  extends GrandHallT554CleanupMarkerEvidencePackSummary {
  readonly sourceVerificationState: "not_checked_structural_only";
}

export interface ExactSourceBuiltGrandHallT554CleanupMarkerEvidencePack
  extends GrandHallT554CleanupMarkerEvidencePackSummary {
  readonly sourceVerificationState: "exact_source_build_verified";
}

export interface ExactSourceRegeneratedGrandHallT554CleanupMarkerEvidencePack
  extends GrandHallT554CleanupMarkerEvidencePackSummary {
  readonly sourceVerificationState: "exact_source_regeneration_verified";
  readonly exactRegenerationVerified: true;
}

async function readStableOutput(
  path: string,
  maximumBytes: number,
): Promise<StableFileBytes> {
  try {
    return await readStableDirectFile(path, maximumBytes, `Output ${basename(path)}`);
  } catch (error) {
    throw new GrandHallT554CleanupMarkerEvidenceError(
      "OUTPUT_VERIFICATION_FAILED",
      `Output ${basename(path)} is not a stable direct file.`,
      error,
    );
  }
}

interface OutputDirectorySnapshot {
  readonly stats: BigIntStats;
  readonly entries: readonly OutputEntrySnapshot[];
}

interface OutputEntrySnapshot {
  readonly name: string;
  readonly stats: BigIntStats;
}

interface InspectPersistedPackTestSeam {
  readonly afterInitialDirectorySnapshot?: () => Promise<void> | void;
  readonly afterOutputReads?: () => Promise<void> | void;
}

function sameNodeIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

async function snapshotDirectOutputDirectory(
  outputDirectory: string,
): Promise<OutputDirectorySnapshot> {
  try {
    const before = await lstat(outputDirectory, { bigint: true });
    const canonical = await realpath(outputDirectory);
    if (
      !before.isDirectory() ||
      before.isSymbolicLink() ||
      comparablePath(canonical) !== comparablePath(outputDirectory)
    ) throw new Error("Output directory must be one direct regular directory.");
    const directoryEntries = await readdir(outputDirectory, { withFileTypes: true });
    const entries = await Promise.all(directoryEntries.map(async (entry) => {
      const path = resolve(outputDirectory, entry.name);
      const stats = await lstat(path, { bigint: true });
      const canonicalEntry = await realpath(path);
      if (
        !entry.isFile() ||
        entry.isSymbolicLink() ||
        !stats.isFile() ||
        stats.isSymbolicLink() ||
        stats.nlink !== 1n ||
        comparablePath(canonicalEntry) !== comparablePath(path)
      ) throw new Error("Output inventory contains a non-direct regular file.");
      return { name: entry.name, stats };
    }));
    const after = await lstat(outputDirectory, { bigint: true });
    if (!sameFileIdentity(before, after) || after.isSymbolicLink()) {
      throw new Error("Output directory changed during inventory inspection.");
    }
    return {
      stats: after,
      entries: entries.sort((left, right) => lexicalOrder(left.name, right.name)),
    };
  } catch (error) {
    throw new GrandHallT554CleanupMarkerEvidenceError(
      "OUTPUT_VERIFICATION_FAILED",
      "Cleanup-marker output directory is not a stable direct directory.",
      error,
    );
  }
}

function assertExactOutputNames(entries: readonly OutputEntrySnapshot[]): void {
  const expectedNames = [
    GRAND_HALL_T554_CLEANUP_MARKER_EVIDENCE_FILENAME,
    GRAND_HALL_T554_CLEANUP_MARKER_RECEIPT_FILENAME,
  ].sort(lexicalOrder);
  const names = entries.map((entry) => entry.name);
  if (names.join("\n") !== expectedNames.join("\n")) {
    throw new GrandHallT554CleanupMarkerEvidenceError(
      "OUTPUT_VERIFICATION_FAILED",
      "Cleanup-marker output inventory must contain exactly two flat files.",
    );
  }
}

function assertStableOutputSnapshots(
  before: OutputDirectorySnapshot,
  after: OutputDirectorySnapshot,
): void {
  const entriesStable = before.entries.length === after.entries.length &&
    before.entries.every((entry, index) => {
      const finalEntry = after.entries[index];
      return finalEntry !== undefined && entry.name === finalEntry.name &&
        sameFileIdentity(entry.stats, finalEntry.stats);
    });
  if (
    !sameFileIdentity(before.stats, after.stats) ||
    !entriesStable
  ) throw new GrandHallT554CleanupMarkerEvidenceError(
    "OUTPUT_VERIFICATION_FAILED",
    "Cleanup-marker output directory changed during persisted inspection.",
  );
}

function assertReadBoundToOutputSnapshots(
  file: StableFileBytes,
  name: string,
  before: OutputDirectorySnapshot,
  after: OutputDirectorySnapshot,
): void {
  const initial = before.entries.find((entry) => entry.name === name);
  const final = after.entries.find((entry) => entry.name === name);
  if (
    initial === undefined ||
    final === undefined ||
    !sameFileIdentity(initial.stats, file.stats) ||
    !sameFileIdentity(final.stats, file.stats)
  ) throw new GrandHallT554CleanupMarkerEvidenceError(
    "OUTPUT_VERIFICATION_FAILED",
    `${name} did not retain one identity across inventory and content reads.`,
  );
}

async function inspectPersistedPack(
  outputDirectory: string,
  testSeam: InspectPersistedPackTestSeam = {},
): Promise<StructurallyInspectedGrandHallT554CleanupMarkerEvidencePack> {
  const initialSnapshot = await snapshotDirectOutputDirectory(outputDirectory);
  assertExactOutputNames(initialSnapshot.entries);
  await testSeam.afterInitialDirectorySnapshot?.();
  const [evidenceFile, receiptFile] = await Promise.all([
    readStableOutput(
      resolve(outputDirectory, GRAND_HALL_T554_CLEANUP_MARKER_EVIDENCE_FILENAME),
      MAX_EVIDENCE_BYTES,
    ),
    readStableOutput(
      resolve(outputDirectory, GRAND_HALL_T554_CLEANUP_MARKER_RECEIPT_FILENAME),
      MAX_RECEIPT_BYTES,
    ),
  ]);
  await testSeam.afterOutputReads?.();
  const finalSnapshot = await snapshotDirectOutputDirectory(outputDirectory);
  assertExactOutputNames(finalSnapshot.entries);
  assertStableOutputSnapshots(initialSnapshot, finalSnapshot);
  assertReadBoundToOutputSnapshots(
    evidenceFile,
    GRAND_HALL_T554_CLEANUP_MARKER_EVIDENCE_FILENAME,
    initialSnapshot,
    finalSnapshot,
  );
  assertReadBoundToOutputSnapshots(
    receiptFile,
    GRAND_HALL_T554_CLEANUP_MARKER_RECEIPT_FILENAME,
    initialSnapshot,
    finalSnapshot,
  );
  const evidence = parseGrandHallT554CleanupMarkerEvidence(evidenceFile.bytes);
  const receipt = parseGrandHallT554CleanupMarkerReceipt(receiptFile.bytes);
  assertReceiptBindsEvidence(receipt, evidence, evidenceFile);
  return persistedPackSummary(outputDirectory, evidence, receipt, evidenceFile, receiptFile);
}

function assertReceiptBindsEvidence(
  receipt: GrandHallT554CleanupMarkerReceipt,
  evidence: GrandHallT554CleanupMarkerEvidence,
  evidenceFile: StableFileBytes,
): void {
  if (
    receipt.evidenceSha256 !== evidence.evidenceSha256 ||
    receipt.cleanupTargetInventorySha256 !== evidence.cleanupTargetInventorySha256 ||
    receipt.payload.byteLength !== evidenceFile.bytes.length ||
    receipt.payload.sha256 !== evidenceFile.sha256 ||
    receipt.explicitCleanupTargetCount !== evidence.explicitCleanupTargets.length ||
    receipt.mirrorLocalizedTargetCount !== evidence.classEvidence[1].localizedTargetIds.length
  ) throw new GrandHallT554CleanupMarkerEvidenceError(
    "OUTPUT_VERIFICATION_FAILED",
    "Cleanup-marker receipt does not exactly bind its evidence payload.",
  );
}

function persistedPackSummary(
  outputDirectory: string,
  evidence: GrandHallT554CleanupMarkerEvidence,
  receipt: GrandHallT554CleanupMarkerReceipt,
  evidenceFile: StableFileBytes,
  receiptFile: StableFileBytes,
): StructurallyInspectedGrandHallT554CleanupMarkerEvidencePack {
  return {
    outputDirectory,
    evidenceSha256: evidence.evidenceSha256,
    cleanupTargetInventorySha256: evidence.cleanupTargetInventorySha256,
    receiptSha256: receipt.receiptSha256,
    evidenceFileSha256: evidenceFile.sha256,
    receiptFileSha256: receiptFile.sha256,
    explicitCleanupTargetCount: 5,
    windowLocalizedTargetCount: 0,
    mirrorLocalizedTargetCount: 5,
    windowLocalizationState: GRAND_HALL_T554_WINDOW_LOCALIZATION_STATE,
    mirrorLocalizationState: GRAND_HALL_T554_MIRROR_LOCALIZATION_STATE,
    outputFileCount: 2,
    authority: "none",
    cleanupApplied: false,
    sourceFacesRemoved: false,
    sourceVerificationState: "not_checked_structural_only",
  };
}

function assertBoundaryEvidenceOutsideOutput(
  boundaryEvidencePath: string,
  outputDirectory: string,
): void {
  const input = comparablePath(boundaryEvidencePath);
  const output = comparablePath(outputDirectory);
  if (input === output || input.startsWith(`${output}\\`) || output.startsWith(`${input}\\`)) {
    throw new GrandHallT554CleanupMarkerEvidenceError(
      "OUTPUT_UNSAFE",
      "Cleanup-marker output and source-boundary evidence must be disjoint.",
    );
  }
}

interface PublishPackTestSeam {
  readonly beforeOutputReservation?: () => Promise<void> | void;
  readonly afterOutputReservation?: (outputDirectory: string) => Promise<void> | void;
  readonly beforeReceiptWrite?: (outputDirectory: string) => Promise<void> | void;
  readonly beforeInspection?: (outputDirectory: string) => Promise<void> | void;
}

async function stableDirectDirectoryStats(path: string, label: string): Promise<BigIntStats> {
  const before = await lstat(path, { bigint: true });
  const canonical = await realpath(path);
  const after = await lstat(path, { bigint: true });
  if (
    !before.isDirectory() ||
    before.isSymbolicLink() ||
    comparablePath(canonical) !== comparablePath(path) ||
    !sameFileIdentity(before, after)
  ) throw new GrandHallT554CleanupMarkerEvidenceError(
    "OUTPUT_UNSAFE",
    `${label} is not a stable direct directory.`,
  );
  return after;
}

async function assertOwnedDirectoryIdentity(
  path: string,
  expected: BigIntStats,
  label: string,
): Promise<void> {
  const current = await stableDirectDirectoryStats(path, label);
  if (!sameNodeIdentity(current, expected)) {
    throw new GrandHallT554CleanupMarkerEvidenceError(
      "OUTPUT_UNSAFE",
      `${label} identity changed during publication.`,
    );
  }
}

async function writeExclusiveSyncedFile(path: string, bytes: Buffer): Promise<void> {
  const handle = await open(path, "wx");
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function publicationError(error: unknown): GrandHallT554CleanupMarkerEvidenceError {
  if (error instanceof GrandHallT554CleanupMarkerEvidenceError) return error;
  return new GrandHallT554CleanupMarkerEvidenceError(
    "OUTPUT_PUBLISH_FAILED",
    "Cleanup-marker evidence pack could not be published without replacement.",
    error,
  );
}

function assertPublishedPackMatchesBuilt(
  inspected: StructurallyInspectedGrandHallT554CleanupMarkerEvidencePack,
  built: GrandHallT554CleanupMarkerBuiltPack,
): void {
  const evidenceFileSha256 =
    `sha256:${createHash("sha256").update(built.evidenceBytes).digest("hex")}`;
  const receiptFileSha256 =
    `sha256:${createHash("sha256").update(built.receiptBytes).digest("hex")}`;
  if (
    inspected.evidenceSha256 !== built.evidence.evidenceSha256 ||
    inspected.receiptSha256 !== built.receipt.receiptSha256 ||
    inspected.evidenceFileSha256 !== evidenceFileSha256 ||
    inspected.receiptFileSha256 !== receiptFileSha256
  ) throw new GrandHallT554CleanupMarkerEvidenceError(
    "OUTPUT_VERIFICATION_FAILED",
    "Published cleanup-marker files differ from the exact bytes built for this run.",
  );
}

interface PublicationContext {
  readonly parentStats: BigIntStats;
  reservedOutputCreated: boolean;
  outputStats: BigIntStats | undefined;
}

async function reserveOwnedOutputDirectory(
  outputDirectory: string,
  outputParent: string,
  context: PublicationContext,
  testSeam: PublishPackTestSeam,
): Promise<BigIntStats> {
  await testSeam.beforeOutputReservation?.();
  await mkdir(outputDirectory, { recursive: false });
  context.reservedOutputCreated = true;
  context.outputStats = await stableDirectDirectoryStats(
    outputDirectory,
    "Reserved output directory",
  );
  const parentAfterReservation = await stableDirectDirectoryStats(outputParent, "Output parent");
  if (!sameNodeIdentity(context.parentStats, parentAfterReservation)) {
    throw new GrandHallT554CleanupMarkerEvidenceError(
      "OUTPUT_UNSAFE",
      "Output parent identity changed during reservation.",
    );
  }
  return context.outputStats;
}

async function publishOwnedOutputFiles(
  outputDirectory: string,
  outputParent: string,
  outputStats: BigIntStats,
  context: PublicationContext,
  built: GrandHallT554CleanupMarkerBuiltPack,
  testSeam: PublishPackTestSeam,
): Promise<void> {
  await assertOwnedDirectoryIdentity(outputDirectory, outputStats, "Reserved output directory");
  await writeExclusiveSyncedFile(
    resolve(outputDirectory, GRAND_HALL_T554_CLEANUP_MARKER_EVIDENCE_FILENAME),
    built.evidenceBytes,
  );
  await assertOwnedDirectoryIdentity(outputDirectory, outputStats, "Reserved output directory");
  await testSeam.beforeReceiptWrite?.(outputDirectory);
  await writeExclusiveSyncedFile(
    resolve(outputDirectory, GRAND_HALL_T554_CLEANUP_MARKER_RECEIPT_FILENAME),
    built.receiptBytes,
  );
  await assertOwnedDirectoryIdentity(outputDirectory, outputStats, "Reserved output directory");
  await assertOwnedDirectoryIdentity(outputParent, context.parentStats, "Output parent");
}

async function publishPack(
  outputDirectory: string,
  outputParent: string,
  built: GrandHallT554CleanupMarkerBuiltPack,
  testSeam: PublishPackTestSeam = {},
): Promise<StructurallyInspectedGrandHallT554CleanupMarkerEvidencePack> {
  const context: PublicationContext = {
    parentStats: await stableDirectDirectoryStats(outputParent, "Output parent"),
    reservedOutputCreated: false,
    outputStats: undefined,
  };
  try {
    const outputStats = await reserveOwnedOutputDirectory(
      outputDirectory,
      outputParent,
      context,
      testSeam,
    );
    await testSeam.afterOutputReservation?.(outputDirectory);
    await publishOwnedOutputFiles(
      outputDirectory,
      outputParent,
      outputStats,
      context,
      built,
      testSeam,
    );
    await testSeam.beforeInspection?.(outputDirectory);
    const inspected = await inspectPersistedPack(outputDirectory);
    await assertOwnedDirectoryIdentity(
      outputDirectory,
      outputStats,
      "Reserved output directory",
    );
    assertPublishedPackMatchesBuilt(inspected, built);
    return inspected;
  } catch (error) {
    if (context.reservedOutputCreated) throw new GrandHallT554CleanupMarkerEvidenceError(
      "OUTPUT_UNSAFE",
      `Publication failed after reservation; ${outputDirectory} was quarantined without automated deletion.`,
      error,
    );
    throw publicationError(error);
  }
}

export async function generateGrandHallT554CleanupMarkerEvidencePack(
  options: GenerateGrandHallT554CleanupMarkerEvidenceOptions,
): Promise<ExactSourceBuiltGrandHallT554CleanupMarkerEvidencePack> {
  assertBoundaryEvidenceOutsideOutput(
    options.sourceBoundaryEvidencePath,
    options.outputDirectory,
  );
  const safety = await assertGrandHallT554ReviewOutputSafety({
    sourceRoots: [options.captureStageRoot, dirname(options.sourceBoundaryEvidencePath)],
    outputDirectory: options.outputDirectory,
  });
  const built = await buildGrandHallT554CleanupMarkerEvidencePack(options);
  const inspected = await publishPack(safety.outputDirectory, safety.outputParent, built);
  return { ...inspected, sourceVerificationState: "exact_source_build_verified" };
}

export async function inspectPersistedGrandHallT554CleanupMarkerEvidencePackStructure(
  outputDirectory: string,
): Promise<StructurallyInspectedGrandHallT554CleanupMarkerEvidencePack> {
  const safety = await assertGrandHallT554ExistingReviewOutputSafety({
    sourceRoots: [],
    outputDirectory,
  });
  return await inspectPersistedPack(safety.outputDirectory);
}

export async function checkGrandHallT554CleanupMarkerEvidencePack(
  options: GenerateGrandHallT554CleanupMarkerEvidenceOptions,
): Promise<ExactSourceRegeneratedGrandHallT554CleanupMarkerEvidencePack> {
  assertBoundaryEvidenceOutsideOutput(
    options.sourceBoundaryEvidencePath,
    options.outputDirectory,
  );
  const safety = await assertGrandHallT554ExistingReviewOutputSafety({
    sourceRoots: [options.captureStageRoot, dirname(options.sourceBoundaryEvidencePath)],
    outputDirectory: options.outputDirectory,
  });
  const outputStats = await stableDirectDirectoryStats(
    safety.outputDirectory,
    "Checked output directory",
  );
  const before = await inspectPersistedPack(safety.outputDirectory);
  const built = await buildGrandHallT554CleanupMarkerEvidencePack(options);
  const after = await inspectPersistedPack(safety.outputDirectory);
  await assertOwnedDirectoryIdentity(
    safety.outputDirectory,
    outputStats,
    "Checked output directory",
  );
  assertPublishedPackMatchesBuilt(after, built);
  if (
    before.evidenceSha256 !== after.evidenceSha256 ||
    before.receiptSha256 !== after.receiptSha256 ||
    before.evidenceFileSha256 !== after.evidenceFileSha256 ||
    before.receiptFileSha256 !== after.receiptFileSha256
  ) throw new GrandHallT554CleanupMarkerEvidenceError(
    "OUTPUT_VERIFICATION_FAILED",
    "Cleanup-marker evidence output changed during independent check.",
  );
  return {
    ...after,
    sourceVerificationState: "exact_source_regeneration_verified",
    exactRegenerationVerified: true,
  };
}

/**
 * Test-only structural publisher. It is intentionally excluded from the package root.
 * It never claims that source bytes were inspected or regenerated.
 */
export async function __testOnlyPublishGrandHallT554CleanupMarkerEvidencePackStructure(
  options: GenerateGrandHallT554CleanupMarkerEvidenceOptions,
  built: GrandHallT554CleanupMarkerBuiltPack,
  testSeam: PublishPackTestSeam = {},
): Promise<StructurallyInspectedGrandHallT554CleanupMarkerEvidencePack> {
  assertBoundaryEvidenceOutsideOutput(
    options.sourceBoundaryEvidencePath,
    options.outputDirectory,
  );
  const safety = await assertGrandHallT554ReviewOutputSafety({
    sourceRoots: [options.captureStageRoot, dirname(options.sourceBoundaryEvidencePath)],
    outputDirectory: options.outputDirectory,
  });
  return await publishPack(safety.outputDirectory, safety.outputParent, built, testSeam);
}

/** Test-only race seam for structural persisted-pack inspection. */
export async function __testOnlyInspectGrandHallT554CleanupMarkerEvidencePackStructure(
  outputDirectory: string,
  testSeam: InspectPersistedPackTestSeam,
): Promise<StructurallyInspectedGrandHallT554CleanupMarkerEvidencePack> {
  const safety = await assertGrandHallT554ExistingReviewOutputSafety({
    sourceRoots: [],
    outputDirectory,
  });
  return await inspectPersistedPack(safety.outputDirectory, testSeam);
}
