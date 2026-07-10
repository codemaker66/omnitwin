export type Vec3 = readonly [number, number, number];

export type TriangleWindingDisposition = "keep" | "flip" | "ambiguous" | "degenerate";

export type TriangleIndexArray = Uint16Array | Uint32Array;

export type FlatPositionArray = readonly number[] | Float32Array | Float64Array;

export interface InteriorWindingReport {
  readonly keep: number;
  readonly flip: number;
  readonly ambiguous: number;
  readonly degenerate: number;
  readonly triangles: number;
}

export interface OrientTriangleIndicesInput<TIndices extends TriangleIndexArray> {
  readonly positions: FlatPositionArray;
  readonly indices: TIndices;
  readonly capturePositions: readonly Vec3[];
}

export interface InteriorWindingResult<TIndices extends TriangleIndexArray> {
  readonly indices: TIndices;
  readonly report: InteriorWindingReport;
}

interface OrientTriangleIndicesRuntimeInput {
  readonly positions: FlatPositionArray;
  readonly indices: ArrayLike<number>;
  readonly capturePositions: readonly Vec3[];
}

const DEGENERATE_SINE_EPSILON = 1e-12;
const AMBIGUOUS_COSINE_EPSILON = 1e-12;
// A relative tie keeps capture ordering from deciding winding when witnesses provide equal evidence.
const NEAREST_CAPTURE_RELATIVE_EPSILON = 1e-12;

function assertFiniteVec3(point: Vec3, label: string): void {
  for (let axis = 0; axis < 3; axis += 1) {
    const coordinate = point[axis];
    if (!Number.isFinite(coordinate)) {
      throw new TypeError(`${label}[${String(axis)}] must be finite`);
    }
  }
}

function pairCoordinateScale(a: Vec3, b: Vec3): number {
  return Math.max(
    Math.abs(a[0]),
    Math.abs(a[1]),
    Math.abs(a[2]),
    Math.abs(b[0]),
    Math.abs(b[1]),
    Math.abs(b[2]),
  );
}

function unitDirection(from: Vec3, to: Vec3): Vec3 | null {
  const scale = pairCoordinateScale(from, to);
  if (scale === 0) return null;
  const dx = to[0] / scale - from[0] / scale;
  const dy = to[1] / scale - from[1] / scale;
  const dz = to[2] / scale - from[2] / scale;
  const length = Math.hypot(dx, dy, dz);
  if (length === 0) return null;
  return [dx / length, dy / length, dz / length];
}

function unitTriangleNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 | null {
  const ab = unitDirection(a, b);
  const ac = unitDirection(a, c);
  if (ab === null || ac === null) return null;

  const nx = ab[1] * ac[2] - ab[2] * ac[1];
  const ny = ab[2] * ac[0] - ab[0] * ac[2];
  const nz = ab[0] * ac[1] - ab[1] * ac[0];
  const normalLength = Math.hypot(nx, ny, nz);
  if (normalLength <= DEGENERATE_SINE_EPSILON) return null;
  return [nx / normalLength, ny / normalLength, nz / normalLength];
}

function classifyTriangleTowardPointUnchecked(
  a: Vec3,
  b: Vec3,
  c: Vec3,
  witness: Vec3,
): TriangleWindingDisposition {
  const normal = unitTriangleNormal(a, b, c);
  if (normal === null) return "degenerate";

  const centroid = triangleCentroid(a, b, c);
  const witnessDirection = unitDirection(centroid, witness);
  if (witnessDirection === null) return "ambiguous";

  const facingCosine =
    normal[0] * witnessDirection[0] +
    normal[1] * witnessDirection[1] +
    normal[2] * witnessDirection[2];
  if (Math.abs(facingCosine) <= AMBIGUOUS_COSINE_EPSILON) return "ambiguous";
  return facingCosine > 0 ? "keep" : "flip";
}

/** Classifies whether one triangle's front face points toward an interior capture witness. */
export function classifyTriangleTowardPoint(
  a: Vec3,
  b: Vec3,
  c: Vec3,
  witness: Vec3,
): TriangleWindingDisposition {
  assertFiniteVec3(a, "triangle vertex a");
  assertFiniteVec3(b, "triangle vertex b");
  assertFiniteVec3(c, "triangle vertex c");
  assertFiniteVec3(witness, "capture witness");
  return classifyTriangleTowardPointUnchecked(a, b, c, witness);
}

function positionValueAt(positions: FlatPositionArray, index: number): number {
  const value = positions[index];
  if (value === undefined) throw new RangeError(`positions[${String(index)}] is missing`);
  return value;
}

function pointAt(positions: FlatPositionArray, vertexIndex: number): Vec3 {
  const offset = vertexIndex * 3;
  return [
    positionValueAt(positions, offset),
    positionValueAt(positions, offset + 1),
    positionValueAt(positions, offset + 2),
  ];
}

function validatePositions(positions: FlatPositionArray): number {
  if (positions.length % 3 !== 0) {
    throw new RangeError(`positions length ${String(positions.length)} must be a multiple of 3`);
  }
  for (let index = 0; index < positions.length; index += 1) {
    const value = positionValueAt(positions, index);
    if (!Number.isFinite(value)) throw new TypeError(`positions[${String(index)}] must be finite`);
  }
  return positions.length / 3;
}

function cloneAndValidateIndices(indices: ArrayLike<number>, vertexCount: number): TriangleIndexArray {
  if (!(indices instanceof Uint16Array) && !(indices instanceof Uint32Array)) {
    throw new TypeError("indices must be a Uint16Array or Uint32Array");
  }
  if (indices.length % 3 !== 0) {
    throw new RangeError(`indices length ${String(indices.length)} must be a multiple of 3`);
  }
  for (let index = 0; index < indices.length; index += 1) {
    const vertexIndex = indices[index];
    if (vertexIndex === undefined || vertexIndex >= vertexCount) {
      throw new RangeError(`indices[${String(index)}] is outside the position vertex range`);
    }
  }
  return indices.slice();
}

function validateCapturePositions(capturePositions: readonly Vec3[], needsWitness: boolean): void {
  if (needsWitness && capturePositions.length === 0) {
    throw new RangeError("at least one capture position is required for non-empty geometry");
  }
  for (let index = 0; index < capturePositions.length; index += 1) {
    const capture = capturePositions[index];
    if (capture === undefined) throw new RangeError(`capturePositions[${String(index)}] is missing`);
    assertFiniteVec3(capture, `capturePositions[${String(index)}]`);
  }
}

function stableAverage(a: number, b: number, c: number): number {
  const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c));
  if (scale === 0) return 0;
  return ((a / scale + b / scale + c / scale) / 3) * scale;
}

function triangleCentroid(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const centroid: Vec3 = [
    stableAverage(a[0], b[0], c[0]),
    stableAverage(a[1], b[1], c[1]),
    stableAverage(a[2], b[2], c[2]),
  ];
  assertFiniteVec3(centroid, "triangle centroid");
  return centroid;
}

function euclideanDistanceBetween(a: Vec3, b: Vec3): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz)) {
    throw new RangeError("capture distance exceeds the finite numeric range");
  }
  const distanceSquared = dx * dx + dy * dy + dz * dz;
  if (distanceSquared > 0 && Number.isFinite(distanceSquared)) return Math.sqrt(distanceSquared);
  const distance = Math.hypot(dx, dy, dz);
  if (!Number.isFinite(distance)) throw new RangeError("capture distance exceeds the finite numeric range");
  return distance;
}

function captureDistancesTie(left: number, right: number): boolean {
  if (left === right) return true;
  const scale = Math.max(left, right);
  return Math.abs(left - right) <= NEAREST_CAPTURE_RELATIVE_EPSILON * scale;
}

function classifyTriangleTowardNearestCapture(
  a: Vec3,
  b: Vec3,
  c: Vec3,
  capturePositions: readonly Vec3[],
  captureDistances: Float64Array,
): TriangleWindingDisposition {
  const centroid = triangleCentroid(a, b, c);
  const first = capturePositions[0];
  if (first === undefined) throw new RangeError("at least one capture position is required");
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < capturePositions.length; index += 1) {
    const candidate = capturePositions[index];
    if (candidate === undefined) throw new RangeError(`capturePositions[${String(index)}] is missing`);
    const distance = euclideanDistanceBetween(centroid, candidate);
    captureDistances[index] = distance;
    nearestDistance = Math.min(nearestDistance, distance);
  }

  let nearestDisposition: TriangleWindingDisposition | null = null;
  for (let index = 0; index < capturePositions.length; index += 1) {
    const candidate = capturePositions[index];
    const distance = captureDistances[index];
    if (candidate === undefined || distance === undefined) {
      throw new RangeError(`capturePositions[${String(index)}] is missing`);
    }
    if (!captureDistancesTie(distance, nearestDistance)) continue;
    const disposition = classifyTriangleTowardPointUnchecked(a, b, c, candidate);
    if (nearestDisposition !== null && disposition !== nearestDisposition) return "ambiguous";
    nearestDisposition = disposition;
  }
  if (nearestDisposition === null) throw new RangeError("nearest capture position could not be resolved");
  return nearestDisposition;
}

function indexAt(indices: TriangleIndexArray, index: number): number {
  const value = indices[index];
  if (value === undefined) throw new RangeError(`indices[${String(index)}] is missing`);
  return value;
}

function flipTriangle(indices: TriangleIndexArray, offset: number): void {
  const second = indexAt(indices, offset + 1);
  indices[offset + 1] = indexAt(indices, offset + 2);
  indices[offset + 2] = second;
}

/** Returns a cloned index buffer whose non-ambiguous faces point toward their nearest capture. */
export function orientTriangleIndicesTowardCapture(
  input: OrientTriangleIndicesInput<Uint16Array>,
): InteriorWindingResult<Uint16Array>;
export function orientTriangleIndicesTowardCapture(
  input: OrientTriangleIndicesInput<Uint32Array>,
): InteriorWindingResult<Uint32Array>;
export function orientTriangleIndicesTowardCapture(
  input: OrientTriangleIndicesInput<TriangleIndexArray>,
): InteriorWindingResult<TriangleIndexArray>;
export function orientTriangleIndicesTowardCapture(
  input: OrientTriangleIndicesRuntimeInput,
): InteriorWindingResult<TriangleIndexArray> {
  const vertexCount = validatePositions(input.positions);
  const indices = cloneAndValidateIndices(input.indices, vertexCount);
  validateCapturePositions(input.capturePositions, indices.length > 0);
  const captureDistances = new Float64Array(input.capturePositions.length);
  const report = { keep: 0, flip: 0, ambiguous: 0, degenerate: 0, triangles: indices.length / 3 };

  for (let offset = 0; offset < indices.length; offset += 3) {
    const a = pointAt(input.positions, indexAt(indices, offset));
    const b = pointAt(input.positions, indexAt(indices, offset + 1));
    const c = pointAt(input.positions, indexAt(indices, offset + 2));
    const disposition = classifyTriangleTowardNearestCapture(
      a,
      b,
      c,
      input.capturePositions,
      captureDistances,
    );
    report[disposition] += 1;
    if (disposition === "flip") flipTriangle(indices, offset);
  }

  return { indices, report };
}
