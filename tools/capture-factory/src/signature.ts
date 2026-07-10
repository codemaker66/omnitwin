import { open } from "node:fs/promises";
import { extname } from "node:path";
import type { CaptureFileFormat, CaptureFileSignature, E57PhysicalHeader } from "@omnitwin/types";

const SIGNATURE_BYTES = 48;
const E57_MAGIC = Buffer.from("ASTM-E57", "ascii");

function startsWith(bytes: Buffer, prefix: Buffer): boolean {
  return bytes.length >= prefix.length && bytes.subarray(0, prefix.length).equals(prefix);
}

function safeInteger(value: bigint, label: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} exceeds JavaScript's safe integer range`);
  }
  return Number(value);
}

function parseE57Header(bytes: Buffer, actualBytes: number): E57PhysicalHeader {
  if (bytes.length < SIGNATURE_BYTES) {
    throw new Error("ASTM E57 file is shorter than its 48-byte physical header");
  }
  const physicalLengthBytes = safeInteger(bytes.readBigUInt64LE(16), "E57 physical length");
  const xmlPhysicalOffsetBytes = safeInteger(bytes.readBigUInt64LE(24), "E57 XML offset");
  const xmlLogicalLengthBytes = safeInteger(bytes.readBigUInt64LE(32), "E57 XML length");
  const pageSizeBytes = safeInteger(bytes.readBigUInt64LE(40), "E57 page size");
  if (pageSizeBytes <= 0) {
    throw new Error("ASTM E57 page size must be positive");
  }
  return {
    versionMajor: bytes.readUInt32LE(8),
    versionMinor: bytes.readUInt32LE(12),
    physicalLengthBytes,
    xmlPhysicalOffsetBytes,
    xmlLogicalLengthBytes,
    pageSizeBytes,
    fileLengthMatchesHeader: physicalLengthBytes === actualBytes,
  };
}

function textPrefix(bytes: Buffer): string {
  return bytes.toString("utf8").trimStart().toLowerCase();
}

function inferFormat(bytes: Buffer, extension: string): CaptureFileFormat {
  const prefix = textPrefix(bytes);
  if (startsWith(bytes, E57_MAGIC)) return "e57";
  if (startsWith(bytes, Buffer.from([0xff, 0xd8, 0xff]))) return "jpeg";
  if (startsWith(bytes, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (startsWith(bytes, Buffer.from("%PDF-", "ascii"))) return "pdf";
  if (startsWith(bytes, Buffer.from("SQLite format 3\0", "ascii"))) return "sqlite";
  if (startsWith(bytes, Buffer.from("TBFM", "ascii"))) return "matterport_metadata";
  if (startsWith(bytes, Buffer.from("#LcUStream", "ascii"))) return "nwc";
  if (prefix.startsWith("ply")) return "ply";
  if (prefix.startsWith("mtllib") || extension === ".obj") return "wavefront_obj";
  if (prefix.startsWith("newmtl") || extension === ".mtl") return "wavefront_mtl";
  if (extension === ".xyz") return "xyz";
  if (extension === ".json") return "json";
  if (extension === ".py") return "python";
  if ([".txt", ".cfg", ".ini", ".sh"].includes(extension)) return "text";
  return "unknown";
}

export async function inspectFileSignature(path: string, sizeBytes: number): Promise<CaptureFileSignature> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(SIGNATURE_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const bytes = buffer.subarray(0, bytesRead);
    const extension = extname(path).toLowerCase();
    const format = inferFormat(bytes, extension);
    const e57Header = format === "e57" ? parseE57Header(bytes, sizeBytes) : null;
    if (e57Header !== null && !e57Header.fileLengthMatchesHeader) {
      throw new Error(`ASTM E57 physical length does not match file length: ${path}`);
    }
    return { format, magicHex: bytes.toString("hex"), e57Header };
  } finally {
    await handle.close();
  }
}
