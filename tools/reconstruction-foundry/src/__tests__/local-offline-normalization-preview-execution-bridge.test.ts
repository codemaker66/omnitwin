import {
  createHash,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const witnessRegistry = vi.hoisted(() => ({
  live: new WeakSet(),
  evidence: new WeakMap<object, unknown>(),
}));

vi.mock(
  "../local-offline-normalization-preview-docker-sandbox.js",
  async (
    importOriginal: () => Promise<typeof import(
      "../local-offline-normalization-preview-docker-sandbox.js"
    )>,
  ) => {
    const actual = await importOriginal();
    return {
      ...actual,
      isLocalOfflinePreviewDockerSandboxLiveWitness: (value: unknown) =>
        typeof value === "object" &&
        value !== null &&
        witnessRegistry.live.has(value),
      localOfflinePreviewDockerSandboxLiveWitnessMatchesEvidence: (
        witness: unknown,
        evidence: unknown,
      ) =>
        typeof witness === "object" &&
        witness !== null &&
        witnessRegistry.live.has(witness) &&
        witnessRegistry.evidence.get(witness) === evidence,
    };
  },
);

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
  computeFoundryOfflineNormalizeMeshGlbPreviewInvocationSha256,
  computeFoundryOfflineNormalizeMeshGlbPreviewOperatorAcknowledgementSha256,
  runFoundryOfflineNormalizeMeshGlbPreview,
  serializeFoundryOfflineNormalizeMeshGlbPreviewPermitV0,
  type FoundryOfflineNormalizeMeshGlbPreviewInvocationV0,
  type FoundryOfflineNormalizeMeshGlbPreviewReportV0,
} from "../../../../packages/reconstruction-foundry/src/offline-normalize-mesh-glb-preview.js";
import {
  decodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage,
} from "../../../../packages/reconstruction-foundry/src/offline-normalize-mesh-glb-preview-sandbox-wire.js";
import {
  __testOnlyCreateLocalOfflineNormalizationPreviewDockerExecutionBridge,
  localOfflineNormalizationPreviewExecutionProofMatches,
} from "../local-offline-normalization-preview-execution-bridge.js";
import type {
  LocalOfflinePreviewDockerSandboxBackend,
  LocalOfflinePreviewDockerSandboxLiveWitness,
  LocalOfflinePreviewDockerSandboxSession,
} from "../local-offline-normalization-preview-docker-sandbox.js";

const KEY_ID = "execution-bridge-test-key";
const REQUEST_ID = "aabbccddeeff00112233445566778899";
const POLICY_DIGEST = `sha256:${"1".repeat(64)}`;
const ENGINE_DIGEST = `sha256:${"2".repeat(64)}`;
const EVIDENCE_DIGEST = `sha256:${"3".repeat(64)}`;
const RELEASE_DIGEST = `sha256:${"4".repeat(64)}`;
const QUALIFICATION_DIGEST = `sha256:${"5".repeat(64)}`;

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
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((value, index) =>
    positions.writeFloatLE(value, index * 4),
  );
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

interface Fixture {
  readonly source: Buffer;
  readonly candidate: Buffer;
  readonly report: FoundryOfflineNormalizeMeshGlbPreviewReportV0;
  readonly invocation: FoundryOfflineNormalizeMeshGlbPreviewInvocationV0;
  readonly envelope: unknown;
  readonly publicKey: KeyObject;
  readonly deadlineAt: string;
}

async function fixture(): Promise<Fixture> {
  const source = glbFixture();
  const now = Date.now();
  const expiresAt = new Date(now + 5 * 60_000).toISOString();
  const sourceFacts = {
    assetId: "execution-bridge-source",
    inputType: "glb_gltf" as const,
    mediaType: "model/gltf-binary" as const,
    sizeBytes: source.byteLength,
    sha256: sha256(source),
  };
  const acknowledgementPayload = {
    schemaVersion:
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_OPERATOR_ACKNOWLEDGEMENT_V0,
    acknowledgementId: "execution-bridge-ack",
    operatorId: "execution-bridge-operator",
    recordedAt: new Date(now).toISOString(),
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
    permitId: "execution-bridge-permit",
    issuerKeyId: KEY_ID,
    validFrom: new Date(now - 30_000).toISOString(),
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
  const keys = generateKeyPairSync("ed25519");
  const signature = sign(
    null,
    dssePae(
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_PAYLOAD_TYPE,
      payload,
    ),
    keys.privateKey,
  );
  const envelope = {
    payloadType:
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_PAYLOAD_TYPE,
    payload: payload.toString("base64"),
    signatures: [{ keyid: KEY_ID, sig: signature.toString("base64") }],
  };
  const invocation = FoundryOfflineNormalizeMeshGlbPreviewInvocationV0Schema.parse({
    schemaVersion: FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_INVOCATION_V0,
    operation: FOUNDRY_NORMALIZE_MESH_GLB_OPERATION,
    operationVersion: FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_VERSION,
    sealedIdentity: [...FOUNDRY_NORMALIZE_MESH_GLB_SEALED_IDENTITY],
    executionMode: FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_EXECUTION_MODE,
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
  const transformed = await runFoundryOfflineNormalizeMeshGlbPreview({
    invocation,
    sourceBytes: source,
    permitEnvelope: envelope,
    pinnedTrustedPermitKeys: new Map([[KEY_ID, keys.publicKey]]),
  });
  return {
    source,
    candidate: transformed.normalizedGlb,
    report: transformed.report,
    invocation,
    envelope,
    publicKey: keys.publicKey,
    deadlineAt: new Date(now + 60_000).toISOString(),
  };
}

type WitnessMode = "authentic" | "absent" | "fake" | "mismatch";

function backendFixture(
  value: Fixture,
  witnessMode: WitnessMode = "authentic",
  options: { readonly stopError?: Error } = {},
) {
  let liveSessions = 0;
  let sessionStopCalls = 0;
  let stopAllCalls = 0;
  let reserveCalls = 0;
  let transformCalls = 0;
  let verifierCalls = 0;
  const session: LocalOfflinePreviewDockerSandboxSession = {
    requestId: REQUEST_ID,
    deadlineAt: value.deadlineAt,
    runTransform(wire) {
      transformCalls += 1;
      const decoded =
        decodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage(wire);
      expect(decoded.kind).toBe("transform_request");
      if (decoded.kind !== "transform_request") throw new Error("wrong wire");
      expect(decoded.metadata.requestId).toBe(REQUEST_ID);
      expect(decoded.metadata.deadlineAt).toBe(value.deadlineAt);
      expect(decoded.metadata.invocation).toEqual(value.invocation);
      expect(decoded.metadata.permitEnvelope).toEqual(value.envelope);
      expect(decoded.metadata.permitPublicKey.keyId).toBe(KEY_ID);
      expect(decoded.sourceBytes).toEqual(value.source);
      return Promise.resolve({
        outputBytes: Buffer.from(value.candidate),
        report: value.report,
        receiptClaim: {} as never,
      });
    },
    runFreshVerifier(wire) {
      verifierCalls += 1;
      const decoded =
        decodeFoundryOfflineNormalizeMeshGlbPreviewSandboxWireMessage(wire);
      expect(decoded.kind).toBe("fresh_verifier_request");
      if (decoded.kind !== "fresh_verifier_request") {
        throw new Error("wrong verifier wire");
      }
      expect(decoded.sourceBytes).toEqual(value.source);
      expect(decoded.candidateBytes).toEqual(value.candidate);
      expect(decoded.metadata.report).toEqual(value.report);
      liveSessions = 0;
      const source = {
        sizeBytes: value.source.byteLength,
        sha256: sha256(value.source),
      };
      const candidate = {
        sizeBytes: value.candidate.byteLength,
        sha256: sha256(value.candidate),
      };
      const witness = {
        sandboxEstablished: true as const,
        backend: "docker_linux_shared_kernel" as const,
        requestId: REQUEST_ID,
        deadlineAt: witnessMode === "mismatch"
          ? new Date(Date.parse(value.deadlineAt) - 1).toISOString()
          : value.deadlineAt,
        invocationSha256:
          computeFoundryOfflineNormalizeMeshGlbPreviewInvocationSha256(
            value.invocation,
          ),
        permitPayloadSha256: value.invocation.permit.payloadSha256,
        policyDigest: POLICY_DIGEST,
        engineDigest: ENGINE_DIGEST,
        source,
        candidate,
        reportSha256: value.report.reportSha256,
        evidenceDigest: EVIDENCE_DIGEST,
        releaseManifestSha256: RELEASE_DIGEST,
        qualificationReportSha256: QUALIFICATION_DIGEST,
        toJSON: () => ({
          sandboxEstablished: false as const,
          claimStatus: "unauthenticated_integrity_claim" as const,
          attestationAuthority: "none" as const,
        }),
      } satisfies LocalOfflinePreviewDockerSandboxLiveWitness;
      const evidence = Object.freeze({ evidenceDigest: EVIDENCE_DIGEST });
      if (witnessMode === "authentic" || witnessMode === "mismatch") {
        witnessRegistry.live.add(witness);
        witnessRegistry.evidence.set(witness, evidence);
      }
      return Promise.resolve({
        receiptClaim: {} as never,
        evidenceClaim: evidence as never,
        liveWitness: witnessMode === "absent"
          ? null
          : witness,
      });
    },
    stop() {
      sessionStopCalls += 1;
      if (options.stopError !== undefined) {
        return Promise.reject(options.stopError);
      }
      liveSessions = 0;
      return Promise.resolve();
    },
  };
  const backend: LocalOfflinePreviewDockerSandboxBackend = {
    runtimeMode: "cryptographically_verified_bundled_qualification_private_preview",
    liveAuthorityCapable: true,
    authority: "cryptographically_verified_bundled_release",
    productionUse: "disabled",
    policy: {} as never,
    reconcileExpired: () => Promise.resolve(),
    reserveSession(input) {
      reserveCalls += 1;
      expect(input.invocation).toEqual(value.invocation);
      expect(input.permitEnvelope).toEqual(value.envelope);
      expect(input.deadlineAt).toBe(value.deadlineAt);
      liveSessions = 1;
      return Promise.resolve(session);
    },
    stopAll() {
      stopAllCalls += 1;
      liveSessions = 0;
      return Promise.resolve();
    },
    toJSON: () => ({
      runtimeMode: "test_only_disabled",
      liveAuthorityCapable: false,
      authority: "none",
      productionUse: "disabled",
    }),
  };
  return {
    backend,
    state: () => ({
      liveSessions,
      reserveCalls,
      sessionStopCalls,
      stopAllCalls,
      transformCalls,
      verifierCalls,
    }),
  };
}

function proxyHidingAbortedSignal(): AbortSignal {
  const abort = new AbortController();
  abort.abort(new Error("already cancelled"));
  return new Proxy(abort.signal, {
    get(target, property): unknown {
      if (property === "aborted") return false;
      return Reflect.get(target, property, target) as unknown;
    },
  });
}

function reservation(value: Fixture) {
  return {
    deadlineAt: value.deadlineAt,
    invocation: value.invocation,
    permitEnvelope: value.envelope,
    permitPublicKey: value.publicKey,
    permitPayloadSha256: value.invocation.permit.payloadSha256,
  };
}

describe("offline preview Docker execution bridge", () => {
  it("encodes both exact wire messages, authenticates a live witness, and leaves no live session", async () => {
    const value = await fixture();
    const fake = backendFixture(value);
    const bridge =
      __testOnlyCreateLocalOfflineNormalizationPreviewDockerExecutionBridge(
        () => Promise.resolve(fake.backend),
      );
    const abort = new AbortController();
    const session = await bridge.reserveSession(reservation(value), abort.signal);
    const transformed = await session.runTransform({
      sourceBytes: value.source,
      signal: abort.signal,
    });
    const verified = await session.runFreshVerifier({
      freshSourceBytes: value.source,
      candidateBytes: transformed.candidateBytes,
      report: transformed.report,
      signal: abort.signal,
    });

    const expected = {
      deadlineAt: value.deadlineAt,
      invocation: value.invocation,
      permitPayloadSha256: value.invocation.permit.payloadSha256,
      sourceBytes: value.source,
      candidateBytes: value.candidate,
      report: value.report,
    };
    expect(
      localOfflineNormalizationPreviewExecutionProofMatches(
        verified.proof,
        expected,
      ),
    ).toBe(true);
    expect(fake.state()).toMatchObject({
      liveSessions: 0,
      reserveCalls: 1,
      sessionStopCalls: 0,
    });
    expect(JSON.stringify(verified.proof)).toBe(
      '{"sandboxEstablished":false,"claimStatus":"unauthenticated_integrity_claim"}',
    );

    const alteredSource = Buffer.from(value.source);
    const alteredSourceByte = alteredSource[alteredSource.length - 1];
    if (alteredSourceByte === undefined) throw new Error("source is empty");
    alteredSource[alteredSource.length - 1] = alteredSourceByte ^ 0xff;
    const alteredCandidate = Buffer.from(value.candidate);
    const alteredCandidateByte = alteredCandidate[alteredCandidate.length - 1];
    if (alteredCandidateByte === undefined) throw new Error("candidate is empty");
    alteredCandidate[alteredCandidate.length - 1] = alteredCandidateByte ^ 0xff;
    const alteredInvocation = structuredClone(value.invocation);
    alteredInvocation.source.assetId = "different-source";
    const alteredReport = structuredClone(value.report);
    alteredReport.reportSha256 = `sha256:${"f".repeat(64)}`;
    const alteredReportPayload = structuredClone(value.report);
    alteredReportPayload.output.sizeBytes += 1;
    expect(localOfflineNormalizationPreviewExecutionProofMatches(
      verified.proof,
      { ...expected, sourceBytes: alteredSource },
    )).toBe(false);
    expect(localOfflineNormalizationPreviewExecutionProofMatches(
      verified.proof,
      { ...expected, candidateBytes: alteredCandidate },
    )).toBe(false);
    expect(localOfflineNormalizationPreviewExecutionProofMatches(
      verified.proof,
      { ...expected, deadlineAt: new Date(Date.parse(value.deadlineAt) - 1).toISOString() },
    )).toBe(false);
    expect(localOfflineNormalizationPreviewExecutionProofMatches(
      verified.proof,
      { ...expected, permitPayloadSha256: `sha256:${"e".repeat(64)}` },
    )).toBe(false);
    expect(localOfflineNormalizationPreviewExecutionProofMatches(
      verified.proof,
      { ...expected, invocation: alteredInvocation },
    )).toBe(false);
    expect(localOfflineNormalizationPreviewExecutionProofMatches(
      verified.proof,
      { ...expected, report: alteredReport },
    )).toBe(false);
    expect(localOfflineNormalizationPreviewExecutionProofMatches(
      verified.proof,
      { ...expected, report: alteredReportPayload },
    )).toBe(false);

    await bridge.stopAll();
    await bridge.stopAll();
    expect(fake.state().stopAllCalls).toBe(1);
    // A successful verifier removed its resources; controller success must not
    // call session.stop() after proof acceptance.
    expect(fake.state().sessionStopCalls).toBe(0);
  });

  it.each(["absent", "fake", "mismatch"] as const)(
    "fails closed for a %s live witness",
    async (mode) => {
      const value = await fixture();
      const fake = backendFixture(value, mode);
      const bridge =
        __testOnlyCreateLocalOfflineNormalizationPreviewDockerExecutionBridge(
          () => Promise.resolve(fake.backend),
        );
      const abort = new AbortController();
      const session = await bridge.reserveSession(
        reservation(value),
        abort.signal,
      );
      const transformed = await session.runTransform({
        sourceBytes: value.source,
        signal: abort.signal,
      });

      await expect(session.runFreshVerifier({
        freshSourceBytes: value.source,
        candidateBytes: transformed.candidateBytes,
        report: transformed.report,
        signal: abort.signal,
      })).rejects.toMatchObject({
        code: "LOCAL_OFFLINE_PREVIEW_SANDBOX_PROOF_REJECTED",
      });
      expect(fake.state().liveSessions).toBe(0);
    },
  );

  it("is lazy, fails closed when unavailable, and permits only one reservation attempt", async () => {
    const value = await fixture();
    let factoryCalls = 0;
    const unavailable =
      __testOnlyCreateLocalOfflineNormalizationPreviewDockerExecutionBridge(
        () => {
          factoryCalls += 1;
          return Promise.reject(Object.assign(new Error("unavailable"), {
            code: "BUNDLED_RELEASE_UNAVAILABLE",
          }));
        },
      );
    expect(factoryCalls).toBe(0);
    await expect(unavailable.reserveSession(
      reservation(value),
      new AbortController().signal,
    )).rejects.toMatchObject({ code: "BUNDLED_RELEASE_UNAVAILABLE" });
    await expect(unavailable.reserveSession(
      reservation(value),
      new AbortController().signal,
    )).rejects.toMatchObject({
      code: "LOCAL_OFFLINE_PREVIEW_EXECUTION_BRIDGE_ALREADY_USED",
    });
    expect(factoryCalls).toBe(1);
    await unavailable.stopAll();
  });

  it.each([
    "CLEANUP_UNPROVED",
    "PROCESS_TERMINATION_UNCONFIRMED",
    "RECONCILIATION_FAILED",
    "PERMIT_LEDGER_REJECTED",
  ] as const)(
    "preserves a side-effect-ambiguous factory failure through every stop: %s",
    async (code) => {
      const value = await fixture();
      const factoryFailure = Object.assign(
        new Error("backend initialization left operator-visible uncertainty"),
        { code },
      );
      const bridge =
        __testOnlyCreateLocalOfflineNormalizationPreviewDockerExecutionBridge(
          () => Promise.reject(factoryFailure),
        );

      await expect(bridge.reserveSession(
        reservation(value),
        new AbortController().signal,
      )).rejects.toBe(factoryFailure);
      const firstStop = bridge.stopAll();
      const secondStop = bridge.stopAll();
      expect(secondStop).toBe(firstStop);
      await expect(firstStop).rejects.toBe(factoryFailure);
      await expect(secondStop).rejects.toBe(factoryFailure);
      expect(bridge.stopAll()).toBe(firstStop);
    },
  );

  it("preserves cleanup uncertainty when Stop races a still-pending backend factory", async () => {
    const value = await fixture();
    const factoryFailure = Object.assign(
      new Error("preflight process termination remained unconfirmed"),
      { code: "PROCESS_TERMINATION_UNCONFIRMED" },
    );
    let rejectFactory!: (reason: unknown) => void;
    const pendingFactory = new Promise<never>((_resolve, reject) => {
      rejectFactory = reject;
    });
    const bridge =
      __testOnlyCreateLocalOfflineNormalizationPreviewDockerExecutionBridge(
        () => pendingFactory,
      );

    const reserving = bridge.reserveSession(
      reservation(value),
      new AbortController().signal,
    );
    const stopping = bridge.stopAll();
    const reserveAssertion = expect(reserving).rejects.toBe(factoryFailure);
    const stopAssertion = expect(stopping).rejects.toBe(factoryFailure);
    rejectFactory(factoryFailure);

    await reserveAssertion;
    await stopAssertion;
    expect(bridge.stopAll()).toBe(stopping);
    await expect(bridge.stopAll()).rejects.toBe(factoryFailure);
  });

  it("rejects invalid process inputs and hostile signals before any backend or container exists", async () => {
    const value = await fixture();

    for (const invalid of [
      {
        ...reservation(value),
        permitPublicKey: {} as KeyObject,
      },
      {
        ...reservation(value),
        permitEnvelope: new Proxy(value.envelope as object, {}),
      },
    ]) {
      const fake = backendFixture(value);
      let factoryCalls = 0;
      const bridge =
        __testOnlyCreateLocalOfflineNormalizationPreviewDockerExecutionBridge(
          () => {
            factoryCalls += 1;
            return Promise.resolve(fake.backend);
          },
        );
      await expect(bridge.reserveSession(
        invalid,
        new AbortController().signal,
      )).rejects.toBeInstanceOf(Error);
      expect(factoryCalls).toBe(0);
      expect(fake.state()).toMatchObject({
        reserveCalls: 0,
        liveSessions: 0,
        sessionStopCalls: 0,
      });
    }

    const fake = backendFixture(value);
    let factoryCalls = 0;
    const bridge =
      __testOnlyCreateLocalOfflineNormalizationPreviewDockerExecutionBridge(
        () => {
          factoryCalls += 1;
          return Promise.resolve(fake.backend);
        },
      );
    const hostileSignal: AbortSignal = Object.create(AbortSignal.prototype);
    Object.defineProperty(hostileSignal, "aborted", {
      get: () => {
        throw new Error("hostile aborted getter");
      },
    });
    await expect(bridge.reserveSession(
      reservation(value),
      hostileSignal,
    )).rejects.toMatchObject({
      code: "LOCAL_OFFLINE_PREVIEW_EXECUTION_SIGNAL_REJECTED",
    });
    expect(factoryCalls).toBe(0);
    expect(fake.state()).toMatchObject({ reserveCalls: 0, liveSessions: 0 });
  });

  it.each([
    ["a duck-typed object", { aborted: false } as AbortSignal],
    ["a Proxy hiding an aborted native signal", proxyHidingAbortedSignal()],
  ] as const)(
    "rejects %s before reservation without consulting caller-owned signal properties",
    async (_label, hostileSignal) => {
      const value = await fixture();
      const fake = backendFixture(value);
      let factoryCalls = 0;
      const bridge =
        __testOnlyCreateLocalOfflineNormalizationPreviewDockerExecutionBridge(
          () => {
            factoryCalls += 1;
            return Promise.resolve(fake.backend);
          },
        );

      await expect(bridge.reserveSession(
        reservation(value),
        hostileSignal,
      )).rejects.toMatchObject({
        code: "LOCAL_OFFLINE_PREVIEW_EXECUTION_SIGNAL_REJECTED",
      });
      expect(factoryCalls).toBe(0);
      expect(fake.state()).toMatchObject({
        reserveCalls: 0,
        transformCalls: 0,
        verifierCalls: 0,
        liveSessions: 0,
      });
    },
  );

  it("rejects Proxy-hidden cancellation before transform and fresh verification", async () => {
    const transformValue = await fixture();
    const transformFake = backendFixture(transformValue);
    const transformBridge =
      __testOnlyCreateLocalOfflineNormalizationPreviewDockerExecutionBridge(
        () => Promise.resolve(transformFake.backend),
      );
    const transformSession = await transformBridge.reserveSession(
      reservation(transformValue),
      new AbortController().signal,
    );

    await expect(transformSession.runTransform({
      sourceBytes: transformValue.source,
      signal: proxyHidingAbortedSignal(),
    })).rejects.toMatchObject({
      code: "LOCAL_OFFLINE_PREVIEW_EXECUTION_SIGNAL_REJECTED",
    });
    expect(transformFake.state().transformCalls).toBe(0);
    await transformSession.stop();
    await transformBridge.stopAll();

    const verifierValue = await fixture();
    const verifierFake = backendFixture(verifierValue);
    const verifierBridge =
      __testOnlyCreateLocalOfflineNormalizationPreviewDockerExecutionBridge(
        () => Promise.resolve(verifierFake.backend),
      );
    const verifierSession = await verifierBridge.reserveSession(
      reservation(verifierValue),
      new AbortController().signal,
    );
    const transformed = await verifierSession.runTransform({
      sourceBytes: verifierValue.source,
      signal: new AbortController().signal,
    });

    await expect(verifierSession.runFreshVerifier({
      freshSourceBytes: verifierValue.source,
      candidateBytes: transformed.candidateBytes,
      report: transformed.report,
      signal: proxyHidingAbortedSignal(),
    })).rejects.toMatchObject({
      code: "LOCAL_OFFLINE_PREVIEW_EXECUTION_SIGNAL_REJECTED",
    });
    expect(verifierFake.state()).toMatchObject({
      transformCalls: 1,
      verifierCalls: 0,
    });
    await verifierSession.stop();
    await verifierBridge.stopAll();
  });

  it("cannot start a backend after a reservation getter reentrantly stops the bridge", async () => {
    const value = await fixture();
    const fake = backendFixture(value);
    let factoryCalls = 0;
    const bridge =
      __testOnlyCreateLocalOfflineNormalizationPreviewDockerExecutionBridge(
        () => {
          factoryCalls += 1;
          return Promise.resolve(fake.backend);
        },
      );
    const hostileReservation = { ...reservation(value) };
    Object.defineProperty(hostileReservation, "deadlineAt", {
      enumerable: true,
      get: () => {
        void bridge.stopAll();
        return value.deadlineAt;
      },
    });

    await expect(bridge.reserveSession(
      hostileReservation,
      new AbortController().signal,
    )).rejects.toMatchObject({
      code: "LOCAL_OFFLINE_PREVIEW_EXECUTION_BRIDGE_STOPPED",
    });
    await bridge.stopAll();
    expect(factoryCalls).toBe(0);
    expect(fake.state()).toMatchObject({
      reserveCalls: 0,
      stopAllCalls: 0,
      liveSessions: 0,
    });
    await expect(bridge.reserveSession(
      reservation(value),
      new AbortController().signal,
    )).rejects.toMatchObject({
      code: "LOCAL_OFFLINE_PREVIEW_EXECUTION_BRIDGE_STOPPED",
    });
  });

  it("stops a just-reserved session on abort and lets cleanup failure take precedence", async () => {
    const value = await fixture();
    const cleanupError = Object.assign(new Error("cleanup unproved"), {
      code: "CLEANUP_UNPROVED",
    });
    const fake = backendFixture(value, "authentic", { stopError: cleanupError });
    const abort = new AbortController();
    const backend: LocalOfflinePreviewDockerSandboxBackend = {
      ...fake.backend,
      async reserveSession(input) {
        const session = await fake.backend.reserveSession(input);
        abort.abort(Object.assign(new Error("cancelled"), {
          code: "EXECUTION_CANCELLED",
        }));
        return session;
      },
    };
    const bridge =
      __testOnlyCreateLocalOfflineNormalizationPreviewDockerExecutionBridge(
        () => Promise.resolve(backend),
      );

    await expect(bridge.reserveSession(
      reservation(value),
      abort.signal,
    )).rejects.toBe(cleanupError);
    expect(fake.state()).toMatchObject({
      reserveCalls: 1,
      sessionStopCalls: 1,
      liveSessions: 1,
    });
  });
});
