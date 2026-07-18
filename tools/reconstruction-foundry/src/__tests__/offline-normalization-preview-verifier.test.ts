import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { beforeAll, describe, expect, it } from "vitest";
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
  runFoundryOfflineNormalizeMeshGlbPreview,
  serializeFoundryOfflineNormalizeMeshGlbPreviewPermitV0,
  type FoundryOfflineNormalizeMeshGlbPreviewInvocationV0,
  type FoundryOfflineNormalizeMeshGlbPreviewReportV0,
} from "../../../../packages/reconstruction-foundry/src/offline-normalize-mesh-glb-preview.js";
import {
  LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_FAILURE_CODES,
  LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_INPUT_V0,
  LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_MAX_RUNTIME_MS,
  LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_RESOURCE_LIMITS,
  LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_RESULT_V0,
  executeLocalOfflineNormalizationPreviewFreshVerification,
  parseLocalOfflineNormalizationPreviewVerifierInput,
  parseLocalOfflineNormalizationPreviewVerifierResult,
  type LocalOfflineNormalizationPreviewVerifierInput,
} from "../local-offline-normalization-preview-verifier.js";

const KEY_ID = "fresh-verifier-test-key";

interface VerificationFixture {
  readonly source: Buffer;
  readonly candidate: Buffer;
  readonly invocation: FoundryOfflineNormalizeMeshGlbPreviewInvocationV0;
  readonly envelope: LocalOfflineNormalizationPreviewVerifierInput["permitEnvelope"];
  readonly report: FoundryOfflineNormalizeMeshGlbPreviewReportV0;
  readonly trustedKeys: ReadonlyMap<string, KeyObject>;
}

let fixture: VerificationFixture;

beforeAll(async () => {
  fixture = await verificationFixture();
});

function sha256(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function dssePae(payloadType: string, payload: Buffer): Buffer {
  const typeBytes = Buffer.from(payloadType, "utf8");
  return Buffer.concat([
    Buffer.from(`DSSEv1 ${String(typeBytes.byteLength)} `, "utf8"),
    typeBytes,
    Buffer.from(` ${String(payload.byteLength)} `, "utf8"),
    payload,
  ]);
}

function glbFixture(): Buffer {
  const positions = Buffer.alloc(36);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((value, index) => {
    positions.writeFloatLE(value, index * 4);
  });
  const indices = Buffer.alloc(6);
  indices.writeUInt16LE(0, 0);
  indices.writeUInt16LE(1, 2);
  indices.writeUInt16LE(2, 4);
  const binaryLength = positions.length + indices.length;
  const binary = Buffer.alloc(Math.ceil(binaryLength / 4) * 4);
  positions.copy(binary);
  indices.copy(binary, positions.length);
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
        byteLength: positions.length,
        target: 34962,
      },
      {
        buffer: 0,
        byteOffset: positions.length,
        byteLength: indices.length,
        target: 34963,
      },
    ],
    buffers: [{ byteLength: binaryLength }],
  };
  const json = Buffer.from(JSON.stringify(document), "utf8");
  const paddedJson = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20);
  json.copy(paddedJson);
  const output = Buffer.alloc(20 + paddedJson.length + 8 + binary.length);
  output.writeUInt32LE(0x46546c67, 0);
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(paddedJson.length, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  paddedJson.copy(output, 20);
  const binaryHeader = 20 + paddedJson.length;
  output.writeUInt32LE(binary.length, binaryHeader);
  output.writeUInt32LE(0x004e4942, binaryHeader + 4);
  binary.copy(output, binaryHeader + 8);
  return output;
}

async function verificationFixture(): Promise<VerificationFixture> {
  const source = glbFixture();
  const now = Date.now();
  const validFrom = new Date(now - 30_000).toISOString();
  const expiresAt = new Date(now + 10 * 60_000).toISOString();
  const sourceFacts = {
    assetId: "fresh-verifier-source",
    inputType: "glb_gltf" as const,
    mediaType: "model/gltf-binary" as const,
    sizeBytes: source.byteLength,
    sha256: sha256(source),
  };
  const acknowledgementPayload = {
    schemaVersion:
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_OPERATOR_ACKNOWLEDGEMENT_V0,
    acknowledgementId: "fresh-verifier-ack",
    operatorId: "fresh-verifier-operator",
    recordedAt: new Date(now).toISOString(),
    acknowledgement: "operator_records_private_offline_preview_intent" as const,
    statement:
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_OPERATOR_ACKNOWLEDGEMENT_STATEMENT,
    legalPosture:
      "operator_statement_not_independent_rights_approval" as const,
    authorizationPosture:
      "operator_statement_recorded_not_a_permit" as const,
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
  const acknowledgement =
    FoundryOfflineNormalizeMeshGlbPreviewOperatorAcknowledgementV0Schema.parse({
      ...acknowledgementPayload,
      acknowledgementSha256:
        computeFoundryOfflineNormalizeMeshGlbPreviewOperatorAcknowledgementSha256(
          acknowledgementPayload,
        ),
    });
  const permit = FoundryOfflineNormalizeMeshGlbPreviewPermitV0Schema.parse({
    schemaVersion: FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_V0,
    permitId: "fresh-verifier-permit",
    issuerKeyId: KEY_ID,
    validFrom,
    expiresAt,
    purpose: "private_offline_format_normalization_preview",
    actions: ["normalize_mesh_glb_to_private_preview_bytes"],
    source: sourceFacts,
    operation: acknowledgement.operation,
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
  const keyPair = generateKeyPairSync("ed25519");
  const signature = sign(
    null,
    dssePae(
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_PAYLOAD_TYPE,
      payload,
    ),
    keyPair.privateKey,
  );
  const envelope = {
    payloadType:
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_PAYLOAD_TYPE,
    payload: payload.toString("base64"),
    signatures: [{
      keyid: KEY_ID,
      sig: signature.toString("base64"),
    }],
  };
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
        payloadSha256: sha256(payload),
        keyId: KEY_ID,
        expiresAt,
      },
      operatorAcknowledgement: acknowledgement,
      operatorAcknowledgementSha256: acknowledgement.acknowledgementSha256,
      outputPolicy: structuredClone(
        FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_OUTPUT_POLICY_V0,
      ),
      executionBoundary: structuredClone(
        FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_EXECUTION_BOUNDARY_V0,
      ),
      authority: "none",
    });
  const trustedKeys = new Map([[KEY_ID, keyPair.publicKey]]);
  const transformed = await runFoundryOfflineNormalizeMeshGlbPreview({
    invocation,
    sourceBytes: source,
    permitEnvelope: envelope,
    pinnedTrustedPermitKeys: trustedKeys,
  });
  return {
    source,
    candidate: Buffer.from(transformed.normalizedGlb),
    invocation,
    envelope,
    report: transformed.report,
    trustedKeys,
  };
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function inputFor(
  value: VerificationFixture,
): LocalOfflineNormalizationPreviewVerifierInput {
  return {
    schemaVersion: LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_INPUT_V0,
    freshSourceBytes: asArrayBuffer(value.source),
    candidateOutputBytes: asArrayBuffer(value.candidate),
    invocation: structuredClone(value.invocation),
    permitEnvelope: structuredClone(value.envelope),
    report: structuredClone(value.report),
    pinnedTrustedPermitKeys: new Map(value.trustedKeys),
  };
}

function expectCleared(bytes: ArrayBuffer): void {
  expect([...new Uint8Array(bytes)]).toEqual(
    Array.from({ length: bytes.byteLength }, () => 0),
  );
}

async function workerMessage(
  input: LocalOfflineNormalizationPreviewVerifierInput,
): Promise<unknown> {
  const require = createRequire(import.meta.url);
  const tsxApiUrl = pathToFileURL(require.resolve("tsx/esm/api")).href;
  const sourceEntryUrl = new URL(
    "../offline-normalization-preview-verifier.worker.ts",
    import.meta.url,
  ).href;
  const tsconfigPath = fileURLToPath(
    new URL("../../tsconfig.json", import.meta.url),
  );
  const parentUrl = import.meta.url;
  const bootstrap = `void (async () => { const { tsImport } = await import(${JSON.stringify(
    tsxApiUrl,
  )}); await tsImport(${JSON.stringify(sourceEntryUrl)}, { parentURL: ${JSON.stringify(
    parentUrl,
  )}, tsconfig: ${JSON.stringify(tsconfigPath)} }); })();`;
  const worker = new Worker(bootstrap, {
    eval: true,
    workerData: input,
    transferList: [input.freshSourceBytes, input.candidateOutputBytes],
    resourceLimits:
      LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_RESOURCE_LIMITS,
    env: { TSX_DISABLE_CACHE: "1" },
  });
  return new Promise((resolve, reject) => {
    worker.once("message", resolve);
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`fresh-verification Worker exited with ${String(code)}`));
      }
    });
  });
}

describe("offline normalization preview fresh-verification Worker", () => {
  it("pins finite resource and host-deadline limits without a sandbox claim", () => {
    expect(LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_RESOURCE_LIMITS).toEqual({
      maxOldGenerationSizeMb: 512,
      maxYoungGenerationSizeMb: 64,
      codeRangeSizeMb: 64,
      stackSizeMb: 4,
    });
    expect(LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_MAX_RUNTIME_MS).toBe(
      60_000,
    );
  });

  it("strictly parses only the bounded public-key input contract", () => {
    const input = inputFor(fixture);
    const parsed = parseLocalOfflineNormalizationPreviewVerifierInput(input);
    expect(parsed.schemaVersion).toBe(
      LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_INPUT_V0,
    );
    expect(parsed.pinnedTrustedPermitKeys.get(KEY_ID)?.type).toBe("public");
    expect(() =>
      parseLocalOfflineNormalizationPreviewVerifierInput({
        ...inputFor(fixture),
        sourcePath: "C:/private/source.glb",
      })
    ).toThrow("Invalid fresh-verification Worker input.");
    const aliased = asArrayBuffer(fixture.source);
    expect(() =>
      parseLocalOfflineNormalizationPreviewVerifierInput({
        ...inputFor(fixture),
        freshSourceBytes: aliased,
        candidateOutputBytes: aliased,
      })
    ).toThrow("Invalid fresh-verification Worker input.");
    const privateKey = createPrivateKey(
      generateKeyPairSync("ed25519").privateKey.export({
        type: "pkcs8",
        format: "pem",
      }),
    );
    expect(() =>
      parseLocalOfflineNormalizationPreviewVerifierInput({
        ...inputFor(fixture),
        pinnedTrustedPermitKeys: new Map([[KEY_ID, privateKey]]),
      })
    ).toThrow("Invalid fresh-verification Worker input.");
    const whitespaceEnvelope = inputFor(fixture);
    expect(() =>
      parseLocalOfflineNormalizationPreviewVerifierInput({
        ...whitespaceEnvelope,
        permitEnvelope: {
          ...whitespaceEnvelope.permitEnvelope,
          payloadType: ` ${whitespaceEnvelope.permitEnvelope.payloadType}`,
        },
      })
    ).toThrow("Invalid fresh-verification Worker input.");
  });

  it("returns the candidate only after full deterministic verification and clears the source view", async () => {
    const input = inputFor(fixture);
    const expectedCandidate = Buffer.from(input.candidateOutputBytes);
    const result =
      await executeLocalOfflineNormalizationPreviewFreshVerification(input);
    expect(result.kind).toBe("verified");
    if (result.kind !== "verified") throw new Error("expected verified result");
    expect(Buffer.from(result.candidateOutputBytes)).toEqual(expectedCandidate);
    expect(result.report).toEqual(fixture.report);
    expectCleared(input.freshSourceBytes);
    expect(Buffer.from(input.candidateOutputBytes)).toEqual(expectedCandidate);
  });

  it("returns one safe failure code and clears both byte views when verification fails", async () => {
    const input = inputFor(fixture);
    const candidate = new Uint8Array(input.candidateOutputBytes);
    const original = candidate[24];
    if (original === undefined) throw new Error("candidate fixture is too short");
    candidate[24] = original ^ 0xff;
    const result =
      await executeLocalOfflineNormalizationPreviewFreshVerification(input);
    expect(result).toEqual({
      schemaVersion:
        LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_RESULT_V0,
      kind: "failed",
      code:
        LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_FAILURE_CODES.verificationFailed,
    });
    expectCleared(input.freshSourceBytes);
    expectCleared(input.candidateOutputBytes);
  });

  it("clears recognizable buffers when strict input parsing rejects an extra field", async () => {
    const input = inputFor(fixture);
    const result =
      await executeLocalOfflineNormalizationPreviewFreshVerification({
        ...input,
        command: "do-not-accept",
      });
    expect(result).toEqual({
      schemaVersion:
        LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_RESULT_V0,
      kind: "failed",
      code:
        LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_FAILURE_CODES.inputInvalid,
    });
    expectCleared(input.freshSourceBytes);
    expectCleared(input.candidateOutputBytes);
  });

  it("strictly parses success and fixed failure results", () => {
    const success = {
      schemaVersion:
        LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_RESULT_V0,
      kind: "verified",
      candidateOutputBytes: asArrayBuffer(fixture.candidate),
      report: structuredClone(fixture.report),
    };
    expect(parseLocalOfflineNormalizationPreviewVerifierResult(success)).toEqual(
      success,
    );
    expect(() =>
      parseLocalOfflineNormalizationPreviewVerifierResult({
        ...success,
        path: "not-allowed",
      })
    ).toThrow("Invalid fresh-verification Worker input.");
    expectCleared(success.candidateOutputBytes);
    expect(() =>
      parseLocalOfflineNormalizationPreviewVerifierResult({
        schemaVersion:
          LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_RESULT_V0,
        kind: "failed",
        code: "RAW_INTERNAL_ERROR",
      })
    ).toThrow("Invalid fresh-verification Worker input.");
  });

  it("runs through the standalone Worker with transferred input and output buffers", async () => {
    const input = inputFor(fixture);
    const messagePromise = workerMessage(input);
    expect(input.freshSourceBytes.byteLength).toBe(0);
    expect(input.candidateOutputBytes.byteLength).toBe(0);
    const result = parseLocalOfflineNormalizationPreviewVerifierResult(
      await messagePromise,
    );
    expect(result.kind).toBe("verified");
    if (result.kind !== "verified") throw new Error("expected verified result");
    expect(Buffer.from(result.candidateOutputBytes)).toEqual(fixture.candidate);
    expect(result.report).toEqual(fixture.report);
  });
});
