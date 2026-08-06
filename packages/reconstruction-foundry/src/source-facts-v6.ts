import { createHash } from "node:crypto";
import { FoundryRelativePathSchema } from "@omnitwin/types";
import { z } from "zod";
import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "./canonical-json.js";
import { FoundryIntegrityError } from "./errors.js";
import {
  FOUNDRY_GAUSSIAN_PLY_REQUIRED_FLOAT32_PROPERTY_NAMES,
} from "./gaussian-ply-source-facts.js";
import {
  FOUNDRY_POINT_PLY_COMMENT_MAX_COUNT,
  FOUNDRY_POINT_PLY_ELEMENT_MAX_COUNT,
  FOUNDRY_POINT_PLY_HEADER_LINE_MAX_BYTES,
  FOUNDRY_POINT_PLY_HEADER_MAX_BYTES,
  FOUNDRY_POINT_PLY_PROPERTY_MAX_COUNT,
  FOUNDRY_POINT_PLY_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE,
  FOUNDRY_POINT_PLY_SOURCE_FACTS_FAILURE_CODES,
  FOUNDRY_POINT_PLY_SOURCE_FACTS_LIMITATIONS,
  FOUNDRY_POINT_PLY_SOURCE_MAX_BYTES,
  FOUNDRY_POINT_PLY_VERTEX_MAX_COUNT,
  FOUNDRY_POINT_PLY_VERTEX_STRIDE_MAX_BYTES,
  type FoundryPlyPointCloudScalarCanonicalType,
  type FoundryPlyPointCloudScalarDeclaredType,
  type FoundryPlyPointCloudSourceFactsOutcome,
} from "./ply-point-cloud-source-facts.js";
import {
  FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES,
  FOUNDRY_XBIN_OFFICIAL_EXPORT_NEXT_ACTION,
  type UniversalSourceFactsReceiptFileIdentity,
} from "./source-facts.js";
import {
  FOUNDRY_SOURCE_FACTS_V5_LIMITATIONS,
  FOUNDRY_UNIVERSAL_SOURCE_FACTS_V5,
  UniversalSourceFactsV5AssetSchema,
  UniversalSourceFactsV5FileResultSchema,
  UniversalSourceFactsV5ReceiptFileIdentitySchema,
  createUniversalSourceFactsV5ArtifactFromReceipt,
  createUniversalSourceFactsV5StreamCollector,
  type UniversalSourceFactsV5Asset,
  type UniversalSourceFactsV5FileResult,
  type UniversalSourceFactsV5FinalizeOptions,
  type UniversalSourceFactsV5ReceiptFileIdentity,
} from "./source-facts-v5.js";

export const FOUNDRY_UNIVERSAL_SOURCE_FACTS_V6 =
  "omnitwin.foundry.universal-source-facts.v6";
export const FOUNDRY_UNIVERSAL_SOURCE_FACTS_V6_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_UNIVERSAL_SOURCE_FACTS_V6";
export const FOUNDRY_SOURCE_FACTS_V6_LIMITATIONS = Object.freeze([
  ...FOUNDRY_SOURCE_FACTS_V5_LIMITATIONS,
  "POINT_PLY_STRUCTURE_DOES_NOT_DECODE_VALUES_OR_ESTABLISH_SEMANTICS",
] as const);

const SHA256_HEX = /^[a-f0-9]{64}$/u;
const STABLE_CODE = /^[A-Z][A-Z0-9_]{2,95}$/u;
const PLY_NAME = /^[\x21-\x7e]+$/u;

export const UniversalSourceFactsV6ReceiptFileIdentitySchema =
  UniversalSourceFactsV5ReceiptFileIdentitySchema;
export type UniversalSourceFactsV6ReceiptFileIdentity =
  UniversalSourceFactsV5ReceiptFileIdentity;

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
  return Object.freeze(UnknownFactSchema.parse({
    code,
    label,
    reason,
    decisiveNextTest,
  }));
}

export const FOUNDRY_POINT_PLY_UNKNOWNS = Object.freeze([
  unknownFact(
    "POINT_PLY_ATTRIBUTE_VALUES_UNKNOWN",
    "Decoded point attributes",
    "Exact fixed-width layout verification does not decode or validate any coordinate, normal, color, intensity, timestamp, classification, or vendor attribute value.",
    "Run a separately reviewed bounded decoder against this exact SHA-256 and record finite-value, range, byte, point-count, and cancellation limits.",
  ),
  unknownFact(
    "POINT_PLY_PROPERTY_SEMANTICS_UNKNOWN",
    "Property semantics",
    "PLY property names and scalar types do not establish what declared fields mean; x, y, and z are structural names rather than an authoritative semantic declaration.",
    "Bind this exact source digest to a versioned producer specification defining every property, encoding, transform, and null or sentinel convention.",
  ),
  unknownFact(
    "POINT_PLY_PHYSICAL_BOUNDS_AND_COMPLETENESS_UNKNOWN",
    "Physical bounds and completeness",
    "Header and payload layout do not establish decoded spatial bounds, density, occlusion, clipping, duplicate points, missing regions, or capture completeness.",
    "Decode under frozen limits, compute digest-bound bounds and density diagnostics, and compare coverage with an independently scoped capture manifest.",
  ),
  unknownFact(
    "POINT_PLY_UNITS_AND_SCALE_UNKNOWN",
    "Units and scale",
    "The supported PLY profile contains no authoritative declaration of physical units, scale, or whether coordinates are metric.",
    "Obtain a digest-bound unit declaration and verify at least one independently controlled physical dimension before assigning scale.",
  ),
  unknownFact(
    "POINT_PLY_FRAME_CRS_AND_AXIS_UNKNOWN",
    "Frame, CRS, and axis convention",
    "The source does not establish origin, handedness, up axis, coordinate reference system, datum, or a transform into the venue frame.",
    "Obtain an authoritative frame declaration and independently reviewed control transform bound to this exact digest.",
  ),
  unknownFact(
    "POINT_PLY_GEOMETRY_ROLE_UNKNOWN",
    "Geometry role",
    "A vertex-only scalar PLY layout does not prove whether records are captured samples, reconstructed points, derived vertices, landmarks, a preview, or another geometry role.",
    "Obtain a digest-bound lineage record naming the producing workflow, source role, derivation stage, and intended downstream use.",
  ),
  unknownFact(
    "POINT_PLY_ACCURACY_AND_UNCERTAINTY_UNKNOWN",
    "Accuracy and uncertainty",
    "Structural inspection does not establish measurement accuracy, precision, covariance, drift, noise, or fitness for survey, fabrication, or safety-critical use.",
    "Compare decoded positions with independent survey control and frozen blind acceptance limits, including uncertainty treatment and outlier policy.",
  ),
  unknownFact(
    "POINT_PLY_REGISTRATION_UNKNOWN",
    "Registration quality",
    "The source does not establish alignment to sibling captures or a venue frame, nor residuals, holdouts, or independent registration validation.",
    "Evaluate a digest-bound transform against independent control with declared residual, holdout, and reviewer requirements.",
  ),
  unknownFact(
    "POINT_PLY_PROVENANCE_AND_CAPTURE_CLASS_UNKNOWN",
    "Provenance and capture class",
    "The PLY container does not establish the device, capture session, software, source observations, transformations, export settings, or whether it is captured or derived evidence.",
    "Obtain a digest-bound lineage manifest naming every material parent digest, producer, capture session, transformation, and export step.",
  ),
  unknownFact(
    "POINT_PLY_RIGHTS_UNKNOWN",
    "Usage rights",
    "Read-only structural inspection does not evaluate ownership, privacy, commercial use, derivative-output, model-training, or redistribution rights.",
    "Obtain an authorized purpose-scoped rights decision bound to this exact SHA-256.",
  ),
] as const);

const ScalarDeclaredTypeSchema = z.enum([
  "char", "int8", "uchar", "uint8", "short", "int16", "ushort", "uint16",
  "int", "int32", "uint", "uint32", "float", "float32", "double", "float64",
]);
const ScalarCanonicalTypeSchema = z.enum([
  "int8", "uint8", "int16", "uint16", "int32", "uint32", "float32", "float64",
]);

const SCALAR_TYPE_FACTS: Readonly<Record<
  FoundryPlyPointCloudScalarDeclaredType,
  { readonly canonicalType: FoundryPlyPointCloudScalarCanonicalType; readonly byteWidth: 1 | 2 | 4 | 8 }
>> = Object.freeze({
  char: { canonicalType: "int8", byteWidth: 1 },
  int8: { canonicalType: "int8", byteWidth: 1 },
  uchar: { canonicalType: "uint8", byteWidth: 1 },
  uint8: { canonicalType: "uint8", byteWidth: 1 },
  short: { canonicalType: "int16", byteWidth: 2 },
  int16: { canonicalType: "int16", byteWidth: 2 },
  ushort: { canonicalType: "uint16", byteWidth: 2 },
  uint16: { canonicalType: "uint16", byteWidth: 2 },
  int: { canonicalType: "int32", byteWidth: 4 },
  int32: { canonicalType: "int32", byteWidth: 4 },
  uint: { canonicalType: "uint32", byteWidth: 4 },
  uint32: { canonicalType: "uint32", byteWidth: 4 },
  float: { canonicalType: "float32", byteWidth: 4 },
  float32: { canonicalType: "float32", byteWidth: 4 },
  double: { canonicalType: "float64", byteWidth: 8 },
  float64: { canonicalType: "float64", byteWidth: 8 },
});

const PointPropertyFactsSchema = z.object({
  ordinal: z.number().int().min(0).max(FOUNDRY_POINT_PLY_PROPERTY_MAX_COUNT - 1),
  name: z.string().regex(PLY_NAME).max(FOUNDRY_POINT_PLY_HEADER_LINE_MAX_BYTES),
  declaredType: ScalarDeclaredTypeSchema,
  canonicalType: ScalarCanonicalTypeSchema,
  byteOffset: z.number().int().min(0).max(FOUNDRY_POINT_PLY_VERTEX_STRIDE_MAX_BYTES),
  byteWidth: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(8)]),
}).strict().superRefine((property, ctx) => {
  const expected = SCALAR_TYPE_FACTS[property.declaredType];
  if (
    property.canonicalType !== expected.canonicalType ||
    property.byteWidth !== expected.byteWidth
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "point PLY scalar aliases must map to their frozen canonical type and width",
    });
  }
  if (
    `property ${property.declaredType} ${property.name}`.length >
      FOUNDRY_POINT_PLY_HEADER_LINE_MAX_BYTES
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["name"],
      message: "point PLY property declaration exceeds the header-line byte limit",
    });
  }
});

const PointLimitationsSchema = z.tuple([
  z.literal(FOUNDRY_POINT_PLY_SOURCE_FACTS_LIMITATIONS[0]),
  z.literal(FOUNDRY_POINT_PLY_SOURCE_FACTS_LIMITATIONS[1]),
  z.literal(FOUNDRY_POINT_PLY_SOURCE_FACTS_LIMITATIONS[2]),
  z.literal(FOUNDRY_POINT_PLY_SOURCE_FACTS_LIMITATIONS[3]),
  z.literal(FOUNDRY_POINT_PLY_SOURCE_FACTS_LIMITATIONS[4]),
]);

function minimumPointPlyHeaderBytes(facts: {
  readonly header: {
    readonly lineEndings: "lf" | "crlf" | "mixed";
    readonly comments: { readonly count: number };
    readonly objInfo: { readonly count: number };
  };
  readonly vertices: {
    readonly count: number;
    readonly properties: readonly {
      readonly declaredType: FoundryPlyPointCloudScalarDeclaredType;
      readonly name: string;
    }[];
  };
}): number {
  const declarationBytes =
    "ply".length +
    "format binary_little_endian 1.0".length +
    `element vertex ${String(facts.vertices.count)}`.length +
    facts.vertices.properties.reduce(
      (total, property) =>
        total + `property ${property.declaredType} ${property.name}`.length,
      0,
    ) +
    facts.header.comments.count * "comment".length +
    facts.header.objInfo.count * "obj_info".length +
    "end_header".length;
  const lineCount =
    4 +
    facts.vertices.properties.length +
    facts.header.comments.count +
    facts.header.objInfo.count;
  const lineEndingBytes = facts.header.lineEndings === "crlf"
    ? lineCount * 2
    : facts.header.lineEndings === "mixed"
      ? lineCount + 1
      : lineCount;
  return declarationBytes + lineEndingBytes;
}

function maximumPointPlyHeaderBytes(facts: {
  readonly header: {
    readonly lineEndings: "lf" | "crlf" | "mixed";
    readonly comments: { readonly count: number };
    readonly objInfo: { readonly count: number };
  };
  readonly vertices: {
    readonly properties: readonly unknown[];
  };
}): number {
  const declarationLineCount =
    2 +
    facts.vertices.properties.length +
    facts.header.comments.count +
    facts.header.objInfo.count;
  const lineCount = declarationLineCount + 2;
  const contentBytes =
    "ply".length +
    "end_header".length +
    declarationLineCount * FOUNDRY_POINT_PLY_HEADER_LINE_MAX_BYTES;
  const lineEndingBytes = facts.header.lineEndings === "lf"
    ? lineCount
    : facts.header.lineEndings === "crlf"
      ? lineCount * 2
      : lineCount * 2 - 1;
  return Math.min(
    FOUNDRY_POINT_PLY_HEADER_MAX_BYTES,
    contentBytes + lineEndingBytes,
  );
}

export const FoundryPlyPointCloudFactsV6Schema = z.object({
  format: z.literal("ply_binary_little_endian"),
  profile: z.literal("ordinary_point_geometry_fixed_width_scalar"),
  inspectionCoverage: z.literal(
    "complete_header_and_exact_fixed_width_payload_layout",
  ),
  plyVersion: z.literal("1.0"),
  header: z.object({
    bytes: z.number().int().positive().max(FOUNDRY_POINT_PLY_HEADER_MAX_BYTES),
    lineEndings: z.enum(["lf", "crlf", "mixed"]),
    comments: z.object({
      count: z.number().int().min(0).max(FOUNDRY_POINT_PLY_COMMENT_MAX_COUNT),
      retainedVerbatim: z.literal(false),
      authoritative: z.literal(false),
    }).strict(),
    objInfo: z.object({
      count: z.number().int().min(0).max(FOUNDRY_POINT_PLY_COMMENT_MAX_COUNT),
      retainedVerbatim: z.literal(false),
      authoritative: z.literal(false),
    }).strict(),
  }).strict(),
  vertices: z.object({
    count: z.number().int().min(1).max(FOUNDRY_POINT_PLY_VERTEX_MAX_COUNT),
    recordStrideBytes: z.number().int().positive().max(
      FOUNDRY_POINT_PLY_VERTEX_STRIDE_MAX_BYTES,
    ),
    payloadBytes: z.number().int().safe().positive().max(FOUNDRY_POINT_PLY_SOURCE_MAX_BYTES),
    properties: z.array(PointPropertyFactsSchema).min(3).max(
      FOUNDRY_POINT_PLY_PROPERTY_MAX_COUNT,
    ),
    requiredCoordinateProperties: z.object({
      names: z.tuple([z.literal("x"), z.literal("y"), z.literal("z")]),
      ordinals: z.tuple([
        z.number().int().min(0).max(FOUNDRY_POINT_PLY_PROPERTY_MAX_COUNT - 1),
        z.number().int().min(0).max(FOUNDRY_POINT_PLY_PROPERTY_MAX_COUNT - 1),
        z.number().int().min(0).max(FOUNDRY_POINT_PLY_PROPERTY_MAX_COUNT - 1),
      ]),
      byteOffsets: z.tuple([
        z.number().int().min(0).max(FOUNDRY_POINT_PLY_VERTEX_STRIDE_MAX_BYTES),
        z.number().int().min(0).max(FOUNDRY_POINT_PLY_VERTEX_STRIDE_MAX_BYTES),
        z.number().int().min(0).max(FOUNDRY_POINT_PLY_VERTEX_STRIDE_MAX_BYTES),
      ]),
      canonicalTypes: z.tuple([
        ScalarCanonicalTypeSchema,
        ScalarCanonicalTypeSchema,
        ScalarCanonicalTypeSchema,
      ]),
    }).strict(),
    additionalProperties: z.object({
      count: z.number().int().min(0).max(FOUNDRY_POINT_PLY_PROPERTY_MAX_COUNT - 3),
      names: z.array(z.string().regex(PLY_NAME).max(
        FOUNDRY_POINT_PLY_HEADER_LINE_MAX_BYTES,
      )).max(FOUNDRY_POINT_PLY_PROPERTY_MAX_COUNT - 3),
    }).strict(),
  }).strict(),
  container: z.object({
    sourceSizeBytes: z.number().int().safe().positive().max(FOUNDRY_POINT_PLY_SOURCE_MAX_BYTES),
    headerBytes: z.number().int().positive().max(FOUNDRY_POINT_PLY_HEADER_MAX_BYTES),
    payloadOffsetBytes: z.number().int().positive().max(FOUNDRY_POINT_PLY_HEADER_MAX_BYTES),
    payloadBytes: z.number().int().safe().positive().max(FOUNDRY_POINT_PLY_SOURCE_MAX_BYTES),
    exactFileLengthVerified: z.literal(true),
    trailingBytes: z.literal(0),
  }).strict(),
  limitations: PointLimitationsSchema,
}).strict().superRefine((facts, ctx) => {
  if (
    facts.header.comments.count + facts.header.objInfo.count >
      FOUNDRY_POINT_PLY_COMMENT_MAX_COUNT
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["header"],
      message: "point PLY comment and obj_info counts exceed the shared declaration limit",
    });
  }
  let nextOffset = 0;
  const names = new Set<string>();
  for (const [index, property] of facts.vertices.properties.entries()) {
    if (
      property.ordinal !== index ||
      property.byteOffset !== nextOffset ||
      names.has(property.name)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["vertices", "properties", index],
        message: "point PLY properties must be unique, ordinal, and contiguous",
      });
    }
    names.add(property.name);
    nextOffset += property.byteWidth;
  }
  if (nextOffset !== facts.vertices.recordStrideBytes) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["vertices", "recordStrideBytes"],
      message: "point PLY stride must equal the exact scalar-property width sum",
    });
  }
  if (
    FOUNDRY_GAUSSIAN_PLY_REQUIRED_FLOAT32_PROPERTY_NAMES.every(
      (name) => names.has(name),
    )
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["vertices", "properties"],
      message: "classic Gaussian PLY property families are excluded from the ordinary point profile",
    });
  }
  const coordinates = ["x", "y", "z"].map((name) =>
    facts.vertices.properties.find((property) => property.name === name)
  );
  if (coordinates.some((property) => property === undefined)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["vertices", "requiredCoordinateProperties"],
      message: "point PLY facts require unique x, y, and z properties",
    });
  } else {
    const present = coordinates as [
      z.infer<typeof PointPropertyFactsSchema>,
      z.infer<typeof PointPropertyFactsSchema>,
      z.infer<typeof PointPropertyFactsSchema>,
    ];
    if (
      JSON.stringify(facts.vertices.requiredCoordinateProperties.ordinals) !==
        JSON.stringify(present.map((property) => property.ordinal)) ||
      JSON.stringify(facts.vertices.requiredCoordinateProperties.byteOffsets) !==
        JSON.stringify(present.map((property) => property.byteOffset)) ||
      JSON.stringify(facts.vertices.requiredCoordinateProperties.canonicalTypes) !==
        JSON.stringify(present.map((property) => property.canonicalType))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["vertices", "requiredCoordinateProperties"],
        message: "point PLY coordinate facts must match the declared property layout",
      });
    }
  }
  const additionalNames = facts.vertices.properties
    .filter((property) => !["x", "y", "z"].includes(property.name))
    .map((property) => property.name);
  if (
    facts.vertices.additionalProperties.count !== additionalNames.length ||
    JSON.stringify(facts.vertices.additionalProperties.names) !==
      JSON.stringify(additionalNames)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["vertices", "additionalProperties"],
      message: "point PLY additional properties must match declaration order exactly",
    });
  }
  const payload = BigInt(facts.vertices.count) *
    BigInt(facts.vertices.recordStrideBytes);
  const minimumHeaderBytes = minimumPointPlyHeaderBytes(facts);
  const maximumHeaderBytes = maximumPointPlyHeaderBytes(facts);
  if (
    facts.header.bytes < minimumHeaderBytes ||
    facts.header.bytes > maximumHeaderBytes
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["header", "bytes"],
      message: "point PLY header bytes cannot encode exactly the established declarations and line-ending mode",
    });
  }
  if (
    payload !== BigInt(facts.vertices.payloadBytes) ||
    facts.container.payloadBytes !== facts.vertices.payloadBytes ||
    facts.container.headerBytes !== facts.header.bytes ||
    facts.container.payloadOffsetBytes !== facts.header.bytes ||
    BigInt(facts.container.headerBytes) + payload !==
      BigInt(facts.container.sourceSizeBytes)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["container"],
      message: "point PLY container facts must satisfy the exact fixed-width file equation",
    });
  }
});
export type FoundryPlyPointCloudFactsV6 = z.infer<
  typeof FoundryPlyPointCloudFactsV6Schema
>;

const PointPlySourceSchema = SourceIdentityBaseSchema.extend({
  inputType: z.literal("ply_point_cloud"),
}).strict();

const PointPlyInspectionSchema = z.object({
  state: z.enum(["established", "facts_not_established"]),
  category: z.enum([
    "established",
    "resource_limit",
    "parse_failure",
    "unsupported_variant",
    "unsupported_container",
  ]),
  code: z.union([
    z.literal("POINT_PLY_SOURCE_FACTS_ESTABLISHED"),
    z.enum(FOUNDRY_POINT_PLY_SOURCE_FACTS_FAILURE_CODES),
  ]),
  coverage: z.enum([
    "none",
    "complete_header_and_exact_fixed_width_payload_layout",
  ]),
}).strict().superRefine((inspection, ctx) => {
  if ((inspection.state === "established") !== (inspection.category === "established")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["category"],
      message: "point PLY inspection state and category must agree",
    });
  }
  if (inspection.state === "established") {
    if (
      inspection.code !== "POINT_PLY_SOURCE_FACTS_ESTABLISHED" ||
      inspection.coverage !== "complete_header_and_exact_fixed_width_payload_layout"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "established point PLY inspection must use the frozen success profile",
      });
    }
    return;
  }
  if (inspection.code === "POINT_PLY_SOURCE_FACTS_ESTABLISHED") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["code"],
      message: "failed point PLY inspection cannot use the success code",
    });
    return;
  }
  const expected = FOUNDRY_POINT_PLY_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE[
    inspection.code
  ];
  if (
    expected === "cancelled" ||
    expected !== inspection.category ||
    inspection.coverage !== "none"
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["code"],
      message: "failed point PLY inspection must match the frozen non-cancelled failure registry",
    });
  }
});

const PointPlyAssetSchema = z.object({
  source: PointPlySourceSchema,
  format: z.literal("ply"),
  inspection: PointPlyInspectionSchema,
  facts: FoundryPlyPointCloudFactsV6Schema.nullable(),
  unknowns: z.array(UnknownFactSchema).length(FOUNDRY_POINT_PLY_UNKNOWNS.length),
}).strict().superRefine((asset, ctx) => {
  if (JSON.stringify(asset.unknowns) !== JSON.stringify(FOUNDRY_POINT_PLY_UNKNOWNS)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["unknowns"],
      message: "point PLY unknowns must match the frozen V6 profile",
    });
  }
  if ((asset.inspection.state === "established") !== (asset.facts !== null)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["facts"],
      message: "point PLY facts must match inspection state",
    });
  }
  if (
    asset.facts !== null &&
    asset.facts.container.sourceSizeBytes !== asset.source.sizeBytes
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["facts", "container", "sourceSizeBytes"],
      message: "point PLY facts must match source size",
    });
  }
});

export const UniversalSourceFactsV6AssetSchema = z.union([
  UniversalSourceFactsV5AssetSchema,
  PointPlyAssetSchema,
]);
export type UniversalSourceFactsV6Asset = z.infer<
  typeof UniversalSourceFactsV6AssetSchema
>;

function isPointPlyAsset(
  asset: UniversalSourceFactsV6Asset,
): asset is z.infer<typeof PointPlyAssetSchema> {
  return asset.source.inputType === "ply_point_cloud" && asset.format === "ply";
}

const BlockedSourceSchema = SourceIdentityBaseSchema.extend({
  inputType: z.literal("xgrids_xbin"),
}).strict();

export const UniversalSourceFactsV6FileResultSchema = z.union([
  UniversalSourceFactsV5FileResultSchema,
  z.object({ kind: z.literal("asset"), asset: PointPlyAssetSchema }).strict(),
]);
export type UniversalSourceFactsV6FileResult = z.infer<
  typeof UniversalSourceFactsV6FileResultSchema
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

const LimitsSchema = z.object({
  inheritedProfile: z.literal(FOUNDRY_UNIVERSAL_SOURCE_FACTS_V5),
  pointPlySourceMaxBytes: z.literal(FOUNDRY_POINT_PLY_SOURCE_MAX_BYTES),
  pointPlyHeaderMaxBytes: z.literal(FOUNDRY_POINT_PLY_HEADER_MAX_BYTES),
  pointPlyHeaderLineMaxBytes: z.literal(FOUNDRY_POINT_PLY_HEADER_LINE_MAX_BYTES),
  pointPlyElementMaxCount: z.literal(FOUNDRY_POINT_PLY_ELEMENT_MAX_COUNT),
  pointPlyPropertyMaxCount: z.literal(FOUNDRY_POINT_PLY_PROPERTY_MAX_COUNT),
  pointPlyCommentMaxCount: z.literal(FOUNDRY_POINT_PLY_COMMENT_MAX_COUNT),
  pointPlyVertexMaxCount: z.literal(FOUNDRY_POINT_PLY_VERTEX_MAX_COUNT),
  pointPlyVertexStrideMaxBytes: z.literal(FOUNDRY_POINT_PLY_VERTEX_STRIDE_MAX_BYTES),
}).strict();

const LIMITS: z.infer<typeof LimitsSchema> = {
  inheritedProfile: FOUNDRY_UNIVERSAL_SOURCE_FACTS_V5,
  pointPlySourceMaxBytes: FOUNDRY_POINT_PLY_SOURCE_MAX_BYTES,
  pointPlyHeaderMaxBytes: FOUNDRY_POINT_PLY_HEADER_MAX_BYTES,
  pointPlyHeaderLineMaxBytes: FOUNDRY_POINT_PLY_HEADER_LINE_MAX_BYTES,
  pointPlyElementMaxCount: FOUNDRY_POINT_PLY_ELEMENT_MAX_COUNT,
  pointPlyPropertyMaxCount: FOUNDRY_POINT_PLY_PROPERTY_MAX_COUNT,
  pointPlyCommentMaxCount: FOUNDRY_POINT_PLY_COMMENT_MAX_COUNT,
  pointPlyVertexMaxCount: FOUNDRY_POINT_PLY_VERTEX_MAX_COUNT,
  pointPlyVertexStrideMaxBytes: FOUNDRY_POINT_PLY_VERTEX_STRIDE_MAX_BYTES,
};

const SummarySchema = z.object({
  receiptFileCount: z.number().int().min(0).max(FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES),
  assetCount: z.number().int().min(0).max(FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES),
  establishedCount: z.number().int().min(0).max(FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES),
  factsNotEstablishedCount: z.number().int().min(0).max(
    FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES,
  ),
  untargetedFileCount: z.number().int().min(0).max(
    FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES,
  ),
  blockedSourceCount: z.number().int().min(0).max(
    FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES,
  ),
}).strict();

const LimitationsSchema = z.tuple([
  z.literal(FOUNDRY_SOURCE_FACTS_V6_LIMITATIONS[0]),
  z.literal(FOUNDRY_SOURCE_FACTS_V6_LIMITATIONS[1]),
  z.literal(FOUNDRY_SOURCE_FACTS_V6_LIMITATIONS[2]),
  z.literal(FOUNDRY_SOURCE_FACTS_V6_LIMITATIONS[3]),
  z.literal(FOUNDRY_SOURCE_FACTS_V6_LIMITATIONS[4]),
  z.literal(FOUNDRY_SOURCE_FACTS_V6_LIMITATIONS[5]),
]);

const ArtifactBaseSchema = z.object({
  schemaVersion: z.literal(FOUNDRY_UNIVERSAL_SOURCE_FACTS_V6),
  receiptSha256: z.string().regex(SHA256_HEX),
  policy: PolicySchema,
  limitations: LimitationsSchema,
  limits: LimitsSchema,
  summary: SummarySchema,
  factsSha256: z.string().regex(SHA256_HEX),
}).strict();

const AvailableArtifactSchema = ArtifactBaseSchema.extend({
  state: z.literal("available"),
  assets: z.array(UniversalSourceFactsV6AssetSchema).max(
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
      "Universal Source Facts V6 are unavailable because the receipt includes an unsupported XGRIDS XBIN candidate.",
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
    FOUNDRY_UNIVERSAL_SOURCE_FACTS_V6_DIGEST_DOMAIN,
    toCanonicalJson(payload),
  );
}

function validateArtifact(
  value: ArtifactWithoutValidation,
  ctx: z.RefinementCtx,
): void {
  const paths = value.assets.map((asset) => asset.source.path);
  const sorted = [...paths].sort(compareText);
  if (
    new Set(paths).size !== paths.length ||
    paths.some((path, index) => path !== sorted[index])
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["assets"],
      message: "V6 asset paths must be unique and sorted",
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
      message: "V6 summary contradicts attached evidence",
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
        message: "V6 affected XBIN sources must be unique and sorted",
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
      message: "V6 metadata probe policy contradicts attached E57 evidence",
    });
  }
  if (value.factsSha256 !== artifactDigest(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["factsSha256"],
      message: "V6 facts digest does not match canonical payload",
    });
  }
}

export const FoundryUniversalSourceFactsV6Schema = z.discriminatedUnion("state", [
  AvailableArtifactSchema,
  UnavailableArtifactSchema,
]).superRefine(validateArtifact);
export type FoundryUniversalSourceFactsV6 = z.infer<
  typeof FoundryUniversalSourceFactsV6Schema
>;

export interface UniversalSourceFactsV6FinalizeOptions
  extends UniversalSourceFactsV5FinalizeOptions {
  readonly plyPointCloudInspection?: FoundryPlyPointCloudSourceFactsOutcome;
}

export interface UniversalSourceFactsV6StreamCollector {
  observe(chunk: Uint8Array, absoluteOffset: number): void;
  finalize(
    identity: UniversalSourceFactsV6ReceiptFileIdentity,
    options?: UniversalSourceFactsV6FinalizeOptions,
  ): UniversalSourceFactsV6FileResult;
}

function hasCandidate(
  identity: UniversalSourceFactsReceiptFileIdentity,
  inputType: string,
): boolean {
  return identity.detection.candidates.some(
    (candidate) => candidate.inputType === inputType,
  );
}

function isOrdinaryPointCandidate(
  identity: UniversalSourceFactsV6ReceiptFileIdentity,
): boolean {
  return !identity.magicHex.startsWith("4153544d2d453537") &&
    !identity.magicHex.startsWith("676c5446") &&
    hasCandidate(identity, "ply_point_cloud") &&
    !hasCandidate(identity, "gaussian_ply");
}

function assertPointOutcome(
  outcome: FoundryPlyPointCloudSourceFactsOutcome,
): void {
  if (outcome.state === "established") {
    FoundryPlyPointCloudFactsV6Schema.parse(outcome.facts);
    return;
  }
  if (
    !FOUNDRY_POINT_PLY_SOURCE_FACTS_FAILURE_CODES.includes(outcome.code) ||
    FOUNDRY_POINT_PLY_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE[outcome.code] !==
      outcome.category
  ) {
    throw new FoundryIntegrityError(
      "SOURCE_FACTS_V6_POINT_PLY_OUTCOME_INVALID",
      "The ordinary point PLY inspection outcome contradicts the frozen failure registry.",
    );
  }
  if (outcome.category === "cancelled") {
    throw new FoundryIntegrityError(
      "SOURCE_FACTS_V6_POINT_PLY_INSPECTION_CANCELLED",
      "The ordinary point PLY Source Facts inspection was cancelled; no V6 artifact was issued.",
    );
  }
}

function pointPlyResult(
  identity: UniversalSourceFactsV6ReceiptFileIdentity,
  outcome: FoundryPlyPointCloudSourceFactsOutcome,
): UniversalSourceFactsV6FileResult {
  assertPointOutcome(outcome);
  const source = {
    path: identity.path,
    sizeBytes: identity.sizeBytes,
    sha256: identity.sha256,
    inputType: "ply_point_cloud" as const,
  };
  if (outcome.state === "established") {
    return UniversalSourceFactsV6FileResultSchema.parse({
      kind: "asset",
      asset: {
        source,
        format: "ply",
        inspection: {
          state: "established",
          category: "established",
          code: "POINT_PLY_SOURCE_FACTS_ESTABLISHED",
          coverage: "complete_header_and_exact_fixed_width_payload_layout",
        },
        facts: FoundryPlyPointCloudFactsV6Schema.parse(outcome.facts),
        unknowns: FOUNDRY_POINT_PLY_UNKNOWNS,
      },
    });
  }
  return UniversalSourceFactsV6FileResultSchema.parse({
    kind: "asset",
    asset: {
      source,
      format: "ply",
      inspection: {
        state: "facts_not_established",
        category: outcome.category,
        code: outcome.code,
        coverage: "none",
      },
      facts: null,
      unknowns: FOUNDRY_POINT_PLY_UNKNOWNS,
    },
  });
}

class UniversalSourceFactsV6StreamCollectorImpl
implements UniversalSourceFactsV6StreamCollector {
  private readonly v5Collector;
  private readonly hash = createHash("sha256");
  private readonly prefix = Buffer.alloc(128);
  private prefixBytes = 0;
  private observedBytes = 0;
  private finalized = false;

  constructor(private readonly relativePath: string) {
    this.relativePath = FoundryRelativePathSchema.parse(relativePath);
    this.v5Collector = createUniversalSourceFactsV5StreamCollector(this.relativePath);
  }

  observe(chunk: Uint8Array, absoluteOffset: number): void {
    if (this.finalized) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V6_COLLECTOR_FINALIZED",
        "Source Facts V6 collector is already finalized.",
      );
    }
    if (!(chunk instanceof Uint8Array) || absoluteOffset !== this.observedBytes) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V6_NONCONTIGUOUS_STREAM",
        "Source Facts V6 byte chunks must be contiguous and start at offset zero.",
      );
    }
    this.v5Collector.observe(chunk, absoluteOffset);
    this.hash.update(chunk);
    if (this.prefixBytes < this.prefix.length) {
      const copyBytes = Math.min(this.prefix.length - this.prefixBytes, chunk.length);
      this.prefix.set(chunk.subarray(0, copyBytes), this.prefixBytes);
      this.prefixBytes += copyBytes;
    }
    this.observedBytes += chunk.length;
  }

  finalize(
    identityInput: UniversalSourceFactsV6ReceiptFileIdentity,
    options: UniversalSourceFactsV6FinalizeOptions = {},
  ): UniversalSourceFactsV6FileResult {
    if (this.finalized) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V6_COLLECTOR_FINALIZED",
        "Source Facts V6 collector is already finalized.",
      );
    }
    this.finalized = true;
    const identity = UniversalSourceFactsV6ReceiptFileIdentitySchema.parse(identityInput);
    if (identity.path !== this.relativePath || identity.sizeBytes !== this.observedBytes) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V6_IDENTITY_MISMATCH",
        "Source Facts V6 bytes do not match their receipt identity.",
      );
    }
    const observedSha256 = this.hash.digest("hex");
    if (observedSha256 !== identity.sha256) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V6_SHA256_MISMATCH",
        "Source Facts V6 bytes do not match the receipt SHA-256.",
      );
    }
    const magicHex = this.prefix.subarray(0, this.prefixBytes).toString("hex");
    if (magicHex !== identity.magicHex) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V6_MAGIC_BINDING_MISMATCH",
        "Source Facts V6 prefix bytes do not match the receipt-bound magic bytes.",
      );
    }

    const { plyPointCloudInspection, ...v5Options } = options;
    const pointTarget = isOrdinaryPointCandidate(identity);
    if (!pointTarget) {
      if (plyPointCloudInspection !== undefined) {
        throw new FoundryIntegrityError(
          "SOURCE_FACTS_V6_UNEXPECTED_POINT_PLY_INSPECTION",
          "An ordinary point PLY inspection was supplied for a non-V6 target.",
        );
      }
      return UniversalSourceFactsV6FileResultSchema.parse(
        this.v5Collector.finalize(identity, v5Options),
      );
    }
    if (v5Options.gaussianPlyInspection === undefined) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V6_GAUSSIAN_PRECEDENCE_INSPECTION_REQUIRED",
        "Ordinary point PLY Source Facts V6 require the inherited Gaussian profile to run first on the same handle.",
      );
    }
    if (v5Options.gaussianPlyInspection.state === "established") {
      if (plyPointCloudInspection !== undefined) {
        throw new FoundryIntegrityError(
          "SOURCE_FACTS_V6_CONTRADICTORY_POINT_PLY_INSPECTION",
          "A Gaussian-established source cannot also carry an ordinary point PLY inspection.",
        );
      }
      return UniversalSourceFactsV6FileResultSchema.parse(
        this.v5Collector.finalize(identity, v5Options),
      );
    }
    if (plyPointCloudInspection === undefined) {
      this.v5Collector.finalize(identity, v5Options);
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V6_POINT_PLY_INSPECTION_REQUIRED",
        "An ordinary PLY candidate requires a bounded point-layout inspection after Gaussian non-establishment.",
      );
    }
    if (
      plyPointCloudInspection.sourceSizeBytes !== this.observedBytes ||
      plyPointCloudInspection.sourceSha256 !== observedSha256
    ) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V6_POINT_PLY_INSPECTION_SOURCE_MISMATCH",
        "The bounded point PLY inspection does not match the receipt-bound V6 byte stream.",
      );
    }
    assertPointOutcome(plyPointCloudInspection);
    const inherited = this.v5Collector.finalize(identity, v5Options);
    if (inherited.kind !== "untargeted") {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V6_INHERITED_POINT_TARGET_CONFLICT",
        "The inherited V5 result claimed an ordinary PLY source after Gaussian non-establishment.",
      );
    }
    return pointPlyResult(identity, plyPointCloudInspection);
  }
}

export function createUniversalSourceFactsV6StreamCollector(
  relativePath: string,
): UniversalSourceFactsV6StreamCollector {
  return new UniversalSourceFactsV6StreamCollectorImpl(relativePath);
}

function resultSource(
  result: UniversalSourceFactsV6FileResult,
): z.infer<typeof SourceIdentityBaseSchema> {
  return result.kind === "asset" ? result.asset.source : result.source;
}

function issueArtifact(payload: ArtifactPayload): FoundryUniversalSourceFactsV6 {
  const candidate = {
    ...payload,
    factsSha256: "0".repeat(64),
  } as ArtifactWithoutValidation;
  return FoundryUniversalSourceFactsV6Schema.parse({
    ...payload,
    factsSha256: artifactDigest(candidate),
  });
}

function uniqueSortedResults(
  inputs: readonly UniversalSourceFactsV6FileResult[],
): UniversalSourceFactsV6FileResult[] {
  if (inputs.length > FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES) {
    throw new FoundryIntegrityError(
      "SOURCE_FACTS_V6_FILE_COUNT_LIMIT",
      "Source Facts V6 results exceed the receipt file-count limit.",
    );
  }
  const results = inputs.map((result) =>
    UniversalSourceFactsV6FileResultSchema.parse(result)
  );
  results.sort((left, right) =>
    compareText(resultSource(left).path, resultSource(right).path)
  );
  const paths = results.map((result) => resultSource(result).path);
  if (new Set(paths).size !== paths.length) {
    throw new FoundryIntegrityError(
      "SOURCE_FACTS_V6_DUPLICATE_RESULT_PATH",
      "Source Facts V6 results must have unique paths.",
    );
  }
  return results;
}

function pointAsV5Untargeted(
  result: UniversalSourceFactsV6FileResult,
): UniversalSourceFactsV5FileResult {
  if (result.kind === "asset" && isPointPlyAsset(result.asset)) {
    return UniversalSourceFactsV5FileResultSchema.parse({
      kind: "untargeted",
      source: {
        path: result.asset.source.path,
        sizeBytes: result.asset.source.sizeBytes,
        sha256: result.asset.source.sha256,
      },
    });
  }
  return UniversalSourceFactsV5FileResultSchema.parse(result);
}

function unavailableArtifact(
  receiptSha256: string,
  receiptFileCount: number,
  affectedSourcesInput: readonly z.infer<typeof BlockedSourceSchema>[],
): FoundryUniversalSourceFactsV6 {
  const affectedSources = affectedSourcesInput
    .map((source) => BlockedSourceSchema.parse(source))
    .sort((left, right) => compareText(left.path, right.path));
  return issueArtifact({
    schemaVersion: FOUNDRY_UNIVERSAL_SOURCE_FACTS_V6,
    receiptSha256,
    state: "unavailable",
    policy: {
      sourceAccess: "read_only",
      mutation: "none",
      reconstruction: "none",
      networkAccess: "none",
      externalProcess: "none",
      metadataProbe: "none",
      authority: "none",
      rights: "not_evaluated",
    },
    limitations: [...FOUNDRY_SOURCE_FACTS_V6_LIMITATIONS],
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
        "Universal Source Facts V6 are unavailable because the receipt includes an unsupported XGRIDS XBIN candidate.",
      nextAction: FOUNDRY_XBIN_OFFICIAL_EXPORT_NEXT_ACTION,
    },
  });
}

function availableArtifact(
  receiptSha256: string,
  receiptFileCount: number,
  results: readonly UniversalSourceFactsV6FileResult[],
  inheritedAssets: readonly UniversalSourceFactsV5Asset[],
): FoundryUniversalSourceFactsV6 {
  const assets = results
    .filter((result): result is Extract<
      UniversalSourceFactsV6FileResult,
      { readonly kind: "asset" }
    > => result.kind === "asset")
    .map((result) => result.asset)
    .sort((left, right) => compareText(left.source.path, right.source.path));
  const usesPye57 = inheritedAssets.some((asset) =>
    asset.format === "e57" &&
    asset.facts !== null &&
    "aggregateMetadata" in asset.facts &&
    asset.facts.aggregateMetadata !== null
  );
  const probe = usesPye57 ? "local_pye57_read_only" as const : "none" as const;
  return issueArtifact({
    schemaVersion: FOUNDRY_UNIVERSAL_SOURCE_FACTS_V6,
    receiptSha256,
    state: "available",
    policy: {
      sourceAccess: "read_only",
      mutation: "none",
      reconstruction: "none",
      networkAccess: "none",
      externalProcess: probe,
      metadataProbe: probe,
      authority: "none",
      rights: "not_evaluated",
    },
    limitations: [...FOUNDRY_SOURCE_FACTS_V6_LIMITATIONS],
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

export function createUniversalSourceFactsV6ArtifactFromReceipt(
  receiptSha256Input: string,
  identityInputs: readonly UniversalSourceFactsV6ReceiptFileIdentity[],
  resultInputs: readonly UniversalSourceFactsV6FileResult[] = [],
): FoundryUniversalSourceFactsV6 {
  const receiptSha256 = z.string().regex(SHA256_HEX).parse(receiptSha256Input);
  if (identityInputs.length > FOUNDRY_SOURCE_FACTS_MAX_RECEIPT_FILES) {
    throw new FoundryIntegrityError(
      "SOURCE_FACTS_V6_FILE_COUNT_LIMIT",
      "Source Facts V6 receipt identities exceed the file-count limit.",
    );
  }
  const identities = identityInputs
    .map((identity) => UniversalSourceFactsV6ReceiptFileIdentitySchema.parse(identity))
    .sort((left, right) => compareText(left.path, right.path));
  const identityPaths = identities.map((identity) => identity.path);
  if (new Set(identityPaths).size !== identityPaths.length) {
    throw new FoundryIntegrityError(
      "SOURCE_FACTS_V6_DUPLICATE_RECEIPT_PATH",
      "Source Facts V6 receipt identities must have unique paths.",
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
      "SOURCE_FACTS_V6_RESULT_SET_INCOMPLETE",
      "Available Source Facts V6 require one finalized result per receipt file.",
    );
  }
  let inherited;
  try {
    inherited = createUniversalSourceFactsV5ArtifactFromReceipt(
      receiptSha256,
      identities,
      results.map(pointAsV5Untargeted),
    );
  } catch (error: unknown) {
    throw new FoundryIntegrityError(
      "SOURCE_FACTS_V6_INHERITED_RESULT_INVALID",
      "A Source Facts V6 inherited result contradicts the receipt-derived V1-V5 target.",
      { cause: error },
    );
  }
  if (inherited.state !== "available") {
    throw new FoundryIntegrityError(
      "SOURCE_FACTS_V6_UNEXPECTED_INHERITED_BLOCK",
      "V5 reported an XBIN block after V6 established that the receipt has no XBIN candidate.",
    );
  }
  const inheritedAssetPaths = new Set(
    inherited.assets.map((asset) => asset.source.path),
  );
  for (const [index, identity] of identities.entries()) {
    const result = results[index];
    if (result === undefined) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V6_RESULT_SET_INCOMPLETE",
        "Source Facts V6 result is missing.",
      );
    }
    const source = resultSource(result);
    if (
      source.path !== identity.path ||
      source.sizeBytes !== identity.sizeBytes ||
      source.sha256 !== identity.sha256
    ) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V6_RESULT_IDENTITY_MISMATCH",
        "Source Facts V6 result does not match its receipt identity.",
      );
    }
    const pointAsset = result.kind === "asset" && isPointPlyAsset(result.asset)
      ? result.asset
      : null;
    const expectedPointAsset = isOrdinaryPointCandidate(identity) &&
      !inheritedAssetPaths.has(identity.path);
    if ((pointAsset !== null) !== expectedPointAsset) {
      throw new FoundryIntegrityError(
        "SOURCE_FACTS_V6_RESULT_TARGET_MISMATCH",
        "A Source Facts V6 result does not match inherited Gaussian precedence or its ordinary point PLY target.",
      );
    }
  }
  return availableArtifact(
    receiptSha256,
    identities.length,
    results,
    inherited.assets,
  );
}

export function serializeUniversalSourceFactsV6Artifact(
  value: FoundryUniversalSourceFactsV6,
): string {
  return stableCanonicalJson(
    toCanonicalJson(FoundryUniversalSourceFactsV6Schema.parse(value)),
  );
}
