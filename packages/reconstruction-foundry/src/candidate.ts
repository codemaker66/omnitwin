import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { Readable } from "node:stream";
import {
  ReconstructionQaReportSchema,
  ReconstructionReleaseManifestSchema,
  type ReconstructionQaReport,
  type ReconstructionReleaseFile,
  type ReconstructionReleaseManifest,
} from "@omnitwin/types";
import { stableCanonicalJson, toCanonicalJson } from "./canonical-json.js";
import { FoundryIntegrityError } from "./errors.js";
import { parseGlbHeader, type GlbInspection } from "./glb.js";
import { sha256Bytes, sha256RegularFile } from "./hash.js";
import {
  FOUNDRY_MAX_BUNDLE_BYTES,
  FOUNDRY_MAX_FILE_BYTES,
  FOUNDRY_MAX_FILE_COUNT,
  type FoundryBundleInventory,
  type FoundryInventoryFile,
  type FoundryMediaKind,
} from "./inventory.js";
import {
  assertSafeCandidateKey,
  assertSafePublicReleaseKey,
  publicReleasePrefixForDigest,
  verifyCandidateObject,
  verifyImmutableObject,
  type CandidateObjectStore,
  type ImmutableObjectStore,
  type VerifiedCandidateObject,
} from "./object-store.js";
import { resolveBundlePath } from "./path-safety.js";
import {
  FOUNDRY_QA_REPORT_NAME,
  FOUNDRY_RELEASE_MANIFEST_NAME,
  candidatePrefixFor,
  loadPreparedReconstructionRelease,
} from "./preparation.js";
import {
  assertTwinContentHashes,
  assertTwinExactFileSet,
  assertTwinFloorIntegrity,
  assertTwinGraphIntegrity,
  createVerifiedTwinBundleQaResult,
  expectedTwinWebpDimensions,
  inspectTwinBundle,
  parseTwinManifestText,
} from "./qa.js";
import { buildPreparedReleaseEvidence } from "./release.js";
import { inspectWebpBytes, type WebpDimensions } from "./webp.js";

const MAX_JSON_SIDECAR_BYTES = 4 * 1024 * 1024;

export interface RemoteCandidateVerification {
  readonly candidatePrefix: string;
  readonly candidateManifestKey: string;
  readonly candidateQaReportKey: string;
  readonly manifest: ReconstructionReleaseManifest;
  readonly qaReport: ReconstructionQaReport;
  readonly releaseManifestObject: VerifiedCandidateObject;
  readonly qaReportObject: VerifiedCandidateObject;
  readonly verifiedFiles: readonly VerifiedCandidateObject[];
}

export interface CandidateUploadReceipt extends RemoteCandidateVerification {
  readonly createdKeys: readonly string[];
  readonly reusedKeys: readonly string[];
}

interface CapturedCandidateObject extends VerifiedCandidateObject {
  readonly captured: Buffer;
}

function equalCanonical(left: unknown, right: unknown): boolean {
  return stableCanonicalJson(toCanonicalJson(left)) === stableCanonicalJson(toCanonicalJson(right));
}

function assertCandidatePrefixShape(candidatePrefix: string): void {
  assertSafeCandidateKey(`${candidatePrefix}/probe`);
  const match = /^candidates\/[^/]+\/([a-f0-9]{64})$/u.exec(candidatePrefix);
  if (match === null) {
    throw new FoundryIntegrityError(
      "INVALID_CANDIDATE_PREFIX",
      "Candidate prefix must be candidates/{venueSlug}/{releaseDigest}.",
    );
  }
}

function parseJsonObject<T>(
  bytes: Buffer,
  label: string,
  parse: (value: unknown) => T,
): T {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error: unknown) {
    throw new FoundryIntegrityError("INVALID_CANDIDATE_JSON", `${label} is not valid JSON.`, { cause: error });
  }
  try {
    return parse(value);
  } catch (error: unknown) {
    throw new FoundryIntegrityError("INVALID_CANDIDATE_SCHEMA", `${label} failed strict schema validation.`, { cause: error });
  }
}

async function readBoundedCandidateObject(
  store: CandidateObjectStore,
  key: string,
  maxBytes: number,
): Promise<CapturedCandidateObject> {
  assertSafeCandidateKey(key);
  const result = await store.get(key);
  if (result.contentLength !== null && (result.contentLength <= 0 || result.contentLength > maxBytes)) {
    throw new FoundryIntegrityError("CANDIDATE_SIZE_OUT_OF_BOUNDS", `Candidate object size is out of bounds: ${key}.`);
  }
  const digest = createHash("sha256");
  const chunks: Buffer[] = [];
  let sizeBytes = 0;
  for await (const chunk of result.body) {
    sizeBytes += chunk.byteLength;
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes > maxBytes) {
      throw new FoundryIntegrityError("CANDIDATE_SIZE_OUT_OF_BOUNDS", `Candidate object exceeded its size limit: ${key}.`);
    }
    const bytes = Buffer.from(chunk);
    digest.update(bytes);
    chunks.push(bytes);
  }
  if (sizeBytes <= 0 || (result.contentLength !== null && sizeBytes !== result.contentLength)) {
    throw new FoundryIntegrityError("CANDIDATE_SIZE_MISMATCH", `Candidate object byte length changed during read: ${key}.`);
  }
  return { key, sha256: digest.digest("hex"), sizeBytes, captured: Buffer.concat(chunks, sizeBytes) };
}

async function readVerifiedCandidateObject(
  store: CandidateObjectStore,
  expected: { readonly key: string; readonly sha256: string; readonly sizeBytes: number },
  captureBytes: number,
): Promise<CapturedCandidateObject> {
  assertSafeCandidateKey(expected.key);
  if (
    !/^[a-f0-9]{64}$/u.test(expected.sha256) ||
    !Number.isSafeInteger(expected.sizeBytes) ||
    expected.sizeBytes <= 0 ||
    expected.sizeBytes > FOUNDRY_MAX_FILE_BYTES
  ) {
    throw new FoundryIntegrityError("INVALID_EXPECTED_OBJECT", `Invalid candidate metadata for ${expected.key}.`);
  }
  const result = await store.get(expected.key);
  if (result.contentLength !== null && result.contentLength !== expected.sizeBytes) {
    throw new FoundryIntegrityError("CANDIDATE_SIZE_MISMATCH", `Candidate byte length mismatch for ${expected.key}.`);
  }
  const digest = createHash("sha256");
  const capturedParts: Buffer[] = [];
  let capturedBytes = 0;
  let sizeBytes = 0;
  for await (const chunk of result.body) {
    sizeBytes += chunk.byteLength;
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes > expected.sizeBytes) {
      throw new FoundryIntegrityError("CANDIDATE_SIZE_MISMATCH", `Candidate object exceeded its declared size: ${expected.key}.`);
    }
    const bytes = Buffer.from(chunk);
    digest.update(bytes);
    if (capturedBytes < captureBytes) {
      const remaining = captureBytes - capturedBytes;
      const captured = bytes.subarray(0, remaining);
      capturedParts.push(captured);
      capturedBytes += captured.length;
    }
  }
  const sha256 = digest.digest("hex");
  if (sizeBytes !== expected.sizeBytes || sha256 !== expected.sha256) {
    throw new FoundryIntegrityError("CANDIDATE_DIGEST_MISMATCH", `Candidate readback verification failed for ${expected.key}.`);
  }
  return {
    key: expected.key,
    sha256,
    sizeBytes,
    captured: Buffer.concat(capturedParts, capturedBytes),
  };
}

function mediaKindForReleaseFile(file: ReconstructionReleaseFile): FoundryMediaKind {
  if (file.path === "manifest.json") {
    if (file.role !== "manifest" || file.mimeType !== "application/json") {
      throw new FoundryIntegrityError("INVALID_RELEASE_FILE_METADATA", "manifest.json must use the manifest role and application/json MIME type.");
    }
    return "manifest";
  }
  const extension = extname(file.path).toLowerCase();
  if (extension === ".webp" && file.role === "imagery" && file.mimeType === "image/webp") return "webp";
  if (extension === ".glb" && file.role === "geometry" && file.mimeType === "model/gltf-binary") return "glb";
  throw new FoundryIntegrityError("INVALID_RELEASE_FILE_METADATA", `Unsupported or inconsistent release file metadata: ${file.path}.`);
}

function assertWebpDimensions(
  path: string,
  expected: { readonly width: number; readonly height: number },
  actual: WebpDimensions,
): void {
  if (actual.width !== expected.width || actual.height !== expected.height) {
    throw new FoundryIntegrityError(
      "WEBP_DIMENSION_MISMATCH",
      `WebP ${path} dimensions do not match the Twin manifest LOD contract.`,
    );
  }
}

/**
 * Independently verifies a committed private candidate using only immutable
 * object reads. It does not trust local preparation output or a prior QA row.
 */
export async function verifyRemoteCandidateRelease(input: {
  readonly candidatePrefix: string;
  readonly store: CandidateObjectStore;
}): Promise<RemoteCandidateVerification> {
  assertCandidatePrefixShape(input.candidatePrefix);
  const candidateManifestKey = `${input.candidatePrefix}/${FOUNDRY_RELEASE_MANIFEST_NAME}`;
  const releaseManifestObject = await readBoundedCandidateObject(
    input.store,
    candidateManifestKey,
    MAX_JSON_SIDECAR_BYTES,
  );
  const manifest = parseJsonObject(
    releaseManifestObject.captured,
    "Candidate release manifest",
    (value) => ReconstructionReleaseManifestSchema.parse(value),
  );
  if (candidatePrefixFor(manifest) !== input.candidatePrefix) {
    throw new FoundryIntegrityError("CANDIDATE_PREFIX_MISMATCH", "Candidate prefix does not bind the committed release digest and venue.");
  }
  if (manifest.fileCount > FOUNDRY_MAX_FILE_COUNT || manifest.totalBytes > FOUNDRY_MAX_BUNDLE_BYTES) {
    throw new FoundryIntegrityError("CANDIDATE_BUNDLE_OUT_OF_BOUNDS", "Candidate release exceeds Foundry inventory limits.");
  }

  const candidateQaReportKey = `${input.candidatePrefix}/${FOUNDRY_QA_REPORT_NAME}`;
  const qaReportObject = await readBoundedCandidateObject(
    input.store,
    candidateQaReportKey,
    MAX_JSON_SIDECAR_BYTES,
  );
  const qaReport = parseJsonObject(
    qaReportObject.captured,
    "Candidate QA report",
    (value) => ReconstructionQaReportSchema.parse(value),
  );

  const verifiedFiles: VerifiedCandidateObject[] = [];
  const inventoryFiles: FoundryInventoryFile[] = [];
  const webpHeaders = new Map<string, WebpDimensions>();
  const glbHeaders = new Map<string, GlbInspection>();
  let sourceManifestBytes: Buffer | null = null;
  for (const file of manifest.files) {
    const mediaKind = mediaKindForReleaseFile(file);
    if (mediaKind === "manifest" && file.sizeBytes > MAX_JSON_SIDECAR_BYTES) {
      throw new FoundryIntegrityError("MANIFEST_TOO_LARGE", "Twin source manifest exceeds the Foundry size limit.");
    }
    const key = `${input.candidatePrefix}/${file.path}`;
    const captured = await readVerifiedCandidateObject(
      input.store,
      { key, sha256: file.sha256, sizeBytes: file.sizeBytes },
      file.sizeBytes,
    );
    verifiedFiles.push({ key, sha256: captured.sha256, sizeBytes: captured.sizeBytes });
    inventoryFiles.push({ path: file.path, sha256: file.sha256, sizeBytes: file.sizeBytes, mediaKind });
    if (mediaKind === "manifest") sourceManifestBytes = captured.captured;
    if (mediaKind === "webp") webpHeaders.set(
      file.path,
      await inspectWebpBytes(captured.captured, file.sizeBytes),
    );
    if (mediaKind === "glb") glbHeaders.set(file.path, await parseGlbHeader(captured.captured, file.sizeBytes));
  }
  if (sourceManifestBytes === null) {
    throw new FoundryIntegrityError("SOURCE_MANIFEST_MISSING", "Candidate inventory has no source Twin manifest.");
  }

  const twinManifest = parseTwinManifestText(sourceManifestBytes.toString("utf8"));
  const inventory: FoundryBundleInventory = {
    root: input.candidatePrefix,
    files: inventoryFiles,
    totalBytes: manifest.totalBytes,
  };
  assertTwinExactFileSet(twinManifest, inventory.files);
  assertTwinContentHashes(twinManifest, inventory.files);
  assertTwinGraphIntegrity(twinManifest);
  assertTwinFloorIntegrity(twinManifest);
  for (const [path, dimensions] of webpHeaders) {
    assertWebpDimensions(path, expectedTwinWebpDimensions(path, twinManifest), dimensions);
  }

  let mesh: GlbInspection | null = null;
  if (twinManifest.mesh !== undefined) {
    mesh = glbHeaders.get(twinManifest.mesh.path) ?? null;
    if (mesh === null || mesh.sizeBytes !== twinManifest.mesh.bytes) {
      throw new FoundryIntegrityError("GLB_MANIFEST_SIZE_MISMATCH", "Twin manifest mesh byte count does not match its verified GLB.");
    }
  }
  const verifiedQa = createVerifiedTwinBundleQaResult({
    manifest: twinManifest,
    inventory,
    webpFilesChecked: webpHeaders.size,
    mesh,
  });
  const rebuilt = buildPreparedReleaseEvidence(verifiedQa);
  if (!equalCanonical(rebuilt.manifest, manifest) || !equalCanonical(rebuilt.qaReport, qaReport)) {
    throw new FoundryIntegrityError(
      "CANDIDATE_EVIDENCE_MISMATCH",
      "Committed candidate sidecars do not match independently rebuilt release and QA evidence.",
    );
  }

  return {
    candidatePrefix: input.candidatePrefix,
    candidateManifestKey,
    candidateQaReportKey,
    manifest,
    qaReport,
    releaseManifestObject: {
      key: releaseManifestObject.key,
      sha256: releaseManifestObject.sha256,
      sizeBytes: releaseManifestObject.sizeBytes,
    },
    qaReportObject: {
      key: qaReportObject.key,
      sha256: qaReportObject.sha256,
      sizeBytes: qaReportObject.sizeBytes,
    },
    verifiedFiles,
  };
}

async function putLocalFile(input: {
  readonly store: CandidateObjectStore;
  readonly key: string;
  readonly path: string;
  readonly contentType: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}): Promise<"created" | "exists"> {
  const body = createReadStream(input.path, { highWaterMark: 8 * 1024 * 1024 });
  try {
    const result = await input.store.putIfAbsent({
      key: input.key,
      contentType: input.contentType,
      contentLength: input.sizeBytes,
      body,
    });
    const after = await sha256RegularFile(input.path);
    if (after.sha256 !== input.sha256 || after.sizeBytes !== input.sizeBytes) {
      throw new FoundryIntegrityError("LOCAL_SOURCE_DRIFT", `Local source changed while candidate upload was in progress: ${input.path}.`);
    }
    await verifyCandidateObject(input.store, {
      key: input.key,
      sha256: input.sha256,
      sizeBytes: input.sizeBytes,
    });
    return result;
  } finally {
    body.destroy();
  }
}

async function putBuffer(input: {
  readonly store: CandidateObjectStore;
  readonly key: string;
  readonly bytes: Buffer;
  readonly contentType: string;
  readonly sha256: string;
}): Promise<"created" | "exists"> {
  const result = await input.store.putIfAbsent({
    key: input.key,
    contentType: input.contentType,
    contentLength: input.bytes.length,
    body: Readable.from([input.bytes]),
  });
  await verifyCandidateObject(input.store, {
    key: input.key,
    sha256: input.sha256,
    sizeBytes: input.bytes.length,
  });
  return result;
}

/** Uploads content first, QA evidence second, and the release-manifest commit marker last. */
export async function uploadCandidateRelease(input: {
  readonly preparedDirectory: string;
  readonly store: CandidateObjectStore;
}): Promise<CandidateUploadReceipt> {
  const prepared = await loadPreparedReconstructionRelease(input.preparedDirectory);
  const currentQa = await inspectTwinBundle(prepared.preparation.sourceBundleRoot);
  const currentEvidence = buildPreparedReleaseEvidence(currentQa);
  if (!equalCanonical(currentEvidence.manifest, prepared.manifest) || !equalCanonical(currentEvidence.qaReport, prepared.qaReport)) {
    throw new FoundryIntegrityError("PREPARATION_SOURCE_DRIFT", "Source Twin no longer matches its prepared release and QA evidence.");
  }

  const createdKeys: string[] = [];
  const reusedKeys: string[] = [];
  const record = (key: string, status: "created" | "exists"): void => {
    (status === "created" ? createdKeys : reusedKeys).push(key);
  };
  for (const file of prepared.manifest.files) {
    const key = `${prepared.preparation.candidateR2Prefix}/${file.path}`;
    record(key, await putLocalFile({
      store: input.store,
      key,
      path: resolveBundlePath(prepared.preparation.sourceBundleRoot, file.path),
      contentType: file.mimeType,
      sha256: file.sha256,
      sizeBytes: file.sizeBytes,
    }));
  }

  const qaBytes = await readFile(join(prepared.directory, FOUNDRY_QA_REPORT_NAME));
  if (
    qaBytes.length !== prepared.preparation.qaReportSizeBytes ||
    sha256Bytes(qaBytes) !== prepared.preparation.qaReportFileSha256
  ) {
    throw new FoundryIntegrityError("PREPARATION_DIGEST_MISMATCH", "Prepared QA sidecar changed before upload.");
  }
  record(prepared.preparation.candidateQaReportR2Key, await putBuffer({
    store: input.store,
    key: prepared.preparation.candidateQaReportR2Key,
    bytes: qaBytes,
    contentType: "application/json",
    sha256: prepared.preparation.qaReportFileSha256,
  }));

  const releaseBytes = await readFile(join(prepared.directory, FOUNDRY_RELEASE_MANIFEST_NAME));
  if (
    releaseBytes.length !== prepared.preparation.releaseManifestSizeBytes ||
    sha256Bytes(releaseBytes) !== prepared.preparation.releaseManifestSha256
  ) {
    throw new FoundryIntegrityError("PREPARATION_DIGEST_MISMATCH", "Prepared release sidecar changed before upload.");
  }
  record(prepared.preparation.candidateManifestR2Key, await putBuffer({
    store: input.store,
    key: prepared.preparation.candidateManifestR2Key,
    bytes: releaseBytes,
    contentType: "application/json",
    sha256: prepared.preparation.releaseManifestSha256,
  }));

  const verification = await verifyRemoteCandidateRelease({
    candidatePrefix: prepared.preparation.candidateR2Prefix,
    store: input.store,
  });
  return { ...verification, createdKeys, reusedKeys };
}

export interface ImmutableCandidateTransferResult {
  readonly source: VerifiedCandidateObject;
  readonly destination: VerifiedCandidateObject;
  readonly disposition: "created" | "exists";
}

/**
 * Streams one already-declared candidate object into its digest-addressed
 * public release key. The primitive has no delete/list/copy/policy authority.
 */
export async function transferImmutableCandidateObject(input: {
  readonly sourceStore: CandidateObjectStore;
  readonly destinationStore: ImmutableObjectStore;
  readonly sourceKey: string;
  readonly destinationKey: string;
  readonly contentType: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}): Promise<ImmutableCandidateTransferResult> {
  assertSafeCandidateKey(input.sourceKey);
  assertSafePublicReleaseKey(input.destinationKey);
  const sourceResult = await input.sourceStore.get(input.sourceKey);
  if (sourceResult.contentLength !== null && sourceResult.contentLength !== input.sizeBytes) {
    throw new FoundryIntegrityError("CANDIDATE_SIZE_MISMATCH", `Candidate source size mismatch for ${input.sourceKey}.`);
  }
  const sourceBody = Readable.from(sourceResult.body);
  let disposition: "created" | "exists";
  try {
    disposition = await input.destinationStore.putIfAbsent({
      key: input.destinationKey,
      contentType: input.contentType,
      contentLength: input.sizeBytes,
      body: sourceBody,
    });
  } finally {
    sourceBody.destroy();
  }
  const [source, destination] = await Promise.all([
    verifyCandidateObject(input.sourceStore, {
      key: input.sourceKey,
      sha256: input.sha256,
      sizeBytes: input.sizeBytes,
    }),
    verifyImmutableObject(input.destinationStore, {
      key: input.destinationKey,
      sha256: input.sha256,
      sizeBytes: input.sizeBytes,
    }, "public-release"),
  ]);
  return { source, destination, disposition };
}

export function publicReleaseKeyFor(
  manifest: ReconstructionReleaseManifest,
  relativePath: string,
): string {
  const file = manifest.files.find((candidate) => candidate.path === relativePath);
  if (file === undefined) {
    throw new FoundryIntegrityError("PUBLIC_FILE_NOT_DECLARED", `Public release file is not in the immutable manifest: ${relativePath}.`);
  }
  const key = `${publicReleasePrefixForDigest(manifest.releaseDigest)}/${file.path}`;
  assertSafePublicReleaseKey(key);
  return key;
}
