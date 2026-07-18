import type { FileHandle } from "node:fs/promises";
import {
  FOUNDRY_GAUSSIAN_PLY_COMMENT_MAX_COUNT,
  FOUNDRY_GAUSSIAN_PLY_ELEMENT_MAX_COUNT,
  FOUNDRY_GAUSSIAN_PLY_HEADER_LINE_MAX_BYTES,
  FOUNDRY_GAUSSIAN_PLY_HEADER_MAX_BYTES,
  FOUNDRY_GAUSSIAN_PLY_PROPERTY_MAX_COUNT,
  FOUNDRY_GAUSSIAN_PLY_SOURCE_MAX_BYTES,
  FOUNDRY_GAUSSIAN_PLY_VERTEX_MAX_COUNT,
  FOUNDRY_GAUSSIAN_PLY_VERTEX_STRIDE_MAX_BYTES,
} from "./gaussian-ply-source-facts.js";

export const FOUNDRY_POINT_PLY_SOURCE_MAX_BYTES =
  FOUNDRY_GAUSSIAN_PLY_SOURCE_MAX_BYTES;
export const FOUNDRY_POINT_PLY_HEADER_MAX_BYTES =
  FOUNDRY_GAUSSIAN_PLY_HEADER_MAX_BYTES;
export const FOUNDRY_POINT_PLY_HEADER_LINE_MAX_BYTES =
  FOUNDRY_GAUSSIAN_PLY_HEADER_LINE_MAX_BYTES;
export const FOUNDRY_POINT_PLY_ELEMENT_MAX_COUNT =
  FOUNDRY_GAUSSIAN_PLY_ELEMENT_MAX_COUNT;
export const FOUNDRY_POINT_PLY_PROPERTY_MAX_COUNT =
  FOUNDRY_GAUSSIAN_PLY_PROPERTY_MAX_COUNT;
export const FOUNDRY_POINT_PLY_COMMENT_MAX_COUNT =
  FOUNDRY_GAUSSIAN_PLY_COMMENT_MAX_COUNT;
export const FOUNDRY_POINT_PLY_VERTEX_MAX_COUNT =
  FOUNDRY_GAUSSIAN_PLY_VERTEX_MAX_COUNT;
export const FOUNDRY_POINT_PLY_VERTEX_STRIDE_MAX_BYTES =
  FOUNDRY_GAUSSIAN_PLY_VERTEX_STRIDE_MAX_BYTES;

export const FOUNDRY_POINT_PLY_SOURCE_FACTS_LIMITATIONS = Object.freeze([
  "POINT_ATTRIBUTE_VALUES_ARE_NOT_DECODED_OR_VALIDATED",
  "PROPERTY_NAMES_AND_FIXED_WIDTH_LAYOUT_DO_NOT_ESTABLISH_PROPERTY_SEMANTICS",
  "STRUCTURAL_FACTS_DO_NOT_ESTABLISH_PHYSICAL_BOUNDS_DENSITY_COMPLETENESS_OR_FITNESS",
  "STRUCTURAL_FACTS_DO_NOT_ESTABLISH_UNITS_SCALE_AXES_FRAME_CRS_ACCURACY_OR_REGISTRATION",
  "FORMAT_FACTS_DO_NOT_ESTABLISH_CAPTURE_ROLE_PROVENANCE_VISUAL_FIDELITY_RIGHTS_OR_AUTHORITY",
] as const);

export const FOUNDRY_POINT_PLY_SOURCE_FACTS_FAILURE_CODES = Object.freeze([
  "POINT_PLY_INSPECTION_CANCELLED",
  "POINT_PLY_CONTAINER_UNRECOGNIZED",
  "POINT_PLY_SOURCE_SIZE_INVALID",
  "POINT_PLY_SOURCE_SIZE_LIMIT_EXCEEDED",
  "POINT_PLY_HEADER_SIZE_LIMIT_EXCEEDED",
  "POINT_PLY_HEADER_LINE_LIMIT_EXCEEDED",
  "POINT_PLY_ELEMENT_LIMIT_EXCEEDED",
  "POINT_PLY_PROPERTY_LIMIT_EXCEEDED",
  "POINT_PLY_COMMENT_LIMIT_EXCEEDED",
  "POINT_PLY_VERTEX_COUNT_LIMIT_EXCEEDED",
  "POINT_PLY_LAYOUT_SIZE_LIMIT_EXCEEDED",
  "POINT_PLY_VERSION_UNSUPPORTED",
  "POINT_PLY_ASCII_ENCODING_UNSUPPORTED",
  "POINT_PLY_BINARY_BIG_ENDIAN_UNSUPPORTED",
  "POINT_PLY_COMPRESSED_LAYOUT_UNSUPPORTED",
  "POINT_PLY_DATA_ENCODING_UNSUPPORTED",
  "POINT_PLY_EXTRA_ELEMENT_UNSUPPORTED",
  "POINT_PLY_LIST_PROPERTY_UNSUPPORTED",
  "POINT_PLY_SCALAR_TYPE_UNSUPPORTED",
  "POINT_PLY_VERTEX_ELEMENT_MISSING",
  "POINT_PLY_MULTIPLE_VERTEX_ELEMENTS",
  "POINT_PLY_REQUIRED_POSITION_PROPERTY_MISSING",
  "POINT_PLY_GAUSSIAN_PROFILE_EXCLUDED",
  "POINT_PLY_PACKED_GAUSSIAN_PROFILE_EXCLUDED",
  "POINT_PLY_SOURCE_NOT_REGULAR",
  "POINT_PLY_SOURCE_SIZE_MISMATCH",
  "POINT_PLY_SOURCE_CHANGED",
  "POINT_PLY_HANDLE_READ_FAILED",
  "POINT_PLY_HEADER_TRUNCATED",
  "POINT_PLY_HEADER_ENCODING_INVALID",
  "POINT_PLY_HEADER_GRAMMAR_INVALID",
  "POINT_PLY_FORMAT_DECLARATION_INVALID",
  "POINT_PLY_VERTEX_COUNT_INVALID",
  "POINT_PLY_DUPLICATE_ELEMENT",
  "POINT_PLY_DUPLICATE_PROPERTY",
  "POINT_PLY_PAYLOAD_LENGTH_MISMATCH",
  "POINT_PLY_INSPECTION_FAILED",
] as const);

export type FoundryPlyPointCloudSourceFactsFailureCode =
  (typeof FOUNDRY_POINT_PLY_SOURCE_FACTS_FAILURE_CODES)[number];
export type FoundryPlyPointCloudSourceFactsFailureCategory =
  | "parse_failure"
  | "resource_limit"
  | "unsupported_variant"
  | "unsupported_container"
  | "cancelled";

export const FOUNDRY_POINT_PLY_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE =
  Object.freeze({
    POINT_PLY_INSPECTION_CANCELLED: "cancelled",
    POINT_PLY_CONTAINER_UNRECOGNIZED: "unsupported_container",
    POINT_PLY_SOURCE_SIZE_INVALID: "resource_limit",
    POINT_PLY_SOURCE_SIZE_LIMIT_EXCEEDED: "resource_limit",
    POINT_PLY_HEADER_SIZE_LIMIT_EXCEEDED: "resource_limit",
    POINT_PLY_HEADER_LINE_LIMIT_EXCEEDED: "resource_limit",
    POINT_PLY_ELEMENT_LIMIT_EXCEEDED: "resource_limit",
    POINT_PLY_PROPERTY_LIMIT_EXCEEDED: "resource_limit",
    POINT_PLY_COMMENT_LIMIT_EXCEEDED: "resource_limit",
    POINT_PLY_VERTEX_COUNT_LIMIT_EXCEEDED: "resource_limit",
    POINT_PLY_LAYOUT_SIZE_LIMIT_EXCEEDED: "resource_limit",
    POINT_PLY_VERSION_UNSUPPORTED: "unsupported_variant",
    POINT_PLY_ASCII_ENCODING_UNSUPPORTED: "unsupported_variant",
    POINT_PLY_BINARY_BIG_ENDIAN_UNSUPPORTED: "unsupported_variant",
    POINT_PLY_COMPRESSED_LAYOUT_UNSUPPORTED: "unsupported_variant",
    POINT_PLY_DATA_ENCODING_UNSUPPORTED: "unsupported_variant",
    POINT_PLY_EXTRA_ELEMENT_UNSUPPORTED: "unsupported_variant",
    POINT_PLY_LIST_PROPERTY_UNSUPPORTED: "unsupported_variant",
    POINT_PLY_SCALAR_TYPE_UNSUPPORTED: "unsupported_variant",
    POINT_PLY_VERTEX_ELEMENT_MISSING: "unsupported_variant",
    POINT_PLY_MULTIPLE_VERTEX_ELEMENTS: "unsupported_variant",
    POINT_PLY_REQUIRED_POSITION_PROPERTY_MISSING: "unsupported_variant",
    POINT_PLY_GAUSSIAN_PROFILE_EXCLUDED: "unsupported_variant",
    POINT_PLY_PACKED_GAUSSIAN_PROFILE_EXCLUDED: "unsupported_variant",
    POINT_PLY_SOURCE_NOT_REGULAR: "parse_failure",
    POINT_PLY_SOURCE_SIZE_MISMATCH: "parse_failure",
    POINT_PLY_SOURCE_CHANGED: "parse_failure",
    POINT_PLY_HANDLE_READ_FAILED: "parse_failure",
    POINT_PLY_HEADER_TRUNCATED: "parse_failure",
    POINT_PLY_HEADER_ENCODING_INVALID: "parse_failure",
    POINT_PLY_HEADER_GRAMMAR_INVALID: "parse_failure",
    POINT_PLY_FORMAT_DECLARATION_INVALID: "parse_failure",
    POINT_PLY_VERTEX_COUNT_INVALID: "parse_failure",
    POINT_PLY_DUPLICATE_ELEMENT: "parse_failure",
    POINT_PLY_DUPLICATE_PROPERTY: "parse_failure",
    POINT_PLY_PAYLOAD_LENGTH_MISMATCH: "parse_failure",
    POINT_PLY_INSPECTION_FAILED: "parse_failure",
  } as const satisfies Readonly<
    Record<
      FoundryPlyPointCloudSourceFactsFailureCode,
      FoundryPlyPointCloudSourceFactsFailureCategory
    >
  >);

export type FoundryPlyPointCloudScalarDeclaredType =
  | "char"
  | "int8"
  | "uchar"
  | "uint8"
  | "short"
  | "int16"
  | "ushort"
  | "uint16"
  | "int"
  | "int32"
  | "uint"
  | "uint32"
  | "float"
  | "float32"
  | "double"
  | "float64";

export type FoundryPlyPointCloudScalarCanonicalType =
  | "int8"
  | "uint8"
  | "int16"
  | "uint16"
  | "int32"
  | "uint32"
  | "float32"
  | "float64";

export interface FoundryPlyPointCloudPropertyFacts {
  readonly ordinal: number;
  readonly name: string;
  readonly declaredType: FoundryPlyPointCloudScalarDeclaredType;
  readonly canonicalType: FoundryPlyPointCloudScalarCanonicalType;
  readonly byteOffset: number;
  readonly byteWidth: 1 | 2 | 4 | 8;
}

export interface FoundryPlyPointCloudSourceFacts {
  readonly format: "ply_binary_little_endian";
  readonly profile: "ordinary_point_geometry_fixed_width_scalar";
  readonly inspectionCoverage:
    "complete_header_and_exact_fixed_width_payload_layout";
  readonly plyVersion: "1.0";
  readonly header: {
    readonly bytes: number;
    readonly lineEndings: "lf" | "crlf" | "mixed";
    readonly comments: {
      readonly count: number;
      readonly retainedVerbatim: false;
      readonly authoritative: false;
    };
    readonly objInfo: {
      readonly count: number;
      readonly retainedVerbatim: false;
      readonly authoritative: false;
    };
  };
  readonly vertices: {
    readonly count: number;
    readonly recordStrideBytes: number;
    readonly payloadBytes: number;
    readonly properties: readonly FoundryPlyPointCloudPropertyFacts[];
    readonly requiredCoordinateProperties: {
      readonly names: readonly ["x", "y", "z"];
      readonly ordinals: readonly [number, number, number];
      readonly byteOffsets: readonly [number, number, number];
      readonly canonicalTypes: readonly [
        FoundryPlyPointCloudScalarCanonicalType,
        FoundryPlyPointCloudScalarCanonicalType,
        FoundryPlyPointCloudScalarCanonicalType,
      ];
    };
    readonly additionalProperties: {
      readonly count: number;
      readonly names: readonly string[];
    };
  };
  readonly container: {
    readonly sourceSizeBytes: number;
    readonly headerBytes: number;
    readonly payloadOffsetBytes: number;
    readonly payloadBytes: number;
    readonly exactFileLengthVerified: true;
    readonly trailingBytes: 0;
  };
  readonly limitations: typeof FOUNDRY_POINT_PLY_SOURCE_FACTS_LIMITATIONS;
}

export interface FoundryPlyPointCloudSourceFactsSourceBinding {
  readonly sourceSha256: string;
  readonly sourceSizeBytes: number;
}

export type FoundryPlyPointCloudSourceFactsOutcome =
  FoundryPlyPointCloudSourceFactsSourceBinding & (
    | {
        readonly state: "established";
        readonly facts: FoundryPlyPointCloudSourceFacts;
      }
    | {
        readonly state: "facts_not_established";
        readonly category: FoundryPlyPointCloudSourceFactsFailureCategory;
        readonly code: FoundryPlyPointCloudSourceFactsFailureCode;
      }
  );

interface ScalarTypeFacts {
  readonly canonicalType: FoundryPlyPointCloudScalarCanonicalType;
  readonly byteWidth: 1 | 2 | 4 | 8;
}

const SCALAR_TYPES = Object.freeze({
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
} as const satisfies Readonly<
  Record<FoundryPlyPointCloudScalarDeclaredType, ScalarTypeFacts>
>);

type FailureCode = FoundryPlyPointCloudSourceFactsFailureCode;
type FailureCategory = FoundryPlyPointCloudSourceFactsFailureCategory;

const PLY_NAME = /^[\x21-\x7e]+$/u;
const DECIMAL_INTEGER = /^[0-9]+$/u;
const HEADER_READ_CHUNK_BYTES = 64 * 1024;
const PLAYCANVAS_PACKED_CHUNK_SIZE = 256;
const PLAYCANVAS_PACKED_REQUIRED_CHUNK_PROPERTIES = Object.freeze([
  "min_x", "min_y", "min_z",
  "max_x", "max_y", "max_z",
  "min_scale_x", "min_scale_y", "min_scale_z",
  "max_scale_x", "max_scale_y", "max_scale_z",
] as const);
const PLAYCANVAS_PACKED_COLOR_CHUNK_PROPERTIES = Object.freeze([
  "min_r", "min_g", "min_b",
  "max_r", "max_g", "max_b",
] as const);
const PLAYCANVAS_PACKED_VERTEX_PROPERTIES = Object.freeze([
  "packed_position",
  "packed_rotation",
  "packed_scale",
  "packed_color",
] as const);
const CLASSIC_GAUSSIAN_PROPERTIES = Object.freeze([
  "x", "y", "z",
  "f_dc_0", "f_dc_1", "f_dc_2",
  "opacity",
  "scale_0", "scale_1", "scale_2",
  "rot_0", "rot_1", "rot_2", "rot_3",
] as const);

class PointPlyInspectionFailure extends Error {
  constructor(
    readonly category: FailureCategory,
    readonly code: FailureCode,
  ) {
    super(code);
    this.name = "PointPlyInspectionFailure";
  }
}

function fail(category: FailureCategory, code: FailureCode): never {
  if (FOUNDRY_POINT_PLY_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE[code] !== category) {
    throw new PointPlyInspectionFailure(
      "parse_failure",
      "POINT_PLY_INSPECTION_FAILED",
    );
  }
  throw new PointPlyInspectionFailure(category, code);
}

function assertNotCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    fail("cancelled", "POINT_PLY_INSPECTION_CANCELLED");
  }
}

function sameFileIdentity(
  left: Awaited<ReturnType<FileHandle["stat"]>>,
  right: Awaited<ReturnType<FileHandle["stat"]>>,
): boolean {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs;
}

async function statHandle(
  handle: FileHandle,
  signal: AbortSignal | undefined,
): Promise<Awaited<ReturnType<FileHandle["stat"]>>> {
  try {
    assertNotCancelled(signal);
    const value = await handle.stat();
    assertNotCancelled(signal);
    return value;
  } catch (error: unknown) {
    if (error instanceof PointPlyInspectionFailure) throw error;
    fail("parse_failure", "POINT_PLY_HANDLE_READ_FAILED");
  }
}

async function readHeaderCapture(
  handle: FileHandle,
  fileSize: number,
  signal: AbortSignal | undefined,
): Promise<Buffer> {
  const length = Math.min(fileSize, FOUNDRY_POINT_PLY_HEADER_MAX_BYTES + 1);
  const output = Buffer.allocUnsafe(length);
  let completed = 0;
  try {
    while (completed < length) {
      assertNotCancelled(signal);
      const requested = Math.min(HEADER_READ_CHUNK_BYTES, length - completed);
      const { bytesRead } = await handle.read(
        output,
        completed,
        requested,
        completed,
      );
      assertNotCancelled(signal);
      if (bytesRead <= 0) {
        fail("parse_failure", "POINT_PLY_HANDLE_READ_FAILED");
      }
      completed += bytesRead;
    }
  } catch (error: unknown) {
    if (error instanceof PointPlyInspectionFailure) throw error;
    fail("parse_failure", "POINT_PLY_HANDLE_READ_FAILED");
  }
  return output;
}

interface CapturedHeader {
  readonly bytes: number;
  readonly lines: readonly string[];
  readonly lineEndings: "lf" | "crlf" | "mixed";
}

function asciiLine(bytes: Buffer): string {
  for (const byte of bytes) {
    if (byte === 0x09 || (byte >= 0x20 && byte <= 0x7e)) continue;
    fail("parse_failure", "POINT_PLY_HEADER_ENCODING_INVALID");
  }
  return bytes.toString("ascii");
}

function capturedLineEnding(
  lfCount: number,
  crlfCount: number,
): CapturedHeader["lineEndings"] {
  if (lfCount > 0 && crlfCount > 0) return "mixed";
  return crlfCount > 0 ? "crlf" : "lf";
}

function captureHeader(bytes: Buffer): CapturedHeader {
  const lines: string[] = [];
  let start = 0;
  let lfCount = 0;
  let crlfCount = 0;
  for (let cursor = 0; cursor < bytes.length; cursor += 1) {
    if (bytes[cursor] !== 0x0a) continue;
    let end = cursor;
    const isCrlf = end > start && bytes[end - 1] === 0x0d;
    if (isCrlf) end -= 1;
    if (end - start > FOUNDRY_POINT_PLY_HEADER_LINE_MAX_BYTES) {
      fail("resource_limit", "POINT_PLY_HEADER_LINE_LIMIT_EXCEEDED");
    }
    const line = asciiLine(bytes.subarray(start, end));
    lines.push(line);
    if (isCrlf) crlfCount += 1;
    else lfCount += 1;
    const headerBytes = cursor + 1;
    if (line.trim() === "end_header" && line !== "end_header") {
      fail("parse_failure", "POINT_PLY_HEADER_GRAMMAR_INVALID");
    }
    if (line === "end_header") {
      if (headerBytes > FOUNDRY_POINT_PLY_HEADER_MAX_BYTES) {
        fail("resource_limit", "POINT_PLY_HEADER_SIZE_LIMIT_EXCEEDED");
      }
      return {
        bytes: headerBytes,
        lines,
        lineEndings: capturedLineEnding(lfCount, crlfCount),
      };
    }
    start = cursor + 1;
  }
  if (bytes.length - start > FOUNDRY_POINT_PLY_HEADER_LINE_MAX_BYTES) {
    fail("resource_limit", "POINT_PLY_HEADER_LINE_LIMIT_EXCEEDED");
  }
  if (bytes.length > FOUNDRY_POINT_PLY_HEADER_MAX_BYTES) {
    fail("resource_limit", "POINT_PLY_HEADER_SIZE_LIMIT_EXCEEDED");
  }
  fail("parse_failure", "POINT_PLY_HEADER_TRUNCATED");
}

interface ParsedScalarProperty extends ScalarTypeFacts {
  readonly kind: "scalar";
  readonly name: string;
  readonly declaredType: FoundryPlyPointCloudScalarDeclaredType;
}

interface ParsedListProperty {
  readonly kind: "list";
  readonly name: string;
  readonly countType: FoundryPlyPointCloudScalarDeclaredType;
  readonly itemType: FoundryPlyPointCloudScalarDeclaredType;
}

type ParsedProperty = ParsedScalarProperty | ParsedListProperty;

interface ParsedElement {
  readonly name: string;
  readonly count: number;
  readonly properties: ParsedProperty[];
}

interface ParsedPointHeader {
  readonly vertex: ParsedElement & {
    readonly properties: ParsedScalarProperty[];
  };
  readonly commentCount: number;
  readonly objInfoCount: number;
}

function scalarType(
  type: string,
): ScalarTypeFacts & {
  readonly declaredType: FoundryPlyPointCloudScalarDeclaredType;
} {
  const declaredType = type as FoundryPlyPointCloudScalarDeclaredType;
  const facts = (SCALAR_TYPES as Partial<
    Record<FoundryPlyPointCloudScalarDeclaredType, ScalarTypeFacts>
  >)[declaredType];
  if (facts === undefined) {
    fail("unsupported_variant", "POINT_PLY_SCALAR_TYPE_UNSUPPORTED");
  }
  return { declaredType, ...facts };
}

function parseElementCount(name: string, token: string): number {
  if (!DECIMAL_INTEGER.test(token)) {
    fail(
      "parse_failure",
      name === "vertex"
        ? "POINT_PLY_VERTEX_COUNT_INVALID"
        : "POINT_PLY_HEADER_GRAMMAR_INVALID",
    );
  }
  const value = BigInt(token);
  if (name === "vertex") {
    if (value === 0n) {
      fail("parse_failure", "POINT_PLY_VERTEX_COUNT_INVALID");
    }
    if (value > BigInt(FOUNDRY_POINT_PLY_VERTEX_MAX_COUNT)) {
      fail("resource_limit", "POINT_PLY_VERTEX_COUNT_LIMIT_EXCEEDED");
    }
  }
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    fail("parse_failure", "POINT_PLY_HEADER_GRAMMAR_INVALID");
  }
  return Number(value);
}

function parseFormat(tokens: readonly string[]): void {
  if (tokens.length !== 3) {
    fail("parse_failure", "POINT_PLY_FORMAT_DECLARATION_INVALID");
  }
  const encoding = tokens[1] ?? "";
  const version = tokens[2] ?? "";
  if (encoding === "ascii") {
    fail("unsupported_variant", "POINT_PLY_ASCII_ENCODING_UNSUPPORTED");
  }
  if (encoding === "binary_big_endian") {
    fail(
      "unsupported_variant",
      "POINT_PLY_BINARY_BIG_ENDIAN_UNSUPPORTED",
    );
  }
  if (encoding === "binary_little_endian_compressed") {
    fail("unsupported_variant", "POINT_PLY_COMPRESSED_LAYOUT_UNSUPPORTED");
  }
  if (encoding !== "binary_little_endian") {
    fail("unsupported_variant", "POINT_PLY_DATA_ENCODING_UNSUPPORTED");
  }
  if (version !== "1.0") {
    fail("unsupported_variant", "POINT_PLY_VERSION_UNSUPPORTED");
  }
}

function parseElement(
  tokens: readonly string[],
  elements: ParsedElement[],
): ParsedElement {
  if (tokens.length !== 3 || !PLY_NAME.test(tokens[1] ?? "")) {
    fail("parse_failure", "POINT_PLY_HEADER_GRAMMAR_INVALID");
  }
  if (elements.length >= FOUNDRY_POINT_PLY_ELEMENT_MAX_COUNT) {
    fail("resource_limit", "POINT_PLY_ELEMENT_LIMIT_EXCEEDED");
  }
  const name = tokens[1] ?? "";
  if (elements.some((element) => element.name === name)) {
    fail(
      name === "vertex" ? "unsupported_variant" : "parse_failure",
      name === "vertex"
        ? "POINT_PLY_MULTIPLE_VERTEX_ELEMENTS"
        : "POINT_PLY_DUPLICATE_ELEMENT",
    );
  }
  return {
    name,
    count: parseElementCount(name, tokens[2] ?? ""),
    properties: [],
  };
}

function parseProperty(
  tokens: readonly string[],
  current: ParsedElement | undefined,
): ParsedProperty {
  if (current === undefined) {
    fail("parse_failure", "POINT_PLY_HEADER_GRAMMAR_INVALID");
  }
  const isList = tokens[1] === "list";
  const expectedLength = isList ? 5 : 3;
  const propertyName = tokens[isList ? 4 : 2] ?? "";
  if (tokens.length !== expectedLength || !PLY_NAME.test(propertyName)) {
    fail("parse_failure", "POINT_PLY_HEADER_GRAMMAR_INVALID");
  }
  if (current.properties.some((property) => property.name === propertyName)) {
    fail("parse_failure", "POINT_PLY_DUPLICATE_PROPERTY");
  }
  if (isList) {
    return {
      kind: "list",
      name: propertyName,
      countType: scalarType(tokens[2] ?? "").declaredType,
      itemType: scalarType(tokens[3] ?? "").declaredType,
    };
  }
  return {
    kind: "scalar",
    name: propertyName,
    ...scalarType(tokens[1] ?? ""),
  };
}

function parseHeaderDeclarations(
  header: CapturedHeader,
): {
  readonly elements: ParsedElement[];
  readonly commentCount: number;
  readonly objInfoCount: number;
} {
  const elements: ParsedElement[] = [];
  let current: ParsedElement | undefined;
  let propertyCount = 0;
  let commentCount = 0;
  let objInfoCount = 0;
  for (let index = 2; index < header.lines.length; index += 1) {
    const raw = header.lines[index] ?? "";
    const line = raw.trim();
    if (line === "end_header") break;
    if (line.length === 0) {
      fail("parse_failure", "POINT_PLY_HEADER_GRAMMAR_INVALID");
    }
    const tokens = line.split(/[ \t]+/u);
    const keyword = tokens[0];
    if (keyword === "comment" || keyword === "obj_info") {
      if (keyword === "comment") commentCount += 1;
      else objInfoCount += 1;
      if (commentCount + objInfoCount > FOUNDRY_POINT_PLY_COMMENT_MAX_COUNT) {
        fail("resource_limit", "POINT_PLY_COMMENT_LIMIT_EXCEEDED");
      }
      continue;
    }
    if (keyword === "format") {
      fail("parse_failure", "POINT_PLY_FORMAT_DECLARATION_INVALID");
    }
    if (keyword === "element") {
      current = parseElement(tokens, elements);
      elements.push(current);
      continue;
    }
    if (keyword === "property") {
      propertyCount += 1;
      if (propertyCount > FOUNDRY_POINT_PLY_PROPERTY_MAX_COUNT) {
        fail("resource_limit", "POINT_PLY_PROPERTY_LIMIT_EXCEEDED");
      }
      const property = parseProperty(tokens, current);
      current?.properties.push(property);
      continue;
    }
    fail("parse_failure", "POINT_PLY_HEADER_GRAMMAR_INVALID");
  }
  return { elements, commentCount, objInfoCount };
}

function hasExactScalarProperties(
  element: ParsedElement,
  names: readonly string[],
  canonicalType: FoundryPlyPointCloudScalarCanonicalType,
): boolean {
  if (element.properties.length !== names.length) return false;
  const byName = new Map(
    element.properties
      .filter(
        (property): property is ParsedScalarProperty =>
          property.kind === "scalar",
      )
      .map((property) => [property.name, property] as const),
  );
  return names.every(
    (name) => byName.get(name)?.canonicalType === canonicalType,
  );
}

function isPlayCanvasPackedLayout(elements: readonly ParsedElement[]): boolean {
  if (elements.length !== 2 && elements.length !== 3) return false;
  const chunk = elements.find((element) => element.name === "chunk");
  const vertex = elements.find((element) => element.name === "vertex");
  if (chunk === undefined || vertex === undefined) return false;
  const chunkProperties =
    chunk.properties.length ===
      PLAYCANVAS_PACKED_REQUIRED_CHUNK_PROPERTIES.length
      ? PLAYCANVAS_PACKED_REQUIRED_CHUNK_PROPERTIES
      : [
          ...PLAYCANVAS_PACKED_REQUIRED_CHUNK_PROPERTIES,
          ...PLAYCANVAS_PACKED_COLOR_CHUNK_PROPERTIES,
        ];
  if (
    !hasExactScalarProperties(chunk, chunkProperties, "float32") ||
    !hasExactScalarProperties(
      vertex,
      PLAYCANVAS_PACKED_VERTEX_PROPERTIES,
      "uint32",
    ) ||
    Math.ceil(vertex.count / PLAYCANVAS_PACKED_CHUNK_SIZE) !== chunk.count
  ) {
    return false;
  }
  if (elements.length === 2) return true;
  const sh = elements.find((element) => element.name === "sh");
  if (
    sh === undefined ||
    sh.count !== vertex.count ||
    ![9, 24, 45].includes(sh.properties.length)
  ) {
    return false;
  }
  return hasExactScalarProperties(
    sh,
    Array.from(
      { length: sh.properties.length },
      (_, index) => "f_rest_" + String(index),
    ),
    "uint8",
  );
}

function parsePointHeader(header: CapturedHeader): ParsedPointHeader {
  if (header.lines.length === 0 || header.lines[0] !== "ply") {
    fail("unsupported_container", "POINT_PLY_CONTAINER_UNRECOGNIZED");
  }
  if (header.lines.length < 3) {
    fail("parse_failure", "POINT_PLY_HEADER_TRUNCATED");
  }
  const formatTokens = header.lines[1]?.trim().split(/[ \t]+/u) ?? [];
  if (formatTokens[0] !== "format") {
    fail("parse_failure", "POINT_PLY_FORMAT_DECLARATION_INVALID");
  }
  parseFormat(formatTokens);
  const parsed = parseHeaderDeclarations(header);
  if (isPlayCanvasPackedLayout(parsed.elements)) {
    fail(
      "unsupported_variant",
      "POINT_PLY_PACKED_GAUSSIAN_PROFILE_EXCLUDED",
    );
  }
  const vertices = parsed.elements.filter(
    (element) => element.name === "vertex",
  );
  if (vertices.length === 0) {
    fail("unsupported_variant", "POINT_PLY_VERTEX_ELEMENT_MISSING");
  }
  if (vertices.length > 1) {
    fail("unsupported_variant", "POINT_PLY_MULTIPLE_VERTEX_ELEMENTS");
  }
  if (parsed.elements.length !== 1) {
    fail("unsupported_variant", "POINT_PLY_EXTRA_ELEMENT_UNSUPPORTED");
  }
  const vertex = vertices[0];
  if (vertex === undefined) {
    fail("unsupported_variant", "POINT_PLY_VERTEX_ELEMENT_MISSING");
  }
  if (vertex.properties.some((property) => property.kind === "list")) {
    fail("unsupported_variant", "POINT_PLY_LIST_PROPERTY_UNSUPPORTED");
  }
  const scalarProperties = vertex.properties.filter(
    (property): property is ParsedScalarProperty => property.kind === "scalar",
  );
  const names = new Set(scalarProperties.map((property) => property.name));
  if (CLASSIC_GAUSSIAN_PROPERTIES.every((name) => names.has(name))) {
    fail("unsupported_variant", "POINT_PLY_GAUSSIAN_PROFILE_EXCLUDED");
  }
  if (!["x", "y", "z"].every((name) => names.has(name))) {
    fail(
      "unsupported_variant",
      "POINT_PLY_REQUIRED_POSITION_PROPERTY_MISSING",
    );
  }
  return {
    vertex: { ...vertex, properties: scalarProperties },
    commentCount: parsed.commentCount,
    objInfoCount: parsed.objInfoCount,
  };
}

function propertyFacts(
  properties: readonly ParsedScalarProperty[],
): {
  readonly properties: FoundryPlyPointCloudPropertyFacts[];
  readonly recordStrideBytes: number;
} {
  const output: FoundryPlyPointCloudPropertyFacts[] = [];
  let byteOffset = 0;
  for (const [ordinal, property] of properties.entries()) {
    output.push({
      ordinal,
      name: property.name,
      declaredType: property.declaredType,
      canonicalType: property.canonicalType,
      byteOffset,
      byteWidth: property.byteWidth,
    });
    byteOffset += property.byteWidth;
    if (byteOffset > FOUNDRY_POINT_PLY_VERTEX_STRIDE_MAX_BYTES) {
      fail("resource_limit", "POINT_PLY_LAYOUT_SIZE_LIMIT_EXCEEDED");
    }
  }
  if (byteOffset <= 0) {
    fail("parse_failure", "POINT_PLY_HEADER_GRAMMAR_INVALID");
  }
  return { properties: output, recordStrideBytes: byteOffset };
}

function requiredCoordinateProperties(
  properties: readonly FoundryPlyPointCloudPropertyFacts[],
): FoundryPlyPointCloudSourceFacts["vertices"]["requiredCoordinateProperties"] {
  const x = properties.find((property) => property.name === "x");
  const y = properties.find((property) => property.name === "y");
  const z = properties.find((property) => property.name === "z");
  if (x === undefined || y === undefined || z === undefined) {
    fail(
      "unsupported_variant",
      "POINT_PLY_REQUIRED_POSITION_PROPERTY_MISSING",
    );
  }
  return {
    names: ["x", "y", "z"],
    ordinals: [x.ordinal, y.ordinal, z.ordinal],
    byteOffsets: [x.byteOffset, y.byteOffset, z.byteOffset],
    canonicalTypes: [x.canonicalType, y.canonicalType, z.canonicalType],
  };
}

function inspectLayout(
  header: CapturedHeader,
  parsed: ParsedPointHeader,
  fileSize: number,
): FoundryPlyPointCloudSourceFacts {
  const layout = propertyFacts(parsed.vertex.properties);
  const payloadBig =
    BigInt(parsed.vertex.count) * BigInt(layout.recordStrideBytes);
  if (
    payloadBig > BigInt(FOUNDRY_POINT_PLY_SOURCE_MAX_BYTES) ||
    payloadBig > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    fail("resource_limit", "POINT_PLY_LAYOUT_SIZE_LIMIT_EXCEEDED");
  }
  const payloadBytes = Number(payloadBig);
  if (BigInt(header.bytes) + payloadBig !== BigInt(fileSize)) {
    fail("parse_failure", "POINT_PLY_PAYLOAD_LENGTH_MISMATCH");
  }
  const coordinateProperties = requiredCoordinateProperties(
    layout.properties,
  );
  const additionalNames = layout.properties
    .filter((property) => !["x", "y", "z"].includes(property.name))
    .map((property) => property.name);
  return {
    format: "ply_binary_little_endian",
    profile: "ordinary_point_geometry_fixed_width_scalar",
    inspectionCoverage:
      "complete_header_and_exact_fixed_width_payload_layout",
    plyVersion: "1.0",
    header: {
      bytes: header.bytes,
      lineEndings: header.lineEndings,
      comments: {
        count: parsed.commentCount,
        retainedVerbatim: false,
        authoritative: false,
      },
      objInfo: {
        count: parsed.objInfoCount,
        retainedVerbatim: false,
        authoritative: false,
      },
    },
    vertices: {
      count: parsed.vertex.count,
      recordStrideBytes: layout.recordStrideBytes,
      payloadBytes,
      properties: layout.properties,
      requiredCoordinateProperties: coordinateProperties,
      additionalProperties: {
        count: additionalNames.length,
        names: additionalNames,
      },
    },
    container: {
      sourceSizeBytes: fileSize,
      headerBytes: header.bytes,
      payloadOffsetBytes: header.bytes,
      payloadBytes,
      exactFileLengthVerified: true,
      trailingBytes: 0,
    },
    limitations: FOUNDRY_POINT_PLY_SOURCE_FACTS_LIMITATIONS,
  };
}

/**
 * Inspects one already-open, identity-bound ordinary PLY point source.
 * The profile reads only the bounded ASCII header and verifies the exact
 * fixed-width payload equation against the same handle. Values are not decoded.
 */
export async function inspectPlyPointCloudSourceFacts(
  handle: FileHandle,
  fileSize: number,
  sourceSha256: string,
  signal?: AbortSignal,
): Promise<FoundryPlyPointCloudSourceFactsOutcome> {
  const binding: FoundryPlyPointCloudSourceFactsSourceBinding = {
    sourceSha256,
    sourceSizeBytes: fileSize,
  };
  try {
    assertNotCancelled(signal);
    if (!Number.isSafeInteger(fileSize) || fileSize <= 0) {
      fail("resource_limit", "POINT_PLY_SOURCE_SIZE_INVALID");
    }
    if (fileSize > FOUNDRY_POINT_PLY_SOURCE_MAX_BYTES) {
      fail("resource_limit", "POINT_PLY_SOURCE_SIZE_LIMIT_EXCEEDED");
    }
    const before = await statHandle(handle, signal);
    if (!before.isFile()) {
      fail("parse_failure", "POINT_PLY_SOURCE_NOT_REGULAR");
    }
    if (before.size !== fileSize) {
      fail("parse_failure", "POINT_PLY_SOURCE_SIZE_MISMATCH");
    }
    const captured = await readHeaderCapture(handle, fileSize, signal);
    const header = captureHeader(captured);
    const parsed = parsePointHeader(header);
    const facts = inspectLayout(header, parsed, fileSize);
    assertNotCancelled(signal);
    const after = await statHandle(handle, signal);
    if (!sameFileIdentity(before, after) || after.size !== fileSize) {
      fail("parse_failure", "POINT_PLY_SOURCE_CHANGED");
    }
    return { ...binding, state: "established", facts };
  } catch (error: unknown) {
    if (error instanceof PointPlyInspectionFailure) {
      return {
        ...binding,
        state: "facts_not_established",
        category: error.category,
        code: error.code,
      };
    }
    return {
      ...binding,
      state: "facts_not_established",
      category: "parse_failure",
      code: "POINT_PLY_INSPECTION_FAILED",
    };
  }
}
