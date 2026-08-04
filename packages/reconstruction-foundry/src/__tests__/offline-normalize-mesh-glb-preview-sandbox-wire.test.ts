import {
  createHash,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";
import {
  stableCanonicalJson,
  toCanonicalJson,
} from "../canonical-json.js";
import { dssePreAuthenticationEncoding } from "../dsse.js";
import { FoundryIntegrityError } from "../errors.js";
import { sha256Bytes } from "../hash.js";
import {
  FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_EXECUTION_BOUNDARY_V0,
  FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_EXECUTION_MODE,
  FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_INVOCATION_V0,
  FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_OPERATOR_ACKNOWLEDGEMENT_STATEMENT,
  FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_OPERATOR_ACKNOWLEDGEMENT_V0,
  FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_OUTPUT_POLICY_V0,
  FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_PAYLOAD_TYPE,
  FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_V0,
  FoundryOfflineNormalizeMeshGlbPreviewInvocationV0Schema,
  FoundryOfflineNormalizeMeshGlbPreviewOperatorAcknowledgementV0Schema,
  FoundryOfflineNormalizeMeshGlbPreviewPermitV0Schema,
  computeFoundryOfflineNormalizeMeshGlbPreviewOperatorAcknowledgementSha256,
  computeFoundryOfflineNormalizeMeshGlbPreviewReportSha256,
  runFoundryOfflineNormalizeMeshGlbPreview,
  serializeFoundryOfflineNormalizeMeshGlbPreviewPermitV0,
  type FoundryOfflineNormalizeMeshGlbPreviewInvocationV0,
  type FoundryOfflineNormalizeMeshGlbPreviewReportV0,
} from "../offline-normalize-mesh-glb-preview.js";
import {
  FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_FRAME_HEADER_BYTES,
  FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_HEADER_BYTES,
  FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_MAX_BYTES,
  FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_MAX_METADATA_BYTES,
  decodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage,
  encodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage,
} from "../offline-normalize-mesh-glb-preview-sandbox-wire.js";
import {
  FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES,
  FOUNDRY_NORMALIZE_MESH_GLB_OPERATION,
  FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_VERSION,
  FOUNDRY_NORMALIZE_MESH_GLB_SEALED_IDENTITY,
} from "../normalize-mesh-glb-worker.js";
import { glbFixture } from "./fixture.js";
import { beforeAll, describe, expect, it, vi } from "vitest";

const KEY_ID = "sandbox-wire-test-key";
const REQUEST_ID = "sandbox-request-01";
const DEADLINE = "2026-07-17T10:09:00.000Z";
const METADATA_DIGEST_DOMAIN =
  "OMNITWIN_FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_METADATA_V0";

interface WireFixture {
  readonly source: Buffer;
  readonly candidate: Buffer;
  readonly invocation: FoundryOfflineNormalizeMeshGlbPreviewInvocationV0;
  readonly report: FoundryOfflineNormalizeMeshGlbPreviewReportV0;
  readonly envelope: {
    readonly payloadType: string;
    readonly payload: string;
    readonly signatures: readonly [{ readonly keyid: string; readonly sig: string }];
  };
  readonly permitPublicKey: {
    readonly keyId: string;
    readonly spkiDerBase64: string;
  };
}

function sourceBinding(bytes: Uint8Array) {
  return {
    assetId: "sandbox-wire-source",
    inputType: "glb_gltf" as const,
    mediaType: "model/gltf-binary" as const,
    sizeBytes: bytes.byteLength,
    sha256: `sha256:${sha256Bytes(bytes)}`,
  };
}

function signedEnvelope(payload: Buffer, privateKey: KeyObject) {
  return {
    payloadType: FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_PAYLOAD_TYPE,
    payload: payload.toString("base64"),
    signatures: [
      {
        keyid: KEY_ID,
        sig: sign(
          null,
          dssePreAuthenticationEncoding(
            FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_PAYLOAD_TYPE,
            payload,
          ),
          privateKey,
        ).toString("base64"),
      },
    ] as const,
  };
}

function acknowledgement(source: Buffer) {
  const binding = sourceBinding(source);
  const payload = {
    schemaVersion:
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_OPERATOR_ACKNOWLEDGEMENT_V0,
    acknowledgementId: "sandbox-wire-ack",
    operatorId: "sandbox-wire-operator",
    recordedAt: "2026-07-17T10:00:00.000Z",
    acknowledgement: "operator_records_private_offline_preview_intent" as const,
    statement:
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_OPERATOR_ACKNOWLEDGEMENT_STATEMENT,
    legalPosture:
      "operator_statement_not_independent_rights_approval" as const,
    authorizationPosture: "operator_statement_recorded_not_a_permit" as const,
    independentRightsApprovalEstablished: false as const,
    operatorStatementEstablishesExecutionPermit: false as const,
    source: {
      assetId: binding.assetId,
      sizeBytes: binding.sizeBytes,
      sha256: binding.sha256,
    },
    operation: {
      operation: FOUNDRY_NORMALIZE_MESH_GLB_OPERATION,
      operationVersion: FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_VERSION,
      sealedIdentity: [...FOUNDRY_NORMALIZE_MESH_GLB_SEALED_IDENTITY],
    },
    authority: "none" as const,
  };
  return FoundryOfflineNormalizeMeshGlbPreviewOperatorAcknowledgementV0Schema.parse({
    ...payload,
    acknowledgementSha256:
      computeFoundryOfflineNormalizeMeshGlbPreviewOperatorAcknowledgementSha256(
        payload,
      ),
  });
}

async function createWireFixture(): Promise<WireFixture> {
  const source = glbFixture();
  const keys = generateKeyPairSync("ed25519");
  const permit = FoundryOfflineNormalizeMeshGlbPreviewPermitV0Schema.parse({
    schemaVersion: FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_V0,
    permitId: "sandbox-wire-permit",
    issuerKeyId: KEY_ID,
    validFrom: "2026-07-17T10:00:00.000Z",
    expiresAt: "2026-07-17T10:10:00.000Z",
    purpose: "private_offline_format_normalization_preview",
    actions: ["normalize_mesh_glb_to_private_preview_bytes"],
    source: sourceBinding(source),
    operation: {
      operation: FOUNDRY_NORMALIZE_MESH_GLB_OPERATION,
      operationVersion: FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_VERSION,
      sealedIdentity: [...FOUNDRY_NORMALIZE_MESH_GLB_SEALED_IDENTITY],
    },
    outputPolicy: structuredClone(
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_OUTPUT_POLICY_V0,
    ),
    executionBoundary: structuredClone(
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_EXECUTION_BOUNDARY_V0,
    ),
    permitScope: "trusted_process_side_offline_preview_only",
    outputAuthority: "none",
  });
  const payload = serializeFoundryOfflineNormalizeMeshGlbPreviewPermitV0(permit);
  const envelope = signedEnvelope(payload, keys.privateKey);
  const operatorAcknowledgement = acknowledgement(source);
  const invocation = FoundryOfflineNormalizeMeshGlbPreviewInvocationV0Schema.parse({
    schemaVersion: FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_INVOCATION_V0,
    operation: FOUNDRY_NORMALIZE_MESH_GLB_OPERATION,
    operationVersion: FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_VERSION,
    sealedIdentity: [...FOUNDRY_NORMALIZE_MESH_GLB_SEALED_IDENTITY],
    executionMode: FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_EXECUTION_MODE,
    source: sourceBinding(source),
    permit: {
      payloadSha256: `sha256:${sha256Bytes(payload)}`,
      keyId: KEY_ID,
      expiresAt: permit.expiresAt,
    },
    operatorAcknowledgement,
    operatorAcknowledgementSha256:
      operatorAcknowledgement.acknowledgementSha256,
    outputPolicy: structuredClone(
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_OUTPUT_POLICY_V0,
    ),
    executionBoundary: structuredClone(
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_EXECUTION_BOUNDARY_V0,
    ),
    authority: "none",
  });
  const exported = keys.publicKey.export({ format: "der", type: "spki" });
  if (!Buffer.isBuffer(exported)) throw new Error("Ed25519 SPKI fixture was not bytes.");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime("2026-07-17T10:05:00.000Z");
  try {
    const result = await runFoundryOfflineNormalizeMeshGlbPreview({
      invocation,
      sourceBytes: source,
      permitEnvelope: envelope,
      pinnedTrustedPermitKeys: new Map([[KEY_ID, keys.publicKey]]),
    });
    return {
      source,
      candidate: result.normalizedGlb,
      invocation,
      report: result.report,
      envelope,
      permitPublicKey: {
        keyId: KEY_ID,
        spkiDerBase64: exported.toString("base64"),
      },
    };
  } finally {
    vi.useRealTimers();
  }
}

function metadataRange(wire: Buffer): { readonly start: number; readonly end: number } {
  const start = FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_HEADER_BYTES;
  return { start, end: start + wire.readUInt32BE(12) };
}

function metadataObject(wire: Buffer): Record<string, unknown> {
  const range = metadataRange(wire);
  const parsed: unknown = JSON.parse(wire.subarray(range.start, range.end).toString("utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Wire fixture metadata is not an object.");
  }
  return parsed as Record<string, unknown>;
}

function metadataDigest(kind: number, bytes: Buffer): Buffer {
  const prefix = Buffer.alloc(5);
  prefix.writeUInt8(kind, 0);
  prefix.writeUInt32BE(bytes.length, 1);
  return createHash("sha256")
    .update(METADATA_DIGEST_DOMAIN, "ascii")
    .update(Buffer.from([0]))
    .update(prefix)
    .update(bytes)
    .digest();
}

function replaceMetadata(wire: Buffer, metadata: Buffer): Buffer {
  const range = metadataRange(wire);
  const header = Buffer.from(
    wire.subarray(
      0,
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_HEADER_BYTES,
    ),
  );
  header.writeUInt32BE(metadata.length, 12);
  metadataDigest(header.readUInt8(9), metadata).copy(header, 16);
  return Buffer.concat([header, metadata, wire.subarray(range.end)]);
}

function replaceCanonicalMetadata(
  wire: Buffer,
  mutate: (metadata: Record<string, unknown>) => void,
): Buffer {
  const metadata = metadataObject(wire);
  mutate(metadata);
  return replaceMetadata(
    wire,
    Buffer.from(stableCanonicalJson(toCanonicalJson(metadata)), "utf8"),
  );
}

function transformRequest(fixture: WireFixture): Buffer {
  return encodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage({
    kind: "transform_request",
    requestId: REQUEST_ID,
    deadlineAt: DEADLINE,
    invocation: fixture.invocation,
    permitEnvelope: fixture.envelope,
    permitPublicKey: fixture.permitPublicKey,
    sourceBytes: fixture.source,
  });
}

function verifierRequest(fixture: WireFixture): Buffer {
  return encodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage({
    kind: "fresh_verifier_request",
    requestId: REQUEST_ID,
    deadlineAt: DEADLINE,
    invocation: fixture.invocation,
    permitEnvelope: fixture.envelope,
    permitPublicKey: fixture.permitPublicKey,
    report: fixture.report,
    sourceBytes: fixture.source,
    candidateBytes: fixture.candidate,
  });
}

function expectWireError(bytes: Uint8Array, code: string): void {
  try {
    decodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage(bytes);
    throw new Error("Expected sandbox wire decoding to fail.");
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(FoundryIntegrityError);
    expect((error as FoundryIntegrityError).code).toBe(code);
  }
}

describe.sequential("offline preview isolated-worker sandbox wire", () => {
  let fixture: WireFixture;

  beforeAll(async () => {
    fixture = await createWireFixture();
  });

  it("round-trips a transform request with frozen exact metadata and copied source bytes", () => {
    const wire = transformRequest(fixture);
    const decoded = decodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage(wire);
    expect(decoded.kind).toBe("transform_request");
    if (decoded.kind !== "transform_request") throw new Error("Unexpected decoded role.");
    expect(decoded.sourceBytes).toEqual(fixture.source);
    expect(decoded.sourceBytes).not.toBe(fixture.source);
    expect(decoded.metadata).toMatchObject({
      messageType: "request",
      role: "transform",
      requestId: REQUEST_ID,
      deadlineAt: DEADLINE,
      blobs: [{
        kind: "source",
        sizeBytes: fixture.source.length,
        sha256: `sha256:${sha256Bytes(fixture.source)}`,
      }],
    });
    expect(Object.isFrozen(decoded.metadata)).toBe(true);
    expect(Object.isFrozen(decoded.metadata.invocation)).toBe(true);
  });

  it("round-trips fresh verification without ever echoing candidate bytes in success", () => {
    const decoded = decodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage(
      verifierRequest(fixture),
    );
    expect(decoded.kind).toBe("fresh_verifier_request");
    if (decoded.kind !== "fresh_verifier_request") throw new Error("Unexpected decoded role.");
    expect(decoded.sourceBytes).toEqual(fixture.source);
    expect(decoded.candidateBytes).toEqual(fixture.candidate);
    expect(decoded.metadata.report).toEqual(fixture.report);

    const success = decodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage(
      encodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage({
        kind: "fresh_verifier_success",
        requestId: REQUEST_ID,
      }),
    );
    expect(success).toEqual({
      kind: "fresh_verifier_success",
      metadata: {
        schemaVersion:
          "omnitwin.foundry.offline-normalize-mesh-glb-preview-sandbox-wire.v0",
        messageType: "success",
        role: "fresh_verifier",
        requestId: REQUEST_ID,
        blobs: [],
      },
    });
    expect(JSON.stringify(success)).not.toContain(fixture.candidate.toString("base64"));
  });

  it("round-trips transform success and code-only failure responses", () => {
    const success = decodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage(
      encodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage({
        kind: "transform_success",
        requestId: REQUEST_ID,
        report: fixture.report,
        outputBytes: fixture.candidate,
      }),
    );
    expect(success.kind).toBe("transform_success");
    if (success.kind !== "transform_success") throw new Error("Unexpected decoded role.");
    expect(success.outputBytes).toEqual(fixture.candidate);
    expect(success.metadata.report).toEqual(fixture.report);

    const failure = decodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage(
      encodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage({
        kind: "failure",
        role: "transform",
        requestId: REQUEST_ID,
        failure: { code: "TRANSFORM_FAILED" },
      }),
    );
    expect(failure).toMatchObject({
      kind: "failure",
      metadata: {
        messageType: "failure",
        role: "transform",
        failure: { code: "TRANSFORM_FAILED" },
        blobs: [],
      },
    });
    if (failure.kind !== "failure") throw new Error("Unexpected decoded role.");
    expect(Object.keys(failure.metadata.failure)).toEqual(["code"]);
  });

  it("rejects wrong magic, version, message kind, flags, and frame count", () => {
    const wire = transformRequest(fixture);
    const wrongMagic = Buffer.from(wire);
    wrongMagic[0] = (wrongMagic[0] ?? 0) ^ 0xff;
    expectWireError(wrongMagic, "OFFLINE_PREVIEW_SANDBOX_WIRE_MAGIC_INVALID");
    const wrongVersion = Buffer.from(wire);
    wrongVersion[8] = 2;
    expectWireError(wrongVersion, "OFFLINE_PREVIEW_SANDBOX_WIRE_VERSION_INVALID");
    const wrongKind = Buffer.from(wire);
    wrongKind[9] = 99;
    expectWireError(wrongKind, "OFFLINE_PREVIEW_SANDBOX_WIRE_MESSAGE_KIND_INVALID");
    const wrongFlags = Buffer.from(wire);
    wrongFlags[11] = 1;
    expectWireError(wrongFlags, "OFFLINE_PREVIEW_SANDBOX_WIRE_HEADER_FLAGS_INVALID");
    const tooManyFrames = Buffer.from(wire);
    tooManyFrames[10] = 3;
    expectWireError(tooManyFrames, "OFFLINE_PREVIEW_SANDBOX_WIRE_FRAME_COUNT_INVALID");
  });

  it("rejects truncated, oversized, and trailing wire data before ambiguity", () => {
    const wire = transformRequest(fixture);
    expectWireError(
      wire.subarray(0, FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_HEADER_BYTES - 1),
      "OFFLINE_PREVIEW_SANDBOX_WIRE_TRUNCATED",
    );
    const metadataTooLarge = Buffer.from(wire);
    metadataTooLarge.writeUInt32BE(
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_MAX_METADATA_BYTES + 1,
      12,
    );
    expectWireError(
      metadataTooLarge,
      "OFFLINE_PREVIEW_SANDBOX_WIRE_METADATA_LENGTH_INVALID",
    );
    expectWireError(
      Buffer.concat([wire, Buffer.from([0])]),
      "OFFLINE_PREVIEW_SANDBOX_WIRE_TRAILING_BYTES",
    );
  });

  it("rejects altered metadata and every noncanonical JSON spelling", () => {
    const wire = transformRequest(fixture);
    const altered = Buffer.from(wire);
    altered[FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_HEADER_BYTES] =
      (altered[FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_HEADER_BYTES] ?? 0) ^ 1;
    expectWireError(
      altered,
      "OFFLINE_PREVIEW_SANDBOX_WIRE_METADATA_DIGEST_MISMATCH",
    );

    const raw = metadataObject(wire);
    const pretty = replaceMetadata(
      wire,
      Buffer.from(JSON.stringify(raw, null, 2), "utf8"),
    );
    expectWireError(pretty, "OFFLINE_PREVIEW_SANDBOX_WIRE_METADATA_NOT_CANONICAL");

    const duplicateRole = replaceMetadata(
      wire,
      Buffer.from(
        wire
          .subarray(metadataRange(wire).start, metadataRange(wire).end)
          .toString("utf8")
          .replace("{", "{\"role\":\"transform\","),
        "utf8",
      ),
    );
    expectWireError(
      duplicateRole,
      "OFFLINE_PREVIEW_SANDBOX_WIRE_METADATA_NOT_CANONICAL",
    );
  });

  it("rejects extra keys, wrong roles, unsafe IDs, and unsafe deadlines", () => {
    const wire = transformRequest(fixture);
    expectWireError(
      replaceCanonicalMetadata(wire, (metadata) => {
        metadata.command = "powershell.exe";
      }),
      "OFFLINE_PREVIEW_SANDBOX_WIRE_METADATA_SHAPE_INVALID",
    );
    expectWireError(
      replaceCanonicalMetadata(wire, (metadata) => {
        metadata.role = "fresh_verifier";
      }),
      "OFFLINE_PREVIEW_SANDBOX_WIRE_METADATA_SHAPE_INVALID",
    );
    expect(() =>
      encodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage({
        kind: "transform_request",
        requestId: "../unsafe request",
        deadlineAt: DEADLINE,
        invocation: fixture.invocation,
        permitEnvelope: fixture.envelope,
        permitPublicKey: fixture.permitPublicKey,
        sourceBytes: fixture.source,
      }),
    ).toThrow();
    expect(() =>
      encodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage({
        kind: "transform_request",
        requestId: REQUEST_ID,
        deadlineAt: "2026-07-17 10:09:00Z",
        invocation: fixture.invocation,
        permitEnvelope: fixture.envelope,
        permitPublicKey: fixture.permitPublicKey,
        sourceBytes: fixture.source,
      }),
    ).toThrow();
    expect(() =>
      encodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage({
        kind: "transform_request",
        requestId: REQUEST_ID,
        deadlineAt: "2026-07-17T10:11:00.000Z",
        invocation: fixture.invocation,
        permitEnvelope: fixture.envelope,
        permitPublicKey: fixture.permitPublicKey,
        sourceBytes: fixture.source,
      }),
    ).toThrowError(/deadline/u);
  });

  it("rejects noncanonical, non-Ed25519, unbound, and extra public keys", () => {
    const canonical = fixture.permitPublicKey.spkiDerBase64;
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const padIndex = canonical.length - 2;
    const alphabetIndex = alphabet.indexOf(canonical[padIndex] ?? "");
    if (alphabetIndex < 0) throw new Error("SPKI fixture base64 is unavailable.");
    const noncanonicalPad = alphabet[alphabetIndex | 1];
    if (noncanonicalPad === undefined) throw new Error("SPKI pad-bit fixture is unavailable.");
    const noncanonical = `${canonical.slice(0, padIndex)}${noncanonicalPad}=`;
    for (const permitPublicKey of [
      { keyId: KEY_ID, spkiDerBase64: noncanonical },
      { keyId: KEY_ID, spkiDerBase64: Buffer.alloc(44).toString("base64") },
      { keyId: "different-key", spkiDerBase64: canonical },
      { ...fixture.permitPublicKey, path: "C:/secret" },
    ]) {
      expect(() =>
        encodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage({
          kind: "transform_request",
          requestId: REQUEST_ID,
          deadlineAt: DEADLINE,
          invocation: fixture.invocation,
          permitEnvelope: fixture.envelope,
          permitPublicKey,
          sourceBytes: fixture.source,
        }),
      ).toThrow();
    }
  });

  it("rejects altered, truncated, oversized, duplicate, and metadata-mismatched frames", () => {
    const wire = verifierRequest(fixture);
    const firstFrame = metadataRange(wire).end;
    const firstLength = wire.readUInt32BE(firstFrame + 4);
    const secondFrame =
      firstFrame +
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_FRAME_HEADER_BYTES +
      firstLength;

    const alteredCandidate = Buffer.from(wire);
    const candidateOffset =
      secondFrame +
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_FRAME_HEADER_BYTES;
    alteredCandidate[candidateOffset] =
      (alteredCandidate[candidateOffset] ?? 0) ^ 1;
    expectWireError(
      alteredCandidate,
      "OFFLINE_PREVIEW_SANDBOX_WIRE_FRAME_DOMAIN_DIGEST_MISMATCH",
    );
    expectWireError(
      wire.subarray(0, wire.length - 1),
      "OFFLINE_PREVIEW_SANDBOX_WIRE_FRAME_LENGTH_INVALID",
    );
    const oversizedFrame = Buffer.from(wire);
    oversizedFrame.writeUInt32BE(FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES + 1, firstFrame + 4);
    expectWireError(
      oversizedFrame,
      "OFFLINE_PREVIEW_SANDBOX_WIRE_FRAME_LENGTH_INVALID",
    );
    const duplicate = Buffer.from(wire);
    duplicate[secondFrame] = 1;
    expectWireError(duplicate, "OFFLINE_PREVIEW_SANDBOX_WIRE_DUPLICATE_FRAME");
    const mismatched = replaceCanonicalMetadata(wire, (metadata) => {
      const blobs = metadata.blobs;
      if (!Array.isArray(blobs) || typeof blobs[1] !== "object" || blobs[1] === null) {
        throw new Error("Candidate binding fixture is unavailable.");
      }
      (blobs[1] as Record<string, unknown>).sha256 = `sha256:${"0".repeat(64)}`;
    });
    expectWireError(
      mismatched,
      "OFFLINE_PREVIEW_SANDBOX_WIRE_VERIFIER_BINDING_MISMATCH",
    );
  });

  it("pins the exact 64 MiB per-blob cap and exported total-reader bound", () => {
    expect(FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES).toBe(64 * 1024 * 1024);
    expect(
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_MAX_BYTES,
    ).toBe(
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_HEADER_BYTES +
        FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_MAX_METADATA_BYTES +
        2 *
          (FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_FRAME_HEADER_BYTES +
            FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES),
    );
    const exact = Buffer.alloc(FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES, 0x5a);
    const { reportSha256: _reportSha256, ...basePayload } =
      structuredClone(fixture.report);
    const exactPayload = {
      ...basePayload,
      output: {
        ...basePayload.output,
        sizeBytes: exact.length,
        sha256: `sha256:${sha256Bytes(exact)}`,
      },
    };
    const exactWire = encodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage({
      kind: "transform_success",
      requestId: REQUEST_ID,
      report: {
        ...exactPayload,
        reportSha256:
          computeFoundryOfflineNormalizeMeshGlbPreviewReportSha256(exactPayload),
      },
      outputBytes: exact,
    });
    expect(exactWire.length).toBeLessThanOrEqual(
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_MAX_BYTES,
    );
    exactWire.fill(0);
    exact.fill(0);

    const tooLarge = Buffer.alloc(FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES + 1);
    expect(() =>
      encodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage({
        kind: "transform_request",
        requestId: REQUEST_ID,
        deadlineAt: DEADLINE,
        invocation: fixture.invocation,
        permitEnvelope: fixture.envelope,
        permitPublicKey: fixture.permitPublicKey,
        sourceBytes: tooLarge,
      }),
    ).toThrowError(/1-67108864 bytes/u);
  });
});
