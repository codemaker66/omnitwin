import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rename,
  rm,
  type FileHandle,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { inflateSync } from "node:zlib";

import sharp from "sharp";

import { buildGrandHallVisibleFirstRadianceComparison } from "./grand-hall-visible-first-radiance-comparison.js";
import { parseGrandHallT554StrictJson } from "./grand-hall-t554-strict-json.js";

export const GRAND_HALL_NATIVE_INCLUSIVE_COMPARISON_SCHEMA =
  "venviewer.grand-hall.native-inclusive-visible-first-comparison.v1";
export const GRAND_HALL_NATIVE_INCLUSIVE_RECEIPT = "native-inclusive-comparison-receipt.json";
export const GRAND_HALL_NATIVE_INCLUSIVE_SIDE_BY_SIDE = "sog-spz-native-side-by-side.png";
export const GRAND_HALL_NATIVE_INCLUSIVE_DIFFS = Object.freeze([
  "sog-spz-absolute-rgb-difference-x8.png",
  "sog-native-absolute-rgb-difference-x8.png",
  "spz-native-absolute-rgb-difference-x8.png",
]);

const WIDTH = 1600;
const HEIGHT = 900;
const CHANNELS = 3;
const CAMERA_SHA = "sha256:9eca9b6582b7301ec1c059b1a5be699e5a4983773afecb2beea46c2668305922";
const CAMERA_ID = "source-pose-19890-interior-v1";
const NATIVE_SCHEMA = "venviewer.grand-hall.lcc-native-capture-receipt.v14";
const OPERATOR_SCHEMA = "venviewer.grand-hall.lcc-native-capture-operator-receipt.v4";
const BROWSER_RECEIPT_NAME = "visible-first-browser-bakeoff-receipt.json";
const BROWSER_CAMERA_NAME = "source-pose-19890-interior-v1-9eca9b6582b7301ec1c059b1a5be699e5a4983773afecb2beea46c2668305922.json";
const BROWSER_ROOT_ADDITIONAL_FROZEN_NOTE = "native-v4-exact-target-callback-rejection.json";
const EXPECTED_SCENE = "C:\\GRAND_HALL_BIG_MODEL_VARIATIONS\\scans_BIG_MODEL_TH_GH_1\\lcc2-result\\Grand_Hall.lcc2";
const EXPECTED_EDITOR = "C:\\Users\\blake\\AppData\\Local\\Venviewer\\lcc-native-capture-sandbox\\lcceditor-0.15.0.7\\LCCEditor.exe";
const EXPECTED_MODULE_ROOT = "C:\\Users\\blake\\AppData\\Local\\Venviewer\\lcc-native-capture-sandbox\\lcceditor-0.15.0.7\\Modules\\Venviewer Native Capture";
const EXPECTED_BUILD_RECEIPT = "C:\\Users\\blake\\omnitwin2-grand-hall-exact-runtime\\tools\\reconstruction-foundry\\native\\grand-hall-lcc-native-capture\\out\\build-receipt.json";
const EXPECTED_OPERATOR_SOURCE = "C:\\Users\\blake\\omnitwin2-grand-hall-exact-runtime\\tools\\reconstruction-foundry\\native\\grand-hall-lcc-native-capture\\run-capture.ps1";
const EXPECTED_FEATURE_ROOT = "C:\\Users\\blake\\AppData\\LocalLow\\XGrids\\LCCEditor\\feature_toggles";
const EXPECTED_RUNTIME_ROOT = "C:\\Users\\blake\\AppData\\Local\\Venviewer\\lcc-native-capture-sandbox\\lcceditor-0.15.0.7";
const EXPECTED_HASHES = Object.freeze({
  browserBakeoffReceipt: "22b412f07a9eaa84655fafbdaae09f31f694c6b8f0d1eafc11c2665cab2c587f",
  browserComparisonReceipt: "b82b428b309368cf9a9ab129a683e2296bc9edd6b677ba5eba64e2925c2e1776",
  browserGitSha: "8a71c1b7d6e7abd07cae4479e642905dd8ba16a3",
  operatorReceipt: "a37fa98ee31abbd14a96a91462e571c2aed2b4b6e8b51d4918cda39efe7e314e",
  nativeReceipt: "a97006c8facd90b8e4e8d4914acc72ea63ffbb967754ac9aaca4132c99369f90",
  receiptSidecar: "abf3ed84fb373b76edac18071cf5cf89c6f79738ef2ee0cd7603600301daded9",
  runLog: "5de2d06f1b922326dea9da7509ab7ec113bb1d3fd8866d1f563ccb2b02280b28",
  png8: "c08e5f2074792e852635b3ae6b48d1cdc114c440efd6f604f31f9ed1827c13e7",
  rawRgb24: "aa5caa2c91da3e9526bb538d77d495848dbe15fd6217b1470138e6bd3cea2364",
  png16: "6fb177906d1a0f4484b2c5b664453439cd776fa6b7ed7f844f0906eb892e8b69",
  expanded16Samples: "f2d029ffcd03cfeef21e57eadff8be67c686354222f699ece8fdaccb9bcdb42a",
  buildReceipt: "b3fb90a93e0e8f3da81301557d0c706998d0cedd230ba3921739b039c7ebb08a",
  module: "2b7de5c1d6475f7c34ad4ee8c2bbf4a96ec2c454d5b4e094410cbdc7ee954e19",
  plugin: "453c74eab820f2b70db9101b777b41af9171e077a00e79b7a0781c25262ac55b",
  runtimeClosureLock: "f3ced55c3bd215fbc8bba49be453829d67d689a6a42d2f3a338eff2a0d95cec5",
  runtimeClosureInventory: "e76dae03144f07e47c1600582ac6a15b19a21812c5648e0c864f86b61f328cf8",
  cameraProfile: CAMERA_SHA.slice("sha256:".length),
  operatorSource: "2210186770c357cff583be060a11be83b2dc776ab5efcc124d0b4c073675b7c6",
  packageManifest: "927a92699de222e99d2684ca2567a35ab1e523a036461e6e01236b7b77b7f659",
  packageInventory: "6013763ae4d9fa13cb10d2c62e9b11b971bc2f22420ca2ade6f736aeecc4b793",
  featureOriginal: "8ff16cac30f3f49a71be9a06d486b1bb9b682e0ccf1c5c35869a251d98313531",
  featureAugmented: "efaed3905bb30f9875c1db47c7449110966f31bb3783db5c09216f509715c020",
});
const FILES = Object.freeze({
  operator: "grand-hall-native-capture-operator-receipt.json",
  receipt: "grand-hall-native-capture-receipt.json",
  sidecar: "grand-hall-native-capture-receipt.json.sha256",
  log: "grand-hall-native-capture-player-log-run.log",
  png8: "grand-hall-native-capture-1600x900.png",
  raw: "grand-hall-native-capture-1600x900.unorm-lower-left.rgb24",
  png16: "grand-hall-native-capture-1600x900.srgb-tagged-expanded16.png",
});
const CANDIDATE_FILES = Object.freeze([
  ".native-candidate-001.png",
  ".native-candidate-002.png",
  ".native-candidate-003.png",
  ".native-srgb-tagged-expanded16-candidate-001.png",
  ".native-srgb-tagged-expanded16-candidate-002.png",
  ".native-srgb-tagged-expanded16-candidate-003.png",
  ".native-unorm-rgb24-candidate-001.rgb24",
  ".native-unorm-rgb24-candidate-002.rgb24",
  ".native-unorm-rgb24-candidate-003.rgb24",
]);
const EXPECTED_NATIVE_INVENTORY = Object.freeze([...Object.values(FILES), ...CANDIDATE_FILES]);
const EXPECTED_DBUFFER_ERROR = "ERROR: Shader Hidden/Universal Render Pipeline/DBufferClear shader is not supported on this GPU (none of subshaders/fallbacks are suitable)";
const EXPECTED_WMF_WARNING = `Color primaries 0 is unknown or unsupported by WindowsMediaFoundation. Falling back to default may result in color shift. ${EXPECTED_RUNTIME_ROOT}\\LCCEditor_Data\\sharedassets0.resource`;
const TERMINAL_SHUTDOWN_MARKER = "Input System module state changed to: Shutdown.";
const PNG_CHUNK_ORDER = "IHDR,sRGB,gAMA,cHRM,IDAT,IEND";
const PNG_SRGB_CHROMATICITIES = Object.freeze([31_270, 32_900, 64_000, 33_000, 30_000, 60_000, 15_000, 6_000]);

export class GrandHallNativeInclusiveComparisonError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

function fail(code: string, message: string): never {
  throw new GrandHallNativeInclusiveComparisonError(code, message);
}
function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("RECEIPT_INVALID", `${label} must be an object.`);
  return value as Record<string, unknown>;
}
function exact(value: unknown, expected: unknown, label: string): void {
  if (value !== expected) fail("RECEIPT_INVALID", `${label} is not the approved value.`);
}
function exactJson(value: unknown, expected: unknown, label: string): void {
  if (canonical(value) !== canonical(expected)) fail("RECEIPT_INVALID", `${label} is not the approved structured value.`);
}
function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") fail("RECEIPT_INVALID", `${label} must be a string.`);
  return value;
}
function sha(bytes: Buffer): string { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }
function bareSha(bytes: Buffer): string { return sha(bytes).slice(7); }
function normalizedSha(value: unknown, label: string): string {
  const text = stringValue(value, label);
  if (!/^(?:sha256:)?[a-fA-F0-9]{64}$/u.test(text)) fail("RECEIPT_INVALID", `${label} is not one exact SHA-256 value.`);
  return text.toLowerCase().replace(/^sha256:/u, "");
}
function sameSha(actual: unknown, bytes: Buffer, label: string): void {
  if (normalizedSha(actual, label) !== bareSha(bytes)) fail("HASH_MISMATCH", `${label} does not bind the local artifact.`);
}
function frozenSha(bytes: Buffer, expected: string, label: string): void {
  if (bareSha(bytes) !== expected) fail("FROZEN_EVIDENCE_MISMATCH", `${label} is not the reviewed frozen artifact.`);
}
function exactSha(value: unknown, expected: string, label: string): void {
  if (normalizedSha(value, label) !== expected) fail("FROZEN_EVIDENCE_MISMATCH", `${label} is not the reviewed frozen SHA-256.`);
}
function samePath(left: string, right: string): boolean {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}
function pathWithin(root: string, candidate: string): boolean {
  const delta = relative(root, candidate);
  return delta === "" || (!delta.startsWith(`..${sep}`) && delta !== ".." && !isAbsolute(delta));
}
interface FileIdentity { readonly dev: number; readonly ino: number; readonly nlink: number; readonly size: number; readonly mtimeMs: number; readonly ctimeMs: number; }
interface ObjectIdentity { readonly dev: number; readonly ino: number; }
function identity(stat: Stats): FileIdentity {
  return { dev: stat.dev, ino: stat.ino, nlink: stat.nlink, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs };
}
function objectIdentity(stat: Stats): ObjectIdentity { return { dev: stat.dev, ino: stat.ino }; }
function sameObject(left: ObjectIdentity, right: ObjectIdentity): boolean { return left.dev === right.dev && left.ino === right.ino; }
function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.nlink === right.nlink && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}
async function stableFile(path: string, label: string): Promise<Buffer> {
  const before = await lstat(path).catch(() => fail("FILE_MISSING", `${label} is missing.`));
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) fail("FILE_INVALID", `${label} must be one direct, singly linked regular file.`);
  const handle = await open(path, "r");
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || !sameIdentity(identity(before), identity(opened))) fail("FILE_DRIFT", `${label} changed before its handle was bound.`);
    const bytes = await handle.readFile();
    const [handleAfter, pathAfter] = await Promise.all([handle.stat(), lstat(path)]);
    if (!handleAfter.isFile() || pathAfter.isSymbolicLink() || !pathAfter.isFile()
      || !sameIdentity(identity(opened), identity(handleAfter)) || !sameIdentity(identity(opened), identity(pathAfter))
      || bytes.length !== opened.size) {
      fail("FILE_DRIFT", `${label} changed while it was read.`);
    }
    return bytes;
  } finally {
    await handle.close();
  }
}
async function strictDirectDirectory(path: string, label: string): Promise<{ readonly root: string; readonly identity: ObjectIdentity }> {
  if (!isAbsolute(path) || resolve(path) !== path) fail("ARGUMENT_INVALID", `${label} must be absolute and normalized.`);
  const stat = await lstat(path).catch(() => fail("ARGUMENT_INVALID", `${label} is missing.`));
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("ARGUMENT_INVALID", `${label} must be a direct directory, not a link.`);
  await realpath(path).catch(() => fail("PATH_ESCAPE", `${label} cannot be resolved.`));
  return { root: path, identity: objectIdentity(stat) };
}
async function requireDirectoryIdentity(path: string, expected: ObjectIdentity, label: string): Promise<void> {
  const current = await lstat(path).catch(() => fail("PATH_ESCAPE", `${label} disappeared.`));
  if (!current.isDirectory() || current.isSymbolicLink() || !sameObject(objectIdentity(current), expected)) fail("PATH_ESCAPE", `${label} identity changed.`);
  await realpath(path).catch(() => fail("PATH_ESCAPE", `${label} cannot be resolved.`));
}
function exactInventory(expected: readonly string[], actual: readonly string[], label: string): void {
  const left = [...expected].sort((a, b) => a.localeCompare(b));
  const right = [...actual].sort((a, b) => a.localeCompare(b));
  if (canonical(left) !== canonical(right)) fail("INVENTORY_INVALID", `${label} has missing or unexpected entries.`);
}
function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const obj = record(value, "canonical JSON value");
  return `{${Object.keys(obj).sort().map((key) => `${JSON.stringify(key)}:${canonical(obj[key])}`).join(",")}}`;
}
function canonicalBytes(value: unknown): Buffer { return Buffer.from(`${canonical(value)}\n`, "utf8"); }

async function decodePng8(bytes: Buffer, label: string): Promise<Buffer> {
  let metadata;
  try {
    metadata = await sharp(bytes, { failOn: "error", limitInputPixels: WIDTH * HEIGHT }).metadata();
  } catch (error) {
    fail("IMAGE_INVALID", `${label} is not a valid PNG: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (metadata.format !== "png" || metadata.width !== WIDTH || metadata.height !== HEIGHT
    || metadata.channels !== CHANNELS || metadata.hasAlpha || metadata.depth !== "uchar"
    || metadata.space !== "srgb" || metadata.isPalette
    || (metadata.pages !== undefined && metadata.pages !== 1)
    || (metadata.bitsPerSample !== undefined && metadata.bitsPerSample !== 8)
    || (metadata.orientation !== undefined && metadata.orientation !== 1)
    || metadata.icc !== undefined || metadata.exif !== undefined || metadata.xmp !== undefined || metadata.iptc !== undefined) {
    fail("IMAGE_INVALID", `${label} must be one opaque, unprofiled, unrotated 1600x900 RGB8 sRGB PNG.`);
  }
  try {
    const decoded = await sharp(bytes, { failOn: "error", limitInputPixels: WIDTH * HEIGHT }).raw().toBuffer({ resolveWithObject: true });
    if (decoded.info.width !== WIDTH || decoded.info.height !== HEIGHT || decoded.info.channels !== CHANNELS
      || decoded.data.length !== WIDTH * HEIGHT * CHANNELS) fail("IMAGE_INVALID", `${label} is not opaque RGB8.`);
    return decoded.data;
  } catch (error) {
    if (error instanceof GrandHallNativeInclusiveComparisonError) throw error;
    fail("IMAGE_INVALID", `${label} could not be decoded: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function flipLowerLeft(raw: Buffer): Buffer {
  if (raw.length !== WIDTH * HEIGHT * CHANNELS) fail("RAW_INVALID", "Native RGB24 has the wrong byte length.");
  const result = Buffer.allocUnsafe(raw.length);
  const stride = WIDTH * CHANNELS;
  for (let y = 0; y < HEIGHT; y += 1) raw.copy(result, y * stride, (HEIGHT - 1 - y) * stride, (HEIGHT - y) * stride);
  return result;
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface ParsedStrictPng {
  readonly bitDepth: 8 | 16;
  readonly inflated: Buffer;
  readonly rowBytes: number;
}

function parseGrandHallStrictTaggedPng(bytes: Buffer, expectedBitDepth: 8 | 16, label: string): ParsedStrictPng {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const errorCode = expectedBitDepth === 8 ? "PNG8_INVALID" : "PNG16_INVALID";
  if (bytes.length < 8 || bytes.subarray(0, 8).compare(signature) !== 0) fail(errorCode, `${label} has an invalid PNG signature.`);
  let offset = 8;
  const types: string[] = [];
  const idat: Buffer[] = [];
  const ancillary = new Map<string, Buffer>();
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) fail(errorCode, `${label} has a truncated chunk header.`);
    const length = bytes.readUInt32BE(offset); const typeBytes = bytes.subarray(offset + 4, offset + 8); const type = typeBytes.toString("ascii");
    const dataStart = offset + 8; const dataEnd = dataStart + length; const crcOffset = dataEnd;
    if (!/^[A-Za-z]{4}$/u.test(type) || crcOffset + 4 > bytes.length) fail(errorCode, `${label} has a malformed or truncated chunk.`);
    const data = bytes.subarray(dataStart, dataEnd); const expectedCrc = bytes.readUInt32BE(crcOffset);
    if (crc32(Buffer.concat([typeBytes, data])) !== expectedCrc) fail(errorCode, `${label} ${type} CRC is invalid.`);
    types.push(type);
    if (type === "IHDR") {
      if (length !== 13 || data.readUInt32BE(0) !== WIDTH || data.readUInt32BE(4) !== HEIGHT
        || data[8] !== expectedBitDepth || data[9] !== 2 || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) {
        fail(errorCode, `${label} IHDR is not strict 1600x900 RGB${String(expectedBitDepth)} non-interlaced PNG.`);
      }
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "sRGB" || type === "gAMA" || type === "cHRM") {
      ancillary.set(type, data);
    }
    offset = crcOffset + 4;
    if (type === "IEND") break;
  }
  if (offset !== bytes.length || types.join(",") !== PNG_CHUNK_ORDER || idat.length !== 1) {
    fail(errorCode, `${label} chunk inventory/order is not the exact approved contract.`);
  }
  const srgb = ancillary.get("sRGB"); const gamma = ancillary.get("gAMA"); const chromaticities = ancillary.get("cHRM");
  if (srgb?.length !== 1 || srgb[0] !== 0 || gamma?.length !== 4 || gamma.readUInt32BE(0) !== 45_455 || chromaticities?.length !== 32) {
    fail(errorCode, `${label} does not carry the exact approved sRGB colour declarations.`);
  }
  for (const [index, expected] of PNG_SRGB_CHROMATICITIES.entries()) {
    if (chromaticities.readUInt32BE(index * 4) !== expected) fail(errorCode, `${label} cHRM values are not exact sRGB chromaticities.`);
  }
  let inflated: Buffer;
  const rowBytes = WIDTH * CHANNELS * (expectedBitDepth / 8);
  const expectedInflatedLength = HEIGHT * (rowBytes + 1);
  try {
    inflated = inflateSync(Buffer.concat(idat), { maxOutputLength: expectedInflatedLength });
  } catch (error) {
    fail(errorCode, `${label} IDAT cannot be boundedly inflated: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (inflated.length !== expectedInflatedLength) fail(errorCode, `${label} decoded length drifted.`);
  for (let row = 0; row < HEIGHT; row += 1) if (inflated[row * (rowBytes + 1)] !== 0) fail(errorCode, `${label} must use filter zero on every row.`);
  return { bitDepth: expectedBitDepth, inflated, rowBytes };
}

export function verifyGrandHallNativePng8(bytes: Buffer): Buffer {
  const parsed = parseGrandHallStrictTaggedPng(bytes, 8, "Native PNG8");
  const rgb = Buffer.allocUnsafe(WIDTH * HEIGHT * CHANNELS);
  for (let row = 0; row < HEIGHT; row += 1) {
    const sourceStart = row * (parsed.rowBytes + 1) + 1;
    parsed.inflated.copy(rgb, row * parsed.rowBytes, sourceStart, sourceStart + parsed.rowBytes);
  }
  return rgb;
}

export function verifyGrandHallExpandedPng16(bytes: Buffer, png8: Buffer): void {
  if (png8.length !== WIDTH * HEIGHT * CHANNELS) fail("PNG16_INVALID", "Native PNG8 comparison raster has the wrong byte length.");
  const parsed = parseGrandHallStrictTaggedPng(bytes, 16, "Native expanded PNG16");
  let sampleIndex = 0;
  for (let row = 0; row < HEIGHT; row += 1) {
    const rowStart = row * (parsed.rowBytes + 1);
    for (let byteOffset = rowStart + 1; byteOffset < rowStart + 1 + parsed.rowBytes; byteOffset += 2) {
      const sample8 = png8[sampleIndex];
      if (sample8 === undefined || parsed.inflated[byteOffset] !== sample8 || parsed.inflated[byteOffset + 1] !== sample8) fail("PNG16_INVALID", "Native expanded PNG16 is not exact big-endian value*257 expansion.");
      sampleIndex += 1;
    }
  }
}

export function verifyGrandHallNativePixelBindings(png8Bytes: Buffer, rawBytes: Buffer, png16Bytes: Buffer): Buffer {
  const png8 = verifyGrandHallNativePng8(png8Bytes);
  if (flipLowerLeft(rawBytes).compare(png8) !== 0) fail("PIXEL_BINDING_INVALID", "PNG8 pixels are not byte-identical to vertically flipped native RGB24.");
  verifyGrandHallExpandedPng16(png16Bytes, png8);
  return png8;
}

interface NativeEvidence { readonly rgb: Buffer; readonly bindings: Record<string, unknown>; }

function integerValue(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) fail("RECEIPT_INVALID", `${label} must be a safe integer.`);
  return value;
}

function strictRelativeMember(value: unknown, label: string): string {
  const member = stringValue(value, label);
  const parts = member.split(/[\\/]/u);
  if (member.length === 0 || member.startsWith("/") || member.startsWith("\\") || member.includes(":")
    || parts.some((part) => part.length === 0 || part === "." || part === "..")) {
    fail("RECEIPT_INVALID", `${label} is not a strict package-relative path.`);
  }
  return member;
}

function verifyReceiptInventory(
  unknownMembers: unknown,
  expectedCount: number,
  expectedTotal: number,
  expectedDigest: string,
  label: string,
  sortBeforeDigest: boolean,
): readonly Record<string, unknown>[] {
  if (!Array.isArray(unknownMembers) || unknownMembers.length !== expectedCount) fail("RECEIPT_INVALID", `${label} member count is not exact.`);
  const members = unknownMembers.map((value, index) => record(value, `${label} member ${String(index + 1)}`));
  const rows = members.map((member, index) => {
    const memberLabel = `${label} member ${String(index + 1)}`;
    const relativePath = strictRelativeMember(member.relativePath, `${memberLabel} relativePath`);
    const byteLength = integerValue(member.byteLength, `${memberLabel} byteLength`);
    if (byteLength < 0) fail("RECEIPT_INVALID", `${memberLabel} byteLength must be non-negative.`);
    return { relativePath, byteLength, digest: normalizedSha(member.sha256, `${memberLabel} sha256`) };
  });
  if (new Set(rows.map((row) => row.relativePath.toLowerCase())).size !== rows.length) fail("RECEIPT_INVALID", `${label} contains duplicate member paths.`);
  const total = rows.reduce((sum, row) => sum + row.byteLength, 0);
  if (total !== expectedTotal) fail("RECEIPT_INVALID", `${label} total byte length drifted.`);
  const digestRows = sortBeforeDigest
    ? [...rows].sort((left, right) => left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0)
    : rows;
  const material = digestRows.map((row) => `${row.relativePath}|${String(row.byteLength)}|${row.digest.toUpperCase()}\n`).join("");
  if (bareSha(Buffer.from(material, "utf8")) !== expectedDigest) fail("FROZEN_EVIDENCE_MISMATCH", `${label} inventory material does not reproduce its frozen digest.`);
  return members;
}

async function requireAbsent(path: string, label: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  fail("FEATURE_RESTORE_INVALID", `${label} must be absent.`);
}

async function validateFrozenBuildAndLease(operator: Record<string, unknown>): Promise<void> {
  const build = record(operator.buildEvidence, "operator buildEvidence");
  exact(build.buildReceiptPath, EXPECTED_BUILD_RECEIPT, "operator build receipt path");
  exactSha(build.buildReceiptSha256, EXPECTED_HASHES.buildReceipt, "operator build receipt sha256");
  exact(build.schemaVersion, "venviewer.grand-hall.lcc-native-capture-build-receipt.v1", "operator build schema");
  exact(build.networkUsed, false, "operator build networkUsed");
  exact(build.vendorBinariesCopiedIntoRepository, false, "operator build vendor copy claim");
  const tests = record(build.tests, "operator build tests");
  for (const name of ["liveCanonicalPackageVerified", "runtimeClosureVerified", "displayEncodingTestsPassed", "playerLogAuditSelfTestPassed", "passed"]) exact(tests[name], true, `operator build test ${name}`);
  exactSha(build.moduleSha256, EXPECTED_HASHES.module, "operator build module sha256");
  exactSha(build.pluginManifestSha256, EXPECTED_HASHES.plugin, "operator build plugin sha256");
  exactSha(build.runtimeClosureLockSha256, EXPECTED_HASHES.runtimeClosureLock, "operator build runtime lock sha256");
  exactSha(build.runtimeClosureInventorySha256, EXPECTED_HASHES.runtimeClosureInventory, "operator build runtime inventory sha256");
  exactSha(build.cameraProfileSha256, EXPECTED_HASHES.cameraProfile, "operator build camera sha256");
  exact(build.operatorSourcePath, EXPECTED_OPERATOR_SOURCE, "operator source path");
  exact(build.operatorSourceByteLength, 129_478, "operator source byte length");
  exactSha(build.operatorSourceSha256, EXPECTED_HASHES.operatorSource, "operator source sha256");
  exact(build.operatorSourceBoundToBuildReceipt, true, "operator source build binding");

  const frozenFiles = await Promise.all([
    stableFile(EXPECTED_BUILD_RECEIPT, "frozen native build receipt"),
    stableFile(EXPECTED_OPERATOR_SOURCE, "frozen operator source"),
    stableFile(join(EXPECTED_MODULE_ROOT, "VenviewerNativeCapture.dll"), "frozen native module"),
    stableFile(join(EXPECTED_MODULE_ROOT, "plugin.json"), "frozen plugin manifest"),
    stableFile(join(EXPECTED_MODULE_ROOT, "runtime-closure-lock.json"), "frozen runtime closure lock"),
    stableFile(join(EXPECTED_MODULE_ROOT, "camera-profile.json"), "frozen camera profile"),
    stableFile(EXPECTED_SCENE, "frozen canonical package manifest"),
  ]);
  const frozenExpected = [
    EXPECTED_HASHES.buildReceipt,
    EXPECTED_HASHES.operatorSource,
    EXPECTED_HASHES.module,
    EXPECTED_HASHES.plugin,
    EXPECTED_HASHES.runtimeClosureLock,
    EXPECTED_HASHES.cameraProfile,
    EXPECTED_HASHES.packageManifest,
  ] as const;
  for (const [index, bytes] of frozenFiles.entries()) {
    const expected = frozenExpected[index];
    if (expected === undefined) fail("INTERNAL_ERROR", "Frozen build evidence inventory is incomplete.");
    frozenSha(bytes, expected, `frozen build/source artifact ${String(index + 1)}`);
  }

  const lease = record(operator.featureToggleLease, "operator featureToggleLease");
  const activePath = join(EXPECTED_FEATURE_ROOT, "module_toggles.dat");
  const backupPath = join(EXPECTED_FEATURE_ROOT, ".module_toggles.dat.venviewer-native-capture.original");
  const markerPath = join(EXPECTED_FEATURE_ROOT, ".module_toggles.dat.venviewer-native-capture.lease.json");
  exact(lease.activePath, activePath, "feature active path"); exact(lease.backupPath, backupPath, "feature backup path"); exact(lease.leaseMarkerPath, markerPath, "feature marker path");
  exactSha(lease.expectedOriginalSha256, EXPECTED_HASHES.featureOriginal, "feature expected original sha256");
  for (const name of ["originalSha256", "backupSha256", "restoredSha256"]) exactSha(lease[name], EXPECTED_HASHES.featureOriginal, `feature ${name}`);
  for (const name of ["augmentedSha256", "preRestoreSha256"]) exactSha(lease[name], EXPECTED_HASHES.featureAugmented, `feature ${name}`);
  const preRestoreExpected = lease.preRestoreExpectedHashes;
  if (!Array.isArray(preRestoreExpected) || preRestoreExpected.length !== 2
    || normalizedSha(preRestoreExpected[0], "feature preRestore expected original") !== EXPECTED_HASHES.featureOriginal
    || normalizedSha(preRestoreExpected[1], "feature preRestore expected augmented") !== EXPECTED_HASHES.featureAugmented) {
    fail("FEATURE_RESTORE_INVALID", "Feature lease pre-restore hash set drifted.");
  }
  for (const name of ["preRestoreTargetMatchedLease", "restoredMetadataExact", "stockModuleEntriesUnchanged", "noOtherLccEditorProcessAtAcquisition", "noUnexpectedLccEditorProcessAfterLaunch", "childTerminationConfirmedBeforeRestore", "noLccEditorProcessBeforeRestore", "restoreAttempted", "restored"]) exact(lease[name], true, `feature ${name}`);
  for (const name of ["staleLeaseRecoveredBeforeAcquisition", "secondOwnedTerminationAttemptedBeforeRestore", "secondOwnedTerminationSucceededBeforeRestore", "restorationDeferredForLiveEditor"]) exact(lease[name], false, `feature ${name}`);
  exact(lease.soleAddedModuleId, "com.venviewer.native_capture", "feature sole module id"); exact(lease.soleAddedEnabledValue, 1, "feature sole enabled value");
  if (!Array.isArray(lease.remainingLccEditorProcessIdsBeforeRestore) || lease.remainingLccEditorProcessIdsBeforeRestore.length !== 0) fail("FEATURE_RESTORE_INVALID", "Feature lease retained editor process IDs before restoration.");
  if (canonical(lease.originalMetadata) !== canonical(lease.restoredMetadata)) fail("FEATURE_RESTORE_INVALID", "Feature lease metadata was not restored exactly.");
  const activeBytes = await stableFile(activePath, "restored feature-toggle target");
  frozenSha(activeBytes, EXPECTED_HASHES.featureOriginal, "restored live feature-toggle target");
  await Promise.all([requireAbsent(backupPath, "feature-toggle durable backup residue"), requireAbsent(markerPath, "feature-toggle lease marker residue")]);
}

function validateRunLog(log: Record<string, unknown>, logBytes: Buffer, directory: string, receiptBytes: Buffer): void {
  sameSha(log.runLogSha256, logBytes, "operator runLogSha256"); exact(log.runLogByteLength, logBytes.length, "operator runLogByteLength");
  exact(log.strictUtf8Decoded, true, "operator strictUtf8Decoded"); exact(log.beginsAtExactApprovedSandboxStartupMarker, true, "operator startup boundary");
  exact(log.exactApprovedSandboxStartupMarkerCount, 1, "operator startup marker count");
  exact(log.nativeReceiptMarkerCount, 1, "operator nativeReceiptMarkerCount"); exact(log.nativeReceiptUniquelyBound, true, "operator nativeReceiptUniquelyBound");
  exact(log.nativeReceiptMarkerExactLineBound, true, "operator exact marker line binding"); exact(log.onlyExpectedDiagnosticsObserved, true, "operator onlyExpectedDiagnosticsObserved");
  const decodedLog = new TextDecoder("utf-8", { fatal: true }).decode(logBytes);
  const lines = decodedLog.split(/\r?\n/u);
  const expectedMarker = `[VenviewerNativeCapture] Receipt: ${join(directory, FILES.receipt)} SHA-256 ${bareSha(receiptBytes).toUpperCase()}`;
  if (lines.filter((line) => line === expectedMarker).length !== 1) fail("LOG_BINDING_INVALID", "The run log does not contain exactly one directory- and hash-bound native receipt marker.");
  exact(log.nativeReceiptMarker, expectedMarker, "operator nativeReceiptMarker");
  if (lines.filter((line) => line.startsWith("ERROR:")).length !== 1 || lines.filter((line) => line === EXPECTED_DBUFFER_ERROR).length !== 1) fail("LOG_PROFILE_REJECTED", "The run log does not contain exactly the frozen DBufferClear startup ERROR.");
  if (lines.filter((line) => line.startsWith("Color primaries 0 is unknown or unsupported by WindowsMediaFoundation.")).length !== 1
    || lines.filter((line) => line === EXPECTED_WMF_WARNING).length !== 1) fail("LOG_PROFILE_REJECTED", "The run log does not contain exactly the frozen WMF limitation.");
  if (lines.filter((line) => line === TERMINAL_SHUTDOWN_MARKER).length !== 1 || lines.filter((line) => line.length > 0).at(-1) !== TERMINAL_SHUTDOWN_MARKER) fail("LOG_PROFILE_REJECTED", "The run log does not terminate with one exact clean shutdown marker.");
  exact(log.renderTextureSrgbFallbackWarningCount, 0, "operator sRGB fallback warning count");
  exact(log.errorLineCount, 1, "operator error line count"); exact(log.knownStartupDbufferClearShaderUnsupportedErrorCount, 1, "operator DBuffer error count"); exact(log.unexpectedErrorLineCount, 0, "operator unexpected error count"); exact(log.errorFree, false, "operator errorFree");
  exact(log.errorClassification, "one_known_startup_dbuffer_clear_shader_unsupported_error_observed", "operator error classification");
  exact(log.windowsMediaFoundationUnknownColorPrimariesWarningCount, 1, "operator WMF warning count"); exact(log.knownWindowsMediaFoundationUnknownColorPrimariesWarningCount, 1, "operator known WMF count"); exact(log.unexpectedWindowsMediaFoundationUnknownColorPrimariesWarningCount, 0, "operator unexpected WMF count"); exact(log.windowsMediaFoundationWarningFree, false, "operator WMF warningFree");
  exact(log.windowsMediaFoundationWarningClassification, "one_known_windows_media_foundation_unknown_color_primaries_warning_observed_limitation_only", "operator WMF classification");
  exact(log.terminalShutdownMarker, TERMINAL_SHUTDOWN_MARKER, "operator terminal marker"); exact(log.terminalShutdownMarkerCount, 1, "operator terminal marker count"); exact(log.terminalShutdownMarkerAfterReceipt, true, "operator terminal phase"); exact(log.terminalShutdownMarkerAtEof, true, "operator terminal EOF"); exact(log.terminalShutdownComplete, true, "operator terminal completion");
  for (const name of ["exceptionStartCount", "knownPostReceiptVendorTooltipRescacheShutdownExceptionCount", "knownPreReceiptVendorTooltipRescacheShutdownExceptionCount", "knownPostReceiptVendorEnvironmentOnDisableShutdownExceptionCount", "knownPreReceiptVendorEnvironmentOnDisableShutdownExceptionCount", "knownApprovedPostReceiptShutdownExceptionCount", "unclassifiedExceptionCount", "exceptionDiagnosticLineCount", "knownApprovedPostReceiptExceptionDiagnosticLineCount", "unclassifiedExceptionDiagnosticLineCount"]) exact(log[name], 0, `operator ${name}`);
  exact(log.exceptionFree, true, "operator exceptionFree"); exact(log.exceptionClassification, "one_exact_approved_clean_shutdown_profile_observed", "operator exception classification");
  exact(log.shutdownProfileSetId, "venviewer.grand-hall.lcc-native-shutdown-profile-set.v1", "operator shutdownProfileSetId"); exact(log.approvedShutdownProfile, "clean_shutdown_no_exceptions", "operator approvedShutdownProfile");
  for (const name of ["approvedShutdownProfileMatched", "approvedShutdownProfileExactlyOneMatched", "approvedShutdownProfilesMutuallyExclusive", "approvedShutdownProfileFullyConsumed", "approvedShutdownProfilePhaseSatisfied"]) exact(log[name], true, `operator ${name}`);
  exact(log.approvedShutdownProfileMatchCount, 1, "operator approved shutdown match count"); exact(log.tooltipShutdownBlocksConsecutive, false, "operator tooltip profile absence"); exact(log.environmentShutdownImmediatelyAfterReceiptMarker, false, "operator environment profile absence"); exact(log.shutdownProfileClassification, "one_exact_approved_clean_shutdown_profile_observed", "operator shutdown profile classification");
}

export async function validateGrandHallNativeOperatorEvidence(directory: string): Promise<NativeEvidence> {
  const { root, identity: rootIdentity } = await strictDirectDirectory(directory, "Native operator directory");
  const entries = await readdir(root, { withFileTypes: true });
  if (entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) fail("INVENTORY_INVALID", "Native operator directory may contain only direct regular files.");
  exactInventory(EXPECTED_NATIVE_INVENTORY, entries.map((entry) => entry.name), "Native operator directory");
  const artifactEntries = await Promise.all(EXPECTED_NATIVE_INVENTORY.map(async (name) => [name, await stableFile(join(root, name), `native artifact ${name}`)] as const));
  await requireDirectoryIdentity(root, rootIdentity, "Native operator directory");
  const artifacts = new Map(artifactEntries);
  const requiredBytes = (name: string): Buffer => artifacts.get(name) ?? fail("INTERNAL_ERROR", `Native artifact map lost ${name}.`);
  const operatorBytes = requiredBytes(FILES.operator); const receiptBytes = requiredBytes(FILES.receipt); const sidecarBytes = requiredBytes(FILES.sidecar);
  const logBytes = requiredBytes(FILES.log); const png8Bytes = requiredBytes(FILES.png8); const rawBytes = requiredBytes(FILES.raw); const png16Bytes = requiredBytes(FILES.png16);
  frozenSha(operatorBytes, EXPECTED_HASHES.operatorReceipt, "operator receipt"); frozenSha(receiptBytes, EXPECTED_HASHES.nativeReceipt, "native receipt");
  frozenSha(sidecarBytes, EXPECTED_HASHES.receiptSidecar, "native receipt sidecar"); frozenSha(logBytes, EXPECTED_HASHES.runLog, "native run log");
  frozenSha(png8Bytes, EXPECTED_HASHES.png8, "native PNG8"); frozenSha(rawBytes, EXPECTED_HASHES.rawRgb24, "native RGB24"); frozenSha(png16Bytes, EXPECTED_HASHES.png16, "native PNG16");
  for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
    const suffix = String(ordinal).padStart(3, "0");
    frozenSha(requiredBytes(`.native-candidate-${suffix}.png`), EXPECTED_HASHES.png8, `native PNG8 candidate ${suffix}`);
    frozenSha(requiredBytes(`.native-unorm-rgb24-candidate-${suffix}.rgb24`), EXPECTED_HASHES.rawRgb24, `native RGB24 candidate ${suffix}`);
    frozenSha(requiredBytes(`.native-srgb-tagged-expanded16-candidate-${suffix}.png`), EXPECTED_HASHES.png16, `native PNG16 candidate ${suffix}`);
  }
  const operator = record(parseGrandHallT554StrictJson(operatorBytes), "operator receipt");
  exact(operator.schemaVersion, OPERATOR_SCHEMA, "operator schemaVersion"); exact(operator.authority, "none", "operator authority");
  exact(operator.status, "success", "operator status"); exact(operator.timedOut, false, "operator timedOut"); exact(operator.exitCode, 0, "operator exitCode");
  exact(operator.executable, EXPECTED_EDITOR, "operator executable"); exact(operator.canonicalScene, EXPECTED_SCENE, "operator canonical scene"); exact(operator.outputDirectory, root, "operator output directory");
  exact(operator.processTreeTerminationAttempted, false, "operator process termination attempt"); exact(operator.processTreeTerminationSucceeded, true, "operator process termination outcome");
  sameSha(operator.nativeReceiptSha256, receiptBytes, "operator nativeReceiptSha256"); sameSha(operator.finalPngSha256, png8Bytes, "operator finalPngSha256");
  sameSha(operator.rawRgb24Sha256, rawBytes, "operator rawRgb24Sha256"); sameSha(operator.expandedSrgbTagged16PngSha256, png16Bytes, "operator expanded PNG16 sha256");
  await validateFrozenBuildAndLease(operator);
  const log = record(operator.playerLogEvidence, "operator playerLogEvidence");
  validateRunLog(log, logBytes, root, receiptBytes);
  const expectedSidecar = `${bareSha(receiptBytes).toUpperCase()}  ${FILES.receipt}\r\n`;
  if (sidecarBytes.toString("ascii") !== expectedSidecar) fail("HASH_MISMATCH", "Native receipt sidecar is not the exact CRLF hash binding.");
  const native = record(parseGrandHallT554StrictJson(receiptBytes), "native receipt");
  exact(native.schemaVersion, NATIVE_SCHEMA, "native schemaVersion"); exact(native.status, "success", "native status"); exact(native.authority, "none", "native authority");
  exact(native.truthClass, "RECONSTRUCTED_DIAGNOSTIC", "native truthClass"); exact(native.roomRef, "trades-hall/grand-hall", "native roomRef");
  const vendor = record(native.vendor, "native vendor"); exact(vendor.xgridsInstalledVersion, "0.15.0.7", "native XGRIDS version"); exact(vendor.unityVersion, "6000.0.60f1", "native Unity version"); exact(vendor.lccSdkReportedVersion, "2.1.21.0", "native LCC SDK version"); exact(vendor.rendererApplication, EXPECTED_EDITOR, "native renderer path");
  const closure = record(vendor.runtimeClosure, "native runtime closure"); exact(closure.lockPath, join(EXPECTED_MODULE_ROOT, "runtime-closure-lock.json"), "native runtime lock path"); exactSha(closure.lockSha256, EXPECTED_HASHES.runtimeClosureLock, "native runtime lock sha256"); exactSha(closure.inventorySha256, EXPECTED_HASHES.runtimeClosureInventory, "native runtime inventory sha256"); exact(closure.memberCount, 890, "native runtime member count"); exact(closure.totalByteLength, 1_402_172_819, "native runtime byte length");
  verifyReceiptInventory(closure.members, 890, 1_402_172_819, EXPECTED_HASHES.runtimeClosureInventory, "native runtime closure", true);
  const module = record(native.module, "native module"); exact(module.id, "com.venviewer.native_capture", "native module id"); exact(module.version, "1.7.0", "native module version");
  const assembly = record(module.assembly, "native module assembly"); exact(assembly.path, join(EXPECTED_MODULE_ROOT, "VenviewerNativeCapture.dll"), "native module path"); exact(assembly.byteLength, 297_984, "native module byte length"); exactSha(assembly.sha256, EXPECTED_HASHES.module, "native module sha256");
  const manifest = record(module.manifest, "native plugin manifest"); exact(manifest.path, join(EXPECTED_MODULE_ROOT, "plugin.json"), "native plugin path"); exact(manifest.byteLength, 577, "native plugin byte length"); exactSha(manifest.sha256, EXPECTED_HASHES.plugin, "native plugin sha256"); exactSha(module.buildReceiptExpectedAssemblySha256, EXPECTED_HASHES.module, "native build expected module sha256"); exactSha(module.buildReceiptExpectedManifestSha256, EXPECTED_HASHES.plugin, "native build expected plugin sha256");
  const inputPackage = record(native.input, "native input package"); exact(inputPackage.scenePath, EXPECTED_SCENE, "native input scene path"); exactSha(inputPackage.manifestSha256, EXPECTED_HASHES.packageManifest, "native package manifest sha256"); exactSha(inputPackage.inventorySha256, EXPECTED_HASHES.packageInventory, "native package inventory sha256"); exact(inputPackage.memberCount, 60, "native package member count"); exact(inputPackage.totalByteLength, 214_350_601, "native package byte length");
  const packageMembers = verifyReceiptInventory(inputPackage.members, 60, 214_350_601, EXPECTED_HASHES.packageInventory, "native source package", false);
  for (const [index, member] of packageMembers.entries()) {
    const relativePath = strictRelativeMember(member.relativePath, `native source package member ${String(index + 1)} path`);
    exact(member.absolutePath, join(dirname(EXPECTED_SCENE), relativePath), `native source package member ${String(index + 1)} absolute path`);
  }
  for (const name of ["beforeAfterByteIdentityVerified", "beforeAfterTimestampIdentityVerified", "preLoadThroughPostCaptureIdentityVerified"]) exact(inputPackage[name], true, `native source package ${name}`);
  const sceneLoad = record(native.sceneLoad, "native sceneLoad");
  exact(sceneLoad.api, "IProjectManager.CreateTemporaryLCCProject(string) + ISceneManager.LoadDefaultScene()", "native scene load API");
  for (const name of ["requestedPath", "generatedLccAssetPath", "generatedLccAssetResolvedPath", "eventPath", "rendererHandlerPath"]) exact(sceneLoad[name], EXPECTED_SCENE, `native sceneLoad ${name}`);
  for (const name of ["preloadedSceneRejected", "freshProjectStateVerified", "temporaryProjectCreationSucceeded", "projectInitializedVerified", "temporaryProjectVerified", "currentSceneDataNonNull", "generatedLccAssetPresent", "generatedLccAssetPathVerified", "defaultSceneLoadAccepted", "eventSubscriptionAccepted", "eventPathVerified", "rendererHandlerNonNull", "rendererHandlerPathVerified", "canonicalSceneLoadedVerified", "renderAllBeginEventSubscriptionAccepted", "renderAllBeginEventObserved", "renderAllPendingDefaultDerivedFromFreshRenderer", "renderAllPendingTrueRequestedBeforeLoad", "renderAllActiveTrueObservedAfterLoad", "renderAllPendingFalseResetAttempted", "renderAllPendingFalseResetCallCompleted"]) exact(sceneLoad[name], true, `native sceneLoad ${name}`);
  exact(sceneLoad.commandLineSceneArgumentUsed, false, "native sceneLoad command line path"); exact(sceneLoad.renderAllPendingResetReadbackAvailable, false, "native render-all reset readback"); exact(sceneLoad.renderAllIsolationBoundary, "disposable_process_exit", "native render-all isolation");
  const camera = record(native.cameraProfile, "native cameraProfile"); exact(camera.profileId, CAMERA_ID, "native camera profileId");
  exactSha(camera.sha256, EXPECTED_HASHES.cameraProfile, "native camera sha256"); exact(camera.path, join(EXPECTED_MODULE_ROOT, "camera-profile.json"), "native camera profile path"); exact(camera.schemaVersion, "venviewer.grand-hall.fixed-camera-profile.v1", "native camera profile schema");
  exact(camera.sourceFrame, "xgrids_lcc2_source_z_up", "native camera source frame"); exact(camera.nativeFrame, "xgrids_lcceditor_unity_y_up", "native camera native frame"); exact(camera.threeFrame, "venviewer_browser_centered_y_up", "native camera browser frame");
  exact(camera.inspectionOnly, true, "native camera inspectionOnly"); exact(camera.environmentIncluded, false, "native environmentIncluded"); exact(camera.environmentExclusionReason, "browser_frontier_parity_env_sog_excluded", "native camera environment exclusion reason");
  const cameraUse = record(native.camera, "native applied camera"); exact(cameraUse.cameraId, CAMERA_ID, "native applied camera id"); exact(cameraUse.sourcePoseIndex, 19_890, "native source pose index"); exact(cameraUse.sourcePoseTimestamp, "1780223098.347440958", "native source pose timestamp"); exact(cameraUse.sourceFrame, "xgrids_lcc2_source_z_up", "native applied source frame"); exact(cameraUse.nativeFrame, "xgrids_lcceditor_unity_y_up", "native applied native frame"); exact(cameraUse.targetDerivation, "pose_q05_q95_horizontal_centre_at_source_pose_height", "native target derivation"); exact(cameraUse.targetCalibrationStatus, "inspection_only_not_calibrated_source_orientation", "native target calibration status");
  exactJson(cameraUse.sourcePosition, [-4.774913, -16.59914, -0.687065], "native source camera position"); exactJson(cameraUse.sourceTarget, [-4.5826875, -8.392191, -0.687065], "native source camera target"); exactJson(cameraUse.sourceUp, [0, 0, 1], "native source camera up");
  exactJson(cameraUse.nativePosition, [4.7749128341674805, -0.6870630979537964, 16.59914207458496], "native applied position"); exactJson(cameraUse.nativeTarget, [4.5826873779296875, -0.6870641112327576, 8.392191886901855], "native applied target"); exactJson(cameraUse.nativeUp, [0, 1, 0], "native applied up"); exactJson(cameraUse.nativeDirection, [-0.023415854200720787, -1.2343210187282239e-7, -0.9997258186340332], "native applied direction"); exactJson(cameraUse.nativeQuaternionXyzw, [-7.226165221752012e-10, 0.9999314546585083, -6.171182320713342e-8, -0.011708729900419712], "native applied quaternion");
  exactJson(cameraUse.expectedRawNativePosition, [4.774913, -0.687065, 16.59914], "native expected position"); exactJson(cameraUse.expectedRawNativeTarget, [4.5826875, -0.687065, 8.392191], "native expected target"); exactJson(cameraUse.expectedRawNativeUp, [0, 1, 0], "native expected up"); exactJson(cameraUse.expectedRawNativeDirection, [-0.0234158630569611, 0, -0.999725811088869], "native expected direction"); exactJson(cameraUse.expectedRawNativeQuaternionXyzw, [0, -0.999931450422695, 0, 0.0117087341572578], "native expected quaternion"); exact(cameraUse.rawNativeAssertionTolerance, 0.00001, "native camera assertion tolerance");
  exact(cameraUse.projection, "perspective", "native projection"); exact(cameraUse.verticalFieldOfViewDegrees, 60, "native vertical FOV"); exact(cameraUse.nearClipMetres, 0.05, "native near clip"); exact(cameraUse.farClipMetres, 80, "native far clip"); exact(cameraUse.aspect, 1.77777779, "native aspect");
  const capture = record(native.capture, "native capture"); exact(capture.width, WIDTH, "native width"); exact(capture.height, HEIGHT, "native height");
  exact(capture.uiComposited, false, "native UI compositing");
  for (const name of ["recordModeEnabled", "gridHidden", "sceneGizmoHidden", "trajectoryHidden", "ultraQualityVerified", "renderAllRequested", "renderAllObservedAfterRequest", "renderAllRequestedBeforeSceneLoad", "renderAllObservedAfterSceneLoad", "renderAllVerifiedAtEveryGate", "canonicalPackageHasEnvironment", "environmentExclusionRequested", "rendererReadinessContractSatisfied", "globalCameraCallbackRequiredForAdmission", "standardCameraRenderCallbackProofAvailable", "everyObservedPixelSourceMatchesConfigured"]) exact(capture[name], true, `native capture ${name}`);
  exact(capture.environmentDataIncluded, false, "native environment inclusion"); exact(capture.environmentExclusionReason, "browser_frontier_parity_env_sog_excluded", "native environment exclusion reason"); exact(capture.configuredPixelSource, "first_party_owned_urp_single_camera_request_render_texture", "native configured pixel source"); exact(capture.observedPixelSource, "first_party_owned_urp_single_camera_request_render_texture", "native observed pixel source");
  exact(capture.everyAttemptSpawnPointVisualizationsSuppressedAndRestored, true, "native marker suppression proof");
  exact(capture.plateauHashDomain, "lower_left_Unity_Gamma_R8G8B8A8_UNorm_display_code_rgb24_sha256_before_row_flip_and_sRGB_tagging", "native plateau domain");
  exact(capture.finalBrowserDisplayCodeMapping, "IDENTITY_UNITY_GAMMA_UNORM_DISPLAY_CODE_VALUES_TO_SRGB_TAGGED_PNG8", "native PNG8 mapping");
  exact(capture.finalExpanded16CodeMapping, "UINT8_CODE_VALUE_TIMES_257_TO_SRGB_TAGGED_PNG16_NO_ADDED_PRECISION", "native PNG16 mapping");
  exact(capture.rawRgb24LinearLightPhotometryClaimed, false, "native photometry claim"); exact(capture.exactPhotometricTransferClaimed, false, "native transfer claim");
  exact(capture.expanded16AddsPrecision, false, "native PNG16 precision claim"); exact(capture.finalPngSrgbTagsVerified, true, "native PNG8 tags");
  exact(capture.browserDisplaySrgbTaggedExpanded16PngChunksVerified, true, "native PNG16 chunks");
  exact(capture.stableConsecutiveIdenticalHashes, 3, "native stable hash count"); exact(capture.sameHostHashPlateauVerified, true, "native same-host plateau proof");
  exact(capture.requiredConsecutiveIdenticalHashes, 3, "native required stable hashes"); exact(capture.completedAttempts, 3, "native completed attempts");
  exact(capture.selectedAttemptPath, join(root, ".native-candidate-003.png"), "native selected PNG8 attempt"); exact(capture.selectedRawRgb24AttemptPath, join(root, ".native-unorm-rgb24-candidate-003.rgb24"), "native selected raw attempt"); exact(capture.selectedBrowserDisplaySrgbTaggedExpanded16AttemptPath, join(root, ".native-srgb-tagged-expanded16-candidate-003.png"), "native selected PNG16 attempt");
  exact(capture.finalPngPath, join(root, FILES.png8), "native final PNG8 path"); exact(capture.rawRgb24EvidencePath, join(root, FILES.raw), "native final raw path"); exact(capture.browserDisplaySrgbTaggedExpanded16PngPath, join(root, FILES.png16), "native final PNG16 path");
  exact(capture.finalPngByteLength, png8Bytes.length, "native final PNG8 byte length"); exact(capture.rawRgb24EvidenceByteLength, rawBytes.length, "native raw byte length"); exact(capture.browserDisplaySrgbTaggedExpanded16PngByteLength, png16Bytes.length, "native final PNG16 byte length");
  sameSha(capture.finalPngSha256, png8Bytes, "native finalPngSha256"); sameSha(capture.rawRgb24EvidenceSha256, rawBytes, "native rawRgb24EvidenceSha256");
  sameSha(capture.browserDisplaySrgbTaggedExpanded16PngSha256, png16Bytes, "native PNG16 sha256");
  const attempts = capture.attempts;
  if (!Array.isArray(attempts) || attempts.length !== 3) fail("RECEIPT_INVALID", "Native capture must contain exactly three admitted attempts.");
  for (const [index, unknownAttempt] of attempts.entries()) {
    const attemptLabel = `native attempt ${String(index + 1)}`;
    const attempt = record(unknownAttempt, attemptLabel);
    const ordinal = index + 1; const suffix = String(ordinal).padStart(3, "0");
    exact(attempt.ordinal, ordinal, `${attemptLabel} ordinal`); exact(attempt.status, "accepted", `${attemptLabel} status`); exact(attempt.width, WIDTH, `${attemptLabel} width`); exact(attempt.height, HEIGHT, `${attemptLabel} height`); exact(attempt.consecutiveIdenticalHashes, ordinal, `${attemptLabel} consecutive hash count`);
    exactSha(attempt.sha256, EXPECTED_HASHES.png8, `${attemptLabel} selected encoded sha256`); exact(attempt.byteLength, png8Bytes.length, `${attemptLabel} selected byte length`); exactSha(attempt.plateauHashSha256, EXPECTED_HASHES.rawRgb24, `${attemptLabel} plateau sha256`); exactSha(attempt.rawRgb24Sha256, EXPECTED_HASHES.rawRgb24, `${attemptLabel} raw sha256`); exact(attempt.rawRgb24ByteLength, rawBytes.length, `${attemptLabel} raw byte length`);
    exact(attempt.rawRgb24CandidatePath, join(root, `.native-unorm-rgb24-candidate-${suffix}.rgb24`), `${attemptLabel} raw candidate path`); exact(attempt.browserDisplaySrgbTagged8CandidatePath, join(root, `.native-candidate-${suffix}.png`), `${attemptLabel} PNG8 candidate path`); exact(attempt.browserDisplaySrgbTaggedExpanded16CandidatePath, join(root, `.native-srgb-tagged-expanded16-candidate-${suffix}.png`), `${attemptLabel} PNG16 candidate path`);
    exactSha(attempt.browserDisplaySrgbTagged8SampleSha256, EXPECTED_HASHES.rawRgb24, `${attemptLabel} PNG8 sample sha256`); exactSha(attempt.browserDisplaySrgbTagged8EncodedSha256, EXPECTED_HASHES.png8, `${attemptLabel} PNG8 encoded sha256`); exact(attempt.browserDisplaySrgbTagged8EncodedByteLength, png8Bytes.length, `${attemptLabel} PNG8 byte length`);
    exactSha(attempt.browserDisplaySrgbTaggedExpanded16SampleSha256, EXPECTED_HASHES.expanded16Samples, `${attemptLabel} PNG16 sample sha256`); exactSha(attempt.browserDisplaySrgbTaggedExpanded16EncodedSha256, EXPECTED_HASHES.png16, `${attemptLabel} PNG16 encoded sha256`); exact(attempt.browserDisplaySrgbTaggedExpanded16EncodedByteLength, png16Bytes.length, `${attemptLabel} PNG16 byte length`);
    for (const name of ["captureTaskCompletedBeforeDeadline", "pixelReadCompleted", "rawRgb24BytePublicationCompleted", "rawRgb24PostWriteFileShaVerified", "browserDisplaySrgbTagged8PngEncodingCompleted", "browserDisplaySrgbTagged8PngChunksVerified", "browserDisplaySrgbTagged8PostWriteFileShaVerified", "browserDisplaySrgbTaggedExpanded16PngEncodingCompleted", "browserDisplaySrgbTaggedExpanded16PngChunksVerified", "browserDisplaySrgbTaggedExpanded16PostWriteFileShaVerified", "pngEncodingCompleted", "postWriteFileShaVerified", "firstPartyReadPixelsCompleted", "firstPartyApplyCompleted", "standardCameraRenderCallbackProofAvailable"]) exact(attempt[name], true, `${attemptLabel} ${name}`);
    for (const name of ["captureTaskStopObserved", "captureTaskTimeoutObserved", "underlyingCaptureCancellationAvailable"]) exact(attempt[name], false, `${attemptLabel} ${name}`);
    exact(attempt.failureType, null, `${attemptLabel} failureType`); exact(attempt.failureMessage, null, `${attemptLabel} failureMessage`);
    const raster = record(attempt.raster, `${attemptLabel} raster`); exact(raster.pixelCount, WIDTH * HEIGHT, `${attemptLabel} pixel count`); exact(raster.nonBlackPixelCount, WIDTH * HEIGHT, `${attemptLabel} non-black count`); exact(raster.nonDegenerateVerified, true, `${attemptLabel} non-degenerate proof`); exactSha(raster.rgb24Sha256, EXPECTED_HASHES.rawRgb24, `${attemptLabel} raster sha256`);
    exact(attempt.rawRgb24Semantics, capture.rawRgb24Semantics, `${attemptLabel} raw semantics`);
    exact(attempt.rawRgb24LinearLightPhotometryClaimed, false, `${attemptLabel} photometry claim`);
    exact(attempt.exactPhotometricTransferClaimed, false, `${attemptLabel} transfer claim`);
    exact(attempt.expanded16AddsPrecision, false, `${attemptLabel} PNG16 precision claim`);
    exact(attempt.browserDisplay8CodeMapping, capture.finalBrowserDisplayCodeMapping, `${attemptLabel} PNG8 mapping`);
    exact(attempt.browserDisplay16CodeMapping, capture.finalExpanded16CodeMapping, `${attemptLabel} PNG16 mapping`);
    const surface = record(attempt.singleCameraRenderRequestSurface, `${attemptLabel} render surface`);
    const suppression = record(surface.spawnPointVisualizationSuppression, `${attemptLabel} marker suppression`);
    exact(suppression.everyTargetSuppressed, true, `${attemptLabel} every marker suppressed`);
    exact(suppression.everyTargetRestored, true, `${attemptLabel} every marker restored`);
    exact(suppression.identityStableAtEveryCheckpoint, true, `${attemptLabel} marker identity stability`);
    exact(suppression.sceneDirtyEqualAtEveryCheckpoint, true, `${attemptLabel} scene dirty stability`);
    exact(suppression.coveredSentinelRequestAndReadback, true, `${attemptLabel} sentinel suppression coverage`);
    exact(suppression.coveredExactRequestAndReadback, true, `${attemptLabel} exact suppression coverage`);
    exact(surface.activeColorSpace, "Gamma", `${attemptLabel} active colour space`);
    exact(surface.activeColorSpaceAfter, "Gamma", `${attemptLabel} restored colour space`);
    for (const requestName of ["sentinelRequest", "exactRequest"] as const) {
      const request = record(surface[requestName], `${attemptLabel} ${requestName}`);
      for (const targetName of ["targetBeforeSubmit", "targetAfterSubmit"] as const) {
        const target = record(request[targetName], `${attemptLabel} ${requestName} ${targetName}`);
        exact(target.requestedGraphicsFormat, "R8G8B8A8_UNorm", "native requested graphics format"); exact(target.effectiveGraphicsFormat, "R8G8B8A8_UNorm", "native effective graphics format");
        exact(target.requestedSrgb, false, "native requested sRGB"); exact(target.effectiveSrgb, false, "native effective sRGB"); exact(target.requestedAndEffectiveFormatMatch, true, "native graphics format match");
      }
    }
  }
  const png8 = verifyGrandHallNativePixelBindings(png8Bytes, rawBytes, png16Bytes);
  await requireDirectoryIdentity(root, rootIdentity, "Native operator directory");
  return { rgb: png8, bindings: { operatorReceiptSha256: sha(operatorBytes), nativeReceiptSha256: sha(receiptBytes), runLogSha256: sha(logBytes), png8Sha256: sha(png8Bytes), rawRgb24Sha256: sha(rawBytes), png16Sha256: sha(png16Bytes), cameraProfileId: CAMERA_ID, cameraProfileSha256: CAMERA_SHA } };
}

interface Metrics { mae: number; mse: number; rmse: number; psnr: number | null; maxAbsoluteError: number; clippedDifferenceSamples: number; }
function compare(a: Buffer, b: Buffer): { metrics: Metrics; diff: Buffer } {
  if (a.length !== b.length) fail("IMAGE_INVALID", "Compared RGB images have unequal lengths.");
  let sum = 0; let squared = 0; let max = 0; let clipped = 0; const diff = Buffer.allocUnsafe(a.length);
  for (let i = 0; i < a.length; i += 1) { const av = a[i]; const bv = b[i]; if (av === undefined || bv === undefined) fail("IMAGE_INVALID", "Compared RGB image ended unexpectedly."); const d = Math.abs(av - bv); sum += d; squared += d * d; max = Math.max(max, d); if (d * 8 > 255) clipped += 1; diff[i] = Math.min(255, d * 8); }
  const mse = squared / a.length;
  return { metrics: { mae: sum / a.length, mse, rmse: Math.sqrt(mse), psnr: mse === 0 ? null : 10 * Math.log10(65025 / mse), maxAbsoluteError: max, clippedDifferenceSamples: clipped }, diff };
}
async function png(raw: Buffer, width = WIDTH): Promise<Buffer> { return sharp(raw, { raw: { width, height: HEIGHT, channels: 3 } }).png({ compressionLevel: 9, adaptiveFiltering: false, palette: false }).toBuffer(); }

export interface GrandHallNativeInclusiveArtifacts { readonly files: ReadonlyMap<string, Buffer>; readonly receipt: Record<string, unknown>; }

async function validateFrozenBrowserReceiptPath(browserReceiptPath: string): Promise<{ readonly bundle: string; readonly identity: ObjectIdentity }> {
  if (!isAbsolute(browserReceiptPath) || resolve(browserReceiptPath) !== browserReceiptPath) fail("ARGUMENT_INVALID", "Browser receipt path must be absolute and normalized.");
  if (basename(browserReceiptPath) !== BROWSER_RECEIPT_NAME) fail("ARGUMENT_INVALID", `Browser receipt must be named ${BROWSER_RECEIPT_NAME}.`);
  const directory = await strictDirectDirectory(dirname(browserReceiptPath), "Browser v3 evidence directory");
  if (!samePath(join(directory.root, BROWSER_RECEIPT_NAME), browserReceiptPath)) fail("PATH_ESCAPE", "Browser receipt must be a direct child of its canonical evidence directory.");
  const bytes = await stableFile(browserReceiptPath, "frozen browser-v3 receipt");
  frozenSha(bytes, EXPECTED_HASHES.browserBakeoffReceipt, "browser-v3 receipt");
  await requireDirectoryIdentity(directory.root, directory.identity, "Browser v3 evidence directory");
  return { bundle: directory.root, identity: directory.identity };
}

async function writeTemporaryMirrorLeaf(path: string, bytes: Buffer): Promise<void> {
  const handle = await open(path, "wx", 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  if ((await stableFile(path, `temporary browser mirror ${basename(path)}`)).compare(bytes) !== 0) fail("OUTPUT_WRITE_FAILED", "Temporary browser mirror write did not reproduce its source bytes.");
}

async function buildFrozenBrowserComparison(browserSource: { readonly bundle: string; readonly identity: ObjectIdentity }) {
  const sourceEntries = await readdir(browserSource.bundle, { withFileTypes: true });
  if (sourceEntries.some((entry) => entry.isSymbolicLink())) fail("INVENTORY_INVALID", "Browser-v3 evidence root contains a linked entry.");
  exactInventory(
    [BROWSER_RECEIPT_NAME, BROWSER_CAMERA_NAME, "sog", "spz", "ply", BROWSER_ROOT_ADDITIONAL_FROZEN_NOTE],
    sourceEntries.map((entry) => entry.name),
    "Frozen browser-v3 evidence root",
  );
  const mirror = await mkdtemp(join(tmpdir(), "venviewer-native-inclusive-browser-v3-"));
  const mirrorStat = await lstat(mirror);
  const mirrorIdentity = objectIdentity(mirrorStat);
  try {
    for (const name of [BROWSER_RECEIPT_NAME, BROWSER_CAMERA_NAME]) {
      await writeTemporaryMirrorLeaf(join(mirror, name), await stableFile(join(browserSource.bundle, name), `browser-v3 ${name}`));
    }
    for (const lane of ["sog", "spz", "ply"] as const) {
      const sourceLane = await strictDirectDirectory(join(browserSource.bundle, lane), `browser-v3 ${lane} lane`);
      const targetLane = join(mirror, lane);
      await mkdir(targetLane, { recursive: false });
      const laneEntries = await readdir(sourceLane.root, { withFileTypes: true });
      if (laneEntries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) fail("INVENTORY_INVALID", `Browser-v3 ${lane} lane contains an unsafe entry.`);
      for (const entry of laneEntries) {
        const bytes = await stableFile(join(sourceLane.root, entry.name), `browser-v3 ${lane}/${entry.name}`);
        await writeTemporaryMirrorLeaf(join(targetLane, entry.name), bytes);
      }
      await requireDirectoryIdentity(sourceLane.root, sourceLane.identity, `browser-v3 ${lane} lane`);
    }
    await requireDirectoryIdentity(browserSource.bundle, browserSource.identity, "Browser v3 evidence directory");
    await requireDirectoryIdentity(mirror, mirrorIdentity, "Temporary browser-v3 mirror");
    return await buildGrandHallVisibleFirstRadianceComparison(join(mirror, BROWSER_RECEIPT_NAME));
  } finally {
    try {
      await requireDirectoryIdentity(mirror, mirrorIdentity, "Temporary browser-v3 mirror");
      await rm(mirror, { recursive: true, force: false });
    } catch {
      // Never recursively remove a path if the temporary mirror identity changed.
    }
  }
}

export async function buildGrandHallNativeInclusiveVisibleFirstComparison(browserReceiptPath: string, nativeOperatorDirectory: string): Promise<GrandHallNativeInclusiveArtifacts> {
  const browserSource = await validateFrozenBrowserReceiptPath(browserReceiptPath);
  const browser = await buildFrozenBrowserComparison(browserSource);
  frozenSha(browser.receiptJson, EXPECTED_HASHES.browserComparisonReceipt, "derived browser comparison receipt");
  const browserReceipt = record(browser.receipt, "browser comparison receipt");
  exact(browserReceipt.authority, "none", "browser comparison authority"); exact(browserReceipt.decisionStatus, "not_evaluated", "browser comparison decision"); exact(browserReceipt.winner, null, "browser comparison winner"); exact(browserReceipt.rankingPermitted, false, "browser comparison ranking permission"); exact(browserReceipt.visualAcceptance, "not_reviewed", "browser comparison visual acceptance");
  const input = record(browserReceipt.input, "browser comparison input"); const selected = record(input.selectedCaptures, "browser selectedCaptures");
  const bakeoff = record(input.bakeoffReceipt, "browser bakeoff receipt binding"); exact(bakeoff.fileName, BROWSER_RECEIPT_NAME, "browser bakeoff file name"); exactSha(bakeoff.sha256, EXPECTED_HASHES.browserBakeoffReceipt, "browser bakeoff sha256"); exact(bakeoff.sizeBytes, 18_158, "browser bakeoff byte length"); exact(bakeoff.schemaVersion, "venviewer.grand-hall.visible-first-browser-bakeoff.v3", "browser bakeoff schema"); exact(bakeoff.gitSha, EXPECTED_HASHES.browserGitSha, "browser bakeoff git SHA");
  const hardware = record(input.browserHardwareProfile, "browser hardware profile"); exactSha(hardware.profileSha256, "61a38a3424dbbda3b4139677a92caa1ac918879d6ac50212de0ca073d8bb922e", "browser hardware profile sha256"); exact(hardware.contextLost, false, "browser context loss");
  const bundle = browserSource.bundle;
  const loadLane = async (lane: "sog" | "spz") => {
    const screenshot = record(record(selected[lane], lane).screenshot, `${lane} screenshot`);
    const name = stringValue(screenshot.fileName, `${lane} screenshot fileName`);
    if (basename(name) !== name) fail("PATH_ESCAPE", `${lane} screenshot is not bundle-local.`);
    const laneDirectory = await strictDirectDirectory(join(bundle, lane), `${lane} browser lane`);
    const screenshotPath = join(laneDirectory.root, name);
    if (!pathWithin(laneDirectory.root, screenshotPath) || dirname(screenshotPath) !== laneDirectory.root) fail("PATH_ESCAPE", `${lane} screenshot escaped its lane.`);
    const bytes = await stableFile(screenshotPath, `${lane} screenshot`); sameSha(screenshot.sha256, bytes, `${lane} screenshot sha256`);
    exactSha(screenshot.sha256, lane === "sog" ? "72f4c376d2742128daac0fb1a8ec68c178fd0e373bf47c1ce9e808cd077d3aae" : "02740825e322d119fd3484bda8d2b90fd2acd4352c5891cb9d51fca9b9613d20", `${lane} frozen screenshot sha256`);
    await requireDirectoryIdentity(laneDirectory.root, laneDirectory.identity, `${lane} browser lane`);
    return decodePng8(bytes, `${lane} screenshot`);
  };
  const [sog, spz, native] = await Promise.all([loadLane("sog"), loadLane("spz"), validateGrandHallNativeOperatorEvidence(nativeOperatorDirectory)]);
  await requireDirectoryIdentity(browserSource.bundle, browserSource.identity, "Browser v3 evidence directory");
  const camera = record(input.cameraProfile, "browser cameraProfile"); exact(camera.profileId, CAMERA_ID, "browser camera profileId"); exact(camera.sha256, CAMERA_SHA, "browser camera sha256");
  const pairs = { sogSpz: compare(sog, spz), sogNative: compare(sog, native.rgb), spzNative: compare(spz, native.rgb) };
  const gap = Buffer.alloc(8 * HEIGHT * 3, 24); const side = Buffer.alloc((WIDTH * 3 + 16) * HEIGHT * 3); const stride = WIDTH * 3; const outStride = (WIDTH * 3 + 16) * 3;
  for (let y = 0; y < HEIGHT; y += 1) { sog.copy(side, y*outStride, y*stride, (y+1)*stride); gap.copy(side, y*outStride+stride, y*24, y*24+24); spz.copy(side, y*outStride+stride+24, y*stride, (y+1)*stride); gap.copy(side, y*outStride+2*stride+24, y*24, y*24+24); native.rgb.copy(side, y*outStride+2*stride+48, y*stride, (y+1)*stride); }
  const generated = new Map<string, Buffer>(); generated.set(GRAND_HALL_NATIVE_INCLUSIVE_SIDE_BY_SIDE, await png(side, WIDTH*3+16));
  const [sogSpzDiffName, sogNativeDiffName, spzNativeDiffName] = GRAND_HALL_NATIVE_INCLUSIVE_DIFFS;
  if (sogSpzDiffName === undefined || sogNativeDiffName === undefined || spzNativeDiffName === undefined) fail("INTERNAL_ERROR", "Pairwise difference inventory is incomplete.");
  generated.set(sogSpzDiffName, await png(pairs.sogSpz.diff)); generated.set(sogNativeDiffName, await png(pairs.sogNative.diff)); generated.set(spzNativeDiffName, await png(pairs.spzNative.diff));
  const receipt: Record<string, unknown> = { schemaVersion: GRAND_HALL_NATIVE_INCLUSIVE_COMPARISON_SCHEMA, authority: "none", decisionStatus: "not_evaluated", winner: null, rankingPermitted: false, visualAcceptance: "not_reviewed", humanReviewRequired: true, cameraProfile: { profileId: CAMERA_ID, sha256: CAMERA_SHA }, browserComparisonReceiptSha256: sha(browser.receiptJson), nativeBindings: native.bindings, lanes: ["sog", "spz", "native_lcc"], plyDisposition: "structural_only_excluded_from_radiance_comparison", metrics: { sogSpz: pairs.sogSpz.metrics, sogNative: pairs.sogNative.metrics, spzNative: pairs.spzNative.metrics }, differenceFormula: "min(255, abs(rgb8A-rgb8B)*8) per channel", generatedFiles: [...generated].map(([fileName, bytes]) => ({ fileName, sha256: sha(bytes), sizeBytes: bytes.length })), outputInventory: [GRAND_HALL_NATIVE_INCLUSIVE_SIDE_BY_SIDE, ...GRAND_HALL_NATIVE_INCLUSIVE_DIFFS, GRAND_HALL_NATIVE_INCLUSIVE_RECEIPT], limitations: ["This is authority-none representation-disagreement evidence at one inspection camera.", "It makes no visual winner, fidelity, room-scope, metric-admission, runtime-equivalence, or architectural-truth claim.", "The native PNG16 is an exact expansion of PNG8 and adds no precision."] };
  const receiptBytes = canonicalBytes(receipt); generated.set(GRAND_HALL_NATIVE_INCLUSIVE_RECEIPT, receiptBytes);
  return { files: generated, receipt };
}

interface NativeInclusiveOutputLocation {
  readonly target: string;
  readonly parent: string;
  readonly parentIdentity: ObjectIdentity;
}

interface ClaimedNativeInclusiveStaging extends NativeInclusiveOutputLocation {
  readonly staging: string;
  readonly stagingIdentity: ObjectIdentity;
}

export interface GrandHallNativeInclusiveWriteTestHooks {
  readonly afterStagingClaimed?: (input: { readonly stagingDirectory: string; readonly targetDirectory: string }) => Promise<void>;
  readonly beforePublish?: (input: { readonly stagingDirectory: string; readonly targetDirectory: string }) => Promise<void>;
  readonly afterPublishedIdentityRead?: (input: { readonly targetDirectory: string }) => Promise<void>;
}

export interface GrandHallNativeInclusiveWriteOptions { readonly testHooks?: GrandHallNativeInclusiveWriteTestHooks; }
export interface GrandHallNativeInclusiveCheckTestHooks {
  readonly afterOutputIdentityRead?: (input: { readonly outputDirectory: string }) => Promise<void>;
  readonly beforeOutputMemberRead?: (input: { readonly outputDirectory: string; readonly fileName: string }) => Promise<void>;
}
export interface GrandHallNativeInclusiveCheckOptions { readonly testHooks?: GrandHallNativeInclusiveCheckTestHooks; }

async function pathExists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function assertOutputLocation(browserReceiptPath: string, nativeDirectory: string, outputDirectory: string): Promise<NativeInclusiveOutputLocation> {
  if (process.platform !== "win32") fail("OUTPUT_UNSAFE", "Native-inclusive publication requires Windows no-replace directory rename semantics.");
  if (!isAbsolute(outputDirectory) || resolve(outputDirectory) !== outputDirectory) fail("ARGUMENT_INVALID", "Output directory must be absolute and normalized.");
  const parent = await strictDirectDirectory(dirname(outputDirectory), "Native-inclusive output parent");
  if (!samePath(join(parent.root, basename(outputDirectory)), outputDirectory)) fail("OUTPUT_UNSAFE", "Output directory must be a direct child of its canonical parent.");
  const browserRoot = await realpath(dirname(browserReceiptPath)); const nativeRoot = await realpath(nativeDirectory);
  if (pathWithin(browserRoot, outputDirectory) || pathWithin(outputDirectory, browserRoot)
    || pathWithin(nativeRoot, outputDirectory) || pathWithin(outputDirectory, nativeRoot)) fail("OUTPUT_UNSAFE", "Output must not contain or be contained by either input evidence root.");
  return { target: outputDirectory, parent: parent.root, parentIdentity: parent.identity };
}

async function requireStagingIdentity(claim: ClaimedNativeInclusiveStaging): Promise<void> {
  await requireDirectoryIdentity(claim.parent, claim.parentIdentity, "Native-inclusive output parent");
  await requireDirectoryIdentity(claim.staging, claim.stagingIdentity, "Native-inclusive staging directory");
}

async function claimStaging(location: NativeInclusiveOutputLocation): Promise<ClaimedNativeInclusiveStaging> {
  if (await pathExists(location.target)) fail("OUTPUT_EXISTS", `Refusing to replace existing output: ${location.target}`);
  await requireDirectoryIdentity(location.parent, location.parentIdentity, "Native-inclusive output parent");
  const staging = await mkdtemp(join(location.parent, `.${basename(location.target)}.staging-`));
  const claimed = await strictDirectDirectory(staging, "Native-inclusive staging directory");
  return { ...location, staging: claimed.root, stagingIdentity: claimed.identity };
}

async function writeAll(handle: FileHandle, bytes: Buffer): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) {
    const written = await handle.write(bytes, offset, bytes.length - offset, offset);
    if (written.bytesWritten <= 0) fail("OUTPUT_WRITE_FAILED", "An output write made no progress.");
    offset += written.bytesWritten;
  }
  await handle.sync();
}

async function writeStagedFile(claim: ClaimedNativeInclusiveStaging, name: string, bytes: Buffer): Promise<void> {
  await requireStagingIdentity(claim);
  if (basename(name) !== name || name.length === 0) fail("OUTPUT_UNSAFE", `Unsafe native-inclusive output member: ${name}`);
  const path = resolve(claim.staging, name);
  if (dirname(path) !== claim.staging) fail("OUTPUT_UNSAFE", `Output member escaped staging: ${name}`);
  const handle = await open(path, "wx", 0o600);
  try { await writeAll(handle, bytes); } finally { await handle.close(); }
  await requireStagingIdentity(claim);
  if ((await stableFile(path, `staged output ${name}`)).compare(bytes) !== 0) fail("OUTPUT_WRITE_FAILED", `Staged output ${name} failed byte verification.`);
}

async function verifyPublishedArtifacts(target: string, targetIdentity: ObjectIdentity, artifacts: GrandHallNativeInclusiveArtifacts): Promise<void> {
  await requireDirectoryIdentity(target, targetIdentity, "Published native-inclusive output");
  const entries = await readdir(target, { withFileTypes: true });
  if (entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) fail("OUTPUT_UNSAFE", "Published output contains a non-regular or linked entry.");
  exactInventory([...artifacts.files.keys()], entries.map((entry) => entry.name), "Published native-inclusive output");
  for (const [name, bytes] of artifacts.files) {
    await requireDirectoryIdentity(target, targetIdentity, "Published native-inclusive output");
    if ((await stableFile(join(target, name), `published output ${name}`)).compare(bytes) !== 0) fail("OUTPUT_MISMATCH", `Published ${name} differs from its staged artifact.`);
  }
  await requireDirectoryIdentity(target, targetIdentity, "Published native-inclusive output");
}

async function publishStaging(claim: ClaimedNativeInclusiveStaging, artifacts: GrandHallNativeInclusiveArtifacts, hooks: GrandHallNativeInclusiveWriteTestHooks | undefined): Promise<void> {
  await requireStagingIdentity(claim);
  await hooks?.beforePublish?.({ stagingDirectory: claim.staging, targetDirectory: claim.target });
  await requireStagingIdentity(claim);
  if (await pathExists(claim.target)) fail("OUTPUT_EXISTS", `Refusing racing output target: ${claim.target}`);
  await rename(claim.staging, claim.target).catch((error: unknown) => fail("OUTPUT_EXISTS", `Atomic no-replace publication failed because the target was no longer absent: ${error instanceof Error ? error.message : String(error)}`));
  const published = await lstat(claim.target).catch(() => fail("OUTPUT_UNSAFE", "Published output disappeared."));
  if (!published.isDirectory() || published.isSymbolicLink() || !sameObject(objectIdentity(published), claim.stagingIdentity)) fail("OUTPUT_UNSAFE", "Published output is not the claimed staging object.");
  await hooks?.afterPublishedIdentityRead?.({ targetDirectory: claim.target });
  await realpath(claim.target).catch(() => fail("OUTPUT_UNSAFE", "Published output cannot be resolved."));
  await verifyPublishedArtifacts(claim.target, claim.stagingIdentity, artifacts);
  await requireDirectoryIdentity(claim.parent, claim.parentIdentity, "Native-inclusive output parent");
}

async function cleanupStaging(claim: ClaimedNativeInclusiveStaging): Promise<void> {
  try {
    await requireStagingIdentity(claim);
    await rm(claim.staging, { recursive: true, force: false });
  } catch {
    // Never recursively remove a path whose directory identity no longer matches our claim.
  }
}

export async function writeGrandHallNativeInclusiveVisibleFirstComparison(
  browserReceiptPath: string,
  nativeDirectory: string,
  outputDirectory: string,
  options: GrandHallNativeInclusiveWriteOptions = {},
): Promise<Record<string, unknown>> {
  const location = await assertOutputLocation(browserReceiptPath, nativeDirectory, outputDirectory);
  if (await pathExists(location.target)) fail("OUTPUT_EXISTS", `Refusing to replace existing output: ${location.target}`);
  const artifacts = await buildGrandHallNativeInclusiveVisibleFirstComparison(browserReceiptPath, nativeDirectory);
  const claim = await claimStaging(location);
  let published = false;
  try {
    await options.testHooks?.afterStagingClaimed?.({ stagingDirectory: claim.staging, targetDirectory: claim.target });
    await requireStagingIdentity(claim);
    for (const [name, bytes] of artifacts.files) await writeStagedFile(claim, name, bytes);
    const entries = await readdir(claim.staging, { withFileTypes: true });
    if (entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) fail("OUTPUT_UNSAFE", "Staging contains a non-regular or linked entry.");
    exactInventory([...artifacts.files.keys()], entries.map((entry) => entry.name), "Native-inclusive staging");
    await publishStaging(claim, artifacts, options.testHooks);
    published = true;
    return artifacts.receipt;
  } finally {
    if (!published) await cleanupStaging(claim);
  }
}

export async function checkGrandHallNativeInclusiveVisibleFirstComparison(
  browserReceiptPath: string,
  nativeDirectory: string,
  outputDirectory: string,
  options: GrandHallNativeInclusiveCheckOptions = {},
): Promise<Record<string, unknown>> {
  const location = await assertOutputLocation(browserReceiptPath, nativeDirectory, outputDirectory);
  const output = await strictDirectDirectory(location.target, "Native-inclusive output directory").catch(() => fail("OUTPUT_MISMATCH", "Output directory is missing or unsafe."));
  await options.testHooks?.afterOutputIdentityRead?.({ outputDirectory: output.root });
  await requireDirectoryIdentity(output.root, output.identity, "Native-inclusive output directory");
  const expected = await buildGrandHallNativeInclusiveVisibleFirstComparison(browserReceiptPath, nativeDirectory);
  await requireDirectoryIdentity(output.root, output.identity, "Native-inclusive output directory");
  const entries = await readdir(output.root, { withFileTypes: true });
  if (entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) fail("OUTPUT_UNSAFE", "Output contains a non-regular or linked entry.");
  exactInventory([...expected.files.keys()], entries.map((entry) => entry.name), "Native-inclusive output");
  for (const [name, bytes] of expected.files) {
    await options.testHooks?.beforeOutputMemberRead?.({ outputDirectory: output.root, fileName: name });
    await requireDirectoryIdentity(output.root, output.identity, "Native-inclusive output directory");
    const actual = await stableFile(join(output.root, name), `native-inclusive output ${name}`);
    if (actual.compare(bytes) !== 0) fail("OUTPUT_MISMATCH", `${name} differs from deterministic regeneration.`);
    if (name === GRAND_HALL_NATIVE_INCLUSIVE_RECEIPT) {
      const parsed = parseGrandHallT554StrictJson(actual);
      if (canonicalBytes(parsed).compare(actual) !== 0) fail("OUTPUT_MISMATCH", "Native-inclusive receipt is not canonical JSON with one trailing newline.");
    }
  }
  await requireDirectoryIdentity(output.root, output.identity, "Native-inclusive output directory");
  await requireDirectoryIdentity(location.parent, location.parentIdentity, "Native-inclusive output parent");
  return expected.receipt;
}
