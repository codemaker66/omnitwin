import { BufferAttribute, BufferGeometry } from "three";
/** Three r186's public GaussianSplat attribute representation. */
export interface NativeSplatData {
    readonly format: string;
    readonly centers: Float32Array;
    readonly covariances: Float32Array;
    readonly colors: Uint8ClampedArray;
    readonly sh: readonly Uint32Array[];
}
export const MAX_NATIVE_SPLATS = 16777216;
export const SH_WORDS = [0, 3, 4, 6] as const;
export const SH_COEFFICIENTS = [0, 3, 8, 15] as const;
/** Checked access for decoded array members and validated metadata. */
export function nativeValue<T>(value: T | null | undefined): T {
    if (value === null || value === undefined)
        throw new Error("Native splat data is missing an expected value.");
    return value;
}
export function assertSplatCount(count: number): void {
    if (!Number.isSafeInteger(count) || count < 1 || count > MAX_NATIVE_SPLATS) {
        throw new Error(`Splat count must be between 1 and ${String(MAX_NATIVE_SPLATS)}.`);
    }
}
export function allocateSplatData(count: number, degree: number, format: string): NativeSplatData {
    assertSplatCount(count);
    if (!Number.isInteger(degree) || degree < 0 || degree > 3)
        throw new Error("Unsupported SH degree.");
    const sh: Uint32Array[] = [];
    for (let band = 1; band <= degree; band++) {
        const values = new Uint32Array(count * nativeValue(SH_WORDS[band]));
        values.fill(0x80808080);
        sh.push(values);
    }
    return {
        format,
        centers: new Float32Array(count * 3),
        covariances: new Float32Array(count * 6),
        colors: new Uint8ClampedArray(count * 4),
        sh,
    };
}
/** Covariance R diag(scale²) Rᵀ, in native [xx,xy,xz,yy,yz,zz] order. */
export function writeSplatCovariance(target: Float32Array, offset: number, sx: number, sy: number, sz: number, qx: number, qy: number, qz: number, qw: number): void {
    const length = Math.hypot(qx, qy, qz, qw);
    if (!Number.isFinite(length) || length === 0)
        throw new Error("Invalid splat quaternion.");
    qx /= length;
    qy /= length;
    qz /= length;
    qw /= length;
    const xx = 1 - 2 * (qy * qy + qz * qz), xy = 2 * (qx * qy - qz * qw), xz = 2 * (qx * qz + qy * qw);
    const yx = 2 * (qx * qy + qz * qw), yy = 1 - 2 * (qx * qx + qz * qz), yz = 2 * (qy * qz - qx * qw);
    const zx = 2 * (qx * qz - qy * qw), zy = 2 * (qy * qz + qx * qw), zz = 1 - 2 * (qx * qx + qy * qy);
    const a = sx * sx, b = sy * sy, c = sz * sz;
    target[offset] = xx * xx * a + xy * xy * b + xz * xz * c;
    target[offset + 1] = xx * yx * a + xy * yy * b + xz * yz * c;
    target[offset + 2] = xx * zx * a + xy * zy * b + xz * zz * c;
    target[offset + 3] = yx * yx * a + yy * yy * b + yz * yz * c;
    target[offset + 4] = yx * zx * a + yy * zy * b + yz * zz * c;
    target[offset + 5] = zx * zx * a + zy * zy * b + zz * zz * c;
}
export function nativeDataToGeometry(data: NativeSplatData): BufferGeometry {
    const count = data.centers.length / 3;
    assertSplatCount(count);
    if (data.covariances.length !== count * 6 || data.colors.length !== count * 4 || data.sh.length > 3) {
        throw new Error("Malformed native splat attribute lengths.");
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(data.centers, 3));
    geometry.setAttribute("covariance", new BufferAttribute(data.covariances, 6));
    geometry.setAttribute("color", new BufferAttribute(data.colors, 4, true));
    data.sh.forEach((values, index) => {
        const words = nativeValue(SH_WORDS[index + 1]);
        if (values.length !== count * words)
            throw new Error("Malformed native SH attribute length.");
        geometry.setAttribute(`sphericalHarmonics${String(index + 1)}`, new BufferAttribute(values, words));
    });
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.userData.nativeSplat = { format: data.format, count, shDegree: data.sh.length };
    return geometry;
}
export function validateNativeData(data: NativeSplatData): NativeSplatData {
    for (const values of [data.centers, data.covariances]) {
        for (const value of values)
            if (!Number.isFinite(value))
                throw new Error("Splat geometry contains non-finite data.");
    }
    return data;
}
