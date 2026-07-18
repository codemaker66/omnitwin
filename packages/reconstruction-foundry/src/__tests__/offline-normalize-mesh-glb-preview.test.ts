import {
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  stableCanonicalJson,
  toCanonicalJson,
} from "../canonical-json.js";
import {
  runFoundryDerivativeNormalizationOutputBundle,
  type RunFoundryDerivativeNormalizationOutputBundleOptions,
} from "../derivative-normalization-output-bundle.js";
import { dssePreAuthenticationEncoding } from "../dsse.js";
import { sha256Bytes } from "../hash.js";
import {
  FOUNDRY_NORMALIZE_MESH_GLB_INVOCATION_V0,
  FOUNDRY_NORMALIZE_MESH_GLB_OPERATION,
  FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_VERSION,
  FOUNDRY_NORMALIZE_MESH_GLB_SEALED_IDENTITY,
  FoundryNormalizeMeshGlbInvocationV0Schema,
  __testOnlyNormalizeMeshGlbBytes,
  computeFoundryNormalizeMeshGlbInvocationSha256,
  runFoundryNormalizeMeshGlbWorker,
  type FoundryNormalizeMeshGlbInvocationV0,
  type RunFoundryNormalizeMeshGlbWorkerOptions,
} from "../normalize-mesh-glb-worker.js";
import {
  FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_EXECUTION_BOUNDARY_V0,
  FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_EXECUTION_MODE,
  FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_INVOCATION_V0,
  FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_MAX_PERMIT_PAYLOAD_BYTES,
  FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_OPERATOR_ACKNOWLEDGEMENT_STATEMENT,
  FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_OPERATOR_ACKNOWLEDGEMENT_V0,
  FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_OUTPUT_POLICY_V0,
  FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_PAYLOAD_TYPE,
  FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_V0,
  FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_REPORT_V0,
  FoundryOfflineNormalizeMeshGlbPreviewInvocationV0Schema,
  FoundryOfflineNormalizeMeshGlbPreviewOperatorAcknowledgementV0Schema,
  FoundryOfflineNormalizeMeshGlbPreviewPermitV0Schema,
  FoundryOfflineNormalizeMeshGlbPreviewReportV0Schema,
  computeFoundryOfflineNormalizeMeshGlbPreviewInvocationSha256,
  computeFoundryOfflineNormalizeMeshGlbPreviewOperatorAcknowledgementSha256,
  computeFoundryOfflineNormalizeMeshGlbPreviewReportSha256,
  runFoundryOfflineNormalizeMeshGlbPreview,
  serializeFoundryOfflineNormalizeMeshGlbPreviewPermitV0,
  verifyFoundryOfflineNormalizeMeshGlbPreview,
  verifyFoundryOfflineNormalizeMeshGlbPreviewPermit,
  type FoundryOfflineNormalizeMeshGlbPreviewInvocationV0,
  type FoundryOfflineNormalizeMeshGlbPreviewOperatorAcknowledgementV0,
  type FoundryOfflineNormalizeMeshGlbPreviewPermitV0,
  type FoundryOfflineNormalizeMeshGlbPreviewReportV0,
} from "../offline-normalize-mesh-glb-preview.js";
import { glbFixture } from "./fixture.js";
import { describe, expect, it, vi } from "vitest";

const SIGNING_KEY_ID = "offline-preview-test-key";

interface SignedPermitFixture {
  readonly permit: FoundryOfflineNormalizeMeshGlbPreviewPermitV0;
  readonly envelope: {
    readonly payloadType: string;
    readonly payload: string;
    readonly signatures: readonly [{ readonly keyid: string; readonly sig: string }];
  };
  readonly trustedKeys: ReadonlyMap<string, KeyObject>;
}

function sourceBinding(bytes: Uint8Array) {
  return {
    assetId: "fixture-mesh",
    inputType: "glb_gltf" as const,
    mediaType: "model/gltf-binary" as const,
    sizeBytes: bytes.byteLength,
    sha256: `sha256:${sha256Bytes(bytes)}`,
  };
}

function signPayload(
  payloadBytes: Buffer,
  privateKey: KeyObject,
  keyId = SIGNING_KEY_ID,
) {
  return {
    payloadType: FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_PAYLOAD_TYPE,
    payload: payloadBytes.toString("base64"),
    signatures: [
      {
        keyid: keyId,
        sig: sign(
          null,
          dssePreAuthenticationEncoding(
            FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_PAYLOAD_TYPE,
            payloadBytes,
          ),
          privateKey,
        ).toString("base64"),
      },
    ] as const,
  };
}

function signedPermit(
  bytes: Uint8Array,
  overrides: {
    readonly issuerKeyId?: string;
    readonly validFrom?: string;
    readonly expiresAt?: string;
    readonly sourceSha256?: string;
  } = {},
): SignedPermitFixture {
  const keys = generateKeyPairSync("ed25519");
  const source = sourceBinding(bytes);
  const permit = FoundryOfflineNormalizeMeshGlbPreviewPermitV0Schema.parse({
    schemaVersion: FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_V0,
    permitId: "offline-preview-fixture-permit",
    issuerKeyId: overrides.issuerKeyId ?? SIGNING_KEY_ID,
    validFrom: overrides.validFrom ?? "2026-07-17T09:55:00.000Z",
    expiresAt: overrides.expiresAt ?? "2026-07-17T10:05:00.000Z",
    purpose: "private_offline_format_normalization_preview",
    actions: ["normalize_mesh_glb_to_private_preview_bytes"],
    source: {
      ...source,
      sha256: overrides.sourceSha256 ?? source.sha256,
    },
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
  const payloadBytes =
    serializeFoundryOfflineNormalizeMeshGlbPreviewPermitV0(permit);
  return {
    permit,
    envelope: signPayload(payloadBytes, keys.privateKey),
    trustedKeys: new Map([[SIGNING_KEY_ID, keys.publicKey]]),
  };
}

function signedRawPermit(
  permit: FoundryOfflineNormalizeMeshGlbPreviewPermitV0,
  payloadBytes: Buffer,
  keyId = SIGNING_KEY_ID,
): {
  readonly fixture: SignedPermitFixture;
  readonly binding: {
    readonly payloadSha256: string;
    readonly keyId: string;
    readonly expiresAt: string;
  };
} {
  const keys = generateKeyPairSync("ed25519");
  return {
    fixture: {
      permit,
      envelope: signPayload(payloadBytes, keys.privateKey, keyId),
      trustedKeys: new Map([[keyId, keys.publicKey]]),
    },
    binding: {
      payloadSha256: `sha256:${sha256Bytes(payloadBytes)}`,
      keyId,
      expiresAt: permit.expiresAt,
    },
  };
}

function acknowledgement(
  bytes: Uint8Array,
  overrides: {
    readonly acknowledgementId?: string;
    readonly sourceSha256?: string;
  } = {},
): FoundryOfflineNormalizeMeshGlbPreviewOperatorAcknowledgementV0 {
  const source = sourceBinding(bytes);
  const payload: Omit<
    FoundryOfflineNormalizeMeshGlbPreviewOperatorAcknowledgementV0,
    "acknowledgementSha256"
  > = {
    schemaVersion:
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_OPERATOR_ACKNOWLEDGEMENT_V0,
    acknowledgementId:
      overrides.acknowledgementId ?? "offline-preview-fixture-ack",
    operatorId: "fixture-operator",
    recordedAt: "2026-07-17T10:00:00.000Z",
    acknowledgement: "operator_records_private_offline_preview_intent",
    statement:
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_OPERATOR_ACKNOWLEDGEMENT_STATEMENT,
    legalPosture: "operator_statement_not_independent_rights_approval",
    authorizationPosture: "operator_statement_recorded_not_a_permit",
    independentRightsApprovalEstablished: false,
    operatorStatementEstablishesExecutionPermit: false,
    source: {
      assetId: source.assetId,
      sizeBytes: source.sizeBytes,
      sha256: overrides.sourceSha256 ?? source.sha256,
    },
    operation: {
      operation: FOUNDRY_NORMALIZE_MESH_GLB_OPERATION,
      operationVersion: FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_VERSION,
      sealedIdentity: [...FOUNDRY_NORMALIZE_MESH_GLB_SEALED_IDENTITY],
    },
    authority: "none",
  };
  return FoundryOfflineNormalizeMeshGlbPreviewOperatorAcknowledgementV0Schema.parse(
    {
      ...payload,
      acknowledgementSha256:
        computeFoundryOfflineNormalizeMeshGlbPreviewOperatorAcknowledgementSha256(
          payload,
        ),
    },
  );
}

function permitBinding(fixture: SignedPermitFixture) {
  const payloadBytes = Buffer.from(fixture.envelope.payload, "base64");
  return {
    payloadSha256: `sha256:${sha256Bytes(payloadBytes)}`,
    keyId: SIGNING_KEY_ID,
    expiresAt: fixture.permit.expiresAt,
  };
}

function previewInvocation(
  bytes: Uint8Array,
  permit: SignedPermitFixture,
  operatorAcknowledgement = acknowledgement(bytes),
  binding = permitBinding(permit),
): FoundryOfflineNormalizeMeshGlbPreviewInvocationV0 {
  return FoundryOfflineNormalizeMeshGlbPreviewInvocationV0Schema.parse({
    schemaVersion: FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_INVOCATION_V0,
    operation: FOUNDRY_NORMALIZE_MESH_GLB_OPERATION,
    operationVersion: FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_VERSION,
    sealedIdentity: [...FOUNDRY_NORMALIZE_MESH_GLB_SEALED_IDENTITY],
    executionMode: FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_EXECUTION_MODE,
    source: sourceBinding(bytes),
    permit: binding,
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
}

function oldInvocation(bytes: Uint8Array): FoundryNormalizeMeshGlbInvocationV0 {
  return FoundryNormalizeMeshGlbInvocationV0Schema.parse({
    schemaVersion: FOUNDRY_NORMALIZE_MESH_GLB_INVOCATION_V0,
    operation: FOUNDRY_NORMALIZE_MESH_GLB_OPERATION,
    operationVersion: FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_VERSION,
    sealedIdentity: [...FOUNDRY_NORMALIZE_MESH_GLB_SEALED_IDENTITY],
    executionMode: "test_only_pure_core_proof",
    source: sourceBinding(bytes),
    authority: "none",
  });
}

function rewriteJson(
  bytes: Buffer,
  mutate: (json: Record<string, unknown>) => void,
  pretty = false,
): Buffer {
  const jsonLength = bytes.readUInt32LE(12);
  const binaryHeader = 20 + jsonLength;
  const binaryLength = bytes.readUInt32LE(binaryHeader);
  const binary = bytes.subarray(
    binaryHeader + 8,
    binaryHeader + 8 + binaryLength,
  );
  const json = JSON.parse(
    bytes
      .subarray(20, 20 + jsonLength)
      .toString("utf8")
      .replace(/ +$/u, ""),
  ) as Record<string, unknown>;
  mutate(json);
  const encoded = Buffer.from(
    JSON.stringify(json, null, pretty ? 2 : undefined),
    "utf8",
  );
  const padded = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 0x20);
  encoded.copy(padded);
  const output = Buffer.alloc(20 + padded.length + 8 + binary.length);
  output.writeUInt32LE(0x46546c67, 0);
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(padded.length, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(output, 20);
  const outputBinaryHeader = 20 + padded.length;
  output.writeUInt32LE(binary.length, outputBinaryHeader);
  output.writeUInt32LE(0x004e4942, outputBinaryHeader + 4);
  binary.copy(output, outputBinaryHeader + 8);
  return output;
}

function resignPreviewReport(
  report: FoundryOfflineNormalizeMeshGlbPreviewReportV0,
  mutate: (
    payload: Omit<
      FoundryOfflineNormalizeMeshGlbPreviewReportV0,
      "reportSha256"
    >,
  ) => void,
): FoundryOfflineNormalizeMeshGlbPreviewReportV0 {
  const clone = structuredClone(report);
  const { reportSha256: _reportSha256, ...payload } = clone;
  mutate(payload);
  return FoundryOfflineNormalizeMeshGlbPreviewReportV0Schema.parse({
    ...payload,
    reportSha256:
      computeFoundryOfflineNormalizeMeshGlbPreviewReportSha256(payload),
  });
}

function runOptions(
  source: Buffer,
  permit: SignedPermitFixture,
) {
  return {
    invocation: previewInvocation(source, permit),
    sourceBytes: source,
    permitEnvelope: permit.envelope,
    pinnedTrustedPermitKeys: permit.trustedKeys,
  };
}

describe.sequential("offline authority-none normalize_mesh_glb preview", () => {
  it("synchronously returns only the frozen controller permit DTO without reading source bytes or transforming", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime("2026-07-17T10:00:00.000Z");
    try {
      const unsupported = rewriteJson(glbFixture(), (json) => {
        json.materials = [{ pbrMetallicRoughness: {} }];
      });
      const permit = signedPermit(unsupported);
      const invocation = previewInvocation(unsupported, permit);
      let sourceBytesObserved = 0;
      const controllerInput = {
        invocation,
        permitEnvelope: permit.envelope,
        pinnedTrustedPermitKeys: permit.trustedKeys,
        get sourceBytes() {
          sourceBytesObserved += 1;
          return unsupported;
        },
      };

      const verified =
        verifyFoundryOfflineNormalizeMeshGlbPreviewPermit(controllerInput);
      expect(sourceBytesObserved).toBe(0);
      expect(Object.keys(verified).sort()).toEqual([
        "expiresAt",
        "invocation",
        "permitPayloadSha256",
        "validFrom",
      ]);
      expect(verified).toEqual({
        invocation,
        permitPayloadSha256: invocation.permit.payloadSha256,
        validFrom: permit.permit.validFrom,
        expiresAt: permit.permit.expiresAt,
      });
      expect(Object.isFrozen(verified)).toBe(true);
      expect(Object.isFrozen(verified.invocation)).toBe(true);
      expect(Object.isFrozen(verified.invocation.source)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("synchronously fails with exact codes for missing trust and expired permit evidence", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime("2026-07-17T10:00:00.000Z");
    try {
      const source = glbFixture();
      const active = signedPermit(source);
      const invocation = previewInvocation(source, active);
      let untrustedFailure: unknown;
      try {
        verifyFoundryOfflineNormalizeMeshGlbPreviewPermit({
          invocation,
          permitEnvelope: active.envelope,
          pinnedTrustedPermitKeys: new Map(),
        });
      } catch (error: unknown) {
        untrustedFailure = error;
      }
      expect(untrustedFailure).toMatchObject({
        code: "DSSE_SIGNATURE_INVALID",
      });

      const expired = signedPermit(source, {
        validFrom: "2026-07-17T09:40:00.000Z",
        expiresAt: "2026-07-17T09:50:00.000Z",
      });
      let expiredFailure: unknown;
      try {
        verifyFoundryOfflineNormalizeMeshGlbPreviewPermit({
          invocation: previewInvocation(source, expired),
          permitEnvelope: expired.envelope,
          pinnedTrustedPermitKeys: expired.trustedKeys,
        });
      } catch (error: unknown) {
        expiredFailure = error;
      }
      expect(expiredFailure).toMatchObject({
        code: "OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_EXPIRED",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("normalizes deterministically only after a trusted exact permit verifies", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime("2026-07-17T10:00:00.000Z");
    try {
      const source = glbFixture();
      const permit = signedPermit(source);
      const options = runOptions(source, permit);
      const first = await runFoundryOfflineNormalizeMeshGlbPreview(options);
      const second = await runFoundryOfflineNormalizeMeshGlbPreview(options);

      expect(second.normalizedGlb).toEqual(first.normalizedGlb);
      expect(second.report).toEqual(first.report);
      expect(first.report).toMatchObject({
        schemaVersion: FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_REPORT_V0,
        executionMode:
          FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_EXECUTION_MODE,
        permit: options.invocation.permit,
        operatorAcknowledgementSha256:
          options.invocation.operatorAcknowledgementSha256,
        outputPolicy: {
          disposition: "private_quarantine_only",
          trainingEligible: false,
          redistributionEligible: false,
          signingEligible: false,
          registrationEligible: false,
          publicationEligible: false,
          promotionEligible: false,
          measurementEligible: false,
        },
        executionBoundary: {
          primitiveKind: "pure_in_memory",
          sandboxEstablished: false,
          custodyEstablished: false,
          rightsAuthorizationEstablished: false,
          replayProtectionEstablished: false,
        },
        semanticProof: {
          exactMatch: true,
          accessorCount: 2,
          compressedBufferViewCount: 2,
        },
        authority: "none",
      });
      expect(first.report.semanticProof.beforeSha256).toBe(
        first.report.semanticProof.afterSha256,
      );
      expect(JSON.stringify(first.report)).not.toContain("test_only");
      expect(
        computeFoundryOfflineNormalizeMeshGlbPreviewInvocationSha256(
          options.invocation,
        ),
      ).not.toBe(
        computeFoundryNormalizeMeshGlbInvocationSha256(oldInvocation(source)),
      );
      await expect(
        verifyFoundryOfflineNormalizeMeshGlbPreview({
          ...options,
          normalizedGlb: first.normalizedGlb,
          report: first.report,
        }),
      ).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects missing, untrusted, tampered, or expired permits before normalization", async () => {
    const source = rewriteJson(glbFixture(), (json) => {
      json.materials = [{ pbrMetallicRoughness: {} }];
    });
    const activePermit = signedPermit(source);

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime("2026-07-17T10:00:00.000Z");
    try {
      let sourceBytesObserved = 0;
      const activeOptions = runOptions(source, activePermit);
      await expect(
        runFoundryOfflineNormalizeMeshGlbPreview({
          invocation: activeOptions.invocation,
          get sourceBytes() {
            sourceBytesObserved += 1;
            return source;
          },
          permitEnvelope: undefined,
          pinnedTrustedPermitKeys: activeOptions.pinnedTrustedPermitKeys,
        }),
      ).rejects.toMatchObject({
        code: "OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_ENVELOPE_INVALID",
      });
      expect(sourceBytesObserved).toBe(0);
      await expect(
        runFoundryOfflineNormalizeMeshGlbPreview({
          ...runOptions(source, activePermit),
          pinnedTrustedPermitKeys: new Map(),
        }),
      ).rejects.toMatchObject({ code: "DSSE_SIGNATURE_INVALID" });

      const signatureBytes = Buffer.from(
        activePermit.envelope.signatures[0].sig,
        "base64",
      );
      signatureBytes[0] = (signatureBytes[0] ?? 0) ^ 1;
      await expect(
        runFoundryOfflineNormalizeMeshGlbPreview({
          ...runOptions(source, activePermit),
          permitEnvelope: {
            ...activePermit.envelope,
            signatures: [
              {
                ...activePermit.envelope.signatures[0],
                sig: signatureBytes.toString("base64"),
              },
            ],
          },
        }),
      ).rejects.toMatchObject({ code: "DSSE_SIGNATURE_INVALID" });

      const expired = signedPermit(source, {
        validFrom: "2026-07-17T09:40:00.000Z",
        expiresAt: "2026-07-17T09:50:00.000Z",
      });
      await expect(
        runFoundryOfflineNormalizeMeshGlbPreview(runOptions(source, expired)),
      ).rejects.toMatchObject({
        code: "OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_EXPIRED",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("enforces inclusive validity start, exclusive expiry, and the 15-minute lifetime", async () => {
    const source = glbFixture();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime("2026-07-17T10:00:00.000Z");
    try {
      const exactLifetime = signedPermit(source, {
        validFrom: "2026-07-17T10:00:00.000Z",
        expiresAt: "2026-07-17T10:15:00.000Z",
      });
      await expect(
        runFoundryOfflineNormalizeMeshGlbPreview(
          runOptions(source, exactLifetime),
        ),
      ).resolves.toBeDefined();

      const notYetValid = signedPermit(source, {
        validFrom: "2026-07-17T10:00:00.001Z",
        expiresAt: "2026-07-17T10:15:00.000Z",
      });
      await expect(
        runFoundryOfflineNormalizeMeshGlbPreview(
          runOptions(source, notYetValid),
        ),
      ).rejects.toMatchObject({
        code: "OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_NOT_YET_VALID",
      });

      const atExpiry = signedPermit(source, {
        validFrom: "2026-07-17T09:45:00.000Z",
        expiresAt: "2026-07-17T10:00:00.000Z",
      });
      await expect(
        runFoundryOfflineNormalizeMeshGlbPreview(
          runOptions(source, atExpiry),
        ),
      ).rejects.toMatchObject({
        code: "OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_EXPIRED",
      });

      expect(() =>
        signedPermit(source, {
          validFrom: "2026-07-17T10:00:00.000Z",
          expiresAt: "2026-07-17T10:00:00.000Z",
        }),
      ).toThrow("expire after its inclusive validity start");
      expect(() =>
        signedPermit(source, {
          validFrom: "2026-07-17T10:00:00.000Z",
          expiresAt: "2026-07-17T10:15:00.001Z",
        }),
      ).toThrow("exceeds the immutable short-lived lifetime bound");
    } finally {
      vi.useRealTimers();
    }
  });

  it("rechecks permit expiry after the transform and returns no late result", async () => {
    const source = glbFixture();
    const permit = signedPermit(source);
    const now = vi
      .spyOn(Date, "now")
      .mockReturnValueOnce(Date.parse("2026-07-17T10:00:00.000Z"))
      .mockReturnValue(Date.parse("2026-07-17T10:06:00.000Z"));
    try {
      await expect(
        runFoundryOfflineNormalizeMeshGlbPreview(runOptions(source, permit)),
      ).rejects.toMatchObject({
        code: "OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_EXPIRED",
      });
    } finally {
      now.mockRestore();
    }
  });

  it("rejects signed permits bound to the wrong source or operation", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime("2026-07-17T10:00:00.000Z");
    try {
      const source = glbFixture();
      const wrongSource = signedPermit(source, {
        sourceSha256: `sha256:${"0".repeat(64)}`,
      });
      await expect(
        runFoundryOfflineNormalizeMeshGlbPreview(
          runOptions(source, wrongSource),
        ),
      ).rejects.toMatchObject({
        code: "OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_BINDING_MISMATCH",
      });

      const valid = signedPermit(source);
      const keys = generateKeyPairSync("ed25519");
      const wrongOperationPayload = {
        ...valid.permit,
        operation: {
          ...valid.permit.operation,
          operationVersion: "v1",
        },
      };
      const wrongOperationBytes = Buffer.from(
        stableCanonicalJson(toCanonicalJson(wrongOperationPayload)),
        "utf8",
      );
      const wrongOperation: SignedPermitFixture = {
        permit: valid.permit,
        envelope: signPayload(wrongOperationBytes, keys.privateKey),
        trustedKeys: new Map([[SIGNING_KEY_ID, keys.publicKey]]),
      };
      const binding = {
        payloadSha256: `sha256:${sha256Bytes(wrongOperationBytes)}`,
        keyId: SIGNING_KEY_ID,
        expiresAt: valid.permit.expiresAt,
      };
      await expect(
        runFoundryOfflineNormalizeMeshGlbPreview({
          invocation: previewInvocation(
            source,
            wrongOperation,
            acknowledgement(source),
            binding,
          ),
          sourceBytes: source,
          permitEnvelope: wrongOperation.envelope,
          pinnedTrustedPermitKeys: wrongOperation.trustedKeys,
        }),
      ).rejects.toMatchObject({
        code: "OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_CLAIMS_INVALID",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects noncanonical, mis-keyed, misspelled, oversized, or broadened permit evidence", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime("2026-07-17T10:00:00.000Z");
    try {
      const source = glbFixture();
      const valid = signedPermit(source);
      const optionsFor = (raw: ReturnType<typeof signedRawPermit>) => ({
        invocation: previewInvocation(
          source,
          raw.fixture,
          acknowledgement(source),
          raw.binding,
        ),
        sourceBytes: source,
        permitEnvelope: raw.fixture.envelope,
        pinnedTrustedPermitKeys: raw.fixture.trustedKeys,
      });

      const noncanonical = signedRawPermit(
        valid.permit,
        Buffer.from(JSON.stringify(valid.permit, null, 2), "utf8"),
      );
      await expect(
        runFoundryOfflineNormalizeMeshGlbPreview(optionsFor(noncanonical)),
      ).rejects.toMatchObject({
        code: "OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_NOT_CANONICAL",
      });

      const wrongIssuer = signedRawPermit(
        valid.permit,
        serializeFoundryOfflineNormalizeMeshGlbPreviewPermitV0(valid.permit),
        "different-trusted-key",
      );
      await expect(
        runFoundryOfflineNormalizeMeshGlbPreview(optionsFor(wrongIssuer)),
      ).rejects.toMatchObject({
        code: "OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_BINDING_MISMATCH",
      });

      for (const claims of [
        { ...valid.permit, purpose: "publish_the_result" },
        { ...valid.permit, actions: ["train_a_model"] },
        {
          ...valid.permit,
          outputPolicy: {
            ...valid.permit.outputPolicy,
            publicationEligible: true,
          },
        },
      ]) {
        const raw = signedRawPermit(
          valid.permit,
          Buffer.from(stableCanonicalJson(toCanonicalJson(claims)), "utf8"),
        );
        await expect(
          runFoundryOfflineNormalizeMeshGlbPreview(optionsFor(raw)),
        ).rejects.toMatchObject({
          code: "OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_CLAIMS_INVALID",
        });
      }

      const canonical = signedRawPermit(
        valid.permit,
        serializeFoundryOfflineNormalizeMeshGlbPreviewPermitV0(valid.permit),
      );
      await expect(
        runFoundryOfflineNormalizeMeshGlbPreview({
          ...optionsFor(canonical),
          permitEnvelope: {
            ...canonical.fixture.envelope,
            payloadType: `${canonical.fixture.envelope.payloadType} `,
          },
        }),
      ).rejects.toMatchObject({
        code: "OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_PAYLOAD_TYPE_MISMATCH",
      });
      await expect(
        runFoundryOfflineNormalizeMeshGlbPreview({
          ...optionsFor(canonical),
          permitEnvelope: {
            ...canonical.fixture.envelope,
            signatures: [
              {
                ...canonical.fixture.envelope.signatures[0],
                keyid: `${canonical.fixture.envelope.signatures[0].keyid} `,
              },
            ],
          },
        }),
      ).rejects.toMatchObject({
        code: "OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_KEY_ID_INVALID",
      });
      await expect(
        runFoundryOfflineNormalizeMeshGlbPreview({
          ...runOptions(source, valid),
          permitEnvelope: {
            payloadType:
              FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_PAYLOAD_TYPE,
            payload: Buffer.alloc(
              FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_MAX_PERMIT_PAYLOAD_BYTES +
                1,
            ).toString("base64"),
            signatures: valid.envelope.signatures,
          },
        }),
      ).rejects.toMatchObject({
        code: "OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_PAYLOAD_TOO_LARGE",
      });

      expect(() =>
        FoundryOfflineNormalizeMeshGlbPreviewInvocationV0Schema.parse({
          ...runOptions(source, valid).invocation,
          source: {
            ...sourceBinding(source),
            assetId: "a/../../x",
          },
        }),
      ).toThrow();
      expect(() =>
        FoundryOfflineNormalizeMeshGlbPreviewPermitV0Schema.parse({
          ...valid.permit,
          permitId: "a/../../permit",
        }),
      ).toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects changed source bytes and cross-bound or tampered acknowledgements", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime("2026-07-17T10:00:00.000Z");
    try {
      const source = glbFixture();
      const permit = signedPermit(source);
      const options = runOptions(source, permit);
      const changed = Buffer.from(source);
      changed[changed.length - 1] = (changed[changed.length - 1] ?? 0) ^ 1;
      await expect(
        runFoundryOfflineNormalizeMeshGlbPreview({
          ...options,
          sourceBytes: changed,
        }),
      ).rejects.toMatchObject({
        code: "NORMALIZE_MESH_GLB_SOURCE_BINDING_MISMATCH",
      });

      const crossBound = acknowledgement(source, {
        sourceSha256: `sha256:${"0".repeat(64)}`,
      });
      expect(() => previewInvocation(source, permit, crossBound)).toThrow(
        "exactly bind the invocation source and operation",
      );
      expect(() =>
        FoundryOfflineNormalizeMeshGlbPreviewInvocationV0Schema.parse({
          ...options.invocation,
          operatorAcknowledgementSha256: `sha256:${"f".repeat(64)}`,
        }),
      ).toThrow("operator acknowledgement digest binding mismatch");
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects unsupported GLB semantics with a valid permit", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime("2026-07-17T10:00:00.000Z");
    try {
      const unsupported = rewriteJson(glbFixture(), (json) => {
        json.materials = [{ pbrMetallicRoughness: {} }];
      });
      const permit = signedPermit(unsupported);
      await expect(
        runFoundryOfflineNormalizeMeshGlbPreview(
          runOptions(unsupported, permit),
        ),
      ).rejects.toMatchObject({
        code: "NORMALIZE_MESH_GLB_UNSUPPORTED_SEMANTICS",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("freshly verifies report bytes, invocation, permit, and acknowledgement", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime("2026-07-17T10:00:00.000Z");
    try {
      const source = glbFixture();
      const permit = signedPermit(source);
      const options = runOptions(source, permit);
      const result = await runFoundryOfflineNormalizeMeshGlbPreview(options);
      const secondInvocation = previewInvocation(
        source,
        permit,
        acknowledgement(source, {
          acknowledgementId: "second-preview-ack",
        }),
      );
      await expect(
        verifyFoundryOfflineNormalizeMeshGlbPreview({
          ...options,
          invocation: secondInvocation,
          normalizedGlb: result.normalizedGlb,
          report: result.report,
        }),
      ).rejects.toMatchObject({
        code: "OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PROOF_BINDING_MISMATCH",
      });

      const forged = resignPreviewReport(result.report, (payload) => {
        payload.output.sha256 = `sha256:${"a".repeat(64)}`;
      });
      await expect(
        verifyFoundryOfflineNormalizeMeshGlbPreview({
          ...options,
          normalizedGlb: result.normalizedGlb,
          report: forged,
        }),
      ).rejects.toMatchObject({
        code: "OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PROOF_BINDING_MISMATCH",
      });

      const semanticallyEquivalentReserialization = rewriteJson(
        result.normalizedGlb,
        () => undefined,
        true,
      );
      expect(semanticallyEquivalentReserialization).not.toEqual(
        result.normalizedGlb,
      );
      const reserializedReport = resignPreviewReport(
        result.report,
        (payload) => {
          payload.output.sizeBytes =
            semanticallyEquivalentReserialization.length;
          payload.output.sha256 =
            `sha256:${sha256Bytes(semanticallyEquivalentReserialization)}`;
        },
      );
      await expect(
        verifyFoundryOfflineNormalizeMeshGlbPreview({
          ...options,
          normalizedGlb: semanticallyEquivalentReserialization,
          report: reserializedReport,
        }),
      ).rejects.toMatchObject({
        code:
          "OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_DETERMINISTIC_PROVENANCE_MISMATCH",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves the old V0 golden bytes, report, schema literal, and domains", async () => {
    const source = glbFixture();
    const invocation = oldInvocation(source);
    const result = await __testOnlyNormalizeMeshGlbBytes(invocation, source);
    expect(computeFoundryNormalizeMeshGlbInvocationSha256(invocation)).toBe(
      "sha256:fd8689b669bf31277ce8d0ecbab5bc9922542d171d37c931190bd3b5646a0e15",
    );
    expect(`sha256:${sha256Bytes(result.normalizedGlb)}`).toBe(
      "sha256:6a51a340155da5ed41d1a66d6388c4dd14770e1e9788c721229c7fe2a65505d1",
    );
    expect(result.report.reportSha256).toBe(
      "sha256:6d16eb9941ec1f3952c4a32fda5819685ffc525aaa513f6be5f389a45979f498",
    );
    expect(invocation.executionMode).toBe("test_only_pure_core_proof");
    expect(() =>
      FoundryNormalizeMeshGlbInvocationV0Schema.parse({
        ...invocation,
        executionMode:
          FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_EXECUTION_MODE,
      }),
    ).toThrow();
  });

  it("keeps both old production entrypoints closed before observing options", () => {
    const workerObserved: string[] = [];
    const workerOptions = new Proxy(
      {},
      {
        get: (_target, key) => {
          workerObserved.push(String(key));
          return undefined;
        },
      },
    ) as RunFoundryNormalizeMeshGlbWorkerOptions;
    expect(() => runFoundryNormalizeMeshGlbWorker(workerOptions)).toThrow();
    expect(workerObserved).toEqual([]);

    const bundleObserved: string[] = [];
    const bundleOptions = new Proxy(
      {},
      {
        get: (_target, key) => {
          bundleObserved.push(String(key));
          return undefined;
        },
      },
    ) as RunFoundryDerivativeNormalizationOutputBundleOptions;
    let thrown: unknown;
    try {
      runFoundryDerivativeNormalizationOutputBundle(bundleOptions);
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      code:
        process.platform === "win32"
          ? "DERIVATIVE_NORMALIZATION_OUTPUT_WINDOWS_SANDBOX_UNREVIEWED"
          : "DERIVATIVE_NORMALIZATION_OUTPUT_PRODUCTION_DISABLED",
    });
    expect(bundleObserved).toEqual([]);
  });

  it("exports the honest preview API but no internals or test hooks at package root", async () => {
    const rootSource = await readFile(
      new URL("../index.ts", import.meta.url),
      "utf8",
    );
    expect(rootSource).toContain("runFoundryOfflineNormalizeMeshGlbPreview");
    expect(rootSource).toContain("verifyFoundryOfflineNormalizeMeshGlbPreview");
    expect(rootSource).toContain(
      "verifyFoundryOfflineNormalizeMeshGlbPreviewPermit",
    );
    expect(rootSource).not.toContain("normalizeMeshGlbPureTransformInternal");
    expect(rootSource).not.toContain(
      "verifyNormalizeMeshGlbSemanticProofInternal",
    );
    expect(rootSource).not.toContain("__testOnlyNormalizeMeshGlbBytes");
  });
});
