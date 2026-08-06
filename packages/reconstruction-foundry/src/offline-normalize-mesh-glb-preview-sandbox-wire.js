import { createHash, createPublicKey, } from "node:crypto";
import { z } from "zod";
import { stableCanonicalJson, toCanonicalJson, } from "./canonical-json.js";
import { DsseEnvelopeSchema } from "./dsse.js";
import { FoundryIntegrityError } from "./errors.js";
import { sha256Bytes } from "./hash.js";
import { FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_MAX_PERMIT_PAYLOAD_BYTES, FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_PAYLOAD_TYPE, FoundryOfflineNormalizeMeshGlbPreviewInvocationV0Schema, FoundryOfflineNormalizeMeshGlbPreviewReportV0Schema, computeFoundryOfflineNormalizeMeshGlbPreviewInvocationSha256, } from "./offline-normalize-mesh-glb-preview.js";
import { FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES } from "./normalize-mesh-glb-worker.js";
export const FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_V0 = "omnitwin.foundry.offline-normalize-mesh-glb-preview-sandbox-wire.v0";
export const FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_MAX_METADATA_BYTES = 256 * 1024;
export const FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_HEADER_BYTES = 48;
export const FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_FRAME_HEADER_BYTES = 40;
const MAGIC = Buffer.from("OMFGLBW0", "ascii");
const WIRE_VERSION = 1;
const HEADER_FLAGS = 0;
const METADATA_DIGEST_OFFSET = 16;
const DIGEST_BYTES = 32;
const MAX_FRAME_COUNT = 2;
const SPKI_DER_BYTES = 44;
const SPKI_BASE64_BYTES = 60;
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const METADATA_DIGEST_DOMAIN = "OMNITWIN_FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_METADATA_V0";
const FRAME_DIGEST_DOMAIN = "OMNITWIN_FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_FRAME_V0";
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
});
const BLOB_KIND = Object.freeze({
    source: 1,
    candidate: 2,
    output: 3,
});
export const FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_FAILURE_CODES = [
    "REQUEST_INVALID",
    "DEADLINE_EXCEEDED",
    "TRANSFORM_FAILED",
    "VERIFICATION_FAILED",
    "OUTPUT_LIMIT_EXCEEDED",
    "CANCELLED",
    "INTERNAL_FAILURE",
];
export const FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_MAX_BYTES = FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_HEADER_BYTES +
    FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_MAX_METADATA_BYTES +
    MAX_FRAME_COUNT *
        (FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_FRAME_HEADER_BYTES +
            FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES);
function fail(code, message, cause) {
    throw new FoundryIntegrityError(code, message, { cause });
}
function deepFreeze(value) {
    if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
        return value;
    }
    for (const member of Object.values(value))
        deepFreeze(member);
    return Object.freeze(value);
}
function canonicalUtc(value) {
    if (!CANONICAL_UTC.test(value))
        return false;
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
export const FoundryOfflineNormalizeMeshGlbPreviewSandboxTransformRequestMetadataV0Schema = z
    .object({
    schemaVersion: z.literal(FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_V0),
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
export const FoundryOfflineNormalizeMeshGlbPreviewSandboxFreshVerifierRequestMetadataV0Schema = z
    .object({
    schemaVersion: z.literal(FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_V0),
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
export const FoundryOfflineNormalizeMeshGlbPreviewSandboxTransformSuccessMetadataV0Schema = z
    .object({
    schemaVersion: z.literal(FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_V0),
    messageType: z.literal("success"),
    role: z.literal("transform"),
    requestId: RequestIdSchema,
    report: FoundryOfflineNormalizeMeshGlbPreviewReportV0Schema,
    blobs: z.tuple([OutputBlobBindingSchema]),
})
    .strict();
export const FoundryOfflineNormalizeMeshGlbPreviewSandboxFreshVerifierSuccessMetadataV0Schema = z
    .object({
    schemaVersion: z.literal(FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_V0),
    messageType: z.literal("success"),
    role: z.literal("fresh_verifier"),
    requestId: RequestIdSchema,
    requestWireSha256: z.string().regex(SHA256),
    deadlineAt: DeadlineSchema,
    invocationSha256: z.string().regex(SHA256),
    permitPayloadSha256: z.string().regex(SHA256),
    source: SourceBlobBindingSchema,
    candidate: CandidateBlobBindingSchema,
    reportSha256: z.string().regex(SHA256),
    blobs: z.tuple([]),
})
    .strict();
const FailureSchema = z
    .object({
    code: z.enum(FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_FAILURE_CODES),
})
    .strict();
export const FoundryOfflineNormalizeMeshGlbPreviewSandboxFailureMetadataV0Schema = z
    .object({
    schemaVersion: z.literal(FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_V0),
    messageType: z.literal("failure"),
    role: z.union([z.literal("transform"), z.literal("fresh_verifier")]),
    requestId: RequestIdSchema,
    failure: FailureSchema,
    blobs: z.tuple([]),
})
    .strict();
function plainDigest(bytes) {
    return `sha256:${sha256Bytes(bytes)}`;
}
function blobBinding(kind, bytes) {
    return { kind, sizeBytes: bytes.byteLength, sha256: plainDigest(bytes) };
}
function canonicalMetadataBytes(metadata) {
    const bytes = Buffer.from(stableCanonicalJson(toCanonicalJson(metadata)), "utf8");
    if (bytes.length === 0 ||
        bytes.length >
            FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_MAX_METADATA_BYTES) {
        fail("OFFLINE_PREVIEW_SANDBOX_WIRE_METADATA_OVERSIZED", "Sandbox wire metadata exceeds its fixed byte budget.");
    }
    return bytes;
}
function domainDigest(domain, discriminator, length, bytes) {
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
function messageKindFromCode(code) {
    for (const [kind, value] of Object.entries(MESSAGE_KIND)) {
        if (value === code)
            return kind;
    }
    fail("OFFLINE_PREVIEW_SANDBOX_WIRE_MESSAGE_KIND_INVALID", "Sandbox wire message kind is unknown.");
}
function blobKindFromCode(code) {
    for (const [kind, value] of Object.entries(BLOB_KIND)) {
        if (value === code)
            return kind;
    }
    fail("OFFLINE_PREVIEW_SANDBOX_WIRE_BLOB_KIND_INVALID", "Sandbox wire blob kind is unknown.");
}
function schemaForKind(kind) {
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
function parseMetadata(kind, bytes) {
    let text;
    try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    }
    catch (error) {
        fail("OFFLINE_PREVIEW_SANDBOX_WIRE_METADATA_UTF8_INVALID", "Sandbox wire metadata is not valid UTF-8.", error);
    }
    let raw;
    try {
        raw = JSON.parse(text);
    }
    catch (error) {
        fail("OFFLINE_PREVIEW_SANDBOX_WIRE_METADATA_JSON_INVALID", "Sandbox wire metadata is not valid JSON.", error);
    }
    let parsed;
    try {
        parsed = schemaForKind(kind).parse(raw);
    }
    catch (error) {
        fail("OFFLINE_PREVIEW_SANDBOX_WIRE_METADATA_SHAPE_INVALID", "Sandbox wire metadata does not match the exact message contract.", error);
    }
    if (!canonicalMetadataBytes(parsed).equals(bytes)) {
        fail("OFFLINE_PREVIEW_SANDBOX_WIRE_METADATA_NOT_CANONICAL", "Sandbox wire metadata must be its exact canonical JSON encoding.");
    }
    return deepFreeze(parsed);
}
function decodeCanonicalSpki(value) {
    if (value.length !== SPKI_BASE64_BYTES ||
        !CANONICAL_BASE64.test(value)) {
        fail("OFFLINE_PREVIEW_SANDBOX_WIRE_PUBLIC_KEY_INVALID", "Sandbox wire permit key must be canonical padded base64.");
    }
    const bytes = Buffer.from(value, "base64");
    if (bytes.length !== SPKI_DER_BYTES ||
        bytes.toString("base64") !== value ||
        !bytes.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)) {
        bytes.fill(0);
        fail("OFFLINE_PREVIEW_SANDBOX_WIRE_PUBLIC_KEY_INVALID", "Sandbox wire permit key must be exactly one Ed25519 SPKI DER public key.");
    }
    return bytes;
}
function parsePermitPublicKey(metadata) {
    const spki = decodeCanonicalSpki(metadata.permitPublicKey.spkiDerBase64);
    try {
        const key = createPublicKey({ key: spki, format: "der", type: "spki" });
        if (key.type !== "public" || key.asymmetricKeyType !== "ed25519") {
            fail("OFFLINE_PREVIEW_SANDBOX_WIRE_PUBLIC_KEY_INVALID", "Sandbox wire permit key is not an Ed25519 public key.");
        }
    }
    catch (error) {
        if (error instanceof FoundryIntegrityError)
            throw error;
        fail("OFFLINE_PREVIEW_SANDBOX_WIRE_PUBLIC_KEY_INVALID", "Sandbox wire permit key is not valid SPKI DER.", error);
    }
    finally {
        spki.fill(0);
    }
}
function validateRequestPermitTransport(metadata) {
    const keyId = metadata.permitPublicKey.keyId;
    if (keyId !== metadata.invocation.permit.keyId ||
        !metadata.permitEnvelope.signatures.some((signature) => signature.keyid === keyId)) {
        fail("OFFLINE_PREVIEW_SANDBOX_WIRE_PERMIT_KEY_BINDING_MISMATCH", "Sandbox wire permit key ID must exactly bind the invocation and signed envelope.");
    }
    const payloadBytes = Buffer.from(metadata.permitEnvelope.payload, "base64");
    try {
        if (payloadBytes.length === 0 ||
            payloadBytes.length >
                FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_MAX_PERMIT_PAYLOAD_BYTES ||
            metadata.permitEnvelope.payloadType !==
                FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_PAYLOAD_TYPE ||
            metadata.invocation.permit.payloadSha256 !== plainDigest(payloadBytes)) {
            fail("OFFLINE_PREVIEW_SANDBOX_WIRE_PERMIT_BINDING_MISMATCH", "Sandbox wire permit payload, type, size, or digest does not match the invocation.");
        }
        parsePermitPublicKey(metadata);
    }
    catch (error) {
        if (error instanceof FoundryIntegrityError)
            throw error;
        fail("OFFLINE_PREVIEW_SANDBOX_WIRE_PERMIT_TRANSPORT_INVALID", "Sandbox wire permit transport bindings are invalid.", error);
    }
    finally {
        payloadBytes.fill(0);
    }
}
function assertRequestBindings(metadata) {
    const source = metadata.blobs[0];
    if (source.sizeBytes !== metadata.invocation.source.sizeBytes ||
        source.sha256 !== metadata.invocation.source.sha256 ||
        Date.parse(metadata.deadlineAt) > Date.parse(metadata.invocation.permit.expiresAt)) {
        fail("OFFLINE_PREVIEW_SANDBOX_WIRE_REQUEST_BINDING_MISMATCH", "Sandbox request source or deadline does not match its invocation and permit bounds.");
    }
    validateRequestPermitTransport(metadata);
}
function assertFreshVerifierBindings(metadata) {
    const candidate = metadata.blobs[1];
    const report = metadata.report;
    if (report.invocationSha256 !==
        computeFoundryOfflineNormalizeMeshGlbPreviewInvocationSha256(metadata.invocation) ||
        report.source.sizeBytes !== metadata.invocation.source.sizeBytes ||
        report.source.sha256 !== metadata.invocation.source.sha256 ||
        candidate.sizeBytes !== report.output.sizeBytes ||
        candidate.sha256 !== report.output.sha256) {
        fail("OFFLINE_PREVIEW_SANDBOX_WIRE_VERIFIER_BINDING_MISMATCH", "Fresh-verifier report and candidate bindings do not match the invocation.");
    }
}
function validateMetadataBindings(metadata) {
    if (metadata.messageType === "request") {
        assertRequestBindings(metadata);
        if (metadata.role === "fresh_verifier") {
            assertFreshVerifierBindings(metadata);
        }
        return;
    }
    if (metadata.messageType === "success" && metadata.role === "transform") {
        const output = metadata.blobs[0];
        if (output.sizeBytes !== metadata.report.output.sizeBytes ||
            output.sha256 !== metadata.report.output.sha256) {
            fail("OFFLINE_PREVIEW_SANDBOX_WIRE_OUTPUT_BINDING_MISMATCH", "Transform-success output does not match its report binding.");
        }
    }
}
function expectedFrames(metadata) {
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
function expectedBinding(metadata, index) {
    return metadata.blobs[index];
}
function snapshotBoundedBytes(bytes, label, sensitive) {
    if (!(bytes instanceof Uint8Array)) {
        fail("OFFLINE_PREVIEW_SANDBOX_WIRE_BLOB_BYTES_INVALID", `${label} must be supplied as Uint8Array bytes.`);
    }
    if (!Number.isSafeInteger(bytes.byteLength) ||
        bytes.byteLength <= 0 ||
        bytes.byteLength > FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES) {
        fail("OFFLINE_PREVIEW_SANDBOX_WIRE_BLOB_OVERSIZED", `${label} must contain 1-${String(FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES)} bytes.`);
    }
    try {
        const snapshot = Buffer.from(bytes);
        sensitive.push(snapshot);
        return snapshot;
    }
    catch (error) {
        fail("OFFLINE_PREVIEW_SANDBOX_WIRE_BLOB_SNAPSHOT_FAILED", `${label} could not be copied into a stable wire snapshot.`, error);
    }
}
function encodeMessage(kind, metadata, frames) {
    validateMetadataBindings(metadata);
    const metadataBytes = canonicalMetadataBytes(metadata);
    const header = Buffer.alloc(FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_HEADER_BYTES);
    let output;
    try {
        MAGIC.copy(header, 0);
        header.writeUInt8(WIRE_VERSION, 8);
        header.writeUInt8(MESSAGE_KIND[kind], 9);
        header.writeUInt8(frames.length, 10);
        header.writeUInt8(HEADER_FLAGS, 11);
        header.writeUInt32BE(metadataBytes.length, 12);
        domainDigest(METADATA_DIGEST_DOMAIN, MESSAGE_KIND[kind], metadataBytes.length, metadataBytes).copy(header, METADATA_DIGEST_OFFSET);
        const outputLength = frames.reduce((total, frame) => total +
            FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_FRAME_HEADER_BYTES +
            frame.bytes.length, header.length + metadataBytes.length);
        if (outputLength >
            FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_MAX_BYTES) {
            fail("OFFLINE_PREVIEW_SANDBOX_WIRE_MESSAGE_OVERSIZED", "Sandbox wire message exceeds its immutable total byte budget.");
        }
        output = Buffer.allocUnsafe(outputLength);
        let cursor = 0;
        cursor += header.copy(output, cursor);
        cursor += metadataBytes.copy(output, cursor);
        for (const frame of frames) {
            const frameHeader = Buffer.alloc(FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_FRAME_HEADER_BYTES);
            try {
                frameHeader.writeUInt8(BLOB_KIND[frame.kind], 0);
                frameHeader.writeUInt8(HEADER_FLAGS, 1);
                frameHeader.writeUInt16BE(0, 2);
                frameHeader.writeUInt32BE(frame.bytes.length, 4);
                domainDigest(FRAME_DIGEST_DOMAIN, BLOB_KIND[frame.kind], frame.bytes.length, frame.bytes).copy(frameHeader, 8);
                cursor += frameHeader.copy(output, cursor);
                cursor += frame.bytes.copy(output, cursor);
            }
            finally {
                frameHeader.fill(0);
            }
        }
        return output;
    }
    catch (error) {
        output?.fill(0);
        throw error;
    }
    finally {
        header.fill(0);
        metadataBytes.fill(0);
    }
}
function buildMetadataAndFrames(input, sensitive) {
    switch (input.kind) {
        case "transform_request": {
            const source = snapshotBoundedBytes(input.sourceBytes, "sourceBytes", sensitive);
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
            const source = snapshotBoundedBytes(input.sourceBytes, "sourceBytes", sensitive);
            const candidate = snapshotBoundedBytes(input.candidateBytes, "candidateBytes", sensitive);
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
            const output = snapshotBoundedBytes(input.outputBytes, "outputBytes", sensitive);
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
                    requestWireSha256: input.requestWireSha256,
                    deadlineAt: input.deadlineAt,
                    invocationSha256: input.invocationSha256,
                    permitPayloadSha256: input.permitPayloadSha256,
                    source: input.source,
                    candidate: input.candidate,
                    reportSha256: input.reportSha256,
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
export function encodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage(input) {
    const sensitive = [];
    try {
        const built = buildMetadataAndFrames(input, sensitive);
        return encodeMessage(input.kind, built.metadata, built.frames);
    }
    finally {
        for (const bytes of sensitive)
            bytes.fill(0);
    }
}
function assertHeader(bytes) {
    if (bytes.length <
        FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_HEADER_BYTES) {
        fail("OFFLINE_PREVIEW_SANDBOX_WIRE_TRUNCATED", "Sandbox wire message is shorter than its fixed header.");
    }
    if (!bytes.subarray(0, MAGIC.length).equals(MAGIC)) {
        fail("OFFLINE_PREVIEW_SANDBOX_WIRE_MAGIC_INVALID", "Sandbox wire magic bytes do not match this protocol.");
    }
    if (bytes.readUInt8(8) !== WIRE_VERSION) {
        fail("OFFLINE_PREVIEW_SANDBOX_WIRE_VERSION_INVALID", "Sandbox wire version is unsupported.");
    }
    if (bytes.readUInt8(11) !== HEADER_FLAGS) {
        fail("OFFLINE_PREVIEW_SANDBOX_WIRE_HEADER_FLAGS_INVALID", "Sandbox wire header contains unsupported flags.");
    }
    const frameCount = bytes.readUInt8(10);
    const metadataLength = bytes.readUInt32BE(12);
    if (frameCount > MAX_FRAME_COUNT) {
        fail("OFFLINE_PREVIEW_SANDBOX_WIRE_FRAME_COUNT_INVALID", "Sandbox wire frame count exceeds the fixed protocol bound.");
    }
    if (metadataLength === 0 ||
        metadataLength >
            FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_MAX_METADATA_BYTES ||
        FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_HEADER_BYTES +
            metadataLength >
            bytes.length) {
        fail("OFFLINE_PREVIEW_SANDBOX_WIRE_METADATA_LENGTH_INVALID", "Sandbox wire metadata length is zero, oversized, or truncated.");
    }
    return {
        kind: messageKindFromCode(bytes.readUInt8(9)),
        frameCount,
        metadataLength,
    };
}
function verifyMetadataDigest(wire, kind, metadata) {
    const expected = domainDigest(METADATA_DIGEST_DOMAIN, MESSAGE_KIND[kind], metadata.length, metadata);
    if (!wire
        .subarray(METADATA_DIGEST_OFFSET, METADATA_DIGEST_OFFSET + DIGEST_BYTES)
        .equals(expected)) {
        fail("OFFLINE_PREVIEW_SANDBOX_WIRE_METADATA_DIGEST_MISMATCH", "Sandbox wire metadata domain digest does not match its bytes.");
    }
}
function parseFrame(wire, cursor, seenKinds, sensitive) {
    const headerEnd = cursor +
        FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_FRAME_HEADER_BYTES;
    if (headerEnd > wire.length) {
        fail("OFFLINE_PREVIEW_SANDBOX_WIRE_FRAME_TRUNCATED", "Sandbox wire frame header is truncated.");
    }
    const kind = blobKindFromCode(wire.readUInt8(cursor));
    if (wire.readUInt8(cursor + 1) !== HEADER_FLAGS ||
        wire.readUInt16BE(cursor + 2) !== 0) {
        fail("OFFLINE_PREVIEW_SANDBOX_WIRE_FRAME_FLAGS_INVALID", "Sandbox wire frame contains unsupported flags or reserved data.");
    }
    if (seenKinds.has(kind)) {
        fail("OFFLINE_PREVIEW_SANDBOX_WIRE_DUPLICATE_FRAME", "Sandbox wire cannot contain duplicate blob frame kinds.");
    }
    seenKinds.add(kind);
    const length = wire.readUInt32BE(cursor + 4);
    const payloadEnd = headerEnd + length;
    if (length === 0 ||
        length > FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES ||
        payloadEnd > wire.length) {
        fail("OFFLINE_PREVIEW_SANDBOX_WIRE_FRAME_LENGTH_INVALID", "Sandbox wire frame is empty, oversized, or truncated.");
    }
    const bytes = Buffer.from(wire.subarray(headerEnd, payloadEnd));
    sensitive.push(bytes);
    const expected = domainDigest(FRAME_DIGEST_DOMAIN, BLOB_KIND[kind], length, bytes);
    if (!wire
        .subarray(cursor + 8, cursor + 8 + DIGEST_BYTES)
        .equals(expected)) {
        fail("OFFLINE_PREVIEW_SANDBOX_WIRE_FRAME_DOMAIN_DIGEST_MISMATCH", "Sandbox wire frame domain digest does not match its bytes.");
    }
    return {
        frame: { kind, bytes, digest: plainDigest(bytes) },
        nextCursor: payloadEnd,
    };
}
function parseFrames(wire, cursor, count, metadata, sensitive) {
    const expected = expectedFrames(metadata);
    if (count !== expected.length) {
        fail("OFFLINE_PREVIEW_SANDBOX_WIRE_FRAME_COUNT_MISMATCH", "Sandbox wire frame count does not match its exact message role.");
    }
    const frames = [];
    const seenKinds = new Set();
    let next = cursor;
    for (let index = 0; index < count; index += 1) {
        const parsed = parseFrame(wire, next, seenKinds, sensitive);
        const binding = expectedBinding(metadata, index);
        if (parsed.frame.kind !== expected[index] ||
            binding === undefined ||
            binding.kind !== parsed.frame.kind ||
            binding.sizeBytes !== parsed.frame.bytes.length ||
            binding.sha256 !== parsed.frame.digest) {
            fail("OFFLINE_PREVIEW_SANDBOX_WIRE_FRAME_BINDING_MISMATCH", "Sandbox wire frame order, length, or SHA-256 does not match metadata.");
        }
        frames.push(parsed.frame);
        next = parsed.nextCursor;
    }
    if (next !== wire.length) {
        fail("OFFLINE_PREVIEW_SANDBOX_WIRE_TRAILING_BYTES", "Sandbox wire message contains trailing or unframed bytes.");
    }
    return frames;
}
function assembleDecodedMessage(kind, metadata, frames) {
    const frame = (index) => {
        const value = frames[index];
        if (value === undefined) {
            fail("OFFLINE_PREVIEW_SANDBOX_WIRE_FRAME_COUNT_MISMATCH", "Sandbox wire decoded message is missing its required blob frame.");
        }
        return value;
    };
    switch (kind) {
        case "transform_request":
            return {
                kind,
                metadata: metadata,
                sourceBytes: frame(0).bytes,
            };
        case "fresh_verifier_request":
            return {
                kind,
                metadata: metadata,
                sourceBytes: frame(0).bytes,
                candidateBytes: frame(1).bytes,
            };
        case "transform_success":
            return {
                kind,
                metadata: metadata,
                outputBytes: frame(0).bytes,
            };
        case "fresh_verifier_success":
            return {
                kind,
                metadata: metadata,
            };
        case "failure":
            return { kind, metadata: metadata };
    }
}
function snapshotWireBytes(input) {
    if (!(input instanceof Uint8Array)) {
        fail("OFFLINE_PREVIEW_SANDBOX_WIRE_BYTES_INVALID", "Sandbox wire input must be a Uint8Array.");
    }
    if (!Number.isSafeInteger(input.byteLength) ||
        input.byteLength >
            FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_MAX_BYTES) {
        fail("OFFLINE_PREVIEW_SANDBOX_WIRE_MESSAGE_OVERSIZED", "Sandbox wire message exceeds its immutable total byte budget.");
    }
    try {
        return Buffer.from(input);
    }
    catch (error) {
        fail("OFFLINE_PREVIEW_SANDBOX_WIRE_SNAPSHOT_FAILED", "Sandbox wire bytes could not be copied into a stable snapshot.", error);
    }
}
/**
 * Decodes and authenticates the transport framing and exact byte bindings.
 * The result establishes no trust root, permit authority, sandbox, or right to
 * execute. Callers retain ownership of the returned blob buffers and should
 * erase candidate/output bytes when their lifecycle ends.
 */
export function decodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage(input) {
    const wire = snapshotWireBytes(input);
    const sensitive = [];
    let completed = false;
    try {
        const header = assertHeader(wire);
        const metadataStart = FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_HEADER_BYTES;
        const metadataEnd = metadataStart + header.metadataLength;
        const metadataBytes = wire.subarray(metadataStart, metadataEnd);
        verifyMetadataDigest(wire, header.kind, metadataBytes);
        const metadata = parseMetadata(header.kind, metadataBytes);
        validateMetadataBindings(metadata);
        const frames = parseFrames(wire, metadataEnd, header.frameCount, metadata, sensitive);
        const message = assembleDecodedMessage(header.kind, metadata, frames);
        completed = true;
        return message;
    }
    finally {
        wire.fill(0);
        if (!completed) {
            for (const bytes of sensitive)
                bytes.fill(0);
        }
    }
}
//# sourceMappingURL=offline-normalize-mesh-glb-preview-sandbox-wire.js.map