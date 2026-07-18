import {
  createHash,
  createPublicKey,
} from "node:crypto";
import { z } from "zod";
import {
  stableCanonicalJson,
  toCanonicalJson,
} from "./canonical-json.js";
import { DsseEnvelopeSchema } from "./dsse.js";
import { FoundryIntegrityError } from "./errors.js";
import { sha256Bytes } from "./hash.js";
import {
  FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_MAX_PERMIT_PAYLOAD_BYTES,
  FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_PAYLOAD_TYPE,
  FoundryOfflineNormalizeMeshGlbPreviewInvocationV0Schema,
  FoundryOfflineNormalizeMeshGlbPreviewReportV0Schema,
  computeFoundryOfflineNormalizeMeshGlbPreviewInvocationSha256,
  type FoundryOfflineNormalizeMeshGlbPreviewInvocationV0,
  type FoundryOfflineNormalizeMeshGlbPreviewReportV0,
} from "./offline-normalize-mesh-glb-preview.js";
import { FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES } from "./normalize-mesh-glb-worker.js";

export const FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_V0 =
  "omnitwin.foundry.offline-normalize-mesh-glb-preview-sandbox-wire.v0";
export const FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_MAX_METADATA_BYTES =
  256 * 1024;
export const FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_HEADER_BYTES =
  48;
export const FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_FRAME_HEADER_BYTES =
  40;

const MAGIC = Buffer.from("OMFGLBW0", "ascii");
const WIRE_VERSION = 1;
const HEADER_FLAGS = 0;
const METADATA_DIGEST_OFFSET = 16;
const DIGEST_BYTES = 32;
const MAX_FRAME_COUNT = 2;
const SPKI_DER_BYTES = 44;
const SPKI_BASE64_BYTES = 60;
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const METADATA_DIGEST_DOMAIN =
  "OMNITWIN_FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_METADATA_V0";
const FRAME_DIGEST_DOMAIN =
  "OMNITWIN_FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_FRAME_V0";
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/u;
const SAFE_KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/u;
const CANONICAL_UTC = /^20\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/u;
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

const MESSAGE_KIND = Object.freeze({
  transform_request: 1,
  fresh_verifier_request: 2,
  transform_success: 17,
  fresh_verifier_success: 18,
  failure: 127,
} as const);

const BLOB_KIND = Object.freeze({
  source: 1,
  candidate: 2,
  output: 3,
} as const);

type MessageKind = keyof typeof MESSAGE_KIND;
type BlobKind = keyof typeof BLOB_KIND;
type RequestRole = "transform" | "fresh_verifier";

export const FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_FAILURE_CODES =
  [
    "REQUEST_INVALID",
    "DEADLINE_EXCEEDED",
    "TRANSFORM_FAILED",
    "VERIFICATION_FAILED",
    "OUTPUT_LIMIT_EXCEEDED",
    "CANCELLED",
    "INTERNAL_FAILURE",
  ] as const;

export const FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_MAX_BYTES =
  FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_HEADER_BYTES +
  FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_MAX_METADATA_BYTES +
  MAX_FRAME_COUNT *
    (FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_FRAME_HEADER_BYTES +
      FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES);

function fail(code: string, message: string, cause?: unknown): never {
  throw new FoundryIntegrityError(code, message, { cause });
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const member of Object.values(value)) deepFreeze(member);
  return Object.freeze(value);
}

function canonicalUtc(value: string): boolean {
  if (!CANONICAL_UTC.test(value)) return false;
  const milliseconds = Date.parse(value);
  return Number.isSafeInteger(milliseconds) &&
    new Date(milliseconds).toISOString() === value;
}

const DeadlineSchema = z.string().refine(canonicalUtc, {
  message: "Sandbox wire deadlines must be exact millisecond UTC instants between 2000 and 2099.",
});

const RequestIdSchema = z.string().regex(SAFE_REQUEST_ID);
const KeyIdSchema = z.string().regex(SAFE_KEY_ID);

const PermitPublicKeySchema = z
  .object({
    keyId: KeyIdSchema,
    spkiDerBase64: z.string().length(SPKI_BASE64_BYTES),
  })
  .strict();

const SourceBlobBindingSchema = z
  .object({
    kind: z.literal("source"),
    sizeBytes: z.number().int().safe().positive().max(FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES),
    sha256: z.string().regex(SHA256),
  })
  .strict();

const CandidateBlobBindingSchema = z
  .object({
    kind: z.literal("candidate"),
    sizeBytes: z.number().int().safe().positive().max(FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES),
    sha256: z.string().regex(SHA256),
  })
  .strict();

const OutputBlobBindingSchema = z
  .object({
    kind: z.literal("output"),
    sizeBytes: z.number().int().safe().positive().max(FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES),
    sha256: z.string().regex(SHA256),
  })
  .strict();

export const FoundryOfflineNormalizeMeshGlbPreviewSandboxTransformRequestMetadataV0Schema =
  z
    .object({
      schemaVersion: z.literal(
        FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_V0,
      ),
      messageType: z.literal("request"),
      role: z.literal("transform"),
      requestId: RequestIdSchema,
      deadlineAt: DeadlineSchema,
      invocation: FoundryOfflineNormalizeMeshGlbPreviewInvocationV0Schema,
      permitEnvelope: DsseEnvelopeSchema,
      permitPublicKey: PermitPublicKeySchema,
      blobs: z.tuple([SourceBlobBindingSchema]),
    })
    .strict();

export const FoundryOfflineNormalizeMeshGlbPreviewSandboxFreshVerifierRequestMetadataV0Schema =
  z
    .object({
      schemaVersion: z.literal(
        FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_V0,
      ),
      messageType: z.literal("request"),
      role: z.literal("fresh_verifier"),
      requestId: RequestIdSchema,
      deadlineAt: DeadlineSchema,
      invocation: FoundryOfflineNormalizeMeshGlbPreviewInvocationV0Schema,
      permitEnvelope: DsseEnvelopeSchema,
      permitPublicKey: PermitPublicKeySchema,
      report: FoundryOfflineNormalizeMeshGlbPreviewReportV0Schema,
      blobs: z.tuple([SourceBlobBindingSchema, CandidateBlobBindingSchema]),
    })
    .strict();

export const FoundryOfflineNormalizeMeshGlbPreviewSandboxTransformSuccessMetadataV0Schema =
  z
    .object({
      schemaVersion: z.literal(
        FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_V0,
      ),
      messageType: z.literal("success"),
      role: z.literal("transform"),
      requestId: RequestIdSchema,
      report: FoundryOfflineNormalizeMeshGlbPreviewReportV0Schema,
      blobs: z.tuple([OutputBlobBindingSchema]),
    })
    .strict();

export const FoundryOfflineNormalizeMeshGlbPreviewSandboxFreshVerifierSuccessMetadataV0Schema =
  z
    .object({
      schemaVersion: z.literal(
        FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_V0,
      ),
      messageType: z.literal("success"),
      role: z.literal("fresh_verifier"),
      requestId: RequestIdSchema,
      blobs: z.tuple([]),
    })
    .strict();

const FailureSchema = z
  .object({
    code: z.enum(
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_FAILURE_CODES,
    ),
  })
  .strict();

export const FoundryOfflineNormalizeMeshGlbPreviewSandboxFailureMetadataV0Schema =
  z
    .object({
      schemaVersion: z.literal(
        FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_V0,
      ),
      messageType: z.literal("failure"),
      role: z.union([z.literal("transform"), z.literal("fresh_verifier")]),
      requestId: RequestIdSchema,
      failure: FailureSchema,
      blobs: z.tuple([]),
    })
    .strict();

type TransformRequestMetadata = z.infer<
  typeof FoundryOfflineNormalizeMeshGlbPreviewSandboxTransformRequestMetadataV0Schema
>;
type FreshVerifierRequestMetadata = z.infer<
  typeof FoundryOfflineNormalizeMeshGlbPreviewSandboxFreshVerifierRequestMetadataV0Schema
>;
type TransformSuccessMetadata = z.infer<
  typeof FoundryOfflineNormalizeMeshGlbPreviewSandboxTransformSuccessMetadataV0Schema
>;
type FreshVerifierSuccessMetadata = z.infer<
  typeof FoundryOfflineNormalizeMeshGlbPreviewSandboxFreshVerifierSuccessMetadataV0Schema
>;
type FailureMetadata = z.infer<
  typeof FoundryOfflineNormalizeMeshGlbPreviewSandboxFailureMetadataV0Schema
>;
type WireMetadata =
  | TransformRequestMetadata
  | FreshVerifierRequestMetadata
  | TransformSuccessMetadata
  | FreshVerifierSuccessMetadata
  | FailureMetadata;

export interface FoundryOfflineNormalizeMeshGlbPreviewSandboxTransformRequestInput {
  readonly kind: "transform_request";
  readonly requestId: string;
  readonly deadlineAt: string;
  readonly invocation: unknown;
  readonly permitEnvelope: unknown;
  readonly permitPublicKey: {
    readonly keyId: string;
    readonly spkiDerBase64: string;
  };
  readonly sourceBytes: Uint8Array;
}

export interface FoundryOfflineNormalizeMeshGlbPreviewSandboxFreshVerifierRequestInput {
  readonly kind: "fresh_verifier_request";
  readonly requestId: string;
  readonly deadlineAt: string;
  readonly invocation: unknown;
  readonly permitEnvelope: unknown;
  readonly permitPublicKey: {
    readonly keyId: string;
    readonly spkiDerBase64: string;
  };
  readonly report: unknown;
  readonly sourceBytes: Uint8Array;
  readonly candidateBytes: Uint8Array;
}

export interface FoundryOfflineNormalizeMeshGlbPreviewSandboxTransformSuccessInput {
  readonly kind: "transform_success";
  readonly requestId: string;
  readonly report: unknown;
  readonly outputBytes: Uint8Array;
}

export interface FoundryOfflineNormalizeMeshGlbPreviewSandboxFreshVerifierSuccessInput {
  readonly kind: "fresh_verifier_success";
  readonly requestId: string;
}

export interface FoundryOfflineNormalizeMeshGlbPreviewSandboxFailureInput {
  readonly kind: "failure";
  readonly role: RequestRole;
  readonly requestId: string;
  readonly failure: {
    readonly code: string;
  };
}

export type FoundryOfflineNormalizeMeshGlbPreviewSandboxWireInput =
  | FoundryOfflineNormalizeMeshGlbPreviewSandboxTransformRequestInput
  | FoundryOfflineNormalizeMeshGlbPreviewSandboxFreshVerifierRequestInput
  | FoundryOfflineNormalizeMeshGlbPreviewSandboxTransformSuccessInput
  | FoundryOfflineNormalizeMeshGlbPreviewSandboxFreshVerifierSuccessInput
  | FoundryOfflineNormalizeMeshGlbPreviewSandboxFailureInput;

export interface FoundryOfflineNormalizeMeshGlbPreviewSandboxTransformRequest {
  readonly kind: "transform_request";
  readonly metadata: TransformRequestMetadata;
  readonly sourceBytes: Buffer;
}

export interface FoundryOfflineNormalizeMeshGlbPreviewSandboxFreshVerifierRequest {
  readonly kind: "fresh_verifier_request";
  readonly metadata: FreshVerifierRequestMetadata;
  readonly sourceBytes: Buffer;
  readonly candidateBytes: Buffer;
}

export interface FoundryOfflineNormalizeMeshGlbPreviewSandboxTransformSuccess {
  readonly kind: "transform_success";
  readonly metadata: TransformSuccessMetadata;
  readonly outputBytes: Buffer;
}

export interface FoundryOfflineNormalizeMeshGlbPreviewSandboxFreshVerifierSuccess {
  readonly kind: "fresh_verifier_success";
  readonly metadata: FreshVerifierSuccessMetadata;
}

export interface FoundryOfflineNormalizeMeshGlbPreviewSandboxFailure {
  readonly kind: "failure";
  readonly metadata: FailureMetadata;
}

export type FoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage =
  | FoundryOfflineNormalizeMeshGlbPreviewSandboxTransformRequest
  | FoundryOfflineNormalizeMeshGlbPreviewSandboxFreshVerifierRequest
  | FoundryOfflineNormalizeMeshGlbPreviewSandboxTransformSuccess
  | FoundryOfflineNormalizeMeshGlbPreviewSandboxFreshVerifierSuccess
  | FoundryOfflineNormalizeMeshGlbPreviewSandboxFailure;

interface BlobFrame {
  readonly kind: BlobKind;
  readonly bytes: Buffer;
}

interface ParsedFrame extends BlobFrame {
  readonly digest: string;
}

function plainDigest(bytes: Uint8Array): string {
  return `sha256:${sha256Bytes(bytes)}`;
}

function blobBinding(kind: BlobKind, bytes: Uint8Array) {
  return { kind, sizeBytes: bytes.byteLength, sha256: plainDigest(bytes) };
}

function canonicalMetadataBytes(metadata: WireMetadata): Buffer {
  const bytes = Buffer.from(
    stableCanonicalJson(toCanonicalJson(metadata)),
    "utf8",
  );
  if (
    bytes.length === 0 ||
    bytes.length >
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_MAX_METADATA_BYTES
  ) {
    fail(
      "OFFLINE_PREVIEW_SANDBOX_WIRE_METADATA_OVERSIZED",
      "Sandbox wire metadata exceeds its fixed byte budget.",
    );
  }
  return bytes;
}

function domainDigest(
  domain: string,
  discriminator: number,
  length: number,
  bytes: Uint8Array,
): Buffer {
  const prefix = Buffer.alloc(5);
  prefix.writeUInt8(discriminator, 0);
  prefix.writeUInt32BE(length, 1);
  return createHash("sha256")
    .update(domain, "ascii")
    .update(Buffer.from([0]))
    .update(prefix)
    .update(bytes)
    .digest();
}

function messageKindFromCode(code: number): MessageKind {
  for (const [kind, value] of Object.entries(MESSAGE_KIND)) {
    if (value === code) return kind as MessageKind;
  }
  fail(
    "OFFLINE_PREVIEW_SANDBOX_WIRE_MESSAGE_KIND_INVALID",
    "Sandbox wire message kind is unknown.",
  );
}

function blobKindFromCode(code: number): BlobKind {
  for (const [kind, value] of Object.entries(BLOB_KIND)) {
    if (value === code) return kind as BlobKind;
  }
  fail(
    "OFFLINE_PREVIEW_SANDBOX_WIRE_BLOB_KIND_INVALID",
    "Sandbox wire blob kind is unknown.",
  );
}

function schemaForKind(kind: MessageKind) {
  switch (kind) {
    case "transform_request":
      return FoundryOfflineNormalizeMeshGlbPreviewSandboxTransformRequestMetadataV0Schema;
    case "fresh_verifier_request":
      return FoundryOfflineNormalizeMeshGlbPreviewSandboxFreshVerifierRequestMetadataV0Schema;
    case "transform_success":
      return FoundryOfflineNormalizeMeshGlbPreviewSandboxTransformSuccessMetadataV0Schema;
    case "fresh_verifier_success":
      return FoundryOfflineNormalizeMeshGlbPreviewSandboxFreshVerifierSuccessMetadataV0Schema;
    case "failure":
      return FoundryOfflineNormalizeMeshGlbPreviewSandboxFailureMetadataV0Schema;
  }
}

function parseMetadata(kind: MessageKind, bytes: Buffer): WireMetadata {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error: unknown) {
    fail(
      "OFFLINE_PREVIEW_SANDBOX_WIRE_METADATA_UTF8_INVALID",
      "Sandbox wire metadata is not valid UTF-8.",
      error,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error: unknown) {
    fail(
      "OFFLINE_PREVIEW_SANDBOX_WIRE_METADATA_JSON_INVALID",
      "Sandbox wire metadata is not valid JSON.",
      error,
    );
  }
  let parsed: WireMetadata;
  try {
    parsed = schemaForKind(kind).parse(raw);
  } catch (error: unknown) {
    fail(
      "OFFLINE_PREVIEW_SANDBOX_WIRE_METADATA_SHAPE_INVALID",
      "Sandbox wire metadata does not match the exact message contract.",
      error,
    );
  }
  if (!canonicalMetadataBytes(parsed).equals(bytes)) {
    fail(
      "OFFLINE_PREVIEW_SANDBOX_WIRE_METADATA_NOT_CANONICAL",
      "Sandbox wire metadata must be its exact canonical JSON encoding.",
    );
  }
  return deepFreeze(parsed);
}

function decodeCanonicalSpki(value: string): Buffer {
  if (
    value.length !== SPKI_BASE64_BYTES ||
    !CANONICAL_BASE64.test(value)
  ) {
    fail(
      "OFFLINE_PREVIEW_SANDBOX_WIRE_PUBLIC_KEY_INVALID",
      "Sandbox wire permit key must be canonical padded base64.",
    );
  }
  const bytes = Buffer.from(value, "base64");
  if (
    bytes.length !== SPKI_DER_BYTES ||
    bytes.toString("base64") !== value ||
    !bytes.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    bytes.fill(0);
    fail(
      "OFFLINE_PREVIEW_SANDBOX_WIRE_PUBLIC_KEY_INVALID",
      "Sandbox wire permit key must be exactly one Ed25519 SPKI DER public key.",
    );
  }
  return bytes;
}

function parsePermitPublicKey(
  metadata: TransformRequestMetadata | FreshVerifierRequestMetadata,
): void {
  const spki = decodeCanonicalSpki(metadata.permitPublicKey.spkiDerBase64);
  try {
    const key = createPublicKey({ key: spki, format: "der", type: "spki" });
    if (key.type !== "public" || key.asymmetricKeyType !== "ed25519") {
      fail(
        "OFFLINE_PREVIEW_SANDBOX_WIRE_PUBLIC_KEY_INVALID",
        "Sandbox wire permit key is not an Ed25519 public key.",
      );
    }
  } catch (error: unknown) {
    if (error instanceof FoundryIntegrityError) throw error;
    fail(
      "OFFLINE_PREVIEW_SANDBOX_WIRE_PUBLIC_KEY_INVALID",
      "Sandbox wire permit key is not valid SPKI DER.",
      error,
    );
  } finally {
    spki.fill(0);
  }
}

function validateRequestPermitTransport(
  metadata: TransformRequestMetadata | FreshVerifierRequestMetadata,
): void {
  const keyId = metadata.permitPublicKey.keyId;
  if (
    keyId !== metadata.invocation.permit.keyId ||
    !metadata.permitEnvelope.signatures.some(
      (signature) => signature.keyid === keyId,
    )
  ) {
    fail(
      "OFFLINE_PREVIEW_SANDBOX_WIRE_PERMIT_KEY_BINDING_MISMATCH",
      "Sandbox wire permit key ID must exactly bind the invocation and signed envelope.",
    );
  }
  const payloadBytes = Buffer.from(metadata.permitEnvelope.payload, "base64");
  try {
    if (
      payloadBytes.length === 0 ||
      payloadBytes.length >
        FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_MAX_PERMIT_PAYLOAD_BYTES ||
      metadata.permitEnvelope.payloadType !==
        FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_PAYLOAD_TYPE ||
      metadata.invocation.permit.payloadSha256 !== plainDigest(payloadBytes)
    ) {
      fail(
        "OFFLINE_PREVIEW_SANDBOX_WIRE_PERMIT_BINDING_MISMATCH",
        "Sandbox wire permit payload, type, size, or digest does not match the invocation.",
      );
    }
    parsePermitPublicKey(metadata);
  } catch (error: unknown) {
    if (error instanceof FoundryIntegrityError) throw error;
    fail(
      "OFFLINE_PREVIEW_SANDBOX_WIRE_PERMIT_TRANSPORT_INVALID",
      "Sandbox wire permit transport bindings are invalid.",
      error,
    );
  } finally {
    payloadBytes.fill(0);
  }
}

function assertRequestBindings(
  metadata: TransformRequestMetadata | FreshVerifierRequestMetadata,
): void {
  const source = metadata.blobs[0];
  if (
    source.sizeBytes !== metadata.invocation.source.sizeBytes ||
    source.sha256 !== metadata.invocation.source.sha256 ||
    Date.parse(metadata.deadlineAt) > Date.parse(metadata.invocation.permit.expiresAt)
  ) {
    fail(
      "OFFLINE_PREVIEW_SANDBOX_WIRE_REQUEST_BINDING_MISMATCH",
      "Sandbox request source or deadline does not match its invocation and permit bounds.",
    );
  }
  validateRequestPermitTransport(metadata);
}

function assertFreshVerifierBindings(
  metadata: FreshVerifierRequestMetadata,
): void {
  const candidate = metadata.blobs[1];
  const report = metadata.report;
  if (
    report.invocationSha256 !==
      computeFoundryOfflineNormalizeMeshGlbPreviewInvocationSha256(
        metadata.invocation,
      ) ||
    report.source.sizeBytes !== metadata.invocation.source.sizeBytes ||
    report.source.sha256 !== metadata.invocation.source.sha256 ||
    candidate.sizeBytes !== report.output.sizeBytes ||
    candidate.sha256 !== report.output.sha256
  ) {
    fail(
      "OFFLINE_PREVIEW_SANDBOX_WIRE_VERIFIER_BINDING_MISMATCH",
      "Fresh-verifier report and candidate bindings do not match the invocation.",
    );
  }
}

function validateMetadataBindings(metadata: WireMetadata): void {
  if (metadata.messageType === "request") {
    assertRequestBindings(metadata);
    if (metadata.role === "fresh_verifier") {
      assertFreshVerifierBindings(metadata);
    }
    return;
  }
  if (metadata.messageType === "success" && metadata.role === "transform") {
    const output = metadata.blobs[0];
    if (
      output.sizeBytes !== metadata.report.output.sizeBytes ||
      output.sha256 !== metadata.report.output.sha256
    ) {
      fail(
        "OFFLINE_PREVIEW_SANDBOX_WIRE_OUTPUT_BINDING_MISMATCH",
        "Transform-success output does not match its report binding.",
      );
    }
  }
}

function expectedFrames(metadata: WireMetadata): readonly BlobKind[] {
  if (metadata.messageType === "request") {
    return metadata.role === "transform"
      ? ["source"]
      : ["source", "candidate"];
  }
  if (metadata.messageType === "success" && metadata.role === "transform") {
    return ["output"];
  }
  return [];
}

function expectedBinding(metadata: WireMetadata, index: number) {
  return metadata.blobs[index];
}

function snapshotBoundedBytes(bytes: Uint8Array, label: string): Buffer {
  if (!(bytes instanceof Uint8Array)) {
    fail(
      "OFFLINE_PREVIEW_SANDBOX_WIRE_BLOB_BYTES_INVALID",
      `${label} must be supplied as Uint8Array bytes.`,
    );
  }
  if (
    !Number.isSafeInteger(bytes.byteLength) ||
    bytes.byteLength <= 0 ||
    bytes.byteLength > FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES
  ) {
    fail(
      "OFFLINE_PREVIEW_SANDBOX_WIRE_BLOB_OVERSIZED",
      `${label} must contain 1-${String(FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES)} bytes.`,
    );
  }
  try {
    return Buffer.from(bytes);
  } catch (error: unknown) {
    fail(
      "OFFLINE_PREVIEW_SANDBOX_WIRE_BLOB_SNAPSHOT_FAILED",
      `${label} could not be copied into a stable wire snapshot.`,
      error,
    );
  }
}

function encodeFrame(frame: BlobFrame): Buffer {
  const header = Buffer.alloc(
    FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_FRAME_HEADER_BYTES,
  );
  header.writeUInt8(BLOB_KIND[frame.kind], 0);
  header.writeUInt8(HEADER_FLAGS, 1);
  header.writeUInt16BE(0, 2);
  header.writeUInt32BE(frame.bytes.length, 4);
  domainDigest(
    FRAME_DIGEST_DOMAIN,
    BLOB_KIND[frame.kind],
    frame.bytes.length,
    frame.bytes,
  ).copy(header, 8);
  return Buffer.concat([header, frame.bytes]);
}

function encodeMessage(
  kind: MessageKind,
  metadata: WireMetadata,
  frames: readonly BlobFrame[],
): Buffer {
  validateMetadataBindings(metadata);
  const metadataBytes = canonicalMetadataBytes(metadata);
  const header = Buffer.alloc(
    FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_HEADER_BYTES,
  );
  MAGIC.copy(header, 0);
  header.writeUInt8(WIRE_VERSION, 8);
  header.writeUInt8(MESSAGE_KIND[kind], 9);
  header.writeUInt8(frames.length, 10);
  header.writeUInt8(HEADER_FLAGS, 11);
  header.writeUInt32BE(metadataBytes.length, 12);
  domainDigest(
    METADATA_DIGEST_DOMAIN,
    MESSAGE_KIND[kind],
    metadataBytes.length,
    metadataBytes,
  ).copy(header, METADATA_DIGEST_OFFSET);
  const output = Buffer.concat([
    header,
    metadataBytes,
    ...frames.map(encodeFrame),
  ]);
  if (
    output.length >
    FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_MAX_BYTES
  ) {
    output.fill(0);
    fail(
      "OFFLINE_PREVIEW_SANDBOX_WIRE_MESSAGE_OVERSIZED",
      "Sandbox wire message exceeds its immutable total byte budget.",
    );
  }
  return output;
}

function buildMetadataAndFrames(
  input: FoundryOfflineNormalizeMeshGlbPreviewSandboxWireInput,
): { readonly metadata: WireMetadata; readonly frames: readonly BlobFrame[] } {
  switch (input.kind) {
    case "transform_request": {
      const source = snapshotBoundedBytes(input.sourceBytes, "sourceBytes");
      const metadata = FoundryOfflineNormalizeMeshGlbPreviewSandboxTransformRequestMetadataV0Schema.parse({
        schemaVersion: FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_V0,
        messageType: "request",
        role: "transform",
        requestId: input.requestId,
        deadlineAt: input.deadlineAt,
        invocation: input.invocation,
        permitEnvelope: input.permitEnvelope,
        permitPublicKey: input.permitPublicKey,
        blobs: [blobBinding("source", source)],
      });
      return { metadata, frames: [{ kind: "source", bytes: source }] };
    }
    case "fresh_verifier_request": {
      const source = snapshotBoundedBytes(input.sourceBytes, "sourceBytes");
      const candidate = snapshotBoundedBytes(input.candidateBytes, "candidateBytes");
      const metadata = FoundryOfflineNormalizeMeshGlbPreviewSandboxFreshVerifierRequestMetadataV0Schema.parse({
        schemaVersion: FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_V0,
        messageType: "request",
        role: "fresh_verifier",
        requestId: input.requestId,
        deadlineAt: input.deadlineAt,
        invocation: input.invocation,
        permitEnvelope: input.permitEnvelope,
        permitPublicKey: input.permitPublicKey,
        report: input.report,
        blobs: [
          blobBinding("source", source),
          blobBinding("candidate", candidate),
        ],
      });
      return {
        metadata,
        frames: [
          { kind: "source", bytes: source },
          { kind: "candidate", bytes: candidate },
        ],
      };
    }
    case "transform_success": {
      const output = snapshotBoundedBytes(input.outputBytes, "outputBytes");
      const metadata = FoundryOfflineNormalizeMeshGlbPreviewSandboxTransformSuccessMetadataV0Schema.parse({
        schemaVersion: FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_V0,
        messageType: "success",
        role: "transform",
        requestId: input.requestId,
        report: input.report,
        blobs: [blobBinding("output", output)],
      });
      return { metadata, frames: [{ kind: "output", bytes: output }] };
    }
    case "fresh_verifier_success":
      // The host retains its own candidate copy; successful verification never
      // echoes candidate bytes back across the worker boundary.
      return {
        metadata: FoundryOfflineNormalizeMeshGlbPreviewSandboxFreshVerifierSuccessMetadataV0Schema.parse({
          schemaVersion: FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_V0,
          messageType: "success",
          role: "fresh_verifier",
          requestId: input.requestId,
          blobs: [],
        }),
        frames: [],
      };
    case "failure":
      return {
        metadata: FoundryOfflineNormalizeMeshGlbPreviewSandboxFailureMetadataV0Schema.parse({
          schemaVersion: FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_V0,
          messageType: "failure",
          role: input.role,
          requestId: input.requestId,
          failure: input.failure,
          blobs: [],
        }),
        frames: [],
      };
  }
}

/**
 * Encodes only the bounded transport contract. A successfully encoded message
 * does not establish key trust, permit authority, sandboxing, or execution.
 */
export function encodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage(
  input: FoundryOfflineNormalizeMeshGlbPreviewSandboxWireInput,
): Buffer {
  const built = buildMetadataAndFrames(input);
  return encodeMessage(input.kind, built.metadata, built.frames);
}

function assertHeader(bytes: Buffer): {
  readonly kind: MessageKind;
  readonly frameCount: number;
  readonly metadataLength: number;
} {
  if (
    bytes.length <
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_HEADER_BYTES
  ) {
    fail(
      "OFFLINE_PREVIEW_SANDBOX_WIRE_TRUNCATED",
      "Sandbox wire message is shorter than its fixed header.",
    );
  }
  if (!bytes.subarray(0, MAGIC.length).equals(MAGIC)) {
    fail(
      "OFFLINE_PREVIEW_SANDBOX_WIRE_MAGIC_INVALID",
      "Sandbox wire magic bytes do not match this protocol.",
    );
  }
  if (bytes.readUInt8(8) !== WIRE_VERSION) {
    fail(
      "OFFLINE_PREVIEW_SANDBOX_WIRE_VERSION_INVALID",
      "Sandbox wire version is unsupported.",
    );
  }
  if (bytes.readUInt8(11) !== HEADER_FLAGS) {
    fail(
      "OFFLINE_PREVIEW_SANDBOX_WIRE_HEADER_FLAGS_INVALID",
      "Sandbox wire header contains unsupported flags.",
    );
  }
  const frameCount = bytes.readUInt8(10);
  const metadataLength = bytes.readUInt32BE(12);
  if (frameCount > MAX_FRAME_COUNT) {
    fail(
      "OFFLINE_PREVIEW_SANDBOX_WIRE_FRAME_COUNT_INVALID",
      "Sandbox wire frame count exceeds the fixed protocol bound.",
    );
  }
  if (
    metadataLength === 0 ||
    metadataLength >
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_MAX_METADATA_BYTES ||
    FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_HEADER_BYTES +
      metadataLength >
      bytes.length
  ) {
    fail(
      "OFFLINE_PREVIEW_SANDBOX_WIRE_METADATA_LENGTH_INVALID",
      "Sandbox wire metadata length is zero, oversized, or truncated.",
    );
  }
  return {
    kind: messageKindFromCode(bytes.readUInt8(9)),
    frameCount,
    metadataLength,
  };
}

function verifyMetadataDigest(
  wire: Buffer,
  kind: MessageKind,
  metadata: Buffer,
): void {
  const expected = domainDigest(
    METADATA_DIGEST_DOMAIN,
    MESSAGE_KIND[kind],
    metadata.length,
    metadata,
  );
  if (
    !wire
      .subarray(
        METADATA_DIGEST_OFFSET,
        METADATA_DIGEST_OFFSET + DIGEST_BYTES,
      )
      .equals(expected)
  ) {
    fail(
      "OFFLINE_PREVIEW_SANDBOX_WIRE_METADATA_DIGEST_MISMATCH",
      "Sandbox wire metadata domain digest does not match its bytes.",
    );
  }
}

function parseFrame(
  wire: Buffer,
  cursor: number,
  seenKinds: Set<BlobKind>,
  sensitive: Buffer[],
): { readonly frame: ParsedFrame; readonly nextCursor: number } {
  const headerEnd =
    cursor +
    FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_FRAME_HEADER_BYTES;
  if (headerEnd > wire.length) {
    fail(
      "OFFLINE_PREVIEW_SANDBOX_WIRE_FRAME_TRUNCATED",
      "Sandbox wire frame header is truncated.",
    );
  }
  const kind = blobKindFromCode(wire.readUInt8(cursor));
  if (
    wire.readUInt8(cursor + 1) !== HEADER_FLAGS ||
    wire.readUInt16BE(cursor + 2) !== 0
  ) {
    fail(
      "OFFLINE_PREVIEW_SANDBOX_WIRE_FRAME_FLAGS_INVALID",
      "Sandbox wire frame contains unsupported flags or reserved data.",
    );
  }
  if (seenKinds.has(kind)) {
    fail(
      "OFFLINE_PREVIEW_SANDBOX_WIRE_DUPLICATE_FRAME",
      "Sandbox wire cannot contain duplicate blob frame kinds.",
    );
  }
  seenKinds.add(kind);
  const length = wire.readUInt32BE(cursor + 4);
  const payloadEnd = headerEnd + length;
  if (
    length === 0 ||
    length > FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES ||
    payloadEnd > wire.length
  ) {
    fail(
      "OFFLINE_PREVIEW_SANDBOX_WIRE_FRAME_LENGTH_INVALID",
      "Sandbox wire frame is empty, oversized, or truncated.",
    );
  }
  const bytes = Buffer.from(wire.subarray(headerEnd, payloadEnd));
  if (kind === "candidate" || kind === "output") sensitive.push(bytes);
  const expected = domainDigest(
    FRAME_DIGEST_DOMAIN,
    BLOB_KIND[kind],
    length,
    bytes,
  );
  if (
    !wire
      .subarray(cursor + 8, cursor + 8 + DIGEST_BYTES)
      .equals(expected)
  ) {
    fail(
      "OFFLINE_PREVIEW_SANDBOX_WIRE_FRAME_DOMAIN_DIGEST_MISMATCH",
      "Sandbox wire frame domain digest does not match its bytes.",
    );
  }
  return {
    frame: { kind, bytes, digest: plainDigest(bytes) },
    nextCursor: payloadEnd,
  };
}

function parseFrames(
  wire: Buffer,
  cursor: number,
  count: number,
  metadata: WireMetadata,
  sensitive: Buffer[],
): readonly ParsedFrame[] {
  const expected = expectedFrames(metadata);
  if (count !== expected.length) {
    fail(
      "OFFLINE_PREVIEW_SANDBOX_WIRE_FRAME_COUNT_MISMATCH",
      "Sandbox wire frame count does not match its exact message role.",
    );
  }
  const frames: ParsedFrame[] = [];
  const seenKinds = new Set<BlobKind>();
  let next = cursor;
  for (let index = 0; index < count; index += 1) {
    const parsed = parseFrame(wire, next, seenKinds, sensitive);
    const binding = expectedBinding(metadata, index);
    if (
      parsed.frame.kind !== expected[index] ||
      binding === undefined ||
      binding.kind !== parsed.frame.kind ||
      binding.sizeBytes !== parsed.frame.bytes.length ||
      binding.sha256 !== parsed.frame.digest
    ) {
      fail(
        "OFFLINE_PREVIEW_SANDBOX_WIRE_FRAME_BINDING_MISMATCH",
        "Sandbox wire frame order, length, or SHA-256 does not match metadata.",
      );
    }
    frames.push(parsed.frame);
    next = parsed.nextCursor;
  }
  if (next !== wire.length) {
    fail(
      "OFFLINE_PREVIEW_SANDBOX_WIRE_TRAILING_BYTES",
      "Sandbox wire message contains trailing or unframed bytes.",
    );
  }
  return frames;
}

function assembleDecodedMessage(
  kind: MessageKind,
  metadata: WireMetadata,
  frames: readonly ParsedFrame[],
): FoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage {
  const frame = (index: number): ParsedFrame => {
    const value = frames[index];
    if (value === undefined) {
      fail(
        "OFFLINE_PREVIEW_SANDBOX_WIRE_FRAME_COUNT_MISMATCH",
        "Sandbox wire decoded message is missing its required blob frame.",
      );
    }
    return value;
  };
  switch (kind) {
    case "transform_request":
      return {
        kind,
        metadata: metadata as TransformRequestMetadata,
        sourceBytes: frame(0).bytes,
      };
    case "fresh_verifier_request":
      return {
        kind,
        metadata: metadata as FreshVerifierRequestMetadata,
        sourceBytes: frame(0).bytes,
        candidateBytes: frame(1).bytes,
      };
    case "transform_success":
      return {
        kind,
        metadata: metadata as TransformSuccessMetadata,
        outputBytes: frame(0).bytes,
      };
    case "fresh_verifier_success":
      return {
        kind,
        metadata: metadata as FreshVerifierSuccessMetadata,
      };
    case "failure":
      return { kind, metadata: metadata as FailureMetadata };
  }
}

function snapshotWireBytes(input: Uint8Array): Buffer {
  if (!(input instanceof Uint8Array)) {
    fail(
      "OFFLINE_PREVIEW_SANDBOX_WIRE_BYTES_INVALID",
      "Sandbox wire input must be a Uint8Array.",
    );
  }
  if (
    !Number.isSafeInteger(input.byteLength) ||
    input.byteLength >
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_MAX_BYTES
  ) {
    fail(
      "OFFLINE_PREVIEW_SANDBOX_WIRE_MESSAGE_OVERSIZED",
      "Sandbox wire message exceeds its immutable total byte budget.",
    );
  }
  try {
    return Buffer.from(input);
  } catch (error: unknown) {
    fail(
      "OFFLINE_PREVIEW_SANDBOX_WIRE_SNAPSHOT_FAILED",
      "Sandbox wire bytes could not be copied into a stable snapshot.",
      error,
    );
  }
}

/**
 * Decodes and authenticates the transport framing and exact byte bindings.
 * The result establishes no trust root, permit authority, sandbox, or right to
 * execute. Callers retain ownership of the returned blob buffers and should
 * erase candidate/output bytes when their lifecycle ends.
 */
export function decodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage(
  input: Uint8Array,
): FoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage {
  const wire = snapshotWireBytes(input);
  const sensitive: Buffer[] = [];
  let completed = false;
  try {
    const header = assertHeader(wire);
    const metadataStart =
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_HEADER_BYTES;
    const metadataEnd = metadataStart + header.metadataLength;
    const metadataBytes = wire.subarray(metadataStart, metadataEnd);
    verifyMetadataDigest(wire, header.kind, metadataBytes);
    const metadata = parseMetadata(header.kind, metadataBytes);
    validateMetadataBindings(metadata);
    const frames = parseFrames(
      wire,
      metadataEnd,
      header.frameCount,
      metadata,
      sensitive,
    );
    const message = assembleDecodedMessage(header.kind, metadata, frames);
    completed = true;
    return message;
  } finally {
    wire.fill(0);
    if (!completed) {
      for (const bytes of sensitive) bytes.fill(0);
    }
  }
}

export type {
  FailureMetadata as FoundryOfflineNormalizeMeshGlbPreviewSandboxFailureMetadataV0,
  FreshVerifierRequestMetadata as FoundryOfflineNormalizeMeshGlbPreviewSandboxFreshVerifierRequestMetadataV0,
  FreshVerifierSuccessMetadata as FoundryOfflineNormalizeMeshGlbPreviewSandboxFreshVerifierSuccessMetadataV0,
  TransformRequestMetadata as FoundryOfflineNormalizeMeshGlbPreviewSandboxTransformRequestMetadataV0,
  TransformSuccessMetadata as FoundryOfflineNormalizeMeshGlbPreviewSandboxTransformSuccessMetadataV0,
};

// These aliases keep the transport surface explicit without representing the
// transported key as trusted or the transported report as execution authority.
export type FoundryOfflineNormalizeMeshGlbPreviewSandboxInvocation =
  FoundryOfflineNormalizeMeshGlbPreviewInvocationV0;
export type FoundryOfflineNormalizeMeshGlbPreviewSandboxReport =
  FoundryOfflineNormalizeMeshGlbPreviewReportV0;
