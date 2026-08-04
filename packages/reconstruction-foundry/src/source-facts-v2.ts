import { createHash } from "node:crypto";
import { E57_PHYSICAL_HEADER_BYTES, FoundryRelativePathSchema } from "@omnitwin/types";
import { z } from "zod";
import { domainSeparatedSha256, stableCanonicalJson, toCanonicalJson } from "./canonical-json.js";
import { FoundryIntegrityError } from "./errors.js";
import {
  FOUNDRY_SOG_META_JSON_MAX_DEPTH,
  FOUNDRY_SOG_META_JSON_MAX_VALUES,
  FOUNDRY_SOG_META_MAX_BYTES,
  FOUNDRY_SOG_WEBP_AGGREGATE_MAX_BYTES,
  FOUNDRY_SOG_WEBP_MEMBER_MAX_BYTES,
  FOUNDRY_SOG_ZIP_MAX_CENTRAL_DIRECTORY_BYTES,
  FOUNDRY_SOG_ZIP_MAX_ENTRIES,
  type FoundrySogSourceFactsOutcome,
} from "./sog-source-facts.js";
import {
  FOUNDRY_SOURCE_FACTS_GLB_JSON_MAX_BYTES,
  FOUNDRY_SOURCE_FACTS_GLB_JSON_MAX_DEPTH,
  FOUNDRY_SOURCE_FACTS_GLB_JSON_MAX_VALUES,
  FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES,
  FOUNDRY_SOURCE_FACTS_OBJ_LOGICAL_LINE_MAX_BYTES,
  FOUNDRY_XBIN_OFFICIAL_EXPORT_NEXT_ACTION,
  UniversalSourceFactsAssetSchema,
  UniversalSourceFactsReceiptFileIdentitySchema,
  createUniversalSourceFactsStreamCollector,
  type UniversalSourceFactsFileResult,
  type UniversalSourceFactsReceiptFileIdentity,
} from "./source-facts.js";
import {
  FOUNDRY_SPZ_DECOMPRESSED_MAX_BYTES,
  FOUNDRY_SPZ_EXTENSION_MAX_BYTES,
  FOUNDRY_SPZ_EXTENSION_MAX_RECORDS,
  FOUNDRY_SPZ_GZIP_HEADER_MAX_BYTES,
  FOUNDRY_SPZ_LEGACY_HEADER_BYTES,
  FOUNDRY_SPZ_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE,
  FOUNDRY_SPZ_SOURCE_FACTS_FAILURE_CODES,
  FOUNDRY_SPZ_SOURCE_FACTS_LIMITATIONS,
  FOUNDRY_SPZ_SOURCE_MAX_BYTES,
  FOUNDRY_SPZ_V4_HEADER_BYTES,
  FOUNDRY_SPZ_V4_MAX_COMPRESSION_RATIO,
  type FoundrySpzSourceFactsOutcome,
} from "./spz-source-facts.js";

export const FOUNDRY_UNIVERSAL_SOURCE_FACTS_V2 =
  "omnitwin.foundry.universal-source-facts.v2";
export const FOUNDRY_UNIVERSAL_SOURCE_FACTS_V2_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_UNIVERSAL_SOURCE_FACTS_V2";
export const FOUNDRY_SOURCE_FACTS_V2_LIMITATIONS = [
  "DIGEST_BINDING_IS_NOT_AN_ATOMIC_FILESYSTEM_SNAPSHOT",
  "FORMAT_FACTS_DO_NOT_ESTABLISH_ACCURACY_REGISTRATION_RIGHTS_OR_PROCESSING_ELIGIBILITY",
  "REFERENCED_OR_BINARY_PAYLOADS_ARE_NOT_IMPLICITLY_RESOLVED",
] as const;

const SHA256_HEX = /^[a-f0-9]{64}$/u;
const STABLE_CODE = /^[A-Z][A-Z0-9_]{2,95}$/u;
const TYPE_CODE_HEX = /^[a-f0-9]{8}$/u;

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

const InspectionSchema = z.object({
  state: z.enum(["established", "facts_not_established"]),
  category: z.enum([
    "established",
    "resource_limit",
    "parse_failure",
    "unsupported_variant",
    "unsupported_container",
  ]),
  code: z.string().regex(STABLE_CODE),
  coverage: z.enum([
    "none",
    "physical_header",
    "container_header",
    "container_header_and_json",
    "complete_container_structure",
    "complete_stream",
  ]),
}).strict().superRefine((value, ctx) => {
  if ((value.state === "established") !== (value.category === "established")) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["category"], message: "inspection state and category must agree" });
  }
});

function unknownFact(
  code: string,
  label: string,
  reason: string,
  decisiveNextTest: string,
): Readonly<z.infer<typeof UnknownFactSchema>> {
  return Object.freeze(UnknownFactSchema.parse({ code, label, reason, decisiveNextTest }));
}

export const FOUNDRY_SPZ_UNKNOWNS = Object.freeze([
  unknownFact("SPZ_ATTRIBUTE_VALUES_UNKNOWN", "Decoded Gaussian attributes", "This inspection does not establish decoded Gaussian attribute values; structural success establishes only the header, declared layout, and complete compression ranges.", "Run a separately reviewed bounded SPZ attribute decoder against this exact source digest and record value, finite-number, byte, point, and cancellation limits."),
  unknownFact("SPZ_PHYSICAL_BOUNDS_UNKNOWN", "Physical spatial bounds", "This inspection does not establish venue-space physical bounds; structural success traverses packed position bytes for compression integrity without decoding them.", "Decode positions under a documented SPZ convention, bind authoritative units and frame, and compute bounds against this exact source digest."),
  unknownFact("SPZ_UNITS_UNKNOWN", "Physical units", "This inspection does not establish authoritative physical units; supported SPZ structures contain no venue-specific unit attestation.", "Obtain authoritative source provenance that declares units and verify a known physical dimension."),
  unknownFact("SPZ_FRAME_UNKNOWN", "Coordinate frame", "This inspection does not establish the actual venue frame or a transform into it; nominal SPZ conventions and extension presence are insufficient.", "Bind this exact source digest to an authoritative frame transform and control record."),
  unknownFact("SPZ_RENDERER_COMPATIBILITY_UNKNOWN", "Renderer compatibility", "This inspection does not establish that a particular renderer supports or presents the source's exact version, SH degree, extensions, and semantics.", "Run a pinned offline compatibility probe against this exact digest and record loader version, limits, result, and every unsupported feature."),
  unknownFact("SPZ_VISUAL_FIDELITY_UNKNOWN", "Appearance fidelity", "This inspection does not establish visual fidelity to the captured venue.", "Compare frozen views in a pinned offline renderer with rights-cleared reference observations and record indeterminate regions."),
  unknownFact("SPZ_PROVENANCE_UNKNOWN", "Source provenance", "This inspection does not establish the capture, training, conversion, or export lineage of the source.", "Obtain an authoritative lineage record bound to this exact SHA-256, including capture source and every material conversion step."),
  unknownFact("SPZ_ACCURACY_UNKNOWN", "Physical accuracy", "This inspection does not establish metric accuracy.", "Compare decoded positions with independent survey control and frozen blind checks."),
  unknownFact("SPZ_REGISTRATION_UNKNOWN", "Registration quality", "This inspection does not establish alignment quality or residuals in the venue frame.", "Evaluate digest-bound decoded positions against independent control with a documented registration method and residual protocol."),
  unknownFact("SPZ_RIGHTS_UNKNOWN", "Usage rights", "This inspection does not evaluate ownership, model-training, derivative-output, or redistribution rights.", "Obtain an authorized purpose-scoped rights decision bound to this exact SHA-256."),
] as const);

const ExtensionRecordSchema = z.object({
  typeCodeHex: z.string().regex(TYPE_CODE_HEX),
  payloadBytes: z.number().int().min(0).max(FOUNDRY_SPZ_EXTENSION_MAX_BYTES),
  recognizedType: z.enum(["adobe_safe_orbit_camera", "adobe_coordinate_system", "unknown"]),
}).strict().superRefine((record, ctx) => {
  const expected = record.typeCodeHex === "adbe0002"
    ? "adobe_safe_orbit_camera"
    : record.typeCodeHex === "adbe0003"
      ? "adobe_coordinate_system"
      : "unknown";
  if (record.recognizedType !== expected) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["recognizedType"], message: "SPZ extension recognition contradicts its type code" });
  }
  if (
    (record.recognizedType === "adobe_safe_orbit_camera" && record.payloadBytes !== 12) ||
    (record.recognizedType === "adobe_coordinate_system" && record.payloadBytes !== 4)
  ) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["payloadBytes"], message: "recognized SPZ extension has the wrong payload length" });
  }
});

const ShFactsSchema = z.object({
  degree: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  nonDcCoefficientCount: z.union([z.literal(0), z.literal(3), z.literal(8), z.literal(15), z.literal(24)]),
  bytesPerGaussian: z.union([z.literal(0), z.literal(9), z.literal(24), z.literal(45), z.literal(72)]),
}).strict();

const AttributeLayoutSchema = z.object({
  positionEncoding: z.enum(["float16_xyz", "signed_fixed_point_24_xyz"]),
  positionBytesPerGaussian: z.union([z.literal(6), z.literal(9)]),
  alphaBytesPerGaussian: z.literal(1),
  colorDcBytesPerGaussian: z.literal(3),
  scaleBytesPerGaussian: z.literal(3),
  rotationEncoding: z.enum(["first_three_quaternion_uint8", "smallest_three_quaternion_uint32"]),
  rotationBytesPerGaussian: z.union([z.literal(3), z.literal(4)]),
  sphericalHarmonicsBytesPerGaussian: z.union([z.literal(0), z.literal(9), z.literal(24), z.literal(45), z.literal(72)]),
  totalBytesPerGaussian: z.number().int().positive().max(FOUNDRY_SPZ_DECOMPRESSED_MAX_BYTES),
}).strict();

const V4StreamSchema = z.object({
  role: z.enum(["positions", "alphas", "colors_dc", "scales", "rotations", "spherical_harmonics_non_dc"]),
  compressedSizeBytes: z.number().int().safe().positive(),
  uncompressedSizeBytes: z.number().int().safe().positive(),
  zstdFrameMagicVerified: z.literal(true),
  completeZstdDecompressionVerified: z.literal(true),
}).strict();

const LegacyContainerSchema = z.object({
  kind: z.literal("legacy_gzip"),
  sourceSizeBytes: z.number().int().safe().positive().max(FOUNDRY_SPZ_SOURCE_MAX_BYTES),
  headerBytes: z.literal(FOUNDRY_SPZ_LEGACY_HEADER_BYTES),
  corePayloadBytes: z.number().int().safe().positive().max(FOUNDRY_SPZ_DECOMPRESSED_MAX_BYTES),
  extensionBytes: z.number().int().min(0).max(FOUNDRY_SPZ_EXTENSION_MAX_BYTES),
  decompressedSizeBytes: z.number().int().safe().positive().max(FOUNDRY_SPZ_DECOMPRESSED_MAX_BYTES),
  gzipHeaderBytes: z.number().int().min(10).max(FOUNDRY_SPZ_GZIP_HEADER_MAX_BYTES),
  singleGzipMemberVerified: z.literal(true),
  gzipCrc32Verified: z.literal(true),
  gzipInputSizeVerified: z.literal(true),
  exactDecompressedLengthVerified: z.literal(true),
}).strict();

const V4ContainerSchema = z.object({
  kind: z.literal("v4_zstd_multistream"),
  sourceSizeBytes: z.number().int().safe().positive().max(FOUNDRY_SPZ_SOURCE_MAX_BYTES),
  headerBytes: z.literal(FOUNDRY_SPZ_V4_HEADER_BYTES),
  tocByteOffset: z.number().int().safe().min(FOUNDRY_SPZ_V4_HEADER_BYTES),
  tocBytes: z.union([z.literal(80), z.literal(96)]),
  streamCount: z.union([z.literal(5), z.literal(6)]),
  totalCompressedStreamBytes: z.number().int().safe().positive(),
  totalUncompressedStreamBytes: z.number().int().safe().positive().max(FOUNDRY_SPZ_DECOMPRESSED_MAX_BYTES),
  compressedStreamsEndAtFileEnd: z.literal(true),
  streams: z.array(V4StreamSchema).min(5).max(6),
}).strict();

export const FoundrySpzFactsV2Schema = z.object({
  format: z.enum(["spz_legacy_gzip", "spz_v4_zstd"]),
  inspectionCoverage: z.enum([
    "single_gzip_member_header_declared_layout_and_complete_stream",
    "plaintext_header_extensions_toc_and_complete_zstd_streams",
  ]),
  version: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  count: z.number().int().min(1).max(0x7fffffff),
  fractionalBitsRaw: z.number().int().min(0).max(255),
  antialiased: z.boolean(),
  sphericalHarmonics: ShFactsSchema,
  attributeLayout: AttributeLayoutSchema,
  extensions: z.object({
    declared: z.boolean(),
    totalBytes: z.number().int().min(0).max(FOUNDRY_SPZ_EXTENSION_MAX_BYTES),
    records: z.array(ExtensionRecordSchema).max(FOUNDRY_SPZ_EXTENSION_MAX_RECORDS),
  }).strict(),
  container: z.discriminatedUnion("kind", [LegacyContainerSchema, V4ContainerSchema]),
  limitations: z.tuple([
    z.literal(FOUNDRY_SPZ_SOURCE_FACTS_LIMITATIONS[0]),
    z.literal(FOUNDRY_SPZ_SOURCE_FACTS_LIMITATIONS[1]),
    z.literal(FOUNDRY_SPZ_SOURCE_FACTS_LIMITATIONS[2]),
  ]),
}).strict().superRefine((facts, ctx) => {
  const degree = facts.sphericalHarmonics.degree;
  const expectedCoefficients = [0, 3, 8, 15, 24][degree];
  const expectedShBytes = [0, 9, 24, 45, 72][degree];
  if (
    facts.sphericalHarmonics.nonDcCoefficientCount !== expectedCoefficients ||
    facts.sphericalHarmonics.bytesPerGaussian !== expectedShBytes
  ) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sphericalHarmonics"], message: "SPZ SH degree and byte counts disagree" });
  }
  const expectedPositionBytes = facts.version === 1 ? 6 : 9;
  const expectedRotationBytes = facts.version >= 3 ? 4 : 3;
  const expectedTotal = expectedPositionBytes + 1 + 3 + 3 + expectedRotationBytes + (expectedShBytes ?? 0);
  const layout = facts.attributeLayout;
  if (
    layout.positionBytesPerGaussian !== expectedPositionBytes ||
    layout.positionEncoding !== (facts.version === 1 ? "float16_xyz" : "signed_fixed_point_24_xyz") ||
    layout.rotationBytesPerGaussian !== expectedRotationBytes ||
    layout.rotationEncoding !== (facts.version >= 3 ? "smallest_three_quaternion_uint32" : "first_three_quaternion_uint8") ||
    layout.sphericalHarmonicsBytesPerGaussian !== expectedShBytes ||
    layout.totalBytesPerGaussian !== expectedTotal
  ) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["attributeLayout"], message: "SPZ version and attribute layout disagree" });
  }
  const recordBytes = facts.extensions.records.reduce((total, record) => total + 8 + record.payloadBytes, 0);
  if (
    facts.extensions.totalBytes !== recordBytes ||
    facts.extensions.declared !== (facts.extensions.totalBytes > 0)
  ) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["extensions"], message: "SPZ extension declarations and record bytes disagree" });
  }
  if (facts.container.kind === "legacy_gzip") {
    const expectedDecompressed = FOUNDRY_SPZ_LEGACY_HEADER_BYTES +
      facts.count * expectedTotal + facts.extensions.totalBytes;
    if (
      facts.version === 4 || facts.format !== "spz_legacy_gzip" ||
      facts.inspectionCoverage !== "single_gzip_member_header_declared_layout_and_complete_stream" ||
      facts.container.corePayloadBytes !== facts.count * expectedTotal ||
      facts.container.extensionBytes !== facts.extensions.totalBytes ||
      facts.container.decompressedSizeBytes !== expectedDecompressed
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["container"], message: "legacy SPZ container facts are inconsistent" });
    }
    return;
  }
  const expectedRoles = degree === 0
    ? ["positions", "alphas", "colors_dc", "scales", "rotations"]
    : ["positions", "alphas", "colors_dc", "scales", "rotations", "spherical_harmonics_non_dc"];
  const expectedSizes = [facts.count * 9, facts.count, facts.count * 3, facts.count * 3, facts.count * 4];
  if (degree > 0) expectedSizes.push(facts.count * (expectedShBytes ?? 0));
  const compressedTotal = facts.container.streams.reduce((total, stream) => total + stream.compressedSizeBytes, 0);
  const uncompressedTotal = facts.container.streams.reduce((total, stream) => total + stream.uncompressedSizeBytes, 0);
  if (
    facts.version !== 4 || facts.format !== "spz_v4_zstd" ||
    facts.inspectionCoverage !== "plaintext_header_extensions_toc_and_complete_zstd_streams" ||
    facts.container.streamCount !== expectedRoles.length ||
    facts.container.tocBytes !== facts.container.streamCount * 16 ||
    facts.container.tocByteOffset !== FOUNDRY_SPZ_V4_HEADER_BYTES + facts.extensions.totalBytes ||
    JSON.stringify(facts.container.streams.map((stream) => stream.role)) !== JSON.stringify(expectedRoles) ||
    JSON.stringify(facts.container.streams.map((stream) => stream.uncompressedSizeBytes)) !== JSON.stringify(expectedSizes) ||
    facts.container.totalCompressedStreamBytes !== compressedTotal ||
    facts.container.totalUncompressedStreamBytes !== uncompressedTotal ||
    facts.container.sourceSizeBytes !== facts.container.tocByteOffset + facts.container.tocBytes + compressedTotal
  ) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["container"], message: "SPZ v4 stream table is inconsistent" });
  }
});
export type FoundrySpzFactsV2 = z.infer<typeof FoundrySpzFactsV2Schema>;

const SpzAssetSchema = z.object({
  source: SourceIdentityBaseSchema.extend({ inputType: z.literal("spz") }).strict(),
  format: z.literal("spz"),
  inspection: InspectionSchema,
  facts: FoundrySpzFactsV2Schema.nullable(),
  unknowns: z.array(UnknownFactSchema),
}).strict().superRefine((asset, ctx) => {
  if ((asset.inspection.state === "established") !== (asset.facts !== null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["facts"], message: "SPZ facts must match inspection state" });
  }
  if (JSON.stringify(asset.unknowns) !== JSON.stringify(FOUNDRY_SPZ_UNKNOWNS)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["unknowns"], message: "SPZ unknowns must match V2 coverage" });
  }
  if (asset.inspection.state === "established") {
    if (
      asset.inspection.category !== "established" ||
      asset.inspection.code !== "SPZ_FORMAT_FACTS_ESTABLISHED" ||
      asset.inspection.coverage !== "complete_stream" ||
      asset.facts?.container.sourceSizeBytes !== asset.source.sizeBytes
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["inspection"], message: "established SPZ inspection fields are inconsistent" });
    }
    return;
  }
  const code = asset.inspection.code as (typeof FOUNDRY_SPZ_SOURCE_FACTS_FAILURE_CODES)[number];
  const category = (FOUNDRY_SPZ_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE as Partial<
    Record<string, "parse_failure" | "resource_limit" | "unsupported_variant" | "unsupported_container" | "cancelled">
  >)[asset.inspection.code];
  if (
    !FOUNDRY_SPZ_SOURCE_FACTS_FAILURE_CODES.includes(code) ||
    category === undefined || category === "cancelled" ||
    asset.inspection.category !== category || asset.inspection.coverage !== "none"
  ) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["inspection"], message: "failed SPZ inspection fields are inconsistent" });
  }
});

export const UniversalSourceFactsV2AssetSchema = z.union([
  UniversalSourceFactsAssetSchema,
  SpzAssetSchema,
]);
export type UniversalSourceFactsV2Asset = z.infer<typeof UniversalSourceFactsV2AssetSchema>;

const BlockedSourceSchema = SourceIdentityBaseSchema.extend({ inputType: z.literal("xgrids_xbin") }).strict();

export const UniversalSourceFactsV2FileResultSchema = z.union([
  z.object({ kind: z.literal("asset"), asset: UniversalSourceFactsV2AssetSchema }).strict(),
  z.object({ kind: z.literal("xbin_block"), source: BlockedSourceSchema }).strict(),
  z.object({ kind: z.literal("untargeted"), source: SourceIdentityBaseSchema }).strict(),
]);
export type UniversalSourceFactsV2FileResult = z.infer<typeof UniversalSourceFactsV2FileResultSchema>;

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

const LimitsSchema = z.object({
  e57PhysicalHeaderBytes: z.literal(E57_PHYSICAL_HEADER_BYTES),
  glbJsonChunkMaxBytes: z.literal(FOUNDRY_SOURCE_FACTS_GLB_JSON_MAX_BYTES),
  glbJsonMaxDepth: z.literal(FOUNDRY_SOURCE_FACTS_GLB_JSON_MAX_DEPTH),
  glbJsonMaxValues: z.literal(FOUNDRY_SOURCE_FACTS_GLB_JSON_MAX_VALUES),
  objLogicalLineMaxBytes: z.literal(FOUNDRY_SOURCE_FACTS_OBJ_LOGICAL_LINE_MAX_BYTES),
  sogZipMaxEntries: z.literal(FOUNDRY_SOG_ZIP_MAX_ENTRIES),
  sogZipCentralDirectoryMaxBytes: z.literal(FOUNDRY_SOG_ZIP_MAX_CENTRAL_DIRECTORY_BYTES),
  sogMetaJsonMaxBytes: z.literal(FOUNDRY_SOG_META_MAX_BYTES),
  sogMetaJsonMaxDepth: z.literal(FOUNDRY_SOG_META_JSON_MAX_DEPTH),
  sogMetaJsonMaxValues: z.literal(FOUNDRY_SOG_META_JSON_MAX_VALUES),
  sogWebpMemberMaxBytes: z.literal(FOUNDRY_SOG_WEBP_MEMBER_MAX_BYTES),
  sogWebpAggregateMaxBytes: z.literal(FOUNDRY_SOG_WEBP_AGGREGATE_MAX_BYTES),
  spzSourceMaxBytes: z.literal(FOUNDRY_SPZ_SOURCE_MAX_BYTES),
  spzDecompressedMaxBytes: z.literal(FOUNDRY_SPZ_DECOMPRESSED_MAX_BYTES),
  spzExtensionMaxBytes: z.literal(FOUNDRY_SPZ_EXTENSION_MAX_BYTES),
  spzExtensionMaxRecords: z.literal(FOUNDRY_SPZ_EXTENSION_MAX_RECORDS),
  spzGzipHeaderMaxBytes: z.literal(FOUNDRY_SPZ_GZIP_HEADER_MAX_BYTES),
  spzLegacyHeaderBytes: z.literal(FOUNDRY_SPZ_LEGACY_HEADER_BYTES),
  spzV4HeaderBytes: z.literal(FOUNDRY_SPZ_V4_HEADER_BYTES),
  spzV4MaxCompressionRatio: z.literal(FOUNDRY_SPZ_V4_MAX_COMPRESSION_RATIO),
}).strict();

const SummarySchema = z.object({
  receiptFileCount: z.number().int().min(0).max(FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES),
  assetCount: z.number().int().min(0).max(FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES),
  establishedCount: z.number().int().min(0).max(FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES),
  factsNotEstablishedCount: z.number().int().min(0).max(FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES),
  untargetedFileCount: z.number().int().min(0).max(FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES),
  blockedSourceCount: z.number().int().min(0).max(FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES),
}).strict();

const ArtifactBaseSchema = z.object({
  schemaVersion: z.literal(FOUNDRY_UNIVERSAL_SOURCE_FACTS_V2),
  receiptSha256: z.string().regex(SHA256_HEX),
  policy: PolicySchema,
  limitations: z.tuple([
    z.literal(FOUNDRY_SOURCE_FACTS_V2_LIMITATIONS[0]),
    z.literal(FOUNDRY_SOURCE_FACTS_V2_LIMITATIONS[1]),
    z.literal(FOUNDRY_SOURCE_FACTS_V2_LIMITATIONS[2]),
  ]),
  limits: LimitsSchema,
  summary: SummarySchema,
  factsSha256: z.string().regex(SHA256_HEX),
}).strict();

const AvailableArtifactSchema = ArtifactBaseSchema.extend({
  state: z.literal("available"),
  assets: z.array(UniversalSourceFactsV2AssetSchema).max(FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES),
}).strict();

const UnavailableArtifactSchema = ArtifactBaseSchema.extend({
  state: z.literal("unavailable"),
  assets: z.tuple([]),
  affectedSources: z.array(BlockedSourceSchema).min(1).max(FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES),
  reason: z.object({
    code: z.literal("XGRIDS_XBIN_UNSUPPORTED"),
    message: z.literal("Universal Source Facts V2 are unavailable because the receipt includes an unsupported XGRIDS XBIN candidate."),
    nextAction: z.literal(FOUNDRY_XBIN_OFFICIAL_EXPORT_NEXT_ACTION),
  }).strict(),
}).strict();

type ArtifactWithoutValidation = z.infer<typeof AvailableArtifactSchema> | z.infer<typeof UnavailableArtifactSchema>;
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
  return domainSeparatedSha256(FOUNDRY_UNIVERSAL_SOURCE_FACTS_V2_DIGEST_DOMAIN, toCanonicalJson(payload));
}

function validateArtifact(value: ArtifactWithoutValidation, ctx: z.RefinementCtx): void {
  const paths = value.assets.map((asset) => asset.source.path);
  const sorted = [...paths].sort(compareText);
  if (new Set(paths).size !== paths.length || paths.some((path, index) => path !== sorted[index])) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["assets"], message: "V2 asset paths must be unique and sorted" });
  }
  const expectedSummary = value.state === "available"
    ? {
        receiptFileCount: value.summary.receiptFileCount,
        assetCount: value.assets.length,
        establishedCount: value.assets.filter((asset) => asset.inspection.state === "established").length,
        factsNotEstablishedCount: value.assets.filter((asset) => asset.inspection.state === "facts_not_established").length,
        untargetedFileCount: value.summary.receiptFileCount - value.assets.length,
        blockedSourceCount: 0,
      }
    : {
        receiptFileCount: value.summary.receiptFileCount,
        assetCount: 0,
        establishedCount: 0,
        factsNotEstablishedCount: 0,
        untargetedFileCount: value.summary.receiptFileCount - value.affectedSources.length,
        blockedSourceCount: value.affectedSources.length,
      };
  if (expectedSummary.untargetedFileCount < 0 || JSON.stringify(value.summary) !== JSON.stringify(expectedSummary)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["summary"], message: "V2 summary does not match artifact contents" });
  }
  if (value.state === "unavailable") {
    const blockedPaths = value.affectedSources.map((source) => source.path);
    const sortedBlocked = [...blockedPaths].sort(compareText);
    if (new Set(blockedPaths).size !== blockedPaths.length || blockedPaths.some((path, index) => path !== sortedBlocked[index])) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["affectedSources"], message: "V2 affected sources must be unique and sorted" });
    }
  }
  const usesPye57 = value.assets.some((asset) =>
    asset.format === "e57" && asset.facts?.aggregateMetadata !== null && asset.facts?.aggregateMetadata !== undefined
  );
  const expectedProbe = usesPye57 ? "local_pye57_read_only" : "none";
  if (value.policy.metadataProbe !== expectedProbe || value.policy.externalProcess !== expectedProbe) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["policy", "metadataProbe"], message: "V2 metadata probe policy contradicts attached E57 evidence" });
  }
  if (value.factsSha256 !== artifactDigest(value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["factsSha256"], message: "V2 facts digest does not match canonical payload" });
  }
}

export const FoundryUniversalSourceFactsV2Schema = z.discriminatedUnion("state", [
  AvailableArtifactSchema,
  UnavailableArtifactSchema,
]).superRefine(validateArtifact);
export type FoundryUniversalSourceFactsV2 = z.infer<typeof FoundryUniversalSourceFactsV2Schema>;

export interface UniversalSourceFactsV2FinalizeOptions {
  readonly sogInspection?: FoundrySogSourceFactsOutcome;
  readonly spzInspection?: FoundrySpzSourceFactsOutcome;
}

export interface UniversalSourceFactsV2StreamCollector {
  observe(chunk: Uint8Array, absoluteOffset: number): void;
  finalize(
    identity: UniversalSourceFactsReceiptFileIdentity,
    options?: UniversalSourceFactsV2FinalizeOptions,
  ): UniversalSourceFactsV2FileResult;
}

function extension(path: string): string {
  const name = path.split("/").at(-1) ?? path;
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot).toLowerCase();
}

function hasCandidate(identity: UniversalSourceFactsReceiptFileIdentity, inputType: string): boolean {
  return identity.detection.candidates.some((candidate) => candidate.inputType === inputType);
}

function spzResult(
  identity: UniversalSourceFactsReceiptFileIdentity,
  outcome: FoundrySpzSourceFactsOutcome,
): UniversalSourceFactsV2FileResult {
  const source = {
    path: identity.path,
    sizeBytes: identity.sizeBytes,
    sha256: identity.sha256,
    inputType: "spz" as const,
  };
  if (outcome.state === "established") {
    return UniversalSourceFactsV2FileResultSchema.parse({
      kind: "asset",
      asset: {
        source,
        format: "spz",
        inspection: {
          state: "established",
          category: "established",
          code: "SPZ_FORMAT_FACTS_ESTABLISHED",
          coverage: "complete_stream",
        },
        facts: outcome.facts,
        unknowns: FOUNDRY_SPZ_UNKNOWNS,
      },
    });
  }
  if (outcome.category === "cancelled" || outcome.code === "SPZ_INSPECTION_CANCELLED") {
    throw new FoundryIntegrityError(
      "SOURCE_FACTS_SPZ_INSPECTION_CANCELLED",
      "The read-only SPZ Source Facts inspection was cancelled; no V2 artifact was issued.",
    );
  }
  const expectedCategory = FOUNDRY_SPZ_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE[outcome.code];
  if (!FOUNDRY_SPZ_SOURCE_FACTS_FAILURE_CODES.includes(outcome.code) || expectedCategory !== outcome.category) {
    throw new FoundryIntegrityError(
      "SOURCE_FACTS_SPZ_OUTCOME_INVALID",
      "The bounded SPZ Source Facts outcome is contradictory; no V2 artifact was issued.",
    );
  }
  return UniversalSourceFactsV2FileResultSchema.parse({
    kind: "asset",
    asset: {
      source,
      format: "spz",
      inspection: {
        state: "facts_not_established",
        category: outcome.category,
        code: outcome.code,
        coverage: "none",
      },
      facts: null,
      unknowns: FOUNDRY_SPZ_UNKNOWNS,
    },
  });
}

class UniversalSourceFactsV2StreamCollectorImpl implements UniversalSourceFactsV2StreamCollector {
  private readonly v1Collector;
  private readonly hash = createHash("sha256");
  private readonly prefix = Buffer.alloc(8);
  private prefixBytes = 0;
  private observedBytes = 0;
  private finalized = false;

  constructor(private readonly relativePath: string) {
    this.relativePath = FoundryRelativePathSchema.parse(relativePath);
    this.v1Collector = createUniversalSourceFactsStreamCollector(this.relativePath);
  }

  observe(chunk: Uint8Array, absoluteOffset: number): void {
    if (this.finalized) throw new FoundryIntegrityError("SOURCE_FACTS_V2_COLLECTOR_FINALIZED", "Source Facts V2 collector is already finalized.");
    if (!(chunk instanceof Uint8Array) || absoluteOffset !== this.observedBytes) {
      throw new FoundryIntegrityError("SOURCE_FACTS_V2_NONCONTIGUOUS_STREAM", "Source Facts V2 byte chunks must be contiguous and start at offset zero.");
    }
    this.v1Collector.observe(chunk, absoluteOffset);
    this.hash.update(chunk);
    if (this.prefixBytes < this.prefix.length) {
      const copyBytes = Math.min(this.prefix.length - this.prefixBytes, chunk.length);
      this.prefix.set(chunk.subarray(0, copyBytes), this.prefixBytes);
      this.prefixBytes += copyBytes;
    }
    this.observedBytes += chunk.length;
  }

  finalize(
    identityInput: UniversalSourceFactsReceiptFileIdentity,
    options: UniversalSourceFactsV2FinalizeOptions = {},
  ): UniversalSourceFactsV2FileResult {
    if (this.finalized) throw new FoundryIntegrityError("SOURCE_FACTS_V2_COLLECTOR_FINALIZED", "Source Facts V2 collector is already finalized.");
    this.finalized = true;
    const identity = UniversalSourceFactsReceiptFileIdentitySchema.parse(identityInput);
    if (identity.path !== this.relativePath || identity.sizeBytes !== this.observedBytes) {
      throw new FoundryIntegrityError("SOURCE_FACTS_V2_IDENTITY_MISMATCH", "Source Facts V2 bytes do not match their receipt identity.");
    }
    const observedSha256 = this.hash.digest("hex");
    if (observedSha256 !== identity.sha256) {
      throw new FoundryIntegrityError("SOURCE_FACTS_V2_SHA256_MISMATCH", "Source Facts V2 bytes do not match the receipt SHA-256.");
    }
    const magicHex = this.prefix.subarray(0, this.prefixBytes).toString("hex");
    const e57Magic = magicHex.startsWith("4153544d2d453537");
    const glbMagic = magicHex.startsWith("676c5446");
    const inspectAsSpz = !e57Magic && !glbMagic && (hasCandidate(identity, "spz") || extension(identity.path) === ".spz");
    if (options.spzInspection !== undefined && !inspectAsSpz) {
      throw new FoundryIntegrityError("SOURCE_FACTS_V2_UNEXPECTED_SPZ_INSPECTION", "A bounded SPZ inspection was supplied for a non-SPZ V2 target.");
    }
    if (inspectAsSpz) {
      if (options.sogInspection !== undefined) {
        throw new FoundryIntegrityError("SOURCE_FACTS_V2_UNEXPECTED_SOG_INSPECTION", "A bounded SOG inspection was supplied for an SPZ V2 target.");
      }
      if (options.spzInspection === undefined) {
        throw new FoundryIntegrityError("SOURCE_FACTS_V2_SPZ_INSPECTION_REQUIRED", "SPZ Source Facts V2 require a bounded inspection on the identity-bound open handle.");
      }
      if (
        options.spzInspection.sourceSizeBytes !== this.observedBytes ||
        options.spzInspection.sourceSha256 !== observedSha256
      ) {
        throw new FoundryIntegrityError("SOURCE_FACTS_V2_SPZ_INSPECTION_SOURCE_MISMATCH", "The bounded SPZ inspection does not match the receipt-bound V2 byte stream.");
      }
      return spzResult(identity, options.spzInspection);
    }
    const v1Result: UniversalSourceFactsFileResult = this.v1Collector.finalize(
      identity,
      options.sogInspection === undefined ? undefined : { sogInspection: options.sogInspection },
    );
    return UniversalSourceFactsV2FileResultSchema.parse(v1Result);
  }
}

export function createUniversalSourceFactsV2StreamCollector(
  relativePath: string,
): UniversalSourceFactsV2StreamCollector {
  return new UniversalSourceFactsV2StreamCollectorImpl(relativePath);
}

const LIMITS: z.infer<typeof LimitsSchema> = {
  e57PhysicalHeaderBytes: E57_PHYSICAL_HEADER_BYTES,
  glbJsonChunkMaxBytes: FOUNDRY_SOURCE_FACTS_GLB_JSON_MAX_BYTES,
  glbJsonMaxDepth: FOUNDRY_SOURCE_FACTS_GLB_JSON_MAX_DEPTH,
  glbJsonMaxValues: FOUNDRY_SOURCE_FACTS_GLB_JSON_MAX_VALUES,
  objLogicalLineMaxBytes: FOUNDRY_SOURCE_FACTS_OBJ_LOGICAL_LINE_MAX_BYTES,
  sogZipMaxEntries: FOUNDRY_SOG_ZIP_MAX_ENTRIES,
  sogZipCentralDirectoryMaxBytes: FOUNDRY_SOG_ZIP_MAX_CENTRAL_DIRECTORY_BYTES,
  sogMetaJsonMaxBytes: FOUNDRY_SOG_META_MAX_BYTES,
  sogMetaJsonMaxDepth: FOUNDRY_SOG_META_JSON_MAX_DEPTH,
  sogMetaJsonMaxValues: FOUNDRY_SOG_META_JSON_MAX_VALUES,
  sogWebpMemberMaxBytes: FOUNDRY_SOG_WEBP_MEMBER_MAX_BYTES,
  sogWebpAggregateMaxBytes: FOUNDRY_SOG_WEBP_AGGREGATE_MAX_BYTES,
  spzSourceMaxBytes: FOUNDRY_SPZ_SOURCE_MAX_BYTES,
  spzDecompressedMaxBytes: FOUNDRY_SPZ_DECOMPRESSED_MAX_BYTES,
  spzExtensionMaxBytes: FOUNDRY_SPZ_EXTENSION_MAX_BYTES,
  spzExtensionMaxRecords: FOUNDRY_SPZ_EXTENSION_MAX_RECORDS,
  spzGzipHeaderMaxBytes: FOUNDRY_SPZ_GZIP_HEADER_MAX_BYTES,
  spzLegacyHeaderBytes: FOUNDRY_SPZ_LEGACY_HEADER_BYTES,
  spzV4HeaderBytes: FOUNDRY_SPZ_V4_HEADER_BYTES,
  spzV4MaxCompressionRatio: FOUNDRY_SPZ_V4_MAX_COMPRESSION_RATIO,
};

function resultSource(result: UniversalSourceFactsV2FileResult): z.infer<typeof SourceIdentityBaseSchema> {
  return result.kind === "asset" ? result.asset.source : result.source;
}

function policyForAssets(assets: readonly UniversalSourceFactsV2Asset[]): z.infer<typeof PolicySchema> {
  const usesPye57 = assets.some((asset) =>
    asset.format === "e57" && asset.facts?.aggregateMetadata !== null && asset.facts?.aggregateMetadata !== undefined
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

function issueArtifact(
  payload: ArtifactPayload,
): FoundryUniversalSourceFactsV2 {
  const candidate = { ...payload, factsSha256: "0".repeat(64) } as ArtifactWithoutValidation;
  return FoundryUniversalSourceFactsV2Schema.parse({ ...payload, factsSha256: artifactDigest(candidate) });
}

function uniqueSortedResults(
  inputs: readonly UniversalSourceFactsV2FileResult[],
): UniversalSourceFactsV2FileResult[] {
  if (inputs.length > FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES) {
    throw new FoundryIntegrityError("SOURCE_FACTS_V2_FILE_COUNT_LIMIT", "Source Facts V2 results exceed the receipt file-count limit.");
  }
  const results = inputs.map((result) => UniversalSourceFactsV2FileResultSchema.parse(result));
  results.sort((left, right) => compareText(resultSource(left).path, resultSource(right).path));
  const paths = results.map((result) => resultSource(result).path);
  if (new Set(paths).size !== paths.length) {
    throw new FoundryIntegrityError("SOURCE_FACTS_V2_DUPLICATE_RESULT_PATH", "Source Facts V2 results must have unique paths.");
  }
  return results;
}

function unavailableArtifact(
  receiptSha256: string,
  receiptFileCount: number,
  affectedSourcesInput: readonly z.infer<typeof BlockedSourceSchema>[],
): FoundryUniversalSourceFactsV2 {
  const affectedSources = affectedSourcesInput
    .map((source) => BlockedSourceSchema.parse(source))
    .sort((left, right) => compareText(left.path, right.path));
  return issueArtifact({
    schemaVersion: FOUNDRY_UNIVERSAL_SOURCE_FACTS_V2,
    receiptSha256,
    state: "unavailable",
    policy: policyForAssets([]),
    limitations: [...FOUNDRY_SOURCE_FACTS_V2_LIMITATIONS],
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
      message: "Universal Source Facts V2 are unavailable because the receipt includes an unsupported XGRIDS XBIN candidate.",
      nextAction: FOUNDRY_XBIN_OFFICIAL_EXPORT_NEXT_ACTION,
    },
  });
}

function availableArtifact(
  receiptSha256: string,
  receiptFileCount: number,
  results: readonly UniversalSourceFactsV2FileResult[],
): FoundryUniversalSourceFactsV2 {
  const assets = results
    .filter((result): result is Extract<UniversalSourceFactsV2FileResult, { readonly kind: "asset" }> => result.kind === "asset")
    .map((result) => result.asset)
    .sort((left, right) => compareText(left.source.path, right.source.path));
  return issueArtifact({
    schemaVersion: FOUNDRY_UNIVERSAL_SOURCE_FACTS_V2,
    receiptSha256,
    state: "available",
    policy: policyForAssets(assets),
    limitations: [...FOUNDRY_SOURCE_FACTS_V2_LIMITATIONS],
    limits: LIMITS,
    summary: {
      receiptFileCount,
      assetCount: assets.length,
      establishedCount: assets.filter((asset) => asset.inspection.state === "established").length,
      factsNotEstablishedCount: assets.filter((asset) => asset.inspection.state === "facts_not_established").length,
      untargetedFileCount: receiptFileCount - assets.length,
      blockedSourceCount: 0,
    },
    assets,
  });
}

export function createUniversalSourceFactsV2ArtifactFromReceipt(
  receiptSha256Input: string,
  identityInputs: readonly UniversalSourceFactsReceiptFileIdentity[],
  resultInputs: readonly UniversalSourceFactsV2FileResult[] = [],
): FoundryUniversalSourceFactsV2 {
  const receiptSha256 = z.string().regex(SHA256_HEX).parse(receiptSha256Input);
  if (identityInputs.length > FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES) {
    throw new FoundryIntegrityError("SOURCE_FACTS_V2_FILE_COUNT_LIMIT", "Source Facts V2 receipt identities exceed the file-count limit.");
  }
  const identities = identityInputs
    .map((identity) => UniversalSourceFactsReceiptFileIdentitySchema.parse(identity))
    .sort((left, right) => compareText(left.path, right.path));
  const identityPaths = identities.map((identity) => identity.path);
  if (new Set(identityPaths).size !== identityPaths.length) {
    throw new FoundryIntegrityError("SOURCE_FACTS_V2_DUPLICATE_RECEIPT_PATH", "Source Facts V2 receipt identities must have unique paths.");
  }
  const blocked = identities
    .filter((identity) => hasCandidate(identity, "xgrids_xbin"))
    .map((identity) => ({
      path: identity.path,
      sizeBytes: identity.sizeBytes,
      sha256: identity.sha256,
      inputType: "xgrids_xbin" as const,
    }));
  if (blocked.length > 0) return unavailableArtifact(receiptSha256, identities.length, blocked);

  const results = uniqueSortedResults(resultInputs);
  if (results.length !== identities.length) {
    throw new FoundryIntegrityError("SOURCE_FACTS_V2_RESULT_SET_INCOMPLETE", "Available Source Facts V2 require one finalized result per receipt file.");
  }
  for (const [index, identity] of identities.entries()) {
    const result = results[index];
    if (result === undefined) throw new FoundryIntegrityError("SOURCE_FACTS_V2_RESULT_SET_INCOMPLETE", "Source Facts V2 result is missing.");
    const source = resultSource(result);
    if (source.path !== identity.path || source.sizeBytes !== identity.sizeBytes || source.sha256 !== identity.sha256) {
      throw new FoundryIntegrityError("SOURCE_FACTS_V2_RESULT_IDENTITY_MISMATCH", "Source Facts V2 result does not match its receipt identity.");
    }
    if (result.kind === "xbin_block") {
      throw new FoundryIntegrityError("SOURCE_FACTS_V2_UNEXPECTED_XBIN_RESULT", "An XBIN result was not declared by receipt detection.");
    }
  }
  return availableArtifact(receiptSha256, identities.length, results);
}

export function serializeUniversalSourceFactsV2Artifact(value: FoundryUniversalSourceFactsV2): string {
  return stableCanonicalJson(toCanonicalJson(FoundryUniversalSourceFactsV2Schema.parse(value)));
}
