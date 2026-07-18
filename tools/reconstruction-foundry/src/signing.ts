import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readFile, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  FoundryIntegrityError,
  dssePreAuthenticationEncoding,
  sha256Bytes,
} from "@omnitwin/reconstruction-foundry";
import {
  CanonicalJsonValueSchema,
  ReconstructionDsseEnvelopeSchema,
  ReconstructionReleaseSigningPayloadSchema,
  stableCanonicalJson,
  type ReconstructionDsseEnvelope,
  type ReconstructionReleaseSigningPayload,
} from "@omnitwin/types";

const MAX_SIGNING_PAYLOAD_FILE_BYTES = 4 * 1024 * 1024;
export const DSSE_PAE_FILE_NAME = "dsse-pae.bin";
export const DSSE_ENVELOPE_TEMPLATE_FILE_NAME = "dsse-envelope-template.json";
export const SIGNING_REQUEST_FILE_NAME = "signing-request.json";

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : null;
}

async function writeImmutableFile(path: string, bytes: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  try {
    const existing = await readFile(path);
    if (existing.equals(bytes)) return;
    throw new FoundryIntegrityError("IMMUTABLE_SIGNING_FILE_CONFLICT", `Refusing to replace a different signing file: ${path}`);
  } catch (error: unknown) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.partial`);
  try {
    const handle = await open(temporary, "wx");
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(temporary, path);
    } catch (error: unknown) {
      if (errorCode(error) !== "EEXIST") throw error;
      const existing = await readFile(path);
      if (!existing.equals(bytes)) {
        throw new FoundryIntegrityError("IMMUTABLE_SIGNING_FILE_CONFLICT", `Concurrent signing-file conflict: ${path}`);
      }
    }
  } finally {
    await rm(temporary, { force: true });
  }
}

async function loadSigningPayload(pathInput: string): Promise<{
  readonly payload: ReconstructionReleaseSigningPayload;
  readonly payloadBytes: Buffer;
}> {
  const path = resolve(pathInput);
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size <= 0 || metadata.size > MAX_SIGNING_PAYLOAD_FILE_BYTES) {
    throw new FoundryIntegrityError(
      "INVALID_SIGNING_PAYLOAD_FILE",
      "Signing payload must be a regular, non-link JSON file no larger than 4 MiB.",
    );
  }
  const raw = await readFile(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    throw new FoundryIntegrityError("INVALID_SIGNING_PAYLOAD_JSON", "Signing payload is not valid JSON.", { cause: error });
  }
  const payload = ReconstructionReleaseSigningPayloadSchema.parse(parsed);
  const payloadBytes = Buffer.from(payload.payloadUtf8, "utf8");
  const base64Bytes = Buffer.from(payload.payloadBase64, "base64");
  if (
    payload.payloadBase64 !== base64Bytes.toString("base64") ||
    !payloadBytes.equals(base64Bytes) ||
    payload.payloadByteLength !== payloadBytes.length ||
    payload.payloadSha256 !== sha256Bytes(payloadBytes)
  ) {
    throw new FoundryIntegrityError(
      "SIGNING_PAYLOAD_EVIDENCE_MISMATCH",
      "Downloaded signing payload fields do not describe the exact serialized statement bytes.",
    );
  }
  return { payload, payloadBytes };
}

function jsonBytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export interface PreparedSigningRequest {
  readonly directory: string;
  readonly paePath: string;
  readonly paeSha256: string;
  readonly paeByteLength: number;
  readonly envelopeTemplatePath: string;
  readonly requestPath: string;
  readonly payloadSha256: string;
  readonly releaseDigest: string;
  readonly reviewDigest: string;
}

/** Writes KMS-ready raw DSSE PAE bytes. No key material is accepted or read. */
export async function prepareSigningRequest(input: {
  readonly payloadPath: string;
  readonly outDirectory: string;
}): Promise<PreparedSigningRequest> {
  const loaded = await loadSigningPayload(input.payloadPath);
  const directory = resolve(input.outDirectory);
  await mkdir(directory, { recursive: true });
  const directoryMetadata = await lstat(directory);
  if (directoryMetadata.isSymbolicLink() || !directoryMetadata.isDirectory()) {
    throw new FoundryIntegrityError("INVALID_SIGNING_OUTPUT", "Signing-request output must be a real directory, not a symbolic link.");
  }
  const paePath = join(directory, DSSE_PAE_FILE_NAME);
  const envelopeTemplatePath = join(directory, DSSE_ENVELOPE_TEMPLATE_FILE_NAME);
  const requestPath = join(directory, SIGNING_REQUEST_FILE_NAME);
  if ([paePath, envelopeTemplatePath, requestPath].includes(resolve(input.payloadPath))) {
    throw new FoundryIntegrityError("SIGNING_OUTPUT_OVERLAP", "Signing output cannot replace the downloaded payload file.");
  }
  const pae = dssePreAuthenticationEncoding(loaded.payload.payloadType, loaded.payloadBytes);
  const paeSha256 = sha256Bytes(pae);
  const template = {
    __instructions: "Do not upload this template. Sign dsse-pae.bin as raw Ed25519 bytes, then run assemble-attestation.",
    payloadType: loaded.payload.payloadType,
    payload: loaded.payload.payloadBase64,
    signatures: [{ keyid: "<TRUSTED_KEY_ID>", sig: "<BASE64_ED25519_SIGNATURE>" }],
  };
  const request = {
    schemaVersion: "venviewer.reconstruction-signing-request.v1",
    algorithm: "ed25519",
    kmsMessageType: "RAW",
    bytesToSign: DSSE_PAE_FILE_NAME,
    paeSha256,
    paeByteLength: pae.length,
    payloadSha256: loaded.payload.payloadSha256,
    releaseId: loaded.payload.releaseId,
    releaseDigest: loaded.payload.releaseDigest,
    reviewId: loaded.payload.reviewId,
    reviewDigest: loaded.payload.reviewDigest,
  };
  await writeImmutableFile(paePath, pae);
  await writeImmutableFile(envelopeTemplatePath, jsonBytes(template));
  await writeImmutableFile(requestPath, jsonBytes(request));
  return {
    directory,
    paePath,
    paeSha256,
    paeByteLength: pae.length,
    envelopeTemplatePath,
    requestPath,
    payloadSha256: loaded.payload.payloadSha256,
    releaseDigest: loaded.payload.releaseDigest,
    reviewDigest: loaded.payload.reviewDigest,
  };
}

export interface AssembledAttestation {
  readonly path: string;
  readonly envelopeSha256: string;
  readonly envelopeFileSha256: string;
  readonly keyId: string;
  readonly payloadSha256: string;
  readonly releaseDigest: string;
  readonly reviewDigest: string;
  readonly envelope: ReconstructionDsseEnvelope;
}

/** Assembles public signature bytes with the exact server-issued payload. */
export async function assembleAttestation(input: {
  readonly payloadPath: string;
  readonly keyId: string;
  readonly signatureBase64: string;
  readonly outPath: string;
}): Promise<AssembledAttestation> {
  const loaded = await loadSigningPayload(input.payloadPath);
  const signatureBytes = Buffer.from(input.signatureBase64, "base64");
  if (
    input.signatureBase64 !== signatureBytes.toString("base64") ||
    signatureBytes.length !== 64
  ) {
    throw new FoundryIntegrityError(
      "INVALID_ED25519_SIGNATURE",
      "KMS signature must be canonical base64 encoding of exactly 64 Ed25519 signature bytes.",
    );
  }
  const envelope = ReconstructionDsseEnvelopeSchema.parse({
    payloadType: loaded.payload.payloadType,
    payload: loaded.payload.payloadBase64,
    signatures: [{ keyid: input.keyId, sig: input.signatureBase64 }],
  });
  const outPath = resolve(input.outPath);
  if (outPath === resolve(input.payloadPath)) {
    throw new FoundryIntegrityError("SIGNING_OUTPUT_OVERLAP", "Attestation output cannot replace the downloaded payload file.");
  }
  const parent = dirname(outPath);
  await mkdir(parent, { recursive: true });
  const parentMetadata = await stat(parent);
  if (!parentMetadata.isDirectory()) {
    throw new FoundryIntegrityError("INVALID_SIGNING_OUTPUT", "Attestation output parent is not a directory.");
  }
  const bytes = jsonBytes(envelope);
  await writeImmutableFile(outPath, bytes);
  const canonicalEnvelopeBytes = Buffer.from(
    stableCanonicalJson(CanonicalJsonValueSchema.parse(envelope)),
    "utf8",
  );
  return {
    path: outPath,
    envelopeSha256: sha256Bytes(canonicalEnvelopeBytes),
    envelopeFileSha256: sha256Bytes(bytes),
    keyId: envelope.signatures[0]?.keyid ?? input.keyId,
    payloadSha256: loaded.payload.payloadSha256,
    releaseDigest: loaded.payload.releaseDigest,
    reviewDigest: loaded.payload.reviewDigest,
    envelope,
  };
}
