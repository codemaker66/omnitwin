// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- upstream ships no declarations.
/// <reference path="./gltf-validator.d.ts" />
import { PlatformIO, VertexLayout, type ILogger } from "@gltf-transform/core";
import { EXTMeshoptCompression } from "@gltf-transform/extensions";
import { validateBytes, version as validatorVersion } from "gltf-validator";
import { MeshoptDecoder, MeshoptEncoder } from "meshoptimizer";
import { z } from "zod";
import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
  type CanonicalJson,
} from "./canonical-json.js";
import { FoundryIntegrityError } from "./errors.js";
import { sha256Bytes } from "./hash.js";

export const FOUNDRY_NORMALIZE_MESH_GLB_INVOCATION_V0 =
  "omnitwin.foundry.normalize-mesh-glb-invocation.v0";
export const FOUNDRY_NORMALIZE_MESH_GLB_REPORT_V0 =
  "omnitwin.foundry.normalize-mesh-glb-report.v0";
export const FOUNDRY_NORMALIZE_MESH_GLB_SEMANTIC_SNAPSHOT_V0 =
  "omnitwin.foundry.normalize-mesh-glb-semantic-snapshot.v0";
export const FOUNDRY_NORMALIZE_MESH_GLB_OPERATION = "normalize_mesh_glb";
export const FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_VERSION = "v0";
export const FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES = 64 * 1024 * 1024;
export const FOUNDRY_NORMALIZE_MESH_GLB_SEALED_IDENTITY = [
  FOUNDRY_NORMALIZE_MESH_GLB_OPERATION,
  FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_VERSION,
  "core-static-triangles-meshopt-lossless-proof",
] as const;

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const GLB_HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;
const JSON_BYTES_OFFSET = GLB_HEADER_BYTES + CHUNK_HEADER_BYTES;
const EXT_MESHOPT_COMPRESSION = "EXT_meshopt_compression";
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const INVOCATION_DOMAIN = "OMNITWIN_FOUNDRY_NORMALIZE_MESH_GLB_INVOCATION_V0";
const SNAPSHOT_DOMAIN = "OMNITWIN_FOUNDRY_NORMALIZE_MESH_GLB_SEMANTIC_SNAPSHOT_V0";
const REPORT_DOMAIN = "OMNITWIN_FOUNDRY_NORMALIZE_MESH_GLB_REPORT_V0";

const LIMITATIONS = [
  "This proof accepts only one extension-free, self-contained, static core-geometry GLB.",
  "Materials, textures, images, samplers, cameras, skins, animations, morph targets, sparse accessors, extras, custom attributes, quantized geometry, and non-identity transforms are rejected.",
  "The writer canonicalizes storage layout and derived accessor bounds; the proof compares logical accessor bytes and topology, and compressed views are decoded independently because the bundled Khronos validator does not validate EXT_meshopt_compression semantics.",
  "No quantize, reorder, simplify, weld, deduplicate, prune, texture-compression, provider, network, database, object-store, signing, registration, promotion, or publication operation is performed.",
  "This pure proof establishes semantic round-trip equality only; it grants no execution, control-plane, staging, rights, or release authority.",
  "The production entrypoint is disabled until reviewed verified-stage, manifest, admission, JobSpec, and purpose-aware rights bindings exist.",
] as const;

const DEPENDENCIES = [
  { name: "@gltf-transform/core", version: "4.3.0", license: "MIT" },
  { name: "@gltf-transform/extensions", version: "4.3.0", license: "MIT" },
  { name: "meshoptimizer", version: "1.2.0", license: "MIT" },
  { name: "gltf-validator", version: "2.0.0-dev.3.10", license: "Apache-2.0" },
  { name: "property-graph", version: "4.1.0", license: "MIT" },
  { name: "ktx-parse", version: "1.1.0", license: "MIT" },
] as const;

const SourceSchema = z
  .object({
    assetId: z.string().regex(SAFE_ID),
    inputType: z.literal("glb_gltf"),
    mediaType: z.literal("model/gltf-binary"),
    sizeBytes: z.number().int().safe().positive().max(FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES),
    sha256: z.string().regex(SHA256),
  })
  .strict();

export const FoundryNormalizeMeshGlbInvocationV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_NORMALIZE_MESH_GLB_INVOCATION_V0),
    operation: z.literal(FOUNDRY_NORMALIZE_MESH_GLB_OPERATION),
    operationVersion: z.literal(FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_VERSION),
    sealedIdentity: z.tuple([
      z.literal(FOUNDRY_NORMALIZE_MESH_GLB_OPERATION),
      z.literal(FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_VERSION),
      z.literal("core-static-triangles-meshopt-lossless-proof"),
    ]),
    executionMode: z.literal("test_only_pure_core_proof"),
    source: SourceSchema,
    authority: z.literal("none"),
  })
  .strict();

export type FoundryNormalizeMeshGlbInvocationV0 = z.infer<
  typeof FoundryNormalizeMeshGlbInvocationV0Schema
>;

const ValidatorResultSchema = z
  .object({
    version: z.string().min(1),
    errors: z.literal(0),
    warnings: z.literal(0),
  })
  .strict();

const ReportPayloadSchema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_NORMALIZE_MESH_GLB_REPORT_V0),
    invocationSha256: z.string().regex(SHA256),
    operation: z.literal(FOUNDRY_NORMALIZE_MESH_GLB_OPERATION),
    operationVersion: z.literal(FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_VERSION),
    source: SourceSchema,
    output: z
      .object({
        mediaType: z.literal("model/gltf-binary"),
        sizeBytes: z.number().int().safe().positive().max(FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES),
        sha256: z.string().regex(SHA256),
      })
      .strict(),
    semanticProof: z
      .object({
        schemaVersion: z.literal(FOUNDRY_NORMALIZE_MESH_GLB_SEMANTIC_SNAPSHOT_V0),
        beforeSha256: z.string().regex(SHA256),
        afterSha256: z.string().regex(SHA256),
        exactMatch: z.literal(true),
        accessorCount: z.number().int().positive(),
        compressedBufferViewCount: z.number().int().positive(),
      })
      .strict(),
    validation: z
      .object({ before: ValidatorResultSchema, after: ValidatorResultSchema })
      .strict(),
    transform: z
      .object({
        extension: z.literal(EXT_MESHOPT_COMPRESSION),
        required: z.literal(true),
        encoderMethod: z.literal("quantize"),
        meshoptFilter: z.literal("NONE"),
        logicalAccessorMutation: z.literal("none_proven_by_exact_decoded_snapshot"),
      })
      .strict(),
    dependencies: z.tuple([
      z.object({ name: z.literal("@gltf-transform/core"), version: z.literal("4.3.0"), license: z.literal("MIT") }).strict(),
      z.object({ name: z.literal("@gltf-transform/extensions"), version: z.literal("4.3.0"), license: z.literal("MIT") }).strict(),
      z.object({ name: z.literal("meshoptimizer"), version: z.literal("1.2.0"), license: z.literal("MIT") }).strict(),
      z.object({ name: z.literal("gltf-validator"), version: z.literal("2.0.0-dev.3.10"), license: z.literal("Apache-2.0") }).strict(),
      z.object({ name: z.literal("property-graph"), version: z.literal("4.1.0"), license: z.literal("MIT") }).strict(),
      z.object({ name: z.literal("ktx-parse"), version: z.literal("1.1.0"), license: z.literal("MIT") }).strict(),
    ]),
    policy: z
      .object({
        inputExtensions: z.literal("none"),
        meshSemantics: z.literal("static_indexed_identity_transform_position_float32_triangles"),
        network: z.literal("none"),
        childProcesses: z.literal("none"),
        genericArguments: z.literal("none"),
        mutationBeyondReturnedBytes: z.literal("none"),
        measuredGeometryEligibility: z.literal("not_established"),
        reconstructionQualityImprovement: z.literal("none"),
        immutableRegistration: z.literal("not_authorized"),
        signing: z.literal("not_authorized"),
        publication: z.literal("not_authorized"),
        promotion: z.literal("not_authorized"),
      })
      .strict(),
    limitations: z.tuple(LIMITATIONS.map((value) => z.literal(value)) as [
      z.ZodLiteral<(typeof LIMITATIONS)[0]>,
      z.ZodLiteral<(typeof LIMITATIONS)[1]>,
      z.ZodLiteral<(typeof LIMITATIONS)[2]>,
      z.ZodLiteral<(typeof LIMITATIONS)[3]>,
      z.ZodLiteral<(typeof LIMITATIONS)[4]>,
      z.ZodLiteral<(typeof LIMITATIONS)[5]>,
    ]),
    authority: z.literal("none"),
  })
  .strict();

type ReportPayload = z.infer<typeof ReportPayloadSchema>;

export const FoundryNormalizeMeshGlbReportV0Schema = ReportPayloadSchema.extend({
  reportSha256: z.string().regex(SHA256),
})
  .strict()
  .superRefine((report, ctx) => {
    const { reportSha256: _reportSha256, ...payload } = report;
    const parsed = ReportPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) ctx.addIssue(issue);
      return;
    }
    if (report.reportSha256 !== computeFoundryNormalizeMeshGlbReportSha256(parsed.data)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reportSha256"],
        message: "normalization report digest does not match its canonical payload",
      });
    }
  });

export type FoundryNormalizeMeshGlbReportV0 = z.infer<
  typeof FoundryNormalizeMeshGlbReportV0Schema
>;

export interface FoundryNormalizeMeshGlbProofResult {
  readonly normalizedGlb: Buffer;
  readonly report: FoundryNormalizeMeshGlbReportV0;
}

/**
 * Package-internal neutral result from the reviewed in-memory transform. This
 * is deliberately not exported from the package root: public callers must use
 * an evidence contract that honestly describes why the transform is running.
 */
export interface NormalizeMeshGlbPureTransformInternalResult {
  readonly normalizedGlb: Buffer;
  readonly semanticProof: FoundryNormalizeMeshGlbReportV0["semanticProof"];
  readonly validation: FoundryNormalizeMeshGlbReportV0["validation"];
}

export interface RunFoundryNormalizeMeshGlbWorkerOptions {
  readonly invocation: FoundryNormalizeMeshGlbInvocationV0;
  readonly sourcePath: string;
  readonly outputDirectory: string;
  readonly signal?: AbortSignal;
}

type JsonObject = Record<string, unknown>;

interface GlbContainer {
  readonly json: JsonObject;
  readonly binary: Buffer;
}

interface AccessorProof {
  readonly name: string;
  readonly role: "POSITION" | "INDICES";
  readonly componentType: 5123 | 5125 | 5126;
  readonly type: "SCALAR" | "VEC3";
  readonly normalized: false;
  readonly count: number;
  readonly logicalBytesSha256: string;
  readonly derivedMin: readonly number[];
  readonly derivedMax: readonly number[];
}

interface ParsedGeometry {
  readonly snapshot: CanonicalJson;
  readonly snapshotSha256: string;
  readonly accessorCount: number;
  readonly compressedBufferViewCount: number;
}

function fail(code: string, message: string, cause?: unknown): never {
  throw new FoundryIntegrityError(code, message, { cause });
}

function object(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("NORMALIZE_MESH_GLB_INVALID_STRUCTURE", `${label} must be an object.`);
  }
  return value as JsonObject;
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) fail("NORMALIZE_MESH_GLB_INVALID_STRUCTURE", `${label} must be an array.`);
  return value;
}

function integer(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || typeof value !== "number" || value < minimum) {
    fail("NORMALIZE_MESH_GLB_INVALID_STRUCTURE", `${label} must be a safe integer >= ${String(minimum)}.`);
  }
  return value;
}

function optionalInteger(value: unknown, label: string): number {
  return value === undefined ? 0 : integer(value, label);
}

function boundedLength(value: unknown, label: string): number {
  const parsed = integer(value, label, 1);
  if (parsed > FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES) {
    fail("NORMALIZE_MESH_GLB_RESOURCE_BOUNDS", `${label} exceeds the reviewed byte budget.`);
  }
  return parsed;
}

function safeAdd(left: number, right: number, label: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result) || result > FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES) {
    fail("NORMALIZE_MESH_GLB_RESOURCE_BOUNDS", `${label} exceeds the reviewed byte budget.`);
  }
  return result;
}

function safeProduct(factors: readonly number[], label: string): number {
  let result = 1;
  for (const factor of factors) {
    result *= factor;
    if (!Number.isSafeInteger(result) || result > FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES) {
      fail("NORMALIZE_MESH_GLB_RESOURCE_BOUNDS", `${label} exceeds the reviewed byte budget.`);
    }
  }
  return result;
}

function index(value: unknown, length: number, label: string): number {
  const parsed = integer(value, label);
  if (parsed >= length) fail("NORMALIZE_MESH_GLB_INVALID_REFERENCE", `${label} is out of range.`);
  return parsed;
}

function name(value: unknown, label: string): string {
  if (value === undefined) return "";
  if (typeof value !== "string" || value.length > 1_024) {
    fail("NORMALIZE_MESH_GLB_INVALID_STRUCTURE", `${label} must be a string no longer than 1024 characters.`);
  }
  return value;
}

function assertAllowedKeys(value: JsonObject, allowed: readonly string[], label: string): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      fail("NORMALIZE_MESH_GLB_UNSUPPORTED_SEMANTICS", `${label}.${key} is outside the reviewed V0 subset.`);
    }
  }
}

function assertBoundedCanonicalJson(value: unknown): void {
  const stack: Array<{ readonly value: unknown; readonly depth: number }> = [{ value, depth: 0 }];
  let visited = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    visited += 1;
    if (visited > 500_000 || current.depth > 64) {
      fail("NORMALIZE_MESH_GLB_JSON_BOUNDS", "GLB JSON exceeds the reviewed member or nesting-depth budget.");
    }
    if (typeof current.value === "number" && (!Number.isFinite(current.value) || Object.is(current.value, -0))) {
      fail("NORMALIZE_MESH_GLB_NON_CANONICAL_NUMBER", "GLB JSON contains a non-finite or negative-zero number.");
    }
    if (Array.isArray(current.value)) {
      for (const member of current.value) stack.push({ value: member, depth: current.depth + 1 });
    } else if (typeof current.value === "object" && current.value !== null) {
      for (const member of Object.values(current.value)) stack.push({ value: member, depth: current.depth + 1 });
    }
  }
}

function assertNoDuplicateJsonKeys(jsonText: string): void {
  let offset = 0;
  let values = 0;
  const whitespace = (): void => {
    while (/\s/u.test(jsonText[offset] ?? "")) offset += 1;
  };
  const parseString = (): string => {
    const start = offset;
    if (jsonText[offset] !== '"') fail("NORMALIZE_MESH_GLB_INVALID_JSON_CHUNK", "Expected a JSON string.");
    offset += 1;
    let escaped = false;
    while (offset < jsonText.length) {
      const character = jsonText[offset];
      offset += 1;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        try {
          return JSON.parse(jsonText.slice(start, offset)) as string;
        } catch (error: unknown) {
          fail("NORMALIZE_MESH_GLB_INVALID_JSON_CHUNK", "Invalid JSON string escape.", error);
        }
      }
    }
    fail("NORMALIZE_MESH_GLB_INVALID_JSON_CHUNK", "Unterminated JSON string.");
  };
  const parseValue = (depth: number): void => {
    values += 1;
    if (values > 500_000 || depth > 64) fail("NORMALIZE_MESH_GLB_JSON_BOUNDS", "GLB JSON exceeds the reviewed member or nesting-depth budget.");
    whitespace();
    const character = jsonText[offset];
    if (character === "{") {
      offset += 1;
      whitespace();
      const keys = new Set<string>();
      if (jsonText[offset] === "}") {
        offset += 1;
        return;
      }
      while (offset < jsonText.length) {
        whitespace();
        const key = parseString();
        if (keys.has(key)) fail("NORMALIZE_MESH_GLB_DUPLICATE_JSON_KEY", `Duplicate JSON object key is forbidden: ${key}.`);
        keys.add(key);
        whitespace();
        if (jsonText[offset] !== ":") fail("NORMALIZE_MESH_GLB_INVALID_JSON_CHUNK", "Expected ':' after JSON object key.");
        offset += 1;
        parseValue(depth + 1);
        whitespace();
        if (jsonText[offset] === "}") {
          offset += 1;
          return;
        }
        if (jsonText[offset] !== ",") fail("NORMALIZE_MESH_GLB_INVALID_JSON_CHUNK", "Expected ',' between JSON object members.");
        offset += 1;
      }
      fail("NORMALIZE_MESH_GLB_INVALID_JSON_CHUNK", "Unterminated JSON object.");
    }
    if (character === "[") {
      offset += 1;
      whitespace();
      if (jsonText[offset] === "]") {
        offset += 1;
        return;
      }
      while (offset < jsonText.length) {
        parseValue(depth + 1);
        whitespace();
        if (jsonText[offset] === "]") {
          offset += 1;
          return;
        }
        if (jsonText[offset] !== ",") fail("NORMALIZE_MESH_GLB_INVALID_JSON_CHUNK", "Expected ',' between JSON array members.");
        offset += 1;
      }
      fail("NORMALIZE_MESH_GLB_INVALID_JSON_CHUNK", "Unterminated JSON array.");
    }
    if (character === '"') {
      parseString();
      return;
    }
    const start = offset;
    while (offset < jsonText.length && !/[\s,}\]]/u.test(jsonText[offset] ?? "")) offset += 1;
    if (offset === start) fail("NORMALIZE_MESH_GLB_INVALID_JSON_CHUNK", "Expected a JSON value.");
  };
  parseValue(0);
  whitespace();
  if (offset !== jsonText.length) fail("NORMALIZE_MESH_GLB_INVALID_JSON_CHUNK", "Unexpected bytes follow the JSON document.");
}

function parseGlb(bytes: Uint8Array): GlbContainer {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer.length > FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES || buffer.length < JSON_BYTES_OFFSET + CHUNK_HEADER_BYTES) {
    fail("NORMALIZE_MESH_GLB_SIZE_OUT_OF_BOUNDS", "GLB byte length is outside the reviewed V0 bounds.");
  }
  if (buffer.readUInt32LE(0) !== GLB_MAGIC) fail("NORMALIZE_MESH_GLB_NOT_GLB", "Input is not binary glTF.");
  if (buffer.readUInt32LE(4) !== 2) fail("NORMALIZE_MESH_GLB_UNSUPPORTED_VERSION", "Only binary glTF 2 is supported.");
  if (buffer.readUInt32LE(8) !== buffer.length) fail("NORMALIZE_MESH_GLB_LENGTH_MISMATCH", "GLB declared length does not match exact bytes.");
  const jsonLength = buffer.readUInt32LE(12);
  if (jsonLength === 0 || jsonLength % 4 !== 0 || buffer.readUInt32LE(16) !== JSON_CHUNK) {
    fail("NORMALIZE_MESH_GLB_INVALID_JSON_CHUNK", "GLB must begin with one aligned non-empty JSON chunk.");
  }
  const binaryHeader = JSON_BYTES_OFFSET + jsonLength;
  if (binaryHeader + CHUNK_HEADER_BYTES > buffer.length || buffer.readUInt32LE(binaryHeader + 4) !== BIN_CHUNK) {
    fail("NORMALIZE_MESH_GLB_INVALID_BIN_CHUNK", "GLB must contain one final BIN chunk.");
  }
  const binaryLength = buffer.readUInt32LE(binaryHeader);
  if (binaryLength % 4 !== 0 || binaryHeader + CHUNK_HEADER_BYTES + binaryLength !== buffer.length) {
    fail("NORMALIZE_MESH_GLB_INVALID_BIN_CHUNK", "GLB BIN chunk must be aligned and exactly final.");
  }
  let jsonText: string;
  try {
    jsonText = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(JSON_BYTES_OFFSET, binaryHeader));
  } catch (error: unknown) {
    fail("NORMALIZE_MESH_GLB_INVALID_JSON_CHUNK", "GLB JSON is not valid UTF-8.", error);
  }
  while (jsonText.endsWith(" ") || jsonText.endsWith("\u0000")) jsonText = jsonText.slice(0, -1);
  assertNoDuplicateJsonKeys(jsonText);
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (error: unknown) {
    fail("NORMALIZE_MESH_GLB_INVALID_JSON_CHUNK", "GLB JSON cannot be parsed.", error);
  }
  assertBoundedCanonicalJson(raw);
  return {
    json: object(raw, "GLB JSON"),
    binary: buffer.subarray(binaryHeader + CHUNK_HEADER_BYTES),
  };
}

function exactNumberArray(value: unknown, expected: readonly number[], label: string): void {
  const values = array(value, label);
  if (values.length !== expected.length || values.some((member, memberIndex) => member !== expected[memberIndex])) {
    fail("NORMALIZE_MESH_GLB_NON_IDENTITY_TRANSFORM", `${label} must be identity when present.`);
  }
}

function exactAccessorBounds(value: unknown, expected: readonly number[], label: string): void {
  const values = array(value, label);
  if (values.length !== expected.length || values.some((member, memberIndex) => member !== expected[memberIndex])) {
    fail("NORMALIZE_MESH_GLB_ACCESSOR_BOUNDS", `${label} must exactly match bounds independently derived from logical accessor bytes.`);
  }
}

function prefixedDigest(domain: string, value: unknown): string {
  return `sha256:${domainSeparatedSha256(domain, toCanonicalJson(value))}`;
}

function logicalElementBytes(componentType: number, type: string, count: number): number {
  const componentBytes = componentType === 5123 ? 2 : 4;
  const components = type === "VEC3" ? 3 : 1;
  return safeProduct([count, componentBytes, components], "accessor logical byte length");
}

function parseReviewedGeometry(container: GlbContainer, output: boolean): ParsedGeometry {
  const rootKeys = ["asset", "scene", "scenes", "nodes", "meshes", "accessors", "bufferViews", "buffers"];
  if (output) rootKeys.push("extensionsUsed", "extensionsRequired");
  assertAllowedKeys(container.json, rootKeys, "GLB");
  const asset = object(container.json.asset, "asset");
  assertAllowedKeys(asset, output ? ["version", "generator"] : ["version"], "asset");
  if (asset.version !== "2.0") fail("NORMALIZE_MESH_GLB_UNSUPPORTED_VERSION", "asset.version must be 2.0.");
  if (output && asset.generator !== "glTF-Transform v4.3.0") {
    fail("NORMALIZE_MESH_GLB_UNEXPECTED_WRITER", "Output generator does not identify the pinned glTF Transform writer.");
  }
  if (output) {
    const used = array(container.json.extensionsUsed, "extensionsUsed");
    const required = array(container.json.extensionsRequired, "extensionsRequired");
    if (used.length !== 1 || used[0] !== EXT_MESHOPT_COMPRESSION || required.length !== 1 || required[0] !== EXT_MESHOPT_COMPRESSION) {
      fail("NORMALIZE_MESH_GLB_EXTENSION_SET_MISMATCH", "Output must use and require only EXT_meshopt_compression.");
    }
  }

  const scenes = array(container.json.scenes, "scenes");
  const nodes = array(container.json.nodes, "nodes");
  const meshes = array(container.json.meshes, "meshes");
  const accessors = array(container.json.accessors, "accessors");
  const views = array(container.json.bufferViews, "bufferViews");
  const buffers = array(container.json.buffers, "buffers");
  if (scenes.length !== 1 || container.json.scene !== 0) fail("NORMALIZE_MESH_GLB_SCENE_SUBSET", "V0 requires exactly one default scene.");
  if (nodes.length === 0 || nodes.length > 100_000 || meshes.length === 0 || meshes.length > 100_000 || accessors.length === 0 || accessors.length > 200_000) {
    fail("NORMALIZE_MESH_GLB_RESOURCE_BOUNDS", "GLB resource counts are outside reviewed V0 bounds.");
  }
  if (views.length !== accessors.length) fail("NORMALIZE_MESH_GLB_STORAGE_SUBSET", "V0 requires exactly one bufferView per accessor.");
  if (buffers.length !== (output ? 2 : 1)) fail("NORMALIZE_MESH_GLB_BUFFER_SUBSET", `V0 requires ${output ? "meshopt plus fallback" : "exactly one input"} buffer definition(s).`);

  const firstBuffer = object(buffers[0], "buffers[0]");
  assertAllowedKeys(firstBuffer, ["name", "byteLength"], "buffers[0]");
  const physicalLength = boundedLength(firstBuffer.byteLength, "buffers[0].byteLength");
  if (physicalLength > container.binary.length || container.binary.length - physicalLength > 3) {
    fail("NORMALIZE_MESH_GLB_BIN_LENGTH_MISMATCH", "Physical BIN bytes do not match buffers[0].byteLength plus legal padding.");
  }
  if (output) {
    const fallback = object(buffers[1], "buffers[1]");
    assertAllowedKeys(fallback, ["byteLength", "extensions"], "buffers[1]");
    const extensions = object(fallback.extensions, "buffers[1].extensions");
    assertAllowedKeys(extensions, [EXT_MESHOPT_COMPRESSION], "buffers[1].extensions");
    const marker = object(extensions[EXT_MESHOPT_COMPRESSION], "buffers[1] meshopt marker");
    assertAllowedKeys(marker, ["fallback"], "buffers[1] meshopt marker");
    if (marker.fallback !== true) fail("NORMALIZE_MESH_GLB_INVALID_FALLBACK", "Output fallback buffer marker is invalid.");
  }

  const sceneSnapshots = scenes.map((sceneValue, sceneIndex) => {
    const scene = object(sceneValue, `scenes[${String(sceneIndex)}]`);
    assertAllowedKeys(scene, ["name", "nodes"], `scenes[${String(sceneIndex)}]`);
    const roots = array(scene.nodes, `scenes[${String(sceneIndex)}].nodes`).map((value, rootIndex) =>
      index(value, nodes.length, `scenes[${String(sceneIndex)}].nodes[${String(rootIndex)}]`));
    if (roots.length === 0) fail("NORMALIZE_MESH_GLB_EMPTY_SCENE", "Default scene must contain a root node.");
    return { name: name(scene.name, `scenes[${String(sceneIndex)}].name`), nodes: roots };
  });

  const nodeSnapshots = nodes.map((nodeValue, nodeIndex) => {
    const node = object(nodeValue, `nodes[${String(nodeIndex)}]`);
    assertAllowedKeys(node, ["name", "children", "mesh", "translation", "rotation", "scale"], `nodes[${String(nodeIndex)}]`);
    if (node.translation !== undefined) exactNumberArray(node.translation, [0, 0, 0], `nodes[${String(nodeIndex)}].translation`);
    if (node.rotation !== undefined) exactNumberArray(node.rotation, [0, 0, 0, 1], `nodes[${String(nodeIndex)}].rotation`);
    if (node.scale !== undefined) exactNumberArray(node.scale, [1, 1, 1], `nodes[${String(nodeIndex)}].scale`);
    const children = node.children === undefined
      ? []
      : array(node.children, `nodes[${String(nodeIndex)}].children`).map((value, childIndex) =>
          index(value, nodes.length, `nodes[${String(nodeIndex)}].children[${String(childIndex)}]`));
    const mesh = node.mesh === undefined ? null : index(node.mesh, meshes.length, `nodes[${String(nodeIndex)}].mesh`);
    return { name: name(node.name, `nodes[${String(nodeIndex)}].name`), children, mesh };
  });

  const roots = sceneSnapshots[0]?.nodes ?? [];
  const rootSet = new Set(roots);
  if (rootSet.size !== roots.length) fail("NORMALIZE_MESH_GLB_NODE_GRAPH", "Scene root node references must be unique.");
  const parentCounts = new Uint8Array(nodes.length);
  for (const node of nodeSnapshots) {
    for (const child of node.children) {
      parentCounts[child] = (parentCounts[child] ?? 0) + 1;
      if ((parentCounts[child] ?? 0) > 1) fail("NORMALIZE_MESH_GLB_NODE_GRAPH", "A node may have at most one parent in V0.");
    }
  }
  for (const rootNode of roots) {
    if ((parentCounts[rootNode] ?? 0) !== 0) fail("NORMALIZE_MESH_GLB_NODE_CYCLE", "Scene root node is also referenced as a child.");
  }
  const visited = new Set<number>();
  const pending = [...roots];
  while (pending.length > 0) {
    const nodeIndex = pending.pop();
    if (nodeIndex === undefined) break;
    if (visited.has(nodeIndex)) fail("NORMALIZE_MESH_GLB_NODE_CYCLE", "Scene node graph contains a cycle or duplicate reference.");
    visited.add(nodeIndex);
    for (const child of nodeSnapshots[nodeIndex]?.children ?? []) pending.push(child);
  }
  if (visited.size !== nodes.length) fail("NORMALIZE_MESH_GLB_UNREACHABLE_OBJECT", "Every node must be reachable from the default scene.");

  const roles = new Map<number, "POSITION" | "INDICES">();
  const referencedMeshes = new Set<number>();
  for (const node of nodeSnapshots) if (node.mesh !== null) referencedMeshes.add(node.mesh);
  if (referencedMeshes.size !== meshes.length) fail("NORMALIZE_MESH_GLB_UNREACHABLE_OBJECT", "Every mesh must be referenced by a reachable node.");

  const meshSnapshots = meshes.map((meshValue, meshIndex) => {
    const mesh = object(meshValue, `meshes[${String(meshIndex)}]`);
    assertAllowedKeys(mesh, ["name", "primitives"], `meshes[${String(meshIndex)}]`);
    const primitives = array(mesh.primitives, `meshes[${String(meshIndex)}].primitives`);
    if (primitives.length === 0) fail("NORMALIZE_MESH_GLB_EMPTY_MESH", "Meshes must contain at least one primitive.");
    return {
      name: name(mesh.name, `meshes[${String(meshIndex)}].name`),
      primitives: primitives.map((primitiveValue, primitiveIndex) => {
        const label = `meshes[${String(meshIndex)}].primitives[${String(primitiveIndex)}]`;
        const primitive = object(primitiveValue, label);
        assertAllowedKeys(primitive, ["attributes", "indices", "mode"], label);
        if (primitive.mode !== undefined && primitive.mode !== 4) fail("NORMALIZE_MESH_GLB_TOPOLOGY_SUBSET", `${label} must use TRIANGLES mode.`);
        const attributes = object(primitive.attributes, `${label}.attributes`);
        assertAllowedKeys(attributes, ["POSITION"], `${label}.attributes`);
        const position = index(attributes.POSITION, accessors.length, `${label}.attributes.POSITION`);
        const indices = index(primitive.indices, accessors.length, `${label}.indices`);
        for (const [accessorIndex, role] of [[position, "POSITION"], [indices, "INDICES"]] as const) {
          const prior = roles.get(accessorIndex);
          if (prior !== undefined && prior !== role) fail("NORMALIZE_MESH_GLB_ACCESSOR_ROLE_CONFLICT", "An accessor cannot serve multiple semantic roles.");
          roles.set(accessorIndex, role);
        }
        return { mode: 4, position, indices };
      }),
    };
  });
  if (roles.size !== accessors.length) fail("NORMALIZE_MESH_GLB_UNREACHABLE_OBJECT", "Every accessor must be referenced by reviewed primitive semantics.");

  const accessorByView = new Map<number, number>();
  const decodedViews = new Map<number, Buffer>();
  const encodedModes = new Map<number, "ATTRIBUTES" | "TRIANGLES">();
  const encodedCounts = new Map<number, number>();
  const encodedStrides = new Map<number, number>();
  const physicalRanges: Array<{ readonly start: number; readonly end: number }> = [];
  const fallbackRanges: Array<{ readonly start: number; readonly end: number }> = [];
  let cumulativeLogicalBytes = 0;
  let compressedBufferViewCount = 0;
  for (const [viewIndex, viewValue] of views.entries()) {
    const label = `bufferViews[${String(viewIndex)}]`;
    const view = object(viewValue, label);
    assertAllowedKeys(view, output
      ? ["buffer", "byteOffset", "byteLength", "byteStride", "target", "extensions"]
      : ["buffer", "byteOffset", "byteLength", "target"], label);
    const viewLength = boundedLength(view.byteLength, `${label}.byteLength`);
    cumulativeLogicalBytes = safeAdd(cumulativeLogicalBytes, viewLength, "cumulative logical bufferView bytes");
    if (!output) {
      if (view.buffer !== 0) fail("NORMALIZE_MESH_GLB_BUFFER_SUBSET", `${label} must reference input buffer 0.`);
      const offset = optionalInteger(view.byteOffset, `${label}.byteOffset`);
      const end = safeAdd(offset, viewLength, `${label} end offset`);
      if (offset % 4 !== 0 || end > physicalLength) fail("NORMALIZE_MESH_GLB_BUFFER_BOUNDS", `${label} is unaligned or outside the BIN buffer.`);
      physicalRanges.push({ start: offset, end });
      decodedViews.set(viewIndex, container.binary.subarray(offset, end));
      continue;
    }
    if (view.buffer !== 1) fail("NORMALIZE_MESH_GLB_INVALID_FALLBACK", `${label} must reference fallback buffer 1.`);
    const fallbackLength = boundedLength(object(buffers[1], "buffers[1]").byteLength, "buffers[1].byteLength");
    const fallbackOffset = optionalInteger(view.byteOffset, `${label}.byteOffset`);
    const fallbackEnd = safeAdd(fallbackOffset, viewLength, `${label} fallback end offset`);
    if (fallbackOffset % 4 !== 0 || fallbackEnd > fallbackLength) {
      fail("NORMALIZE_MESH_GLB_INVALID_FALLBACK", `${label} fallback range is unaligned or out of bounds.`);
    }
    fallbackRanges.push({ start: fallbackOffset, end: fallbackEnd });
    const extensions = object(view.extensions, `${label}.extensions`);
    assertAllowedKeys(extensions, [EXT_MESHOPT_COMPRESSION], `${label}.extensions`);
    const extension = object(extensions[EXT_MESHOPT_COMPRESSION], `${label}.extensions.${EXT_MESHOPT_COMPRESSION}`);
    assertAllowedKeys(extension, ["buffer", "byteOffset", "byteLength", "mode", "byteStride", "count", "filter"], `${label}.meshopt`);
    if (extension.buffer !== 0 || (extension.filter !== undefined && extension.filter !== "NONE")) {
      fail("NORMALIZE_MESH_GLB_MESHOPT_FILTER", `${label} must use compressed buffer 0 and filter NONE.`);
    }
    const offset = optionalInteger(extension.byteOffset, `${label}.meshopt.byteOffset`);
    const compressedLength = boundedLength(extension.byteLength, `${label}.meshopt.byteLength`);
    const count = integer(extension.count, `${label}.meshopt.count`, 1);
    const stride = integer(extension.byteStride, `${label}.meshopt.byteStride`, 1);
    const compressedEnd = safeAdd(offset, compressedLength, `${label} compressed end offset`);
    if (compressedEnd > physicalLength || safeProduct([count, stride], `${label} decoded byte length`) !== viewLength) {
      fail("NORMALIZE_MESH_GLB_MESHOPT_BOUNDS", `${label} meshopt metadata is inconsistent or out of bounds.`);
    }
    const mode = extension.mode;
    if (mode !== "ATTRIBUTES" && mode !== "TRIANGLES") fail("NORMALIZE_MESH_GLB_MESHOPT_MODE", `${label} has an unsupported meshopt mode.`);
    physicalRanges.push({ start: offset, end: compressedEnd });
    encodedModes.set(viewIndex, mode);
    encodedCounts.set(viewIndex, count);
    encodedStrides.set(viewIndex, stride);
    const decoded = Buffer.alloc(viewLength);
    try {
      MeshoptDecoder.decodeGltfBuffer(decoded, count, stride, container.binary.subarray(offset, compressedEnd), mode, "NONE");
    } catch (error: unknown) {
      fail("NORMALIZE_MESH_GLB_MESHOPT_DECODE_FAILED", `${label} failed independent meshopt decoding.`, error);
    }
    decodedViews.set(viewIndex, decoded);
    compressedBufferViewCount += 1;
  }
  for (const ranges of [physicalRanges, fallbackRanges]) {
    ranges.sort((left, right) => left.start - right.start || left.end - right.end);
    let cursor = 0;
    for (let rangeIndex = 1; rangeIndex < ranges.length; rangeIndex += 1) {
      const previous = ranges[rangeIndex - 1];
      const current = ranges[rangeIndex];
      if (previous !== undefined && current !== undefined && current.start < previous.end) {
        fail("NORMALIZE_MESH_GLB_OVERLAPPING_STORAGE", "Reviewed GLB buffer ranges must not overlap.");
      }
    }
    for (const range of ranges) {
      if (range.start - cursor > 3) fail("NORMALIZE_MESH_GLB_ORPHAN_STORAGE", "Reviewed GLB buffers may contain only alignment padding outside accessor storage.");
      cursor = range.end;
    }
    const declaredLength = ranges === physicalRanges
      ? physicalLength
      : output ? boundedLength(object(buffers[1], "buffers[1]").byteLength, "buffers[1].byteLength") : 0;
    if (declaredLength - cursor > 3) fail("NORMALIZE_MESH_GLB_ORPHAN_STORAGE", "Reviewed GLB buffers may contain only final alignment padding outside accessor storage.");
  }

  const accessorProofs: AccessorProof[] = accessors.map((accessorValue, accessorIndex) => {
    const label = `accessors[${String(accessorIndex)}]`;
    const accessor = object(accessorValue, label);
    assertAllowedKeys(accessor, ["name", "bufferView", "byteOffset", "componentType", "normalized", "count", "type", "min", "max"], label);
    if (optionalInteger(accessor.byteOffset, `${label}.byteOffset`) !== 0 || (accessor.normalized !== undefined && accessor.normalized !== false)) {
      fail("NORMALIZE_MESH_GLB_ACCESSOR_LAYOUT", `${label} must be tightly packed and not normalized.`);
    }
    const viewIndex = index(accessor.bufferView, views.length, `${label}.bufferView`);
    if (accessorByView.has(viewIndex)) fail("NORMALIZE_MESH_GLB_STORAGE_SUBSET", "Each bufferView must contain exactly one accessor.");
    accessorByView.set(viewIndex, accessorIndex);
    const role = roles.get(accessorIndex);
    if (role === undefined) fail("NORMALIZE_MESH_GLB_UNREACHABLE_OBJECT", `${label} has no reviewed semantic role.`);
    const componentType = integer(accessor.componentType, `${label}.componentType`);
    const type = accessor.type;
    if (role === "POSITION" ? componentType !== 5126 || type !== "VEC3" : (componentType !== 5123 && componentType !== 5125) || type !== "SCALAR") {
      fail("NORMALIZE_MESH_GLB_ACCESSOR_SUBSET", `${label} does not match the reviewed ${role} accessor format.`);
    }
    const count = integer(accessor.count, `${label}.count`, 3);
    if (role === "INDICES" && count % 3 !== 0) fail("NORMALIZE_MESH_GLB_TOPOLOGY_SUBSET", `${label} index count must be divisible by three.`);
    const view = object(views[viewIndex], `bufferViews[${String(viewIndex)}]`);
    const expectedBytes = logicalElementBytes(componentType, String(type), count);
    if (view.byteLength !== expectedBytes) fail("NORMALIZE_MESH_GLB_ACCESSOR_LAYOUT", `${label} is not tightly packed in its own bufferView.`);
    if (role === "POSITION") {
      if (view.target !== 34962 || (output && view.byteStride !== 12)) fail("NORMALIZE_MESH_GLB_ACCESSOR_LAYOUT", `${label} must use an ARRAY_BUFFER view with 12-byte output stride.`);
    } else if (view.target !== 34963 || (output && view.byteStride !== undefined)) {
      fail("NORMALIZE_MESH_GLB_ACCESSOR_LAYOUT", `${label} must use an ELEMENT_ARRAY_BUFFER view without byteStride.`);
    }
    if (output) {
      const expectedMode = role === "POSITION" ? "ATTRIBUTES" : "TRIANGLES";
      const expectedStride = role === "POSITION" ? 12 : componentType === 5123 ? 2 : 4;
      if (encodedModes.get(viewIndex) !== expectedMode || encodedCounts.get(viewIndex) !== count || encodedStrides.get(viewIndex) !== expectedStride) {
        fail("NORMALIZE_MESH_GLB_MESHOPT_LAYOUT", `${label} meshopt mode, count, or stride does not match its logical accessor.`);
      }
    }
    const logical = decodedViews.get(viewIndex);
    if (logical === undefined || logical.length !== expectedBytes) fail("NORMALIZE_MESH_GLB_ACCESSOR_LAYOUT", `${label} logical bytes are unavailable.`);
    let derivedMin: number[];
    let derivedMax: number[];
    if (role === "POSITION") {
      derivedMin = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
      derivedMax = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
      for (let byteOffset = 0; byteOffset < logical.length; byteOffset += 4) {
        const rawValue = logical.readFloatLE(byteOffset);
        if (!Number.isFinite(rawValue)) fail("NORMALIZE_MESH_GLB_NONFINITE_POSITION", `${label} contains a non-finite float32 position component.`);
        const value = Object.is(rawValue, -0) ? 0 : rawValue;
        const component = (byteOffset / 4) % 3;
        derivedMin[component] = Math.min(derivedMin[component] ?? value, value);
        derivedMax[component] = Math.max(derivedMax[component] ?? value, value);
      }
      exactAccessorBounds(accessor.min, derivedMin, `${label}.min`);
      exactAccessorBounds(accessor.max, derivedMax, `${label}.max`);
    } else {
      let minimum = Number.POSITIVE_INFINITY;
      let maximum = Number.NEGATIVE_INFINITY;
      for (let indexOffset = 0; indexOffset < count; indexOffset += 1) {
        const value = componentType === 5123 ? logical.readUInt16LE(indexOffset * 2) : logical.readUInt32LE(indexOffset * 4);
        minimum = Math.min(minimum, value);
        maximum = Math.max(maximum, value);
      }
      derivedMin = [minimum];
      derivedMax = [maximum];
      const hasMin = accessor.min !== undefined;
      const hasMax = accessor.max !== undefined;
      if (hasMin !== hasMax) fail("NORMALIZE_MESH_GLB_ACCESSOR_BOUNDS", `${label} index bounds must be both present or both absent.`);
      if (hasMin) {
        exactAccessorBounds(accessor.min, derivedMin, `${label}.min`);
        exactAccessorBounds(accessor.max, derivedMax, `${label}.max`);
      }
    }
    return {
      name: name(accessor.name, `${label}.name`),
      role,
      componentType: componentType as 5123 | 5125 | 5126,
      type: type as "SCALAR" | "VEC3",
      normalized: false,
      count,
      logicalBytesSha256: `sha256:${sha256Bytes(logical)}`,
      derivedMin,
      derivedMax,
    };
  });
  if (accessorByView.size !== views.length) fail("NORMALIZE_MESH_GLB_UNREACHABLE_OBJECT", "Every bufferView must be owned by exactly one accessor.");

  const topology = meshSnapshots.flatMap((mesh, meshIndex) =>
    mesh.primitives.map((primitive, primitiveIndex) => {
      const position = accessorProofs[primitive.position];
      const indices = accessorProofs[primitive.indices];
      if (position === undefined || indices === undefined) fail("NORMALIZE_MESH_GLB_INVALID_REFERENCE", "Primitive accessor proof is missing.");
      const indexView = index(object(accessors[primitive.indices], "index accessor").bufferView, views.length, "index accessor.bufferView");
      const bytes = decodedViews.get(indexView);
      if (bytes === undefined) fail("NORMALIZE_MESH_GLB_INVALID_REFERENCE", "Index bytes are missing.");
      let maximum = -1;
      for (let indexOffset = 0; indexOffset < indices.count; indexOffset += 1) {
        const value = indices.componentType === 5123 ? bytes.readUInt16LE(indexOffset * 2) : bytes.readUInt32LE(indexOffset * 4);
        maximum = Math.max(maximum, value);
      }
      if (maximum >= position.count) fail("NORMALIZE_MESH_GLB_INDEX_OUT_OF_RANGE", "Primitive index references a vertex outside POSITION.");
      return {
        meshIndex,
        primitiveIndex,
        vertexCount: position.count,
        indexCount: indices.count,
        triangleCount: indices.count / 3,
        maximumIndex: maximum,
        indexSequenceSha256: indices.logicalBytesSha256,
      };
    }));

  const snapshot = toCanonicalJson({
    schemaVersion: FOUNDRY_NORMALIZE_MESH_GLB_SEMANTIC_SNAPSHOT_V0,
    asset: { version: "2.0" },
    defaultScene: 0,
    scenes: sceneSnapshots,
    nodes: nodeSnapshots,
    meshes: meshSnapshots,
    accessors: accessorProofs,
    topology,
    buffer: { name: name(firstBuffer.name, "buffers[0].name") },
  });
  return {
    snapshot,
    snapshotSha256: prefixedDigest(SNAPSHOT_DOMAIN, snapshot),
    accessorCount: accessors.length,
    compressedBufferViewCount,
  };
}

async function validateKhronos(bytes: Uint8Array, uri: string): Promise<{ version: string; errors: 0; warnings: 0 }> {
  let raw: unknown;
  try {
    raw = await validateBytes(bytes, { uri, format: "glb", writeTimestamp: false, maxIssues: 1_000 });
  } catch (error: unknown) {
    fail("NORMALIZE_MESH_GLB_VALIDATOR_FAILED", "Khronos glTF Validator could not parse GLB bytes.", error);
  }
  const report = object(raw, "validator report");
  const issues = object(report.issues, "validator report issues");
  const errors = integer(issues.numErrors, "validator numErrors");
  const warnings = integer(issues.numWarnings, "validator numWarnings");
  if (errors !== 0 || warnings !== 0) {
    fail("NORMALIZE_MESH_GLB_VALIDATION_ISSUES", `Khronos glTF Validator reported ${String(errors)} error(s) and ${String(warnings)} warning(s).`);
  }
  return { version: typeof report.validatorVersion === "string" ? report.validatorVersion : validatorVersion(), errors: 0, warnings: 0 };
}

const fatalLogger: ILogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: (text) => fail("NORMALIZE_MESH_GLB_GLTF_TRANSFORM_WARNING", `glTF Transform warning: ${text}`),
  error: (text) => fail("NORMALIZE_MESH_GLB_GLTF_TRANSFORM_ERROR", `glTF Transform error: ${text}`),
};

class SealedMemoryIO extends PlatformIO {
  protected readURI(_uri: string, _type: "view" | "text"): Promise<never> {
    return Promise.reject(
      new FoundryIntegrityError(
        "NORMALIZE_MESH_GLB_URI_FORBIDDEN",
        "The sealed in-memory GLB core cannot resolve any URI.",
      ),
    );
  }

  protected resolve(_base: string, _path: string): never {
    fail("NORMALIZE_MESH_GLB_URI_FORBIDDEN", "The sealed in-memory GLB core cannot resolve paths.");
  }

  protected dirname(_uri: string): never {
    fail("NORMALIZE_MESH_GLB_URI_FORBIDDEN", "The sealed in-memory GLB core has no directory context.");
  }
}

function reportPayload(input: {
  readonly invocation: FoundryNormalizeMeshGlbInvocationV0;
  readonly transform: NormalizeMeshGlbPureTransformInternalResult;
}): ReportPayload {
  return ReportPayloadSchema.parse({
    schemaVersion: FOUNDRY_NORMALIZE_MESH_GLB_REPORT_V0,
    invocationSha256: computeFoundryNormalizeMeshGlbInvocationSha256(input.invocation),
    operation: FOUNDRY_NORMALIZE_MESH_GLB_OPERATION,
    operationVersion: FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_VERSION,
    source: input.invocation.source,
    output: {
      mediaType: "model/gltf-binary",
      sizeBytes: input.transform.normalizedGlb.length,
      sha256: `sha256:${sha256Bytes(input.transform.normalizedGlb)}`,
    },
    semanticProof: input.transform.semanticProof,
    validation: input.transform.validation,
    transform: {
      extension: EXT_MESHOPT_COMPRESSION,
      required: true,
      encoderMethod: "quantize",
      meshoptFilter: "NONE",
      logicalAccessorMutation: "none_proven_by_exact_decoded_snapshot",
    },
    dependencies: DEPENDENCIES,
    policy: {
      inputExtensions: "none",
      meshSemantics: "static_indexed_identity_transform_position_float32_triangles",
      network: "none",
      childProcesses: "none",
      genericArguments: "none",
      mutationBeyondReturnedBytes: "none",
      measuredGeometryEligibility: "not_established",
      reconstructionQualityImprovement: "none",
      immutableRegistration: "not_authorized",
      signing: "not_authorized",
      publication: "not_authorized",
      promotion: "not_authorized",
    },
    limitations: LIMITATIONS,
    authority: "none",
  });
}

export function computeFoundryNormalizeMeshGlbInvocationSha256(input: unknown): string {
  return prefixedDigest(INVOCATION_DOMAIN, FoundryNormalizeMeshGlbInvocationV0Schema.parse(input));
}

export function computeFoundryNormalizeMeshGlbReportSha256(input: ReportPayload): string {
  return prefixedDigest(REPORT_DOMAIN, ReportPayloadSchema.parse(input));
}

/**
 * Production remains fail-closed until the durable control-plane adapter can bind the exact
 * verified stage, manifests, admission decision, JobSpec, fence, and purpose-aware derivative
 * rights. This function deliberately performs no parsing or filesystem access.
 */
export function runFoundryNormalizeMeshGlbWorker(
  _options: RunFoundryNormalizeMeshGlbWorkerOptions,
): never {
  fail(
    "NORMALIZE_MESH_GLB_PRODUCTION_BINDING_UNAVAILABLE",
    "normalize_mesh_glb/v0 production execution is disabled: reviewed verified-stage, manifest, admission, JobSpec, fence, and purpose-aware rights bindings are unavailable.",
  );
}

async function normalizeMeshGlbPureCore(
  invocationInput: FoundryNormalizeMeshGlbInvocationV0,
  sourceBytes: Uint8Array,
): Promise<FoundryNormalizeMeshGlbProofResult> {
  const invocation = FoundryNormalizeMeshGlbInvocationV0Schema.parse(invocationInput);
  const transform = await normalizeMeshGlbPureTransformInternal(
    invocation.source,
    sourceBytes,
  );
  const payload = reportPayload({ invocation, transform });
  const report = FoundryNormalizeMeshGlbReportV0Schema.parse({
    ...payload,
    reportSha256: computeFoundryNormalizeMeshGlbReportSha256(payload),
  });
  return { normalizedGlb: transform.normalizedGlb, report };
}

/**
 * Shared package-internal transform. It accepts only the exact source binding
 * and bytes, performs no path, process, network, registration, or custody IO,
 * and deliberately carries no execution authority. It is omitted from the
 * package root so only reviewed evidence wrappers can invoke it.
 */
export async function normalizeMeshGlbPureTransformInternal(
  sourceInput: FoundryNormalizeMeshGlbInvocationV0["source"],
  sourceBytes: Uint8Array,
): Promise<NormalizeMeshGlbPureTransformInternalResult> {
  const sourceBinding = SourceSchema.parse(sourceInput);
  if (sourceBytes.byteLength <= 0 || sourceBytes.byteLength > FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES ||
      sourceBytes.byteLength !== sourceBinding.sizeBytes) {
    fail("NORMALIZE_MESH_GLB_SOURCE_BINDING_MISMATCH", "Source byte length does not match the bounded invocation source before copying.");
  }
  const source = Buffer.from(sourceBytes);
  if (source.length !== sourceBinding.sizeBytes || `sha256:${sha256Bytes(source)}` !== sourceBinding.sha256) {
    fail("NORMALIZE_MESH_GLB_SOURCE_BINDING_MISMATCH", "Source bytes do not match the invocation's exact size and SHA-256 binding.");
  }
  const before = parseReviewedGeometry(parseGlb(source), false);
  const validationBefore = await validateKhronos(source, "source.glb");
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  if (!MeshoptEncoder.supported || !MeshoptDecoder.supported) fail("NORMALIZE_MESH_GLB_MESHOPT_UNAVAILABLE", "Pinned meshoptimizer encoder/decoder is unavailable.");
  const io = new SealedMemoryIO()
    .setStrictResources(true)
    .setVertexLayout(VertexLayout.SEPARATE)
    .setLogger(fatalLogger)
    .registerExtensions([EXTMeshoptCompression])
    .registerDependencies({ "meshopt.encoder": MeshoptEncoder, "meshopt.decoder": MeshoptDecoder });
  let document;
  try {
    document = await io.readBinary(source);
  } catch (error: unknown) {
    fail("NORMALIZE_MESH_GLB_GLTF_TRANSFORM_READ_FAILED", "Pinned glTF Transform could not read the reviewed input subset.", error);
  }
  document
    .createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  let normalized: Buffer;
  try {
    normalized = Buffer.from(await io.writeBinary(document));
  } catch (error: unknown) {
    fail("NORMALIZE_MESH_GLB_GLTF_TRANSFORM_WRITE_FAILED", "Pinned glTF Transform could not write the reviewed output subset.", error);
  }
  if (normalized.length > FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES) fail("NORMALIZE_MESH_GLB_OUTPUT_TOO_LARGE", "Normalized GLB exceeds the reviewed V0 bound.");
  const validationAfter = await validateKhronos(normalized, "normalized.glb");
  const after = parseReviewedGeometry(parseGlb(normalized), true);
  if (before.snapshotSha256 !== after.snapshotSha256 || stableCanonicalJson(before.snapshot) !== stableCanonicalJson(after.snapshot)) {
    fail("NORMALIZE_MESH_GLB_SEMANTIC_MISMATCH", "Decoded semantic snapshot changed during normalization.");
  }
  if (after.compressedBufferViewCount !== before.accessorCount) {
    fail("NORMALIZE_MESH_GLB_COMPRESSION_INCOMPLETE", "Every eligible accessor view must be independently proven meshopt-compressed.");
  }
  return {
    normalizedGlb: normalized,
    semanticProof: {
      schemaVersion: FOUNDRY_NORMALIZE_MESH_GLB_SEMANTIC_SNAPSHOT_V0,
      beforeSha256: before.snapshotSha256,
      afterSha256: after.snapshotSha256,
      exactMatch: true,
      accessorCount: before.accessorCount,
      compressedBufferViewCount: after.compressedBufferViewCount,
    },
    validation: { before: validationBefore, after: validationAfter },
  };
}

/** Test-only pure Buffer proof. Deliberately omitted from the package root export. */
export async function __testOnlyNormalizeMeshGlbBytes(
  invocation: FoundryNormalizeMeshGlbInvocationV0,
  sourceBytes: Uint8Array,
): Promise<FoundryNormalizeMeshGlbProofResult> {
  if (process.env.NODE_ENV !== "test") {
    fail("NORMALIZE_MESH_GLB_TEST_ONLY", "The pure normalization core is available only when NODE_ENV=test.");
  }
  return normalizeMeshGlbPureCore(invocation, sourceBytes);
}

/** Package-internal fresh semantic verifier, omitted from the package root. */
export async function verifyNormalizeMeshGlbSemanticProofInternal(input: {
  readonly sourceBytes: Uint8Array;
  readonly normalizedGlb: Uint8Array;
  readonly semanticProof: FoundryNormalizeMeshGlbReportV0["semanticProof"];
  readonly validation: FoundryNormalizeMeshGlbReportV0["validation"];
}): Promise<void> {
  const source = Buffer.from(input.sourceBytes);
  const normalized = Buffer.from(input.normalizedGlb);
  const before = parseReviewedGeometry(parseGlb(source), false);
  await MeshoptDecoder.ready;
  const after = parseReviewedGeometry(parseGlb(normalized), true);
  if (before.snapshotSha256 !== after.snapshotSha256 || before.snapshotSha256 !== input.semanticProof.beforeSha256 ||
      after.snapshotSha256 !== input.semanticProof.afterSha256 || after.compressedBufferViewCount !== before.accessorCount ||
      input.semanticProof.accessorCount !== before.accessorCount ||
      input.semanticProof.compressedBufferViewCount !== after.compressedBufferViewCount) {
    fail("NORMALIZE_MESH_GLB_PROOF_SEMANTIC_MISMATCH", "Normalization proof semantic bindings are inconsistent.");
  }
  const [validationBefore, validationAfter] = await Promise.all([
    validateKhronos(source, "source.glb"),
    validateKhronos(normalized, "normalized.glb"),
  ]);
  if (stableCanonicalJson(toCanonicalJson(input.validation.before)) !== stableCanonicalJson(toCanonicalJson(validationBefore)) ||
      stableCanonicalJson(toCanonicalJson(input.validation.after)) !== stableCanonicalJson(toCanonicalJson(validationAfter))) {
    fail("NORMALIZE_MESH_GLB_PROOF_VALIDATION_MISMATCH", "Normalization proof validator results do not match a fresh validation.");
  }
}

export async function verifyFoundryNormalizeMeshGlbProof(input: {
  readonly invocation: FoundryNormalizeMeshGlbInvocationV0;
  readonly sourceBytes: Uint8Array;
  readonly normalizedGlb: Uint8Array;
  readonly report: FoundryNormalizeMeshGlbReportV0;
}): Promise<void> {
  const invocation = FoundryNormalizeMeshGlbInvocationV0Schema.parse(input.invocation);
  const report = FoundryNormalizeMeshGlbReportV0Schema.parse(input.report);
  if (input.sourceBytes.byteLength <= 0 || input.sourceBytes.byteLength > FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES ||
      input.normalizedGlb.byteLength <= 0 || input.normalizedGlb.byteLength > FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES ||
      input.sourceBytes.byteLength !== invocation.source.sizeBytes || input.sourceBytes.byteLength !== report.source.sizeBytes ||
      input.normalizedGlb.byteLength !== report.output.sizeBytes) {
    fail("NORMALIZE_MESH_GLB_PROOF_BINDING_MISMATCH", "Normalization proof byte lengths exceed bounds or do not match declarations before copying.");
  }
  const source = Buffer.from(input.sourceBytes);
  const normalized = Buffer.from(input.normalizedGlb);
  const sourceSha256 = `sha256:${sha256Bytes(source)}`;
  if (report.invocationSha256 !== computeFoundryNormalizeMeshGlbInvocationSha256(invocation) ||
      stableCanonicalJson(toCanonicalJson(report.source)) !== stableCanonicalJson(toCanonicalJson(invocation.source)) ||
      invocation.source.sha256 !== sourceSha256 || invocation.source.sizeBytes !== source.length ||
      report.source.sha256 !== sourceSha256 || report.source.sizeBytes !== source.length ||
      report.output.sha256 !== `sha256:${sha256Bytes(normalized)}` || report.output.sizeBytes !== normalized.length) {
    fail("NORMALIZE_MESH_GLB_PROOF_BINDING_MISMATCH", "Normalization proof bytes do not match its canonical bindings.");
  }
  await verifyNormalizeMeshGlbSemanticProofInternal({
    sourceBytes: source,
    normalizedGlb: normalized,
    semanticProof: report.semanticProof,
    validation: report.validation,
  });
}
