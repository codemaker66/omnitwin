import {
  Matrix4,
  Mesh,
  Object3D,
  Quaternion,
  Vector3,
} from "three";

const ROOT_NODE_ID = "root";
const MIN_INVERTIBLE_DETERMINANT = 1e-12;
const MIN_DIRECTION_LENGTH_SQUARED = 1e-12;
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const UINT32_RANGE = 0x1_0000_0000;
const FULL_TURN_RADIANS = Math.PI * 2;

export type FurnitureVector3Tuple = readonly [number, number, number];

/** The generated img2threejs action-ready runtime, without an implicit type. */
export interface Img2ThreeSculptRuntime {
  readonly nodes: Readonly<Record<string, Object3D>>;
  readonly meshes: Readonly<Record<string, Mesh>>;
  readonly sockets: Readonly<Record<string, Object3D>>;
  readonly colliders: Readonly<Record<string, unknown>>;
  readonly destructionGroups: Readonly<Record<string, readonly Object3D[]>>;
}

export interface FurniturePresentationRuntimeOptions {
  /** Full-separation distance in rendered world units. */
  readonly explodeDistance: number;
  /** Explode origin in the furniture root's local coordinate system. */
  readonly origin?: FurnitureVector3Tuple;
  /** Supply this when the generated runtime is held outside root.userData. */
  readonly runtime?: Img2ThreeSculptRuntime;
}

export interface FurnitureInspectionPart {
  readonly id: string;
  readonly node: Object3D;
  readonly parentPartId: string | null;
  readonly explodeWithParent: boolean;
}

interface LocalTransformSnapshot {
  readonly position: Vector3;
  readonly quaternion: Quaternion;
  readonly scale: Vector3;
  readonly matrix: Matrix4;
}

interface CapturedFurniturePart {
  readonly inspectionPart: FurnitureInspectionPart;
  readonly original: LocalTransformSnapshot;
  readonly explodeOffset: Vector3;
}

export class FurniturePresentationRuntimeError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "FurniturePresentationRuntimeError";
  }
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isUnknownRecord(value)) {
    throw new FurniturePresentationRuntimeError(`${path} must be an object record`);
  }
  return value;
}

function isObject3D(value: unknown): value is Object3D {
  return value instanceof Object3D;
}

function isMesh(value: unknown): value is Mesh {
  return value instanceof Mesh;
}

function readObject3DRecord(value: unknown, path: string): Record<string, Object3D> {
  const source = requireRecord(value, path);
  const result: Record<string, Object3D> = {};
  for (const [id, entry] of Object.entries(source)) {
    if (!isObject3D(entry)) {
      throw new FurniturePresentationRuntimeError(`${path}.${id} must be a THREE.Object3D`);
    }
    result[id] = entry;
  }
  return result;
}

function readMeshRecord(value: unknown, path: string): Record<string, Mesh> {
  const source = requireRecord(value, path);
  const result: Record<string, Mesh> = {};
  for (const [id, entry] of Object.entries(source)) {
    if (!isMesh(entry)) {
      throw new FurniturePresentationRuntimeError(`${path}.${id} must be a THREE.Mesh`);
    }
    result[id] = entry;
  }
  return result;
}

function readDestructionGroups(
  value: unknown,
  path: string,
): Record<string, readonly Object3D[]> {
  const source = requireRecord(value, path);
  const result: Record<string, readonly Object3D[]> = {};
  for (const [id, entry] of Object.entries(source)) {
    if (!Array.isArray(entry)) {
      throw new FurniturePresentationRuntimeError(`${path}.${id} must be an object array`);
    }
    result[id] = entry.map((node, index) => {
      if (!isObject3D(node)) {
        throw new FurniturePresentationRuntimeError(
          `${path}.${id}[${String(index)}] must be a THREE.Object3D`,
        );
      }
      return node;
    });
  }
  return result;
}

/** Read and validate the action-ready metadata published by an img2threejs model. */
export function readImg2ThreeSculptRuntime(root: Object3D): Img2ThreeSculptRuntime {
  const userData: unknown = root.userData;
  const candidate = requireRecord(userData, "root.userData").sculptRuntime;
  const runtime = requireRecord(candidate, "root.userData.sculptRuntime");
  return {
    nodes: readObject3DRecord(runtime.nodes, "sculptRuntime.nodes"),
    meshes: readMeshRecord(runtime.meshes, "sculptRuntime.meshes"),
    sockets: readObject3DRecord(runtime.sockets, "sculptRuntime.sockets"),
    colliders: requireRecord(runtime.colliders, "sculptRuntime.colliders"),
    destructionGroups: readDestructionGroups(
      runtime.destructionGroups,
      "sculptRuntime.destructionGroups",
    ),
  };
}

function assertFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a finite number greater than or equal to zero`);
  }
}

function assertProgress(progress: number): void {
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
    throw new RangeError("explode progress must be a finite number from zero to one");
  }
}

function vectorFromTuple(tuple: FurnitureVector3Tuple | undefined): Vector3 {
  const [x, y, z] = tuple ?? [0, 0, 0];
  if (![x, y, z].every(Number.isFinite)) {
    throw new RangeError("explode origin must contain three finite numbers");
  }
  return new Vector3(x, y, z);
}

function isDescendantOf(node: Object3D, root: Object3D): boolean {
  let cursor: Object3D | null = node;
  while (cursor !== null) {
    if (cursor === root) return true;
    cursor = cursor.parent;
  }
  return false;
}

function explodeWithParent(node: Object3D): boolean {
  const userData: unknown = node.userData;
  return isUnknownRecord(userData) && userData.explodeWithParent === true;
}

function stableHash(value: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

function fallbackDirection(id: string): Vector3 {
  const longitudeUnit = stableHash(id) / UINT32_RANGE;
  const heightUnit = stableHash(`${id}:height`) / UINT32_RANGE;
  const height = heightUnit * 2 - 1;
  const radial = Math.sqrt(Math.max(0, 1 - height * height));
  const longitude = longitudeUnit * FULL_TURN_RADIANS;
  return new Vector3(
    Math.cos(longitude) * radial,
    height,
    Math.sin(longitude) * radial,
  );
}

function nearestParentPartId(
  node: Object3D,
  idsByNode: ReadonlyMap<Object3D, string>,
): string | null {
  let cursor = node.parent;
  while (cursor !== null) {
    const id = idsByNode.get(cursor);
    if (id !== undefined) return id;
    cursor = cursor.parent;
  }
  return null;
}

function worldExplodeDirection(node: Object3D, originWorld: Vector3, id: string): Vector3 {
  const worldPosition = new Vector3().setFromMatrixPosition(node.matrixWorld);
  const direction = worldPosition.sub(originWorld);
  if (direction.lengthSq() <= MIN_DIRECTION_LENGTH_SQUARED) {
    return fallbackDirection(id);
  }
  return direction.normalize();
}

function parentLocalExplodeOffset(
  node: Object3D,
  directionWorld: Vector3,
  explodeDistance: number,
): Vector3 {
  if (explodeDistance === 0) return new Vector3();
  const parent = node.parent;
  if (parent === null) {
    throw new FurniturePresentationRuntimeError("a furniture part must have a parent node");
  }
  const determinant = parent.matrixWorld.determinant();
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= MIN_INVERTIBLE_DETERMINANT) {
    throw new FurniturePresentationRuntimeError(
      `cannot explode ${node.name}: its parent world transform is not invertible`,
    );
  }
  const inverseParentWorld = parent.matrixWorld.clone().invert();
  const worldStart = new Vector3().setFromMatrixPosition(node.matrixWorld);
  const localStart = worldStart.clone().applyMatrix4(inverseParentWorld);
  const localEnd = worldStart
    .addScaledVector(directionWorld, explodeDistance)
    .applyMatrix4(inverseParentWorld);
  return localEnd.sub(localStart);
}

function validatePartEntries(
  root: Object3D,
  runtime: Img2ThreeSculptRuntime,
): readonly (readonly [string, Object3D])[] {
  if (runtime.nodes[ROOT_NODE_ID] !== root) {
    throw new FurniturePresentationRuntimeError("sculptRuntime.nodes.root must reference the model root");
  }
  const entries = Object.entries(runtime.nodes)
    .filter(([id]) => id !== ROOT_NODE_ID)
    .sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) {
    throw new FurniturePresentationRuntimeError("sculptRuntime.nodes must expose at least one named part");
  }
  const seen = new Set<Object3D>();
  for (const [id, node] of entries) {
    if (id.trim().length === 0 || node.name.trim().length === 0) {
      throw new FurniturePresentationRuntimeError("each sculptRuntime node must be a named part");
    }
    if (seen.has(node)) {
      throw new FurniturePresentationRuntimeError(`named part ${id} duplicates another runtime node`);
    }
    if (!isDescendantOf(node, root) || node === root) {
      throw new FurniturePresentationRuntimeError(`named part ${id} must be a descendant of the model root`);
    }
    seen.add(node);
  }
  return entries;
}

function capturePart(
  id: string,
  node: Object3D,
  runtimeMesh: Mesh | undefined,
  idsByNode: ReadonlyMap<Object3D, string>,
  originWorld: Vector3,
  explodeDistance: number,
): CapturedFurniturePart {
  const followsParent = explodeWithParent(node)
    || (runtimeMesh !== undefined && explodeWithParent(runtimeMesh));
  const direction = worldExplodeDirection(node, originWorld, id);
  const offset = followsParent
    ? new Vector3()
    : parentLocalExplodeOffset(node, direction, explodeDistance);
  return {
    inspectionPart: {
      id,
      node,
      parentPartId: nearestParentPartId(node, idsByNode),
      explodeWithParent: followsParent,
    },
    original: {
      position: node.position.clone(),
      quaternion: node.quaternion.clone(),
      scale: node.scale.clone(),
      matrix: node.matrix.clone(),
    },
    explodeOffset: offset,
  };
}

function captureParts(
  root: Object3D,
  runtime: Img2ThreeSculptRuntime,
  originRootLocal: Vector3,
  explodeDistance: number,
): CapturedFurniturePart[] {
  root.updateWorldMatrix(true, true);
  const entries = validatePartEntries(root, runtime);
  const idsByNode = new Map(entries.map(([id, node]) => [node, id]));
  const originWorld = originRootLocal.applyMatrix4(root.matrixWorld);
  return entries.map(([id, node]) =>
    capturePart(id, node, runtime.meshes[id], idsByNode, originWorld, explodeDistance),
  );
}

function applyPartProgress(part: CapturedFurniturePart, progress: number): void {
  const { node } = part.inspectionPart;
  node.position
    .copy(part.original.position)
    .addScaledVector(part.explodeOffset, progress);
  node.quaternion.copy(part.original.quaternion);
  node.scale.copy(part.original.scale);
  node.matrix.copy(part.original.matrix);
  node.matrix.elements[12] += part.explodeOffset.x * progress;
  node.matrix.elements[13] += part.explodeOffset.y * progress;
  node.matrix.elements[14] += part.explodeOffset.z * progress;
  node.matrixWorldNeedsUpdate = true;
}

/**
 * Presentation-only controller for inspecting generated furniture assemblies.
 * It does not alter planning, collision, evidence, or authority data.
 */
export class FurniturePresentationRuntime {
  readonly #partByNode = new Map<Object3D, FurnitureInspectionPart>();
  #root: Object3D | null;
  #parts: CapturedFurniturePart[];
  #explodeProgress = 0;
  #disposed = false;

  private constructor(
    root: Object3D,
    runtime: Img2ThreeSculptRuntime,
    explodeDistance: number,
    originRootLocal: Vector3,
  ) {
    this.#root = root;
    this.#parts = captureParts(root, runtime, originRootLocal, explodeDistance);
    for (const part of this.#parts) {
      this.#partByNode.set(part.inspectionPart.node, part.inspectionPart);
    }
  }

  public static create(
    root: Object3D,
    options: FurniturePresentationRuntimeOptions,
  ): FurniturePresentationRuntime {
    assertFiniteNonNegative(options.explodeDistance, "explode distance");
    const origin = vectorFromTuple(options.origin);
    const runtime = options.runtime ?? readImg2ThreeSculptRuntime(root);
    return new FurniturePresentationRuntime(root, runtime, options.explodeDistance, origin);
  }

  public get inspectionParts(): readonly FurnitureInspectionPart[] {
    return this.#parts.map((part) => part.inspectionPart);
  }

  public get explodeProgress(): number {
    return this.#explodeProgress;
  }

  public get disposed(): boolean {
    return this.#disposed;
  }

  public setExplodeProgress(progress: number): void {
    if (this.#disposed) return;
    assertProgress(progress);
    for (const part of this.#parts) applyPartProgress(part, progress);
    this.#explodeProgress = progress;
  }

  public restore(): void {
    if (this.#disposed) return;
    for (const part of this.#parts) applyPartProgress(part, 0);
    this.#explodeProgress = 0;
  }

  public resolveInspectionPart(object: Object3D): FurnitureInspectionPart | null {
    if (this.#disposed || this.#root === null) return null;
    let cursor: Object3D | null = object;
    while (cursor !== null && cursor !== this.#root) {
      const part = this.#partByNode.get(cursor);
      const followsParent = part?.explodeWithParent ?? explodeWithParent(cursor);
      if (!followsParent && part !== undefined) return part;
      cursor = cursor.parent;
    }
    return null;
  }

  public dispose(): void {
    if (this.#disposed) return;
    this.restore();
    this.#disposed = true;
    this.#root = null;
    this.#parts = [];
    this.#partByNode.clear();
  }
}

export function createFurniturePresentationRuntime(
  root: Object3D,
  options: FurniturePresentationRuntimeOptions,
): FurniturePresentationRuntime {
  return FurniturePresentationRuntime.create(root, options);
}
