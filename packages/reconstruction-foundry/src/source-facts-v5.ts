import { createHash } from "node:crypto";
import { FoundryRelativePathSchema } from "@omnitwin/types";
import { z } from "zod";
import {
  FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE,
  FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_FACTS_FAILURE_CODES,
  FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_FACTS_FAILURE_CODES_BY_FORMAT,
  FoundryCalibrationTrajectorySourceFactsOutcomeSchema,
  FoundryCalibrationTrajectorySourceFactsSchema,
  FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_FACTS_LIMITS,
  type FoundryCalibrationTrajectorySourceFactsOutcome,
} from "./calibration-trajectory-source-facts.js";
import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "./canonical-json.js";
import { FoundryIntegrityError } from "./errors.js";
import {
  FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES,
  FOUNDRY_XBIN_OFFICIAL_EXPORT_NEXT_ACTION,
  type UniversalSourceFactsReceiptFileIdentity,
} from "./source-facts.js";
import {
  FOUNDRY_MEDIA_CONTAINER_RECEIPT_CANDIDATE_INPUT_TYPES,
  FOUNDRY_SOURCE_FACTS_V4_LIMITATIONS,
  FOUNDRY_UNIVERSAL_SOURCE_FACTS_V4,
  UniversalSourceFactsV4AssetSchema,
  UniversalSourceFactsV4FileResultSchema,
  UniversalSourceFactsV4ReceiptFileIdentitySchema,
  createUniversalSourceFactsV4ArtifactFromReceipt,
  createUniversalSourceFactsV4StreamCollector,
  type UniversalSourceFactsV4FinalizeOptions,
  type UniversalSourceFactsV4ReceiptFileIdentity,
} from "./source-facts-v4.js";

export { FOUNDRY_MEDIA_CONTAINER_RECEIPT_CANDIDATE_INPUT_TYPES };

export const FOUNDRY_UNIVERSAL_SOURCE_FACTS_V5 =
  "omnitwin.foundry.universal-source-facts.v5";
export const FOUNDRY_UNIVERSAL_SOURCE_FACTS_V5_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_UNIVERSAL_SOURCE_FACTS_V5";
export const FOUNDRY_SOURCE_FACTS_V5_LIMITATIONS = Object.freeze([
  ...FOUNDRY_SOURCE_FACTS_V4_LIMITATIONS,
  "CALIBRATION_TRAJECTORY_STRUCTURE_DOES_NOT_ESTABLISH_SEMANTICS_OR_APPLICABILITY",
  "RECEIPT_SCOPE_IS_ONLY_THE_SELECTED_FILE_SET",
] as const);

const SHA256_HEX = /^[a-f0-9]{64}$/u;
const STABLE_CODE = /^[A-Z][A-Z0-9_]{2,95}$/u;

export const UniversalSourceFactsV5ReceiptFileIdentitySchema =
  UniversalSourceFactsV4ReceiptFileIdentitySchema;
export type UniversalSourceFactsV5ReceiptFileIdentity =
  UniversalSourceFactsV4ReceiptFileIdentity;

const SourceIdentityBaseSchema = z.object({
  path: FoundryRelativePathSchema,
  sizeBytes: z.number().int().safe().nonnegative(),
  sha256: z.string().regex(SHA256_HEX),
}).strict();

const UnknownFactSchema = z.object({
  code: z.string().regex(STABLE_CODE),
  label: z.string().trim().min(1).max(120),
  reason: z.string().trim().min(1).max(500),
  decisiveNextTest: z.string().trim().min(1).max(500),
}).strict();

function unknownFact(
  code: string,
  label: string,
  reason: string,
  decisiveNextTest: string,
): Readonly<z.infer<typeof UnknownFactSchema>> {
  return Object.freeze(UnknownFactSchema.parse({ code, label, reason, decisiveNextTest }));
}

export const FOUNDRY_TRAJECTORY_DOCUMENT_UNKNOWNS = Object.freeze([
  unknownFact(
    "TRAJECTORY_FIELD_SEMANTICS_UNKNOWN",
    "Trajectory field semantics",
    "Complete record or JSON structure does not establish what any column, key, vector, matrix, or tuple means.",
    "Obtain a digest-bound format declaration that defines every field while preserving the exact source bytes as the evidence subject.",
  ),
  unknownFact(
    "TRAJECTORY_CLOCK_DOMAIN_AND_TIME_UNITS_UNKNOWN",
    "Clock domain and time units",
    "Numeric or string tokens do not establish a clock, epoch, timezone, time unit, cadence, or capture duration.",
    "Bind the exact source digest to an authoritative clock-domain and timestamp-unit declaration, then test ordering, gaps, and rollover separately.",
  ),
  unknownFact(
    "TRAJECTORY_TRANSFORM_CONVENTION_UNKNOWN",
    "Transform and rotation convention",
    "Tuple and matrix shapes do not establish transform direction, active or passive rotation, quaternion order, sign convention, or matrix layout.",
    "Obtain a digest-bound convention record and verify it with frozen asymmetric test poses before constructing any transform artifact.",
  ),
  unknownFact(
    "TRAJECTORY_COORDINATE_FRAME_AND_UNITS_UNKNOWN",
    "Coordinate frame and units",
    "Document structure does not establish axes, handedness, origin, scale, physical units, CRS, datum, or registration to a venue frame.",
    "Obtain authoritative frame and unit declarations plus independently reviewed control before assigning spatial authority.",
  ),
  unknownFact(
    "TRAJECTORY_COMPLETENESS_AND_SYNCHRONIZATION_UNKNOWN",
    "Completeness and synchronization",
    "A complete document parse does not establish missing samples, interpolation rules, continuity, sensor synchronization, or relationship to sibling files.",
    "Use a digest-bound capture manifest and independently test sequence gaps and cross-sensor synchronization without relying on folder adjacency.",
  ),
  unknownFact(
    "TRAJECTORY_ACCURACY_AND_DRIFT_UNKNOWN",
    "Accuracy, drift, and covariance",
    "Finite tokens or monotonic values do not establish pose accuracy, accumulated drift, covariance, precision, or fitness for measurement.",
    "Compare against independent survey control and frozen blind checks with declared acceptance limits and uncertainty treatment.",
  ),
  unknownFact(
    "TRAJECTORY_PROVENANCE_UNKNOWN",
    "Trajectory provenance",
    "The document does not establish the producing device, software, capture session, transformations, or lineage to other assets.",
    "Obtain a digest-bound lineage record naming the producer, capture session, transformations, and every exact parent digest.",
  ),
  unknownFact(
    "TRAJECTORY_RIGHTS_UNKNOWN",
    "Trajectory usage rights",
    "Read-only structure inspection does not evaluate ownership, privacy, commercial use, derivative output, or redistribution rights.",
    "Obtain an authorized purpose-scoped rights decision bound to this exact SHA-256.",
  ),
] as const);

export const FOUNDRY_CALIBRATION_DOCUMENT_UNKNOWNS = Object.freeze([
  unknownFact(
    "CALIBRATION_FIELD_SEMANTICS_UNKNOWN",
    "Calibration field semantics",
    "Complete JSON structure does not establish what declared keys, arrays, matrices, or numeric tokens mean.",
    "Obtain a digest-bound calibration format declaration that defines every field and supported model version.",
  ),
  unknownFact(
    "CALIBRATION_SENSOR_APPLICABILITY_UNKNOWN",
    "Sensor applicability",
    "The document does not prove which physical sensor, lens, device revision, operating mode, focus state, or capture interval it applies to.",
    "Bind the exact source digest to verified device and sensor identities, calibration date, validity interval, and operating conditions.",
  ),
  unknownFact(
    "CALIBRATION_INTRINSICS_AND_DISTORTION_UNKNOWN",
    "Intrinsics and distortion",
    "Key names and numeric shapes do not establish a complete camera model, coefficient order, image geometry, crop, binning, or distortion validity.",
    "Verify the declared camera model and coefficient ordering against controlled calibration observations and exact image geometry.",
  ),
  unknownFact(
    "CALIBRATION_EXTRINSIC_CONVENTION_UNKNOWN",
    "Extrinsic convention, frame, and units",
    "Matrix or tuple shapes do not establish transform direction, matrix layout, axes, handedness, origin, scale, units, or frame relationships.",
    "Obtain a digest-bound convention and frame record, then verify asymmetric transforms before constructing any transform artifact.",
  ),
  unknownFact(
    "CALIBRATION_TIMING_AND_READOUT_UNKNOWN",
    "Timing and readout",
    "Document structure does not establish exposure timing, rolling-shutter readout, synchronization, latency, or clock relationships.",
    "Obtain authoritative timing and readout declarations and verify them against a controlled synchronized capture.",
  ),
  unknownFact(
    "CALIBRATION_UNCERTAINTY_AND_VALIDATION_UNKNOWN",
    "Uncertainty and independent validation",
    "A syntactically valid document does not establish residuals, uncertainty, calibration quality, stability, or independent validation.",
    "Review the calibration procedure and compare independent held-out observations under frozen acceptance limits.",
  ),
  unknownFact(
    "CALIBRATION_PROVENANCE_UNKNOWN",
    "Calibration provenance",
    "The document does not establish the author, instrument, software, procedure, parent observations, edits, or lineage.",
    "Obtain a digest-bound calibration lineage record naming the author, procedure, software, instruments, and exact parent digests.",
  ),
  unknownFact(
    "CALIBRATION_RIGHTS_UNKNOWN",
    "Calibration usage rights",
    "Read-only structure inspection does not evaluate ownership, confidentiality, commercial use, derivative output, or redistribution rights.",
    "Obtain an authorized purpose-scoped rights decision bound to this exact SHA-256.",
  ),
] as const);

const RegistrationDocumentInputTypeSchema = z.enum([
  "calibration_bundle",
  "trajectory",
]);
type RegistrationDocumentInputType = z.infer<typeof RegistrationDocumentInputTypeSchema>;

const RegistrationDocumentSourceSchema = SourceIdentityBaseSchema.extend({
  inputType: RegistrationDocumentInputTypeSchema,
  receiptCandidateInputTypes: z.tuple([RegistrationDocumentInputTypeSchema]),
}).strict().superRefine((source, ctx) => {
  if (source.receiptCandidateInputTypes[0] !== source.inputType) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["receiptCandidateInputTypes"],
      message: "registration-document source must preserve its one exact receipt candidate",
    });
  }
});

const RegistrationDocumentInspectionSchema = z.object({
  state: z.enum(["established", "facts_not_established"]),
  category: z.enum([
    "established",
    "resource_limit",
    "parse_failure",
    "unsupported_variant",
  ]),
  code: z.union([
    z.literal("CALIBRATION_TRAJECTORY_DOCUMENT_FACTS_ESTABLISHED"),
    z.enum(FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_FACTS_FAILURE_CODES),
  ]),
  coverage: z.enum([
    "none",
    "complete_record_structure",
    "complete_json_syntax_and_shape",
  ]),
}).strict().superRefine((inspection, ctx) => {
  if ((inspection.state === "established") !== (inspection.category === "established")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["category"],
      message: "registration-document inspection state and category must agree",
    });
  }
  if (inspection.state === "established") {
    if (inspection.code !== "CALIBRATION_TRAJECTORY_DOCUMENT_FACTS_ESTABLISHED") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["code"],
        message: "established registration-document inspection must use the frozen success code",
      });
    }
    return;
  }
  if (
    inspection.code === "CALIBRATION_TRAJECTORY_DOCUMENT_FACTS_ESTABLISHED" ||
    FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE[
      inspection.code
    ] !== inspection.category
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["code"],
      message: "failed registration-document inspection code and category must match the frozen failure registry",
    });
  }
});

const RegistrationDocumentAssetSchema = z.object({
  source: RegistrationDocumentSourceSchema,
  format: z.enum(["csv", "json", "calibration_trajectory_document"]),
  inspection: RegistrationDocumentInspectionSchema,
  facts: FoundryCalibrationTrajectorySourceFactsSchema.nullable(),
  unknowns: z.array(UnknownFactSchema).length(8),
}).strict().superRefine((asset, ctx) => {
  const expectedUnknowns = asset.source.inputType === "trajectory"
    ? FOUNDRY_TRAJECTORY_DOCUMENT_UNKNOWNS
    : FOUNDRY_CALIBRATION_DOCUMENT_UNKNOWNS;
  if (JSON.stringify(asset.unknowns) !== JSON.stringify(expectedUnknowns)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["unknowns"],
      message: "registration-document unknowns must match the frozen V5 input-family profile",
    });
  }
  const facts = asset.facts;
  if ((asset.inspection.state === "established") !== (facts !== null)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["facts"],
      message: "registration-document facts must match inspection state",
    });
    return;
  }
  if (asset.inspection.state === "established") {
    if (facts === null) return;
    const factsFormat = facts.format;
    const pathFormat = documentFormat(asset.source.path);
    const coverage = factsFormat === "csv"
      ? "complete_record_structure"
      : "complete_json_syntax_and_shape";
    if (
      asset.inspection.category !== "established" ||
      asset.inspection.code !== "CALIBRATION_TRAJECTORY_DOCUMENT_FACTS_ESTABLISHED" ||
      asset.inspection.coverage !== coverage ||
      asset.format !== factsFormat ||
      pathFormat !== factsFormat ||
      facts.container.sourceSizeBytes !== asset.source.sizeBytes ||
      facts.container.sourceSha256 !== asset.source.sha256
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["inspection"],
        message: "established registration-document fields are inconsistent",
      });
    }
    return;
  }
  const pathFormat = documentFormat(asset.source.path);
  const failureCode = asset.inspection.code;
  const failureCodeMatchesPath = failureCode !==
    "CALIBRATION_TRAJECTORY_DOCUMENT_FACTS_ESTABLISHED" &&
    (pathFormat === null
      ? failureCode === "CALIBRATION_TRAJECTORY_DOCUMENT_EXTENSION_UNSUPPORTED"
      : FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_FACTS_FAILURE_CODES_BY_FORMAT[
        pathFormat
      ].some((code) => code === failureCode));
  if (
    asset.format !== "calibration_trajectory_document" ||
    asset.facts !== null ||
    asset.inspection.coverage !== "none" ||
    !failureCodeMatchesPath
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["inspection"],
      message: "failed registration-document inspection must remain a neutral placeholder",
    });
  }
});

export const UniversalSourceFactsV5AssetSchema = z.union([
  UniversalSourceFactsV4AssetSchema,
  RegistrationDocumentAssetSchema,
]);
export type UniversalSourceFactsV5Asset = z.infer<typeof UniversalSourceFactsV5AssetSchema>;

function isRegistrationDocumentAsset(
  asset: UniversalSourceFactsV5Asset,
): asset is z.infer<typeof RegistrationDocumentAssetSchema> {
  return asset.source.inputType === "calibration_bundle" ||
    asset.source.inputType === "trajectory";
}

const BlockedSourceSchema = SourceIdentityBaseSchema.extend({
  inputType: z.literal("xgrids_xbin"),
}).strict();

export const UniversalSourceFactsV5FileResultSchema = z.union([
  UniversalSourceFactsV4FileResultSchema,
  z.object({ kind: z.literal("asset"), asset: RegistrationDocumentAssetSchema }).strict(),
]);
export type UniversalSourceFactsV5FileResult = z.infer<
  typeof UniversalSourceFactsV5FileResultSchema
>;

const PolicySchema = z.object({
  sourceAccess: z.literal("read_only"),
  mutation: z.literal("none"),
  reconstruction: z.literal("none"),
  networkAccess: z.literal("none"),
  externalProcess: z.enum(["none", "local_pye57_read_only"]),
  metadataProbe: z.enum(["none", "local_pye57_read_only"]),
  authority: z.literal("none"),
  rights: z.literal("not_evaluated"),
}).strict();

const RegistrationDocumentLimitsSchema = z.record(
  z.string().trim().min(1).max(120),
  z.number().int().safe().nonnegative(),
).superRefine((limits, ctx) => {
  if (
    stableCanonicalJson(limits) !==
      stableCanonicalJson(FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_FACTS_LIMITS)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "registration-document limits must match the immutable inspector profile",
    });
  }
});

const LimitsSchema = z.object({
  inheritedProfile: z.literal(FOUNDRY_UNIVERSAL_SOURCE_FACTS_V4),
  calibrationTrajectoryDocument: RegistrationDocumentLimitsSchema,
}).strict();

const SummarySchema = z.object({
  receiptFileCount: z.number().int().min(0).max(FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES),
  assetCount: z.number().int().min(0).max(FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES),
  establishedCount: z.number().int().min(0).max(FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES),
  factsNotEstablishedCount: z.number().int().min(0).max(FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES),
  untargetedFileCount: z.number().int().min(0).max(FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES),
  blockedSourceCount: z.number().int().min(0).max(FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES),
}).strict();

const LimitationsSchema = z.tuple([
  z.literal(FOUNDRY_SOURCE_FACTS_V5_LIMITATIONS[0]),
  z.literal(FOUNDRY_SOURCE_FACTS_V5_LIMITATIONS[1]),
  z.literal(FOUNDRY_SOURCE_FACTS_V5_LIMITATIONS[2]),
  z.literal(FOUNDRY_SOURCE_FACTS_V5_LIMITATIONS[3]),
  z.literal(FOUNDRY_SOURCE_FACTS_V5_LIMITATIONS[4]),
]);

const ArtifactBaseSchema = z.object({
  schemaVersion: z.literal(FOUNDRY_UNIVERSAL_SOURCE_FACTS_V5),
  receiptSha256: z.string().regex(SHA256_HEX),
  policy: PolicySchema,
  limitations: LimitationsSchema,
  limits: LimitsSchema,
  summary: SummarySchema,
  factsSha256: z.string().regex(SHA256_HEX),
}).strict();

const AvailableArtifactSchema = ArtifactBaseSchema.extend({
  state: z.literal("available"),
  assets: z.array(UniversalSourceFactsV5AssetSchema).max(
    FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES,
  ),
}).strict();

const UnavailableArtifactSchema = ArtifactBaseSchema.extend({
  state: z.literal("unavailable"),
  assets: z.tuple([]),
  affectedSources: z.array(BlockedSourceSchema).min(1).max(
    FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES,
  ),
  reason: z.object({
    code: z.literal("XGRIDS_XBIN_UNSUPPORTED"),
    message: z.literal(
      "Universal Source Facts V5 are unavailable because the receipt includes an unsupported XGRIDS XBIN candidate.",
    ),
    nextAction: z.literal(FOUNDRY_XBIN_OFFICIAL_EXPORT_NEXT_ACTION),
  }).strict(),
}).strict();

type ArtifactWithoutValidation = z.infer<typeof AvailableArtifactSchema> |
  z.infer<typeof UnavailableArtifactSchema>;
type ArtifactPayload = ArtifactWithoutValidation extends infer Artifact
  ? Artifact extends ArtifactWithoutValidation
    ? Omit<Artifact, "factsSha256">
    : never
  : never;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function artifactDigest(value: ArtifactWithoutValidation): string {
  const { factsSha256: _factsSha256, ...payload } = value;
  return domainSeparatedSha256(
    FOUNDRY_UNIVERSAL_SOURCE_FACTS_V5_DIGEST_DOMAIN,
    toCanonicalJson(payload),
  );
}

function validateArtifact(value: ArtifactWithoutValidation, ctx: z.RefinementCtx): void {
  const paths = value.assets.map((asset) => asset.source.path);
  const sorted = [...paths].sort(compareText);
  if (
    new Set(paths).size !== paths.length ||
    paths.some((path, index) => path !== sorted[index])
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["assets"],
      message: "V5 asset paths must be unique and sorted",
    });
  }
  const expectedSummary = value.state === "available"
    ? {
        receiptFileCount: value.summary.receiptFileCount,
        assetCount: value.assets.length,
        establishedCount: value.assets.filter(
          (asset) => asset.inspection.state === "established",
        ).length,
        factsNotEstablishedCount: value.assets.filter(
          (asset) => asset.inspection.state === "facts_not_established",
        ).length,
        untargetedFileCount: value.summary.receiptFileCount - value.assets.length,
        blockedSourceCount: 0,
      }
    : {
        receiptFileCount: value.summary.receiptFileCount,
        assetCount: 0,
        establishedCount: 0,
        factsNotEstablishedCount: 0,
        untargetedFileCount:
          value.summary.receiptFileCount - value.affectedSources.length,
        blockedSourceCount: value.affectedSources.length,
      };
  if (
    expectedSummary.untargetedFileCount < 0 ||
    JSON.stringify(value.summary) !== JSON.stringify(expectedSummary)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["summary"],
      message: "V5 summary contradicts attached evidence",
    });
  }
  if (value.state === "unavailable") {
    const affectedPaths = value.affectedSources.map((source) => source.path);
    const affectedSorted = [...affectedPaths].sort(compareText);
    if (
      new Set(affectedPaths).size !== affectedPaths.length ||
      affectedPaths.some((path, index) => path !== affectedSorted[index])
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["affectedSources"],
        message: "V5 affected XBIN sources must be unique and sorted",
      });
    }
  }
  const usesPye57 = value.state === "available" && value.assets.some((asset) =>
    asset.format === "e57" &&
    asset.facts !== null &&
    "aggregateMetadata" in asset.facts &&
    asset.facts.aggregateMetadata !== null
  );
  const expectedProbe = usesPye57 ? "local_pye57_read_only" : "none";
  if (
    value.policy.metadataProbe !== expectedProbe ||
    value.policy.externalProcess !== expectedProbe
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["policy", "metadataProbe"],
      message: "V5 metadata probe policy contradicts attached E57 evidence",
    });
  }
  if (value.factsSha256 !== artifactDigest(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["factsSha256"],
      message: "V5 facts digest does not match canonical payload",
    });
  }
}

export const FoundryUniversalSourceFactsV5Schema = z.discriminatedUnion("state", [
  AvailableArtifactSchema,
  UnavailableArtifactSchema,
]).superRefine(validateArtifact);
export type FoundryUniversalSourceFactsV5 = z.infer<
  typeof FoundryUniversalSourceFactsV5Schema
>;

export interface UniversalSourceFactsV5FinalizeOptions
  extends UniversalSourceFactsV4FinalizeOptions {
  readonly calibrationTrajectoryInspection?: FoundryCalibrationTrajectorySourceFactsOutcome;
}

export interface UniversalSourceFactsV5StreamCollector {
  observe(chunk: Uint8Array, absoluteOffset: number): void;
  finalize(
    identity: UniversalSourceFactsV5ReceiptFileIdentity,
    options?: UniversalSourceFactsV5FinalizeOptions,
  ): UniversalSourceFactsV5FileResult;
}

function hasCandidate(
  identity: UniversalSourceFactsReceiptFileIdentity,
  inputType: string,
): boolean {
  return identity.detection.candidates.some(
    (candidate) => candidate.inputType === inputType,
  );
}

function extension(relativePath: string): string {
  const leaf = relativePath.replaceAll("\\", "/").split("/").at(-1) ?? relativePath;
  const dot = leaf.lastIndexOf(".");
  return dot < 0 ? "" : leaf.slice(dot).toLowerCase();
}

function claimedByV1ThroughV3SourceFacts(
  identity: UniversalSourceFactsV5ReceiptFileIdentity,
): boolean {
  const magicHex = identity.magicHex;
  if (
    magicHex.startsWith("4153544d2d453537") ||
    magicHex.startsWith("676c5446")
  ) return true;
  const suffix = extension(identity.path);
  return hasCandidate(identity, "gaussian_ply") ||
    hasCandidate(identity, "ply_point_cloud") ||
    hasCandidate(identity, "spz") || suffix === ".spz" ||
    hasCandidate(identity, "sog") || suffix === ".sog" ||
    hasCandidate(identity, "generic_e57") ||
    hasCandidate(identity, "matterport_e57") || suffix === ".e57" ||
    hasCandidate(identity, "glb_gltf") || suffix === ".gltf" || suffix === ".glb" ||
    hasCandidate(identity, "obj") || suffix === ".obj";
}

function claimedByInheritedSourceFacts(
  identity: UniversalSourceFactsV5ReceiptFileIdentity,
): boolean {
  return claimedByV1ThroughV3SourceFacts(identity) ||
    FOUNDRY_MEDIA_CONTAINER_RECEIPT_CANDIDATE_INPUT_TYPES.some((inputType) =>
      hasCandidate(identity, inputType)
    );
}

function registrationDocumentTarget(
  identity: UniversalSourceFactsV5ReceiptFileIdentity,
): RegistrationDocumentInputType | null {
  if (claimedByInheritedSourceFacts(identity)) return null;
  if (
    identity.detection.status !== "detected" ||
    identity.detection.candidates.length !== 1
  ) return null;
  const candidate = identity.detection.candidates[0]?.inputType;
  return candidate === "calibration_bundle" || candidate === "trajectory"
    ? candidate
    : null;
}

function mediaReceiptCandidates(
  identity: UniversalSourceFactsV5ReceiptFileIdentity,
): Array<(typeof FOUNDRY_MEDIA_CONTAINER_RECEIPT_CANDIDATE_INPUT_TYPES)[number]> {
  const present = new Set(
    identity.detection.candidates.map((candidate) => candidate.inputType),
  );
  return FOUNDRY_MEDIA_CONTAINER_RECEIPT_CANDIDATE_INPUT_TYPES.filter((inputType) =>
    present.has(inputType)
  );
}

function establishedMediaFormatFromMagic(
  magicHex: string,
): "jpeg" | "png" | "iso_bmff" | null {
  if (magicHex.startsWith("89504e470d0a1a0a")) return "png";
  if (magicHex.startsWith("ffd8")) return "jpeg";
  if (magicHex.length >= 16 && magicHex.slice(8, 16) === "66747970") {
    return "iso_bmff";
  }
  return null;
}

function expectedAssetTarget(
  identity: UniversalSourceFactsV5ReceiptFileIdentity,
  asset: UniversalSourceFactsV5Asset | null,
): { readonly inputType: string; readonly format: string } | null {
  const magic = identity.magicHex;
  const e57Magic = magic.startsWith("4153544d2d453537");
  const glbMagic = magic.startsWith("676c5446");
  const suffix = extension(identity.path);
  if (e57Magic) {
    return {
      inputType: hasCandidate(identity, "matterport_e57")
        ? "matterport_e57"
        : "generic_e57",
      format: "e57",
    };
  }
  if (glbMagic) return { inputType: "glb_gltf", format: "glb" };
  const establishedGaussianRefinement = hasCandidate(identity, "ply_point_cloud") &&
    asset?.format === "gaussian_ply" &&
    asset.inspection.state === "established";
  if (hasCandidate(identity, "gaussian_ply") || establishedGaussianRefinement) {
    return { inputType: "gaussian_ply", format: "gaussian_ply" };
  }
  if (hasCandidate(identity, "spz") || suffix === ".spz") {
    return { inputType: "spz", format: "spz" };
  }
  if (hasCandidate(identity, "sog") || suffix === ".sog") {
    return { inputType: "sog", format: "sog" };
  }
  if (
    hasCandidate(identity, "generic_e57") ||
    hasCandidate(identity, "matterport_e57") ||
    suffix === ".e57"
  ) {
    return {
      inputType: hasCandidate(identity, "matterport_e57")
        ? "matterport_e57"
        : "generic_e57",
      format: "e57",
    };
  }
  if (hasCandidate(identity, "glb_gltf")) {
    return {
      inputType: "glb_gltf",
      format: suffix === ".gltf" ? "gltf_json" : "glb",
    };
  }
  if (suffix === ".obj") return { inputType: "obj", format: "obj" };
  if (claimedByV1ThroughV3SourceFacts(identity)) return null;

  const registrationTarget = registrationDocumentTarget(identity);
  if (registrationTarget !== null) {
    const format = asset?.inspection.state === "facts_not_established"
      ? "calibration_trajectory_document"
      : suffix === ".csv"
        ? "csv"
        : suffix === ".json"
          ? "json"
          : "calibration_trajectory_document";
    return { inputType: registrationTarget, format };
  }

  const mediaCandidates = mediaReceiptCandidates(identity);
  if (mediaCandidates.length === 0) return null;
  const format = asset?.inspection.state === "facts_not_established"
    ? "media_container"
    : establishedMediaFormatFromMagic(magic) ?? "media_container";
  const inputType = format === "iso_bmff"
    ? "video"
    : format === "jpeg" || format === "png"
      ? "generic_image"
      : mediaCandidates.includes("video")
        ? "video"
        : mediaCandidates.length === 1 && mediaCandidates[0] === "drone_media"
          ? "drone_media"
          : "generic_image";
  return { inputType, format };
}

function documentFormat(
  relativePath: string,
): "csv" | "json" | null {
  const suffix = extension(relativePath);
  if (suffix === ".csv") return "csv";
  if (suffix === ".json") return "json";
  return null;
}

function documentUnknowns(inputType: RegistrationDocumentInputType) {
  return inputType === "trajectory"
    ? FOUNDRY_TRAJECTORY_DOCUMENT_UNKNOWNS
    : FOUNDRY_CALIBRATION_DOCUMENT_UNKNOWNS;
}

function registrationDocumentResult(
  identity: UniversalSourceFactsV5ReceiptFileIdentity,
  inputType: RegistrationDocumentInputType,
  outcomeInput: FoundryCalibrationTrajectorySourceFactsOutcome | null,
): UniversalSourceFactsV5FileResult {
  const source = {
    path: identity.path,
    sizeBytes: identity.sizeBytes,
    sha256: identity.sha256,
    inputType,
    receiptCandidateInputTypes: [inputType] as const,
  };
  const format = documentFormat(identity.path);
  if (format === null) {
    if (outcomeInput !== null) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V5_UNEXPECTED_CALIBRATION_TRAJECTORY_INSPECTION",
        "A bounded registration-document inspection was supplied for an unsupported extension.",
      );
    }
    return UniversalSourceFactsV5FileResultSchema.parse({
      kind: "asset",
      asset: {
        source,
        format: "calibration_trajectory_document",
        inspection: {
          state: "facts_not_established",
          category: "unsupported_variant",
          code: "CALIBRATION_TRAJECTORY_DOCUMENT_EXTENSION_UNSUPPORTED",
          coverage: "none",
        },
        facts: null,
        unknowns: documentUnknowns(inputType),
      },
    });
  }
  if (outcomeInput === null) {
    throw new FoundryIntegrityError(
      "SOURCE_FACTS_V5_CALIBRATION_TRAJECTORY_INSPECTION_REQUIRED",
      "CSV and JSON registration-document Source Facts require bounded same-handle inspection.",
    );
  }
  const outcome = FoundryCalibrationTrajectorySourceFactsOutcomeSchema.parse(outcomeInput);
  if (
    outcome.state === "facts_not_established" &&
    !FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_FACTS_FAILURE_CODES_BY_FORMAT[
      format
    ].some((code) => code === outcome.code)
  ) {
    throw new FoundryIntegrityError(
      "SOURCE_FACTS_V5_CALIBRATION_TRAJECTORY_FAILURE_CODE_FORMAT_MISMATCH",
      "The registration-document inspection failure code contradicts its receipt-bound CSV or JSON format.",
    );
  }
  if (outcome.state === "facts_not_established" && outcome.category === "cancelled") {
    throw new FoundryIntegrityError(
      "SOURCE_FACTS_V5_CALIBRATION_TRAJECTORY_INSPECTION_CANCELLED",
      "The registration-document Source Facts inspection was cancelled; no V5 artifact was issued.",
    );
  }
  if (outcome.state === "established") {
    const facts = FoundryCalibrationTrajectorySourceFactsSchema.parse(outcome.facts);
    if (facts.format !== format) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V5_CALIBRATION_TRAJECTORY_FORMAT_BINDING_MISMATCH",
        "Established registration-document facts contradict the receipt-bound filename profile.",
      );
    }
    return UniversalSourceFactsV5FileResultSchema.parse({
      kind: "asset",
      asset: {
        source,
        format,
        inspection: {
          state: "established",
          category: "established",
          code: "CALIBRATION_TRAJECTORY_DOCUMENT_FACTS_ESTABLISHED",
          coverage: format === "csv"
            ? "complete_record_structure"
            : "complete_json_syntax_and_shape",
        },
        facts,
        unknowns: documentUnknowns(inputType),
      },
    });
  }
  return UniversalSourceFactsV5FileResultSchema.parse({
    kind: "asset",
    asset: {
      source,
      format: "calibration_trajectory_document",
      inspection: {
        state: "facts_not_established",
        category: outcome.category,
        code: outcome.code,
        coverage: "none",
      },
      facts: null,
      unknowns: documentUnknowns(inputType),
    },
  });
}

class UniversalSourceFactsV5StreamCollectorImpl
implements UniversalSourceFactsV5StreamCollector {
  private readonly v4Collector;
  private readonly hash = createHash("sha256");
  private readonly prefix = Buffer.alloc(128);
  private prefixBytes = 0;
  private observedBytes = 0;
  private finalized = false;

  constructor(private readonly relativePath: string) {
    this.relativePath = FoundryRelativePathSchema.parse(relativePath);
    this.v4Collector = createUniversalSourceFactsV4StreamCollector(this.relativePath);
  }

  observe(chunk: Uint8Array, absoluteOffset: number): void {
    if (this.finalized) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V5_COLLECTOR_FINALIZED",
        "Source Facts V5 collector is already finalized.",
      );
    }
    if (!(chunk instanceof Uint8Array) || absoluteOffset !== this.observedBytes) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V5_NONCONTIGUOUS_STREAM",
        "Source Facts V5 byte chunks must be contiguous and start at offset zero.",
      );
    }
    this.v4Collector.observe(chunk, absoluteOffset);
    this.hash.update(chunk);
    if (this.prefixBytes < this.prefix.length) {
      const copyBytes = Math.min(this.prefix.length - this.prefixBytes, chunk.length);
      this.prefix.set(chunk.subarray(0, copyBytes), this.prefixBytes);
      this.prefixBytes += copyBytes;
    }
    this.observedBytes += chunk.length;
  }

  finalize(
    identityInput: UniversalSourceFactsV5ReceiptFileIdentity,
    options: UniversalSourceFactsV5FinalizeOptions = {},
  ): UniversalSourceFactsV5FileResult {
    if (this.finalized) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V5_COLLECTOR_FINALIZED",
        "Source Facts V5 collector is already finalized.",
      );
    }
    this.finalized = true;
    const identity = UniversalSourceFactsV5ReceiptFileIdentitySchema.parse(identityInput);
    if (identity.path !== this.relativePath || identity.sizeBytes !== this.observedBytes) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V5_IDENTITY_MISMATCH",
        "Source Facts V5 bytes do not match their receipt identity.",
      );
    }
    const observedSha256 = this.hash.digest("hex");
    if (observedSha256 !== identity.sha256) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V5_SHA256_MISMATCH",
        "Source Facts V5 bytes do not match the receipt SHA-256.",
      );
    }
    const magicHex = this.prefix.subarray(0, this.prefixBytes).toString("hex");
    if (identity.magicHex !== magicHex) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V5_MAGIC_BINDING_MISMATCH",
        "Source Facts V5 prefix bytes do not match the receipt-bound magic bytes.",
      );
    }
    const target = registrationDocumentTarget(identity);
    const {
      calibrationTrajectoryInspection,
      ...v4Options
    } = options;
    if (target === null) {
      if (calibrationTrajectoryInspection !== undefined) {
        throw new FoundryIntegrityError(
          "SOURCE_FACTS_V5_UNEXPECTED_CALIBRATION_TRAJECTORY_INSPECTION",
          "A bounded registration-document inspection was supplied for a non-V5 target.",
        );
      }
      return UniversalSourceFactsV5FileResultSchema.parse(
        this.v4Collector.finalize(identity, v4Options),
      );
    }
    if (Object.keys(v4Options).length > 0) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V5_CONTRADICTORY_INSPECTIONS",
        "A registration-document target cannot carry an inherited format inspection.",
      );
    }
    if (
      calibrationTrajectoryInspection !== undefined &&
      (
        calibrationTrajectoryInspection.sourceSizeBytes !== this.observedBytes ||
        calibrationTrajectoryInspection.sourceSha256 !== observedSha256
      )
    ) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V5_CALIBRATION_TRAJECTORY_INSPECTION_SOURCE_MISMATCH",
        "The bounded registration-document inspection does not match the receipt-bound V5 byte stream.",
      );
    }
    return registrationDocumentResult(
      identity,
      target,
      calibrationTrajectoryInspection ?? null,
    );
  }
}

export function createUniversalSourceFactsV5StreamCollector(
  relativePath: string,
): UniversalSourceFactsV5StreamCollector {
  return new UniversalSourceFactsV5StreamCollectorImpl(relativePath);
}

const LIMITS: z.infer<typeof LimitsSchema> = {
  inheritedProfile: FOUNDRY_UNIVERSAL_SOURCE_FACTS_V4,
  calibrationTrajectoryDocument: FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_FACTS_LIMITS,
};

function resultSource(
  result: UniversalSourceFactsV5FileResult,
): z.infer<typeof SourceIdentityBaseSchema> {
  return result.kind === "asset" ? result.asset.source : result.source;
}

function policyForAssets(
  assets: readonly UniversalSourceFactsV5Asset[],
): z.infer<typeof PolicySchema> {
  const usesPye57 = assets.some((asset) =>
    asset.format === "e57" &&
    asset.facts !== null &&
    "aggregateMetadata" in asset.facts &&
    asset.facts.aggregateMetadata !== null
  );
  const probe = usesPye57 ? "local_pye57_read_only" as const : "none" as const;
  return {
    sourceAccess: "read_only",
    mutation: "none",
    reconstruction: "none",
    networkAccess: "none",
    externalProcess: probe,
    metadataProbe: probe,
    authority: "none",
    rights: "not_evaluated",
  };
}

function issueArtifact(payload: ArtifactPayload): FoundryUniversalSourceFactsV5 {
  const candidate = {
    ...payload,
    factsSha256: "0".repeat(64),
  } as ArtifactWithoutValidation;
  return FoundryUniversalSourceFactsV5Schema.parse({
    ...payload,
    factsSha256: artifactDigest(candidate),
  });
}

function uniqueSortedResults(
  inputs: readonly UniversalSourceFactsV5FileResult[],
): UniversalSourceFactsV5FileResult[] {
  if (inputs.length > FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES) {
    throw new FoundryIntegrityError(
      "SOURCE_FACTS_V5_FILE_COUNT_LIMIT",
      "Source Facts V5 results exceed the receipt file-count limit.",
    );
  }
  const results = inputs.map((result) => UniversalSourceFactsV5FileResultSchema.parse(result));
  results.sort((left, right) => compareText(resultSource(left).path, resultSource(right).path));
  const paths = results.map((result) => resultSource(result).path);
  if (new Set(paths).size !== paths.length) {
    throw new FoundryIntegrityError(
      "SOURCE_FACTS_V5_DUPLICATE_RESULT_PATH",
      "Source Facts V5 results must have unique paths.",
    );
  }
  return results;
}

function unavailableArtifact(
  receiptSha256: string,
  receiptFileCount: number,
  affectedSourcesInput: readonly z.infer<typeof BlockedSourceSchema>[],
): FoundryUniversalSourceFactsV5 {
  const affectedSources = affectedSourcesInput
    .map((source) => BlockedSourceSchema.parse(source))
    .sort((left, right) => compareText(left.path, right.path));
  return issueArtifact({
    schemaVersion: FOUNDRY_UNIVERSAL_SOURCE_FACTS_V5,
    receiptSha256,
    state: "unavailable",
    policy: policyForAssets([]),
    limitations: [...FOUNDRY_SOURCE_FACTS_V5_LIMITATIONS],
    limits: LIMITS,
    summary: {
      receiptFileCount,
      assetCount: 0,
      establishedCount: 0,
      factsNotEstablishedCount: 0,
      untargetedFileCount: receiptFileCount - affectedSources.length,
      blockedSourceCount: affectedSources.length,
    },
    assets: [],
    affectedSources,
    reason: {
      code: "XGRIDS_XBIN_UNSUPPORTED",
      message:
        "Universal Source Facts V5 are unavailable because the receipt includes an unsupported XGRIDS XBIN candidate.",
      nextAction: FOUNDRY_XBIN_OFFICIAL_EXPORT_NEXT_ACTION,
    },
  });
}

function availableArtifact(
  receiptSha256: string,
  receiptFileCount: number,
  results: readonly UniversalSourceFactsV5FileResult[],
): FoundryUniversalSourceFactsV5 {
  const assets = results
    .filter((result): result is Extract<
      UniversalSourceFactsV5FileResult,
      { readonly kind: "asset" }
    > => result.kind === "asset")
    .map((result) => result.asset)
    .sort((left, right) => compareText(left.source.path, right.source.path));
  return issueArtifact({
    schemaVersion: FOUNDRY_UNIVERSAL_SOURCE_FACTS_V5,
    receiptSha256,
    state: "available",
    policy: policyForAssets(assets),
    limitations: [...FOUNDRY_SOURCE_FACTS_V5_LIMITATIONS],
    limits: LIMITS,
    summary: {
      receiptFileCount,
      assetCount: assets.length,
      establishedCount: assets.filter(
        (asset) => asset.inspection.state === "established",
      ).length,
      factsNotEstablishedCount: assets.filter(
        (asset) => asset.inspection.state === "facts_not_established",
      ).length,
      untargetedFileCount: receiptFileCount - assets.length,
      blockedSourceCount: 0,
    },
    assets,
  });
}

export function createUniversalSourceFactsV5ArtifactFromReceipt(
  receiptSha256Input: string,
  identityInputs: readonly UniversalSourceFactsV5ReceiptFileIdentity[],
  resultInputs: readonly UniversalSourceFactsV5FileResult[] = [],
): FoundryUniversalSourceFactsV5 {
  const receiptSha256 = z.string().regex(SHA256_HEX).parse(receiptSha256Input);
  if (identityInputs.length > FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES) {
    throw new FoundryIntegrityError(
      "SOURCE_FACTS_V5_FILE_COUNT_LIMIT",
      "Source Facts V5 receipt identities exceed the file-count limit.",
    );
  }
  const identities = identityInputs
    .map((identity) => UniversalSourceFactsV5ReceiptFileIdentitySchema.parse(identity))
    .sort((left, right) => compareText(left.path, right.path));
  const identityPaths = identities.map((identity) => identity.path);
  if (new Set(identityPaths).size !== identityPaths.length) {
    throw new FoundryIntegrityError(
      "SOURCE_FACTS_V5_DUPLICATE_RECEIPT_PATH",
      "Source Facts V5 receipt identities must have unique paths.",
    );
  }
  const blocked = identities
    .filter((identity) => hasCandidate(identity, "xgrids_xbin"))
    .map((identity) => ({
      path: identity.path,
      sizeBytes: identity.sizeBytes,
      sha256: identity.sha256,
      inputType: "xgrids_xbin" as const,
    }));
  if (blocked.length > 0) {
    return unavailableArtifact(receiptSha256, identities.length, blocked);
  }

  const results = uniqueSortedResults(resultInputs);
  if (results.length !== identities.length) {
    throw new FoundryIntegrityError(
      "SOURCE_FACTS_V5_RESULT_SET_INCOMPLETE",
      "Available Source Facts V5 require one finalized result per receipt file.",
    );
  }
  const inheritedValidationResults = results.map((result) => {
    if (result.kind === "asset" && isRegistrationDocumentAsset(result.asset)) {
      return UniversalSourceFactsV4FileResultSchema.parse({
        kind: "untargeted",
        source: {
          path: result.asset.source.path,
          sizeBytes: result.asset.source.sizeBytes,
          sha256: result.asset.source.sha256,
        },
      });
    }
    return UniversalSourceFactsV4FileResultSchema.parse(result);
  });
  try {
    createUniversalSourceFactsV4ArtifactFromReceipt(
      receiptSha256,
      identities,
      inheritedValidationResults,
    );
  } catch (error: unknown) {
    throw new FoundryIntegrityError(
      "SOURCE_FACTS_V5_INHERITED_RESULT_INVALID",
      "A Source Facts V5 inherited result contradicts the receipt-derived V1-V4 target.",
      { cause: error },
    );
  }
  for (const [index, identity] of identities.entries()) {
    const result = results[index];
    if (result === undefined) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V5_RESULT_SET_INCOMPLETE",
        "Source Facts V5 result is missing.",
      );
    }
    const source = resultSource(result);
    if (
      source.path !== identity.path ||
      source.sizeBytes !== identity.sizeBytes ||
      source.sha256 !== identity.sha256
    ) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V5_RESULT_IDENTITY_MISMATCH",
        "Source Facts V5 result does not match its receipt identity.",
      );
    }
    if (result.kind === "xbin_block") {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V5_UNEXPECTED_XBIN_RESULT",
        "An XBIN result was not declared by receipt detection.",
      );
    }
    const asset = result.kind === "asset" ? result.asset : null;
    const expectedTarget = expectedAssetTarget(identity, asset);
    if ((asset !== null) !== (expectedTarget !== null)) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V5_RESULT_TARGET_MISMATCH",
        "A Source Facts V5 result does not match its exact receipt-derived V1-V5 target.",
      );
    }
    if (
      asset !== null &&
      expectedTarget !== null &&
      (
        asset.source.inputType !== expectedTarget.inputType ||
        asset.format !== expectedTarget.format
      )
    ) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V5_RESULT_TARGET_BINDING_MISMATCH",
        "A Source Facts V5 asset input type or format contradicts its exact receipt-derived target.",
      );
    }
    const target = registrationDocumentTarget(identity);
    const registrationAsset = result.kind === "asset" &&
      isRegistrationDocumentAsset(result.asset)
      ? result.asset
      : null;
    if ((registrationAsset !== null) !== (target !== null)) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V5_RESULT_TARGET_MISMATCH",
        "A Source Facts V5 result does not match the receipt-derived inherited/registration-document target.",
      );
    }
    if (registrationAsset !== null && target !== null) {
      if (
        registrationAsset.source.inputType !== target ||
        JSON.stringify(registrationAsset.source.receiptCandidateInputTypes) !==
          JSON.stringify([target])
      ) {
        throw new FoundryIntegrityError(
          "SOURCE_FACTS_V5_CALIBRATION_TRAJECTORY_CANDIDATE_BINDING_MISMATCH",
          "Registration-document Source Facts candidates do not exactly match receipt detection.",
        );
      }
      const expectedFormat = documentFormat(identity.path);
      if (
        registrationAsset.inspection.state === "established" &&
        registrationAsset.format !== expectedFormat
      ) {
        throw new FoundryIntegrityError(
          "SOURCE_FACTS_V5_CALIBRATION_TRAJECTORY_FORMAT_BINDING_MISMATCH",
          "Established registration-document format contradicts the receipt-bound extension profile.",
        );
      }
      if (
        registrationAsset.inspection.state === "facts_not_established" &&
        registrationAsset.format !== "calibration_trajectory_document"
      ) {
        throw new FoundryIntegrityError(
          "SOURCE_FACTS_V5_CALIBRATION_TRAJECTORY_FORMAT_BINDING_MISMATCH",
          "Failed registration-document facts must retain the neutral placeholder format.",
        );
      }
    }
  }
  return availableArtifact(receiptSha256, identities.length, results);
}

export function serializeUniversalSourceFactsV5Artifact(
  value: FoundryUniversalSourceFactsV5,
): string {
  return stableCanonicalJson(
    toCanonicalJson(FoundryUniversalSourceFactsV5Schema.parse(value)),
  );
}
