import {
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dssePreAuthenticationEncoding } from "../dsse.js";
import { sha256Bytes } from "../hash.js";
import {
  FOUNDRY_NORMALIZE_MESH_GLB_OPERATION,
  FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_VERSION,
  FOUNDRY_NORMALIZE_MESH_GLB_SEALED_IDENTITY,
} from "../normalize-mesh-glb-worker.js";
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
  FoundryOfflineNormalizeMeshGlbPreviewReportV0Schema,
  computeFoundryOfflineNormalizeMeshGlbPreviewOperatorAcknowledgementSha256,
  computeFoundryOfflineNormalizeMeshGlbPreviewReportSha256,
  serializeFoundryOfflineNormalizeMeshGlbPreviewPermitV0,
  type FoundryOfflineNormalizeMeshGlbPreviewInvocationV0,
  type FoundryOfflineNormalizeMeshGlbPreviewReportV0,
} from "../offline-normalize-mesh-glb-preview.js";
import {
  decodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage,
  encodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage,
  FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_FAILURE_CODES,
  type FoundryOfflineNormalizeMeshGlbPreviewSandboxFailure,
  type FoundryOfflineNormalizeMeshGlbPreviewSandboxTransformSuccess,
} from "../offline-normalize-mesh-glb-preview-sandbox-wire.js";
import {
  FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WORKER_UNBOUND_REQUEST_ID,
  runFoundryOfflineNormalizeMeshGlbPreviewSandboxWorker,
} from "../offline-normalize-mesh-glb-preview-sandbox-worker.js";
import { glbFixture } from "./fixture.js";

const KEY_ID = "sandbox-worker-fixture-key";
const REQUEST_ID = "0123456789abcdef0123456789abcdef";
const NOW = "2026-07-17T10:00:00.000Z";
const DEADLINE = "2026-07-17T10:04:00.000Z";
const EXPIRES_AT = "2026-07-17T10:05:00.000Z";

interface SandboxFixture {
  readonly source: Buffer;
  readonly invocation: FoundryOfflineNormalizeMeshGlbPreviewInvocationV0;
  readonly permitEnvelope: {
    readonly payloadType: string;
    readonly payload: string;
    readonly signatures: readonly [{ readonly keyid: string; readonly sig: string }];
  };
  readonly publicKey: KeyObject;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function digest(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${sha256Bytes(bytes)}`;
}

function sourceBinding(source: Uint8Array) {
  return {
    assetId: "sandbox-worker-source",
    inputType: "glb_gltf" as const,
    mediaType: "model/gltf-binary" as const,
    sizeBytes: source.byteLength,
    sha256: digest(source),
  };
}

function spkiDerBase64(publicKey: KeyObject): string {
  const exported = publicKey.export({ format: "der", type: "spki" });
  if (typeof exported === "string") {
    throw new TypeError("DER public-key export unexpectedly returned text.");
  }
  return exported.toString("base64");
}

function sandboxFixture(): SandboxFixture {
  const source = glbFixture();
  const keys = generateKeyPairSync("ed25519");
  const sourceFacts = sourceBinding(source);
  const permit = FoundryOfflineNormalizeMeshGlbPreviewPermitV0Schema.parse({
    schemaVersion: FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_V0,
    permitId: "sandbox-worker-fixture-permit",
    issuerKeyId: KEY_ID,
    validFrom: "2026-07-17T09:55:00.000Z",
    expiresAt: EXPIRES_AT,
    purpose: "private_offline_format_normalization_preview",
    actions: ["normalize_mesh_glb_to_private_preview_bytes"],
    source: sourceFacts,
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
  const permitEnvelope = {
    payloadType:
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_PAYLOAD_TYPE,
    payload: payloadBytes.toString("base64"),
    signatures: [
      {
        keyid: KEY_ID,
        sig: sign(
          null,
          dssePreAuthenticationEncoding(
            FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_PAYLOAD_TYPE,
            payloadBytes,
          ),
          keys.privateKey,
        ).toString("base64"),
      },
    ] as const,
  };
  const acknowledgementPayload = {
    schemaVersion:
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_OPERATOR_ACKNOWLEDGEMENT_V0,
    acknowledgementId: "sandbox-worker-fixture-ack",
    operatorId: "sandbox-worker-fixture-operator",
    recordedAt: NOW,
    acknowledgement: "operator_records_private_offline_preview_intent" as const,
    statement:
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_OPERATOR_ACKNOWLEDGEMENT_STATEMENT,
    legalPosture: "operator_statement_not_independent_rights_approval" as const,
    authorizationPosture: "operator_statement_recorded_not_a_permit" as const,
    independentRightsApprovalEstablished: false as const,
    operatorStatementEstablishesExecutionPermit: false as const,
    source: {
      assetId: sourceFacts.assetId,
      sizeBytes: sourceFacts.sizeBytes,
      sha256: sourceFacts.sha256,
    },
    operation: {
      operation: FOUNDRY_NORMALIZE_MESH_GLB_OPERATION,
      operationVersion: FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_VERSION,
      sealedIdentity: [...FOUNDRY_NORMALIZE_MESH_GLB_SEALED_IDENTITY],
    },
    authority: "none" as const,
  };
  const operatorAcknowledgement =
    FoundryOfflineNormalizeMeshGlbPreviewOperatorAcknowledgementV0Schema.parse({
      ...acknowledgementPayload,
      acknowledgementSha256:
        computeFoundryOfflineNormalizeMeshGlbPreviewOperatorAcknowledgementSha256(
          acknowledgementPayload,
        ),
    });
  const invocation =
    FoundryOfflineNormalizeMeshGlbPreviewInvocationV0Schema.parse({
      schemaVersion:
        FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_INVOCATION_V0,
      operation: FOUNDRY_NORMALIZE_MESH_GLB_OPERATION,
      operationVersion: FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_VERSION,
      sealedIdentity: [...FOUNDRY_NORMALIZE_MESH_GLB_SEALED_IDENTITY],
      executionMode:
        FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_EXECUTION_MODE,
      source: sourceFacts,
      permit: {
        payloadSha256: digest(payloadBytes),
        keyId: KEY_ID,
        expiresAt: EXPIRES_AT,
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
  return {
    source,
    invocation,
    permitEnvelope,
    publicKey: keys.publicKey,
  };
}

function transformRequest(
  fixture: SandboxFixture,
  options: {
    readonly deadlineAt?: string;
    readonly publicKey?: KeyObject;
    readonly requestId?: string;
  } = {},
): Buffer {
  return encodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage({
    kind: "transform_request",
    requestId: options.requestId ?? REQUEST_ID,
    deadlineAt: options.deadlineAt ?? DEADLINE,
    invocation: fixture.invocation,
    permitEnvelope: fixture.permitEnvelope,
    permitPublicKey: {
      keyId: KEY_ID,
      spkiDerBase64: spkiDerBase64(options.publicKey ?? fixture.publicKey),
    },
    sourceBytes: fixture.source,
  });
}

async function transformed(
  fixture: SandboxFixture,
): Promise<FoundryOfflineNormalizeMeshGlbPreviewSandboxTransformSuccess> {
  const response = await runFoundryOfflineNormalizeMeshGlbPreviewSandboxWorker(
    transformRequest(fixture),
  );
  const decoded =
    decodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage(response);
  if (decoded.kind !== "transform_success") {
    throw new Error("fixture transform did not succeed");
  }
  return decoded;
}

function expectFixedFailure(
  response: Uint8Array,
  expected: {
    readonly code:
      (typeof FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_FAILURE_CODES)[number];
    readonly requestId: string;
    readonly role: "transform" | "fresh_verifier";
  },
): FoundryOfflineNormalizeMeshGlbPreviewSandboxFailure {
  const decoded =
    decodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage(response);
  expect(decoded.kind).toBe("failure");
  if (decoded.kind !== "failure") {
    throw new Error("worker response was not a closed failure");
  }
  expect(decoded.metadata).toEqual({
    schemaVersion:
      "omnitwin.foundry.offline-normalize-mesh-glb-preview-sandbox-wire.v0",
    messageType: "failure",
    role: expected.role,
    requestId: expected.requestId,
    failure: {
      code: expected.code,
    },
    blobs: [],
  });
  expect(Object.keys(decoded)).toEqual(["kind", "metadata"]);
  return decoded;
}

function tamperedReport(
  report: FoundryOfflineNormalizeMeshGlbPreviewReportV0,
): FoundryOfflineNormalizeMeshGlbPreviewReportV0 {
  const clone = structuredClone(report);
  const { reportSha256: _reportSha256, ...payload } = clone;
  const changed = {
    ...payload,
    validation: {
      ...payload.validation,
      before: {
        ...payload.validation.before,
        version: `${payload.validation.before.version}-tampered`,
      },
    },
  };
  return FoundryOfflineNormalizeMeshGlbPreviewReportV0Schema.parse({
    ...changed,
    reportSha256:
      computeFoundryOfflineNormalizeMeshGlbPreviewReportSha256(changed),
  });
}

describe.sequential("offline preview semantic sandbox worker", () => {
  it("deterministically transforms a signed minimal GLB with authority none", async () => {
    const fixture = sandboxFixture();
    const request = transformRequest(fixture);
    const requestSnapshot = Buffer.from(request);

    const first =
      await runFoundryOfflineNormalizeMeshGlbPreviewSandboxWorker(request);
    const second =
      await runFoundryOfflineNormalizeMeshGlbPreviewSandboxWorker(request);

    expect(first).toEqual(second);
    expect(request).toEqual(requestSnapshot);
    const decoded =
      decodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage(first);
    expect(decoded.kind).toBe("transform_success");
    if (decoded.kind !== "transform_success") {
      throw new Error("transform response was not successful");
    }
    expect(decoded.metadata.requestId).toBe(REQUEST_ID);
    expect(decoded.metadata.report.authority).toBe("none");
    expect(decoded.metadata.report.executionBoundary.sandboxEstablished)
      .toBe(false);
    expect(decoded.metadata.report.output.sha256).toBe(digest(decoded.outputBytes));
  });

  it("fresh-verifies the candidate and returns a frame-free success", async () => {
    const fixture = sandboxFixture();
    const transform = await transformed(fixture);
    const request =
      encodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage({
        kind: "fresh_verifier_request",
        requestId: REQUEST_ID,
        deadlineAt: DEADLINE,
        invocation: fixture.invocation,
        permitEnvelope: fixture.permitEnvelope,
        permitPublicKey: {
          keyId: KEY_ID,
          spkiDerBase64: spkiDerBase64(fixture.publicKey),
        },
        report: transform.metadata.report,
        sourceBytes: fixture.source,
        candidateBytes: transform.outputBytes,
      });

    const response =
      await runFoundryOfflineNormalizeMeshGlbPreviewSandboxWorker(request);
    const decoded =
      decodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage(response);

    expect(decoded.kind).toBe("fresh_verifier_success");
    if (decoded.kind !== "fresh_verifier_success") {
      throw new Error("fresh verifier response was not successful");
    }
    expect(decoded.metadata.requestId).toBe(REQUEST_ID);
    expect(decoded.metadata.blobs).toEqual([]);
    expect(Object.keys(decoded)).toEqual(["kind", "metadata"]);
  });

  it("rejects a valid Ed25519 key that did not sign the bound permit", async () => {
    const fixture = sandboxFixture();
    const wrongKey = generateKeyPairSync("ed25519").publicKey;
    const response =
      await runFoundryOfflineNormalizeMeshGlbPreviewSandboxWorker(
        transformRequest(fixture, { publicKey: wrongKey }),
      );

    expectFixedFailure(response, {
      code: "REQUEST_INVALID",
      requestId: REQUEST_ID,
      role: "transform",
    });
  });

  it("rejects expired deadlines before transformation", async () => {
    const fixture = sandboxFixture();
    const response =
      await runFoundryOfflineNormalizeMeshGlbPreviewSandboxWorker(
        transformRequest(fixture, { deadlineAt: NOW }),
      );

    expectFixedFailure(response, {
      code: "DEADLINE_EXCEEDED",
      requestId: REQUEST_ID,
      role: "transform",
    });
  });

  it("rejects an otherwise valid result that finishes at its deadline", async () => {
    const fixture = sandboxFixture();
    const deadlineMs = Date.parse(DEADLINE);
    const nowMs = Date.parse(NOW);
    let dateReads = 0;
    vi.spyOn(Date, "now").mockImplementation(() => {
      dateReads += 1;
      return dateReads >= 4 ? deadlineMs : nowMs;
    });

    const response =
      await runFoundryOfflineNormalizeMeshGlbPreviewSandboxWorker(
        transformRequest(fixture),
      );

    expect(dateReads).toBeGreaterThanOrEqual(4);
    expectFixedFailure(response, {
      code: "DEADLINE_EXCEEDED",
      requestId: REQUEST_ID,
      role: "transform",
    });
  });

  it("rejects a freshly bound but semantically wrong verifier report", async () => {
    const fixture = sandboxFixture();
    const transform = await transformed(fixture);
    const request =
      encodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage({
        kind: "fresh_verifier_request",
        requestId: REQUEST_ID,
        deadlineAt: DEADLINE,
        invocation: fixture.invocation,
        permitEnvelope: fixture.permitEnvelope,
        permitPublicKey: {
          keyId: KEY_ID,
          spkiDerBase64: spkiDerBase64(fixture.publicKey),
        },
        report: tamperedReport(transform.metadata.report),
        sourceBytes: fixture.source,
        candidateBytes: transform.outputBytes,
      });

    const response =
      await runFoundryOfflineNormalizeMeshGlbPreviewSandboxWorker(request);

    expectFixedFailure(response, {
      code: "VERIFICATION_FAILED",
      requestId: REQUEST_ID,
      role: "fresh_verifier",
    });
    expect(response.includes(transform.outputBytes)).toBe(false);
  });

  it("closes digest-corrupt and malformed input without reflecting bytes or errors", async () => {
    const fixture = sandboxFixture();
    const corrupt = Buffer.from(transformRequest(fixture));
    corrupt[corrupt.length - 1] = (corrupt[corrupt.length - 1] ?? 0) ^ 0xff;
    const malformedMarker = "SECRET_SOURCE_AND_RAW_ERROR_MUST_NOT_RETURN";

    for (const input of [corrupt, Buffer.from(malformedMarker, "utf8")]) {
      const response =
        await runFoundryOfflineNormalizeMeshGlbPreviewSandboxWorker(input);
      expectFixedFailure(response, {
        code: "REQUEST_INVALID",
        requestId:
          FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WORKER_UNBOUND_REQUEST_ID,
        role: "transform",
      });
      expect(response.toString("utf8")).not.toContain(malformedMarker);
      expect(response.includes(fixture.source)).toBe(false);
    }
    expect(
      /^[a-f0-9]{32}$/u.test(
        FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WORKER_UNBOUND_REQUEST_ID,
      ),
    ).toBe(false);
  });

  it("zeroizes decoded binary from a non-request message before closing it", async () => {
    const fixture = sandboxFixture();
    const transform = await transformed(fixture);
    const nonRequest =
      encodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage({
        kind: "transform_success",
        requestId: REQUEST_ID,
        report: transform.metadata.report,
        outputBytes: transform.outputBytes,
      });
    const fillSpy = vi.spyOn(Buffer.prototype, "fill");

    const response =
      await runFoundryOfflineNormalizeMeshGlbPreviewSandboxWorker(nonRequest);

    expectFixedFailure(response, {
      code: "REQUEST_INVALID",
      requestId: REQUEST_ID,
      role: "transform",
    });
    const zeroizedMatchingBuffer = fillSpy.mock.instances.some(
      (instance, index) => {
        const firstArgument: unknown = fillSpy.mock.calls[index]?.[0];
        return firstArgument === 0 &&
          Buffer.isBuffer(instance) &&
          instance.length === transform.outputBytes.length &&
          instance.every((value) => value === 0);
      },
    );
    expect(zeroizedMatchingBuffer).toBe(true);
  });

  it("has no filesystem, network, subprocess, persistence, or OS-sandbox claim", async () => {
    const source = await readFile(
      new URL(
        "../offline-normalize-mesh-glb-preview-sandbox-worker.ts",
        import.meta.url,
      ),
      "utf8",
    );

    expect(source).not.toMatch(/from "node:(?:fs|net|http|https|tls|dgram|child_process|cluster)"/u);
    expect(source).not.toContain("process.");
    expect(source).not.toContain("sandboxEstablished: true");
    expect(source).toContain("does not establish an operating-system sandbox");
  });
});
