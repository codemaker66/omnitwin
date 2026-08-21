import {
  createHash,
  createPublicKey,
  type KeyObject,
} from "node:crypto";
import { types as nodeUtilTypes } from "node:util";
import {
  RECONSTRUCTION_DSSE_PAYLOAD_TYPE,
  ReconstructionDsseEnvelopeSchema,
  ReconstructionReleaseSigningStatementSchema,
  type ReconstructionDsseEnvelope,
  type ReconstructionReleaseSigningStatement,
} from "@omnitwin/types";
import {
  canonicalizeFoundryActivationV1Json,
  parseFoundryActivationV1CanonicalJsonBytes,
  parseFoundryActivationV1StrictJsonBytes,
} from "./activation-v1-authenticated-evidence-bytes.js";
import { verifyDsseEnvelope } from "./dsse.js";
import { FoundryIntegrityError } from "./errors.js";

export const HISTORICAL_RUNTIME_TWIN_RELEASE_MAX_ENVELOPE_BYTES = 2 * 1024 * 1024;
export const HISTORICAL_RUNTIME_TWIN_RELEASE_MAX_PAYLOAD_BYTES = 1024 * 1024;

export const HISTORICAL_RUNTIME_TWIN_RELEASE_EVIDENCE_ERROR_CODES = Object.freeze({
  expectedIdentityInvalid: "HISTORICAL_RUNTIME_TWIN_RELEASE_EXPECTED_IDENTITY_INVALID",
  envelopeShapeInvalid: "HISTORICAL_RUNTIME_TWIN_RELEASE_ENVELOPE_SHAPE_INVALID",
  payloadTypeMismatch: "HISTORICAL_RUNTIME_TWIN_RELEASE_PAYLOAD_TYPE_MISMATCH",
  payloadBase64Invalid: "HISTORICAL_RUNTIME_TWIN_RELEASE_PAYLOAD_BASE64_INVALID",
  payloadBytesInvalid: "HISTORICAL_RUNTIME_TWIN_RELEASE_PAYLOAD_BYTES_INVALID",
  statementShapeInvalid: "HISTORICAL_RUNTIME_TWIN_RELEASE_STATEMENT_SHAPE_INVALID",
  statementBytesInvalid: "HISTORICAL_RUNTIME_TWIN_RELEASE_STATEMENT_BYTES_INVALID",
  statementIdentityMismatch: "HISTORICAL_RUNTIME_TWIN_RELEASE_STATEMENT_IDENTITY_MISMATCH",
  signatureShapeInvalid: "HISTORICAL_RUNTIME_TWIN_RELEASE_SIGNATURE_SHAPE_INVALID",
  keyIdInvalid: "HISTORICAL_RUNTIME_TWIN_RELEASE_KEY_ID_INVALID",
  keyMissing: "HISTORICAL_RUNTIME_TWIN_RELEASE_KEY_MISSING",
  keyTypeInvalid: "HISTORICAL_RUNTIME_TWIN_RELEASE_KEY_TYPE_INVALID",
  keyFingerprintMismatch: "HISTORICAL_RUNTIME_TWIN_RELEASE_KEY_FINGERPRINT_MISMATCH",
  signatureInvalid: "HISTORICAL_RUNTIME_TWIN_RELEASE_SIGNATURE_INVALID",
} as const);

export type HistoricalRuntimeTwinReleaseEvidenceErrorCode =
  (typeof HISTORICAL_RUNTIME_TWIN_RELEASE_EVIDENCE_ERROR_CODES)[keyof typeof HISTORICAL_RUNTIME_TWIN_RELEASE_EVIDENCE_ERROR_CODES];

export interface HistoricalRuntimeTwinReleaseExpectedEvidence {
  readonly expectedKeyId: string;
  readonly expectedPublicKeyFingerprint: string;
  readonly statement: ReconstructionReleaseSigningStatement;
}

export interface HistoricalRuntimeTwinReleaseAuthenticatedEvidenceBytes {
  readonly payloadType: typeof RECONSTRUCTION_DSSE_PAYLOAD_TYPE;
  readonly keyId: string;
  readonly publicKeyFingerprint: string;
  readonly envelope: ReconstructionDsseEnvelope;
  readonly statement: ReconstructionReleaseSigningStatement;
  readonly envelopeUtf8: string;
  readonly payloadUtf8: string;
  readonly envelopeSha256: string;
  readonly payloadSha256: string;
  readonly envelopeByteLength: string;
  readonly payloadByteLength: string;
}

const ERROR = HISTORICAL_RUNTIME_TWIN_RELEASE_EVIDENCE_ERROR_CODES;
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const PRINTABLE_KEY_ID = /^[\x20-\x7e]{1,128}$/u;
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const ED25519_SPKI_BYTE_LENGTH = 44;

function isUnknownRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(
  code: HistoricalRuntimeTwinReleaseEvidenceErrorCode,
  message: string,
  options?: ErrorOptions,
): never {
  throw new FoundryIntegrityError(code, message, options);
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalBase64Bytes(value: string, subject: string): Buffer {
  if (!CANONICAL_BASE64.test(value)) {
    fail(ERROR.payloadBase64Invalid, `${subject} must use padded RFC 4648 canonical base64.`);
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) {
    fail(ERROR.payloadBase64Invalid, `${subject} must decode and re-encode byte-for-byte identically.`);
  }
  return bytes;
}

function expectedIdentity(
  input: HistoricalRuntimeTwinReleaseExpectedEvidence,
): HistoricalRuntimeTwinReleaseExpectedEvidence {
  if (
    !PRINTABLE_KEY_ID.test(input.expectedKeyId) ||
    !SHA256.test(input.expectedPublicKeyFingerprint)
  ) {
    fail(
      ERROR.expectedIdentityInvalid,
      "Twin-release verification requires an exact printable key ID and lowercase SHA-256 public-key fingerprint.",
    );
  }
  let statement: ReconstructionReleaseSigningStatement;
  try {
    statement = ReconstructionReleaseSigningStatementSchema.parse(input.statement);
  } catch (cause) {
    fail(
      ERROR.expectedIdentityInvalid,
      "Twin-release verification requires one exact reconstruction-release signing statement.",
      { cause },
    );
  }
  return Object.freeze({
    expectedKeyId: input.expectedKeyId,
    expectedPublicKeyFingerprint: input.expectedPublicKeyFingerprint,
    statement,
  });
}

function exactEd25519PublicKey(
  trustedPublicKeys: ReadonlyMap<string, KeyObject>,
  keyId: string,
  expectedFingerprint: string,
): KeyObject {
  if (
    nodeUtilTypes.isProxy(trustedPublicKeys)
  ) {
    fail(ERROR.keyTypeInvalid, "Twin-release verification requires an unproxied public-key Map.");
  }
  let candidate: KeyObject | undefined;
  try {
    candidate = Map.prototype.get.call(trustedPublicKeys, keyId) as KeyObject | undefined;
  } catch (cause) {
    fail(ERROR.keyTypeInvalid, "Twin-release verification requires an actual public-key Map.", { cause });
  }
  if (candidate === undefined) {
    fail(ERROR.keyMissing, "The exact twin-release signing key ID is absent from the trusted set.");
  }
  if (!nodeUtilTypes.isKeyObject(candidate) || nodeUtilTypes.isProxy(candidate)) {
    fail(ERROR.keyTypeInvalid, "Twin-release verification requires a native unproxied KeyObject.");
  }
  if (candidate.type !== "public" || candidate.asymmetricKeyType !== "ed25519") {
    fail(ERROR.keyTypeInvalid, "Twin-release verification requires an Ed25519 public key.");
  }
  let exported: Buffer;
  try {
    exported = Buffer.from(candidate.export({ format: "der", type: "spki" }));
  } catch (cause) {
    fail(ERROR.keyTypeInvalid, "Twin-release signing key is not canonical RFC 8410 SPKI DER.", { cause });
  }
  if (
    exported.byteLength !== ED25519_SPKI_BYTE_LENGTH ||
    !exported.subarray(0, ED25519_SPKI_PREFIX.byteLength).equals(ED25519_SPKI_PREFIX)
  ) {
    fail(ERROR.keyTypeInvalid, "Twin-release verification requires canonical Ed25519 SPKI DER.");
  }
  const fingerprint = sha256Hex(exported);
  if (fingerprint !== expectedFingerprint) {
    fail(
      ERROR.keyFingerprintMismatch,
      "Twin-release signing key bytes do not match the expected public-key fingerprint.",
    );
  }
  try {
    return createPublicKey({ key: exported, format: "der", type: "spki" });
  } catch (cause) {
    fail(ERROR.keyTypeInvalid, "Twin-release signing key cannot be normalized as Ed25519 SPKI.", { cause });
  }
}

function exactEnvelope(value: unknown): ReconstructionDsseEnvelope {
  let envelope: ReconstructionDsseEnvelope;
  try {
    envelope = ReconstructionDsseEnvelopeSchema.parse(value);
  } catch (cause) {
    fail(ERROR.envelopeShapeInvalid, "Twin-release DSSE envelope has an invalid strict shape.", { cause });
  }
  if (
    !isUnknownRecord(value) ||
    value["payloadType"] !== envelope.payloadType
  ) {
    fail(
      ERROR.payloadTypeMismatch,
      "Twin-release DSSE payload type must not be normalized or whitespace-aliased.",
    );
  }
  if (envelope.payloadType !== RECONSTRUCTION_DSSE_PAYLOAD_TYPE) {
    fail(
      ERROR.payloadTypeMismatch,
      "Twin-release DSSE envelope does not use the exact in-toto payload type.",
    );
  }
  if (envelope.signatures.length !== 1) {
    fail(ERROR.signatureShapeInvalid, "Twin-release DSSE envelope must contain exactly one signature.");
  }
  const signature = envelope.signatures[0];
  const rawSignatures: unknown = isUnknownRecord(value)
    ? value["signatures"]
    : undefined;
  const rawSignature: unknown = Array.isArray(rawSignatures)
    ? (rawSignatures as readonly unknown[])[0]
    : undefined;
  const rawKeyId = isUnknownRecord(rawSignature)
    ? rawSignature["keyid"]
    : undefined;
  if (
    rawKeyId !== signature?.keyid
  ) {
    fail(ERROR.keyIdInvalid, "Twin-release DSSE key ID must not be normalized or whitespace-aliased.");
  }
  if (signature === undefined || !PRINTABLE_KEY_ID.test(signature.keyid)) {
    fail(ERROR.keyIdInvalid, "Twin-release DSSE key ID must contain 1-128 printable ASCII bytes.");
  }
  const signatureBytes = canonicalBase64Bytes(signature.sig, "Twin-release DSSE signature");
  if (signatureBytes.byteLength !== 64) {
    fail(ERROR.signatureShapeInvalid, "Twin-release Ed25519 signature must decode to exactly 64 bytes.");
  }
  return envelope;
}

/**
 * Verifies the exact stored reconstruction-release DSSE bytes at the production
 * Twin trust boundary. The envelope uses the repository's lexically sorted
 * canonical JSON representation. Its in-toto payload deliberately follows the
 * older D-019 contract: exact JSON.stringify(schema.parse(statement)) bytes.
 * Both byte conventions are enforced independently before the Ed25519 PAE is
 * accepted, so JSON reordering, whitespace, duplicate keys, and parser drift
 * cannot silently change the signed authority.
 */
export function verifyHistoricalRuntimeTwinReleaseEnvelopeBytes(
  envelopeBytes: Uint8Array,
  trustedPublicKeys: ReadonlyMap<string, KeyObject>,
  expectedInput: HistoricalRuntimeTwinReleaseExpectedEvidence,
): HistoricalRuntimeTwinReleaseAuthenticatedEvidenceBytes {
  const expected = expectedIdentity(expectedInput);
  const parsedEnvelope = parseFoundryActivationV1CanonicalJsonBytes(
    envelopeBytes,
    HISTORICAL_RUNTIME_TWIN_RELEASE_MAX_ENVELOPE_BYTES,
  );
  const envelope = exactEnvelope(parsedEnvelope.value);
  const signature = envelope.signatures[0];
  if (signature === undefined || signature.keyid !== expected.expectedKeyId) {
    fail(ERROR.keyIdInvalid, "Twin-release DSSE signature key ID does not equal the expected key authority.");
  }
  const normalizedPublicKey = exactEd25519PublicKey(
    trustedPublicKeys,
    expected.expectedKeyId,
    expected.expectedPublicKeyFingerprint,
  );
  const payloadBytes = canonicalBase64Bytes(envelope.payload, "Twin-release DSSE payload");
  if (
    payloadBytes.byteLength < 1 ||
    payloadBytes.byteLength > HISTORICAL_RUNTIME_TWIN_RELEASE_MAX_PAYLOAD_BYTES
  ) {
    fail(ERROR.payloadBytesInvalid, "Twin-release payload bytes are empty or exceed the 1 MiB bound.");
  }
  const parsedPayload = parseFoundryActivationV1StrictJsonBytes(
    payloadBytes,
    HISTORICAL_RUNTIME_TWIN_RELEASE_MAX_PAYLOAD_BYTES,
  );
  let statement: ReconstructionReleaseSigningStatement;
  try {
    statement = ReconstructionReleaseSigningStatementSchema.parse(parsedPayload.value);
  } catch (cause) {
    fail(ERROR.statementShapeInvalid, "Twin-release payload is not the strict in-toto release statement.", {
      cause,
    });
  }
  const signerCompatiblePayload = JSON.stringify(statement);
  if (parsedPayload.sourceJson !== signerCompatiblePayload) {
    fail(
      ERROR.statementBytesInvalid,
      "Twin-release payload bytes must equal JSON.stringify of the strict parsed statement.",
    );
  }
  if (signerCompatiblePayload !== JSON.stringify(expected.statement)) {
    fail(
      ERROR.statementIdentityMismatch,
      "Twin-release payload does not equal the expected release and latest-review statement.",
    );
  }

  const payloadSha256 = sha256Hex(payloadBytes);
  let verified;
  try {
    verified = verifyDsseEnvelope(
      envelope,
      new Map([[expected.expectedKeyId, normalizedPublicKey]]),
      { payloadType: RECONSTRUCTION_DSSE_PAYLOAD_TYPE, payloadSha256 },
    );
  } catch (cause) {
    fail(ERROR.signatureInvalid, "Twin-release DSSE PAE has an invalid Ed25519 signature.", { cause });
  }
  if (
    verified.verifiedKeyIds.length !== 1 ||
    verified.verifiedKeyIds[0] !== expected.expectedKeyId ||
    Buffer.from(verified.payload).compare(payloadBytes) !== 0
  ) {
    fail(ERROR.signatureInvalid, "Twin-release DSSE verification did not bind the exact payload and key.");
  }

  const envelopeBuffer = Buffer.from(parsedEnvelope.canonicalJson, "utf8");
  return Object.freeze({
    payloadType: RECONSTRUCTION_DSSE_PAYLOAD_TYPE,
    keyId: expected.expectedKeyId,
    publicKeyFingerprint: expected.expectedPublicKeyFingerprint,
    envelope,
    statement,
    envelopeUtf8: parsedEnvelope.canonicalJson,
    payloadUtf8: parsedPayload.sourceJson,
    envelopeSha256: sha256Hex(envelopeBuffer),
    payloadSha256,
    envelopeByteLength: String(envelopeBuffer.byteLength),
    payloadByteLength: String(payloadBytes.byteLength),
  });
}

export function canonicalHistoricalRuntimeTwinReleaseEnvelopeBytes(
  envelope: ReconstructionDsseEnvelope,
): Uint8Array {
  return Buffer.from(canonicalizeFoundryActivationV1Json(envelope), "utf8");
}
