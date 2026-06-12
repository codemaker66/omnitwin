import { z } from "zod";

// ---------------------------------------------------------------------------
// Room-agnostic runtime asset registry contracts
//
// These schemas describe storage/provenance records only. They do not make
// public product claims. A runtime package is loadable only when the package
// is internally/published loadable and its primary visual AssetVersion is
// marked `usable`; the browser still validates the resolved URL before Spark.
// ---------------------------------------------------------------------------

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T/;

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

// Backward-compatible export for older local call sites while this foundation
// lands. New code should use AssetRuntimeStatusSchema or RuntimePackageStatusSchema.
export const RUNTIME_STATUSES = ASSET_RUNTIME_STATUSES;
export const RuntimeStatusSchema = AssetRuntimeStatusSchema;
export type RuntimeStatus = AssetRuntimeStatus;

export const ROOM_ALIGNMENT_STATUSES = ["unaligned", "approximate", "aligned", "verified"] as const;
export const RoomAlignmentStatusSchema = z.enum(ROOM_ALIGNMENT_STATUSES);
export type RoomAlignmentStatus = z.infer<typeof RoomAlignmentStatusSchema>;

export const RUNTIME_SPLAT_EXTENSIONS = [".ply", ".spz", ".splat", ".ksplat", ".rad", ".radc"] as const;
export type RuntimeSplatExtension = (typeof RUNTIME_SPLAT_EXTENSIONS)[number];

export const RUNTIME_FILE_EXTENSIONS = [
  ".ply",
  ".spz",
  ".splat",
  ".ksplat",
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
  manifest: [".json"],
  preview: [".jpg", ".jpeg", ".png", ".webp", ".mp4", ".mov"],
  other: RUNTIME_FILE_EXTENSIONS,
};

export const TRADES_HALL_VENUE_SLUG = "trades-hall" as const;
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
  "splat_exists_outside_repo_needs_registration",
] as const;
export const TradesHallRoomCaptureStatusSchema = z.enum(TRADES_HALL_ROOM_CAPTURE_STATUSES);
export type TradesHallRoomCaptureStatus = z.infer<typeof TradesHallRoomCaptureStatusSchema>;

export const TRADES_HALL_ROOM_REGISTRY_RUNTIME_STATUSES = ["not_registered"] as const;
export const TradesHallRoomRegistryRuntimeStatusSchema = z.enum(TRADES_HALL_ROOM_REGISTRY_RUNTIME_STATUSES);
export type TradesHallRoomRegistryRuntimeStatus = z.infer<typeof TradesHallRoomRegistryRuntimeStatusSchema>;

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

export const RuntimePackageManifestJsonSchema = z.object({
  schemaVersion: z.literal("venviewer.runtime-package.v1"),
  venueSlug: RuntimeSlugSchema,
  roomSlug: RuntimeSlugSchema,
  packageType: z.literal("room-runtime"),
  assets: z.object({
    primaryVisualAssetVersionId: z.string().uuid().nullable(),
    semanticMeshAssetVersionId: z.string().uuid().nullable(),
    collisionAssetVersionId: z.string().uuid().nullable(),
    pointCloudAssetVersionId: z.string().uuid().nullable(),
  }).strict(),
  generatedAt: z.string().regex(ISO_DATE_TIME, "generatedAt must be an ISO datetime.").optional(),
  notes: z.string().trim().max(2000).optional(),
}).strict().superRefine((manifest, ctx) => {
  validateSupportedTradesHallRoom(manifest.venueSlug, manifest.roomSlug, ctx, ["roomSlug"]);
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
});
export type RuntimePackage = z.infer<typeof RuntimePackageSchema>;

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
