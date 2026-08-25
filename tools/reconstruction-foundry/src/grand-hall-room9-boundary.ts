/**
 * Deterministic, read-only extraction of MatterPak room surfaces and E57
 * camera-centre membership evidence.
 *
 * This module deliberately does not manufacture a room polygon or a closed
 * volume. MatterPak room groups select observed mesh faces; a vertical
 * first-hit test can then classify camera centres against those source faces.
 */

import { createHash } from "node:crypto";

export type Vec3 = readonly [number, number, number];

export interface MatterportRoomKey {
  /** MatterPak `_groupNNN` value (the supplied model uses this as a floor partition). */
  readonly groupIndex: number;
  /** MatterPak `_subNNN` value (room 9 is `_sub009`). */
  readonly subIndex: number;
}

export interface MatterportObjGroup extends MatterportRoomKey {
  readonly name: string;
}

export interface MatterportObjTriangle {
  readonly vertexIndices: readonly [number, number, number];
  readonly group: MatterportObjGroup;
  readonly material: string | null;
  /** Zero-based order among `f` records in the source OBJ. */
  readonly sourceFaceOrdinal: number;
}

export interface ParsedMatterportObj {
  readonly vertices: readonly Vec3[];
  readonly triangles: readonly MatterportObjTriangle[];
}

export interface AxisAlignedBounds3 {
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface MatterportRoomSelectionSummary extends MatterportRoomKey {
  readonly groupNames: readonly string[];
  readonly groupCount: number;
  readonly faceCount: number;
  readonly uniqueVertexCount: number;
  readonly materialNames: readonly string[];
  readonly materialCount: number;
  readonly connectedComponentCount: number;
  /** Vertices referenced by both selected and non-selected source faces. */
  readonly sourceSharedVertexCount: number;
  readonly bounds: AxisAlignedBounds3 | null;
}

export interface SharedVertexInterfaceSummary {
  readonly roomA: MatterportRoomKey;
  readonly roomB: MatterportRoomKey;
  readonly sharedVertexCount: number;
  readonly bounds: AxisAlignedBounds3 | null;
}

export interface CameraTranslation {
  readonly index: number;
  readonly translation: Vec3;
}

export interface VerticalFirstHitOptions {
  readonly projectedAreaEpsilon?: number;
  readonly xyBoundsEpsilon?: number;
  readonly barycentricEpsilon?: number;
  readonly nonnegativeDistanceEpsilon?: number;
  readonly nearestHitImprovementEpsilon?: number;
}

export interface VerticalFirstHitMethod {
  readonly direction: readonly [0, 0, -1];
  readonly projectedAreaEpsilon: number;
  readonly xyBoundsEpsilon: number;
  readonly barycentricEpsilon: number;
  readonly nonnegativeDistanceEpsilon: number;
  readonly nearestHitImprovementEpsilon: number;
  readonly tieBreak: "source-face-order";
}

export interface VerticalFirstHit {
  readonly state: "hit";
  readonly cameraIndex: number;
  readonly cameraTranslation: Vec3;
  readonly distance: number;
  readonly hitPoint: Vec3;
  readonly group: MatterportObjGroup;
  readonly material: string | null;
  readonly sourceFaceOrdinal: number;
}

export interface VerticalNoHit {
  readonly state: "no-hit";
  readonly cameraIndex: number;
  readonly cameraTranslation: Vec3;
}

export type VerticalFirstHitResult = VerticalFirstHit | VerticalNoHit;

export interface VerticalFirstHitClassification {
  readonly method: VerticalFirstHitMethod;
  readonly results: readonly VerticalFirstHitResult[];
}

export const GRAND_HALL_ROOM_9: MatterportRoomKey = Object.freeze({
  groupIndex: 1,
  subIndex: 9,
});

export const GRAND_HALL_ROOM9_SOURCE_BOUNDARY_EVIDENCE_DOMAIN =
  "omnitwin.foundry.grand-hall-room9-source-boundary-evidence.v1";

export const GRAND_HALL_ROOM9_SOURCE_RECEIPT_DOMAIN =
  "omnitwin.foundry.grand-hall-room9-source-receipt.v1";

export const DEFAULT_VERTICAL_FIRST_HIT_METHOD: VerticalFirstHitMethod = Object.freeze({
  direction: [0, 0, -1] as const,
  projectedAreaEpsilon: 1e-12,
  xyBoundsEpsilon: 1e-9,
  barycentricEpsilon: 1e-8,
  nonnegativeDistanceEpsilon: 1e-8,
  nearestHitImprovementEpsilon: 1e-12,
  tieBreak: "source-face-order",
});

const MATTERPORT_GROUP_PATTERN = /^(?:chunk|mirror)\d+_group(\d{3})_sub(\d{3})$/u;

function parseFiniteNumber(value: string | undefined, context: string): number {
  if (value === undefined || value.length === 0) {
    throw new Error(`${context}: missing number`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${context}: expected a finite number, received ${JSON.stringify(value)}`);
  }
  return parsed;
}

function parseGroup(name: string, lineNumber: number): MatterportObjGroup {
  const match = MATTERPORT_GROUP_PATTERN.exec(name);
  if (match === null) {
    throw new Error(
      `OBJ line ${String(lineNumber)}: group ${JSON.stringify(name)} is not a recognized MatterPak room group`,
    );
  }
  return {
    name,
    groupIndex: Number.parseInt(match[1] ?? "", 10),
    subIndex: Number.parseInt(match[2] ?? "", 10),
  };
}

function resolveVertexIndex(token: string, vertexCount: number, lineNumber: number): number {
  const rawIndexText = token.split("/", 1)[0];
  if (rawIndexText === undefined || !/^-?\d+$/u.test(rawIndexText)) {
    throw new Error(
      `OBJ line ${String(lineNumber)}: malformed face vertex ${JSON.stringify(token)}`,
    );
  }
  const rawIndex = Number.parseInt(rawIndexText, 10);
  if (rawIndex === 0) {
    throw new Error(`OBJ line ${String(lineNumber)}: OBJ vertex index zero is invalid`);
  }
  const resolved = rawIndex > 0 ? rawIndex - 1 : vertexCount + rawIndex;
  if (resolved < 0 || resolved >= vertexCount) {
    throw new Error(
      `OBJ line ${String(lineNumber)}: vertex index ${String(rawIndex)} resolves outside ${String(vertexCount)} vertices`,
    );
  }
  return resolved;
}

/**
 * Parses only source geometry required by the classifier. Unknown OBJ record
 * types are ignored, but all geometry-bearing group/vertex/face records fail
 * closed on ambiguity. Faces must already be triangles; this function never
 * guesses a triangulation.
 */
export function parseMatterportObjLines(lines: Iterable<string>): ParsedMatterportObj {
  const vertices: Vec3[] = [];
  const triangles: MatterportObjTriangle[] = [];
  let activeGroup: MatterportObjGroup | null = null;
  let activeMaterial: string | null = null;
  let lineNumber = 0;

  for (const rawLine of lines) {
    lineNumber += 1;
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const fields = line.split(/\s+/u);
    const recordType = fields[0];

    if (recordType === "v") {
      if (fields.length !== 4) {
        throw new Error(`OBJ line ${String(lineNumber)}: vertex must contain exactly x y z`);
      }
      vertices.push([
        parseFiniteNumber(fields[1], `OBJ line ${String(lineNumber)} x`),
        parseFiniteNumber(fields[2], `OBJ line ${String(lineNumber)} y`),
        parseFiniteNumber(fields[3], `OBJ line ${String(lineNumber)} z`),
      ]);
      continue;
    }

    if (recordType === "g") {
      if (fields.length !== 2 || fields[1] === undefined) {
        throw new Error(
          `OBJ line ${String(lineNumber)}: exactly one MatterPak group name is required`,
        );
      }
      activeGroup = parseGroup(fields[1], lineNumber);
      continue;
    }

    if (recordType === "usemtl") {
      if (fields.length !== 2 || fields[1] === undefined || fields[1].length === 0) {
        throw new Error(`OBJ line ${String(lineNumber)}: exactly one material name is required`);
      }
      activeMaterial = fields[1];
      continue;
    }

    if (recordType === "f") {
      if (fields.length !== 4) {
        throw new Error(
          `OBJ line ${String(lineNumber)}: source face has ${String(fields.length - 1)} vertices; deterministic input must be triangular`,
        );
      }
      if (activeGroup === null) {
        throw new Error(
          `OBJ line ${String(lineNumber)}: face appears before a recognized MatterPak group`,
        );
      }
      const a = resolveVertexIndex(fields[1] ?? "", vertices.length, lineNumber);
      const b = resolveVertexIndex(fields[2] ?? "", vertices.length, lineNumber);
      const c = resolveVertexIndex(fields[3] ?? "", vertices.length, lineNumber);
      if (a === b || b === c || a === c) {
        throw new Error(`OBJ line ${String(lineNumber)}: face repeats a vertex index`);
      }
      triangles.push({
        vertexIndices: [a, b, c],
        group: activeGroup,
        material: activeMaterial,
        sourceFaceOrdinal: triangles.length,
      });
    }
  }

  if (vertices.length === 0) throw new Error("OBJ contains no vertices");
  if (triangles.length === 0) throw new Error("OBJ contains no MatterPak triangles");
  return { vertices, triangles };
}

export function parseMatterportObjText(text: string): ParsedMatterportObj {
  return parseMatterportObjLines(text.split(/\r?\n/u));
}

function isRoom(group: MatterportObjGroup, room: MatterportRoomKey): boolean {
  return group.groupIndex === room.groupIndex && group.subIndex === room.subIndex;
}

class DisjointSet {
  private readonly parent = new Map<number, number>();

  add(value: number): void {
    if (!this.parent.has(value)) this.parent.set(value, value);
  }

  find(value: number): number {
    const parent = this.parent.get(value);
    if (parent === undefined) {
      throw new Error(`disjoint-set value ${String(value)} was not added`);
    }
    if (parent === value) return value;
    const root = this.find(parent);
    this.parent.set(value, root);
    return root;
  }

  union(a: number, b: number): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootB, rootA);
  }
}

function boundsForVertexIndices(
  vertices: readonly Vec3[],
  indices: ReadonlySet<number>,
): AxisAlignedBounds3 | null {
  if (indices.size === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const index of indices) {
    const vertex = vertices[index];
    if (vertex === undefined) throw new Error(`missing parsed vertex ${String(index)}`);
    minX = Math.min(minX, vertex[0]);
    minY = Math.min(minY, vertex[1]);
    minZ = Math.min(minZ, vertex[2]);
    maxX = Math.max(maxX, vertex[0]);
    maxY = Math.max(maxY, vertex[1]);
    maxZ = Math.max(maxZ, vertex[2]);
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

export function summarizeMatterportRoomSelection(
  model: ParsedMatterportObj,
  room: MatterportRoomKey,
): MatterportRoomSelectionSummary {
  const selectedVertices = new Set<number>();
  const outsideVertices = new Set<number>();
  const groupNames = new Set<string>();
  const materialNames = new Set<string>();
  const disjointSet = new DisjointSet();
  let faceCount = 0;

  for (const triangle of model.triangles) {
    const selected = isRoom(triangle.group, room);
    for (const vertexIndex of triangle.vertexIndices) {
      if (selected) {
        selectedVertices.add(vertexIndex);
        disjointSet.add(vertexIndex);
      } else {
        outsideVertices.add(vertexIndex);
      }
    }
    if (!selected) continue;
    faceCount += 1;
    groupNames.add(triangle.group.name);
    if (triangle.material !== null) materialNames.add(triangle.material);
    disjointSet.union(triangle.vertexIndices[0], triangle.vertexIndices[1]);
    disjointSet.union(triangle.vertexIndices[1], triangle.vertexIndices[2]);
  }

  const roots = new Set<number>();
  let sourceSharedVertexCount = 0;
  for (const vertexIndex of selectedVertices) {
    roots.add(disjointSet.find(vertexIndex));
    if (outsideVertices.has(vertexIndex)) sourceSharedVertexCount += 1;
  }
  const lexicalOrder = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  const sortedGroups = [...groupNames].sort(lexicalOrder);
  const sortedMaterials = [...materialNames].sort(lexicalOrder);
  return {
    groupIndex: room.groupIndex,
    subIndex: room.subIndex,
    groupNames: sortedGroups,
    groupCount: sortedGroups.length,
    faceCount,
    uniqueVertexCount: selectedVertices.size,
    materialNames: sortedMaterials,
    materialCount: sortedMaterials.length,
    connectedComponentCount: roots.size,
    sourceSharedVertexCount,
    bounds: boundsForVertexIndices(model.vertices, selectedVertices),
  };
}

function roomVertexIndices(model: ParsedMatterportObj, room: MatterportRoomKey): Set<number> {
  const indices = new Set<number>();
  for (const triangle of model.triangles) {
    if (!isRoom(triangle.group, room)) continue;
    for (const vertexIndex of triangle.vertexIndices) indices.add(vertexIndex);
  }
  return indices;
}

export function summarizeSharedVertexInterface(
  model: ParsedMatterportObj,
  roomA: MatterportRoomKey,
  roomB: MatterportRoomKey,
): SharedVertexInterfaceSummary {
  const verticesA = roomVertexIndices(model, roomA);
  const verticesB = roomVertexIndices(model, roomB);
  const shared = new Set<number>();
  for (const vertexIndex of verticesA) {
    if (verticesB.has(vertexIndex)) shared.add(vertexIndex);
  }
  return {
    roomA,
    roomB,
    sharedVertexCount: shared.size,
    bounds: boundsForVertexIndices(model.vertices, shared),
  };
}

function resolvedFirstHitMethod(options: VerticalFirstHitOptions): VerticalFirstHitMethod {
  const method: VerticalFirstHitMethod = {
    direction: [0, 0, -1],
    projectedAreaEpsilon:
      options.projectedAreaEpsilon ?? DEFAULT_VERTICAL_FIRST_HIT_METHOD.projectedAreaEpsilon,
    xyBoundsEpsilon: options.xyBoundsEpsilon ?? DEFAULT_VERTICAL_FIRST_HIT_METHOD.xyBoundsEpsilon,
    barycentricEpsilon:
      options.barycentricEpsilon ?? DEFAULT_VERTICAL_FIRST_HIT_METHOD.barycentricEpsilon,
    nonnegativeDistanceEpsilon:
      options.nonnegativeDistanceEpsilon ??
      DEFAULT_VERTICAL_FIRST_HIT_METHOD.nonnegativeDistanceEpsilon,
    nearestHitImprovementEpsilon:
      options.nearestHitImprovementEpsilon ??
      DEFAULT_VERTICAL_FIRST_HIT_METHOD.nearestHitImprovementEpsilon,
    tieBreak: "source-face-order",
  };
  for (const [name, value] of Object.entries(method)) {
    if (typeof value === "number" && (!Number.isFinite(value) || value < 0)) {
      throw new Error(`${name} must be a finite nonnegative number`);
    }
  }
  return method;
}

interface ProjectedTriangleHit {
  readonly distance: number;
  readonly hitPoint: Vec3;
}

function verticalProjectedTriangleHit(
  origin: Vec3,
  a: Vec3,
  b: Vec3,
  c: Vec3,
  method: VerticalFirstHitMethod,
): ProjectedTriangleHit | null {
  const minX = Math.min(a[0], b[0], c[0]) - method.xyBoundsEpsilon;
  const maxX = Math.max(a[0], b[0], c[0]) + method.xyBoundsEpsilon;
  const minY = Math.min(a[1], b[1], c[1]) - method.xyBoundsEpsilon;
  const maxY = Math.max(a[1], b[1], c[1]) + method.xyBoundsEpsilon;
  if (origin[0] < minX || origin[0] > maxX || origin[1] < minY || origin[1] > maxY) {
    return null;
  }

  const denominator =
    (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  if (Math.abs(denominator) <= method.projectedAreaEpsilon) return null;
  const weightA =
    ((b[1] - c[1]) * (origin[0] - c[0]) +
      (c[0] - b[0]) * (origin[1] - c[1])) /
    denominator;
  const weightB =
    ((c[1] - a[1]) * (origin[0] - c[0]) +
      (a[0] - c[0]) * (origin[1] - c[1])) /
    denominator;
  const weightC = 1 - weightA - weightB;
  const epsilon = method.barycentricEpsilon;
  if (weightA < -epsilon || weightB < -epsilon || weightC < -epsilon) return null;

  const hitZ = weightA * a[2] + weightB * b[2] + weightC * c[2];
  const distance = origin[2] - hitZ;
  if (distance < -method.nonnegativeDistanceEpsilon) return null;
  return {
    distance: Math.max(0, distance),
    hitPoint: [origin[0], origin[1], hitZ],
  };
}

/**
 * Casts [0,0,-1] from each supplied camera translation and reports the first
 * source triangle. No floor-height threshold, room-name guess, or generated
 * geometry participates in the decision.
 */
export function classifyVerticalFirstHits(
  model: ParsedMatterportObj,
  cameras: readonly CameraTranslation[],
  options: VerticalFirstHitOptions = {},
): VerticalFirstHitClassification {
  const method = resolvedFirstHitMethod(options);
  const results: VerticalFirstHitResult[] = [];

  for (const camera of cameras) {
    let best: { triangle: MatterportObjTriangle; hit: ProjectedTriangleHit } | null = null;
    for (const triangle of model.triangles) {
      const a = model.vertices[triangle.vertexIndices[0]];
      const b = model.vertices[triangle.vertexIndices[1]];
      const c = model.vertices[triangle.vertexIndices[2]];
      if (a === undefined || b === undefined || c === undefined) {
        throw new Error(
          `triangle ${String(triangle.sourceFaceOrdinal)} references a missing vertex`,
        );
      }
      const hit = verticalProjectedTriangleHit(camera.translation, a, b, c, method);
      if (hit === null) continue;
      if (
        best === null ||
        hit.distance < best.hit.distance - method.nearestHitImprovementEpsilon
      ) {
        best = { triangle, hit };
      }
    }

    if (best === null) {
      results.push({
        state: "no-hit",
        cameraIndex: camera.index,
        cameraTranslation: camera.translation,
      });
      continue;
    }
    results.push({
      state: "hit",
      cameraIndex: camera.index,
      cameraTranslation: camera.translation,
      distance: best.hit.distance,
      hitPoint: best.hit.hitPoint,
      group: best.triangle.group,
      material: best.triangle.material,
      sourceFaceOrdinal: best.triangle.sourceFaceOrdinal,
    });
  }
  return { method, results };
}

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export function stableCanonicalJson(value: JsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonical JSON rejects non-finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const array = value as readonly JsonValue[];
    return `[${array.map((entry) => stableCanonicalJson(entry)).join(",")}]`;
  }
  const record = value as { readonly [key: string]: JsonValue };
  const entries = Object.keys(record)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((key) => {
      const entry = record[key];
      if (entry === undefined) throw new Error(`canonical JSON rejects undefined at ${key}`);
      return `${JSON.stringify(key)}:${stableCanonicalJson(entry)}`;
    });
  return `{${entries.join(",")}}`;
}

export function computeGrandHallRoom9EvidenceSha256(material: JsonValue): `sha256:${string}` {
  const payload = `${GRAND_HALL_ROOM9_SOURCE_BOUNDARY_EVIDENCE_DOMAIN}\n${stableCanonicalJson(material)}`;
  return `sha256:${createHash("sha256").update(payload, "utf8").digest("hex")}`;
}

export function computeGrandHallRoom9SourceReceiptSha256(
  material: JsonValue,
): `sha256:${string}` {
  const payload = `${GRAND_HALL_ROOM9_SOURCE_RECEIPT_DOMAIN}\n${stableCanonicalJson(material)}`;
  return `sha256:${createHash("sha256").update(payload, "utf8").digest("hex")}`;
}
