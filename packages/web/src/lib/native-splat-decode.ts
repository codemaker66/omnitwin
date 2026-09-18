import { nativeValue } from "./native-splat-data.js";
import type { BufferGeometry } from "three";
import { GaussianSplatPLYLoader } from "three/addons/loaders/GaussianSplatPLYLoader.js";
import { decodeBoundedSpz } from "./native-splat-spz.js";
import { allocateSplatData, assertSplatCount, validateNativeData, writeSplatCovariance, type NativeSplatData } from "./native-splat-data.js";
import { decodeSogArchive } from "./native-splat-sog.js";
import { decodeSplatWebp } from "./native-splat-webp.js";
import { decodeKsplat } from "./native-splat-ksplat.js";
function geometryData(geometry: BufferGeometry, format: string): NativeSplatData {
    try {
        const position = geometry.getAttribute("position"), covariance = geometry.getAttribute("covariance"), color = geometry.getAttribute("color");
        assertSplatCount(position.count);
        if (!(position.array instanceof Float32Array) || !(covariance.array instanceof Float32Array) || !(color.array instanceof Uint8Array || color.array instanceof Uint8ClampedArray))
            throw new Error("Native loader returned unexpected attribute types.");
        const sh: Uint32Array[] = [];
        for (let band = 1; band <= 3; band++) {
            const name = `sphericalHarmonics${String(band)}`;
            if (!geometry.hasAttribute(name))
                break;
            const attribute = geometry.getAttribute(name);
            if (!(attribute.array instanceof Uint32Array))
                throw new Error("Native loader returned unpacked spherical harmonics.");
            sh.push(attribute.array);
        }
        return validateNativeData({ format, centers: position.array, covariances: covariance.array, colors: new Uint8ClampedArray(color.array.buffer, color.array.byteOffset, color.array.byteLength), sh });
    }
    finally {
        geometry.dispose();
    }
}
/** Standard 32-byte SPLAT records: xyz, scales, RGBA, unsigned wxyz quaternion. */
export function decodeSplatRecords(buffer: ArrayBuffer): NativeSplatData {
    if (buffer.byteLength % 32 !== 0)
        throw new Error("SPLAT file length must be a multiple of 32 bytes.");
    const data = allocateSplatData(buffer.byteLength / 32, 0, "splat");
    const view = new DataView(buffer), bytes = new Uint8Array(buffer);
    for (let i = 0; i < data.centers.length / 3; i++) {
        const base = i * 32;
        for (let axis = 0; axis < 3; axis++)
            data.centers[i * 3 + axis] = view.getFloat32(base + axis * 4, true);
        data.colors.set(bytes.subarray(base + 24, base + 28), i * 4);
        const scales = [view.getFloat32(base + 12, true), view.getFloat32(base + 16, true), view.getFloat32(base + 20, true)];
        if (scales.some((value) => value < 0 || !Number.isFinite(value)))
            throw new Error("Invalid SPLAT scale.");
        writeSplatCovariance(data.covariances, i * 6, nativeValue(scales[0]), nativeValue(scales[1]), nativeValue(scales[2]), (nativeValue(bytes[base + 29]) - 128) / 128, (nativeValue(bytes[base + 30]) - 128) / 128, (nativeValue(bytes[base + 31]) - 128) / 128, (nativeValue(bytes[base + 28]) - 128) / 128);
    }
    return validateNativeData(data);
}
/** Keep the upstream PLY converter, but bound its temporary JS property arrays. */
export function decodeNativePly(buffer: ArrayBuffer, chunkLimit = 250000): NativeSplatData {
    if (!Number.isInteger(chunkLimit) || chunkLimit < 1 || chunkLimit > 250000)
        throw new Error("Invalid native PLY chunk limit.");
    const headerBytes = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 1024 * 1024));
    const headerText = new TextDecoder().decode(headerBytes);
    const ending = /end_header\r?\n/u.exec(headerText);
    if (!ending)
        throw new Error("PLY header is missing or exceeds 1 MiB.");
    const header = headerText.slice(0, ending.index + ending[0].length);
    const countMatch = /^element vertex (\d+)\r?$/mu.exec(header);
    if (!countMatch)
        throw new Error("PLY does not declare a vertex count.");
    const count = Number(countMatch[1]);
    assertSplatCount(count);
    const loader = new GaussianSplatPLYLoader();
    if (count <= chunkLimit)
        return geometryData(loader.parse(buffer), "ply");
    // Other layouts still use the official parser; reject unsafe huge arrays rather than
    // failing with an opaque RangeError or silently truncating source geometry.
    const properties = [...header.matchAll(/^property (\S+) (\S+)\r?$/gmu)];
    const elements = [...header.matchAll(/^element (\S+) (\d+)\r?$/gmu)];
    if (!header.includes("format binary_little_endian 1.0") || elements.length !== 1 || properties.some((property) => property[1] !== "float" && property[1] !== "float32")) {
        throw new Error("Large PLY requires binary little-endian float32 vertex records; convert this asset to SOG or SPZ.");
    }
    const headerLength = new TextEncoder().encode(header).length;
    const stride = properties.length * 4;
    if (stride === 0 || headerLength + stride * count !== buffer.byteLength)
        throw new Error("PLY vertex payload length does not match its header.");
    let result: NativeSplatData | undefined;
    for (let base = 0; base < count; base += chunkLimit) {
        const chunkCount = Math.min(chunkLimit, count - base);
        const chunkHeader = new TextEncoder().encode(header.replace(/^element vertex \d+\r?$/mu, `element vertex ${String(chunkCount)}`));
        const chunk = new Uint8Array(chunkHeader.length + chunkCount * stride);
        chunk.set(chunkHeader);
        chunk.set(new Uint8Array(buffer, headerLength + base * stride, chunkCount * stride), chunkHeader.length);
        const decoded = geometryData(loader.parse(chunk.buffer), "ply");
        result ??= allocateSplatData(count, decoded.sh.length, "ply");
        result.centers.set(decoded.centers, base * 3);
        result.covariances.set(decoded.covariances, base * 6);
        result.colors.set(decoded.colors, base * 4);
        decoded.sh.forEach((values, band) => { nativeValue(nativeValue(result).sh[band]).set(values, base * values.length / chunkCount); });
    }
    if (!result)
        throw new Error("PLY contains no vertices.");
    return result;
}
export async function decodeNativeSplatBuffer(buffer: ArrayBuffer, url: string, signal?: AbortSignal): Promise<NativeSplatData> {
    signal?.throwIfAborted();
    const extension = new URL(url, "https://native-splat.invalid/").pathname.toLowerCase().split(".").pop();
    if (extension === "sog")
        return decodeSogArchive(buffer, decodeSplatWebp, signal);
    if (extension === "ply")
        return decodeNativePly(buffer);
    if (extension === "spz") {
        const geometry = await decodeBoundedSpz(buffer, signal);
        return geometryData(geometry, "spz");
    }
    if (extension === "splat")
        return decodeSplatRecords(buffer);
    if (extension === "rad" || extension === "radc")
        throw new Error("RAD is a legacy renderer LOD tree. Select this capture's original SOG, PLY or SPZ source for native rendering.");
    if (extension === "ksplat")
        return decodeKsplat(buffer);
    throw new Error(`Unsupported native splat format: ${extension ?? "missing extension"}`);
}
