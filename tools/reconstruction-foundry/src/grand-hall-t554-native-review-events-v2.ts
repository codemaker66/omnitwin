import { createHash } from "node:crypto";

import {
  CanonicalJsonValueSchema,
  GRAND_HALL_PANORAMA_HEIGHT_PX,
  GRAND_HALL_PANORAMA_WIDTH_PX,
  GrandHallPanoramaSourceJpgIdentityV2Schema,
  stableCanonicalJson,
  type GrandHallPanoramaSourceJpgIdentityV2,
} from "@omnitwin/types";
import { z } from "zod";

import {
  GRAND_HALL_T554_MAXIMUM_CREDITED_HEARTBEAT_GAP_MS,
  GRAND_HALL_T554_MINIMUM_DWELL_MS_PER_TILE,
  GRAND_HALL_T554_NATIVE_REVIEW_MAXIMUM_TELEMETRY_EVENTS,
  GRAND_HALL_T554_NATIVE_TILE_COLUMN_COUNT,
  GRAND_HALL_T554_NATIVE_TILE_COUNT,
  GRAND_HALL_T554_NATIVE_TILE_HEIGHT_PX,
  GRAND_HALL_T554_NATIVE_TILE_ROW_COUNT,
  GRAND_HALL_T554_NATIVE_TILE_WIDTH_PX,
} from "./grand-hall-t554-native-review-coverage.js";
import {
  GRAND_HALL_T554_NATIVE_MASK_MAX_POLYGON_VERTEX_COUNT,
  GRAND_HALL_T554_NATIVE_MASK_MAX_REVISION,
  GRAND_HALL_T554_NATIVE_MASK_REASON_CODES,
} from "./grand-hall-t554-native-review-mask-store.js";

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const SAFE_MEMBER_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,254}$/u;
const CANONICAL_UTC_MILLISECOND_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const TILE_BITMAP_HEX_LENGTH =
  Math.ceil(GRAND_HALL_T554_NATIVE_TILE_COUNT / 8) * 2;
const DWELL_VECTOR_BYTE_LENGTH = GRAND_HALL_T554_NATIVE_TILE_COUNT * 2;
const DWELL_VECTOR_BASE64URL_LENGTH =
  Math.ceil(DWELL_VECTOR_BYTE_LENGTH / 3) * 4 - 2;
const MAXIMUM_BOUND_ARTIFACT_BYTES = 512 * 1_024 * 1_024;
const SOURCE_PIXEL_COUNT =
  GRAND_HALL_PANORAMA_WIDTH_PX * GRAND_HALL_PANORAMA_HEIGHT_PX;

export const GRAND_HALL_T554_NATIVE_REVIEW_DOMAIN_EVENT_V2 =
  "venviewer.grand-hall-t554-native-review-domain-event.v2";
export const GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_SCOPE_V2 =
  "venviewer.grand-hall-t554-native-review-journal-scope.v2";
const GRAND_HALL_T554_NATIVE_REVIEW_SOURCE_DECISION_DIGEST_DOMAIN_V2 =
  "VENVIEWER_GRAND_HALL_T554_NATIVE_REVIEW_SOURCE_DECISION_V2";
const GRAND_HALL_T554_NATIVE_REVIEW_HUMAN_ATTESTATION_DIGEST_DOMAIN_V2 =
  "VENVIEWER_GRAND_HALL_T554_NATIVE_REVIEW_HUMAN_ATTESTATION_V2";
export const GRAND_HALL_T554_NATIVE_REVIEW_HUMAN_ATTESTATION_STATEMENT_V2 =
  "I reviewed the exact bound source at native scale and recorded only what I could support from supplied evidence.";

export const GrandHallT554NativeReviewSha256V2Schema = z
  .string()
  .regex(SHA256_PATTERN)
  .transform(
    (value): `sha256:${string}` => `sha256:${value.slice("sha256:".length)}`,
  );

export type GrandHallT554NativeReviewSha256V2 = z.infer<
  typeof GrandHallT554NativeReviewSha256V2Schema
>;

export const GrandHallT554NativeReviewCanonicalUtcV2Schema = z
  .string()
  .regex(CANONICAL_UTC_MILLISECOND_PATTERN)
  .refine((value) => {
    const milliseconds = Date.parse(value);
    return (
      Number.isFinite(milliseconds) &&
      new Date(milliseconds).toISOString() === value
    );
  }, "instant must be canonical UTC with millisecond precision");

const SafeLeafNameSchema = z
  .string()
  .regex(SAFE_MEMBER_NAME_PATTERN)
  .refine(
    (value) =>
      value !== "." &&
      value !== ".." &&
      !value.includes("..") &&
      !value.endsWith(".") &&
      !value.endsWith(" "),
    "leaf name must be one canonical server-owned basename",
  );

const ArtifactByteLengthSchema = z
  .number()
  .int()
  .positive()
  .max(MAXIMUM_BOUND_ARTIFACT_BYTES);
const RenderGenerationSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const WorkspaceRevisionSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const BrowserEpochNumberSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const MaskRevisionSchema = z
  .number()
  .int()
  .nonnegative()
  .max(GRAND_HALL_T554_NATIVE_MASK_MAX_REVISION);
export const GrandHallT554NativeReviewTileBitmapHexV2Schema = z
  .string()
  .regex(new RegExp(`^[a-f0-9]{${String(TILE_BITMAP_HEX_LENGTH)}}$`, "u"));
const EMPTY_TILE_BITMAP_HEX = "0".repeat(TILE_BITMAP_HEX_LENGTH);
const FULL_TILE_BITMAP_HEX = "ff".repeat(TILE_BITMAP_HEX_LENGTH / 2);

function sha256(bytes: Buffer): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalDigest(domain: string, value: unknown): `sha256:${string}` {
  const canonical = CanonicalJsonValueSchema.parse(value);
  return sha256(
    Buffer.from(`${domain}\n${stableCanonicalJson(canonical)}`, "utf8"),
  );
}

function dwellStateSha256(bytes: Buffer): `sha256:${string}` {
  return sha256(
    Buffer.concat([
      Buffer.from(
        "VENVIEWER_GRAND_HALL_T554_NATIVE_REVIEW_DWELL_STATE_V2\n",
        "utf8",
      ),
      bytes,
    ]),
  );
}

function bitmapBuffer(value: string): Buffer {
  return Buffer.from(value, "hex");
}

function bitmapPopcount(value: string): number {
  let count = 0;
  for (const byte of bitmapBuffer(value)) {
    let remaining = byte;
    while (remaining !== 0) {
      count += remaining & 1;
      remaining >>>= 1;
    }
  }
  return count;
}

function bitmapIsSubset(candidate: string, superset: string): boolean {
  const candidateBytes = bitmapBuffer(candidate);
  const supersetBytes = bitmapBuffer(superset);
  return candidateBytes.every((byte, index) => {
    const containingByte = supersetBytes[index];
    return containingByte !== undefined && (byte & ~containingByte) === 0;
  });
}

function addIssue(
  context: z.RefinementCtx,
  path: readonly (string | number)[],
  message: string,
): void {
  context.addIssue({ code: z.ZodIssueCode.custom, path: [...path], message });
}

const AuthorityNoneShape = {
  authority: z.literal("none"),
  reviewState: z.literal("human_pending"),
  finalDecision: z.literal("PENDING"),
  acceptanceAuthorized: z.literal(false),
  reconstructionAuthorized: z.literal(false),
  runtimeAuthorized: z.literal(false),
  exportAuthorized: z.literal(false),
  generatedContentAuthorized: z.literal(false),
};

export const GrandHallT554NativeReviewAuthorityBoundaryV2Schema = z
  .object({
    schemaVersion: z.literal(
      "venviewer.grand-hall-t554-native-review-authority-boundary.v2",
    ),
    ...AuthorityNoneShape,
  })
  .strict();

export type GrandHallT554NativeReviewAuthorityBoundaryV2 = z.infer<
  typeof GrandHallT554NativeReviewAuthorityBoundaryV2Schema
>;

export const GrandHallT554NativeReviewArtifactBindingV2Schema = z
  .object({
    semanticSha256: GrandHallT554NativeReviewSha256V2Schema,
    fileSha256: GrandHallT554NativeReviewSha256V2Schema,
    byteLength: ArtifactByteLengthSchema,
  })
  .strict();

export type GrandHallT554NativeReviewArtifactBindingV2 = z.infer<
  typeof GrandHallT554NativeReviewArtifactBindingV2Schema
>;

export const GrandHallT554NativeReviewImplementationManifestBindingV2Schema = z
  .object({
    schemaVersion: z.literal(
      "venviewer.grand-hall-t554-native-review-implementation-manifest-binding.v2",
    ),
    implementationId: z.literal("grand-hall-t554-native-review-workbench-v1"),
    semanticSha256: GrandHallT554NativeReviewSha256V2Schema,
    fileSha256: GrandHallT554NativeReviewSha256V2Schema,
    byteLength: ArtifactByteLengthSchema,
  })
  .strict();

export type GrandHallT554NativeReviewImplementationManifestBindingV2 = z.infer<
  typeof GrandHallT554NativeReviewImplementationManifestBindingV2Schema
>;

export const GrandHallT554NativeReviewRegistryBindingV2Schema = z
  .object({
    schemaVersion: z.literal(
      "venviewer.grand-hall-t554-native-review-registry-binding.v2",
    ),
    venueSlug: z.literal("trades-hall"),
    roomSlug: z.literal("grand-hall"),
    sourceCount: z.literal(148),
    reviewPack: GrandHallT554NativeReviewArtifactBindingV2Schema,
    publicationReceipt: GrandHallT554NativeReviewArtifactBindingV2Schema,
    ...AuthorityNoneShape,
  })
  .strict();

export type GrandHallT554NativeReviewRegistryBindingV2 = z.infer<
  typeof GrandHallT554NativeReviewRegistryBindingV2Schema
>;

const DecoderIdentitySchema = z
  .object({
    schemaVersion: z.literal(
      "venviewer.grand-hall-t554-source-jpeg-decoder-identity.v1",
    ),
    library: z.literal("sharp"),
    sharpVersion: z.string().min(1).max(64),
    libvipsVersion: z.string().min(1).max(64),
    pipeline: z.literal("captured-jpeg-buffer-to-unrotated-rgb8.v1"),
  })
  .strict();

export const GrandHallT554NativeReviewSourceVerificationV2Schema = z
  .object({
    fileName: SafeLeafNameSchema,
    sha256: GrandHallT554NativeReviewSha256V2Schema,
    byteLength: ArtifactByteLengthSchema,
    widthPx: z.literal(GRAND_HALL_PANORAMA_WIDTH_PX),
    heightPx: z.literal(GRAND_HALL_PANORAMA_HEIGHT_PX),
    decodedChannelCount: z.literal(3),
    decodedBitsPerSample: z.literal(8),
    alphaPresent: z.literal(false),
    orientationMetadataPresent: z.literal(false),
    decodedPixelSha256: GrandHallT554NativeReviewSha256V2Schema,
    decoderIdentity: DecoderIdentitySchema,
    descriptorWitnessSha256: GrandHallT554NativeReviewSha256V2Schema,
    sameOpenDescriptorHashedAndDecoded: z.literal(true),
    fullJpegDecodeCompleted: z.literal(true),
  })
  .strict();

export type GrandHallT554NativeReviewSourceVerificationV2 = z.infer<
  typeof GrandHallT554NativeReviewSourceVerificationV2Schema
>;

export const GrandHallT554NativeReviewSourceCustodyBindingV2Schema = z
  .object({
    source: GrandHallPanoramaSourceJpgIdentityV2Schema,
    sourceVerification: GrandHallT554NativeReviewSourceVerificationV2Schema,
    sourceReviewSubjectSha256: GrandHallT554NativeReviewSha256V2Schema,
    sourceEpochBindingSha256: GrandHallT554NativeReviewSha256V2Schema,
    sourceEpochNonceSha256: GrandHallT554NativeReviewSha256V2Schema,
    sourceEpochRenderGeneration: RenderGenerationSchema,
  })
  .strict()
  .superRefine((binding, context) => {
    if (binding.source.fileName !== binding.sourceVerification.fileName) {
      addIssue(
        context,
        ["sourceVerification", "fileName"],
        "verification filename must match source",
      );
    }
    if (binding.source.sha256 !== binding.sourceVerification.sha256) {
      addIssue(
        context,
        ["sourceVerification", "sha256"],
        "verification digest must match source",
      );
    }
    if (binding.source.byteLength !== binding.sourceVerification.byteLength) {
      addIssue(
        context,
        ["sourceVerification", "byteLength"],
        "verification length must match source",
      );
    }
  });

export type GrandHallT554NativeReviewSourceCustodyBindingV2 = z.infer<
  typeof GrandHallT554NativeReviewSourceCustodyBindingV2Schema
>;

const ReasonCountSchema = z
  .object({
    reasonCode: z.enum(GRAND_HALL_T554_NATIVE_MASK_REASON_CODES),
    pixelCount: z.number().int().positive().max(SOURCE_PIXEL_COUNT),
  })
  .strict();

const ReasonCountsSchema = z
  .array(ReasonCountSchema)
  .max(GRAND_HALL_T554_NATIVE_MASK_REASON_CODES.length)
  .superRefine((counts, context) => {
    let priorIndex = -1;
    let total = 0;
    counts.forEach((entry, index) => {
      const codeIndex = GRAND_HALL_T554_NATIVE_MASK_REASON_CODES.indexOf(
        entry.reasonCode,
      );
      if (codeIndex <= priorIndex) {
        addIssue(
          context,
          [index, "reasonCode"],
          "reason counts must be unique and in codebook order",
        );
      }
      priorIndex = codeIndex;
      total += entry.pixelCount;
    });
    if (total > SOURCE_PIXEL_COUNT) {
      addIssue(
        context,
        [],
        "reason counts exceed the exact source pixel count",
      );
    }
  });

const ReasonSampleCodebookSchema = z.tuple([
  z
    .object({
      sample: z.literal(1),
      reasonCode: z.literal("adjacent_room_pixels"),
    })
    .strict(),
  z
    .object({
      sample: z.literal(2),
      reasonCode: z.literal("portal_beyond_grand_hall_plane"),
    })
    .strict(),
  z
    .object({
      sample: z.literal(3),
      reasonCode: z.literal("facade_or_exterior_pixels"),
    })
    .strict(),
  z
    .object({
      sample: z.literal(4),
      reasonCode: z.literal("capture_artifact_outside_verified_room"),
    })
    .strict(),
  z
    .object({
      sample: z.literal(5),
      reasonCode: z.literal("unverified_or_unknown_pixels"),
    })
    .strict(),
]);

const ReasonMapBindingSchema = z
  .object({
    fileName: SafeLeafNameSchema,
    sha256: GrandHallT554NativeReviewSha256V2Schema,
    byteLength: ArtifactByteLengthSchema,
    widthPx: z.literal(GRAND_HALL_PANORAMA_WIDTH_PX),
    heightPx: z.literal(GRAND_HALL_PANORAMA_HEIGHT_PX),
    bitDepth: z.literal(8),
    channelCount: z.literal(1),
    permittedPixelValues: z.tuple([
      z.literal(0),
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
    ]),
    zeroMeaning: z.literal("grand_hall_included"),
    reasonSampleCodebook: ReasonSampleCodebookSchema,
  })
  .strict();

const PreparedMaskFileBindingSchema = z
  .object({
    fileName: SafeLeafNameSchema,
    sha256: GrandHallT554NativeReviewSha256V2Schema,
    byteLength: ArtifactByteLengthSchema,
    widthPx: z.literal(GRAND_HALL_PANORAMA_WIDTH_PX),
    heightPx: z.literal(GRAND_HALL_PANORAMA_HEIGHT_PX),
    bitDepth: z.literal(8),
    channelCount: z.literal(1),
    permittedPixelValues: z.tuple([z.literal(0), z.literal(255)]),
    zeroMeaning: z.literal("grand_hall_included"),
    twoHundredFiftyFiveMeaning: z.literal("excluded_or_unknown"),
  })
  .strict();

export const GrandHallT554NativeReviewPreparedMaskBindingV2Schema = z
  .object({
    schemaVersion: z.literal(
      "venviewer.grand-hall-t554-native-mask-prepared-binding.v2",
    ),
    source: GrandHallPanoramaSourceJpgIdentityV2Schema,
    revision: MaskRevisionSchema,
    includedPixelCount: z.number().int().nonnegative().max(SOURCE_PIXEL_COUNT),
    excludedPixelCount: z.number().int().nonnegative().max(SOURCE_PIXEL_COUNT),
    reasonCounts: ReasonCountsSchema,
    mask: PreparedMaskFileBindingSchema,
    reasonMap: ReasonMapBindingSchema,
  })
  .strict()
  .superRefine((binding, context) => {
    if (
      binding.includedPixelCount + binding.excludedPixelCount !==
      SOURCE_PIXEL_COUNT
    ) {
      addIssue(
        context,
        ["excludedPixelCount"],
        "prepared counts must cover the source grid",
      );
    }
    const reasonTotal = binding.reasonCounts.reduce(
      (sum, entry) => sum + entry.pixelCount,
      0,
    );
    if (reasonTotal !== binding.excludedPixelCount) {
      addIssue(
        context,
        ["reasonCounts"],
        "prepared reasons must equal excluded pixels",
      );
    }
    if (binding.mask.fileName === binding.reasonMap.fileName) {
      addIssue(
        context,
        ["reasonMap", "fileName"],
        "prepared mask filenames must differ",
      );
    }
  });

export type GrandHallT554NativeReviewPreparedMaskBindingV2 = z.infer<
  typeof GrandHallT554NativeReviewPreparedMaskBindingV2Schema
>;

export const GrandHallT554NativeReviewFrozenMaskBindingV2Schema = z
  .object({
    schemaVersion: z.literal(
      "venviewer.grand-hall-t554-native-mask-frozen-binding.v2",
    ),
    source: GrandHallPanoramaSourceJpgIdentityV2Schema,
    revision: MaskRevisionSchema,
    fileName: SafeLeafNameSchema,
    sha256: GrandHallT554NativeReviewSha256V2Schema,
    byteLength: ArtifactByteLengthSchema,
    widthPx: z.literal(GRAND_HALL_PANORAMA_WIDTH_PX),
    heightPx: z.literal(GRAND_HALL_PANORAMA_HEIGHT_PX),
    bitDepth: z.literal(8),
    channelCount: z.literal(1),
    permittedPixelValues: z.tuple([z.literal(0), z.literal(255)]),
    zeroMeaning: z.literal("grand_hall_included"),
    twoHundredFiftyFiveMeaning: z.literal("excluded_or_unknown"),
    includedPixelCount: z.number().int().nonnegative().max(SOURCE_PIXEL_COUNT),
    excludedPixelCount: z.number().int().nonnegative().max(SOURCE_PIXEL_COUNT),
    reasonCounts: ReasonCountsSchema,
    publicationDurability: z.enum([
      "directory_fsync",
      "windows_file_fsync_fallback",
    ]),
    immutableFrozen: z.literal(true),
    reasonMap: ReasonMapBindingSchema,
  })
  .strict()
  .superRefine((binding, context) => {
    if (
      binding.includedPixelCount + binding.excludedPixelCount !==
      SOURCE_PIXEL_COUNT
    ) {
      addIssue(
        context,
        ["excludedPixelCount"],
        "included and excluded counts must cover the source grid",
      );
    }
    const reasonTotal = binding.reasonCounts.reduce(
      (sum, entry) => sum + entry.pixelCount,
      0,
    );
    if (reasonTotal !== binding.excludedPixelCount) {
      addIssue(
        context,
        ["reasonCounts"],
        "reason counts must equal the excluded pixel count",
      );
    }
    if (binding.fileName === binding.reasonMap.fileName) {
      addIssue(
        context,
        ["reasonMap", "fileName"],
        "mask and reason-map filenames must differ",
      );
    }
  });

export type GrandHallT554NativeReviewFrozenMaskBindingV2 = z.infer<
  typeof GrandHallT554NativeReviewFrozenMaskBindingV2Schema
>;

const ScopeCommonShape = {
  schemaVersion: z.literal(GRAND_HALL_T554_NATIVE_REVIEW_JOURNAL_SCOPE_V2),
  sessionIdSha256: GrandHallT554NativeReviewSha256V2Schema,
  implementationManifest:
    GrandHallT554NativeReviewImplementationManifestBindingV2Schema,
  registry: GrandHallT554NativeReviewRegistryBindingV2Schema,
  authorityBoundary: GrandHallT554NativeReviewAuthorityBoundaryV2Schema,
};

export const GrandHallT554NativeReviewSessionScopeV2Schema = z
  .object({
    ...ScopeCommonShape,
    kind: z.literal("session"),
    subjectSha256: GrandHallT554NativeReviewSha256V2Schema,
  })
  .strict();

export const GrandHallT554NativeReviewSourceScopeV2Schema = z
  .object({
    ...ScopeCommonShape,
    kind: z.literal("source"),
    browserEpochNonceSha256: GrandHallT554NativeReviewSha256V2Schema,
    coverageSegmentIdSha256: GrandHallT554NativeReviewSha256V2Schema,
    renderGeneration: RenderGenerationSchema,
    sourceCustody: GrandHallT554NativeReviewSourceCustodyBindingV2Schema,
  })
  .strict()
  .superRefine((scope, context) => {
    if (
      scope.renderGeneration !== scope.sourceCustody.sourceEpochRenderGeneration
    ) {
      addIssue(
        context,
        ["renderGeneration"],
        "source-review render generation must equal the source-epoch generation",
      );
    }
  });

export const GrandHallT554NativeReviewMaskScopeV2Schema = z
  .object({
    ...ScopeCommonShape,
    kind: z.literal("mask"),
    browserEpochNonceSha256: GrandHallT554NativeReviewSha256V2Schema,
    coverageSegmentIdSha256: GrandHallT554NativeReviewSha256V2Schema,
    renderGeneration: RenderGenerationSchema,
    sourceCustody: GrandHallT554NativeReviewSourceCustodyBindingV2Schema,
    maskReviewSubjectSha256: GrandHallT554NativeReviewSha256V2Schema,
    maskStateSha256: GrandHallT554NativeReviewSha256V2Schema,
    frozenBindingSha256: GrandHallT554NativeReviewSha256V2Schema,
    frozenBinding: GrandHallT554NativeReviewFrozenMaskBindingV2Schema,
  })
  .strict()
  .superRefine((scope, context) => {
    if (
      !sameSourceIdentity(
        scope.sourceCustody.source,
        scope.frozenBinding.source,
      )
    ) {
      addIssue(
        context,
        ["frozenBinding", "source"],
        "frozen mask must bind the scoped source",
      );
    }
    if (
      scope.frozenBinding.revision === 0 ||
      scope.frozenBinding.includedPixelCount === 0
    ) {
      addIssue(
        context,
        ["frozenBinding"],
        "mask-review scope requires an edited frozen mask with included pixels",
      );
    }
  });

export const GrandHallT554NativeReviewJournalScopeV2Schema = z.union([
  GrandHallT554NativeReviewSessionScopeV2Schema,
  GrandHallT554NativeReviewSourceScopeV2Schema,
  GrandHallT554NativeReviewMaskScopeV2Schema,
]);

export type GrandHallT554NativeReviewSessionScopeV2 = z.infer<
  typeof GrandHallT554NativeReviewSessionScopeV2Schema
>;
export type GrandHallT554NativeReviewSourceScopeV2 = z.infer<
  typeof GrandHallT554NativeReviewSourceScopeV2Schema
>;
export type GrandHallT554NativeReviewMaskScopeV2 = z.infer<
  typeof GrandHallT554NativeReviewMaskScopeV2Schema
>;
export type GrandHallT554NativeReviewJournalScopeV2 = z.infer<
  typeof GrandHallT554NativeReviewJournalScopeV2Schema
>;

const ChildJournalCheckpointCommonShape = {
  schemaVersion: z.literal(
    "venviewer.grand-hall-t554-native-review-child-checkpoint.v2",
  ),
  leafName: SafeLeafNameSchema,
  scopeSha256: GrandHallT554NativeReviewSha256V2Schema,
  scopeFileSha256: GrandHallT554NativeReviewSha256V2Schema,
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  headEventSha256: GrandHallT554NativeReviewSha256V2Schema,
  journalInventorySha256: GrandHallT554NativeReviewSha256V2Schema,
};

export const GrandHallT554NativeReviewSourceChildCheckpointV2Schema = z
  .object({
    ...ChildJournalCheckpointCommonShape,
    kind: z.literal("source"),
  })
  .strict();

export const GrandHallT554NativeReviewMaskChildCheckpointV2Schema = z
  .object({
    ...ChildJournalCheckpointCommonShape,
    kind: z.literal("mask"),
  })
  .strict();

export const GrandHallT554NativeReviewChildCheckpointV2Schema =
  z.discriminatedUnion("kind", [
    GrandHallT554NativeReviewSourceChildCheckpointV2Schema,
    GrandHallT554NativeReviewMaskChildCheckpointV2Schema,
  ]);

export type GrandHallT554NativeReviewSourceChildCheckpointV2 = z.infer<
  typeof GrandHallT554NativeReviewSourceChildCheckpointV2Schema
>;
export type GrandHallT554NativeReviewMaskChildCheckpointV2 = z.infer<
  typeof GrandHallT554NativeReviewMaskChildCheckpointV2Schema
>;
export type GrandHallT554NativeReviewChildCheckpointV2 = z.infer<
  typeof GrandHallT554NativeReviewChildCheckpointV2Schema
>;

export const GrandHallT554NativeReviewCompletedSourceCoverageV2Schema = z
  .object({
    schemaVersion: z.literal(
      "venviewer.grand-hall-t554-native-review-completed-source-coverage.v2",
    ),
    sourceReviewSubjectSha256: GrandHallT554NativeReviewSha256V2Schema,
    sourceJournal: GrandHallT554NativeReviewSourceChildCheckpointV2Schema,
    completedTileBitsetHex: z.literal(FULL_TILE_BITMAP_HEX),
    completedTileCount: z.literal(GRAND_HALL_T554_NATIVE_TILE_COUNT),
    cumulativeDwellStateSha256: GrandHallT554NativeReviewSha256V2Schema,
  })
  .strict();

export type GrandHallT554NativeReviewCompletedSourceCoverageV2 = z.infer<
  typeof GrandHallT554NativeReviewCompletedSourceCoverageV2Schema
>;

export const GrandHallT554NativeReviewCompletedMaskCoverageV2Schema = z
  .object({
    schemaVersion: z.literal(
      "venviewer.grand-hall-t554-native-review-completed-mask-coverage.v2",
    ),
    maskReviewSubjectSha256: GrandHallT554NativeReviewSha256V2Schema,
    maskStateSha256: GrandHallT554NativeReviewSha256V2Schema,
    frozenBindingSha256: GrandHallT554NativeReviewSha256V2Schema,
    maskJournal: GrandHallT554NativeReviewMaskChildCheckpointV2Schema,
    completedTileBitsetHex: z.literal(FULL_TILE_BITMAP_HEX),
    completedTileCount: z.literal(GRAND_HALL_T554_NATIVE_TILE_COUNT),
    cumulativeDwellStateSha256: GrandHallT554NativeReviewSha256V2Schema,
  })
  .strict();

export type GrandHallT554NativeReviewCompletedMaskCoverageV2 = z.infer<
  typeof GrandHallT554NativeReviewCompletedMaskCoverageV2Schema
>;

const DwellVectorBase64urlSchema = z
  .string()
  .regex(
    new RegExp(
      `^[A-Za-z0-9_-]{${String(DWELL_VECTOR_BASE64URL_LENGTH)}}$`,
      "u",
    ),
  )
  .refine((value) => {
    const bytes = Buffer.from(value, "base64url");
    return (
      bytes.length === DWELL_VECTOR_BYTE_LENGTH &&
      bytes.toString("base64url") === value
    );
  }, "dwell vector must be canonical unpadded base64url for exactly 512 Uint16LE cells");

const CoverageCarryEvidenceShape = {
  sessionIdSha256: GrandHallT554NativeReviewSha256V2Schema,
  registry: GrandHallT554NativeReviewRegistryBindingV2Schema,
  implementationManifest:
    GrandHallT554NativeReviewImplementationManifestBindingV2Schema,
  sourceCustody: GrandHallT554NativeReviewSourceCustodyBindingV2Schema,
  priorBrowserEpochNonceSha256: GrandHallT554NativeReviewSha256V2Schema,
  priorSourceEpochBindingSha256: GrandHallT554NativeReviewSha256V2Schema,
  priorSourceEpochNonceSha256: GrandHallT554NativeReviewSha256V2Schema,
  priorSourceEpochRenderGeneration: RenderGenerationSchema,
  priorCoverageSegmentIdSha256: GrandHallT554NativeReviewSha256V2Schema,
  priorRenderGeneration: RenderGenerationSchema,
  predecessorFinalDurableRecordedAtUtc:
    GrandHallT554NativeReviewCanonicalUtcV2Schema,
  cappedDwellMsUint16LeBase64url: DwellVectorBase64urlSchema,
  cappedDwellBytesSha256: GrandHallT554NativeReviewSha256V2Schema,
  completedTileBitsetHex: GrandHallT554NativeReviewTileBitmapHexV2Schema,
  completedTileCount: z
    .number()
    .int()
    .nonnegative()
    .max(GRAND_HALL_T554_NATIVE_TILE_COUNT),
  cumulativeDwellStateSha256: GrandHallT554NativeReviewSha256V2Schema,
};

function validateCoverageCarry(
  carry: {
    readonly sourceCustody: GrandHallT554NativeReviewSourceCustodyBindingV2;
    readonly priorSourceEpochBindingSha256: string;
    readonly priorSourceEpochNonceSha256: string;
    readonly priorSourceEpochRenderGeneration: number;
    readonly cappedDwellMsUint16LeBase64url: string;
    readonly cappedDwellBytesSha256: string;
    readonly completedTileBitsetHex: string;
    readonly completedTileCount: number;
    readonly cumulativeDwellStateSha256: string;
  },
  context: z.RefinementCtx,
): void {
  if (
    carry.priorSourceEpochBindingSha256 !==
      carry.sourceCustody.sourceEpochBindingSha256 ||
    carry.priorSourceEpochNonceSha256 !==
      carry.sourceCustody.sourceEpochNonceSha256 ||
    carry.priorSourceEpochRenderGeneration !==
      carry.sourceCustody.sourceEpochRenderGeneration
  ) {
    addIssue(
      context,
      ["sourceCustody"],
      "carried prior source-epoch witnesses must match source custody",
    );
  }
  const bytes = Buffer.from(carry.cappedDwellMsUint16LeBase64url, "base64url");
  if (sha256(bytes) !== carry.cappedDwellBytesSha256) {
    addIssue(
      context,
      ["cappedDwellBytesSha256"],
      "dwell vector digest does not match its bytes",
    );
  }
  if (dwellStateSha256(bytes) !== carry.cumulativeDwellStateSha256) {
    addIssue(
      context,
      ["cumulativeDwellStateSha256"],
      "cumulative dwell-state digest does not match its bytes",
    );
  }
  const completed = Buffer.alloc(
    Math.ceil(GRAND_HALL_T554_NATIVE_TILE_COUNT / 8),
  );
  for (let index = 0; index < GRAND_HALL_T554_NATIVE_TILE_COUNT; index += 1) {
    const dwell = bytes.readUInt16LE(index * 2);
    if (dwell > GRAND_HALL_T554_MINIMUM_DWELL_MS_PER_TILE) {
      addIssue(
        context,
        ["cappedDwellMsUint16LeBase64url"],
        "dwell values must be capped at 750 ms",
      );
      return;
    }
    if (dwell === GRAND_HALL_T554_MINIMUM_DWELL_MS_PER_TILE) {
      const byteIndex = Math.floor(index / 8);
      const bitIndex = index % 8;
      completed[byteIndex] = (completed[byteIndex] ?? 0) | (1 << bitIndex);
    }
  }
  if (completed.toString("hex") !== carry.completedTileBitsetHex) {
    addIssue(
      context,
      ["completedTileBitsetHex"],
      "completed bitmap does not match the dwell vector",
    );
  }
  if (
    bitmapPopcount(carry.completedTileBitsetHex) !== carry.completedTileCount
  ) {
    addIssue(
      context,
      ["completedTileCount"],
      "completed count does not match its bitmap",
    );
  }
}

export const GrandHallT554NativeReviewSourceCoverageCarryStateV2Schema = z
  .object({
    schemaVersion: z.literal(
      "venviewer.grand-hall-t554-native-review-coverage-carry-state.v2",
    ),
    kind: z.literal("source"),
    subjectSha256: GrandHallT554NativeReviewSha256V2Schema,
    predecessorJournal: GrandHallT554NativeReviewSourceChildCheckpointV2Schema,
    ...CoverageCarryEvidenceShape,
  })
  .strict()
  .superRefine((carry, context) => {
    validateCoverageCarry(carry, context);
    if (carry.subjectSha256 !== carry.sourceCustody.sourceReviewSubjectSha256) {
      addIssue(
        context,
        ["subjectSha256"],
        "carried source coverage must bind its stable subject",
      );
    }
  });

export const GrandHallT554NativeReviewMaskCoverageCarryStateV2Schema = z
  .object({
    schemaVersion: z.literal(
      "venviewer.grand-hall-t554-native-review-coverage-carry-state.v2",
    ),
    kind: z.literal("mask"),
    subjectSha256: GrandHallT554NativeReviewSha256V2Schema,
    predecessorJournal: GrandHallT554NativeReviewMaskChildCheckpointV2Schema,
    maskStateSha256: GrandHallT554NativeReviewSha256V2Schema,
    frozenBindingSha256: GrandHallT554NativeReviewSha256V2Schema,
    frozenBinding: GrandHallT554NativeReviewFrozenMaskBindingV2Schema,
    ...CoverageCarryEvidenceShape,
  })
  .strict()
  .superRefine((carry, context) => {
    validateCoverageCarry(carry, context);
    if (
      !sameSourceIdentity(
        carry.sourceCustody.source,
        carry.frozenBinding.source,
      )
    ) {
      addIssue(
        context,
        ["frozenBinding", "source"],
        "carried mask coverage must bind the source",
      );
    }
    if (
      carry.frozenBinding.revision === 0 ||
      carry.frozenBinding.includedPixelCount === 0
    ) {
      addIssue(
        context,
        ["frozenBinding"],
        "carried mask coverage requires an edited frozen mask with included pixels",
      );
    }
  });

export const GrandHallT554NativeReviewCoverageCarryStateV2Schema = z.union([
  GrandHallT554NativeReviewSourceCoverageCarryStateV2Schema,
  GrandHallT554NativeReviewMaskCoverageCarryStateV2Schema,
]);

export type GrandHallT554NativeReviewSourceCoverageCarryStateV2 = z.infer<
  typeof GrandHallT554NativeReviewSourceCoverageCarryStateV2Schema
>;
export type GrandHallT554NativeReviewMaskCoverageCarryStateV2 = z.infer<
  typeof GrandHallT554NativeReviewMaskCoverageCarryStateV2Schema
>;
export type GrandHallT554NativeReviewCoverageCarryStateV2 = z.infer<
  typeof GrandHallT554NativeReviewCoverageCarryStateV2Schema
>;

const PixelCoordinateXSchema = z
  .number()
  .int()
  .min(0)
  .max(GRAND_HALL_PANORAMA_WIDTH_PX);
const PixelCoordinateYSchema = z
  .number()
  .int()
  .min(0)
  .max(GRAND_HALL_PANORAMA_HEIGHT_PX);

const RectanglePrimitiveSchema = z
  .object({
    kind: z.literal("rectangle"),
    horizontalSeam: z.enum(["none", "wrap"]),
    leftPx: PixelCoordinateXSchema,
    topPx: PixelCoordinateYSchema,
    rightExclusivePx: PixelCoordinateXSchema,
    bottomExclusivePx: PixelCoordinateYSchema,
  })
  .strict()
  .superRefine((rectangle, context) => {
    if (rectangle.topPx >= rectangle.bottomExclusivePx) {
      addIssue(
        context,
        ["bottomExclusivePx"],
        "rectangle must contain a source-grid row",
      );
    }
    if (
      rectangle.horizontalSeam === "none" &&
      rectangle.leftPx >= rectangle.rightExclusivePx
    ) {
      addIssue(
        context,
        ["rightExclusivePx"],
        "non-wrapping rectangle must increase left-to-right",
      );
    }
    if (
      rectangle.horizontalSeam === "wrap" &&
      (rectangle.leftPx <= rectangle.rightExclusivePx ||
        rectangle.leftPx === GRAND_HALL_PANORAMA_WIDTH_PX)
    ) {
      addIssue(
        context,
        ["horizontalSeam"],
        "wrapping rectangle must cross the horizontal seam",
      );
    }
  });

const PolygonPrimitiveSchema = z
  .object({
    kind: z.literal("polygon"),
    horizontalSeam: z.enum(["none", "wrap_shortest"]),
    points: z
      .array(
        z
          .object({ xPx: PixelCoordinateXSchema, yPx: PixelCoordinateYSchema })
          .strict(),
      )
      .min(3)
      .max(GRAND_HALL_T554_NATIVE_MASK_MAX_POLYGON_VERTEX_COUNT),
  })
  .strict();

export const GrandHallT554NativeReviewMaskPrimitiveV2Schema = z.union([
  RectanglePrimitiveSchema,
  PolygonPrimitiveSchema,
]);

export const GrandHallT554NativeReviewMaskEditV2Schema = z.discriminatedUnion(
  "operation",
  [
    z
      .object({
        expectedRevision: MaskRevisionSchema,
        operation: z.literal("include"),
        primitive: GrandHallT554NativeReviewMaskPrimitiveV2Schema,
      })
      .strict(),
    z
      .object({
        expectedRevision: MaskRevisionSchema,
        operation: z.literal("exclude"),
        reasonCode: z.enum(GRAND_HALL_T554_NATIVE_MASK_REASON_CODES),
        primitive: GrandHallT554NativeReviewMaskPrimitiveV2Schema,
      })
      .strict(),
  ],
);

export type GrandHallT554NativeReviewMaskPrimitiveV2 = z.infer<
  typeof GrandHallT554NativeReviewMaskPrimitiveV2Schema
>;
export type GrandHallT554NativeReviewMaskEditV2 = z.infer<
  typeof GrandHallT554NativeReviewMaskEditV2Schema
>;

export const GrandHallT554NativeReviewMaskStateEvidenceV2Schema = z
  .object({
    revision: MaskRevisionSchema,
    maskStateSha256: GrandHallT554NativeReviewSha256V2Schema,
    includedPixelCount: z.number().int().nonnegative().max(SOURCE_PIXEL_COUNT),
    excludedPixelCount: z.number().int().nonnegative().max(SOURCE_PIXEL_COUNT),
    reasonCounts: ReasonCountsSchema,
  })
  .strict()
  .superRefine((state, context) => {
    if (
      state.includedPixelCount + state.excludedPixelCount !==
      SOURCE_PIXEL_COUNT
    ) {
      addIssue(
        context,
        ["excludedPixelCount"],
        "mask-state counts must cover the source grid",
      );
    }
    const reasonTotal = state.reasonCounts.reduce(
      (sum, entry) => sum + entry.pixelCount,
      0,
    );
    if (reasonTotal !== state.excludedPixelCount) {
      addIssue(
        context,
        ["reasonCounts"],
        "mask-state reasons must equal excluded pixels",
      );
    }
  });

export type GrandHallT554NativeReviewMaskStateEvidenceV2 = z.infer<
  typeof GrandHallT554NativeReviewMaskStateEvidenceV2Schema
>;

const SourceBindingPayloadShape = {
  sourceCustody: GrandHallT554NativeReviewSourceCustodyBindingV2Schema,
};

const WorkspaceAdvanceShape = {
  previousWorkspaceRevision: WorkspaceRevisionSchema,
  resultingWorkspaceRevision: WorkspaceRevisionSchema,
};

function validateWorkspaceAdvance(
  value: {
    readonly previousWorkspaceRevision: number;
    readonly resultingWorkspaceRevision: number;
  },
  context: z.RefinementCtx,
): void {
  if (
    value.resultingWorkspaceRevision !==
    value.previousWorkspaceRevision + 1
  ) {
    addIssue(
      context,
      ["resultingWorkspaceRevision"],
      "committed mutation must advance workspace once",
    );
  }
}

function validateGenerationAdvance(
  previous: number,
  resulting: number,
  context: z.RefinementCtx,
  path: readonly (string | number)[] = ["resultingRenderGeneration"],
): void {
  if (resulting <= previous) {
    addIssue(context, path, "render generation must advance monotonically");
  }
}

function sameImplementationBinding(
  left: GrandHallT554NativeReviewImplementationManifestBindingV2,
  right: GrandHallT554NativeReviewImplementationManifestBindingV2,
): boolean {
  return (
    left.semanticSha256 === right.semanticSha256 &&
    left.fileSha256 === right.fileSha256 &&
    left.byteLength === right.byteLength
  );
}

function sameSourceIdentity(
  left: GrandHallPanoramaSourceJpgIdentityV2,
  right: GrandHallPanoramaSourceJpgIdentityV2,
): boolean {
  return (
    left.inventoryIndex === right.inventoryIndex &&
    left.sweepNumber === right.sweepNumber &&
    left.fileName === right.fileName &&
    left.sha256 === right.sha256 &&
    left.byteLength === right.byteLength
  );
}

function sameStableSourceCustody(
  left: GrandHallT554NativeReviewSourceCustodyBindingV2,
  right: GrandHallT554NativeReviewSourceCustodyBindingV2,
): boolean {
  return (
    left.sourceReviewSubjectSha256 === right.sourceReviewSubjectSha256 &&
    left.source.fileName === right.source.fileName &&
    left.source.sha256 === right.source.sha256 &&
    left.source.byteLength === right.source.byteLength &&
    left.source.inventoryIndex === right.source.inventoryIndex &&
    left.source.sweepNumber === right.source.sweepNumber &&
    left.sourceVerification.decodedPixelSha256 ===
      right.sourceVerification.decodedPixelSha256 &&
    left.sourceVerification.descriptorWitnessSha256 ===
      right.sourceVerification.descriptorWitnessSha256 &&
    left.sourceVerification.decoderIdentity.sharpVersion ===
      right.sourceVerification.decoderIdentity.sharpVersion &&
    left.sourceVerification.decoderIdentity.libvipsVersion ===
      right.sourceVerification.decoderIdentity.libvipsVersion
  );
}

function sameExactSourceCustody(
  left: GrandHallT554NativeReviewSourceCustodyBindingV2,
  right: GrandHallT554NativeReviewSourceCustodyBindingV2,
): boolean {
  return (
    sameStableSourceCustody(left, right) &&
    left.sourceEpochBindingSha256 === right.sourceEpochBindingSha256 &&
    left.sourceEpochNonceSha256 === right.sourceEpochNonceSha256 &&
    left.sourceEpochRenderGeneration === right.sourceEpochRenderGeneration
  );
}

function sameRegistryBinding(
  left: GrandHallT554NativeReviewRegistryBindingV2,
  right: GrandHallT554NativeReviewRegistryBindingV2,
): boolean {
  return (
    left.reviewPack.semanticSha256 === right.reviewPack.semanticSha256 &&
    left.reviewPack.fileSha256 === right.reviewPack.fileSha256 &&
    left.reviewPack.byteLength === right.reviewPack.byteLength &&
    left.publicationReceipt.semanticSha256 ===
      right.publicationReceipt.semanticSha256 &&
    left.publicationReceipt.fileSha256 ===
      right.publicationReceipt.fileSha256 &&
    left.publicationReceipt.byteLength === right.publicationReceipt.byteLength
  );
}

function sameFrozenBinding(
  left: GrandHallT554NativeReviewFrozenMaskBindingV2,
  right: GrandHallT554NativeReviewFrozenMaskBindingV2,
): boolean {
  return (
    sameSourceIdentity(left.source, right.source) &&
    left.revision === right.revision &&
    left.fileName === right.fileName &&
    left.sha256 === right.sha256 &&
    left.byteLength === right.byteLength &&
    left.includedPixelCount === right.includedPixelCount &&
    left.excludedPixelCount === right.excludedPixelCount &&
    left.publicationDurability === right.publicationDurability &&
    left.reasonMap.fileName === right.reasonMap.fileName &&
    left.reasonMap.sha256 === right.reasonMap.sha256 &&
    left.reasonMap.byteLength === right.reasonMap.byteLength &&
    left.reasonCounts.length === right.reasonCounts.length &&
    left.reasonCounts.every((entry, index) => {
      const peer = right.reasonCounts[index];
      return (
        peer !== undefined &&
        entry.reasonCode === peer.reasonCode &&
        entry.pixelCount === peer.pixelCount
      );
    })
  );
}

function sameChildCheckpoint(
  left: GrandHallT554NativeReviewChildCheckpointV2,
  right: GrandHallT554NativeReviewChildCheckpointV2,
): boolean {
  return (
    left.kind === right.kind &&
    left.leafName === right.leafName &&
    left.scopeSha256 === right.scopeSha256 &&
    left.scopeFileSha256 === right.scopeFileSha256 &&
    left.revision === right.revision &&
    left.headEventSha256 === right.headEventSha256 &&
    left.journalInventorySha256 === right.journalInventorySha256
  );
}

export const GrandHallT554NativeReviewSessionCreatedPayloadV2Schema = z
  .object({
    schemaVersion: z.literal(
      "venviewer.grand-hall-t554-native-review-session-created.v2",
    ),
    sessionIdSha256: GrandHallT554NativeReviewSha256V2Schema,
    workspaceRevision: z.literal(0),
    maximumAllocatedRenderGeneration: z.literal(0),
    registry: GrandHallT554NativeReviewRegistryBindingV2Schema,
    implementationManifest:
      GrandHallT554NativeReviewImplementationManifestBindingV2Schema,
    authorityBoundary: GrandHallT554NativeReviewAuthorityBoundaryV2Schema,
  })
  .strict();

export const GrandHallT554NativeReviewBrowserEpochStartedPayloadV2Schema = z
  .object({
    schemaVersion: z.literal(
      "venviewer.grand-hall-t554-native-review-browser-epoch-started.v2",
    ),
    browserEpochNumber: BrowserEpochNumberSchema,
    browserEpochNonceSha256: GrandHallT554NativeReviewSha256V2Schema,
    previousBrowserEpochNonceSha256:
      GrandHallT554NativeReviewSha256V2Schema.nullable(),
    reason: z.enum(["session_created", "crash_resume"]),
    workspaceRevision: WorkspaceRevisionSchema,
    maximumAllocatedRenderGeneration: WorkspaceRevisionSchema,
    startedAtUtc: GrandHallT554NativeReviewCanonicalUtcV2Schema,
  })
  .strict()
  .superRefine((event, context) => {
    if (event.reason === "session_created") {
      if (event.browserEpochNumber !== 1) {
        addIssue(
          context,
          ["browserEpochNumber"],
          "created session must begin browser epoch one",
        );
      }
      if (event.previousBrowserEpochNonceSha256 !== null) {
        addIssue(
          context,
          ["previousBrowserEpochNonceSha256"],
          "first browser epoch has no predecessor",
        );
      }
    } else if (
      event.browserEpochNumber < 2 ||
      event.previousBrowserEpochNonceSha256 === null
    ) {
      addIssue(
        context,
        ["reason"],
        "crash resume must rotate a prior browser epoch",
      );
    }
  });

export const GrandHallT554NativeReviewSourceSelectionIntendedPayloadV2Schema = z
  .object({
    schemaVersion: z.literal(
      "venviewer.grand-hall-t554-native-review-source-selection-intended.v2",
    ),
    operationIdSha256: GrandHallT554NativeReviewSha256V2Schema,
    browserEpochNonceSha256: GrandHallT554NativeReviewSha256V2Schema,
    expectedWorkspaceRevision: WorkspaceRevisionSchema,
    source: GrandHallPanoramaSourceJpgIdentityV2Schema,
    sourceEpochNonceSha256: GrandHallT554NativeReviewSha256V2Schema,
    coverageSegmentIdSha256: GrandHallT554NativeReviewSha256V2Schema,
    previousRenderGeneration: WorkspaceRevisionSchema,
    allocatedRenderGeneration: RenderGenerationSchema,
    childJournalLeafName: SafeLeafNameSchema,
    priorActiveSourceJournal:
      GrandHallT554NativeReviewSourceChildCheckpointV2Schema.nullable(),
  })
  .strict()
  .superRefine((event, context) => {
    validateGenerationAdvance(
      event.previousRenderGeneration,
      event.allocatedRenderGeneration,
      context,
      ["allocatedRenderGeneration"],
    );
  });

export const GrandHallT554NativeReviewSourceSelectionCommittedPayloadV2Schema =
  z
    .object({
      schemaVersion: z.literal(
        "venviewer.grand-hall-t554-native-review-source-selection-committed.v2",
      ),
      operationIdSha256: GrandHallT554NativeReviewSha256V2Schema,
      browserEpochNonceSha256: GrandHallT554NativeReviewSha256V2Schema,
      coverageSegmentIdSha256: GrandHallT554NativeReviewSha256V2Schema,
      ...WorkspaceAdvanceShape,
      renderGeneration: RenderGenerationSchema,
      ...SourceBindingPayloadShape,
      sourceJournal: GrandHallT554NativeReviewSourceChildCheckpointV2Schema,
    })
    .strict()
    .superRefine((event, context) => {
      validateWorkspaceAdvance(event, context);
      if (
        event.renderGeneration !==
        event.sourceCustody.sourceEpochRenderGeneration
      ) {
        addIssue(
          context,
          ["renderGeneration"],
          "selected source generation must equal its epoch generation",
        );
      }
    });

const SourceRecoveryDispositionSchema = z.discriminatedUnion(
  "childDisposition",
  [
    z
      .object({
        childDisposition: z.literal("absent"),
        abandonedChildJournal: z.null(),
      })
      .strict(),
    z
      .object({
        childDisposition: z.literal("exact_abandoned"),
        abandonedChildJournal:
          GrandHallT554NativeReviewSourceChildCheckpointV2Schema,
      })
      .strict(),
  ],
);

export const GrandHallT554NativeReviewSourceSelectionRecoveryAbortedPayloadV2Schema =
  z
    .object({
      schemaVersion: z.literal(
        "venviewer.grand-hall-t554-native-review-source-selection-recovery-aborted.v2",
      ),
      operationIdSha256: GrandHallT554NativeReviewSha256V2Schema,
      browserEpochNonceSha256: GrandHallT554NativeReviewSha256V2Schema,
      workspaceRevision: WorkspaceRevisionSchema,
      consumedRenderGeneration: RenderGenerationSchema,
      recovery: SourceRecoveryDispositionSchema,
    })
    .strict();

export const GrandHallT554NativeReviewMaskWorkflowStartedPayloadV2Schema = z
  .object({
    schemaVersion: z.literal(
      "venviewer.grand-hall-t554-native-review-mask-workflow-started.v2",
    ),
    browserEpochNonceSha256: GrandHallT554NativeReviewSha256V2Schema,
    ...WorkspaceAdvanceShape,
    ...SourceBindingPayloadShape,
    previousRenderGeneration: RenderGenerationSchema,
    resultingRenderGeneration: RenderGenerationSchema,
    completedSourceCoverage:
      GrandHallT554NativeReviewCompletedSourceCoverageV2Schema,
    initialMaskState: GrandHallT554NativeReviewMaskStateEvidenceV2Schema,
  })
  .strict()
  .superRefine((event, context) => {
    validateWorkspaceAdvance(event, context);
    validateGenerationAdvance(
      event.previousRenderGeneration,
      event.resultingRenderGeneration,
      context,
    );
    if (
      event.completedSourceCoverage.sourceReviewSubjectSha256 !==
      event.sourceCustody.sourceReviewSubjectSha256
    ) {
      addIssue(
        context,
        ["completedSourceCoverage", "sourceReviewSubjectSha256"],
        "mask workflow requires completed coverage for the active source subject",
      );
    }
    if (
      event.initialMaskState.revision !== 0 ||
      event.initialMaskState.includedPixelCount !== 0 ||
      event.initialMaskState.excludedPixelCount !== SOURCE_PIXEL_COUNT ||
      event.initialMaskState.reasonCounts.length !== 1 ||
      event.initialMaskState.reasonCounts[0]?.reasonCode !==
        "unverified_or_unknown_pixels" ||
      event.initialMaskState.reasonCounts[0]?.pixelCount !== SOURCE_PIXEL_COUNT
    ) {
      addIssue(
        context,
        ["initialMaskState"],
        "mask workflow must begin at the exact all-excluded state",
      );
    }
  });

export const GrandHallT554NativeReviewMaskEditedPayloadV2Schema = z
  .object({
    schemaVersion: z.literal(
      "venviewer.grand-hall-t554-native-review-mask-edited.v2",
    ),
    operationIdSha256: GrandHallT554NativeReviewSha256V2Schema,
    browserEpochNonceSha256: GrandHallT554NativeReviewSha256V2Schema,
    ...WorkspaceAdvanceShape,
    ...SourceBindingPayloadShape,
    previousRenderGeneration: RenderGenerationSchema,
    resultingRenderGeneration: RenderGenerationSchema,
    edit: GrandHallT554NativeReviewMaskEditV2Schema,
    previousMaskState: GrandHallT554NativeReviewMaskStateEvidenceV2Schema,
    resultingMaskState: GrandHallT554NativeReviewMaskStateEvidenceV2Schema,
    invalidatedFrozenBindingSha256:
      GrandHallT554NativeReviewSha256V2Schema.nullable(),
    invalidatedMaskJournal:
      GrandHallT554NativeReviewMaskChildCheckpointV2Schema.nullable(),
  })
  .strict()
  .superRefine((event, context) => {
    validateWorkspaceAdvance(event, context);
    validateGenerationAdvance(
      event.previousRenderGeneration,
      event.resultingRenderGeneration,
      context,
    );
    if (event.edit.expectedRevision !== event.previousMaskState.revision) {
      addIssue(
        context,
        ["edit", "expectedRevision"],
        "edit CAS must equal the prior mask revision",
      );
    }
    if (
      event.resultingMaskState.revision !==
      event.previousMaskState.revision + 1
    ) {
      addIssue(
        context,
        ["resultingMaskState", "revision"],
        "mask edit must advance one revision",
      );
    }
    if (
      (event.invalidatedFrozenBindingSha256 === null) !==
      (event.invalidatedMaskJournal === null)
    ) {
      addIssue(
        context,
        ["invalidatedMaskJournal"],
        "frozen binding and mask journal invalidate together",
      );
    }
  });

export const GrandHallT554NativeReviewMaskFreezeIntendedPayloadV2Schema = z
  .object({
    schemaVersion: z.literal(
      "venviewer.grand-hall-t554-native-review-mask-freeze-intended.v2",
    ),
    operationIdSha256: GrandHallT554NativeReviewSha256V2Schema,
    browserEpochNonceSha256: GrandHallT554NativeReviewSha256V2Schema,
    expectedWorkspaceRevision: WorkspaceRevisionSchema,
    ...SourceBindingPayloadShape,
    previousRenderGeneration: RenderGenerationSchema,
    allocatedRenderGeneration: RenderGenerationSchema,
    maskState: GrandHallT554NativeReviewMaskStateEvidenceV2Schema,
    maskReviewSubjectSha256: GrandHallT554NativeReviewSha256V2Schema,
    coverageSegmentIdSha256: GrandHallT554NativeReviewSha256V2Schema,
    preparedBindingSha256: GrandHallT554NativeReviewSha256V2Schema,
    preparedBinding: GrandHallT554NativeReviewPreparedMaskBindingV2Schema,
    childJournalLeafName: SafeLeafNameSchema,
  })
  .strict()
  .superRefine((event, context) => {
    validateGenerationAdvance(
      event.previousRenderGeneration,
      event.allocatedRenderGeneration,
      context,
      ["allocatedRenderGeneration"],
    );
    if (event.maskState.revision !== event.preparedBinding.revision) {
      addIssue(
        context,
        ["preparedBinding", "revision"],
        "prepared binding revision must match mask state",
      );
    }
    if (
      !sameSourceIdentity(
        event.sourceCustody.source,
        event.preparedBinding.source,
      )
    ) {
      addIssue(
        context,
        ["preparedBinding", "source"],
        "prepared binding must match source custody",
      );
    }
    if (
      event.maskState.revision === 0 ||
      event.maskState.includedPixelCount === 0
    ) {
      addIssue(
        context,
        ["maskState"],
        "INCLUDE freeze requires an edited mask with included pixels",
      );
    }
  });

export const GrandHallT554NativeReviewMaskFreezeCommittedPayloadV2Schema = z
  .object({
    schemaVersion: z.literal(
      "venviewer.grand-hall-t554-native-review-mask-freeze-committed.v2",
    ),
    operationIdSha256: GrandHallT554NativeReviewSha256V2Schema,
    browserEpochNonceSha256: GrandHallT554NativeReviewSha256V2Schema,
    ...WorkspaceAdvanceShape,
    ...SourceBindingPayloadShape,
    renderGeneration: RenderGenerationSchema,
    maskState: GrandHallT554NativeReviewMaskStateEvidenceV2Schema,
    maskReviewSubjectSha256: GrandHallT554NativeReviewSha256V2Schema,
    coverageSegmentIdSha256: GrandHallT554NativeReviewSha256V2Schema,
    frozenBindingSha256: GrandHallT554NativeReviewSha256V2Schema,
    frozenBinding: GrandHallT554NativeReviewFrozenMaskBindingV2Schema,
    maskJournal: GrandHallT554NativeReviewMaskChildCheckpointV2Schema,
  })
  .strict()
  .superRefine((event, context) => {
    validateWorkspaceAdvance(event, context);
    if (event.maskState.revision !== event.frozenBinding.revision) {
      addIssue(
        context,
        ["frozenBinding", "revision"],
        "committed frozen revision must match mask state",
      );
    }
    if (
      !sameSourceIdentity(
        event.sourceCustody.source,
        event.frozenBinding.source,
      )
    ) {
      addIssue(
        context,
        ["frozenBinding", "source"],
        "committed frozen binding must match source",
      );
    }
    if (
      event.maskState.revision === 0 ||
      event.maskState.includedPixelCount === 0
    ) {
      addIssue(
        context,
        ["maskState"],
        "committed INCLUDE freeze requires included pixels",
      );
    }
  });

const FreezePublicationDispositionSchema = z.enum([
  "none",
  "mask_only",
  "reason_map_only",
  "mask_and_reason_map",
]);

export const GrandHallT554NativeReviewMaskFreezeRecoveryAbortedPayloadV2Schema =
  z
    .object({
      schemaVersion: z.literal(
        "venviewer.grand-hall-t554-native-review-mask-freeze-recovery-aborted.v2",
      ),
      operationIdSha256: GrandHallT554NativeReviewSha256V2Schema,
      browserEpochNonceSha256: GrandHallT554NativeReviewSha256V2Schema,
      workspaceRevision: WorkspaceRevisionSchema,
      consumedRenderGeneration: RenderGenerationSchema,
      publicationDisposition: FreezePublicationDispositionSchema,
      abandonedMaskJournal:
        GrandHallT554NativeReviewMaskChildCheckpointV2Schema.nullable(),
    })
    .strict();

const CoverageSegmentResumeIntentCommonShape = {
  schemaVersion: z.literal(
    "venviewer.grand-hall-t554-native-review-coverage-segment-resume-intended.v2",
  ),
  operationIdSha256: GrandHallT554NativeReviewSha256V2Schema,
  browserEpochNonceSha256: GrandHallT554NativeReviewSha256V2Schema,
  expectedWorkspaceRevision: WorkspaceRevisionSchema,
  sourceCustodyBefore: GrandHallT554NativeReviewSourceCustodyBindingV2Schema,
  previousVisibleRenderGeneration: RenderGenerationSchema,
  previousMaximumAllocatedRenderGeneration: RenderGenerationSchema,
  allocatedRenderGeneration: RenderGenerationSchema,
  newSourceEpochNonceSha256: GrandHallT554NativeReviewSha256V2Schema,
  newCoverageSegmentIdSha256: GrandHallT554NativeReviewSha256V2Schema,
  childJournalLeafName: SafeLeafNameSchema,
};

function validateCoverageSegmentResumeIntentCommon(
  event: {
    readonly sourceCustodyBefore: GrandHallT554NativeReviewSourceCustodyBindingV2;
    readonly previousVisibleRenderGeneration: number;
    readonly previousMaximumAllocatedRenderGeneration: number;
    readonly allocatedRenderGeneration: number;
    readonly newSourceEpochNonceSha256: string;
    readonly newCoverageSegmentIdSha256: string;
  },
  context: z.RefinementCtx,
): void {
  validateGenerationAdvance(
    event.previousMaximumAllocatedRenderGeneration,
    event.allocatedRenderGeneration,
    context,
    ["allocatedRenderGeneration"],
  );
  if (
    event.previousVisibleRenderGeneration >
    event.previousMaximumAllocatedRenderGeneration
  ) {
    addIssue(
      context,
      ["previousVisibleRenderGeneration"],
      "visible generation cannot exceed the global allocation ceiling",
    );
  }
  if (
    event.newSourceEpochNonceSha256 ===
    event.sourceCustodyBefore.sourceEpochNonceSha256
  ) {
    addIssue(
      context,
      ["newSourceEpochNonceSha256"],
      "coverage resume must allocate a fresh source epoch nonce",
    );
  }
  if (
    event.newCoverageSegmentIdSha256 ===
    event.sourceCustodyBefore.sourceEpochBindingSha256
  ) {
    addIssue(
      context,
      ["newCoverageSegmentIdSha256"],
      "coverage segment identity must not alias the prior source epoch binding",
    );
  }
}

const SourceCoverageSegmentResumeIntendedPayloadV2Schema = z
  .object({
    ...CoverageSegmentResumeIntentCommonShape,
    kind: z.literal("source"),
    priorChildJournal:
      GrandHallT554NativeReviewSourceChildCheckpointV2Schema,
    predecessorCoverage:
      GrandHallT554NativeReviewSourceCoverageCarryStateV2Schema,
  })
  .strict();

const MaskCoverageSegmentResumeIntendedPayloadV2Schema = z
  .object({
    ...CoverageSegmentResumeIntentCommonShape,
    kind: z.literal("mask"),
    priorChildJournal: GrandHallT554NativeReviewMaskChildCheckpointV2Schema,
    predecessorCoverage:
      GrandHallT554NativeReviewMaskCoverageCarryStateV2Schema,
    maskState: GrandHallT554NativeReviewMaskStateEvidenceV2Schema,
    maskReviewSubjectSha256: GrandHallT554NativeReviewSha256V2Schema,
    frozenBindingSha256: GrandHallT554NativeReviewSha256V2Schema,
    frozenBinding: GrandHallT554NativeReviewFrozenMaskBindingV2Schema,
  })
  .strict();

export const GrandHallT554NativeReviewCoverageSegmentResumeIntendedPayloadV2Schema =
  z
    .discriminatedUnion("kind", [
      SourceCoverageSegmentResumeIntendedPayloadV2Schema,
      MaskCoverageSegmentResumeIntendedPayloadV2Schema,
    ])
    .superRefine((event, context) => {
    validateCoverageSegmentResumeIntentCommon(event, context);
    const carry = event.predecessorCoverage;
    if (
      !sameChildCheckpoint(
        carry.predecessorJournal,
        event.priorChildJournal,
      )
    ) {
      addIssue(
        context,
        ["predecessorCoverage", "predecessorJournal"],
        `${event.kind} carry must bind the exact finalized prior child checkpoint`,
      );
    }
    if (
      !sameStableSourceCustody(
        carry.sourceCustody,
        event.sourceCustodyBefore,
      )
    ) {
      addIssue(
        context,
        ["predecessorCoverage", "sourceCustody"],
        `${event.kind} carry must retain the active stable source and decode identity`,
      );
    }
    if (
      carry.priorCoverageSegmentIdSha256 ===
      event.newCoverageSegmentIdSha256
    ) {
      addIssue(
        context,
        ["newCoverageSegmentIdSha256"],
        `${event.kind} coverage resume must allocate a fresh segment`,
      );
    }
    if (event.kind === "source") return;
    const maskCarry = event.predecessorCoverage;
    if (
      !sameSourceIdentity(
        event.sourceCustodyBefore.source,
        event.frozenBinding.source,
      )
    ) {
      addIssue(
        context,
        ["frozenBinding", "source"],
        "mask resume must retain frozen evidence for the active source",
      );
    }
    if (event.maskState.revision !== event.frozenBinding.revision) {
      addIssue(
        context,
        ["frozenBinding", "revision"],
        "mask resume state and frozen binding revisions must match",
      );
    }
    if (
      maskCarry.maskStateSha256 !== event.maskState.maskStateSha256 ||
      maskCarry.frozenBindingSha256 !== event.frozenBindingSha256 ||
      !sameFrozenBinding(maskCarry.frozenBinding, event.frozenBinding)
    ) {
      addIssue(
        context,
        ["predecessorCoverage"],
        "mask carry must retain the active source, mask state, and frozen evidence",
      );
    }
  });

const CoverageSegmentResumeCommitCommonShape = {
  schemaVersion: z.literal(
    "venviewer.grand-hall-t554-native-review-coverage-segment-resume-committed.v2",
  ),
  operationIdSha256: GrandHallT554NativeReviewSha256V2Schema,
  browserEpochNonceSha256: GrandHallT554NativeReviewSha256V2Schema,
  ...WorkspaceAdvanceShape,
  renderGeneration: RenderGenerationSchema,
  coverageSegmentIdSha256: GrandHallT554NativeReviewSha256V2Schema,
  sourceCustody: GrandHallT554NativeReviewSourceCustodyBindingV2Schema,
};

const SourceCoverageSegmentResumeCommittedPayloadV2Schema = z
  .object({
    ...CoverageSegmentResumeCommitCommonShape,
    kind: z.literal("source"),
    sourceJournal: GrandHallT554NativeReviewSourceChildCheckpointV2Schema,
  })
  .strict();

const MaskCoverageSegmentResumeCommittedPayloadV2Schema = z
  .object({
    ...CoverageSegmentResumeCommitCommonShape,
    kind: z.literal("mask"),
    maskState: GrandHallT554NativeReviewMaskStateEvidenceV2Schema,
    maskReviewSubjectSha256: GrandHallT554NativeReviewSha256V2Schema,
    frozenBindingSha256: GrandHallT554NativeReviewSha256V2Schema,
    frozenBinding: GrandHallT554NativeReviewFrozenMaskBindingV2Schema,
    maskJournal: GrandHallT554NativeReviewMaskChildCheckpointV2Schema,
  })
  .strict();

export const GrandHallT554NativeReviewCoverageSegmentResumeCommittedPayloadV2Schema =
  z
    .discriminatedUnion("kind", [
      SourceCoverageSegmentResumeCommittedPayloadV2Schema,
      MaskCoverageSegmentResumeCommittedPayloadV2Schema,
    ])
    .superRefine((event, context) => {
    validateWorkspaceAdvance(event, context);
    if (
      event.sourceCustody.sourceEpochRenderGeneration !==
      event.renderGeneration
    ) {
      addIssue(
        context,
        ["sourceCustody", "sourceEpochRenderGeneration"],
        `resumed ${event.kind} custody must use the committed generation`,
      );
    }
    if (event.kind === "source") return;
    if (
      event.maskState.revision !== event.frozenBinding.revision ||
      !sameSourceIdentity(
        event.sourceCustody.source,
        event.frozenBinding.source,
      )
    ) {
      addIssue(
        context,
        ["frozenBinding"],
        "resumed mask commit must retain the scoped source and revision",
      );
    }
  });

const SourceCoverageResumeRecoverySchema = z.discriminatedUnion(
  "childDisposition",
  [
    z
      .object({
        childDisposition: z.literal("absent"),
        abandonedChildJournal: z.null(),
      })
      .strict(),
    z
      .object({
        childDisposition: z.literal("exact_abandoned"),
        abandonedChildJournal:
          GrandHallT554NativeReviewSourceChildCheckpointV2Schema,
      })
      .strict(),
  ],
);

const MaskCoverageResumeRecoverySchema = z.discriminatedUnion(
  "childDisposition",
  [
    z
      .object({
        childDisposition: z.literal("absent"),
        abandonedChildJournal: z.null(),
      })
      .strict(),
    z
      .object({
        childDisposition: z.literal("exact_abandoned"),
        abandonedChildJournal:
          GrandHallT554NativeReviewMaskChildCheckpointV2Schema,
      })
      .strict(),
  ],
);

const CoverageSegmentResumeRecoveryAbortCommonShape = {
  schemaVersion: z.literal(
    "venviewer.grand-hall-t554-native-review-coverage-segment-resume-recovery-aborted.v2",
  ),
  operationIdSha256: GrandHallT554NativeReviewSha256V2Schema,
  browserEpochNonceSha256: GrandHallT554NativeReviewSha256V2Schema,
  workspaceRevision: WorkspaceRevisionSchema,
  consumedRenderGeneration: RenderGenerationSchema,
};

export const GrandHallT554NativeReviewCoverageSegmentResumeRecoveryAbortedPayloadV2Schema =
  z.discriminatedUnion("kind", [
    z
      .object({
        ...CoverageSegmentResumeRecoveryAbortCommonShape,
        kind: z.literal("source"),
        recovery: SourceCoverageResumeRecoverySchema,
      })
      .strict(),
    z
      .object({
        ...CoverageSegmentResumeRecoveryAbortCommonShape,
        kind: z.literal("mask"),
        recovery: MaskCoverageResumeRecoverySchema,
      })
      .strict(),
  ]);

export const GrandHallT554NativeReviewMaskEditEpochResumedPayloadV2Schema = z
  .object({
    schemaVersion: z.literal(
      "venviewer.grand-hall-t554-native-review-mask-edit-epoch-resumed.v2",
    ),
    operationIdSha256: GrandHallT554NativeReviewSha256V2Schema,
    browserEpochNonceSha256: GrandHallT554NativeReviewSha256V2Schema,
    ...WorkspaceAdvanceShape,
    previousVisibleRenderGeneration: RenderGenerationSchema,
    previousMaximumAllocatedRenderGeneration: RenderGenerationSchema,
    resultingRenderGeneration: RenderGenerationSchema,
    sourceCustodyBefore: GrandHallT554NativeReviewSourceCustodyBindingV2Schema,
    sourceCustody: GrandHallT554NativeReviewSourceCustodyBindingV2Schema,
  })
  .strict()
  .superRefine((event, context) => {
    validateWorkspaceAdvance(event, context);
    validateGenerationAdvance(
      event.previousMaximumAllocatedRenderGeneration,
      event.resultingRenderGeneration,
      context,
    );
    if (
      event.previousVisibleRenderGeneration >
      event.previousMaximumAllocatedRenderGeneration
    ) {
      addIssue(
        context,
        ["previousVisibleRenderGeneration"],
        "visible generation cannot exceed the global allocation ceiling",
      );
    }
    if (
      !sameStableSourceCustody(
        event.sourceCustodyBefore,
        event.sourceCustody,
      ) ||
      event.sourceCustodyBefore.sourceEpochNonceSha256 ===
        event.sourceCustody.sourceEpochNonceSha256 ||
      event.sourceCustodyBefore.sourceEpochBindingSha256 ===
        event.sourceCustody.sourceEpochBindingSha256
    ) {
      addIssue(
        context,
        ["sourceCustody"],
        "mask-edit resume must retain stable source identity with a fresh epoch",
      );
    }
    if (
      event.sourceCustody.sourceEpochRenderGeneration !==
      event.resultingRenderGeneration
    ) {
      addIssue(
        context,
        ["sourceCustody", "sourceEpochRenderGeneration"],
        "resumed mask-edit custody must use the resulting generation",
      );
    }
  });

const SourceDecisionCommonMaterialShape = {
  schemaVersion: z.literal(
    "venviewer.grand-hall-t554-native-review-source-decision-recorded.v2",
  ),
  operationIdSha256: GrandHallT554NativeReviewSha256V2Schema,
  browserEpochNonceSha256: GrandHallT554NativeReviewSha256V2Schema,
  ...WorkspaceAdvanceShape,
  sessionIdSha256: GrandHallT554NativeReviewSha256V2Schema,
  registry: GrandHallT554NativeReviewRegistryBindingV2Schema,
  implementationManifest:
    GrandHallT554NativeReviewImplementationManifestBindingV2Schema,
  authorityBoundary: GrandHallT554NativeReviewAuthorityBoundaryV2Schema,
  ...SourceBindingPayloadShape,
  previousRenderGeneration: RenderGenerationSchema,
  resultingRenderGeneration: RenderGenerationSchema,
  completedSourceCoverage:
    GrandHallT554NativeReviewCompletedSourceCoverageV2Schema,
  note: z.string().trim().min(1).max(1_000),
  decidedAtUtc: GrandHallT554NativeReviewCanonicalUtcV2Schema,
};

const SourceExcludeDecisionMaterialV2Schema = z
  .object({
    ...SourceDecisionCommonMaterialShape,
    result: z.literal("EXCLUDE"),
    classification: z.literal("no_observed_grand_hall_pixels"),
    maskState: z.null(),
    maskReviewSubjectSha256: z.null(),
    frozenBindingSha256: z.null(),
    frozenBinding: z.null(),
    completedMaskCoverage: z.null(),
  })
  .strict();

const SourceIncludeDecisionMaterialV2Schema = z
  .object({
    ...SourceDecisionCommonMaterialShape,
    result: z.literal("INCLUDE"),
    classification: z.enum(["grand_hall_core", "grand_hall_portal_threshold"]),
    maskState: GrandHallT554NativeReviewMaskStateEvidenceV2Schema,
    maskReviewSubjectSha256: GrandHallT554NativeReviewSha256V2Schema,
    frozenBindingSha256: GrandHallT554NativeReviewSha256V2Schema,
    frozenBinding: GrandHallT554NativeReviewFrozenMaskBindingV2Schema,
    completedMaskCoverage:
      GrandHallT554NativeReviewCompletedMaskCoverageV2Schema,
  })
  .strict();

const SourceDecisionRecordedMaterialBaseV2Schema = z.discriminatedUnion(
  "result",
  [
    SourceExcludeDecisionMaterialV2Schema,
    SourceIncludeDecisionMaterialV2Schema,
  ],
);

type SourceDecisionRecordedMaterialCandidateV2 = z.infer<
  typeof SourceDecisionRecordedMaterialBaseV2Schema
>;

function sameReasonCounts(
  left: GrandHallT554NativeReviewMaskStateEvidenceV2["reasonCounts"],
  right: GrandHallT554NativeReviewFrozenMaskBindingV2["reasonCounts"],
): boolean {
  return (
    left.length === right.length &&
    left.every((entry, index) => {
      const peer = right[index];
      return (
        peer !== undefined &&
        entry.reasonCode === peer.reasonCode &&
        entry.pixelCount === peer.pixelCount
      );
    })
  );
}

function validateSourceDecisionMaterial(
  decision: SourceDecisionRecordedMaterialCandidateV2,
  context: z.RefinementCtx,
): void {
  validateWorkspaceAdvance(decision, context);
  validateGenerationAdvance(
    decision.previousRenderGeneration,
    decision.resultingRenderGeneration,
    context,
  );
  if (
    decision.completedSourceCoverage.sourceReviewSubjectSha256 !==
    decision.sourceCustody.sourceReviewSubjectSha256
  ) {
    addIssue(
      context,
      ["completedSourceCoverage", "sourceReviewSubjectSha256"],
      "decision source coverage must bind the exact source-review subject",
    );
  }
  if (decision.result === "EXCLUDE") return;
  if (
    !sameSourceIdentity(
      decision.sourceCustody.source,
      decision.frozenBinding.source,
    )
  ) {
    addIssue(
      context,
      ["frozenBinding", "source"],
      "included decision frozen evidence must bind the exact source",
    );
  }
  if (
    decision.maskState.revision !== decision.frozenBinding.revision ||
    decision.maskState.includedPixelCount !==
      decision.frozenBinding.includedPixelCount ||
    decision.maskState.excludedPixelCount !==
      decision.frozenBinding.excludedPixelCount ||
    !sameReasonCounts(
      decision.maskState.reasonCounts,
      decision.frozenBinding.reasonCounts,
    )
  ) {
    addIssue(
      context,
      ["frozenBinding"],
      "included decision mask state and frozen evidence must match exactly",
    );
  }
  if (
    decision.maskState.revision === 0 ||
    decision.maskState.includedPixelCount === 0
  ) {
    addIssue(
      context,
      ["maskState"],
      "included decision requires a reviewed nonempty mask revision",
    );
  }
  if (
    decision.completedMaskCoverage.maskReviewSubjectSha256 !==
      decision.maskReviewSubjectSha256 ||
    decision.completedMaskCoverage.maskStateSha256 !==
      decision.maskState.maskStateSha256 ||
    decision.completedMaskCoverage.frozenBindingSha256 !==
      decision.frozenBindingSha256
  ) {
    addIssue(
      context,
      ["completedMaskCoverage"],
      "completed mask coverage must bind the exact reviewed mask subject, state, and frozen evidence",
    );
  }
}

export const GrandHallT554NativeReviewSourceDecisionRecordedMaterialV2Schema =
  SourceDecisionRecordedMaterialBaseV2Schema.superRefine(
    validateSourceDecisionMaterial,
  );

export type GrandHallT554NativeReviewSourceDecisionRecordedMaterialV2 = z.infer<
  typeof GrandHallT554NativeReviewSourceDecisionRecordedMaterialV2Schema
>;

export function computeGrandHallT554NativeReviewSourceDecisionV2Sha256(
  material: unknown,
): `sha256:${string}` {
  const parsed =
    GrandHallT554NativeReviewSourceDecisionRecordedMaterialV2Schema.parse(
      material,
    );
  return canonicalDigest(
    GRAND_HALL_T554_NATIVE_REVIEW_SOURCE_DECISION_DIGEST_DOMAIN_V2,
    parsed,
  );
}

const SourceDecisionRecordedPayloadBaseV2Schema = z.discriminatedUnion(
  "result",
  [
    SourceExcludeDecisionMaterialV2Schema.extend({
      decisionSha256: GrandHallT554NativeReviewSha256V2Schema,
    }).strict(),
    SourceIncludeDecisionMaterialV2Schema.extend({
      decisionSha256: GrandHallT554NativeReviewSha256V2Schema,
    }).strict(),
  ],
);

export const GrandHallT554NativeReviewSourceDecisionRecordedPayloadV2Schema =
  SourceDecisionRecordedPayloadBaseV2Schema.superRefine((decision, context) => {
    validateSourceDecisionMaterial(decision, context);
    const { decisionSha256, ...material } = decision;
    const materialResult =
      GrandHallT554NativeReviewSourceDecisionRecordedMaterialV2Schema.safeParse(
        material,
      );
    if (!materialResult.success) return;
    if (
      decisionSha256 !==
      computeGrandHallT554NativeReviewSourceDecisionV2Sha256(
        materialResult.data,
      )
    ) {
      addIssue(
        context,
        ["decisionSha256"],
        "decision digest must bind every exact decision material field",
      );
    }
  });

export type GrandHallT554NativeReviewSourceDecisionRecordedPayloadV2 = z.infer<
  typeof GrandHallT554NativeReviewSourceDecisionRecordedPayloadV2Schema
>;

const HumanAttestationRecordedMaterialV2Schema = z
  .object({
    schemaVersion: z.literal(
      "venviewer.grand-hall-t554-native-review-source-human-attestation-recorded.v2",
    ),
    operationIdSha256: GrandHallT554NativeReviewSha256V2Schema,
    browserEpochNonceSha256: GrandHallT554NativeReviewSha256V2Schema,
    ...WorkspaceAdvanceShape,
    sessionIdSha256: GrandHallT554NativeReviewSha256V2Schema,
    sourceReviewSubjectSha256: GrandHallT554NativeReviewSha256V2Schema,
    decisionSha256: GrandHallT554NativeReviewSha256V2Schema,
    reviewerId: z.string().trim().min(1).max(160),
    reviewerRole: z.literal("venue_owner_or_authorized_domain_reviewer"),
    knowledgeBasis: z.array(z.string().trim().min(1).max(240)).min(1).max(32),
    attestedAtUtc: GrandHallT554NativeReviewCanonicalUtcV2Schema,
    statement: z.literal(
      GRAND_HALL_T554_NATIVE_REVIEW_HUMAN_ATTESTATION_STATEMENT_V2,
    ),
    humanPresenceProof: z.literal("not_cryptographic"),
    agentDecisionAuthority: z.literal("none"),
    authority: z.literal("none"),
  })
  .strict()
  .superRefine(validateWorkspaceAdvance);

export const GrandHallT554NativeReviewHumanAttestationRecordedMaterialV2Schema =
  HumanAttestationRecordedMaterialV2Schema;

export type GrandHallT554NativeReviewHumanAttestationRecordedMaterialV2 =
  z.infer<
    typeof GrandHallT554NativeReviewHumanAttestationRecordedMaterialV2Schema
  >;

export function computeGrandHallT554NativeReviewHumanAttestationV2Sha256(
  material: unknown,
): `sha256:${string}` {
  const parsed =
    GrandHallT554NativeReviewHumanAttestationRecordedMaterialV2Schema.parse(
      material,
    );
  return canonicalDigest(
    GRAND_HALL_T554_NATIVE_REVIEW_HUMAN_ATTESTATION_DIGEST_DOMAIN_V2,
    parsed,
  );
}

export const GrandHallT554NativeReviewHumanAttestationRecordedPayloadV2Schema =
  z
    .object({
      schemaVersion: z.literal(
        "venviewer.grand-hall-t554-native-review-source-human-attestation-recorded.v2",
      ),
      operationIdSha256: GrandHallT554NativeReviewSha256V2Schema,
      browserEpochNonceSha256: GrandHallT554NativeReviewSha256V2Schema,
      ...WorkspaceAdvanceShape,
      sessionIdSha256: GrandHallT554NativeReviewSha256V2Schema,
      sourceReviewSubjectSha256: GrandHallT554NativeReviewSha256V2Schema,
      decisionSha256: GrandHallT554NativeReviewSha256V2Schema,
      reviewerId: z.string().trim().min(1).max(160),
      reviewerRole: z.literal("venue_owner_or_authorized_domain_reviewer"),
      knowledgeBasis: z.array(z.string().trim().min(1).max(240)).min(1).max(32),
      attestedAtUtc: GrandHallT554NativeReviewCanonicalUtcV2Schema,
      statement: z.literal(
        GRAND_HALL_T554_NATIVE_REVIEW_HUMAN_ATTESTATION_STATEMENT_V2,
      ),
      humanPresenceProof: z.literal("not_cryptographic"),
      agentDecisionAuthority: z.literal("none"),
      authority: z.literal("none"),
      attestationSha256: GrandHallT554NativeReviewSha256V2Schema,
    })
    .strict()
    .superRefine((attestation, context) => {
      validateWorkspaceAdvance(attestation, context);
      const { attestationSha256, ...material } = attestation;
      const materialResult =
        GrandHallT554NativeReviewHumanAttestationRecordedMaterialV2Schema.safeParse(
          material,
        );
      if (!materialResult.success) return;
      if (
        attestationSha256 !==
        computeGrandHallT554NativeReviewHumanAttestationV2Sha256(
          materialResult.data,
        )
      ) {
        addIssue(
          context,
          ["attestationSha256"],
          "attestation digest must bind every exact attestation material field",
        );
      }
    });

export type GrandHallT554NativeReviewHumanAttestationRecordedPayloadV2 =
  z.infer<
    typeof GrandHallT554NativeReviewHumanAttestationRecordedPayloadV2Schema
  >;

export const GrandHallT554NativeReviewSourceAbandonedPayloadV2Schema = z
  .object({
    schemaVersion: z.literal(
      "venviewer.grand-hall-t554-native-review-source-abandoned.v2",
    ),
    browserEpochNonceSha256: GrandHallT554NativeReviewSha256V2Schema,
    ...WorkspaceAdvanceShape,
    ...SourceBindingPayloadShape,
    finalRenderGeneration: RenderGenerationSchema,
    sourceJournal: GrandHallT554NativeReviewSourceChildCheckpointV2Schema,
    maskJournal:
      GrandHallT554NativeReviewMaskChildCheckpointV2Schema.nullable(),
    reason: z.enum(["operator_abandon", "source_switch", "session_stop"]),
  })
  .strict()
  .superRefine(validateWorkspaceAdvance);

export const GrandHallT554NativeReviewSessionStoppedPayloadV2Schema = z
  .object({
    schemaVersion: z.literal(
      "venviewer.grand-hall-t554-native-review-session-stopped.v2",
    ),
    browserEpochNonceSha256: GrandHallT554NativeReviewSha256V2Schema,
    ...WorkspaceAdvanceShape,
    stoppedAtUtc: GrandHallT554NativeReviewCanonicalUtcV2Schema,
    activeSourceWasPresent: z.boolean(),
    authorityBoundary: GrandHallT554NativeReviewAuthorityBoundaryV2Schema,
  })
  .strict()
  .superRefine(validateWorkspaceAdvance);

export const GrandHallT554NativeReviewSessionPoisonedPayloadV2Schema = z
  .object({
    schemaVersion: z.literal(
      "venviewer.grand-hall-t554-native-review-session-poisoned.v2",
    ),
    browserEpochNonceSha256: GrandHallT554NativeReviewSha256V2Schema,
    workspaceRevision: WorkspaceRevisionSchema,
    maximumAllocatedRenderGeneration: WorkspaceRevisionSchema,
    poisonedAtUtc: GrandHallT554NativeReviewCanonicalUtcV2Schema,
    reasonCode: z.enum([
      "durability_ambiguous",
      "resource_cleanup_failed",
      "implementation_drift",
      "root_inventory_invalid",
      "internal_invariant_failed",
    ]),
    authorityBoundary: GrandHallT554NativeReviewAuthorityBoundaryV2Schema,
  })
  .strict();

const TileGridSchema = z
  .object({
    widthPx: z.literal(GRAND_HALL_T554_NATIVE_TILE_WIDTH_PX),
    heightPx: z.literal(GRAND_HALL_T554_NATIVE_TILE_HEIGHT_PX),
    columnCount: z.literal(GRAND_HALL_T554_NATIVE_TILE_COLUMN_COUNT),
    rowCount: z.literal(GRAND_HALL_T554_NATIVE_TILE_ROW_COUNT),
    channelCount: z.literal(3),
    bytesPerTile: z.literal(
      GRAND_HALL_T554_NATIVE_TILE_WIDTH_PX *
        GRAND_HALL_T554_NATIVE_TILE_HEIGHT_PX *
        3,
    ),
    resampling: z.literal("none"),
  })
  .strict();

export const GrandHallT554NativeReviewSourceReviewStartedPayloadV2Schema = z
  .object({
    schemaVersion: z.literal(
      "venviewer.grand-hall-t554-native-review-source-review-started.v2",
    ),
    browserEpochNonceSha256: GrandHallT554NativeReviewSha256V2Schema,
    coverageSegmentIdSha256: GrandHallT554NativeReviewSha256V2Schema,
    coverageSegmentStartedAtUtc: GrandHallT554NativeReviewCanonicalUtcV2Schema,
    firstSampleMustCreditZero: z.literal(true),
    renderGeneration: RenderGenerationSchema,
    ...SourceBindingPayloadShape,
    registry: GrandHallT554NativeReviewRegistryBindingV2Schema,
    implementationManifest:
      GrandHallT554NativeReviewImplementationManifestBindingV2Schema,
    tileGrid: TileGridSchema,
    predecessorCoverage:
      GrandHallT554NativeReviewSourceCoverageCarryStateV2Schema.nullable(),
    authorityBoundary: GrandHallT554NativeReviewAuthorityBoundaryV2Schema,
  })
  .strict()
  .superRefine((event, context) => {
    if (
      event.renderGeneration !== event.sourceCustody.sourceEpochRenderGeneration
    ) {
      addIssue(
        context,
        ["renderGeneration"],
        "source review must use the source epoch generation",
      );
    }
    if (
      event.predecessorCoverage !== null &&
      event.predecessorCoverage.subjectSha256 !==
        event.sourceCustody.sourceReviewSubjectSha256
    ) {
      addIssue(
        context,
        ["predecessorCoverage", "subjectSha256"],
        "predecessor source subject drifted",
      );
    }
    if (
      event.predecessorCoverage !== null &&
      !sameImplementationBinding(
        event.predecessorCoverage.implementationManifest,
        event.implementationManifest,
      )
    ) {
      addIssue(
        context,
        ["predecessorCoverage", "implementationManifest"],
        "source coverage cannot cross an implementation change",
      );
    }
    if (
      event.predecessorCoverage !== null &&
      !sameStableSourceCustody(
        event.predecessorCoverage.sourceCustody,
        event.sourceCustody,
      )
    ) {
      addIssue(
        context,
        ["predecessorCoverage", "sourceCustody"],
        "source coverage cannot cross stable source-custody drift",
      );
    }
  });

export const GrandHallT554NativeReviewMaskReviewStartedPayloadV2Schema = z
  .object({
    schemaVersion: z.literal(
      "venviewer.grand-hall-t554-native-review-mask-review-started.v2",
    ),
    browserEpochNonceSha256: GrandHallT554NativeReviewSha256V2Schema,
    coverageSegmentIdSha256: GrandHallT554NativeReviewSha256V2Schema,
    coverageSegmentStartedAtUtc: GrandHallT554NativeReviewCanonicalUtcV2Schema,
    firstSampleMustCreditZero: z.literal(true),
    renderGeneration: RenderGenerationSchema,
    ...SourceBindingPayloadShape,
    maskReviewSubjectSha256: GrandHallT554NativeReviewSha256V2Schema,
    maskStateSha256: GrandHallT554NativeReviewSha256V2Schema,
    frozenBindingSha256: GrandHallT554NativeReviewSha256V2Schema,
    frozenBinding: GrandHallT554NativeReviewFrozenMaskBindingV2Schema,
    implementationManifest:
      GrandHallT554NativeReviewImplementationManifestBindingV2Schema,
    predecessorCoverage:
      GrandHallT554NativeReviewMaskCoverageCarryStateV2Schema.nullable(),
    authorityBoundary: GrandHallT554NativeReviewAuthorityBoundaryV2Schema,
  })
  .strict()
  .superRefine((event, context) => {
    if (
      !sameSourceIdentity(
        event.sourceCustody.source,
        event.frozenBinding.source,
      )
    ) {
      addIssue(
        context,
        ["frozenBinding", "source"],
        "mask review must bind source custody",
      );
    }
    if (
      event.frozenBinding.revision === 0 ||
      event.frozenBinding.includedPixelCount === 0
    ) {
      addIssue(
        context,
        ["frozenBinding"],
        "mask review requires an edited frozen mask with included pixels",
      );
    }
    if (
      event.predecessorCoverage !== null &&
      event.predecessorCoverage.subjectSha256 !== event.maskReviewSubjectSha256
    ) {
      addIssue(
        context,
        ["predecessorCoverage", "subjectSha256"],
        "predecessor mask subject drifted",
      );
    }
    if (
      event.predecessorCoverage !== null &&
      !sameImplementationBinding(
        event.predecessorCoverage.implementationManifest,
        event.implementationManifest,
      )
    ) {
      addIssue(
        context,
        ["predecessorCoverage", "implementationManifest"],
        "mask coverage cannot cross an implementation change",
      );
    }
    if (
      event.predecessorCoverage !== null &&
      (!sameStableSourceCustody(
        event.predecessorCoverage.sourceCustody,
        event.sourceCustody,
      ) ||
        event.predecessorCoverage.maskStateSha256 !== event.maskStateSha256 ||
        event.predecessorCoverage.frozenBindingSha256 !==
          event.frozenBindingSha256)
    ) {
      addIssue(
        context,
        ["predecessorCoverage"],
        "mask coverage cannot cross source, mask-state, or frozen-binding drift",
      );
    }
  });

const TileDeliveredPayloadSchema = z
  .object({
    schemaVersion: z.literal(
      "venviewer.grand-hall-t554-native-review-tile-delivered.v2",
    ),
    browserEpochNonceSha256: GrandHallT554NativeReviewSha256V2Schema,
    sourceEpochNonceSha256: GrandHallT554NativeReviewSha256V2Schema,
    coverageSegmentIdSha256: GrandHallT554NativeReviewSha256V2Schema,
    subjectSha256: GrandHallT554NativeReviewSha256V2Schema,
    renderGeneration: RenderGenerationSchema,
    column: z
      .number()
      .int()
      .min(0)
      .max(GRAND_HALL_T554_NATIVE_TILE_COLUMN_COUNT - 1),
    row: z
      .number()
      .int()
      .min(0)
      .max(GRAND_HALL_T554_NATIVE_TILE_ROW_COUNT - 1),
    tileIndex: z
      .number()
      .int()
      .min(0)
      .max(GRAND_HALL_T554_NATIVE_TILE_COUNT - 1),
    responseFinishedAtUtc: GrandHallT554NativeReviewCanonicalUtcV2Schema,
  })
  .strict()
  .superRefine((delivery, context) => {
    const expectedIndex =
      delivery.row * GRAND_HALL_T554_NATIVE_TILE_COLUMN_COUNT + delivery.column;
    if (delivery.tileIndex !== expectedIndex) {
      addIssue(
        context,
        ["tileIndex"],
        "tile index must equal row-major source-grid coordinates",
      );
    }
  });

export const GrandHallT554NativeReviewTileDeliveredPayloadV2Schema =
  TileDeliveredPayloadSchema;
export type GrandHallT554NativeReviewTileDeliveredPayloadV2 = z.infer<
  typeof GrandHallT554NativeReviewTileDeliveredPayloadV2Schema
>;

const SourceToCssTransformSchema = z
  .object({
    a: z.number().finite().positive().max(64),
    b: z.literal(0),
    c: z.literal(0),
    d: z.number().finite().positive().max(64),
    e: z.number().finite().min(-1_000_000).max(1_000_000),
    f: z.number().finite().min(-1_000_000).max(1_000_000),
  })
  .strict()
  .superRefine((matrix, context) => {
    if (Math.abs(matrix.a - matrix.d) > 1e-9) {
      addIssue(
        context,
        ["d"],
        "native review requires one uniform source scale",
      );
    }
  });

const CoverageDisqualifierSchema = z
  .enum([
    "first_sample",
    "document_not_visible",
    "document_not_focused",
    "below_native_device_scale",
    "heartbeat_gap_exceeded",
    "no_fully_visible_delivered_tiles",
    "no_continuously_visible_tiles",
  ])
  .nullable();

export const GrandHallT554NativeReviewCoverageObservedPayloadV2Schema = z
  .object({
    schemaVersion: z.literal(
      "venviewer.grand-hall-t554-native-review-coverage-observed.v2",
    ),
    browserEpochNonceSha256: GrandHallT554NativeReviewSha256V2Schema,
    sourceEpochNonceSha256: GrandHallT554NativeReviewSha256V2Schema,
    coverageSegmentIdSha256: GrandHallT554NativeReviewSha256V2Schema,
    subjectSha256: GrandHallT554NativeReviewSha256V2Schema,
    renderGeneration: RenderGenerationSchema,
    sequence: z
      .number()
      .int()
      .nonnegative()
      .max(GRAND_HALL_T554_NATIVE_REVIEW_MAXIMUM_TELEMETRY_EVENTS - 1),
    previousCoverageEventSha256:
      GrandHallT554NativeReviewSha256V2Schema.nullable(),
    serverObservation: z
      .object({
        receivedAtUtc: GrandHallT554NativeReviewCanonicalUtcV2Schema,
        monotonicElapsedMs: z
          .number()
          .int()
          .nonnegative()
          .max(Number.MAX_SAFE_INTEGER),
      })
      .strict(),
    telemetry: z
      .object({
        documentVisibilityState: z.enum(["visible", "hidden", "prerender"]),
        documentFocusState: z.enum(["focused", "blurred"]),
        viewportCssWidth: z.number().finite().positive().max(16_384),
        viewportCssHeight: z.number().finite().positive().max(16_384),
        devicePixelRatio: z.number().finite().min(0.25).max(8),
        sourceToCssTransform: SourceToCssTransformSchema,
        paintedTileBitsetHex: GrandHallT554NativeReviewTileBitmapHexV2Schema,
      })
      .strict(),
    derived: z
      .object({
        effectiveDevicePixelsPerSourcePixel: z
          .number()
          .finite()
          .positive()
          .max(512),
        serverMonotonicDeltaMs: z
          .number()
          .int()
          .nonnegative()
          .max(Number.MAX_SAFE_INTEGER),
        deliveredTileBitsetHex: GrandHallT554NativeReviewTileBitmapHexV2Schema,
        fullyVisibleDeliveredTileBitsetHex:
          GrandHallT554NativeReviewTileBitmapHexV2Schema,
        creditedTileBitsetHex: GrandHallT554NativeReviewTileBitmapHexV2Schema,
        creditedDurationMs: z
          .number()
          .int()
          .nonnegative()
          .max(GRAND_HALL_T554_MAXIMUM_CREDITED_HEARTBEAT_GAP_MS),
        disqualifier: CoverageDisqualifierSchema,
        completedTileBitsetHex: GrandHallT554NativeReviewTileBitmapHexV2Schema,
        completedTileCount: z
          .number()
          .int()
          .nonnegative()
          .max(GRAND_HALL_T554_NATIVE_TILE_COUNT),
        cumulativeDwellStateSha256: GrandHallT554NativeReviewSha256V2Schema,
      })
      .strict(),
    coverageEventSha256: GrandHallT554NativeReviewSha256V2Schema,
  })
  .strict()
  .superRefine((event, context) => {
    if (event.sequence === 0) {
      if (event.previousCoverageEventSha256 !== null) {
        addIssue(
          context,
          ["previousCoverageEventSha256"],
          "first segment sample has no predecessor event",
        );
      }
      if (
        event.derived.serverMonotonicDeltaMs !== 0 ||
        event.derived.creditedDurationMs !== 0 ||
        event.derived.creditedTileBitsetHex !== EMPTY_TILE_BITMAP_HEX ||
        event.derived.disqualifier !== "first_sample"
      ) {
        addIssue(
          context,
          ["derived"],
          "first segment sample must earn exactly zero credit",
        );
      }
    } else if (event.previousCoverageEventSha256 === null) {
      addIssue(
        context,
        ["previousCoverageEventSha256"],
        "later sample must chain to its predecessor",
      );
    }
    if (
      event.derived.disqualifier !== null &&
      (event.derived.creditedDurationMs !== 0 ||
        event.derived.creditedTileBitsetHex !== EMPTY_TILE_BITMAP_HEX)
    ) {
      addIssue(
        context,
        ["derived", "disqualifier"],
        "disqualified sample cannot earn dwell",
      );
    }
    if (
      event.derived.disqualifier === null &&
      event.derived.serverMonotonicDeltaMs >
        GRAND_HALL_T554_MAXIMUM_CREDITED_HEARTBEAT_GAP_MS
    ) {
      addIssue(
        context,
        ["derived", "serverMonotonicDeltaMs"],
        "long heartbeat gap must disqualify credit",
      );
    }
    if (
      event.derived.disqualifier === null &&
      event.derived.creditedDurationMs !== event.derived.serverMonotonicDeltaMs
    ) {
      addIssue(
        context,
        ["derived", "creditedDurationMs"],
        "eligible credit must equal the monotonic delta",
      );
    }
    if (
      !bitmapIsSubset(
        event.derived.fullyVisibleDeliveredTileBitsetHex,
        event.derived.deliveredTileBitsetHex,
      ) ||
      !bitmapIsSubset(
        event.derived.fullyVisibleDeliveredTileBitsetHex,
        event.telemetry.paintedTileBitsetHex,
      )
    ) {
      addIssue(
        context,
        ["derived", "fullyVisibleDeliveredTileBitsetHex"],
        "fully visible tiles must be both delivered and painted",
      );
    }
    if (
      !bitmapIsSubset(
        event.derived.creditedTileBitsetHex,
        event.derived.fullyVisibleDeliveredTileBitsetHex,
      )
    ) {
      addIssue(
        context,
        ["derived", "creditedTileBitsetHex"],
        "credited tiles must be fully visible and delivered",
      );
    }
    if (
      bitmapPopcount(event.derived.completedTileBitsetHex) !==
      event.derived.completedTileCount
    ) {
      addIssue(
        context,
        ["derived", "completedTileCount"],
        "completed count must equal the completed bitmap population",
      );
    }
  });

export type GrandHallT554NativeReviewCoverageObservedPayloadV2 = z.infer<
  typeof GrandHallT554NativeReviewCoverageObservedPayloadV2Schema
>;

function eventEnvelope<
  const EventType extends string,
  PayloadSchema extends z.ZodTypeAny,
>(eventType: EventType, payload: PayloadSchema) {
  return z
    .object({
      schemaVersion: z.literal(GRAND_HALL_T554_NATIVE_REVIEW_DOMAIN_EVENT_V2),
      eventType: z.literal(eventType),
      payload,
    })
    .strict();
}

export const GrandHallT554NativeReviewSessionCreatedEventV2Schema =
  eventEnvelope(
    "session.created.v2",
    GrandHallT554NativeReviewSessionCreatedPayloadV2Schema,
  );
export const GrandHallT554NativeReviewBrowserEpochStartedEventV2Schema =
  eventEnvelope(
    "session.browser-epoch-started.v2",
    GrandHallT554NativeReviewBrowserEpochStartedPayloadV2Schema,
  );
export const GrandHallT554NativeReviewSourceSelectionIntendedEventV2Schema =
  eventEnvelope(
    "source.selection-intended.v2",
    GrandHallT554NativeReviewSourceSelectionIntendedPayloadV2Schema,
  );
export const GrandHallT554NativeReviewSourceSelectionCommittedEventV2Schema =
  eventEnvelope(
    "source.selection-committed.v2",
    GrandHallT554NativeReviewSourceSelectionCommittedPayloadV2Schema,
  );
export const GrandHallT554NativeReviewSourceSelectionRecoveryAbortedEventV2Schema =
  eventEnvelope(
    "source.selection-recovery-aborted.v2",
    GrandHallT554NativeReviewSourceSelectionRecoveryAbortedPayloadV2Schema,
  );
export const GrandHallT554NativeReviewMaskWorkflowStartedEventV2Schema =
  eventEnvelope(
    "mask.workflow-started.v2",
    GrandHallT554NativeReviewMaskWorkflowStartedPayloadV2Schema,
  );
export const GrandHallT554NativeReviewMaskEditedEventV2Schema = eventEnvelope(
  "mask.edited.v2",
  GrandHallT554NativeReviewMaskEditedPayloadV2Schema,
);
export const GrandHallT554NativeReviewMaskFreezeIntendedEventV2Schema =
  eventEnvelope(
    "mask.freeze-intended.v2",
    GrandHallT554NativeReviewMaskFreezeIntendedPayloadV2Schema,
  );
export const GrandHallT554NativeReviewMaskFreezeCommittedEventV2Schema =
  eventEnvelope(
    "mask.freeze-committed.v2",
    GrandHallT554NativeReviewMaskFreezeCommittedPayloadV2Schema,
  );
export const GrandHallT554NativeReviewMaskFreezeRecoveryAbortedEventV2Schema =
  eventEnvelope(
    "mask.freeze-recovery-aborted.v2",
    GrandHallT554NativeReviewMaskFreezeRecoveryAbortedPayloadV2Schema,
  );
export const GrandHallT554NativeReviewCoverageSegmentResumeIntendedEventV2Schema =
  eventEnvelope(
    "coverage.segment-resume-intended.v2",
    GrandHallT554NativeReviewCoverageSegmentResumeIntendedPayloadV2Schema,
  );
export const GrandHallT554NativeReviewCoverageSegmentResumeCommittedEventV2Schema =
  eventEnvelope(
    "coverage.segment-resume-committed.v2",
    GrandHallT554NativeReviewCoverageSegmentResumeCommittedPayloadV2Schema,
  );
export const GrandHallT554NativeReviewCoverageSegmentResumeRecoveryAbortedEventV2Schema =
  eventEnvelope(
    "coverage.segment-resume-recovery-aborted.v2",
    GrandHallT554NativeReviewCoverageSegmentResumeRecoveryAbortedPayloadV2Schema,
  );
export const GrandHallT554NativeReviewMaskEditEpochResumedEventV2Schema =
  eventEnvelope(
    "mask.edit-epoch-resumed.v2",
    GrandHallT554NativeReviewMaskEditEpochResumedPayloadV2Schema,
  );
export const GrandHallT554NativeReviewSourceDecisionRecordedEventV2Schema =
  eventEnvelope(
    "source.decision-recorded.v2",
    GrandHallT554NativeReviewSourceDecisionRecordedPayloadV2Schema,
  );
export const GrandHallT554NativeReviewHumanAttestationRecordedEventV2Schema =
  eventEnvelope(
    "source.human-attestation-recorded.v2",
    GrandHallT554NativeReviewHumanAttestationRecordedPayloadV2Schema,
  );
export const GrandHallT554NativeReviewSourceAbandonedEventV2Schema =
  eventEnvelope(
    "source.abandoned.v2",
    GrandHallT554NativeReviewSourceAbandonedPayloadV2Schema,
  );
export const GrandHallT554NativeReviewSessionStoppedEventV2Schema =
  eventEnvelope(
    "session.stopped.v2",
    GrandHallT554NativeReviewSessionStoppedPayloadV2Schema,
  );
export const GrandHallT554NativeReviewSessionPoisonedEventV2Schema =
  eventEnvelope(
    "session.poisoned.v2",
    GrandHallT554NativeReviewSessionPoisonedPayloadV2Schema,
  );
export const GrandHallT554NativeReviewSourceReviewStartedEventV2Schema =
  eventEnvelope(
    "source.review-started.v2",
    GrandHallT554NativeReviewSourceReviewStartedPayloadV2Schema,
  );
export const GrandHallT554NativeReviewSourceTileDeliveredEventV2Schema =
  eventEnvelope(
    "source.tile-delivered.v2",
    GrandHallT554NativeReviewTileDeliveredPayloadV2Schema,
  );
export const GrandHallT554NativeReviewSourceCoverageObservedEventV2Schema =
  eventEnvelope(
    "source.coverage-observed.v2",
    GrandHallT554NativeReviewCoverageObservedPayloadV2Schema,
  );
export const GrandHallT554NativeReviewMaskReviewStartedEventV2Schema =
  eventEnvelope(
    "mask.review-started.v2",
    GrandHallT554NativeReviewMaskReviewStartedPayloadV2Schema,
  );
export const GrandHallT554NativeReviewMaskTileDeliveredEventV2Schema =
  eventEnvelope(
    "mask.tile-delivered.v2",
    GrandHallT554NativeReviewTileDeliveredPayloadV2Schema,
  );
export const GrandHallT554NativeReviewMaskCoverageObservedEventV2Schema =
  eventEnvelope(
    "mask.coverage-observed.v2",
    GrandHallT554NativeReviewCoverageObservedPayloadV2Schema,
  );

export const GrandHallT554NativeReviewCoordinatorEventV2Schema =
  z.discriminatedUnion("eventType", [
    GrandHallT554NativeReviewSessionCreatedEventV2Schema,
    GrandHallT554NativeReviewBrowserEpochStartedEventV2Schema,
    GrandHallT554NativeReviewSourceSelectionIntendedEventV2Schema,
    GrandHallT554NativeReviewSourceSelectionCommittedEventV2Schema,
    GrandHallT554NativeReviewSourceSelectionRecoveryAbortedEventV2Schema,
    GrandHallT554NativeReviewMaskWorkflowStartedEventV2Schema,
    GrandHallT554NativeReviewMaskEditedEventV2Schema,
    GrandHallT554NativeReviewMaskFreezeIntendedEventV2Schema,
    GrandHallT554NativeReviewMaskFreezeCommittedEventV2Schema,
    GrandHallT554NativeReviewMaskFreezeRecoveryAbortedEventV2Schema,
    GrandHallT554NativeReviewCoverageSegmentResumeIntendedEventV2Schema,
    GrandHallT554NativeReviewCoverageSegmentResumeCommittedEventV2Schema,
    GrandHallT554NativeReviewCoverageSegmentResumeRecoveryAbortedEventV2Schema,
    GrandHallT554NativeReviewMaskEditEpochResumedEventV2Schema,
    GrandHallT554NativeReviewSourceDecisionRecordedEventV2Schema,
    GrandHallT554NativeReviewHumanAttestationRecordedEventV2Schema,
    GrandHallT554NativeReviewSourceAbandonedEventV2Schema,
    GrandHallT554NativeReviewSessionStoppedEventV2Schema,
    GrandHallT554NativeReviewSessionPoisonedEventV2Schema,
  ]);

export const GrandHallT554NativeReviewSourceChildEventV2Schema =
  z.discriminatedUnion("eventType", [
    GrandHallT554NativeReviewSourceReviewStartedEventV2Schema,
    GrandHallT554NativeReviewSourceTileDeliveredEventV2Schema,
    GrandHallT554NativeReviewSourceCoverageObservedEventV2Schema,
  ]);

export const GrandHallT554NativeReviewMaskChildEventV2Schema =
  z.discriminatedUnion("eventType", [
    GrandHallT554NativeReviewMaskReviewStartedEventV2Schema,
    GrandHallT554NativeReviewMaskTileDeliveredEventV2Schema,
    GrandHallT554NativeReviewMaskCoverageObservedEventV2Schema,
  ]);

export const GrandHallT554NativeReviewChildEventV2Schema = z.discriminatedUnion(
  "eventType",
  [
    GrandHallT554NativeReviewSourceReviewStartedEventV2Schema,
    GrandHallT554NativeReviewSourceTileDeliveredEventV2Schema,
    GrandHallT554NativeReviewSourceCoverageObservedEventV2Schema,
    GrandHallT554NativeReviewMaskReviewStartedEventV2Schema,
    GrandHallT554NativeReviewMaskTileDeliveredEventV2Schema,
    GrandHallT554NativeReviewMaskCoverageObservedEventV2Schema,
  ],
);

export const GrandHallT554NativeReviewDomainEventV2Schema =
  z.discriminatedUnion("eventType", [
    GrandHallT554NativeReviewSessionCreatedEventV2Schema,
    GrandHallT554NativeReviewBrowserEpochStartedEventV2Schema,
    GrandHallT554NativeReviewSourceSelectionIntendedEventV2Schema,
    GrandHallT554NativeReviewSourceSelectionCommittedEventV2Schema,
    GrandHallT554NativeReviewSourceSelectionRecoveryAbortedEventV2Schema,
    GrandHallT554NativeReviewMaskWorkflowStartedEventV2Schema,
    GrandHallT554NativeReviewMaskEditedEventV2Schema,
    GrandHallT554NativeReviewMaskFreezeIntendedEventV2Schema,
    GrandHallT554NativeReviewMaskFreezeCommittedEventV2Schema,
    GrandHallT554NativeReviewMaskFreezeRecoveryAbortedEventV2Schema,
    GrandHallT554NativeReviewCoverageSegmentResumeIntendedEventV2Schema,
    GrandHallT554NativeReviewCoverageSegmentResumeCommittedEventV2Schema,
    GrandHallT554NativeReviewCoverageSegmentResumeRecoveryAbortedEventV2Schema,
    GrandHallT554NativeReviewMaskEditEpochResumedEventV2Schema,
    GrandHallT554NativeReviewSourceDecisionRecordedEventV2Schema,
    GrandHallT554NativeReviewHumanAttestationRecordedEventV2Schema,
    GrandHallT554NativeReviewSourceAbandonedEventV2Schema,
    GrandHallT554NativeReviewSessionStoppedEventV2Schema,
    GrandHallT554NativeReviewSessionPoisonedEventV2Schema,
    GrandHallT554NativeReviewSourceReviewStartedEventV2Schema,
    GrandHallT554NativeReviewSourceTileDeliveredEventV2Schema,
    GrandHallT554NativeReviewSourceCoverageObservedEventV2Schema,
    GrandHallT554NativeReviewMaskReviewStartedEventV2Schema,
    GrandHallT554NativeReviewMaskTileDeliveredEventV2Schema,
    GrandHallT554NativeReviewMaskCoverageObservedEventV2Schema,
  ]);

const GrandHallT554NativeReviewScopedEventV2BaseSchema = z.union([
  z
    .object({
      scope: GrandHallT554NativeReviewSessionScopeV2Schema,
      event: GrandHallT554NativeReviewCoordinatorEventV2Schema,
    })
    .strict(),
  z
    .object({
      scope: GrandHallT554NativeReviewSourceScopeV2Schema,
      event: GrandHallT554NativeReviewSourceChildEventV2Schema,
    })
    .strict(),
  z
    .object({
      scope: GrandHallT554NativeReviewMaskScopeV2Schema,
      event: GrandHallT554NativeReviewMaskChildEventV2Schema,
    })
    .strict(),
]);

type GrandHallT554NativeReviewScopedEventV2Base = z.infer<
  typeof GrandHallT554NativeReviewScopedEventV2BaseSchema
>;
type GrandHallT554NativeReviewScopedEventV2BaseInput = z.input<
  typeof GrandHallT554NativeReviewScopedEventV2BaseSchema
>;

export const GrandHallT554NativeReviewScopedEventV2Schema: z.ZodType<
  GrandHallT554NativeReviewScopedEventV2Base,
  z.ZodTypeDef,
  GrandHallT554NativeReviewScopedEventV2BaseInput
> = GrandHallT554NativeReviewScopedEventV2BaseSchema.superRefine(
  (record, context) => {
    const { event, scope } = record;
    if (scope.kind === "session") {
      if (event.eventType === "session.created.v2") {
        if (event.payload.sessionIdSha256 !== scope.sessionIdSha256) {
          addIssue(
            context,
            ["event", "payload", "sessionIdSha256"],
            "created session must match the journal session identity",
          );
        }
        if (
          !sameImplementationBinding(
            event.payload.implementationManifest,
            scope.implementationManifest,
          )
        ) {
          addIssue(
            context,
            ["event", "payload", "implementationManifest"],
            "created session must match the scoped implementation manifest",
          );
        }
        if (!sameRegistryBinding(event.payload.registry, scope.registry)) {
          addIssue(
            context,
            ["event", "payload", "registry"],
            "created session must match the scoped registry",
          );
        }
      } else if (event.eventType === "source.decision-recorded.v2") {
        if (event.payload.sessionIdSha256 !== scope.sessionIdSha256) {
          addIssue(
            context,
            ["event", "payload", "sessionIdSha256"],
            "source decision must match the journal session identity",
          );
        }
        if (!sameRegistryBinding(event.payload.registry, scope.registry)) {
          addIssue(
            context,
            ["event", "payload", "registry"],
            "source decision must match the scoped registry",
          );
        }
        if (
          !sameImplementationBinding(
            event.payload.implementationManifest,
            scope.implementationManifest,
          )
        ) {
          addIssue(
            context,
            ["event", "payload", "implementationManifest"],
            "source decision must match the scoped implementation manifest",
          );
        }
      } else if (
        event.eventType === "source.human-attestation-recorded.v2" &&
        event.payload.sessionIdSha256 !== scope.sessionIdSha256
      ) {
        addIssue(
          context,
          ["event", "payload", "sessionIdSha256"],
          "human attestation must match the journal session identity",
        );
      }
      return;
    }

    if (scope.kind === "source") {
        if (event.eventType === "source.review-started.v2") {
          if (
            event.payload.browserEpochNonceSha256 !==
              scope.browserEpochNonceSha256 ||
            event.payload.coverageSegmentIdSha256 !==
              scope.coverageSegmentIdSha256 ||
            event.payload.renderGeneration !== scope.renderGeneration
          ) {
            addIssue(
              context,
              ["event", "payload"],
              "source-review start must match the scoped browser epoch, segment, and generation",
            );
          }
          if (
            !sameExactSourceCustody(
              event.payload.sourceCustody,
              scope.sourceCustody,
            )
          ) {
            addIssue(
              context,
              ["event", "payload", "sourceCustody"],
              "source-review start must match the exact scoped source custody",
            );
          }
          if (
            !sameImplementationBinding(
              event.payload.implementationManifest,
              scope.implementationManifest,
            )
          ) {
            addIssue(
              context,
              ["event", "payload", "implementationManifest"],
              "source-review start must match the scoped implementation manifest",
            );
          }
          if (!sameRegistryBinding(event.payload.registry, scope.registry)) {
            addIssue(
              context,
              ["event", "payload", "registry"],
              "source-review start must match the scoped registry",
            );
          }
          return;
        }
        if (
          event.eventType !== "source.tile-delivered.v2" &&
          event.eventType !== "source.coverage-observed.v2"
        ) {
          addIssue(
            context,
            ["event", "eventType"],
            "source scope permits only source child events",
          );
          return;
        }
        if (
          event.payload.browserEpochNonceSha256 !==
            scope.browserEpochNonceSha256 ||
          event.payload.sourceEpochNonceSha256 !==
            scope.sourceCustody.sourceEpochNonceSha256 ||
          event.payload.coverageSegmentIdSha256 !==
            scope.coverageSegmentIdSha256 ||
          event.payload.subjectSha256 !==
            scope.sourceCustody.sourceReviewSubjectSha256 ||
          event.payload.renderGeneration !== scope.renderGeneration
        ) {
          addIssue(
            context,
            ["event", "payload"],
            "source-review evidence must match the exact scoped epoch, segment, subject, and generation",
          );
        }
        return;
      }

      if (event.eventType === "mask.review-started.v2") {
        if (
          event.payload.browserEpochNonceSha256 !==
            scope.browserEpochNonceSha256 ||
          event.payload.coverageSegmentIdSha256 !==
            scope.coverageSegmentIdSha256 ||
          event.payload.renderGeneration !== scope.renderGeneration ||
          event.payload.maskReviewSubjectSha256 !==
            scope.maskReviewSubjectSha256 ||
          event.payload.maskStateSha256 !== scope.maskStateSha256 ||
          event.payload.frozenBindingSha256 !== scope.frozenBindingSha256
        ) {
          addIssue(
            context,
            ["event", "payload"],
            "mask-review start must match the scoped epoch, segment, generation, and mask identity",
          );
        }
        if (
          !sameExactSourceCustody(
            event.payload.sourceCustody,
            scope.sourceCustody,
          )
        ) {
          addIssue(
            context,
            ["event", "payload", "sourceCustody"],
            "mask-review start must match the exact scoped source custody",
          );
        }
        if (
          !sameImplementationBinding(
            event.payload.implementationManifest,
            scope.implementationManifest,
          )
        ) {
          addIssue(
            context,
            ["event", "payload", "implementationManifest"],
            "mask-review start must match the scoped implementation manifest",
          );
        }
        if (
          !sameFrozenBinding(event.payload.frozenBinding, scope.frozenBinding)
        ) {
          addIssue(
            context,
            ["event", "payload", "frozenBinding"],
            "mask-review start must match the exact scoped frozen binding",
          );
        }
        return;
      }
      if (
        event.eventType !== "mask.tile-delivered.v2" &&
        event.eventType !== "mask.coverage-observed.v2"
      ) {
        addIssue(
          context,
          ["event", "eventType"],
          "mask scope permits only mask child events",
        );
        return;
      }
      if (
        event.payload.browserEpochNonceSha256 !==
          scope.browserEpochNonceSha256 ||
        event.payload.sourceEpochNonceSha256 !==
          scope.sourceCustody.sourceEpochNonceSha256 ||
        event.payload.coverageSegmentIdSha256 !==
          scope.coverageSegmentIdSha256 ||
        event.payload.subjectSha256 !== scope.maskReviewSubjectSha256 ||
        event.payload.renderGeneration !== scope.renderGeneration
      ) {
        addIssue(
          context,
          ["event", "payload"],
          "mask-review evidence must match the exact scoped epoch, segment, subject, and generation",
        );
      }
    },
  );

export type GrandHallT554NativeReviewCoordinatorEventV2 = z.infer<
  typeof GrandHallT554NativeReviewCoordinatorEventV2Schema
>;
export type GrandHallT554NativeReviewSourceChildEventV2 = z.infer<
  typeof GrandHallT554NativeReviewSourceChildEventV2Schema
>;
export type GrandHallT554NativeReviewMaskChildEventV2 = z.infer<
  typeof GrandHallT554NativeReviewMaskChildEventV2Schema
>;
export type GrandHallT554NativeReviewChildEventV2 = z.infer<
  typeof GrandHallT554NativeReviewChildEventV2Schema
>;
export type GrandHallT554NativeReviewDomainEventV2 = z.infer<
  typeof GrandHallT554NativeReviewDomainEventV2Schema
>;
export type GrandHallT554NativeReviewScopedEventV2 = z.infer<
  typeof GrandHallT554NativeReviewScopedEventV2Schema
>;
