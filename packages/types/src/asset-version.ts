import { z } from "zod";
import {
  RuntimeTransformAlignmentMethodSchema,
  RuntimeTransformFrameSchema,
  RuntimeManifestKeySchema,
  RuntimeTransformProvenanceStateSchema,
  TransformArtifactV0Schema,
  type RuntimeTransformAlignmentMethod,
  type RuntimeTransformReferenceType,
} from "./runtime-venue-manifest.js";

// ---------------------------------------------------------------------------
// Room-agnostic runtime asset registry contracts
//
// These schemas describe storage/provenance records only. They do not make
// public product claims. A runtime package is loadable only when the package
// is internally/published loadable and every explicitly declared visual
// AssetVersion is marked `usable`. Legacy manifests declare only the primary;
// the browser still validates the complete resolved URL set before Spark.
// ---------------------------------------------------------------------------

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T/;
const MAX_RUNTIME_VISUAL_ASSET_COUNT = 1_024;

export const RUNTIME_PACKAGE_REVISION_IDENTITY_KINDS = [
  "legacy",
  "content_sha256",
] as const;
export const RuntimePackageRevisionIdentityKindSchema = z.enum(
  RUNTIME_PACKAGE_REVISION_IDENTITY_KINDS,
);
export type RuntimePackageRevisionIdentityKind = z.infer<
  typeof RuntimePackageRevisionIdentityKindSchema
>;

export const RuntimePackageContentDigestSchema = z.string().regex(
  SHA256_HEX,
  "Runtime package content digest must be a lowercase SHA-256 hex string.",
);
export type RuntimePackageContentDigest = z.infer<typeof RuntimePackageContentDigestSchema>;

export const RuntimeSlugSchema = z.string().trim().min(1).max(100).regex(
  SLUG_PATTERN,
  "Slug must be lowercase kebab-case.",
);
export type RuntimeSlug = z.infer<typeof RuntimeSlugSchema>;

export const CAPTURE_SOURCE_TYPES = ["matterport", "xgrids_portalcam", "runpod", "manual", "other"] as const;
export const CaptureSourceTypeSchema = z.enum(CAPTURE_SOURCE_TYPES);
export type CaptureSourceType = z.infer<typeof CaptureSourceTypeSchema>;

export const ASSET_SOURCE_TYPES = ["xgrids", "runpod", "matterport", "manual", "other"] as const;
export const AssetSourceTypeSchema = z.enum(ASSET_SOURCE_TYPES);
export type AssetSourceType = z.infer<typeof AssetSourceTypeSchema>;

export const CAPTURE_SESSION_STATUSES = ["captured", "uploaded", "processing", "processed", "failed", "archived"] as const;
export const CaptureSessionStatusSchema = z.enum(CAPTURE_SESSION_STATUSES);
export type CaptureSessionStatus = z.infer<typeof CaptureSessionStatusSchema>;

export const ASSET_KINDS = ["splat", "mesh", "point_cloud", "image_set", "video", "manifest", "preview", "other"] as const;
export const AssetKindSchema = z.enum(ASSET_KINDS);
export type AssetKind = z.infer<typeof AssetKindSchema>;

export const ASSET_EVIDENCE_STATUSES = ["unverified", "machine_checked", "human_reviewed", "rejected"] as const;
export const AssetEvidenceStatusSchema = z.enum(ASSET_EVIDENCE_STATUSES);
export type AssetEvidenceStatus = z.infer<typeof AssetEvidenceStatusSchema>;

export const ASSET_RUNTIME_STATUSES = ["staged", "usable", "rejected", "archived"] as const;
export const AssetRuntimeStatusSchema = z.enum(ASSET_RUNTIME_STATUSES);
export type AssetRuntimeStatus = z.infer<typeof AssetRuntimeStatusSchema>;

export const RUNTIME_PACKAGE_STATUSES = ["draft", "internal_ready", "published", "archived"] as const;
export const RuntimePackageStatusSchema = z.enum(RUNTIME_PACKAGE_STATUSES);
export type RuntimePackageStatus = z.infer<typeof RuntimePackageStatusSchema>;

export const SIGNED_RUNTIME_TRANSFORM_ALIGNMENT_METHODS = [
  "manual_alignment",
  "icp",
  "landmark_solve",
  "matterport_e57_extraction",
  "blender_authored_placement",
  "known_pose_colmap",
] as const satisfies readonly RuntimeTransformAlignmentMethod[];
export type SignedRuntimeTransformAlignmentMethod = (typeof SIGNED_RUNTIME_TRANSFORM_ALIGNMENT_METHODS)[number];

export const SIGNED_RUNTIME_TRANSFORM_EVIDENCE_REF_TYPES = [
  "control_network",
  "landmark_set",
  "artifact",
] as const satisfies readonly RuntimeTransformReferenceType[];
export type SignedRuntimeTransformEvidenceRefType = (typeof SIGNED_RUNTIME_TRANSFORM_EVIDENCE_REF_TYPES)[number];

const signedRuntimeTransformAlignmentMethods = new Set<RuntimeTransformAlignmentMethod>(
  SIGNED_RUNTIME_TRANSFORM_ALIGNMENT_METHODS,
);
const signedRuntimeTransformEvidenceRefTypes = new Set<RuntimeTransformReferenceType>(
  SIGNED_RUNTIME_TRANSFORM_EVIDENCE_REF_TYPES,
);

// Backward-compatible export for older local call sites while this foundation
// lands. New code should use AssetRuntimeStatusSchema or RuntimePackageStatusSchema.
export const RUNTIME_STATUSES = ASSET_RUNTIME_STATUSES;
export const RuntimeStatusSchema = AssetRuntimeStatusSchema;
export type RuntimeStatus = AssetRuntimeStatus;

export const ROOM_ALIGNMENT_STATUSES = ["unaligned", "approximate", "aligned", "verified"] as const;
export const RoomAlignmentStatusSchema = z.enum(ROOM_ALIGNMENT_STATUSES);
export type RoomAlignmentStatus = z.infer<typeof RoomAlignmentStatusSchema>;

export const RUNTIME_SPLAT_EXTENSIONS = [".ply", ".spz", ".splat", ".ksplat", ".sog", ".rad", ".radc"] as const;
export type RuntimeSplatExtension = (typeof RUNTIME_SPLAT_EXTENSIONS)[number];

export const RUNTIME_FILE_EXTENSIONS = [
  ".ply",
  ".spz",
  ".splat",
  ".ksplat",
  ".sog",
  ".rad",
  ".radc",
  ".glb",
  ".gltf",
  ".obj",
  ".e57",
  ".las",
  ".laz",
  ".zip",
  ".json",
  ".lcc2",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".mp4",
  ".mov",
] as const;
export const RuntimeFileExtensionSchema = z.enum(RUNTIME_FILE_EXTENSIONS);
export type RuntimeFileExtension = z.infer<typeof RuntimeFileExtensionSchema>;

const ASSET_KIND_EXTENSIONS: Readonly<Record<AssetKind, readonly RuntimeFileExtension[]>> = {
  splat: RUNTIME_SPLAT_EXTENSIONS,
  mesh: [".glb", ".gltf", ".obj"],
  point_cloud: [".ply", ".e57", ".las", ".laz"],
  image_set: [".zip", ".json", ".jpg", ".jpeg", ".png", ".webp"],
  video: [".mp4", ".mov"],
  manifest: [".json", ".lcc2"],
  preview: [".jpg", ".jpeg", ".png", ".webp", ".mp4", ".mov"],
  other: RUNTIME_FILE_EXTENSIONS,
};

export const TRADES_HALL_VENUE_SLUG = "trades-hall";
export const TRADES_HALL_RUNTIME_ROOM_SLUGS = [
  "grand-hall",
  "reception-room",
  "robert-adam-room",
  "saloon",
  "lady-convenors-room",
  "north-gallery",
  "south-gallery",
] as const;
export const TradesHallRuntimeRoomSlugSchema = z.enum(TRADES_HALL_RUNTIME_ROOM_SLUGS);
export type TradesHallRuntimeRoomSlug = z.infer<typeof TradesHallRuntimeRoomSlugSchema>;

export const TRADES_HALL_ROOM_GROUPS = ["principal-room", "support-room", "gallery"] as const;
export const TradesHallRoomGroupSchema = z.enum(TRADES_HALL_ROOM_GROUPS);
export type TradesHallRoomGroup = z.infer<typeof TradesHallRoomGroupSchema>;

export const TRADES_HALL_ROOM_DEFAULT_STATUSES = ["needs_processing", "needs_registration"] as const;
export const TradesHallRoomDefaultStatusSchema = z.enum(TRADES_HALL_ROOM_DEFAULT_STATUSES);
export type TradesHallRoomDefaultStatus = z.infer<typeof TradesHallRoomDefaultStatusSchema>;

export const TRADES_HALL_ROOM_CAPTURE_STATUSES = [
  "captured_needs_processing",
  "processed_needs_registration",
  "splat_exists_outside_repo_needs_registration",
] as const;
export const TradesHallRoomCaptureStatusSchema = z.enum(TRADES_HALL_ROOM_CAPTURE_STATUSES);
export type TradesHallRoomCaptureStatus = z.infer<typeof TradesHallRoomCaptureStatusSchema>;

export const TRADES_HALL_ROOM_REGISTRY_RUNTIME_STATUSES = ["not_registered"] as const;
export const TradesHallRoomRegistryRuntimeStatusSchema = z.enum(TRADES_HALL_ROOM_REGISTRY_RUNTIME_STATUSES);
export type TradesHallRoomRegistryRuntimeStatus = z.infer<typeof TradesHallRoomRegistryRuntimeStatusSchema>;

export const REVIEWED_RUNTIME_TRANSFORM_STATUSES = ["missing", "registered"] as const;
export const ReviewedRuntimeTransformStatusSchema = z.enum(REVIEWED_RUNTIME_TRANSFORM_STATUSES);
export type ReviewedRuntimeTransformStatus = z.infer<typeof ReviewedRuntimeTransformStatusSchema>;

export const REVIEWED_RUNTIME_QA_STATUSES = [
  "missing",
  "blocked_internal_only",
  "approved_internal_preview",
  "approved_public",
] as const;
export const ReviewedRuntimeQaStatusSchema = z.enum(REVIEWED_RUNTIME_QA_STATUSES);
export type ReviewedRuntimeQaStatus = z.infer<typeof ReviewedRuntimeQaStatusSchema>;

export const REVIEWED_CAPTURE_CONTROL_STATUSES = [
  "missing",
  "source_registered",
  "linked_to_transform",
] as const;
export const ReviewedCaptureControlStatusSchema = z.enum(REVIEWED_CAPTURE_CONTROL_STATUSES);
export type ReviewedCaptureControlStatus = z.infer<typeof ReviewedCaptureControlStatusSchema>;

export const CAPTURE_CONTROL_FRESHNESS_STATUSES = [
  "missing",
  "not_checked",
  "current_for_runtime_package",
  "stale_for_runtime_package",
] as const;
export const CaptureControlFreshnessStatusSchema = z.enum(CAPTURE_CONTROL_FRESHNESS_STATUSES);
export type CaptureControlFreshnessStatus = z.infer<typeof CaptureControlFreshnessStatusSchema>;

export const ROOM_RUNTIME_CONTROL_EVIDENCE_CHAIN_STATUSES = [
  "not_recorded",
  "blocked_insufficient_landmark_candidates",
  "blocked_missing_coordinate_pair_intake",
  "blocked_invalid_coordinate_pair_intake",
  "blocked_incompatible_coordinate_pair_intake",
  "blocked_packet_build",
  "blocked_capture_control_payload",
  "capture_control_payload_ready",
  "chain_inconsistent",
] as const;
export const RoomRuntimeControlEvidenceChainStatusSchema = z.enum(
  ROOM_RUNTIME_CONTROL_EVIDENCE_CHAIN_STATUSES,
);
export type RoomRuntimeControlEvidenceChainStatus = z.infer<
  typeof RoomRuntimeControlEvidenceChainStatusSchema
>;

export const TRADES_HALL_RUNTIME_ROOMS = [
  {
    slug: "grand-hall",
    roomSlug: "grand-hall",
    displayName: "Grand Hall",
    roomGroup: "principal-room",
    defaultStatus: "needs_processing",
    captureStatus: "captured_needs_processing",
    registryRuntimeStatus: "not_registered",
    publicShowcaseEnabled: false,
    internalVisualEnabled: true,
    primaryCaptureSource: "runpod",
    currentState: "captured_needs_processing",
    safeCopy: "captured / needs processing",
    nextAction: "Process captured room into a runtime splat",
  },
  {
    slug: "reception-room",
    roomSlug: "reception-room",
    displayName: "Reception Room",
    roomGroup: "support-room",
    defaultStatus: "needs_registration",
    captureStatus: "processed_needs_registration",
    registryRuntimeStatus: "not_registered",
    publicShowcaseEnabled: false,
    internalVisualEnabled: true,
    primaryCaptureSource: "xgrids",
    currentState: "processed_output_found",
    safeCopy: "processed output found / needs registration",
    nextAction: "Upload/register XGRIDS SOG bundle and verify internal runtime load",
  },
  {
    slug: "robert-adam-room",
    roomSlug: "robert-adam-room",
    displayName: "Robert Adam Room",
    roomGroup: "support-room",
    defaultStatus: "needs_processing",
    captureStatus: "captured_needs_processing",
    registryRuntimeStatus: "not_registered",
    publicShowcaseEnabled: false,
    internalVisualEnabled: true,
    primaryCaptureSource: "xgrids",
    currentState: "captured_needs_processing",
    safeCopy: "captured / needs processing",
    nextAction: "Process captured room into a runtime splat",
  },
  {
    slug: "saloon",
    roomSlug: "saloon",
    displayName: "Saloon",
    roomGroup: "support-room",
    defaultStatus: "needs_processing",
    captureStatus: "captured_needs_processing",
    registryRuntimeStatus: "not_registered",
    publicShowcaseEnabled: false,
    internalVisualEnabled: true,
    primaryCaptureSource: "xgrids",
    currentState: "captured_needs_processing",
    safeCopy: "captured / needs processing",
    nextAction: "Process captured room into a runtime splat",
  },
  {
    slug: "lady-convenors-room",
    roomSlug: "lady-convenors-room",
    displayName: "Lady Convenor's Room",
    roomGroup: "support-room",
    defaultStatus: "needs_registration",
    captureStatus: "splat_exists_outside_repo_needs_registration",
    registryRuntimeStatus: "not_registered",
    publicShowcaseEnabled: false,
    internalVisualEnabled: true,
    primaryCaptureSource: "xgrids",
    currentState: "splat_done_outside_repo",
    safeCopy: "splat exists outside repo / needs registration",
    nextAction: "Register external splat asset and runtime package",
  },
  {
    slug: "north-gallery",
    roomSlug: "north-gallery",
    displayName: "North Gallery",
    roomGroup: "gallery",
    defaultStatus: "needs_registration",
    captureStatus: "splat_exists_outside_repo_needs_registration",
    registryRuntimeStatus: "not_registered",
    publicShowcaseEnabled: false,
    internalVisualEnabled: true,
    primaryCaptureSource: "xgrids",
    currentState: "splat_done_outside_repo",
    safeCopy: "splat exists outside repo / needs registration",
    nextAction: "Register external splat asset and runtime package",
  },
  {
    slug: "south-gallery",
    roomSlug: "south-gallery",
    displayName: "South Gallery",
    roomGroup: "gallery",
    defaultStatus: "needs_registration",
    captureStatus: "splat_exists_outside_repo_needs_registration",
    registryRuntimeStatus: "not_registered",
    publicShowcaseEnabled: false,
    internalVisualEnabled: true,
    primaryCaptureSource: "xgrids",
    currentState: "splat_done_outside_repo",
    safeCopy: "splat exists outside repo / needs registration",
    nextAction: "Register external splat asset and runtime package",
  },
] as const;
export type TradesHallRuntimeRoom = (typeof TRADES_HALL_RUNTIME_ROOMS)[number];
export type TradesHallRoomCurrentState = (typeof TRADES_HALL_RUNTIME_ROOMS)[number]["currentState"];

export function isTradesHallRuntimeRoomSlug(value: string): value is TradesHallRuntimeRoomSlug {
  return TRADES_HALL_RUNTIME_ROOM_SLUGS.includes(value as TradesHallRuntimeRoomSlug);
}

export function tradesHallRuntimeRoomForSlug(value: string): TradesHallRuntimeRoom | null {
  return TRADES_HALL_RUNTIME_ROOMS.find((room) => room.slug === value) ?? null;
}

export const R2_TRAINING_INPUT_BUCKET = "venviewer-training-inputs";
export const R2_TRAINING_OUTPUT_BUCKET = "venviewer-training-outputs";
export const R2_TRAINING_INPUT_LANES = ["xgrids", "matterport", "raw"] as const;
export const R2_TRAINING_OUTPUT_LANES = ["runtime", "xgrids", "runpod"] as const;
export type R2TrainingInputLane = (typeof R2_TRAINING_INPUT_LANES)[number];
export type R2TrainingOutputLane = (typeof R2_TRAINING_OUTPUT_LANES)[number];

export function trainingInputR2Prefix(venueSlug: string, roomSlug: string, lane: R2TrainingInputLane): string {
  return `r2:${R2_TRAINING_INPUT_BUCKET}/${venueSlug}/rooms/${roomSlug}/${lane}/`;
}

export function trainingOutputR2Prefix(venueSlug: string, roomSlug: string, lane: R2TrainingOutputLane): string {
  return `r2:${R2_TRAINING_OUTPUT_BUCKET}/${venueSlug}/rooms/${roomSlug}/${lane}/`;
}

export const FORBIDDEN_ASSET_FIXTURE_MARKERS = [
  "textsplats",
  "text-splats",
  "spark-fixture",
  "splat-fixture",
  "fixture",
  "demo",
] as const;

export function runtimeFileExtensionForKey(key: string): RuntimeFileExtension | null {
  const pathOnly = key.split(/[?#]/, 1)[0]?.toLowerCase() ?? "";
  return RUNTIME_FILE_EXTENSIONS.find((extension) => pathOnly.endsWith(extension)) ?? null;
}

export function splatExtensionForKey(key: string): RuntimeSplatExtension | null {
  const pathOnly = key.split(/[?#]/, 1)[0]?.toLowerCase() ?? "";
  return RUNTIME_SPLAT_EXTENSIONS.find((extension) => pathOnly.endsWith(extension)) ?? null;
}

export function isForbiddenAssetFixtureKey(key: string): boolean {
  const lower = key.toLowerCase();
  return FORBIDDEN_ASSET_FIXTURE_MARKERS.some((marker) => lower.includes(marker));
}

export function isR2ObjectKeyShape(key: string): boolean {
  if (key.length === 0 || key.length > 1024) return false;
  if (key.trim() !== key) return false;
  if (key.startsWith("/") || key.includes("\\") || key.includes("?") || key.includes("#")) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(key)) return false;
  const segments = key.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

export function assetKindAllowsExtension(kind: AssetKind, extension: RuntimeFileExtension): boolean {
  return ASSET_KIND_EXTENSIONS[kind].includes(extension);
}

function validateSupportedTradesHallRoom(
  venueSlug: string,
  roomSlug: string | null | undefined,
  ctx: z.RefinementCtx,
  path: readonly (string | number)[],
): void {
  if (venueSlug !== TRADES_HALL_VENUE_SLUG || roomSlug === null || roomSlug === undefined) return;
  if (isTradesHallRuntimeRoomSlug(roomSlug)) return;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: [...path],
    message: "Unsupported Trades Hall room slug.",
  });
}

const R2ObjectKeySchema = z.string().trim().min(1).max(1024).superRefine((key, ctx) => {
  if (!isR2ObjectKeyShape(key)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "r2Key must be an object key, not a URL or root-relative path.",
    });
  }
  if (isForbiddenAssetFixtureKey(key)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Fixture/demo asset keys cannot be registered as runtime assets.",
    });
  }
  if (runtimeFileExtensionForKey(key) === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Asset key has an unsupported file extension.",
    });
  }
});

const ExternalAssetUrlSchema = z.string().trim().url().max(2048).superRefine((url, ctx) => {
  if (!url.startsWith("https://")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "externalUrl must use https.",
    });
  }
  if (isForbiddenAssetFixtureKey(url)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Fixture/demo asset URLs cannot be registered as runtime assets.",
    });
  }
  if (runtimeFileExtensionForKey(url) === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "External asset URL has an unsupported file extension.",
    });
  }
});

const FileNameSchema = z.string().trim().min(1).max(255).superRefine((fileName, ctx) => {
  if (fileName.includes("/") || fileName.includes("\\") || fileName === "." || fileName === "..") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "fileName must be a file name, not a path.",
    });
  }
});

export const RuntimePackageCompositionBasisSchema = z.object({
  decisionId: RuntimeManifestKeySchema,
  decisionRef: z.string().trim().min(1).max(500),
  hierarchySha256: RuntimePackageContentDigestSchema,
  format: z.enum(["sog", "spz"]),
  level: z.enum(["coarse", "medium", "fine", "custom"]),
  lodSelectionPolicy: RuntimeManifestKeySchema,
  expectedGaussianCount: z.number().int().positive(),
}).strict();
export type RuntimePackageCompositionBasis = z.infer<
  typeof RuntimePackageCompositionBasisSchema
>;

/**
 * Immutable identity for one visual member. The storage key itself remains
 * server-only; its digest binds the object location into package content.
 */
export const RuntimePackageVisualAssetReceiptSchema = z.object({
  assetVersionId: z.string().uuid(),
  fileName: FileNameSchema,
  fileExt: z.enum([".sog", ".spz"]),
  sha256: RuntimePackageContentDigestSchema,
  sizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  storageKeySha256: RuntimePackageContentDigestSchema,
}).strict();
export type RuntimePackageVisualAssetReceipt = z.infer<
  typeof RuntimePackageVisualAssetReceiptSchema
>;

export const RuntimePackageManifestJsonSchema = z.object({
  schemaVersion: z.literal("venviewer.runtime-package.v1"),
  venueSlug: RuntimeSlugSchema,
  roomSlug: RuntimeSlugSchema,
  packageType: z.literal("room-runtime"),
  assets: z.object({
    primaryVisualAssetVersionId: z.string().uuid().nullable(),
    visualAssetVersionIds: z.array(z.string().uuid()).min(1).max(MAX_RUNTIME_VISUAL_ASSET_COUNT).optional(),
    visualAssetReceipts: z.array(RuntimePackageVisualAssetReceiptSchema)
      .min(1)
      .max(MAX_RUNTIME_VISUAL_ASSET_COUNT)
      .optional(),
    semanticMeshAssetVersionId: z.string().uuid().nullable(),
    collisionAssetVersionId: z.string().uuid().nullable(),
    pointCloudAssetVersionId: z.string().uuid().nullable(),
  }).strict(),
  compositionBasis: RuntimePackageCompositionBasisSchema.optional(),
  generatedAt: z.string().regex(ISO_DATE_TIME, "generatedAt must be an ISO datetime.").optional(),
  notes: z.string().trim().max(2000).optional(),
}).strict().superRefine((manifest, ctx) => {
  validateSupportedTradesHallRoom(manifest.venueSlug, manifest.roomSlug, ctx, ["roomSlug"]);

  const visualAssetVersionIds = manifest.assets.visualAssetVersionIds;
  const visualAssetReceipts = manifest.assets.visualAssetReceipts;
  if (visualAssetVersionIds === undefined) {
    if (visualAssetReceipts !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assets", "visualAssetReceipts"],
        message: "Visual asset receipts require explicit ordered visual asset version ids.",
      });
    }
    return;
  }

  if (new Set(visualAssetVersionIds).size !== visualAssetVersionIds.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["assets", "visualAssetVersionIds"],
      message: "Visual asset version ids must not contain duplicates.",
    });
  }

  const primaryVisualAssetVersionId = manifest.assets.primaryVisualAssetVersionId;
  if (primaryVisualAssetVersionId === null || !visualAssetVersionIds.includes(primaryVisualAssetVersionId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["assets", "visualAssetVersionIds"],
      message: "Visual asset version ids must include the non-null primary visual asset version id.",
    });
  }

  if (visualAssetReceipts === undefined) return;
  if (visualAssetReceipts.length !== visualAssetVersionIds.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["assets", "visualAssetReceipts"],
      message: "Visual asset receipts must exactly match the ordered visual asset membership.",
    });
    return;
  }
  if (
    new Set(visualAssetReceipts.map((receipt) => receipt.storageKeySha256)).size !==
    visualAssetReceipts.length
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["assets", "visualAssetReceipts"],
      message: "Visual asset receipts must not reuse one storage identity.",
    });
  }
  for (let index = 0; index < visualAssetVersionIds.length; index += 1) {
    if (visualAssetReceipts[index]?.assetVersionId !== visualAssetVersionIds[index]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assets", "visualAssetReceipts", index, "assetVersionId"],
        message: "Visual asset receipts must preserve exact manifest order and identity.",
      });
    }
  }
});
export type RuntimePackageManifestJson = z.infer<typeof RuntimePackageManifestJsonSchema>;

export const CaptureSessionSchema = z.object({
  id: z.string(),
  venueSlug: RuntimeSlugSchema,
  roomSlug: RuntimeSlugSchema.nullable(),
  captureSource: CaptureSourceTypeSchema,
  captureDevice: z.string().nullable(),
  captureDate: z.string().nullable(),
  operatorName: z.string().nullable(),
  sourceProjectName: z.string().nullable(),
  notes: z.string().nullable(),
  status: CaptureSessionStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CaptureSession = z.infer<typeof CaptureSessionSchema>;

export const RegisterCaptureSessionInputSchema = z.object({
  venueSlug: RuntimeSlugSchema,
  roomSlug: RuntimeSlugSchema.nullable().optional(),
  captureSource: CaptureSourceTypeSchema,
  captureDevice: z.string().trim().max(255).nullable().optional(),
  captureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  operatorName: z.string().trim().max(255).nullable().optional(),
  sourceProjectName: z.string().trim().max(255).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  status: CaptureSessionStatusSchema.default("captured"),
}).strict().superRefine((body, ctx) => {
  validateSupportedTradesHallRoom(body.venueSlug, body.roomSlug, ctx, ["roomSlug"]);
});
export type RegisterCaptureSessionInput = z.infer<typeof RegisterCaptureSessionInputSchema>;

export const AssetVersionSchema = z.object({
  id: z.string(),
  venueSlug: RuntimeSlugSchema,
  roomSlug: RuntimeSlugSchema.nullable(),
  captureSessionId: z.string().nullable(),
  assetKind: AssetKindSchema,
  sourceType: AssetSourceTypeSchema,
  fileName: z.string(),
  fileExt: RuntimeFileExtensionSchema,
  r2Key: z.string().nullable(),
  externalUrl: z.string().nullable(),
  mimeType: z.string().nullable(),
  sha256: z.string().nullable(),
  sizeBytes: z.number().nullable(),
  evidenceStatus: AssetEvidenceStatusSchema,
  runtimeStatus: AssetRuntimeStatusSchema,
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AssetVersion = z.infer<typeof AssetVersionSchema>;

export const RoomManifestSchema = z.object({
  id: z.string(),
  venueSlug: RuntimeSlugSchema,
  roomSlug: RuntimeSlugSchema,
  displayName: z.string(),
  matterportMasterReference: z.string().nullable(),
  alignmentStatus: RoomAlignmentStatusSchema,
  primaryCaptureSource: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type RoomManifest = z.infer<typeof RoomManifestSchema>;

export const RuntimePackageSchema = z.object({
  id: z.string(),
  venueSlug: RuntimeSlugSchema,
  roomSlug: RuntimeSlugSchema,
  primaryVisualAssetVersionId: z.string().nullable(),
  semanticMeshAssetVersionId: z.string().nullable(),
  collisionAssetVersionId: z.string().nullable(),
  pointCloudAssetVersionId: z.string().nullable(),
  manifestJson: RuntimePackageManifestJsonSchema,
  evidenceStatus: AssetEvidenceStatusSchema,
  runtimeStatus: RuntimePackageStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  primaryVisualAssetVersion: AssetVersionSchema.nullable(),
  primaryVisualAssetUrl: z.string().nullable(),
  visualAssetUrls: z.array(z.string().url()),
});
export type RuntimePackage = z.infer<typeof RuntimePackageSchema>;

/**
 * Opaque, review-safe identity for a server-approved Reception runtime
 * composition. Exact asset IDs, byte hashes, storage identities and hierarchy
 * receipts stay on the server; public clients receive only this attestation and
 * the URLs needed to render the already-approved composition.
 */
export const ReviewedRuntimeProfileIdSchema = z.enum([
  "quality-sog-fine-v1",
  "mobile-spz-fine-v1",
]);
export type ReviewedRuntimeProfileId = z.infer<typeof ReviewedRuntimeProfileIdSchema>;

export const ApprovedRoomRuntimeProfileSchema = z.object({
  scope: z.literal("approved_room_runtime_profile"),
  venueSlug: RuntimeSlugSchema,
  roomSlug: RuntimeSlugSchema,
  profileId: ReviewedRuntimeProfileIdSchema,
  visualAssetUrls: z.array(z.string().url())
    .min(1)
    .max(MAX_RUNTIME_VISUAL_ASSET_COUNT),
}).strict().superRefine((profile, ctx) => {
  if (new Set(profile.visualAssetUrls).size !== profile.visualAssetUrls.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["visualAssetUrls"],
      message: "Approved runtime profile URLs must be unique.",
    });
  }
});
export type ApprovedRoomRuntimeProfile = z.infer<typeof ApprovedRoomRuntimeProfileSchema>;

export const RuntimePackagePreviewVisualAssetSchema = z.object({
  assetVersionId: z.string().uuid(),
  fileName: FileNameSchema,
  fileExt: z.enum([".sog", ".spz"]),
  sha256: RuntimePackageContentDigestSchema,
  sizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();
export type RuntimePackagePreviewVisualAsset = z.infer<
  typeof RuntimePackagePreviewVisualAssetSchema
>;

/**
 * One administrator-only view of an exact immutable runtime package. Asset
 * bytes remain behind authenticated API streams; this metadata contains no
 * object-store key, public fallback, or bearer-capability URL.
 */
export const RuntimePackagePreviewSchema = z.object({
  scope: z.literal("exact_private_runtime_package_preview"),
  runtimePackageId: z.string().uuid(),
  venueSlug: RuntimeSlugSchema,
  roomSlug: RuntimeSlugSchema,
  revision: z.number().int().positive(),
  identityKind: z.literal("content_sha256"),
  contentDigest: RuntimePackageContentDigestSchema,
  manifestJson: RuntimePackageManifestJsonSchema,
  evidenceStatus: AssetEvidenceStatusSchema,
  runtimeStatus: z.enum(["internal_ready", "published"]),
  reviewedProfileId: ReviewedRuntimeProfileIdSchema.nullable(),
  issuedAt: z.string().datetime(),
  visualAssets: z.array(RuntimePackagePreviewVisualAssetSchema).min(1).max(MAX_RUNTIME_VISUAL_ASSET_COUNT),
}).strict().superRefine((preview, ctx) => {
  if (preview.evidenceStatus === "rejected") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["evidenceStatus"],
      message: "Rejected evidence cannot be opened as a private runtime preview.",
    });
  }
  if (
    preview.manifestJson.venueSlug !== preview.venueSlug ||
    preview.manifestJson.roomSlug !== preview.roomSlug
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["manifestJson"],
      message: "Preview package and manifest venue/room identity must match.",
    });
  }
  const declaredIds = preview.manifestJson.assets.visualAssetVersionIds ??
    (preview.manifestJson.assets.primaryVisualAssetVersionId === null
      ? []
      : [preview.manifestJson.assets.primaryVisualAssetVersionId]);
  if (declaredIds.length !== preview.visualAssets.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["visualAssets"],
      message: "Preview visual assets must exactly match the package manifest membership.",
    });
    return;
  }
  const receipts = preview.manifestJson.assets.visualAssetReceipts;
  if (receipts === undefined || receipts.length !== preview.visualAssets.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["manifestJson", "assets", "visualAssetReceipts"],
      message: "Exact private previews require immutable receipts for every visual asset.",
    });
    return;
  }
  for (let index = 0; index < declaredIds.length; index += 1) {
    const asset = preview.visualAssets[index];
    const receipt = receipts[index];
    if (
      asset === undefined ||
      asset.assetVersionId !== declaredIds[index]
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["visualAssets", index],
        message: "Preview visual assets must preserve exact manifest order and identity.",
      });
    }
    if (
      asset === undefined ||
      receipt === undefined ||
      receipt.assetVersionId !== asset.assetVersionId ||
      receipt.fileName !== asset.fileName ||
      receipt.fileExt !== asset.fileExt ||
      receipt.sha256 !== asset.sha256 ||
      receipt.sizeBytes !== asset.sizeBytes
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["visualAssets", index],
        message: "Preview visual asset metadata must match its immutable package receipt.",
      });
    }
  }
});
export type RuntimePackagePreview = z.infer<typeof RuntimePackagePreviewSchema>;

export const RuntimeTransformArtifactSchema = z.object({
  id: z.string(),
  runtimePackageId: z.string().uuid(),
  venueSlug: RuntimeSlugSchema,
  roomSlug: RuntimeSlugSchema,
  transformArtifactId: RuntimeManifestKeySchema,
  transformArtifact: TransformArtifactV0Schema,
  reviewNote: z.string().nullable(),
  registeredBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict().superRefine((row, ctx) => {
  if (row.transformArtifact.id !== row.transformArtifactId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["transformArtifactId"],
      message: "transformArtifactId must match transformArtifact.id.",
    });
  }
});
export type RuntimeTransformArtifact = z.infer<typeof RuntimeTransformArtifactSchema>;

export const RegisterRuntimeTransformArtifactInputSchema = z.object({
  runtimePackageId: z.string().uuid(),
  venueSlug: RuntimeSlugSchema,
  roomSlug: RuntimeSlugSchema,
  transformArtifact: TransformArtifactV0Schema,
  reviewNote: z.string().trim().max(2000).nullable().optional(),
}).strict().superRefine((body, ctx) => {
  validateSupportedTradesHallRoom(body.venueSlug, body.roomSlug, ctx, ["roomSlug"]);

  if (!signedRuntimeTransformAlignmentMethods.has(body.transformArtifact.alignmentMethod)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["transformArtifact", "alignmentMethod"],
      message: "Signed runtime transforms cannot use visual-only or unconstrained alignment methods.",
    });
  }

  const hasReviewableEvidenceRef = body.transformArtifact.provenance.refs.some((ref) =>
    signedRuntimeTransformEvidenceRefTypes.has(ref.refType),
  );
  if (!hasReviewableEvidenceRef) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["transformArtifact", "provenance", "refs"],
      message: "Signed runtime transforms need a control network, landmark set, or review artifact reference.",
    });
  }
});
export type RegisterRuntimeTransformArtifactInput = z.infer<typeof RegisterRuntimeTransformArtifactInputSchema>;

export const RuntimeTransformArtifactQuerySchema = z.object({
  runtimePackageId: z.string().uuid(),
}).strict();
export type RuntimeTransformArtifactQuery = z.infer<typeof RuntimeTransformArtifactQuerySchema>;

export const RuntimeTransformArtifactRegistrationReportSchema = z
  .object({
    schemaVersion: z.literal("venviewer.runtime-transform-artifact-registration-report.v0"),
    generatedAt: z.string().datetime(),
    mode: z.enum(["dry_run", "registered"]),
    apiUrl: z.string().url(),
    payloadFile: z.string().trim().min(1),
    payload: z.object({
      venueSlug: RuntimeSlugSchema,
      roomSlug: RuntimeSlugSchema,
      runtimePackageId: z.string().uuid(),
      transformArtifactId: RuntimeManifestKeySchema,
      sourceFrame: RuntimeTransformFrameSchema,
      targetFrame: RuntimeTransformFrameSchema,
      alignmentMethod: RuntimeTransformAlignmentMethodSchema,
      provenanceState: RuntimeTransformProvenanceStateSchema,
      residualRmseM: z.number().finite().nonnegative().nullable(),
      landmarkCount: z.number().int().nonnegative(),
      reviewerId: z.string().trim().min(1).max(160),
      reviewerRole: z.string().trim().min(1).max(80),
    }).strict(),
    preflight: z.object({
      payloadRuntimePackageId: z.string().uuid(),
      latestRuntimePackageId: z.string().uuid().nullable(),
      latestRuntimePackageRuntimeStatus: RuntimePackageStatusSchema.nullable(),
      latestRuntimePackageEvidenceStatus: AssetEvidenceStatusSchema.nullable(),
      runtimePackageMatchesLatest: z.boolean(),
      runtimePackageDriftAllowed: z.boolean(),
    }).strict(),
    registration: z.object({
      runtimeTransformArtifactRowId: z.string().min(1),
      transformArtifactId: RuntimeManifestKeySchema,
      registeredBy: z.string().nullable(),
      createdAt: z.string().datetime(),
      updatedAt: z.string().datetime(),
    }).strict().nullable(),
    guardrails: z.object({
      runtimePackageDriftAllowed: z.boolean(),
      runtimeQaRecordChanged: z.literal(false),
      captureControlSourceChanged: z.literal(false),
      publicExposureChanged: z.literal(false),
    }).strict(),
  })
  .strict()
  .superRefine((report, ctx) => {
    if (report.mode === "dry_run" && report.registration !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["registration"],
        message: "Dry-run reports cannot include a registration row.",
      });
    }
    if (report.mode === "registered" && report.registration === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["registration"],
        message: "Registered reports must include the persisted runtime transform artifact row.",
      });
    }
    if (report.payload.runtimePackageId !== report.preflight.payloadRuntimePackageId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["preflight", "payloadRuntimePackageId"],
        message: "Preflight payload runtime package id must match the report payload.",
      });
    }
    const expectedMatch = report.preflight.latestRuntimePackageId !== null &&
      report.preflight.latestRuntimePackageId === report.preflight.payloadRuntimePackageId;
    if (report.preflight.runtimePackageMatchesLatest !== expectedMatch) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["preflight", "runtimePackageMatchesLatest"],
        message: "runtimePackageMatchesLatest must reflect payload/latest runtime package identity.",
      });
    }
    if (!expectedMatch && !report.preflight.runtimePackageDriftAllowed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["preflight", "runtimePackageDriftAllowed"],
        message: "Runtime package drift reports require the explicit drift override.",
      });
    }
    if (report.guardrails.runtimePackageDriftAllowed !== report.preflight.runtimePackageDriftAllowed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["guardrails", "runtimePackageDriftAllowed"],
        message: "Guardrail drift override must match preflight drift override.",
      });
    }
    if (
      report.registration !== null &&
      report.registration.transformArtifactId !== report.payload.transformArtifactId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["registration", "transformArtifactId"],
        message: "Registered transform artifact id must match the report payload transform artifact id.",
      });
    }
  });
export type RuntimeTransformArtifactRegistrationReport = z.infer<
  typeof RuntimeTransformArtifactRegistrationReportSchema
>;

export const RUNTIME_TRANSFORM_ARTIFACT_REGISTRATION_REPORT_INSPECTION_STATUSES = [
  "ready_for_live_transform_registration",
  "not_ready_for_live_transform_registration",
  "registered_transform_report_verified",
  "invalid_report",
] as const;
export const RuntimeTransformArtifactRegistrationReportInspectionStatusSchema = z.enum(
  RUNTIME_TRANSFORM_ARTIFACT_REGISTRATION_REPORT_INSPECTION_STATUSES,
);
export type RuntimeTransformArtifactRegistrationReportInspectionStatus = z.infer<
  typeof RuntimeTransformArtifactRegistrationReportInspectionStatusSchema
>;

export const RuntimeTransformArtifactRegistrationReportInspectionSchema = z
  .object({
    schemaVersion: z.literal("venviewer.runtime-transform-artifact-registration-report-inspection.v0"),
    generatedAt: z.string().datetime(),
    inspectedReportFile: z.string().trim().min(1),
    inspectedReportGeneratedAt: z.string().datetime().nullable(),
    status: RuntimeTransformArtifactRegistrationReportInspectionStatusSchema,
    liveTransformRegistrationReady: z.boolean(),
    mode: z.enum(["dry_run", "registered"]).nullable(),
    venueSlug: RuntimeSlugSchema.nullable(),
    roomSlug: RuntimeSlugSchema.nullable(),
    transformArtifactId: RuntimeManifestKeySchema.nullable(),
    reportRuntimePackageId: z.string().uuid().nullable(),
    reportLatestRuntimePackageId: z.string().uuid().nullable(),
    reportRuntimePackageMatchesLatest: z.boolean().nullable(),
    reportRuntimePackageDriftAllowed: z.boolean().nullable(),
    blockers: z.array(z.string().trim().min(1)),
    messages: z.array(z.string().trim().min(1)),
  })
  .strict()
  .superRefine((inspection, ctx) => {
    if (
      inspection.liveTransformRegistrationReady &&
      inspection.status !== "ready_for_live_transform_registration"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message: "Only ready_for_live_transform_registration inspections may set liveTransformRegistrationReady.",
      });
    }
    if (inspection.status === "ready_for_live_transform_registration") {
      if (!inspection.liveTransformRegistrationReady) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["liveTransformRegistrationReady"],
          message: "Ready inspections must set liveTransformRegistrationReady.",
        });
      }
      if (inspection.mode !== "dry_run") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["mode"],
          message: "Ready inspections must come from dry-run reports.",
        });
      }
      if (
        inspection.venueSlug === null ||
        inspection.roomSlug === null ||
        inspection.transformArtifactId === null ||
        inspection.inspectedReportGeneratedAt === null
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["status"],
          message: "Ready inspections must include report target identity.",
        });
      }
      if (inspection.blockers.length !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["blockers"],
          message: "Ready inspections cannot include blockers.",
        });
      }
      if (inspection.reportRuntimePackageId === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["reportRuntimePackageId"],
          message: "Ready inspections must be scoped to a runtime package.",
        });
      }
      if (inspection.reportLatestRuntimePackageId !== inspection.reportRuntimePackageId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["reportLatestRuntimePackageId"],
          message: "Ready inspections require the payload runtime package to match latest loadable package.",
        });
      }
      if (inspection.reportRuntimePackageMatchesLatest !== true) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["reportRuntimePackageMatchesLatest"],
          message: "Ready inspections require runtimePackageMatchesLatest true.",
        });
      }
      if (inspection.reportRuntimePackageDriftAllowed !== false) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["reportRuntimePackageDriftAllowed"],
          message: "Ready inspections cannot use runtime-package drift override.",
        });
      }
    }
    if (
      inspection.status === "not_ready_for_live_transform_registration" &&
      inspection.blockers.length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["blockers"],
        message: "Not-ready inspections must include at least one blocker.",
      });
    }
    if (inspection.status === "registered_transform_report_verified") {
      if (inspection.liveTransformRegistrationReady) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["liveTransformRegistrationReady"],
          message: "Registered transform reports are audit evidence, not live-registration authorization.",
        });
      }
      if (inspection.mode !== "registered") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["mode"],
          message: "Registered transform report inspections must cite registered mode.",
        });
      }
      if (inspection.blockers.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["blockers"],
          message: "Registered transform report inspections must state why they are not live-registration-ready.",
        });
      }
    }
    if (inspection.status === "invalid_report") {
      if (inspection.liveTransformRegistrationReady) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["liveTransformRegistrationReady"],
          message: "Invalid reports cannot be live-registration-ready.",
        });
      }
      if (inspection.blockers.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["blockers"],
          message: "Invalid report inspections must include validation blockers.",
        });
      }
    }
  });
export type RuntimeTransformArtifactRegistrationReportInspection = z.infer<
  typeof RuntimeTransformArtifactRegistrationReportInspectionSchema
>;

export const PublicRoomRuntimeVisualSchema = z
  .object({
    venueSlug: RuntimeSlugSchema,
    roomSlug: RuntimeSlugSchema,
    runtimeVisualAvailable: z.boolean(),
    visualUrl: z.string().url().nullable(),
    visualLabel: z.string().min(1),
    safeCopy: z.string().min(1),
    humanReviewRequired: z.boolean(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.runtimeVisualAvailable && value.visualUrl === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["visualUrl"],
        message: "visualUrl is required when a public runtime visual is available.",
      });
    }

    if (!value.runtimeVisualAvailable && value.visualUrl !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["visualUrl"],
        message: "visualUrl must be null when a public runtime visual is unavailable.",
      });
    }
  });
export type PublicRoomRuntimeVisual = z.infer<typeof PublicRoomRuntimeVisualSchema>;

export const RegisterAssetVersionInputSchema = z.object({
  venueSlug: RuntimeSlugSchema,
  roomSlug: RuntimeSlugSchema.nullable().optional(),
  captureSessionId: z.string().uuid().nullable().optional(),
  assetKind: AssetKindSchema,
  sourceType: AssetSourceTypeSchema,
  fileName: FileNameSchema,
  fileExt: RuntimeFileExtensionSchema,
  r2Key: R2ObjectKeySchema.nullable().optional(),
  externalUrl: ExternalAssetUrlSchema.nullable().optional(),
  mimeType: z.string().trim().min(1).max(120).nullable().optional(),
  sha256: z.string().regex(SHA256_HEX, "sha256 must be 64 lowercase hex characters").nullable().optional(),
  sizeBytes: z.number().int().positive().nullable().optional(),
  evidenceStatus: AssetEvidenceStatusSchema.default("unverified"),
  runtimeStatus: AssetRuntimeStatusSchema.default("staged"),
  notes: z.string().trim().max(4000).nullable().optional(),
}).strict().superRefine((body, ctx) => {
  validateSupportedTradesHallRoom(body.venueSlug, body.roomSlug, ctx, ["roomSlug"]);

  const r2Key = body.r2Key ?? null;
  const externalUrl = body.externalUrl ?? null;
  if (r2Key === null && externalUrl === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["r2Key"],
      message: "Either r2Key or externalUrl is required.",
    });
  }
  const r2Extension = r2Key === null ? null : runtimeFileExtensionForKey(r2Key);
  if (r2Key !== null && r2Extension !== body.fileExt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["fileExt"],
      message: "fileExt must match the r2Key extension.",
    });
  }
  const externalExtension = externalUrl === null ? null : runtimeFileExtensionForKey(externalUrl);
  if (externalUrl !== null && externalExtension !== body.fileExt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["fileExt"],
      message: "fileExt must match the externalUrl extension.",
    });
  }
  const lowerFileName = body.fileName.toLowerCase();
  if (!lowerFileName.endsWith(body.fileExt)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["fileName"],
      message: "fileName must end with fileExt.",
    });
  }
  if (!assetKindAllowsExtension(body.assetKind, body.fileExt)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["fileExt"],
      message: `File extension ${body.fileExt} is not allowed for ${body.assetKind}.`,
    });
  }
});
export type RegisterAssetVersionInput = z.infer<typeof RegisterAssetVersionInputSchema>;

export const RegisterRuntimePackageInputSchema = z.object({
  venueSlug: RuntimeSlugSchema,
  roomSlug: RuntimeSlugSchema,
  primaryVisualAssetVersionId: z.string().uuid().nullable().optional(),
  semanticMeshAssetVersionId: z.string().uuid().nullable().optional(),
  collisionAssetVersionId: z.string().uuid().nullable().optional(),
  pointCloudAssetVersionId: z.string().uuid().nullable().optional(),
  manifestJson: RuntimePackageManifestJsonSchema,
  evidenceStatus: AssetEvidenceStatusSchema.default("unverified"),
  runtimeStatus: RuntimePackageStatusSchema.default("draft"),
}).strict().superRefine((body, ctx) => {
  validateSupportedTradesHallRoom(body.venueSlug, body.roomSlug, ctx, ["roomSlug"]);

  if (body.manifestJson.venueSlug !== body.venueSlug) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["manifestJson", "venueSlug"],
      message: "Manifest venueSlug must match the package venueSlug.",
    });
  }
  if (body.manifestJson.roomSlug !== body.roomSlug) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["manifestJson", "roomSlug"],
      message: "Manifest roomSlug must match the package roomSlug.",
    });
  }

  const primaryId = body.primaryVisualAssetVersionId ?? null;
  const semanticId = body.semanticMeshAssetVersionId ?? null;
  const collisionId = body.collisionAssetVersionId ?? null;
  const pointCloudId = body.pointCloudAssetVersionId ?? null;
  if (body.manifestJson.assets.primaryVisualAssetVersionId !== primaryId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["manifestJson", "assets", "primaryVisualAssetVersionId"],
      message: "Manifest primary visual asset id must match the package field.",
    });
  }
  if (body.manifestJson.assets.semanticMeshAssetVersionId !== semanticId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["manifestJson", "assets", "semanticMeshAssetVersionId"],
      message: "Manifest semantic mesh asset id must match the package field.",
    });
  }
  if (body.manifestJson.assets.collisionAssetVersionId !== collisionId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["manifestJson", "assets", "collisionAssetVersionId"],
      message: "Manifest collision asset id must match the package field.",
    });
  }
  if (body.manifestJson.assets.pointCloudAssetVersionId !== pointCloudId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["manifestJson", "assets", "pointCloudAssetVersionId"],
      message: "Manifest point cloud asset id must match the package field.",
    });
  }
  if ((body.runtimeStatus === "internal_ready" || body.runtimeStatus === "published") && primaryId === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["primaryVisualAssetVersionId"],
      message: "A loadable runtime package requires a primary visual asset version.",
    });
  }
});
export type RegisterRuntimePackageInput = z.infer<typeof RegisterRuntimePackageInputSchema>;

export const CreateRuntimePackageRevisionInputSchema = z.object({
  requestedRevision: z.number().int().positive().optional(),
  package: RegisterRuntimePackageInputSchema,
}).strict();
export type CreateRuntimePackageRevisionInput = z.infer<
  typeof CreateRuntimePackageRevisionInputSchema
>;

export const RuntimePackageRevisionReceiptSchema = z.object({
  packageId: z.string().uuid(),
  revision: z.number().int().positive(),
  contentDigest: RuntimePackageContentDigestSchema,
  created: z.boolean(),
}).strict();
export type RuntimePackageRevisionReceipt = z.infer<typeof RuntimePackageRevisionReceiptSchema>;

export const RuntimePackageRevisionCreateResponseSchema = z.object({
  data: RuntimePackageSchema,
  receipt: RuntimePackageRevisionReceiptSchema,
}).strict();
export type RuntimePackageRevisionCreateResponse = z.infer<
  typeof RuntimePackageRevisionCreateResponseSchema
>;

export const LatestRuntimePackageQuerySchema = z.object({
  venue: RuntimeSlugSchema,
  room: RuntimeSlugSchema,
}).strict().superRefine((query, ctx) => {
  validateSupportedTradesHallRoom(query.venue, query.room, ctx, ["room"]);
});
export type LatestRuntimePackageQuery = z.infer<typeof LatestRuntimePackageQuerySchema>;

export const RoomManifestQuerySchema = z.object({
  venue: RuntimeSlugSchema.optional(),
  room: RuntimeSlugSchema.optional(),
}).strict().superRefine((query, ctx) => {
  validateSupportedTradesHallRoom(query.venue ?? "", query.room, ctx, ["room"]);
});
export type RoomManifestQuery = z.infer<typeof RoomManifestQuerySchema>;

export const AdminRoomsQuerySchema = z.object({
  venue: RuntimeSlugSchema.default("trades-hall"),
}).strict();
export type AdminRoomsQuery = z.infer<typeof AdminRoomsQuerySchema>;

export const RoomAssetStatusSchema = z.object({
  venueSlug: RuntimeSlugSchema,
  roomSlug: RuntimeSlugSchema,
  displayName: z.string(),
  roomGroup: TradesHallRoomGroupSchema,
  defaultStatus: TradesHallRoomDefaultStatusSchema,
  captureStatus: TradesHallRoomCaptureStatusSchema,
  registryRuntimeStatus: TradesHallRoomRegistryRuntimeStatusSchema,
  publicShowcaseEnabled: z.boolean(),
  internalVisualEnabled: z.boolean(),
  primaryCaptureSource: z.string().nullable(),
  currentState: z.string(),
  splatStatus: z.string(),
  splatExists: z.boolean(),
  runtimePackageStatus: z.string(),
  runtimePackageExists: z.boolean(),
  reviewedTransformStatus: ReviewedRuntimeTransformStatusSchema,
  reviewedTransformArtifactCount: z.number().int().nonnegative(),
  latestTransformArtifactId: RuntimeManifestKeySchema.nullable(),
  reviewedTransformSafeCopy: z.string().min(1),
  reviewedQaStatus: ReviewedRuntimeQaStatusSchema,
  latestQaRecordId: z.string().nullable(),
  qaSignedTransformArtifactId: RuntimeManifestKeySchema.nullable(),
  qaSignedTransformLinked: z.boolean(),
  reviewedQaSafeCopy: z.string().min(1),
  captureControlStatus: ReviewedCaptureControlStatusSchema,
  captureControlSourceCount: z.number().int().nonnegative(),
  latestCaptureControlSourceRecordId: z.string().uuid().nullable(),
  latestCaptureControlSourceId: z.string().nullable(),
  latestCaptureControlSourceClass: z.string().nullable(),
  latestCaptureControlPoseAuthorityLevel: z.string().nullable(),
  latestCaptureControlAlignmentMethods: z.array(z.string()),
  latestCaptureControlStalenessTriggers: z.array(z.string()),
  latestCaptureControlActiveStalenessTriggers: z.array(z.string()),
  captureControlFreshnessStatus: CaptureControlFreshnessStatusSchema,
  latestCaptureControlQaStatus: z.string().nullable(),
  captureControlLinkedTransformArtifactId: RuntimeManifestKeySchema.nullable(),
  captureControlTransformLinked: z.boolean(),
  captureControlAuthoritySafeCopy: z.string().min(1),
  captureControlStalenessSafeCopy: z.string().min(1),
  captureControlSafeCopy: z.string().min(1),
  runtimeControlEvidenceChainStatus: RoomRuntimeControlEvidenceChainStatusSchema,
  runtimeControlEvidenceChainRef: z.string().min(1).nullable(),
  runtimeControlRequiredCoordinatePairCount: z.number().int().nonnegative().nullable(),
  runtimeControlReviewedCoordinatePairCount: z.number().int().nonnegative().nullable(),
  runtimeControlEvidenceChainSafeCopy: z.string().min(1),
  runtimeControlEvidenceChainNextAction: z.string().min(1),
  evidenceStatus: AssetEvidenceStatusSchema.nullable(),
  runtimeStatus: RuntimePackageStatusSchema.nullable(),
  nextAction: z.string(),
  safeCopy: z.string(),
});
export type RoomAssetStatus = z.infer<typeof RoomAssetStatusSchema>;

export const ProcessingJobProcessorSchema = z.enum(["lixel_cybercolor", "runpod", "custom", "manual", "other"]);
export type ProcessingJobProcessor = z.infer<typeof ProcessingJobProcessorSchema>;

export const ProcessingJobStatusSchema = z.enum(["planned", "running", "complete", "failed", "cancelled"]);
export type ProcessingJobStatus = z.infer<typeof ProcessingJobStatusSchema>;
