import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve through node:path so Vite does not rewrite this as a served asset URL.
const publicRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../public");

/** A file under packages/web/public, by its site path ("/images/…"). */
export function publicAsset(path: string): Buffer {
  return readFileSync(resolve(publicRoot, path.slice(1)));
}

/** Pixel dimensions from a WebP (VP8, VP8L or VP8X), PNG or JPEG header. */
export function imageSize(bytes: Buffer): { readonly width: number; readonly height: number } {
  if (bytes.toString("ascii", 0, 4) === "RIFF") {
    const chunk = bytes.toString("ascii", 12, 16);
    if (chunk === "VP8 ") return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
    if (chunk === "VP8L") {
      const bits = bytes.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
  }
  if (bytes.readUInt32BE(0) === 0x89504e47) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  for (let offset = 2; offset + 9 < bytes.length;) {
    const marker = bytes.readUInt16BE(offset);
    const length = bytes.readUInt16BE(offset + 2);
    if (marker >= 0xffc0 && marker <= 0xffcf && ![0xffc4, 0xffc8, 0xffcc].includes(marker)) {
      return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
    }
    offset += 2 + length;
  }
  throw new Error("Unrecognised image header");
}

/** "a.webp 56w, b.webp 112w" as paths and widths, in order. */
export function srcSetRungs(srcSet: string): readonly { readonly path: string; readonly width: number }[] {
  return srcSet.split(", ").map((entry) => {
    const [path = "", descriptor = ""] = entry.split(" ");
    return { path, width: Number(descriptor.replace(/w$/u, "")) };
  });
}
