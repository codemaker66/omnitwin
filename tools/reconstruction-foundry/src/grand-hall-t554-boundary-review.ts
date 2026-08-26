/**
 * T-554 authority-none Grand Hall boundary review evidence.
 *
 * Every visual in this module is a direct, flat projection of hash-bound
 * MatterPak triangles, triangle/plane intersections, E57 camera centres, or
 * shared source vertices. Plane fits are explicitly non-architectural review
 * diagnostics. This module never authors a wall, portal closure, room volume,
 * texture, or mask.
 */

import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
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
  classifyVerticalFirstHits,
  GRAND_HALL_ROOM_9,
  parseMatterportObjText,
  stableCanonicalJson,
  type AxisAlignedBounds3,
  type CameraTranslation,
  type JsonValue,
  type MatterportObjTriangle,
  type MatterportRoomKey,
  type ParsedMatterportObj,
  type Vec3,
  type VerticalFirstHitResult,
} from "./grand-hall-room9-boundary.js";
import { computePythonCanonicalPoseSha256 } from "./grand-hall-room9-source-receipt.js";
import {
  GRAND_HALL_T554_INTERFACE_DEFINITIONS,
  checkT554InterfaceAtlas,
  verifyPersistedT554InterfaceAtlasEvidence,
  writeT554InterfaceAtlas,
} from "./grand-hall-t554-interface-atlas.js";
import { verifyT554SvgSafety } from "./grand-hall-t554-svg-safety.js";

export { verifyT554SvgSafety } from "./grand-hall-t554-svg-safety.js";

export const GRAND_HALL_T554_BOUNDARY_REVIEW_PACK_SCHEMA =
  "omnitwin.foundry.grand-hall-t554-boundary-review-pack.v2";
export const GRAND_HALL_T554_BOUNDARY_REVIEW_PACK_DOMAIN =
  "OMNITWIN_GRAND_HALL_T554_BOUNDARY_REVIEW_PACK_V2";
export const GRAND_HALL_T554_BOUNDARY_REVIEW_FATAL_MESSAGE =
  "Grand Hall T-554 boundary review generation failed; no review pack was issued.";

const ROOM_13: MatterportRoomKey = Object.freeze({ groupIndex: 1, subIndex: 13 });
const ROOM_14: MatterportRoomKey = Object.freeze({ groupIndex: 1, subIndex: 14 });
const REVIEW_ROOMS = Object.freeze([GRAND_HALL_ROOM_9, ROOM_13, ROOM_14]);
const SLICE_HEIGHTS_M = Object.freeze([0.1, 1.5, 2.5]);
const SLICE_EPSILON_M = 1e-9;
const FLOAT_QUANTIZATION_DECIMALS = 9;
const INTERFACE_PALETTE = Object.freeze([
  "#fb7185",
  "#f97316",
  "#eab308",
  "#84cc16",
  "#14b8a6",
  "#06b6d4",
  "#8b5cf6",
  "#ec4899",
]);
const T551_SOURCE_RECEIPT_SHA256 =
  "sha256:0d331b5193f345ad5a127372b691ae02d2049fecdcfd0bc92b7f7cc27166997b";
const T551_EVIDENCE_SHA256 =
  "sha256:7ab3490a55f67d700a8ab84581e53c69e66b3dc831256bc9b70350d43f8b41c4";
const EXPECTED_POSE_CANONICAL_SHA256 =
  "sha256:fe3b9000eda4737af038e01e811e57bffa7fae07290a938c1ef75875c9df82e3";

type Sha256 = `sha256:${string}`;
type Vec2 = readonly [number, number];
type Edge = readonly [number, number];

interface ExpectedSourceFile {
  readonly sourceLocator: string;
  readonly fileName: string;
  readonly byteLength: number;
  readonly sha256: Sha256;
}

const EXPECTED_SOURCE_FILES = Object.freeze({
  obj: Object.freeze({
    sourceLocator: "MATTERPAK_SOURCE_ROOT/424ff41f6e5d41969c635fcd61be9b3f.obj",
    fileName: "424ff41f6e5d41969c635fcd61be9b3f.obj",
    byteLength: 38_381_816,
    sha256: "sha256:cf7247b5343fe719dc0f1aaf6b64c667d238c69133b71c44ccd9f5c67b5878c7",
  }),
  mtl: Object.freeze({
    sourceLocator: "MATTERPAK_SOURCE_ROOT/424ff41f6e5d41969c635fcd61be9b3f.mtl",
    fileName: "424ff41f6e5d41969c635fcd61be9b3f.mtl",
    byteLength: 20_879,
    sha256: "sha256:8e43085c90e40e2e76b7e221038c13bd65f17893a3d097eb12ffea5445f85d7a",
  }),
  colorPlan: Object.freeze({
    sourceLocator: "MATTERPAK_SOURCE_ROOT/colorplan_001.jpg",
    fileName: "colorplan_001.jpg",
    byteLength: 2_125_761,
    sha256: "sha256:95ea727b1c6426158f954a9f6f6c00fb60e838203f83a39b901ddb25f9417212",
  }),
  ceilingColorPlan: Object.freeze({
    sourceLocator: "MATTERPAK_SOURCE_ROOT/ceilingcolorplan_001.jpg",
    fileName: "ceilingcolorplan_001.jpg",
    byteLength: 1_982_157,
    sha256: "sha256:e94e9d6389000ea18d64aa875e2af75ee88ad31d4df970d449b99a2591f6064a",
  }),
  poses: Object.freeze({
    sourceLocator: "E57_SOURCE_ROOT/poses.json",
    fileName: "poses.json",
    byteLength: 39_717,
    sha256: "sha256:b181eee225ad5019caec82c207d6e996be0cddf8852048b50f430f77707dc364",
  }),
}) satisfies Readonly<Record<string, ExpectedSourceFile>>;

const OUTPUT_FILE_NAMES = Object.freeze([
  "plan-xy.svg",
  "camera-overview-diagnostic.svg",
  "slice-z-0.10m.svg",
  "slice-z-1.50m.svg",
  "slice-z-2.50m.svg",
  "interface-plane-fit-room9-room13.svg",
  "interface-plane-fit-room9-room14.svg",
]);
const INTERFACE_ATLAS_DIRECTORY_NAME = "interfaces";
const MAX_BOUNDARY_MANIFEST_BYTES = 4 * 1_024 * 1_024;
const MAX_BOUNDARY_SVG_BYTES = 32 * 1_024 * 1_024;

export interface T554StableSourceIdentity {
  readonly sourceLocator: string;
  readonly byteLength: number;
  readonly sha256: Sha256;
}

interface StableSourceBytes extends T554StableSourceIdentity {
  readonly bytes: Uint8Array;
}

interface FileIdentitySnapshot {
  readonly device: bigint;
  readonly inode: bigint;
  readonly mode: bigint;
  readonly links: bigint;
  readonly size: bigint;
  readonly modifiedNs: bigint;
  readonly changedNs: bigint;
}

export interface T554BoundaryReviewBuildInputs {
  readonly sources: {
    readonly obj: T554StableSourceIdentity;
    readonly mtl: T554StableSourceIdentity;
    readonly colorPlan: T554StableSourceIdentity;
    readonly ceilingColorPlan: T554StableSourceIdentity;
    readonly poses: T554StableSourceIdentity;
  };
  readonly objText: string;
  readonly mtlText: string;
  readonly posesJson: unknown;
  readonly poseCanonicalSha256: Sha256;
}

export interface T554CanonicalPoseDocument {
  readonly posesJson: unknown;
  readonly canonicalSha256: Sha256;
}

export interface T554BoundaryReviewPack {
  readonly manifest: JsonValue;
  readonly manifestSha256: Sha256;
  readonly files: ReadonlyMap<string, string>;
}

export interface T554BoundaryReviewFileOptions {
  readonly matterpakSourceRoot: string;
  readonly posesJsonPath: string;
}

export interface T554BoundaryReviewWriteOptions extends T554BoundaryReviewFileOptions {
  readonly outputDirectory: string;
}

interface RoomTriangles {
  readonly key: MatterportRoomKey;
  readonly triangles: readonly MatterportObjTriangle[];
}

interface EdgeRecord {
  readonly edge: Edge;
  count: number;
}

interface BoundaryComponentSummary {
  readonly vertexCount: number;
  readonly edgeCount: number;
  readonly degreeOneCount: number;
  readonly degreeTwoCount: number;
  readonly degreeAboveTwoCount: number;
  readonly kind: "loop" | "open" | "branched";
}

interface Room9Topology {
  readonly uniqueEdges: readonly EdgeRecord[];
  readonly boundaryEdges: readonly Edge[];
  readonly boundaryVertexCount: number;
  readonly boundaryComponents: readonly BoundaryComponentSummary[];
  readonly faceOrdinalsSha256: Sha256;
  readonly boundaryEdgesSha256: Sha256;
}

interface InterfaceEvidence {
  readonly interfaceId: string;
  readonly roomA: MatterportRoomKey;
  readonly roomB: MatterportRoomKey;
  readonly sharedVertexIndices: readonly number[];
  readonly sharedVertexIndicesSha256: Sha256;
  readonly sharedPositionsSha256: Sha256;
  readonly bounds: AxisAlignedBounds3;
  readonly room9BoundaryEdges: readonly Edge[];
  readonly room9BoundaryEdgesSha256: Sha256;
  readonly candidateRole: "shared_topology_unresolved";
}

interface InterfacePlanePointProjection {
  readonly vertexIndex: number;
  readonly u: number;
  readonly v: number;
  readonly signedResidualM: number;
}

interface InterfacePlaneFitDiagnostic {
  readonly interfaceId: string;
  readonly roomB: MatterportRoomKey;
  readonly centroid: Vec3;
  readonly normal: Vec3;
  readonly basisU: Vec3;
  readonly basisV: Vec3;
  readonly planeOffset: number;
  readonly eigenvalues: Vec3;
  readonly rmsResidualM: number;
  readonly maximumAbsoluteResidualM: number;
  readonly projectedBounds: { readonly min: Vec2; readonly max: Vec2 };
  readonly hullVertexIndices: readonly number[];
  readonly hullAreaSquareM: number;
  readonly hullPerimeterM: number;
  readonly projectedPoints: readonly InterfacePlanePointProjection[];
}

interface SliceSegment {
  readonly a: Vec2;
  readonly b: Vec2;
  readonly sourceFaceOrdinal: number;
}

interface SliceEvidence {
  readonly zM: number;
  readonly byRoom: readonly {
    readonly room: MatterportRoomKey;
    readonly segments: readonly SliceSegment[];
    readonly segmentsSha256: Sha256;
  }[];
}

interface BuiltGeometryEvidence {
  readonly model: ParsedMatterportObj;
  readonly cameras: readonly CameraTranslation[];
  readonly cameraHits: readonly VerticalFirstHitResult[];
  readonly rooms: readonly RoomTriangles[];
  readonly room9Topology: Room9Topology;
  readonly interfaces: readonly InterfaceEvidence[];
  readonly interfacePlaneFitDiagnostics: readonly InterfacePlaneFitDiagnostic[];
  readonly slices: readonly SliceEvidence[];
  readonly materialRefsByRoom: readonly {
    readonly room: MatterportRoomKey;
    readonly materialNames: readonly string[];
  }[];
}

function fileSha256(bytes: Uint8Array): Sha256 {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalDigest(domain: string, value: JsonValue): Sha256 {
  return `sha256:${createHash("sha256")
    .update(`${domain}\n${stableCanonicalJson(value)}`, "utf8")
    .digest("hex")}`;
}

function quantize(value: number): number {
  if (!Number.isFinite(value)) throw new Error("review evidence rejects non-finite numbers");
  const rounded = Number(value.toFixed(FLOAT_QUANTIZATION_DECIMALS));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function quantizedVec3(value: readonly number[]): Vec3 {
  if (value.length !== 3) throw new Error("expected a three-component vector");
  return [quantize(value[0] ?? 0), quantize(value[1] ?? 0), quantize(value[2] ?? 0)];
}

function requiredArrayItem<T>(items: readonly T[], index: number, context: string): T {
  const value = items[index];
  if (value === undefined) throw new Error(`${context} is absent`);
  return value;
}

function descriptorIdentity(descriptor: number): FileIdentitySnapshot {
  const stats = fstatSync(descriptor, { bigint: true });
  return {
    device: stats.dev,
    inode: stats.ino,
    mode: stats.mode,
    links: stats.nlink,
    size: stats.size,
    modifiedNs: stats.mtimeNs,
    changedNs: stats.ctimeNs,
  };
}

function pathIdentity(path: string): FileIdentitySnapshot {
  const stats = statSync(path, { bigint: true });
  return {
    device: stats.dev,
    inode: stats.ino,
    mode: stats.mode,
    links: stats.nlink,
    size: stats.size,
    modifiedNs: stats.mtimeNs,
    changedNs: stats.ctimeNs,
  };
}

function sameFileIdentity(left: FileIdentitySnapshot, right: FileIdentitySnapshot): boolean {
  return (
    left.device === right.device &&
    left.inode === right.inode &&
    left.mode === right.mode &&
    left.links === right.links &&
    left.size === right.size &&
    left.modifiedNs === right.modifiedNs &&
    left.changedNs === right.changedNs
  );
}

function safeDirectSourceFile(path: string, expected: ExpectedSourceFile): string {
  if (!isAbsolute(path)) throw new Error("review source file must be absolute");
  if (basename(path) !== expected.fileName) throw new Error("review source filename differs");
  if (lstatSync(path).isSymbolicLink()) throw new Error("review source cannot be a symbolic link");
  const canonical = realpathSync(path);
  if (!statSync(canonical).isFile()) throw new Error("review source must be a regular file");
  return canonical;
}

function readStableExactSource(path: string, expected: ExpectedSourceFile): StableSourceBytes {
  const canonicalBefore = safeDirectSourceFile(path, expected);
  const descriptor = openSync(canonicalBefore, "r");
  try {
    const before = descriptorIdentity(descriptor);
    const pathBefore = pathIdentity(canonicalBefore);
    if (!sameFileIdentity(before, pathBefore)) {
      throw new Error("review source descriptor and path identities differ");
    }
    if (before.size !== BigInt(expected.byteLength)) {
      throw new Error("review source byte length differs from the expected receipt");
    }
    const bytes = Buffer.alloc(expected.byteLength);
    const digest = createHash("sha256");
    const blockBytes = 8 * 1_024 * 1_024;
    let offset = 0;
    while (offset < bytes.byteLength) {
      const requested = Math.min(blockBytes, bytes.byteLength - offset);
      const bytesRead = readSync(descriptor, bytes, offset, requested, offset);
      if (bytesRead <= 0) throw new Error("review source ended during same-run hashing");
      digest.update(bytes.subarray(offset, offset + bytesRead));
      offset += bytesRead;
    }
    const sha256: Sha256 = `sha256:${digest.digest("hex")}`;
    if (sha256 !== expected.sha256) {
      throw new Error("review source SHA-256 differs from the expected receipt");
    }
    const canonicalAfter = realpathSync(path);
    const after = descriptorIdentity(descriptor);
    const pathAfter = pathIdentity(canonicalAfter);
    if (
      canonicalAfter !== canonicalBefore ||
      lstatSync(path).isSymbolicLink() ||
      !sameFileIdentity(before, after) ||
      !sameFileIdentity(after, pathAfter)
    ) {
      throw new Error("review source changed during hash and read");
    }
    return {
      sourceLocator: expected.sourceLocator,
      byteLength: bytes.byteLength,
      sha256,
      bytes,
    };
  } finally {
    closeSync(descriptor);
  }
}

function validatedMatterpakRoot(root: string): string {
  if (!isAbsolute(root)) throw new Error("MatterPak source root must be absolute");
  if (lstatSync(root).isSymbolicLink()) throw new Error("MatterPak source root cannot be a link");
  const canonical = realpathSync(root);
  if (!statSync(canonical).isDirectory()) throw new Error("MatterPak source root must be a directory");
  return canonical;
}

function sourceRecord(value: StableSourceBytes): T554StableSourceIdentity {
  return {
    sourceLocator: value.sourceLocator,
    byteLength: value.byteLength,
    sha256: value.sha256,
  };
}

export function canonicalizeT554PoseDocument(bytes: Uint8Array): T554CanonicalPoseDocument {
  let posesJson: unknown;
  try {
    posesJson = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("retained E57 poses.json is not strict UTF-8 JSON");
  }
  return {
    posesJson,
    canonicalSha256: computePythonCanonicalPoseSha256(posesJson),
  };
}

export function loadT554BoundaryReviewInputsFromFiles(
  options: T554BoundaryReviewFileOptions,
): T554BoundaryReviewBuildInputs {
  const root = validatedMatterpakRoot(options.matterpakSourceRoot);
  const obj = readStableExactSource(resolve(root, EXPECTED_SOURCE_FILES.obj.fileName), EXPECTED_SOURCE_FILES.obj);
  const mtl = readStableExactSource(resolve(root, EXPECTED_SOURCE_FILES.mtl.fileName), EXPECTED_SOURCE_FILES.mtl);
  const colorPlan = readStableExactSource(
    resolve(root, EXPECTED_SOURCE_FILES.colorPlan.fileName),
    EXPECTED_SOURCE_FILES.colorPlan,
  );
  const ceilingColorPlan = readStableExactSource(
    resolve(root, EXPECTED_SOURCE_FILES.ceilingColorPlan.fileName),
    EXPECTED_SOURCE_FILES.ceilingColorPlan,
  );
  const poses = readStableExactSource(options.posesJsonPath, EXPECTED_SOURCE_FILES.poses);
  const canonicalPoses = canonicalizeT554PoseDocument(poses.bytes);
  if (canonicalPoses.canonicalSha256 !== EXPECTED_POSE_CANONICAL_SHA256) {
    throw new Error("pose values differ from the T-551 canonical pose receipt");
  }
  return {
    sources: {
      obj: sourceRecord(obj),
      mtl: sourceRecord(mtl),
      colorPlan: sourceRecord(colorPlan),
      ceilingColorPlan: sourceRecord(ceilingColorPlan),
      poses: sourceRecord(poses),
    },
    objText: new TextDecoder().decode(obj.bytes),
    mtlText: new TextDecoder().decode(mtl.bytes),
    posesJson: canonicalPoses.posesJson,
    poseCanonicalSha256: canonicalPoses.canonicalSha256,
  };
}

function roomId(room: MatterportRoomKey): string {
  return `${String(room.groupIndex)}:${String(room.subIndex)}`;
}

function interfaceId(roomA: MatterportRoomKey, roomB: MatterportRoomKey): string {
  return `matterpak-${roomId(roomA).replace(":", "-")}-${roomId(roomB).replace(":", "-")}`;
}

function isRoom(group: MatterportRoomKey, room: MatterportRoomKey): boolean {
  return group.groupIndex === room.groupIndex && group.subIndex === room.subIndex;
}

function edge(a: number, b: number): Edge {
  return a < b ? [a, b] : [b, a];
}

function edgeKey(value: Edge): string {
  return `${String(value[0])}:${String(value[1])}`;
}

function compareEdge(a: Edge, b: Edge): number {
  return a[0] - b[0] || a[1] - b[1];
}

function roomTriangles(model: ParsedMatterportObj, room: MatterportRoomKey): MatterportObjTriangle[] {
  return model.triangles.filter((triangle) => isRoom(triangle.group, room));
}

function roomVertexIndices(triangles: readonly MatterportObjTriangle[]): Set<number> {
  const indices = new Set<number>();
  for (const triangle of triangles) {
    for (const vertexIndex of triangle.vertexIndices) indices.add(vertexIndex);
  }
  return indices;
}

function boundsForIndices(model: ParsedMatterportObj, indices: readonly number[]): AxisAlignedBounds3 {
  if (indices.length === 0) throw new Error("cannot derive bounds for an empty vertex set");
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const index of indices) {
    const point = model.vertices[index];
    if (point === undefined) throw new Error("interface references a missing source vertex");
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis] ?? Number.POSITIVE_INFINITY, point[axis] ?? 0);
      max[axis] = Math.max(max[axis] ?? Number.NEGATIVE_INFINITY, point[axis] ?? 0);
    }
  }
  return { min: quantizedVec3(min), max: quantizedVec3(max) };
}

function topologyForRoom9(triangles: readonly MatterportObjTriangle[]): Room9Topology {
  const edges = new Map<string, EdgeRecord>();
  for (const triangle of triangles) {
    const [a, b, c] = triangle.vertexIndices;
    for (const candidate of [edge(a, b), edge(b, c), edge(c, a)]) {
      const key = edgeKey(candidate);
      const existing = edges.get(key);
      if (existing === undefined) edges.set(key, { edge: candidate, count: 1 });
      else existing.count += 1;
    }
  }
  const uniqueEdges = [...edges.values()].sort((a, b) => compareEdge(a.edge, b.edge));
  const boundaryEdges = uniqueEdges.filter((item) => item.count === 1).map((item) => item.edge);
  const graph = new Map<number, Set<number>>();
  for (const [a, b] of boundaryEdges) {
    const neighborsA = graph.get(a) ?? new Set<number>();
    const neighborsB = graph.get(b) ?? new Set<number>();
    neighborsA.add(b);
    neighborsB.add(a);
    graph.set(a, neighborsA);
    graph.set(b, neighborsB);
  }
  const visited = new Set<number>();
  const boundaryComponents: BoundaryComponentSummary[] = [];
  for (const start of [...graph.keys()].sort((a, b) => a - b)) {
    if (visited.has(start)) continue;
    const stack = [start];
    visited.add(start);
    let vertexCount = 0;
    let degreeSum = 0;
    let degreeOneCount = 0;
    let degreeTwoCount = 0;
    let degreeAboveTwoCount = 0;
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) break;
      vertexCount += 1;
      const neighbors = graph.get(current);
      if (neighbors === undefined) throw new Error("boundary graph lost a vertex");
      degreeSum += neighbors.size;
      if (neighbors.size === 1) degreeOneCount += 1;
      else if (neighbors.size === 2) degreeTwoCount += 1;
      else if (neighbors.size > 2) degreeAboveTwoCount += 1;
      for (const neighbor of [...neighbors].sort((a, b) => b - a)) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          stack.push(neighbor);
        }
      }
    }
    boundaryComponents.push({
      vertexCount,
      edgeCount: degreeSum / 2,
      degreeOneCount,
      degreeTwoCount,
      degreeAboveTwoCount,
      kind: degreeAboveTwoCount > 0 ? "branched" : degreeOneCount > 0 ? "open" : "loop",
    });
  }
  boundaryComponents.sort((a, b) =>
    b.edgeCount - a.edgeCount || b.vertexCount - a.vertexCount || a.kind.localeCompare(b.kind),
  );
  const faceOrdinals = triangles.map((triangle) => triangle.sourceFaceOrdinal).sort((a, b) => a - b);
  return {
    uniqueEdges,
    boundaryEdges,
    boundaryVertexCount: graph.size,
    boundaryComponents,
    faceOrdinalsSha256: canonicalDigest(
      `${GRAND_HALL_T554_BOUNDARY_REVIEW_PACK_DOMAIN}.room9-face-ordinals`,
      faceOrdinals,
    ),
    boundaryEdgesSha256: canonicalDigest(
      `${GRAND_HALL_T554_BOUNDARY_REVIEW_PACK_DOMAIN}.room9-boundary-edges`,
      boundaryEdges,
    ),
  };
}

function allRoomVertexSets(model: ParsedMatterportObj): Map<string, { key: MatterportRoomKey; vertices: Set<number> }> {
  const sets = new Map<string, { key: MatterportRoomKey; vertices: Set<number> }>();
  for (const triangle of model.triangles) {
    const id = roomId(triangle.group);
    const current = sets.get(id) ?? {
      key: { groupIndex: triangle.group.groupIndex, subIndex: triangle.group.subIndex },
      vertices: new Set<number>(),
    };
    for (const vertexIndex of triangle.vertexIndices) current.vertices.add(vertexIndex);
    sets.set(id, current);
  }
  return sets;
}

function exhaustiveInterfaces(
  model: ParsedMatterportObj,
  room9Triangles: readonly MatterportObjTriangle[],
  topology: Room9Topology,
): InterfaceEvidence[] {
  const room9Vertices = roomVertexIndices(room9Triangles);
  const roomSets = allRoomVertexSets(model);
  const interfaces: InterfaceEvidence[] = [];
  for (const candidate of roomSets.values()) {
    if (isRoom(candidate.key, GRAND_HALL_ROOM_9)) continue;
    const shared = [...room9Vertices].filter((index) => candidate.vertices.has(index)).sort((a, b) => a - b);
    if (shared.length === 0) continue;
    const sharedSet = new Set(shared);
    const interfaceBoundaryEdges = topology.boundaryEdges
      .filter(([a, b]) => sharedSet.has(a) && sharedSet.has(b))
      .sort(compareEdge);
    const positions = shared.map((index) => {
      const point = model.vertices[index];
      if (point === undefined) throw new Error("shared interface vertex is absent");
      return [index, ...point] as const;
    });
    interfaces.push({
      interfaceId: interfaceId(GRAND_HALL_ROOM_9, candidate.key),
      roomA: GRAND_HALL_ROOM_9,
      roomB: candidate.key,
      sharedVertexIndices: shared,
      sharedVertexIndicesSha256: canonicalDigest(
        `${GRAND_HALL_T554_BOUNDARY_REVIEW_PACK_DOMAIN}.interface-indices.${roomId(candidate.key)}`,
        shared,
      ),
      sharedPositionsSha256: canonicalDigest(
        `${GRAND_HALL_T554_BOUNDARY_REVIEW_PACK_DOMAIN}.interface-positions.${roomId(candidate.key)}`,
        positions,
      ),
      bounds: boundsForIndices(model, shared),
      room9BoundaryEdges: interfaceBoundaryEdges,
      room9BoundaryEdgesSha256: canonicalDigest(
        `${GRAND_HALL_T554_BOUNDARY_REVIEW_PACK_DOMAIN}.interface-boundary-edges.${roomId(candidate.key)}`,
        interfaceBoundaryEdges,
      ),
      candidateRole: "shared_topology_unresolved",
    });
  }
  return interfaces.sort((a, b) =>
    a.roomB.groupIndex - b.roomB.groupIndex || a.roomB.subIndex - b.roomB.subIndex,
  );
}

function dot(a: readonly number[], b: readonly number[]): number {
  return (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0);
}

function subtract(a: readonly number[], b: readonly number[]): Vec3 {
  return [(a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0)];
}

function scale(value: readonly number[], multiplier: number): Vec3 {
  return [(value[0] ?? 0) * multiplier, (value[1] ?? 0) * multiplier, (value[2] ?? 0) * multiplier];
}

function cross(a: readonly number[], b: readonly number[]): Vec3 {
  return [
    (a[1] ?? 0) * (b[2] ?? 0) - (a[2] ?? 0) * (b[1] ?? 0),
    (a[2] ?? 0) * (b[0] ?? 0) - (a[0] ?? 0) * (b[2] ?? 0),
    (a[0] ?? 0) * (b[1] ?? 0) - (a[1] ?? 0) * (b[0] ?? 0),
  ];
}

function normalize(value: readonly number[]): Vec3 {
  const length = Math.hypot(value[0] ?? 0, value[1] ?? 0, value[2] ?? 0);
  if (!Number.isFinite(length) || length <= 1e-12) throw new Error("cannot normalize a degenerate vector");
  return [(value[0] ?? 0) / length, (value[1] ?? 0) / length, (value[2] ?? 0) / length];
}

interface EigenPair {
  readonly value: number;
  readonly vector: Vec3;
}

function symmetricEigenPairs(covariance: readonly (readonly number[])[]): readonly EigenPair[] {
  const matrix = covariance.map((row) => [...row]);
  const vectors = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let iteration = 0; iteration < 64; iteration += 1) {
    let p = 0;
    let q = 1;
    let maximum = Math.abs(matrix[0]?.[1] ?? 0);
    for (const [i, j] of [[0, 2], [1, 2]] as const) {
      const candidate = Math.abs(matrix[i]?.[j] ?? 0);
      if (candidate > maximum) {
        maximum = candidate;
        p = i;
        q = j;
      }
    }
    if (maximum <= 1e-15) break;
    const app = matrix[p]?.[p] ?? 0;
    const aqq = matrix[q]?.[q] ?? 0;
    const apq = matrix[p]?.[q] ?? 0;
    const angle = 0.5 * Math.atan2(2 * apq, aqq - app);
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const rowP = requiredArrayItem(matrix, p, "Jacobi row p");
    const rowQ = requiredArrayItem(matrix, q, "Jacobi row q");
    for (let axis = 0; axis < 3; axis += 1) {
      if (axis === p || axis === q) continue;
      const axisRow = requiredArrayItem(matrix, axis, "Jacobi axis row");
      const axisP = matrix[axis]?.[p] ?? 0;
      const axisQ = matrix[axis]?.[q] ?? 0;
      const rotatedP = cosine * axisP - sine * axisQ;
      const rotatedQ = sine * axisP + cosine * axisQ;
      axisRow[p] = rotatedP;
      axisRow[q] = rotatedQ;
      rowP[axis] = rotatedP;
      rowQ[axis] = rotatedQ;
    }
    rowP[p] = cosine * cosine * app - 2 * sine * cosine * apq + sine * sine * aqq;
    rowQ[q] = sine * sine * app + 2 * sine * cosine * apq + cosine * cosine * aqq;
    rowP[q] = 0;
    rowQ[p] = 0;
    for (let axis = 0; axis < 3; axis += 1) {
      const vectorRow = requiredArrayItem(vectors, axis, "Jacobi eigenvector row");
      const vectorP = vectorRow[p] ?? 0;
      const vectorQ = vectorRow[q] ?? 0;
      vectorRow[p] = cosine * vectorP - sine * vectorQ;
      vectorRow[q] = sine * vectorP + cosine * vectorQ;
    }
  }
  return [0, 1, 2]
    .map((index): EigenPair => ({
      value: matrix[index]?.[index] ?? 0,
      vector: normalize([
        vectors[0]?.[index] ?? 0,
        vectors[1]?.[index] ?? 0,
        vectors[2]?.[index] ?? 0,
      ]),
    }))
    .sort((a, b) => a.value - b.value);
}

function canonicalNormal(value: Vec3): Vec3 {
  const absolute = value.map((component) => Math.abs(component));
  let largestAxis = 0;
  for (let axis = 1; axis < 3; axis += 1) {
    if ((absolute[axis] ?? 0) > (absolute[largestAxis] ?? 0)) largestAxis = axis;
  }
  return (value[largestAxis] ?? 0) < 0 ? scale(value, -1) : value;
}

function convexHull(points: readonly InterfacePlanePointProjection[]): readonly InterfacePlanePointProjection[] {
  const sorted = [...points].sort((a, b) => a.u - b.u || a.v - b.v || a.vertexIndex - b.vertexIndex);
  const cross2 = (
    o: InterfacePlanePointProjection,
    a: InterfacePlanePointProjection,
    b: InterfacePlanePointProjection,
  ): number =>
    (a.u - o.u) * (b.v - o.v) - (a.v - o.v) * (b.u - o.u);
  const lower: InterfacePlanePointProjection[] = [];
  for (const point of sorted) {
    while (lower.length >= 2) {
      const origin = requiredArrayItem(lower, lower.length - 2, "lower hull origin");
      const previous = requiredArrayItem(lower, lower.length - 1, "lower hull previous point");
      if (cross2(origin, previous, point) > 0) break;
      lower.pop();
    }
    lower.push(point);
  }
  const upper: InterfacePlanePointProjection[] = [];
  for (const point of [...sorted].reverse()) {
    while (upper.length >= 2) {
      const origin = requiredArrayItem(upper, upper.length - 2, "upper hull origin");
      const previous = requiredArrayItem(upper, upper.length - 1, "upper hull previous point");
      if (cross2(origin, previous, point) > 0) break;
      upper.pop();
    }
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function interfacePlaneFitDiagnostic(
  model: ParsedMatterportObj,
  evidence: InterfaceEvidence,
): InterfacePlaneFitDiagnostic {
  const points = evidence.sharedVertexIndices.map((index) => {
    const point = model.vertices[index];
    if (point === undefined) throw new Error("shared interface vertex is absent");
    return { index, point };
  });
  const centroidRaw = [0, 1, 2].map(
    (axis) => points.reduce((total, point) => total + (point.point[axis] ?? 0), 0) / points.length,
  );
  const centroid = quantizedVec3(centroidRaw);
  const covariance = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const { point } of points) {
    const centered = subtract(point, centroidRaw);
    for (let row = 0; row < 3; row += 1) {
      const covarianceRow = requiredArrayItem(covariance, row, "covariance row");
      for (let column = 0; column < 3; column += 1) {
        covarianceRow[column] =
          (covarianceRow[column] ?? 0) +
          (centered[row] ?? 0) * (centered[column] ?? 0) / points.length;
      }
    }
  }
  const eigenPairs = symmetricEigenPairs(covariance);
  const normalRaw = canonicalNormal(eigenPairs[0]?.vector ?? [0, 1, 0]);
  const normal = quantizedVec3(normalRaw);
  const worldX: Vec3 = [1, 0, 0];
  const projectedX = subtract(worldX, scale(normalRaw, dot(worldX, normalRaw)));
  const basisURaw = normalize(projectedX);
  let basisVRaw = normalize(cross(basisURaw, normalRaw));
  if (dot(basisVRaw, [0, 0, 1]) < 0) basisVRaw = scale(basisVRaw, -1);
  const basisU = quantizedVec3(basisURaw);
  const basisV = quantizedVec3(basisVRaw);
  const projectedPoints = points.map(({ index, point }): InterfacePlanePointProjection => {
    const centered = subtract(point, centroidRaw);
    return {
      vertexIndex: index,
      u: quantize(dot(centered, basisURaw)),
      v: quantize(dot(centered, basisVRaw)),
      signedResidualM: quantize(dot(centered, normalRaw)),
    };
  });
  const hull = convexHull(projectedPoints);
  if (hull.length < 3) throw new Error("shared-interface vertices do not form a reviewable hull");
  let twiceArea = 0;
  let perimeter = 0;
  for (let index = 0; index < hull.length; index += 1) {
    const current = requiredArrayItem(hull, index, "shared-interface hull point");
    const next = requiredArrayItem(hull, (index + 1) % hull.length, "shared-interface hull successor");
    twiceArea += current.u * next.v - current.v * next.u;
    perimeter += Math.hypot(next.u - current.u, next.v - current.v);
  }
  const residuals = projectedPoints.map((point) => point.signedResidualM);
  const minU = Math.min(...projectedPoints.map((point) => point.u));
  const minV = Math.min(...projectedPoints.map((point) => point.v));
  const maxU = Math.max(...projectedPoints.map((point) => point.u));
  const maxV = Math.max(...projectedPoints.map((point) => point.v));
  return {
    interfaceId: evidence.interfaceId,
    roomB: evidence.roomB,
    centroid,
    normal,
    basisU,
    basisV,
    planeOffset: quantize(-dot(normalRaw, centroidRaw)),
    eigenvalues: quantizedVec3(eigenPairs.map((pair) => pair.value)),
    rmsResidualM: quantize(
      Math.sqrt(residuals.reduce((total, value) => total + value * value, 0) / residuals.length),
    ),
    maximumAbsoluteResidualM: quantize(Math.max(...residuals.map((value) => Math.abs(value)))),
    projectedBounds: { min: [quantize(minU), quantize(minV)], max: [quantize(maxU), quantize(maxV)] },
    hullVertexIndices: hull.map((point) => point.vertexIndex),
    hullAreaSquareM: quantize(Math.abs(twiceArea) / 2),
    hullPerimeterM: quantize(perimeter),
    projectedPoints,
  };
}

function samePoint(a: Vec2, b: Vec2): boolean {
  return Math.abs(a[0] - b[0]) <= SLICE_EPSILON_M && Math.abs(a[1] - b[1]) <= SLICE_EPSILON_M;
}

function sliceTriangle(
  model: ParsedMatterportObj,
  triangle: MatterportObjTriangle,
  zM: number,
): SliceSegment[] {
  const points = triangle.vertexIndices.map((index) => model.vertices[index]);
  if (points.some((point) => point === undefined)) throw new Error("slice triangle has a missing vertex");
  const vertices = points as [Vec3, Vec3, Vec3];
  const distances = vertices.map((point) => point[2] - zM);
  if (distances.every((distance) => Math.abs(distance) <= SLICE_EPSILON_M)) {
    return [
      { a: [vertices[0][0], vertices[0][1]], b: [vertices[1][0], vertices[1][1]], sourceFaceOrdinal: triangle.sourceFaceOrdinal },
      { a: [vertices[1][0], vertices[1][1]], b: [vertices[2][0], vertices[2][1]], sourceFaceOrdinal: triangle.sourceFaceOrdinal },
      { a: [vertices[2][0], vertices[2][1]], b: [vertices[0][0], vertices[0][1]], sourceFaceOrdinal: triangle.sourceFaceOrdinal },
    ];
  }
  const intersections: Vec2[] = [];
  for (const [first, second] of [[0, 1], [1, 2], [2, 0]] as const) {
    const a = vertices[first];
    const b = vertices[second];
    const da = distances[first] ?? 0;
    const db = distances[second] ?? 0;
    if (Math.abs(da) <= SLICE_EPSILON_M) intersections.push([a[0], a[1]]);
    if (da * db < 0) {
      const t = da / (da - db);
      intersections.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  const unique: Vec2[] = [];
  for (const point of intersections) {
    if (!unique.some((candidate) => samePoint(point, candidate))) unique.push(point);
  }
  if (unique.length < 2) return [];
  if (unique.length > 2) {
    let best: readonly [Vec2, Vec2] = [
      requiredArrayItem(unique, 0, "slice intersection start"),
      requiredArrayItem(unique, 1, "slice intersection end"),
    ];
    let bestDistance = 0;
    for (let first = 0; first < unique.length; first += 1) {
      for (let second = first + 1; second < unique.length; second += 1) {
        const a = requiredArrayItem(unique, first, "slice distance start");
        const b = requiredArrayItem(unique, second, "slice distance end");
        const distance = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (distance > bestDistance) {
          best = [a, b];
          bestDistance = distance;
        }
      }
    }
    return [{ a: best[0], b: best[1], sourceFaceOrdinal: triangle.sourceFaceOrdinal }];
  }
  return [{
    a: requiredArrayItem(unique, 0, "slice segment start"),
    b: requiredArrayItem(unique, 1, "slice segment end"),
    sourceFaceOrdinal: triangle.sourceFaceOrdinal,
  }];
}

function sliceEvidence(model: ParsedMatterportObj, rooms: readonly RoomTriangles[], zM: number): SliceEvidence {
  return {
    zM,
    byRoom: rooms.map((room) => {
      const segments = room.triangles.flatMap((triangle) => sliceTriangle(model, triangle, zM));
      const digestMaterial = segments.map((segment) => [
        segment.sourceFaceOrdinal,
        quantize(segment.a[0]),
        quantize(segment.a[1]),
        quantize(segment.b[0]),
        quantize(segment.b[1]),
      ]);
      return {
        room: room.key,
        segments,
        segmentsSha256: canonicalDigest(
          `${GRAND_HALL_T554_BOUNDARY_REVIEW_PACK_DOMAIN}.slice.${zM.toFixed(2)}.${roomId(room.key)}`,
          digestMaterial,
        ),
      };
    }),
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

function requireSafeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a nonnegative safe integer`);
  }
  return value;
}

function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function requireSha256(value: unknown, label: string): Sha256 {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} must be a SHA-256 receipt`);
  }
  return value as Sha256;
}

function requireExactKeys(
  record: Readonly<Record<string, unknown>>,
  expectedKeys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(record).sort();
  const expected = [...expectedKeys].sort();
  if (stableCanonicalJson(actual) !== stableCanonicalJson(expected)) {
    throw new Error(`${label} fields drifted`);
  }
}

function requireExactRoom(value: unknown, expected: MatterportRoomKey, label: string): void {
  const room = requireRecord(value, label);
  requireExactKeys(room, ["groupIndex", "subIndex"], label);
  if (room.groupIndex !== expected.groupIndex || room.subIndex !== expected.subIndex) {
    throw new Error(`${label} differs from its exact source room`);
  }
}

function requireFiniteBounds(value: unknown, label: string): AxisAlignedBounds3 {
  const bounds = requireRecord(value, label);
  requireExactKeys(bounds, ["min", "max"], label);
  const minimum = finiteVector(bounds.min, 3, `${label} minimum`) as Vec3;
  const maximum = finiteVector(bounds.max, 3, `${label} maximum`) as Vec3;
  if (minimum.some((coordinate, index) => coordinate > (maximum[index] ?? Number.NEGATIVE_INFINITY))) {
    throw new Error(`${label} minimum exceeds maximum`);
  }
  return { min: minimum, max: maximum };
}

function finiteVector(value: unknown, length: number, label: string): readonly number[] {
  if (!Array.isArray(value) || value.length !== length) {
    throw new Error(`${label} must contain ${String(length)} numbers`);
  }
  return value.map((entry) => {
    if (typeof entry !== "number" || !Number.isFinite(entry)) throw new Error(`${label} is not finite`);
    return entry;
  });
}

function camerasFromPoses(value: unknown): CameraTranslation[] {
  const record = requireRecord(value, "poses JSON");
  const keys = Object.keys(record).sort((a, b) => Number(a) - Number(b));
  const cameras: CameraTranslation[] = [];
  keys.forEach((key, index) => {
    if (key !== String(index)) throw new Error("pose keys must be contiguous from zero");
    const pose = requireRecord(record[key], `pose ${key}`);
    const translation = finiteVector(pose.translation, 3, `pose ${key} translation`);
    const rotation = finiteVector(pose.rotation, 4, `pose ${key} rotation`);
    if (Math.abs(Math.hypot(...rotation) - 1) > 1e-5) throw new Error(`pose ${key} is not normalized`);
    cameras.push({
      index,
      translation: [translation[0] ?? 0, translation[1] ?? 0, translation[2] ?? 0],
    });
  });
  if (cameras.length !== 149) throw new Error("T-554 review requires the exact 149-pose inventory");
  return cameras;
}

function parseMtl(text: string): ReadonlyMap<string, string> {
  const materials = new Map<string, string>();
  let active: string | null = null;
  for (const [index, rawLine] of text.split(/\r?\n/u).entries()) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const fields = line.split(/\s+/u);
    if (fields[0] === "newmtl") {
      if (fields.length !== 2 || fields[1] === undefined) throw new Error(`MTL line ${String(index + 1)} is ambiguous`);
      if (materials.has(fields[1])) throw new Error("MTL declares a duplicate material");
      active = fields[1];
      materials.set(active, "");
    } else if (fields[0] === "map_Kd") {
      if (active === null || fields.length !== 2 || fields[1] === undefined) {
        throw new Error(`MTL line ${String(index + 1)} has an invalid diffuse map`);
      }
      if ((materials.get(active) ?? "").length > 0) throw new Error("MTL material has duplicate diffuse maps");
      materials.set(active, fields[1]);
    }
  }
  if (materials.size !== 144) throw new Error("MTL does not contain the expected 144 materials");
  for (const [material, diffuse] of materials) {
    if (diffuse !== material) throw new Error("MTL material does not map to its same-named source JPEG");
  }
  return materials;
}

function referencedMaterials(
  rooms: readonly RoomTriangles[],
  mtl: ReadonlyMap<string, string>,
): BuiltGeometryEvidence["materialRefsByRoom"] {
  return rooms.map((room) => {
    const materialNames = [...new Set(room.triangles.map((triangle) => triangle.material))]
      .filter((name): name is string => name !== null)
      .sort((a, b) => a.localeCompare(b));
    for (const name of materialNames) {
      if (!mtl.has(name)) throw new Error("OBJ room references an absent MTL material");
    }
    return { room: room.key, materialNames };
  });
}

function buildGeometry(inputs: T554BoundaryReviewBuildInputs): BuiltGeometryEvidence {
  if (computePythonCanonicalPoseSha256(inputs.posesJson) !== inputs.poseCanonicalSha256) {
    throw new Error("pose canonical digest differs from the supplied raw-to-canonical lineage");
  }
  const model = parseMatterportObjText(inputs.objText);
  const cameras = camerasFromPoses(inputs.posesJson);
  const rooms = REVIEW_ROOMS.map((key) => ({ key, triangles: roomTriangles(model, key) }));
  if (rooms.some((room) => room.triangles.length === 0)) throw new Error("review room has no source triangles");
  const room9 = rooms[0];
  if (room9 === undefined) throw new Error("room 9 source selection is absent");
  const room9Topology = topologyForRoom9(room9.triangles);
  const interfaces = exhaustiveInterfaces(model, room9.triangles, room9Topology);
  const planeFitReviewInterfaces = [...interfaces]
    .filter((item) => item.sharedVertexIndices.length >= 3)
    .sort((a, b) =>
      b.sharedVertexIndices.length - a.sharedVertexIndices.length || a.interfaceId.localeCompare(b.interfaceId),
    )
    .slice(0, 2);
  if (planeFitReviewInterfaces.length !== 2) {
    throw new Error("expected two source interfaces with enough vertices for review-only plane fits");
  }
  const interfacePlaneFitDiagnostics = planeFitReviewInterfaces.map((item) =>
    interfacePlaneFitDiagnostic(model, item),
  );
  const slices = SLICE_HEIGHTS_M.map((zM) => sliceEvidence(model, rooms, zM));
  const materialRefsByRoom = referencedMaterials(rooms, parseMtl(inputs.mtlText));
  return {
    model,
    cameras,
    cameraHits: classifyVerticalFirstHits(model, cameras).results,
    rooms,
    room9Topology,
    interfaces,
    interfacePlaneFitDiagnostics,
    slices,
    materialRefsByRoom,
  };
}

function formatNumber(value: number, decimals = 6): string {
  const formatted = value.toFixed(decimals).replace(/(?:\.0+|(?<=\.[0-9]*?)0+)$/u, "");
  return formatted === "-0" ? "0" : formatted;
}

function xmlEscape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function roomColor(room: MatterportRoomKey): string {
  if (room.groupIndex === 1 && room.subIndex === 9) return "#c9a45c";
  if (room.groupIndex === 1 && room.subIndex === 13) return "#38bdf8";
  if (room.groupIndex === 1 && room.subIndex === 14) return "#a78bfa";
  return "#94a3b8";
}

function planarBounds(geometry: BuiltGeometryEvidence, includeAllCameras: boolean): { minX: number; minY: number; maxX: number; maxY: number } {
  const points: Vec2[] = [];
  for (const room of geometry.rooms) {
    for (const triangle of room.triangles) {
      for (const index of triangle.vertexIndices) {
        const point = geometry.model.vertices[index];
        if (point !== undefined) points.push([point[0], point[1]]);
      }
    }
  }
  if (includeAllCameras) {
    for (const camera of geometry.cameras) points.push([camera.translation[0], camera.translation[1]]);
  }
  if (points.length === 0) {
    throw new Error("Cannot render a plan without source-backed geometry or camera points.");
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
  };
}

function svgHeader(title: string, description: string, bounds: { minX: number; minY: number; maxX: number; maxY: number }, bannerHeight = 0.9): string {
  const padding = 0.8;
  const minX = bounds.minX - padding;
  const minY = -bounds.maxY - padding - bannerHeight;
  const widthM = bounds.maxX - bounds.minX + padding * 2;
  const heightM = bounds.maxY - bounds.minY + padding * 2 + bannerHeight;
  const widthPx = Math.max(1200, Math.ceil(widthM * 100));
  const heightPx = Math.max(800, Math.ceil(heightM * 100));
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(widthPx)}" height="${String(heightPx)}" viewBox="${formatNumber(minX)} ${formatNumber(minY)} ${formatNumber(widthM)} ${formatNumber(heightM)}" role="img" aria-labelledby="title desc">`,
    `<title id="title">${xmlEscape(title)}</title>`,
    `<desc id="desc">${xmlEscape(description)}</desc>`,
    `<rect x="${formatNumber(minX)}" y="${formatNumber(minY)}" width="${formatNumber(widthM)}" height="${formatNumber(heightM)}" fill="#090d12"/>`,
    `<rect x="${formatNumber(minX)}" y="${formatNumber(minY)}" width="${formatNumber(widthM)}" height="${formatNumber(bannerHeight)}" fill="#111923"/>`,
    `<text x="${formatNumber(minX + 0.25)}" y="${formatNumber(minY + 0.38)}" fill="#f5d28b" font-family="sans-serif" font-size="0.24">${xmlEscape(title)}</text>`,
    `<text x="${formatNumber(minX + 0.25)}" y="${formatNumber(minY + 0.69)}" fill="#ef4444" font-family="sans-serif" font-weight="700" font-size="0.19">REVIEW PROPOSAL — NOT ARCHITECTURE — AUTHORITY NONE</text>`,
  ].join("\n");
}

function trianglePath(geometry: BuiltGeometryEvidence, triangles: readonly MatterportObjTriangle[]): string {
  return triangles.map((triangle) => {
    const points = triangle.vertexIndices.map((index) => geometry.model.vertices[index]);
    if (points.some((point) => point === undefined)) throw new Error("plan triangle has a missing vertex");
    const [a, b, c] = points as [Vec3, Vec3, Vec3];
    return `M${formatNumber(a[0])},${formatNumber(-a[1])}L${formatNumber(b[0])},${formatNumber(-b[1])}L${formatNumber(c[0])},${formatNumber(-c[1])}Z`;
  }).join("");
}

function edgesPath(model: ParsedMatterportObj, edges: readonly Edge[]): string {
  return edges.map(([aIndex, bIndex]) => {
    const a = model.vertices[aIndex];
    const b = model.vertices[bIndex];
    if (a === undefined || b === undefined) throw new Error("edge path references a missing vertex");
    return `M${formatNumber(a[0])},${formatNumber(-a[1])}L${formatNumber(b[0])},${formatNumber(-b[1])}`;
  }).join("");
}

function cameraColor(hit: VerticalFirstHitResult): string {
  if (hit.state === "no-hit") return "#ef4444";
  if (hit.group.groupIndex === 1 && hit.group.subIndex === 9) return "#22c55e";
  if (hit.group.groupIndex === 1 && hit.group.subIndex === 13) return "#38bdf8";
  if (hit.group.groupIndex === 1 && hit.group.subIndex === 14) return "#a78bfa";
  return "#64748b";
}

function cameraIsInsidePlanBounds(
  hit: VerticalFirstHitResult,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
): boolean {
  return (
    hit.cameraTranslation[0] >= bounds.minX &&
    hit.cameraTranslation[0] <= bounds.maxX &&
    hit.cameraTranslation[1] >= bounds.minY &&
    hit.cameraTranslation[1] <= bounds.maxY
  );
}

function roomScaleCandidateCameraHits(
  geometry: BuiltGeometryEvidence,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
): readonly VerticalFirstHitResult[] {
  return geometry.cameraHits.filter((hit) => hit.cameraIndex <= 49 && cameraIsInsidePlanBounds(hit, bounds));
}

function renderRoomTriangles(chunks: string[], geometry: BuiltGeometryEvidence): void {
  for (const room of geometry.rooms) {
    const color = roomColor(room.key);
    chunks.push(`<path d="${trianglePath(geometry, room.triangles)}" fill="${color}" fill-opacity="0.025" stroke="${color}" stroke-opacity="0.58" stroke-width="0.012"/>`);
  }
}

function renderCameraCentre(chunks: string[], hit: VerticalFirstHitResult, renderLabel: boolean): void {
  const x = hit.cameraTranslation[0];
  const y = -hit.cameraTranslation[1];
  chunks.push(`<circle cx="${formatNumber(x)}" cy="${formatNumber(y)}" r="0.07" fill="${cameraColor(hit)}" stroke="#020617" stroke-width="0.015"/>`);
  if (renderLabel) {
    chunks.push(`<text x="${formatNumber(x + 0.09)}" y="${formatNumber(y - 0.09)}" fill="#e2e8f0" font-family="monospace" font-size="0.14">${String(hit.cameraIndex)}</text>`);
  }
}

function renderPlanSvg(geometry: BuiltGeometryEvidence): string {
  const roomBounds = planarBounds(geometry, false);
  const footerHeight = 3.15;
  const canvasBounds = { ...roomBounds, minY: roomBounds.minY - footerHeight };
  const chunks = [svgHeader(
    "Grand Hall room-scale source XY review",
    "Room-scale direct projection of exact MatterPak source triangles, open edges, exhaustive shared vertices, and only scan candidates 0 through 49 whose diagnostic-identity centres fall inside the room bounds. No closure or inferred wall is present.",
    canvasBounds,
  )];
  renderRoomTriangles(chunks, geometry);
  chunks.push(`<path d="${edgesPath(geometry.model, geometry.room9Topology.boundaryEdges)}" fill="none" stroke="#f43f5e" stroke-width="0.018"/>`);
  geometry.interfaces.forEach((item, interfaceIndex) => {
    const color = INTERFACE_PALETTE[interfaceIndex % INTERFACE_PALETTE.length] ?? "#ffffff";
    for (const vertexIndex of item.sharedVertexIndices) {
      const point = geometry.model.vertices[vertexIndex];
      if (point === undefined) throw new Error("plan interface point is absent");
      chunks.push(`<circle cx="${formatNumber(point[0])}" cy="${formatNumber(-point[1])}" r="0.045" fill="${color}"/>`);
    }
  });
  const primaryCameraHits = roomScaleCandidateCameraHits(geometry, roomBounds);
  primaryCameraHits.forEach((hit) => {
    renderCameraCentre(chunks, hit, true);
  });

  const footerX = roomBounds.minX;
  const footerY = -roomBounds.minY + 0.3;
  const footerWidth = roomBounds.maxX - roomBounds.minX;
  chunks.push(`<rect x="${formatNumber(footerX - 0.12)}" y="${formatNumber(footerY - 0.18)}" width="${formatNumber(footerWidth + 0.24)}" height="2.86" rx="0.08" fill="#111923" stroke="#334155" stroke-width="0.012"/>`);
  chunks.push(`<text x="${formatNumber(footerX)}" y="${formatNumber(footerY + 0.08)}" fill="#f5d28b" font-family="sans-serif" font-weight="700" font-size="0.16">All ${String(geometry.interfaces.length)} shared-index interfaces — every disposition remains pending</text>`);
  geometry.interfaces.forEach((item, interfaceIndex) => {
    const color = INTERFACE_PALETTE[interfaceIndex % INTERFACE_PALETTE.length] ?? "#ffffff";
    const rowY = footerY + 0.38 + interfaceIndex * 0.235;
    chunks.push(`<circle cx="${formatNumber(footerX + 0.06)}" cy="${formatNumber(rowY - 0.045)}" r="0.055" fill="${color}"/>`);
    chunks.push(`<text x="${formatNumber(footerX + 0.19)}" y="${formatNumber(rowY)}" fill="#e2e8f0" font-family="monospace" font-size="0.13">${color} · ${item.interfaceId} · adjacent ${roomId(item.roomB)} · ${String(item.sharedVertexIndices.length)} shared vertices · PENDING</text>`);
  });
  chunks.push(`<text x="${formatNumber(footerX)}" y="${formatNumber(footerY + 2.41)}" fill="#cbd5e1" font-family="sans-serif" font-size="0.14">Gold room 9 · blue room 13 · violet room 14 · red open source edges · candidate centres rendered here: ${String(primaryCameraHits.length)}</text>`);
  chunks.push(`<text x="${formatNumber(footerX)}" y="${formatNumber(footerY + 2.64)}" fill="#f59e0b" font-family="sans-serif" font-size="0.14">Camera centres use diagnostic identity only; no reviewed E57→MatterPak transform exists. See separate all-centres overview.</text>`);
  chunks.push("</svg>\n");
  return chunks.join("\n");
}

function renderCameraOverviewSvg(geometry: BuiltGeometryEvidence): string {
  const bounds = planarBounds(geometry, true);
  const chunks = [svgHeader(
    "E57 camera-centre diagnostic overview",
    "All 149 source pose centres under the explicitly unreviewed diagnostic identity, with MatterPak rooms 9, 13, and 14 only as a scale reference. This is not a registration or transform artifact.",
    bounds,
  )];
  renderRoomTriangles(chunks, geometry);
  geometry.cameraHits.forEach((hit) => {
    renderCameraCentre(chunks, hit, hit.cameraIndex <= 49);
  });
  chunks.push(`<text x="${formatNumber(bounds.minX)}" y="${formatNumber(-bounds.minY + 0.45)}" fill="#f59e0b" font-family="sans-serif" font-weight="700" font-size="0.17">DIAGNOSTIC IDENTITY ONLY — ALL 149 CENTRES — NOT A REVIEWED E57→MATTERPAK REGISTRATION</text>`);
  chunks.push(`<text x="${formatNumber(bounds.minX)}" y="${formatNumber(-bounds.minY + 0.68)}" fill="#cbd5e1" font-family="sans-serif" font-size="0.14">Labels 0–49 mark the candidate scan range; rooms are direct source geometry and remain spatially unregistered to E57.</text>`);
  chunks.push("</svg>\n");
  return chunks.join("\n");
}

function segmentPath(segments: readonly SliceSegment[]): string {
  return segments.map((segment) =>
    `M${formatNumber(segment.a[0])},${formatNumber(-segment.a[1])}L${formatNumber(segment.b[0])},${formatNumber(-segment.b[1])}`,
  ).join("");
}

function renderSliceSvg(geometry: BuiltGeometryEvidence, slice: SliceEvidence): string {
  const bounds = planarBounds(geometry, false);
  const title = `Grand Hall exact source slice z=${slice.zM.toFixed(2)} m`;
  const chunks = [svgHeader(
    title,
    "Exact triangle-plane intersections from rooms 9, 13, and 14. Coplanar source triangles contribute their source edges. No contour repair or inferred geometry is present.",
    bounds,
  )];
  for (const room of slice.byRoom) {
    chunks.push(`<path d="${segmentPath(room.segments)}" fill="none" stroke="${roomColor(room.room)}" stroke-width="0.018"/>`);
  }
  chunks.push(`<text x="${formatNumber(bounds.minX)}" y="${formatNumber(-bounds.minY + 0.45)}" fill="#cbd5e1" font-family="sans-serif" font-size="0.17">Exact source intersection; epsilon ${SLICE_EPSILON_M.toExponential(0)} m. Empty regions remain empty.</text>`);
  chunks.push("</svg>\n");
  return chunks.join("\n");
}

function residualColor(value: number): string {
  const absolute = Math.abs(value);
  if (absolute <= 0.025) return "#22c55e";
  if (absolute <= 0.075) return "#f59e0b";
  return "#ef4444";
}

function renderInterfacePlaneFitSvg(diagnostic: InterfacePlaneFitDiagnostic): string {
  const padding = 0.35;
  const sourceMinU = diagnostic.projectedBounds.min[0] - padding;
  const sourceMaxU = diagnostic.projectedBounds.max[0] + padding;
  const horizontalCentre = (sourceMinU + sourceMaxU) / 2;
  const minimumCanvasWidth = 4.8;
  const minU = Math.min(sourceMinU, horizontalCentre - minimumCanvasWidth / 2);
  const maxU = Math.max(sourceMaxU, horizontalCentre + minimumCanvasWidth / 2);
  const minV = diagnostic.projectedBounds.min[1] - padding - 0.75;
  const maxV = diagnostic.projectedBounds.max[1] + padding + 0.9;
  const width = maxU - minU;
  const height = maxV - minV;
  const roomNumber = diagnostic.roomB.subIndex;
  const chunks = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(Math.max(1000, Math.ceil(width * 260)))}" height="${String(Math.max(1000, Math.ceil(height * 260)))}" viewBox="${formatNumber(minU)} ${formatNumber(-maxV)} ${formatNumber(width)} ${formatNumber(height)}" role="img" aria-labelledby="title desc">`,
    `<title id="title">Room 9 to room ${String(roomNumber)} shared-interface plane-fit review</title>`,
    `<desc id="desc">Raw shared vertices from one of the two largest source-topology interfaces projected into a deterministic PCA review plane, with convex hull and signed plane residual colours. This does not infer a portal, doorway, or closure plane.</desc>`,
    `<rect x="${formatNumber(minU)}" y="${formatNumber(-maxV)}" width="${formatNumber(width)}" height="${formatNumber(height)}" fill="#090d12"/>`,
    `<text x="${formatNumber(minU + 0.08)}" y="${formatNumber(-maxV + 0.28)}" fill="#f5d28b" font-family="sans-serif" font-size="0.13">Room 9 ↔ ${String(roomNumber)} shared-interface plane-fit diagnostic</text>`,
    `<text x="${formatNumber(minU + 0.08)}" y="${formatNumber(-maxV + 0.52)}" fill="#ef4444" font-family="sans-serif" font-weight="700" font-size="0.12">REVIEW ONLY — NO PORTAL OR DOORWAY INFERRED</text>`,
    `<text x="${formatNumber(minU + 0.08)}" y="${formatNumber(-maxV + 0.74)}" fill="#ef4444" font-family="sans-serif" font-weight="700" font-size="0.12">NOT ARCHITECTURE — NOT A CLOSURE</text>`,
    `<rect x="${formatNumber(diagnostic.projectedBounds.min[0])}" y="${formatNumber(-diagnostic.projectedBounds.max[1])}" width="${formatNumber(diagnostic.projectedBounds.max[0] - diagnostic.projectedBounds.min[0])}" height="${formatNumber(diagnostic.projectedBounds.max[1] - diagnostic.projectedBounds.min[1])}" fill="none" stroke="#f8fafc" stroke-width="0.012" stroke-dasharray="0.05 0.035"/>`,
  ];
  const hullPoints = diagnostic.hullVertexIndices.map((index) => {
    const point = diagnostic.projectedPoints.find((candidate) => candidate.vertexIndex === index);
    if (point === undefined) throw new Error("interface plane-fit hull references an absent projection");
    return `${formatNumber(point.u)},${formatNumber(-point.v)}`;
  }).join(" ");
  chunks.push(`<polygon points="${hullPoints}" fill="#38bdf8" fill-opacity="0.12" stroke="#38bdf8" stroke-width="0.018"/>`);
  for (const point of diagnostic.projectedPoints) {
    chunks.push(`<circle cx="${formatNumber(point.u)}" cy="${formatNumber(-point.v)}" r="0.032" fill="${residualColor(point.signedResidualM)}"/>`);
  }
  const residualBaseline = diagnostic.projectedBounds.min[1] - 0.35;
  chunks.push(`<line x1="${formatNumber(diagnostic.projectedBounds.min[0])}" y1="${formatNumber(-residualBaseline)}" x2="${formatNumber(diagnostic.projectedBounds.max[0])}" y2="${formatNumber(-residualBaseline)}" stroke="#94a3b8" stroke-width="0.008"/>`);
  for (const point of diagnostic.projectedPoints) {
    const residualEndpoint = residualBaseline + point.signedResidualM * 2;
    chunks.push(`<line x1="${formatNumber(point.u)}" y1="${formatNumber(-residualBaseline)}" x2="${formatNumber(point.u)}" y2="${formatNumber(-residualEndpoint)}" stroke="${residualColor(point.signedResidualM)}" stroke-width="0.01"/>`);
  }
  chunks.push(`<text x="${formatNumber(minU + 0.08)}" y="${formatNumber(-minV - 0.35)}" fill="#cbd5e1" font-family="monospace" font-size="0.13">shared ${String(diagnostic.projectedPoints.length)} · RMS ${(diagnostic.rmsResidualM * 1000).toFixed(1)} mm · max ${(diagnostic.maximumAbsoluteResidualM * 1000).toFixed(1)} mm</text>`);
  chunks.push(`<text x="${formatNumber(minU + 0.08)}" y="${formatNumber(-minV - 0.12)}" fill="#cbd5e1" font-family="monospace" font-size="0.085">green ≤25 mm · amber ≤75 mm · red &gt;75 mm · lower strokes show signed residual ×2</text>`);
  chunks.push("</svg>\n");
  return chunks.join("\n");
}

function outputRole(fileName: string): string {
  return fileName === "plan-xy.svg"
    ? "source_xy_plan_review"
    : fileName === "camera-overview-diagnostic.svg"
      ? "unregistered_all_camera_centres_diagnostic"
      : fileName.startsWith("slice-")
        ? "exact_source_triangle_plane_slice"
        : "review_only_shared_interface_plane_fit_diagnostic";
}

function outputRecord(fileName: string, content: string): JsonValue {
  const bytes = new TextEncoder().encode(content);
  return {
    relativePath: fileName,
    mediaType: "image/svg+xml",
    byteLength: bytes.byteLength,
    sha256: fileSha256(bytes),
    role: outputRole(fileName),
  };
}

function roomKeyValue(room: MatterportRoomKey): JsonValue {
  return { groupIndex: room.groupIndex, subIndex: room.subIndex };
}

function axisAlignedBoundsValue(bounds: AxisAlignedBounds3): JsonValue {
  return { min: [...bounds.min], max: [...bounds.max] };
}

function sourceIdentityValue(source: T554StableSourceIdentity): JsonValue {
  return {
    sourceLocator: source.sourceLocator,
    byteLength: source.byteLength,
    sha256: source.sha256,
  };
}

function interfaceManifestValue(item: InterfaceEvidence): JsonValue {
  return {
    interfaceId: item.interfaceId,
    roomA: roomKeyValue(item.roomA),
    roomB: roomKeyValue(item.roomB),
    candidateRole: item.candidateRole,
    reviewState: "pending",
    sharedVertexCount: item.sharedVertexIndices.length,
    sharedVertexIndices: item.sharedVertexIndices,
    sharedVertexIndicesSha256: item.sharedVertexIndicesSha256,
    sharedPositionsSha256: item.sharedPositionsSha256,
    boundsMeters: { min: item.bounds.min, max: item.bounds.max },
    room9BoundaryEdgeCount: item.room9BoundaryEdges.length,
    room9BoundaryEdgesSha256: item.room9BoundaryEdgesSha256,
    disposition: null,
  };
}

function interfacePlaneFitManifestValue(item: InterfacePlaneFitDiagnostic): JsonValue {
  return {
    interfaceId: item.interfaceId,
    state: "review_only_shared_interface_plane_fit",
    selectionBasis: "two_largest_interfaces_by_exact_shared_source_vertex_count_with_at_least_three_vertices",
    architecturalInference: "none",
    portalOrDoorwayInferred: false,
    method: {
      name: "deterministic_total_least_squares_shared_vertex_plane_v1",
      covariance: "population_covariance_sorted_source_vertex_indices",
      eigenSolver: "fixed_order_jacobi_64_iterations_or_1e-15_convergence",
      normalSign: "largest_absolute_component_positive",
      scalarQuantizationDecimalPlaces: FLOAT_QUANTIZATION_DECIMALS,
    },
    centroidMeters: item.centroid,
    normal: item.normal,
    basisU: item.basisU,
    basisV: item.basisV,
    planeOffset: item.planeOffset,
    eigenvaluesSquareM: item.eigenvalues,
    rmsResidualM: item.rmsResidualM,
    maximumAbsoluteResidualM: item.maximumAbsoluteResidualM,
    projectedBoundsMeters: item.projectedBounds,
    hullVertexIndices: item.hullVertexIndices,
    hullAreaSquareM: item.hullAreaSquareM,
    hullPerimeterM: item.hullPerimeterM,
    closureAuthored: false,
    keepSideChosen: false,
  };
}

function buildManifestMaterial(
  inputs: T554BoundaryReviewBuildInputs,
  geometry: BuiltGeometryEvidence,
  files: ReadonlyMap<string, string>,
): JsonValue {
  const edgeIncidence = new Map<number, number>();
  for (const item of geometry.room9Topology.uniqueEdges) {
    edgeIncidence.set(item.count, (edgeIncidence.get(item.count) ?? 0) + 1);
  }
  const componentKinds = { loop: 0, open: 0, branched: 0 };
  for (const component of geometry.room9Topology.boundaryComponents) componentKinds[component.kind] += 1;
  const cameraClassification = geometry.cameraHits.map((hit) => ({
    scanIndex: hit.cameraIndex,
    translation: hit.cameraTranslation,
    hitRoom: hit.state === "hit" ? { groupIndex: hit.group.groupIndex, subIndex: hit.group.subIndex } : null,
  }));
  const roomScaleBounds = planarBounds(geometry, false);
  const primaryPlanCameraHits = roomScaleCandidateCameraHits(geometry, roomScaleBounds);
  return {
    schemaVersion: GRAND_HALL_T554_BOUNDARY_REVIEW_PACK_SCHEMA,
    subject: {
      venueSlug: "trades-hall",
      roomSlug: "grand-hall",
      matterpakRoom: roomKeyValue(GRAND_HALL_ROOM_9),
    },
    lineage: {
      t551SourceReceiptSha256: T551_SOURCE_RECEIPT_SHA256,
      t551BoundaryEvidenceSha256: T551_EVIDENCE_SHA256,
      coordinateFrame: "MatterPak local; metres; right-handed; Z-up",
      e57ToMatterpakIdentityUse: "diagnostic_only_not_a_reviewed_transform_artifact",
    },
    sourceBindings: {
      obj: sourceIdentityValue(inputs.sources.obj),
      mtl: sourceIdentityValue(inputs.sources.mtl),
      colorPlan: sourceIdentityValue(inputs.sources.colorPlan),
      ceilingColorPlan: sourceIdentityValue(inputs.sources.ceilingColorPlan),
      posesRaw: sourceIdentityValue(inputs.sources.poses),
    },
    poseRawToCanonicalLineage: {
      rawSourceBinding: "sourceBindings.posesRaw",
      rawByteIdentityRequiredForRegeneration: true,
      parse: "strict_utf8_then_json_parse",
      schema: "149_contiguous_pose_keys_rotation4_translation3_finite_normalized_quaternions",
      canonicalizationMethod: "python_sort_keys_compact_separators_finite_float_repr_pose_schema_v1",
      canonicalSha256: inputs.poseCanonicalSha256,
      expectedCanonicalSha256: EXPECTED_POSE_CANONICAL_SHA256,
      disposition: "canonical_digest_proves_pose_value_equivalence_not_raw_byte_equivalence",
      stagedPoseFileDependency: false,
    },
    sourceTexturePolicy: {
      mode: "flat_geometry_only",
      sourceTextureBytesRead: false,
      sourceTextureBytesHashed: false,
      sourceTextureBytesDecoded: false,
      reason: "review visuals consume no texture bytes; the MTL binds names only",
      referencedMaterialNamesByRoom: geometry.materialRefsByRoom.map((item) => ({
        room: roomKeyValue(item.room),
        materialNames: item.materialNames,
      })),
    },
    geometryMethod: {
      objSelection: "exact MatterPak group key; original triangular faces only",
      plan: "room-scale direct XY projection of source triangle edges with exhaustive interface legend",
      cameraOverview: "separate all-centres diagnostic under unreviewed E57-to-MatterPak identity",
      slices: {
        method: "exact_source_triangle_plane_intersection_v1",
        zMeters: SLICE_HEIGHTS_M,
        epsilonM: SLICE_EPSILON_M,
        coplanarDisposition: "emit_all_three_source_triangle_edges",
      },
      generatedGeometryUsed: false,
    },
    room9Topology: {
      faceCount: geometry.rooms[0]?.triangles.length ?? 0,
      faceOrdinalsSha256: geometry.room9Topology.faceOrdinalsSha256,
      uniqueUndirectedEdgeCount: geometry.room9Topology.uniqueEdges.length,
      edgeIncidenceCounts: Object.fromEntries([...edgeIncidence.entries()].sort((a, b) => a[0] - b[0]).map(([count, total]) => [String(count), total])),
      boundaryEdgeCount: geometry.room9Topology.boundaryEdges.length,
      boundaryEdgesSha256: geometry.room9Topology.boundaryEdgesSha256,
      boundaryVertexCount: geometry.room9Topology.boundaryVertexCount,
      boundaryComponentCount: geometry.room9Topology.boundaryComponents.length,
      boundaryComponentKinds: componentKinds,
      watertight: false,
      closedVolumeClaim: false,
    },
    exhaustiveSharedInterfaces: {
      method: "intersect sorted source OBJ vertex-index sets with every other MatterPak room key",
      interfaceCount: geometry.interfaces.length,
      allInterfacesResolved: false,
      interfaces: geometry.interfaces.map(interfaceManifestValue),
    },
    sharedInterfacePlaneFitDiagnostics: geometry.interfacePlaneFitDiagnostics.map(interfacePlaneFitManifestValue),
    cameraCentres: {
      source: "retained E57_SOURCE_ROOT/poses.json raw byte identity plus canonical pose-value identity",
      count: geometry.cameras.length,
      primaryRoomScalePlan: {
        candidateScanIndexRange: { minimum: 0, maximum: 49 },
        inclusionPolicy: "diagnostic_identity_centre_inside_exact_rooms_9_13_14_xy_bounds",
        renderedCount: primaryPlanCameraHits.length,
        renderedScanIndices: primaryPlanCameraHits.map((hit) => hit.cameraIndex),
      },
      diagnosticOverview: {
        renderedCount: geometry.cameraHits.length,
        labelsRenderedForScanIndices: { minimum: 0, maximum: 49 },
        registrationState: "unreviewed_diagnostic_identity_only",
      },
      classification: "T-551 deterministic vertical first-hit diagnostic",
      classificationSha256: canonicalDigest(
        `${GRAND_HALL_T554_BOUNDARY_REVIEW_PACK_DOMAIN}.camera-classification`,
        cameraClassification,
      ),
    },
    sliceDiagnostics: geometry.slices.map((slice) => ({
      zM: slice.zM,
      rooms: slice.byRoom.map((room) => ({
        room: roomKeyValue(room.room),
        segmentCount: room.segments.length,
        segmentsSha256: room.segmentsSha256,
      })),
    })),
    outputs: OUTPUT_FILE_NAMES.map((fileName) => {
      const content = files.get(fileName);
      if (content === undefined) throw new Error("review output is absent from the deterministic build");
      return outputRecord(fileName, content);
    }),
    authority: {
      state: "none",
      reviewState: "human_pending",
      room9IdentityAccepted: false,
      allInterfacesResolved: false,
      nonConvexBoundaryAuthored: false,
      portalClosureAuthored: false,
      closedVolumeAuthored: false,
      transformAuthorityGranted: false,
      pointMaskAuthored: false,
      trainingAuthority: false,
      runtimeAuthority: false,
      structuralAuthority: false,
      generatedFillPermitted: false,
    },
  };
}

export function buildT554BoundaryReviewPack(inputs: T554BoundaryReviewBuildInputs): T554BoundaryReviewPack {
  const geometry = buildGeometry(inputs);
  const files = new Map<string, string>();
  files.set("plan-xy.svg", renderPlanSvg(geometry));
  files.set("camera-overview-diagnostic.svg", renderCameraOverviewSvg(geometry));
  for (const slice of geometry.slices) {
    files.set(`slice-z-${slice.zM.toFixed(2)}m.svg`, renderSliceSvg(geometry, slice));
  }
  for (const diagnostic of geometry.interfacePlaneFitDiagnostics) {
    files.set(
      `interface-plane-fit-room9-room${String(diagnostic.roomB.subIndex)}.svg`,
      renderInterfacePlaneFitSvg(diagnostic),
    );
  }
  if (
    files.size !== OUTPUT_FILE_NAMES.length ||
    OUTPUT_FILE_NAMES.some((fileName) => !files.has(fileName))
  ) {
    throw new Error("deterministic review output inventory is incomplete");
  }
  for (const svg of files.values()) verifyT554SvgSafety(svg);
  const material = buildManifestMaterial(inputs, geometry, files);
  const manifestSha256 = canonicalDigest(GRAND_HALL_T554_BOUNDARY_REVIEW_PACK_DOMAIN, material);
  if (material === null || Array.isArray(material) || typeof material !== "object") {
    throw new Error("review manifest material must be an object");
  }
  return {
    manifest: Object.assign({}, material, { manifestSha256 }),
    manifestSha256,
    files,
  };
}

function manifestBytes(pack: T554BoundaryReviewPack): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(pack.manifest, null, 2)}\n`);
}

function assertNoAbsolutePaths(value: string): void {
  if (/[A-Za-z]:[\\/]/u.test(value) || /file:\/\//iu.test(value) || /(?:^|[\\/])Users[\\/]/iu.test(value)) {
    throw new Error("review artifact contains an operator path");
  }
}

interface ValidatedBoundaryInterface {
  readonly interfaceId: string;
  readonly roomB: MatterportRoomKey;
  readonly sharedVertexIndices: readonly number[];
  readonly sharedPositionsSha256: Sha256;
  readonly boundsMeters: AxisAlignedBounds3;
  readonly room9BoundaryEdgeCount: number;
  readonly room9BoundaryEdgesSha256: Sha256;
}

function validatePersistedSourceBindings(value: unknown): void {
  const sourceBindings = requireRecord(value, "review source bindings");
  requireExactKeys(
    sourceBindings,
    ["obj", "mtl", "colorPlan", "ceilingColorPlan", "posesRaw"],
    "review source bindings",
  );
  const bindings = [
    ["obj", EXPECTED_SOURCE_FILES.obj],
    ["mtl", EXPECTED_SOURCE_FILES.mtl],
    ["colorPlan", EXPECTED_SOURCE_FILES.colorPlan],
    ["ceilingColorPlan", EXPECTED_SOURCE_FILES.ceilingColorPlan],
    ["posesRaw", EXPECTED_SOURCE_FILES.poses],
  ] as const;
  for (const [key, expected] of bindings) {
    const binding = requireRecord(sourceBindings[key], `${key} source binding`);
    requireExactKeys(binding, ["sourceLocator", "byteLength", "sha256"], `${key} source binding`);
    const exact: JsonValue = {
      sourceLocator: expected.sourceLocator,
      byteLength: expected.byteLength,
      sha256: expected.sha256,
    };
    if (stableCanonicalJson(binding as JsonValue) !== stableCanonicalJson(exact)) {
      throw new Error(`${key} source binding differs from the exact retained source receipt`);
    }
  }
}

function validatePersistedInterfaces(value: unknown): readonly ValidatedBoundaryInterface[] {
  const exhaustive = requireRecord(value, "shared interfaces");
  requireExactKeys(
    exhaustive,
    ["method", "interfaceCount", "allInterfacesResolved", "interfaces"],
    "shared interfaces",
  );
  if (
    exhaustive.method !== "intersect sorted source OBJ vertex-index sets with every other MatterPak room key" ||
    exhaustive.interfaceCount !== GRAND_HALL_T554_INTERFACE_DEFINITIONS.length ||
    exhaustive.allInterfacesResolved !== false
  ) {
    throw new Error("review manifest overstates or changes exhaustive interface discovery");
  }
  const interfaces = requireArray(exhaustive.interfaces, "shared interface inventory");
  if (interfaces.length !== GRAND_HALL_T554_INTERFACE_DEFINITIONS.length) {
    throw new Error("review manifest omitted or added a shared interface");
  }
  return interfaces.map((value, index) => {
    const definition = GRAND_HALL_T554_INTERFACE_DEFINITIONS[index];
    if (definition === undefined) throw new Error("shared interface definition inventory drifted");
    const item = requireRecord(value, `interface ${String(index)}`);
    requireExactKeys(item, [
      "interfaceId", "roomA", "roomB", "candidateRole", "reviewState", "sharedVertexCount",
      "sharedVertexIndices", "sharedVertexIndicesSha256", "sharedPositionsSha256", "boundsMeters",
      "room9BoundaryEdgeCount", "room9BoundaryEdgesSha256", "disposition",
    ], `interface ${String(index)}`);
    if (
      item.interfaceId !== definition.interfaceId ||
      item.candidateRole !== "shared_topology_unresolved" ||
      item.reviewState !== "pending" ||
      item.disposition !== null
    ) {
      throw new Error(`interface ${String(index)} identity, role, or pending disposition drifted`);
    }
    requireExactRoom(item.roomA, GRAND_HALL_ROOM_9, `interface ${String(index)} room A`);
    requireExactRoom(item.roomB, definition.roomB, `interface ${String(index)} room B`);
    const sharedVertexIndices = requireArray(
      item.sharedVertexIndices,
      `interface ${String(index)} shared vertex indices`,
    ).map((entry, vertexIndex) =>
      requireSafeInteger(entry, `interface ${String(index)} shared vertex ${String(vertexIndex)}`),
    );
    if (
      sharedVertexIndices.length === 0 ||
      sharedVertexIndices.some((entry, vertexIndex) =>
        vertexIndex > 0 && entry <= (sharedVertexIndices[vertexIndex - 1] ?? -1),
      ) ||
      item.sharedVertexCount !== sharedVertexIndices.length
    ) {
      throw new Error(`interface ${String(index)} shared vertex inventory drifted`);
    }
    const expectedIndicesSha256 = canonicalDigest(
      `${GRAND_HALL_T554_BOUNDARY_REVIEW_PACK_DOMAIN}.interface-indices.${roomId(definition.roomB)}`,
      sharedVertexIndices,
    );
    if (requireSha256(item.sharedVertexIndicesSha256, `interface ${String(index)} index digest`) !== expectedIndicesSha256) {
      throw new Error(`interface ${String(index)} shared vertex digest differs`);
    }
    const sharedPositionsSha256 = requireSha256(
      item.sharedPositionsSha256,
      `interface ${String(index)} position digest`,
    );
    const room9BoundaryEdgeCount = requireSafeInteger(
      item.room9BoundaryEdgeCount,
      `interface ${String(index)} room9 boundary edge count`,
    );
    const room9BoundaryEdgesSha256 = requireSha256(
      item.room9BoundaryEdgesSha256,
      `interface ${String(index)} room9 boundary edge digest`,
    );
    return {
      interfaceId: definition.interfaceId,
      roomB: definition.roomB,
      sharedVertexIndices,
      sharedPositionsSha256,
      boundsMeters: requireFiniteBounds(item.boundsMeters, `interface ${String(index)} bounds`),
      room9BoundaryEdgeCount,
      room9BoundaryEdgesSha256,
    };
  });
}

function validatePersistedPlaneFits(
  value: unknown,
  interfaces: readonly ValidatedBoundaryInterface[],
): void {
  const planeFits = requireArray(value, "shared-interface plane-fit diagnostics");
  if (planeFits.length !== 2) {
    throw new Error("review manifest must contain two shared-interface plane-fit diagnostics");
  }
  const expectedInterfaceIds = [...interfaces]
    .filter((item) => item.sharedVertexIndices.length >= 3)
    .sort((left, right) =>
      right.sharedVertexIndices.length - left.sharedVertexIndices.length ||
      left.interfaceId.localeCompare(right.interfaceId),
    )
    .slice(0, 2)
    .map((item) => item.interfaceId);
  const expectedMethod: JsonValue = {
    name: "deterministic_total_least_squares_shared_vertex_plane_v1",
    covariance: "population_covariance_sorted_source_vertex_indices",
    eigenSolver: "fixed_order_jacobi_64_iterations_or_1e-15_convergence",
    normalSign: "largest_absolute_component_positive",
    scalarQuantizationDecimalPlaces: FLOAT_QUANTIZATION_DECIMALS,
  };
  planeFits.forEach((value, index) => {
    const item = requireRecord(value, `shared-interface plane-fit diagnostic ${String(index)}`);
    requireExactKeys(item, [
      "interfaceId", "state", "selectionBasis", "architecturalInference", "portalOrDoorwayInferred",
      "method", "centroidMeters", "normal", "basisU", "basisV", "planeOffset", "eigenvaluesSquareM",
      "rmsResidualM", "maximumAbsoluteResidualM", "projectedBoundsMeters", "hullVertexIndices",
      "hullAreaSquareM", "hullPerimeterM", "closureAuthored", "keepSideChosen",
    ], `shared-interface plane-fit diagnostic ${String(index)}`);
    if (
      item.interfaceId !== expectedInterfaceIds[index] ||
      item.state !== "review_only_shared_interface_plane_fit" ||
      item.selectionBasis !== "two_largest_interfaces_by_exact_shared_source_vertex_count_with_at_least_three_vertices" ||
      item.architecturalInference !== "none" ||
      item.portalOrDoorwayInferred !== false ||
      item.closureAuthored !== false ||
      item.keepSideChosen !== false
    ) {
      throw new Error("shared-interface plane-fit selection or authority claim drifted");
    }
    const method = requireRecord(item.method, `shared-interface plane-fit diagnostic ${String(index)} method`);
    if (stableCanonicalJson(method as JsonValue) !== stableCanonicalJson(expectedMethod)) {
      throw new Error("shared-interface plane-fit method drifted");
    }
    finiteVector(item.centroidMeters, 3, `shared-interface plane-fit diagnostic ${String(index)} centroid`);
    finiteVector(item.normal, 3, `shared-interface plane-fit diagnostic ${String(index)} normal`);
    finiteVector(item.basisU, 3, `shared-interface plane-fit diagnostic ${String(index)} basis U`);
    finiteVector(item.basisV, 3, `shared-interface plane-fit diagnostic ${String(index)} basis V`);
    finiteVector(item.eigenvaluesSquareM, 3, `shared-interface plane-fit diagnostic ${String(index)} eigenvalues`);
    requireFiniteNumber(item.planeOffset, `shared-interface plane-fit diagnostic ${String(index)} offset`);
    for (const [field, label] of [
      ["rmsResidualM", "RMS residual"],
      ["maximumAbsoluteResidualM", "maximum residual"],
      ["hullAreaSquareM", "hull area"],
      ["hullPerimeterM", "hull perimeter"],
    ] as const) {
      if (requireFiniteNumber(item[field], `shared-interface plane-fit diagnostic ${String(index)} ${label}`) < 0) {
        throw new Error(`shared-interface plane-fit diagnostic ${String(index)} ${label} cannot be negative`);
      }
    }
    const projectedBounds = requireRecord(
      item.projectedBoundsMeters,
      `shared-interface plane-fit diagnostic ${String(index)} projected bounds`,
    );
    requireExactKeys(projectedBounds, ["min", "max"], `shared-interface plane-fit diagnostic ${String(index)} projected bounds`);
    const projectedMinimum = finiteVector(
      projectedBounds.min,
      2,
      `shared-interface plane-fit diagnostic ${String(index)} projected minimum`,
    );
    const projectedMaximum = finiteVector(
      projectedBounds.max,
      2,
      `shared-interface plane-fit diagnostic ${String(index)} projected maximum`,
    );
    if (projectedMinimum.some((coordinate, axis) => coordinate > (projectedMaximum[axis] ?? Number.NEGATIVE_INFINITY))) {
      throw new Error(`shared-interface plane-fit diagnostic ${String(index)} projected bounds are inverted`);
    }
    const selectedInterface = interfaces.find((candidate) => candidate.interfaceId === item.interfaceId);
    if (selectedInterface === undefined) throw new Error("shared-interface plane-fit references an absent interface");
    const shared = new Set(selectedInterface.sharedVertexIndices);
    const hull = requireArray(
      item.hullVertexIndices,
      `shared-interface plane-fit diagnostic ${String(index)} hull`,
    ).map((entry, hullIndex) =>
      requireSafeInteger(entry, `shared-interface plane-fit diagnostic ${String(index)} hull ${String(hullIndex)}`),
    );
    if (hull.length < 3 || new Set(hull).size !== hull.length || hull.some((entry) => !shared.has(entry))) {
      throw new Error(`shared-interface plane-fit diagnostic ${String(index)} hull inventory drifted`);
    }
  });
}

function validatePersistedOutputs(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  const outputs = requireArray(value, "review output inventory");
  if (outputs.length !== OUTPUT_FILE_NAMES.length) {
    throw new Error("review manifest output inventory is incomplete");
  }
  return outputs.map((value, index) => {
    const expectedName = OUTPUT_FILE_NAMES[index];
    if (expectedName === undefined) throw new Error("review output definition inventory drifted");
    const record = requireRecord(value, `review output ${String(index)}`);
    requireExactKeys(record, ["relativePath", "mediaType", "byteLength", "sha256", "role"], `review output ${String(index)}`);
    if (
      record.relativePath !== expectedName ||
      record.mediaType !== "image/svg+xml" ||
      record.role !== outputRole(expectedName) ||
      requireSafeInteger(record.byteLength, `review output ${String(index)} byte length`) === 0
    ) {
      throw new Error(`review output ${String(index)} identity, order, or role drifted`);
    }
    requireSha256(record.sha256, `review output ${String(index)} digest`);
    return record;
  });
}

function parseManifest(bytes: Uint8Array): Readonly<Record<string, unknown>> {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("review manifest is not strict UTF-8");
  }
  if (text.charCodeAt(0) === 0xfeff) throw new Error("review manifest cannot contain a BOM");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("review manifest is not JSON");
  }
  const manifest = requireRecord(parsed, "review manifest");
  requireExactKeys(manifest, [
    "schemaVersion", "subject", "lineage", "sourceBindings", "poseRawToCanonicalLineage",
    "sourceTexturePolicy", "geometryMethod", "room9Topology", "exhaustiveSharedInterfaces",
    "sharedInterfacePlaneFitDiagnostics", "cameraCentres", "sliceDiagnostics", "outputs", "authority",
    "manifestSha256",
  ], "review manifest");
  if (manifest.schemaVersion !== GRAND_HALL_T554_BOUNDARY_REVIEW_PACK_SCHEMA) {
    throw new Error("unsupported review manifest schema");
  }
  const manifestSha256 = requireSha256(manifest.manifestSha256, "review manifest digest");
  const material: Record<string, unknown> = { ...manifest };
  delete material.manifestSha256;
  const canonical = material as JsonValue;
  if (canonicalDigest(GRAND_HALL_T554_BOUNDARY_REVIEW_PACK_DOMAIN, canonical) !== manifestSha256) {
    throw new Error("review manifest canonical digest differs");
  }
  assertNoAbsolutePaths(JSON.stringify(manifest));
  const expectedSubject: JsonValue = {
    venueSlug: "trades-hall",
    roomSlug: "grand-hall",
    matterpakRoom: roomKeyValue(GRAND_HALL_ROOM_9),
  };
  if (stableCanonicalJson(requireRecord(manifest.subject, "review subject") as JsonValue) !== stableCanonicalJson(expectedSubject)) {
    throw new Error("review subject drifted");
  }
  const expectedLineage: JsonValue = {
    t551SourceReceiptSha256: T551_SOURCE_RECEIPT_SHA256,
    t551BoundaryEvidenceSha256: T551_EVIDENCE_SHA256,
    coordinateFrame: "MatterPak local; metres; right-handed; Z-up",
    e57ToMatterpakIdentityUse: "diagnostic_only_not_a_reviewed_transform_artifact",
  };
  if (stableCanonicalJson(requireRecord(manifest.lineage, "review lineage") as JsonValue) !== stableCanonicalJson(expectedLineage)) {
    throw new Error("review lineage drifted");
  }
  validatePersistedSourceBindings(manifest.sourceBindings);
  const poseLineage = requireRecord(manifest.poseRawToCanonicalLineage, "raw-to-canonical pose lineage");
  const expectedPoseLineage: JsonValue = {
    rawSourceBinding: "sourceBindings.posesRaw",
    rawByteIdentityRequiredForRegeneration: true,
    parse: "strict_utf8_then_json_parse",
    schema: "149_contiguous_pose_keys_rotation4_translation3_finite_normalized_quaternions",
    canonicalizationMethod: "python_sort_keys_compact_separators_finite_float_repr_pose_schema_v1",
    canonicalSha256: EXPECTED_POSE_CANONICAL_SHA256,
    expectedCanonicalSha256: EXPECTED_POSE_CANONICAL_SHA256,
    disposition: "canonical_digest_proves_pose_value_equivalence_not_raw_byte_equivalence",
    stagedPoseFileDependency: false,
  };
  if (stableCanonicalJson(poseLineage as JsonValue) !== stableCanonicalJson(expectedPoseLineage)) {
    throw new Error("retained raw pose binding or canonical pose lineage drifted");
  }
  const authority = requireRecord(manifest.authority, "review authority");
  const expectedAuthority: JsonValue = {
    state: "none",
    reviewState: "human_pending",
    room9IdentityAccepted: false,
    allInterfacesResolved: false,
    nonConvexBoundaryAuthored: false,
    portalClosureAuthored: false,
    closedVolumeAuthored: false,
    transformAuthorityGranted: false,
    pointMaskAuthored: false,
    trainingAuthority: false,
    runtimeAuthority: false,
    structuralAuthority: false,
    generatedFillPermitted: false,
  };
  if (stableCanonicalJson(authority as JsonValue) !== stableCanonicalJson(expectedAuthority)) {
    throw new Error("review manifest escaped its authority-none boundary");
  }
  const interfaces = validatePersistedInterfaces(manifest.exhaustiveSharedInterfaces);
  validatePersistedPlaneFits(manifest.sharedInterfacePlaneFitDiagnostics, interfaces);
  const cameraCentres = requireRecord(manifest.cameraCentres, "camera centres");
  requireExactKeys(cameraCentres, [
    "source", "count", "primaryRoomScalePlan", "diagnosticOverview", "classification", "classificationSha256",
  ], "camera centres");
  const primaryPlan = requireRecord(cameraCentres.primaryRoomScalePlan, "primary room-scale camera plan");
  requireExactKeys(primaryPlan, [
    "candidateScanIndexRange", "inclusionPolicy", "renderedCount", "renderedScanIndices",
  ], "primary room-scale camera plan");
  const overview = requireRecord(cameraCentres.diagnosticOverview, "camera diagnostic overview");
  requireExactKeys(overview, ["renderedCount", "labelsRenderedForScanIndices", "registrationState"], "camera diagnostic overview");
  const candidateRange = requireRecord(primaryPlan.candidateScanIndexRange, "primary camera candidate range");
  requireExactKeys(candidateRange, ["minimum", "maximum"], "primary camera candidate range");
  const labelRange = requireRecord(overview.labelsRenderedForScanIndices, "camera label range");
  requireExactKeys(labelRange, ["minimum", "maximum"], "camera label range");
  const renderedScanIndices = requireArray(primaryPlan.renderedScanIndices, "primary rendered scan indices").map(
    (entry, index) => requireSafeInteger(entry, `primary rendered scan index ${String(index)}`),
  );
  if (
    cameraCentres.source !== "retained E57_SOURCE_ROOT/poses.json raw byte identity plus canonical pose-value identity" ||
    cameraCentres.count !== 149 ||
    cameraCentres.classification !== "T-551 deterministic vertical first-hit diagnostic" ||
    candidateRange.minimum !== 0 ||
    candidateRange.maximum !== 49 ||
    primaryPlan.inclusionPolicy !== "diagnostic_identity_centre_inside_exact_rooms_9_13_14_xy_bounds" ||
    primaryPlan.renderedCount !== renderedScanIndices.length ||
    renderedScanIndices.some((entry, index) => entry >= 149 || index > 0 && entry <= (renderedScanIndices[index - 1] ?? -1)) ||
    overview.renderedCount !== 149 ||
    labelRange.minimum !== 0 ||
    labelRange.maximum !== 49 ||
    overview.registrationState !== "unreviewed_diagnostic_identity_only"
  ) {
    throw new Error("camera-centre review inventory or registration disclaimer drifted");
  }
  requireSha256(cameraCentres.classificationSha256, "camera classification digest");
  validatePersistedOutputs(manifest.outputs);
  return manifest;
}

function crossBindBoundaryManifestToInterfaceAtlas(
  manifest: Readonly<Record<string, unknown>>,
  atlas: ReturnType<typeof verifyPersistedT554InterfaceAtlasEvidence>,
): void {
  const manifestSha256 = requireSha256(manifest.manifestSha256, "review manifest digest");
  if (atlas.boundaryReviewManifestSha256 !== manifestSha256) {
    throw new Error("interface atlas does not bind the exact boundary review manifest");
  }
  const sourceBindings = requireRecord(manifest.sourceBindings, "review source bindings");
  const obj = requireRecord(sourceBindings.obj, "boundary OBJ binding");
  if (stableCanonicalJson(obj as JsonValue) !== stableCanonicalJson(atlas.obj as JsonValue)) {
    throw new Error("boundary and interface atlas OBJ source receipts differ");
  }
  const interfaces = validatePersistedInterfaces(manifest.exhaustiveSharedInterfaces);
  if (interfaces.length !== atlas.interfaces.length) {
    throw new Error("boundary and interface atlas inventories differ");
  }
  interfaces.forEach((item, index) => {
    const atlasItem = atlas.interfaces[index];
    if (atlasItem === undefined) throw new Error("interface atlas summary inventory drifted");
    const atlasIndices = atlasItem.sharedVertices.map((vertex) => vertex.index);
    const boundaryPositionDigest = canonicalDigest(
      `${GRAND_HALL_T554_BOUNDARY_REVIEW_PACK_DOMAIN}.interface-positions.${roomId(item.roomB)}`,
      atlasItem.sharedVertices.map((vertex) => [vertex.index, ...vertex.position]),
    );
    const boundaryEdgeDigest = canonicalDigest(
      `${GRAND_HALL_T554_BOUNDARY_REVIEW_PACK_DOMAIN}.interface-boundary-edges.${roomId(item.roomB)}`,
      atlasItem.room9BoundaryEdges,
    );
    if (
      item.interfaceId !== atlasItem.interfaceId ||
      atlasItem.roomA.groupIndex !== GRAND_HALL_ROOM_9.groupIndex ||
      atlasItem.roomA.subIndex !== GRAND_HALL_ROOM_9.subIndex ||
      item.roomB.groupIndex !== atlasItem.roomB.groupIndex ||
      item.roomB.subIndex !== atlasItem.roomB.subIndex ||
      stableCanonicalJson(item.sharedVertexIndices) !== stableCanonicalJson(atlasIndices) ||
      item.sharedPositionsSha256 !== boundaryPositionDigest ||
      stableCanonicalJson(axisAlignedBoundsValue(item.boundsMeters)) !==
        stableCanonicalJson(axisAlignedBoundsValue(atlasItem.sharedBoundsMeters)) ||
      item.room9BoundaryEdgeCount !== atlasItem.room9BoundaryEdges.length ||
      item.room9BoundaryEdgeCount !== atlasItem.room9BoundaryEdgeCount ||
      item.room9BoundaryEdgesSha256 !== boundaryEdgeDigest
    ) {
      throw new Error(`boundary interface ${item.interfaceId} differs from exact interface-atlas source evidence`);
    }
  });
}

function safeExistingOutputFile(outputDirectory: string, fileName: string): string {
  if (!/^[a-z0-9.-]+$/u.test(fileName) || fileName.includes("..")) throw new Error("review output filename is unsafe");
  const path = resolve(outputDirectory, fileName);
  if (dirname(path) !== resolve(outputDirectory)) throw new Error("review output escapes its directory");
  const direct = lstatSync(path, { bigint: true });
  if (direct.isSymbolicLink()) throw new Error("review output cannot be a link");
  if (direct.nlink !== 1n) throw new Error("review output must have exactly one hard link");
  const canonical = realpathSync(path);
  const canonicalStats = statSync(canonical, { bigint: true });
  if (!canonicalStats.isFile()) throw new Error("review output is not a regular file");
  if (canonicalStats.nlink !== 1n) throw new Error("review output must have exactly one hard link");
  return canonical;
}

function readStableExistingOutputFile(
  outputDirectory: string,
  fileName: string,
  maximumByteLength: number,
): Buffer {
  const directPath = resolve(outputDirectory, fileName);
  const canonicalBefore = safeExistingOutputFile(outputDirectory, fileName);
  const descriptor = openSync(canonicalBefore, "r");
  try {
    const before = descriptorIdentity(descriptor);
    const pathBefore = pathIdentity(canonicalBefore);
    const byteLength = Number(before.size);
    if (
      !sameFileIdentity(before, pathBefore) ||
      before.links !== 1n ||
      !Number.isSafeInteger(byteLength) ||
      byteLength < 1 ||
      byteLength > maximumByteLength
    ) {
      throw new Error("review output failed its bounded stable-read precondition");
    }
    const bytes = readFileSync(descriptor);
    const after = descriptorIdentity(descriptor);
    const canonicalAfter = safeExistingOutputFile(outputDirectory, fileName);
    const pathAfter = pathIdentity(canonicalAfter);
    if (
      bytes.byteLength !== byteLength ||
      canonicalAfter !== canonicalBefore ||
      realpathSync(directPath) !== canonicalBefore ||
      !sameFileIdentity(before, after) ||
      !sameFileIdentity(after, pathAfter) ||
      after.links !== 1n
    ) {
      throw new Error("review output changed during its stable read");
    }
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

export function verifyPersistedT554BoundaryReviewPack(outputDirectory: string): Sha256 {
  if (!isAbsolute(outputDirectory)) throw new Error("review output directory must be absolute");
  if (lstatSync(outputDirectory).isSymbolicLink()) throw new Error("review output directory cannot be a link");
  const root = realpathSync(outputDirectory);
  if (!statSync(root).isDirectory()) throw new Error("review output must be a directory");
  const names = readdirSync(root).sort((a, b) => a.localeCompare(b));
  const expectedNames = [
    ...OUTPUT_FILE_NAMES,
    "manifest.json",
    INTERFACE_ATLAS_DIRECTORY_NAME,
  ].sort((a, b) => a.localeCompare(b));
  if (JSON.stringify(names) !== JSON.stringify(expectedNames)) throw new Error("review output inventory drifted");
  const manifest = parseManifest(
    readStableExistingOutputFile(root, "manifest.json", MAX_BOUNDARY_MANIFEST_BYTES),
  );
  const outputs = manifest.outputs;
  if (!Array.isArray(outputs) || outputs.length !== OUTPUT_FILE_NAMES.length) {
    throw new Error("review manifest output inventory is incomplete");
  }
  for (const value of outputs) {
    const record = requireRecord(value, "review output record");
    if (
      typeof record.relativePath !== "string" ||
      typeof record.byteLength !== "number" ||
      typeof record.sha256 !== "string"
    ) {
      throw new Error("review output record is malformed");
    }
    const bytes = readStableExistingOutputFile(root, record.relativePath, MAX_BOUNDARY_SVG_BYTES);
    if (bytes.byteLength !== record.byteLength || fileSha256(bytes) !== record.sha256) {
      throw new Error("review output bytes drifted from the manifest");
    }
    const svg = new TextDecoder().decode(bytes);
    verifyT554SvgSafety(svg);
  }
  const atlas = verifyPersistedT554InterfaceAtlasEvidence(
    resolve(root, INTERFACE_ATLAS_DIRECTORY_NAME),
  );
  crossBindBoundaryManifestToInterfaceAtlas(manifest, atlas);
  return manifest.manifestSha256 as Sha256;
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

function assertNoSymlinkAncestors(path: string): void {
  if (!isAbsolute(path)) throw new Error("output path must be absolute");
  let current = resolve(path);
  const pending: string[] = [];
  while (!existsSync(current)) {
    pending.push(basename(current));
    const parent = dirname(current);
    if (parent === current) throw new Error("output path has no existing ancestor");
    current = parent;
  }
  if (lstatSync(current).isSymbolicLink()) throw new Error("output ancestor cannot be a link");
  while (pending.length > 0) {
    const next = pending.pop();
    if (next === undefined) break;
    current = resolve(current, next);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error("output path traverses a link");
    }
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

export function writeT554BoundaryReviewPack(options: T554BoundaryReviewWriteOptions): Sha256 {
  if (!isAbsolute(options.outputDirectory)) throw new Error("review output directory must be absolute");
  const output = resolve(options.outputDirectory);
  if (existsSync(output)) throw new Error("review output already exists");
  const matterpakRoot = validatedMatterpakRoot(options.matterpakSourceRoot);
  const poseFile = safeDirectSourceFile(options.posesJsonPath, EXPECTED_SOURCE_FILES.poses);
  if (pathsOverlap(matterpakRoot, output) || pathsOverlap(poseFile, output)) {
    throw new Error("review output overlaps an immutable source");
  }
  assertNoSymlinkAncestors(output);
  const inputs = loadT554BoundaryReviewInputsFromFiles(options);
  const pack = buildT554BoundaryReviewPack(inputs);
  const parent = dirname(output);
  mkdirSync(parent, { recursive: true });
  assertNoSymlinkAncestors(parent);
  const stage = resolve(parent, `.${basename(output)}.stage-${String(process.pid)}-${randomUUID()}`);
  if (pathsOverlap(stage, matterpakRoot) || pathsOverlap(stage, poseFile) || existsSync(stage)) {
    throw new Error("review staging path is unsafe");
  }
  mkdirSync(stage);
  try {
    for (const fileName of OUTPUT_FILE_NAMES) {
      const content = pack.files.get(fileName);
      if (content === undefined) throw new Error("review output is missing during write");
      writeExclusive(resolve(stage, fileName), new TextEncoder().encode(content));
    }
    writeExclusive(resolve(stage, "manifest.json"), manifestBytes(pack));
    writeT554InterfaceAtlas({
      matterpakSourceRoot: options.matterpakSourceRoot,
      outputDirectory: resolve(stage, INTERFACE_ATLAS_DIRECTORY_NAME),
    });
    verifyPersistedT554BoundaryReviewPack(stage);
    if (existsSync(output)) throw new Error("review output appeared before atomic publish");
    renameSync(stage, output);
    const persisted = verifyPersistedT554BoundaryReviewPack(output);
    if (persisted !== pack.manifestSha256) throw new Error("persisted review digest differs");
    return persisted;
  } catch (error) {
    if (existsSync(stage)) rmSync(stage, { recursive: true, force: true });
    throw error;
  }
}

export function checkT554BoundaryReviewPack(options: T554BoundaryReviewWriteOptions): Sha256 {
  const persisted = verifyPersistedT554BoundaryReviewPack(options.outputDirectory);
  const inputs = loadT554BoundaryReviewInputsFromFiles(options);
  const expected = buildT554BoundaryReviewPack(inputs);
  if (persisted !== expected.manifestSha256) throw new Error("review pack digest differs from exact regeneration");
  const root = realpathSync(options.outputDirectory);
  for (const fileName of OUTPUT_FILE_NAMES) {
    const expectedText = expected.files.get(fileName);
    if (expectedText === undefined) throw new Error("expected review output is absent");
    const actual = readStableExistingOutputFile(root, fileName, MAX_BOUNDARY_SVG_BYTES);
    const expectedBytes = new TextEncoder().encode(expectedText);
    if (!actual.equals(expectedBytes)) throw new Error("review SVG differs from exact regeneration");
  }
  const actualManifest = readStableExistingOutputFile(
    root,
    "manifest.json",
    MAX_BOUNDARY_MANIFEST_BYTES,
  );
  if (!actualManifest.equals(manifestBytes(expected))) {
    throw new Error("review manifest bytes differ from exact regeneration");
  }
  checkT554InterfaceAtlas({
    matterpakSourceRoot: options.matterpakSourceRoot,
    outputDirectory: resolve(root, INTERFACE_ATLAS_DIRECTORY_NAME),
  });
  return persisted;
}
