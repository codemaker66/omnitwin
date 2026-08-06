#!/usr/bin/env node

/**
 * Capture three fresh same-camera renders for each frozen source-photo view.
 *
 * This authority-none runner never opens LCC, starts vendor software, chooses a
 * winner, or publishes an asset. It consumes an already-frozen Python protocol
 * and an explicit loopback-only plan, drives the existing development preflight
 * page, records increasing browser-frame evidence, and emits input for
 * compare_source_photo_renders.py.
 */

import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { createServer } from "node:http";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";
import {
  assertReceptionCaptureRuntimeVersions,
  computeReceptionCaptureRuntimeEnvironmentDigest,
  computeReceptionCaptureRuntimeBuildDigest,
  receptionCaptureRuntimeEnvironment,
  receptionCaptureRuntimeBuildInputs,
} from "../../packages/web/scripts/reception-capture-runtime-build-digest.mjs";


export const CAPTURE_PLAN_SCHEMA_VERSION = "venviewer.reception-source-photo-capture-plan.v1";
export const CAPTURE_RECEIPT_SCHEMA_VERSION = "venviewer.reception-source-photo-capture-receipt.v3";
export const RUN_SCHEMA_VERSION = "venviewer.reception-source-photo-cv-run.v2";
export const SERVED_PAGE_MANIFEST_SCHEMA_VERSION = "venviewer.reception-served-page-manifest.v1";

const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,95}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const VALUE_OPTIONS = new Map([
  ["--repo-root", "repoRoot"],
  ["--protocol", "protocol"],
  ["--plan", "plan"],
  ["--output-root", "outputRoot"],
]);
const FLAG_OPTIONS = new Map([
  ["--help", "help"],
  ["--verify-only", "verifyOnly"],
]);
const FRAME_COUNTER_NAME = "__venviewerSourcePhotoCaptureFrameCounter";
const FRAME_COUNTER_STORAGE_KEY = "venviewer-source-photo-capture-frame-counter-v1";
const SETTLE_FRAME_COUNT = 30;
const MAX_ASSET_FILE_BYTES = 64 * 1024 * 1024;
const MAX_CANDIDATE_SET_BYTES = 512 * 1024 * 1024;
const CAPTURE_ADAPTER_SCHEMA_VERSION = "venviewer.reception-renderer-capture.v1";
const PRESENTATION_FONT_STYLESHEET_URL =
  "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght,SOFT,WONK@0,9..144,300..700,0..100,0..1;1,9..144,300..700,0..100,0..1&family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&family=Geist:wght@300;400;500;600&family=Geist+Mono:wght@400;500&display=swap";
const CAPTURE_RESULT_KEYS = [
  "schemaVersion", "protocolDigest", "challengeNonce", "documentSessionId",
  "renderSequence", "presentedFrameId", "candidateId", "viewId", "assetSetSha256",
  "assetReceipts", "profileId", "loadedSourceCount", "loadedSplatCount",
  "rendererBinding", "camera", "renderer", "framebufferPixelSha256",
  "rendererFrameDigest", "framebufferRgbaBase64",
];
const SERVED_PAGE_MANIFEST_DOMAIN = "venviewer.reception-served-page-manifest.v1\0";
const TOOLCHAIN_MANIFEST_DOMAIN = "venviewer.reception-capture-toolchain.v1\0";
const PACKAGE_TREE_DOMAIN = "venviewer.reception-capture-package-tree.v1\0";
const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);
const CAPTURE_FAVICON_BYTES = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>',
  "utf8",
);


class JsonKeyScanner {
  constructor(text, label) {
    this.text = text;
    this.label = label;
    this.index = 0;
  }

  scan() {
    this.skipSpace();
    this.value("$");
    this.skipSpace();
    if (this.index !== this.text.length) this.fail("contains trailing data");
  }

  value(location) {
    this.skipSpace();
    const token = this.text[this.index];
    if (token === "{") this.object(location);
    else if (token === "[") this.array(location);
    else if (token === '"') this.string();
    else if (token === "t") this.literal("true");
    else if (token === "f") this.literal("false");
    else if (token === "n") this.literal("null");
    else this.number();
  }

  object(location) {
    this.expect("{");
    const keys = new Set();
    this.skipSpace();
    if (this.take("}")) return;
    while (true) {
      this.skipSpace();
      if (this.text[this.index] !== '"') this.fail("has a non-string object key");
      const key = this.string();
      if (keys.has(key)) this.fail(`contains duplicate key ${JSON.stringify(key)} at ${location}`);
      keys.add(key);
      this.skipSpace();
      this.expect(":");
      this.value(`${location}.${key}`);
      this.skipSpace();
      if (this.take("}")) return;
      this.expect(",");
    }
  }

  array(location) {
    this.expect("[");
    this.skipSpace();
    if (this.take("]")) return;
    let index = 0;
    while (true) {
      this.value(`${location}[${index}]`);
      index += 1;
      this.skipSpace();
      if (this.take("]")) return;
      this.expect(",");
    }
  }

  string() {
    const start = this.index;
    this.expect('"');
    while (this.index < this.text.length) {
      const token = this.text[this.index];
      this.index += 1;
      if (token === '"') {
        try {
          return JSON.parse(this.text.slice(start, this.index));
        } catch {
          this.fail("contains an invalid JSON string");
        }
      }
      if (token === "\\") this.escape();
      else if (token.charCodeAt(0) < 0x20) this.fail("contains a control character in a string");
    }
    this.fail("contains an unterminated string");
  }

  escape() {
    const token = this.text[this.index];
    this.index += 1;
    if ('"\\/bfnrt'.includes(token)) return;
    if (token !== "u" || !/^[0-9a-fA-F]{4}$/u.test(this.text.slice(this.index, this.index + 4))) {
      this.fail("contains an invalid JSON escape");
    }
    this.index += 4;
  }

  number() {
    const remainder = this.text.slice(this.index);
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(remainder);
    if (match === null) this.fail("contains an invalid value");
    this.index += match[0].length;
  }

  literal(value) {
    if (!this.text.startsWith(value, this.index)) this.fail("contains an invalid literal");
    this.index += value.length;
  }

  skipSpace() {
    while (/\s/u.test(this.text[this.index] ?? "")) this.index += 1;
  }

  expect(value) {
    if (!this.take(value)) this.fail(`expected ${JSON.stringify(value)}`);
  }

  take(value) {
    if (!this.text.startsWith(value, this.index)) return false;
    this.index += value.length;
    return true;
  }

  fail(message) {
    throw new Error(`${this.label} ${message} near byte ${this.index}`);
  }
}


export function parseJsonDocument(bytes, label) {
  let textValue;
  try {
    textValue = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} is not valid UTF-8`);
  }
  new JsonKeyScanner(textValue, label).scan();
  return JSON.parse(textValue);
}


function exactObject(value, keys, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} keys differ; expected ${expected.join(", ")}, observed ${actual.join(", ")}`);
  }
  return value;
}

function safeId(value, label) {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    throw new Error(`${label} must be a lower-case safe identifier`);
  }
  return value;
}

function sha256(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new Error(`${label} must be a lower-case SHA-256`);
  }
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
  return value;
}

function boundedAssetSize(value, label) {
  const size = positiveInteger(value, label);
  if (size > MAX_ASSET_FILE_BYTES) throw new Error(`${label} exceeds the v1 per-file limit`);
  return size;
}

function absoluteFilePath(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value)) throw new Error(`${label} must be an absolute file path`);
  return path.normalize(value);
}

function requestPath(value, label) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    throw new Error(`${label} must be an origin-relative path`);
  }
  const parsed = new URL(value, "http://127.0.0.1");
  if (parsed.pathname !== value || parsed.search || parsed.hash) {
    throw new Error(`${label} cannot contain a query, fragment, or path normalization`);
  }
  return value;
}

function loopbackOrigin(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid loopback origin`);
  }
  const hosts = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
  if (
    !hosts.has(parsed.hostname)
    || !["http:", "https:"].includes(parsed.protocol)
    || parsed.username !== ""
    || parsed.password !== ""
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
  ) {
    throw new Error(`${label} must be an HTTP(S) loopback origin without a path, query, or fragment`);
  }
  return parsed.origin;
}

function captureAssetOrigin(value, label) {
  const parsed = new URL(loopbackOrigin(value, label));
  const port = Number(parsed.port);
  if (
    parsed.protocol !== "http:"
    || parsed.hostname !== "127.0.0.1"
    || !Number.isInteger(port)
    || port < 1_024
    || port > 65_535
  ) {
    throw new Error(`${label} must be an explicit 127.0.0.1 HTTP port`);
  }
  return parsed.origin;
}

export function parseCliArguments(argv) {
  const parsed = { help: false, verifyOnly: false };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (seen.has(token)) throw new Error(`duplicate option: ${token}`);
    if (FLAG_OPTIONS.has(token)) {
      seen.add(token);
      parsed[FLAG_OPTIONS.get(token)] = true;
      continue;
    }
    const key = VALUE_OPTIONS.get(token);
    if (key === undefined) throw new Error(token?.startsWith("--") ? `unknown option: ${token}` : `unexpected positional argument: ${token}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`option ${token} requires exactly one value`);
    seen.add(token);
    parsed[key] = value;
    index += 1;
  }
  if (parsed.help) {
    if (argv.length !== 1) throw new Error("--help must be used alone");
    return parsed;
  }
  for (const [option, key] of VALUE_OPTIONS) {
    if (parsed[key] === undefined) throw new Error(`missing required option: ${option}`);
    if (!path.isAbsolute(parsed[key])) throw new Error(`${option} must be an absolute path`);
    parsed[key] = path.normalize(parsed[key]);
  }
  return parsed;
}

function parseAsset(value, candidateIndex, assetIndex) {
  const label = `candidates[${candidateIndex}].assets[${assetIndex}]`;
  const raw = exactObject(value, ["requestPath", "localPath", "sha256", "sizeBytes"], label);
  return {
    requestPath: requestPath(raw.requestPath, `${label}.requestPath`),
    localPath: absoluteFilePath(raw.localPath, `${label}.localPath`),
    sha256: sha256(raw.sha256, `${label}.sha256`),
    sizeBytes: boundedAssetSize(raw.sizeBytes, `${label}.sizeBytes`),
  };
}

export function assetSetDigest(assets) {
  const identity = [...assets]
    .sort((left, right) => left.requestPath.localeCompare(right.requestPath))
    .map(({ requestPath: requestedPath, sha256: digest, sizeBytes }) => ({ requestedPath, digest, sizeBytes }));
  return sha256Bytes(Buffer.from(JSON.stringify(identity), "utf8"));
}

function parseCandidate(value, index) {
  const raw = exactObject(
    value,
    ["candidateId", "assetSetSha256", "profileId", "expectedSplatCount", "assetOrigin", "assets"],
    `candidates[${index}]`,
  );
  if (!Array.isArray(raw.assets) || raw.assets.length < 1 || raw.assets.length > 16) {
    throw new Error(`candidates[${index}].assets must contain one through sixteen files`);
  }
  const assets = raw.assets.map((asset, assetIndex) => parseAsset(asset, index, assetIndex));
  const paths = assets.map((asset) => asset.requestPath);
  const localPaths = assets.map((asset) => asset.localPath.toLowerCase());
  if (new Set(paths).size !== paths.length || new Set(localPaths).size !== localPaths.length) {
    throw new Error(`candidates[${index}].assets must have unique request and local paths`);
  }
  if (assets.reduce((total, asset) => total + asset.sizeBytes, 0) > MAX_CANDIDATE_SET_BYTES) {
    throw new Error(`candidates[${index}].assets exceed the v1 candidate-set limit`);
  }
  const expectedSetDigest = sha256(raw.assetSetSha256, `candidates[${index}].assetSetSha256`);
  if (assetSetDigest(assets) !== expectedSetDigest) throw new Error(`candidates[${index}] asset-set digest does not match its files`);
  return {
    candidateId: safeId(raw.candidateId, `candidates[${index}].candidateId`),
    assetSetSha256: expectedSetDigest,
    profileId: safeId(raw.profileId, `candidates[${index}].profileId`),
    expectedSplatCount: positiveInteger(raw.expectedSplatCount, `candidates[${index}].expectedSplatCount`),
    assetOrigin: captureAssetOrigin(raw.assetOrigin, `candidates[${index}].assetOrigin`),
    assets,
  };
}

export function parseCapturePlan(value, protocol) {
  const raw = exactObject(
    value,
    ["schemaVersion", "authority", "protocolDigest", "webOrigin", "candidates"],
    "capture plan",
  );
  if (raw.schemaVersion !== CAPTURE_PLAN_SCHEMA_VERSION || raw.authority !== "none") {
    throw new Error("capture plan header is invalid");
  }
  if (raw.protocolDigest !== protocol.protocolDigest) throw new Error("capture plan protocol digest does not match");
  if (!Array.isArray(raw.candidates) || raw.candidates.length !== 2) throw new Error("capture plan needs exactly two candidates");
  const candidates = raw.candidates.map(parseCandidate);
  const candidateIds = candidates.map((candidate) => candidate.candidateId);
  if (new Set(candidateIds).size !== 2 || JSON.stringify(candidateIds) !== JSON.stringify(protocol.candidateIds)) {
    throw new Error("capture plan candidate IDs must match the frozen protocol in order");
  }
  const bindings = new Map(protocol.candidateBindings.map((item) => [item.candidateId, item]));
  for (const candidate of candidates) {
    const frozen = bindings.get(candidate.candidateId);
    if (frozen === undefined
      || candidate.assetSetSha256 !== frozen.assetSetSha256
      || candidate.profileId !== frozen.profileId
      || candidate.expectedSplatCount !== frozen.expectedSplatCount) {
      throw new Error(`${candidate.candidateId} identity does not match its frozen candidate binding`);
    }
  }
  if (new Set(candidateIds).size !== candidateIds.length || !candidateIds.every((id) => ["quality", "mobile"].includes(id))) {
    throw new Error("v1 local preflight supports only quality and mobile candidate IDs");
  }
  const webOrigin = captureAssetOrigin(raw.webOrigin, "webOrigin");
  const assetOrigins = candidates.map((candidate) => candidate.assetOrigin);
  if (new Set(assetOrigins).size !== assetOrigins.length || assetOrigins.includes(webOrigin)) {
    throw new Error("candidate asset origins must be unique and separate from the web origin");
  }
  return { schemaVersion: CAPTURE_PLAN_SCHEMA_VERSION, authority: "none", protocolDigest: raw.protocolDigest, webOrigin, candidates };
}

export function buildCameraQuery(candidateId, view, captureNonce) {
  return new URLSearchParams({
    candidate: candidateId,
    camera: view.camera.positionMetres.join(","),
    lookAt: view.camera.targetMetres.join(","),
    up: view.camera.up.join(","),
    fov: String(view.camera.verticalFovDegrees),
    experimentalViewId: view.viewId,
    capture: "1",
    captureNonce,
  }).toString();
}

export function buildCaptureReceipt({
  protocol,
  candidate,
  view,
  captureOrdinal,
  renderedFrameCounter,
  capturedAtUtc,
  captureId,
  reloadId,
  imageSha256,
  captureRunnerSha256,
  captureProvenance,
  telemetry,
}) {
  return {
    schemaVersion: CAPTURE_RECEIPT_SCHEMA_VERSION,
    authority: "none",
    protocolDigest: protocol.protocolDigest,
    candidateId: candidate.candidateId,
    viewId: view.viewId,
    captureId,
    reloadId,
    cameraDigest: view.cameraDigest,
    roomStateDigest: view.roomStateDigest,
    assetSha256: candidate.assetSetSha256,
    profileId: candidate.profileId,
    expectedSplatCount: candidate.expectedSplatCount,
    rendererConfigDigest: protocol.rendererBinding.digest,
    runtimeBuildDigest: protocol.rendererBinding.runtimeBuildDigest,
    runtimeEnvironmentDigest: protocol.rendererBinding.runtimeEnvironmentDigest,
    profileDigest: protocol.rendererBinding.profileDigest,
    toneMapDigest: protocol.rendererBinding.toneMapDigest,
    exposureDigest: protocol.rendererBinding.exposureDigest,
    colourSpaceDigest: protocol.rendererBinding.colourSpaceDigest,
    captureEvidenceClass: protocol.captureBinding.evidenceClass,
    capturePlanSha256: captureProvenance.planSha256,
    capturePlanSizeBytes: captureProvenance.planSizeBytes,
    webOrigin: captureProvenance.webOrigin,
    servedPageManifestDigest: captureProvenance.servedPageManifestDigest,
    captureToolchainDigest: captureProvenance.captureToolchainDigest,
    presentedFrameId: telemetry.presentedFrameId,
    rendererFrameDigest: telemetry.rendererFrameDigest,
    frameEvidence: telemetry.frameEvidence,
    imageSha256,
    captureOrdinal,
    renderedFrameCounter,
    capturedAtUtc,
    captureRunnerSha256,
  };
}

export function validateFrameEvidence(receipts) {
  if (!Array.isArray(receipts) || receipts.length !== 3) throw new Error("frame evidence needs exactly three captures");
  const ordinals = receipts.map((receipt) => receipt.captureOrdinal);
  if (JSON.stringify(ordinals) !== JSON.stringify([1, 2, 3])) throw new Error("capture ordinals must be 1, 2, 3");
  const counters = receipts.map((receipt) => receipt.renderedFrameCounter);
  if (!(counters[0] < counters[1] && counters[1] < counters[2])) throw new Error("rendered frame counters must strictly increase");
  const timestamps = receipts.map((receipt) => Date.parse(receipt.capturedAtUtc));
  if (timestamps.some((value) => !Number.isFinite(value)) || !(timestamps[0] < timestamps[1] && timestamps[1] < timestamps[2])) {
    throw new Error("capture times must be valid and strictly increase");
  }
  const presented = receipts.map((receipt) => receipt.presentedFrameId);
  const digests = receipts.map((receipt) => receipt.rendererFrameDigest);
  if (new Set(presented).size !== 3 || new Set(digests).size !== 3) {
    throw new Error("renderer-presented frame identities must be fresh and unique");
  }
}

async function sha256File(filePath) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) digest.update(chunk);
  return digest.digest("hex");
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function stableCanonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("renderer binding contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableCanonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableCanonicalJson(value[key])}`).join(",")}}`;
  }
  throw new Error("renderer binding contains a non-canonical value");
}

function componentDigest(domain, value) {
  return sha256Bytes(Buffer.from(`${domain}${stableCanonicalJson(value)}`, "utf8"));
}

export async function expectedReceptionRendererBinding(repoRoot, environment = {}) {
  const manifestPath = path.join(repoRoot, "packages", "web", "src", "pages", "living-hall", "reception-capture-binding-v1.json");
  const manifest = parseJsonDocument(await readFile(manifestPath), "Reception capture binding manifest");
  const raw = exactObject(manifest, [
    "schemaVersion", "digestDomains", "viewerProfile", "toneMap", "exposure",
    "colourSpace", "captureBackgroundRgb", "lockedRuntimeVersions",
  ], "Reception capture binding manifest");
  if (raw.schemaVersion !== "venviewer.reception-renderer-binding.v1") throw new Error("Reception capture binding version is invalid");
  const domains = exactObject(raw.digestDomains, [
    "rendererBinding", "runtimeEnvironment", "profile", "toneMap", "exposure", "colourSpace", "frame",
  ], "Reception capture digest domains");
  const runtimeEnvironmentDigest = computeReceptionCaptureRuntimeEnvironmentDigest(environment);
  if (runtimeEnvironmentDigest !== componentDigest(
    domains.runtimeEnvironment,
    receptionCaptureRuntimeEnvironment(environment),
  )) throw new Error("Reception capture runtime environment domain is inconsistent");
  const components = {
    colourSpaceDigest: componentDigest(domains.colourSpace, raw.colourSpace),
    exposureDigest: componentDigest(domains.exposure, raw.exposure),
    profileDigest: componentDigest(domains.profile, raw.viewerProfile),
    runtimeBuildDigest: computeReceptionCaptureRuntimeBuildDigest(repoRoot),
    runtimeEnvironmentDigest,
    toneMapDigest: componentDigest(domains.toneMap, raw.toneMap),
  };
  return {
    digest: componentDigest(domains.rendererBinding, components),
    ...components,
    frameDomain: domains.frame,
    captureBackgroundRgb: raw.captureBackgroundRgb,
    expectedSplatMeshMatrixWorld: raw.viewerProfile.expectedSplatMeshMatrixWorld,
  };
}

function assertRendererBinding(actual, expected) {
  const keys = [
    "digest", "runtimeBuildDigest", "runtimeEnvironmentDigest", "profileDigest",
    "toneMapDigest", "exposureDigest", "colourSpaceDigest",
  ];
  for (const key of keys) {
    if (actual?.[key] !== expected[key]) throw new Error(`protocol renderer binding ${key} does not match the real capture build`);
  }
}

async function runPythonVerification(repoRoot, protocolPath) {
  const tool = path.join(repoRoot, "tools", "reception-hd", "compare_source_photo_renders.py");
  const executable = process.platform === "win32" ? "python" : "python3";
  const child = spawn(executable, [tool, "verify-protocol", "--protocol", protocolPath], {
    cwd: repoRoot,
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0) throw new Error(`protocol verification failed: ${Buffer.concat(stderr).toString("utf8").trim()}`);
  return JSON.parse(Buffer.concat(stdout).toString("utf8"));
}

function transposeMatrix4(values) {
  if (!Array.isArray(values) || values.length !== 16) throw new Error("camera matrix must contain sixteen values");
  return Array.from({ length: 16 }, (_, index) => values[(index % 4) * 4 + Math.floor(index / 4)]);
}

function parseNumberList(value, length, label) {
  const parsed = String(value ?? "").split(",").map(Number);
  if (parsed.length !== length || parsed.some((entry) => !Number.isFinite(entry))) throw new Error(`${label} is invalid`);
  return parsed;
}

function arraysClose(left, right, tolerance = 1e-8) {
  return left.length === right.length && left.every((value, index) => Math.abs(value - right[index]) <= tolerance);
}

function pngDimensions(bytes) {
  if (bytes.length < 24 || bytes.toString("ascii", 1, 4) !== "PNG" || bytes.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("Playwright did not return a valid PNG");
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(name, payload) {
  const type = Buffer.from(name, "ascii");
  const body = Buffer.concat([type, payload]);
  const result = Buffer.alloc(12 + payload.length);
  result.writeUInt32BE(payload.length, 0);
  body.copy(result, 4);
  result.writeUInt32BE(crc32(body), result.length - 4);
  return result;
}

function compositeRgbaRows(rgba, width, height, background) {
  const scanlines = Buffer.alloc(height * (1 + width * 3));
  for (let row = 0; row < height; row += 1) {
    const outputRow = row * (1 + width * 3);
    scanlines[outputRow] = 0;
    for (let column = 0; column < width; column += 1) {
      const source = (row * width + column) * 4;
      const target = outputRow + 1 + column * 3;
      const alpha = rgba[source + 3];
      for (let channel = 0; channel < 3; channel += 1) {
        const foreground = rgba[source + channel];
        scanlines[target + channel] = Math.min(255, foreground + Math.round(background[channel] * (255 - alpha) / 255));
      }
    }
  }
  return scanlines;
}

function encodeRgbPng(rgba, width, height, background) {
  if (!Buffer.isBuffer(rgba) || rgba.length !== width * height * 4) throw new Error("captured framebuffer byte count is invalid");
  if (!Array.isArray(background) || background.length !== 3 || background.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    throw new Error("capture background is invalid");
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", ihdr),
    pngChunk("sRGB", Buffer.from([0])),
    pngChunk("IDAT", deflateSync(compositeRgbaRows(rgba, width, height, background), { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function decodeCanonicalBase64(value, expectedBytes) {
  if (typeof value !== "string" || value.length > Math.ceil(expectedBytes / 3) * 4 + 4 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) {
    throw new Error("capture adapter framebuffer is not canonical base64");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== expectedBytes || bytes.toString("base64") !== value) throw new Error("capture adapter framebuffer size is wrong");
  return bytes;
}

function capturePath(candidateId, viewId, ordinal) {
  return `captures/${candidateId}-${viewId}-${ordinal}.png`;
}

function receiptPath(candidateId, viewId, ordinal) {
  return `receipts/${candidateId}-${viewId}-${ordinal}.json`;
}

async function fileReference(root, relativePath) {
  const absolute = path.join(root, ...relativePath.split("/"));
  return { path: relativePath, sha256: await sha256File(absolute) };
}

async function fileIdentityReference(root, relativePath) {
  const absolute = path.join(root, ...relativePath.split("/"));
  const info = await lstat(absolute);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`capture evidence is not a regular file: ${relativePath}`);
  }
  return { path: relativePath, sizeBytes: info.size, sha256: await sha256File(absolute) };
}

function candidateById(plan, candidateId) {
  const candidate = plan.candidates.find((entry) => entry.candidateId === candidateId);
  if (candidate === undefined) throw new Error(`capture plan is missing candidate ${candidateId}`);
  return candidate;
}

function captureRuntimeEnvironmentFromPlan(plan) {
  return {
    VITE_RECEPTION_MOBILE_ORIGIN: candidateById(plan, "mobile").assetOrigin,
    VITE_RECEPTION_QUALITY_ORIGIN: candidateById(plan, "quality").assetOrigin,
  };
}

function expectedAssetUrls(candidate) {
  return new Set(candidate.assets.map((asset) => new URL(asset.requestPath, candidate.assetOrigin).href));
}

export function validateAssetRequests(candidate, requestedUrls) {
  const expected = expectedAssetUrls(candidate);
  const requested = new Set(requestedUrls.map((value) => new URL(value).href));
  for (const url of expected) {
    if (!requested.has(url)) throw new Error(`${candidate.candidateId} did not request pinned asset ${url}`);
  }
  for (const url of requested) {
    if (!expected.has(url)) throw new Error(`${candidate.candidateId} requested unpinned asset ${url}`);
  }
}

async function loadCandidateAssetBytes(plan) {
  const candidates = new Map();
  for (const candidate of plan.candidates) {
    const assets = new Map();
    for (const asset of candidate.assets) {
      const bytes = await readFile(asset.localPath);
      if (bytes.length !== asset.sizeBytes || sha256Bytes(bytes) !== asset.sha256) {
        throw new Error(`${candidate.candidateId} asset changed before browser admission: ${asset.requestPath}`);
      }
      assets.set(new URL(asset.requestPath, candidate.assetOrigin).href, bytes);
    }
    candidates.set(candidate.candidateId, assets);
  }
  return candidates;
}

async function waitForFreshFrames(page, previousCounter) {
  await page.waitForFunction(
    ({ name, minimum }) => Number(window[name] ?? 0) >= minimum,
    { name: FRAME_COUNTER_NAME, minimum: previousCounter + SETTLE_FRAME_COUNT },
    { timeout: 30_000 },
  );
  return page.evaluate((name) => Number(window[name] ?? 0), FRAME_COUNTER_NAME);
}

async function inspectReadyPage(page, protocol, candidate, view) {
  await page.waitForFunction(
    ({ candidateId, expectedCount, expectedSources, expectedView, assetSet, renderer }) => {
      const root = document.querySelector(".lh-root");
      const scene = document.querySelector(".lh-scene");
      return root instanceof HTMLElement && scene instanceof HTMLElement
        && root.dataset.preflightCandidateId === candidateId
        && root.dataset.preflightReviewViewId === expectedView
        && root.dataset.preflightRuntimeProfileId !== undefined
        && root.dataset.preflightLoadedAssetSetSha256 === assetSet
        && root.dataset.preflightRendererConfigDigest === renderer.digest
        && root.dataset.preflightRuntimeBuildDigest === renderer.runtimeBuildDigest
        && root.dataset.preflightRuntimeEnvironmentDigest === renderer.runtimeEnvironmentDigest
        && root.dataset.preflightProfileDigest === renderer.profileDigest
        && root.dataset.preflightToneMapDigest === renderer.toneMapDigest
        && root.dataset.preflightExposureDigest === renderer.exposureDigest
        && root.dataset.preflightColourSpaceDigest === renderer.colourSpaceDigest
        && scene.dataset.sceneState === "live"
        && scene.dataset.cameraReady === "true"
        && scene.dataset.loadedSourceCount === String(expectedSources)
        && scene.dataset.loadedSplatCount === String(expectedCount)
        && document.querySelector(".lh-scene-poster") === null
        && typeof window.__venviewerCaptureV1?.capture === "function";
    },
    {
      candidateId: candidate.candidateId,
      expectedCount: candidate.expectedSplatCount,
      expectedSources: candidate.assets.length,
      expectedView: `experimental-e57:${view.viewId}`,
      assetSet: candidate.assetSetSha256,
      renderer: protocol.rendererBinding,
    },
    { timeout: 90_000 },
  );
  const root = await page.locator(".lh-root").evaluate((element) => ({ ...element.dataset }));
  const scene = await page.locator(".lh-scene").evaluate((element) => ({ ...element.dataset }));
  if (root.preflightRuntimeProfileId !== candidate.profileId) throw new Error("page rendered an unexpected candidate profile");
  const position = parseNumberList(scene.cameraPosition, 3, "camera position");
  const viewMatrix = transposeMatrix4(parseNumberList(scene.cameraViewMatrix, 16, "camera view matrix"));
  const projection = transposeMatrix4(parseNumberList(scene.cameraProjectionMatrix, 16, "camera projection matrix"));
  if (!arraysClose(position, view.camera.positionMetres) || !arraysClose(viewMatrix, view.camera.worldToCamera) || !arraysClose(projection, view.camera.projectionMatrix)) {
    throw new Error(`${candidate.candidateId}/${view.viewId} camera binding drifted`);
  }
}

function validateAdapterAssets(rawAssets, candidate, binding) {
  if (!Array.isArray(rawAssets) || rawAssets.length !== candidate.assets.length) throw new Error("capture adapter asset receipt count is wrong");
  const expected = new Map(candidate.assets.map((asset) => [asset.requestPath, asset]));
  const receipts = rawAssets.map((value, index) => {
    const raw = exactObject(value, [
      "candidateId", "requestPath", "sha256", "sizeBytes", "sourceId",
      "renderProfileId", "meshUuid", "splatCount", "initialized", "visible",
      "opacity", "maxSh", "enableLod", "matrixWorld",
    ], `capture adapter assetReceipts[${index}]`);
    const asset = expected.get(raw.requestPath);
    const expectedSourceId = asset === undefined ? null
      : `local-preflight:${candidate.candidateId}:${asset.requestPath.slice(asset.requestPath.lastIndexOf("/") + 1)}`;
    if (asset === undefined || raw.candidateId !== candidate.candidateId || raw.sha256 !== asset.sha256
      || raw.sizeBytes !== asset.sizeBytes || raw.renderProfileId !== "reception-fixed-fine-review-v1"
      || raw.initialized !== true || raw.visible !== true || raw.opacity !== 1 || raw.maxSh !== 3
      || raw.enableLod !== false || raw.sourceId !== expectedSourceId || typeof raw.meshUuid !== "string"
      || !Array.isArray(raw.matrixWorld) || raw.matrixWorld.length !== 16
      || raw.matrixWorld.some((entry) => !Number.isFinite(entry)) || !Number.isInteger(raw.splatCount)
      || raw.splatCount <= 0
      || !arraysClose(raw.matrixWorld, binding.expectedSplatMeshMatrixWorld)) {
      throw new Error("capture adapter reported an unexpected active splat mesh");
    }
    expected.delete(raw.requestPath);
    return raw;
  });
  const total = receipts.reduce((sum, receipt) => sum + receipt.splatCount, 0);
  if (total !== candidate.expectedSplatCount) throw new Error("capture adapter total splat count is wrong");
  return receipts;
}

function validateAdapterCamera(rawCamera, view) {
  const camera = exactObject(rawCamera, [
    "positionMetres", "quaternion", "worldMatrix", "worldToCamera", "projectionMatrix",
  ], "capture adapter camera");
  const position = camera.positionMetres;
  const worldToCamera = transposeMatrix4(camera.worldToCamera);
  const projection = transposeMatrix4(camera.projectionMatrix);
  if (!Array.isArray(position) || position.length !== 3 || position.some((entry) => !Number.isFinite(entry))
    || !arraysClose(position, view.camera.positionMetres) || !arraysClose(worldToCamera, view.camera.worldToCamera)
    || !arraysClose(projection, view.camera.projectionMatrix)) {
    throw new Error("capture adapter camera differs from the frozen view");
  }
  return camera;
}

function validateAdapterRenderer(rawRenderer, view, candidate) {
  const renderer = exactObject(rawRenderer, [
    "browserUserAgent", "webglVersion", "webglShadingLanguageVersion",
    "webglVendor", "webglRenderer",
    "threeFrame", "sparkLastFrame", "sparkActiveSplats", "drawingBufferWidth",
    "drawingBufferHeight", "effectiveDpr", "outputColorSpace", "toneMapping",
    "toneMappingExposure", "antialias", "alpha", "premultipliedAlpha", "contextLost",
    "sparkSorting", "sparkEnableLod", "sparkRenderSize",
  ], "capture adapter renderer");
  if (["browserUserAgent", "webglVersion", "webglShadingLanguageVersion", "webglVendor", "webglRenderer"]
    .some((key) => typeof renderer[key] !== "string" || renderer[key].length === 0)
    || !Number.isInteger(renderer.threeFrame) || renderer.threeFrame < 1
    || !Number.isInteger(renderer.sparkLastFrame) || renderer.sparkLastFrame < 0
    || !Number.isInteger(renderer.sparkActiveSplats) || renderer.sparkActiveSplats < 1
    || renderer.sparkActiveSplats > candidate.expectedSplatCount
    || renderer.drawingBufferWidth !== view.camera.imageWidth || renderer.drawingBufferHeight !== view.camera.imageHeight
    || renderer.effectiveDpr !== view.camera.viewport.devicePixelRatio || renderer.outputColorSpace !== "srgb"
    || renderer.toneMapping !== 4 || renderer.toneMappingExposure !== 1 || renderer.antialias !== false
    || renderer.alpha !== true || renderer.premultipliedAlpha !== true || renderer.contextLost !== false
    || renderer.sparkSorting !== false || renderer.sparkEnableLod !== false
    || !arraysClose(renderer.sparkRenderSize, [view.camera.imageWidth, view.camera.imageHeight])) {
    throw new Error("capture adapter renderer differs from the frozen profile");
  }
  return renderer;
}

function validateCaptureAdapterResult(rawValue, { protocol, candidate, view, challengeNonce, binding }) {
  const raw = exactObject(rawValue, CAPTURE_RESULT_KEYS, "capture adapter result");
  if (raw.schemaVersion !== CAPTURE_ADAPTER_SCHEMA_VERSION || raw.protocolDigest !== protocol.protocolDigest
    || raw.challengeNonce !== challengeNonce || raw.candidateId !== candidate.candidateId
    || raw.viewId !== view.viewId || raw.assetSetSha256 !== candidate.assetSetSha256
    || raw.profileId !== candidate.profileId || raw.loadedSourceCount !== candidate.assets.length
    || raw.loadedSplatCount !== candidate.expectedSplatCount || !Number.isInteger(raw.renderSequence)
    || raw.renderSequence < 1 || !/^[a-f0-9]{32}$/u.test(raw.documentSessionId)) {
    throw new Error("capture adapter result identity is wrong");
  }
  assertRendererBinding(raw.rendererBinding, protocol.rendererBinding);
  const assetReceipts = validateAdapterAssets(raw.assetReceipts, candidate, binding);
  const camera = validateAdapterCamera(raw.camera, view);
  const renderer = validateAdapterRenderer(raw.renderer, view, candidate);
  const pixelSha256 = sha256(raw.framebufferPixelSha256, "capture adapter framebuffer digest");
  const pixels = decodeCanonicalBase64(raw.framebufferRgbaBase64, view.camera.imageWidth * view.camera.imageHeight * 4);
  if (sha256Bytes(pixels) !== pixelSha256) throw new Error("capture adapter framebuffer digest is wrong");
  const { framebufferRgbaBase64: _pixels, rendererFrameDigest: _frameDigest, ...frameRecord } = raw;
  const expectedFrameDigest = componentDigest(binding.frameDomain, frameRecord);
  if (raw.rendererFrameDigest !== expectedFrameDigest) throw new Error("capture adapter frame digest is wrong");
  return {
    presentedFrameId: safeId(raw.presentedFrameId, "capture adapter presented frame ID"),
    rendererFrameDigest: sha256(raw.rendererFrameDigest, "capture adapter frame digest"),
    framebufferPixelSha256: pixelSha256,
    frameEvidence: frameRecord,
    image: encodeRgbPng(pixels, view.camera.imageWidth, view.camera.imageHeight, binding.captureBackgroundRgb),
    assetReceipts,
    camera,
    renderer,
  };
}

async function awaitWithTimeout(promise, timeoutMilliseconds, message) {
  let timeoutId = null;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMilliseconds);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
}

async function capturePresentedFrame(page, protocol, candidate, view, challengeNonce, binding) {
  const evaluation = page.evaluate(async (request) => {
    if (window.__venviewerCaptureV1 === undefined) throw new Error("renderer capture adapter is unavailable");
    return window.__venviewerCaptureV1.capture(request);
  }, { schemaVersion: CAPTURE_ADAPTER_SCHEMA_VERSION, protocolDigest: protocol.protocolDigest, challengeNonce });
  const raw = await awaitWithTimeout(
    evaluation,
    75_000,
    "renderer capture adapter did not finish within 75 seconds",
  );
  return validateCaptureAdapterResult(raw, { protocol, candidate, view, challengeNonce, binding });
}

function addFrameCounter(context) {
  return context.addInitScript(({ name, storageKey }) => {
    let counter = Number(sessionStorage.getItem(storageKey) ?? "0");
    Object.defineProperty(window, name, { configurable: false, get: () => counter });
    const tick = () => {
      counter += 1;
      sessionStorage.setItem(storageKey, String(counter));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, { name: FRAME_COUNTER_NAME, storageKey: FRAME_COUNTER_STORAGE_KEY });
}

function blockWebSockets(context) {
  if (typeof context.routeWebSocket !== "function") {
    throw new Error("capture requires Playwright WebSocket routing support");
  }
  return context.routeWebSocket(/.*/u, (socket) => socket.close());
}

function nextTimestamp(previousMilliseconds) {
  const milliseconds = Math.max(Date.now(), previousMilliseconds + 1);
  return { milliseconds, iso: new Date(milliseconds).toISOString() };
}

export function isIntentionallyBlockedCaptureRequest(url, method, resourceType) {
  return method === "GET"
    && resourceType === "stylesheet"
    && url.href === PRESENTATION_FONT_STYLESHEET_URL;
}

async function routeOwnedPageRequest(route, request, url, pageApp, external) {
  const resolved = resolveServedPageResponse(pageApp, url, request.method());
  if (resolved === null) {
    external.push(url.href);
    await route.abort("blockedbyclient");
    return;
  }
  await route.fulfill({
    status: 200,
    body: request.method() === "HEAD" ? Buffer.alloc(0) : resolved.bytes,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "Content-Type": resolved.contentType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function routeBrowserRequest({
  route, plan, pageApp, assetOrigins, candidateAssetBytes, assetRequests, external,
}) {
  const request = route.request();
  const url = new URL(request.url());
  if (["data:", "blob:"].includes(url.protocol)) {
    await route.continue();
    return;
  }
  if (url.origin === plan.webOrigin) {
    await routeOwnedPageRequest(route, request, url, pageApp, external);
    return;
  }
  if (!assetOrigins.has(url.origin)) {
    if (isIntentionallyBlockedCaptureRequest(url, request.method(), request.resourceType())) {
      await route.abort("blockedbyclient");
      return;
    }
    external.push(url.href);
    await route.abort("blockedbyclient");
    return;
  }
  assetRequests.push(url.href);
  const body = candidateAssetBytes.get(url.href);
  if (body === undefined) {
    external.push(url.href);
    await route.abort("blockedbyclient");
    return;
  }
  await route.fulfill({
    status: 200,
    body,
    headers: {
      "Access-Control-Allow-Origin": plan.webOrigin,
      "Cache-Control": "no-store",
      "Content-Type": "application/octet-stream",
    },
  });
}

async function captureCandidateView({
  browser, protocol, plan, candidate, view, tempRoot, runnerSha256,
  assetOrigins, candidateAssetBytes, binding, runtimeBuildSnapshot,
  pageApp, captureProvenance,
}) {
  const context = await browser.newContext({
    viewport: { width: view.camera.viewport.cssWidth, height: view.camera.viewport.cssHeight },
    deviceScaleFactor: view.camera.viewport.devicePixelRatio,
    colorScheme: "dark",
    locale: "en-GB",
    reducedMotion: "reduce",
    serviceWorkers: "block",
  });
  const external = [];
  const assetRequests = [];
  try {
    await addFrameCounter(context);
    await blockWebSockets(context);
    await context.route("**/*", (route) => routeBrowserRequest({
      route, plan, pageApp, assetOrigins, candidateAssetBytes, assetRequests, external,
    }));
    const page = await context.newPage();
    const errors = [];
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("pageerror", (error) => errors.push(error.message));
    return await captureThreeFreshFrames({
      page, protocol, plan, candidate, view, tempRoot, runnerSha256, external, errors,
      assetRequests, binding, runtimeBuildSnapshot, captureProvenance,
    });
  } finally {
    await context.close();
  }
}

async function captureThreeFreshFrames({
  page, protocol, plan, candidate, view, tempRoot, runnerSha256, external, errors,
  assetRequests, binding, runtimeBuildSnapshot, captureProvenance,
}) {
  const captures = [];
  const receiptData = [];
  let priorFrameCounter = 0;
  let priorTimestamp = 0;
  for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
    await verifyRuntimeBuildSnapshot(runtimeBuildSnapshot);
    assetRequests.length = 0;
    const captureId = `${candidate.candidateId}-${view.viewId}-capture-${ordinal}`;
    const reloadId = `${candidate.candidateId}-${view.viewId}-reload-${ordinal}`;
    const challengeNonce = `${captureId}-${randomBytes(8).toString("hex")}`;
    const target = new URL("/dev/reception-quality-preflight", plan.webOrigin);
    target.search = buildCameraQuery(candidate.candidateId, view, challengeNonce);
    await page.goto(target.href, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await inspectReadyPage(page, protocol, candidate, view);
    const renderedFrameCounter = await waitForFreshFrames(page, priorFrameCounter);
    const telemetry = await capturePresentedFrame(page, protocol, candidate, view, challengeNonce, binding);
    if (external.length > 0) throw new Error(`blocked external or unpinned browser request: ${external[0]}`);
    if (errors.length > 0) throw new Error(`browser error: ${errors[0]}`);
    validateAssetRequests(candidate, assetRequests);
    await verifyRuntimeBuildSnapshot(runtimeBuildSnapshot);
    const screenshot = telemetry.image;
    const dimensions = pngDimensions(screenshot);
    if (dimensions.width !== view.camera.imageWidth || dimensions.height !== view.camera.imageHeight) throw new Error("screenshot dimensions differ from the frozen camera");
    const imageRelative = capturePath(candidate.candidateId, view.viewId, ordinal);
    await writeFile(path.join(tempRoot, ...imageRelative.split("/")), screenshot, { flag: "wx" });
    const timestamp = nextTimestamp(priorTimestamp);
    const receipt = buildCaptureReceipt({
      protocol, candidate, view, captureOrdinal: ordinal, renderedFrameCounter,
      capturedAtUtc: timestamp.iso, captureId, reloadId,
      imageSha256: sha256Bytes(screenshot), captureRunnerSha256: runnerSha256,
      captureProvenance, telemetry,
    });
    const receiptRelative = receiptPath(candidate.candidateId, view.viewId, ordinal);
    await writeFile(path.join(tempRoot, ...receiptRelative.split("/")), `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
    captures.push({ image: await fileReference(tempRoot, imageRelative), receipt: await fileReference(tempRoot, receiptRelative) });
    receiptData.push(receipt);
    priorFrameCounter = renderedFrameCounter;
    priorTimestamp = timestamp.milliseconds;
  }
  validateFrameEvidence(receiptData);
  return { viewId: view.viewId, captures };
}

export async function captureAll({
  browser, protocol, plan, tempRoot, runnerSha256, binding, runtimeBuildSnapshot = null,
  pageApp = null, captureProvenance = null,
}) {
  if (pageApp === null) {
    throw new Error("captureAll requires the runner-owned immutable page application");
  }
  if (captureProvenance === null) {
    throw new Error("captureAll requires capture-plan and served-page provenance");
  }
  const assetOrigins = new Set(plan.candidates.map((candidate) => candidate.assetOrigin));
  const assetBytes = await loadCandidateAssetBytes(plan);
  const candidates = [];
  for (const candidateId of protocol.candidateIds) {
    const candidate = candidateById(plan, candidateId);
    const views = [];
    for (const view of protocol.views) {
      views.push(await captureCandidateView({
        browser, protocol, plan, candidate, view, tempRoot, runnerSha256,
        assetOrigins, candidateAssetBytes: assetBytes.get(candidateId), binding,
        runtimeBuildSnapshot, pageApp, captureProvenance,
      }));
    }
    candidates.push({
      candidateId,
      assetSha256: candidate.assetSetSha256,
      profileId: candidate.profileId,
      expectedSplatCount: candidate.expectedSplatCount,
      rendererConfigDigest: protocol.rendererBinding.digest,
      views,
    });
  }
  return candidates;
}

async function loadPlaywright(repoRoot) {
  const webRoot = path.join(repoRoot, "packages", "web");
  const webRequire = createRequire(path.join(webRoot, "package.json"));
  return { chromium: webRequire("@playwright/test").chromium, webRequire };
}

async function packageJsonPath(requireFrom, packageName) {
  try {
    return requireFrom.resolve(`${packageName}/package.json`);
  } catch {
    let directory = path.dirname(requireFrom.resolve(packageName));
    while (path.dirname(directory) !== directory) {
      const candidate = path.join(directory, "package.json");
      const parsed = await readFile(candidate, "utf8")
        .then((value) => JSON.parse(value), () => null);
      if (parsed?.name === packageName) return candidate;
      directory = path.dirname(directory);
    }
    throw new Error(`Cannot resolve capture toolchain package: ${packageName}`);
  }
}

async function collectTreeFiles(directory, relativeDirectory = "", output = []) {
  const entries = await readdir(path.join(directory, relativeDirectory), { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
  for (const entry of entries) {
    const relativePath = relativeDirectory === "" ? entry.name : `${relativeDirectory}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`capture toolchain contains a link: ${relativePath}`);
    if (entry.isDirectory()) await collectTreeFiles(directory, relativePath, output);
    else if (entry.isFile()) output.push(relativePath);
  }
  return output;
}

async function snapshotToolchainFile(filePath, label) {
  const info = await lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file`);
  }
  return {
    filePath,
    label,
    sizeBytes: info.size,
    sha256: await sha256File(filePath),
  };
}

export async function snapshotCaptureToolchainTree(directory, label = "capture toolchain") {
  const canonicalRoot = await realpath(directory);
  const relativePaths = await collectTreeFiles(canonicalRoot);
  const snapshots = [];
  for (const relativePath of relativePaths) {
    snapshots.push(await snapshotToolchainFile(
      path.join(canonicalRoot, ...relativePath.split("/")),
      `${label} ${relativePath}`,
    ));
  }
  const entries = snapshots.map(({ filePath: _path, label: _label, ...entry }, index) => ({
    path: relativePaths[index],
    ...entry,
  }));
  return {
    root: canonicalRoot,
    relativePaths,
    snapshots,
    fileCount: entries.length,
    sizeBytes: entries.reduce((total, entry) => total + entry.sizeBytes, 0),
    sha256: componentDigest(PACKAGE_TREE_DOMAIN, entries),
  };
}

async function packageToolchainIdentity(requireFrom, packageName) {
  const jsonPath = await packageJsonPath(requireFrom, packageName);
  const metadata = JSON.parse(await readFile(jsonPath, "utf8"));
  if (metadata.name !== packageName || typeof metadata.version !== "string") {
    throw new Error(`capture toolchain package metadata is invalid: ${packageName}`);
  }
  const tree = await snapshotCaptureToolchainTree(path.dirname(jsonPath), packageName);
  return {
    identity: {
      name: packageName,
      version: metadata.version,
      fileCount: tree.fileCount,
      sizeBytes: tree.sizeBytes,
      treeSha256: tree.sha256,
    },
    tree,
  };
}

async function capturePackageIdentities(webRequire) {
  const playwrightJson = await packageJsonPath(webRequire, "@playwright/test");
  const playwrightRequire = createRequire(playwrightJson);
  const playwrightPackageJson = await packageJsonPath(playwrightRequire, "playwright");
  const playwrightPackageRequire = createRequire(playwrightPackageJson);
  const requirements = [
    [webRequire, "vite"],
    [webRequire, "@vitejs/plugin-react"],
    [webRequire, "@playwright/test"],
    [playwrightRequire, "playwright"],
    [playwrightPackageRequire, "playwright-core"],
  ];
  return Promise.all(requirements.map(([requireFrom, packageName]) => (
    packageToolchainIdentity(requireFrom, packageName)
  )));
}

export async function snapshotCaptureToolchain(webRequire, chromium) {
  const packages = await capturePackageIdentities(webRequire);
  const nodeExecutable = await snapshotToolchainFile(process.execPath, "Node executable");
  const chromiumTree = await snapshotCaptureToolchainTree(
    path.dirname(chromium.executablePath()),
    "Chromium runtime",
  );
  const manifest = {
    schemaVersion: "venviewer.reception-capture-toolchain.v1",
    node: {
      version: process.version,
      platform: process.platform,
      architecture: process.arch,
      sizeBytes: nodeExecutable.sizeBytes,
      sha256: nodeExecutable.sha256,
    },
    packages: packages.map((item) => item.identity),
    chromium: {
      fileCount: chromiumTree.fileCount,
      sizeBytes: chromiumTree.sizeBytes,
      treeSha256: chromiumTree.sha256,
    },
  };
  return {
    manifest: { ...manifest, digest: componentDigest(TOOLCHAIN_MANIFEST_DOMAIN, manifest) },
    trees: [...packages.map((item) => item.tree), chromiumTree],
    files: [nodeExecutable],
  };
}

async function verifyToolchainTree(tree) {
  const current = await snapshotCaptureToolchainTree(tree.root, "capture toolchain recheck");
  if (
    JSON.stringify(current.relativePaths) !== JSON.stringify(tree.relativePaths)
    || current.fileCount !== tree.fileCount
    || current.sizeBytes !== tree.sizeBytes
    || current.sha256 !== tree.sha256
  ) throw new Error("capture toolchain package bytes changed during execution");
}

async function verifyCaptureToolchain(snapshot) {
  for (const file of snapshot.files) await snapshotFile(
    file.filePath,
    file.label,
    file.sha256,
    file.sizeBytes,
  );
  for (const tree of snapshot.trees) await verifyToolchainTree(tree);
}

async function loadCaptureBuildTools(webRequire) {
  const viteEntry = webRequire.resolve("vite");
  const reactEntry = webRequire.resolve("@vitejs/plugin-react");
  const viteModule = await import(pathToFileURL(viteEntry).href);
  const reactModule = await import(pathToFileURL(reactEntry).href);
  if (typeof viteModule.build !== "function" || typeof reactModule.default !== "function") {
    throw new Error("capture build toolchain exports are invalid");
  }
  return { build: viteModule.build, react: reactModule.default };
}

function captureBuildDefines(rendererBinding, environment) {
  return {
    __VENVIEWER_CLERK_PUBLISHABLE_KEY__: JSON.stringify(""),
    __VENVIEWER_RECEPTION_CAPTURE_RUNTIME_BUILD_DIGEST__: JSON.stringify(
      rendererBinding.runtimeBuildDigest,
    ),
    __VENVIEWER_RECEPTION_CAPTURE_RUNTIME_ENVIRONMENT_DIGEST__: JSON.stringify(
      rendererBinding.runtimeEnvironmentDigest,
    ),
    "import.meta.env.VITE_RECEPTION_MOBILE_ORIGIN": JSON.stringify(
      environment.VITE_RECEPTION_MOBILE_ORIGIN,
    ),
    "import.meta.env.VITE_RECEPTION_QUALITY_ORIGIN": JSON.stringify(
      environment.VITE_RECEPTION_QUALITY_ORIGIN,
    ),
    "import.meta.env.DEV": "true",
    "import.meta.env.PROD": "false",
    "import.meta.env.MODE": JSON.stringify("reception-capture"),
  };
}

async function buildCaptureWebApp({ repoRoot, outputDirectory, plan, rendererBinding, webRequire }) {
  const tools = await loadCaptureBuildTools(webRequire);
  const environment = captureRuntimeEnvironmentFromPlan(plan);
  await tools.build({
    root: path.join(repoRoot, "packages", "web"),
    configFile: false,
    publicDir: false,
    envFile: false,
    envPrefix: ["VENVIEWER_CAPTURE_PRIVATE_SENTINEL_"],
    mode: "reception-capture",
    logLevel: "silent",
    plugins: [tools.react()],
    define: captureBuildDefines(rendererBinding, environment),
    build: {
      outDir: outputDirectory,
      emptyOutDir: true,
      target: "es2022",
      minify: false,
      cssMinify: false,
      sourcemap: false,
      assetsInlineLimit: 0,
    },
  });
  const faviconPath = path.join(outputDirectory, "favicon.svg");
  if (!await pathExists(faviconPath)) {
    await writeFile(faviconPath, CAPTURE_FAVICON_BYTES, { flag: "wx" });
  }
}

async function loadBuiltResponses(outputDirectory) {
  const relativePaths = await collectTreeFiles(outputDirectory);
  const responses = new Map();
  const entries = [];
  for (const relativePath of relativePaths) {
    const bytes = await readFile(path.join(outputDirectory, ...relativePath.split("/")));
    const requestPath = `/${relativePath}`;
    const contentType = MIME_TYPES.get(path.extname(relativePath).toLowerCase())
      ?? "application/octet-stream";
    responses.set(requestPath, { bytes, contentType });
    entries.push({
      path: requestPath,
      sizeBytes: bytes.length,
      sha256: sha256Bytes(bytes),
      contentType,
    });
  }
  if (!responses.has("/favicon.svg")) {
    responses.set("/favicon.svg", {
      bytes: CAPTURE_FAVICON_BYTES,
      contentType: "image/svg+xml",
    });
    entries.push({
      path: "/favicon.svg",
      sizeBytes: CAPTURE_FAVICON_BYTES.length,
      sha256: sha256Bytes(CAPTURE_FAVICON_BYTES),
      contentType: "image/svg+xml",
    });
  }
  entries.sort((left, right) => left.path.localeCompare(right.path, "en"));
  if (!responses.has("/index.html")) throw new Error("capture build did not emit index.html");
  return { responses, entries };
}

function servedPageManifest({ plan, rendererBinding, toolchain, entries }) {
  const body = {
    schemaVersion: SERVED_PAGE_MANIFEST_SCHEMA_VERSION,
    authority: "none",
    webOrigin: plan.webOrigin,
    runtimeBuildDigest: rendererBinding.runtimeBuildDigest,
    runtimeEnvironmentDigest: rendererBinding.runtimeEnvironmentDigest,
    rendererBindingDigest: rendererBinding.digest,
    retainedRoot: "served-page",
    captureToolchain: toolchain.manifest,
    entries,
  };
  return { ...body, digest: componentDigest(SERVED_PAGE_MANIFEST_DOMAIN, body) };
}

export async function prepareImmutableCaptureWebApp({
  repoRoot, tempRoot, plan, rendererBinding, webRequire, toolchain,
}) {
  const outputDirectory = path.join(tempRoot, "served-page");
  await buildCaptureWebApp({ repoRoot, outputDirectory, plan, rendererBinding, webRequire });
  await verifyCaptureToolchain(toolchain);
  const built = await loadBuiltResponses(outputDirectory);
  const manifest = servedPageManifest({
    plan,
    rendererBinding,
    toolchain,
    entries: built.entries,
  });
  await writeFile(
    path.join(tempRoot, "served-page-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: "wx" },
  );
  return { ...built, manifest };
}

export async function verifyRetainedServedPage(tempRoot, manifest) {
  const retainedRoot = path.join(tempRoot, manifest.retainedRoot);
  const actualPaths = await collectTreeFiles(retainedRoot);
  const expectedPaths = manifest.entries.map((entry) => entry.path.slice(1));
  if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) {
    throw new Error("retained served-page path set differs from its manifest");
  }
  for (const entry of manifest.entries) {
    const snapshot = await snapshotFile(
      path.join(retainedRoot, ...entry.path.slice(1).split("/")),
      `retained served page ${entry.path}`,
      entry.sha256,
      entry.sizeBytes,
    );
    const expectedType = MIME_TYPES.get(path.extname(entry.path).toLowerCase())
      ?? "application/octet-stream";
    if (expectedType !== entry.contentType) {
      throw new Error(`retained served-page content type drifted: ${entry.path}`);
    }
    if (snapshot.size !== entry.sizeBytes) throw new Error("retained served-page size changed");
  }
}

function resolveServedPageResponse(pageApp, requestUrl, method) {
  if (!["GET", "HEAD"].includes(method)) return null;
  let pathname;
  try {
    pathname = decodeURIComponent(requestUrl.pathname);
  } catch {
    return null;
  }
  if (pathname.includes("\\") || pathname.includes("\0") || pathname.split("/").includes("..")) {
    return null;
  }
  const exact = pageApp.responses.get(pathname);
  if (exact !== undefined) return exact;
  if (path.posix.extname(pathname) === "") return pageApp.responses.get("/index.html") ?? null;
  return null;
}

function writeImmutableWebResponse(response, resolved, method) {
  response.writeHead(200, {
    "Cache-Control": "no-store, max-age=0",
    "Content-Length": resolved.bytes.length,
    "Content-Type": resolved.contentType,
    "X-Content-Type-Options": "nosniff",
  });
  response.end(method === "HEAD" ? undefined : resolved.bytes);
}

export async function claimImmutableCaptureWebOrigin(webOrigin) {
  const origin = new URL(webOrigin);
  let pageApp = null;
  const server = createServer((request, response) => {
    if (pageApp === null) {
      response.writeHead(503, { "Cache-Control": "no-store" });
      response.end();
      return;
    }
    const requestUrl = new URL(request.url ?? "/", webOrigin);
    const resolved = resolveServedPageResponse(pageApp, requestUrl, request.method ?? "GET");
    if (resolved === null) {
      response.writeHead(404, { "Cache-Control": "no-store" });
      response.end();
      return;
    }
    writeImmutableWebResponse(response, resolved, request.method ?? "GET");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number(origin.port), origin.hostname, resolve);
  }).catch((cause) => {
    throw new Error("capture webOrigin is occupied or cannot be owned by this runner", { cause });
  });
  return {
    activate(immutablePageApp) {
      if (pageApp !== null) throw new Error("capture web origin is already active");
      pageApp = immutablePageApp;
    },
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections?.();
    }),
  };
}

export async function startImmutableCaptureWebServer(webOrigin, pageApp) {
  const ownership = await claimImmutableCaptureWebOrigin(webOrigin);
  ownership.activate(pageApp);
  return ownership;
}

async function makeTemporaryRoot(finalRoot) {
  const parent = path.dirname(finalRoot);
  const parentInfo = await lstat(parent).catch(() => null);
  if (parentInfo === null || !parentInfo.isDirectory() || parentInfo.isSymbolicLink()) {
    throw new Error(`output parent is not a direct regular directory: ${parent}`);
  }
  if (await realpath(parent) !== path.resolve(parent)) throw new Error(`output parent cannot traverse a link: ${parent}`);
  if (await pathExists(finalRoot)) throw new Error(`output root already exists: ${finalRoot}`);
  const temporary = path.join(parent, `.${path.basename(finalRoot)}.tmp-${process.pid}-${randomBytes(8).toString("hex")}`);
  if (await pathExists(temporary)) throw new Error(`temporary output unexpectedly exists: ${temporary}`);
  await mkdir(path.join(temporary, "captures"), { recursive: true });
  await mkdir(path.join(temporary, "receipts"), { recursive: true });
  return temporary;
}

async function pathExists(target) {
  return lstat(target).then(() => true, () => false);
}

async function snapshotFile(filePath, label, expectedSha256 = null, expectedSize = null) {
  const info = await lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
    throw new Error(`${label} must be a single-link regular file: ${filePath}`);
  }
  const canonical = await realpath(filePath);
  if (canonical !== path.resolve(filePath)) throw new Error(`${label} cannot traverse a filesystem link: ${filePath}`);
  if (expectedSize !== null && info.size !== expectedSize) throw new Error(`${label} size does not match its plan`);
  const observedSha256 = await sha256File(canonical);
  if (expectedSha256 !== null && observedSha256 !== expectedSha256) throw new Error(`${label} SHA-256 does not match its plan`);
  return { filePath: canonical, sha256: observedSha256, size: info.size, label };
}

async function verifySnapshot(snapshot) {
  await snapshotFile(snapshot.filePath, snapshot.label, snapshot.sha256, snapshot.size);
}


function verifySnapshotBytes(bytes, snapshot) {
  if (bytes.length !== snapshot.size || sha256Bytes(bytes) !== snapshot.sha256) {
    throw new Error(`${snapshot.label} bytes differ from the admitted snapshot`);
  }
}

async function snapshotCandidateAssets(plan) {
  const snapshots = [];
  for (const candidate of plan.candidates) {
    for (const asset of candidate.assets) {
      snapshots.push(await snapshotFile(
        asset.localPath,
        `${candidate.candidateId} asset ${asset.requestPath}`,
        asset.sha256,
        asset.sizeBytes,
      ));
    }
  }
  return snapshots;
}

export async function snapshotRuntimeBuildInputs(repoRoot) {
  const repositoryPaths = [...receptionCaptureRuntimeBuildInputs(repoRoot)];
  const snapshots = [];
  for (const repositoryPath of repositoryPaths) {
    snapshots.push(await snapshotFile(
      path.join(repoRoot, ...repositoryPath.split("/")),
      `runtime build input ${repositoryPath}`,
    ));
  }
  return { repoRoot, repositoryPaths, snapshots };
}

async function verifySnapshots(snapshots) {
  for (const snapshot of snapshots) await verifySnapshot(snapshot);
}

export function assertRuntimeBuildInputSetUnchanged(admitted, current) {
  if (JSON.stringify(admitted) !== JSON.stringify(current)) {
    throw new Error("runtime build input path set changed after capture admission");
  }
}

export async function verifyRuntimeBuildSnapshot(snapshot) {
  if (snapshot === null) return;
  const beforePaths = receptionCaptureRuntimeBuildInputs(snapshot.repoRoot);
  assertRuntimeBuildInputSetUnchanged(snapshot.repositoryPaths, beforePaths);
  assertReceptionCaptureRuntimeVersions(snapshot.repoRoot);
  await verifySnapshots(snapshot.snapshots);
  assertReceptionCaptureRuntimeVersions(snapshot.repoRoot);
  const afterPaths = receptionCaptureRuntimeBuildInputs(snapshot.repoRoot);
  assertRuntimeBuildInputSetUnchanged(snapshot.repositoryPaths, afterPaths);
}

async function publishTemporaryRoot(tempRoot, finalRoot) {
  if (await pathExists(finalRoot)) throw new Error(`output root appeared during capture: ${finalRoot}`);
  const info = await lstat(tempRoot);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("temporary output identity changed");
  await rename(tempRoot, finalRoot);
}

async function verifyRunnerIdentity(repoRoot, protocol) {
  const runnerPath = fileURLToPath(import.meta.url);
  const expectedPath = path.join(repoRoot, "tools", "reception-hd", "run_source_photo_capture.mjs");
  if (path.resolve(runnerPath) !== path.resolve(expectedPath)) throw new Error("capture runner is not the repository implementation");
  const runnerSha256 = await sha256File(runnerPath);
  if (runnerSha256 !== protocol.captureBinding.runnerImplementation.sha256) {
    throw new Error("capture runner does not match the implementation frozen in the protocol");
  }
  return { runnerPath, runnerSha256 };
}

function assertCopiedCapturePlan(capturePlan, planSnapshot) {
  if (
    capturePlan.sha256 !== planSnapshot.sha256
    || capturePlan.sizeBytes !== planSnapshot.size
  ) throw new Error("copied capture plan differs from its admitted snapshot");
}

async function prepareCaptureRuntime({
  repoRoot, tempRoot, plan, rendererBinding, planSnapshot,
}) {
  const { chromium, webRequire } = await loadPlaywright(repoRoot);
  const toolchain = await snapshotCaptureToolchain(webRequire, chromium);
  await verifyCaptureToolchain(toolchain);
  const pageApp = await prepareImmutableCaptureWebApp({
    repoRoot, tempRoot, plan, rendererBinding, webRequire, toolchain,
  });
  await verifyRetainedServedPage(tempRoot, pageApp.manifest);
  const capturePlan = await fileIdentityReference(tempRoot, "capture-plan.json");
  assertCopiedCapturePlan(capturePlan, planSnapshot);
  const servedPageManifest = await fileIdentityReference(tempRoot, "served-page-manifest.json");
  const captureProvenance = {
    planSha256: capturePlan.sha256,
    planSizeBytes: capturePlan.sizeBytes,
    webOrigin: plan.webOrigin,
    servedPageManifestDigest: pageApp.manifest.digest,
    captureToolchainDigest: toolchain.manifest.digest,
  };
  return {
    chromium, toolchain, pageApp, capturePlan, servedPageManifest, captureProvenance,
  };
}

async function captureRunData({
  repoRoot, runnerPath, tempRoot, protocol, plan, runnerSha256,
  rendererBinding, runtimeBuildSnapshot, planSnapshot,
}) {
  await copyFile(runnerPath, path.join(tempRoot, "capture-runner.mjs"), constants.COPYFILE_EXCL);
  await copyFile(planSnapshot.filePath, path.join(tempRoot, "capture-plan.json"), constants.COPYFILE_EXCL);
  const server = await claimImmutableCaptureWebOrigin(plan.webOrigin);
  let browser = null;
  try {
    const prepared = await prepareCaptureRuntime({
      repoRoot, tempRoot, plan, rendererBinding, planSnapshot,
    });
    const { chromium, toolchain, pageApp, captureProvenance } = prepared;
    server.activate(pageApp);
    browser = await chromium.launch({ headless: true });
    const candidates = await captureAll({
      browser, protocol, plan, tempRoot, runnerSha256, binding: rendererBinding,
      runtimeBuildSnapshot, pageApp, captureProvenance,
    });
    await verifyRetainedServedPage(tempRoot, pageApp.manifest);
    await verifyCaptureToolchain(toolchain);
    return {
      schemaVersion: RUN_SCHEMA_VERSION,
      authority: "none",
      protocolDigest: protocol.protocolDigest,
      captureRunnerImplementation: await fileReference(tempRoot, "capture-runner.mjs"),
      capturePlan: prepared.capturePlan,
      webOrigin: plan.webOrigin,
      servedPageManifest: prepared.servedPageManifest,
      servedPageManifestDigest: pageApp.manifest.digest,
      captureToolchainDigest: toolchain.manifest.digest,
      candidates,
    };
  } finally {
    await browser?.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}

async function executeCapture(args) {
  const repoRoot = await realpath(args.repoRoot);
  const protocolSnapshot = await snapshotFile(args.protocol, "protocol input");
  const planSnapshot = await snapshotFile(args.plan, "capture-plan input");
  const protocolPath = protocolSnapshot.filePath;
  const planPath = planSnapshot.filePath;
  await runPythonVerification(repoRoot, protocolPath);
  const protocolBytes = await readFile(protocolPath);
  const planBytes = await readFile(planPath);
  verifySnapshotBytes(protocolBytes, protocolSnapshot);
  verifySnapshotBytes(planBytes, planSnapshot);
  const protocol = parseJsonDocument(protocolBytes, "protocol input");
  const plan = parseCapturePlan(parseJsonDocument(planBytes, "capture-plan input"), protocol);
  if (protocol.captureBinding.evidenceClass !== "diagnostic_renderer_owned_telemetry") {
    throw new Error("this v1 browser runner is diagnostic-only and cannot produce held-out evidence");
  }
  const runtimeBuildSnapshot = await snapshotRuntimeBuildInputs(repoRoot);
  const rendererBinding = await expectedReceptionRendererBinding(
    repoRoot,
    captureRuntimeEnvironmentFromPlan(plan),
  );
  assertRendererBinding(protocol.rendererBinding, rendererBinding);
  const { runnerPath, runnerSha256 } = await verifyRunnerIdentity(repoRoot, protocol);
  const assetSnapshots = await snapshotCandidateAssets(plan);
  const admittedSnapshots = [
    protocolSnapshot, planSnapshot, ...assetSnapshots,
  ];
  await verifySnapshots(admittedSnapshots);
  await verifyRuntimeBuildSnapshot(runtimeBuildSnapshot);
  if (args.verifyOnly) {
    return { status: "capture_inputs_verified_no_browser_opened", protocolDigest: protocol.protocolDigest, viewCount: protocol.views.length };
  }
  const finalRoot = path.resolve(args.outputRoot);
  const tempRoot = await makeTemporaryRoot(finalRoot);
  try {
    const run = await captureRunData({
      repoRoot, runnerPath, tempRoot, protocol, plan, runnerSha256,
      rendererBinding, runtimeBuildSnapshot, planSnapshot,
    });
    await writeFile(path.join(tempRoot, "run.json"), `${JSON.stringify(run, null, 2)}\n`, { flag: "wx" });
    await verifySnapshots(admittedSnapshots);
    await verifyRuntimeBuildSnapshot(runtimeBuildSnapshot);
    if ((await sha256File(runnerPath)) !== runnerSha256) throw new Error("capture runner changed during execution");
    await publishTemporaryRoot(tempRoot, finalRoot);
    return { status: "capture_complete_authority_none", protocolDigest: protocol.protocolDigest, outputRoot: finalRoot, captureCount: protocol.views.length * protocol.candidateIds.length * 3 };
  } catch (error) {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

function helpText() {
  return [
    "Same-camera Reception source-photo capture runner",
    "",
    "Required absolute paths:",
    "  --repo-root PATH --protocol PATH --plan PATH --output-root PATH",
    "",
    "Optional:",
    "  --verify-only  Verify the frozen protocol and loopback plan without opening a browser.",
    "  --help         Show this text.",
    "",
    "This runner builds and exclusively owns the loopback preflight web origin.",
    "The requested webOrigin port must be unused; lookalike or stale servers are rejected.",
    "Pinned candidate requests are fulfilled directly from the hash-verified local files in the plan.",
  ].join("\n");
}

async function main() {
  try {
    const args = parseCliArguments(process.argv.slice(2));
    if (args.help) {
      process.stdout.write(`${helpText()}\n`);
      return;
    }
    const result = await executeCapture(args);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`CAPTURE_ERROR ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] === undefined ? null : path.resolve(process.argv[1]);
if (invokedPath !== null && invokedPath === path.resolve(fileURLToPath(import.meta.url))) {
  await main();
}
