import { createHash } from "node:crypto";
import {
  E57_PHYSICAL_HEADER_BYTES,
  FoundryFileDetectionSchema,
  FoundryRelativePathSchema,
  parseE57PhysicalHeader,
  type FoundryFileDetection,
} from "@omnitwin/types";
import { z } from "zod";
import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "./canonical-json.js";
import { FoundryIntegrityError } from "./errors.js";
import {
  FOUNDRY_SOG_META_JSON_MAX_DEPTH,
  FOUNDRY_SOG_META_JSON_MAX_VALUES,
  FOUNDRY_SOG_META_MAX_BYTES,
  FOUNDRY_SOG_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE,
  FOUNDRY_SOG_SOURCE_FACTS_FAILURE_CODES,
  FOUNDRY_SOG_SOURCE_FACTS_LIMITATIONS,
  FOUNDRY_SOG_WEBP_AGGREGATE_MAX_BYTES,
  FOUNDRY_SOG_WEBP_MEMBER_MAX_BYTES,
  FOUNDRY_SOG_ZIP_MAX_CENTRAL_DIRECTORY_BYTES,
  FOUNDRY_SOG_ZIP_MAX_ENTRIES,
  foundrySogShCentroidWidth,
  type FoundrySogSourceFactsOutcome,
} from "./sog-source-facts.js";

export const FOUNDRY_UNIVERSAL_SOURCE_FACTS_V1 =
  "omnitwin.foundry.universal-source-facts.v1";
export const FOUNDRY_UNIVERSAL_SOURCE_FACTS_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_UNIVERSAL_SOURCE_FACTS_V1";
export const FOUNDRY_SOURCE_FACTS_GLB_JSON_MAX_BYTES = 16 * 1024 * 1024;
export const FOUNDRY_SOURCE_FACTS_GLB_JSON_MAX_DEPTH = 128;
export const FOUNDRY_SOURCE_FACTS_GLB_JSON_MAX_VALUES = 1_000_000;
export const FOUNDRY_SOURCE_FACTS_GLB_DECLARATION_MAX_COUNT = 4_096;
export const FOUNDRY_SOURCE_FACTS_OBJ_LOGICAL_LINE_MAX_BYTES = 1024 * 1024;
export const FOUNDRY_SOURCE_FACTS_OBJ_FACE_ARITY_MAX_COUNT = 4_096;
export const FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES = 100_000;
export const FOUNDRY_XBIN_OFFICIAL_EXPORT_NEXT_ACTION =
  "Use XGRIDS' official export workflow to produce E57, binary GLB, or OBJ, then inspect that exported file; do not decode, decrypt, or reverse-engineer the XBIN payload.";
export const FOUNDRY_SOURCE_FACTS_LIMITATIONS = [
  "DIGEST_BINDING_IS_NOT_AN_ATOMIC_FILESYSTEM_SNAPSHOT",
  "FORMAT_FACTS_DO_NOT_ESTABLISH_ACCURACY_REGISTRATION_RIGHTS_OR_PROCESSING_ELIGIBILITY",
  "REFERENCED_OR_BINARY_PAYLOADS_ARE_NOT_IMPLICITLY_RESOLVED",
] as const;

const SHA256_HEX = /^[a-f0-9]{64}$/u;
const DECIMAL_COUNT = /^(?:0|[1-9][0-9]*)$/u;
const STABLE_CODE = /^[A-Z][A-Z0-9_]{2,95}$/u;
const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK_TYPE = 0x4e4f534a;
const GLB_HEADER_BYTES = 12;
const GLB_CHUNK_HEADER_BYTES = 8;
const GLB_JSON_OFFSET = GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES;
const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;

function isJsonWhitespaceCode(code: number): boolean {
  return code === 0x09 || code === 0x0a || code === 0x0d || code === 0x20;
}

const DecimalCountSchema = z.string().max(40).regex(DECIMAL_COUNT);
const StableCodeSchema = z.string().regex(STABLE_CODE);
const FiniteNumberSchema = z.number().finite();
const Vector3Schema = z.tuple([FiniteNumberSchema, FiniteNumberSchema, FiniteNumberSchema]);

export const UniversalSourceFactsReceiptFileIdentitySchema = z
  .object({
    path: FoundryRelativePathSchema,
    sizeBytes: z.number().int().safe().nonnegative(),
    sha256: z.string().regex(SHA256_HEX),
    detection: FoundryFileDetectionSchema,
  })
  .strict();
export type UniversalSourceFactsReceiptFileIdentity = z.infer<
  typeof UniversalSourceFactsReceiptFileIdentitySchema
>;

const SourceIdentityBaseSchema = z
  .object({
    path: FoundryRelativePathSchema,
    sizeBytes: z.number().int().safe().nonnegative(),
    sha256: z.string().regex(SHA256_HEX),
  })
  .strict();

const SourceIdentitySchema = SourceIdentityBaseSchema.extend({
  inputType: z.enum(["generic_e57", "matterport_e57", "glb_gltf", "obj", "sog"]),
}).strict();

const UnknownFactSchema = z
  .object({
    code: StableCodeSchema,
    label: z.string().trim().min(1).max(120),
    reason: z.string().trim().min(1).max(500),
    decisiveNextTest: z.string().trim().min(1).max(500),
  })
  .strict();

const InspectionSchema = z
  .object({
    state: z.enum(["established", "facts_not_established"]),
    category: z.enum([
      "established",
      "resource_limit",
      "parse_failure",
      "unsupported_variant",
      "unsupported_container",
    ]),
    code: StableCodeSchema,
    coverage: z.enum([
      "none",
      "physical_header",
      "container_header",
      "container_header_and_json",
      "complete_container_structure",
      "complete_stream",
    ]),
  })
  .strict()
  .superRefine((inspection, ctx) => {
    if ((inspection.state === "established") !== (inspection.category === "established")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["category"],
        message: "established state and category must agree",
      });
    }
  });

const E57FactsSchema = z
  .object({
    signature: z.literal("ASTM-E57"),
    versionMajor: z.number().int().nonnegative(),
    versionMinor: z.number().int().nonnegative(),
    physicalLengthBytes: z.number().int().safe().nonnegative(),
    xmlPhysicalOffsetBytes: z.number().int().safe().nonnegative(),
    xmlLogicalLengthBytes: z.number().int().safe().nonnegative(),
    pageSizeBytes: z.number().int().safe().positive(),
    fileLengthMatchesHeader: z.boolean(),
    aggregateMetadata: z.lazy(() => E57AggregateMetadataSchema).nullable(),
  })
  .strict();

const E57CountPairSchema = z
  .object({
    absent: z.number().int().min(0).max(1_000_000),
    present: z.number().int().min(0).max(1_000_000),
  })
  .strict();

export const E57AggregateMetadataSchema = z
  .object({
    adapter: z.object({ name: z.literal("pye57"), version: z.literal("0.4.19") }).strict(),
    imageBlobBytesRead: z.literal(false),
    openMode: z.literal("read-only"),
    pointRecordsRead: z.literal(false),
    runtimeVersions: z.object({ numpy: z.string().min(1).max(100), python: z.string().min(1).max(100) }).strict(),
    blobDeclarationHistogram: z.array(z.object({
      declarationCount: z.number().int().nonnegative(),
      declaredByteTotal: DecimalCountSchema,
      kind: z.enum(["imageMask", "jpegImage", "pngImage"]),
    }).strict()).max(3),
    coordinateMetadata: z.object({
      present: z.boolean(),
      sha256: z.string().regex(SHA256_HEX).nullable(),
      utf8ByteCount: z.number().int().min(0).max(1_048_576),
    }).strict().superRefine((value, ctx) => {
      if (value.present !== (value.sha256 !== null) || (!value.present && value.utf8ByteCount !== 0)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "coordinate metadata presence fields disagree" });
      }
    }),
    declaredImageBlobByteTotal: DecimalCountSchema,
    declaredPointRecordTotal: DecimalCountSchema,
    file: z.object({ byteSize: z.number().int().safe().nonnegative() }).strict(),
    imageCount: z.number().int().min(0).max(1_000_000),
    imagePoseCounts: E57CountPairSchema,
    imageRepresentationCardinality: z.object({
      absent: z.number().int().nonnegative(),
      multiple: z.number().int().nonnegative(),
      single: z.number().int().nonnegative(),
    }).strict(),
    imageRepresentationHistogram: z.array(z.object({
      declarationCount: z.number().int().nonnegative(),
      kind: z.enum([
        "cylindricalRepresentation",
        "pinholeRepresentation",
        "sphericalRepresentation",
        "visualReferenceRepresentation",
      ]),
    }).strict()).max(4),
    pointFieldCoverage: z.array(z.object({
      field: z.string().min(1).max(1_024),
      scanCount: z.number().int().nonnegative(),
    }).strict()).max(256),
    scanCount: z.number().int().min(0).max(1_000_000),
    scanPoseCounts: E57CountPairSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.scanPoseCounts.absent + value.scanPoseCounts.present !== value.scanCount) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["scanPoseCounts"], message: "scan pose counts must equal scan count" });
    }
    if (value.imagePoseCounts.absent + value.imagePoseCounts.present !== value.imageCount) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["imagePoseCounts"], message: "image pose counts must equal image count" });
    }
    const cardinality = value.imageRepresentationCardinality;
    if (cardinality.absent + cardinality.multiple + cardinality.single !== value.imageCount) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["imageRepresentationCardinality"], message: "image representation cardinality must equal image count" });
    }
    const representationDeclarations = value.imageRepresentationHistogram.reduce(
      (total, item) => total + item.declarationCount,
      0,
    );
    const representationMinimum = cardinality.single + (2 * cardinality.multiple);
    const representationMaximum = cardinality.single + (4 * cardinality.multiple);
    if (
      representationDeclarations < representationMinimum ||
      representationDeclarations > representationMaximum
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["imageRepresentationHistogram"],
        message: "image representation histogram contradicts representation cardinality",
      });
    }
    const blobTotal = value.blobDeclarationHistogram.reduce(
      (total, item) => total + BigInt(item.declaredByteTotal),
      0n,
    );
    if (blobTotal !== BigInt(value.declaredImageBlobByteTotal) || blobTotal > BigInt(value.file.byteSize)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["declaredImageBlobByteTotal"], message: "declared blob total must match the histogram and fit the file" });
    }
    if (value.pointFieldCoverage.some((item) => item.scanCount > value.scanCount)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["pointFieldCoverage"], message: "point-field coverage cannot exceed scan count" });
    }
    for (const [path, list, key] of [
      ["pointFieldCoverage", value.pointFieldCoverage, "field"],
      ["imageRepresentationHistogram", value.imageRepresentationHistogram, "kind"],
      ["blobDeclarationHistogram", value.blobDeclarationHistogram, "kind"],
    ] as const) {
      const labels = list.map((entry) => String(entry[key as keyof typeof entry]));
      if (new Set(labels).size !== labels.length || labels.some((label, index) => label !== [...labels].sort(compareText)[index])) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message: `${path} must be unique and sorted` });
      }
    }
  });
export type E57AggregateMetadata = z.infer<typeof E57AggregateMetadataSchema>;

const GlbContainerFactsSchema = z
  .object({
    magic: z.literal("glTF"),
    version: z.number().int().nonnegative(),
    declaredLengthBytes: z.number().int().nonnegative(),
    observedLengthBytes: z.number().int().safe().nonnegative(),
    fileLengthMatchesDeclaration: z.boolean(),
    firstChunkLengthBytes: z.number().int().nonnegative(),
    firstChunkTypeHex: z.string().regex(/^[a-f0-9]{8}$/u),
    firstChunkTypeIsJson: z.boolean(),
  })
  .strict()
  .superRefine((facts, ctx) => {
    if (facts.fileLengthMatchesDeclaration !== (facts.declaredLengthBytes === facts.observedLengthBytes)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fileLengthMatchesDeclaration"], message: "GLB length comparison is inconsistent" });
    }
    if (facts.firstChunkTypeIsJson !== (facts.firstChunkTypeHex === "4e4f534a")) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["firstChunkTypeIsJson"], message: "GLB first-chunk type comparison is inconsistent" });
    }
  });

const GlbDeclaredCountsSchema = z
  .object({
    accessors: DecimalCountSchema,
    animations: DecimalCountSchema,
    buffers: DecimalCountSchema,
    bufferViews: DecimalCountSchema,
    cameras: DecimalCountSchema,
    images: DecimalCountSchema,
    materials: DecimalCountSchema,
    meshes: DecimalCountSchema,
    nodes: DecimalCountSchema,
    samplers: DecimalCountSchema,
    scenes: DecimalCountSchema,
    skins: DecimalCountSchema,
    textures: DecimalCountSchema,
  })
  .strict();

const GlbJsonFactsSchema = z
  .object({
    assetVersion: z.string().max(128).nullable(),
    assetMinVersion: z.string().max(128).nullable(),
    generator: z.string().max(500).nullable(),
    declaredCounts: GlbDeclaredCountsSchema,
    extensionsUsed: z.array(z.string().min(1).max(256)).max(FOUNDRY_SOURCE_FACTS_GLB_DECLARATION_MAX_COUNT),
    extensionsRequired: z.array(z.string().min(1).max(256)).max(FOUNDRY_SOURCE_FACTS_GLB_DECLARATION_MAX_COUNT),
    primitiveModes: z
      .array(
        z.object({ mode: z.number().int().min(0).max(6), count: DecimalCountSchema }).strict(),
      )
      .max(7),
    invalidPrimitiveModeDeclarationCount: DecimalCountSchema,
    attributeSemantics: z.array(z.string().min(1).max(256)).max(FOUNDRY_SOURCE_FACTS_GLB_DECLARATION_MAX_COUNT),
    uriDeclarations: z
      .object({
        total: DecimalCountSchema,
        buffers: DecimalCountSchema,
        images: DecimalCountSchema,
        other: DecimalCountSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((facts, ctx) => {
    const sortedUsed = [...facts.extensionsUsed].sort(compareText);
    const sortedRequired = [...facts.extensionsRequired].sort(compareText);
    const sortedSemantics = [...facts.attributeSemantics].sort(compareText);
    if (facts.extensionsUsed.some((value, index) => value !== sortedUsed[index])) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["extensionsUsed"], message: "extension declarations must be sorted" });
    }
    if (facts.extensionsRequired.some((value, index) => value !== sortedRequired[index])) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["extensionsRequired"], message: "required extension declarations must be sorted" });
    }
    if (
      new Set(facts.attributeSemantics).size !== facts.attributeSemantics.length ||
      facts.attributeSemantics.some((value, index) => value !== sortedSemantics[index])
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["attributeSemantics"], message: "attribute semantics must be unique and sorted" });
    }
    if (
      new Set(facts.primitiveModes.map((item) => item.mode)).size !== facts.primitiveModes.length ||
      facts.primitiveModes.some((item, index) => index > 0 && item.mode <= (facts.primitiveModes[index - 1]?.mode ?? -1))
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["primitiveModes"], message: "primitive modes must be unique and sorted" });
    }
    const uri = facts.uriDeclarations;
    if (BigInt(uri.total) !== BigInt(uri.buffers) + BigInt(uri.images) + BigInt(uri.other)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["uriDeclarations", "total"], message: "URI declaration total is inconsistent" });
    }
  });

const ObjStatementCountsSchema = z
  .object({
    logicalLines: DecimalCountSchema,
    blank: DecimalCountSchema,
    comment: DecimalCountSchema,
    vertexPosition: DecimalCountSchema,
    textureCoordinate: DecimalCountSchema,
    normal: DecimalCountSchema,
    parameterSpaceVertex: DecimalCountSchema,
    face: DecimalCountSchema,
    line: DecimalCountSchema,
    point: DecimalCountSchema,
    object: DecimalCountSchema,
    group: DecimalCountSchema,
    materialLibrary: DecimalCountSchema,
    useMaterial: DecimalCountSchema,
    smoothing: DecimalCountSchema,
    other: DecimalCountSchema,
    malformed: DecimalCountSchema,
  })
  .strict();

const ObjFactsSchema = z
  .object({
    statementCounts: ObjStatementCountsSchema,
    validVertexPositionCount: DecimalCountSchema,
    validTextureCoordinateCount: DecimalCountSchema,
    validNormalCount: DecimalCountSchema,
    validFaceStatementCount: DecimalCountSchema,
    validFaceCornerCount: DecimalCountSchema,
    fanTriangleEquivalentCount: DecimalCountSchema,
    faceForms: z
      .object({
        vertexOnly: DecimalCountSchema,
        vertexTexture: DecimalCountSchema,
        vertexNormal: DecimalCountSchema,
        vertexTextureNormal: DecimalCountSchema,
      })
      .strict(),
    faceIndexReferences: z
      .object({
        positive: DecimalCountSchema,
        negative: DecimalCountSchema,
      })
      .strict(),
    faceArities: z.array(
      z.object({ arity: z.number().int().min(3), faceCount: DecimalCountSchema }).strict(),
    ).max(FOUNDRY_SOURCE_FACTS_OBJ_FACE_ARITY_MAX_COUNT),
    nativeCoordinateBounds: z
      .object({ min: Vector3Schema, max: Vector3Schema })
      .strict()
      .nullable(),
    materialLibraryDeclarationCount: DecimalCountSchema,
    materialUseDeclarationCount: DecimalCountSchema,
  })
  .strict()
  .superRefine((facts, ctx) => {
    const counts = facts.statementCounts;
    const classifiedLines = [
      counts.blank,
      counts.comment,
      counts.vertexPosition,
      counts.textureCoordinate,
      counts.normal,
      counts.parameterSpaceVertex,
      counts.face,
      counts.line,
      counts.point,
      counts.object,
      counts.group,
      counts.materialLibrary,
      counts.useMaterial,
      counts.smoothing,
      counts.other,
    ].reduce((total, value) => total + BigInt(value), 0n);
    if (classifiedLines !== BigInt(counts.logicalLines)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["statementCounts", "logicalLines"], message: "OBJ logical-line count is inconsistent" });
    }
    if (
      BigInt(facts.validVertexPositionCount) > BigInt(counts.vertexPosition) ||
      BigInt(facts.validTextureCoordinateCount) > BigInt(counts.textureCoordinate) ||
      BigInt(facts.validNormalCount) > BigInt(counts.normal) ||
      BigInt(facts.validFaceStatementCount) > BigInt(counts.face)
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "valid OBJ statement counts exceed declared statement counts" });
    }
    const sortedArities = [...facts.faceArities].sort((left, right) => left.arity - right.arity);
    if (
      new Set(facts.faceArities.map((item) => item.arity)).size !== facts.faceArities.length ||
      facts.faceArities.some((item, index) => item.arity !== sortedArities[index]?.arity)
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["faceArities"], message: "face arities must be unique and sorted" });
    }
    const arityFaces = facts.faceArities.reduce((total, item) => total + BigInt(item.faceCount), 0n);
    const arityCorners = facts.faceArities.reduce((total, item) => total + BigInt(item.arity) * BigInt(item.faceCount), 0n);
    const arityTriangles = facts.faceArities.reduce((total, item) => total + BigInt(item.arity - 2) * BigInt(item.faceCount), 0n);
    const formFaces = Object.values(facts.faceForms).reduce((total, value) => total + BigInt(value), 0n);
    const faceIndexReferences = BigInt(facts.faceIndexReferences.positive) + BigInt(facts.faceIndexReferences.negative);
    if (
      arityFaces !== BigInt(facts.validFaceStatementCount) ||
      formFaces !== BigInt(facts.validFaceStatementCount) ||
      arityCorners !== BigInt(facts.validFaceCornerCount) ||
      arityTriangles !== BigInt(facts.fanTriangleEquivalentCount)
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["faceArities"], message: "OBJ face aggregates are inconsistent" });
    }
    if (faceIndexReferences < arityCorners || faceIndexReferences > (3n * arityCorners)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["faceIndexReferences"], message: "OBJ face-index reference count is inconsistent" });
    }
    if ((facts.nativeCoordinateBounds !== null) !== (BigInt(facts.validVertexPositionCount) > 0n)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["nativeCoordinateBounds"], message: "OBJ bounds presence must match valid positions" });
    }
    if (
      facts.nativeCoordinateBounds !== null &&
      facts.nativeCoordinateBounds.min.some((value, index) => value > (facts.nativeCoordinateBounds?.max[index] ?? value))
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["nativeCoordinateBounds"], message: "OBJ bounds min cannot exceed max" });
    }
    if (
      facts.materialLibraryDeclarationCount !== counts.materialLibrary ||
      facts.materialUseDeclarationCount !== counts.useMaterial
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["materialLibraryDeclarationCount"], message: "OBJ material declaration counts are inconsistent" });
    }
  });

const SogWebpPlaneFactsSchema = z
  .object({
    role: z.enum([
      "means_l",
      "means_u",
      "scales",
      "quats",
      "sh0",
      "shN_centroids",
      "shN_labels",
    ]),
    kind: z.enum(["per_gaussian", "sh_palette"]),
    sizeBytes: z.number().int().safe().positive().max(FOUNDRY_SOG_WEBP_MEMBER_MAX_BYTES),
    crc32Hex: z.string().regex(/^[a-f0-9]{8}$/u),
    width: z.number().int().min(1).max(16_384),
    height: z.number().int().min(1).max(16_384),
    encoding: z.enum(["VP8", "VP8L", "VP8X"]),
  })
  .strict();

const SogFactsSchema = z
  .object({
    format: z.literal("sog_v2_stored_zip"),
    inspectionCoverage: z.literal("stored_zip_meta_json_and_complete_webp_riff_structure"),
    version: z.literal(2),
    count: z.number().int().safe().positive(),
    antialias: z.object({
      declared: z.boolean(),
      declaredValue: z.boolean().nullable(),
      formatDefault: z.literal(false),
    }).strict(),
    assetGeneratorDeclared: z.boolean(),
    encodedMeansRange: z.object({
      mins: Vector3Schema,
      maxs: Vector3Schema,
    }).strict(),
    sphericalHarmonics: z.object({
      higherOrderPresent: z.boolean(),
      bands: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable(),
      paletteCount: z.number().int().min(1).max(65_536).nullable(),
    }).strict(),
    container: z.object({
      archiveSizeBytes: z.number().int().safe().positive(),
      entryCount: z.number().int().min(1).max(FOUNDRY_SOG_ZIP_MAX_ENTRIES),
      centralDirectoryBytes: z.number().int().min(1).max(FOUNDRY_SOG_ZIP_MAX_CENTRAL_DIRECTORY_BYTES),
      archiveCommentBytes: z.number().int().min(0).max(65_535),
      metaJsonBytes: z.number().int().min(1).max(FOUNDRY_SOG_META_MAX_BYTES),
      totalMemberUncompressedBytes: z.number().int().safe().positive(),
      webpPlaneBytes: z.number().int().min(1).max(FOUNDRY_SOG_WEBP_AGGREGATE_MAX_BYTES),
      dataDescriptorCount: z.number().int().min(0).max(FOUNDRY_SOG_ZIP_MAX_ENTRIES),
      exactMemberSet: z.literal(true),
      allMembersStored: z.literal(true),
      allMemberCrc32Verified: z.literal(true),
      allDataDescriptorsVerified: z.literal(true),
      localHeaderFieldsConsistentWithCentralDirectory: z.literal(true),
      archiveHasNoPrefixOrGaps: z.literal(true),
      entryRangesNonOverlapping: z.literal(true),
    }).strict(),
    sharedPerGaussianImage: z.object({
      width: z.number().int().min(1).max(16_384),
      height: z.number().int().min(1).max(16_384),
      capacityPixels: z.number().int().safe().positive(),
      countFitsCapacity: z.literal(true),
    }).strict(),
    planes: z.array(SogWebpPlaneFactsSchema).min(5).max(7),
    limitations: z.tuple([
      z.literal(FOUNDRY_SOG_SOURCE_FACTS_LIMITATIONS[0]),
      z.literal(FOUNDRY_SOG_SOURCE_FACTS_LIMITATIONS[1]),
      z.literal(FOUNDRY_SOG_SOURCE_FACTS_LIMITATIONS[2]),
    ]),
  })
  .strict()
  .superRefine((facts, ctx) => {
    if (facts.antialias.declared !== (facts.antialias.declaredValue !== null)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["antialias"], message: "SOG antialias declaration fields disagree" });
    }
    if (facts.encodedMeansRange.mins.some((minimum, index) => minimum > (facts.encodedMeansRange.maxs[index] ?? minimum))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["encodedMeansRange"], message: "encoded SOG means minima cannot exceed maxima" });
    }
    const hasHigherOrder = facts.sphericalHarmonics.higherOrderPresent;
    if (
      hasHigherOrder !== (facts.sphericalHarmonics.bands !== null) ||
      hasHigherOrder !== (facts.sphericalHarmonics.paletteCount !== null)
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sphericalHarmonics"], message: "SOG higher-order SH fields disagree" });
    }
    const expectedRoles = hasHigherOrder
      ? ["means_l", "means_u", "scales", "quats", "sh0", "shN_centroids", "shN_labels"]
      : ["means_l", "means_u", "scales", "quats", "sh0"];
    if (JSON.stringify(facts.planes.map((plane) => plane.role)) !== JSON.stringify(expectedRoles)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["planes"], message: "SOG plane roles must be complete and canonically ordered" });
    }
    if (facts.planes.some((plane) => plane.kind !== (plane.role === "shN_centroids" ? "sh_palette" : "per_gaussian"))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["planes"], message: "SOG plane roles and kinds disagree" });
    }
    const planeBytes = facts.planes.reduce((total, plane) => total + plane.sizeBytes, 0);
    if (
      planeBytes !== facts.container.webpPlaneBytes ||
      facts.container.totalMemberUncompressedBytes !== planeBytes + facts.container.metaJsonBytes ||
      facts.container.entryCount !== facts.planes.length + 1 ||
      facts.container.dataDescriptorCount > facts.container.entryCount
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["container"], message: "SOG container member totals are inconsistent" });
    }
    const shared = facts.sharedPerGaussianImage;
    if (
      shared.capacityPixels !== shared.width * shared.height ||
      facts.count > shared.capacityPixels ||
      facts.planes.some((plane) =>
        plane.kind === "per_gaussian" &&
        (plane.width !== shared.width || plane.height !== shared.height)
      )
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sharedPerGaussianImage"], message: "SOG per-Gaussian image capacity is inconsistent" });
    }
    const centroid = facts.planes.find((plane) => plane.role === "shN_centroids");
    if (hasHigherOrder) {
      const bands = facts.sphericalHarmonics.bands;
      const paletteCount = facts.sphericalHarmonics.paletteCount;
      const expectedWidth = bands === null ? null : foundrySogShCentroidWidth(bands);
      const expectedHeight = paletteCount === null ? null : Math.ceil(paletteCount / 64);
      if (centroid === undefined || centroid.width !== expectedWidth || centroid.height !== expectedHeight) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["planes"], message: "SOG SH centroid dimensions are inconsistent" });
      }
    } else if (centroid !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["planes"], message: "SOG SH0 facts cannot include a centroid plane" });
    }
  });

const E57AssetSchema = z
  .object({
    source: SourceIdentitySchema.extend({
      inputType: z.enum(["generic_e57", "matterport_e57"]),
    }).strict(),
    format: z.literal("e57"),
    inspection: InspectionSchema,
    facts: E57FactsSchema.nullable(),
    unknowns: z.array(UnknownFactSchema),
  })
  .strict()
  .superRefine((asset, ctx) => {
    if ((asset.inspection.state === "established") !== (asset.facts !== null)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["facts"], message: "E57 facts must match inspection state" });
    }
    validateE57AssetConsistency(asset, ctx);
  });

const GlbAssetSchema = z
  .object({
    source: SourceIdentitySchema.extend({ inputType: z.literal("glb_gltf") }).strict(),
    format: z.literal("glb"),
    inspection: InspectionSchema,
    facts: z.object({ container: GlbContainerFactsSchema.nullable(), json: GlbJsonFactsSchema.nullable() }).strict(),
    unknowns: z.array(UnknownFactSchema),
  })
  .strict()
  .superRefine((asset, ctx) => {
    const complete = asset.facts.container !== null && asset.facts.json !== null;
    if ((asset.inspection.state === "established") !== complete) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["facts"], message: "GLB facts must match inspection state" });
    }
    validateGlbAssetConsistency(asset, ctx);
  });

const GltfJsonAssetSchema = z
  .object({
    source: SourceIdentitySchema.extend({ inputType: z.literal("glb_gltf") }).strict(),
    format: z.literal("gltf_json"),
    inspection: InspectionSchema,
    facts: z.null(),
    unknowns: z.array(UnknownFactSchema),
  })
  .strict()
  .superRefine((asset, ctx) => { validateGltfJsonAssetConsistency(asset, ctx); });

const ObjAssetSchema = z
  .object({
    source: SourceIdentitySchema.extend({ inputType: z.literal("obj") }).strict(),
    format: z.literal("obj"),
    inspection: InspectionSchema,
    facts: ObjFactsSchema.nullable(),
    unknowns: z.array(UnknownFactSchema),
  })
  .strict()
  .superRefine((asset, ctx) => {
    if ((asset.inspection.state === "established") !== (asset.facts !== null)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["facts"], message: "OBJ facts must match inspection state" });
    }
    validateObjAssetConsistency(asset, ctx);
  });

const SogAssetSchema = z
  .object({
    source: SourceIdentitySchema.extend({ inputType: z.literal("sog") }).strict(),
    format: z.literal("sog"),
    inspection: InspectionSchema,
    facts: SogFactsSchema.nullable(),
    unknowns: z.array(UnknownFactSchema),
  })
  .strict()
  .superRefine((asset, ctx) => {
    if ((asset.inspection.state === "established") !== (asset.facts !== null)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["facts"], message: "SOG facts must match inspection state" });
    }
    if (asset.facts !== null && asset.facts.container.archiveSizeBytes !== asset.source.sizeBytes) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["facts", "container", "archiveSizeBytes"], message: "SOG archive size must match its source identity" });
    }
    validateSogAssetConsistency(asset, ctx);
  });

export const UniversalSourceFactsAssetSchema = z.union([
  E57AssetSchema,
  GlbAssetSchema,
  GltfJsonAssetSchema,
  ObjAssetSchema,
  SogAssetSchema,
]);
export type UniversalSourceFactsAsset = z.infer<typeof UniversalSourceFactsAssetSchema>;

const BlockedSourceSchema = SourceIdentityBaseSchema.extend({
  inputType: z.literal("xgrids_xbin"),
}).strict();

export const UniversalSourceFactsFileResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("asset"), asset: UniversalSourceFactsAssetSchema }).strict(),
  z.object({ kind: z.literal("xbin_block"), source: BlockedSourceSchema }).strict(),
  z.object({ kind: z.literal("untargeted"), source: SourceIdentityBaseSchema }).strict(),
]);
export type UniversalSourceFactsFileResult = z.infer<typeof UniversalSourceFactsFileResultSchema>;

const PolicySchema = z
  .object({
    sourceAccess: z.literal("read_only"),
    mutation: z.literal("none"),
    reconstruction: z.literal("none"),
    networkAccess: z.literal("none"),
    externalProcess: z.enum(["none", "local_pye57_read_only"]),
    metadataProbe: z.enum(["none", "local_pye57_read_only"]),
    authority: z.literal("none"),
    rights: z.literal("not_evaluated"),
  })
  .strict();

const LimitationsSchema = z.tuple([
  z.literal(FOUNDRY_SOURCE_FACTS_LIMITATIONS[0]),
  z.literal(FOUNDRY_SOURCE_FACTS_LIMITATIONS[1]),
  z.literal(FOUNDRY_SOURCE_FACTS_LIMITATIONS[2]),
]);

const LimitsSchema = z
  .object({
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
  })
  .strict();

const SummarySchema = z
  .object({
    receiptFileCount: z.number().int().min(0).max(FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES),
    assetCount: z.number().int().min(0).max(FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES),
    establishedCount: z.number().int().min(0).max(FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES),
    factsNotEstablishedCount: z.number().int().min(0).max(FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES),
    untargetedFileCount: z.number().int().min(0).max(FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES),
    blockedSourceCount: z.number().int().min(0).max(FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES),
  })
  .strict();

const ArtifactBaseSchema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_UNIVERSAL_SOURCE_FACTS_V1),
    receiptSha256: z.string().regex(SHA256_HEX),
    policy: PolicySchema,
    limitations: LimitationsSchema,
    limits: LimitsSchema,
    summary: SummarySchema,
    factsSha256: z.string().regex(SHA256_HEX),
  })
  .strict();

const AvailableArtifactSchema = ArtifactBaseSchema.extend({
  state: z.literal("available"),
  assets: z.array(UniversalSourceFactsAssetSchema).max(FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES),
}).strict();

const UnavailableArtifactSchema = ArtifactBaseSchema.extend({
  state: z.literal("unavailable"),
  assets: z.tuple([]),
  affectedSources: z.array(BlockedSourceSchema).min(1).max(FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES),
  reason: z
    .object({
      code: z.literal("XGRIDS_XBIN_UNSUPPORTED"),
      message: z.literal("Universal Source Facts are unavailable because the receipt includes an unsupported XGRIDS XBIN candidate."),
      nextAction: z.literal(FOUNDRY_XBIN_OFFICIAL_EXPORT_NEXT_ACTION),
    })
    .strict(),
}).strict();

type ArtifactWithoutValidation = z.infer<typeof AvailableArtifactSchema> | z.infer<typeof UnavailableArtifactSchema>;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function artifactDigest(value: ArtifactWithoutValidation): string {
  const { factsSha256: _factsSha256, ...payload } = value;
  return domainSeparatedSha256(
    FOUNDRY_UNIVERSAL_SOURCE_FACTS_DIGEST_DOMAIN,
    toCanonicalJson(payload),
  );
}

function validateArtifact(value: ArtifactWithoutValidation, ctx: z.RefinementCtx): void {
  const paths = value.assets.map((asset) => asset.source.path);
  const sortedPaths = [...paths].sort(compareText);
  if (new Set(paths).size !== paths.length || paths.some((path, index) => path !== sortedPaths[index])) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["assets"], message: "asset paths must be unique and sorted" });
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
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["summary"], message: "summary does not match artifact contents" });
  }
  if (value.state === "unavailable") {
    const blockedPaths = value.affectedSources.map((source) => source.path);
    const sortedBlockedPaths = [...blockedPaths].sort(compareText);
    if (new Set(blockedPaths).size !== blockedPaths.length || blockedPaths.some((path, index) => path !== sortedBlockedPaths[index])) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["affectedSources"], message: "affected sources must be unique and sorted" });
    }
  }
  const hasAggregate = value.assets.some((asset) =>
    asset.format === "e57" && asset.facts?.aggregateMetadata !== null && asset.facts?.aggregateMetadata !== undefined
  );
  const expectedProbe = hasAggregate ? "local_pye57_read_only" : "none";
  if (value.policy.metadataProbe !== expectedProbe || value.policy.externalProcess !== expectedProbe) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["policy", "metadataProbe"],
      message: "metadata probe policy must match attached E57 aggregate evidence",
    });
  }
  if (value.factsSha256 !== artifactDigest(value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["factsSha256"], message: "facts digest does not match canonical payload" });
  }
}

export const FoundryUniversalSourceFactsSchema = z
  .discriminatedUnion("state", [AvailableArtifactSchema, UnavailableArtifactSchema])
  .superRefine(validateArtifact);
export type FoundryUniversalSourceFacts = z.infer<typeof FoundryUniversalSourceFactsSchema>;

const E57_UNKNOWNS = [
  unknownFact("E57_SCAN_COUNT_UNKNOWN", "Scan count", "The fixed physical header does not contain the scan count.", "Run a format-aware E57 metadata-tree inspection against the same SHA-256-bound file."),
  unknownFact("E57_POINT_COUNT_UNKNOWN", "Point count", "The fixed physical header does not contain point-record counts.", "Inspect the E57 data3D metadata tree without reading point payloads."),
  unknownFact("E57_IMAGE_COUNT_UNKNOWN", "Image count", "The fixed physical header does not contain image2D counts.", "Inspect the E57 images2D metadata tree without extracting imagery."),
  unknownFact("E57_CRS_UNKNOWN", "Coordinate reference system", "No CRS claim is made from the physical header.", "Obtain authoritative CRS metadata or a survey-control record bound to this source."),
  unknownFact("E57_UNITS_UNKNOWN", "Units", "No unit claim is made from the physical header.", "Inspect documented E57 coordinate metadata and corroborate it with capture provenance."),
  unknownFact("E57_BOUNDS_UNKNOWN", "Spatial bounds", "Point payloads were not read.", "Run a bounded, read-only point-statistics pass against the same source digest."),
  unknownFact("E57_ACCURACY_UNKNOWN", "Measurement accuracy", "Container metadata cannot establish physical measurement accuracy.", "Compare the reconstruction with independent survey control and frozen blind checks."),
  unknownFact("E57_REGISTRATION_UNKNOWN", "Registration quality", "The physical header cannot establish alignment or registration quality.", "Evaluate residuals against independent control with a documented registration method."),
  unknownFact("E57_RIGHTS_UNKNOWN", "Usage rights", "Byte and metadata inspection do not evaluate ownership, training, or redistribution rights.", "Obtain an authorized rights decision bound to this exact SHA-256."),
] as const;

const GLB_UNKNOWNS = [
  unknownFact("GLB_DECODED_GEOMETRY_UNKNOWN", "Decoded geometry", "V1 reads the container header and bounded JSON declarations but does not decode BIN chunks, accessors, indices, or positions.", "Run a separately reviewed bounded accessor decoder against this exact source digest."),
  unknownFact("GLB_REMAINING_CHUNKS_UNKNOWN", "Remaining chunk structure", "V1 does not interpret chunks after the first JSON chunk.", "Inspect the complete GLB chunk table with fixed chunk-count and byte limits."),
  unknownFact("GLB_UNITS_UNKNOWN", "Physical units", "glTF does not require a source-specific physical-unit attestation.", "Obtain source provenance that declares units and verify a known dimension."),
  unknownFact("GLB_FRAME_UNKNOWN", "Coordinate frame", "Container and JSON declarations do not establish the venue coordinate frame.", "Bind the asset to an authoritative frame transform and control network."),
  unknownFact("GLB_ACCURACY_UNKNOWN", "Physical accuracy", "Declared mesh structure does not establish reconstruction accuracy.", "Compare geometry against independent survey control and frozen blind checks."),
  unknownFact("GLB_RIGHTS_UNKNOWN", "Usage rights", "Byte inspection does not evaluate ownership, training, or redistribution rights.", "Obtain an authorized rights decision bound to this exact SHA-256."),
  unknownFact("GLB_APPEARANCE_FIDELITY_UNKNOWN", "Appearance fidelity", "JSON declarations do not establish visual fidelity to the captured venue.", "Perform a source-image comparison using rights-cleared reference imagery."),
] as const;

const OBJ_UNKNOWNS = [
  unknownFact("OBJ_UNITS_UNKNOWN", "Physical units", "Wavefront OBJ does not require a unit declaration.", "Obtain source provenance and verify a known physical dimension."),
  unknownFact("OBJ_UP_AXIS_UNKNOWN", "Up axis", "Wavefront OBJ does not require an up-axis declaration.", "Obtain the exporter convention or an authoritative frame transform."),
  unknownFact("OBJ_FRAME_UNKNOWN", "Coordinate frame", "Vertex coordinates alone do not identify a venue frame.", "Bind the source to an authoritative coordinate-frame record."),
  unknownFact("OBJ_TOPOLOGY_UNKNOWN", "Topology quality", "Syntactic face checks do not establish manifoldness, winding, or self-intersection quality.", "Run a bounded geometry-topology validator against this exact source digest."),
  unknownFact("OBJ_TRIANGULATION_UNKNOWN", "Triangulation semantics", "The fan-triangle equivalent is a syntactic comparison only; V1 does not choose or prove a triangulation.", "Run the intended importer and compare its exact triangle topology against this digest-bound source."),
  unknownFact("OBJ_MATERIAL_COMPLETENESS_UNKNOWN", "Material completeness", "Material libraries were declared but never opened.", "Inspect separately receipted MTL and texture assets without resolving external paths implicitly."),
  unknownFact("OBJ_ACCURACY_UNKNOWN", "Physical accuracy", "Syntactic geometry facts do not establish reconstruction accuracy.", "Compare geometry against independent survey control and frozen blind checks."),
  unknownFact("OBJ_RIGHTS_UNKNOWN", "Usage rights", "Byte inspection does not evaluate ownership, training, or redistribution rights.", "Obtain an authorized rights decision bound to this exact SHA-256."),
] as const;

const SOG_UNKNOWNS = [
  unknownFact("SOG_ATTRIBUTE_VALUES_UNKNOWN", "Decoded Gaussian attributes", "V1 validates the stored ZIP, meta.json, member CRCs, and complete WebP RIFF structures but does not decode pixels into Gaussian attribute values.", "Run a separately reviewed bounded SOG v2 attribute decoder against this exact source digest and record byte, point, finite-value, and cancellation limits."),
  unknownFact("SOG_PHYSICAL_BOUNDS_UNKNOWN", "Physical spatial bounds", "The encoded means minima and maxima are reported only as format parameters and are not asserted as venue-space physical bounds.", "Decode positions under a documented SOG convention, bind authoritative units and frame, and compute bounds against this exact source digest."),
  unknownFact("SOG_UNITS_UNKNOWN", "Physical units", "SOG v2 container metadata does not establish an authoritative physical-unit attestation for this venue source.", "Obtain authoritative source provenance that declares units and verify a known physical dimension."),
  unknownFact("SOG_FRAME_UNKNOWN", "Coordinate frame", "Container structure and encoded means ranges do not identify the venue coordinate frame or a transform into it.", "Bind this exact source digest to an authoritative frame transform and control record."),
  unknownFact("SOG_RENDERER_COMPATIBILITY_UNKNOWN", "Renderer compatibility", "Complete stored members and RIFF structures do not prove that a particular renderer decodes and presents the Gaussian attributes correctly.", "Run a pinned offline compatibility probe against this exact digest and record loader version, limits, result, and any unsupported feature."),
  unknownFact("SOG_VISUAL_FIDELITY_UNKNOWN", "Appearance fidelity", "Structural and declaration facts do not establish visual fidelity to the captured venue.", "Compare frozen views in a pinned offline renderer with rights-cleared reference observations and record indeterminate regions."),
  unknownFact("SOG_PROVENANCE_UNKNOWN", "Source provenance", "Byte inspection does not establish the capture, training, conversion, or export lineage of the SOG asset.", "Obtain an authoritative lineage record bound to this exact SHA-256, including capture source and every material conversion step."),
  unknownFact("SOG_ACCURACY_UNKNOWN", "Physical accuracy", "A structurally valid SOG container does not establish metric accuracy.", "Compare decoded positions with independent survey control and frozen blind checks."),
  unknownFact("SOG_REGISTRATION_UNKNOWN", "Registration quality", "The container does not establish alignment quality or residuals in the venue frame.", "Evaluate digest-bound decoded positions against independent control with a documented registration method and residual protocol."),
  unknownFact("SOG_RIGHTS_UNKNOWN", "Usage rights", "Byte inspection does not evaluate ownership, model-training, derivative-output, or redistribution rights.", "Obtain an authorized purpose-scoped rights decision bound to this exact SHA-256."),
] as const;

type Inspection = z.infer<typeof InspectionSchema>;
type UnknownFact = z.infer<typeof UnknownFactSchema>;

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateExactUnknowns(
  actual: readonly UnknownFact[],
  expected: readonly UnknownFact[],
  ctx: z.RefinementCtx,
): void {
  if (!sameJson(actual, expected)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["unknowns"],
      message: "unknown facts must match the canonical format coverage",
    });
  }
}

function validateExactInspection(
  actual: Inspection,
  expected: Inspection,
  ctx: z.RefinementCtx,
): void {
  if (!sameJson(actual, expected)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["inspection"],
      message: "inspection state must match the stable format outcome",
    });
  }
}

function validateE57AssetConsistency(
  asset: {
    readonly facts: z.infer<typeof E57FactsSchema> | null;
    readonly inspection: Inspection;
    readonly unknowns: readonly UnknownFact[];
  },
  ctx: z.RefinementCtx,
): void {
  const expectedUnknowns = asset.facts?.aggregateMetadata === null || asset.facts === null
    ? E57_UNKNOWNS
    : E57_UNKNOWNS.filter((item) => !E57_DEEP_METADATA_UNKNOWN_CODES.has(item.code));
  validateExactUnknowns(asset.unknowns, expectedUnknowns, ctx);
  if (asset.facts !== null) {
    validateExactInspection(
      asset.inspection,
      inspection("established", "established", "E57_PHYSICAL_HEADER_ESTABLISHED", "physical_header"),
      ctx,
    );
    return;
  }
  const allowed = new Set([
    "E57_PHYSICAL_HEADER_TRUNCATED",
    "E57_SIGNATURE_NOT_ESTABLISHED",
    "E57_HEADER_VALUE_OUT_OF_RANGE",
    "E57_PHYSICAL_HEADER_PARSE_FAILED",
  ]);
  if (!allowed.has(asset.inspection.code)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["inspection", "code"], message: "unrecognized E57 outcome code" });
    return;
  }
  validateExactInspection(
    asset.inspection,
    inspection("facts_not_established", "parse_failure", asset.inspection.code, "none"),
    ctx,
  );
}

const GLB_FAILURE_CATEGORY: Readonly<Record<string, Inspection["category"]>> = {
  GLB_HEADER_TRUNCATED: "parse_failure",
  GLB_MAGIC_NOT_ESTABLISHED: "parse_failure",
  GLB_JSON_CHUNK_HEADER_TRUNCATED: "parse_failure",
  GLB_FIRST_CHUNK_IS_NOT_JSON: "unsupported_container",
  GLB_JSON_CHUNK_EMPTY: "parse_failure",
  GLB_JSON_CHUNK_LIMIT_EXCEEDED: "resource_limit",
  GLB_JSON_CHUNK_OUT_OF_BOUNDS: "parse_failure",
  GLB_JSON_CHUNK_EXCEEDS_DECLARED_CONTAINER: "parse_failure",
  GLB_JSON_UTF8_INVALID: "parse_failure",
  GLB_JSON_PADDING_INVALID: "parse_failure",
  GLB_JSON_SYNTAX_INVALID: "parse_failure",
  GLB_JSON_DUPLICATE_KEY: "parse_failure",
  GLB_JSON_DEPTH_LIMIT_EXCEEDED: "resource_limit",
  GLB_JSON_VALUE_LIMIT_EXCEEDED: "resource_limit",
  GLB_JSON_NUMBER_OUT_OF_RANGE: "parse_failure",
  GLB_JSON_ROOT_NOT_OBJECT: "parse_failure",
  GLB_DECLARATION_STRUCTURE_UNSUPPORTED: "parse_failure",
  GLB_DECLARATION_LIMIT_EXCEEDED: "resource_limit",
  GLB_JSON_FACT_EXTRACTION_FAILED: "parse_failure",
};

function validateGlbAssetConsistency(
  asset: {
    readonly facts: {
      readonly container: z.infer<typeof GlbContainerFactsSchema> | null;
      readonly json: z.infer<typeof GlbJsonFactsSchema> | null;
    };
    readonly inspection: Inspection;
    readonly unknowns: readonly UnknownFact[];
  },
  ctx: z.RefinementCtx,
): void {
  validateExactUnknowns(asset.unknowns, GLB_UNKNOWNS, ctx);
  if (asset.facts.json !== null) {
    validateExactInspection(
      asset.inspection,
      inspection("established", "established", "GLB_CONTAINER_JSON_FACTS_ESTABLISHED", "container_header_and_json"),
      ctx,
    );
    return;
  }
  const category = GLB_FAILURE_CATEGORY[asset.inspection.code];
  if (category === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["inspection", "code"], message: "unrecognized GLB outcome code" });
    return;
  }
  validateExactInspection(
    asset.inspection,
    inspection(
      "facts_not_established",
      category,
      asset.inspection.code,
      asset.facts.container === null ? "none" : "container_header",
    ),
    ctx,
  );
}

function validateGltfJsonAssetConsistency(
  asset: { readonly inspection: Inspection; readonly unknowns: readonly UnknownFact[] },
  ctx: z.RefinementCtx,
): void {
  validateExactUnknowns(asset.unknowns, GLB_UNKNOWNS, ctx);
  validateExactInspection(
    asset.inspection,
    inspection("facts_not_established", "unsupported_variant", "GLTF_JSON_VARIANT_UNSUPPORTED", "none"),
    ctx,
  );
}

function validateObjAssetConsistency(
  asset: {
    readonly facts: z.infer<typeof ObjFactsSchema> | null;
    readonly inspection: Inspection;
    readonly unknowns: readonly UnknownFact[];
  },
  ctx: z.RefinementCtx,
): void {
  validateExactUnknowns(asset.unknowns, OBJ_UNKNOWNS, ctx);
  if (asset.facts !== null) {
    validateExactInspection(
      asset.inspection,
      inspection("established", "established", "OBJ_STREAM_FACTS_ESTABLISHED", "complete_stream"),
      ctx,
    );
    return;
  }
  const category = asset.inspection.code === "OBJ_LOGICAL_LINE_LIMIT_EXCEEDED" ||
    asset.inspection.code === "OBJ_DECLARATION_LIMIT_EXCEEDED"
    ? "resource_limit"
    : "parse_failure";
  const allowed = new Set([
    "OBJ_LOGICAL_LINE_LIMIT_EXCEEDED",
    "OBJ_DECLARATION_LIMIT_EXCEEDED",
    "OBJ_LINE_CONTINUATION_UNTERMINATED",
    "OBJ_UTF8_INVALID",
    "OBJ_NUL_BYTE",
  ]);
  if (!allowed.has(asset.inspection.code)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["inspection", "code"], message: "unrecognized OBJ outcome code" });
    return;
  }
  validateExactInspection(
    asset.inspection,
    inspection("facts_not_established", category, asset.inspection.code, "none"),
    ctx,
  );
}

function validateSogAssetConsistency(
  asset: {
    readonly facts: z.infer<typeof SogFactsSchema> | null;
    readonly inspection: Inspection;
    readonly unknowns: readonly UnknownFact[];
  },
  ctx: z.RefinementCtx,
): void {
  validateExactUnknowns(asset.unknowns, SOG_UNKNOWNS, ctx);
  if (asset.facts !== null) {
    validateExactInspection(
      asset.inspection,
      inspection(
        "established",
        "established",
        "SOG_V2_STORED_ZIP_FACTS_ESTABLISHED",
        "complete_container_structure",
      ),
      ctx,
    );
    return;
  }
  const category = (
    FOUNDRY_SOG_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE as Readonly<Record<string, string>>
  )[asset.inspection.code];
  if (category === undefined || category === "cancelled") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["inspection", "code"], message: "unrecognized or non-serializable SOG outcome code" });
    return;
  }
  validateExactInspection(
    asset.inspection,
    inspection(
      "facts_not_established",
      category as Exclude<Inspection["category"], "established">,
      asset.inspection.code,
      "none",
    ),
    ctx,
  );
}

function unknownFact(
  code: string,
  label: string,
  reason: string,
  decisiveNextTest: string,
): z.infer<typeof UnknownFactSchema> {
  return UnknownFactSchema.parse({ code, label, reason, decisiveNextTest });
}

class JsonFactsError extends Error {
  readonly code: string;
  readonly category: "resource_limit" | "parse_failure";

  constructor(code: string, category: "resource_limit" | "parse_failure", message: string) {
    super(message);
    this.name = "JsonFactsError";
    this.code = code;
    this.category = category;
  }
}

class BoundedJsonParser {
  private index = 0;
  private valueCount = 0;

  constructor(private readonly text: string) {}

  parse(): unknown {
    this.skipWhitespace();
    const value = this.parseValue(1);
    this.skipWhitespace();
    if (this.index !== this.text.length) this.fail("GLB_JSON_SYNTAX_INVALID", "JSON has trailing content.");
    return value;
  }

  private fail(code: string, message: string): never {
    throw new JsonFactsError(code, "parse_failure", message);
  }

  private countValue(): void {
    this.valueCount += 1;
    if (this.valueCount > FOUNDRY_SOURCE_FACTS_GLB_JSON_MAX_VALUES) {
      throw new JsonFactsError(
        "GLB_JSON_VALUE_LIMIT_EXCEEDED",
        "resource_limit",
        "GLB JSON exceeds the bounded value-count limit.",
      );
    }
  }

  private parseValue(depth: number): unknown {
    if (depth > FOUNDRY_SOURCE_FACTS_GLB_JSON_MAX_DEPTH) {
      throw new JsonFactsError(
        "GLB_JSON_DEPTH_LIMIT_EXCEEDED",
        "resource_limit",
        "GLB JSON exceeds the bounded nesting-depth limit.",
      );
    }
    this.countValue();
    const character = this.text[this.index];
    if (character === "{") return this.parseObject(depth);
    if (character === "[") return this.parseArray(depth);
    if (character === "\"") return this.parseString();
    if (character === "t" && this.takeKeyword("true")) return true;
    if (character === "f" && this.takeKeyword("false")) return false;
    if (character === "n" && this.takeKeyword("null")) return null;
    return this.parseNumber();
  }

  private parseObject(depth: number): Record<string, unknown> {
    this.index += 1;
    const output: Record<string, unknown> = {};
    const keys = new Set<string>();
    this.skipWhitespace();
    if (this.text[this.index] === "}") {
      this.index += 1;
      return output;
    }
    while (this.index < this.text.length) {
      if (this.text[this.index] !== "\"") this.fail("GLB_JSON_SYNTAX_INVALID", "JSON object key must be a string.");
      const key = this.parseString();
      if (keys.has(key)) this.fail("GLB_JSON_DUPLICATE_KEY", "GLB JSON contains a duplicate object key.");
      keys.add(key);
      this.skipWhitespace();
      if (this.text[this.index] !== ":") this.fail("GLB_JSON_SYNTAX_INVALID", "JSON object key lacks a colon.");
      this.index += 1;
      this.skipWhitespace();
      output[key] = this.parseValue(depth + 1);
      this.skipWhitespace();
      const delimiter = this.text[this.index];
      if (delimiter === "}") {
        this.index += 1;
        return output;
      }
      if (delimiter !== ",") this.fail("GLB_JSON_SYNTAX_INVALID", "JSON object member lacks a delimiter.");
      this.index += 1;
      this.skipWhitespace();
    }
    return this.fail("GLB_JSON_SYNTAX_INVALID", "JSON object is unterminated.");
  }

  private parseArray(depth: number): unknown[] {
    this.index += 1;
    const output: unknown[] = [];
    this.skipWhitespace();
    if (this.text[this.index] === "]") {
      this.index += 1;
      return output;
    }
    while (this.index < this.text.length) {
      output.push(this.parseValue(depth + 1));
      this.skipWhitespace();
      const delimiter = this.text[this.index];
      if (delimiter === "]") {
        this.index += 1;
        return output;
      }
      if (delimiter !== ",") this.fail("GLB_JSON_SYNTAX_INVALID", "JSON array member lacks a delimiter.");
      this.index += 1;
      this.skipWhitespace();
    }
    return this.fail("GLB_JSON_SYNTAX_INVALID", "JSON array is unterminated.");
  }

  private parseString(): string {
    const start = this.index;
    this.index += 1;
    let escaped = false;
    while (this.index < this.text.length) {
      const code = this.text.charCodeAt(this.index);
      const character = this.text[this.index];
      if (!escaped && character === "\"") {
        this.index += 1;
        try {
          return JSON.parse(this.text.slice(start, this.index)) as string;
        } catch {
          return this.fail("GLB_JSON_SYNTAX_INVALID", "JSON string escape is invalid.");
        }
      }
      if (!escaped && code < 0x20) this.fail("GLB_JSON_SYNTAX_INVALID", "JSON string contains an unescaped control character.");
      if (!escaped && character === "\\") {
        escaped = true;
      } else {
        escaped = false;
      }
      this.index += 1;
    }
    return this.fail("GLB_JSON_SYNTAX_INVALID", "JSON string is unterminated.");
  }

  private parseNumber(): number {
    const remainder = this.text.slice(this.index);
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u.exec(remainder);
    if (match === null) return this.fail("GLB_JSON_SYNTAX_INVALID", "JSON value is invalid.");
    this.index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) return this.fail("GLB_JSON_NUMBER_OUT_OF_RANGE", "JSON number is outside the finite range.");
    return value;
  }

  private takeKeyword(keyword: string): boolean {
    if (!this.text.startsWith(keyword, this.index)) return false;
    this.index += keyword.length;
    return true;
  }

  private skipWhitespace(): void {
    while (isJsonWhitespaceCode(this.text.charCodeAt(this.index))) this.index += 1;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function decimal(value: number | bigint): string {
  return String(value);
}

function declaredArrayLength(value: unknown): string {
  if (value === undefined) return "0";
  if (!Array.isArray(value)) {
    throw new JsonFactsError("GLB_DECLARATION_STRUCTURE_UNSUPPORTED", "parse_failure", "A GLB top-level declaration is not an array.");
  }
  return decimal(value.length);
}

function optionalBoundedString(value: unknown, max: number): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string") {
    throw new JsonFactsError("GLB_DECLARATION_STRUCTURE_UNSUPPORTED", "parse_failure", "A GLB scalar declaration has the wrong type.");
  }
  if (value.length > max) {
    throw new JsonFactsError("GLB_DECLARATION_LIMIT_EXCEEDED", "resource_limit", "A GLB scalar declaration exceeds the bounded output limit.");
  }
  return value;
}

function declaredStrings(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new JsonFactsError("GLB_DECLARATION_STRUCTURE_UNSUPPORTED", "parse_failure", "A GLB declaration list is not a bounded string array.");
  }
  const declarations: string[] = [];
  for (const item of value as unknown[]) {
    if (typeof item !== "string" || item.length < 1 || item.length > 256) {
      throw new JsonFactsError("GLB_DECLARATION_STRUCTURE_UNSUPPORTED", "parse_failure", "A GLB declaration list is not a bounded string array.");
    }
    declarations.push(item);
  }
  if (value.length > FOUNDRY_SOURCE_FACTS_GLB_DECLARATION_MAX_COUNT) {
    throw new JsonFactsError("GLB_DECLARATION_LIMIT_EXCEEDED", "resource_limit", "GLB declarations exceed the bounded output limit.");
  }
  return declarations.sort(compareText);
}

function extractGlbJsonFacts(documentValue: unknown): z.infer<typeof GlbJsonFactsSchema> {
  const document = record(documentValue);
  if (document === null) throw new JsonFactsError("GLB_JSON_ROOT_NOT_OBJECT", "parse_failure", "GLB JSON root is not an object.");
  const asset = document.asset === undefined ? null : record(document.asset);
  if (document.asset !== undefined && asset === null) {
    throw new JsonFactsError("GLB_DECLARATION_STRUCTURE_UNSUPPORTED", "parse_failure", "The GLB asset declaration is not an object.");
  }
  const declaredCounts = {
    accessors: declaredArrayLength(document.accessors),
    animations: declaredArrayLength(document.animations),
    buffers: declaredArrayLength(document.buffers),
    bufferViews: declaredArrayLength(document.bufferViews),
    cameras: declaredArrayLength(document.cameras),
    images: declaredArrayLength(document.images),
    materials: declaredArrayLength(document.materials),
    meshes: declaredArrayLength(document.meshes),
    nodes: declaredArrayLength(document.nodes),
    samplers: declaredArrayLength(document.samplers),
    scenes: declaredArrayLength(document.scenes),
    skins: declaredArrayLength(document.skins),
    textures: declaredArrayLength(document.textures),
  };
  const modes = new Map<number, bigint>();
  const semantics = new Set<string>();
  let invalidModes = 0n;
  if (Array.isArray(document.meshes)) {
    for (const meshValue of document.meshes) {
      const mesh = record(meshValue);
      if (mesh === null) {
        throw new JsonFactsError("GLB_DECLARATION_STRUCTURE_UNSUPPORTED", "parse_failure", "A GLB mesh declaration is not an object.");
      }
      const primitives = mesh.primitives;
      if (primitives === undefined) continue;
      if (!Array.isArray(primitives)) {
        throw new JsonFactsError("GLB_DECLARATION_STRUCTURE_UNSUPPORTED", "parse_failure", "A GLB primitive declaration is not an array.");
      }
      for (const primitiveValue of primitives) {
        const primitive = record(primitiveValue);
        if (primitive === null) {
          throw new JsonFactsError("GLB_DECLARATION_STRUCTURE_UNSUPPORTED", "parse_failure", "A GLB primitive declaration is not an object.");
        }
        const mode = primitive.mode === undefined ? 4 : primitive.mode;
        if (typeof mode === "number" && Number.isInteger(mode) && mode >= 0 && mode <= 6) {
          modes.set(mode, (modes.get(mode) ?? 0n) + 1n);
        } else {
          invalidModes += 1n;
        }
        const attributes = primitive.attributes === undefined ? null : record(primitive.attributes);
        if (primitive.attributes !== undefined && attributes === null) {
          throw new JsonFactsError("GLB_DECLARATION_STRUCTURE_UNSUPPORTED", "parse_failure", "A GLB attribute declaration is not an object.");
        }
        if (attributes !== null) {
          for (const semantic of Object.keys(attributes)) semantics.add(semantic);
        }
      }
    }
  }
  if (semantics.size > FOUNDRY_SOURCE_FACTS_GLB_DECLARATION_MAX_COUNT || [...semantics].some((item) => item.length < 1 || item.length > 256)) {
    throw new JsonFactsError("GLB_DECLARATION_LIMIT_EXCEEDED", "resource_limit", "GLB attribute declarations exceed the bounded output limit.");
  }
  let uriTotal = 0n;
  let uriBuffers = 0n;
  let uriImages = 0n;
  const visit = (value: unknown, topLevelSection: string | null): void => {
    if (Array.isArray(value)) {
      value.forEach((child) => { visit(child, topLevelSection); });
      return;
    }
    const object = record(value);
    if (object === null) return;
    for (const [key, child] of Object.entries(object)) {
      if (key === "uri") {
        uriTotal += 1n;
        if (topLevelSection === "buffers") uriBuffers += 1n;
        else if (topLevelSection === "images") uriImages += 1n;
      }
      visit(child, topLevelSection ?? key);
    }
  };
  visit(document, null);
  return GlbJsonFactsSchema.parse({
    assetVersion: optionalBoundedString(asset?.version, 128),
    assetMinVersion: optionalBoundedString(asset?.minVersion, 128),
    generator: optionalBoundedString(asset?.generator, 500),
    declaredCounts,
    extensionsUsed: declaredStrings(document.extensionsUsed),
    extensionsRequired: declaredStrings(document.extensionsRequired),
    primitiveModes: [...modes.entries()].sort(([left], [right]) => left - right).map(([mode, count]) => ({ mode, count: decimal(count) })),
    invalidPrimitiveModeDeclarationCount: decimal(invalidModes),
    attributeSemantics: [...semantics].sort(compareText),
    uriDeclarations: {
      total: decimal(uriTotal),
      buffers: decimal(uriBuffers),
      images: decimal(uriImages),
      other: decimal(uriTotal - uriBuffers - uriImages),
    },
  });
}

type ObjStatementKey = keyof z.infer<typeof ObjStatementCountsSchema>;
type ObjFaceForm = keyof z.infer<typeof ObjFactsSchema>["faceForms"];

function emptyObjStatementCounts(): Record<ObjStatementKey, bigint> {
  return {
    logicalLines: 0n,
    blank: 0n,
    comment: 0n,
    vertexPosition: 0n,
    textureCoordinate: 0n,
    normal: 0n,
    parameterSpaceVertex: 0n,
    face: 0n,
    line: 0n,
    point: 0n,
    object: 0n,
    group: 0n,
    materialLibrary: 0n,
    useMaterial: 0n,
    smoothing: 0n,
    other: 0n,
    malformed: 0n,
  };
}

function validObjIndex(raw: string, available: bigint): boolean {
  if (!/^-?(?:[1-9][0-9]*)$/u.test(raw)) return false;
  const value = BigInt(raw);
  return value > 0n ? value <= available : -value <= available;
}

function objNumber(raw: string): number | null {
  if (!/^[+-]?(?:(?:[0-9]+(?:\.[0-9]*)?)|(?:\.[0-9]+))(?:[eE][+-]?[0-9]+)?$/u.test(raw)) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function objFaceCornerForm(
  token: string,
  vertices: bigint,
  textures: bigint,
  normals: bigint,
): ObjFaceForm | null {
  const parts = token.split("/");
  if (parts.length === 1) {
    return validObjIndex(parts[0] ?? "", vertices) ? "vertexOnly" : null;
  }
  if (parts.length === 2) {
    return validObjIndex(parts[0] ?? "", vertices) && validObjIndex(parts[1] ?? "", textures)
      ? "vertexTexture"
      : null;
  }
  if (parts.length !== 3 || !validObjIndex(parts[0] ?? "", vertices)) return null;
  const texture = parts[1] ?? "";
  const normal = parts[2] ?? "";
  if (texture === "" && validObjIndex(normal, normals)) return "vertexNormal";
  if (validObjIndex(texture, textures) && validObjIndex(normal, normals)) return "vertexTextureNormal";
  return null;
}

class ObjStreamFactsParser {
  private readonly lineBytes: number[] = [];
  private readonly counts = emptyObjStatementCounts();
  private readonly arities = new Map<number, bigint>();
  private readonly faceForms: Record<ObjFaceForm, bigint> = {
    vertexOnly: 0n,
    vertexTexture: 0n,
    vertexNormal: 0n,
    vertexTextureNormal: 0n,
  };
  private validVertices = 0n;
  private validTextures = 0n;
  private validNormals = 0n;
  private validFaces = 0n;
  private validCorners = 0n;
  private fanTriangles = 0n;
  private positiveFaceIndexReferences = 0n;
  private negativeFaceIndexReferences = 0n;
  private min: [number, number, number] | null = null;
  private max: [number, number, number] | null = null;
  private firstLine = true;
  private failureCode:
    | "OBJ_LOGICAL_LINE_LIMIT_EXCEEDED"
    | "OBJ_DECLARATION_LIMIT_EXCEEDED"
    | "OBJ_LINE_CONTINUATION_UNTERMINATED"
    | "OBJ_UTF8_INVALID"
    | "OBJ_NUL_BYTE"
    | null = null;

  observe(chunk: Uint8Array): void {
    for (const byte of chunk) {
      if (byte === 0x0a) {
        if (this.failureCode === null && this.consumeLineContinuation()) continue;
        if (this.failureCode === null) this.processLine();
        this.lineBytes.length = 0;
        continue;
      }
      if (this.failureCode !== null) continue;
      if (this.lineBytes.length >= FOUNDRY_SOURCE_FACTS_OBJ_LOGICAL_LINE_MAX_BYTES) {
        this.failureCode = "OBJ_LOGICAL_LINE_LIMIT_EXCEEDED";
        this.lineBytes.length = 0;
        continue;
      }
      this.lineBytes.push(byte);
    }
  }

  finalize(): { readonly code: string; readonly facts: z.infer<typeof ObjFactsSchema> | null } {
    if (this.failureCode === null && this.lineContinuationIndex() !== null) {
      this.failureCode = "OBJ_LINE_CONTINUATION_UNTERMINATED";
    }
    if (this.failureCode === null && this.lineBytes.length > 0) this.processLine();
    if (this.failureCode !== null) return { code: this.failureCode, facts: null };
    const statementCounts = Object.fromEntries(
      Object.entries(this.counts).map(([key, value]) => [key, decimal(value)]),
    );
    return {
      code: "OBJ_STREAM_FACTS_ESTABLISHED",
      facts: ObjFactsSchema.parse({
        statementCounts,
        validVertexPositionCount: decimal(this.validVertices),
        validTextureCoordinateCount: decimal(this.validTextures),
        validNormalCount: decimal(this.validNormals),
        validFaceStatementCount: decimal(this.validFaces),
        validFaceCornerCount: decimal(this.validCorners),
        fanTriangleEquivalentCount: decimal(this.fanTriangles),
        faceForms: Object.fromEntries(Object.entries(this.faceForms).map(([key, value]) => [key, decimal(value)])),
        faceIndexReferences: {
          positive: decimal(this.positiveFaceIndexReferences),
          negative: decimal(this.negativeFaceIndexReferences),
        },
        faceArities: [...this.arities.entries()]
          .sort(([left], [right]) => left - right)
          .map(([arity, faceCount]) => ({ arity, faceCount: decimal(faceCount) })),
        nativeCoordinateBounds: this.min === null || this.max === null
          ? null
          : { min: this.min, max: this.max },
        materialLibraryDeclarationCount: decimal(this.counts.materialLibrary),
        materialUseDeclarationCount: decimal(this.counts.useMaterial),
      }),
    };
  }

  private increment(key: ObjStatementKey): void {
    this.counts[key] += 1n;
  }

  private malformed(): void {
    this.increment("malformed");
  }

  private processLine(): void {
    let bytes = Uint8Array.from(this.lineBytes);
    if (bytes.at(-1) === 0x0d) bytes = bytes.subarray(0, bytes.length - 1);
    if (this.firstLine) {
      this.firstLine = false;
      if (UTF8_BOM.every((byte, index) => bytes[index] === byte)) bytes = bytes.subarray(UTF8_BOM.length);
    }
    let line: string;
    try {
      line = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      this.failureCode = "OBJ_UTF8_INVALID";
      return;
    }
    if (line.includes("\u0000")) {
      this.failureCode = "OBJ_NUL_BYTE";
      return;
    }
    this.increment("logicalLines");
    const leftTrimmed = line.trimStart();
    if (leftTrimmed === "") {
      this.increment("blank");
      return;
    }
    if (leftTrimmed.startsWith("#")) {
      this.increment("comment");
      return;
    }
    const content = line.slice(0, line.indexOf("#") < 0 ? line.length : line.indexOf("#")).trim();
    if (content === "") {
      this.increment("comment");
      return;
    }
    const tokens = content.replaceAll("\t", " ").split(" ").filter((token) => token !== "");
    const directive = tokens[0] ?? "";
    const values = tokens.slice(1);
    switch (directive) {
      case "v":
        this.increment("vertexPosition");
        this.parseVertex(values);
        break;
      case "vt":
        this.increment("textureCoordinate");
        if (values.length < 1 || values.length > 3 || values.some((value) => objNumber(value) === null)) this.malformed();
        else this.validTextures += 1n;
        break;
      case "vn":
        this.increment("normal");
        if (values.length !== 3 || values.some((value) => objNumber(value) === null)) this.malformed();
        else this.validNormals += 1n;
        break;
      case "vp":
        this.increment("parameterSpaceVertex");
        if (values.length < 1 || values.length > 3 || values.some((value) => objNumber(value) === null)) this.malformed();
        break;
      case "f":
        this.increment("face");
        this.parseFace(values);
        break;
      case "l":
        this.increment("line");
        break;
      case "p":
        this.increment("point");
        break;
      case "o":
        this.increment("object");
        break;
      case "g":
        this.increment("group");
        break;
      case "mtllib":
        this.increment("materialLibrary");
        break;
      case "usemtl":
        this.increment("useMaterial");
        break;
      case "s":
        this.increment("smoothing");
        break;
      default:
        this.increment("other");
    }
  }

  private parseVertex(values: readonly string[]): void {
    const parsed = values.map(objNumber);
    if (values.length < 3 || values.length > 4 || parsed.some((value) => value === null)) {
      this.malformed();
      return;
    }
    const point = [parsed[0], parsed[1], parsed[2]] as [number, number, number];
    this.validVertices += 1n;
    if (this.min === null || this.max === null) {
      this.min = [...point];
      this.max = [...point];
      return;
    }
    this.min = [
      Math.min(this.min[0], point[0]),
      Math.min(this.min[1], point[1]),
      Math.min(this.min[2], point[2]),
    ];
    this.max = [
      Math.max(this.max[0], point[0]),
      Math.max(this.max[1], point[1]),
      Math.max(this.max[2], point[2]),
    ];
  }

  private parseFace(corners: readonly string[]): void {
    if (corners.length < 3) {
      this.malformed();
      return;
    }
    const forms = corners.map((corner) => objFaceCornerForm(
      corner,
      this.validVertices,
      this.validTextures,
      this.validNormals,
    ));
    const form = forms[0];
    if (form === null || form === undefined || forms.some((candidate) => candidate !== form)) {
      this.malformed();
      return;
    }
    if (!this.arities.has(corners.length) && this.arities.size >= FOUNDRY_SOURCE_FACTS_OBJ_FACE_ARITY_MAX_COUNT) {
      this.failureCode = "OBJ_DECLARATION_LIMIT_EXCEEDED";
      return;
    }
    this.validFaces += 1n;
    this.validCorners += BigInt(corners.length);
    this.fanTriangles += BigInt(corners.length - 2);
    this.arities.set(corners.length, (this.arities.get(corners.length) ?? 0n) + 1n);
    this.faceForms[form] += 1n;
    for (const corner of corners) {
      for (const rawIndex of corner.split("/")) {
        if (rawIndex === "") continue;
        if (rawIndex.startsWith("-")) this.negativeFaceIndexReferences += 1n;
        else this.positiveFaceIndexReferences += 1n;
      }
    }
  }

  private lineContinuationIndex(): number | null {
    let index = this.lineBytes.length - 1;
    if (this.lineBytes[index] === 0x0d) index -= 1;
    if (index < 0 || this.lineBytes[index] !== 0x5c) return null;
    const commentIndex = this.lineBytes.indexOf(0x23);
    return commentIndex >= 0 && commentIndex < index ? null : index;
  }

  private consumeLineContinuation(): boolean {
    const index = this.lineContinuationIndex();
    if (index === null) return false;
    this.lineBytes.splice(index);
    this.lineBytes.push(0x20);
    return true;
  }
}

function littleEndianUint32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

function extension(relativePath: string): string {
  const name = relativePath.split("/").at(-1) ?? relativePath;
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot).toLowerCase();
}

function hasCandidate(detection: FoundryFileDetection, inputType: string): boolean {
  return detection.candidates.some((candidate) => candidate.inputType === inputType);
}

function baseIdentity(identity: UniversalSourceFactsReceiptFileIdentity): z.infer<typeof SourceIdentityBaseSchema> {
  return { path: identity.path, sizeBytes: identity.sizeBytes, sha256: identity.sha256 };
}

function inspection(
  state: "established" | "facts_not_established",
  category: z.infer<typeof InspectionSchema>["category"],
  code: string,
  coverage: z.infer<typeof InspectionSchema>["coverage"],
): z.infer<typeof InspectionSchema> {
  return InspectionSchema.parse({ state, category, code, coverage });
}

function e57Result(
  identity: UniversalSourceFactsReceiptFileIdentity,
  prefix: Uint8Array,
): UniversalSourceFactsFileResult {
  const source = {
    ...baseIdentity(identity),
    inputType: hasCandidate(identity.detection, "matterport_e57")
      ? "matterport_e57" as const
      : "generic_e57" as const,
  };
  if (identity.sizeBytes < E57_PHYSICAL_HEADER_BYTES || prefix.length < E57_PHYSICAL_HEADER_BYTES) {
    return UniversalSourceFactsFileResultSchema.parse({
      kind: "asset",
      asset: {
        source,
        format: "e57",
        inspection: inspection("facts_not_established", "parse_failure", "E57_PHYSICAL_HEADER_TRUNCATED", "none"),
        facts: null,
        unknowns: E57_UNKNOWNS,
      },
    });
  }
  try {
    const header = parseE57PhysicalHeader(prefix.subarray(0, E57_PHYSICAL_HEADER_BYTES), identity.sizeBytes);
    return UniversalSourceFactsFileResultSchema.parse({
      kind: "asset",
      asset: {
        source,
        format: "e57",
        inspection: inspection("established", "established", "E57_PHYSICAL_HEADER_ESTABLISHED", "physical_header"),
        facts: { signature: "ASTM-E57", ...header, aggregateMetadata: null },
        unknowns: E57_UNKNOWNS,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "";
    const code = message.includes("signature")
      ? "E57_SIGNATURE_NOT_ESTABLISHED"
      : message.includes("safe integer range")
        ? "E57_HEADER_VALUE_OUT_OF_RANGE"
        : "E57_PHYSICAL_HEADER_PARSE_FAILED";
    return UniversalSourceFactsFileResultSchema.parse({
      kind: "asset",
      asset: {
        source,
        format: "e57",
        inspection: inspection("facts_not_established", "parse_failure", code, "none"),
        facts: null,
        unknowns: E57_UNKNOWNS,
      },
    });
  }
}

function glbContainerFacts(
  prefix: Uint8Array,
  observedLength: number,
): z.infer<typeof GlbContainerFactsSchema> | null {
  if (prefix.length < GLB_JSON_OFFSET || littleEndianUint32(prefix, 0) !== GLB_MAGIC) return null;
  const chunkType = littleEndianUint32(prefix, 16);
  return GlbContainerFactsSchema.parse({
    magic: "glTF",
    version: littleEndianUint32(prefix, 4),
    declaredLengthBytes: littleEndianUint32(prefix, 8),
    observedLengthBytes: observedLength,
    fileLengthMatchesDeclaration: littleEndianUint32(prefix, 8) === observedLength,
    firstChunkLengthBytes: littleEndianUint32(prefix, 12),
    firstChunkTypeHex: chunkType.toString(16).padStart(8, "0"),
    firstChunkTypeIsJson: chunkType === GLB_JSON_CHUNK_TYPE,
  });
}

function glbResult(
  identity: UniversalSourceFactsReceiptFileIdentity,
  prefix: Uint8Array,
  jsonCapture: Uint8Array | null,
): UniversalSourceFactsFileResult {
  const source = { ...baseIdentity(identity), inputType: "glb_gltf" as const };
  const facts = { container: glbContainerFacts(prefix, identity.sizeBytes), json: null as z.infer<typeof GlbJsonFactsSchema> | null };
  const failure = (
    category: z.infer<typeof InspectionSchema>["category"],
    code: string,
    coverage: "none" | "container_header" = facts.container === null ? "none" : "container_header",
  ): UniversalSourceFactsFileResult => UniversalSourceFactsFileResultSchema.parse({
    kind: "asset",
    asset: {
      source,
      format: "glb",
      inspection: inspection("facts_not_established", category, code, coverage),
      facts,
      unknowns: GLB_UNKNOWNS,
    },
  });
  if (identity.sizeBytes < GLB_HEADER_BYTES || prefix.length < GLB_HEADER_BYTES) {
    return failure("parse_failure", "GLB_HEADER_TRUNCATED", "none");
  }
  if (littleEndianUint32(prefix, 0) !== GLB_MAGIC) return failure("parse_failure", "GLB_MAGIC_NOT_ESTABLISHED", "none");
  if (identity.sizeBytes < GLB_JSON_OFFSET || prefix.length < GLB_JSON_OFFSET || facts.container === null) {
    return failure("parse_failure", "GLB_JSON_CHUNK_HEADER_TRUNCATED", "none");
  }
  const jsonBytes = facts.container.firstChunkLengthBytes;
  if (!facts.container.firstChunkTypeIsJson) return failure("unsupported_container", "GLB_FIRST_CHUNK_IS_NOT_JSON");
  if (jsonBytes === 0) return failure("parse_failure", "GLB_JSON_CHUNK_EMPTY");
  if (jsonBytes > FOUNDRY_SOURCE_FACTS_GLB_JSON_MAX_BYTES) return failure("resource_limit", "GLB_JSON_CHUNK_LIMIT_EXCEEDED");
  if (GLB_JSON_OFFSET + jsonBytes > identity.sizeBytes || jsonCapture === null || jsonCapture.length < GLB_JSON_OFFSET + jsonBytes) {
    return failure("parse_failure", "GLB_JSON_CHUNK_OUT_OF_BOUNDS");
  }
  if (GLB_JSON_OFFSET + jsonBytes > facts.container.declaredLengthBytes) {
    return failure("parse_failure", "GLB_JSON_CHUNK_EXCEEDS_DECLARED_CONTAINER");
  }
  const encodedJson = jsonCapture.subarray(GLB_JSON_OFFSET, GLB_JSON_OFFSET + jsonBytes);
  if (encodedJson.at(-1) === 0x00) return failure("parse_failure", "GLB_JSON_PADDING_INVALID");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(encodedJson);
  } catch {
    return failure("parse_failure", "GLB_JSON_UTF8_INVALID");
  }
  while (text.endsWith(" ")) text = text.slice(0, -1);
  try {
    facts.json = extractGlbJsonFacts(new BoundedJsonParser(text).parse());
  } catch (error: unknown) {
    if (error instanceof JsonFactsError) return failure(error.category, error.code);
    return failure("parse_failure", "GLB_JSON_FACT_EXTRACTION_FAILED");
  }
  return UniversalSourceFactsFileResultSchema.parse({
    kind: "asset",
    asset: {
      source,
      format: "glb",
      inspection: inspection("established", "established", "GLB_CONTAINER_JSON_FACTS_ESTABLISHED", "container_header_and_json"),
      facts,
      unknowns: GLB_UNKNOWNS,
    },
  });
}

function objResult(
  identity: UniversalSourceFactsReceiptFileIdentity,
  parser: ObjStreamFactsParser,
): UniversalSourceFactsFileResult {
  const parsed = parser.finalize();
  return UniversalSourceFactsFileResultSchema.parse({
    kind: "asset",
    asset: {
      source: { ...baseIdentity(identity), inputType: "obj" },
      format: "obj",
      inspection: parsed.facts === null
        ? inspection(
            "facts_not_established",
            parsed.code === "OBJ_LOGICAL_LINE_LIMIT_EXCEEDED" || parsed.code === "OBJ_DECLARATION_LIMIT_EXCEEDED"
              ? "resource_limit"
              : "parse_failure",
            parsed.code,
            "none",
          )
        : inspection("established", "established", parsed.code, "complete_stream"),
      facts: parsed.facts,
      unknowns: OBJ_UNKNOWNS,
    },
  });
}

function sogResult(
  identity: UniversalSourceFactsReceiptFileIdentity,
  outcome: FoundrySogSourceFactsOutcome,
): UniversalSourceFactsFileResult {
  const source = { ...baseIdentity(identity), inputType: "sog" as const };
  if (outcome.state === "established") {
    return UniversalSourceFactsFileResultSchema.parse({
      kind: "asset",
      asset: {
        source,
        format: "sog",
        inspection: inspection(
          "established",
          "established",
          "SOG_V2_STORED_ZIP_FACTS_ESTABLISHED",
          "complete_container_structure",
        ),
        facts: outcome.facts,
        unknowns: SOG_UNKNOWNS,
      },
    });
  }
  const expectedCategory = FOUNDRY_SOG_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE[outcome.code];
  if (outcome.category === "cancelled" || outcome.code === "SOG_INSPECTION_CANCELLED") {
    throw new FoundryIntegrityError(
      "SOURCE_FACTS_SOG_INSPECTION_CANCELLED",
      "The read-only SOG Source Facts inspection was cancelled; no artifact was issued.",
    );
  }
  if (
    !FOUNDRY_SOG_SOURCE_FACTS_FAILURE_CODES.includes(outcome.code) ||
    expectedCategory !== outcome.category
  ) {
    throw new FoundryIntegrityError(
      "SOURCE_FACTS_SOG_OUTCOME_INVALID",
      "The bounded SOG Source Facts outcome is contradictory; no artifact was issued.",
    );
  }
  return UniversalSourceFactsFileResultSchema.parse({
    kind: "asset",
    asset: {
      source,
      format: "sog",
      inspection: inspection(
        "facts_not_established",
        outcome.category,
        outcome.code,
        "none",
      ),
      facts: null,
      unknowns: SOG_UNKNOWNS,
    },
  });
}

export interface UniversalSourceFactsFinalizeOptions {
  readonly sogInspection?: FoundrySogSourceFactsOutcome;
}

export interface UniversalSourceFactsStreamCollector {
  observe(chunk: Uint8Array, absoluteOffset: number): void;
  finalize(
    identity: UniversalSourceFactsReceiptFileIdentity,
    options?: UniversalSourceFactsFinalizeOptions,
  ): UniversalSourceFactsFileResult;
}

class UniversalSourceFactsStreamCollectorImpl implements UniversalSourceFactsStreamCollector {
  private readonly hash = createHash("sha256");
  private readonly prefix = new Uint8Array(E57_PHYSICAL_HEADER_BYTES);
  private readonly objParser: ObjStreamFactsParser | null;
  private prefixLength = 0;
  private observedBytes = 0;
  private glbCapture: Uint8Array | null = null;
  private glbCaptureLength = 0;
  private glbHeaderEvaluated = false;
  private finalized = false;

  constructor(private readonly relativePath: string) {
    this.relativePath = FoundryRelativePathSchema.parse(relativePath);
    this.objParser = extension(relativePath) === ".obj" ? new ObjStreamFactsParser() : null;
  }

  observe(chunkInput: Uint8Array, absoluteOffset: number): void {
    if (this.finalized) throw new FoundryIntegrityError("SOURCE_FACTS_COLLECTOR_FINALIZED", "Source Facts collector is already finalized.");
    if (!(chunkInput instanceof Uint8Array)) throw new FoundryIntegrityError("SOURCE_FACTS_INVALID_CHUNK", "Source Facts observer requires a byte chunk.");
    if (!Number.isSafeInteger(absoluteOffset) || absoluteOffset < 0 || absoluteOffset !== this.observedBytes) {
      throw new FoundryIntegrityError("SOURCE_FACTS_NONCONTIGUOUS_STREAM", "Source Facts byte chunks must be contiguous and start at offset zero.");
    }
    const chunk = chunkInput;
    if (chunk.length === 0) return;
    if (!Number.isSafeInteger(this.observedBytes + chunk.length)) {
      throw new FoundryIntegrityError("SOURCE_FACTS_SIZE_OUT_OF_RANGE", "Source Facts byte count exceeds the safe integer range.");
    }
    const end = this.observedBytes + chunk.length;
    this.hash.update(chunk);
    this.copyOverlap(chunk, this.observedBytes, this.prefix);
    this.prefixLength = Math.min(this.prefix.length, end);
    if (!this.glbHeaderEvaluated && this.prefixLength >= GLB_JSON_OFFSET) {
      this.glbHeaderEvaluated = true;
      if (littleEndianUint32(this.prefix, 0) === GLB_MAGIC) {
        const jsonBytes = littleEndianUint32(this.prefix, 12);
        if (jsonBytes <= FOUNDRY_SOURCE_FACTS_GLB_JSON_MAX_BYTES) {
          this.glbCaptureLength = GLB_JSON_OFFSET + jsonBytes;
          this.glbCapture = new Uint8Array(this.glbCaptureLength);
          this.glbCapture.set(this.prefix.subarray(0, Math.min(this.prefixLength, this.glbCaptureLength)));
        }
      }
    }
    if (this.glbCapture !== null) this.copyOverlap(chunk, this.observedBytes, this.glbCapture);
    this.objParser?.observe(chunk);
    this.observedBytes = end;
  }

  finalize(
    identityInput: UniversalSourceFactsReceiptFileIdentity,
    options: UniversalSourceFactsFinalizeOptions = {},
  ): UniversalSourceFactsFileResult {
    if (this.finalized) throw new FoundryIntegrityError("SOURCE_FACTS_COLLECTOR_FINALIZED", "Source Facts collector is already finalized.");
    this.finalized = true;
    const identity = UniversalSourceFactsReceiptFileIdentitySchema.parse(identityInput);
    if (identity.path !== this.relativePath) throw new FoundryIntegrityError("SOURCE_FACTS_PATH_MISMATCH", "Source Facts collector path does not match the receipt identity.");
    if (identity.sizeBytes !== this.observedBytes) throw new FoundryIntegrityError("SOURCE_FACTS_SIZE_MISMATCH", "Source Facts byte count does not match the receipt identity.");
    const observedSha256 = this.hash.digest("hex");
    if (observedSha256 !== identity.sha256) throw new FoundryIntegrityError("SOURCE_FACTS_SHA256_MISMATCH", "Source Facts byte stream does not match the receipt SHA-256.");
    if (hasCandidate(identity.detection, "xgrids_xbin")) {
      return UniversalSourceFactsFileResultSchema.parse({
        kind: "xbin_block",
        source: { ...baseIdentity(identity), inputType: "xgrids_xbin" },
      });
    }
    const prefix = this.prefix.subarray(0, this.prefixLength);
    const glbMagic = prefix.length >= 4 && littleEndianUint32(prefix, 0) === GLB_MAGIC;
    const e57Magic = prefix.length >= 8 && Buffer.from(prefix.subarray(0, 8)).toString("ascii") === "ASTM-E57";
    const sogTarget = hasCandidate(identity.detection, "sog") || extension(identity.path) === ".sog";
    const inspectAsSog = sogTarget && !e57Magic && !glbMagic;
    if (options.sogInspection !== undefined && !inspectAsSog) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_UNEXPECTED_SOG_INSPECTION",
        "A bounded SOG inspection was supplied for a non-SOG Source Facts target.",
      );
    }
    if (e57Magic) {
      return e57Result(identity, prefix);
    }
    if (glbMagic) {
      return glbResult(identity, prefix, this.glbCapture);
    }
    if (inspectAsSog) {
      if (options.sogInspection === undefined) {
        throw new FoundryIntegrityError(
          "SOURCE_FACTS_SOG_INSPECTION_REQUIRED",
          "SOG Source Facts require bounded random-access inspection on the identity-bound open handle.",
        );
      }
      if (
        options.sogInspection.sourceSizeBytes !== this.observedBytes ||
        options.sogInspection.sourceSha256 !== observedSha256
      ) {
        throw new FoundryIntegrityError(
          "SOURCE_FACTS_SOG_INSPECTION_SOURCE_MISMATCH",
          "The bounded SOG inspection does not match the receipt-bound Source Facts byte stream.",
        );
      }
      return sogResult(identity, options.sogInspection);
    }
    if (hasCandidate(identity.detection, "generic_e57") || hasCandidate(identity.detection, "matterport_e57") || extension(identity.path) === ".e57") {
      return e57Result(identity, prefix);
    }
    if (hasCandidate(identity.detection, "glb_gltf") && extension(identity.path) !== ".gltf") {
      return glbResult(identity, prefix, this.glbCapture);
    }
    if (hasCandidate(identity.detection, "glb_gltf") && extension(identity.path) === ".gltf") {
      return UniversalSourceFactsFileResultSchema.parse({
        kind: "asset",
        asset: {
          source: { ...baseIdentity(identity), inputType: "glb_gltf" },
          format: "gltf_json",
          inspection: inspection("facts_not_established", "unsupported_variant", "GLTF_JSON_VARIANT_UNSUPPORTED", "none"),
          facts: null,
          unknowns: GLB_UNKNOWNS,
        },
      });
    }
    if (this.objParser !== null && (hasCandidate(identity.detection, "obj") || extension(identity.path) === ".obj")) {
      return objResult(identity, this.objParser);
    }
    return UniversalSourceFactsFileResultSchema.parse({ kind: "untargeted", source: baseIdentity(identity) });
  }

  private copyOverlap(chunk: Uint8Array, absoluteOffset: number, target: Uint8Array): void {
    const start = Math.max(absoluteOffset, 0);
    const end = Math.min(absoluteOffset + chunk.length, target.length);
    if (start >= end) return;
    target.set(chunk.subarray(start - absoluteOffset, end - absoluteOffset), start);
  }
}

export function createUniversalSourceFactsStreamCollector(
  relativePath: string,
): UniversalSourceFactsStreamCollector {
  return new UniversalSourceFactsStreamCollectorImpl(relativePath);
}

const E57_DEEP_METADATA_UNKNOWN_CODES = new Set([
  "E57_SCAN_COUNT_UNKNOWN",
  "E57_POINT_COUNT_UNKNOWN",
  "E57_IMAGE_COUNT_UNKNOWN",
]);

/**
 * Immutably associates a separately produced, bounded pye57 metadata aggregate
 * with an already SHA-256-bound E57 result and checks its reported byte size.
 * The artifact digest binds that association, but this helper cannot prove the
 * earlier probe read the same digest because the probe does not report one.
 * Callers must provide the required handle/TOCTOU controls. This helper does no I/O.
 */
export function withUniversalSourceFactsE57Aggregate(
  resultInput: UniversalSourceFactsFileResult,
  aggregateInput: E57AggregateMetadata,
): UniversalSourceFactsFileResult {
  const result = UniversalSourceFactsFileResultSchema.parse(resultInput);
  const aggregate = E57AggregateMetadataSchema.parse(aggregateInput);
  if (result.kind !== "asset" || result.asset.format !== "e57" || result.asset.facts === null) {
    throw new FoundryIntegrityError(
      "SOURCE_FACTS_E57_AGGREGATE_TARGET_INVALID",
      "E57 aggregate metadata can only attach to established E57 physical-header facts.",
    );
  }
  if (aggregate.file.byteSize !== result.asset.source.sizeBytes) {
    throw new FoundryIntegrityError(
      "SOURCE_FACTS_E57_AGGREGATE_SIZE_MISMATCH",
      "E57 aggregate metadata byte size does not match the receipt-bound source.",
    );
  }
  return UniversalSourceFactsFileResultSchema.parse({
    kind: "asset",
    asset: {
      ...result.asset,
      facts: { ...result.asset.facts, aggregateMetadata: aggregate },
      unknowns: result.asset.unknowns.filter(
        (item: z.infer<typeof UnknownFactSchema>) => !E57_DEEP_METADATA_UNKNOWN_CODES.has(item.code),
      ),
    },
  });
}

function resultSource(result: UniversalSourceFactsFileResult): z.infer<typeof SourceIdentityBaseSchema> {
  return result.kind === "asset" ? result.asset.source : result.source;
}

function usesE57MetadataProbe(assets: readonly UniversalSourceFactsAsset[]): boolean {
  return assets.some((asset) =>
    asset.format === "e57" && asset.facts?.aggregateMetadata !== null && asset.facts?.aggregateMetadata !== undefined
  );
}

function policyForAssets(assets: readonly UniversalSourceFactsAsset[]): z.infer<typeof PolicySchema> {
  const metadataProbe = usesE57MetadataProbe(assets) ? "local_pye57_read_only" as const : "none" as const;
  return PolicySchema.parse({
    sourceAccess: "read_only",
    mutation: "none",
    reconstruction: "none",
    networkAccess: "none",
    externalProcess: metadataProbe,
    metadataProbe,
    authority: "none",
    rights: "not_evaluated",
  });
}

const SOURCE_FACT_LIMITS: z.infer<typeof LimitsSchema> = {
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
};

type ArtifactPayload = ArtifactWithoutValidation extends infer Artifact
  ? Artifact extends ArtifactWithoutValidation
    ? Omit<Artifact, "factsSha256">
    : never
  : never;

function issueArtifact(
  payload: ArtifactPayload,
): FoundryUniversalSourceFacts {
  const candidate = { ...payload, factsSha256: "0".repeat(64) } as ArtifactWithoutValidation;
  const issued = { ...payload, factsSha256: artifactDigest(candidate) };
  return FoundryUniversalSourceFactsSchema.parse(issued);
}

function uniqueSortedResults(
  resultInputs: readonly UniversalSourceFactsFileResult[],
): UniversalSourceFactsFileResult[] {
  if (resultInputs.length > FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES) {
    throw new FoundryIntegrityError("SOURCE_FACTS_FILE_COUNT_LIMIT", "Source Facts results exceed the receipt file-count limit.");
  }
  const results = resultInputs.map((result) => UniversalSourceFactsFileResultSchema.parse(result));
  results.sort((left, right) => compareText(resultSource(left).path, resultSource(right).path));
  const paths = results.map((result) => resultSource(result).path);
  if (new Set(paths).size !== paths.length) {
    throw new FoundryIntegrityError("SOURCE_FACTS_DUPLICATE_RESULT_PATH", "Source Facts results must have unique receipt paths.");
  }
  return results;
}

function unavailableArtifact(
  receiptSha256: string,
  receiptFileCount: number,
  affectedSourcesInput: readonly z.infer<typeof BlockedSourceSchema>[],
): FoundryUniversalSourceFacts {
  const affectedSources = affectedSourcesInput
    .map((source) => BlockedSourceSchema.parse(source))
    .sort((left, right) => compareText(left.path, right.path));
  return issueArtifact({
    schemaVersion: FOUNDRY_UNIVERSAL_SOURCE_FACTS_V1,
    receiptSha256,
    state: "unavailable" as const,
    policy: policyForAssets([]),
    limitations: [
      FOUNDRY_SOURCE_FACTS_LIMITATIONS[0],
      FOUNDRY_SOURCE_FACTS_LIMITATIONS[1],
      FOUNDRY_SOURCE_FACTS_LIMITATIONS[2],
    ],
    limits: SOURCE_FACT_LIMITS,
    summary: {
      receiptFileCount,
      assetCount: 0,
      establishedCount: 0,
      factsNotEstablishedCount: 0,
      untargetedFileCount: receiptFileCount - affectedSources.length,
      blockedSourceCount: affectedSources.length,
    },
    assets: [] as [],
    affectedSources,
    reason: {
      code: "XGRIDS_XBIN_UNSUPPORTED" as const,
      message: "Universal Source Facts are unavailable because the receipt includes an unsupported XGRIDS XBIN candidate." as const,
      nextAction: FOUNDRY_XBIN_OFFICIAL_EXPORT_NEXT_ACTION,
    },
  });
}

function availableArtifact(
  receiptSha256: string,
  receiptFileCount: number,
  results: readonly UniversalSourceFactsFileResult[],
): FoundryUniversalSourceFacts {
  const assets = results
    .filter((result): result is Extract<UniversalSourceFactsFileResult, { readonly kind: "asset" }> => result.kind === "asset")
    .map((result) => result.asset)
    .sort((left, right) => compareText(left.source.path, right.source.path));
  return issueArtifact({
    schemaVersion: FOUNDRY_UNIVERSAL_SOURCE_FACTS_V1,
    receiptSha256,
    state: "available" as const,
    policy: policyForAssets(assets),
    limitations: [
      FOUNDRY_SOURCE_FACTS_LIMITATIONS[0],
      FOUNDRY_SOURCE_FACTS_LIMITATIONS[1],
      FOUNDRY_SOURCE_FACTS_LIMITATIONS[2],
    ],
    limits: SOURCE_FACT_LIMITS,
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

/** Builds an artifact from already finalized per-file stream results. */
export function createUniversalSourceFactsArtifact(
  receiptSha256Input: string,
  resultInputs: readonly UniversalSourceFactsFileResult[],
): FoundryUniversalSourceFacts {
  const receiptSha256 = z.string().regex(SHA256_HEX).parse(receiptSha256Input);
  const results = uniqueSortedResults(resultInputs);
  const blocked = results
    .filter((result): result is Extract<UniversalSourceFactsFileResult, { readonly kind: "xbin_block" }> => result.kind === "xbin_block")
    .map((result) => result.source);
  return blocked.length > 0
    ? unavailableArtifact(receiptSha256, results.length, blocked)
    : availableArtifact(receiptSha256, results.length, results);
}

/**
 * Receipt-first builder. XBIN candidates are rejected before results are read,
 * so callers can guarantee zero E57/GLB/OBJ/SOG parser invocation on that path.
 */
export function createUniversalSourceFactsArtifactFromReceipt(
  receiptSha256Input: string,
  identityInputs: readonly UniversalSourceFactsReceiptFileIdentity[],
  resultInputs: readonly UniversalSourceFactsFileResult[] = [],
): FoundryUniversalSourceFacts {
  const receiptSha256 = z.string().regex(SHA256_HEX).parse(receiptSha256Input);
  if (identityInputs.length > FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES) {
    throw new FoundryIntegrityError("SOURCE_FACTS_FILE_COUNT_LIMIT", "Source Facts receipt identities exceed the file-count limit.");
  }
  const identities = identityInputs
    .map((identity) => UniversalSourceFactsReceiptFileIdentitySchema.parse(identity))
    .sort((left, right) => compareText(left.path, right.path));
  const identityPaths = identities.map((identity) => identity.path);
  if (new Set(identityPaths).size !== identityPaths.length) {
    throw new FoundryIntegrityError("SOURCE_FACTS_DUPLICATE_RECEIPT_PATH", "Source Facts receipt identities must have unique paths.");
  }
  const blocked = identities
    .filter((identity) => hasCandidate(identity.detection, "xgrids_xbin"))
    .map((identity) => ({ ...baseIdentity(identity), inputType: "xgrids_xbin" as const }));
  if (blocked.length > 0) return unavailableArtifact(receiptSha256, identities.length, blocked);

  const results = uniqueSortedResults(resultInputs);
  if (results.length !== identities.length) {
    throw new FoundryIntegrityError("SOURCE_FACTS_RESULT_SET_INCOMPLETE", "Available Source Facts require one finalized result per receipt file.");
  }
  for (const [index, identity] of identities.entries()) {
    const result = results[index];
    if (result === undefined) throw new FoundryIntegrityError("SOURCE_FACTS_RESULT_SET_INCOMPLETE", "Source Facts result is missing.");
    const source = resultSource(result);
    if (source.path !== identity.path || source.sizeBytes !== identity.sizeBytes || source.sha256 !== identity.sha256) {
      throw new FoundryIntegrityError("SOURCE_FACTS_RESULT_IDENTITY_MISMATCH", "Source Facts result does not match its receipt identity.");
    }
    if (result.kind === "xbin_block") {
      throw new FoundryIntegrityError("SOURCE_FACTS_UNEXPECTED_XBIN_RESULT", "XBIN result was not declared by the receipt detection.");
    }
  }
  return availableArtifact(receiptSha256, identities.length, results);
}

/** Returns the exact canonical JSON whose payload (minus factsSha256) is digested. */
export function serializeUniversalSourceFactsArtifact(value: FoundryUniversalSourceFacts): string {
  return stableCanonicalJson(toCanonicalJson(FoundryUniversalSourceFactsSchema.parse(value)));
}
