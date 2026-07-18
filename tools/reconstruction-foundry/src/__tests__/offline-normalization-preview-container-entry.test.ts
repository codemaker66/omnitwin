import {
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import { Readable, Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dssePreAuthenticationEncoding } from "../../../../packages/reconstruction-foundry/src/dsse.js";
import { sha256Bytes } from "../../../../packages/reconstruction-foundry/src/hash.js";
import {
  FOUNDRY_NORMALIZE_MESH_GLB_OPERATION,
  FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_VERSION,
  FOUNDRY_NORMALIZE_MESH_GLB_SEALED_IDENTITY,
} from "../../../../packages/reconstruction-foundry/src/normalize-mesh-glb-worker.js";
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
  serializeFoundryOfflineNormalizeMeshGlbPreviewPermitV0,
  type FoundryOfflineNormalizeMeshGlbPreviewInvocationV0,
} from "../../../../packages/reconstruction-foundry/src/offline-normalize-mesh-glb-preview.js";
import {
  decodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage,
  encodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage,
  FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_MAX_BYTES,
} from "../../../../packages/reconstruction-foundry/src/offline-normalize-mesh-glb-preview-sandbox-wire.js";
import {
  FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WORKER_UNBOUND_REQUEST_ID,
} from "../../../../packages/reconstruction-foundry/src/offline-normalize-mesh-glb-preview-sandbox-worker.js";
import {
  OFFLINE_NORMALIZATION_PREVIEW_CONTAINER_EXIT_FAILURE,
  OFFLINE_NORMALIZATION_PREVIEW_CONTAINER_EXIT_SUCCESS,
  runOfflineNormalizationPreviewContainerEntry,
} from "../offline-normalization-preview-container-entry.js";

const KEY_ID = "container-entry-fixture-key";
const REQUEST_ID = "0123456789abcdef0123456789abcdef";

interface ContainerFixture {
  readonly source: Buffer;
  readonly invocation: FoundryOfflineNormalizeMeshGlbPreviewInvocationV0;
  readonly permitEnvelope: {
    readonly payloadType: string;
    readonly payload: string;
    readonly signatures: readonly [{ readonly keyid: string; readonly sig: string }];
  };
  readonly publicKey: KeyObject;
  readonly deadlineAt: string;
}

type SinkMode = "normal" | "slow" | "write_error" | "close";

class RecordingWritable extends Writable {
  readonly references: Buffer[] = [];
  readonly snapshots: Buffer[] = [];
  writeCount = 0;

  constructor(private readonly mode: SinkMode = "normal") {
    super({ highWaterMark: mode === "slow" ? 1 : 16 * 1024 });
  }

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.writeCount += 1;
    this.references.push(chunk);
    this.snapshots.push(Buffer.from(chunk));
    if (this.mode === "write_error") {
      callback(new Error("RAW_WRITE_FAILURE_MUST_NOT_BE_EMITTED"));
      return;
    }
    if (this.mode === "close") {
      this.destroy();
      return;
    }
    if (this.mode === "slow") {
      setImmediate(callback);
      return;
    }
    callback();
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

function digest(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${sha256Bytes(bytes)}`;
}

function tinyGlb(): Buffer {
  const positions = Buffer.alloc(36);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((value, index) => {
    positions.writeFloatLE(value, index * 4);
  });
  const indices = Buffer.alloc(6);
  indices.writeUInt16LE(0, 0);
  indices.writeUInt16LE(1, 2);
  indices.writeUInt16LE(2, 4);
  const binaryLength = positions.byteLength + indices.byteLength;
  const binary = Buffer.alloc(Math.ceil(binaryLength / 4) * 4);
  positions.copy(binary);
  indices.copy(binary, positions.byteLength);
  const document = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{
      primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }],
    }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: "VEC3",
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
      {
        bufferView: 1,
        componentType: 5123,
        count: 3,
        type: "SCALAR",
        min: [0],
        max: [2],
      },
    ],
    bufferViews: [
      {
        buffer: 0,
        byteOffset: 0,
        byteLength: positions.byteLength,
        target: 34962,
      },
      {
        buffer: 0,
        byteOffset: positions.byteLength,
        byteLength: indices.byteLength,
        target: 34963,
      },
    ],
    buffers: [{ byteLength: binaryLength }],
  };
  const json = Buffer.from(JSON.stringify(document), "utf8");
  const paddedJson = Buffer.alloc(Math.ceil(json.byteLength / 4) * 4, 0x20);
  json.copy(paddedJson);
  const output = Buffer.alloc(20 + paddedJson.byteLength + 8 + binary.byteLength);
  output.writeUInt32LE(0x46546c67, 0);
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(output.byteLength, 8);
  output.writeUInt32LE(paddedJson.byteLength, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  paddedJson.copy(output, 20);
  const binaryHeader = 20 + paddedJson.byteLength;
  output.writeUInt32LE(binary.byteLength, binaryHeader);
  output.writeUInt32LE(0x004e4942, binaryHeader + 4);
  binary.copy(output, binaryHeader + 8);
  return output;
}

function spkiDerBase64(publicKey: KeyObject): string {
  const exported = publicKey.export({ format: "der", type: "spki" });
  if (typeof exported === "string") {
    throw new TypeError("DER public-key export unexpectedly returned text.");
  }
  return exported.toString("base64");
}

function fixture(): ContainerFixture {
  const now = Date.now();
  const recordedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + 5 * 60_000).toISOString();
  const deadlineAt = new Date(now + 4 * 60_000).toISOString();
  const source = tinyGlb();
  const keys = generateKeyPairSync("ed25519");
  const sourceFacts = {
    assetId: "container-entry-source",
    inputType: "glb_gltf" as const,
    mediaType: "model/gltf-binary" as const,
    sizeBytes: source.byteLength,
    sha256: digest(source),
  };
  const permit = FoundryOfflineNormalizeMeshGlbPreviewPermitV0Schema.parse({
    schemaVersion: FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_V0,
    permitId: "container-entry-fixture-permit",
    issuerKeyId: KEY_ID,
    validFrom: new Date(now - 30_000).toISOString(),
    expiresAt,
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
    signatures: [{
      keyid: KEY_ID,
      sig: sign(
        null,
        dssePreAuthenticationEncoding(
          FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_PAYLOAD_TYPE,
          payloadBytes,
        ),
        keys.privateKey,
      ).toString("base64"),
    }] as const,
  };
  const acknowledgementPayload = {
    schemaVersion:
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_OPERATOR_ACKNOWLEDGEMENT_V0,
    acknowledgementId: "container-entry-fixture-ack",
    operatorId: "container-entry-fixture-operator",
    recordedAt,
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
        expiresAt,
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
    deadlineAt,
  };
}

function transformRequest(value: ContainerFixture): Buffer {
  return encodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage({
    kind: "transform_request",
    requestId: REQUEST_ID,
    deadlineAt: value.deadlineAt,
    invocation: value.invocation,
    permitEnvelope: value.permitEnvelope,
    permitPublicKey: {
      keyId: KEY_ID,
      spkiDerBase64: spkiDerBase64(value.publicKey),
    },
    sourceBytes: value.source,
  });
}

async function run(
  chunks: readonly Buffer[],
  output: RecordingWritable = new RecordingWritable(),
) {
  const exitStatus = await runOfflineNormalizationPreviewContainerEntry(
    Readable.from(chunks),
    output,
  );
  return { exitStatus, output };
}

function onlyResponse(output: RecordingWritable): Buffer {
  expect(output.writeCount).toBe(1);
  expect(output.snapshots).toHaveLength(1);
  const response = output.snapshots[0];
  if (response === undefined) throw new Error("test sink did not record a response");
  return response;
}

describe.sequential("offline normalization preview container entry", () => {
  it("runs a golden transform and fresh-verifier round trip through EOF streams", async () => {
    const value = fixture();
    const transformed = await run([transformRequest(value)]);

    expect(transformed.exitStatus).toBe(
      OFFLINE_NORMALIZATION_PREVIEW_CONTAINER_EXIT_SUCCESS,
    );
    const transformMessage =
      decodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage(
        onlyResponse(transformed.output),
      );
    expect(transformMessage.kind).toBe("transform_success");
    if (transformMessage.kind !== "transform_success") {
      throw new Error("golden transform did not succeed");
    }
    expect(transformMessage.metadata.report.authority).toBe("none");
    expect(
      transformMessage.metadata.report.executionBoundary.sandboxEstablished,
    ).toBe(false);

    const verifierRequest =
      encodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage({
        kind: "fresh_verifier_request",
        requestId: REQUEST_ID,
        deadlineAt: value.deadlineAt,
        invocation: value.invocation,
        permitEnvelope: value.permitEnvelope,
        permitPublicKey: {
          keyId: KEY_ID,
          spkiDerBase64: spkiDerBase64(value.publicKey),
        },
        report: transformMessage.metadata.report,
        sourceBytes: value.source,
        candidateBytes: transformMessage.outputBytes,
      });
    const verified = await run([verifierRequest]);

    expect(verified.exitStatus).toBe(
      OFFLINE_NORMALIZATION_PREVIEW_CONTAINER_EXIT_SUCCESS,
    );
    const verifierMessage =
      decodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage(
        onlyResponse(verified.output),
      );
    expect(verifierMessage.kind).toBe("fresh_verifier_success");
    if (verifierMessage.kind !== "fresh_verifier_success") {
      throw new Error("golden fresh verifier did not succeed");
    }
    expect(verifierMessage.metadata.requestId).toBe(REQUEST_ID);
    expect(verifierMessage.metadata.blobs).toEqual([]);
  });

  it("reassembles a request split across many chunks and writes no extra bytes", async () => {
    const request = transformRequest(fixture());
    const chunks: Buffer[] = [];
    for (let offset = 0; offset < request.byteLength; offset += 37) {
      chunks.push(request.subarray(offset, Math.min(offset + 37, request.byteLength)));
    }

    const result = await run(chunks);

    expect(result.exitStatus).toBe(
      OFFLINE_NORMALIZATION_PREVIEW_CONTAINER_EXIT_SUCCESS,
    );
    expect(result.output.writeCount).toBe(1);
    expect(result.output.snapshots).toHaveLength(1);
    expect(
      decodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage(
        onlyResponse(result.output),
      ).kind,
    ).toBe("transform_success");
  });

  it("honors output backpressure before closing the one response", async () => {
    const sink = new RecordingWritable("slow");
    let drainObserved = false;
    sink.once("drain", () => {
      drainObserved = true;
    });

    const result = await run([transformRequest(fixture())], sink);

    expect(result.exitStatus).toBe(
      OFFLINE_NORMALIZATION_PREVIEW_CONTAINER_EXIT_SUCCESS,
    );
    expect(drainObserved).toBe(true);
    expect(sink.writableFinished).toBe(true);
    expect(sink.writeCount).toBe(1);
    expect(sink.snapshots).toHaveLength(1);
  });

  it("returns the fixed failure status and only a closed failure wire for malformed input", async () => {
    const secret = Buffer.from(
      "MALFORMED_SECRET_SOURCE_AND_RAW_ERROR_MUST_NOT_RETURN",
      "utf8",
    );
    const original = Buffer.from(secret);

    const result = await run([secret]);

    expect(result.exitStatus).toBe(
      OFFLINE_NORMALIZATION_PREVIEW_CONTAINER_EXIT_FAILURE,
    );
    expect(secret).toEqual(original);
    const response = onlyResponse(result.output);
    const decoded =
      decodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage(response);
    expect(decoded.kind).toBe("failure");
    if (decoded.kind !== "failure") {
      throw new Error("malformed input did not close as a fixed failure");
    }
    expect(decoded.metadata.requestId).toBe(
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WORKER_UNBOUND_REQUEST_ID,
    );
    expect(decoded.metadata.failure.code).toBe("REQUEST_INVALID");
    expect(response.includes(secret)).toBe(false);
    expect(response.toString("utf8")).not.toContain("RAW_ERROR");
  });

  it("rejects MAX_BYTES plus one before copying or writing it", async () => {
    const oversized = Buffer.allocUnsafe(
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_SANDBOX_WIRE_MAX_BYTES + 1,
    );
    try {
      const result = await run([oversized]);

      expect(result.exitStatus).toBe(
        OFFLINE_NORMALIZATION_PREVIEW_CONTAINER_EXIT_FAILURE,
      );
      expect(result.output.writeCount).toBe(0);
      expect(result.output.snapshots).toEqual([]);
    } finally {
      oversized.fill(0);
    }
  });

  it("returns the fixed failure status for input read errors without output", async () => {
    const input = new Readable({
      read() {
        this.destroy(new Error("RAW_READ_FAILURE_MUST_NOT_BE_EMITTED"));
      },
    });
    const output = new RecordingWritable();

    const exitStatus = await runOfflineNormalizationPreviewContainerEntry(
      input,
      output,
    );

    expect(exitStatus).toBe(
      OFFLINE_NORMALIZATION_PREVIEW_CONTAINER_EXIT_FAILURE,
    );
    expect(output.writeCount).toBe(0);
  });

  it.each(["write_error", "close"] as const)(
    "returns the fixed failure status for an output %s without a second write",
    async (mode) => {
      const sink = new RecordingWritable(mode);

      const result = await run([transformRequest(fixture())], sink);

      expect(result.exitStatus).toBe(
        OFFLINE_NORMALIZATION_PREVIEW_CONTAINER_EXIT_FAILURE,
      );
      expect(sink.writeCount).toBe(1);
      expect(sink.snapshots).toHaveLength(1);
    },
  );

  it("zeroizes observable internal request and response copies without changing caller input", async () => {
    const request = transformRequest(fixture());
    const original = Buffer.from(request);
    const fillSpy = vi.spyOn(Buffer.prototype, "fill");

    const result = await run([request]);

    expect(result.exitStatus).toBe(
      OFFLINE_NORMALIZATION_PREVIEW_CONTAINER_EXIT_SUCCESS,
    );
    expect(request).toEqual(original);
    const responseReference = result.output.references[0];
    expect(responseReference).toBeDefined();
    expect(responseReference?.every((value) => value === 0)).toBe(true);
    const zeroizedRequestCopy = fillSpy.mock.instances.some(
      (instance, index) =>
        fillSpy.mock.calls[index]?.[0] === 0 &&
        Buffer.isBuffer(instance) &&
        instance.byteLength === request.byteLength &&
        instance.every((value) => value === 0),
    );
    expect(zeroizedRequestCopy).toBe(true);
  });

  it("keeps the direct entry fixed to stdin/stdout with no privileged I/O or sandbox claim", async () => {
    const source = await readFile(
      new URL(
        "../offline-normalization-preview-container-entry.ts",
        import.meta.url,
      ),
      "utf8",
    );

    expect(source).not.toMatch(
      /from "node:(?:fs|net|http|https|tls|dgram|child_process|cluster|worker_threads)"/u,
    );
    expect(source).not.toContain("process.env");
    expect(source).not.toContain("process.stderr");
    expect(source).not.toContain("console.");
    expect(source).not.toContain("sandboxEstablished: true");
    expect(source).toContain("process.stdin");
    expect(source).toContain("process.stdout");
    expect(source).toContain("does not establish an operating-system sandbox");
  });
});
