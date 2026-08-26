/**
 * Authority-none source-topology atlas for all eight T-554 Grand Hall
 * MatterPak shared-index interfaces.
 *
 * The atlas projects exact source triangles only. It does not fit a plane,
 * close an opening, choose a keep side, join cameras, repair a contour, infer
 * a doorway, author a mask, or grant any runtime/training authority.
 */

import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  GRAND_HALL_ROOM_9,
  parseMatterportObjText,
  stableCanonicalJson,
  type AxisAlignedBounds3,
  type JsonValue,
  type MatterportObjTriangle,
  type MatterportRoomKey,
  type ParsedMatterportObj,
  type Vec3,
} from "./grand-hall-room9-boundary.js";
import { verifyT554SvgSafety } from "./grand-hall-t554-svg-safety.js";

export const GRAND_HALL_T554_INTERFACE_ATLAS_SCHEMA =
  "omnitwin.foundry.grand-hall-t554-interface-topology-atlas.v1";
export const GRAND_HALL_T554_INTERFACE_ATLAS_DOMAIN =
  "OMNITWIN_GRAND_HALL_T554_INTERFACE_TOPOLOGY_ATLAS_V1";
export const GRAND_HALL_T554_INTERFACE_ATLAS_FATAL_MESSAGE =
  "Grand Hall T-554 interface topology atlas failed; no atlas was issued.";

const T551_SOURCE_RECEIPT_SHA256 =
  "sha256:0d331b5193f345ad5a127372b691ae02d2049fecdcfd0bc92b7f7cc27166997b";
const T551_BOUNDARY_EVIDENCE_SHA256 =
  "sha256:7ab3490a55f67d700a8ab84581e53c69e66b3dc831256bc9b70350d43f8b41c4";
const T554_BOUNDARY_REVIEW_MANIFEST_SHA256 =
  "sha256:289dff7895d9e840671d503b74f576460f6e15b7ff32efae0ca12a866a875dd3";
export const GRAND_HALL_T554_EXACT_INTERFACE_ATLAS_MANIFEST_SHA256 =
  "sha256:6f7b702ef8b74b22e6d83d516ff8a2b160ee78ddcdd66f7a06370982ed96e4bc";
const MAX_MANIFEST_BYTES = 32 * 1_024 * 1_024;
const MAX_SVG_BYTES = 16 * 1_024 * 1_024;
const FILE_READ_BLOCK_BYTES = 8 * 1_024 * 1_024;

type Sha256 = `sha256:${string}`;
type Edge = readonly [number, number];
type Projection = "XY" | "XZ" | "YZ";

export interface T554InterfaceDefinition {
  readonly interfaceId: string;
  readonly roomB: MatterportRoomKey;
}

export const GRAND_HALL_T554_INTERFACE_DEFINITIONS = Object.freeze([
  Object.freeze({ interfaceId: "matterpak-1-9-0-2", roomB: Object.freeze({ groupIndex: 0, subIndex: 2 }) }),
  Object.freeze({ interfaceId: "matterpak-1-9-0-3", roomB: Object.freeze({ groupIndex: 0, subIndex: 3 }) }),
  Object.freeze({ interfaceId: "matterpak-1-9-0-4", roomB: Object.freeze({ groupIndex: 0, subIndex: 4 }) }),
  Object.freeze({ interfaceId: "matterpak-1-9-1-10", roomB: Object.freeze({ groupIndex: 1, subIndex: 10 }) }),
  Object.freeze({ interfaceId: "matterpak-1-9-1-11", roomB: Object.freeze({ groupIndex: 1, subIndex: 11 }) }),
  Object.freeze({ interfaceId: "matterpak-1-9-1-12", roomB: Object.freeze({ groupIndex: 1, subIndex: 12 }) }),
  Object.freeze({ interfaceId: "matterpak-1-9-1-13", roomB: Object.freeze({ groupIndex: 1, subIndex: 13 }) }),
  Object.freeze({ interfaceId: "matterpak-1-9-1-14", roomB: Object.freeze({ groupIndex: 1, subIndex: 14 }) }),
] satisfies readonly T554InterfaceDefinition[]);

export const GRAND_HALL_T554_INTERFACE_ATLAS_OBJ_RECEIPT = Object.freeze({
  sourceLocator: "MATTERPAK_SOURCE_ROOT/424ff41f6e5d41969c635fcd61be9b3f.obj",
  fileName: "424ff41f6e5d41969c635fcd61be9b3f.obj",
  byteLength: 38_381_816,
  sha256: "sha256:cf7247b5343fe719dc0f1aaf6b64c667d238c69133b71c44ccd9f5c67b5878c7",
} satisfies T554InterfaceAtlasSourceReceipt);

const ATLAS_AUTHORITY: JsonValue = Object.freeze({
  state: "none",
  reviewState: "human_pending",
  interfaceDecisionsAccepted: false,
  closurePlaneAuthored: false,
  keepSideDecisionMade: false,
  cameraJoinAuthored: false,
  maskAuthored: false,
  repairedContourAuthored: false,
  inferredPortalOrDoorwayAuthored: false,
  generatedGeometryUsed: false,
  trainingAuthority: false,
  runtimeAuthority: false,
  structuralAuthority: false,
  exportAuthority: false,
});

export interface T554InterfaceAtlasSourceReceipt {
  readonly sourceLocator: string;
  readonly fileName: string;
  readonly byteLength: number;
  readonly sha256: Sha256;
}

export interface T554VerifiedInterfaceAtlasSummary {
  readonly manifestSha256: Sha256;
  readonly boundaryReviewManifestSha256: Sha256;
  readonly obj: Omit<T554InterfaceAtlasSourceReceipt, "fileName">;
  readonly interfaces: readonly {
    readonly interfaceId: string;
    readonly roomA: MatterportRoomKey;
    readonly roomB: MatterportRoomKey;
    readonly sharedVertexCount: number;
    readonly sharedVertices: readonly {
      readonly index: number;
      readonly position: Vec3;
    }[];
    readonly sharedVertexIndicesSha256: Sha256;
    readonly sharedPositionsSha256: Sha256;
    readonly sharedBoundsMeters: AxisAlignedBounds3;
    readonly room9BoundaryEdgeCount: number;
    readonly room9BoundaryEdges: readonly Edge[];
    readonly room9BoundaryEdgesSha256: Sha256;
  }[];
}

export interface T554InterfaceAtlasBuildInputs {
  readonly sourceObj: Omit<T554InterfaceAtlasSourceReceipt, "fileName">;
  readonly objText: string;
}

export interface T554InterfaceAtlasPack {
  readonly manifest: JsonValue;
  readonly manifestSha256: Sha256;
  readonly files: ReadonlyMap<string, string>;
}

export interface T554InterfaceAtlasFileOptions {
  readonly matterpakSourceRoot: string;
}

export interface T554InterfaceAtlasWriteOptions extends T554InterfaceAtlasFileOptions {
  readonly outputDirectory: string;
  readonly hooks?: T554InterfaceAtlasReadHooks;
}

export interface T554InterfaceAtlasReadEvent {
  readonly purpose: "source_obj" | "manifest" | "svg";
  readonly fileName: string;
  readonly canonicalPath: string;
}

export interface T554InterfaceAtlasReadHooks {
  readonly afterDescriptorRead?: (event: T554InterfaceAtlasReadEvent) => void;
}

export interface T554InterfaceAtlasStableExpectation {
  readonly byteLength?: number;
  readonly sha256?: Sha256;
  readonly maximumByteLength: number;
}

export interface T554InterfaceAtlasStableFile {
  readonly bytes: Uint8Array;
  readonly byteLength: number;
  readonly sha256: Sha256;
}

interface FileIdentitySnapshot {
  readonly device: bigint;
  readonly inode: bigint;
  readonly mode: bigint;
  readonly size: bigint;
  readonly modifiedNs: bigint;
  readonly changedNs: bigint;
  readonly links: bigint;
}

interface VertexEvidence {
  readonly index: number;
  readonly position: Vec3;
}

interface TriangleEvidence {
  readonly sourceFaceOrdinal: number;
  readonly vertexIndices: readonly [number, number, number];
  readonly groupName: string;
  readonly material: string | null;
}

interface SideEvidence {
  readonly room: MatterportRoomKey;
  readonly groupNames: readonly string[];
  readonly vertices: readonly VertexEvidence[];
  readonly verticesSha256: Sha256;
  readonly triangles: readonly TriangleEvidence[];
  readonly sourceFaceOrdinals: readonly number[];
  readonly sourceFaceOrdinalsSha256: Sha256;
  readonly trianglesSha256: Sha256;
  readonly boundsMeters: AxisAlignedBounds3;
}

interface EdgeComponentEvidence {
  readonly componentIndex: number;
  readonly vertexIndices: readonly number[];
  readonly edges: readonly Edge[];
  readonly vertexIndicesSha256: Sha256;
  readonly edgesSha256: Sha256;
  readonly boundsMeters: AxisAlignedBounds3;
}

interface InterfaceEvidence {
  readonly definition: T554InterfaceDefinition;
  readonly sharedVertices: readonly VertexEvidence[];
  readonly room9: SideEvidence;
  readonly adjacent: SideEvidence;
  readonly inducedEdges: readonly Edge[];
  readonly components: readonly EdgeComponentEvidence[];
  readonly room9BoundaryEdges: readonly Edge[];
  readonly sharedBounds: AxisAlignedBounds3;
  readonly localBounds: AxisAlignedBounds3;
  readonly manifestValue: JsonValue;
}

interface RoomIndex {
  readonly key: MatterportRoomKey;
  readonly triangles: readonly MatterportObjTriangle[];
  readonly vertexIndices: ReadonlySet<number>;
}

interface ProjectionDefinition {
  readonly name: Projection;
  readonly horizontalAxis: 0 | 1;
  readonly verticalAxis: 1 | 2;
  readonly horizontalLabel: "X" | "Y";
  readonly verticalLabel: "Y" | "Z";
}

const PROJECTIONS: readonly ProjectionDefinition[] = Object.freeze([
  { name: "XY", horizontalAxis: 0, verticalAxis: 1, horizontalLabel: "X", verticalLabel: "Y" },
  { name: "XZ", horizontalAxis: 0, verticalAxis: 2, horizontalLabel: "X", verticalLabel: "Z" },
  { name: "YZ", horizontalAxis: 1, verticalAxis: 2, horizontalLabel: "Y", verticalLabel: "Z" },
]);

function sha256(bytes: Uint8Array): Sha256 {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalDigest(domain: string, value: JsonValue): Sha256 {
  return `sha256:${createHash("sha256")
    .update(`${domain}\n${stableCanonicalJson(value)}`, "utf8")
    .digest("hex")}`;
}

export function computeT554InterfaceAtlasManifestSha256(material: JsonValue): Sha256 {
  return canonicalDigest(GRAND_HALL_T554_INTERFACE_ATLAS_DOMAIN, material);
}

function descriptorIdentity(descriptor: number): FileIdentitySnapshot {
  const stats = fstatSync(descriptor, { bigint: true });
  return {
    device: stats.dev,
    inode: stats.ino,
    mode: stats.mode,
    size: stats.size,
    modifiedNs: stats.mtimeNs,
    changedNs: stats.ctimeNs,
    links: stats.nlink,
  };
}

function pathIdentity(path: string): FileIdentitySnapshot {
  const stats = statSync(path, { bigint: true });
  return {
    device: stats.dev,
    inode: stats.ino,
    mode: stats.mode,
    size: stats.size,
    modifiedNs: stats.mtimeNs,
    changedNs: stats.ctimeNs,
    links: stats.nlink,
  };
}

function sameIdentity(left: FileIdentitySnapshot, right: FileIdentitySnapshot): boolean {
  return (
    left.device === right.device &&
    left.inode === right.inode &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.modifiedNs === right.modifiedNs &&
    left.changedNs === right.changedNs &&
    left.links === right.links
  );
}

/** Race-safe, descriptor-bound reader used for both immutable source and atlas files. */
export function readStableT554InterfaceAtlasFile(
  path: string,
  expectation: T554InterfaceAtlasStableExpectation,
  event: Omit<T554InterfaceAtlasReadEvent, "canonicalPath">,
  hooks: T554InterfaceAtlasReadHooks = {},
): T554InterfaceAtlasStableFile {
  if (!isAbsolute(path)) throw new Error("atlas evidence file must be absolute");
  if (lstatSync(path).isSymbolicLink()) throw new Error("atlas evidence file cannot be a link");
  const canonicalBefore = realpathSync(path);
  if (!statSync(canonicalBefore).isFile()) throw new Error("atlas evidence path must be a regular file");
  const descriptor = openSync(canonicalBefore, "r");
  try {
    const before = descriptorIdentity(descriptor);
    if (!sameIdentity(before, pathIdentity(canonicalBefore))) {
      throw new Error("atlas descriptor and path identities differ");
    }
    if (before.links !== 1n) throw new Error("atlas evidence file cannot have hard links");
    if (before.size < 0n || before.size > BigInt(expectation.maximumByteLength)) {
      throw new Error("atlas evidence file exceeds its byte ceiling");
    }
    if (expectation.byteLength !== undefined && before.size !== BigInt(expectation.byteLength)) {
      throw new Error("atlas evidence byte length differs");
    }
    const byteLength = Number(before.size);
    const bytes = Buffer.alloc(byteLength);
    const digest = createHash("sha256");
    let offset = 0;
    while (offset < byteLength) {
      const requested = Math.min(FILE_READ_BLOCK_BYTES, byteLength - offset);
      const bytesRead = readSync(descriptor, bytes, offset, requested, offset);
      if (bytesRead <= 0) throw new Error("atlas evidence ended during descriptor read");
      digest.update(bytes.subarray(offset, offset + bytesRead));
      offset += bytesRead;
    }
    const fileSha256: Sha256 = `sha256:${digest.digest("hex")}`;
    hooks.afterDescriptorRead?.({ ...event, canonicalPath: canonicalBefore });
    const canonicalAfter = realpathSync(path);
    const after = descriptorIdentity(descriptor);
    if (
      canonicalAfter !== canonicalBefore ||
      lstatSync(path).isSymbolicLink() ||
      !sameIdentity(before, after) ||
      !sameIdentity(after, pathIdentity(canonicalAfter)) ||
      after.links !== 1n
    ) {
      throw new Error("atlas evidence path identity changed during read");
    }
    if (expectation.sha256 !== undefined && fileSha256 !== expectation.sha256) {
      throw new Error("atlas evidence SHA-256 differs");
    }
    return { bytes, byteLength, sha256: fileSha256 };
  } finally {
    closeSync(descriptor);
  }
}

function validateDirectory(path: string, label: string): string {
  if (!isAbsolute(path)) throw new Error(`${label} must be absolute`);
  if (lstatSync(path).isSymbolicLink()) throw new Error(`${label} cannot be a link`);
  const canonical = realpathSync(path);
  if (!statSync(canonical).isDirectory()) throw new Error(`${label} must be a directory`);
  return canonical;
}

export function loadT554InterfaceAtlasInputsFromFiles(
  options: T554InterfaceAtlasFileOptions,
  hooks: T554InterfaceAtlasReadHooks = {},
): T554InterfaceAtlasBuildInputs {
  const root = validateDirectory(options.matterpakSourceRoot, "MatterPak source root");
  const path = resolve(root, GRAND_HALL_T554_INTERFACE_ATLAS_OBJ_RECEIPT.fileName);
  if (dirname(path) !== root || basename(path) !== GRAND_HALL_T554_INTERFACE_ATLAS_OBJ_RECEIPT.fileName) {
    throw new Error("MatterPak OBJ path escaped its exact source root");
  }
  const source = readStableT554InterfaceAtlasFile(
    path,
    {
      byteLength: GRAND_HALL_T554_INTERFACE_ATLAS_OBJ_RECEIPT.byteLength,
      sha256: GRAND_HALL_T554_INTERFACE_ATLAS_OBJ_RECEIPT.sha256,
      maximumByteLength: GRAND_HALL_T554_INTERFACE_ATLAS_OBJ_RECEIPT.byteLength,
    },
    { purpose: "source_obj", fileName: GRAND_HALL_T554_INTERFACE_ATLAS_OBJ_RECEIPT.fileName },
    hooks,
  );
  return {
    sourceObj: {
      sourceLocator: GRAND_HALL_T554_INTERFACE_ATLAS_OBJ_RECEIPT.sourceLocator,
      byteLength: source.byteLength,
      sha256: source.sha256,
    },
    objText: new TextDecoder("utf-8", { fatal: true }).decode(source.bytes),
  };
}

function roomId(room: MatterportRoomKey): string {
  return `${String(room.groupIndex)}:${String(room.subIndex)}`;
}

function sameRoom(left: MatterportRoomKey, right: MatterportRoomKey): boolean {
  return left.groupIndex === right.groupIndex && left.subIndex === right.subIndex;
}

function canonicalInterfaceId(roomB: MatterportRoomKey): string {
  return `matterpak-1-9-${String(roomB.groupIndex)}-${String(roomB.subIndex)}`;
}

function compareNumbers(left: number, right: number): number {
  return left - right;
}

function canonicalEdge(left: number, right: number): Edge {
  return left < right ? [left, right] : [right, left];
}

function edgeKey(value: Edge): string {
  return `${String(value[0])}:${String(value[1])}`;
}

function compareEdges(left: Edge, right: Edge): number {
  return left[0] - right[0] || left[1] - right[1];
}

function triangleEdges(triangle: Pick<TriangleEvidence, "vertexIndices">): readonly Edge[] {
  const [a, b, c] = triangle.vertexIndices;
  return [canonicalEdge(a, b), canonicalEdge(b, c), canonicalEdge(c, a)];
}

function roomIndex(model: ParsedMatterportObj): ReadonlyMap<string, RoomIndex> {
  const mutable = new Map<string, { key: MatterportRoomKey; triangles: MatterportObjTriangle[]; vertices: Set<number> }>();
  for (const triangle of model.triangles) {
    const id = roomId(triangle.group);
    const current = mutable.get(id) ?? {
      key: { groupIndex: triangle.group.groupIndex, subIndex: triangle.group.subIndex },
      triangles: [],
      vertices: new Set<number>(),
    };
    current.triangles.push(triangle);
    for (const index of triangle.vertexIndices) current.vertices.add(index);
    mutable.set(id, current);
  }
  return new Map([...mutable.entries()].map(([id, value]) => [id, {
    key: value.key,
    triangles: value.triangles,
    vertexIndices: value.vertices,
  }]));
}

function vertex(model: ParsedMatterportObj, index: number): Vec3 {
  const value = model.vertices[index];
  if (value === undefined) throw new Error(`source vertex ${String(index)} is absent`);
  return value;
}

function vertexEvidence(model: ParsedMatterportObj, indices: readonly number[]): VertexEvidence[] {
  return indices.map((index) => ({ index, position: vertex(model, index) }));
}

function boundsForVertices(vertices: readonly VertexEvidence[]): AxisAlignedBounds3 {
  if (vertices.length === 0) throw new Error("cannot derive metric bounds from no vertices");
  const min: [number, number, number] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max: [number, number, number] = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const item of vertices) {
    for (const axis of [0, 1, 2] as const) {
      const value = item.position[axis];
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
  }
  return { min, max };
}

function unionBounds(left: AxisAlignedBounds3, right: AxisAlignedBounds3): AxisAlignedBounds3 {
  return {
    min: [
      Math.min(left.min[0], right.min[0]),
      Math.min(left.min[1], right.min[1]),
      Math.min(left.min[2], right.min[2]),
    ],
    max: [
      Math.max(left.max[0], right.max[0]),
      Math.max(left.max[1], right.max[1]),
      Math.max(left.max[2], right.max[2]),
    ],
  };
}

function triangleValue(triangle: TriangleEvidence): JsonValue {
  return {
    sourceFaceOrdinal: triangle.sourceFaceOrdinal,
    vertexIndices: triangle.vertexIndices,
    groupName: triangle.groupName,
    material: triangle.material,
  };
}

function vertexValue(item: VertexEvidence): JsonValue {
  return { index: item.index, position: item.position };
}

function sideEvidence(
  model: ParsedMatterportObj,
  room: RoomIndex,
  shared: ReadonlySet<number>,
  interfaceId: string,
  side: "room9" | "adjacent",
): SideEvidence {
  const selected = room.triangles
    .filter((triangle) => triangle.vertexIndices.some((index) => shared.has(index)))
    .sort((left, right) => left.sourceFaceOrdinal - right.sourceFaceOrdinal);
  if (selected.length === 0) throw new Error(`${interfaceId} ${side} has no incident source triangles`);
  const triangles: TriangleEvidence[] = selected.map((triangle) => ({
    sourceFaceOrdinal: triangle.sourceFaceOrdinal,
    vertexIndices: triangle.vertexIndices,
    groupName: triangle.group.name,
    material: (() => {
      if (triangle.material !== null && !/^[A-Za-z0-9._-]+$/u.test(triangle.material)) {
        throw new Error(`${interfaceId} ${side} source material name is unsafe`);
      }
      return triangle.material;
    })(),
  }));
  const indices = [...new Set(triangles.flatMap((triangle) => [...triangle.vertexIndices]))].sort(compareNumbers);
  const vertices = vertexEvidence(model, indices);
  const sourceFaceOrdinals = triangles.map((triangle) => triangle.sourceFaceOrdinal);
  const groupNames = [...new Set(triangles.map((triangle) => triangle.groupName))].sort();
  return {
    room: room.key,
    groupNames,
    vertices,
    verticesSha256: canonicalDigest(`${GRAND_HALL_T554_INTERFACE_ATLAS_DOMAIN}.${interfaceId}.${side}.vertices`, vertices.map(vertexValue)),
    triangles,
    sourceFaceOrdinals,
    sourceFaceOrdinalsSha256: canonicalDigest(`${GRAND_HALL_T554_INTERFACE_ATLAS_DOMAIN}.${interfaceId}.${side}.face-ordinals`, sourceFaceOrdinals),
    trianglesSha256: canonicalDigest(`${GRAND_HALL_T554_INTERFACE_ATLAS_DOMAIN}.${interfaceId}.${side}.triangles`, triangles.map(triangleValue)),
    boundsMeters: boundsForVertices(vertices),
  };
}

function room9BoundaryEdges(room9: RoomIndex): readonly Edge[] {
  const incidence = new Map<string, { edge: Edge; count: number }>();
  for (const triangle of room9.triangles) {
    for (const candidate of triangleEdges(triangle)) {
      const key = edgeKey(candidate);
      const current = incidence.get(key);
      if (current === undefined) incidence.set(key, { edge: candidate, count: 1 });
      else current.count += 1;
    }
  }
  return [...incidence.values()]
    .filter((item) => item.count === 1)
    .map((item) => item.edge)
    .sort(compareEdges);
}

function inducedEdges(
  room9: Pick<SideEvidence, "triangles">,
  adjacent: Pick<SideEvidence, "triangles">,
  shared: ReadonlySet<number>,
): Edge[] {
  const edges = new Map<string, Edge>();
  for (const triangle of [...room9.triangles, ...adjacent.triangles]) {
    for (const candidate of triangleEdges(triangle)) {
      if (!shared.has(candidate[0]) || !shared.has(candidate[1])) continue;
      edges.set(edgeKey(candidate), candidate);
    }
  }
  return [...edges.values()].sort(compareEdges);
}

function inducedComponents(
  model: ParsedMatterportObj,
  interfaceId: string,
  sharedIndices: readonly number[],
  edges: readonly Edge[],
): EdgeComponentEvidence[] {
  const graph = new Map<number, Set<number>>(sharedIndices.map((index) => [index, new Set<number>()]));
  for (const [a, b] of edges) {
    graph.get(a)?.add(b);
    graph.get(b)?.add(a);
  }
  const visited = new Set<number>();
  const raw: { vertices: number[]; edges: Edge[] }[] = [];
  for (const start of sharedIndices) {
    if (visited.has(start)) continue;
    const stack = [start];
    const vertices: number[] = [];
    visited.add(start);
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) break;
      vertices.push(current);
      for (const neighbor of [...(graph.get(current) ?? [])].sort((left, right) => right - left)) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          stack.push(neighbor);
        }
      }
    }
    vertices.sort(compareNumbers);
    const members = new Set(vertices);
    raw.push({ vertices, edges: edges.filter(([a, b]) => members.has(a) && members.has(b)) });
  }
  raw.sort((left, right) => (left.vertices[0] ?? 0) - (right.vertices[0] ?? 0));
  return raw.map((component, componentIndex) => ({
    componentIndex,
    vertexIndices: component.vertices,
    edges: component.edges,
    vertexIndicesSha256: canonicalDigest(
      `${GRAND_HALL_T554_INTERFACE_ATLAS_DOMAIN}.${interfaceId}.component.${String(componentIndex)}.vertices`,
      component.vertices,
    ),
    edgesSha256: canonicalDigest(
      `${GRAND_HALL_T554_INTERFACE_ATLAS_DOMAIN}.${interfaceId}.component.${String(componentIndex)}.edges`,
      component.edges,
    ),
    boundsMeters: boundsForVertices(vertexEvidence(model, component.vertices)),
  }));
}

function roomValue(room: MatterportRoomKey): JsonValue {
  return { groupIndex: room.groupIndex, subIndex: room.subIndex };
}

function boundsValue(bounds: AxisAlignedBounds3): JsonValue {
  return { min: bounds.min, max: bounds.max };
}

function sideValue(side: SideEvidence): JsonValue {
  return {
    room: roomValue(side.room),
    groupNames: side.groupNames,
    vertexCount: side.vertices.length,
    vertices: side.vertices.map(vertexValue),
    verticesSha256: side.verticesSha256,
    faceCount: side.triangles.length,
    sourceFaceOrdinals: side.sourceFaceOrdinals,
    sourceFaceOrdinalsSha256: side.sourceFaceOrdinalsSha256,
    triangles: side.triangles.map(triangleValue),
    trianglesSha256: side.trianglesSha256,
    boundsMeters: boundsValue(side.boundsMeters),
  };
}

function componentValue(component: EdgeComponentEvidence): JsonValue {
  return {
    componentIndex: component.componentIndex,
    vertexIndices: component.vertexIndices,
    edges: component.edges,
    vertexIndicesSha256: component.vertexIndicesSha256,
    edgesSha256: component.edgesSha256,
    boundsMeters: boundsValue(component.boundsMeters),
  };
}

function interfaceManifestValue(
  definition: T554InterfaceDefinition,
  sharedVertices: readonly VertexEvidence[],
  room9: SideEvidence,
  adjacent: SideEvidence,
  edges: readonly Edge[],
  components: readonly EdgeComponentEvidence[],
  boundaryEdges: readonly Edge[],
): JsonValue {
  const sharedIndices = sharedVertices.map((item) => item.index);
  const sharedBounds = boundsForVertices(sharedVertices);
  const localBounds = unionBounds(room9.boundsMeters, adjacent.boundsMeters);
  const material: JsonValue = {
    interfaceId: definition.interfaceId,
    roomA: roomValue(GRAND_HALL_ROOM_9),
    roomB: roomValue(definition.roomB),
    reviewState: "human_pending",
    disposition: null,
    sharedVertices: {
      count: sharedVertices.length,
      vertices: sharedVertices.map(vertexValue),
      indicesSha256: canonicalDigest(
        `${GRAND_HALL_T554_INTERFACE_ATLAS_DOMAIN}.${definition.interfaceId}.shared-indices`,
        sharedIndices,
      ),
      positionsSha256: canonicalDigest(
        `${GRAND_HALL_T554_INTERFACE_ATLAS_DOMAIN}.${definition.interfaceId}.shared-positions`,
        sharedVertices.map(vertexValue),
      ),
    },
    localSourceTopology: { room9: sideValue(room9), adjacent: sideValue(adjacent) },
    inducedSourceEdgeComponents: {
      edgeCount: edges.length,
      edges,
      edgesSha256: canonicalDigest(
        `${GRAND_HALL_T554_INTERFACE_ATLAS_DOMAIN}.${definition.interfaceId}.induced-edges`,
        edges,
      ),
      componentCount: components.length,
      components: components.map(componentValue),
      componentsSha256: canonicalDigest(
        `${GRAND_HALL_T554_INTERFACE_ATLAS_DOMAIN}.${definition.interfaceId}.components`,
        components.map(componentValue),
      ),
    },
    room9BoundaryEdges: {
      count: boundaryEdges.length,
      edges: boundaryEdges,
      edgesSha256: canonicalDigest(
        `${GRAND_HALL_T554_INTERFACE_ATLAS_DOMAIN}.${definition.interfaceId}.room9-boundary-edges`,
        boundaryEdges,
      ),
    },
    metricBounds: { sharedVertices: boundsValue(sharedBounds), localSourceTriangles: boundsValue(localBounds) },
  };
  return Object.assign({}, material, {
    evidenceSha256: canonicalDigest(
      `${GRAND_HALL_T554_INTERFACE_ATLAS_DOMAIN}.${definition.interfaceId}.evidence`,
      material,
    ),
  });
}

function exactInterfaceEvidence(model: ParsedMatterportObj): {
  readonly interfaces: readonly InterfaceEvidence[];
  readonly room9: RoomIndex;
  readonly allRoom9BoundaryEdges: readonly Edge[];
} {
  const rooms = roomIndex(model);
  const room9 = rooms.get(roomId(GRAND_HALL_ROOM_9));
  if (room9 === undefined) throw new Error("MatterPak room 1:9 is absent");
  const discovered = [...rooms.values()]
    .filter((room) => !sameRoom(room.key, GRAND_HALL_ROOM_9))
    .filter((room) => [...room9.vertexIndices].some((index) => room.vertexIndices.has(index)))
    .map((room) => canonicalInterfaceId(room.key))
    .sort();
  const expected = GRAND_HALL_T554_INTERFACE_DEFINITIONS.map((item) => item.interfaceId).sort();
  if (stableCanonicalJson(discovered) !== stableCanonicalJson(expected)) {
    throw new Error("source OBJ shared-index interface inventory is not the exact canonical eight");
  }
  const allBoundaryEdges = room9BoundaryEdges(room9);
  const interfaces = GRAND_HALL_T554_INTERFACE_DEFINITIONS.map((definition) => {
    const adjacentRoom = rooms.get(roomId(definition.roomB));
    if (adjacentRoom === undefined) throw new Error(`${definition.interfaceId} adjacent group is absent`);
    const sharedIndices = [...room9.vertexIndices]
      .filter((index) => adjacentRoom.vertexIndices.has(index))
      .sort(compareNumbers);
    if (sharedIndices.length === 0) throw new Error(`${definition.interfaceId} has no exact shared vertices`);
    const shared = new Set(sharedIndices);
    const sharedVertices = vertexEvidence(model, sharedIndices);
    const room9Side = sideEvidence(model, room9, shared, definition.interfaceId, "room9");
    const adjacentSide = sideEvidence(model, adjacentRoom, shared, definition.interfaceId, "adjacent");
    const edges = inducedEdges(room9Side, adjacentSide, shared);
    const components = inducedComponents(model, definition.interfaceId, sharedIndices, edges);
    const boundary = allBoundaryEdges.filter(([a, b]) => shared.has(a) && shared.has(b));
    return {
      definition,
      sharedVertices,
      room9: room9Side,
      adjacent: adjacentSide,
      inducedEdges: edges,
      components,
      room9BoundaryEdges: boundary,
      sharedBounds: boundsForVertices(sharedVertices),
      localBounds: unionBounds(room9Side.boundsMeters, adjacentSide.boundsMeters),
      manifestValue: interfaceManifestValue(
        definition,
        sharedVertices,
        room9Side,
        adjacentSide,
        edges,
        components,
        boundary,
      ),
    } satisfies InterfaceEvidence;
  });
  return { interfaces, room9, allRoom9BoundaryEdges: allBoundaryEdges };
}

function formatMetric(value: number): string {
  if (!Number.isFinite(value)) throw new Error("SVG rejects a non-finite metric");
  const fixed = value.toFixed(6).replace(/0+$/u, "").replace(/\.$/u, "");
  return fixed === "-0" ? "0" : fixed;
}

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function projectionBounds(bounds: AxisAlignedBounds3, projection: ProjectionDefinition): readonly [number, number, number, number] {
  let minH = bounds.min[projection.horizontalAxis];
  let maxH = bounds.max[projection.horizontalAxis];
  let minV = bounds.min[projection.verticalAxis];
  let maxV = bounds.max[projection.verticalAxis];
  const maximumSpan = Math.max(maxH - minH, maxV - minV, 0.25);
  if (maxH - minH < maximumSpan * 0.05) {
    const centre = (minH + maxH) / 2;
    minH = centre - maximumSpan * 0.025;
    maxH = centre + maximumSpan * 0.025;
  }
  if (maxV - minV < maximumSpan * 0.05) {
    const centre = (minV + maxV) / 2;
    minV = centre - maximumSpan * 0.025;
    maxV = centre + maximumSpan * 0.025;
  }
  const marginH = Math.max((maxH - minH) * 0.08, 0.02);
  const marginV = Math.max((maxV - minV) * 0.08, 0.02);
  return [minH - marginH, maxH + marginH, minV - marginV, maxV + marginV];
}

function projectedPoint(
  point: Vec3,
  projection: ProjectionDefinition,
  bounds: readonly [number, number, number, number],
  panel: readonly [number, number, number, number],
): readonly [number, number] {
  const [minH, maxH, minV, maxV] = bounds;
  const [x, y, width, height] = panel;
  const horizontalSpan = maxH - minH;
  const verticalSpan = maxV - minV;
  const pixelsPerMeter = Math.min(width / horizontalSpan, height / verticalSpan);
  const renderedWidth = horizontalSpan * pixelsPerMeter;
  const renderedHeight = verticalSpan * pixelsPerMeter;
  const renderedX = x + (width - renderedWidth) / 2;
  const renderedY = y + (height - renderedHeight) / 2;
  return [
    renderedX + (point[projection.horizontalAxis] - minH) * pixelsPerMeter,
    renderedY + renderedHeight - (point[projection.verticalAxis] - minV) * pixelsPerMeter,
  ];
}

function trianglePath(
  triangle: TriangleEvidence,
  vertices: ReadonlyMap<number, Vec3>,
  projection: ProjectionDefinition,
  bounds: readonly [number, number, number, number],
  panel: readonly [number, number, number, number],
): string {
  const points = triangle.vertexIndices.map((index) => {
    const value = vertices.get(index);
    if (value === undefined) throw new Error("SVG triangle references an absent local vertex");
    return projectedPoint(value, projection, bounds, panel);
  });
  return `M ${formatMetric(points[0]?.[0] ?? 0)} ${formatMetric(points[0]?.[1] ?? 0)} L ${formatMetric(points[1]?.[0] ?? 0)} ${formatMetric(points[1]?.[1] ?? 0)} L ${formatMetric(points[2]?.[0] ?? 0)} ${formatMetric(points[2]?.[1] ?? 0)} Z`;
}

function edgeLine(
  value: Edge,
  vertices: ReadonlyMap<number, Vec3>,
  projection: ProjectionDefinition,
  bounds: readonly [number, number, number, number],
  panel: readonly [number, number, number, number],
): readonly [number, number, number, number] {
  const a = vertices.get(value[0]);
  const b = vertices.get(value[1]);
  if (a === undefined || b === undefined) throw new Error("SVG edge references an absent local vertex");
  const pa = projectedPoint(a, projection, bounds, panel);
  const pb = projectedPoint(b, projection, bounds, panel);
  return [pa[0], pa[1], pb[0], pb[1]];
}

function renderProjection(
  evidence: InterfaceEvidence,
  projection: ProjectionDefinition,
  panel: readonly [number, number, number, number],
): string {
  const vertices = new Map<number, Vec3>(
    [...evidence.room9.vertices, ...evidence.adjacent.vertices].map((item) => [item.index, item.position]),
  );
  const bounds = projectionBounds(evidence.localBounds, projection);
  const chunks: string[] = [];
  const [x, y, width, height] = panel;
  chunks.push(`<rect x="${formatMetric(x)}" y="${formatMetric(y)}" width="${formatMetric(width)}" height="${formatMetric(height)}" fill="#07111f" stroke="#334155" stroke-width="1"/>`);
  chunks.push(`<text x="${formatMetric(x + 16)}" y="${formatMetric(y + 28)}" fill="#f8fafc" font-family="sans-serif" font-size="20" font-weight="700">${projection.name} exact source projection</text>`);
  for (const [side, triangles, color] of [
    ["room9", evidence.room9.triangles, "#38bdf8"],
    ["adjacent", evidence.adjacent.triangles, "#a78bfa"],
  ] as const) {
    for (const triangle of triangles) {
      chunks.push(`<path d="${trianglePath(triangle, vertices, projection, bounds, panel)}" fill="none" stroke="${color}" stroke-opacity="0.58" stroke-width="0.85" data-source-side="${side}" data-source-face-ordinal="${String(triangle.sourceFaceOrdinal)}" data-source-group="${xml(triangle.groupName)}"><title>${side} source face ${String(triangle.sourceFaceOrdinal)} · ${xml(triangle.groupName)}</title></path>`);
    }
  }
  for (const value of evidence.inducedEdges) {
    const [x1, y1, x2, y2] = edgeLine(value, vertices, projection, bounds, panel);
    chunks.push(`<line x1="${formatMetric(x1)}" y1="${formatMetric(y1)}" x2="${formatMetric(x2)}" y2="${formatMetric(y2)}" stroke="#facc15" stroke-width="3" data-source-edge="${String(value[0])}:${String(value[1])}"><title>induced exact source edge ${String(value[0])}:${String(value[1])}</title></line>`);
  }
  for (const value of evidence.room9BoundaryEdges) {
    const [x1, y1, x2, y2] = edgeLine(value, vertices, projection, bounds, panel);
    chunks.push(`<line x1="${formatMetric(x1)}" y1="${formatMetric(y1)}" x2="${formatMetric(x2)}" y2="${formatMetric(y2)}" stroke="#fb7185" stroke-width="4" stroke-dasharray="8 5" data-room9-boundary-edge="${String(value[0])}:${String(value[1])}"><title>room 9 exact boundary edge ${String(value[0])}:${String(value[1])}</title></line>`);
  }
  for (const item of evidence.sharedVertices) {
    const [cx, cy] = projectedPoint(item.position, projection, bounds, panel);
    chunks.push(`<circle cx="${formatMetric(cx)}" cy="${formatMetric(cy)}" r="4" fill="#f8fafc" stroke="#0f172a" stroke-width="1" data-source-vertex-index="${String(item.index)}"><title>shared source vertex ${String(item.index)} · [${item.position.map(formatMetric).join(", ")}] m</title></circle>`);
  }
  for (const component of evidence.components) {
    const centre: Vec3 = [
      (component.boundsMeters.min[0] + component.boundsMeters.max[0]) / 2,
      (component.boundsMeters.min[1] + component.boundsMeters.max[1]) / 2,
      (component.boundsMeters.min[2] + component.boundsMeters.max[2]) / 2,
    ];
    const [cx, cy] = projectedPoint(centre, projection, bounds, panel);
    chunks.push(`<text x="${formatMetric(cx + 5)}" y="${formatMetric(cy - 5)}" fill="#fde68a" font-family="monospace" font-size="12">C${String(component.componentIndex)}</text>`);
  }
  chunks.push(`<text x="${formatMetric(x + 16)}" y="${formatMetric(y + height - 28)}" fill="#94a3b8" font-family="monospace" font-size="12">${projection.horizontalLabel}: ${formatMetric(bounds[0])}..${formatMetric(bounds[1])} m · ${projection.verticalLabel}: ${formatMetric(bounds[2])}..${formatMetric(bounds[3])} m</text>`);
  return chunks.join("");
}

function digestFromManifest(value: JsonValue, key: string): string {
  if (value === null || Array.isArray(value) || typeof value !== "object") throw new Error("manifest digest source is not an object");
  const digest = (value as { readonly [name: string]: JsonValue })[key];
  if (typeof digest !== "string") throw new Error(`manifest digest ${key} is absent`);
  return digest;
}

function renderInterfaceSvg(evidence: InterfaceEvidence, sourceSha256: Sha256): string {
  const width = 1800;
  const height = 1120;
  const panels: readonly (readonly [number, number, number, number])[] = [
    [30, 120, 560, 650],
    [620, 120, 560, 650],
    [1210, 120, 560, 650],
  ];
  const chunks = [
    `<svg xmlns="http://www.w3.org/2000/svg" role="img" viewBox="0 0 ${String(width)} ${String(height)}">`,
    `<title>${xml(evidence.definition.interfaceId)} authority-none exact source topology atlas</title>`,
    `<rect width="${String(width)}" height="${String(height)}" fill="#020617"/>`,
    `<text x="30" y="46" fill="#f8fafc" font-family="sans-serif" font-size="28" font-weight="700">Grand Hall T-554 · ${xml(evidence.definition.interfaceId)}</text>`,
    `<text x="30" y="78" fill="#fbbf24" font-family="sans-serif" font-size="16">AUTHORITY NONE · HUMAN REVIEW PENDING · SOURCE TRIANGLES ONLY</text>`,
    `<text x="30" y="101" fill="#94a3b8" font-family="sans-serif" font-size="14">No closure plane · no keep side · no camera join · no mask · no repaired contour · no inferred portal or doorway · disposition null</text>`,
  ];
  for (let index = 0; index < PROJECTIONS.length; index += 1) {
    const projection = PROJECTIONS[index];
    const panel = panels[index];
    if (projection === undefined || panel === undefined) throw new Error("projection panel inventory drifted");
    chunks.push(renderProjection(evidence, projection, panel));
  }
  const interfaceEvidenceDigest = digestFromManifest(evidence.manifestValue, "evidenceSha256");
  chunks.push(`<rect x="30" y="800" width="1740" height="285" rx="10" fill="#0f172a" stroke="#334155"/>`);
  chunks.push(`<text x="55" y="838" fill="#38bdf8" font-family="monospace" font-size="15">Room 9 local source faces: ${String(evidence.room9.triangles.length)} · ordinals ${String(evidence.room9.sourceFaceOrdinals[0] ?? -1)}..${String(evidence.room9.sourceFaceOrdinals.at(-1) ?? -1)}</text>`);
  chunks.push(`<text x="55" y="865" fill="#38bdf8" font-family="monospace" font-size="13">face ordinal digest: ${evidence.room9.sourceFaceOrdinalsSha256}</text>`);
  chunks.push(`<text x="55" y="892" fill="#38bdf8" font-family="monospace" font-size="13">exact triangle digest: ${evidence.room9.trianglesSha256}</text>`);
  chunks.push(`<text x="55" y="930" fill="#a78bfa" font-family="monospace" font-size="15">Adjacent ${String(evidence.definition.roomB.groupIndex)}:${String(evidence.definition.roomB.subIndex)} local source faces: ${String(evidence.adjacent.triangles.length)} · ordinals ${String(evidence.adjacent.sourceFaceOrdinals[0] ?? -1)}..${String(evidence.adjacent.sourceFaceOrdinals.at(-1) ?? -1)}</text>`);
  chunks.push(`<text x="55" y="957" fill="#a78bfa" font-family="monospace" font-size="13">face ordinal digest: ${evidence.adjacent.sourceFaceOrdinalsSha256}</text>`);
  chunks.push(`<text x="55" y="984" fill="#a78bfa" font-family="monospace" font-size="13">exact triangle digest: ${evidence.adjacent.trianglesSha256}</text>`);
  chunks.push(`<text x="55" y="1022" fill="#fde68a" font-family="monospace" font-size="13">shared vertices ${String(evidence.sharedVertices.length)} · induced edges ${String(evidence.inducedEdges.length)} · components ${String(evidence.components.length)} · room-9 boundary edges ${String(evidence.room9BoundaryEdges.length)}</text>`);
  chunks.push(`<text x="55" y="1049" fill="#cbd5e1" font-family="monospace" font-size="12">OBJ ${sourceSha256} · interface evidence ${interfaceEvidenceDigest}</text>`);
  chunks.push(`<text x="55" y="1073" fill="#94a3b8" font-family="monospace" font-size="11">exact shared bounds [${evidence.sharedBounds.min.map(formatMetric).join(", ")}]..[${evidence.sharedBounds.max.map(formatMetric).join(", ")}] m · exact local-triangle bounds [${evidence.localBounds.min.map(formatMetric).join(", ")}]..[${evidence.localBounds.max.map(formatMetric).join(", ")}] m</text>`);
  chunks.push("</svg>\n");
  const svg = chunks.join("");
  verifyT554SvgSafety(svg);
  return svg;
}

function outputFileName(interfaceId: string): string {
  if (!/^matterpak-1-9-(?:0-[234]|1-1[0-4])$/u.test(interfaceId)) {
    throw new Error("interface ID is outside the canonical output namespace");
  }
  return `interface-${interfaceId}.svg`;
}

function sourceValue(source: T554InterfaceAtlasBuildInputs["sourceObj"]): JsonValue {
  return {
    sourceLocator: source.sourceLocator,
    byteLength: source.byteLength,
    sha256: source.sha256,
  };
}

export function buildT554InterfaceAtlas(inputs: T554InterfaceAtlasBuildInputs): T554InterfaceAtlasPack {
  const sourceBytes = new TextEncoder().encode(inputs.objText);
  if (
    !/^MATTERPAK_SOURCE_ROOT\/[A-Za-z0-9._-]+\.obj$/u.test(inputs.sourceObj.sourceLocator) ||
    !/^sha256:[a-f0-9]{64}$/u.test(inputs.sourceObj.sha256) ||
    inputs.sourceObj.byteLength !== sourceBytes.byteLength ||
    inputs.sourceObj.sha256 !== sha256(sourceBytes)
  ) {
    throw new Error("interface atlas OBJ text differs from its exact source receipt");
  }
  const model = parseMatterportObjText(inputs.objText);
  const geometry = exactInterfaceEvidence(model);
  const files = new Map<string, string>();
  for (const evidence of geometry.interfaces) {
    files.set(outputFileName(evidence.definition.interfaceId), renderInterfaceSvg(evidence, inputs.sourceObj.sha256));
  }
  const expectedNames = GRAND_HALL_T554_INTERFACE_DEFINITIONS.map((item) => outputFileName(item.interfaceId));
  if (files.size !== expectedNames.length || expectedNames.some((name) => !files.has(name))) {
    throw new Error("interface atlas SVG inventory is not the exact canonical eight");
  }
  const room9FaceOrdinals = geometry.room9.triangles.map((triangle) => triangle.sourceFaceOrdinal);
  const material: JsonValue = {
    schemaVersion: GRAND_HALL_T554_INTERFACE_ATLAS_SCHEMA,
    subject: {
      venueSlug: "trades-hall",
      roomSlug: "grand-hall",
      matterpakRoom: roomValue(GRAND_HALL_ROOM_9),
    },
    lineage: {
      t551SourceReceiptSha256: T551_SOURCE_RECEIPT_SHA256,
      t551BoundaryEvidenceSha256: T551_BOUNDARY_EVIDENCE_SHA256,
      t554BoundaryReviewManifestSha256: T554_BOUNDARY_REVIEW_MANIFEST_SHA256,
      coordinateFrame: "MatterPak local; metres; right-handed; Z-up",
    },
    sourceBinding: { obj: sourceValue(inputs.sourceObj), exactByteRehashRequiredForCheck: true },
    method: {
      interfaceDiscovery: "exact shared OBJ vertex indices between MatterPak room 1:9 and every other exact room key",
      localTriangleSelection: "exact source triangle included iff at least one vertex index belongs to the interface shared-index set",
      inducedSourceEdges: "deduplicated exact source triangle edges whose two endpoints both belong to the shared-index set",
      sourceEdgeComponents: "connected components over all shared vertices and the induced exact source edges; isolated shared vertices retained",
      room9BoundaryEdges: "exact room-9 source edges with global triangle incidence one, then restricted to two shared endpoints",
      projections: ["XY", "XZ", "YZ"],
      sourceFaceOrdinalConvention: "zero-based order among source OBJ f records",
      generatedGeometryUsed: false,
    },
    room9SourceTopology: {
      faceCount: geometry.room9.triangles.length,
      sourceFaceOrdinalsSha256: canonicalDigest(
        `${GRAND_HALL_T554_INTERFACE_ATLAS_DOMAIN}.room9.face-ordinals`,
        room9FaceOrdinals,
      ),
      boundaryEdgeCount: geometry.allRoom9BoundaryEdges.length,
      boundaryEdgesSha256: canonicalDigest(
        `${GRAND_HALL_T554_INTERFACE_ATLAS_DOMAIN}.room9.boundary-edges`,
        geometry.allRoom9BoundaryEdges,
      ),
      watertightClaim: false,
    },
    interfaces: geometry.interfaces.map((item) => item.manifestValue),
    outputs: expectedNames.map((relativePath, index) => {
      const content = files.get(relativePath);
      const definition = GRAND_HALL_T554_INTERFACE_DEFINITIONS[index];
      if (content === undefined || definition === undefined) throw new Error("atlas output record source is absent");
      const bytes = new TextEncoder().encode(content);
      return {
        interfaceId: definition.interfaceId,
        relativePath,
        byteLength: bytes.byteLength,
        sha256: sha256(bytes),
      };
    }),
    authority: ATLAS_AUTHORITY,
  };
  const manifestSha256 = computeT554InterfaceAtlasManifestSha256(material);
  return {
    manifest: Object.assign({}, material, { manifestSha256 }),
    manifestSha256,
    files,
  };
}

function requireRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${label} must be an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function requireArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function requireInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a nonnegative safe integer`);
  }
  return value;
}

function requireSha256(value: unknown, label: string): Sha256 {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} must be a SHA-256 receipt`);
  }
  return value as Sha256;
}

function requireExactKeys(record: Readonly<Record<string, unknown>>, keys: readonly string[], label: string): void {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (stableCanonicalJson(actual) !== stableCanonicalJson(expected)) {
    throw new Error(`${label} fields drifted`);
  }
}

function requireRoom(value: unknown, expected: MatterportRoomKey, label: string): void {
  const room = requireRecord(value, label);
  requireExactKeys(room, ["groupIndex", "subIndex"], label);
  if (room.groupIndex !== expected.groupIndex || room.subIndex !== expected.subIndex) {
    throw new Error(`${label} differs from its exact source group`);
  }
}

function requireVec3(value: unknown, label: string): Vec3 {
  const coordinates = requireArray(value, label);
  if (
    coordinates.length !== 3 ||
    coordinates.some((coordinate) => typeof coordinate !== "number" || !Number.isFinite(coordinate))
  ) {
    throw new Error(`${label} must contain three finite coordinates`);
  }
  return [coordinates[0] as number, coordinates[1] as number, coordinates[2] as number];
}

function validateBounds(value: unknown, expected: AxisAlignedBounds3, label: string): void {
  const bounds = requireRecord(value, label);
  requireExactKeys(bounds, ["min", "max"], label);
  const parsed: AxisAlignedBounds3 = {
    min: requireVec3(bounds.min, `${label} minimum`),
    max: requireVec3(bounds.max, `${label} maximum`),
  };
  if (stableCanonicalJson(boundsValue(parsed)) !== stableCanonicalJson(boundsValue(expected))) {
    throw new Error(`${label} differs from exact metric bounds`);
  }
}

function decodeStrictJson(bytes: Uint8Array): Readonly<Record<string, unknown>> {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("interface atlas manifest is not strict UTF-8");
  }
  if (text.charCodeAt(0) === 0xfeff) throw new Error("interface atlas manifest cannot contain a BOM");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("interface atlas manifest is not JSON");
  }
  return requireRecord(parsed, "interface atlas manifest");
}

function assertNoOperatorPath(value: string): void {
  if (
    /[A-Za-z]:[\\/]/u.test(value) ||
    /\\{4,}/u.test(value) ||
    /(?:^|["':])\/(?:home|Users|root|tmp|var|mnt|Volumes)\//u.test(value) ||
    /file:\/\//iu.test(value) ||
    /(?:^|[\\/])Users[\\/]/iu.test(value) ||
    /(?:^|[\\/])\.\.(?:[\\/]|$)/u.test(value)
  ) {
    throw new Error("interface atlas contains an operator path or path escape");
  }
}

function manifestMaterial(manifest: Readonly<Record<string, unknown>>): JsonValue {
  const copy: Record<string, unknown> = { ...manifest };
  delete copy.manifestSha256;
  return copy as JsonValue;
}

function assertCanonicalManifestEnvelope(manifest: Readonly<Record<string, unknown>>): Sha256 {
  requireExactKeys(manifest, [
    "schemaVersion", "subject", "lineage", "sourceBinding", "method", "room9SourceTopology",
    "interfaces", "outputs", "authority", "manifestSha256",
  ], "interface atlas manifest");
  if (manifest.schemaVersion !== GRAND_HALL_T554_INTERFACE_ATLAS_SCHEMA) {
    throw new Error("unsupported interface atlas schema");
  }
  assertNoOperatorPath(JSON.stringify(manifest));
  const claimed = requireSha256(manifest.manifestSha256, "interface atlas manifest digest");
  if (computeT554InterfaceAtlasManifestSha256(manifestMaterial(manifest)) !== claimed) {
    throw new Error("interface atlas manifest canonical digest differs");
  }
  const authority = requireRecord(manifest.authority, "interface atlas authority");
  if (stableCanonicalJson(authority as JsonValue) !== stableCanonicalJson(ATLAS_AUTHORITY)) {
    throw new Error("interface atlas escaped its authority-none boundary");
  }
  return claimed;
}

function validateManifestClaims(manifest: Readonly<Record<string, unknown>>): void {
  const expectedSubject: JsonValue = {
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    matterpakRoom: roomValue(GRAND_HALL_ROOM_9),
  };
  if (stableCanonicalJson(requireRecord(manifest.subject, "interface atlas subject") as JsonValue) !== stableCanonicalJson(expectedSubject)) {
    throw new Error("interface atlas subject drifted");
  }
  const expectedLineage: JsonValue = {
    t551SourceReceiptSha256: T551_SOURCE_RECEIPT_SHA256,
    t551BoundaryEvidenceSha256: T551_BOUNDARY_EVIDENCE_SHA256,
    t554BoundaryReviewManifestSha256: T554_BOUNDARY_REVIEW_MANIFEST_SHA256,
    coordinateFrame: "MatterPak local; metres; right-handed; Z-up",
  };
  if (stableCanonicalJson(requireRecord(manifest.lineage, "interface atlas lineage") as JsonValue) !== stableCanonicalJson(expectedLineage)) {
    throw new Error("interface atlas lineage drifted");
  }
  const expectedMethod: JsonValue = {
    interfaceDiscovery: "exact shared OBJ vertex indices between MatterPak room 1:9 and every other exact room key",
    localTriangleSelection: "exact source triangle included iff at least one vertex index belongs to the interface shared-index set",
    inducedSourceEdges: "deduplicated exact source triangle edges whose two endpoints both belong to the shared-index set",
    sourceEdgeComponents: "connected components over all shared vertices and the induced exact source edges; isolated shared vertices retained",
    room9BoundaryEdges: "exact room-9 source edges with global triangle incidence one, then restricted to two shared endpoints",
    projections: ["XY", "XZ", "YZ"],
    sourceFaceOrdinalConvention: "zero-based order among source OBJ f records",
    generatedGeometryUsed: false,
  };
  if (stableCanonicalJson(requireRecord(manifest.method, "interface atlas method") as JsonValue) !== stableCanonicalJson(expectedMethod)) {
    throw new Error("interface atlas source-topology method drifted");
  }
  const binding = requireRecord(manifest.sourceBinding, "interface atlas source binding");
  requireExactKeys(binding, ["obj", "exactByteRehashRequiredForCheck"], "interface atlas source binding");
  if (binding.exactByteRehashRequiredForCheck !== true) throw new Error("interface atlas disabled exact OBJ rehash");
  const obj = requireRecord(binding.obj, "interface atlas OBJ binding");
  requireExactKeys(obj, ["sourceLocator", "byteLength", "sha256"], "interface atlas OBJ binding");
  if (
    typeof obj.sourceLocator !== "string" ||
    !/^MATTERPAK_SOURCE_ROOT\/[A-Za-z0-9._-]+\.obj$/u.test(obj.sourceLocator)
  ) {
    throw new Error("interface atlas OBJ locator is outside the canonical source namespace");
  }
  const objLength = requireInteger(obj.byteLength, "interface atlas OBJ byte length");
  if (objLength === 0) throw new Error("interface atlas OBJ cannot be empty");
  requireSha256(obj.sha256, "interface atlas OBJ digest");
  const exactGrandHallObj: JsonValue = {
    sourceLocator: GRAND_HALL_T554_INTERFACE_ATLAS_OBJ_RECEIPT.sourceLocator,
    byteLength: GRAND_HALL_T554_INTERFACE_ATLAS_OBJ_RECEIPT.byteLength,
    sha256: GRAND_HALL_T554_INTERFACE_ATLAS_OBJ_RECEIPT.sha256,
  };
  if (
    stableCanonicalJson(obj as JsonValue) === stableCanonicalJson(exactGrandHallObj) &&
    manifest.manifestSha256 !== GRAND_HALL_T554_EXACT_INTERFACE_ATLAS_MANIFEST_SHA256
  ) {
    throw new Error("interface atlas exact Grand Hall source manifest differs from its checked golden receipt");
  }
  const topology = requireRecord(manifest.room9SourceTopology, "interface atlas room9 topology");
  requireExactKeys(topology, [
    "faceCount", "sourceFaceOrdinalsSha256", "boundaryEdgeCount", "boundaryEdgesSha256", "watertightClaim",
  ], "interface atlas room9 topology");
  if (
    requireInteger(topology.faceCount, "interface atlas room9 face count") === 0 ||
    requireInteger(topology.boundaryEdgeCount, "interface atlas room9 boundary edge count") === 0 ||
    topology.watertightClaim !== false
  ) {
    throw new Error("interface atlas room9 topology claim drifted");
  }
  requireSha256(topology.sourceFaceOrdinalsSha256, "interface atlas room9 face ordinal digest");
  requireSha256(topology.boundaryEdgesSha256, "interface atlas room9 boundary edge digest");
}

function validateVertexArray(value: unknown, label: string): readonly VertexEvidence[] {
  const vertices = requireArray(value, label).map((item, index) => {
    const record = requireRecord(item, `${label} ${String(index)}`);
    requireExactKeys(record, ["index", "position"], `${label} ${String(index)}`);
    const vertexIndex = requireInteger(record.index, `${label} ${String(index)} index`);
    const position = requireArray(record.position, `${label} ${String(index)} position`);
    if (position.length !== 3 || position.some((coordinate) => typeof coordinate !== "number" || !Number.isFinite(coordinate))) {
      throw new Error(`${label} ${String(index)} position must contain three finite coordinates`);
    }
    return {
      index: vertexIndex,
      position: [position[0] as number, position[1] as number, position[2] as number],
    } satisfies VertexEvidence;
  });
  const indices = vertices.map((item) => item.index);
  if (indices.some((item, index) => index > 0 && item <= (indices[index - 1] ?? -1))) {
    throw new Error(`${label} source vertex indices must be strictly increasing`);
  }
  return vertices;
}

function validateEdgeArray(value: unknown, label: string): readonly Edge[] {
  const edges = requireArray(value, label).map((item, index) => {
    const pair = requireArray(item, `${label} ${String(index)}`);
    if (pair.length !== 2) throw new Error(`${label} ${String(index)} must have two endpoints`);
    const a = requireInteger(pair[0], `${label} ${String(index)} endpoint a`);
    const b = requireInteger(pair[1], `${label} ${String(index)} endpoint b`);
    if (a >= b) throw new Error(`${label} ${String(index)} is not a canonical undirected edge`);
    return [a, b] as const;
  });
  if (edges.some((item, index) => index > 0 && compareEdges(item, edges[index - 1] ?? item) <= 0)) {
    throw new Error(`${label} must be strictly ordered and unique`);
  }
  return edges;
}

function validateSide(
  value: unknown,
  expectedRoom: MatterportRoomKey,
  sharedIndices: ReadonlySet<number>,
  interfaceId: string,
  sideName: "room9" | "adjacent",
): { readonly vertices: readonly VertexEvidence[]; readonly triangles: readonly TriangleEvidence[] } {
  const side = requireRecord(value, `${interfaceId} ${sideName}`);
  requireExactKeys(side, [
    "room", "groupNames", "vertexCount", "vertices", "verticesSha256", "faceCount",
    "sourceFaceOrdinals", "sourceFaceOrdinalsSha256", "triangles", "trianglesSha256", "boundsMeters",
  ], `${interfaceId} ${sideName}`);
  requireRoom(side.room, expectedRoom, `${interfaceId} ${sideName} room`);
  const vertices = validateVertexArray(side.vertices, `${interfaceId} ${sideName} vertices`);
  if (side.vertexCount !== vertices.length) throw new Error(`${interfaceId} ${sideName} vertex count differs`);
  if (requireSha256(side.verticesSha256, `${interfaceId} ${sideName} vertex digest`) !== canonicalDigest(
    `${GRAND_HALL_T554_INTERFACE_ATLAS_DOMAIN}.${interfaceId}.${sideName}.vertices`, vertices.map(vertexValue),
  )) throw new Error(`${interfaceId} ${sideName} vertex digest differs`);
  const vertexSet = new Set(vertices.map((item) => item.index));
  const triangles = requireArray(side.triangles, `${interfaceId} ${sideName} triangles`).map((item, index) => {
    const triangle = requireRecord(item, `${interfaceId} ${sideName} triangle ${String(index)}`);
    requireExactKeys(triangle, ["sourceFaceOrdinal", "vertexIndices", "groupName", "material"], `${interfaceId} ${sideName} triangle ${String(index)}`);
    const sourceFaceOrdinal = requireInteger(triangle.sourceFaceOrdinal, `${interfaceId} ${sideName} face ordinal`);
    const indices = requireArray(triangle.vertexIndices, `${interfaceId} ${sideName} triangle indices`);
    if (indices.length !== 3 || indices.some((entry) => !Number.isSafeInteger(entry) || (entry as number) < 0)) {
      throw new Error(`${interfaceId} ${sideName} triangle indices are malformed`);
    }
    const typed = indices as readonly number[];
    if (new Set(typed).size !== 3 || typed.some((entry) => !vertexSet.has(entry))) {
      throw new Error(`${interfaceId} ${sideName} triangle topology is inconsistent`);
    }
    if (!typed.some((entry) => sharedIndices.has(entry))) {
      throw new Error(`${interfaceId} ${sideName} triangle is outside the exact local selection`);
    }
    if (typeof triangle.groupName !== "string" || typeof triangle.material !== "string" && triangle.material !== null) {
      throw new Error(`${interfaceId} ${sideName} source group or material is malformed`);
    }
    if (triangle.material !== null && !/^[A-Za-z0-9._-]+$/u.test(triangle.material)) {
      throw new Error(`${interfaceId} ${sideName} source material name is unsafe`);
    }
    const groupPattern = new RegExp(`^(?:chunk|mirror)\\d+_group${String(expectedRoom.groupIndex).padStart(3, "0")}_sub${String(expectedRoom.subIndex).padStart(3, "0")}$`, "u");
    if (!groupPattern.test(triangle.groupName)) throw new Error(`${interfaceId} ${sideName} triangle group differs`);
    return {
      sourceFaceOrdinal,
      vertexIndices: [typed[0] ?? 0, typed[1] ?? 0, typed[2] ?? 0],
      groupName: triangle.groupName,
      material: triangle.material,
    } satisfies TriangleEvidence;
  });
  if (side.faceCount !== triangles.length || triangles.length === 0) throw new Error(`${interfaceId} ${sideName} face count differs`);
  const ordinals = requireArray(side.sourceFaceOrdinals, `${interfaceId} ${sideName} face ordinals`).map((item) => requireInteger(item, `${interfaceId} ${sideName} face ordinal`));
  const triangleOrdinals = triangles.map((triangle) => triangle.sourceFaceOrdinal);
  if (stableCanonicalJson(ordinals) !== stableCanonicalJson(triangleOrdinals) || ordinals.some((item, index) => index > 0 && item <= (ordinals[index - 1] ?? -1))) {
    throw new Error(`${interfaceId} ${sideName} source face ordinals differ or are unordered`);
  }
  if (requireSha256(side.sourceFaceOrdinalsSha256, `${interfaceId} ${sideName} face ordinal digest`) !== canonicalDigest(
    `${GRAND_HALL_T554_INTERFACE_ATLAS_DOMAIN}.${interfaceId}.${sideName}.face-ordinals`, ordinals,
  )) throw new Error(`${interfaceId} ${sideName} source face ordinal digest differs`);
  if (requireSha256(side.trianglesSha256, `${interfaceId} ${sideName} triangle digest`) !== canonicalDigest(
    `${GRAND_HALL_T554_INTERFACE_ATLAS_DOMAIN}.${interfaceId}.${sideName}.triangles`, triangles.map(triangleValue),
  )) throw new Error(`${interfaceId} ${sideName} triangle digest differs`);
  const groupNames = requireArray(side.groupNames, `${interfaceId} ${sideName} group names`);
  if (groupNames.some((name) => typeof name !== "string")) throw new Error(`${interfaceId} ${sideName} group names are malformed`);
  const expectedGroups = [...new Set(triangles.map((triangle) => triangle.groupName))].sort();
  if (stableCanonicalJson(groupNames as JsonValue) !== stableCanonicalJson(expectedGroups)) {
    throw new Error(`${interfaceId} ${sideName} group inventory differs`);
  }
  validateBounds(side.boundsMeters, boundsForVertices(vertices), `${interfaceId} ${sideName} bounds`);
  return { vertices, triangles };
}

function resealedInterfaceMaterial(record: Readonly<Record<string, unknown>>): JsonValue {
  const copy: Record<string, unknown> = { ...record };
  delete copy.evidenceSha256;
  return copy as JsonValue;
}

function validateInterface(value: unknown, definition: T554InterfaceDefinition): void {
  const record = requireRecord(value, definition.interfaceId);
  requireExactKeys(record, [
    "interfaceId", "roomA", "roomB", "reviewState", "disposition", "sharedVertices",
    "localSourceTopology", "inducedSourceEdgeComponents", "room9BoundaryEdges", "metricBounds", "evidenceSha256",
  ], definition.interfaceId);
  if (record.interfaceId !== definition.interfaceId) throw new Error("interface atlas ID or order differs");
  requireRoom(record.roomA, GRAND_HALL_ROOM_9, `${definition.interfaceId} room A`);
  requireRoom(record.roomB, definition.roomB, `${definition.interfaceId} room B`);
  if (record.reviewState !== "human_pending" || record.disposition !== null) {
    throw new Error(`${definition.interfaceId} review state or disposition escaped pending/null`);
  }
  const shared = requireRecord(record.sharedVertices, `${definition.interfaceId} shared vertices`);
  requireExactKeys(shared, ["count", "vertices", "indicesSha256", "positionsSha256"], `${definition.interfaceId} shared vertices`);
  const sharedVertices = validateVertexArray(shared.vertices, `${definition.interfaceId} shared vertices`);
  if (shared.count !== sharedVertices.length || sharedVertices.length === 0) throw new Error(`${definition.interfaceId} shared vertex count differs`);
  const sharedIndices = sharedVertices.map((item) => item.index);
  if (requireSha256(shared.indicesSha256, `${definition.interfaceId} shared index digest`) !== canonicalDigest(
    `${GRAND_HALL_T554_INTERFACE_ATLAS_DOMAIN}.${definition.interfaceId}.shared-indices`, sharedIndices,
  )) throw new Error(`${definition.interfaceId} shared index digest differs`);
  if (requireSha256(shared.positionsSha256, `${definition.interfaceId} shared position digest`) !== canonicalDigest(
    `${GRAND_HALL_T554_INTERFACE_ATLAS_DOMAIN}.${definition.interfaceId}.shared-positions`, sharedVertices.map(vertexValue),
  )) throw new Error(`${definition.interfaceId} shared position digest differs`);
  const sharedSet = new Set(sharedIndices);
  const topology = requireRecord(record.localSourceTopology, `${definition.interfaceId} source topology`);
  requireExactKeys(topology, ["room9", "adjacent"], `${definition.interfaceId} source topology`);
  const room9 = validateSide(topology.room9, GRAND_HALL_ROOM_9, sharedSet, definition.interfaceId, "room9");
  const adjacent = validateSide(topology.adjacent, definition.roomB, sharedSet, definition.interfaceId, "adjacent");
  for (const item of sharedVertices) {
    const index = item.index;
    const room9Vertex = room9.vertices.find((candidate) => candidate.index === index);
    const adjacentVertex = adjacent.vertices.find((candidate) => candidate.index === index);
    if (
      room9Vertex === undefined || adjacentVertex === undefined ||
      stableCanonicalJson(vertexValue(room9Vertex)) !== stableCanonicalJson(vertexValue(item)) ||
      stableCanonicalJson(vertexValue(adjacentVertex)) !== stableCanonicalJson(vertexValue(item))
    ) throw new Error(`${definition.interfaceId} shared position does not cross-bind both source groups`);
  }
  const induced = requireRecord(record.inducedSourceEdgeComponents, `${definition.interfaceId} induced edges`);
  requireExactKeys(induced, ["edgeCount", "edges", "edgesSha256", "componentCount", "components", "componentsSha256"], `${definition.interfaceId} induced edges`);
  const edges = validateEdgeArray(induced.edges, `${definition.interfaceId} induced edges`);
  if (induced.edgeCount !== edges.length || edges.some(([a, b]) => !sharedSet.has(a) || !sharedSet.has(b))) {
    throw new Error(`${definition.interfaceId} induced edge inventory differs`);
  }
  const expectedInducedEdges = inducedEdges(room9, adjacent, sharedSet);
  if (stableCanonicalJson(edges) !== stableCanonicalJson(expectedInducedEdges)) {
    throw new Error(`${definition.interfaceId} induced edges differ from exact local source triangles`);
  }
  if (requireSha256(induced.edgesSha256, `${definition.interfaceId} induced edge digest`) !== canonicalDigest(
    `${GRAND_HALL_T554_INTERFACE_ATLAS_DOMAIN}.${definition.interfaceId}.induced-edges`, edges,
  )) throw new Error(`${definition.interfaceId} induced edge digest differs`);
  const components = requireArray(induced.components, `${definition.interfaceId} components`);
  if (induced.componentCount !== components.length || components.length === 0) throw new Error(`${definition.interfaceId} component count differs`);
  const covered = new Set<number>();
  const componentByVertex = new Map<number, number>();
  for (const [componentIndex, value] of components.entries()) {
    const component = requireRecord(value, `${definition.interfaceId} component ${String(componentIndex)}`);
    requireExactKeys(component, ["componentIndex", "vertexIndices", "edges", "vertexIndicesSha256", "edgesSha256", "boundsMeters"], `${definition.interfaceId} component ${String(componentIndex)}`);
    if (component.componentIndex !== componentIndex) throw new Error(`${definition.interfaceId} component ordinal differs`);
    const indices = requireArray(component.vertexIndices, `${definition.interfaceId} component vertices`).map((item) => requireInteger(item, `${definition.interfaceId} component vertex`));
    if (indices.length === 0 || indices.some((item, index) => !sharedSet.has(item) || covered.has(item) || index > 0 && item <= (indices[index - 1] ?? -1))) {
      throw new Error(`${definition.interfaceId} component vertex partition differs`);
    }
    indices.forEach((item) => {
      covered.add(item);
      componentByVertex.set(item, componentIndex);
    });
    const componentEdges = validateEdgeArray(component.edges, `${definition.interfaceId} component edges`);
    const members = new Set(indices);
    const expectedEdges = edges.filter(([a, b]) => members.has(a) && members.has(b));
    if (stableCanonicalJson(componentEdges) !== stableCanonicalJson(expectedEdges)) throw new Error(`${definition.interfaceId} component edge membership differs`);
    if (requireSha256(component.vertexIndicesSha256, `${definition.interfaceId} component vertex digest`) !== canonicalDigest(
      `${GRAND_HALL_T554_INTERFACE_ATLAS_DOMAIN}.${definition.interfaceId}.component.${String(componentIndex)}.vertices`, indices,
    )) throw new Error(`${definition.interfaceId} component vertex digest differs`);
    if (requireSha256(component.edgesSha256, `${definition.interfaceId} component edge digest`) !== canonicalDigest(
      `${GRAND_HALL_T554_INTERFACE_ATLAS_DOMAIN}.${definition.interfaceId}.component.${String(componentIndex)}.edges`, componentEdges,
    )) throw new Error(`${definition.interfaceId} component edge digest differs`);
    const componentVertices = sharedVertices.filter((item) => members.has(item.index));
    validateBounds(
      component.boundsMeters,
      boundsForVertices(componentVertices),
      `${definition.interfaceId} component ${String(componentIndex)} bounds`,
    );
    if (indices.length > 1) {
      const reachable = new Set<number>([indices[0] ?? 0]);
      const stack = [indices[0] ?? 0];
      while (stack.length > 0) {
        const current = stack.pop();
        if (current === undefined) break;
        for (const [a, b] of componentEdges) {
          const neighbor = a === current ? b : b === current ? a : null;
          if (neighbor !== null && !reachable.has(neighbor)) {
            reachable.add(neighbor);
            stack.push(neighbor);
          }
        }
      }
      if (reachable.size !== indices.length) throw new Error(`${definition.interfaceId} component is disconnected`);
    } else if (componentEdges.length !== 0) {
      throw new Error(`${definition.interfaceId} isolated component contains an edge`);
    }
  }
  if (covered.size !== sharedSet.size) throw new Error(`${definition.interfaceId} components do not exhaust shared vertices`);
  if (edges.some(([a, b]) => componentByVertex.get(a) !== componentByVertex.get(b))) {
    throw new Error(`${definition.interfaceId} component partition cuts an induced source edge`);
  }
  if (requireSha256(induced.componentsSha256, `${definition.interfaceId} components digest`) !== canonicalDigest(
    `${GRAND_HALL_T554_INTERFACE_ATLAS_DOMAIN}.${definition.interfaceId}.components`, components as JsonValue,
  )) throw new Error(`${definition.interfaceId} components digest differs`);
  const boundary = requireRecord(record.room9BoundaryEdges, `${definition.interfaceId} room9 boundary edges`);
  requireExactKeys(boundary, ["count", "edges", "edgesSha256"], `${definition.interfaceId} room9 boundary edges`);
  const boundaryEdges = validateEdgeArray(boundary.edges, `${definition.interfaceId} room9 boundary edges`);
  if (boundary.count !== boundaryEdges.length || boundaryEdges.some(([a, b]) => !sharedSet.has(a) || !sharedSet.has(b))) {
    throw new Error(`${definition.interfaceId} room9 boundary edge inventory differs`);
  }
  if (requireSha256(boundary.edgesSha256, `${definition.interfaceId} room9 boundary edge digest`) !== canonicalDigest(
    `${GRAND_HALL_T554_INTERFACE_ATLAS_DOMAIN}.${definition.interfaceId}.room9-boundary-edges`, boundaryEdges,
  )) throw new Error(`${definition.interfaceId} room9 boundary edge digest differs`);
  const metricBounds = requireRecord(record.metricBounds, `${definition.interfaceId} metric bounds`);
  requireExactKeys(metricBounds, ["sharedVertices", "localSourceTriangles"], `${definition.interfaceId} metric bounds`);
  validateBounds(
    metricBounds.sharedVertices,
    boundsForVertices(sharedVertices),
    `${definition.interfaceId} shared metric bounds`,
  );
  validateBounds(
    metricBounds.localSourceTriangles,
    unionBounds(boundsForVertices(room9.vertices), boundsForVertices(adjacent.vertices)),
    `${definition.interfaceId} local metric bounds`,
  );
  if (requireSha256(record.evidenceSha256, `${definition.interfaceId} evidence digest`) !== canonicalDigest(
    `${GRAND_HALL_T554_INTERFACE_ATLAS_DOMAIN}.${definition.interfaceId}.evidence`, resealedInterfaceMaterial(record),
  )) throw new Error(`${definition.interfaceId} evidence digest differs`);
}

function parseAndValidateManifest(bytes: Uint8Array): {
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly digest: Sha256;
  readonly outputs: readonly Readonly<Record<string, unknown>>[];
} {
  const manifest = decodeStrictJson(bytes);
  const digest = assertCanonicalManifestEnvelope(manifest);
  validateManifestClaims(manifest);
  const interfaces = requireArray(manifest.interfaces, "interface atlas interfaces");
  if (interfaces.length !== GRAND_HALL_T554_INTERFACE_DEFINITIONS.length) {
    throw new Error("interface atlas omitted or added an interface");
  }
  interfaces.forEach((item, index) => {
    const definition = GRAND_HALL_T554_INTERFACE_DEFINITIONS[index];
    if (definition === undefined) throw new Error("interface atlas definition inventory drifted");
    validateInterface(item, definition);
  });
  const outputs = requireArray(manifest.outputs, "interface atlas outputs").map((value, index) => {
    const record = requireRecord(value, `interface atlas output ${String(index)}`);
    requireExactKeys(record, ["interfaceId", "relativePath", "byteLength", "sha256"], `interface atlas output ${String(index)}`);
    const definition = GRAND_HALL_T554_INTERFACE_DEFINITIONS[index];
    if (
      definition === undefined ||
      record.interfaceId !== definition.interfaceId ||
      record.relativePath !== outputFileName(definition.interfaceId)
    ) throw new Error("interface atlas output path, ID, or order differs");
    requireInteger(record.byteLength, `interface atlas output ${String(index)} byte length`);
    requireSha256(record.sha256, `interface atlas output ${String(index)} digest`);
    return record;
  });
  if (outputs.length !== GRAND_HALL_T554_INTERFACE_DEFINITIONS.length) {
    throw new Error("interface atlas output inventory is not the exact canonical eight");
  }
  return { manifest, digest, outputs };
}

function safeOutputMember(root: string, fileName: string): string {
  if (!/^[a-z0-9.-]+$/u.test(fileName) || fileName.includes("..")) throw new Error("interface atlas member path is unsafe");
  const path = resolve(root, fileName);
  if (dirname(path) !== root) throw new Error("interface atlas member escapes its directory");
  return path;
}

function expectedOutputNames(): readonly string[] {
  return [
    ...GRAND_HALL_T554_INTERFACE_DEFINITIONS.map((definition) => outputFileName(definition.interfaceId)),
    "manifest.json",
  ].sort();
}

function verifiedAtlasSummary(
  parsed: ReturnType<typeof parseAndValidateManifest>,
): T554VerifiedInterfaceAtlasSummary {
  const lineage = requireRecord(parsed.manifest.lineage, "interface atlas lineage");
  const sourceBinding = requireRecord(parsed.manifest.sourceBinding, "interface atlas source binding");
  const obj = requireRecord(sourceBinding.obj, "interface atlas OBJ binding");
  const interfaces = requireArray(parsed.manifest.interfaces, "interface atlas interfaces").map((value, index) => {
    const item = requireRecord(value, `interface atlas interface ${String(index)}`);
    const roomA = requireRecord(item.roomA, `interface atlas interface ${String(index)} room A`);
    const roomB = requireRecord(item.roomB, `interface atlas interface ${String(index)} room B`);
    const shared = requireRecord(item.sharedVertices, `interface atlas interface ${String(index)} shared vertices`);
    const sharedVertices = requireArray(
      shared.vertices,
      `interface atlas interface ${String(index)} shared vertex inventory`,
    ).map((value, vertexIndex) => {
      const vertex = requireRecord(
        value,
        `interface atlas interface ${String(index)} shared vertex ${String(vertexIndex)}`,
      );
      return Object.freeze({
        index: vertex.index as number,
        position: Object.freeze(requireVec3(
          vertex.position,
          `interface atlas interface ${String(index)} shared vertex ${String(vertexIndex)} position`,
        )),
      });
    });
    const metricBounds = requireRecord(item.metricBounds, `interface atlas interface ${String(index)} metric bounds`);
    const sharedBounds = requireRecord(
      metricBounds.sharedVertices,
      `interface atlas interface ${String(index)} shared bounds`,
    );
    const boundary = requireRecord(
      item.room9BoundaryEdges,
      `interface atlas interface ${String(index)} room9 boundary edges`,
    );
    const room9BoundaryEdges = requireArray(
      boundary.edges,
      `interface atlas interface ${String(index)} room9 boundary edge inventory`,
    ).map((value, edgeIndex) => {
      const edge = requireArray(
        value,
        `interface atlas interface ${String(index)} room9 boundary edge ${String(edgeIndex)}`,
      );
      return Object.freeze([edge[0] as number, edge[1] as number] as const);
    });
    return Object.freeze({
      interfaceId: item.interfaceId as string,
      roomA: Object.freeze({
        groupIndex: roomA.groupIndex as number,
        subIndex: roomA.subIndex as number,
      }),
      roomB: Object.freeze({
        groupIndex: roomB.groupIndex as number,
        subIndex: roomB.subIndex as number,
      }),
      sharedVertexCount: shared.count as number,
      sharedVertices: Object.freeze(sharedVertices),
      sharedVertexIndicesSha256: shared.indicesSha256 as Sha256,
      sharedPositionsSha256: shared.positionsSha256 as Sha256,
      sharedBoundsMeters: Object.freeze({
        min: Object.freeze(requireVec3(sharedBounds.min, "interface atlas shared bounds minimum")),
        max: Object.freeze(requireVec3(sharedBounds.max, "interface atlas shared bounds maximum")),
      }),
      room9BoundaryEdgeCount: boundary.count as number,
      room9BoundaryEdges: Object.freeze(room9BoundaryEdges),
      room9BoundaryEdgesSha256: boundary.edgesSha256 as Sha256,
    });
  });
  return Object.freeze({
    manifestSha256: parsed.digest,
    boundaryReviewManifestSha256: requireSha256(
      lineage.t554BoundaryReviewManifestSha256,
      "interface atlas boundary lineage digest",
    ),
    obj: Object.freeze({
      sourceLocator: obj.sourceLocator as string,
      byteLength: obj.byteLength as number,
      sha256: obj.sha256 as Sha256,
    }),
    interfaces: Object.freeze(interfaces),
  });
}

export function verifyPersistedT554InterfaceAtlasEvidence(
  outputDirectory: string,
  hooks: T554InterfaceAtlasReadHooks = {},
): T554VerifiedInterfaceAtlasSummary {
  const root = validateDirectory(outputDirectory, "interface atlas output directory");
  const names = readdirSync(root).sort();
  if (stableCanonicalJson(names) !== stableCanonicalJson(expectedOutputNames())) {
    throw new Error("interface atlas output inventory drifted");
  }
  const manifestFile = readStableT554InterfaceAtlasFile(
    safeOutputMember(root, "manifest.json"),
    { maximumByteLength: MAX_MANIFEST_BYTES },
    { purpose: "manifest", fileName: "manifest.json" },
    hooks,
  );
  const parsed = parseAndValidateManifest(manifestFile.bytes);
  for (const output of parsed.outputs) {
    const fileName = output.relativePath as string;
    const expectedLength = output.byteLength as number;
    const expectedSha = output.sha256 as Sha256;
    const file = readStableT554InterfaceAtlasFile(
      safeOutputMember(root, fileName),
      { byteLength: expectedLength, sha256: expectedSha, maximumByteLength: MAX_SVG_BYTES },
      { purpose: "svg", fileName },
      hooks,
    );
    const svg = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes);
    verifyT554SvgSafety(svg);
  }
  return verifiedAtlasSummary(parsed);
}

export function verifyPersistedT554InterfaceAtlas(
  outputDirectory: string,
  hooks: T554InterfaceAtlasReadHooks = {},
): Sha256 {
  return verifyPersistedT554InterfaceAtlasEvidence(outputDirectory, hooks).manifestSha256;
}

function manifestBytes(pack: T554InterfaceAtlasPack): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(pack.manifest, null, 2)}\n`);
}

function comparePersistedWithPack(
  pack: T554InterfaceAtlasPack,
  outputDirectory: string,
  hooks: T554InterfaceAtlasReadHooks = {},
): Sha256 {
  const persisted = verifyPersistedT554InterfaceAtlas(outputDirectory, hooks);
  if (persisted !== pack.manifestSha256) throw new Error("interface atlas digest differs from exact regeneration");
  const root = validateDirectory(outputDirectory, "interface atlas output directory");
  for (const [fileName, text] of pack.files) {
    const expectedBytes = new TextEncoder().encode(text);
    const actual = readStableT554InterfaceAtlasFile(
      safeOutputMember(root, fileName),
      { byteLength: expectedBytes.byteLength, sha256: sha256(expectedBytes), maximumByteLength: MAX_SVG_BYTES },
      { purpose: "svg", fileName },
      hooks,
    );
    if (!Buffer.from(actual.bytes).equals(Buffer.from(expectedBytes))) {
      throw new Error("interface atlas SVG differs from exact source regeneration");
    }
  }
  const expectedManifest = manifestBytes(pack);
  const actualManifest = readStableT554InterfaceAtlasFile(
    safeOutputMember(root, "manifest.json"),
    { byteLength: expectedManifest.byteLength, sha256: sha256(expectedManifest), maximumByteLength: MAX_MANIFEST_BYTES },
    { purpose: "manifest", fileName: "manifest.json" },
    hooks,
  );
  if (!Buffer.from(actualManifest.bytes).equals(Buffer.from(expectedManifest))) {
    throw new Error("interface atlas manifest differs from exact source regeneration");
  }
  return persisted;
}

export function checkT554InterfaceAtlasExactRegeneration(
  inputs: T554InterfaceAtlasBuildInputs,
  outputDirectory: string,
  hooks: T554InterfaceAtlasReadHooks = {},
): Sha256 {
  return comparePersistedWithPack(buildT554InterfaceAtlas(inputs), outputDirectory, hooks);
}

export function checkT554InterfaceAtlas(options: T554InterfaceAtlasWriteOptions): Sha256 {
  const inputs = loadT554InterfaceAtlasInputsFromFiles(options, options.hooks);
  return checkT554InterfaceAtlasExactRegeneration(inputs, options.outputDirectory, options.hooks);
}

function pathsOverlap(left: string, right: string): boolean {
  const canonicalLeft = resolve(left);
  const canonicalRight = resolve(right);
  const leftToRight = relative(canonicalLeft, canonicalRight);
  const rightToLeft = relative(canonicalRight, canonicalLeft);
  const isWithin = (candidate: string): boolean =>
    candidate.length === 0 || (!candidate.startsWith(`..${sep}`) && candidate !== ".." && !isAbsolute(candidate));
  return isWithin(leftToRight) || isWithin(rightToLeft);
}

function assertNoLinkAncestors(path: string): void {
  if (!isAbsolute(path)) throw new Error("interface atlas output path must be absolute");
  let current = resolve(path);
  for (;;) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error("interface atlas output traverses a link");
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function writeExclusive(path: string, bytes: Uint8Array): void {
  const descriptor = openSync(path, "wx");
  try {
    writeFileSync(descriptor, bytes);
  } finally {
    closeSync(descriptor);
  }
}

export function writeT554InterfaceAtlas(options: T554InterfaceAtlasWriteOptions): Sha256 {
  if (!isAbsolute(options.outputDirectory)) throw new Error("interface atlas output must be absolute");
  const output = resolve(options.outputDirectory);
  if (existsSync(output)) throw new Error("interface atlas output already exists");
  const sourceRoot = validateDirectory(options.matterpakSourceRoot, "MatterPak source root");
  if (pathsOverlap(sourceRoot, output)) throw new Error("interface atlas output overlaps immutable source");
  assertNoLinkAncestors(output);
  const inputs = loadT554InterfaceAtlasInputsFromFiles(options, options.hooks);
  const pack = buildT554InterfaceAtlas(inputs);
  const parent = dirname(output);
  mkdirSync(parent, { recursive: true });
  assertNoLinkAncestors(parent);
  const stage = resolve(parent, `.${basename(output)}.stage-${String(process.pid)}-${randomUUID()}`);
  if (existsSync(stage) || pathsOverlap(stage, sourceRoot)) throw new Error("interface atlas staging path is unsafe");
  mkdirSync(stage);
  try {
    for (const [fileName, text] of pack.files) {
      writeExclusive(resolve(stage, fileName), new TextEncoder().encode(text));
    }
    writeExclusive(resolve(stage, "manifest.json"), manifestBytes(pack));
    comparePersistedWithPack(pack, stage);
    if (existsSync(output)) throw new Error("interface atlas output appeared before atomic publish");
    renameSync(stage, output);
    return comparePersistedWithPack(pack, output);
  } catch (error) {
    if (existsSync(stage)) rmSync(stage, { recursive: true, force: true });
    throw error;
  }
}
