import { createHash } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import { z } from "zod";

export const FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_MAX_BYTES = 8 * 1024 * 1024;
export const FOUNDRY_CALIBRATION_TRAJECTORY_READ_CHUNK_BYTES = 256 * 1024;
// The observed LCC2 poses.json profile is a single 542,394-byte line. Keep the
// line ceiling independently bounded while allowing that exact real profile.
export const FOUNDRY_CALIBRATION_TRAJECTORY_LINE_MAX_BYTES = 1024 * 1024;
export const FOUNDRY_CALIBRATION_TRAJECTORY_CSV_RECORD_MAX_COUNT = 250_000;
export const FOUNDRY_CALIBRATION_TRAJECTORY_CSV_RECORD_MAX_CODE_UNITS = 1024 * 1024;
export const FOUNDRY_CALIBRATION_TRAJECTORY_CSV_FIELD_MAX_COUNT = 256;
export const FOUNDRY_CALIBRATION_TRAJECTORY_CSV_AGGREGATE_FIELD_MAX_COUNT = 500_000;
export const FOUNDRY_CALIBRATION_TRAJECTORY_STRING_MAX_CODE_UNITS = 65_536;
export const FOUNDRY_CALIBRATION_TRAJECTORY_NUMBER_LEXEME_MAX_CODE_UNITS = 256;
export const FOUNDRY_CALIBRATION_TRAJECTORY_JSON_DEPTH_MAX = 64;
export const FOUNDRY_CALIBRATION_TRAJECTORY_JSON_VALUE_MAX_COUNT = 250_000;
export const FOUNDRY_CALIBRATION_TRAJECTORY_JSON_MEMBER_MAX_COUNT = 200_000;
export const FOUNDRY_CALIBRATION_TRAJECTORY_JSON_CONTAINER_ENTRY_MAX_COUNT = 100_000;
export const FOUNDRY_CALIBRATION_TRAJECTORY_JSON_DISTINCT_KEY_MAX_COUNT = 65_536;

export const FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_FACTS_LIMITS = Object.freeze({
  sourceMaxBytes: FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_MAX_BYTES,
  readChunkBytes: FOUNDRY_CALIBRATION_TRAJECTORY_READ_CHUNK_BYTES,
  lineMaxBytes: FOUNDRY_CALIBRATION_TRAJECTORY_LINE_MAX_BYTES,
  csvRecordMaxCount: FOUNDRY_CALIBRATION_TRAJECTORY_CSV_RECORD_MAX_COUNT,
  csvRecordMaxCodeUnits: FOUNDRY_CALIBRATION_TRAJECTORY_CSV_RECORD_MAX_CODE_UNITS,
  csvFieldMaxCount: FOUNDRY_CALIBRATION_TRAJECTORY_CSV_FIELD_MAX_COUNT,
  csvAggregateFieldMaxCount: FOUNDRY_CALIBRATION_TRAJECTORY_CSV_AGGREGATE_FIELD_MAX_COUNT,
  stringMaxCodeUnits: FOUNDRY_CALIBRATION_TRAJECTORY_STRING_MAX_CODE_UNITS,
  numberLexemeMaxCodeUnits: FOUNDRY_CALIBRATION_TRAJECTORY_NUMBER_LEXEME_MAX_CODE_UNITS,
  jsonDepthMax: FOUNDRY_CALIBRATION_TRAJECTORY_JSON_DEPTH_MAX,
  jsonValueMaxCount: FOUNDRY_CALIBRATION_TRAJECTORY_JSON_VALUE_MAX_COUNT,
  jsonMemberMaxCount: FOUNDRY_CALIBRATION_TRAJECTORY_JSON_MEMBER_MAX_COUNT,
  jsonContainerEntryMaxCount: FOUNDRY_CALIBRATION_TRAJECTORY_JSON_CONTAINER_ENTRY_MAX_COUNT,
  jsonDistinctKeyMaxCount: FOUNDRY_CALIBRATION_TRAJECTORY_JSON_DISTINCT_KEY_MAX_COUNT,
} as const);

export const FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_FACTS_LIMITATIONS = Object.freeze([
  "CSV_FIRST_RECORD_FIELDS_AND_JSON_OBJECT_KEYS_DO_NOT_ESTABLISH_HEADER_OR_PROPERTY_SEMANTICS",
  "DECIMAL_LEXEMES_ARE_RETAINED_AS_TEXT_AND_DO_NOT_ESTABLISH_UNITS_TIMEBASE_CADENCE_OR_ACCURACY",
  "DOCUMENT_STRUCTURE_DOES_NOT_ESTABLISH_FRAME_CRS_AXES_HANDEDNESS_TRANSFORM_DIRECTION_OR_SENSOR_MODEL",
  "DOCUMENT_STRUCTURE_DOES_NOT_ESTABLISH_PROVENANCE_APPLICABILITY_SYNCHRONIZATION_RIGHTS_REGISTRATION_OR_AUTHORITY",
] as const);

export const FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_FACTS_FAILURE_CODES = Object.freeze([
  "CALIBRATION_TRAJECTORY_INSPECTION_CANCELLED",
  "CALIBRATION_TRAJECTORY_SOURCE_SIZE_LIMIT_EXCEEDED",
  "CALIBRATION_TRAJECTORY_SOURCE_NOT_REGULAR",
  "CALIBRATION_TRAJECTORY_SOURCE_SIZE_MISMATCH",
  "CALIBRATION_TRAJECTORY_SOURCE_SHA256_MISMATCH",
  "CALIBRATION_TRAJECTORY_SOURCE_CHANGED",
  "CALIBRATION_TRAJECTORY_HANDLE_READ_FAILED",
  "CALIBRATION_TRAJECTORY_DOCUMENT_EXTENSION_UNSUPPORTED",
  "CALIBRATION_TRAJECTORY_DOCUMENT_EMPTY",
  "CALIBRATION_TRAJECTORY_DOCUMENT_UTF8_INVALID",
  "CALIBRATION_TRAJECTORY_DOCUMENT_LINE_LIMIT_EXCEEDED",
  "CALIBRATION_TRAJECTORY_DOCUMENT_MALFORMED",
  "CALIBRATION_TRAJECTORY_CSV_NUL_BYTE",
  "CALIBRATION_TRAJECTORY_CSV_RECORD_LIMIT_EXCEEDED",
  "CALIBRATION_TRAJECTORY_CSV_RECORD_SIZE_LIMIT_EXCEEDED",
  "CALIBRATION_TRAJECTORY_CSV_FIELD_LIMIT_EXCEEDED",
  "CALIBRATION_TRAJECTORY_CSV_AGGREGATE_FIELD_LIMIT_EXCEEDED",
  "CALIBRATION_TRAJECTORY_CSV_STRING_LIMIT_EXCEEDED",
  "CALIBRATION_TRAJECTORY_CSV_NUMBER_LIMIT_EXCEEDED",
  "CALIBRATION_TRAJECTORY_JSON_DUPLICATE_KEY",
  "CALIBRATION_TRAJECTORY_JSON_DEPTH_LIMIT_EXCEEDED",
  "CALIBRATION_TRAJECTORY_JSON_VALUE_LIMIT_EXCEEDED",
  "CALIBRATION_TRAJECTORY_JSON_MEMBER_LIMIT_EXCEEDED",
  "CALIBRATION_TRAJECTORY_JSON_CONTAINER_ENTRY_LIMIT_EXCEEDED",
  "CALIBRATION_TRAJECTORY_JSON_DISTINCT_KEY_LIMIT_EXCEEDED",
  "CALIBRATION_TRAJECTORY_JSON_STRING_LIMIT_EXCEEDED",
  "CALIBRATION_TRAJECTORY_JSON_NUMBER_LIMIT_EXCEEDED",
  "CALIBRATION_TRAJECTORY_JSON_UNICODE_SCALAR_INVALID",
  "CALIBRATION_TRAJECTORY_INSPECTION_FAILED",
] as const);

export type FoundryCalibrationTrajectorySourceFactsFailureCode =
  (typeof FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_FACTS_FAILURE_CODES)[number];
export type FoundryCalibrationTrajectorySourceFactsFailureCategory =
  | "cancelled"
  | "parse_failure"
  | "resource_limit"
  | "unsupported_variant";

export const FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE = Object.freeze({
  CALIBRATION_TRAJECTORY_INSPECTION_CANCELLED: "cancelled",
  CALIBRATION_TRAJECTORY_SOURCE_SIZE_LIMIT_EXCEEDED: "resource_limit",
  CALIBRATION_TRAJECTORY_SOURCE_NOT_REGULAR: "parse_failure",
  CALIBRATION_TRAJECTORY_SOURCE_SIZE_MISMATCH: "parse_failure",
  CALIBRATION_TRAJECTORY_SOURCE_SHA256_MISMATCH: "parse_failure",
  CALIBRATION_TRAJECTORY_SOURCE_CHANGED: "parse_failure",
  CALIBRATION_TRAJECTORY_HANDLE_READ_FAILED: "parse_failure",
  CALIBRATION_TRAJECTORY_DOCUMENT_EXTENSION_UNSUPPORTED: "unsupported_variant",
  CALIBRATION_TRAJECTORY_DOCUMENT_EMPTY: "parse_failure",
  CALIBRATION_TRAJECTORY_DOCUMENT_UTF8_INVALID: "parse_failure",
  CALIBRATION_TRAJECTORY_DOCUMENT_LINE_LIMIT_EXCEEDED: "resource_limit",
  CALIBRATION_TRAJECTORY_DOCUMENT_MALFORMED: "parse_failure",
  CALIBRATION_TRAJECTORY_CSV_NUL_BYTE: "parse_failure",
  CALIBRATION_TRAJECTORY_CSV_RECORD_LIMIT_EXCEEDED: "resource_limit",
  CALIBRATION_TRAJECTORY_CSV_RECORD_SIZE_LIMIT_EXCEEDED: "resource_limit",
  CALIBRATION_TRAJECTORY_CSV_FIELD_LIMIT_EXCEEDED: "resource_limit",
  CALIBRATION_TRAJECTORY_CSV_AGGREGATE_FIELD_LIMIT_EXCEEDED: "resource_limit",
  CALIBRATION_TRAJECTORY_CSV_STRING_LIMIT_EXCEEDED: "resource_limit",
  CALIBRATION_TRAJECTORY_CSV_NUMBER_LIMIT_EXCEEDED: "resource_limit",
  CALIBRATION_TRAJECTORY_JSON_DUPLICATE_KEY: "parse_failure",
  CALIBRATION_TRAJECTORY_JSON_DEPTH_LIMIT_EXCEEDED: "resource_limit",
  CALIBRATION_TRAJECTORY_JSON_VALUE_LIMIT_EXCEEDED: "resource_limit",
  CALIBRATION_TRAJECTORY_JSON_MEMBER_LIMIT_EXCEEDED: "resource_limit",
  CALIBRATION_TRAJECTORY_JSON_CONTAINER_ENTRY_LIMIT_EXCEEDED: "resource_limit",
  CALIBRATION_TRAJECTORY_JSON_DISTINCT_KEY_LIMIT_EXCEEDED: "resource_limit",
  CALIBRATION_TRAJECTORY_JSON_STRING_LIMIT_EXCEEDED: "resource_limit",
  CALIBRATION_TRAJECTORY_JSON_NUMBER_LIMIT_EXCEEDED: "resource_limit",
  CALIBRATION_TRAJECTORY_JSON_UNICODE_SCALAR_INVALID: "parse_failure",
  CALIBRATION_TRAJECTORY_INSPECTION_FAILED: "parse_failure",
} as const satisfies Readonly<Record<
  FoundryCalibrationTrajectorySourceFactsFailureCode,
  FoundryCalibrationTrajectorySourceFactsFailureCategory
>>);

const CALIBRATION_TRAJECTORY_COMMON_DOCUMENT_FAILURE_CODES = Object.freeze([
  "CALIBRATION_TRAJECTORY_INSPECTION_CANCELLED",
  "CALIBRATION_TRAJECTORY_SOURCE_SIZE_LIMIT_EXCEEDED",
  "CALIBRATION_TRAJECTORY_SOURCE_NOT_REGULAR",
  "CALIBRATION_TRAJECTORY_SOURCE_SIZE_MISMATCH",
  "CALIBRATION_TRAJECTORY_SOURCE_SHA256_MISMATCH",
  "CALIBRATION_TRAJECTORY_SOURCE_CHANGED",
  "CALIBRATION_TRAJECTORY_HANDLE_READ_FAILED",
  "CALIBRATION_TRAJECTORY_DOCUMENT_EMPTY",
  "CALIBRATION_TRAJECTORY_DOCUMENT_UTF8_INVALID",
  "CALIBRATION_TRAJECTORY_DOCUMENT_LINE_LIMIT_EXCEEDED",
  "CALIBRATION_TRAJECTORY_DOCUMENT_MALFORMED",
  "CALIBRATION_TRAJECTORY_INSPECTION_FAILED",
] as const satisfies readonly FoundryCalibrationTrajectorySourceFactsFailureCode[]);

export const FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_FACTS_FAILURE_CODES_BY_FORMAT =
  Object.freeze({
    csv: Object.freeze([
      ...CALIBRATION_TRAJECTORY_COMMON_DOCUMENT_FAILURE_CODES,
      "CALIBRATION_TRAJECTORY_CSV_NUL_BYTE",
      "CALIBRATION_TRAJECTORY_CSV_RECORD_LIMIT_EXCEEDED",
      "CALIBRATION_TRAJECTORY_CSV_RECORD_SIZE_LIMIT_EXCEEDED",
      "CALIBRATION_TRAJECTORY_CSV_FIELD_LIMIT_EXCEEDED",
      "CALIBRATION_TRAJECTORY_CSV_AGGREGATE_FIELD_LIMIT_EXCEEDED",
      "CALIBRATION_TRAJECTORY_CSV_STRING_LIMIT_EXCEEDED",
      "CALIBRATION_TRAJECTORY_CSV_NUMBER_LIMIT_EXCEEDED",
    ] as const satisfies readonly FoundryCalibrationTrajectorySourceFactsFailureCode[]),
    json: Object.freeze([
      ...CALIBRATION_TRAJECTORY_COMMON_DOCUMENT_FAILURE_CODES,
      "CALIBRATION_TRAJECTORY_JSON_DUPLICATE_KEY",
      "CALIBRATION_TRAJECTORY_JSON_DEPTH_LIMIT_EXCEEDED",
      "CALIBRATION_TRAJECTORY_JSON_VALUE_LIMIT_EXCEEDED",
      "CALIBRATION_TRAJECTORY_JSON_MEMBER_LIMIT_EXCEEDED",
      "CALIBRATION_TRAJECTORY_JSON_CONTAINER_ENTRY_LIMIT_EXCEEDED",
      "CALIBRATION_TRAJECTORY_JSON_DISTINCT_KEY_LIMIT_EXCEEDED",
      "CALIBRATION_TRAJECTORY_JSON_STRING_LIMIT_EXCEEDED",
      "CALIBRATION_TRAJECTORY_JSON_NUMBER_LIMIT_EXCEEDED",
      "CALIBRATION_TRAJECTORY_JSON_UNICODE_SCALAR_INVALID",
    ] as const satisfies readonly FoundryCalibrationTrajectorySourceFactsFailureCode[]),
  } as const);

export const FoundryCalibrationTrajectoryDocumentFormatSchema = z.enum(["csv", "json"]);
export type FoundryCalibrationTrajectoryDocumentFormat = z.infer<
  typeof FoundryCalibrationTrajectoryDocumentFormatSchema
>;

const SHA256 = /^[a-f0-9]{64}$/u;
const CSV_DECIMAL_LEXEME = /^[+-]?(?:(?:[0-9]+(?:\.[0-9]*)?)|(?:\.[0-9]+))(?:[eE][+-]?[0-9]+)?$/u;
const JSON_NUMBER_LEXEME = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/u;
const DecimalLexemeBaseSchema = z.string().min(1).max(
  FOUNDRY_CALIBRATION_TRAJECTORY_NUMBER_LEXEME_MAX_CODE_UNITS,
);
const CsvDecimalLexemeSchema = DecimalLexemeBaseSchema.regex(CSV_DECIMAL_LEXEME);
const JsonNumberLexemeSchema = DecimalLexemeBaseSchema.regex(JSON_NUMBER_LEXEME);
const SourceContainerSchema = z.object({
  sourceSizeBytes: z.number().int().safe().nonnegative().max(
    FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_MAX_BYTES,
  ),
  sourceSha256: z.string().regex(SHA256),
  exactFileLengthVerified: z.literal(true),
  sourceSha256Verified: z.literal(true),
}).strict();
const EncodingSchema = z.object({
  name: z.literal("utf-8"),
  bom: z.enum(["absent", "present"]),
}).strict();
const LimitationsSchema = z.tuple([
  z.literal(FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_FACTS_LIMITATIONS[0]),
  z.literal(FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_FACTS_LIMITATIONS[1]),
  z.literal(FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_FACTS_LIMITATIONS[2]),
  z.literal(FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_FACTS_LIMITATIONS[3]),
]);

function createDecimalSummarySchema(lexemeSchema: z.ZodString) {
  return z.object({
  count: z.number().int().nonnegative().max(FOUNDRY_CALIBRATION_TRAJECTORY_JSON_VALUE_MAX_COUNT),
  firstLexeme: lexemeSchema.nullable(),
  lastLexeme: lexemeSchema.nullable(),
  minimumLexeme: lexemeSchema.nullable(),
  maximumLexeme: lexemeSchema.nullable(),
  integerLexemeCount: z.number().int().nonnegative().max(
    FOUNDRY_CALIBRATION_TRAJECTORY_JSON_VALUE_MAX_COUNT,
  ),
  fractionLexemeCount: z.number().int().nonnegative().max(
    FOUNDRY_CALIBRATION_TRAJECTORY_JSON_VALUE_MAX_COUNT,
  ),
  exponentLexemeCount: z.number().int().nonnegative().max(
    FOUNDRY_CALIBRATION_TRAJECTORY_JSON_VALUE_MAX_COUNT,
  ),
  negativeZeroLexemeCount: z.number().int().nonnegative().max(
    FOUNDRY_CALIBRATION_TRAJECTORY_JSON_VALUE_MAX_COUNT,
  ),
  }).strict().superRefine((value, ctx) => {
  const nullable = [value.firstLexeme, value.lastLexeme, value.minimumLexeme, value.maximumLexeme];
  if (value.count === 0 && nullable.some((entry) => entry !== null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["count"], message: "zero count requires null lexeme bounds" });
  }
  if (value.count > 0 && nullable.some((entry) => entry === null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["count"], message: "positive count requires lexeme bounds" });
  }
  if (
    value.integerLexemeCount > value.count ||
    value.fractionLexemeCount > value.count ||
    value.exponentLexemeCount > value.count ||
    value.negativeZeroLexemeCount > value.count
  ) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["count"], message: "lexeme subtype counts exceed total" });
  }
  if (
    value.minimumLexeme !== null &&
    value.maximumLexeme !== null &&
    lexemeSchema.safeParse(value.minimumLexeme).success &&
    lexemeSchema.safeParse(value.maximumLexeme).success &&
    compareDecimalLexemes(value.minimumLexeme, value.maximumLexeme) > 0
  ) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["minimumLexeme"], message: "decimal bounds are reversed" });
  }
  if (
    value.firstLexeme !== null &&
    value.lastLexeme !== null &&
    value.minimumLexeme !== null &&
    value.maximumLexeme !== null &&
    [
      value.firstLexeme,
      value.lastLexeme,
      value.minimumLexeme,
      value.maximumLexeme,
    ].every((lexeme) => lexemeSchema.safeParse(lexeme).success) &&
    (
      compareDecimalLexemes(value.firstLexeme, value.minimumLexeme) < 0 ||
      compareDecimalLexemes(value.firstLexeme, value.maximumLexeme) > 0 ||
      compareDecimalLexemes(value.lastLexeme, value.minimumLexeme) < 0 ||
      compareDecimalLexemes(value.lastLexeme, value.maximumLexeme) > 0
    )
  ) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["firstLexeme"], message: "decimal boundary lexemes fall outside the declared range" });
  }
  });
}

const CsvDecimalSummarySchema = createDecimalSummarySchema(CsvDecimalLexemeSchema);
const JsonDecimalSummarySchema = createDecimalSummarySchema(JsonNumberLexemeSchema);

const CsvColumnSchema = z.object({
  ordinal: z.number().int().nonnegative().max(FOUNDRY_CALIBRATION_TRAJECTORY_CSV_FIELD_MAX_COUNT - 1),
  observedFieldCount: z.number().int().positive().max(
    FOUNDRY_CALIBRATION_TRAJECTORY_CSV_RECORD_MAX_COUNT,
  ),
  emptyFieldCount: z.number().int().nonnegative().max(
    FOUNDRY_CALIBRATION_TRAJECTORY_CSV_RECORD_MAX_COUNT,
  ),
  nonDecimalFieldCount: z.number().int().nonnegative().max(
    FOUNDRY_CALIBRATION_TRAJECTORY_CSV_RECORD_MAX_COUNT,
  ),
  decimals: CsvDecimalSummarySchema,
}).strict().superRefine((value, ctx) => {
  if (
    value.emptyFieldCount + value.nonDecimalFieldCount + value.decimals.count !==
    value.observedFieldCount
  ) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["observedFieldCount"], message: "column counts are inconsistent" });
  }
});

export const FoundryCalibrationTrajectoryCsvSourceFactsSchema = z.object({
  format: z.literal("csv"),
  profile: z.literal("utf8_csv_record_structure_v0"),
  inspectionCoverage: z.literal("complete_record_structure"),
  encoding: EncodingSchema,
  records: z.object({
    count: z.number().int().positive().max(FOUNDRY_CALIBRATION_TRAJECTORY_CSV_RECORD_MAX_COUNT),
    uniformFieldCount: z.boolean(),
    minimumFieldCount: z.number().int().positive().max(
      FOUNDRY_CALIBRATION_TRAJECTORY_CSV_FIELD_MAX_COUNT,
    ),
    maximumFieldCount: z.number().int().positive().max(
      FOUNDRY_CALIBRATION_TRAJECTORY_CSV_FIELD_MAX_COUNT,
    ),
    blankCount: z.number().int().nonnegative().max(
      FOUNDRY_CALIBRATION_TRAJECTORY_CSV_RECORD_MAX_COUNT,
    ),
    firstFields: z.array(z.string().max(FOUNDRY_CALIBRATION_TRAJECTORY_STRING_MAX_CODE_UNITS))
      .min(1).max(FOUNDRY_CALIBRATION_TRAJECTORY_CSV_FIELD_MAX_COUNT),
    lastFields: z.array(z.string().max(FOUNDRY_CALIBRATION_TRAJECTORY_STRING_MAX_CODE_UNITS))
      .min(1).max(FOUNDRY_CALIBRATION_TRAJECTORY_CSV_FIELD_MAX_COUNT),
  }).strict(),
  fields: z.object({
    count: z.number().int().positive().max(
      FOUNDRY_CALIBRATION_TRAJECTORY_CSV_AGGREGATE_FIELD_MAX_COUNT,
    ),
    emptyCount: z.number().int().nonnegative(),
    quotedCount: z.number().int().nonnegative(),
    multilineCount: z.number().int().nonnegative(),
    maximumCodeUnits: z.number().int().nonnegative().max(
      FOUNDRY_CALIBRATION_TRAJECTORY_STRING_MAX_CODE_UNITS,
    ),
  }).strict(),
  lineBreaks: z.object({
    crlfCount: z.number().int().nonnegative(),
    lfCount: z.number().int().nonnegative(),
    crCount: z.number().int().nonnegative(),
    trailing: z.boolean(),
  }).strict(),
  columns: z.array(CsvColumnSchema).min(1).max(
    FOUNDRY_CALIBRATION_TRAJECTORY_CSV_FIELD_MAX_COUNT,
  ),
  shapeSha256: z.string().regex(SHA256),
  container: SourceContainerSchema,
  limitations: LimitationsSchema,
}).strict().superRefine((facts, ctx) => {
  if (
    facts.records.minimumFieldCount > facts.records.maximumFieldCount ||
    facts.records.firstFields.length < facts.records.minimumFieldCount ||
    facts.records.firstFields.length > facts.records.maximumFieldCount ||
    facts.records.lastFields.length < facts.records.minimumFieldCount ||
    facts.records.lastFields.length > facts.records.maximumFieldCount ||
    facts.columns.length !== facts.records.maximumFieldCount ||
    facts.columns.some((column, index) => column.ordinal !== index)
  ) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["records"], message: "CSV record and column facts are inconsistent" });
  }
  if (facts.records.uniformFieldCount !== (facts.records.minimumFieldCount === facts.records.maximumFieldCount)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["records", "uniformFieldCount"], message: "uniform field flag contradicts bounds" });
  }
  if (
    facts.fields.emptyCount > facts.fields.count ||
    facts.fields.quotedCount > facts.fields.count ||
    facts.fields.multilineCount > facts.fields.quotedCount ||
    facts.records.blankCount > facts.records.count ||
    facts.columns.reduce((total, column) => total + column.emptyFieldCount, 0) !==
      facts.fields.emptyCount ||
    facts.columns.reduce((total, column) => total + column.observedFieldCount, 0) !== facts.fields.count
  ) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fields"], message: "CSV aggregate counts are inconsistent" });
  }
  const minimumAggregateFieldCount =
    facts.records.count * facts.records.minimumFieldCount;
  const maximumAggregateFieldCount =
    facts.records.count * facts.records.maximumFieldCount;
  if (
    facts.fields.count < minimumAggregateFieldCount ||
    facts.fields.count > maximumAggregateFieldCount
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["fields", "count"],
      message: "CSV aggregate field count contradicts record field-count bounds",
    });
  }
  if (
    facts.columns.some((column, index) =>
      (index < facts.records.minimumFieldCount &&
        column.observedFieldCount !== facts.records.count) ||
      (index > 0 &&
        (facts.columns[index - 1]?.observedFieldCount ?? 0) <
          column.observedFieldCount)
    )
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["columns"],
      message: "CSV column observations contradict prefix-complete records",
    });
  }
});

const JsonRootKindSchema = z.enum(["object", "array", "string", "number", "boolean", "null"]);

export const FoundryCalibrationTrajectoryJsonSourceFactsSchema = z.object({
  format: z.literal("json"),
  profile: z.literal("bounded_json_syntax_shape_v0"),
  inspectionCoverage: z.literal("complete_syntax_and_shape"),
  encoding: EncodingSchema,
  root: z.object({
    kind: JsonRootKindSchema,
    objectKeys: z.array(z.string().max(FOUNDRY_CALIBRATION_TRAJECTORY_STRING_MAX_CODE_UNITS)).nullable(),
    arrayLength: z.number().int().nonnegative().max(
      FOUNDRY_CALIBRATION_TRAJECTORY_JSON_CONTAINER_ENTRY_MAX_COUNT,
    ).nullable(),
  }).strict(),
  structure: z.object({
    valueCount: z.number().int().positive().max(
      FOUNDRY_CALIBRATION_TRAJECTORY_JSON_VALUE_MAX_COUNT,
    ),
    maximumDepth: z.number().int().positive().max(FOUNDRY_CALIBRATION_TRAJECTORY_JSON_DEPTH_MAX),
    objectCount: z.number().int().nonnegative(),
    arrayCount: z.number().int().nonnegative(),
    stringValueCount: z.number().int().nonnegative(),
    numberCount: z.number().int().nonnegative(),
    booleanCount: z.number().int().nonnegative(),
    nullCount: z.number().int().nonnegative(),
    objectMemberCount: z.number().int().nonnegative().max(
      FOUNDRY_CALIBRATION_TRAJECTORY_JSON_MEMBER_MAX_COUNT,
    ),
    arrayElementCount: z.number().int().nonnegative().max(
      FOUNDRY_CALIBRATION_TRAJECTORY_JSON_MEMBER_MAX_COUNT,
    ),
    maximumObjectMemberCount: z.number().int().nonnegative().max(
      FOUNDRY_CALIBRATION_TRAJECTORY_JSON_CONTAINER_ENTRY_MAX_COUNT,
    ),
    maximumArrayLength: z.number().int().nonnegative().max(
      FOUNDRY_CALIBRATION_TRAJECTORY_JSON_CONTAINER_ENTRY_MAX_COUNT,
    ),
    distinctObjectKeyCount: z.number().int().nonnegative().max(
      FOUNDRY_CALIBRATION_TRAJECTORY_JSON_DISTINCT_KEY_MAX_COUNT,
    ),
    shapeSha256: z.string().regex(SHA256),
  }).strict(),
  strings: z.object({
    valueCount: z.number().int().nonnegative(),
    minimumCodeUnits: z.number().int().nonnegative().max(
      FOUNDRY_CALIBRATION_TRAJECTORY_STRING_MAX_CODE_UNITS,
    ).nullable(),
    maximumCodeUnits: z.number().int().nonnegative().max(
      FOUNDRY_CALIBRATION_TRAJECTORY_STRING_MAX_CODE_UNITS,
    ).nullable(),
  }).strict(),
  numbers: JsonDecimalSummarySchema,
  container: SourceContainerSchema,
  limitations: LimitationsSchema,
}).strict().superRefine((facts, ctx) => {
  const scalarAndContainerCount = facts.structure.objectCount + facts.structure.arrayCount +
    facts.structure.stringValueCount + facts.structure.numberCount +
    facts.structure.booleanCount + facts.structure.nullCount;
  if (scalarAndContainerCount !== facts.structure.valueCount) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["structure", "valueCount"], message: "JSON value counts are inconsistent" });
  }
  if (
    facts.structure.maximumDepth > facts.structure.valueCount ||
    (facts.structure.valueCount > 1 && facts.structure.maximumDepth < 2)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["structure", "maximumDepth"],
      message: "JSON maximum depth contradicts the complete value count",
    });
  }
  const rootKindCount = facts.root.kind === "object"
    ? facts.structure.objectCount
    : facts.root.kind === "array"
      ? facts.structure.arrayCount
      : facts.root.kind === "string"
        ? facts.structure.stringValueCount
        : facts.root.kind === "number"
          ? facts.structure.numberCount
          : facts.root.kind === "boolean"
            ? facts.structure.booleanCount
            : facts.structure.nullCount;
  if (rootKindCount < 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["root", "kind"], message: "JSON root kind contradicts structure counts" });
  }
  if (
    facts.structure.objectMemberCount + facts.structure.arrayElementCount !==
    facts.structure.valueCount - 1
  ) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["structure"], message: "JSON tree edge counts are inconsistent" });
  }
  if (
    facts.structure.maximumObjectMemberCount > facts.structure.objectMemberCount ||
    facts.structure.maximumArrayLength > facts.structure.arrayElementCount ||
    facts.structure.distinctObjectKeyCount > facts.structure.objectMemberCount
  ) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["structure"], message: "JSON container maxima exceed aggregate counts" });
  }
  if (
    facts.structure.stringValueCount !== facts.strings.valueCount ||
    facts.structure.numberCount !== facts.numbers.count
  ) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["structure"], message: "JSON scalar summaries are inconsistent" });
  }
  if (
    facts.strings.valueCount === 0 !==
    (facts.strings.minimumCodeUnits === null && facts.strings.maximumCodeUnits === null)
  ) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["strings"], message: "JSON string bounds are inconsistent" });
  }
  if (
    facts.strings.minimumCodeUnits !== null &&
    facts.strings.maximumCodeUnits !== null &&
    facts.strings.minimumCodeUnits > facts.strings.maximumCodeUnits
  ) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["strings"], message: "JSON string bounds are reversed" });
  }
  if (facts.root.kind === "object" && facts.root.objectKeys === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["root", "objectKeys"], message: "object root requires keys" });
  }
  if (facts.root.kind !== "object" && facts.root.objectKeys !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["root", "objectKeys"], message: "non-object root cannot expose keys" });
  }
  if (
    facts.root.objectKeys !== null &&
    (
      new Set(facts.root.objectKeys).size !== facts.root.objectKeys.length ||
      facts.root.objectKeys.length > facts.structure.maximumObjectMemberCount ||
      facts.root.objectKeys.length > facts.structure.distinctObjectKeyCount
    )
  ) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["root", "objectKeys"], message: "object root keys contradict JSON structure counts" });
  }
  if (facts.root.kind === "array" && facts.root.arrayLength === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["root", "arrayLength"], message: "array root requires length" });
  }
  if (facts.root.kind !== "array" && facts.root.arrayLength !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["root", "arrayLength"], message: "non-array root cannot expose length" });
  }
  if (
    facts.root.arrayLength !== null &&
    (
      facts.root.arrayLength > facts.structure.maximumArrayLength ||
      facts.root.arrayLength > facts.structure.arrayElementCount
    )
  ) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["root", "arrayLength"], message: "array root length exceeds JSON structure aggregates" });
  }
  if (
    (facts.structure.objectMemberCount === 0 &&
      (facts.structure.maximumObjectMemberCount !== 0 ||
        facts.structure.distinctObjectKeyCount !== 0)) ||
    (facts.structure.objectMemberCount > 0 &&
      (facts.structure.objectCount === 0 ||
        facts.structure.maximumObjectMemberCount === 0 ||
        facts.structure.distinctObjectKeyCount === 0)) ||
    (facts.structure.arrayElementCount === 0 &&
      facts.structure.maximumArrayLength !== 0) ||
    (facts.structure.arrayElementCount > 0 &&
      (facts.structure.arrayCount === 0 ||
        facts.structure.maximumArrayLength === 0))
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["structure"],
      message: "JSON container zero/nonzero aggregates are inconsistent",
    });
  }
  const emptyObjectRoot = facts.root.kind === "object" &&
    facts.root.objectKeys?.length === 0;
  const emptyArrayRoot = facts.root.kind === "array" &&
    facts.root.arrayLength === 0;
  const scalarRoot = facts.root.kind !== "object" && facts.root.kind !== "array";
  if (emptyObjectRoot || emptyArrayRoot || scalarRoot) {
    const expectedObjectCount = emptyObjectRoot ? 1 : 0;
    const expectedArrayCount = emptyArrayRoot ? 1 : 0;
    const expectedStringCount = facts.root.kind === "string" ? 1 : 0;
    const expectedNumberCount = facts.root.kind === "number" ? 1 : 0;
    const expectedBooleanCount = facts.root.kind === "boolean" ? 1 : 0;
    const expectedNullCount = facts.root.kind === "null" ? 1 : 0;
    if (
      facts.structure.valueCount !== 1 ||
      facts.structure.maximumDepth !== 1 ||
      facts.structure.objectCount !== expectedObjectCount ||
      facts.structure.arrayCount !== expectedArrayCount ||
      facts.structure.stringValueCount !== expectedStringCount ||
      facts.structure.numberCount !== expectedNumberCount ||
      facts.structure.booleanCount !== expectedBooleanCount ||
      facts.structure.nullCount !== expectedNullCount ||
      facts.structure.objectMemberCount !== 0 ||
      facts.structure.arrayElementCount !== 0 ||
      facts.structure.maximumObjectMemberCount !== 0 ||
      facts.structure.maximumArrayLength !== 0 ||
      facts.structure.distinctObjectKeyCount !== 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["root"],
        message: "empty-container and scalar JSON roots must describe exactly one root value",
      });
    }
  }
});

export const FoundryCalibrationTrajectorySourceFactsSchema = z.union([
  FoundryCalibrationTrajectoryCsvSourceFactsSchema,
  FoundryCalibrationTrajectoryJsonSourceFactsSchema,
]);
export type FoundryCalibrationTrajectorySourceFacts = z.infer<
  typeof FoundryCalibrationTrajectorySourceFactsSchema
>;

const SourceBindingSchema = z.object({
  sourceSha256: z.string().regex(SHA256),
  sourceSizeBytes: z.number().int().safe().nonnegative(),
}).strict();

const FoundryCalibrationTrajectorySourceFactsFailureOutcomeSchema = SourceBindingSchema.extend({
  state: z.literal("facts_not_established"),
  category: z.enum(["cancelled", "parse_failure", "resource_limit", "unsupported_variant"]),
  code: z.enum(FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_FACTS_FAILURE_CODES),
}).strict().superRefine((outcome, ctx) => {
  if (
    FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE[outcome.code] !==
    outcome.category
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["code"],
      message: "calibration/trajectory failure code and category must match the frozen registry",
    });
  }
});

const FoundryCalibrationTrajectorySourceFactsEstablishedOutcomeSchema = SourceBindingSchema.extend({
  state: z.literal("established"),
  facts: FoundryCalibrationTrajectorySourceFactsSchema,
}).strict().superRefine((outcome, ctx) => {
  if (outcome.sourceSizeBytes !== outcome.facts.container.sourceSizeBytes) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceSizeBytes"],
      message: "established source binding size must match the inspected facts container",
    });
  }
  if (outcome.sourceSha256 !== outcome.facts.container.sourceSha256) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sourceSha256"],
      message: "established source binding SHA-256 must match the inspected facts container",
    });
  }
});

export const FoundryCalibrationTrajectorySourceFactsOutcomeSchema = z.union([
  FoundryCalibrationTrajectorySourceFactsEstablishedOutcomeSchema,
  FoundryCalibrationTrajectorySourceFactsFailureOutcomeSchema,
]);
export type FoundryCalibrationTrajectorySourceFactsOutcome = z.infer<
  typeof FoundryCalibrationTrajectorySourceFactsOutcomeSchema
>;

type FailureCategory = FoundryCalibrationTrajectorySourceFactsFailureCategory;
type FailureCode = FoundryCalibrationTrajectorySourceFactsFailureCode;

class CalibrationTrajectoryInspectionFailure extends Error {
  constructor(
    readonly category: FailureCategory,
    readonly code: FailureCode,
  ) {
    super(code);
    this.name = "CalibrationTrajectoryInspectionFailure";
  }
}

function fail(category: FailureCategory, code: FailureCode): never {
  if (FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE[code] !== category) {
    throw new CalibrationTrajectoryInspectionFailure(
      "parse_failure",
      "CALIBRATION_TRAJECTORY_INSPECTION_FAILED",
    );
  }
  throw new CalibrationTrajectoryInspectionFailure(category, code);
}

function assertNotCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    fail("cancelled", "CALIBRATION_TRAJECTORY_INSPECTION_CANCELLED");
  }
}

type FileStat = Awaited<ReturnType<FileHandle["stat"]>>;

function sameFileIdentity(left: FileStat, right: FileStat): boolean {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs;
}

async function statHandle(handle: FileHandle, signal: AbortSignal | undefined): Promise<FileStat> {
  try {
    assertNotCancelled(signal);
    const value = await handle.stat();
    assertNotCancelled(signal);
    return value;
  } catch (error: unknown) {
    if (error instanceof CalibrationTrajectoryInspectionFailure) throw error;
    fail("parse_failure", "CALIBRATION_TRAJECTORY_HANDLE_READ_FAILED");
  }
}

async function readExactSource(
  handle: FileHandle,
  fileSize: number,
  signal: AbortSignal | undefined,
): Promise<{ readonly bytes: Buffer; readonly sha256: string }> {
  const bytes = Buffer.allocUnsafe(fileSize);
  const digest = createHash("sha256");
  let offset = 0;
  try {
    while (offset < fileSize) {
      assertNotCancelled(signal);
      const requested = Math.min(
        FOUNDRY_CALIBRATION_TRAJECTORY_READ_CHUNK_BYTES,
        fileSize - offset,
      );
      const { bytesRead } = await handle.read(bytes, offset, requested, offset);
      assertNotCancelled(signal);
      if (bytesRead <= 0) {
        fail("parse_failure", "CALIBRATION_TRAJECTORY_SOURCE_SIZE_MISMATCH");
      }
      digest.update(bytes.subarray(offset, offset + bytesRead));
      offset += bytesRead;
    }
  } catch (error: unknown) {
    if (error instanceof CalibrationTrajectoryInspectionFailure) throw error;
    fail("parse_failure", "CALIBRATION_TRAJECTORY_HANDLE_READ_FAILED");
  }
  return { bytes, sha256: digest.digest("hex") };
}

interface DecodedDocument {
  readonly bom: "absent" | "present";
  readonly text: string;
}

function assertPhysicalLineLimit(bytes: Buffer): void {
  let lineBytes = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];
    if (byte === 0x0d) {
      if (bytes[index + 1] === 0x0a) index += 1;
      lineBytes = 0;
      continue;
    }
    if (byte === 0x0a) {
      lineBytes = 0;
      continue;
    }
    lineBytes += 1;
    if (lineBytes > FOUNDRY_CALIBRATION_TRAJECTORY_LINE_MAX_BYTES) {
      fail("resource_limit", "CALIBRATION_TRAJECTORY_DOCUMENT_LINE_LIMIT_EXCEEDED");
    }
  }
}

function decodeDocument(bytes: Buffer): DecodedDocument {
  const hasBom = bytes.length >= 3 &&
    bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const payload = hasBom ? bytes.subarray(3) : bytes;
  if (payload.length === 0) {
    fail("parse_failure", "CALIBRATION_TRAJECTORY_DOCUMENT_EMPTY");
  }
  assertPhysicalLineLimit(payload);
  try {
    return {
      bom: hasBom ? "present" : "absent",
      text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(payload),
    };
  } catch {
    fail("parse_failure", "CALIBRATION_TRAJECTORY_DOCUMENT_UTF8_INVALID");
  }
}

const JSON_NUMBER_AT_START = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u;

function isCsvDecimalLexeme(value: string): boolean {
  let index = 0;
  if (value[index] === "+" || value[index] === "-") index += 1;
  const integerStart = index;
  while (index < value.length && value.charCodeAt(index) >= 48 && value.charCodeAt(index) <= 57) {
    index += 1;
  }
  const integerDigits = index - integerStart;
  let fractionDigits = 0;
  if (value[index] === ".") {
    index += 1;
    const fractionStart = index;
    while (index < value.length && value.charCodeAt(index) >= 48 && value.charCodeAt(index) <= 57) {
      index += 1;
    }
    fractionDigits = index - fractionStart;
  }
  if (integerDigits === 0 && fractionDigits === 0) return false;
  if (value[index] === "e" || value[index] === "E") {
    index += 1;
    if (value[index] === "+" || value[index] === "-") index += 1;
    const exponentStart = index;
    while (index < value.length && value.charCodeAt(index) >= 48 && value.charCodeAt(index) <= 57) {
      index += 1;
    }
    if (index === exponentStart) return false;
  }
  return index === value.length;
}

interface NormalizedDecimal {
  readonly negative: boolean;
  readonly zero: boolean;
  readonly significant: string;
  readonly order: bigint;
}

function normalizeDecimal(lexeme: string): NormalizedDecimal {
  let body = lexeme;
  let negative = false;
  if (body[0] === "-" || body[0] === "+") {
    negative = body[0] === "-";
    body = body.slice(1);
  }
  const exponentMarker = Math.max(body.indexOf("e"), body.indexOf("E"));
  const mantissa = exponentMarker === -1 ? body : body.slice(0, exponentMarker);
  const exponentText = exponentMarker === -1 ? "0" : body.slice(exponentMarker + 1);
  const point = mantissa.indexOf(".");
  const fractionLength = point === -1 ? 0 : mantissa.length - point - 1;
  const digits = mantissa.replace(".", "");
  const firstNonZero = /[1-9]/u.exec(digits)?.index ?? -1;
  if (firstNonZero === -1) {
    return { negative, zero: true, significant: "0", order: 0n };
  }
  const significant = digits.slice(firstNonZero);
  const exponent = BigInt(exponentText);
  const order = exponent - BigInt(fractionLength) + BigInt(significant.length);
  return { negative, zero: false, significant, order };
}

function compareDecimalMagnitude(left: NormalizedDecimal, right: NormalizedDecimal): number {
  if (left.order < right.order) return -1;
  if (left.order > right.order) return 1;
  const width = Math.max(left.significant.length, right.significant.length);
  const leftDigits = left.significant.padEnd(width, "0");
  const rightDigits = right.significant.padEnd(width, "0");
  if (leftDigits < rightDigits) return -1;
  if (leftDigits > rightDigits) return 1;
  return 0;
}

function compareDecimalLexemes(leftLexeme: string, rightLexeme: string): number {
  const left = normalizeDecimal(leftLexeme);
  const right = normalizeDecimal(rightLexeme);
  if (left.zero && right.zero) return 0;
  if (left.zero) return right.negative ? 1 : -1;
  if (right.zero) return left.negative ? -1 : 1;
  if (left.negative !== right.negative) return left.negative ? -1 : 1;
  const magnitude = compareDecimalMagnitude(left, right);
  return left.negative ? -magnitude : magnitude;
}

interface MutableDecimalSummary {
  count: number;
  firstLexeme: string | null;
  lastLexeme: string | null;
  minimumLexeme: string | null;
  maximumLexeme: string | null;
  integerLexemeCount: number;
  fractionLexemeCount: number;
  exponentLexemeCount: number;
  negativeZeroLexemeCount: number;
}

function emptyDecimalSummary(): MutableDecimalSummary {
  return {
    count: 0,
    firstLexeme: null,
    lastLexeme: null,
    minimumLexeme: null,
    maximumLexeme: null,
    integerLexemeCount: 0,
    fractionLexemeCount: 0,
    exponentLexemeCount: 0,
    negativeZeroLexemeCount: 0,
  };
}

function addDecimalLexeme(summary: MutableDecimalSummary, lexeme: string): void {
  if (lexeme.length > FOUNDRY_CALIBRATION_TRAJECTORY_NUMBER_LEXEME_MAX_CODE_UNITS) {
    fail("resource_limit", "CALIBRATION_TRAJECTORY_CSV_NUMBER_LIMIT_EXCEEDED");
  }
  summary.count += 1;
  summary.firstLexeme ??= lexeme;
  summary.lastLexeme = lexeme;
  if (summary.minimumLexeme === null || compareDecimalLexemes(lexeme, summary.minimumLexeme) < 0) {
    summary.minimumLexeme = lexeme;
  }
  if (summary.maximumLexeme === null || compareDecimalLexemes(lexeme, summary.maximumLexeme) > 0) {
    summary.maximumLexeme = lexeme;
  }
  if (!lexeme.includes(".") && !/[eE]/u.test(lexeme)) summary.integerLexemeCount += 1;
  if (lexeme.includes(".")) summary.fractionLexemeCount += 1;
  if (/[eE]/u.test(lexeme)) summary.exponentLexemeCount += 1;
  if (lexeme.startsWith("-") && normalizeDecimal(lexeme).zero) {
    summary.negativeZeroLexemeCount += 1;
  }
}

function addJsonNumberLexeme(summary: MutableDecimalSummary, lexeme: string): void {
  if (lexeme.length > FOUNDRY_CALIBRATION_TRAJECTORY_NUMBER_LEXEME_MAX_CODE_UNITS) {
    fail("resource_limit", "CALIBRATION_TRAJECTORY_JSON_NUMBER_LIMIT_EXCEEDED");
  }
  summary.count += 1;
  summary.firstLexeme ??= lexeme;
  summary.lastLexeme = lexeme;
  if (summary.minimumLexeme === null || compareDecimalLexemes(lexeme, summary.minimumLexeme) < 0) {
    summary.minimumLexeme = lexeme;
  }
  if (summary.maximumLexeme === null || compareDecimalLexemes(lexeme, summary.maximumLexeme) > 0) {
    summary.maximumLexeme = lexeme;
  }
  if (!lexeme.includes(".") && !/[eE]/u.test(lexeme)) summary.integerLexemeCount += 1;
  if (lexeme.includes(".")) summary.fractionLexemeCount += 1;
  if (/[eE]/u.test(lexeme)) summary.exponentLexemeCount += 1;
  if (lexeme.startsWith("-") && normalizeDecimal(lexeme).zero) {
    summary.negativeZeroLexemeCount += 1;
  }
}

interface CsvParsedField {
  readonly value: string;
  readonly quoted: boolean;
  readonly multiline: boolean;
}

interface MutableCsvColumn {
  ordinal: number;
  observedFieldCount: number;
  emptyFieldCount: number;
  nonDecimalFieldCount: number;
  decimals: MutableDecimalSummary;
}

function parseCsv(
  decoded: DecodedDocument,
  sourceSizeBytes: number,
  sourceSha256: string,
): FoundryCalibrationTrajectorySourceFacts {
  const shape = createHash("sha256");
  const columns: MutableCsvColumn[] = [];
  let currentValue = "";
  let currentQuoted = false;
  let currentMultiline = false;
  let inQuotes = false;
  let afterClosingQuote = false;
  let record: CsvParsedField[] = [];
  let recordSourceCodeUnits = 0;
  let recordCount = 0;
  let minimumFieldCount = Number.POSITIVE_INFINITY;
  let maximumFieldCount = 0;
  let blankCount = 0;
  const boundaryRecords: { firstFields: string[] | null; lastFields: string[] } = {
    firstFields: null,
    lastFields: [],
  };
  let fieldCount = 0;
  let emptyFieldCount = 0;
  let quotedFieldCount = 0;
  let multilineFieldCount = 0;
  let maximumFieldCodeUnits = 0;
  let crlfCount = 0;
  let lfCount = 0;
  let crCount = 0;
  const termination = { trailingRecordBreak: false };

  const append = (value: string): void => {
    currentValue += value;
    if (currentValue.length > FOUNDRY_CALIBRATION_TRAJECTORY_STRING_MAX_CODE_UNITS) {
      fail("resource_limit", "CALIBRATION_TRAJECTORY_CSV_STRING_LIMIT_EXCEEDED");
    }
  };

  const finishField = (): void => {
    if (record.length >= FOUNDRY_CALIBRATION_TRAJECTORY_CSV_FIELD_MAX_COUNT) {
      fail("resource_limit", "CALIBRATION_TRAJECTORY_CSV_FIELD_LIMIT_EXCEEDED");
    }
    record.push({ value: currentValue, quoted: currentQuoted, multiline: currentMultiline });
    currentValue = "";
    currentQuoted = false;
    currentMultiline = false;
    afterClosingQuote = false;
  };

  const finishRecord = (): void => {
    if (recordCount >= FOUNDRY_CALIBRATION_TRAJECTORY_CSV_RECORD_MAX_COUNT) {
      fail("resource_limit", "CALIBRATION_TRAJECTORY_CSV_RECORD_LIMIT_EXCEEDED");
    }
    if (record.length === 0) {
      fail("parse_failure", "CALIBRATION_TRAJECTORY_DOCUMENT_MALFORMED");
    }
    recordCount += 1;
    if (
      fieldCount + record.length >
      FOUNDRY_CALIBRATION_TRAJECTORY_CSV_AGGREGATE_FIELD_MAX_COUNT
    ) {
      fail(
        "resource_limit",
        "CALIBRATION_TRAJECTORY_CSV_AGGREGATE_FIELD_LIMIT_EXCEEDED",
      );
    }
    fieldCount += record.length;
    minimumFieldCount = Math.min(minimumFieldCount, record.length);
    maximumFieldCount = Math.max(maximumFieldCount, record.length);
    const values = record.map((field) => field.value);
    boundaryRecords.firstFields ??= [...values];
    boundaryRecords.lastFields = [...values];
    if (values.every((value) => value.length === 0)) blankCount += 1;
    shape.update(`R${String(record.length)}:`);

    for (const [ordinal, field] of record.entries()) {
      let column = columns[ordinal];
      if (column === undefined) {
        column = {
          ordinal,
          observedFieldCount: 0,
          emptyFieldCount: 0,
          nonDecimalFieldCount: 0,
          decimals: emptyDecimalSummary(),
        };
        columns[ordinal] = column;
      }
      column.observedFieldCount += 1;
      maximumFieldCodeUnits = Math.max(maximumFieldCodeUnits, field.value.length);
      if (field.quoted) quotedFieldCount += 1;
      if (field.multiline) multilineFieldCount += 1;
      if (field.value.length === 0) {
        emptyFieldCount += 1;
        column.emptyFieldCount += 1;
        shape.update(field.quoted ? "QE;" : "UE;");
      } else {
        const isDecimal = isCsvDecimalLexeme(field.value);
        if (isDecimal &&
          field.value.length > FOUNDRY_CALIBRATION_TRAJECTORY_NUMBER_LEXEME_MAX_CODE_UNITS) {
          fail("resource_limit", "CALIBRATION_TRAJECTORY_CSV_NUMBER_LIMIT_EXCEEDED");
        }
        if (isDecimal) {
          addDecimalLexeme(column.decimals, field.value);
          shape.update(field.quoted ? "QD;" : "UD;");
        } else {
          column.nonDecimalFieldCount += 1;
          shape.update(field.quoted ? "QT;" : "UT;");
        }
      }
      if (field.multiline) shape.update("M;");
    }
    record = [];
    recordSourceCodeUnits = 0;
  };

  const consumeLineBreak = (kind: "cr" | "crlf" | "lf", insideQuotedField: boolean): void => {
    if (kind === "crlf") crlfCount += 1;
    else if (kind === "lf") lfCount += 1;
    else crCount += 1;
    if (insideQuotedField) {
      currentMultiline = true;
      append(kind === "crlf" ? "\r\n" : kind === "lf" ? "\n" : "\r");
      termination.trailingRecordBreak = false;
      return;
    }
    finishField();
    finishRecord();
    termination.trailingRecordBreak = true;
  };

  for (let index = 0; index < decoded.text.length; index += 1) {
    const character = decoded.text[index];
    if (character === undefined) {
      fail("parse_failure", "CALIBRATION_TRAJECTORY_DOCUMENT_MALFORMED");
    }
    if (character === "\u0000") {
      fail("parse_failure", "CALIBRATION_TRAJECTORY_CSV_NUL_BYTE");
    }
    const crlf = character === "\r" && decoded.text[index + 1] === "\n";
    const sourceWidth = crlf ? 2 : 1;
    recordSourceCodeUnits += sourceWidth;
    if (recordSourceCodeUnits > FOUNDRY_CALIBRATION_TRAJECTORY_CSV_RECORD_MAX_CODE_UNITS) {
      fail("resource_limit", "CALIBRATION_TRAJECTORY_CSV_RECORD_SIZE_LIMIT_EXCEEDED");
    }

    if (inQuotes) {
      if (character === "\"") {
        if (decoded.text[index + 1] === "\"") {
          append("\"");
          index += 1;
          recordSourceCodeUnits += 1;
        } else {
          inQuotes = false;
          afterClosingQuote = true;
        }
        termination.trailingRecordBreak = false;
        continue;
      }
      if (character === "\r" || character === "\n") {
        consumeLineBreak(crlf ? "crlf" : character === "\n" ? "lf" : "cr", true);
        if (crlf) index += 1;
        continue;
      }
      append(character);
      termination.trailingRecordBreak = false;
      continue;
    }

    if (afterClosingQuote) {
      if (character === ",") {
        finishField();
        termination.trailingRecordBreak = false;
        continue;
      }
      if (character === "\r" || character === "\n") {
        consumeLineBreak(crlf ? "crlf" : character === "\n" ? "lf" : "cr", false);
        if (crlf) index += 1;
        continue;
      }
      fail("parse_failure", "CALIBRATION_TRAJECTORY_DOCUMENT_MALFORMED");
    }

    if (character === "\"") {
      if (currentValue.length !== 0) {
        fail("parse_failure", "CALIBRATION_TRAJECTORY_DOCUMENT_MALFORMED");
      }
      inQuotes = true;
      currentQuoted = true;
      termination.trailingRecordBreak = false;
      continue;
    }
    if (character === ",") {
      finishField();
      termination.trailingRecordBreak = false;
      continue;
    }
    if (character === "\r" || character === "\n") {
      consumeLineBreak(crlf ? "crlf" : character === "\n" ? "lf" : "cr", false);
      if (crlf) index += 1;
      continue;
    }
    append(character);
    termination.trailingRecordBreak = false;
  }

  if (inQuotes) {
    fail("parse_failure", "CALIBRATION_TRAJECTORY_DOCUMENT_MALFORMED");
  }
  if (!termination.trailingRecordBreak) {
    finishField();
    finishRecord();
  }
  if (recordCount === 0 || boundaryRecords.firstFields === null || columns.length === 0) {
    fail("parse_failure", "CALIBRATION_TRAJECTORY_DOCUMENT_EMPTY");
  }

  return FoundryCalibrationTrajectoryCsvSourceFactsSchema.parse({
    format: "csv",
    profile: "utf8_csv_record_structure_v0",
    inspectionCoverage: "complete_record_structure",
    encoding: { name: "utf-8", bom: decoded.bom },
    records: {
      count: recordCount,
      uniformFieldCount: minimumFieldCount === maximumFieldCount,
      minimumFieldCount,
      maximumFieldCount,
      blankCount,
      firstFields: boundaryRecords.firstFields,
      lastFields: boundaryRecords.lastFields,
    },
    fields: {
      count: fieldCount,
      emptyCount: emptyFieldCount,
      quotedCount: quotedFieldCount,
      multilineCount: multilineFieldCount,
      maximumCodeUnits: maximumFieldCodeUnits,
    },
    lineBreaks: { crlfCount, lfCount, crCount, trailing: termination.trailingRecordBreak },
    columns,
    shapeSha256: shape.digest("hex"),
    container: {
      sourceSizeBytes,
      sourceSha256,
      exactFileLengthVerified: true,
      sourceSha256Verified: true,
    },
    limitations: FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_FACTS_LIMITATIONS,
  });
}

type JsonRootKind = z.infer<typeof JsonRootKindSchema>;

interface ParsedJsonRoot {
  readonly kind: JsonRootKind;
  readonly objectKeys: readonly string[] | null;
  readonly arrayLength: number | null;
}

function isJsonWhitespace(code: number): boolean {
  return code === 0x09 || code === 0x0a || code === 0x0d || code === 0x20;
}

function hasValidUnicodeScalars(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

class BoundedJsonShapeParser {
  private index = 0;
  private valueCount = 0;
  private maximumDepth = 0;
  private objectCount = 0;
  private arrayCount = 0;
  private stringValueCount = 0;
  private numberCount = 0;
  private booleanCount = 0;
  private nullCount = 0;
  private objectMemberCount = 0;
  private arrayElementCount = 0;
  private maximumObjectMemberCount = 0;
  private maximumArrayLength = 0;
  private readonly distinctKeys = new Set<string>();
  private stringMinimumCodeUnits: number | null = null;
  private stringMaximumCodeUnits: number | null = null;
  private readonly numbers = emptyDecimalSummary();
  private readonly shape = createHash("sha256");

  constructor(private readonly text: string) {}

  parse(
    sourceSizeBytes: number,
    sourceSha256: string,
    bom: DecodedDocument["bom"],
  ): FoundryCalibrationTrajectorySourceFacts {
    this.skipWhitespace();
    if (this.index === this.text.length) {
      fail("parse_failure", "CALIBRATION_TRAJECTORY_DOCUMENT_EMPTY");
    }
    const root = this.parseValue(1, true);
    this.skipWhitespace();
    if (this.index !== this.text.length) {
      fail("parse_failure", "CALIBRATION_TRAJECTORY_DOCUMENT_MALFORMED");
    }
    return FoundryCalibrationTrajectoryJsonSourceFactsSchema.parse({
      format: "json",
      profile: "bounded_json_syntax_shape_v0",
      inspectionCoverage: "complete_syntax_and_shape",
      encoding: { name: "utf-8", bom },
      root,
      structure: {
        valueCount: this.valueCount,
        maximumDepth: this.maximumDepth,
        objectCount: this.objectCount,
        arrayCount: this.arrayCount,
        stringValueCount: this.stringValueCount,
        numberCount: this.numberCount,
        booleanCount: this.booleanCount,
        nullCount: this.nullCount,
        objectMemberCount: this.objectMemberCount,
        arrayElementCount: this.arrayElementCount,
        maximumObjectMemberCount: this.maximumObjectMemberCount,
        maximumArrayLength: this.maximumArrayLength,
        distinctObjectKeyCount: this.distinctKeys.size,
        shapeSha256: this.shape.digest("hex"),
      },
      strings: {
        valueCount: this.stringValueCount,
        minimumCodeUnits: this.stringMinimumCodeUnits,
        maximumCodeUnits: this.stringMaximumCodeUnits,
      },
      numbers: this.numbers,
      container: {
        sourceSizeBytes,
        sourceSha256,
        exactFileLengthVerified: true,
        sourceSha256Verified: true,
      },
      limitations: FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_FACTS_LIMITATIONS,
    });
  }

  private parseValue(depth: number, topLevel: boolean): ParsedJsonRoot {
    if (depth > FOUNDRY_CALIBRATION_TRAJECTORY_JSON_DEPTH_MAX) {
      fail("resource_limit", "CALIBRATION_TRAJECTORY_JSON_DEPTH_LIMIT_EXCEEDED");
    }
    this.valueCount += 1;
    if (this.valueCount > FOUNDRY_CALIBRATION_TRAJECTORY_JSON_VALUE_MAX_COUNT) {
      fail("resource_limit", "CALIBRATION_TRAJECTORY_JSON_VALUE_LIMIT_EXCEEDED");
    }
    this.maximumDepth = Math.max(this.maximumDepth, depth);
    const character = this.text[this.index];
    if (character === "{") return this.parseObject(depth, topLevel);
    if (character === "[") return this.parseArray(depth, topLevel);
    if (character === "\"") {
      const value = this.parseString();
      this.stringValueCount += 1;
      this.stringMinimumCodeUnits = this.stringMinimumCodeUnits === null
        ? value.length
        : Math.min(this.stringMinimumCodeUnits, value.length);
      this.stringMaximumCodeUnits = this.stringMaximumCodeUnits === null
        ? value.length
        : Math.max(this.stringMaximumCodeUnits, value.length);
      this.shape.update("S;");
      return { kind: "string", objectKeys: null, arrayLength: null };
    }
    if (this.take("true") || this.take("false")) {
      this.booleanCount += 1;
      this.shape.update("B;");
      return { kind: "boolean", objectKeys: null, arrayLength: null };
    }
    if (this.take("null")) {
      this.nullCount += 1;
      this.shape.update("N;");
      return { kind: "null", objectKeys: null, arrayLength: null };
    }
    const lexeme = this.parseNumber();
    this.numberCount += 1;
    addJsonNumberLexeme(this.numbers, lexeme);
    this.shape.update(lexeme.includes(".") ? "F;" : /[eE]/u.test(lexeme) ? "E;" : "I;");
    return { kind: "number", objectKeys: null, arrayLength: null };
  }

  private parseObject(depth: number, topLevel: boolean): ParsedJsonRoot {
    this.index += 1;
    this.objectCount += 1;
    this.shape.update("{");
    const localKeys = new Set<string>();
    const orderedKeys: string[] = [];
    let memberCount = 0;
    this.skipWhitespace();
    if (this.text[this.index] === "}") {
      this.index += 1;
      this.shape.update("}");
      return { kind: "object", objectKeys: topLevel ? orderedKeys : null, arrayLength: null };
    }
    while (this.index < this.text.length) {
      if (this.text[this.index] !== "\"") {
        fail("parse_failure", "CALIBRATION_TRAJECTORY_DOCUMENT_MALFORMED");
      }
      const key = this.parseString();
      if (localKeys.has(key)) {
        fail("parse_failure", "CALIBRATION_TRAJECTORY_JSON_DUPLICATE_KEY");
      }
      localKeys.add(key);
      orderedKeys.push(key);
      this.distinctKeys.add(key);
      if (this.distinctKeys.size > FOUNDRY_CALIBRATION_TRAJECTORY_JSON_DISTINCT_KEY_MAX_COUNT) {
        fail("resource_limit", "CALIBRATION_TRAJECTORY_JSON_DISTINCT_KEY_LIMIT_EXCEEDED");
      }
      memberCount += 1;
      this.objectMemberCount += 1;
      if (this.objectMemberCount > FOUNDRY_CALIBRATION_TRAJECTORY_JSON_MEMBER_MAX_COUNT) {
        fail("resource_limit", "CALIBRATION_TRAJECTORY_JSON_MEMBER_LIMIT_EXCEEDED");
      }
      if (memberCount > FOUNDRY_CALIBRATION_TRAJECTORY_JSON_CONTAINER_ENTRY_MAX_COUNT) {
        fail("resource_limit", "CALIBRATION_TRAJECTORY_JSON_CONTAINER_ENTRY_LIMIT_EXCEEDED");
      }
      this.shape.update(`K${String(Buffer.byteLength(key, "utf8"))}:`).update(key).update(";");
      this.skipWhitespace();
      if (this.text[this.index] !== ":") {
        fail("parse_failure", "CALIBRATION_TRAJECTORY_DOCUMENT_MALFORMED");
      }
      this.index += 1;
      this.skipWhitespace();
      this.parseValue(depth + 1, false);
      this.skipWhitespace();
      if (this.text[this.index] === "}") {
        this.index += 1;
        this.maximumObjectMemberCount = Math.max(this.maximumObjectMemberCount, memberCount);
        this.shape.update("}");
        return { kind: "object", objectKeys: topLevel ? orderedKeys : null, arrayLength: null };
      }
      if (this.text[this.index] !== ",") {
        fail("parse_failure", "CALIBRATION_TRAJECTORY_DOCUMENT_MALFORMED");
      }
      this.index += 1;
      this.skipWhitespace();
    }
    return fail("parse_failure", "CALIBRATION_TRAJECTORY_DOCUMENT_MALFORMED");
  }

  private parseArray(depth: number, topLevel: boolean): ParsedJsonRoot {
    this.index += 1;
    this.arrayCount += 1;
    this.shape.update("[");
    let elementCount = 0;
    this.skipWhitespace();
    if (this.text[this.index] === "]") {
      this.index += 1;
      this.shape.update("]");
      return { kind: "array", objectKeys: null, arrayLength: topLevel ? 0 : null };
    }
    while (this.index < this.text.length) {
      elementCount += 1;
      this.arrayElementCount += 1;
      if (this.arrayElementCount > FOUNDRY_CALIBRATION_TRAJECTORY_JSON_MEMBER_MAX_COUNT) {
        fail("resource_limit", "CALIBRATION_TRAJECTORY_JSON_MEMBER_LIMIT_EXCEEDED");
      }
      if (elementCount > FOUNDRY_CALIBRATION_TRAJECTORY_JSON_CONTAINER_ENTRY_MAX_COUNT) {
        fail("resource_limit", "CALIBRATION_TRAJECTORY_JSON_CONTAINER_ENTRY_LIMIT_EXCEEDED");
      }
      this.parseValue(depth + 1, false);
      this.skipWhitespace();
      if (this.text[this.index] === "]") {
        this.index += 1;
        this.maximumArrayLength = Math.max(this.maximumArrayLength, elementCount);
        this.shape.update("]");
        return { kind: "array", objectKeys: null, arrayLength: topLevel ? elementCount : null };
      }
      if (this.text[this.index] !== ",") {
        fail("parse_failure", "CALIBRATION_TRAJECTORY_DOCUMENT_MALFORMED");
      }
      this.index += 1;
      this.skipWhitespace();
    }
    return fail("parse_failure", "CALIBRATION_TRAJECTORY_DOCUMENT_MALFORMED");
  }

  private parseString(): string {
    const start = this.index;
    this.index += 1;
    let escaped = false;
    while (this.index < this.text.length) {
      const character = this.text[this.index];
      const code = this.text.charCodeAt(this.index);
      if (!escaped && character === "\"") {
        this.index += 1;
        let parsed: string;
        try {
          parsed = JSON.parse(this.text.slice(start, this.index)) as string;
        } catch {
          return fail("parse_failure", "CALIBRATION_TRAJECTORY_DOCUMENT_MALFORMED");
        }
        if (parsed.length > FOUNDRY_CALIBRATION_TRAJECTORY_STRING_MAX_CODE_UNITS) {
          fail("resource_limit", "CALIBRATION_TRAJECTORY_JSON_STRING_LIMIT_EXCEEDED");
        }
        if (!hasValidUnicodeScalars(parsed)) {
          fail("parse_failure", "CALIBRATION_TRAJECTORY_JSON_UNICODE_SCALAR_INVALID");
        }
        return parsed;
      }
      if (!escaped && code < 0x20) {
        fail("parse_failure", "CALIBRATION_TRAJECTORY_DOCUMENT_MALFORMED");
      }
      if (!escaped && character === "\\") escaped = true;
      else escaped = false;
      this.index += 1;
    }
    return fail("parse_failure", "CALIBRATION_TRAJECTORY_DOCUMENT_MALFORMED");
  }

  private parseNumber(): string {
    const match = JSON_NUMBER_AT_START.exec(this.text.slice(this.index));
    if (match === null) {
      fail("parse_failure", "CALIBRATION_TRAJECTORY_DOCUMENT_MALFORMED");
    }
    const lexeme = match[0];
    if (lexeme.length > FOUNDRY_CALIBRATION_TRAJECTORY_NUMBER_LEXEME_MAX_CODE_UNITS) {
      fail("resource_limit", "CALIBRATION_TRAJECTORY_JSON_NUMBER_LIMIT_EXCEEDED");
    }
    this.index += lexeme.length;
    return lexeme;
  }

  private take(keyword: string): boolean {
    if (!this.text.startsWith(keyword, this.index)) return false;
    this.index += keyword.length;
    return true;
  }

  private skipWhitespace(): void {
    while (isJsonWhitespace(this.text.charCodeAt(this.index))) this.index += 1;
  }
}

function parseJson(
  decoded: DecodedDocument,
  sourceSizeBytes: number,
  sourceSha256: string,
): FoundryCalibrationTrajectorySourceFacts {
  return new BoundedJsonShapeParser(decoded.text).parse(
    sourceSizeBytes,
    sourceSha256,
    decoded.bom,
  );
}

export interface FoundryCalibrationTrajectorySourceFactsSourceBinding {
  readonly sourceSha256: string;
  readonly sourceSizeBytes: number;
}

/**
 * Inspects one already-open, receipt-bound UTF-8 CSV or JSON handle. The
 * inspector never accepts or reopens a path. It verifies the complete byte
 * length and SHA-256 while reading from that handle, then reports syntax and
 * record/shape facts only. Numeric values remain exact source lexemes.
 */
export async function inspectCalibrationTrajectorySourceFacts(
  handle: FileHandle,
  fileSize: number,
  sourceSha256: string,
  format: FoundryCalibrationTrajectoryDocumentFormat,
  signal?: AbortSignal,
): Promise<FoundryCalibrationTrajectorySourceFactsOutcome> {
  const binding = SourceBindingSchema.parse({
    sourceSha256,
    sourceSizeBytes: fileSize,
  });
  try {
    assertNotCancelled(signal);
    if (fileSize > FOUNDRY_CALIBRATION_TRAJECTORY_SOURCE_MAX_BYTES) {
      fail("resource_limit", "CALIBRATION_TRAJECTORY_SOURCE_SIZE_LIMIT_EXCEEDED");
    }
    const parsedFormat = FoundryCalibrationTrajectoryDocumentFormatSchema.safeParse(format);
    if (!parsedFormat.success) {
      fail("unsupported_variant", "CALIBRATION_TRAJECTORY_DOCUMENT_EXTENSION_UNSUPPORTED");
    }
    const before = await statHandle(handle, signal);
    if (!before.isFile()) {
      fail("parse_failure", "CALIBRATION_TRAJECTORY_SOURCE_NOT_REGULAR");
    }
    if (before.size !== fileSize) {
      fail("parse_failure", "CALIBRATION_TRAJECTORY_SOURCE_SIZE_MISMATCH");
    }
    const source = await readExactSource(handle, fileSize, signal);
    const afterRead = await statHandle(handle, signal);
    if (!sameFileIdentity(before, afterRead) || afterRead.size !== fileSize) {
      fail("parse_failure", "CALIBRATION_TRAJECTORY_SOURCE_CHANGED");
    }
    if (source.sha256 !== sourceSha256) {
      fail("parse_failure", "CALIBRATION_TRAJECTORY_SOURCE_SHA256_MISMATCH");
    }
    const decoded = decodeDocument(source.bytes);
    const facts = parsedFormat.data === "csv"
      ? parseCsv(decoded, fileSize, source.sha256)
      : parseJson(decoded, fileSize, source.sha256);
    assertNotCancelled(signal);
    const afterInspection = await statHandle(handle, signal);
    if (!sameFileIdentity(before, afterInspection) || afterInspection.size !== fileSize) {
      fail("parse_failure", "CALIBRATION_TRAJECTORY_SOURCE_CHANGED");
    }
    return FoundryCalibrationTrajectorySourceFactsOutcomeSchema.parse({
      ...binding,
      state: "established",
      facts,
    });
  } catch (error: unknown) {
    if (error instanceof CalibrationTrajectoryInspectionFailure) {
      return FoundryCalibrationTrajectorySourceFactsOutcomeSchema.parse({
        ...binding,
        state: "facts_not_established",
        category: error.category,
        code: error.code,
      });
    }
    return FoundryCalibrationTrajectorySourceFactsOutcomeSchema.parse({
      ...binding,
      state: "facts_not_established",
      category: "parse_failure",
      code: "CALIBRATION_TRAJECTORY_INSPECTION_FAILED",
    });
  }
}
