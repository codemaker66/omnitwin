import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FOUNDRY_DERIVATIVE_AUTHORIZED_ACTIONS_V0,
  FOUNDRY_DERIVATIVE_FORBIDDEN_DOWNSTREAM_USES_V0,
  FOUNDRY_DERIVATIVE_RIGHTS_APPROVAL_V0,
  FOUNDRY_DERIVATIVE_RIGHTS_POLICY_V0,
  FOUNDRY_INTAKE_ADMISSION_CAPABILITIES,
  FOUNDRY_INTAKE_ADMISSION_REVIEW_V0,
  FOUNDRY_JOB_SPEC_V0,
  FOUNDRY_LOSSLESS_INTERNAL_FORMAT_NORMALIZATION_DERIVATIVE_CLASS,
  FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_V0,
  FoundryDerivativeRightsApprovalV0Schema,
  FoundryDerivativeRightsPolicyV0Schema,
  FoundryDerivativeRightsTrustedPolicyStateV0Schema,
  FoundryIngestManifestV0Schema,
  FoundryIntakeAdmissionReviewPayloadSchema,
  FoundryJobSpecV0Schema,
  computeFoundryDerivativeRightsPolicySha256,
  computeFoundryDerivativeRightsRestrictionSha256,
  computeFoundryIngestManifestSha256,
  computeFoundryJobApprovalSubjectSha256,
  finalizeFoundryIntakeAdmissionReview,
} from "@omnitwin/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dssePreAuthenticationEncoding } from "../dsse.js";
import { sha256Bytes } from "../hash.js";
import { admitUniversalIntakeReceipt } from "../intake-admission.js";
import { inspectUniversalIntake } from "../intake-receipt.js";
import { stageUniversalIntakeDraft } from "../intake-staging.js";
import {
  createFoundryLocalResumableNormalizationPreviewService,
  type CreateFoundryLocalResumableNormalizationPreviewServiceOptions,
  type FoundryLocalNormalizationPreviewDurabilityStage,
  type FoundryLocalNormalizationPreviewDurableRecordKind,
  type RunFoundryLocalResumableNormalizationPreviewOptions,
} from "../local-resumable-normalization-preview.js";
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
  computeFoundryOfflineNormalizeMeshGlbPreviewOperatorAcknowledgementSha256,
  serializeFoundryOfflineNormalizeMeshGlbPreviewPermitV0,
} from "../offline-normalize-mesh-glb-preview.js";
import { glbFixture } from "./fixture.js";

const NOW = "2026-07-17T10:00:00.000Z";
const SIGNING_KEY_ID = "local-resume-test-key";
const cleanup: string[] = [];
const DURABILITY_STAGES = [
  "after_open",
  "after_partial_write",
  "after_fsync",
  "after_publish",
] as const satisfies readonly FoundryLocalNormalizationPreviewDurabilityStage[];
const DURABILITY_RECORD_KINDS = [
  "lease",
  "state",
  "checkpoint",
  "receipt",
  "index",
  "permit",
] as const satisfies readonly FoundryLocalNormalizationPreviewDurableRecordKind[];
const DURABILITY_FAULT_CASES = DURABILITY_RECORD_KINDS.flatMap((recordKind) =>
  DURABILITY_STAGES.map((stage) => ({ recordKind, stage })),
);

async function atomicTempEntries(root: string): Promise<readonly string[]> {
  const entries = await readdir(root, { recursive: true });
  return entries
    .map(String)
    .filter((entry) => /\.atomic-[a-f0-9-]+\.tmp$/u.test(entry))
    .sort();
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function rewriteJson(
  bytes: Buffer,
  mutate: (json: Record<string, unknown>) => void,
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
  const encoded = Buffer.from(JSON.stringify(json), "utf8");
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

function sourceBinding(bytes: Uint8Array) {
  return {
    assetId: "fixture-mesh",
    inputType: "glb_gltf" as const,
    mediaType: "model/gltf-binary" as const,
    sizeBytes: bytes.byteLength,
    sha256: `sha256:${sha256Bytes(bytes)}`,
  };
}

function operatorAcknowledgement(bytes: Uint8Array) {
  const source = sourceBinding(bytes);
  const payload = {
    schemaVersion:
      FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_OPERATOR_ACKNOWLEDGEMENT_V0,
    acknowledgementId: "local-resume-fixture-ack",
    operatorId: "fixture-operator",
    recordedAt: NOW,
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

function signedPreviewPermit(bytes: Uint8Array): {
  readonly invocation: ReturnType<
    typeof FoundryOfflineNormalizeMeshGlbPreviewInvocationV0Schema.parse
  >;
  readonly envelope: {
    readonly payloadType: string;
    readonly payload: string;
    readonly signatures: readonly [
      { readonly keyid: string; readonly sig: string },
    ];
  };
  readonly keys: ReadonlyMap<string, KeyObject>;
} {
  const keyPair = generateKeyPairSync("ed25519");
  const source = sourceBinding(bytes);
  const permit = FoundryOfflineNormalizeMeshGlbPreviewPermitV0Schema.parse({
    schemaVersion: FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_V0,
    permitId: "local-resume-fixture-permit",
    issuerKeyId: SIGNING_KEY_ID,
    validFrom: "2026-07-17T09:55:00.000Z",
    expiresAt: "2026-07-17T10:05:00.000Z",
    purpose: "private_offline_format_normalization_preview",
    actions: ["normalize_mesh_glb_to_private_preview_bytes"],
    source,
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
  const permitBytes =
    serializeFoundryOfflineNormalizeMeshGlbPreviewPermitV0(permit);
  const envelope = {
    payloadType: FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_PAYLOAD_TYPE,
    payload: permitBytes.toString("base64"),
    signatures: [
      {
        keyid: SIGNING_KEY_ID,
        sig: sign(
          null,
          dssePreAuthenticationEncoding(
            FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_PERMIT_PAYLOAD_TYPE,
            permitBytes,
          ),
          keyPair.privateKey,
        ).toString("base64"),
      },
    ] as const,
  };
  const acknowledgement = operatorAcknowledgement(bytes);
  const invocation =
    FoundryOfflineNormalizeMeshGlbPreviewInvocationV0Schema.parse({
      schemaVersion: FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_INVOCATION_V0,
      operation: FOUNDRY_NORMALIZE_MESH_GLB_OPERATION,
      operationVersion: FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_VERSION,
      sealedIdentity: [...FOUNDRY_NORMALIZE_MESH_GLB_SEALED_IDENTITY],
      executionMode: FOUNDRY_OFFLINE_NORMALIZE_MESH_GLB_PREVIEW_EXECUTION_MODE,
      source,
      permit: {
        payloadSha256: `sha256:${sha256Bytes(permitBytes)}`,
        keyId: SIGNING_KEY_ID,
        expiresAt: permit.expiresAt,
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
    invocation,
    envelope,
    keys: new Map([[SIGNING_KEY_ID, keyPair.publicKey]]),
  };
}

function rightsRecord() {
  return {
    basis: "customer_owned" as const,
    commercialUse: "allowed" as const,
    modelTrainingUse: "allowed" as const,
    redistribution: "allowed" as const,
    termsReviewedAt: "2026-07-17T09:00:00.000Z",
    termsReference: "https://rights.example/fixture-mesh",
    restrictions: ["Internal lossless derivatives only."],
  };
}

async function fixture(bytes: Buffer = glbFixture()): Promise<{
  readonly workspace: string;
  readonly sourcePath: string;
  readonly stagedPath: string;
  readonly stateRoot: string;
  readonly permitLedgerRoot: string;
  readonly serviceOptions: CreateFoundryLocalResumableNormalizationPreviewServiceOptions;
  readonly runOptions: RunFoundryLocalResumableNormalizationPreviewOptions;
}> {
  const workspace = await mkdtemp(join(tmpdir(), "foundry-local-resume-"));
  cleanup.push(workspace);
  const sourcePath = join(workspace, "source");
  const stagedPath = join(workspace, "staged");
  const stateRoot = join(workspace, "state");
  const permitLedgerRoot = join(workspace, "permit-ledger");
  await mkdir(sourcePath);
  await writeFile(join(sourcePath, "fixture.glb"), bytes);
  const receipt = await inspectUniversalIntake(sourcePath);
  const receiptFile = receipt.files.find(
    (candidate) => candidate.path === "fixture.glb",
  );
  if (receiptFile === undefined) throw new Error("missing GLB receipt fixture");
  const asset = {
    id: "fixture-mesh",
    sourceRootId: "fixture-root",
    relativePath: "fixture.glb",
    inputType: "glb_gltf" as const,
    mediaType: "model/gltf-binary",
    sizeBytes: bytes.length,
    sha256: `sha256:${sha256Bytes(bytes)}`,
    immutable: true as const,
    captureState: "official_export" as const,
    accessState: "official_export" as const,
    capturedAt: null,
    coordinateFrameId: null,
    calibrationAssetIds: [],
    parentAssetIds: [],
    rights: rightsRecord(),
    provenanceClass: "captured" as const,
    evidenceKinds: [],
    inspection: {
      geometryValue: "high" as const,
      appearanceValue: "high" as const,
      calibrationValue: "none" as const,
      scaleValue: "high" as const,
      metadataKeys: [],
      decisiveNextTest: "Verify exact decoded GLB semantic equality.",
    },
    notes: [],
  };
  const reviewPayload = FoundryIntakeAdmissionReviewPayloadSchema.parse({
    schemaVersion: FOUNDRY_INTAKE_ADMISSION_REVIEW_V0,
    receiptSha256: receipt.receiptSha256,
    projectId: "local-resume-fixture",
    reviewedAt: "2026-07-17T09:10:00.000Z",
    reviewedBy: "fixture-operator",
    sourceRoot: {
      id: "fixture-root",
      kind: "local_directory",
      displayName: "Fixture GLB source",
      locationRedacted: "FIXTURE_SOURCE/[redacted]",
      caseSensitivity: "insensitive",
      readOnly: true,
    },
    coordinateFrames: [],
    transforms: [],
    decisions: [
      {
        action: "admit",
        path: "fixture.glb",
        classification: {
          method: "accepted_detector_candidate",
          rationale:
            "The bounded GLB magic and version match the reviewed file.",
          evidenceReferences: ["intake-receipt:glb-magic"],
        },
        asset,
      },
    ],
    provenanceEdges: [],
    generatedRegions: [],
    legalReviewState: "requires_review",
    sourceMutationPermitted: false,
    authority: "none",
    capabilities: FOUNDRY_INTAKE_ADMISSION_CAPABILITIES,
  });
  const review = finalizeFoundryIntakeAdmissionReview(reviewPayload);
  const admission = admitUniversalIntakeReceipt(receipt, review);
  const staged = await stageUniversalIntakeDraft({
    sourcePath,
    outputDirectory: stagedPath,
    receipt,
    review,
  });
  if (process.platform !== "win32") await chmod(stagedPath, 0o700);
  const manifest = FoundryIngestManifestV0Schema.parse(admission.manifest);
  expect(staged.index.manifestSha256).toBe(
    computeFoundryIngestManifestSha256(manifest),
  );
  const job = FoundryJobSpecV0Schema.parse({
    schemaVersion: FOUNDRY_JOB_SPEC_V0,
    id: "local-resume-normalize-job",
    projectId: manifest.projectId,
    ingestManifestSha256: computeFoundryIngestManifestSha256(manifest),
    executionIntent: "plan_only",
    providerKind: "local_cpu",
    providerAdapterId: "signed-offline-preview-v0",
    stages: [
      {
        id: "normalize-mesh",
        kind: "geometry",
        dependsOn: [],
        containerImage: `local/sealed-normalize@sha256:${"a".repeat(64)}`,
        command: ["omnitwin-sealed-worker", "normalize_mesh_glb", "v0"],
        inputAssetIds: [asset.id],
        outputNames: ["normalized-meshes"],
        rightsPurposes: ["commercial_internal_use"],
        cpuCores: 1,
        ramGiB: 1,
        gpuCount: 0,
        minimumGpuVramGiB: 0,
        scratchGiB: 1,
        networkAccess: "none",
        checkpoint: "none",
        resumable: false,
      },
    ],
    objectStorageProfile: null,
    sourceMountMode: "read_only",
    outputPrefix: "local-resume-fixture/normalize",
    estimatedCostUsd: 0,
    budgetCapUsd: 0,
    killSwitchEnabled: true,
    computeApprovalId: null,
    createdAt: "2026-07-17T09:20:00.000Z",
  });
  const policy = FoundryDerivativeRightsPolicyV0Schema.parse({
    schemaVersion: FOUNDRY_DERIVATIVE_RIGHTS_POLICY_V0,
    policyVersion: "local-resume-rights-2026-07",
    generation: 1,
    effectiveAt: "2026-07-17T09:00:00.000Z",
    maximumApprovalTtlSeconds: 7_200,
    requireNonUnknownRightsBasis: true,
    requireHttpsTermsReference: true,
    requireTermsReviewedAt: true,
    authorizedActions: FOUNDRY_DERIVATIVE_AUTHORIZED_ACTIONS_V0,
    forbiddenDownstreamUses: FOUNDRY_DERIVATIVE_FORBIDDEN_DOWNSTREAM_USES_V0,
    operations: [
      {
        operationId: FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_V0,
        derivativeClass:
          FOUNDRY_LOSSLESS_INTERNAL_FORMAT_NORMALIZATION_DERIVATIVE_CLASS,
        requiredStageKind: "geometry",
        requiredInputType: "glb_gltf",
        requiredMediaType: "model/gltf-binary",
        requiredFileExtension: ".glb",
        requiredAssetCount: 1,
        requiredRightsPurposes: ["commercial_internal_use"],
        requiredCommand: ["omnitwin-sealed-worker", "normalize_mesh_glb", "v0"],
        requiredNetworkAccess: "none",
        deterministic: true,
      },
    ],
  });
  const termsEvidenceSha256 = `sha256:${"b".repeat(64)}`;
  const restrictionText = asset.rights.restrictions[0];
  if (restrictionText === undefined)
    throw new Error("missing rights restriction");
  const approval = FoundryDerivativeRightsApprovalV0Schema.parse({
    schemaVersion: FOUNDRY_DERIVATIVE_RIGHTS_APPROVAL_V0,
    approvalId: "local-resume-derivative-approval",
    policyVersion: policy.policyVersion,
    policyDefinitionSha256: computeFoundryDerivativeRightsPolicySha256(policy),
    policyGeneration: policy.generation,
    jobSubjectSha256: computeFoundryJobApprovalSubjectSha256(job),
    ingestManifestSha256: computeFoundryIngestManifestSha256(manifest),
    stageId: "normalize-mesh",
    operation: {
      operationId: FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_V0,
      derivativeClass:
        FOUNDRY_LOSSLESS_INTERNAL_FORMAT_NORMALIZATION_DERIVATIVE_CLASS,
    },
    authorizedActions: FOUNDRY_DERIVATIVE_AUTHORIZED_ACTIONS_V0,
    forbiddenDownstreamUses: FOUNDRY_DERIVATIVE_FORBIDDEN_DOWNSTREAM_USES_V0,
    assetIds: [asset.id],
    assetRightsEvidence: [
      {
        assetId: asset.id,
        basis: asset.rights.basis,
        termsReference: asset.rights.termsReference,
        reviewedAt: asset.rights.termsReviewedAt,
        termsEvidenceArtifact: {
          artifactId: "terms-fixture-mesh",
          sha256: termsEvidenceSha256,
          sizeBytes: 1_024,
          mediaType: "application/pdf",
          capturedAt: "2026-07-17T08:55:00.000Z",
        },
        restrictionsReviewed: true,
        restrictionDispositions: [
          {
            restrictionIndex: 0,
            restrictionText,
            restrictionSha256: computeFoundryDerivativeRightsRestrictionSha256({
              assetId: asset.id,
              restrictionIndex: 0,
              restrictionText,
            }),
            disposition: "satisfied",
            rationale:
              "The approved action is the exact internal lossless derivative.",
            supportingEvidenceSha256: termsEvidenceSha256,
          },
        ],
      },
    ],
    assetSnapshots: [asset],
    decision: "allowed",
    decidedBy: "rights-reviewer@example.test",
    decidedAt: "2026-07-17T09:30:00.000Z",
    expiresAt: "2026-07-17T11:00:00.000Z",
  });
  const signed = signedPreviewPermit(bytes);
  const trustedPolicyState =
    FoundryDerivativeRightsTrustedPolicyStateV0Schema.parse({
      definition: policy,
      revocation: null,
    });
  return {
    workspace,
    sourcePath,
    stagedPath,
    stateRoot,
    permitLedgerRoot,
    serviceOptions: {
      stateRoot,
      permitLedgerRoot,
      pinnedTrustedPermitKeys: signed.keys,
      recordAuthenticationKey: Buffer.alloc(32, 0x7a),
      getTrustedDerivativeRightsPolicyState: () => trustedPolicyState,
    },
    runOptions: {
      stagedIntakeDirectory: stagedPath,
      jobSpec: job,
      derivativeRightsApproval: approval,
      previewInvocation: signed.invocation,
      permitEnvelope: signed.envelope,
    },
  };
}

describe("durable executor platform boundary", () => {
  it.runIf(process.platform !== "linux")(
    "fails closed before touching host roots when no reviewed OS-private backend exists",
    async () => {
      const workspace = await mkdtemp(
        join(tmpdir(), "foundry-platform-refusal-"),
      );
      cleanup.push(workspace);
      const stateRoot = join(workspace, "state-does-not-exist");
      await expect(
        createFoundryLocalResumableNormalizationPreviewService({
          stateRoot,
          permitLedgerRoot: join(workspace, "ledger-does-not-exist"),
          pinnedTrustedPermitKeys: new Map(),
          recordAuthenticationKey: Buffer.alloc(32, 0x7a),
          getTrustedDerivativeRightsPolicyState: () => null,
        }),
      ).rejects.toMatchObject({
        code: "LOCAL_NORMALIZATION_PREVIEW_PLATFORM_UNSUPPORTED",
      });
      await expect(readFile(stateRoot)).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );
});

describe.skipIf(process.platform !== "linux")(
  "real local resumable authority-none normalization preview",
  () => {
    it("runs a rights-approved staged GLB once and replays the committed review output idempotently", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
      const current = await fixture();
      let transformStarts = 0;
      const onPhase: NonNullable<
        RunFoundryLocalResumableNormalizationPreviewOptions["onPhase"]
      > = (event) => {
        if (event.phase === "transform_started") transformStarts += 1;
      };
      const service =
        await createFoundryLocalResumableNormalizationPreviewService(
          current.serviceOptions,
        );

      const first = await service.run({
        ...current.runOptions,
        onPhase,
      });
      expect(first.status).toBe("succeeded");
      if (first.status !== "succeeded") throw new Error("expected success");
      expect(first.receipt).toMatchObject({
        authority: "none",
        productionExecution: "disabled",
        outputDisposition: "private_quarantine_review_only",
        capabilities: {
          review: "local_only",
          measurement: "not_authorized",
          publication: "not_authorized",
          runtimePromotion: "not_authorized",
        },
      });
      expect(first.index.commitMarker).toBe(
        "artifact_index_content_fsynced_last",
      );
      expect(transformStarts).toBe(1);

      const replay = await service.run({
        ...current.runOptions,
        onPhase,
      });
      expect(replay.status).toBe("already_succeeded");
      expect(replay.commandId).toBe(first.commandId);
      expect(transformStarts).toBe(1);
    });

    it("pauses after a complete transform checkpoint and resumes without consuming or running the permit twice", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
      const current = await fixture();
      let transformStarts = 0;
      const onPhase: NonNullable<
        RunFoundryLocalResumableNormalizationPreviewOptions["onPhase"]
      > = (event) => {
        if (event.phase === "transform_started") transformStarts += 1;
      };
      const service =
        await createFoundryLocalResumableNormalizationPreviewService(
          current.serviceOptions,
        );
      const paused = await service.run({
        ...current.runOptions,
        pauseAfterCheckpoint: true,
        onPhase,
      });
      expect(paused.status).toBe("paused");
      expect(transformStarts).toBe(1);

      const resumedService =
        await createFoundryLocalResumableNormalizationPreviewService(
          current.serviceOptions,
        );
      const resumed = await resumedService.run({
        ...current.runOptions,
        onPhase,
      });
      expect(resumed.status).toBe("succeeded");
      expect(resumed.commandId).toBe(paused.commandId);
      expect(transformStarts).toBe(1);
    });

    it.each(["receipt", "index"] as const)(
      "recovers after the %s commit boundary without regenerating durable commit identity",
      async (boundary) => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(NOW);
        const current = await fixture();
        let transformStarts = 0;
        const service =
          await createFoundryLocalResumableNormalizationPreviewService(
            current.serviceOptions,
          );
        const paused = await service.run({
          ...current.runOptions,
          pauseAfterCommitBoundary: boundary,
          onPhase: (event) => {
            if (event.phase === "transform_started") transformStarts += 1;
          },
        });
        expect(paused.status).toBe("paused");
        const receiptPath = join(
          current.stateRoot,
          paused.commandId,
          "review-output",
          "execution-receipt.json",
        );
        const committedReceipt = JSON.parse(
          (await readFile(receiptPath)).toString("utf8"),
        ) as { readonly receiptSha256: string; readonly completedAt: string };

        vi.setSystemTime("2026-07-17T10:00:01.000Z");
        const resumedService =
          await createFoundryLocalResumableNormalizationPreviewService(
            current.serviceOptions,
          );
        const resumed = await resumedService.run({
          ...current.runOptions,
          onPhase: (event) => {
            if (event.phase === "transform_started") transformStarts += 1;
          },
        });

        expect(resumed.status).toBe("succeeded");
        if (resumed.status !== "succeeded")
          throw new Error("expected recovered success");
        expect(resumed.receipt.receiptSha256).toBe(
          committedReceipt.receiptSha256,
        );
        expect(resumed.receipt.completedAt).toBe(committedReceipt.completedAt);
        expect(transformStarts).toBe(1);
      },
    );

    it("re-reads host-trusted policy state and refuses commit when its generation changes after checkpointing", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
      const current = await fixture();
      const initialPolicyState =
        FoundryDerivativeRightsTrustedPolicyStateV0Schema.parse(
          await current.serviceOptions.getTrustedDerivativeRightsPolicyState(),
        );
      const changedPolicyState =
        FoundryDerivativeRightsTrustedPolicyStateV0Schema.parse({
          definition: {
            ...initialPolicyState.definition,
            generation: initialPolicyState.definition.generation + 1,
          },
          revocation: null,
        });
      let policyLookups = 0;
      const service =
        await createFoundryLocalResumableNormalizationPreviewService({
          ...current.serviceOptions,
          getTrustedDerivativeRightsPolicyState: () => {
            policyLookups += 1;
            return policyLookups === 1
              ? initialPolicyState
              : changedPolicyState;
          },
        });

      await expect(service.run(current.runOptions)).rejects.toMatchObject({
        code: "LOCAL_NORMALIZATION_PREVIEW_TRUSTED_POLICY_CHANGED",
      });
      expect(policyLookups).toBe(2);
    });

    it.each(DURABILITY_FAULT_CASES)(
      "keeps $recordKind atomic across an injected $stage interruption",
      async ({ recordKind, stage }) => {
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(NOW);
        const current = await fixture();
        let injected = false;
        const interruptedService =
          await createFoundryLocalResumableNormalizationPreviewService({
            ...current.serviceOptions,
            durabilityFaultInjector: (event) => {
              if (
                injected ||
                event.recordKind !== recordKind ||
                event.stage !== stage
              ) {
                return;
              }
              injected = true;
              throw new Error("intentional abrupt durability interruption");
            },
          });

        await expect(
          interruptedService.run(current.runOptions),
        ).rejects.toMatchObject({
          code: "LOCAL_NORMALIZATION_PREVIEW_DURABILITY_FAULT_INJECTED",
        });
        expect(injected).toBe(true);

        const resumedService =
          await createFoundryLocalResumableNormalizationPreviewService({
            ...current.serviceOptions,
            confirmAbandonedLease: () => true,
          });
        const resumed = resumedService.run({
          ...current.runOptions,
        });
        const mustRequireFreshPermit =
          (recordKind === "permit" && stage === "after_publish") ||
          (recordKind === "checkpoint" && stage !== "after_publish");
        if (mustRequireFreshPermit) {
          await expect(resumed).rejects.toMatchObject({
            code: "LOCAL_NORMALIZATION_PREVIEW_PERMIT_CONSUMED_WITHOUT_CHECKPOINT",
          });
        } else {
          await expect(resumed).resolves.toMatchObject({ status: "succeeded" });
        }
        expect(await atomicTempEntries(current.workspace)).toEqual([]);
      },
    );

    it("does not let a fresh caller-selected command root replay a permit already consumed in the host-pinned global ledger", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
      const current = await fixture();
      let transformStarts = 0;
      const abort = new AbortController();
      const firstService =
        await createFoundryLocalResumableNormalizationPreviewService(
          current.serviceOptions,
        );
      await expect(
        firstService.run({
          ...current.runOptions,
          signal: abort.signal,
          onPhase: (event) => {
            if (event.phase === "permit_consumed") abort.abort();
            if (event.phase === "transform_started") transformStarts += 1;
          },
        }),
      ).resolves.toMatchObject({ status: "cancelled", permitConsumed: true });

      const alternateStateRoot = join(current.workspace, "alternate-state");
      const secondService =
        await createFoundryLocalResumableNormalizationPreviewService({
          ...current.serviceOptions,
          stateRoot: alternateStateRoot,
        });
      await expect(
        secondService.run({
          ...current.runOptions,
          onPhase: (event) => {
            if (event.phase === "transform_started") transformStarts += 1;
          },
        }),
      ).rejects.toMatchObject({
        code: "LOCAL_NORMALIZATION_PREVIEW_PERMIT_CONSUMED_WITHOUT_CHECKPOINT",
      });
      expect(transformStarts).toBe(0);
    });

    it("keeps check-to-open writes on the pinned directory handle when the visible output path is swapped", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
      const current = await fixture();
      let swapped = false;
      let commandId: string | null = null;
      const externalTarget = join(current.workspace, "external-output-target");
      await mkdir(externalTarget, { mode: 0o700 });
      const service =
        await createFoundryLocalResumableNormalizationPreviewService({
          ...current.serviceOptions,
          durabilityFaultInjector: async (event) => {
            if (
              swapped ||
              commandId === null ||
              event.recordKind !== "normalized_glb" ||
              event.stage !== "after_directory_bind_before_open"
            ) {
              return;
            }
            swapped = true;
            const outputPath = join(
              current.stateRoot,
              commandId,
              "review-output",
            );
            const movedOutputPath = join(
              current.stateRoot,
              commandId,
              "review-output-moved",
            );
            await rename(outputPath, movedOutputPath);
            await symlink(externalTarget, outputPath, "dir");
          },
        });

      await expect(
        service.run({
          ...current.runOptions,
          onPhase: (event) => {
            if (event.phase === "transform_started") {
              commandId = event.commandId;
            }
          },
        }),
      ).rejects.toMatchObject({
        code: "LOCAL_NORMALIZATION_PREVIEW_DIRECTORY_CHANGED",
      });
      expect(swapped).toBe(true);
      expect(await readdir(externalTarget)).toEqual([]);
    });

    it("rejects an oversized output through the bounded handle-read path", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
      const current = await fixture();
      let enlarged = false;
      const service =
        await createFoundryLocalResumableNormalizationPreviewService(
          current.serviceOptions,
        );

      await expect(
        service.run({
          ...current.runOptions,
          onPhase: async (event) => {
            if (event.phase !== "checkpoint_committed" || enlarged) return;
            enlarged = true;
            await truncate(
              join(
                current.stateRoot,
                event.commandId,
                "review-output",
                "normalization-report.json",
              ),
              64 * 1024 * 1024 + 1,
            );
          },
        }),
      ).rejects.toMatchObject({
        code: "LOCAL_NORMALIZATION_PREVIEW_FILE_UNSAFE",
      });
    });

    it("durably cancels after permit consumption and never publishes a review output", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
      const current = await fixture();
      const abort = new AbortController();
      const service =
        await createFoundryLocalResumableNormalizationPreviewService(
          current.serviceOptions,
        );
      const cancelled = await service.run({
        ...current.runOptions,
        signal: abort.signal,
        onPhase: (event) => {
          if (event.phase === "permit_consumed") abort.abort();
        },
      });
      expect(cancelled).toMatchObject({
        status: "cancelled",
        permitConsumed: true,
        authority: "none",
      });
      await expect(
        readFile(
          join(
            current.stateRoot,
            cancelled.commandId,
            "review-output",
            "artifact-index.json",
          ),
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("fails closed on an expired operation-specific rights approval before creating command state", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
      const current = await fixture();
      const approval = FoundryDerivativeRightsApprovalV0Schema.parse({
        ...(current.runOptions.derivativeRightsApproval as object),
        expiresAt: "2026-07-17T09:59:59.999Z",
      });
      const service =
        await createFoundryLocalResumableNormalizationPreviewService(
          current.serviceOptions,
        );
      await expect(
        service.run({
          ...current.runOptions,
          derivativeRightsApproval: approval,
        }),
      ).rejects.toMatchObject({
        code: "LOCAL_NORMALIZATION_PREVIEW_RIGHTS_NOT_APPROVED",
        message: expect.stringContaining("approval_expired"),
      });
      await expect(
        readFile(join(current.stateRoot, "unexpected")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("rejects unsupported GLB semantics exactly instead of reporting a conversion", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
      const unsupported = rewriteJson(glbFixture(), (json) => {
        json.materials = [{ pbrMetallicRoughness: {} }];
      });
      const current = await fixture(unsupported);
      const service =
        await createFoundryLocalResumableNormalizationPreviewService(
          current.serviceOptions,
        );
      await expect(service.run(current.runOptions)).rejects.toMatchObject({
        code: "NORMALIZE_MESH_GLB_UNSUPPORTED_SEMANTICS",
      });
    });

    it("detects staged-source mutation after the handle-bound read before final commit", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
      const current = await fixture();
      let changed = false;
      const service =
        await createFoundryLocalResumableNormalizationPreviewService(
          current.serviceOptions,
        );
      await expect(
        service.run({
          ...current.runOptions,
          onPhase: async (event) => {
            if (event.phase !== "source_read" || changed) return;
            changed = true;
            const stagedSource = join(
              current.stagedPath,
              "source",
              "fixture.glb",
            );
            const bytes = await readFile(stagedSource);
            bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
            await writeFile(stagedSource, bytes);
          },
        }),
      ).rejects.toMatchObject({
        code: "LOCAL_NORMALIZATION_PREVIEW_SOURCE_IDENTITY_MISMATCH",
      });
    });

    it("ignores a run-supplied abandonment claim and rejects lease theft while the authenticated writer is active", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
      const current = await fixture();
      let releaseTransform!: () => void;
      const transformRelease = new Promise<void>((resolve) => {
        releaseTransform = resolve;
      });
      let reportTransformEntered!: () => void;
      const transformEntered = new Promise<void>((resolve) => {
        reportTransformEntered = resolve;
      });
      const service =
        await createFoundryLocalResumableNormalizationPreviewService(
          current.serviceOptions,
        );
      const first = service.run({
        ...current.runOptions,
        onPhase: async (event) => {
          if (event.phase !== "transform_started") return;
          reportTransformEntered();
          await transformRelease;
        },
      });
      await transformEntered;
      const untrustedAbandonmentClaim = vi.fn(() => true);
      const untrustedRunInput: RunFoundryLocalResumableNormalizationPreviewOptions & {
        readonly confirmAbandonedLease: () => boolean;
      } = {
        ...current.runOptions,
        confirmAbandonedLease: untrustedAbandonmentClaim,
      };
      await expect(service.run(untrustedRunInput)).rejects.toMatchObject({
        code: "LOCAL_NORMALIZATION_PREVIEW_LEASE_HELD",
      });
      expect(untrustedAbandonmentClaim).not.toHaveBeenCalled();
      releaseTransform();
      await expect(first).resolves.toMatchObject({ status: "succeeded" });
    });

    it("serializes a delayed abandonment decision against writer release and replacement", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
      const current = await fixture();

      let releaseFirstTransform!: () => void;
      const firstTransformRelease = new Promise<void>((resolve) => {
        releaseFirstTransform = resolve;
      });
      let reportFirstTransformEntered!: () => void;
      const firstTransformEntered = new Promise<void>((resolve) => {
        reportFirstTransformEntered = resolve;
      });
      let reportFirstOutputCommitted!: () => void;
      const firstOutputCommitted = new Promise<void>((resolve) => {
        reportFirstOutputCommitted = resolve;
      });
      const firstService =
        await createFoundryLocalResumableNormalizationPreviewService(
          current.serviceOptions,
        );
      const first = firstService.run({
        ...current.runOptions,
        onPhase: async (event) => {
          if (event.phase === "transform_started") {
            reportFirstTransformEntered();
            await firstTransformRelease;
          }
          if (event.phase === "output_committed") {
            reportFirstOutputCommitted();
          }
        },
      });
      await firstTransformEntered;

      let releaseStaleOracle!: () => void;
      const staleOracleRelease = new Promise<void>((resolve) => {
        releaseStaleOracle = resolve;
      });
      let reportStaleOracleEntered!: () => void;
      const staleOracleEntered = new Promise<void>((resolve) => {
        reportStaleOracleEntered = resolve;
      });
      let oracleCalls = 0;
      const recoveryService =
        await createFoundryLocalResumableNormalizationPreviewService({
          ...current.serviceOptions,
          confirmAbandonedLease: async () => {
            oracleCalls += 1;
            if (oracleCalls !== 1) return false;
            reportStaleOracleEntered();
            await staleOracleRelease;
            return false;
          },
        });
      const recovery = recoveryService.run(current.runOptions);
      await staleOracleEntered;

      releaseFirstTransform();
      await firstOutputCommitted;
      await new Promise<void>((resolve) => setTimeout(resolve, 25));

      let releaseReplacement!: () => void;
      const replacementRelease = new Promise<void>((resolve) => {
        releaseReplacement = resolve;
      });
      let reportReplacementEntered!: () => void;
      const replacementEntered = new Promise<void>((resolve) => {
        reportReplacementEntered = resolve;
      });
      let replacementHasEntered = false;
      const replacementService =
        await createFoundryLocalResumableNormalizationPreviewService(
          current.serviceOptions,
        );
      const replacement = replacementService.run({
        ...current.runOptions,
        onPhase: async (event) => {
          if (event.phase !== "source_read") return;
          replacementHasEntered = true;
          reportReplacementEntered();
          await replacementRelease;
        },
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
      expect(replacementHasEntered).toBe(false);

      releaseStaleOracle();
      await expect(recovery).rejects.toMatchObject({
        code: "LOCAL_NORMALIZATION_PREVIEW_LEASE_HELD",
      });
      expect(oracleCalls).toBe(1);
      await expect(first).resolves.toMatchObject({ status: "succeeded" });
      await replacementEntered;
      releaseReplacement();
      await expect(replacement).resolves.toMatchObject({
        status: "already_succeeded",
      });
    });

    it("recovers a strictly higher fence after crashing between an authenticated abandoned rename and replacement", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(NOW);
      const current = await fixture();
      let orphanInjected = false;
      const orphaningService =
        await createFoundryLocalResumableNormalizationPreviewService({
          ...current.serviceOptions,
          durabilityFaultInjector: (event) => {
            if (
              orphanInjected ||
              event.recordKind !== "lease" ||
              event.stage !== "after_publish"
            ) {
              return;
            }
            orphanInjected = true;
            throw new Error("leave an authenticated published writer lease");
          },
        });
      await expect(
        orphaningService.run(current.runOptions),
      ).rejects.toMatchObject({
        code: "LOCAL_NORMALIZATION_PREVIEW_DURABILITY_FAULT_INJECTED",
      });
      expect(orphanInjected).toBe(true);

      let abandonmentCrashInjected = false;
      const crashingRecoveryService =
        await createFoundryLocalResumableNormalizationPreviewService({
          ...current.serviceOptions,
          confirmAbandonedLease: () => true,
          durabilityFaultInjector: (event) => {
            if (
              abandonmentCrashInjected ||
              event.recordKind !== "lease" ||
              event.stage !== "after_abandoned_lease_rename"
            ) {
              return;
            }
            abandonmentCrashInjected = true;
            throw new Error("crash after durable abandoned lease rename");
          },
        });
      await expect(
        crashingRecoveryService.run(current.runOptions),
      ).rejects.toMatchObject({
        code: "LOCAL_NORMALIZATION_PREVIEW_DURABILITY_FAULT_INJECTED",
      });
      expect(abandonmentCrashInjected).toBe(true);

      let recoveredFence: string | null = null;
      const resumedService =
        await createFoundryLocalResumableNormalizationPreviewService(
          current.serviceOptions,
        );
      await expect(
        resumedService.run({
          ...current.runOptions,
          onPhase: (event) => {
            recoveredFence ??= event.fencingToken;
          },
        }),
      ).resolves.toMatchObject({ status: "succeeded" });
      expect(recoveredFence).toBe("2");
      expect(await atomicTempEntries(current.workspace)).toEqual([]);
    });
  },
);
