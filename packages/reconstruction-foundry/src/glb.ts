// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- upstream ships no declarations.
/// <reference path="./gltf-validator.d.ts" />
import { readFile } from "node:fs/promises";
import { validateBytes } from "gltf-validator";
import { MeshoptDecoder } from "meshoptimizer";
import { FoundryIntegrityError } from "./errors.js";

export const FOUNDRY_GLB_MAX_BYTES = 8 * 1024 * 1024;
export const FOUNDRY_GLB_MAX_VERTICES = 1_000_000;
export const FOUNDRY_GLB_MAX_TRIANGLES = 1_000_000;
const GLB_FILE_HEADER_BYTES = 12;
const GLB_CHUNK_HEADER_BYTES = 8;
const GLB_FIRST_CHUNK_OFFSET = GLB_FILE_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES;
const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK_TYPE = 0x4e4f534a;
const BIN_CHUNK_TYPE = 0x004e4942;
const MESHOPT_EXTENSION = "EXT_meshopt_compression";
const QUANTIZATION_EXTENSION = "KHR_mesh_quantization";
const ALLOWED_REQUIRED_EXTENSIONS = new Set([
  MESHOPT_EXTENSION,
  "EXT_texture_webp",
  QUANTIZATION_EXTENSION,
]);

type JsonRecord = Readonly<Record<string, unknown>>;

export interface GlbInspection {
  readonly version: 2;
  readonly sizeBytes: number;
  readonly firstChunkBytes: number;
  readonly chunkCount: number;
  readonly hasBinaryChunk: true;
  readonly validatorVersion: string;
  readonly meshCount: number;
  readonly primitiveCount: number;
  readonly vertexCount: number;
  readonly triangleCount: number;
  readonly compressedBufferViewCount: number;
}

interface GlbContainer {
  readonly document: JsonRecord;
  readonly binary: Buffer;
  readonly firstChunkBytes: number;
  readonly chunkCount: number;
  readonly requiredExtensions: ReadonlySet<string>;
}

function record(value: unknown, label: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new FoundryIntegrityError("INVALID_GLB_STRUCTURE", `${label} must be an object.`);
  }
  return value as JsonRecord;
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new FoundryIntegrityError("INVALID_GLB_STRUCTURE", `${label} must be an array.`);
  }
  return value;
}

function stringArray(value: unknown, label: string): readonly string[] {
  return array(value, label).map((item) => {
    if (typeof item !== "string") {
      throw new FoundryIntegrityError("INVALID_GLB_STRUCTURE", `${label} entries must be strings.`);
    }
    return item;
  });
}

function index(value: unknown, length: number, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value >= length) {
    throw new FoundryIntegrityError("INVALID_GLB_STRUCTURE", `${label} is not a valid array index.`);
  }
  return value;
}

function nonnegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new FoundryIntegrityError("INVALID_GLB_STRUCTURE", `${label} must be a non-negative safe integer.`);
  }
  return value;
}

function optionalNonnegativeInteger(value: unknown, label: string): number {
  return value === undefined ? 0 : nonnegativeInteger(value, label);
}

function assertNoExternalUris(value: unknown, path = "GLB"): void {
  if (Array.isArray(value)) {
    value.forEach((item, itemIndex) => { assertNoExternalUris(item, `${path}[${String(itemIndex)}]`); });
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    if (key === "uri") {
      throw new FoundryIntegrityError("EXTERNAL_GLB_RESOURCE", `${path}.uri is forbidden; release GLBs must be self-contained.`);
    }
    assertNoExternalUris(child, `${path}.${key}`);
  }
}

function parseJsonChunk(bytes: Buffer): JsonRecord {
  let raw: unknown;
  try {
    let jsonText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    while (jsonText.endsWith("\u0000") || jsonText.endsWith(" ")) {
      jsonText = jsonText.slice(0, -1);
    }
    raw = JSON.parse(jsonText);
  } catch (error: unknown) {
    throw new FoundryIntegrityError("INVALID_GLB_JSON_CHUNK", "GLB first chunk must contain valid UTF-8 JSON.", { cause: error });
  }
  const document = record(raw, "GLB JSON");
  const asset = record(document.asset, "GLB asset");
  if (asset.version !== "2.0") {
    throw new FoundryIntegrityError("INVALID_GLB_JSON_CHUNK", "GLB JSON asset.version must be 2.0.");
  }
  assertNoExternalUris(document);
  return document;
}

function parseContainer(bytes: Buffer, sizeBytes: number): GlbContainer {
  if (sizeBytes <= GLB_FIRST_CHUNK_OFFSET || sizeBytes > FOUNDRY_GLB_MAX_BYTES) {
    throw new FoundryIntegrityError(
      "GLB_SIZE_OUT_OF_BOUNDS",
      `GLB must be larger than ${String(GLB_FIRST_CHUNK_OFFSET)} bytes and no larger than ${String(FOUNDRY_GLB_MAX_BYTES)} bytes.`,
    );
  }
  if (bytes.length !== sizeBytes) throw new FoundryIntegrityError("GLB_SIZE_MISMATCH", "Complete GLB bytes must match the declared file size.");
  if (bytes.readUInt32LE(0) !== GLB_MAGIC) throw new FoundryIntegrityError("INVALID_GLB_HEADER", "Dollhouse mesh is not a binary glTF file.");
  if (bytes.readUInt32LE(4) !== 2) throw new FoundryIntegrityError("UNSUPPORTED_GLB_VERSION", "Dollhouse mesh must use glTF binary version 2.");
  if (bytes.readUInt32LE(8) !== sizeBytes) throw new FoundryIntegrityError("GLB_SIZE_MISMATCH", "GLB declared byte length does not match the file.");
  const firstChunkBytes = bytes.readUInt32LE(GLB_FILE_HEADER_BYTES);
  if (
    bytes.readUInt32LE(GLB_FILE_HEADER_BYTES + 4) !== JSON_CHUNK_TYPE ||
    firstChunkBytes === 0 ||
    firstChunkBytes % 4 !== 0 ||
    GLB_FIRST_CHUNK_OFFSET + firstChunkBytes > sizeBytes
  ) {
    throw new FoundryIntegrityError("INVALID_GLB_JSON_CHUNK", "GLB first chunk must be a bounded, non-empty JSON chunk.");
  }
  const document = parseJsonChunk(bytes.subarray(GLB_FIRST_CHUNK_OFFSET, GLB_FIRST_CHUNK_OFFSET + firstChunkBytes));
  const binaryHeader = GLB_FIRST_CHUNK_OFFSET + firstChunkBytes;
  if (sizeBytes - binaryHeader < GLB_CHUNK_HEADER_BYTES) {
    throw new FoundryIntegrityError("INVALID_GLB_BIN_CHUNK", "Operational GLB is missing its BIN chunk.");
  }
  const binaryChunkBytes = bytes.readUInt32LE(binaryHeader);
  if (
    bytes.readUInt32LE(binaryHeader + 4) !== BIN_CHUNK_TYPE ||
    binaryChunkBytes % 4 !== 0 ||
    binaryHeader + GLB_CHUNK_HEADER_BYTES + binaryChunkBytes !== sizeBytes
  ) {
    throw new FoundryIntegrityError("INVALID_GLB_BIN_CHUNK", "GLB must contain one exact final BIN chunk.");
  }
  const buffers = array(document.buffers, "GLB buffers");
  if (buffers.length < 1 || buffers.length > 2) {
    throw new FoundryIntegrityError("INVALID_GLB_BIN_CHUNK", "Self-contained Foundry GLBs may declare the BIN buffer and one meshopt fallback buffer.");
  }
  const primaryBuffer = record(buffers[0], "GLB buffers[0]");
  const primaryLength = nonnegativeInteger(primaryBuffer.byteLength, "GLB buffers[0].byteLength");
  if (primaryLength > binaryChunkBytes || binaryChunkBytes - primaryLength > 3) {
    throw new FoundryIntegrityError("INVALID_GLB_BIN_CHUNK", "GLB BIN chunk does not match buffers[0].byteLength plus legal padding.");
  }
  if (buffers.length === 2) {
    const fallback = record(buffers[1], "GLB buffers[1]");
    nonnegativeInteger(fallback.byteLength, "GLB buffers[1].byteLength");
    const extensions = record(fallback.extensions, "GLB meshopt fallback extensions");
    const marker = record(extensions[MESHOPT_EXTENSION], "GLB meshopt fallback marker");
    if (marker.fallback !== true) {
      throw new FoundryIntegrityError("INVALID_MESHOPT_FALLBACK", "Second GLB buffer must be an explicit EXT_meshopt_compression fallback buffer.");
    }
  }
  const required = document.extensionsRequired === undefined
    ? []
    : stringArray(document.extensionsRequired, "GLB extensionsRequired");
  for (const extension of required) {
    if (!ALLOWED_REQUIRED_EXTENSIONS.has(extension)) {
      throw new FoundryIntegrityError("UNSUPPORTED_GLB_EXTENSION", `Unsupported required GLB extension: ${extension}.`);
    }
  }
  return {
    document,
    binary: bytes.subarray(binaryHeader + GLB_CHUNK_HEADER_BYTES, binaryHeader + GLB_CHUNK_HEADER_BYTES + primaryLength),
    firstChunkBytes,
    chunkCount: 2,
    requiredExtensions: new Set(required),
  };
}

function validatorIssueSummary(report: unknown): { readonly errors: number; readonly warnings: number; readonly firstMessage: string | null; readonly validatorVersion: string } {
  const root = record(report, "glTF Validator report");
  const issues = record(root.issues, "glTF Validator issues");
  const errors = nonnegativeInteger(issues.numErrors, "glTF Validator numErrors");
  const warnings = nonnegativeInteger(issues.numWarnings, "glTF Validator numWarnings");
  const messages = issues.messages === undefined ? [] : array(issues.messages, "glTF Validator messages");
  const first = messages[0] === undefined ? null : record(messages[0], "glTF Validator message");
  const firstMessage = first === null
    ? null
    : `${typeof first.code === "string" ? first.code : "VALIDATION_ISSUE"}: ${typeof first.message === "string" ? first.message : "unspecified glTF validation issue"}`;
  const validatorVersion = typeof root.validatorVersion === "string" ? root.validatorVersion : "2.0.0-dev.3.10";
  return { errors, warnings, firstMessage, validatorVersion };
}

async function validateWithKhronos(bytes: Buffer): Promise<string> {
  let report: unknown;
  try {
    report = await validateBytes(new Uint8Array(bytes), {
      uri: "dollhouse.glb",
      format: "glb",
      writeTimestamp: false,
      maxIssues: 1_000,
      ignoredIssues: ["UNSUPPORTED_EXTENSION"],
    });
  } catch (error: unknown) {
    throw new FoundryIntegrityError("GLTF_VALIDATOR_FAILED", "Khronos glTF Validator could not parse the GLB.", { cause: error });
  }
  const summary = validatorIssueSummary(report);
  if (summary.errors > 0 || summary.warnings > 0) {
    throw new FoundryIntegrityError(
      "GLTF_VALIDATION_ISSUES",
      `Khronos glTF Validator reported ${String(summary.errors)} error(s) and ${String(summary.warnings)} warning(s)` +
        (summary.firstMessage === null ? "." : `; ${summary.firstMessage}.`),
    );
  }
  return summary.validatorVersion;
}

interface DecodedViews {
  readonly views: ReadonlyMap<number, Buffer>;
  readonly compressedViewCount: number;
}

async function decodeBufferViews(container: GlbContainer): Promise<DecodedViews> {
  const bufferViews = array(container.document.bufferViews, "GLB bufferViews");
  const buffers = array(container.document.buffers, "GLB buffers");
  const views = new Map<number, Buffer>();
  let compressedViewCount = 0;
  await MeshoptDecoder.ready;
  for (const [viewIndex, value] of bufferViews.entries()) {
    const view = record(value, `GLB bufferViews[${String(viewIndex)}]`);
    const bufferIndex = index(view.buffer, buffers.length, "GLB bufferView.buffer");
    const viewLength = nonnegativeInteger(view.byteLength, "GLB bufferView.byteLength");
    const extensions = view.extensions === undefined ? null : record(view.extensions, "GLB bufferView.extensions");
    const meshoptValue = extensions?.[MESHOPT_EXTENSION];
    if (meshoptValue === undefined) {
      if (bufferIndex !== 0) {
        throw new FoundryIntegrityError("INVALID_MESHOPT_FALLBACK", "Fallback-buffer views must carry EXT_meshopt_compression metadata.");
      }
      const offset = optionalNonnegativeInteger(view.byteOffset, "GLB bufferView.byteOffset");
      if (offset + viewLength > container.binary.length) {
        throw new FoundryIntegrityError("INVALID_GLB_BUFFER_VIEW", "GLB buffer view exceeds the BIN chunk.");
      }
      views.set(viewIndex, container.binary.subarray(offset, offset + viewLength));
      continue;
    }
    if (!container.requiredExtensions.has(MESHOPT_EXTENSION)) {
      throw new FoundryIntegrityError("INVALID_MESHOPT_EXTENSION", "Meshopt buffer view requires EXT_meshopt_compression in extensionsRequired.");
    }
    const extension = record(meshoptValue, "GLB EXT_meshopt_compression buffer view");
    const sourceBuffer = index(extension.buffer, buffers.length, "meshopt source buffer");
    if (sourceBuffer !== 0 || sourceBuffer === bufferIndex) {
      throw new FoundryIntegrityError("INVALID_MESHOPT_EXTENSION", "Meshopt source must be BIN buffer 0 and differ from its fallback buffer.");
    }
    const sourceOffset = optionalNonnegativeInteger(extension.byteOffset, "meshopt byteOffset");
    const sourceLength = nonnegativeInteger(extension.byteLength, "meshopt byteLength");
    const count = nonnegativeInteger(extension.count, "meshopt count");
    const stride = nonnegativeInteger(extension.byteStride, "meshopt byteStride");
    const mode = typeof extension.mode === "string" ? extension.mode : "";
    const filter = extension.filter === undefined ? "NONE" : typeof extension.filter === "string" ? extension.filter : "";
    if (
      count === 0 ||
      stride === 0 ||
      count * stride !== viewLength ||
      sourceOffset + sourceLength > container.binary.length ||
      !["ATTRIBUTES", "TRIANGLES", "INDICES"].includes(mode) ||
      !["NONE", "OCTAHEDRAL", "QUATERNION", "EXPONENTIAL"].includes(filter)
    ) {
      throw new FoundryIntegrityError("INVALID_MESHOPT_EXTENSION", "Meshopt buffer view metadata is inconsistent or out of bounds.");
    }
    const target = new Uint8Array(viewLength);
    try {
      MeshoptDecoder.decodeGltfBuffer(
        target,
        count,
        stride,
        container.binary.subarray(sourceOffset, sourceOffset + sourceLength),
        mode,
        filter,
      );
    } catch (error: unknown) {
      throw new FoundryIntegrityError("MESHOPT_DECODE_FAILED", "EXT_meshopt_compression bytes failed independent decoding.", { cause: error });
    }
    views.set(viewIndex, Buffer.from(target));
    compressedViewCount += 1;
  }
  return { views, compressedViewCount };
}

interface AccessorView {
  readonly accessor: JsonRecord;
  readonly bytes: Buffer;
  readonly count: number;
  readonly componentType: number;
  readonly componentBytes: number;
  readonly componentCount: number;
  readonly type: string;
  readonly start: number;
  readonly stride: number;
}

function accessorView(input: {
  readonly accessorIndex: number;
  readonly accessors: readonly unknown[];
  readonly bufferViews: readonly unknown[];
  readonly decodedViews: ReadonlyMap<number, Buffer>;
}): AccessorView {
  const accessor = record(input.accessors[input.accessorIndex], `GLB accessors[${String(input.accessorIndex)}]`);
  if (accessor.sparse !== undefined) {
    throw new FoundryIntegrityError("UNSUPPORTED_GLB_SPARSE_ACCESSOR", "Foundry geometry QA does not accept sparse mesh accessors.");
  }
  const bufferViewIndex = index(accessor.bufferView, input.bufferViews.length, "GLB accessor.bufferView");
  const bufferView = record(input.bufferViews[bufferViewIndex], `GLB bufferViews[${String(bufferViewIndex)}]`);
  const bytes = input.decodedViews.get(bufferViewIndex);
  if (bytes === undefined) throw new FoundryIntegrityError("INVALID_GLB_BUFFER_VIEW", "Accessor buffer view was not independently materialized.");
  const componentType = nonnegativeInteger(accessor.componentType, "GLB accessor.componentType");
  const componentBytes = componentType === 5120 || componentType === 5121
    ? 1
    : componentType === 5122 || componentType === 5123
      ? 2
      : componentType === 5125 || componentType === 5126
        ? 4
        : 0;
  const type = typeof accessor.type === "string" ? accessor.type : "";
  const componentCount = type === "SCALAR" ? 1
    : type === "VEC2" ? 2
      : type === "VEC3" ? 3
        : type === "VEC4" || type === "MAT2" ? 4
          : type === "MAT3" ? 9
            : type === "MAT4" ? 16
              : 0;
  if (componentBytes === 0 || componentCount === 0) {
    throw new FoundryIntegrityError("INVALID_GLB_STRUCTURE", "GLB accessor has an unsupported componentType or shape.");
  }
  const count = nonnegativeInteger(accessor.count, "GLB accessor.count");
  if (count === 0) throw new FoundryIntegrityError("INVALID_GLB_STRUCTURE", "GLB geometry accessors cannot be empty.");
  const accessorOffset = optionalNonnegativeInteger(accessor.byteOffset, "GLB accessor.byteOffset");
  const elementBytes = componentBytes * componentCount;
  const stride = bufferView.byteStride === undefined ? elementBytes : nonnegativeInteger(bufferView.byteStride, "GLB bufferView.byteStride");
  const end = accessorOffset + ((count - 1) * stride) + elementBytes;
  if (stride < elementBytes || stride % componentBytes !== 0 || end > bytes.length || accessorOffset % componentBytes !== 0) {
    throw new FoundryIntegrityError("INVALID_GLB_ACCESSOR_BOUNDS", "GLB accessor exceeds or misaligns its independently decoded buffer view.");
  }
  return { accessor, bytes, count, componentType, componentBytes, componentCount, type, start: accessorOffset, stride };
}

function readComponent(view: AccessorView, element: number, component: number): number {
  const offset = view.start + (element * view.stride) + (component * view.componentBytes);
  if (view.componentType === 5120) return view.bytes.readInt8(offset);
  if (view.componentType === 5121) return view.bytes.readUInt8(offset);
  if (view.componentType === 5122) return view.bytes.readInt16LE(offset);
  if (view.componentType === 5123) return view.bytes.readUInt16LE(offset);
  if (view.componentType === 5125) return view.bytes.readUInt32LE(offset);
  if (view.componentType === 5126) return view.bytes.readFloatLE(offset);
  throw new FoundryIntegrityError("INVALID_GLB_STRUCTURE", "Unsupported accessor component type.");
}

function finiteVector(value: unknown, length: number, label: string): readonly number[] {
  if (!Array.isArray(value) || value.length !== length || !value.every((item) => typeof item === "number" && Number.isFinite(item))) {
    throw new FoundryIntegrityError("INVALID_GLB_ACCESSOR_BOUNDS", `${label} must contain ${String(length)} finite values.`);
  }
  return value as readonly number[];
}

function inspectFiniteAccessor(view: AccessorView): void {
  if (view.componentType !== 5126) return;
  for (let element = 0; element < view.count; element += 1) {
    for (let component = 0; component < view.componentCount; component += 1) {
      if (!Number.isFinite(readComponent(view, element, component))) {
        throw new FoundryIntegrityError("NON_FINITE_GLB_ACCESSOR", "Float accessor contains a non-finite value.");
      }
    }
  }
}

function inspectPositionAccessor(view: AccessorView, quantizationRequired: boolean): void {
  const validComponent = view.componentType === 5126 ||
    (quantizationRequired && [5120, 5121, 5122, 5123].includes(view.componentType));
  if (!validComponent || view.type !== "VEC3") {
    throw new FoundryIntegrityError("INVALID_GLB_POSITION_ACCESSOR", "POSITION must be float32 or KHR_mesh_quantization-compatible VEC3 data.");
  }
  const declaredMin = finiteVector(view.accessor.min, 3, "POSITION min");
  const declaredMax = finiteVector(view.accessor.max, 3, "POSITION max");
  const actualMin = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const actualMax = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (let vertex = 0; vertex < view.count; vertex += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = readComponent(view, vertex, axis);
      if (!Number.isFinite(value)) throw new FoundryIntegrityError("NON_FINITE_GLB_POSITION", "POSITION contains a non-finite coordinate.");
      actualMin[axis] = Math.min(actualMin[axis] ?? value, value);
      actualMax[axis] = Math.max(actualMax[axis] ?? value, value);
    }
  }
  for (const axis of [0, 1, 2] as const) {
    const max = actualMax[axis] ?? 0;
    const tolerance = view.componentType === 5126 ? Math.max(1e-6, Math.abs(max) * 1e-6) : 0;
    if (
      (declaredMin[axis] ?? 0) > (declaredMax[axis] ?? 0) ||
      Math.abs((declaredMin[axis] ?? 0) - (actualMin[axis] ?? 0)) > tolerance ||
      Math.abs((declaredMax[axis] ?? 0) - max) > tolerance
    ) {
      throw new FoundryIntegrityError("INVALID_GLB_POSITION_BOUNDS", "POSITION min/max do not describe the independently decoded vertex data.");
    }
  }
}

function inspectGeometry(
  container: GlbContainer,
  decodedViews: ReadonlyMap<number, Buffer>,
): Pick<GlbInspection, "meshCount" | "primitiveCount" | "vertexCount" | "triangleCount"> {
  const document = container.document;
  const scenes = array(document.scenes, "GLB scenes");
  const nodes = array(document.nodes, "GLB nodes");
  const meshes = array(document.meshes, "GLB meshes");
  const accessors = array(document.accessors, "GLB accessors");
  const bufferViews = array(document.bufferViews, "GLB bufferViews");
  if (scenes.length === 0 || nodes.length === 0 || meshes.length === 0) {
    throw new FoundryIntegrityError("EMPTY_GLB_GEOMETRY", "GLB must contain a default scene with nodes and meshes.");
  }
  const sceneIndex = index(document.scene, scenes.length, "GLB default scene");
  const scene = record(scenes[sceneIndex], `GLB scenes[${String(sceneIndex)}]`);
  const roots = array(scene.nodes, "GLB default scene nodes");
  const reachableMeshes = new Set<number>();
  const visitedNodes = new Set<number>();
  const activeNodes = new Set<number>();
  const visit = (nodeIndex: number): void => {
    if (activeNodes.has(nodeIndex)) throw new FoundryIntegrityError("CYCLIC_GLB_NODES", "GLB node hierarchy contains a cycle.");
    if (visitedNodes.has(nodeIndex)) return;
    activeNodes.add(nodeIndex);
    const node = record(nodes[nodeIndex], `GLB nodes[${String(nodeIndex)}]`);
    if (node.mesh !== undefined) reachableMeshes.add(index(node.mesh, meshes.length, "GLB node.mesh"));
    if (node.children !== undefined) {
      for (const child of array(node.children, "GLB node.children")) visit(index(child, nodes.length, "GLB child node"));
    }
    activeNodes.delete(nodeIndex);
    visitedNodes.add(nodeIndex);
  };
  for (const root of roots) visit(index(root, nodes.length, "GLB scene root node"));
  if (reachableMeshes.size === 0) throw new FoundryIntegrityError("EMPTY_GLB_GEOMETRY", "GLB default scene reaches no mesh primitives.");

  let primitiveCount = 0;
  let vertexCount = 0;
  let triangleCount = 0;
  for (const meshIndex of reachableMeshes) {
    const mesh = record(meshes[meshIndex], `GLB meshes[${String(meshIndex)}]`);
    const primitives = array(mesh.primitives, "GLB mesh.primitives");
    for (const primitiveValue of primitives) {
      const primitive = record(primitiveValue, "GLB mesh primitive");
      if ((primitive.mode ?? 4) !== 4) throw new FoundryIntegrityError("UNSUPPORTED_GLB_PRIMITIVE", "Foundry operational geometry must use TRIANGLES primitives.");
      const attributes = record(primitive.attributes, "GLB primitive.attributes");
      const positionIndex = index(attributes.POSITION, accessors.length, "GLB POSITION accessor");
      for (const accessorValue of Object.values(attributes)) {
        const attribute = accessorView({
          accessorIndex: index(accessorValue, accessors.length, "GLB attribute accessor"),
          accessors,
          bufferViews,
          decodedViews,
        });
        inspectFiniteAccessor(attribute);
      }
      const positions = accessorView({ accessorIndex: positionIndex, accessors, bufferViews, decodedViews });
      inspectPositionAccessor(positions, container.requiredExtensions.has(QUANTIZATION_EXTENSION));
      if (primitive.indices === undefined) {
        if (positions.count % 3 !== 0) throw new FoundryIntegrityError("INVALID_GLB_TRIANGLES", "Unindexed TRIANGLES vertex count must be divisible by three.");
        triangleCount += positions.count / 3;
      } else {
        const indices = accessorView({
          accessorIndex: index(primitive.indices, accessors.length, "GLB indices accessor"),
          accessors,
          bufferViews,
          decodedViews,
        });
        if (indices.type !== "SCALAR" || ![5121, 5123, 5125].includes(indices.componentType) || indices.count % 3 !== 0) {
          throw new FoundryIntegrityError("INVALID_GLB_INDEX_ACCESSOR", "Triangle indices need an unsigned SCALAR count divisible by three.");
        }
        for (let item = 0; item < indices.count; item += 1) {
          if (readComponent(indices, item, 0) >= positions.count) {
            throw new FoundryIntegrityError("GLB_INDEX_OUT_OF_RANGE", "Decoded GLB triangle index exceeds its POSITION accessor.");
          }
        }
        triangleCount += indices.count / 3;
      }
      primitiveCount += 1;
      vertexCount += positions.count;
    }
  }
  if (primitiveCount === 0 || vertexCount > FOUNDRY_GLB_MAX_VERTICES || triangleCount > FOUNDRY_GLB_MAX_TRIANGLES) {
    throw new FoundryIntegrityError("GLB_GEOMETRY_BUDGET_EXCEEDED", "GLB vertex or triangle budget was exceeded.");
  }
  return { meshCount: reachableMeshes.size, primitiveCount, vertexCount, triangleCount };
}

/** Full official validation plus independent meshopt decoding and geometry inspection. */
export async function parseGlbHeader(bytes: Buffer, sizeBytes: number): Promise<GlbInspection> {
  const container = parseContainer(bytes, sizeBytes);
  const [validatorVersion, decoded] = await Promise.all([
    validateWithKhronos(bytes),
    decodeBufferViews(container),
  ]);
  const geometry = inspectGeometry(container, decoded.views);
  return {
    version: 2,
    sizeBytes,
    firstChunkBytes: container.firstChunkBytes,
    chunkCount: container.chunkCount,
    hasBinaryChunk: true,
    validatorVersion,
    compressedBufferViewCount: decoded.compressedViewCount,
    ...geometry,
  };
}

export async function inspectGlb(path: string, sizeBytes: number): Promise<GlbInspection> {
  if (sizeBytes > FOUNDRY_GLB_MAX_BYTES) {
    throw new FoundryIntegrityError("GLB_SIZE_OUT_OF_BOUNDS", `GLB must be no larger than ${String(FOUNDRY_GLB_MAX_BYTES)} bytes.`);
  }
  return parseGlbHeader(await readFile(path), sizeBytes);
}
