import { nativeValue } from "./native-splat-data.js";
import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from "@zip.js/zip.js";
import { allocateSplatData, assertSplatCount, SH_COEFFICIENTS, SH_WORDS, validateNativeData, writeSplatCovariance, type NativeSplatData } from "./native-splat-data.js";
// SOG data format: https://developer.playcanvas.com/user-manual/gaussian-splatting/formats/sog/
// V1 compatibility math checked against PlayCanvas's MIT-licensed GSplatSogIterator.
// This is a data adapter; rendering and sorting remain Three's native pipeline.
const MAX_ENTRY_BYTES = 128 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 16777216;
const SH_C0 = 0.28209479177387814;
export interface SplatImage {
    readonly width: number;
    readonly height: number;
    readonly data: Uint8ClampedArray;
}
export type SplatWebpDecoder = (bytes: ArrayBuffer) => Promise<SplatImage>;
type JsonRecord = Record<string, unknown>;
function record(value: unknown, label: string): JsonRecord {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        throw new Error(`Invalid SOG ${label}.`);
    return value as JsonRecord;
}
function number(value: unknown, label: string): number {
    if (typeof value !== "number" || !Number.isFinite(value))
        throw new Error(`Invalid SOG ${label}.`);
    return value;
}
function numbers(value: unknown, length: number, label: string): number[] {
    if (!Array.isArray(value) || value.length !== length)
        throw new Error(`Invalid SOG ${label}.`);
    return value.map((v: unknown) => number(v, label));
}
function codebook(group: JsonRecord, label: string): number[] {
    const value = group.codebook;
    if (!Array.isArray(value) || value.length !== 256)
        throw new Error(`SOG ${label} codebook must contain 256 entries.`);
    const patched = [...value as unknown[]];
    // Older official encoders emitted a null first entry. Match PlayCanvas's compatibility repair.
    if (patched[0] === null)
        patched[0] = number(patched[1], label) + (number(patched[1], label) - number(patched[255], label)) / 255;
    return patched.map((v: unknown) => number(Math.fround(number(v, label)), label));
}
function safePath(value: unknown): string {
    if (typeof value !== "string" || value.length === 0 || value.length > 255 || /[\\:#?]/u.test(value) || value.includes(String.fromCharCode(0)) || value.startsWith("/") || value.split("/").some((part) => !part || part === "." || part === "..")) {
        throw new Error("SOG references must be safe files contained in the archive.");
    }
    return value;
}
function files(group: JsonRecord, length: number): string[] {
    if (!Array.isArray(group.files) || group.files.length !== length)
        throw new Error("Invalid SOG image file list.");
    return group.files.map((file: unknown) => safePath(file));
}
function abort(signal?: AbortSignal): void { signal?.throwIfAborted(); }
/** Reject oversized images BEFORE libwebp allocates its RGBA result. */
export function inspectSogWebp(bytes: Uint8Array): {
    width: number;
    height: number;
} {
    const text = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
    if (bytes.length < 25 || text(0) !== "RIFF" || text(8) !== "WEBP")
        throw new Error("SOG image is not a WebP file.");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(4, true) + 8 !== bytes.length)
        throw new Error("Truncated SOG WebP image.");
    let dimensions: {
        width: number;
        height: number;
    } | undefined;
    let canvas: {
        width: number;
        height: number;
    } | undefined;
    for (let offset = 12; offset + 8 <= bytes.length;) {
        const length = view.getUint32(offset + 4, true);
        if (offset + 8 + length > bytes.length)
            throw new Error("Truncated SOG WebP chunk.");
        const kind = text(offset);
        if (kind === "VP8 ")
            throw new Error("SOG data requires lossless WebP images.");
        if (kind === "ANIM" || kind === "ANMF")
            throw new Error("Animated SOG data images are unsupported.");
        if (kind === "VP8X") {
            if (length !== 10 || (nativeValue(bytes[offset + 8]) & 2) !== 0)
                throw new Error("Invalid or animated SOG WebP canvas.");
            const u24 = (base: number) => nativeValue(bytes[base]) + (nativeValue(bytes[base + 1]) << 8) + (nativeValue(bytes[base + 2]) << 16);
            canvas = { width: u24(offset + 12) + 1, height: u24(offset + 15) + 1 };
            if (canvas.width * canvas.height > MAX_IMAGE_PIXELS)
                throw new Error("SOG image exceeds the supported image size.");
        }
        if (kind === "VP8L") {
            if (length < 5 || bytes[offset + 8] !== 0x2f || dimensions)
                throw new Error("Invalid lossless SOG WebP header.");
            const bits = view.getUint32(offset + 9, true);
            dimensions = { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
            if ((bits >>> 29) !== 0 || dimensions.width * dimensions.height > MAX_IMAGE_PIXELS)
                throw new Error("SOG image exceeds the supported image size.");
        }
        offset += 8 + length + (length & 1);
    }
    if (!dimensions)
        throw new Error("SOG data requires a lossless WebP payload.");
    if (canvas && (canvas.width !== dimensions.width || canvas.height !== dimensions.height))
        throw new Error("SOG WebP canvas and payload dimensions differ.");
    return dimensions;
}
export async function decodeSogArchive(buffer: ArrayBuffer, decodeWebp: SplatWebpDecoder, signal?: AbortSignal): Promise<NativeSplatData> {
    abort(signal);
    if (buffer.byteLength > MAX_ARCHIVE_BYTES)
        throw new Error("SOG archive exceeds the 512 MiB decode limit.");
    const reader = new ZipReader(new Uint8ArrayReader(new Uint8Array(buffer)), { useWebWorkers: false });
    try {
        const entries = await reader.getEntries();
        if (entries.length > 32)
            throw new Error("SOG archive contains too many entries.");
        const indexed = new Map<string, (typeof entries)[number]>();
        let bytes = 0;
        for (const entry of entries) {
            if (entry.directory)
                continue;
            const name = safePath(entry.filename);
            if (indexed.has(name) || entry.encrypted)
                throw new Error("SOG archive contains duplicate or encrypted files.");
            if (entry.uncompressedSize > MAX_ENTRY_BYTES)
                throw new Error("SOG archive entry exceeds the decode limit.");
            bytes += entry.uncompressedSize;
            if (bytes > MAX_ARCHIVE_BYTES)
                throw new Error("SOG archive expands beyond the decode limit.");
            indexed.set(name, entry);
        }
        const metaNames = [...indexed.keys()].filter((name) => name === "meta.json" || name.endsWith("/meta.json"));
        if (metaNames.length !== 1)
            throw new Error("SOG archive must contain exactly one meta.json.");
        const metaName = nativeValue(metaNames[0]);
        const prefix = metaName.slice(0, -"meta.json".length);
        const extract = async (name: string): Promise<Uint8Array> => {
            abort(signal);
            const entry = indexed.get(name);
            if (!entry || entry.directory)
                throw new Error(`Missing SOG archive file: ${name}`);
            const result = await entry.getData(new Uint8ArrayWriter(), { checkSignature: true, signal });
            abort(signal);
            return result;
        };
        if (nativeValue(indexed.get(metaName)).uncompressedSize > 1024 * 1024)
            throw new Error("SOG metadata exceeds 1 MiB.");
        const meta = record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await extract(metaName))) as unknown, "metadata");
        const version = number(meta.version ?? 1, "version");
        if (version !== 1 && version !== 2)
            throw new Error(`Unsupported SOG version: ${String(version)}`);
        if (meta.antialias === true)
            throw new Error("Mip-antialiased SOG assets require conversion preserving their filter before native rendering.");
        const means = record(meta.means, "means"), scales = record(meta.scales, "scales"), quats = record(meta.quats, "quats"), sh0 = record(meta.sh0, "sh0");
        const shN = meta.shN === undefined ? undefined : record(meta.shN, "shN");
        const count = version === 2 ? number(meta.count, "count") : nativeValue(numbers(means.shape, 2, "means.shape")[0]);
        assertSplatCount(count);
        const mins = numbers(means.mins, 3, "means.mins"), maxs = numbers(means.maxs, 3, "means.maxs");
        if (mins.some((min, axis) => min > nativeValue(maxs[axis])))
            throw new Error("SOG position bounds are reversed.");
        const meansFiles = files(means, 2), shFiles = shN ? files(shN, 2) : [];
        const image = async (name: string): Promise<SplatImage> => {
            const encoded = await extract(prefix + name);
            const dimensions = inspectSogWebp(encoded);
            const decoded = await decodeWebp(encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength));
            abort(signal);
            if (decoded.width !== dimensions.width || decoded.height !== dimensions.height || decoded.data.length !== dimensions.width * dimensions.height * 4)
                throw new Error("SOG decoded image dimensions differ from its header.");
            return decoded;
        };
        // Decode sequentially: decoder WASM is shared and each plane has a bounded lifetime.
        const lower = await image(nativeValue(meansFiles[0])), upper = await image(nativeValue(meansFiles[1]));
        const scaleImage = await image(nativeValue(files(scales, 1)[0])), quatImage = await image(nativeValue(files(quats, 1)[0])), colorImage = await image(nativeValue(files(sh0, 1)[0]));
        const centersImage = shN ? await image(nativeValue(shFiles[0])) : undefined;
        const labelsImage = shN ? await image(nativeValue(shFiles[1])) : undefined;
        for (const plane of [lower, upper, scaleImage, quatImage, colorImage, labelsImage]) {
            if (plane && (plane.width !== lower.width || plane.height !== lower.height || plane.width * plane.height < count))
                throw new Error("SOG per-splat image dimensions do not match the declared count.");
        }
        const degree = centersImage ? ({ 192: 1, 512: 2, 960: 3 } as Record<number, number>)[centersImage.width] : 0;
        if (degree === undefined || (version === 2 && shN && number(shN.bands, "shN.bands") !== degree))
            throw new Error("SOG SH palette has an unsupported or mismatched degree.");
        const paletteCount = shN && version === 2 && shN.count !== undefined ? number(shN.count, "shN.count") : (centersImage?.height ?? 0) * 64;
        if (shN && (!Number.isInteger(paletteCount) || paletteCount < 1 || paletteCount > 65536 || Math.ceil(paletteCount / 64) !== nativeValue(centersImage).height))
            throw new Error("SOG SH palette count does not match its image.");
        const scaleCodebook = version === 2 ? codebook(scales, "scales") : undefined;
        const colorCodebook = version === 2 ? codebook(sh0, "sh0") : undefined;
        const shCodebook = version === 2 && shN ? codebook(shN, "shN") : undefined;
        const scaleMin = version === 1 ? numbers(scales.mins, 3, "scales.mins") : [], scaleMax = version === 1 ? numbers(scales.maxs, 3, "scales.maxs") : [];
        const colorMin = version === 1 ? numbers(sh0.mins, 4, "sh0.mins") : [], colorMax = version === 1 ? numbers(sh0.maxs, 4, "sh0.maxs") : [];
        const shMin = version === 1 && shN ? number(shN.mins, "shN.mins") : 0, shMax = version === 1 && shN ? number(shN.maxs, "shN.maxs") : 0;
        const data = allocateSplatData(count, degree, "sog");
        const shBytes = data.sh.map((values) => new Uint8ClampedArray(values.buffer));
        const coeffs = nativeValue(SH_COEFFICIENTS[degree]);
        const lerp = (a: number, b: number, t: number) => a * (1 - t) + b * t;
        const scaleLut = scaleCodebook?.map(Math.exp);
        const quaternion = [0, 0, 0, 0];
        for (let index = 0; index < count; index++) {
            const p = index * 4;
            for (let axis = 0; axis < 3; axis++) {
                const n = lerp(nativeValue(mins[axis]), nativeValue(maxs[axis]), (nativeValue(lower.data[p + axis]) + (nativeValue(upper.data[p + axis]) << 8)) / 65535);
                data.centers[index * 3 + axis] = Math.sign(n) * Math.expm1(Math.abs(n));
                const dc = colorCodebook ? nativeValue(colorCodebook[nativeValue(colorImage.data[p + axis])]) : lerp(nativeValue(colorMin[axis]), nativeValue(colorMax[axis]), nativeValue(colorImage.data[p + axis]) / 255);
                data.colors[p + axis] = (0.5 + SH_C0 * dc) * 255;
            }
            data.colors[p + 3] = version === 2 ? nativeValue(colorImage.data[p + 3]) : 255 / (1 + Math.exp(-lerp(nativeValue(colorMin[3]), nativeValue(colorMax[3]), nativeValue(colorImage.data[p + 3]) / 255)));
            const mode = nativeValue(quatImage.data[p + 3]) - 252;
            if (mode < 0 || mode > 3)
                throw new Error("SOG quaternion mode is invalid.");
            let sum = 0, source = 0;
            for (let component = 0; component < 4; component++) {
                if (component === mode)
                    continue;
                const value = (nativeValue(quatImage.data[p + source++]) / 255 - 0.5) * Math.SQRT2;
                quaternion[component] = value;
                sum += value * value;
            }
            quaternion[mode] = Math.sqrt(Math.max(0, 1 - sum));
            const scale = (axis: number) => scaleLut ? nativeValue(scaleLut[nativeValue(scaleImage.data[p + axis])]) : Math.exp(lerp(nativeValue(scaleMin[axis]), nativeValue(scaleMax[axis]), nativeValue(scaleImage.data[p + axis]) / 255));
            writeSplatCovariance(data.covariances, index * 6, scale(0), scale(1), scale(2), nativeValue(quaternion[1]), nativeValue(quaternion[2]), nativeValue(quaternion[3]), nativeValue(quaternion[0]));
            if (centersImage && labelsImage) {
                const label = nativeValue(labelsImage.data[p]) + (nativeValue(labelsImage.data[p + 1]) << 8);
                if (label >= paletteCount)
                    throw new Error("SOG SH label is outside the palette.");
                const paletteOffset = (Math.floor(label / 64) * centersImage.width + (label % 64) * coeffs) * 4;
                if (paletteOffset + coeffs * 4 > centersImage.data.length)
                    throw new Error("SOG SH label is outside the palette.");
                for (let band = 1; band <= degree; band++) {
                    const start = nativeValue(SH_COEFFICIENTS[band - 1]), end = nativeValue(SH_COEFFICIENTS[band]);
                    const target = nativeValue(shBytes[band - 1]);
                    for (let k = start; k < end; k++)
                        for (let channel = 0; channel < 3; channel++) {
                            const encoded = nativeValue(centersImage.data[paletteOffset + k * 4 + channel]);
                            const coefficient = shCodebook ? nativeValue(shCodebook[encoded]) : lerp(shMin, shMax, encoded / 255);
                            target[index * nativeValue(SH_WORDS[band]) * 4 + (k - start) * 3 + channel] = coefficient * 128 + 128;
                        }
                }
            }
        }
        abort(signal);
        return validateNativeData(data);
    }
    finally {
        await reader.close();
    }
}
