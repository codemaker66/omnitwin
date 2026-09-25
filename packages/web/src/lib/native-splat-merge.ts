import { BufferAttribute, BufferGeometry, Matrix3, Matrix4 } from "three";

export interface NativeSplatSource {
  readonly geometry: BufferGeometry;
  readonly matrix: Matrix4;
  readonly maxSh: number;
}

export interface MergedNativeSplats {
  readonly geometry: BufferGeometry;
  readonly tileIndices: Uint32Array;
  readonly inverseTransforms: Matrix3[];
  readonly counts: number[];
}

const SH_WORDS = [0, 3, 4, 6] as const;
// Inverse SH matrices plus opacity must fit WebGL2's minimum 16 KiB uniform block.
export const MAX_NATIVE_SPLAT_SOURCES = 128;

function attribute(geometry: BufferGeometry, name: string, size: number, count?: number): BufferAttribute {
  const value = geometry.getAttribute(name);
  if (!(value instanceof BufferAttribute) || value.itemSize !== size
    || (count !== undefined && value.count !== count)) {
    throw new Error(`Invalid native splat attribute: ${name}`);
  }
  return value;
}

export function nativeSplatCount(geometry: BufferGeometry): number {
  const count = attribute(geometry, "position", 3).count;
  if (!Number.isSafeInteger(count) || count < 1) throw new Error("Splat geometry has no complete positions");
  return count;
}

/** Mirrors GaussianSplat's contiguous SH3 range split; every value is retained. */
export function nativeSplatLargestStorageBuffer(count: number, degree: number, storageLimit: number | null): number {
  const shBytes = count * (SH_WORDS[degree] ?? 0) * 4;
  const splitSh3 = degree === 3 && storageLimit !== null && shBytes > storageLimit;
  return splitSh3 ? Math.max(count * 16, Math.ceil(count / 2) * 24) : Math.max(count * 16, shBytes);
}

/** One merged draw is essential: separate native objects sort independently. */
export function mergeNativeSplatSources(
  sources: readonly NativeSplatSource[],
  storageLimit: number | null = null,
): MergedNativeSplats {
  if (sources.length === 0 || sources.length > MAX_NATIVE_SPLAT_SOURCES) {
    throw new Error(`Native splat rendering requires 1–${String(MAX_NATIVE_SPLAT_SOURCES)} sources`);
  }
  const counts = sources.map(({ geometry }) => nativeSplatCount(geometry));
  const count = counts.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(count) || count > 0xffffffff) throw new Error("Splat scene exceeds the index range");
  let degree = 0;
  for (const source of sources) {
    for (let band = 1; band <= Math.min(3, source.maxSh); band++) {
      if (source.geometry.hasAttribute(`sphericalHarmonics${String(band)}`)) degree = Math.max(degree, band);
    }
  }
  const largestBuffer = nativeSplatLargestStorageBuffer(count, degree, storageLimit);
  if (storageLimit !== null && largestBuffer > storageLimit) {
    throw new Error(`This complete splat level needs a ${String(Math.ceil(largestBuffer / 1048576))} MiB GPU buffer; this device supports ${String(Math.floor(storageLimit / 1048576))} MiB. Select a coarser complete capture level.`);
  }
  const positions = new Float32Array(count * 3);
  const covariances = new Float32Array(count * 6);
  const colors = new Uint8Array(count * 4);
  const tileIndices = new Uint32Array(count);
  const inverseTransforms: Matrix3[] = [];
  const sh = Array.from({ length: degree }, (_, index) => {
    const band = new Uint32Array(count * (SH_WORDS[index + 1] ?? 0));
    // Native packed coefficients encode zero as signed-byte bias 128.
    band.fill(0x80808080);
    return band;
  });
  let offset = 0;
  for (const [tile, source] of sources.entries()) {
    const size = counts[tile] ?? 0;
    const p = attribute(source.geometry, "position", 3, size).array;
    const covariance = attribute(source.geometry, "covariance", 6, size).array;
    const color = attribute(source.geometry, "color", 4, size);
    if (!(color.array instanceof Uint8Array || color.array instanceof Uint8ClampedArray)) {
      throw new Error("Native Gaussian colors must be packed RGBA bytes");
    }
    const m = source.matrix.elements;
    if (!m.every(Number.isFinite) || Math.abs(source.matrix.determinant()) < 1e-12
      // Inverse Scene × source-world can round the affine bottom row by machine epsilon.
      || Math.abs(m[3]) > 1e-12 || Math.abs(m[7]) > 1e-12 || Math.abs(m[11]) > 1e-12 || Math.abs(m[15] - 1) > 1e-12) {
      throw new Error("Native splat transforms must be finite, invertible affine matrices");
    }
    inverseTransforms.push(new Matrix3().setFromMatrix4(source.matrix).invert());
    const a = m[0], b = m[4], c = m[8];
    const d = m[1], e = m[5], f = m[9];
    const g = m[2], h = m[6], j = m[10];
    for (let i = 0; i < size; i++) {
      const pi = i * 3, ci = i * 6, targetP = (offset + i) * 3, targetC = (offset + i) * 6;
      const x = p[pi] ?? 0, y = p[pi + 1] ?? 0, z = p[pi + 2] ?? 0;
      positions[targetP] = a * x + b * y + c * z + (m[12]);
      positions[targetP + 1] = d * x + e * y + f * z + (m[13]);
      positions[targetP + 2] = g * x + h * y + j * z + (m[14]);
      const xx = covariance[ci] ?? 0, xy = covariance[ci + 1] ?? 0, xz = covariance[ci + 2] ?? 0;
      const yy = covariance[ci + 3] ?? 0, yz = covariance[ci + 4] ?? 0, zz = covariance[ci + 5] ?? 0;
      // A Σ Aᵀ, including nonuniform scale and rotation.
      const u0 = a * xx + b * xy + c * xz, u1 = a * xy + b * yy + c * yz, u2 = a * xz + b * yz + c * zz;
      const v0 = d * xx + e * xy + f * xz, v1 = d * xy + e * yy + f * yz, v2 = d * xz + e * yz + f * zz;
      const w0 = g * xx + h * xy + j * xz, w1 = g * xy + h * yy + j * yz, w2 = g * xz + h * yz + j * zz;
      covariances[targetC] = u0 * a + u1 * b + u2 * c;
      covariances[targetC + 1] = u0 * d + u1 * e + u2 * f;
      covariances[targetC + 2] = u0 * g + u1 * h + u2 * j;
      covariances[targetC + 3] = v0 * d + v1 * e + v2 * f;
      covariances[targetC + 4] = v0 * g + v1 * h + v2 * j;
      covariances[targetC + 5] = w0 * g + w1 * h + w2 * j;
      if (!Number.isFinite((positions[targetP] ?? NaN) + (positions[targetP + 1] ?? NaN) + (positions[targetP + 2] ?? NaN)
        + (covariances[targetC] ?? NaN) + (covariances[targetC + 1] ?? NaN) + (covariances[targetC + 2] ?? NaN)
        + (covariances[targetC + 3] ?? NaN) + (covariances[targetC + 4] ?? NaN) + (covariances[targetC + 5] ?? NaN))) {
        throw new Error("Transformed splat data is non-finite or exceeds float32 range");
      }
    }
    colors.set(color.array, offset * 4);
    tileIndices.fill(tile, offset, offset + size);
    for (let band = 1; band <= degree; band++) {
      const name = `sphericalHarmonics${String(band)}`;
      if (band > source.maxSh || !source.geometry.hasAttribute(name)) continue;
      const words = SH_WORDS[band] ?? 0;
      const values = attribute(source.geometry, name, words, size).array;
      if (!(values instanceof Uint32Array)) throw new Error(`Invalid packed SH attribute: ${name}`);
      sh[band - 1]?.set(values, offset * words);
    }
    offset += size;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("covariance", new BufferAttribute(covariances, 6));
  geometry.setAttribute("color", new BufferAttribute(colors, 4, true));
  for (const [index, values] of sh.entries()) {
    geometry.setAttribute(`sphericalHarmonics${String(index + 1)}`, new BufferAttribute(values, SH_WORDS[index + 1] ?? 0));
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return { geometry, tileIndices, inverseTransforms, counts };
}

export interface NativeRoomClip {
  readonly center: readonly [number, number, number];
  readonly halfExtent: readonly [number, number, number];
  readonly softEdge: number;
}

/** Same scene-space box and linear edge used by the existing room cutaway. */
export function createNativeRoomClip(
  extent: readonly [number, number, number],
  margin = 0.35,
  softEdge = 0.12,
  keepHeightFraction = 1,
): NativeRoomClip | null {
  if (!extent.every((value) => Number.isFinite(value) && value > 0)
    || ![margin, softEdge, keepHeightFraction].every(Number.isFinite)) return null;
  const halfHeight = extent[1] * Math.min(Math.max(keepHeightFraction, 0.1), 1) / 2;
  return {
    center: [0, halfHeight, 0],
    halfExtent: [extent[0] / 2 + Math.max(0, margin), halfHeight + (keepHeightFraction >= 1 ? Math.max(0, margin) : 0), extent[2] / 2 + Math.max(0, margin)],
    softEdge: Math.max(0, softEdge),
  };
}
