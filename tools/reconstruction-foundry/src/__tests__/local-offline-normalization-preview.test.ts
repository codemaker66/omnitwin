import {
  createHash,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";
import { EventEmitter } from "node:events";
import {
  link,
  mkdtemp,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_INPUT_V0,
  executeLocalOfflineNormalizationPreviewFreshVerification,
  type LocalOfflineNormalizationPreviewVerifierInput,
} from "../local-offline-normalization-preview-verifier.js";
import {
  LOCAL_OFFLINE_NORMALIZATION_PREVIEW_HELPER_RESULT_V0,
  LOCAL_OFFLINE_NORMALIZATION_PREVIEW_INITIAL_DTO,
  createLocalOfflineNormalizationPreviewController,
  type CreateLocalOfflineNormalizationPreviewControllerOptions,
  type LocalOfflineNormalizationPreviewHelperFactory,
  type LocalOfflineNormalizationPreviewHelperInput,
  type LocalOfflineNormalizationPreviewHelperLaunch,
  type LocalOfflineNormalizationPreviewHelperLike,
  type LocalOfflineNormalizationPreviewStartRequest,
} from "../local-offline-normalization-preview.js";

const KEY_ID = "local-preview-test-key";
const PREVIEW_ASSET_ID = "fixture-preview";
const SOURCE_ASSET_ID = "fixture-mesh";
const RECEIPT_SHA256 = sha256Hex(Buffer.from("fixture-receipt", "utf8"));
const TOOL_PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const tempRoots: string[] = [];
let fixtureSequence = 0;

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    tempRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

function sha256(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function relativeEntrySnapshot(
  root: string,
  relativeRoot = "",
): Promise<string[]> {
  const absoluteRoot = relativeRoot.length === 0
    ? root
    : join(root, relativeRoot);
  const entries = await readdir(absoluteRoot, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = relativeRoot.length === 0
      ? entry.name
      : join(relativeRoot, entry.name);
    if (entry.isDirectory()) {
      files.push(`${relativePath}/`);
      files.push(...await relativeEntrySnapshot(root, relativePath));
    } else {
      files.push(relativePath);
    }
  }
  return files.sort();
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

class FakeHelper extends EventEmitter implements LocalOfflineNormalizationPreviewHelperLike {
  terminateCalls = 0;
  terminateImplementation: (() => Promise<number>) | null = null;

  async terminate(): Promise<number> {
    this.terminateCalls += 1;
    return this.terminateImplementation?.() ?? 0;
  }
}

function transferHelperInput(
  launch: LocalOfflineNormalizationPreviewHelperLaunch,
): LocalOfflineNormalizationPreviewHelperInput {
  const input = launch.options.workerData as
    LocalOfflineNormalizationPreviewHelperInput;
  const transferred = structuredClone(input, {
    transfer: [input.sourceBytes],
  });
  if (input.sourceBytes.byteLength !== 0) {
    throw new Error("test helper did not detach the transferred source buffer");
  }
  return transferred;
}

function transferVerifierInput(
  launch: LocalOfflineNormalizationPreviewHelperLaunch,
): LocalOfflineNormalizationPreviewVerifierInput {
  const input = launch.options.workerData as
    LocalOfflineNormalizationPreviewVerifierInput;
  const transferred = structuredClone(input, {
    transfer: [input.freshSourceBytes, input.candidateOutputBytes],
  });
  if (
    input.freshSourceBytes.byteLength !== 0 ||
    input.candidateOutputBytes.byteLength !== 0
  ) {
    throw new Error("test verifier did not detach transferred buffers");
  }
  return transferred;
}

function successHelperFactory(options: {
  readonly beforeMessage?: () => void | Promise<void>;
  readonly configureHelper?: (helper: FakeHelper) => void;
  readonly mutateOutput?: (output: Uint8Array) => void;
  readonly mutateReport?: (
    report: FoundryOfflineNormalizeMeshGlbPreviewReportV0,
  ) => void;
  readonly observeLaunch?: (
    launch: LocalOfflineNormalizationPreviewHelperLaunch,
  ) => void;
} = {}): LocalOfflineNormalizationPreviewHelperFactory {
  return (launch) => {
    if (
      launch.scriptUrl.pathname.endsWith(
        "/offline-normalization-preview-verifier.worker.js",
      )
    ) {
      const input = launch.options.workerData as
        LocalOfflineNormalizationPreviewVerifierInput;
      expect(input.schemaVersion).toBe(
        LOCAL_OFFLINE_NORMALIZATION_PREVIEW_VERIFIER_INPUT_V0,
      );
      const transferred = structuredClone(input, {
        transfer: [input.freshSourceBytes, input.candidateOutputBytes],
      });
      const helper = new FakeHelper();
      queueMicrotask(() => {
        void executeLocalOfflineNormalizationPreviewFreshVerification(
          transferred,
        ).then((result) => {
          helper.emit("message", result);
        }).catch((error: unknown) => {
          helper.emit(
            "error",
            error instanceof Error ? error : new Error(String(error)),
          );
        });
      });
      return helper;
    }
    options.observeLaunch?.(launch);
    const input = transferHelperInput(launch);
    const helper = new FakeHelper();
    options.configureHelper?.(helper);
    queueMicrotask(() => {
      void (async () => {
        try {
          const result = await runFoundryOfflineNormalizeMeshGlbPreview({
            invocation: input.invocation,
            sourceBytes: new Uint8Array(input.sourceBytes),
            permitEnvelope: input.permitEnvelope,
            pinnedTrustedPermitKeys: input.pinnedTrustedPermitKeys,
          });
          const output = Uint8Array.from(result.normalizedGlb);
          options.mutateOutput?.(output);
          const report = structuredClone(result.report);
          options.mutateReport?.(report);
          await options.beforeMessage?.();
          helper.emit("message", {
            schemaVersion:
              "omnitwin.local-offline-normalization-preview-helper-result.v0",
            kind: "completed",
            normalizedGlb: output.buffer,
            report,
          });
        } catch (error: unknown) {
          helper.emit(
            "error",
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      })();
    });
    return helper;
  };
}

function passiveHelperFactory(
  onCreated?: (helper: FakeHelper) => void,
): LocalOfflineNormalizationPreviewHelperFactory {
  return (launch) => {
    transferHelperInput(launch);
    const helper = new FakeHelper();
    onCreated?.(helper);
    return helper;
  };
}

function passiveVerifierFactory(
  onCreated?: (helper: FakeHelper) => void,
): LocalOfflineNormalizationPreviewHelperFactory {
  const transformFactory = successHelperFactory();
  return (launch) => {
    if (
      launch.scriptUrl.pathname.endsWith(
        "/offline-normalization-preview-verifier.worker.js",
      )
    ) {
      transferVerifierInput(launch);
      const helper = new FakeHelper();
      onCreated?.(helper);
      return helper;
    }
    return transformFactory(launch);
  };
}

function emittingHelperFactory(
  emitResult: (helper: FakeHelper) => void,
): LocalOfflineNormalizationPreviewHelperFactory {
  return (launch) => {
    transferHelperInput(launch);
    const helper = new FakeHelper();
    queueMicrotask(() => {
      emitResult(helper);
    });
    return helper;
  };
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("test condition timed out");
    await delay(1);
  }
}

async function settleWithin<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs = 1_000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} did not settle within ${String(timeoutMs)} ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

function expectFailureCode(
  value: { readonly state: string; readonly message: string },
  code: string,
  state = "failed",
): void {
  expect(value.state).toBe(state);
  expect(value.message).toContain(`(${code})`);
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

interface PreviewFixture {
  readonly source: Buffer;
  readonly sourcePath: string;
  readonly invocation: FoundryOfflineNormalizeMeshGlbPreviewInvocationV0;
  readonly envelope: {
    readonly payloadType: string;
    readonly payload: string;
    readonly signatures: readonly [{ readonly keyid: string; readonly sig: string }];
  };
  readonly trustedKeys: ReadonlyMap<string, KeyObject>;
  readonly request: LocalOfflineNormalizationPreviewStartRequest;
  readonly controllerOptions: CreateLocalOfflineNormalizationPreviewControllerOptions;
}

async function previewFixture(options: {
  readonly sourcePath?: string;
  readonly validFrom?: string;
  readonly expiresAt?: string;
  readonly tamperSignature?: boolean;
} = {}): Promise<PreviewFixture> {
  fixtureSequence += 1;
  const fixtureId = `fixture-${String(fixtureSequence)}`;
  const source = glbFixture();
  const now = Date.now();
  const validFrom = options.validFrom ?? new Date(now - 30_000).toISOString();
  const expiresAt = options.expiresAt ?? new Date(now + 5 * 60_000).toISOString();
  const sourceFacts = {
    assetId: SOURCE_ASSET_ID,
    inputType: "glb_gltf" as const,
    mediaType: "model/gltf-binary" as const,
    sizeBytes: source.byteLength,
    sha256: sha256(source),
  };
  const acknowledgementPayload = {
    schemaVersion:
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_OPERATOR_ACKNOWLEDGEMENT_V0,
    acknowledgementId: `${fixtureId}-ack`,
    operatorId: "fixture-operator",
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
    permitId: `${fixtureId}-permit`,
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
  if (options.tamperSignature === true) {
    const firstByte = signature[0];
    if (firstByte === undefined) throw new Error("Ed25519 signature is unexpectedly empty");
    signature[0] = firstByte ^ 0xff;
  }
  const envelope = {
    payloadType:
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_PAYLOAD_TYPE,
    payload: payload.toString("base64"),
    signatures: [{ keyid: KEY_ID, sig: signature.toString("base64") }] as const,
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
  const root = await mkdtemp(join(tmpdir(), "local-preview-controller-"));
  tempRoots.push(root);
  const sourcePath = options.sourcePath ?? join(root, "source.glb");
  if (options.sourcePath === undefined) await writeFile(sourcePath, source);
  const trustedKeys = new Map([[KEY_ID, keyPair.publicKey]]);
  const request = {
    receiptSha256: RECEIPT_SHA256,
    previewAssetId: PREVIEW_ASSET_ID,
    requestId: "0123456789abcdef0123456789abcdef",
  } as const;
  return {
    source,
    sourcePath,
    invocation,
    envelope,
    trustedKeys,
    request,
    controllerOptions: {
      assetsByPreviewAssetId: new Map([
        [
          PREVIEW_ASSET_ID,
          { receiptSha256: RECEIPT_SHA256, absolutePath: sourcePath },
        ],
      ]),
      evidenceByReceiptSha256: new Map([
        [
          RECEIPT_SHA256,
          { previewAssetId: PREVIEW_ASSET_ID, invocation, permitEnvelope: envelope },
        ],
      ]),
      pinnedTrustedPermitKeys: trustedKeys,
    },
  };
}

function controllerOptionsWithPath(
  fixture: PreviewFixture,
  absolutePath: string,
  overrides: Partial<CreateLocalOfflineNormalizationPreviewControllerOptions> = {},
): CreateLocalOfflineNormalizationPreviewControllerOptions {
  return {
    ...fixture.controllerOptions,
    assetsByPreviewAssetId: new Map([
      [
        PREVIEW_ASSET_ID,
        { receiptSha256: RECEIPT_SHA256, absolutePath },
      ],
    ]),
    ...overrides,
  };
}

describe("local offline normalization preview controller", () => {
  it("reports one exact ready preview without exposing paths or signed evidence", async () => {
    const fixture = await previewFixture();
    const controller = createLocalOfflineNormalizationPreviewController(
      fixture.controllerOptions,
    );

    const available = controller.availability(RECEIPT_SHA256);

    expect(available).toEqual({
      state: "ready",
      previewAssetId: PREVIEW_ASSET_ID,
      requestId: null,
      message: expect.any(String),
      source: {
        sizeBytes: fixture.source.byteLength,
        sha256: sha256(fixture.source),
      },
      output: null,
      productionExecution: "disabled",
      authority: "none",
      serverPersistence: "none",
      custody: "session_memory_only",
      trustedSourceOnly: true,
      localVolumeEstablished: false,
      sandboxEstablished: false,
    });
    const serialized = JSON.stringify(available);
    expect(serialized).not.toContain(fixture.sourcePath);
    expect(serialized).not.toContain(fixture.envelope.payload);
    expect(serialized).not.toContain(fixture.envelope.signatures[0].sig);
    expect(serialized).not.toContain(KEY_ID);
  });

  it("keeps availability blocked for absent configuration or the wrong receipt", async () => {
    const fixture = await previewFixture();
    const empty = createLocalOfflineNormalizationPreviewController({
      assetsByPreviewAssetId: new Map(),
      evidenceByReceiptSha256: new Map(),
      pinnedTrustedPermitKeys: new Map(),
    });
    const configured = createLocalOfflineNormalizationPreviewController(
      fixture.controllerOptions,
    );

    expect(empty.availability(RECEIPT_SHA256)).toMatchObject({
      state: "blocked",
      previewAssetId: null,
      requestId: null,
      source: null,
    });
    expect(configured.availability(sha256Hex(Buffer.from("wrong-receipt")))).toMatchObject({
      state: "blocked",
      previewAssetId: null,
      requestId: null,
      source: null,
    });
  });

  it("rechecks permit expiry whenever availability is requested", async () => {
    const now = Date.now();
    const fixture = await previewFixture({
      validFrom: new Date(now - 120_000).toISOString(),
      expiresAt: new Date(now - 60_000).toISOString(),
    });
    const controller = createLocalOfflineNormalizationPreviewController(
      fixture.controllerOptions,
    );

    expect(controller.availability(RECEIPT_SHA256)).toMatchObject({
      state: "blocked",
      previewAssetId: null,
      requestId: null,
      source: null,
    });
  });

  it("starts the real default Worker, verifies its output again, and writes no output files", async () => {
    const fixture = await previewFixture();
    const packageEntriesBefore = await relativeEntrySnapshot(TOOL_PACKAGE_ROOT);
    const controller = createLocalOfflineNormalizationPreviewController(
      fixture.controllerOptions,
    );

    expect(controller.snapshot()).toEqual(
      LOCAL_OFFLINE_NORMALIZATION_PREVIEW_INITIAL_DTO,
    );
    expect(controller.prepare(fixture.request)).toMatchObject({
      state: "ready",
      source: {
        sizeBytes: fixture.source.byteLength,
        sha256: sha256(fixture.source),
      },
      output: null,
      authority: "none",
      productionExecution: "disabled",
      localVolumeEstablished: false,
      sandboxEstablished: false,
    });

    const completed = await controller.start(fixture.request);

    expect(completed).toMatchObject({
      state: "verified",
      previewAssetId: PREVIEW_ASSET_ID,
      requestId: fixture.request.requestId,
      output: { semanticExactMatch: true },
      serverPersistence: "none",
      custody: "session_memory_only",
    });
    const retained = controller.readVerifiedResult(fixture.request.requestId);
    expect(retained?.normalizedGlb.byteLength).toBe(
      completed.output?.sizeBytes,
    );
    expect(sha256(retained?.normalizedGlb ?? Buffer.alloc(0))).toBe(
      completed.output?.sha256,
    );
    expect(await readdir(join(fixture.sourcePath, ".."))).toEqual([
      "source.glb",
    ]);
    expect(await relativeEntrySnapshot(TOOL_PACKAGE_ROOT)).toEqual(
      packageEntriesBefore,
    );
    await controller.stop();
    expect(controller.readVerifiedResult(fixture.request.requestId)).toBeNull();
  }, 30_000);

  it("sends only strict evidence and a dedicated transferable byte buffer to the helper", async () => {
    const fixture = await previewFixture();
    const decoyKey = generateKeyPairSync("ed25519").publicKey;
    let observed = false;
    const helperFactory = successHelperFactory({
      observeLaunch: (launch) => {
        observed = true;
        const input = launch.options.workerData as
          LocalOfflineNormalizationPreviewHelperInput;
        expect(Object.keys(input).sort()).toEqual([
          "invocation",
          "permitEnvelope",
          "pinnedTrustedPermitKeys",
          "schemaVersion",
          "sourceBytes",
        ]);
        expect([...input.pinnedTrustedPermitKeys.keys()]).toEqual([KEY_ID]);
        expect(launch.options.transferList).toEqual([input.sourceBytes]);
        expect(launch.options.env).toEqual({ TSX_DISABLE_CACHE: "1" });
        expect(launch.options.resourceLimits).toEqual({
          maxOldGenerationSizeMb: 512,
          maxYoungGenerationSizeMb: 64,
          codeRangeSizeMb: 64,
          stackSizeMb: 4,
        });
        const serialized = JSON.stringify(input);
        expect(serialized).not.toContain(fixture.sourcePath);
        expect(serialized).not.toContain("absolutePath");
        expect(serialized).not.toContain("outputPath");
        expect(serialized).not.toContain("command");
        expect(serialized).not.toContain("url");
      },
    });
    const controller = createLocalOfflineNormalizationPreviewController({
      ...fixture.controllerOptions,
      pinnedTrustedPermitKeys: new Map([
        ...fixture.trustedKeys,
        ["decoy-key", decoyKey] as const,
      ]),
      helperFactory,
    });

    const completed = await controller.start(fixture.request);

    expect(completed.state).toBe("verified");
    expect(observed).toBe(true);
    await controller.stop();
  });

  it("terminates a helper that exceeds its fixed time limit", async () => {
    const fixture = await previewFixture();
    const helper = { current: null as FakeHelper | null };
    const controller = createLocalOfflineNormalizationPreviewController({
      ...fixture.controllerOptions,
      helperTimeoutMs: 25,
      helperFactory: passiveHelperFactory((created) => {
        helper.current = created;
      }),
    });

    const completed = await controller.start(fixture.request);

    expectFailureCode(completed, "LOCAL_OFFLINE_PREVIEW_OPERATION_TIMEOUT");
    expect(helper.current?.terminateCalls).toBe(1);
    expect(controller.readVerifiedResult(fixture.request.requestId)).toBeNull();
  });

  it("uses permit expiry as a hard helper deadline", async () => {
    const now = Date.now();
    const fixture = await previewFixture({
      validFrom: new Date(now - 30_000).toISOString(),
      expiresAt: new Date(now + 150).toISOString(),
    });
    const helper = { current: null as FakeHelper | null };
    const controller = createLocalOfflineNormalizationPreviewController({
      ...fixture.controllerOptions,
      helperTimeoutMs: 5_000,
      helperFactory: passiveHelperFactory((created) => {
        helper.current = created;
      }),
    });

    const completed = await controller.start(fixture.request);

    expectFailureCode(
      completed,
      "OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_EXPIRED",
    );
    expect(helper.current?.terminateCalls).toBe(1);
  });

  it("applies the one end-to-end deadline while the separate verifier is running", async () => {
    const fixture = await previewFixture();
    const verifier = { current: null as FakeHelper | null };
    const controller = createLocalOfflineNormalizationPreviewController({
      ...fixture.controllerOptions,
      helperTimeoutMs: 250,
      helperFactory: passiveVerifierFactory((created) => {
        verifier.current = created;
      }),
    });

    const completed = await controller.start(fixture.request);

    expectFailureCode(completed, "LOCAL_OFFLINE_PREVIEW_OPERATION_TIMEOUT");
    expect(verifier.current?.terminateCalls).toBe(1);
    expect(controller.readVerifiedReport(fixture.request.requestId)).toBeNull();
  });

  it("cancels one active request, terminates its helper, and retains no result", async () => {
    const fixture = await previewFixture();
    const helper = { current: null as FakeHelper | null };
    const controller = createLocalOfflineNormalizationPreviewController({
      ...fixture.controllerOptions,
      helperTimeoutMs: 5_000,
      helperFactory: passiveHelperFactory((created) => {
        helper.current = created;
      }),
    });
    const starting = controller.start(fixture.request);
    await waitFor(() => helper.current !== null);

    const cancelled = await controller.cancel(fixture.request.requestId);
    const completed = await starting;

    expect(cancelled).not.toBeNull();
    if (cancelled === null) throw new Error("cancelled state is missing");
    expectFailureCode(cancelled, "LOCAL_OFFLINE_PREVIEW_CANCELLED");
    expectFailureCode(completed, "LOCAL_OFFLINE_PREVIEW_CANCELLED");
    expect(helper.current?.terminateCalls).toBe(1);
    expect(controller.readVerifiedResult(fixture.request.requestId)).toBeNull();
  });

  it("interrupts source reading before helper launch when Cancel arrives immediately", async () => {
    const fixture = await previewFixture();
    const helperFactory = vi.fn(successHelperFactory());
    const controller = createLocalOfflineNormalizationPreviewController({
      ...fixture.controllerOptions,
      helperFactory,
    });

    const started = controller.start(fixture.request);
    const cancelled = await controller.cancel(fixture.request.requestId);
    const completed = await started;

    expect(cancelled).not.toBeNull();
    if (cancelled === null) throw new Error("cancelled state is missing");
    expectFailureCode(cancelled, "LOCAL_OFFLINE_PREVIEW_CANCELLED");
    expectFailureCode(completed, "LOCAL_OFFLINE_PREVIEW_CANCELLED");
    expect(helperFactory).not.toHaveBeenCalled();
    expect(controller.readVerifiedReport(fixture.request.requestId)).toBeNull();
  });

  it("terminates the separate verifier promptly when Cancel arrives", async () => {
    const fixture = await previewFixture();
    const verifier = { current: null as FakeHelper | null };
    const controller = createLocalOfflineNormalizationPreviewController({
      ...fixture.controllerOptions,
      helperFactory: passiveVerifierFactory((created) => {
        verifier.current = created;
      }),
    });
    const started = controller.start(fixture.request);
    await waitFor(() => verifier.current !== null);

    const cancelled = await controller.cancel(fixture.request.requestId);
    const completed = await started;

    expect(cancelled).not.toBeNull();
    if (cancelled === null) throw new Error("cancelled state is missing");
    expectFailureCode(cancelled, "LOCAL_OFFLINE_PREVIEW_CANCELLED");
    expectFailureCode(completed, "LOCAL_OFFLINE_PREVIEW_CANCELLED");
    expect(verifier.current?.terminateCalls).toBe(1);
    expect(controller.readVerifiedReport(fixture.request.requestId)).toBeNull();
  });

  it("treats Cancel after completion as discard, so a finish/cancel race keeps no result", async () => {
    const fixture = await previewFixture();
    const controller = createLocalOfflineNormalizationPreviewController({
      ...fixture.controllerOptions,
      helperFactory: successHelperFactory(),
    });
    const completed = await controller.start(fixture.request);
    expect(completed.state).toBe("verified");

    const cancelled = await controller.cancel(fixture.request.requestId);

    expect(cancelled).not.toBeNull();
    if (cancelled === null) throw new Error("cancelled state is missing");
    expectFailureCode(
      cancelled,
      "LOCAL_OFFLINE_PREVIEW_CANCELLED",
      "blocked",
    );
    expect(controller.readVerifiedReport(fixture.request.requestId)).toBeNull();
  });

  it("does not finish stop until helper termination and request settlement finish", async () => {
    const fixture = await previewFixture();
    const helper = { current: null as FakeHelper | null };
    let releaseTermination!: (value: number) => void;
    const termination = new Promise<number>((resolve) => {
      releaseTermination = resolve;
    });
    const controller = createLocalOfflineNormalizationPreviewController({
      ...fixture.controllerOptions,
      helperTimeoutMs: 5_000,
      helperFactory: passiveHelperFactory((created) => {
        helper.current = created;
        created.terminateImplementation = () => termination;
      }),
    });
    const starting = controller.start(fixture.request);
    await waitFor(() => helper.current !== null);
    let stopFinished = false;
    const stopping = controller.stop().then(() => {
      stopFinished = true;
    });

    await delay(20);
    expect(stopFinished).toBe(false);
    expect(helper.current?.terminateCalls).toBe(1);
    releaseTermination(0);
    await stopping;
    const completed = await starting;

    expect(stopFinished).toBe(true);
    expectFailureCode(
      completed,
      "LOCAL_OFFLINE_PREVIEW_CONTROLLER_STOPPED",
    );
  });

  it("rejects helper output when termination after its message is unconfirmed", async () => {
    const fixture = await previewFixture();
    const helper = { current: null as FakeHelper | null };
    const controller = createLocalOfflineNormalizationPreviewController({
      ...fixture.controllerOptions,
      helperFactory: successHelperFactory({
        configureHelper: (created) => {
          helper.current = created;
          created.terminateImplementation = () =>
            Promise.reject(new Error("fixture termination rejection"));
        },
      }),
    });

    const completed = await controller.start(fixture.request);

    expectFailureCode(
      completed,
      "LOCAL_OFFLINE_PREVIEW_HELPER_TERMINATION_UNCONFIRMED",
    );
    expect(completed.message).not.toContain("stopped safely");
    expect(helper.current?.terminateCalls).toBe(1);
    expect(controller.readVerifiedResult(fixture.request.requestId)).toBeNull();

    if (helper.current === null) throw new Error("helper was not created");
    helper.current.terminateImplementation = () => Promise.resolve(0);
    await controller.stop();
    expect(helper.current.terminateCalls).toBe(2);
  });

  it("fails closed within a fixed bound when terminate never settles after a message", async () => {
    const fixture = await previewFixture();
    const helper = { current: null as FakeHelper | null };
    const controller = createLocalOfflineNormalizationPreviewController({
      ...fixture.controllerOptions,
      helperFactory: successHelperFactory({
        configureHelper: (created) => {
          helper.current = created;
          created.terminateImplementation = () => new Promise<number>(() => undefined);
        },
      }),
    });

    const completed = await settleWithin(
      controller.start(fixture.request),
      "message-path termination confirmation",
    );

    expectFailureCode(
      completed,
      "LOCAL_OFFLINE_PREVIEW_HELPER_TERMINATION_UNCONFIRMED",
    );
    expect(helper.current?.terminateCalls).toBe(1);
    expect(controller.readVerifiedResult(fixture.request.requestId)).toBeNull();
    if (helper.current === null) throw new Error("helper was not created");
    helper.current.emit("exit", 0);
    await settleWithin(controller.stop(), "stop after observed helper exit");
  });

  it("declines cancel confirmation when helper termination is unconfirmed", async () => {
    const fixture = await previewFixture();
    const helper = { current: null as FakeHelper | null };
    const controller = createLocalOfflineNormalizationPreviewController({
      ...fixture.controllerOptions,
      helperTimeoutMs: 5_000,
      helperFactory: passiveHelperFactory((created) => {
        helper.current = created;
        created.terminateImplementation = () =>
          Promise.reject(new Error("fixture termination rejection"));
      }),
    });
    const starting = controller.start(fixture.request);
    await waitFor(() => helper.current !== null);

    const cancelled = await controller.cancel(fixture.request.requestId);
    const completed = await starting;

    expect(cancelled).not.toBeNull();
    if (cancelled === null) throw new Error("cancelled state is missing");
    expectFailureCode(
      cancelled,
      "LOCAL_OFFLINE_PREVIEW_HELPER_TERMINATION_UNCONFIRMED",
    );
    expectFailureCode(
      completed,
      "LOCAL_OFFLINE_PREVIEW_HELPER_TERMINATION_UNCONFIRMED",
    );
    expect(cancelled.message).not.toContain("stopped safely");
    expect(helper.current?.terminateCalls).toBe(1);
    expect(controller.readVerifiedResult(fixture.request.requestId)).toBeNull();

    if (helper.current === null) throw new Error("helper was not created");
    helper.current.terminateImplementation = () => Promise.resolve(0);
    await controller.stop();
    expect(helper.current.terminateCalls).toBe(2);
  });

  it("returns from Cancel when terminate never settles and does not start an overlapping terminate", async () => {
    const fixture = await previewFixture();
    const helper = { current: null as FakeHelper | null };
    const controller = createLocalOfflineNormalizationPreviewController({
      ...fixture.controllerOptions,
      helperTimeoutMs: 5_000,
      helperFactory: passiveHelperFactory((created) => {
        helper.current = created;
        created.terminateImplementation = () => new Promise<number>(() => undefined);
      }),
    });
    const starting = controller.start(fixture.request);
    await waitFor(() => helper.current !== null);

    const cancelled = await settleWithin(
      controller.cancel(fixture.request.requestId),
      "Cancel with pending terminate",
    );
    const completed = await settleWithin(starting, "cancelled request settlement");

    expect(cancelled).not.toBeNull();
    if (cancelled === null) throw new Error("cancelled state is missing");
    expectFailureCode(
      cancelled,
      "LOCAL_OFFLINE_PREVIEW_HELPER_TERMINATION_UNCONFIRMED",
    );
    expectFailureCode(
      completed,
      "LOCAL_OFFLINE_PREVIEW_HELPER_TERMINATION_UNCONFIRMED",
    );
    expect(helper.current?.terminateCalls).toBe(1);
    await delay(300);
    expect(helper.current?.terminateCalls).toBe(1);
    if (helper.current === null) throw new Error("helper was not created");
    helper.current.emit("exit", 0);
    await settleWithin(controller.stop(), "stop after cancelled helper exit");
  });

  it("does not confirm Stop until a read-only source handle is confirmed closed", async () => {
    const fixture = await previewFixture();
    let allowClose = false;
    let closeCalls = 0;
    const controller = createLocalOfflineNormalizationPreviewController({
      ...fixture.controllerOptions,
      helperFactory: successHelperFactory(),
      sourceHandleCloser: async (handle) => {
        closeCalls += 1;
        if (!allowClose) throw new Error("synthetic close failure");
        await handle.close();
      },
    });

    const completed = await controller.start(fixture.request);

    expectFailureCode(
      completed,
      "LOCAL_OFFLINE_PREVIEW_SOURCE_HANDLE_CLOSE_UNCONFIRMED",
    );
    expect(completed.message).not.toContain("stopped safely");
    expect(closeCalls).toBeGreaterThanOrEqual(2);
    expect(controller.availability(RECEIPT_SHA256).message).toContain(
      "source-file handle",
    );
    await expect(controller.stop()).rejects.toThrow(
      /source handles could not be confirmed closed/u,
    );

    allowClose = true;
    await controller.stop();
    expect(closeCalls).toBeGreaterThanOrEqual(4);
  });

  it("returns from a pending source-handle close without starting an overlapping close", async () => {
    const fixture = await previewFixture();
    let releaseClose!: () => void;
    const closeGate = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    let closeCalls = 0;
    const controller = createLocalOfflineNormalizationPreviewController({
      ...fixture.controllerOptions,
      helperFactory: successHelperFactory(),
      sourceHandleCloser: async (handle) => {
        closeCalls += 1;
        await closeGate;
        await handle.close();
      },
    });

    const completed = await settleWithin(
      controller.start(fixture.request),
      "pending source-handle close",
    );
    expectFailureCode(
      completed,
      "LOCAL_OFFLINE_PREVIEW_SOURCE_HANDLE_CLOSE_UNCONFIRMED",
    );
    expect(closeCalls).toBe(1);
    await expect(
      settleWithin(controller.stop(), "Stop with pending source-handle close"),
    ).rejects.toThrow(/source handles could not be confirmed closed/u);
    expect(closeCalls).toBe(1);

    releaseClose();
    await settleWithin(controller.stop(), "Stop after source-handle close settled");
    expect(closeCalls).toBe(1);
  });

  it("wipes an output message that arrives after cancellation", async () => {
    const fixture = await previewFixture();
    const helper = { current: null as FakeHelper | null };
    const lateOutput = new Uint8Array([9, 8, 7, 6]);
    const controller = createLocalOfflineNormalizationPreviewController({
      ...fixture.controllerOptions,
      helperFactory: passiveHelperFactory((created) => {
        helper.current = created;
      }),
    });
    const started = controller.start(fixture.request);
    await waitFor(() => helper.current !== null);

    await controller.cancel(fixture.request.requestId);
    await started;
    helper.current?.emit("message", {
      schemaVersion: LOCAL_OFFLINE_NORMALIZATION_PREVIEW_HELPER_RESULT_V0,
      kind: "completed",
      normalizedGlb: lateOutput.buffer,
      report: {},
    });

    expect([...lateOutput]).toEqual([0, 0, 0, 0]);
  });

  it("does not claim stop when helper termination is unconfirmed and retries later", async () => {
    const fixture = await previewFixture();
    const helper = { current: null as FakeHelper | null };
    const controller = createLocalOfflineNormalizationPreviewController({
      ...fixture.controllerOptions,
      helperTimeoutMs: 5_000,
      helperFactory: passiveHelperFactory((created) => {
        helper.current = created;
        created.terminateImplementation = () =>
          Promise.reject(new Error("fixture termination rejection"));
      }),
    });
    const starting = controller.start(fixture.request);
    await waitFor(() => helper.current !== null);

    await expect(controller.stop()).rejects.toThrow(
      /could not be confirmed stopped/u,
    );
    const completed = await starting;

    expectFailureCode(
      completed,
      "LOCAL_OFFLINE_PREVIEW_HELPER_TERMINATION_UNCONFIRMED",
    );
    expect(completed.message).not.toContain("stopped safely");
    expect(helper.current?.terminateCalls).toBe(1);
    expect(controller.readVerifiedResult(fixture.request.requestId)).toBeNull();

    if (helper.current === null) throw new Error("helper was not created");
    helper.current.terminateImplementation = () => Promise.resolve(0);
    await controller.stop();
    expect(helper.current.terminateCalls).toBe(2);
  });

  it("returns from Stop when terminate never settles, then accepts a later exit confirmation", async () => {
    const fixture = await previewFixture();
    const helper = { current: null as FakeHelper | null };
    const controller = createLocalOfflineNormalizationPreviewController({
      ...fixture.controllerOptions,
      helperTimeoutMs: 5_000,
      helperFactory: passiveHelperFactory((created) => {
        helper.current = created;
        created.terminateImplementation = () => new Promise<number>(() => undefined);
      }),
    });
    const starting = controller.start(fixture.request);
    await waitFor(() => helper.current !== null);

    await expect(
      settleWithin(controller.stop(), "Stop with pending terminate"),
    ).rejects.toThrow(/could not be confirmed stopped/u);
    const completed = await settleWithin(starting, "stopped request settlement");
    expectFailureCode(
      completed,
      "LOCAL_OFFLINE_PREVIEW_HELPER_TERMINATION_UNCONFIRMED",
    );
    expect(helper.current?.terminateCalls).toBe(1);
    await delay(300);
    expect(helper.current?.terminateCalls).toBe(1);

    if (helper.current === null) throw new Error("helper was not created");
    helper.current.emit("exit", 0);
    await settleWithin(controller.stop(), "Stop after observed helper exit");
  });

  it("returns after a deadline when terminate never settles", async () => {
    const fixture = await previewFixture();
    const helper = { current: null as FakeHelper | null };
    const controller = createLocalOfflineNormalizationPreviewController({
      ...fixture.controllerOptions,
      helperTimeoutMs: 25,
      helperFactory: passiveHelperFactory((created) => {
        helper.current = created;
        created.terminateImplementation = () => new Promise<number>(() => undefined);
      }),
    });

    const completed = await settleWithin(
      controller.start(fixture.request),
      "deadline with pending terminate",
    );
    expectFailureCode(
      completed,
      "LOCAL_OFFLINE_PREVIEW_HELPER_TERMINATION_UNCONFIRMED",
    );
    expect(helper.current?.terminateCalls).toBe(1);
    if (helper.current === null) throw new Error("helper was not created");
    helper.current.emit("exit", 0);
    await settleWithin(controller.stop(), "Stop after deadline helper exit");
  });

  it.each([
    {
      name: "crashes",
      factory: () =>
        emittingHelperFactory((helper) => {
          helper.emit("error", new Error("fixture crash"));
        }),
      code: "LOCAL_OFFLINE_PREVIEW_HELPER_CRASHED",
    },
    {
      name: "exits without a result",
      factory: () =>
        emittingHelperFactory((helper) => {
          helper.emit("exit", 9);
        }),
      code: "LOCAL_OFFLINE_PREVIEW_HELPER_EXITED_WITHOUT_RESULT",
    },
    {
      name: "returns a malformed message",
      factory: () =>
        emittingHelperFactory((helper) => {
          helper.emit("message", { kind: "completed" });
        }),
      code: "LOCAL_OFFLINE_PREVIEW_HELPER_MESSAGE_INVALID",
    },
    {
      name: "returns an explicit failure",
      factory: () =>
        emittingHelperFactory((helper) => {
          helper.emit("message", {
            schemaVersion:
              "omnitwin.local-offline-normalization-preview-helper-result.v0",
            kind: "failed",
            code: "FIXTURE_HELPER_REJECTED",
          });
        }),
      code: "FIXTURE_HELPER_REJECTED",
    },
  ])("rejects a helper that $name", async ({ factory, code }) => {
    const fixture = await previewFixture();
    const controller = createLocalOfflineNormalizationPreviewController({
      ...fixture.controllerOptions,
      helperFactory: factory(),
    });

    const completed = await controller.start(fixture.request);

    expectFailureCode(completed, code);
    expect(controller.readVerifiedResult(fixture.request.requestId)).toBeNull();
  });

  it("rejects corrupt helper output during separate fresh verification", async () => {
    const fixture = await previewFixture();
    const controller = createLocalOfflineNormalizationPreviewController({
      ...fixture.controllerOptions,
      helperFactory: successHelperFactory({
        mutateOutput: (output) => {
          const firstByte = output[0];
          if (firstByte === undefined) throw new Error("empty normalized GLB");
          output[0] = firstByte ^ 0xff;
        },
      }),
    });

    const completed = await controller.start(fixture.request);

    expectFailureCode(
      completed,
      "LOCAL_OFFLINE_PREVIEW_FRESH_VERIFICATION_FAILED",
    );
    expect(controller.readVerifiedResult(fixture.request.requestId)).toBeNull();
  });

  it("rejects a corrupt helper report before separate fresh verification", async () => {
    const fixture = await previewFixture();
    const controller = createLocalOfflineNormalizationPreviewController({
      ...fixture.controllerOptions,
      helperFactory: successHelperFactory({
        mutateReport: (report) => {
          report.reportSha256 = sha256(Buffer.from("corrupt-report"));
        },
      }),
    });

    const completed = await controller.start(fixture.request);

    expectFailureCode(
      completed,
      "LOCAL_OFFLINE_PREVIEW_VERIFICATION_FAILED",
    );
    expect(controller.readVerifiedResult(fixture.request.requestId)).toBeNull();
  });

  it("rejects a source whose byte length differs from the signed permit", async () => {
    const fixture = await previewFixture();
    await writeFile(
      fixture.sourcePath,
      Buffer.concat([fixture.source, Buffer.from([0])]),
    );
    const helperFactory = vi.fn(successHelperFactory());
    const controller = createLocalOfflineNormalizationPreviewController({
      ...fixture.controllerOptions,
      helperFactory,
    });

    const completed = await controller.start(fixture.request);

    expectFailureCode(
      completed,
      "LOCAL_OFFLINE_PREVIEW_SOURCE_SIZE_MISMATCH",
    );
    expect(helperFactory).not.toHaveBeenCalled();
  });

  it("rejects same-length source bytes whose hash differs from the signed permit", async () => {
    const fixture = await previewFixture();
    const corrupted = Buffer.from(fixture.source);
    const lastByte = corrupted.at(-1);
    if (lastByte === undefined) throw new Error("empty source fixture");
    corrupted[corrupted.length - 1] = lastByte ^ 0xff;
    await writeFile(fixture.sourcePath, corrupted);
    const helperFactory = vi.fn(successHelperFactory());
    const controller = createLocalOfflineNormalizationPreviewController({
      ...fixture.controllerOptions,
      helperFactory,
    });

    const completed = await controller.start(fixture.request);

    expectFailureCode(
      completed,
      "LOCAL_OFFLINE_PREVIEW_SOURCE_HASH_MISMATCH",
    );
    expect(helperFactory).not.toHaveBeenCalled();
  });

  it("rejects a symbolic-link or junction source path before helper launch", async () => {
    const fixture = await previewFixture();
    const sourceRoot = join(fixture.sourcePath, "..");
    let linkedPath = join(sourceRoot, "source-link.glb");
    try {
      await symlink(fixture.sourcePath, linkedPath, "file");
    } catch (error: unknown) {
      if (
        typeof error !== "object" ||
        error === null ||
        !("code" in error) ||
        (error as { readonly code?: unknown }).code !== "EPERM"
      ) {
        throw error;
      }
      const junctionPath = join(sourceRoot, "source-junction");
      await symlink(sourceRoot, junctionPath, "junction");
      linkedPath = join(junctionPath, "source.glb");
    }
    const helperFactory = vi.fn(successHelperFactory());
    const controller = createLocalOfflineNormalizationPreviewController(
      controllerOptionsWithPath(fixture, linkedPath, { helperFactory }),
    );

    const completed = await controller.start(fixture.request);

    expectFailureCode(
      completed,
      "LOCAL_OFFLINE_PREVIEW_SOURCE_NOT_EXACT_REGULAR_FILE",
    );
    expect(helperFactory).not.toHaveBeenCalled();
  });

  it("rejects a noncanonical path containing a hidden ancestor and dot-dot", async () => {
    const fixture = await previewFixture();
    const sourceRoot = join(fixture.sourcePath, "..");
    const noncanonicalPath = `${sourceRoot}/hidden-ancestor/../source.glb`;

    expect(() =>
      createLocalOfflineNormalizationPreviewController(
        controllerOptionsWithPath(fixture, noncanonicalPath),
      )
    ).toThrow("process-owned offline preview asset binding is invalid");
  });

  it("rejects direct network-share and device-style path bindings", async () => {
    const fixture = await previewFixture();
    for (const unsafePath of [
      "//server/share/source.glb",
      "\\\\?\\C:\\private\\source.glb",
    ]) {
      expect(() =>
        createLocalOfflineNormalizationPreviewController(
          controllerOptionsWithPath(fixture, unsafePath),
        )
      ).toThrow("process-owned offline preview asset binding is invalid");
    }
  });

  it("rejects a hard-linked source before helper launch", async () => {
    const fixture = await previewFixture();
    const linkedPath = join(fixture.sourcePath, "..", "source-hardlink.glb");
    await link(fixture.sourcePath, linkedPath);
    const helperFactory = vi.fn(successHelperFactory());
    const controller = createLocalOfflineNormalizationPreviewController(
      controllerOptionsWithPath(fixture, linkedPath, { helperFactory }),
    );

    const completed = await controller.start(fixture.request);

    expectFailureCode(
      completed,
      "LOCAL_OFFLINE_PREVIEW_SOURCE_NOT_EXACT_REGULAR_FILE",
    );
    expect(helperFactory).not.toHaveBeenCalled();
  });

  it("rejects path replacement while the helper is running", async () => {
    const fixture = await previewFixture();
    const movedPath = join(fixture.sourcePath, "..", "source-before.glb");
    const controller = createLocalOfflineNormalizationPreviewController({
      ...fixture.controllerOptions,
      helperFactory: successHelperFactory({
        beforeMessage: async () => {
          await rename(fixture.sourcePath, movedPath);
          await writeFile(fixture.sourcePath, fixture.source);
        },
      }),
    });

    const completed = await controller.start(fixture.request);

    expectFailureCode(
      completed,
      "LOCAL_OFFLINE_PREVIEW_SOURCE_IDENTITY_CHANGED",
    );
    expect(controller.readVerifiedResult(fixture.request.requestId)).toBeNull();
  });

  it("rejects source mutation while the helper is running", async () => {
    const fixture = await previewFixture();
    const mutated = Buffer.from(fixture.source);
    const lastByte = mutated.at(-1);
    if (lastByte === undefined) throw new Error("empty source fixture");
    mutated[mutated.length - 1] = lastByte ^ 0xff;
    const controller = createLocalOfflineNormalizationPreviewController({
      ...fixture.controllerOptions,
      helperFactory: successHelperFactory({
        beforeMessage: () => writeFile(fixture.sourcePath, mutated),
      }),
    });

    const completed = await controller.start(fixture.request);

    expectFailureCode(
      completed,
      "LOCAL_OFFLINE_PREVIEW_SOURCE_HASH_MISMATCH",
    );
    expect(controller.readVerifiedResult(fixture.request.requestId)).toBeNull();
  });

  it("consumes a permit once and rejects replay under a new request ID", async () => {
    const fixture = await previewFixture();
    const controller = createLocalOfflineNormalizationPreviewController({
      ...fixture.controllerOptions,
      helperFactory: successHelperFactory(),
    });
    const first = await controller.start(fixture.request);
    const replayRequest = {
      ...fixture.request,
      requestId: "11111111111111111111111111111111",
    };

    const replay = await controller.start(replayRequest);

    expect(first.state).toBe("verified");
    expectFailureCode(
      replay,
      "LOCAL_OFFLINE_PREVIEW_PERMIT_REPLAY_REJECTED",
      "blocked",
    );
    await controller.stop();
  });

  it("rejects replay from a second controller in the same Node process", async () => {
    const fixture = await previewFixture();
    const firstController = createLocalOfflineNormalizationPreviewController({
      ...fixture.controllerOptions,
      helperFactory: successHelperFactory(),
    });
    const secondHelperFactory = vi.fn(successHelperFactory());
    const secondController = createLocalOfflineNormalizationPreviewController({
      ...fixture.controllerOptions,
      helperFactory: secondHelperFactory,
    });
    const first = await firstController.start(fixture.request);
    expect(first.state).toBe("verified");

    const replay = await secondController.start({
      ...fixture.request,
      requestId: "22222222222222222222222222222222",
    });

    expectFailureCode(
      replay,
      "LOCAL_OFFLINE_PREVIEW_PERMIT_REPLAY_REJECTED",
      "blocked",
    );
    expect(secondController.availability(RECEIPT_SHA256).state).toBe(
      "blocked",
    );
    expect(secondHelperFactory).not.toHaveBeenCalled();
    await firstController.stop();
    await secondController.stop();
  });

  it("rejects reuse of one request ID for different opaque bindings", async () => {
    const fixture = await previewFixture();
    const controller = createLocalOfflineNormalizationPreviewController(
      fixture.controllerOptions,
    );
    expect(controller.prepare(fixture.request).state).toBe("ready");

    const conflict = controller.prepare({
      ...fixture.request,
      previewAssetId: "different-preview",
    });

    expectFailureCode(
      conflict,
      "LOCAL_OFFLINE_PREVIEW_REQUEST_ID_CONFLICT",
      "blocked",
    );
  });

  it("caps the number of request IDs retained in one controller session", async () => {
    const fixture = await previewFixture();
    const controller = createLocalOfflineNormalizationPreviewController(
      fixture.controllerOptions,
    );
    for (let index = 0; index < 256; index += 1) {
      const request = {
        ...fixture.request,
        requestId: index.toString(16).padStart(32, "0"),
      };
      expect(controller.prepare(request).state).toBe("ready");
    }

    const overflow = controller.prepare({
      ...fixture.request,
      requestId: (256).toString(16).padStart(32, "0"),
    });

    expectFailureCode(
      overflow,
      "LOCAL_OFFLINE_PREVIEW_SESSION_REQUEST_LIMIT",
      "blocked",
    );
  });

  it("discards a retained verified result on demand and updates public state", async () => {
    const fixture = await previewFixture();
    const controller = createLocalOfflineNormalizationPreviewController({
      ...fixture.controllerOptions,
      helperFactory: successHelperFactory(),
    });
    const completed = await controller.start(fixture.request);
    expect(completed.state).toBe("verified");
    expect(controller.readVerifiedResult(fixture.request.requestId)).not.toBeNull();

    expect(controller.discardVerifiedResult(fixture.request.requestId)).toBe(true);

    expect(controller.readVerifiedResult(fixture.request.requestId)).toBeNull();
    const state = controller.status(fixture.request.requestId);
    expect(state).not.toBeNull();
    if (state === null) throw new Error("discard state is missing");
    expectFailureCode(
      state,
      "LOCAL_OFFLINE_PREVIEW_RESULT_DISCARDED",
      "blocked",
    );
    expect(state.output).toBeNull();
    expect(controller.discardVerifiedResult(fixture.request.requestId)).toBe(false);
  });

  it("bounds large output copies to one revocable lease and reads reports without a GLB copy", async () => {
    const fixture = await previewFixture();
    const controller = createLocalOfflineNormalizationPreviewController({
      ...fixture.controllerOptions,
      helperFactory: successHelperFactory(),
    });
    const completed = await controller.start(fixture.request);
    expect(completed.state).toBe("verified");
    const report = controller.readVerifiedReport(fixture.request.requestId);
    expect(report?.output.sha256).toBe(completed.output?.sha256);
    expect(controller.acquireVerifiedOutput(
      fixture.request.requestId,
      `sha256:${"0".repeat(64)}`,
    )).toBeNull();

    const first = controller.acquireVerifiedOutput(
      fixture.request.requestId,
      report?.output.sha256 ?? "",
    );
    expect(first).not.toBeNull();
    expect(controller.acquireVerifiedOutput(
      fixture.request.requestId,
      report?.output.sha256 ?? "",
    )).toBeNull();
    const firstBytes = first?.normalizedGlb;
    first?.release();
    expect(firstBytes?.every((value) => value === 0)).toBe(true);

    const revoked = vi.fn();
    const second = controller.acquireVerifiedOutput(
      fixture.request.requestId,
      report?.output.sha256 ?? "",
      revoked,
    );
    expect(second).not.toBeNull();
    const secondBytes = second?.normalizedGlb;
    expect(controller.discardVerifiedResult(fixture.request.requestId)).toBe(true);
    expect(revoked).toHaveBeenCalledOnce();
    expect(secondBytes?.every((value) => value === 0)).toBe(true);
    second?.release();
    expect(controller.readVerifiedReport(fixture.request.requestId)).toBeNull();
  });

  it("wipes helper output when launch, message validation, or termination fails", async () => {
    const launchFixture = await previewFixture();
    let untransferredSource: ArrayBuffer | null = null;
    const launchController = createLocalOfflineNormalizationPreviewController({
      ...launchFixture.controllerOptions,
      helperFactory: (launch) => {
        const input = launch.options.workerData as
          LocalOfflineNormalizationPreviewHelperInput;
        untransferredSource = input.sourceBytes;
        throw new Error("synthetic launch failure");
      },
    });
    const launchResult = await launchController.start(launchFixture.request);
    expectFailureCode(
      launchResult,
      "LOCAL_OFFLINE_PREVIEW_HELPER_LAUNCH_FAILED",
    );
    expect(untransferredSource).not.toBeNull();
    expect([...new Uint8Array(untransferredSource ?? new ArrayBuffer(0))]
      .every((value) => value === 0)).toBe(true);

    const malformedFixture = await previewFixture();
    const malformedOutput = new Uint8Array([1, 2, 3, 4]);
    const malformedController = createLocalOfflineNormalizationPreviewController({
      ...malformedFixture.controllerOptions,
      helperFactory: emittingHelperFactory((helper) => {
        helper.emit("message", {
          schemaVersion: "wrong-schema",
          kind: "completed",
          normalizedGlb: malformedOutput.buffer,
          report: {},
        });
      }),
    });
    const malformedResult = await malformedController.start(
      malformedFixture.request,
    );
    expectFailureCode(
      malformedResult,
      "LOCAL_OFFLINE_PREVIEW_HELPER_MESSAGE_INVALID",
    );
    expect([...malformedOutput]).toEqual([0, 0, 0, 0]);

    const terminationFixture = await previewFixture();
    const terminationOutput = new Uint8Array([5, 6, 7, 8]);
    let terminationHelper: FakeHelper | null = null;
    const terminationController = createLocalOfflineNormalizationPreviewController({
      ...terminationFixture.controllerOptions,
      helperFactory: (launch) => {
        transferHelperInput(launch);
        const helper = new FakeHelper();
        helper.terminateImplementation = () =>
          Promise.reject(new Error("synthetic terminate failure"));
        terminationHelper = helper;
        queueMicrotask(() => {
          helper.emit("message", {
            schemaVersion: LOCAL_OFFLINE_NORMALIZATION_PREVIEW_HELPER_RESULT_V0,
            kind: "completed",
            normalizedGlb: terminationOutput.buffer,
            report: {},
          });
        });
        return helper;
      },
    });
    const terminationResult = await terminationController.start(
      terminationFixture.request,
    );
    expectFailureCode(
      terminationResult,
      "LOCAL_OFFLINE_PREVIEW_HELPER_TERMINATION_UNCONFIRMED",
    );
    expect([...terminationOutput]).toEqual([0, 0, 0, 0]);
    if (terminationHelper === null) throw new Error("helper was not created");
    (terminationHelper as FakeHelper).terminateImplementation = () =>
      Promise.resolve(0);
    await terminationController.stop();
  });

  it("automatically discards a retained result when its permit expires", async () => {
    const now = Date.now();
    const fixture = await previewFixture({
      validFrom: new Date(now - 30_000).toISOString(),
      expiresAt: new Date(now + 900).toISOString(),
    });
    const controller = createLocalOfflineNormalizationPreviewController({
      ...fixture.controllerOptions,
      helperFactory: successHelperFactory(),
    });
    const completed = await controller.start(fixture.request);
    expect(completed.state).toBe("verified");

    await delay(1_000);

    expect(controller.readVerifiedResult(fixture.request.requestId)).toBeNull();
    const state = controller.status(fixture.request.requestId);
    expect(state).not.toBeNull();
    if (state === null) throw new Error("expiry state is missing");
    expectFailureCode(
      state,
      "LOCAL_OFFLINE_PREVIEW_RETAINED_RESULT_EXPIRED",
      "blocked",
    );
    expect(state.output).toBeNull();
  });

  it("rejects an untrusted permit before reading the source or launching a Worker", async () => {
    const missingPath = join(tmpdir(), `must-not-read-${String(Date.now())}.glb`);
    const fixture = await previewFixture({
      sourcePath: missingPath,
      tamperSignature: true,
    });
    const helperFactory = vi.fn(() => {
      throw new Error("must not launch");
    });
    const controller = createLocalOfflineNormalizationPreviewController({
      ...fixture.controllerOptions,
      helperFactory,
    });

    const blocked = await controller.start(fixture.request);

    expect(blocked.state).toBe("blocked");
    expect(blocked.message).toContain("DSSE_SIGNATURE_INVALID");
    expect(helperFactory).not.toHaveBeenCalled();
  });
});
