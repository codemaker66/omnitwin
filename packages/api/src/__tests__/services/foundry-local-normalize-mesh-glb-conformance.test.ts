import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FOUNDRY_INTAKE_ADMISSION_CAPABILITIES,
  FOUNDRY_INTAKE_ADMISSION_REVIEW_V0,
  FoundryIntakeAdmissionReviewPayloadSchema,
  finalizeFoundryIntakeAdmissionReview,
} from "@omnitwin/types";
import {
  FOUNDRY_DERIVATIVE_NORMALIZATION_ARTIFACT_INDEX_PATH,
  FOUNDRY_DERIVATIVE_NORMALIZATION_REPORT_PATH,
  FOUNDRY_DERIVATIVE_NORMALIZED_GLB_PATH,
  computeFoundryDerivativeNormalizationOutputBundleInvocationSha256,
  inspectUniversalIntake,
  stageUniversalIntakeDraft,
  verifyFoundryDerivativeNormalizationOutputBundle,
  verifyUniversalIntakeStage,
  type FoundryDerivativeNormalizationOutputBundleInvocationV0,
  type FoundryDerivativeNormalizationOutputBundleResult,
  type FoundryNormalizeMeshGlbInvocationV0,
  type FoundryNormalizeMeshGlbReportV0,
  type FoundryIntakeStagingIndexV0,
} from "@omnitwin/reconstruction-foundry";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FOUNDRY_CLAIMED_PROVIDER_COMMAND_V0,
  FoundryClaimedProviderCommandV0Schema,
  computeFoundryProviderCommandPayloadSha256,
  computeFoundryProviderRequestSha256,
  executeNextFoundryProviderCommand,
  type FoundryClaimedProviderCommandV0,
  type FoundryProviderCommandExecutorStore,
} from "../../services/foundry-provider-command-executor.js";
import {
  FOUNDRY_LOCAL_SANDBOX_ADAPTER_ID,
  FOUNDRY_LOCAL_SANDBOX_ADAPTER_VERSION,
  FOUNDRY_LOCAL_SANDBOX_ADAPTER_CONFIGURATION_V0,
  computeFoundryLocalSandboxAdapterConfigurationSha256,
  createFoundryLocalCpuCommandAdapter,
  type FoundryLocalSandboxBackend,
  type FoundryLocalSandboxExecutionRequestV0,
} from "../../services/foundry-local-command-adapter.js";
import {
  FOUNDRY_PROVIDER_REQUEST_AUTHORIZATION_V0,
  FoundryProviderRequestAuthorizationV0Schema,
  deriveFoundryProviderClientRequestId,
  deriveFoundryProviderIdempotencyKey,
} from "../../services/foundry-provider-request-authorization.js";

const TEST_FIXTURE_MODULE =
  "../../../../reconstruction-foundry/src/__tests__/derivative-normalization-fixture.js";
const FIXED_TIME = new Date("2026-07-14T10:00:30.000Z");
const EXECUTION_ID = "018f3e5a-6e3b-7d10-a4f1-aabbccddeeff";
const ATTEMPT_ID = "018f3e5a-6e3b-7d10-a4f1-bbccddeeff00";
const CLAIM_TOKEN = "018f3e5a-6e3b-7d10-a4f1-ccddeeff0011";
const FENCING_TOKEN = "1";
const PROVIDER_REF = "local-sandbox:normalize-conformance";
const EXECUTOR_ID = "local-conformance-executor";
const PROJECT_ID = "glb-conformance";
const JOB_ID = "normalize-job";
const SUBJECT_ID = "normalize-subject";
const ASSET_ID = "fixture-mesh";
const SOURCE_ROOT_ID = "fixture-root";
const RELATIVE_PATH = "fixture-mesh.glb";
const OUTPUT_PREFIX = `foundry/${PROJECT_ID}/${JOB_ID}`;
const RUNNER_PROFILE_ID = "test-only-normalize-runner";
const ADAPTER_ARTIFACT_SHA256 = sha(18);
const ADAPTER_CONFIGURATION_SHA256 =
  computeFoundryLocalSandboxAdapterConfigurationSha256({
    schemaVersion: FOUNDRY_LOCAL_SANDBOX_ADAPTER_CONFIGURATION_V0,
    runnerProfileId: RUNNER_PROFILE_ID,
    terminalEnforcement: { mode: "not_supported" },
  });
const PROVIDER_DEPLOYMENT_SHA256 = sha(19);
const PROVIDER_PROFILE_SHA256 = sha(22);
const COMMAND_IDS: Readonly<Record<"provider_submit" | "provider_poll", string>> = {
  provider_submit: "018f3e5a-6e3b-7d10-a4f1-ddeeff001122",
  provider_poll: "018f3e5a-6e3b-7d10-a4f1-eeff00112233",
};
const roots: string[] = [];

interface TestOnlyDerivativeNormalizationFixtureModule {
  readonly createDerivativeNormalizationGlbSourceFixture: () => Buffer;
  readonly createDerivativeNormalizationBundleInvocation: (
    source: Uint8Array,
    overrides?: DerivativeNormalizationFixtureOverrides,
  ) => FoundryDerivativeNormalizationOutputBundleInvocationV0;
  readonly writeDerivativeNormalizationConformanceBundle: (
    outputDirectory: string,
    source: Uint8Array,
    overrides?: DerivativeNormalizationFixtureOverrides,
  ) => Promise<{
    readonly source: Uint8Array;
    readonly normalizeInvocation: FoundryNormalizeMeshGlbInvocationV0;
    readonly normalizedGlb: Uint8Array;
    readonly normalizeReport: FoundryNormalizeMeshGlbReportV0;
    readonly bundleInvocation: FoundryDerivativeNormalizationOutputBundleInvocationV0;
    readonly outputDirectory: string;
    readonly result: FoundryDerivativeNormalizationOutputBundleResult;
  }>;
}

interface DerivativeNormalizationFixtureOverrides {
  readonly assetId?: string;
  readonly sourceRootId?: string;
  readonly relativePath?: string;
  readonly subjectId?: string;
  readonly projectId?: string;
  readonly jobId?: string;
  readonly ingestManifestSha256?: string;
  readonly intakeAdmissionResultSha256?: string;
  readonly intakeStagingIndexSha256?: string;
  readonly providerAdapterArtifactSha256?: string;
  readonly providerDeploymentSha256?: string;
  readonly executionId?: string;
  readonly attemptId?: string;
  readonly fencingToken?: string;
}

interface StagedGlbFixture {
  readonly root: string;
  readonly sourceDirectory: string;
  readonly stageDirectory: string;
  readonly stagedSourcePath: string;
  readonly sourceBytes: Buffer;
  readonly index: FoundryIntakeStagingIndexV0;
}

interface ConformanceContext extends StagedGlbFixture {
  readonly fixtureModule: TestOnlyDerivativeNormalizationFixtureModule;
  readonly bundleInvocation: FoundryDerivativeNormalizationOutputBundleInvocationV0;
  readonly fixtureOverrides: DerivativeNormalizationFixtureOverrides;
}

interface ClaimOverrides {
  readonly intakeStagingIndexSha256?: string;
  readonly workerProfileSha256?: string;
  readonly fencingToken?: string;
}

interface BackendState {
  outputDirectory: string | null;
  written: Awaited<
    ReturnType<
      TestOnlyDerivativeNormalizationFixtureModule["writeDerivativeNormalizationConformanceBundle"]
    >
  > | null;
  rejection: string | null;
  resourceMarkerSha256: string | null;
  writeCount: number;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function sha(value: number): string {
  return `sha256:${value.toString(16).padStart(64, "0")}`;
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function runtimeSha256(value: string): string {
  return value.startsWith("sha256:") ? value : `sha256:${value}`;
}

async function loadFixtureModule(): Promise<TestOnlyDerivativeNormalizationFixtureModule> {
  return vi.importActual<TestOnlyDerivativeNormalizationFixtureModule>(
    TEST_FIXTURE_MODULE,
  );
}

async function createStagedGlbFixture(
  fixtureModule: TestOnlyDerivativeNormalizationFixtureModule,
): Promise<StagedGlbFixture> {
  const root = await mkdtemp(join(tmpdir(), "foundry-local-glb-conformance-"));
  roots.push(root);
  const sourceDirectory = join(root, "source-drop");
  const stageDirectory = join(root, "verified-stage");
  await mkdir(sourceDirectory, { mode: 0o700 });
  const sourceBytes = fixtureModule.createDerivativeNormalizationGlbSourceFixture();
  const sourcePath = join(sourceDirectory, RELATIVE_PATH);
  await writeFile(sourcePath, sourceBytes);
  await utimes(sourcePath, FIXED_TIME, FIXED_TIME);
  const receipt = await inspectUniversalIntake(sourceDirectory);
  const inspected = receipt.files.find((file) => file.path === RELATIVE_PATH);
  if (inspected === undefined) throw new Error("GLB intake fixture was not inspected");
  const review = finalizeFoundryIntakeAdmissionReview(
    FoundryIntakeAdmissionReviewPayloadSchema.parse({
      schemaVersion: FOUNDRY_INTAKE_ADMISSION_REVIEW_V0,
      receiptSha256: receipt.receiptSha256,
      projectId: PROJECT_ID,
      reviewedAt: "2026-07-14T09:05:00.000Z",
      reviewedBy: "conformance-reviewer@example.test",
      sourceRoot: {
        id: SOURCE_ROOT_ID,
        kind: "local_directory",
        displayName: "Verified conformance GLB",
        locationRedacted: "FOUNDRY_CONFORMANCE_SOURCE/[redacted]",
        caseSensitivity: "insensitive",
        readOnly: true,
      },
      coordinateFrames: [],
      transforms: [],
      decisions: [
        {
          action: "admit",
          path: inspected.path,
          classification: {
            method: "accepted_detector_candidate",
            rationale: "The bounded GLB signature is accepted for this test-only proof.",
            evidenceReferences: ["intake-receipt:bounded-signature"],
          },
          asset: {
            id: ASSET_ID,
            sourceRootId: SOURCE_ROOT_ID,
            relativePath: inspected.path,
            inputType: "glb_gltf",
            mediaType: "model/gltf-binary",
            sizeBytes: inspected.sizeBytes,
            sha256: `sha256:${inspected.sha256}`,
            immutable: true,
            captureState: "official_export",
            accessState: "official_export",
            capturedAt: null,
            coordinateFrameId: null,
            calibrationAssetIds: [],
            parentAssetIds: [],
            rights: {
              basis: "customer_owned",
              commercialUse: "allowed",
              modelTrainingUse: "allowed",
              redistribution: "allowed",
              termsReviewedAt: "2026-07-14T09:00:00.000Z",
              termsReference: "https://rights.example/fixture-mesh",
              restrictions: [],
            },
            provenanceClass: "captured",
            evidenceKinds: [],
            inspection: {
              geometryValue: "high",
              appearanceValue: "high",
              calibrationValue: "none",
              scaleValue: "high",
              metadataKeys: [],
              decisiveNextTest: "Verify exact decoded GLB semantic equality.",
            },
            notes: [],
          },
        },
      ],
      provenanceEdges: [],
      generatedRegions: [],
      legalReviewState: "requires_review",
      sourceMutationPermitted: false,
      authority: "none",
      capabilities: FOUNDRY_INTAKE_ADMISSION_CAPABILITIES,
    }),
  );
  const staged = await stageUniversalIntakeDraft({
    sourcePath: sourceDirectory,
    outputDirectory: stageDirectory,
    receipt,
    review,
  });
  return {
    root,
    sourceDirectory,
    stageDirectory,
    stagedSourcePath: join(stageDirectory, "source", RELATIVE_PATH),
    sourceBytes,
    index: staged.index,
  };
}

async function createContext(): Promise<ConformanceContext> {
  const fixtureModule = await loadFixtureModule();
  const staged = await createStagedGlbFixture(fixtureModule);
  const fixtureOverrides: DerivativeNormalizationFixtureOverrides = {
    assetId: ASSET_ID,
    sourceRootId: SOURCE_ROOT_ID,
    relativePath: RELATIVE_PATH,
    subjectId: SUBJECT_ID,
    projectId: PROJECT_ID,
    jobId: JOB_ID,
    ingestManifestSha256: staged.index.manifestSha256,
    intakeAdmissionResultSha256: staged.index.resultSha256,
    intakeStagingIndexSha256: runtimeSha256(staged.index.stagingSha256),
    providerAdapterArtifactSha256: ADAPTER_ARTIFACT_SHA256,
    providerDeploymentSha256: PROVIDER_DEPLOYMENT_SHA256,
    executionId: EXECUTION_ID,
    attemptId: ATTEMPT_ID,
    fencingToken: FENCING_TOKEN,
  };
  const bundleInvocation =
    fixtureModule.createDerivativeNormalizationBundleInvocation(
    staged.sourceBytes,
    fixtureOverrides,
  );
  return {
    ...staged,
    fixtureModule,
    bundleInvocation,
    fixtureOverrides,
  };
}

function providerAuthorization(
  context: ConformanceContext,
  commandKind: "provider_submit" | "provider_poll",
  overrides: ClaimOverrides = {},
) {
  const invocation = context.bundleInvocation;
  const subject = invocation.baseExecutionSubject;
  const profile = invocation.expectedExecutor.workerProfile;
  const workerProfileSha256 =
    overrides.workerProfileSha256 ?? invocation.expectedExecutor.workerProfileSha256;
  const fencingToken = overrides.fencingToken ?? FENCING_TOKEN;
  const providerIdempotencyKey = deriveFoundryProviderIdempotencyKey(
    invocation.baseExecutionSubjectSha256,
    ATTEMPT_ID,
  );
  return FoundryProviderRequestAuthorizationV0Schema.parse({
    schemaVersion: FOUNDRY_PROVIDER_REQUEST_AUTHORIZATION_V0,
    authority: "none",
    commandKind,
    commandId: COMMAND_IDS[commandKind],
    commandSequence: commandKind === "provider_submit" ? 1 : 2,
    preparedAt: "2026-07-14T09:59:00.000Z",
    execution: {
      executionId: EXECUTION_ID,
      attemptId: ATTEMPT_ID,
      attemptOrdinal: 1,
      fencingToken,
      executionSubjectSha256: invocation.baseExecutionSubjectSha256,
      subjectId: SUBJECT_ID,
      projectId: PROJECT_ID,
      jobId: JOB_ID,
    },
    requestIdentity: {
      providerIdempotencyKey,
      clientRequestId: deriveFoundryProviderClientRequestId(
        commandKind,
        COMMAND_IDS[commandKind],
      ),
      resourceMarker: {
        executionSubjectSha256: invocation.baseExecutionSubjectSha256,
        providerIdempotencyKey,
      },
    },
    evidence: {
      jobSpecSha256: subject.jobSpecSha256,
      reviewedIngestManifestSha256: context.index.manifestSha256,
      intakeAdmissionResultSha256: context.index.resultSha256,
      intakeStagingIndexSha256:
        overrides.intakeStagingIndexSha256 ??
        runtimeSha256(context.index.stagingSha256),
      executionEnvelopeSha256: subject.executionEnvelopeSha256,
      executionPolicySha256: subject.executionPolicySha256,
      providerPlanSha256: subject.providerPlanSha256,
      providerDeploymentSha256: subject.providerDeploymentSha256,
      workerProfileSha256s: [workerProfileSha256],
      executionConfirmationSha256: subject.executionConfirmationSha256,
      computeApprovalSha256: null,
    },
    provider: {
      providerKind: "local_cpu",
      providerAdapterId: FOUNDRY_LOCAL_SANDBOX_ADAPTER_ID,
      providerAdapterVersion: FOUNDRY_LOCAL_SANDBOX_ADAPTER_VERSION,
      providerAdapterArtifactSha256: ADAPTER_ARTIFACT_SHA256,
      providerAdapterConfigurationSha256: ADAPTER_CONFIGURATION_SHA256,
      providerDeploymentId: "local-conformance-deployment",
      providerDeploymentSha256: PROVIDER_DEPLOYMENT_SHA256,
      accountProjectAlias: "omnitwin-local-test",
      region: "local",
      dataResidency: "local",
      providerRequestProfileId: "local-conformance-profile",
      providerRequestProfileVersion: "1.0.0",
      providerRequestProfileSha256: PROVIDER_PROFILE_SHA256,
      target: {
        targetKind: "local_worker",
        runnerProfileId: RUNNER_PROFILE_ID,
      },
    },
    rights: {
      rightsApprovalSha256: subject.rightsApprovalSha256,
      rightsPolicyEvidenceSha256: subject.rightsPolicyEvidenceSha256,
      rightsPolicyDefinitionSha256: subject.rightsPolicyDefinitionSha256,
      policyVersion: "rights-v1",
      policyGeneration: 1,
      decision: "allowed",
      stagePurposes: [
        { stageId: "normalize-mesh", purposes: ["commercial_internal_use"] },
      ],
    },
    storage: {
      sourceMountMode: "read_only",
      objectStorageProfile: null,
      outputPrefix: OUTPUT_PREFIX,
    },
    runtime: {
      maximumApiCallSeconds: 30,
      maximumWallClockSeconds: 300,
      workerSelfDeadlineSeconds: 240,
      providerMaximumExecutionTtlSeconds: 300,
      dispatchDeadline: "2026-07-14T11:00:00.000Z",
      observationIntervalSeconds: 1,
      checkpointIntervalSeconds: 60,
      cancelGracePeriodSeconds: 5,
      terminationGracePeriodSeconds: 5,
      terminationConfirmationTimeoutSeconds: 10,
      budgetPolicy: subject.budgetPolicy,
      checkpointContract: null,
    },
    stages: [
      {
        stageId: "normalize-mesh",
        stageKind: "geometry",
        dependsOn: [],
        workerProfileId: profile.profileId,
        workerProfileVersion: profile.profileVersion,
        workerProfileSha256,
        operationClass: profile.operationClass,
        containerImage: profile.containerImage,
        command: [...profile.command],
        networkAccess: profile.networkAccess,
        inputAssetIds: [ASSET_ID],
        outputNames: ["normalized-mesh"],
        rightsPurposes: ["commercial_internal_use"],
        checkpoint: "none",
        resumable: false,
        capacityClass: "local-cpu",
        requestedResources: {
          cpuCores: 2,
          ramGiB: 4,
          gpuCount: 0,
          minimumGpuVramGiB: 0,
          scratchGiB: 8,
        },
        authorizedCapacity: {
          cpuCores: 4,
          ramGiB: 8,
          gpuCount: 0,
          perGpuVramGiB: 0,
          scratchGiB: 16,
        },
        estimatedCostMicroUsd: "0",
        maximumRuntimeSeconds: 240,
      },
    ],
    action: commandKind === "provider_submit"
      ? { kind: "provider_submit", providerCommandRef: null }
      : { kind: "provider_poll", providerCommandRef: PROVIDER_REF },
  });
}

function providerClaim(
  context: ConformanceContext,
  commandKind: "provider_submit" | "provider_poll",
  overrides: ClaimOverrides = {},
): FoundryClaimedProviderCommandV0 {
  const authorization = providerAuthorization(context, commandKind, overrides);
  const providerRequestSha256 = computeFoundryProviderRequestSha256(authorization);
  const providerIdempotencyKey = deriveFoundryProviderIdempotencyKey(
    context.bundleInvocation.baseExecutionSubjectSha256,
    ATTEMPT_ID,
  );
  const payload = {
    commandKind,
    executionSubjectSha256:
      context.bundleInvocation.baseExecutionSubjectSha256,
    providerRequest: authorization,
    providerRequestSha256,
    providerIdempotencyKey,
    stageIds: ["normalize-mesh"],
    maximumApiCallSeconds: 30,
    providerCommandRef: commandKind === "provider_poll" ? PROVIDER_REF : null,
    submitLineage: null,
    stopIntentId: null,
  };
  return FoundryClaimedProviderCommandV0Schema.parse({
    schemaVersion: FOUNDRY_CLAIMED_PROVIDER_COMMAND_V0,
    commandKind,
    commandId: COMMAND_IDS[commandKind],
    executionId: EXECUTION_ID,
    attemptId: ATTEMPT_ID,
    projectId: PROJECT_ID,
    jobId: JOB_ID,
    executionEnvelopeSha256:
      context.bundleInvocation.baseExecutionSubject.executionEnvelopeSha256,
    providerKind: "local_cpu",
    providerAdapterId: FOUNDRY_LOCAL_SANDBOX_ADAPTER_ID,
    providerAdapterVersion: FOUNDRY_LOCAL_SANDBOX_ADAPTER_VERSION,
    providerAdapterArtifactSha256: ADAPTER_ARTIFACT_SHA256,
    providerAdapterConfigurationSha256: ADAPTER_CONFIGURATION_SHA256,
    providerDeploymentSha256: PROVIDER_DEPLOYMENT_SHA256,
    providerRequestProfileId: "local-conformance-profile",
    providerRequestProfileVersion: "1.0.0",
    providerRequestProfileSha256: PROVIDER_PROFILE_SHA256,
    attemptOrdinal: 1,
    fencingToken: overrides.fencingToken ?? FENCING_TOKEN,
    commandSequence: commandKind === "provider_submit" ? 1 : 2,
    claimedBy: EXECUTOR_ID,
    claimToken: CLAIM_TOKEN,
    claimedAt: "2026-07-14T10:00:00.000Z",
    claimExpiresAt: "2026-07-14T10:01:00.000Z",
    payload,
    payloadSha256: computeFoundryProviderCommandPayloadSha256(payload),
  });
}

function assertRequestBindings(
  request: Readonly<FoundryLocalSandboxExecutionRequestV0>,
  context: ConformanceContext,
  stagedBytes: Uint8Array,
): void {
  const invocation = context.bundleInvocation;
  const runtime = invocation.claimedRuntimeContext;
  const authorization = request.authorization;
  const stage = authorization.stages[0];
  const snapshot = invocation.candidate.registryAttestation
    .derivativeRightsApproval.assetSnapshots[0];
  const stagedLedger = context.index.files.find(
    (file) => file.path === `source/${RELATIVE_PATH}`,
  );
  if (stage === undefined || snapshot === undefined || stagedLedger === undefined) {
    throw new Error("conformance fixture is missing its single stage or asset");
  }
  const expectedSourceSha256 = sha256(stagedBytes);
  const exactBindings = [
    [authorization.authority, "none"],
    [authorization.execution.executionId, runtime.executionId],
    [authorization.execution.attemptId, runtime.attemptId],
    [authorization.execution.attemptOrdinal, runtime.attemptOrdinal],
    [authorization.execution.fencingToken, runtime.fencingToken],
    [request.command.fencingToken, runtime.fencingToken],
    [authorization.execution.projectId, invocation.candidate.projectId],
    [authorization.execution.jobId, runtime.jobId],
    [authorization.execution.executionSubjectSha256, invocation.baseExecutionSubjectSha256],
    [
      request.sandbox.stagedInputs.intakeStagingIndexSha256,
      runtimeSha256(context.index.stagingSha256),
    ],
    [request.sandbox.stagedInputs.reviewedIngestManifestSha256, context.index.manifestSha256],
    [stage.stageId, runtime.stageId],
    [stage.workerProfileSha256, invocation.expectedExecutor.workerProfileSha256],
    [stage.containerImage, invocation.expectedExecutor.workerProfile.containerImage],
    [JSON.stringify(stage.command), JSON.stringify(invocation.expectedExecutor.sealedCommand)],
    [stage.networkAccess, "none"],
    [stage.inputAssetIds.join(","), ASSET_ID],
    [request.sandbox.stagedInputs.assetIds.join(","), ASSET_ID],
    [request.sandbox.runnerProfileId, RUNNER_PROFILE_ID],
    [request.sandbox.imagePolicy, "pinned_digest_only"],
    [request.sandbox.stagedInputs.mountMode, "read_only"],
    [authorization.storage.sourceMountMode, "read_only"],
    [request.sandbox.output.writeMode, "isolated_exact_attempt_prefix"],
    [
      request.sandbox.output.isolatedPrefix,
      `${OUTPUT_PREFIX}/.foundry-sandbox/${request.durableResourceMarker.markerSha256.slice("sha256:".length)}`,
    ],
    [snapshot.id, ASSET_ID],
    [snapshot.relativePath, RELATIVE_PATH],
    [snapshot.sizeBytes, stagedBytes.byteLength],
    [snapshot.sha256, expectedSourceSha256],
    [context.index.manifestSha256, invocation.baseExecutionSubject.ingestManifestSha256],
    [context.index.resultSha256, invocation.baseExecutionSubject.intakeAdmissionResultSha256],
    [
      runtimeSha256(context.index.stagingSha256),
      invocation.baseExecutionSubject.intakeStagingIndexSha256,
    ],
    [stagedLedger.sizeBytes, stagedBytes.byteLength],
    [`sha256:${stagedLedger.sha256}`, expectedSourceSha256],
    [request.sandbox.output.authorizedPrefix, OUTPUT_PREFIX],
  ] as const;
  const mismatch = exactBindings.find(([actual, expected]) => actual !== expected);
  if (mismatch !== undefined) {
    throw new Error(
      `test-only conformance binding mismatch: ${String(mismatch[0])} != ${String(mismatch[1])}`,
    );
  }
}

function createBackend(context: ConformanceContext) {
  const state: BackendState = {
    outputDirectory: null,
    written: null,
    rejection: null,
    resourceMarkerSha256: null,
    writeCount: 0,
  };
  const runBoundRequest = async (
    request: Readonly<FoundryLocalSandboxExecutionRequestV0>,
  ) => {
    const stagedBytes = await readFile(context.stagedSourcePath);
    try {
      assertRequestBindings(request, context, stagedBytes);
    } catch (error: unknown) {
      state.rejection = error instanceof Error ? error.message : String(error);
      return {
        kind: "rejected" as const,
        providerKind: request.providerKind,
        durableResourceMarker: request.durableResourceMarker,
        reasonCode: "conformance_binding_mismatch",
      };
    }
    if (state.written !== null) {
      if (
        state.resourceMarkerSha256 !==
        request.durableResourceMarker.markerSha256
      ) {
        state.rejection = "test-only conformance replay changed resource marker";
        return {
          kind: "rejected" as const,
          providerKind: request.providerKind,
          durableResourceMarker: request.durableResourceMarker,
          reasonCode: "conformance_replay_marker_mismatch",
        };
      }
      return {
        kind: "observed" as const,
        providerKind: request.providerKind,
        durableResourceMarker: request.durableResourceMarker,
        providerCommandRef: PROVIDER_REF,
        lifecycle: "queued" as const,
      };
    }
    const quarantineRoot = join(context.root, "quarantine");
    await mkdir(quarantineRoot, { recursive: true, mode: 0o700 });
    const outputDirectory = join(
      quarantineRoot,
      request.durableResourceMarker.markerSha256.slice("sha256:".length),
    );
    state.outputDirectory = outputDirectory;
    state.written =
      await context.fixtureModule.writeDerivativeNormalizationConformanceBundle(
        outputDirectory,
        stagedBytes,
        context.fixtureOverrides,
      );
    state.resourceMarkerSha256 =
      request.durableResourceMarker.markerSha256;
    state.writeCount += 1;
    return {
      kind: "observed" as const,
      providerKind: request.providerKind,
      durableResourceMarker: request.durableResourceMarker,
      providerCommandRef: PROVIDER_REF,
      lifecycle: "queued" as const,
    };
  };
  const backend: FoundryLocalSandboxBackend = {
    submitExact: vi.fn((request, signal) => {
      if (signal.aborted === true) {
        return Promise.reject(new Error("local conformance submit aborted"));
      }
      return runBoundRequest(request);
    }),
    reconcileExact: vi.fn(() =>
      Promise.reject(
        new Error("reconciliation is outside this conformance proof"),
      )),
    pollExact: vi.fn(async (request, signal) => {
      if (signal.aborted === true) {
        throw new Error("local conformance poll aborted");
      }
      if (state.written === null) {
        return {
          kind: "rejected" as const,
          providerKind: request.providerKind,
          durableResourceMarker: request.durableResourceMarker,
          reasonCode: "conformance_output_absent",
        };
      }
      const stagedBytes = await readFile(context.stagedSourcePath);
      try {
        assertRequestBindings(request, context, stagedBytes);
        await verifyFoundryDerivativeNormalizationOutputBundle({
          outputDirectory: state.written.outputDirectory,
          sourceBytes: stagedBytes,
          expectedBundleInvocationSha256:
            computeFoundryDerivativeNormalizationOutputBundleInvocationSha256(
              context.bundleInvocation,
            ),
          expectedCandidateSha256: context.bundleInvocation.candidateSha256,
          expectedCandidateReservationReceiptSha256:
            context.bundleInvocation.candidateReservationReceiptSha256,
          expectedBaseExecutionSubjectSha256:
            context.bundleInvocation.baseExecutionSubjectSha256,
        });
      } catch (error: unknown) {
        state.rejection = error instanceof Error ? error.message : String(error);
        return {
          kind: "rejected" as const,
          providerKind: request.providerKind,
          durableResourceMarker: request.durableResourceMarker,
          reasonCode: "conformance_verification_failed",
        };
      }
      return {
        kind: "observed" as const,
        providerKind: request.providerKind,
        durableResourceMarker: request.durableResourceMarker,
        providerCommandRef: PROVIDER_REF,
        lifecycle: "exited" as const,
      };
    }),
    checkpointExact: vi.fn(() =>
      Promise.reject(new Error("checkpoint is outside this conformance proof")),
    ),
    stopExact: vi.fn(() =>
      Promise.reject(new Error("stop is outside this conformance proof")),
    ),
  };
  return { backend, state };
}

function createStore(commands: readonly FoundryClaimedProviderCommandV0[]) {
  const queue = [...commands];
  let observationOrdinal = 0;
  const store: FoundryProviderCommandExecutorStore = {
    claimNextCommand: () => Promise.resolve(queue.shift() ?? null),
    authorizeAndRecordInvocationStart: () =>
      Promise.resolve({ authorized: true as const }),
    completeBeforeInvocation: () => Promise.resolve(),
    completeAfterInvocation: () =>
      Promise.resolve({ status: "completed" as const }),
    retainProviderResultObservation: () => {
      observationOrdinal += 1;
      return Promise.resolve({
        status: "observed" as const,
        observationId: `018f3e5a-6e3b-7d10-a4f1-${observationOrdinal.toString(16).padStart(12, "0")}`,
        invocationEventId: "018f3e5a-6e3b-7d10-a4f1-112233445566",
        workerObservedAt: "2026-07-14T10:00:30.000Z",
        recordedAt: "2026-07-14T10:00:31.000Z",
        classification: { status: "held" as const },
      });
    },
  };
  return store;
}

function createAdapter(backend: FoundryLocalSandboxBackend) {
  return createFoundryLocalCpuCommandAdapter({
    providerAdapterArtifactSha256: ADAPTER_ARTIFACT_SHA256,
    providerDeploymentSha256: PROVIDER_DEPLOYMENT_SHA256,
    binding: {
      providerAdapterConfigurationSha256: ADAPTER_CONFIGURATION_SHA256,
      providerRequestProfileId: "local-conformance-profile",
      providerRequestProfileVersion: "1.0.0",
      providerRequestProfileSha256: PROVIDER_PROFILE_SHA256,
      runnerProfileId: RUNNER_PROFILE_ID,
      terminalEnforcement: { mode: "not_supported" },
    },
    backend,
    now: () => FIXED_TIME,
  });
}

describe.sequential("test-only local GLB vertical conformance", () => {
  it("carries one verified staged GLB through executor submit/poll to a verified authority-none bundle", async () => {
    const context = await createContext();
    const { backend, state } = createBackend(context);
    const store = createStore([
      providerClaim(context, "provider_submit"),
      providerClaim(context, "provider_poll"),
    ]);
    const adapter = createAdapter(backend);

    const submit = await executeNextFoundryProviderCommand(
      store,
      [adapter],
      EXECUTOR_ID,
    );
    const poll = await executeNextFoundryProviderCommand(
      store,
      [adapter],
      EXECUTOR_ID,
    );
    const idle = await executeNextFoundryProviderCommand(
      store,
      [adapter],
      EXECUTOR_ID,
    );

    expect(submit).toMatchObject({
      status: "completed",
      outcome: {
        status: "succeeded",
        outcomeCode: "local_submit_accepted",
        providerLifecycle: "queued",
      },
    });
    expect(poll).toMatchObject({
      status: "completed",
      outcome: {
        status: "succeeded",
        outcomeCode: "local_poll_exited",
        providerLifecycle: "exited",
      },
    });
    expect(idle).toEqual({ status: "idle" });
    expect(state.rejection).toBeNull();
    expect(state.writeCount).toBe(1);
    expect(state.written).not.toBeNull();
    expect(state.outputDirectory).not.toBeNull();
    const written = state.written!;
    expect((await readdir(written.outputDirectory)).sort()).toEqual([
      FOUNDRY_DERIVATIVE_NORMALIZATION_ARTIFACT_INDEX_PATH,
      FOUNDRY_DERIVATIVE_NORMALIZATION_REPORT_PATH,
      FOUNDRY_DERIVATIVE_NORMALIZED_GLB_PATH,
    ]);
    expect(await readFile(context.stagedSourcePath)).toEqual(context.sourceBytes);
    expect(await verifyUniversalIntakeStage(context.stageDirectory)).toEqual(
      context.index,
    );
    await expect(
      verifyFoundryDerivativeNormalizationOutputBundle({
        outputDirectory: written.outputDirectory,
        sourceBytes: context.sourceBytes,
        expectedBundleInvocationSha256:
          computeFoundryDerivativeNormalizationOutputBundleInvocationSha256(
            context.bundleInvocation,
          ),
        expectedCandidateSha256: context.bundleInvocation.candidateSha256,
        expectedCandidateReservationReceiptSha256:
          context.bundleInvocation.candidateReservationReceiptSha256,
        expectedBaseExecutionSubjectSha256:
          context.bundleInvocation.baseExecutionSubjectSha256,
      }),
    ).resolves.toEqual(written.result);
    expect(context.index.capabilities.execution).toBe("not_authorized");
    expect(written.result.report.authority).toBe("none");
    expect(written.result.report.activation).toEqual({
      state: "absent_not_recorded",
      activationId: null,
      activationSha256: null,
      activationReceiptSha256: null,
      executionActivationRecorded: false,
      executionAuthority: "none",
    });
    expect(
      Object.values(written.result.report.capabilities).every(
        (capability) => !capability,
      ),
    ).toBe(true);
    expect(
      Object.values(written.result.report.outputCommitAuthority).every(
        (capability) => !capability,
      ),
    ).toBe(true);
    expect(written.normalizeReport.policy).toMatchObject({
      measuredGeometryEligibility: "not_established",
      reconstructionQualityImprovement: "none",
      immutableRegistration: "not_authorized",
      signing: "not_authorized",
      publication: "not_authorized",
      promotion: "not_authorized",
    });
    const packageRoot = await import("@omnitwin/reconstruction-foundry");
    expect("__testOnlyNormalizeMeshGlbBytes" in packageRoot).toBe(false);
    expect(
      "__testOnlyWriteFoundryDerivativeNormalizationOutputBundle" in packageRoot,
    ).toBe(false);
  });

  it("replays the same durable marker without rerunning normalization or changing output", async () => {
    const context = await createContext();
    const { backend, state } = createBackend(context);
    const submit = providerClaim(context, "provider_submit");
    const store = createStore([submit, submit]);
    const adapter = createAdapter(backend);

    await expect(
      executeNextFoundryProviderCommand(store, [adapter], EXECUTOR_ID),
    ).resolves.toMatchObject({
      status: "completed",
      outcome: { status: "succeeded", outcomeCode: "local_submit_accepted" },
    });
    const outputDirectory = state.outputDirectory;
    if (outputDirectory === null) throw new Error("first submit did not retain output");
    const before = await Promise.all(
      [
        FOUNDRY_DERIVATIVE_NORMALIZED_GLB_PATH,
        FOUNDRY_DERIVATIVE_NORMALIZATION_REPORT_PATH,
        FOUNDRY_DERIVATIVE_NORMALIZATION_ARTIFACT_INDEX_PATH,
      ].map((path) => readFile(join(outputDirectory, path))),
    );

    await expect(
      executeNextFoundryProviderCommand(store, [adapter], EXECUTOR_ID),
    ).resolves.toMatchObject({
      status: "completed",
      outcome: { status: "succeeded", outcomeCode: "local_submit_accepted" },
    });
    const after = await Promise.all(
      [
        FOUNDRY_DERIVATIVE_NORMALIZED_GLB_PATH,
        FOUNDRY_DERIVATIVE_NORMALIZATION_REPORT_PATH,
        FOUNDRY_DERIVATIVE_NORMALIZATION_ARTIFACT_INDEX_PATH,
      ].map((path) => readFile(join(outputDirectory, path))),
    );

    expect(after).toEqual(before);
    expect(state.writeCount).toBe(1);
    expect(state.rejection).toBeNull();
    expect(vi.mocked(backend.submitExact)).toHaveBeenCalledTimes(2);
  });

  it("honors a pre-backend cancellation without invoking or retaining output", async () => {
    const context = await createContext();
    const { backend, state } = createBackend(context);
    const adapter = createAdapter(backend);
    const cancellation = new AbortController();
    cancellation.abort(new Error("test-only cancellation"));

    await expect(
      adapter.executeClaimedCommand(
        providerClaim(context, "provider_submit"),
        cancellation.signal,
      ),
    ).resolves.toMatchObject({
      status: "failed",
      outcomeCode: "local_call_aborted_before_backend",
      providerLifecycle: "not_observed",
    });
    expect(vi.mocked(backend.submitExact)).not.toHaveBeenCalled();
    expect(state.outputDirectory).toBeNull();
    expect(state.written).toBeNull();
    expect(state.writeCount).toBe(0);
  });

  it.each([
    {
      name: FOUNDRY_DERIVATIVE_NORMALIZED_GLB_PATH,
      path: FOUNDRY_DERIVATIVE_NORMALIZED_GLB_PATH,
      tamper: (bytes: Buffer) => {
        const changed = Buffer.from(bytes);
        changed[changed.length - 1] = (changed[changed.length - 1] ?? 0) ^ 1;
        return changed;
      },
    },
    {
      name: FOUNDRY_DERIVATIVE_NORMALIZATION_REPORT_PATH,
      path: FOUNDRY_DERIVATIVE_NORMALIZATION_REPORT_PATH,
      tamper: () => Buffer.from("{}\n", "utf8"),
    },
    {
      name: FOUNDRY_DERIVATIVE_NORMALIZATION_ARTIFACT_INDEX_PATH,
      path: FOUNDRY_DERIVATIVE_NORMALIZATION_ARTIFACT_INDEX_PATH,
      tamper: (bytes: Buffer) => Buffer.concat([bytes, Buffer.from(" ")]),
    },
  ] satisfies readonly {
    readonly name: string;
    readonly path: string;
    readonly tamper: (bytes: Buffer) => Buffer;
  }[])("rejects $name tampering during terminal poll verification", async ({ path, tamper }) => {
    const context = await createContext();
    const { backend, state } = createBackend(context);
    const store = createStore([
      providerClaim(context, "provider_submit"),
      providerClaim(context, "provider_poll"),
    ]);
    const adapter = createAdapter(backend);
    await expect(
      executeNextFoundryProviderCommand(store, [adapter], EXECUTOR_ID),
    ).resolves.toMatchObject({
      status: "completed",
      outcome: { status: "succeeded", outcomeCode: "local_submit_accepted" },
    });
    if (state.outputDirectory === null) {
      throw new Error("submit did not retain a quarantine output directory");
    }
    const artifactPath = join(state.outputDirectory, path);
    await writeFile(artifactPath, tamper(await readFile(artifactPath)));

    await expect(
      executeNextFoundryProviderCommand(store, [adapter], EXECUTOR_ID),
    ).resolves.toMatchObject({
      status: "completed",
      outcome: { status: "failed", outcomeCode: "local_poll_rejected" },
    });
    expect(state.rejection).not.toBeNull();
    expect(state.writeCount).toBe(1);
  });

  it.each([
    {
      name: "a different staging-index digest",
      claim: { intakeStagingIndexSha256: sha(99) },
      tamperStage: false,
    },
    {
      name: "a different worker profile digest",
      claim: { workerProfileSha256: sha(98) },
      tamperStage: false,
    },
    {
      name: "a different fencing token",
      claim: { fencingToken: "2" },
      tamperStage: false,
    },
    {
      name: "post-staging source-byte drift",
      claim: {},
      tamperStage: true,
    },
  ] satisfies readonly {
    readonly name: string;
    readonly claim: ClaimOverrides;
    readonly tamperStage: boolean;
  }[])("rejects $name before normalization output is retained", async ({ claim, tamperStage }) => {
    const context = await createContext();
    if (tamperStage) {
      const changed = Buffer.from(context.sourceBytes);
      changed[changed.length - 1] = (changed[changed.length - 1] ?? 0) ^ 1;
      await writeFile(context.stagedSourcePath, changed);
    }
    const { backend, state } = createBackend(context);
    const store = createStore([
      providerClaim(context, "provider_submit", claim),
    ]);
    const result = await executeNextFoundryProviderCommand(
      store,
      [createAdapter(backend)],
      EXECUTOR_ID,
    );
    expect(result).toMatchObject({
      status: "completed",
      outcome: {
        status: "failed",
        outcomeCode: "local_submit_rejected",
      },
    });
    expect(state.rejection).toMatch(/conformance binding mismatch/u);
    expect(state.outputDirectory).toBeNull();
    expect(state.written).toBeNull();
  });
});
