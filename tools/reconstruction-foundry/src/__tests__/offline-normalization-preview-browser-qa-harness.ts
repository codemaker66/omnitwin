import {
  createHash,
  generateKeyPairSync,
  sign,
} from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FOUNDRY_NORMALIZE_MESH_GLB_OPERATION,
  FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_VERSION,
  FOUNDRY_NORMALIZE_MESH_GLB_SEALED_IDENTITY,
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
  inspectUniversalIntakeWithSourceFactsV4,
  serializeFoundryOfflineNormalizeMeshGlbPreviewPermitV0,
} from "@omnitwin/reconstruction-foundry";
import type { CreateLocalOfflineNormalizationPreviewControllerOptions } from "../local-offline-normalization-preview.js";
import {
  startLocalFoundryApp,
  type LocalFoundryAppHandle,
} from "../local-app.js";

type BrowserQaMode = "blocked" | "signed";

const KEY_ID = "browser-qa-short-lived-permit-key";
const PREVIEW_ASSET_ID = "browser-qa-private-preview";
const SOURCE_ASSET_ID = "browser-qa-source-mesh";

function requireTestOnlyGuard(): void {
  if (
    process.env.NODE_ENV !== "test" ||
    process.env.FOUNDRY_BROWSER_QA !== "1"
  ) {
    throw new Error(
      "This browser-QA harness requires NODE_ENV=test and FOUNDRY_BROWSER_QA=1.",
    );
  }
}

function parseMode(arguments_: readonly string[]): BrowserQaMode {
  if (arguments_.length === 1 && arguments_[0] === "--mode=blocked") {
    return "blocked";
  }
  if (arguments_.length === 1 && arguments_[0] === "--mode=signed") {
    return "signed";
  }
  throw new Error("Choose exactly one mode: --mode=blocked or --mode=signed.");
}

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

function createTinySupportedGlb(): Buffer {
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

async function createSignedControllerOptions(
  sourcePath: string,
  sourceBytes: Buffer,
): Promise<CreateLocalOfflineNormalizationPreviewControllerOptions> {
  const inspection = await inspectUniversalIntakeWithSourceFactsV4(sourcePath);
  const receiptSha256 = inspection.receipt.receiptSha256;
  const now = Date.now();
  const expiresAt = new Date(now + 12 * 60_000).toISOString();
  const source = {
    assetId: SOURCE_ASSET_ID,
    inputType: "glb_gltf" as const,
    mediaType: "model/gltf-binary" as const,
    sizeBytes: sourceBytes.byteLength,
    sha256: sha256(sourceBytes),
  };
  const acknowledgementPayload = {
    schemaVersion:
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_OPERATOR_ACKNOWLEDGEMENT_V0,
    acknowledgementId: "browser-qa-operator-acknowledgement",
    operatorId: "browser-qa-test-operator",
    recordedAt: new Date(now).toISOString(),
    acknowledgement: "operator_records_private_offline_preview_intent" as const,
    statement:
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_OPERATOR_ACKNOWLEDGEMENT_STATEMENT,
    legalPosture: "operator_statement_not_independent_rights_approval" as const,
    authorizationPosture: "operator_statement_recorded_not_a_permit" as const,
    independentRightsApprovalEstablished: false as const,
    operatorStatementEstablishesExecutionPermit: false as const,
    source: {
      assetId: source.assetId,
      sizeBytes: source.sizeBytes,
      sha256: source.sha256,
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
    permitId: "browser-qa-short-lived-permit",
    issuerKeyId: KEY_ID,
    validFrom: new Date(now - 30_000).toISOString(),
    expiresAt,
    purpose: "private_offline_format_normalization_preview",
    actions: ["normalize_mesh_glb_to_private_preview_bytes"],
    source,
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
  const invocation = FoundryOfflineNormalizeMeshGlbPreviewInvocationV0Schema.parse({
    schemaVersion: FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_INVOCATION_V0,
    operation: FOUNDRY_NORMALIZE_MESH_GLB_OPERATION,
    operationVersion: FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_VERSION,
    sealedIdentity: [...FOUNDRY_NORMALIZE_MESH_GLB_SEALED_IDENTITY],
    executionMode: FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_EXECUTION_MODE,
    source,
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

  return {
    assetsByPreviewAssetId: new Map([
      [PREVIEW_ASSET_ID, { receiptSha256, absolutePath: sourcePath }],
    ]),
    evidenceByReceiptSha256: new Map([
      [receiptSha256, { previewAssetId: PREVIEW_ASSET_ID, invocation, permitEnvelope: envelope }],
    ]),
    pinnedTrustedPermitKeys: new Map([[KEY_ID, keyPair.publicKey]]),
    // Intentionally no helperFactory: browser QA must launch the real Worker.
  };
}

function writeFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
}

async function main(): Promise<void> {
  requireTestOnlyGuard();
  const mode = parseMode(process.argv.slice(2));
  const tempRoot = await mkdtemp(join(tmpdir(), "foundry-browser-qa-"));
  let app: LocalFoundryAppHandle | undefined;
  let stopRequested = false;
  const requestStop = (): void => {
    stopRequested = true;
    if (app !== undefined) void app.stop().catch(writeFailure);
  };
  process.once("SIGINT", requestStop);
  process.once("SIGTERM", requestStop);

  try {
    const sourceBytes = createTinySupportedGlb();
    const sourcePath = join(tempRoot, "browser-qa-source.glb");
    await writeFile(sourcePath, sourceBytes, { flag: "wx" });
    const offlineNormalizationPreview = mode === "signed"
      ? await createSignedControllerOptions(sourcePath, sourceBytes)
      : undefined;
    app = await startLocalFoundryApp({
      source: sourcePath,
      ...(offlineNormalizationPreview === undefined
        ? {}
        : { offlineNormalizationPreview }),
    });
    process.stdout.write(`${JSON.stringify({ url: app.url, mode, tempRoot })}\n`);
    if (stopRequested) await app.stop();
    await app.closed;
  } finally {
    process.removeListener("SIGINT", requestStop);
    process.removeListener("SIGTERM", requestStop);
    if (app !== undefined && app.getPhase() !== "stopped") await app.stop();
    await rm(tempRoot, { force: true, recursive: true });
  }
}

void main().catch((error: unknown) => {
  writeFailure(error);
  process.exitCode = 1;
});
