import {
  createHash,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import {
  request as httpRequest,
  type ClientRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
} from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { inspectUniversalIntakeWithSourceFactsV4 } from "@omnitwin/reconstruction-foundry";
import { afterEach, describe, expect, it } from "vitest";
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
} from "../../../../packages/reconstruction-foundry/src/offline-normalize-mesh-glb-preview.js";
import {
  executeLocalOfflineNormalizationPreviewFreshVerification,
  type LocalOfflineNormalizationPreviewVerifierInput,
} from "../local-offline-normalization-preview-verifier.js";
import {
  LOCAL_OFFLINE_NORMALIZATION_PREVIEW_HELPER_RESULT_V0,
  type CreateLocalOfflineNormalizationPreviewControllerOptions,
  type LocalOfflineNormalizationPreviewDto,
  type LocalOfflineNormalizationPreviewHelperFactory,
  type LocalOfflineNormalizationPreviewHelperInput,
  type LocalOfflineNormalizationPreviewHelperLike,
  type LocalOfflineNormalizationPreviewStartRequest,
} from "../local-offline-normalization-preview.js";
import {
  startLocalFoundryApp,
  type LocalFoundryAppHandle,
  type LocalFoundryPublicState,
} from "../local-app.js";

const KEY_ID = "local-app-preview-route-test-key";
const PREVIEW_ASSET_ID = "route-fixture-preview";
const SOURCE_ASSET_ID = "route-fixture-mesh";
const REQUEST_ID = "0123456789abcdef0123456789abcdef";
const BLOCKED_REQUEST_ID = "22222222222222222222222222222222";
const STALE_REQUEST_ID = "fedcba9876543210fedcba9876543210";
const STALE_DIGEST = `sha256:${"0".repeat(64)}`;
const temporaryDirectories: string[] = [];
const openApps: LocalFoundryAppHandle[] = [];
let fixtureSequence = 0;

interface HttpResult {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: Buffer;
}

interface PausedHttpResponse {
  readonly request: ClientRequest;
  readonly response: IncomingMessage;
}

async function settleWithin<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs = 5_000,
): Promise<T> {
  return Promise.race([
    promise,
    delay(timeoutMs).then(() => {
      throw new Error(`${label} did not settle within ${String(timeoutMs)} ms`);
    }),
  ]);
}

interface PreviewRouteFixture {
  readonly root: string;
  readonly source: Buffer;
  readonly sourcePath: string;
  readonly receiptSha256: string;
  readonly expiresAt: string;
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

class InProcessPreviewHelper extends EventEmitter implements LocalOfflineNormalizationPreviewHelperLike {
  terminate(): Promise<number> {
    return Promise.resolve(0);
  }
}

class StopRetryPreviewHelper extends EventEmitter implements LocalOfflineNormalizationPreviewHelperLike {
  allowTermination = false;
  terminateCalls = 0;

  terminate(): Promise<number> {
    this.terminateCalls += 1;
    return this.allowTermination
      ? Promise.resolve(0)
      : Promise.reject(new Error("fixture cannot confirm this stop yet"));
  }
}

afterEach(async () => {
  await Promise.all(
    openApps.splice(0).map(async (app) => {
      if (app.getPhase() !== "stopped") await app.stop();
    }),
  );
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
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

function glbFixture(triangleCount = 1): Buffer {
  if (!Number.isInteger(triangleCount) || triangleCount < 1 || triangleCount > 21_845) {
    throw new Error("triangleCount must fit an unsigned 16-bit index buffer");
  }
  const vertexCount = triangleCount * 3;
  const positions = Buffer.alloc(vertexCount * 12);
  const indices = Buffer.alloc(vertexCount * 2);
  let randomState = 0x6d2b79f5;
  const nextCoordinate = (): number => {
    randomState = (Math.imul(randomState, 1_664_525) + 1_013_904_223) >>> 0;
    return randomState / 0xffff_ffff;
  };
  for (let index = 0; index < vertexCount; index += 1) {
    const coordinates = index === 0
      ? [0, 0, 0]
      : index === 1
        ? [1, 1, 1]
        : [nextCoordinate(), nextCoordinate(), nextCoordinate()];
    coordinates.forEach((value, component) =>
      positions.writeFloatLE(value, index * 12 + component * 4),
    );
    indices.writeUInt16LE(index, index * 2);
  }
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
        count: vertexCount,
        type: "VEC3",
        min: [0, 0, 0],
        max: [1, 1, 1],
      },
      {
        bufferView: 1,
        componentType: 5123,
        count: vertexCount,
        type: "SCALAR",
        min: [0],
        max: [vertexCount - 1],
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

function inProcessHelperFactory(): LocalOfflineNormalizationPreviewHelperFactory {
  return (launch) => {
    if (
      launch.scriptUrl.pathname.endsWith(
        "/offline-normalization-preview-verifier.worker.js",
      )
    ) {
      const verifierInput = launch.options.workerData as
        LocalOfflineNormalizationPreviewVerifierInput;
      const transferredVerifierInput = structuredClone(verifierInput, {
        transfer: [
          verifierInput.freshSourceBytes,
          verifierInput.candidateOutputBytes,
        ],
      });
      const helper = new InProcessPreviewHelper();
      queueMicrotask(() => {
        void executeLocalOfflineNormalizationPreviewFreshVerification(
          transferredVerifierInput,
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
    const input = launch.options.workerData as LocalOfflineNormalizationPreviewHelperInput;
    const transferred = structuredClone(input, {
      transfer: [input.sourceBytes],
    });
    const helper = new InProcessPreviewHelper();
    queueMicrotask(() => {
      void runFoundryOfflineNormalizeMeshGlbPreview({
        invocation: transferred.invocation,
        sourceBytes: new Uint8Array(transferred.sourceBytes),
        permitEnvelope: transferred.permitEnvelope,
        pinnedTrustedPermitKeys: transferred.pinnedTrustedPermitKeys,
      }).then((result) => {
        const normalizedGlb = Uint8Array.from(result.normalizedGlb);
        helper.emit("message", {
          schemaVersion: LOCAL_OFFLINE_NORMALIZATION_PREVIEW_HELPER_RESULT_V0,
          kind: "completed",
          normalizedGlb: normalizedGlb.buffer,
          report: structuredClone(result.report),
        });
      }).catch((error: unknown) => {
        helper.emit(
          "error",
          error instanceof Error ? error : new Error(String(error)),
        );
      });
    });
    return helper;
  };
}

function stopRetryHelperFactory(
  onCreate: (helper: StopRetryPreviewHelper) => void,
): LocalOfflineNormalizationPreviewHelperFactory {
  return (launch) => {
    const input = launch.options.workerData as LocalOfflineNormalizationPreviewHelperInput;
    structuredClone(input, { transfer: [input.sourceBytes] });
    const helper = new StopRetryPreviewHelper();
    onCreate(helper);
    return helper;
  };
}

async function previewRouteFixture(options: {
  readonly expiresAt?: string;
  readonly requestId?: string;
  readonly triangleCount?: number;
} = {}): Promise<PreviewRouteFixture> {
  fixtureSequence += 1;
  const fixtureId = String(fixtureSequence).padStart(4, "0");
  const root = await mkdtemp(join(tmpdir(), "local-app-preview-routes-"));
  temporaryDirectories.push(root);
  const source = glbFixture(options.triangleCount);
  const sourcePath = join(root, "source.glb");
  await writeFile(sourcePath, source);
  const inspection = await inspectUniversalIntakeWithSourceFactsV4(sourcePath);
  const receiptSha256 = inspection.receipt.receiptSha256;
  const now = Date.now();
  const expiresAt = options.expiresAt ?? new Date(now + 2 * 60_000).toISOString();
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
    acknowledgementId: `route-fixture-acknowledgement-${fixtureId}`,
    operatorId: "route-fixture-operator",
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
    permitId: `route-fixture-permit-${fixtureId}`,
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
  const trustedKeys = new Map([[KEY_ID, keyPair.publicKey]]);
  const request = {
    receiptSha256,
    previewAssetId: PREVIEW_ASSET_ID,
    requestId: options.requestId ?? REQUEST_ID,
  } as const;
  return {
    root,
    source,
    sourcePath,
    receiptSha256,
    expiresAt,
    invocation,
    envelope,
    trustedKeys,
    request,
    controllerOptions: {
      assetsByPreviewAssetId: new Map([
        [PREVIEW_ASSET_ID, { receiptSha256, absolutePath: sourcePath }],
      ]),
      evidenceByReceiptSha256: new Map([
        [
          receiptSha256,
          { previewAssetId: PREVIEW_ASSET_ID, invocation, permitEnvelope: envelope },
        ],
      ]),
      pinnedTrustedPermitKeys: trustedKeys,
      helperFactory: inProcessHelperFactory(),
    },
  };
}

function tokenFor(app: LocalFoundryAppHandle): string {
  const token = new URL(app.url).searchParams.get("token");
  if (token === null) throw new Error("test app URL has no session token");
  return token;
}

function sendRequest(
  app: LocalFoundryAppHandle,
  input: {
    readonly method?: string;
    readonly path: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: string;
  },
): Promise<HttpResult> {
  return new Promise((resolveResult, rejectResult) => {
    const request = httpRequest({
      hostname: app.host,
      port: app.port,
      method: input.method ?? "GET",
      path: input.path,
      headers: input.headers,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        resolveResult({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks),
        });
      });
    });
    request.on("error", rejectResult);
    if (input.body !== undefined) request.write(input.body);
    request.end();
  });
}

function openPausedResponse(
  app: LocalFoundryAppHandle,
  path: string,
): Promise<PausedHttpResponse> {
  return new Promise((resolveResponse, rejectResponse) => {
    const request = httpRequest({
      hostname: app.host,
      port: app.port,
      method: "GET",
      path,
    }, (response) => {
      response.pause();
      resolveResponse({ request, response });
    });
    request.once("error", rejectResponse);
    request.end();
  });
}

async function readState(app: LocalFoundryAppHandle): Promise<LocalFoundryPublicState> {
  const response = await sendRequest(app, {
    path: `/api/state?token=${encodeURIComponent(tokenFor(app))}`,
  });
  expect(response.status).toBe(200);
  return JSON.parse(response.body.toString("utf8")) as LocalFoundryPublicState;
}

async function waitForAppReady(app: LocalFoundryAppHandle): Promise<LocalFoundryPublicState> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const state = await readState(app);
    if (state.phase === "ready") return state;
    if (state.phase === "failed") throw new Error("local app source inspection failed");
    await delay(10);
  }
  throw new Error("local app did not reach ready state");
}

async function postPreviewJson(
  app: LocalFoundryAppHandle,
  route: "start" | "status" | "cancel",
  body: unknown,
  options: {
    readonly token?: string | null;
    readonly origin?: string;
  } = {},
): Promise<HttpResult> {
  const token = options.token === undefined ? tokenFor(app) : options.token;
  const query = token === null ? "" : `?token=${encodeURIComponent(token)}`;
  const encoded = JSON.stringify(body);
  return sendRequest(app, {
    method: "POST",
    path: `/api/offline-normalization-preview/${route}${query}`,
    headers: {
      "Content-Type": "application/json",
      "Content-Length": String(Buffer.byteLength(encoded)),
      Origin: options.origin ?? app.origin,
    },
    body: encoded,
  });
}

function parsePreviewDto(response: HttpResult): LocalOfflineNormalizationPreviewDto {
  return JSON.parse(response.body.toString("utf8")) as LocalOfflineNormalizationPreviewDto;
}

async function waitForPreviewState(
  app: LocalFoundryAppHandle,
  requestId: string,
  target: LocalOfflineNormalizationPreviewDto["state"],
): Promise<LocalOfflineNormalizationPreviewDto> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const response = await postPreviewJson(app, "status", { requestId });
    expect(response.status).toBe(200);
    const current = parsePreviewDto(response);
    if (current.state === target) return current;
    if (current.state === "failed") {
      throw new Error(`private preview failed: ${current.message}`);
    }
    await delay(10);
  }
  throw new Error(`private preview did not reach ${target}`);
}

function artifactPath(
  app: LocalFoundryAppHandle,
  artifact: "output" | "report",
  requestId: string,
  digest: string,
): string {
  return `/api/offline-normalization-preview/${artifact}?token=${encodeURIComponent(
    tokenFor(app),
  )}&requestId=${encodeURIComponent(requestId)}&digest=${encodeURIComponent(digest)}`;
}

describe("Foundry local app offline normalization preview HTTP routes", () => {
  it("keeps process trust out of HTTP while serving only the exact verified bytes", async () => {
    const fixture = await previewRouteFixture();
    const expected = await runFoundryOfflineNormalizeMeshGlbPreview({
      invocation: fixture.invocation,
      sourceBytes: fixture.source,
      permitEnvelope: fixture.envelope,
      pinnedTrustedPermitKeys: fixture.trustedKeys,
    });
    const app = await startLocalFoundryApp({
      source: fixture.sourcePath,
      offlineNormalizationPreview: fixture.controllerOptions,
    });
    openApps.push(app);

    const ready = await waitForAppReady(app);
    expect(ready.receipt?.receiptSha256).toBe(fixture.receiptSha256);
    expect(fixture.receiptSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(ready.safety.execution).toBe("disabled");
    expect(ready.offlineNormalizationPreview).toMatchObject({
      state: "ready",
      previewAssetId: PREVIEW_ASSET_ID,
      requestId: null,
      productionExecution: "disabled",
      authority: "none",
      serverPersistence: "none",
      custody: "session_memory_only",
      trustedSourceOnly: true,
      localVolumeEstablished: false,
      sandboxEstablished: false,
    });

    const publicJson = JSON.stringify(ready);
    const previewJson = JSON.stringify(ready.offlineNormalizationPreview);
    expect(publicJson).not.toContain(fixture.root);
    expect(publicJson).not.toContain(fixture.sourcePath);
    expect(publicJson).not.toContain(KEY_ID);
    expect(publicJson).not.toContain(fixture.envelope.payload);
    expect(publicJson).not.toContain(fixture.envelope.signatures[0].sig);
    expect(previewJson).not.toMatch(/absolutePath|permit|key|invocation|envelope/iu);

    const missingToken = await postPreviewJson(
      app,
      "start",
      fixture.request,
      { token: null },
    );
    expect(missingToken.status).toBe(401);

    const wrongOrigin = await postPreviewJson(
      app,
      "start",
      fixture.request,
      { origin: "http://127.0.0.1:1" },
    );
    expect(wrongOrigin.status).toBe(403);

    const injectedProcessState = await postPreviewJson(app, "start", {
      ...fixture.request,
      absolutePath: fixture.sourcePath,
      permitEnvelope: {},
      pinnedTrustedPermitKeys: [KEY_ID],
    });
    expect(injectedProcessState.status).toBe(400);

    const blockedStart = await postPreviewJson(app, "start", {
      ...fixture.request,
      previewAssetId: "missing-preview-binding",
      requestId: BLOCKED_REQUEST_ID,
    });
    expect(blockedStart.status).toBe(200);
    expect(parsePreviewDto(blockedStart)).toMatchObject({
      state: "blocked",
      previewAssetId: "missing-preview-binding",
      requestId: BLOCKED_REQUEST_ID,
      source: null,
      output: null,
      productionExecution: "disabled",
      authority: "none",
    });

    const blockedStatus = await postPreviewJson(app, "status", {
      requestId: BLOCKED_REQUEST_ID,
    });
    expect(blockedStatus.status).toBe(409);
    expect((await readState(app)).offlineNormalizationPreview).toMatchObject({
      state: "ready",
      previewAssetId: PREVIEW_ASSET_ID,
      requestId: null,
    });

    const start = await postPreviewJson(app, "start", fixture.request);
    expect(start.status).toBe(202);
    expect(["ready", "running", "verified"]).toContain(parsePreviewDto(start).state);

    const staleStatus = await postPreviewJson(app, "status", {
      requestId: STALE_REQUEST_ID,
    });
    expect(staleStatus.status).toBe(409);

    const verified = await waitForPreviewState(app, fixture.request.requestId, "verified");
    expect(verified.source?.sha256).toBe(sha256(fixture.source));
    expect(verified.output).toEqual({
      sizeBytes: expected.normalizedGlb.byteLength,
      sha256: expected.report.output.sha256,
      reportSha256: expected.report.reportSha256,
      semanticExactMatch: true,
    });
    expect(verified.productionExecution).toBe("disabled");
    expect(verified.authority).toBe("none");
    expect(verified.output?.sha256).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(verified.output?.reportSha256).toMatch(/^sha256:[a-f0-9]{64}$/u);

    const staleDigest = await sendRequest(app, {
      path: artifactPath(
        app,
        "output",
        fixture.request.requestId,
        STALE_DIGEST,
      ),
    });
    expect(staleDigest.status).toBe(409);

    const staleRequest = await sendRequest(app, {
      path: artifactPath(
        app,
        "output",
        STALE_REQUEST_ID,
        expected.report.output.sha256,
      ),
    });
    expect(staleRequest.status).toBe(409);

    const output = await sendRequest(app, {
      path: artifactPath(
        app,
        "output",
        fixture.request.requestId,
        expected.report.output.sha256,
      ),
    });
    expect(output.status).toBe(200);
    expect(output.headers["content-type"]).toBe("model/gltf-binary");
    expect(output.headers["content-disposition"]).toBe(
      'attachment; filename="foundry-private-offline-format-preview.glb"',
    );
    expect(output.headers["content-length"]).toBe(
      String(expected.normalizedGlb.byteLength),
    );
    expect(output.body).toEqual(Buffer.from(expected.normalizedGlb));

    const report = await sendRequest(app, {
      path: artifactPath(
        app,
        "report",
        fixture.request.requestId,
        expected.report.reportSha256,
      ),
    });
    const exactReportBytes = Buffer.from(
      `${JSON.stringify(expected.report, null, 2)}\n`,
      "utf8",
    );
    expect(report.status).toBe(200);
    expect(report.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(report.headers["content-disposition"]).toBe(
      'attachment; filename="foundry-private-offline-format-preview-report.json"',
    );
    expect(report.body).toEqual(exactReportBytes);

    expect(await readdir(fixture.root)).toEqual(["source.glb"]);
    await app.stop();
    expect(await app.closed).toEqual({ reason: "programmatic" });
    expect(await readdir(fixture.root)).toEqual(["source.glb"]);
  });

  it("keeps one slow output lease bounded while reports remain available, then revokes it on Stop", async () => {
    const fixture = await previewRouteFixture({
      requestId: "55555555555555555555555555555555",
      triangleCount: 4_096,
    });
    const app = await startLocalFoundryApp({
      source: fixture.sourcePath,
      offlineNormalizationPreview: fixture.controllerOptions,
      offlineNormalizationPreviewTestHooks: {
        responseChunkDelayMs: 250,
      },
    });
    openApps.push(app);
    await waitForAppReady(app);
    const start = await postPreviewJson(app, "start", fixture.request);
    expect(start.status).toBe(202);
    const verified = await waitForPreviewState(
      app,
      fixture.request.requestId,
      "verified",
    );
    const output = verified.output;
    if (output === null) throw new Error("verified preview has no output");

    const wrongDigestBeforeLease = await sendRequest(app, {
      path: artifactPath(
        app,
        "output",
        fixture.request.requestId,
        STALE_DIGEST,
      ),
    });
    expect(wrongDigestBeforeLease.status).toBe(409);

    const slow = await settleWithin(openPausedResponse(
      app,
      artifactPath(
        app,
        "output",
        fixture.request.requestId,
        output.sha256,
      ),
    ), "paused output response");
    expect(slow.response.statusCode).toBe(200);
    const secondOutput = await settleWithin(sendRequest(app, {
      path: artifactPath(
        app,
        "output",
        fixture.request.requestId,
        output.sha256,
      ),
    }), "second output response");
    expect(secondOutput.status).toBe(409);
    expect(secondOutput.body.toString("utf8")).toContain(
      "already being sent",
    );

    const report = await settleWithin(sendRequest(app, {
      path: artifactPath(
        app,
        "report",
        fixture.request.requestId,
        output.reportSha256,
      ),
    }), "report response");
    expect(report.status).toBe(200);

    let receivedBytes = 0;
    slow.response.on("data", (chunk: Buffer) => {
      receivedBytes += chunk.byteLength;
    });
    const slowClosed = new Promise<void>((resolve) => {
      const resolveOnce = (): void => {
        resolve();
      };
      slow.response.once("aborted", resolveOnce);
      slow.response.once("close", resolveOnce);
      slow.response.once("error", resolveOnce);
    });
    await settleWithin(app.stop(), "app stop");
    expect(slow.response.complete).toBe(false);
    slow.response.resume();
    await settleWithin(slowClosed, "slow response close");
    expect(receivedBytes).toBeLessThan(output.sizeBytes);
    await expect(app.closed).resolves.toEqual({ reason: "programmatic" });
    slow.request.destroy();
  }, 60_000);

  it("keeps a programmatic stop open and retries even when its caller does not", async () => {
    const fixture = await previewRouteFixture({
      requestId: "33333333333333333333333333333333",
    });
    let resolveHelper!: (helper: StopRetryPreviewHelper) => void;
    const helperCreated = new Promise<StopRetryPreviewHelper>((resolve) => {
      resolveHelper = resolve;
    });
    const app = await startLocalFoundryApp({
      source: fixture.sourcePath,
      offlineNormalizationPreview: {
        ...fixture.controllerOptions,
        helperFactory: stopRetryHelperFactory(resolveHelper),
      },
    });
    openApps.push(app);

    await waitForAppReady(app);
    const start = await postPreviewJson(app, "start", fixture.request);
    expect(start.status).toBe(202);
    const helper = await helperCreated;

    await expect(app.stop()).rejects.toThrow(/could not be confirmed stopped/u);
    expect(helper.terminateCalls).toBe(1);
    expect(app.getPhase()).toBe("stopping");
    const closedBeforeRetry = await Promise.race([
      app.closed.then(() => true),
      delay(25).then(() => false),
    ]);
    expect(closedBeforeRetry).toBe(false);
    expect((await readState(app)).phase).toBe("stopping");

    helper.allowTermination = true;
    await expect(app.closed).resolves.toEqual({ reason: "programmatic" });
    expect(helper.terminateCalls).toBeGreaterThanOrEqual(2);
    expect(app.getPhase()).toBe("stopped");
  });

  it("keeps retrying an expired session until helper exit is confirmed", async () => {
    const fixture = await previewRouteFixture({
      requestId: "44444444444444444444444444444444",
    });
    let resolveHelper!: (helper: StopRetryPreviewHelper) => void;
    const helperCreated = new Promise<StopRetryPreviewHelper>((resolve) => {
      resolveHelper = resolve;
    });
    const app = await startLocalFoundryApp({
      source: fixture.sourcePath,
      sessionTtlMs: 1_000,
      offlineNormalizationPreview: {
        ...fixture.controllerOptions,
        helperFactory: stopRetryHelperFactory(resolveHelper),
      },
    });
    openApps.push(app);

    await waitForAppReady(app);
    const start = await postPreviewJson(app, "start", fixture.request);
    expect(start.status).toBe(202);
    const helper = await helperCreated;
    const firstStopDeadline = Date.now() + 2_000;
    while (helper.terminateCalls === 0 && Date.now() < firstStopDeadline) {
      await delay(10);
    }
    expect(helper.terminateCalls).toBeGreaterThanOrEqual(1);
    expect(app.getPhase()).toBe("stopping");
    const closedBeforeConfirmation = await Promise.race([
      app.closed.then(() => true),
      delay(25).then(() => false),
    ]);
    expect(closedBeforeConfirmation).toBe(false);
    expect((await readState(app)).phase).toBe("stopping");

    helper.allowTermination = true;
    await expect(app.closed).resolves.toEqual({ reason: "session_expired" });
    expect(helper.terminateCalls).toBeGreaterThanOrEqual(2);
    expect(app.getPhase()).toBe("stopped");
  });

  it("expires retained bytes in memory without creating an output file", async () => {
    const fixture = await previewRouteFixture({
      expiresAt: new Date(Date.now() + 3_000).toISOString(),
      requestId: "11111111111111111111111111111111",
    });
    const app = await startLocalFoundryApp({
      source: fixture.sourcePath,
      offlineNormalizationPreview: fixture.controllerOptions,
    });
    openApps.push(app);

    await waitForAppReady(app);
    const start = await postPreviewJson(app, "start", fixture.request);
    expect(start.status).toBe(202);
    const verified = await waitForPreviewState(app, fixture.request.requestId, "verified");
    const outputSha256 = verified.output?.sha256;
    if (outputSha256 === undefined) throw new Error("verified preview has no output digest");
    expect(await readdir(fixture.root)).toEqual(["source.glb"]);

    const remainingMs = Date.parse(fixture.expiresAt) - Date.now();
    await delay(Math.max(0, remainingMs) + 100);
    const expired = await postPreviewJson(app, "status", {
      requestId: fixture.request.requestId,
    });
    expect(expired.status).toBe(200);
    expect(parsePreviewDto(expired)).toMatchObject({
      state: "blocked",
      output: null,
      productionExecution: "disabled",
      authority: "none",
      serverPersistence: "none",
      custody: "session_memory_only",
    });

    const expiredDownload = await sendRequest(app, {
      path: artifactPath(
        app,
        "output",
        fixture.request.requestId,
        outputSha256,
      ),
    });
    expect(expiredDownload.status).toBe(409);
    expect(await readdir(fixture.root)).toEqual(["source.glb"]);

    await app.stop();
    expect(await readdir(fixture.root)).toEqual(["source.glb"]);
  });
});
