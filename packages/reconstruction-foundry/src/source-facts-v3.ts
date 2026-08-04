import { createHash } from "node:crypto";
import { E57_PHYSICAL_HEADER_BYTES, FoundryRelativePathSchema } from "@omnitwin/types";
import { z } from "zod";
import { domainSeparatedSha256, stableCanonicalJson, toCanonicalJson } from "./canonical-json.js";
import { FoundryIntegrityError } from "./errors.js";
import {
  FOUNDRY_GAUSSIAN_PLY_COMMENT_MAX_COUNT,
  FOUNDRY_GAUSSIAN_PLY_ELEMENT_MAX_COUNT,
  FOUNDRY_GAUSSIAN_PLY_HEADER_LINE_MAX_BYTES,
  FOUNDRY_GAUSSIAN_PLY_HEADER_MAX_BYTES,
  FOUNDRY_GAUSSIAN_PLY_PROPERTY_MAX_COUNT,
  FOUNDRY_GAUSSIAN_PLY_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE,
  FOUNDRY_GAUSSIAN_PLY_SOURCE_FACTS_FAILURE_CODES,
  FOUNDRY_GAUSSIAN_PLY_SOURCE_FACTS_LIMITATIONS,
  FOUNDRY_GAUSSIAN_PLY_SOURCE_MAX_BYTES,
  FOUNDRY_GAUSSIAN_PLY_VERTEX_MAX_COUNT,
  FOUNDRY_GAUSSIAN_PLY_VERTEX_STRIDE_MAX_BYTES,
  type FoundryGaussianPlySourceFactsOutcome,
} from "./gaussian-ply-source-facts.js";
import {
  FOUNDRY_SOG_META_JSON_MAX_DEPTH,
  FOUNDRY_SOG_META_JSON_MAX_VALUES,
  FOUNDRY_SOG_META_MAX_BYTES,
  FOUNDRY_SOG_WEBP_AGGREGATE_MAX_BYTES,
  FOUNDRY_SOG_WEBP_MEMBER_MAX_BYTES,
  FOUNDRY_SOG_ZIP_MAX_CENTRAL_DIRECTORY_BYTES,
  FOUNDRY_SOG_ZIP_MAX_ENTRIES,
} from "./sog-source-facts.js";
import {
  FOUNDRY_SOURCE_FACTS_GLB_JSON_MAX_BYTES,
  FOUNDRY_SOURCE_FACTS_GLB_JSON_MAX_DEPTH,
  FOUNDRY_SOURCE_FACTS_GLB_JSON_MAX_VALUES,
  FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES,
  FOUNDRY_SOURCE_FACTS_OBJ_LOGICAL_LINE_MAX_BYTES,
  FOUNDRY_XBIN_OFFICIAL_EXPORT_NEXT_ACTION,
  UniversalSourceFactsReceiptFileIdentitySchema,
  type UniversalSourceFactsReceiptFileIdentity,
} from "./source-facts.js";
import {
  FOUNDRY_SOURCE_FACTS_V2_LIMITATIONS,
  UniversalSourceFactsV2AssetSchema,
  UniversalSourceFactsV2FileResultSchema,
  createUniversalSourceFactsV2StreamCollector,
  type UniversalSourceFactsV2FileResult,
  type UniversalSourceFactsV2FinalizeOptions,
} from "./source-facts-v2.js";
import {
  FOUNDRY_SPZ_DECOMPRESSED_MAX_BYTES,
  FOUNDRY_SPZ_EXTENSION_MAX_BYTES,
  FOUNDRY_SPZ_EXTENSION_MAX_RECORDS,
  FOUNDRY_SPZ_GZIP_HEADER_MAX_BYTES,
  FOUNDRY_SPZ_LEGACY_HEADER_BYTES,
  FOUNDRY_SPZ_SOURCE_MAX_BYTES,
  FOUNDRY_SPZ_V4_HEADER_BYTES,
  FOUNDRY_SPZ_V4_MAX_COMPRESSION_RATIO,
} from "./spz-source-facts.js";

export const FOUNDRY_UNIVERSAL_SOURCE_FACTS_V3 =
  "omnitwin.foundry.universal-source-facts.v3";
export const FOUNDRY_UNIVERSAL_SOURCE_FACTS_V3_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_UNIVERSAL_SOURCE_FACTS_V3";
export const FOUNDRY_SOURCE_FACTS_V3_LIMITATIONS = Object.freeze([
  ...FOUNDRY_SOURCE_FACTS_V2_LIMITATIONS,
] as const);

const SHA256_HEX = /^[a-f0-9]{64}$/u;
const STABLE_CODE = /^[A-Z][A-Z0-9_]{2,95}$/u;
const PROPERTY_NAME = /^[!-~]+$/u;

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

export const FOUNDRY_GAUSSIAN_PLY_UNKNOWNS = Object.freeze([
  unknownFact("GAUSSIAN_PLY_ACCURACY_UNKNOWN", "Physical accuracy", "This inspection does not establish metric accuracy.", "Compare decoded positions with independent survey control and frozen blind checks."),
  unknownFact("GAUSSIAN_PLY_ATTRIBUTE_VALUES_UNKNOWN", "Decoded Gaussian attributes", "This inspection does not establish decoded Gaussian attribute values; structural success establishes only the declared fixed-width layout and exact payload byte extent.", "Run a separately reviewed bounded Gaussian PLY attribute decoder against this exact source digest and record value, finite-number, byte, point, and cancellation limits."),
  unknownFact("GAUSSIAN_PLY_ENCODING_SEMANTICS_UNKNOWN", "Gaussian encoding semantics", "This inspection does not establish opacity activation, scale transform, quaternion component order or normalization, or spherical-harmonic channel order; property names and non-authoritative comments are insufficient.", "Bind this exact source digest to a pinned producer convention and decoder, then verify decoded semantics with controlled fixtures."),
  unknownFact("GAUSSIAN_PLY_FRAME_UNKNOWN", "Coordinate frame", "This inspection does not establish the actual venue frame or a transform into it; PLY property names and comments contain no authoritative venue-specific frame attestation.", "Bind this exact source digest to an authoritative frame transform and control record."),
  unknownFact("GAUSSIAN_PLY_PHYSICAL_BOUNDS_UNKNOWN", "Physical spatial bounds", "This inspection does not establish venue-space physical bounds; structural success verifies payload layout without decoding positions.", "Decode positions under a documented Gaussian PLY convention, bind authoritative units and frame, and compute bounds against this exact source digest."),
  unknownFact("GAUSSIAN_PLY_PROVENANCE_UNKNOWN", "Source provenance", "This inspection does not establish the capture, training, conversion, or export lineage of the source.", "Obtain an authoritative lineage record bound to this exact SHA-256, including capture source and every material training, conversion, and export step."),
  unknownFact("GAUSSIAN_PLY_REGISTRATION_UNKNOWN", "Registration quality", "This inspection does not establish alignment quality or residuals in the venue frame.", "Evaluate digest-bound decoded positions against independent control with a documented registration method and residual protocol."),
  unknownFact("GAUSSIAN_PLY_RENDERER_COMPATIBILITY_UNKNOWN", "Renderer compatibility", "This inspection does not establish that a particular renderer supports or presents the source's exact property order, types, extras, and encoding semantics.", "Run a pinned offline compatibility probe against this exact digest and record loader version, limits, result, and every unsupported feature."),
  unknownFact("GAUSSIAN_PLY_RIGHTS_UNKNOWN", "Usage rights", "This inspection does not evaluate ownership, model-training, derivative-output, or redistribution rights.", "Obtain an authorized purpose-scoped rights decision bound to this exact SHA-256."),
  unknownFact("GAUSSIAN_PLY_UNITS_UNKNOWN", "Physical units", "This inspection does not establish authoritative physical units; supported Gaussian PLY structures contain no venue-specific unit attestation.", "Obtain authoritative source provenance that declares units and verify a known physical dimension."),
  unknownFact("GAUSSIAN_PLY_VISUAL_FIDELITY_UNKNOWN", "Appearance fidelity", "This inspection does not establish visual fidelity to the captured venue.", "Compare frozen views in a pinned offline renderer with rights-cleared reference observations and record indeterminate regions."),
] as const);

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

const ScalarDeclaredTypeSchema = z.enum([
  "char", "int8", "uchar", "uint8", "short", "int16", "ushort", "uint16",
  "int", "int32", "uint", "uint32", "float", "float32", "double", "float64",
]);
const ScalarCanonicalTypeSchema = z.enum([
  "int8", "uint8", "int16", "uint16", "int32", "uint32", "float32", "float64",
]);
const PropertyRoleSchema = z.enum([
  "position", "normal", "spherical_harmonics_dc", "spherical_harmonics_non_dc",
  "opacity", "scale", "rotation", "extra",
]);

const PropertyFactsSchema = z.object({
  ordinal: z.number().int().min(0).max(FOUNDRY_GAUSSIAN_PLY_PROPERTY_MAX_COUNT - 1),
  name: z.string().regex(PROPERTY_NAME).max(FOUNDRY_GAUSSIAN_PLY_HEADER_LINE_MAX_BYTES),
  declaredType: ScalarDeclaredTypeSchema,
  canonicalType: ScalarCanonicalTypeSchema,
  byteOffset: z.number().int().min(0).max(FOUNDRY_GAUSSIAN_PLY_VERTEX_STRIDE_MAX_BYTES),
  byteWidth: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(8)]),
  role: PropertyRoleSchema,
  roleIndex: z.number().int().min(0).max(FOUNDRY_GAUSSIAN_PLY_PROPERTY_MAX_COUNT - 1).nullable(),
}).strict();

const SH_NON_DC_COUNTS = [0, 9, 24, 45, 72] as const;
const SCALAR_LAYOUT_BY_DECLARED_TYPE = Object.freeze({
  char: ["int8", 1],
  int8: ["int8", 1],
  uchar: ["uint8", 1],
  uint8: ["uint8", 1],
  short: ["int16", 2],
  int16: ["int16", 2],
  ushort: ["uint16", 2],
  uint16: ["uint16", 2],
  int: ["int32", 4],
  int32: ["int32", 4],
  uint: ["uint32", 4],
  uint32: ["uint32", 4],
  float: ["float32", 4],
  float32: ["float32", 4],
  double: ["float64", 8],
  float64: ["float64", 8],
} as const);

export const FoundryGaussianPlyFactsV3Schema = z.object({
  format: z.literal("gaussian_ply_binary_little_endian"),
  profile: z.literal("classic_3dgs_float32_scalar"),
  inspectionCoverage: z.literal("complete_header_and_exact_fixed_width_payload_layout"),
  plyVersion: z.literal("1.0"),
  header: z.object({
    bytes: z.number().int().positive().max(FOUNDRY_GAUSSIAN_PLY_HEADER_MAX_BYTES),
    lineEndings: z.enum(["lf", "crlf", "mixed"]),
    comments: z.object({
      count: z.number().int().min(0).max(FOUNDRY_GAUSSIAN_PLY_COMMENT_MAX_COUNT),
      retainedVerbatim: z.literal(false),
      authoritative: z.literal(false),
    }).strict(),
    objInfo: z.object({
      count: z.number().int().min(0).max(FOUNDRY_GAUSSIAN_PLY_COMMENT_MAX_COUNT),
      retainedVerbatim: z.literal(false),
      authoritative: z.literal(false),
    }).strict(),
  }).strict(),
  gaussians: z.object({
    count: z.number().int().min(1).max(FOUNDRY_GAUSSIAN_PLY_VERTEX_MAX_COUNT),
    vertexStrideBytes: z.number().int().positive().max(FOUNDRY_GAUSSIAN_PLY_VERTEX_STRIDE_MAX_BYTES),
    payloadBytes: z.number().int().safe().positive().max(FOUNDRY_GAUSSIAN_PLY_SOURCE_MAX_BYTES),
    properties: z.array(PropertyFactsSchema).min(14).max(FOUNDRY_GAUSSIAN_PLY_PROPERTY_MAX_COUNT),
    sphericalHarmonics: z.object({
      degree: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
      dcPropertyCount: z.literal(3),
      nonDcPropertyCount: z.union([
        z.literal(0), z.literal(9), z.literal(24), z.literal(45), z.literal(72),
      ]),
      indicesContiguous: z.literal(true),
    }).strict(),
    normals: z.discriminatedUnion("state", [
      z.object({ state: z.literal("absent"), offsets: z.tuple([]) }).strict(),
      z.object({
        state: z.literal("present"),
        offsets: z.tuple([
          z.number().int().min(0).max(FOUNDRY_GAUSSIAN_PLY_VERTEX_STRIDE_MAX_BYTES),
          z.number().int().min(0).max(FOUNDRY_GAUSSIAN_PLY_VERTEX_STRIDE_MAX_BYTES),
          z.number().int().min(0).max(FOUNDRY_GAUSSIAN_PLY_VERTEX_STRIDE_MAX_BYTES),
        ]),
      }).strict(),
    ]),
    extraProperties: z.object({
      count: z.number().int().min(0).max(FOUNDRY_GAUSSIAN_PLY_PROPERTY_MAX_COUNT),
      names: z.array(z.string().regex(PROPERTY_NAME).max(FOUNDRY_GAUSSIAN_PLY_HEADER_LINE_MAX_BYTES))
        .max(FOUNDRY_GAUSSIAN_PLY_PROPERTY_MAX_COUNT),
    }).strict(),
  }).strict(),
  container: z.object({
    sourceSizeBytes: z.number().int().safe().positive().max(FOUNDRY_GAUSSIAN_PLY_SOURCE_MAX_BYTES),
    headerBytes: z.number().int().positive().max(FOUNDRY_GAUSSIAN_PLY_HEADER_MAX_BYTES),
    payloadOffsetBytes: z.number().int().positive().max(FOUNDRY_GAUSSIAN_PLY_HEADER_MAX_BYTES),
    payloadBytes: z.number().int().safe().positive().max(FOUNDRY_GAUSSIAN_PLY_SOURCE_MAX_BYTES),
    exactFileLengthVerified: z.literal(true),
    trailingBytes: z.literal(0),
  }).strict(),
  limitations: z.tuple([
    z.literal(FOUNDRY_GAUSSIAN_PLY_SOURCE_FACTS_LIMITATIONS[0]),
    z.literal(FOUNDRY_GAUSSIAN_PLY_SOURCE_FACTS_LIMITATIONS[1]),
    z.literal(FOUNDRY_GAUSSIAN_PLY_SOURCE_FACTS_LIMITATIONS[2]),
    z.literal(FOUNDRY_GAUSSIAN_PLY_SOURCE_FACTS_LIMITATIONS[3]),
    z.literal(FOUNDRY_GAUSSIAN_PLY_SOURCE_FACTS_LIMITATIONS[4]),
  ]),
}).strict().superRefine((facts, ctx) => {
  const { gaussians, container, header } = facts;
  if (header.comments.count + header.objInfo.count > FOUNDRY_GAUSSIAN_PLY_COMMENT_MAX_COUNT) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["header"], message: "Gaussian PLY comment and obj_info count exceeds the combined limit" });
  }
  if (
    container.headerBytes !== header.bytes ||
    container.payloadOffsetBytes !== header.bytes ||
    container.payloadBytes !== gaussians.payloadBytes ||
    container.sourceSizeBytes !== container.headerBytes + container.payloadBytes ||
    gaussians.payloadBytes !== gaussians.count * gaussians.vertexStrideBytes
  ) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["container"], message: "Gaussian PLY container byte facts are inconsistent" });
  }
  const names = gaussians.properties.map((property) => property.name);
  if (new Set(names).size !== names.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["gaussians", "properties"], message: "Gaussian PLY property names must be unique" });
  }
  let expectedOffset = 0;
  for (const [ordinal, property] of gaussians.properties.entries()) {
    const expectedScalarLayout = SCALAR_LAYOUT_BY_DECLARED_TYPE[property.declaredType];
    if (
      property.ordinal !== ordinal || property.byteOffset !== expectedOffset ||
      property.canonicalType !== expectedScalarLayout[0] || property.byteWidth !== expectedScalarLayout[1]
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["gaussians", "properties", ordinal], message: "Gaussian PLY scalar property layout is inconsistent" });
    }
    expectedOffset += property.byteWidth;
  }
  if (expectedOffset !== gaussians.vertexStrideBytes) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["gaussians", "vertexStrideBytes"], message: "Gaussian PLY property widths do not match the vertex stride" });
  }

  const expectedNamedRoles = new Map<string, readonly [string, number | null]>([
    ["x", ["position", 0]], ["y", ["position", 1]], ["z", ["position", 2]],
    ["opacity", ["opacity", 0]],
    ["scale_0", ["scale", 0]], ["scale_1", ["scale", 1]], ["scale_2", ["scale", 2]],
    ["rot_0", ["rotation", 0]], ["rot_1", ["rotation", 1]],
    ["rot_2", ["rotation", 2]], ["rot_3", ["rotation", 3]],
  ]);
  if (gaussians.normals.state === "present") {
    expectedNamedRoles.set("nx", ["normal", 0]);
    expectedNamedRoles.set("ny", ["normal", 1]);
    expectedNamedRoles.set("nz", ["normal", 2]);
  }
  for (let index = 0; index < 3; index += 1) expectedNamedRoles.set(`f_dc_${String(index)}`, ["spherical_harmonics_dc", index]);
  for (let index = 0; index < gaussians.sphericalHarmonics.nonDcPropertyCount; index += 1) {
    expectedNamedRoles.set(`f_rest_${String(index)}`, ["spherical_harmonics_non_dc", index]);
  }
  for (const [ordinal, property] of gaussians.properties.entries()) {
    const expected = expectedNamedRoles.get(property.name);
    if (expected === undefined) {
      if (property.role !== "extra" || property.roleIndex !== null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["gaussians", "properties", ordinal], message: "Gaussian PLY extra property role is inconsistent" });
      }
    } else if (
      property.role !== expected[0] || property.roleIndex !== expected[1] ||
      property.canonicalType !== "float32" || property.byteWidth !== 4
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["gaussians", "properties", ordinal], message: "Gaussian PLY named property role or scalar type is inconsistent" });
    }
  }
  for (const name of expectedNamedRoles.keys()) {
    if (!names.includes(name)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["gaussians", "properties"], message: `Gaussian PLY required property is missing: ${name}` });
    }
  }
  const nonDcExpected = SH_NON_DC_COUNTS[gaussians.sphericalHarmonics.degree];
  if (gaussians.sphericalHarmonics.nonDcPropertyCount !== nonDcExpected) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["gaussians", "sphericalHarmonics"], message: "Gaussian PLY SH degree and property count disagree" });
  }
  const normalProperties = gaussians.properties.filter((property) => property.role === "normal");
  const normalOffsets = ["nx", "ny", "nz"].map((name) =>
    gaussians.properties.find((property) => property.name === name)?.byteOffset
  );
  if (
    (gaussians.normals.state === "absent" && normalProperties.length !== 0) ||
    (gaussians.normals.state === "present" && (
      normalProperties.length !== 3 || normalOffsets.some((offset) => offset === undefined) ||
      JSON.stringify(gaussians.normals.offsets) !== JSON.stringify(normalOffsets)
    ))
  ) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["gaussians", "normals"], message: "Gaussian PLY normal facts are inconsistent" });
  }
  const extraNames = gaussians.properties.filter((property) => property.role === "extra").map((property) => property.name);
  if (
    gaussians.extraProperties.count !== extraNames.length ||
    JSON.stringify(gaussians.extraProperties.names) !== JSON.stringify(extraNames)
  ) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["gaussians", "extraProperties"], message: "Gaussian PLY extra-property facts are inconsistent" });
  }
});
export type FoundryGaussianPlyFactsV3 = z.infer<typeof FoundryGaussianPlyFactsV3Schema>;

const GaussianPlyAssetSchema = z.object({
  source: SourceIdentityBaseSchema.extend({ inputType: z.literal("gaussian_ply") }).strict(),
  format: z.literal("gaussian_ply"),
  inspection: InspectionSchema,
  facts: FoundryGaussianPlyFactsV3Schema.nullable(),
  unknowns: z.array(UnknownFactSchema),
}).strict().superRefine((asset, ctx) => {
  if ((asset.inspection.state === "established") !== (asset.facts !== null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["facts"], message: "Gaussian PLY facts must match inspection state" });
  }
  if (JSON.stringify(asset.unknowns) !== JSON.stringify(FOUNDRY_GAUSSIAN_PLY_UNKNOWNS)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["unknowns"], message: "Gaussian PLY unknowns must match V3 coverage" });
  }
  if (asset.inspection.state === "established") {
    if (
      asset.inspection.category !== "established" ||
      asset.inspection.code !== "GAUSSIAN_PLY_FORMAT_FACTS_ESTABLISHED" ||
      asset.inspection.coverage !== "complete_container_structure" ||
      asset.facts?.container.sourceSizeBytes !== asset.source.sizeBytes
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["inspection"], message: "established Gaussian PLY inspection fields are inconsistent" });
    }
    return;
  }
  const code = asset.inspection.code as (typeof FOUNDRY_GAUSSIAN_PLY_SOURCE_FACTS_FAILURE_CODES)[number];
  const expectedCategory = (FOUNDRY_GAUSSIAN_PLY_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE as Partial<Record<string, string>>)[code];
  if (
    !FOUNDRY_GAUSSIAN_PLY_SOURCE_FACTS_FAILURE_CODES.includes(code) ||
    expectedCategory === undefined || expectedCategory === "cancelled" ||
    asset.inspection.category !== expectedCategory || asset.inspection.coverage !== "none"
  ) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["inspection"], message: "failed Gaussian PLY inspection fields are inconsistent" });
  }
});

export const UniversalSourceFactsV3AssetSchema = z.union([
  UniversalSourceFactsV2AssetSchema,
  GaussianPlyAssetSchema,
]);
export type UniversalSourceFactsV3Asset = z.infer<typeof UniversalSourceFactsV3AssetSchema>;

const BlockedSourceSchema = SourceIdentityBaseSchema.extend({ inputType: z.literal("xgrids_xbin") }).strict();

export const UniversalSourceFactsV3FileResultSchema = z.union([
  UniversalSourceFactsV2FileResultSchema,
  z.object({ kind: z.literal("asset"), asset: GaussianPlyAssetSchema }).strict(),
]);
export type UniversalSourceFactsV3FileResult = z.infer<typeof UniversalSourceFactsV3FileResultSchema>;

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
  gaussianPlySourceMaxBytes: z.literal(FOUNDRY_GAUSSIAN_PLY_SOURCE_MAX_BYTES),
  gaussianPlyHeaderMaxBytes: z.literal(FOUNDRY_GAUSSIAN_PLY_HEADER_MAX_BYTES),
  gaussianPlyHeaderLineMaxBytes: z.literal(FOUNDRY_GAUSSIAN_PLY_HEADER_LINE_MAX_BYTES),
  gaussianPlyElementMaxCount: z.literal(FOUNDRY_GAUSSIAN_PLY_ELEMENT_MAX_COUNT),
  gaussianPlyPropertyMaxCount: z.literal(FOUNDRY_GAUSSIAN_PLY_PROPERTY_MAX_COUNT),
  gaussianPlyCommentMaxCount: z.literal(FOUNDRY_GAUSSIAN_PLY_COMMENT_MAX_COUNT),
  gaussianPlyVertexMaxCount: z.literal(FOUNDRY_GAUSSIAN_PLY_VERTEX_MAX_COUNT),
  gaussianPlyVertexStrideMaxBytes: z.literal(FOUNDRY_GAUSSIAN_PLY_VERTEX_STRIDE_MAX_BYTES),
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
  schemaVersion: z.literal(FOUNDRY_UNIVERSAL_SOURCE_FACTS_V3),
  receiptSha256: z.string().regex(SHA256_HEX),
  policy: PolicySchema,
  limitations: z.tuple([
    z.literal(FOUNDRY_SOURCE_FACTS_V3_LIMITATIONS[0]),
    z.literal(FOUNDRY_SOURCE_FACTS_V3_LIMITATIONS[1]),
    z.literal(FOUNDRY_SOURCE_FACTS_V3_LIMITATIONS[2]),
  ]),
  limits: LimitsSchema,
  summary: SummarySchema,
  factsSha256: z.string().regex(SHA256_HEX),
}).strict();

const AvailableArtifactSchema = ArtifactBaseSchema.extend({
  state: z.literal("available"),
  assets: z.array(UniversalSourceFactsV3AssetSchema).max(FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES),
}).strict();

const UnavailableArtifactSchema = ArtifactBaseSchema.extend({
  state: z.literal("unavailable"),
  assets: z.tuple([]),
  affectedSources: z.array(BlockedSourceSchema).min(1).max(FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES),
  reason: z.object({
    code: z.literal("XGRIDS_XBIN_UNSUPPORTED"),
    message: z.literal("Universal Source Facts V3 are unavailable because the receipt includes an unsupported XGRIDS XBIN candidate."),
    nextAction: z.literal(FOUNDRY_XBIN_OFFICIAL_EXPORT_NEXT_ACTION),
  }).strict(),
}).strict();

type ArtifactWithoutValidation = z.infer<typeof AvailableArtifactSchema> | z.infer<typeof UnavailableArtifactSchema>;
type ArtifactPayload = ArtifactWithoutValidation extends infer Artifact
  ? Artifact extends ArtifactWithoutValidation ? Omit<Artifact, "factsSha256"> : never
  : never;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function artifactDigest(value: ArtifactWithoutValidation): string {
  const { factsSha256: _factsSha256, ...payload } = value;
  return domainSeparatedSha256(FOUNDRY_UNIVERSAL_SOURCE_FACTS_V3_DIGEST_DOMAIN, toCanonicalJson(payload));
}

function validateArtifact(value: ArtifactWithoutValidation, ctx: z.RefinementCtx): void {
  const paths = value.assets.map((asset) => asset.source.path);
  const sorted = [...paths].sort(compareText);
  if (new Set(paths).size !== paths.length || paths.some((path, index) => path !== sorted[index])) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["assets"], message: "V3 asset paths must be unique and sorted" });
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
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["summary"], message: "V3 summary does not match artifact contents" });
  }
  if (value.state === "unavailable") {
    const blockedPaths = value.affectedSources.map((source) => source.path);
    const sortedBlocked = [...blockedPaths].sort(compareText);
    if (new Set(blockedPaths).size !== blockedPaths.length || blockedPaths.some((path, index) => path !== sortedBlocked[index])) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["affectedSources"], message: "V3 affected sources must be unique and sorted" });
    }
  }
  const usesPye57 = value.assets.some((asset) =>
    asset.format === "e57" && asset.facts?.aggregateMetadata !== null && asset.facts?.aggregateMetadata !== undefined
  );
  const expectedProbe = usesPye57 ? "local_pye57_read_only" : "none";
  if (value.policy.metadataProbe !== expectedProbe || value.policy.externalProcess !== expectedProbe) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["policy", "metadataProbe"], message: "V3 metadata probe policy contradicts attached E57 evidence" });
  }
  if (value.factsSha256 !== artifactDigest(value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["factsSha256"], message: "V3 facts digest does not match canonical payload" });
  }
}

export const FoundryUniversalSourceFactsV3Schema = z.discriminatedUnion("state", [
  AvailableArtifactSchema,
  UnavailableArtifactSchema,
]).superRefine(validateArtifact);
export type FoundryUniversalSourceFactsV3 = z.infer<typeof FoundryUniversalSourceFactsV3Schema>;

export interface UniversalSourceFactsV3FinalizeOptions extends UniversalSourceFactsV2FinalizeOptions {
  readonly gaussianPlyInspection?: FoundryGaussianPlySourceFactsOutcome;
}

export interface UniversalSourceFactsV3StreamCollector {
  observe(chunk: Uint8Array, absoluteOffset: number): void;
  finalize(
    identity: UniversalSourceFactsReceiptFileIdentity,
    options?: UniversalSourceFactsV3FinalizeOptions,
  ): UniversalSourceFactsV3FileResult;
}

function hasCandidate(identity: UniversalSourceFactsReceiptFileIdentity, inputType: string): boolean {
  return identity.detection.candidates.some((candidate) => candidate.inputType === inputType);
}

function gaussianPlyResult(
  identity: UniversalSourceFactsReceiptFileIdentity,
  outcome: FoundryGaussianPlySourceFactsOutcome,
): UniversalSourceFactsV3FileResult {
  const source = {
    path: identity.path,
    sizeBytes: identity.sizeBytes,
    sha256: identity.sha256,
    inputType: "gaussian_ply" as const,
  };
  if (outcome.state === "established") {
    return UniversalSourceFactsV3FileResultSchema.parse({
      kind: "asset",
      asset: {
        source,
        format: "gaussian_ply",
        inspection: {
          state: "established",
          category: "established",
          code: "GAUSSIAN_PLY_FORMAT_FACTS_ESTABLISHED",
          coverage: "complete_container_structure",
        },
        facts: outcome.facts,
        unknowns: FOUNDRY_GAUSSIAN_PLY_UNKNOWNS,
      },
    });
  }
  assertGaussianPlyFailureOutcome(outcome);
  return UniversalSourceFactsV3FileResultSchema.parse({
    kind: "asset",
    asset: {
      source,
      format: "gaussian_ply",
      inspection: {
        state: "facts_not_established",
        category: outcome.category,
        code: outcome.code,
        coverage: "none",
      },
      facts: null,
      unknowns: FOUNDRY_GAUSSIAN_PLY_UNKNOWNS,
    },
  });
}

function assertGaussianPlyFailureOutcome(
  outcome: Extract<
    FoundryGaussianPlySourceFactsOutcome,
    { readonly state: "facts_not_established" }
  >,
): void {
  if (outcome.category === "cancelled" || outcome.code === "GAUSSIAN_PLY_INSPECTION_CANCELLED") {
    throw new FoundryIntegrityError(
      "SOURCE_FACTS_GAUSSIAN_PLY_INSPECTION_CANCELLED",
      "The read-only Gaussian PLY Source Facts inspection was cancelled; no V3 artifact was issued.",
    );
  }
  const expectedCategory = FOUNDRY_GAUSSIAN_PLY_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE[outcome.code];
  if (!FOUNDRY_GAUSSIAN_PLY_SOURCE_FACTS_FAILURE_CODES.includes(outcome.code) || expectedCategory !== outcome.category) {
    throw new FoundryIntegrityError(
      "SOURCE_FACTS_GAUSSIAN_PLY_OUTCOME_INVALID",
      "The bounded Gaussian PLY Source Facts outcome is contradictory; no V3 artifact was issued.",
    );
  }
}

class UniversalSourceFactsV3StreamCollectorImpl implements UniversalSourceFactsV3StreamCollector {
  private readonly v2Collector;
  private readonly hash = createHash("sha256");
  private readonly prefix = Buffer.alloc(8);
  private prefixBytes = 0;
  private observedBytes = 0;
  private finalized = false;

  constructor(private readonly relativePath: string) {
    this.relativePath = FoundryRelativePathSchema.parse(relativePath);
    this.v2Collector = createUniversalSourceFactsV2StreamCollector(this.relativePath);
  }

  observe(chunk: Uint8Array, absoluteOffset: number): void {
    if (this.finalized) throw new FoundryIntegrityError("SOURCE_FACTS_V3_COLLECTOR_FINALIZED", "Source Facts V3 collector is already finalized.");
    if (!(chunk instanceof Uint8Array) || absoluteOffset !== this.observedBytes) {
      throw new FoundryIntegrityError("SOURCE_FACTS_V3_NONCONTIGUOUS_STREAM", "Source Facts V3 byte chunks must be contiguous and start at offset zero.");
    }
    this.v2Collector.observe(chunk, absoluteOffset);
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
    options: UniversalSourceFactsV3FinalizeOptions = {},
  ): UniversalSourceFactsV3FileResult {
    if (this.finalized) throw new FoundryIntegrityError("SOURCE_FACTS_V3_COLLECTOR_FINALIZED", "Source Facts V3 collector is already finalized.");
    this.finalized = true;
    const identity = UniversalSourceFactsReceiptFileIdentitySchema.parse(identityInput);
    if (identity.path !== this.relativePath || identity.sizeBytes !== this.observedBytes) {
      throw new FoundryIntegrityError("SOURCE_FACTS_V3_IDENTITY_MISMATCH", "Source Facts V3 bytes do not match their receipt identity.");
    }
    const observedSha256 = this.hash.digest("hex");
    if (observedSha256 !== identity.sha256) {
      throw new FoundryIntegrityError("SOURCE_FACTS_V3_SHA256_MISMATCH", "Source Facts V3 bytes do not match the receipt SHA-256.");
    }
    const magicHex = this.prefix.subarray(0, this.prefixBytes).toString("hex");
    const e57Magic = magicHex.startsWith("4153544d2d453537");
    const glbMagic = magicHex.startsWith("676c5446");
    const declaredGaussianPly = hasCandidate(identity, "gaussian_ply");
    const ordinaryPlyCandidate = hasCandidate(identity, "ply_point_cloud");
    const inspectAsGaussianPly = !e57Magic && !glbMagic &&
      (declaredGaussianPly || ordinaryPlyCandidate);
    if (options.gaussianPlyInspection !== undefined && !inspectAsGaussianPly) {
      throw new FoundryIntegrityError("SOURCE_FACTS_V3_UNEXPECTED_GAUSSIAN_PLY_INSPECTION", "A bounded Gaussian PLY inspection was supplied for a non-Gaussian-PLY V3 target.");
    }
    if (inspectAsGaussianPly && options.gaussianPlyInspection !== undefined) {
      if (options.sogInspection !== undefined || options.spzInspection !== undefined) {
        throw new FoundryIntegrityError("SOURCE_FACTS_V3_CONTRADICTORY_INSPECTIONS", "A Gaussian PLY V3 target cannot carry a SOG or SPZ inspection.");
      }
      if (
        options.gaussianPlyInspection.sourceSizeBytes !== this.observedBytes ||
        options.gaussianPlyInspection.sourceSha256 !== observedSha256
      ) {
        throw new FoundryIntegrityError("SOURCE_FACTS_V3_GAUSSIAN_PLY_INSPECTION_SOURCE_MISMATCH", "The bounded Gaussian PLY inspection does not match the receipt-bound V3 byte stream.");
      }
      if (
        declaredGaussianPly ||
        options.gaussianPlyInspection.state === "established"
      ) {
        return gaussianPlyResult(identity, options.gaussianPlyInspection);
      }
      assertGaussianPlyFailureOutcome(options.gaussianPlyInspection);
    }
    if (declaredGaussianPly && options.gaussianPlyInspection === undefined) {
      throw new FoundryIntegrityError("SOURCE_FACTS_V3_GAUSSIAN_PLY_INSPECTION_REQUIRED", "Gaussian PLY Source Facts V3 require a bounded inspection on the identity-bound open handle.");
    }
    const v2Result: UniversalSourceFactsV2FileResult = this.v2Collector.finalize(identity, {
      ...(options.sogInspection === undefined ? {} : { sogInspection: options.sogInspection }),
      ...(options.spzInspection === undefined ? {} : { spzInspection: options.spzInspection }),
    });
    return UniversalSourceFactsV3FileResultSchema.parse(v2Result);
  }
}

export function createUniversalSourceFactsV3StreamCollector(
  relativePath: string,
): UniversalSourceFactsV3StreamCollector {
  return new UniversalSourceFactsV3StreamCollectorImpl(relativePath);
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
  gaussianPlySourceMaxBytes: FOUNDRY_GAUSSIAN_PLY_SOURCE_MAX_BYTES,
  gaussianPlyHeaderMaxBytes: FOUNDRY_GAUSSIAN_PLY_HEADER_MAX_BYTES,
  gaussianPlyHeaderLineMaxBytes: FOUNDRY_GAUSSIAN_PLY_HEADER_LINE_MAX_BYTES,
  gaussianPlyElementMaxCount: FOUNDRY_GAUSSIAN_PLY_ELEMENT_MAX_COUNT,
  gaussianPlyPropertyMaxCount: FOUNDRY_GAUSSIAN_PLY_PROPERTY_MAX_COUNT,
  gaussianPlyCommentMaxCount: FOUNDRY_GAUSSIAN_PLY_COMMENT_MAX_COUNT,
  gaussianPlyVertexMaxCount: FOUNDRY_GAUSSIAN_PLY_VERTEX_MAX_COUNT,
  gaussianPlyVertexStrideMaxBytes: FOUNDRY_GAUSSIAN_PLY_VERTEX_STRIDE_MAX_BYTES,
};

function resultSource(result: UniversalSourceFactsV3FileResult): z.infer<typeof SourceIdentityBaseSchema> {
  return result.kind === "asset" ? result.asset.source : result.source;
}

function policyForAssets(assets: readonly UniversalSourceFactsV3Asset[]): z.infer<typeof PolicySchema> {
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

function issueArtifact(payload: ArtifactPayload): FoundryUniversalSourceFactsV3 {
  const candidate = { ...payload, factsSha256: "0".repeat(64) } as ArtifactWithoutValidation;
  return FoundryUniversalSourceFactsV3Schema.parse({ ...payload, factsSha256: artifactDigest(candidate) });
}

function uniqueSortedResults(inputs: readonly UniversalSourceFactsV3FileResult[]): UniversalSourceFactsV3FileResult[] {
  if (inputs.length > FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES) {
    throw new FoundryIntegrityError("SOURCE_FACTS_V3_FILE_COUNT_LIMIT", "Source Facts V3 results exceed the receipt file-count limit.");
  }
  const results = inputs.map((result) => UniversalSourceFactsV3FileResultSchema.parse(result));
  results.sort((left, right) => compareText(resultSource(left).path, resultSource(right).path));
  const paths = results.map((result) => resultSource(result).path);
  if (new Set(paths).size !== paths.length) {
    throw new FoundryIntegrityError("SOURCE_FACTS_V3_DUPLICATE_RESULT_PATH", "Source Facts V3 results must have unique paths.");
  }
  return results;
}

function unavailableArtifact(
  receiptSha256: string,
  receiptFileCount: number,
  affectedSourcesInput: readonly z.infer<typeof BlockedSourceSchema>[],
): FoundryUniversalSourceFactsV3 {
  const affectedSources = affectedSourcesInput
    .map((source) => BlockedSourceSchema.parse(source))
    .sort((left, right) => compareText(left.path, right.path));
  return issueArtifact({
    schemaVersion: FOUNDRY_UNIVERSAL_SOURCE_FACTS_V3,
    receiptSha256,
    state: "unavailable",
    policy: policyForAssets([]),
    limitations: [...FOUNDRY_SOURCE_FACTS_V3_LIMITATIONS],
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
      message: "Universal Source Facts V3 are unavailable because the receipt includes an unsupported XGRIDS XBIN candidate.",
      nextAction: FOUNDRY_XBIN_OFFICIAL_EXPORT_NEXT_ACTION,
    },
  });
}

function availableArtifact(
  receiptSha256: string,
  receiptFileCount: number,
  results: readonly UniversalSourceFactsV3FileResult[],
): FoundryUniversalSourceFactsV3 {
  const assets = results
    .filter((result): result is Extract<UniversalSourceFactsV3FileResult, { readonly kind: "asset" }> => result.kind === "asset")
    .map((result) => result.asset)
    .sort((left, right) => compareText(left.source.path, right.source.path));
  return issueArtifact({
    schemaVersion: FOUNDRY_UNIVERSAL_SOURCE_FACTS_V3,
    receiptSha256,
    state: "available",
    policy: policyForAssets(assets),
    limitations: [...FOUNDRY_SOURCE_FACTS_V3_LIMITATIONS],
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

export function createUniversalSourceFactsV3ArtifactFromReceipt(
  receiptSha256Input: string,
  identityInputs: readonly UniversalSourceFactsReceiptFileIdentity[],
  resultInputs: readonly UniversalSourceFactsV3FileResult[] = [],
): FoundryUniversalSourceFactsV3 {
  const receiptSha256 = z.string().regex(SHA256_HEX).parse(receiptSha256Input);
  if (identityInputs.length > FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES) {
    throw new FoundryIntegrityError("SOURCE_FACTS_V3_FILE_COUNT_LIMIT", "Source Facts V3 receipt identities exceed the file-count limit.");
  }
  const identities = identityInputs
    .map((identity) => UniversalSourceFactsReceiptFileIdentitySchema.parse(identity))
    .sort((left, right) => compareText(left.path, right.path));
  const identityPaths = identities.map((identity) => identity.path);
  if (new Set(identityPaths).size !== identityPaths.length) {
    throw new FoundryIntegrityError("SOURCE_FACTS_V3_DUPLICATE_RECEIPT_PATH", "Source Facts V3 receipt identities must have unique paths.");
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
    throw new FoundryIntegrityError("SOURCE_FACTS_V3_RESULT_SET_INCOMPLETE", "Available Source Facts V3 require one finalized result per receipt file.");
  }
  for (const [index, identity] of identities.entries()) {
    const result = results[index];
    if (result === undefined) throw new FoundryIntegrityError("SOURCE_FACTS_V3_RESULT_SET_INCOMPLETE", "Source Facts V3 result is missing.");
    const source = resultSource(result);
    if (source.path !== identity.path || source.sizeBytes !== identity.sizeBytes || source.sha256 !== identity.sha256) {
      throw new FoundryIntegrityError("SOURCE_FACTS_V3_RESULT_IDENTITY_MISMATCH", "Source Facts V3 result does not match its receipt identity.");
    }
    if (result.kind === "xbin_block") {
      throw new FoundryIntegrityError("SOURCE_FACTS_V3_UNEXPECTED_XBIN_RESULT", "An XBIN result was not declared by receipt detection.");
    }
  }
  return availableArtifact(receiptSha256, identities.length, results);
}

export function serializeUniversalSourceFactsV3Artifact(value: FoundryUniversalSourceFactsV3): string {
  return stableCanonicalJson(toCanonicalJson(FoundryUniversalSourceFactsV3Schema.parse(value)));
}
