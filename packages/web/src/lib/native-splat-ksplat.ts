import { nativeValue } from "./native-splat-data.js";
import { DataUtils } from "three";
import { allocateSplatData, assertSplatCount, SH_COEFFICIENTS, SH_WORDS, validateNativeData, writeSplatCovariance, type NativeSplatData } from "./native-splat-data.js";
// File layout documented by the format author's SplatBuffer:
// https://github.com/mkkellogg/GaussianSplats3D/blob/main/src/loaders/SplatBuffer.js
// No GaussianSplats3D or Spark rendering/loading dependency is imported.
interface Section {
    readonly count: number;
    readonly capacity: number;
    readonly degree: number;
    readonly data: number;
    readonly stride: number;
    readonly buckets: number;
    readonly bucketCount: number;
    readonly bucketSize: number;
    readonly bucketStride: number;
    readonly fullBuckets: number;
    readonly partial: number[];
    readonly range: number;
    readonly scale: number;
}
/** KSPLAT v0.1 section records, including compression levels 0, 1 and 2. */
export function decodeKsplat(buffer: ArrayBuffer): NativeSplatData {
    const view = new DataView(buffer);
    if (buffer.byteLength < 4096 || view.getUint8(0) !== 0 || view.getUint8(1) !== 1)
        throw new Error("Unsupported or truncated KSPLAT header (expected version 0.1).");
    const sectionCount = view.getUint32(4, true), count = view.getUint32(16, true), compression = view.getUint16(20, true);
    assertSplatCount(count);
    if (compression > 2 || sectionCount < 1 || sectionCount > 4096 || 4096 + sectionCount * 1024 > buffer.byteLength)
        throw new Error("Invalid KSPLAT section table or compression level.");
    const shMin = view.getFloat32(36, true) || -1.5, shMax = view.getFloat32(40, true) || 1.5;
    if (!Number.isFinite(shMin) || !Number.isFinite(shMax) || shMin > shMax)
        throw new Error("Invalid KSPLAT SH range.");
    const floatBytes = compression === 0 ? 4 : 2, shBytes = compression === 0 ? 4 : compression === 1 ? 2 : 1;
    const colorOffset = floatBytes * 10, shOffset = colorOffset + 4;
    const sections: Section[] = [];
    let base = 4096 + sectionCount * 1024, decodedCount = 0, maxDegree = 0;
    for (let index = 0; index < sectionCount; index++) {
        const header = 4096 + index * 1024;
        const sectionSplats = view.getUint32(header, true), capacity = view.getUint32(header + 4, true), degree = view.getUint16(header + 40, true);
        const bucketSize = view.getUint32(header + 8, true), bucketCount = view.getUint32(header + 12, true), bucketStride = view.getUint16(header + 20, true);
        const fullBuckets = view.getUint32(header + 32, true), partialCount = view.getUint32(header + 36, true);
        const range = view.getUint32(header + 24, true) || 32767;
        const scale = view.getFloat32(header + 16, true) / (2 * range);
        if (degree > 3 || capacity < sectionSplats || capacity > 16777216 || decodedCount + sectionSplats > count)
            throw new Error("Invalid KSPLAT section count or SH degree.");
        const stride = shOffset + nativeValue(SH_COEFFICIENTS[degree]) * 3 * shBytes;
        const bucketBytes = partialCount * 4 + bucketCount * bucketStride;
        const end = base + bucketBytes + capacity * stride;
        if (!Number.isSafeInteger(end) || end > buffer.byteLength)
            throw new Error("Truncated KSPLAT section payload.");
        if (compression > 0 && sectionSplats > 0 && (bucketSize === 0 || bucketStride < 12 || fullBuckets + partialCount !== bucketCount || !Number.isFinite(scale) || scale <= 0))
            throw new Error("Invalid KSPLAT compression buckets.");
        const partial: number[] = [];
        let covered = fullBuckets * bucketSize;
        for (let j = 0; j < partialCount; j++) {
            const length = view.getUint32(base + j * 4, true);
            if (length < 1 || length > bucketSize)
                throw new Error("Invalid KSPLAT partial bucket.");
            partial.push(length);
            covered += length;
        }
        if (compression > 0 && covered < sectionSplats)
            throw new Error("KSPLAT buckets do not cover the declared splats.");
        sections.push({ count: sectionSplats, capacity, degree, data: base + bucketBytes, stride, buckets: base + partialCount * 4, bucketCount, bucketSize, bucketStride, fullBuckets, partial, range, scale });
        decodedCount += sectionSplats;
        maxDegree = Math.max(maxDegree, degree);
        base = end;
    }
    if (decodedCount !== count || base !== buffer.byteLength)
        throw new Error("KSPLAT payload does not match its declared counts.");
    const output = allocateSplatData(count, maxDegree, "ksplat");
    const packed = output.sh.map((values) => new Uint8ClampedArray(values.buffer));
    const float = (offset: number) => compression === 0 ? view.getFloat32(offset, true) : DataUtils.fromHalfFloat(view.getUint16(offset, true));
    let destination = 0;
    for (const section of sections) {
        let partialIndex = 0, partialBase = section.fullBuckets * section.bucketSize;
        for (let index = 0; index < section.count; index++, destination++) {
            const start = section.data + index * section.stride;
            let bucket = 0;
            if (compression > 0) {
                if (index < section.fullBuckets * section.bucketSize)
                    bucket = Math.floor(index / section.bucketSize);
                else {
                    while (partialIndex < section.partial.length && index >= partialBase + nativeValue(section.partial[partialIndex]))
                        partialBase += nativeValue(section.partial[partialIndex++]);
                    bucket = section.fullBuckets + partialIndex;
                }
                if (bucket >= section.bucketCount)
                    throw new Error("KSPLAT position references a missing bucket.");
            }
            for (let axis = 0; axis < 3; axis++) {
                output.centers[destination * 3 + axis] = compression === 0 ? view.getFloat32(start + axis * 4, true)
                    : (view.getUint16(start + axis * 2, true) - section.range) * section.scale + view.getFloat32(section.buckets + bucket * section.bucketStride + axis * 4, true);
            }
            const sx = float(start + 3 * floatBytes), sy = float(start + 4 * floatBytes), sz = float(start + 5 * floatBytes);
            if (sx < 0 || sy < 0 || sz < 0)
                throw new Error("Invalid KSPLAT scale.");
            writeSplatCovariance(output.covariances, destination * 6, sx, sy, sz, float(start + 7 * floatBytes), float(start + 8 * floatBytes), float(start + 9 * floatBytes), float(start + 6 * floatBytes));
            output.colors.set(new Uint8Array(buffer, start + colorOffset, 4), destination * 4);
            for (let band = 1; band <= section.degree; band++) {
                const previous = nativeValue(SH_COEFFICIENTS[band - 1]), components = nativeValue(SH_COEFFICIENTS[band]) - previous;
                for (let coefficient = 0; coefficient < components; coefficient++)
                    for (let channel = 0; channel < 3; channel++) {
                        // KSPLAT stores each band's channels in separate runs; native interleaves RGB.
                        const offset = start + shOffset + (previous * 3 + channel * components + coefficient) * shBytes;
                        const value = compression === 0 ? view.getFloat32(offset, true) : compression === 1 ? DataUtils.fromHalfFloat(view.getUint16(offset, true)) : shMin + view.getUint8(offset) / 255 * (shMax - shMin);
                        if (!Number.isFinite(value))
                            throw new Error("Invalid KSPLAT spherical harmonic coefficient.");
                        nativeValue(packed[band - 1])[destination * nativeValue(SH_WORDS[band]) * 4 + coefficient * 3 + channel] = value * 128 + 128;
                    }
            }
        }
    }
    return validateNativeData(output);
}
