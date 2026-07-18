import type { FileHandle } from "node:fs/promises";

export const FOUNDRY_GAUSSIAN_PLY_SOURCE_MAX_BYTES = 128 * 1024 * 1024 * 1024;
export const FOUNDRY_GAUSSIAN_PLY_HEADER_MAX_BYTES = 1024 * 1024;
export const FOUNDRY_GAUSSIAN_PLY_HEADER_LINE_MAX_BYTES = 64 * 1024;
export const FOUNDRY_GAUSSIAN_PLY_ELEMENT_MAX_COUNT = 64;
export const FOUNDRY_GAUSSIAN_PLY_PROPERTY_MAX_COUNT = 4096;
export const FOUNDRY_GAUSSIAN_PLY_COMMENT_MAX_COUNT = 256;
export const FOUNDRY_GAUSSIAN_PLY_VERTEX_MAX_COUNT = 100_000_000;
export const FOUNDRY_GAUSSIAN_PLY_VERTEX_STRIDE_MAX_BYTES = 32_768;

export const FOUNDRY_GAUSSIAN_PLY_SOURCE_FACTS_LIMITATIONS = Object.freeze([
  "GAUSSIAN_ATTRIBUTE_VALUES_ARE_NOT_DECODED_OR_VALIDATED",
  "COMMENTS_AND_OBJ_INFO_ARE_NON_AUTHORITATIVE_AND_NOT_RETAINED_VERBATIM",
  "PROPERTY_NAMES_AND_FIXED_WIDTH_LAYOUT_DO_NOT_ESTABLISH_GAUSSIAN_SEMANTIC_CONVENTIONS",
  "STRUCTURAL_FACTS_DO_NOT_ESTABLISH_PHYSICAL_BOUNDS_UNITS_FRAME_OR_RENDERER_COMPATIBILITY",
  "FORMAT_FACTS_DO_NOT_ESTABLISH_VISUAL_FIDELITY_PROVENANCE_ACCURACY_REGISTRATION_OR_RIGHTS",
] as const);

export const FOUNDRY_GAUSSIAN_PLY_SOURCE_FACTS_FAILURE_CODES = Object.freeze([
  "GAUSSIAN_PLY_INSPECTION_CANCELLED",
  "GAUSSIAN_PLY_CONTAINER_UNRECOGNIZED",
  "GAUSSIAN_PLY_SOURCE_SIZE_INVALID",
  "GAUSSIAN_PLY_SOURCE_SIZE_LIMIT_EXCEEDED",
  "GAUSSIAN_PLY_HEADER_SIZE_LIMIT_EXCEEDED",
  "GAUSSIAN_PLY_HEADER_LINE_LIMIT_EXCEEDED",
  "GAUSSIAN_PLY_ELEMENT_LIMIT_EXCEEDED",
  "GAUSSIAN_PLY_PROPERTY_LIMIT_EXCEEDED",
  "GAUSSIAN_PLY_COMMENT_LIMIT_EXCEEDED",
  "GAUSSIAN_PLY_VERTEX_COUNT_LIMIT_EXCEEDED",
  "GAUSSIAN_PLY_LAYOUT_SIZE_LIMIT_EXCEEDED",
  "GAUSSIAN_PLY_VERSION_UNSUPPORTED",
  "GAUSSIAN_PLY_DATA_ENCODING_UNSUPPORTED",
  "GAUSSIAN_PLY_COMPRESSED_LAYOUT_UNSUPPORTED",
  "GAUSSIAN_PLY_EXTRA_ELEMENT_UNSUPPORTED",
  "GAUSSIAN_PLY_LIST_PROPERTY_UNSUPPORTED",
  "GAUSSIAN_PLY_SCALAR_TYPE_UNSUPPORTED",
  "GAUSSIAN_PLY_VERTEX_ELEMENT_MISSING",
  "GAUSSIAN_PLY_MULTIPLE_VERTEX_ELEMENTS",
  "GAUSSIAN_PLY_REQUIRED_PROPERTY_MISSING",
  "GAUSSIAN_PLY_REQUIRED_PROPERTY_TYPE_MISMATCH",
  "GAUSSIAN_PLY_SH_LAYOUT_UNSUPPORTED",
  "GAUSSIAN_PLY_NORMAL_LAYOUT_INVALID",
  "GAUSSIAN_PLY_SOURCE_NOT_REGULAR",
  "GAUSSIAN_PLY_SOURCE_SIZE_MISMATCH",
  "GAUSSIAN_PLY_SOURCE_CHANGED",
  "GAUSSIAN_PLY_HANDLE_READ_FAILED",
  "GAUSSIAN_PLY_HEADER_TRUNCATED",
  "GAUSSIAN_PLY_HEADER_ENCODING_INVALID",
  "GAUSSIAN_PLY_HEADER_GRAMMAR_INVALID",
  "GAUSSIAN_PLY_FORMAT_DECLARATION_INVALID",
  "GAUSSIAN_PLY_VERTEX_COUNT_INVALID",
  "GAUSSIAN_PLY_DUPLICATE_PROPERTY",
  "GAUSSIAN_PLY_PAYLOAD_LENGTH_MISMATCH",
  "GAUSSIAN_PLY_INSPECTION_FAILED",
] as const);

export type FoundryGaussianPlySourceFactsFailureCode =
  (typeof FOUNDRY_GAUSSIAN_PLY_SOURCE_FACTS_FAILURE_CODES)[number];
export type FoundryGaussianPlySourceFactsFailureCategory =
  | "parse_failure"
  | "resource_limit"
  | "unsupported_variant"
  | "unsupported_container"
  | "cancelled";

export const FOUNDRY_GAUSSIAN_PLY_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE = Object.freeze({
  GAUSSIAN_PLY_INSPECTION_CANCELLED: "cancelled",
  GAUSSIAN_PLY_CONTAINER_UNRECOGNIZED: "unsupported_container",
  GAUSSIAN_PLY_SOURCE_SIZE_INVALID: "resource_limit",
  GAUSSIAN_PLY_SOURCE_SIZE_LIMIT_EXCEEDED: "resource_limit",
  GAUSSIAN_PLY_HEADER_SIZE_LIMIT_EXCEEDED: "resource_limit",
  GAUSSIAN_PLY_HEADER_LINE_LIMIT_EXCEEDED: "resource_limit",
  GAUSSIAN_PLY_ELEMENT_LIMIT_EXCEEDED: "resource_limit",
  GAUSSIAN_PLY_PROPERTY_LIMIT_EXCEEDED: "resource_limit",
  GAUSSIAN_PLY_COMMENT_LIMIT_EXCEEDED: "resource_limit",
  GAUSSIAN_PLY_VERTEX_COUNT_LIMIT_EXCEEDED: "resource_limit",
  GAUSSIAN_PLY_LAYOUT_SIZE_LIMIT_EXCEEDED: "resource_limit",
  GAUSSIAN_PLY_VERSION_UNSUPPORTED: "unsupported_variant",
  GAUSSIAN_PLY_DATA_ENCODING_UNSUPPORTED: "unsupported_variant",
  GAUSSIAN_PLY_COMPRESSED_LAYOUT_UNSUPPORTED: "unsupported_variant",
  GAUSSIAN_PLY_EXTRA_ELEMENT_UNSUPPORTED: "unsupported_variant",
  GAUSSIAN_PLY_LIST_PROPERTY_UNSUPPORTED: "unsupported_variant",
  GAUSSIAN_PLY_SCALAR_TYPE_UNSUPPORTED: "unsupported_variant",
  GAUSSIAN_PLY_VERTEX_ELEMENT_MISSING: "unsupported_variant",
  GAUSSIAN_PLY_MULTIPLE_VERTEX_ELEMENTS: "unsupported_variant",
  GAUSSIAN_PLY_REQUIRED_PROPERTY_MISSING: "unsupported_variant",
  GAUSSIAN_PLY_REQUIRED_PROPERTY_TYPE_MISMATCH: "unsupported_variant",
  GAUSSIAN_PLY_SH_LAYOUT_UNSUPPORTED: "unsupported_variant",
  GAUSSIAN_PLY_NORMAL_LAYOUT_INVALID: "unsupported_variant",
  GAUSSIAN_PLY_SOURCE_NOT_REGULAR: "parse_failure",
  GAUSSIAN_PLY_SOURCE_SIZE_MISMATCH: "parse_failure",
  GAUSSIAN_PLY_SOURCE_CHANGED: "parse_failure",
  GAUSSIAN_PLY_HANDLE_READ_FAILED: "parse_failure",
  GAUSSIAN_PLY_HEADER_TRUNCATED: "parse_failure",
  GAUSSIAN_PLY_HEADER_ENCODING_INVALID: "parse_failure",
  GAUSSIAN_PLY_HEADER_GRAMMAR_INVALID: "parse_failure",
  GAUSSIAN_PLY_FORMAT_DECLARATION_INVALID: "parse_failure",
  GAUSSIAN_PLY_VERTEX_COUNT_INVALID: "parse_failure",
  GAUSSIAN_PLY_DUPLICATE_PROPERTY: "parse_failure",
  GAUSSIAN_PLY_PAYLOAD_LENGTH_MISMATCH: "parse_failure",
  GAUSSIAN_PLY_INSPECTION_FAILED: "parse_failure",
} as const satisfies Readonly<
  Record<FoundryGaussianPlySourceFactsFailureCode, FoundryGaussianPlySourceFactsFailureCategory>
>);

export type FoundryGaussianPlyScalarDeclaredType =
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

export type FoundryGaussianPlyScalarCanonicalType =
  | "int8"
  | "uint8"
  | "int16"
  | "uint16"
  | "int32"
  | "uint32"
  | "float32"
  | "float64";

export type FoundryGaussianPlyPropertyRole =
  | "position"
  | "normal"
  | "spherical_harmonics_dc"
  | "spherical_harmonics_non_dc"
  | "opacity"
  | "scale"
  | "rotation"
  | "extra";

export interface FoundryGaussianPlyPropertyFacts {
  readonly ordinal: number;
  readonly name: string;
  readonly declaredType: FoundryGaussianPlyScalarDeclaredType;
  readonly canonicalType: FoundryGaussianPlyScalarCanonicalType;
  readonly byteOffset: number;
  readonly byteWidth: 1 | 2 | 4 | 8;
  readonly role: FoundryGaussianPlyPropertyRole;
  readonly roleIndex: number | null;
}

export interface FoundryGaussianPlySourceFacts {
  readonly format: "gaussian_ply_binary_little_endian";
  readonly profile: "classic_3dgs_float32_scalar";
  readonly inspectionCoverage: "complete_header_and_exact_fixed_width_payload_layout";
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
  readonly gaussians: {
    readonly count: number;
    readonly vertexStrideBytes: number;
    readonly payloadBytes: number;
    readonly properties: readonly FoundryGaussianPlyPropertyFacts[];
    readonly sphericalHarmonics: {
      readonly degree: 0 | 1 | 2 | 3 | 4;
      readonly dcPropertyCount: 3;
      readonly nonDcPropertyCount: 0 | 9 | 24 | 45 | 72;
      readonly indicesContiguous: true;
    };
    readonly normals:
      | { readonly state: "absent"; readonly offsets: readonly [] }
      | { readonly state: "present"; readonly offsets: readonly [number, number, number] };
    readonly extraProperties: {
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
  readonly limitations: typeof FOUNDRY_GAUSSIAN_PLY_SOURCE_FACTS_LIMITATIONS;
}

export interface FoundryGaussianPlySourceFactsSourceBinding {
  readonly sourceSha256: string;
  readonly sourceSizeBytes: number;
}

export type FoundryGaussianPlySourceFactsOutcome = FoundryGaussianPlySourceFactsSourceBinding & (
  | { readonly state: "established"; readonly facts: FoundryGaussianPlySourceFacts }
  | {
      readonly state: "facts_not_established";
      readonly category: FoundryGaussianPlySourceFactsFailureCategory;
      readonly code: FoundryGaussianPlySourceFactsFailureCode;
    }
);

type FailureCategory = FoundryGaussianPlySourceFactsFailureCategory;
type FailureCode = FoundryGaussianPlySourceFactsFailureCode;

interface ScalarTypeFacts {
  readonly canonicalType: FoundryGaussianPlyScalarCanonicalType;
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
} as const satisfies Readonly<Record<FoundryGaussianPlyScalarDeclaredType, ScalarTypeFacts>>);

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

class GaussianPlyInspectionFailure extends Error {
  constructor(
    readonly category: FailureCategory,
    readonly code: FailureCode,
  ) {
    super(code);
    this.name = "GaussianPlyInspectionFailure";
  }
}

function fail(category: FailureCategory, code: FailureCode): never {
  if (FOUNDRY_GAUSSIAN_PLY_SOURCE_FACTS_FAILURE_CATEGORY_BY_CODE[code] !== category) {
    throw new GaussianPlyInspectionFailure("parse_failure", "GAUSSIAN_PLY_INSPECTION_FAILED");
  }
  throw new GaussianPlyInspectionFailure(category, code);
}

function assertNotCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) fail("cancelled", "GAUSSIAN_PLY_INSPECTION_CANCELLED");
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
    if (error instanceof GaussianPlyInspectionFailure) throw error;
    fail("parse_failure", "GAUSSIAN_PLY_HANDLE_READ_FAILED");
  }
}

async function readHeaderCapture(
  handle: FileHandle,
  fileSize: number,
  signal: AbortSignal | undefined,
): Promise<Buffer> {
  const length = Math.min(fileSize, FOUNDRY_GAUSSIAN_PLY_HEADER_MAX_BYTES + 1);
  const output = Buffer.allocUnsafe(length);
  let completed = 0;
  try {
    while (completed < length) {
      assertNotCancelled(signal);
      const requested = Math.min(HEADER_READ_CHUNK_BYTES, length - completed);
      const { bytesRead } = await handle.read(output, completed, requested, completed);
      assertNotCancelled(signal);
      if (bytesRead <= 0) fail("parse_failure", "GAUSSIAN_PLY_HANDLE_READ_FAILED");
      completed += bytesRead;
    }
  } catch (error: unknown) {
    if (error instanceof GaussianPlyInspectionFailure) throw error;
    fail("parse_failure", "GAUSSIAN_PLY_HANDLE_READ_FAILED");
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
    fail("parse_failure", "GAUSSIAN_PLY_HEADER_ENCODING_INVALID");
  }
  return bytes.toString("ascii");
}

function captureHeader(bytes: Buffer): CapturedHeader {
  const lines: string[] = [];
  let start = 0;
  let lfCount = 0;
  let crlfCount = 0;
  for (let cursor = 0; cursor < bytes.length; cursor += 1) {
    if (bytes[cursor] !== 0x0a) continue;
    let end = cursor;
    let crlf = false;
    if (end > start && bytes[end - 1] === 0x0d) {
      end -= 1;
      crlf = true;
    }
    const lineBytes = end - start;
    if (lineBytes > FOUNDRY_GAUSSIAN_PLY_HEADER_LINE_MAX_BYTES) {
      fail("resource_limit", "GAUSSIAN_PLY_HEADER_LINE_LIMIT_EXCEEDED");
    }
    const line = asciiLine(bytes.subarray(start, end));
    if (line.includes("\r")) fail("parse_failure", "GAUSSIAN_PLY_HEADER_ENCODING_INVALID");
    lines.push(line);
    if (crlf) crlfCount += 1;
    else lfCount += 1;
    const headerBytes = cursor + 1;
    if (line.trim() === "end_header" && line !== "end_header") {
      fail("parse_failure", "GAUSSIAN_PLY_HEADER_GRAMMAR_INVALID");
    }
    if (line === "end_header") {
      if (headerBytes > FOUNDRY_GAUSSIAN_PLY_HEADER_MAX_BYTES) {
        fail("resource_limit", "GAUSSIAN_PLY_HEADER_SIZE_LIMIT_EXCEEDED");
      }
      return {
        bytes: headerBytes,
        lines,
        lineEndings: lfCount > 0 && crlfCount > 0 ? "mixed" : crlfCount > 0 ? "crlf" : "lf",
      };
    }
    start = cursor + 1;
  }
  if (bytes.length - start > FOUNDRY_GAUSSIAN_PLY_HEADER_LINE_MAX_BYTES) {
    fail("resource_limit", "GAUSSIAN_PLY_HEADER_LINE_LIMIT_EXCEEDED");
  }
  if (bytes.length > FOUNDRY_GAUSSIAN_PLY_HEADER_MAX_BYTES) {
    fail("resource_limit", "GAUSSIAN_PLY_HEADER_SIZE_LIMIT_EXCEEDED");
  }
  fail("parse_failure", "GAUSSIAN_PLY_HEADER_TRUNCATED");
}

interface ParsedProperty {
  readonly name: string;
  readonly declaredType: FoundryGaussianPlyScalarDeclaredType;
  readonly canonicalType: FoundryGaussianPlyScalarCanonicalType;
  readonly byteWidth: 1 | 2 | 4 | 8;
}

interface ParsedElement {
  readonly name: string;
  readonly count: number;
  readonly properties: ParsedProperty[];
}

interface ParsedClassicHeader {
  readonly vertex: ParsedElement;
  readonly commentCount: number;
  readonly objInfoCount: number;
}

function scalarType(type: string): ScalarTypeFacts & { declaredType: FoundryGaussianPlyScalarDeclaredType } {
  const declaredType = type as FoundryGaussianPlyScalarDeclaredType;
  const facts = (SCALAR_TYPES as Partial<
    Record<FoundryGaussianPlyScalarDeclaredType, ScalarTypeFacts>
  >)[declaredType];
  if (facts === undefined) fail("unsupported_variant", "GAUSSIAN_PLY_SCALAR_TYPE_UNSUPPORTED");
  return { declaredType, ...facts };
}

function parseElementCount(name: string, token: string): number {
  if (!DECIMAL_INTEGER.test(token)) {
    fail("parse_failure", name === "vertex"
      ? "GAUSSIAN_PLY_VERTEX_COUNT_INVALID"
      : "GAUSSIAN_PLY_HEADER_GRAMMAR_INVALID");
  }
  const value = BigInt(token);
  if (name === "vertex") {
    if (value === 0n) fail("parse_failure", "GAUSSIAN_PLY_VERTEX_COUNT_INVALID");
    if (value > BigInt(FOUNDRY_GAUSSIAN_PLY_VERTEX_MAX_COUNT)) {
      fail("resource_limit", "GAUSSIAN_PLY_VERTEX_COUNT_LIMIT_EXCEEDED");
    }
  }
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    fail("parse_failure", "GAUSSIAN_PLY_HEADER_GRAMMAR_INVALID");
  }
  return Number(value);
}

function parseFormat(tokens: readonly string[]): void {
  if (tokens.length !== 3) fail("parse_failure", "GAUSSIAN_PLY_FORMAT_DECLARATION_INVALID");
  const encoding = tokens[1] ?? "";
  const version = tokens[2] ?? "";
  if (encoding === "binary_little_endian_compressed") {
    fail("unsupported_variant", "GAUSSIAN_PLY_COMPRESSED_LAYOUT_UNSUPPORTED");
  }
  if (encoding !== "binary_little_endian") {
    fail("unsupported_variant", "GAUSSIAN_PLY_DATA_ENCODING_UNSUPPORTED");
  }
  if (version !== "1.0") fail("unsupported_variant", "GAUSSIAN_PLY_VERSION_UNSUPPORTED");
}

function hasExactScalarProperties(
  element: ParsedElement,
  names: readonly string[],
  canonicalType: FoundryGaussianPlyScalarCanonicalType,
): boolean {
  if (element.properties.length !== names.length) return false;
  const byName = new Map(element.properties.map((property) => [property.name, property] as const));
  return names.every((name) => byName.get(name)?.canonicalType === canonicalType);
}

function isPlayCanvasPackedLayout(elements: readonly ParsedElement[]): boolean {
  if (elements.length !== 2 && elements.length !== 3) return false;
  const chunk = elements.find((element) => element.name === "chunk");
  const vertex = elements.find((element) => element.name === "vertex");
  if (chunk === undefined || vertex === undefined) return false;

  const chunkProperties = chunk.properties.length === PLAYCANVAS_PACKED_REQUIRED_CHUNK_PROPERTIES.length
    ? PLAYCANVAS_PACKED_REQUIRED_CHUNK_PROPERTIES
    : [
        ...PLAYCANVAS_PACKED_REQUIRED_CHUNK_PROPERTIES,
        ...PLAYCANVAS_PACKED_COLOR_CHUNK_PROPERTIES,
      ];
  if (
    !hasExactScalarProperties(chunk, chunkProperties, "float32") ||
    !hasExactScalarProperties(vertex, PLAYCANVAS_PACKED_VERTEX_PROPERTIES, "uint32") ||
    Math.ceil(vertex.count / PLAYCANVAS_PACKED_CHUNK_SIZE) !== chunk.count
  ) {
    return false;
  }

  if (elements.length === 2) return true;
  const sh = elements.find((element) => element.name === "sh");
  if (sh === undefined || sh.count !== vertex.count || ![9, 24, 45].includes(sh.properties.length)) {
    return false;
  }
  return hasExactScalarProperties(
    sh,
    Array.from({ length: sh.properties.length }, (_, index) => `f_rest_${String(index)}`),
    "uint8",
  );
}

function parseClassicHeader(header: CapturedHeader): ParsedClassicHeader {
  if (header.lines.length === 0 || header.lines[0] !== "ply") {
    fail("unsupported_container", "GAUSSIAN_PLY_CONTAINER_UNRECOGNIZED");
  }
  if (header.lines.length < 3) fail("parse_failure", "GAUSSIAN_PLY_HEADER_TRUNCATED");
  const formatTokens = header.lines[1]?.trim().split(/[ \t]+/u) ?? [];
  if (formatTokens[0] !== "format") {
    fail("parse_failure", "GAUSSIAN_PLY_FORMAT_DECLARATION_INVALID");
  }
  parseFormat(formatTokens);

  const elements: ParsedElement[] = [];
  let current: ParsedElement | undefined;
  let propertyCount = 0;
  let commentCount = 0;
  let objInfoCount = 0;
  for (let lineIndex = 2; lineIndex < header.lines.length; lineIndex += 1) {
    const raw = header.lines[lineIndex] ?? "";
    const line = raw.trim();
    if (line === "end_header") break;
    if (line.length === 0) fail("parse_failure", "GAUSSIAN_PLY_HEADER_GRAMMAR_INVALID");
    const tokens = line.split(/[ \t]+/u);
    const keyword = tokens[0];
    if (keyword === "comment" || keyword === "obj_info") {
      if (keyword === "comment") commentCount += 1;
      else objInfoCount += 1;
      if (commentCount + objInfoCount > FOUNDRY_GAUSSIAN_PLY_COMMENT_MAX_COUNT) {
        fail("resource_limit", "GAUSSIAN_PLY_COMMENT_LIMIT_EXCEEDED");
      }
      continue;
    }
    if (keyword === "format") {
      fail("parse_failure", "GAUSSIAN_PLY_FORMAT_DECLARATION_INVALID");
    }
    if (keyword === "element") {
      if (tokens.length !== 3 || !PLY_NAME.test(tokens[1] ?? "")) {
        fail("parse_failure", "GAUSSIAN_PLY_HEADER_GRAMMAR_INVALID");
      }
      if (elements.length >= FOUNDRY_GAUSSIAN_PLY_ELEMENT_MAX_COUNT) {
        fail("resource_limit", "GAUSSIAN_PLY_ELEMENT_LIMIT_EXCEEDED");
      }
      const name = tokens[1] ?? "";
      const element: ParsedElement = {
        name,
        count: parseElementCount(name, tokens[2] ?? ""),
        properties: [],
      };
      elements.push(element);
      current = element;
      continue;
    }
    if (keyword === "property") {
      if (current === undefined) fail("parse_failure", "GAUSSIAN_PLY_HEADER_GRAMMAR_INVALID");
      propertyCount += 1;
      if (propertyCount > FOUNDRY_GAUSSIAN_PLY_PROPERTY_MAX_COUNT) {
        fail("resource_limit", "GAUSSIAN_PLY_PROPERTY_LIMIT_EXCEEDED");
      }
      if (tokens[1] === "list") {
        fail("unsupported_variant", "GAUSSIAN_PLY_LIST_PROPERTY_UNSUPPORTED");
      }
      if (tokens.length !== 3 || !PLY_NAME.test(tokens[2] ?? "")) {
        fail("parse_failure", "GAUSSIAN_PLY_HEADER_GRAMMAR_INVALID");
      }
      const name = tokens[2] ?? "";
      if (current.properties.some((property) => property.name === name)) {
        fail("parse_failure", "GAUSSIAN_PLY_DUPLICATE_PROPERTY");
      }
      current.properties.push({ name, ...scalarType(tokens[1] ?? "") });
      continue;
    }
    fail("parse_failure", "GAUSSIAN_PLY_HEADER_GRAMMAR_INVALID");
  }

  if (isPlayCanvasPackedLayout(elements)) {
    fail("unsupported_variant", "GAUSSIAN_PLY_COMPRESSED_LAYOUT_UNSUPPORTED");
  }
  const vertices = elements.filter((element) => element.name === "vertex");
  if (vertices.length === 0) fail("unsupported_variant", "GAUSSIAN_PLY_VERTEX_ELEMENT_MISSING");
  if (vertices.length > 1) fail("unsupported_variant", "GAUSSIAN_PLY_MULTIPLE_VERTEX_ELEMENTS");
  if (elements.length !== 1) fail("unsupported_variant", "GAUSSIAN_PLY_EXTRA_ELEMENT_UNSUPPORTED");
  const vertex = vertices[0];
  if (vertex === undefined) fail("unsupported_variant", "GAUSSIAN_PLY_VERTEX_ELEMENT_MISSING");
  return { vertex, commentCount, objInfoCount };
}

function semanticRole(name: string): { role: FoundryGaussianPlyPropertyRole; roleIndex: number | null } {
  if (name === "x" || name === "y" || name === "z") {
    return { role: "position", roleIndex: ["x", "y", "z"].indexOf(name) };
  }
  if (name === "nx" || name === "ny" || name === "nz") {
    return { role: "normal", roleIndex: ["nx", "ny", "nz"].indexOf(name) };
  }
  const dcMatch = /^f_dc_([0-2])$/u.exec(name);
  if (dcMatch !== null) return { role: "spherical_harmonics_dc", roleIndex: Number(dcMatch[1]) };
  const restMatch = /^f_rest_(0|[1-9][0-9]*)$/u.exec(name);
  if (restMatch !== null) return { role: "spherical_harmonics_non_dc", roleIndex: Number(restMatch[1]) };
  if (name === "opacity") return { role: "opacity", roleIndex: 0 };
  const scaleMatch = /^scale_([0-2])$/u.exec(name);
  if (scaleMatch !== null) return { role: "scale", roleIndex: Number(scaleMatch[1]) };
  const rotationMatch = /^rot_([0-3])$/u.exec(name);
  if (rotationMatch !== null) return { role: "rotation", roleIndex: Number(rotationMatch[1]) };
  return { role: "extra", roleIndex: null };
}

function propertyMap(properties: readonly ParsedProperty[]): ReadonlyMap<string, ParsedProperty> {
  return new Map(properties.map((property) => [property.name, property]));
}

function requireFloat32(properties: ReadonlyMap<string, ParsedProperty>, name: string): void {
  const property = properties.get(name);
  if (property === undefined) fail("unsupported_variant", "GAUSSIAN_PLY_REQUIRED_PROPERTY_MISSING");
  if (property.canonicalType !== "float32") {
    fail("unsupported_variant", "GAUSSIAN_PLY_REQUIRED_PROPERTY_TYPE_MISMATCH");
  }
}

function sphericalHarmonicFacts(
  properties: readonly ParsedProperty[],
): FoundryGaussianPlySourceFacts["gaussians"]["sphericalHarmonics"] {
  const rest = properties
    .filter((property) => /^f_rest_(0|[1-9][0-9]*)$/u.test(property.name))
    .map((property) => ({
      property,
      index: Number(/^f_rest_(0|[1-9][0-9]*)$/u.exec(property.name)?.[1]),
    }))
    .sort((left, right) => left.index - right.index);
  const allowedCounts = [0, 9, 24, 45, 72] as const;
  if (!allowedCounts.includes(rest.length as (typeof allowedCounts)[number])) {
    fail("unsupported_variant", "GAUSSIAN_PLY_SH_LAYOUT_UNSUPPORTED");
  }
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index]?.index !== index) fail("unsupported_variant", "GAUSSIAN_PLY_SH_LAYOUT_UNSUPPORTED");
    if (rest[index]?.property.canonicalType !== "float32") {
      fail("unsupported_variant", "GAUSSIAN_PLY_REQUIRED_PROPERTY_TYPE_MISMATCH");
    }
  }
  const degreeByCount = new Map<number, 0 | 1 | 2 | 3 | 4>([
    [0, 0],
    [9, 1],
    [24, 2],
    [45, 3],
    [72, 4],
  ]);
  const degree = degreeByCount.get(rest.length);
  if (degree === undefined) fail("unsupported_variant", "GAUSSIAN_PLY_SH_LAYOUT_UNSUPPORTED");
  return {
    degree,
    dcPropertyCount: 3,
    nonDcPropertyCount: rest.length as 0 | 9 | 24 | 45 | 72,
    indicesContiguous: true,
  };
}

function inspectLayout(
  header: CapturedHeader,
  parsed: ParsedClassicHeader,
  fileSize: number,
): FoundryGaussianPlySourceFacts {
  const byName = propertyMap(parsed.vertex.properties);
  for (const name of [
    "x", "y", "z",
    "f_dc_0", "f_dc_1", "f_dc_2",
    "opacity",
    "scale_0", "scale_1", "scale_2",
    "rot_0", "rot_1", "rot_2", "rot_3",
  ]) {
    requireFloat32(byName, name);
  }
  const normalNames = ["nx", "ny", "nz"] as const;
  const normalCount = normalNames.filter((name) => byName.has(name)).length;
  if (normalCount !== 0 && normalCount !== normalNames.length) {
    fail("unsupported_variant", "GAUSSIAN_PLY_NORMAL_LAYOUT_INVALID");
  }
  if (normalCount === normalNames.length) {
    for (const name of normalNames) {
      if (byName.get(name)?.canonicalType !== "float32") {
        fail("unsupported_variant", "GAUSSIAN_PLY_NORMAL_LAYOUT_INVALID");
      }
    }
  }
  const sphericalHarmonics = sphericalHarmonicFacts(parsed.vertex.properties);
  let byteOffset = 0;
  const properties: FoundryGaussianPlyPropertyFacts[] = [];
  for (let ordinal = 0; ordinal < parsed.vertex.properties.length; ordinal += 1) {
    const property = parsed.vertex.properties[ordinal];
    if (property === undefined) fail("parse_failure", "GAUSSIAN_PLY_HEADER_GRAMMAR_INVALID");
    const semantic = semanticRole(property.name);
    properties.push({
      ordinal,
      name: property.name,
      declaredType: property.declaredType,
      canonicalType: property.canonicalType,
      byteOffset,
      byteWidth: property.byteWidth,
      role: semantic.role,
      roleIndex: semantic.roleIndex,
    });
    byteOffset += property.byteWidth;
    if (byteOffset > FOUNDRY_GAUSSIAN_PLY_VERTEX_STRIDE_MAX_BYTES) {
      fail("resource_limit", "GAUSSIAN_PLY_LAYOUT_SIZE_LIMIT_EXCEEDED");
    }
  }
  const vertexStrideBytes = byteOffset;
  if (vertexStrideBytes <= 0) fail("parse_failure", "GAUSSIAN_PLY_HEADER_GRAMMAR_INVALID");
  const payloadBig = BigInt(parsed.vertex.count) * BigInt(vertexStrideBytes);
  if (payloadBig > BigInt(FOUNDRY_GAUSSIAN_PLY_SOURCE_MAX_BYTES) || payloadBig > BigInt(Number.MAX_SAFE_INTEGER)) {
    fail("resource_limit", "GAUSSIAN_PLY_LAYOUT_SIZE_LIMIT_EXCEEDED");
  }
  const payloadBytes = Number(payloadBig);
  if (BigInt(header.bytes) + payloadBig !== BigInt(fileSize)) {
    fail("parse_failure", "GAUSSIAN_PLY_PAYLOAD_LENGTH_MISMATCH");
  }
  const normalOffsets = normalNames.map((name) => {
    const property = properties.find((candidate) => candidate.name === name);
    return property?.byteOffset;
  });
  let normals: FoundryGaussianPlySourceFacts["gaussians"]["normals"];
  if (normalCount === 0) {
    normals = { state: "absent", offsets: [] };
  } else {
    const [nxOffset, nyOffset, nzOffset] = normalOffsets;
    if (nxOffset === undefined || nyOffset === undefined || nzOffset === undefined) {
      fail("unsupported_variant", "GAUSSIAN_PLY_NORMAL_LAYOUT_INVALID");
    }
    normals = { state: "present", offsets: [nxOffset, nyOffset, nzOffset] };
  }
  const extraNames = properties
    .filter((property) => property.role === "extra")
    .map((property) => property.name);
  return {
    format: "gaussian_ply_binary_little_endian",
    profile: "classic_3dgs_float32_scalar",
    inspectionCoverage: "complete_header_and_exact_fixed_width_payload_layout",
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
    gaussians: {
      count: parsed.vertex.count,
      vertexStrideBytes,
      payloadBytes,
      properties,
      sphericalHarmonics,
      normals,
      extraProperties: { count: extraNames.length, names: extraNames },
    },
    container: {
      sourceSizeBytes: fileSize,
      headerBytes: header.bytes,
      payloadOffsetBytes: header.bytes,
      payloadBytes,
      exactFileLengthVerified: true,
      trailingBytes: 0,
    },
    limitations: FOUNDRY_GAUSSIAN_PLY_SOURCE_FACTS_LIMITATIONS,
  };
}

/**
 * Inspects one already-open, identity-bound PLY handle. This structural
 * profile reads only the bounded ASCII header and verifies the fixed-width
 * payload equation against the same handle; Gaussian values are not decoded.
 */
export async function inspectGaussianPlySourceFacts(
  handle: FileHandle,
  fileSize: number,
  sourceSha256: string,
  signal?: AbortSignal,
): Promise<FoundryGaussianPlySourceFactsOutcome> {
  const binding: FoundryGaussianPlySourceFactsSourceBinding = {
    sourceSha256,
    sourceSizeBytes: fileSize,
  };
  try {
    assertNotCancelled(signal);
    if (!Number.isSafeInteger(fileSize) || fileSize <= 0) {
      fail("resource_limit", "GAUSSIAN_PLY_SOURCE_SIZE_INVALID");
    }
    if (fileSize > FOUNDRY_GAUSSIAN_PLY_SOURCE_MAX_BYTES) {
      fail("resource_limit", "GAUSSIAN_PLY_SOURCE_SIZE_LIMIT_EXCEEDED");
    }
    const before = await statHandle(handle, signal);
    if (!before.isFile()) fail("parse_failure", "GAUSSIAN_PLY_SOURCE_NOT_REGULAR");
    if (before.size !== fileSize) fail("parse_failure", "GAUSSIAN_PLY_SOURCE_SIZE_MISMATCH");
    const captured = await readHeaderCapture(handle, fileSize, signal);
    const header = captureHeader(captured);
    const parsed = parseClassicHeader(header);
    const facts = inspectLayout(header, parsed, fileSize);
    assertNotCancelled(signal);
    const after = await statHandle(handle, signal);
    if (!sameFileIdentity(before, after) || after.size !== fileSize) {
      fail("parse_failure", "GAUSSIAN_PLY_SOURCE_CHANGED");
    }
    return { ...binding, state: "established", facts };
  } catch (error: unknown) {
    if (error instanceof GaussianPlyInspectionFailure) {
      return { ...binding, state: "facts_not_established", category: error.category, code: error.code };
    }
    return {
      ...binding,
      state: "facts_not_established",
      category: "parse_failure",
      code: "GAUSSIAN_PLY_INSPECTION_FAILED",
    };
  }
}
