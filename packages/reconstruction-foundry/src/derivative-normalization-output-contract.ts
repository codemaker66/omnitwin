import { createHash } from "node:crypto";
import {
  FoundryDerivativeExecutionAuthorizationCandidateV1Schema,
  FoundryMicroUsdSchema,
  FoundryProviderAdapterVersionSchema,
  FoundryProviderKindSchema,
  FoundryTrustedWorkerProfileV0Schema,
  FoundryUtcInstantSchema,
  RuntimeManifestKeySchema,
  RuntimeSha256Schema,
  computeFoundryDerivativeExecutionAuthorizationCandidateSha256,
  computeFoundryTrustedWorkerProfileSha256,
} from "@omnitwin/types";
import { z } from "zod";
import {
  stableCanonicalJson,
  toCanonicalJson,
} from "./canonical-json.js";
import {
  FOUNDRY_EXECUTION_MAX_ATTEMPTS_V0,
  FOUNDRY_EXECUTION_SUBJECT_V0,
  assertFoundryExecutionSubjectV0,
  computeFoundryExecutionSubjectSha256,
  type FoundryExecutionSubjectV0,
} from "./execution-control.js";
import {
  FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES,
  FOUNDRY_NORMALIZE_MESH_GLB_OPERATION,
  FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_VERSION,
  FOUNDRY_NORMALIZE_MESH_GLB_SEALED_IDENTITY,
  FoundryNormalizeMeshGlbInvocationV0Schema,
  FoundryNormalizeMeshGlbReportV0Schema,
  computeFoundryNormalizeMeshGlbInvocationSha256,
} from "./normalize-mesh-glb-worker.js";

export const FOUNDRY_DERIVATIVE_NORMALIZATION_OUTPUT_BUNDLE_INVOCATION_V0 =
  "omnitwin.foundry.derivative-normalization-output-bundle-invocation.v0";
export const FOUNDRY_DERIVATIVE_NORMALIZATION_OUTPUT_REPORT_V0 =
  "omnitwin.foundry.derivative-normalization-output-report.v0";
export const FOUNDRY_DERIVATIVE_NORMALIZATION_ARTIFACT_INDEX_V0 =
  "omnitwin.foundry.derivative-normalization-artifact-index.v0";
export const FOUNDRY_DERIVATIVE_NORMALIZATION_QUARANTINE_PROFILE_V0 =
  "omnitwin.foundry.derivative-normalization-quarantine-profile.v0";
export const FOUNDRY_DERIVATIVE_NORMALIZATION_QUARANTINE_LOCATOR_V0 =
  "omnitwin.foundry.derivative-normalization-quarantine-locator.v0";
export const FOUNDRY_DERIVATIVE_NORMALIZATION_EXPECTED_EXECUTOR_V0 =
  "omnitwin.foundry.derivative-normalization-expected-executor.v0";

export const FOUNDRY_DERIVATIVE_NORMALIZED_GLB_PATH = "normalized.glb";
export const FOUNDRY_DERIVATIVE_NORMALIZATION_REPORT_PATH =
  "normalization-report.json";
export const FOUNDRY_DERIVATIVE_NORMALIZATION_ARTIFACT_INDEX_PATH =
  "artifact-index.json";

export const FOUNDRY_DERIVATIVE_NORMALIZATION_SEALED_COMMAND = [
  "omnitwin-sealed-worker",
  FOUNDRY_NORMALIZE_MESH_GLB_OPERATION,
  FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_VERSION,
] as const;

const INVOCATION_DOMAIN =
  FOUNDRY_DERIVATIVE_NORMALIZATION_OUTPUT_BUNDLE_INVOCATION_V0;
const REPORT_DOMAIN = FOUNDRY_DERIVATIVE_NORMALIZATION_OUTPUT_REPORT_V0;
const INDEX_DOMAIN = FOUNDRY_DERIVATIVE_NORMALIZATION_ARTIFACT_INDEX_V0;
const QUARANTINE_PROFILE_DOMAIN =
  FOUNDRY_DERIVATIVE_NORMALIZATION_QUARANTINE_PROFILE_V0;
const QUARANTINE_LOCATOR_DOMAIN =
  FOUNDRY_DERIVATIVE_NORMALIZATION_QUARANTINE_LOCATOR_V0;
const EXPECTED_EXECUTOR_DOMAIN =
  FOUNDRY_DERIVATIVE_NORMALIZATION_EXPECTED_EXECUTOR_V0;

const PositiveFenceSchema = z
  .string()
  .regex(/^[1-9][0-9]{0,18}$/u)
  .refine((value) => BigInt(value) <= 9_223_372_036_854_775_807n);
const DeviceOrInodeSchema = z
  .string()
  .regex(/^(?:0|[1-9][0-9]{0,30})$/u);
function hasNoControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return false;
  }
  return true;
}
function looksLikeAbsoluteLocalPath(value: string): boolean {
  return value.startsWith("/") ||
    /^[A-Za-z]:[\\/]/u.test(value) ||
    value.startsWith("\\\\");
}
const CanonicalLocalPathSchema = z
  .string()
  .min(1)
  .max(32_767)
  .refine(hasNoControlCharacters)
  .refine(looksLikeAbsoluteLocalPath);

function digest(domain: string, value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(domain, "utf8")
    .update("\n", "ascii")
    .update(stableCanonicalJson(toCanonicalJson(value)), "utf8")
    .digest("hex")}`;
}

function issue(
  ctx: z.RefinementCtx,
  path: readonly (string | number)[],
  message: string,
): void {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...path], message });
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

const FoundryExecutionBudgetPolicyBindingSchema = z
  .object({
    currency: z.literal("USD"),
    costWarningMicroUsd: FoundryMicroUsdSchema,
    costHardStopMicroUsd: FoundryMicroUsdSchema,
    terminationReserveMicroUsd: FoundryMicroUsdSchema,
    absoluteCostCapMicroUsd: FoundryMicroUsdSchema,
    costObservationMaximumAgeSeconds: z.number().int().positive().max(31_536_000),
  })
  .strict();

const FoundryCheckpointContractBindingSchema = z
  .object({
    format: RuntimeManifestKeySchema,
    formatVersion: RuntimeManifestKeySchema,
    stageId: RuntimeManifestKeySchema,
    workerImageSha256: RuntimeSha256Schema,
    recipeSha256: RuntimeSha256Schema,
    stageGraphSha256: RuntimeSha256Schema,
    ingestManifestSha256: RuntimeSha256Schema,
    checkpointCommandSha256: RuntimeSha256Schema,
    inputCompatibilitySha256: RuntimeSha256Schema,
  })
  .strict();

/**
 * Exact runtime parser for the frozen V0 subject. This deliberately mirrors
 * the durable provider boundary instead of accepting a digest-only claim.
 */
export const FoundryDerivativeNormalizationBaseExecutionSubjectV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_EXECUTION_SUBJECT_V0),
    subjectId: RuntimeManifestKeySchema,
    projectId: RuntimeManifestKeySchema,
    jobSpecSha256: RuntimeSha256Schema,
    executionEnvelopeSha256: RuntimeSha256Schema,
    ingestManifestSha256: RuntimeSha256Schema,
    intakeAdmissionResultSha256: RuntimeSha256Schema,
    intakeStagingIndexSha256: RuntimeSha256Schema,
    providerPlanSha256: RuntimeSha256Schema,
    executionPolicySha256: RuntimeSha256Schema,
    executionConfirmationSha256: RuntimeSha256Schema,
    rightsApprovalSha256: RuntimeSha256Schema,
    rightsPolicyEvidenceSha256: RuntimeSha256Schema,
    rightsPolicyDefinitionSha256: RuntimeSha256Schema,
    computeApprovalSha256: RuntimeSha256Schema.nullable(),
    providerKind: FoundryProviderKindSchema,
    providerAdapterId: RuntimeManifestKeySchema,
    providerAdapterVersion: FoundryProviderAdapterVersionSchema,
    providerAdapterArtifactSha256: RuntimeSha256Schema,
    providerDeploymentSha256: RuntimeSha256Schema,
    workerProfileSha256s: z.array(RuntimeSha256Schema).min(1).max(1_000),
    pricingSnapshotSha256: RuntimeSha256Schema,
    pricingSnapshotExpiresAt: FoundryUtcInstantSchema,
    createdAt: FoundryUtcInstantSchema,
    dispatchDeadline: FoundryUtcInstantSchema,
    maximumAttempts: z.literal(FOUNDRY_EXECUTION_MAX_ATTEMPTS_V0),
    budgetPolicy: FoundryExecutionBudgetPolicyBindingSchema,
    checkpointContract: FoundryCheckpointContractBindingSchema.nullable(),
  })
  .strict()
  .superRefine((subject, ctx) => {
    try {
      assertFoundryExecutionSubjectV0(subject as FoundryExecutionSubjectV0);
    } catch (error: unknown) {
      issue(
        ctx,
        [],
        `base execution subject failed the durable V0 invariant checker: ${
          error instanceof Error ? error.message : "unknown failure"
        }`,
      );
    }
  });

export type FoundryDerivativeNormalizationBaseExecutionSubjectV0 = z.infer<
  typeof FoundryDerivativeNormalizationBaseExecutionSubjectV0Schema
>;

export const FoundryDerivativeNormalizationQuarantineProfileV0Schema = z
  .object({
    schemaVersion: z.literal(
      FOUNDRY_DERIVATIVE_NORMALIZATION_QUARANTINE_PROFILE_V0,
    ),
    profileId: z.literal("authority-none-test-only-local-create-only"),
    storageKind: z.literal("local_filesystem"),
    writerAvailability: z.literal("test_only"),
    productionExecutionEnabled: z.literal(false),
    createOnly: z.literal(true),
    exactFileSetRequired: z.literal(true),
    singleLinkRegularFilesRequired: z.literal(true),
    handleIdentityReadbackRequired: z.literal(true),
    contentFsyncRequired: z.literal(true),
    directoryFsyncRequiredWhereSupported: z.literal(true),
    commitMarker: z.literal("artifact_index_content_fsynced_last"),
    releaseEligible: z.literal(false),
    publicationEligible: z.literal(false),
    redistributionEligible: z.literal(false),
    signingEligible: z.literal(false),
    runtimePromotionEligible: z.literal(false),
    authority: z.literal("none"),
  })
  .strict();

export type FoundryDerivativeNormalizationQuarantineProfileV0 = z.infer<
  typeof FoundryDerivativeNormalizationQuarantineProfileV0Schema
>;

export function createFoundryDerivativeNormalizationQuarantineProfileV0():
FoundryDerivativeNormalizationQuarantineProfileV0 {
  return FoundryDerivativeNormalizationQuarantineProfileV0Schema.parse({
    schemaVersion: FOUNDRY_DERIVATIVE_NORMALIZATION_QUARANTINE_PROFILE_V0,
    profileId: "authority-none-test-only-local-create-only",
    storageKind: "local_filesystem",
    writerAvailability: "test_only",
    productionExecutionEnabled: false,
    createOnly: true,
    exactFileSetRequired: true,
    singleLinkRegularFilesRequired: true,
    handleIdentityReadbackRequired: true,
    contentFsyncRequired: true,
    directoryFsyncRequiredWhereSupported: true,
    commitMarker: "artifact_index_content_fsynced_last",
    releaseEligible: false,
    publicationEligible: false,
    redistributionEligible: false,
    signingEligible: false,
    runtimePromotionEligible: false,
    authority: "none",
  });
}

export function computeFoundryDerivativeNormalizationQuarantineProfileSha256(
  input: unknown,
): string {
  return digest(
    QUARANTINE_PROFILE_DOMAIN,
    FoundryDerivativeNormalizationQuarantineProfileV0Schema.parse(input),
  );
}

const QuarantineLocatorPayloadSchema = z
  .object({
    schemaVersion: z.literal(
      FOUNDRY_DERIVATIVE_NORMALIZATION_QUARANTINE_LOCATOR_V0,
    ),
    profileId: z.literal("authority-none-test-only-local-create-only"),
    profileSha256: RuntimeSha256Schema,
    locatorKind: z.literal("canonical_local_directory_identity"),
    canonicalDirectoryPath: CanonicalLocalPathSchema,
    directoryDevice: DeviceOrInodeSchema,
    directoryInode: DeviceOrInodeSchema,
    identityBinding: z.literal("lstat_realpath_device_inode"),
    authority: z.literal("none"),
  })
  .strict();

export const FoundryDerivativeNormalizationQuarantineLocatorV0Schema =
  QuarantineLocatorPayloadSchema.extend({
    locatorSha256: RuntimeSha256Schema,
  })
    .strict()
    .superRefine((locator, ctx) => {
      const { locatorSha256: _locatorSha256, ...payload } = locator;
      const parsed = QuarantineLocatorPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        for (const entry of parsed.error.issues) ctx.addIssue(entry);
        return;
      }
      const expected = digest(QUARANTINE_LOCATOR_DOMAIN, parsed.data);
      if (locator.locatorSha256 !== expected) {
        issue(ctx, ["locatorSha256"], "quarantine locator digest mismatch");
      }
    });

export type FoundryDerivativeNormalizationQuarantineLocatorV0 = z.infer<
  typeof FoundryDerivativeNormalizationQuarantineLocatorV0Schema
>;

export function computeFoundryDerivativeNormalizationQuarantineLocatorSha256(
  input: unknown,
): string {
  return digest(
    QUARANTINE_LOCATOR_DOMAIN,
    QuarantineLocatorPayloadSchema.parse(input),
  );
}

const AbsentActivationSchema = z
  .object({
    state: z.literal("absent_not_recorded"),
    activationId: z.null(),
    activationSha256: z.null(),
    activationReceiptSha256: z.null(),
    executionActivationRecorded: z.literal(false),
    executionAuthority: z.literal("none"),
  })
  .strict();

const ClaimedRuntimeContextSchema = z
  .object({
    jobId: RuntimeManifestKeySchema,
    executionId: z.string().uuid(),
    attemptId: z.string().uuid(),
    attemptOrdinal: z.literal(1),
    stageId: RuntimeManifestKeySchema,
    fencingToken: PositiveFenceSchema,
    bindingAuthority: z.literal("caller_claim_only_not_activated"),
    executionAdmission: z.literal("not_established"),
    fenceOwnership: z.literal("not_established"),
  })
  .strict();

const ExpectedExecutorObjectSchema = z
  .object({
    schemaVersion: z.literal(
      FOUNDRY_DERIVATIVE_NORMALIZATION_EXPECTED_EXECUTOR_V0,
    ),
    sealedCommand: z.tuple([
      z.literal("omnitwin-sealed-worker"),
      z.literal(FOUNDRY_NORMALIZE_MESH_GLB_OPERATION),
      z.literal(FOUNDRY_NORMALIZE_MESH_GLB_OPERATION_VERSION),
    ]),
    sealedIdentity: z.tuple([
      z.literal(FOUNDRY_NORMALIZE_MESH_GLB_SEALED_IDENTITY[0]),
      z.literal(FOUNDRY_NORMALIZE_MESH_GLB_SEALED_IDENTITY[1]),
      z.literal(FOUNDRY_NORMALIZE_MESH_GLB_SEALED_IDENTITY[2]),
    ]),
    workerProfile: FoundryTrustedWorkerProfileV0Schema,
    workerProfileSha256: RuntimeSha256Schema,
    bindingAuthority: z.literal("candidate_expected_not_runtime_attested"),
    executorAuthentication: z.literal("not_established"),
  })
  .strict();

export const FoundryDerivativeNormalizationExpectedExecutorV0Schema =
  ExpectedExecutorObjectSchema.superRefine(
  (executor, ctx) => {
    const expectedWorkerProfileSha256 =
      computeFoundryTrustedWorkerProfileSha256(executor.workerProfile);
    if (executor.workerProfileSha256 !== expectedWorkerProfileSha256) {
      issue(
        ctx,
        ["workerProfileSha256"],
        "expected executor worker-profile digest must bind its exact embedded profile",
      );
    }
  },
);

const ExpectedExecutorSchema =
  FoundryDerivativeNormalizationExpectedExecutorV0Schema;

export type FoundryDerivativeNormalizationExpectedExecutorV0 = z.infer<
  typeof ExpectedExecutorSchema
>;

export function computeFoundryDerivativeNormalizationExpectedExecutorSha256(
  input: unknown,
): string {
  return digest(EXPECTED_EXECUTOR_DOMAIN, ExpectedExecutorSchema.parse(input));
}

const BundleInvocationPayloadSchema = z
  .object({
    schemaVersion: z.literal(
      FOUNDRY_DERIVATIVE_NORMALIZATION_OUTPUT_BUNDLE_INVOCATION_V0,
    ),
    purpose: z.literal("authority_none_pre_activation_output_custody"),
    candidate: FoundryDerivativeExecutionAuthorizationCandidateV1Schema,
    candidateSha256: RuntimeSha256Schema,
    candidateReservationReceiptSha256: RuntimeSha256Schema,
    baseExecutionSubject:
      FoundryDerivativeNormalizationBaseExecutionSubjectV0Schema,
    baseExecutionSubjectSha256: RuntimeSha256Schema,
    claimedRuntimeContext: ClaimedRuntimeContextSchema,
    expectedExecutor: ExpectedExecutorSchema,
    activation: AbsentActivationSchema,
    quarantineProfile:
      FoundryDerivativeNormalizationQuarantineProfileV0Schema,
    quarantineProfileSha256: RuntimeSha256Schema,
    authority: z.literal("none"),
    executionEligible: z.literal(false),
    dispatchEnabled: z.literal(false),
  })
  .strict()
  .superRefine((invocation, ctx) => {
    const candidate = invocation.candidate;
    const binding = candidate.bindingSet.bindings[0];
    const profile = invocation.expectedExecutor.workerProfile;
    const baseSubject = invocation.baseExecutionSubject;
    let baseSubjectSha256: string | undefined;
    try {
      baseSubjectSha256 = computeFoundryExecutionSubjectSha256(
        baseSubject as FoundryExecutionSubjectV0,
      );
    } catch {
      // The nested subject parser reports the durable-invariant failure.
    }
    const expectedCandidateSha256 =
      computeFoundryDerivativeExecutionAuthorizationCandidateSha256(
        (() => {
          const { candidateSha256: _candidateSha256, ...material } = candidate;
          return material;
        })(),
      );
    const expectedProfileSha256 =
      computeFoundryTrustedWorkerProfileSha256(profile);
    const expectedQuarantineProfileSha256 =
      computeFoundryDerivativeNormalizationQuarantineProfileSha256(
        invocation.quarantineProfile,
      );

    if (
      invocation.candidateSha256 !== candidate.candidateSha256 ||
      candidate.candidateSha256 !== expectedCandidateSha256
    ) {
      issue(ctx, ["candidateSha256"], "candidate digest binding mismatch");
    }
    if (
      invocation.candidateReservationReceiptSha256 !==
      candidate.candidateReservationReceiptSha256 ||
      candidate.candidateReservationReceiptSha256 !==
      candidate.candidateReservationReceipt.reservationReceiptSha256
    ) {
      issue(
        ctx,
        ["candidateReservationReceiptSha256"],
        "candidate reservation receipt binding mismatch",
      );
    }
    if (
      baseSubjectSha256 === undefined ||
      invocation.baseExecutionSubjectSha256 !== baseSubjectSha256 ||
      candidate.baseExecutionSubjectSha256 !== baseSubjectSha256
    ) {
      issue(
        ctx,
        ["baseExecutionSubjectSha256"],
        "base execution subject digest binding mismatch",
      );
    }
    if (
      binding === undefined ||
      candidate.projectId !== baseSubject.projectId ||
      candidate.jobSpecSha256 !== baseSubject.jobSpecSha256 ||
      candidate.executionEnvelopeSha256 !==
        baseSubject.executionEnvelopeSha256 ||
      candidate.ingestManifestSha256 !== baseSubject.ingestManifestSha256 ||
      candidate.jobId !== invocation.claimedRuntimeContext.jobId ||
      candidate.jobId !== binding.jobId ||
      invocation.claimedRuntimeContext.stageId !== binding.stageId
    ) {
      issue(
        ctx,
        ["claimedRuntimeContext"],
        "claimed runtime context must exactly bind the candidate and base subject",
      );
    }
    if (
      invocation.expectedExecutor.workerProfileSha256 !==
        expectedProfileSha256 ||
      binding?.workerProfileSha256 !== expectedProfileSha256 ||
      !sameStrings(baseSubject.workerProfileSha256s, [expectedProfileSha256]) ||
      profile.operationClass !== "deterministic_transformation" ||
      !sameStrings(
        profile.command,
        FOUNDRY_DERIVATIVE_NORMALIZATION_SEALED_COMMAND,
      ) ||
      profile.networkAccess !== "none" ||
      !profile.localExecutionAllowed
    ) {
      issue(
        ctx,
        ["expectedExecutor"],
        "expected executor must be the exact singleton candidate-bound local no-network profile",
      );
    }
    if (
      invocation.quarantineProfileSha256 !==
      expectedQuarantineProfileSha256
    ) {
      issue(
        ctx,
        ["quarantineProfileSha256"],
        "quarantine profile digest binding mismatch",
      );
    }
  });

export const FoundryDerivativeNormalizationOutputBundleInvocationV0Schema =
  BundleInvocationPayloadSchema;
export type FoundryDerivativeNormalizationOutputBundleInvocationV0 = z.infer<
  typeof FoundryDerivativeNormalizationOutputBundleInvocationV0Schema
>;

export function computeFoundryDerivativeNormalizationOutputBundleInvocationSha256(
  input: unknown,
): string {
  return digest(
    INVOCATION_DOMAIN,
    FoundryDerivativeNormalizationOutputBundleInvocationV0Schema.parse(input),
  );
}

const ByteIdentitySchema = z
  .object({
    mediaType: z.literal("model/gltf-binary"),
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES),
    sha256: RuntimeSha256Schema,
  })
  .strict();

const CapabilityDenialSchema = z
  .object({
    release: z.literal(false),
    publication: z.literal(false),
    redistribution: z.literal(false),
    signing: z.literal(false),
    runtimePromotion: z.literal(false),
    immutableRegistration: z.literal(false),
    measuredGeometryAuthority: z.literal(false),
  })
  .strict();

const OutputCommitNonAuthoritySchema = z
  .object({
    candidateCurrentAuthorityRevalidated: z.literal(false),
    policyGenerationRevalidated: z.literal(false),
    approvalExpiryRevalidated: z.literal(false),
    policyRevocationRevalidated: z.literal(false),
    attestationRevocationRevalidated: z.literal(false),
    executionActivationValidated: z.literal(false),
    executionAdmissionValidated: z.literal(false),
    fenceOwnershipValidated: z.literal(false),
    executorAuthenticated: z.literal(false),
    canonicalOutputCommitAuthorized: z.literal(false),
  })
  .strict();

const ReportPayloadObjectSchema = z
  .object({
    schemaVersion: z.literal(
      FOUNDRY_DERIVATIVE_NORMALIZATION_OUTPUT_REPORT_V0,
    ),
    bundleInvocation:
      FoundryDerivativeNormalizationOutputBundleInvocationV0Schema,
    bundleInvocationSha256: RuntimeSha256Schema,
    candidateSha256: RuntimeSha256Schema,
    candidateReservationReceiptSha256: RuntimeSha256Schema,
    baseExecutionSubjectSha256: RuntimeSha256Schema,
    bindingSetSha256: RuntimeSha256Schema,
    restrictionLineageSetSha256: RuntimeSha256Schema,
    outputPolicySha256: RuntimeSha256Schema,
    normalizeMeshGlbProof: z
      .object({
        invocation: FoundryNormalizeMeshGlbInvocationV0Schema,
        invocationSha256: RuntimeSha256Schema,
        report: FoundryNormalizeMeshGlbReportV0Schema,
        reportSha256: RuntimeSha256Schema,
      })
      .strict(),
    sourceBytes: ByteIdentitySchema.extend({
      assetId: RuntimeManifestKeySchema,
    }).strict(),
    outputBytes: ByteIdentitySchema.extend({
      path: z.literal(FOUNDRY_DERIVATIVE_NORMALIZED_GLB_PATH),
    }).strict(),
    quarantineLocator:
      FoundryDerivativeNormalizationQuarantineLocatorV0Schema,
    activation: AbsentActivationSchema,
    claimedRuntimeContext: ClaimedRuntimeContextSchema,
    expectedExecutor: ExpectedExecutorSchema,
    outputCommitAuthority: OutputCommitNonAuthoritySchema,
    commitPosture: z.literal("report_content_fsynced_after_glb_before_index"),
    capabilities: CapabilityDenialSchema,
    authority: z.literal("none"),
    executionEligible: z.literal(false),
  })
  .strict();

const ReportPayloadSchema = ReportPayloadObjectSchema.superRefine(
  (report, ctx) => {
    const invocation = report.bundleInvocation;
    const candidate = invocation.candidate;
    const proof = report.normalizeMeshGlbProof;
    const asset = candidate.registryAttestation.derivativeRightsApproval
      .assetSnapshots[0];
    const binding = candidate.bindingSet.bindings[0];
    if (asset === undefined || binding === undefined) {
      issue(
        ctx,
        ["bundleInvocation", "candidate"],
        "candidate must retain its exact singleton asset and binding",
      );
      return;
    }
    if (
      report.bundleInvocationSha256 !==
      computeFoundryDerivativeNormalizationOutputBundleInvocationSha256(
        invocation,
      ) ||
      report.candidateSha256 !== candidate.candidateSha256 ||
      report.candidateReservationReceiptSha256 !==
        candidate.candidateReservationReceiptSha256 ||
      report.baseExecutionSubjectSha256 !==
        invocation.baseExecutionSubjectSha256 ||
      report.bindingSetSha256 !== candidate.bindingSetSha256 ||
      report.restrictionLineageSetSha256 !==
        candidate.restrictionLineageSetSha256 ||
      report.outputPolicySha256 !== candidate.outputPolicySha256
    ) {
      issue(ctx, ["bundleInvocationSha256"], "report subject binding mismatch");
    }
    if (
      proof.invocationSha256 !==
        computeFoundryNormalizeMeshGlbInvocationSha256(proof.invocation) ||
      proof.reportSha256 !== proof.report.reportSha256 ||
      proof.report.invocationSha256 !== proof.invocationSha256
    ) {
      issue(
        ctx,
        ["normalizeMeshGlbProof"],
        "embedded normalize_mesh_glb proof digest binding mismatch",
      );
    }
    if (
      proof.invocation.source.assetId !== binding.assetId ||
      proof.invocation.source.assetId !== asset.id ||
      proof.invocation.source.sizeBytes !== asset.sizeBytes ||
      proof.invocation.source.sha256 !== asset.sha256 ||
      report.sourceBytes.assetId !== proof.invocation.source.assetId ||
      report.sourceBytes.sizeBytes !== proof.invocation.source.sizeBytes ||
      report.sourceBytes.sha256 !== proof.invocation.source.sha256
    ) {
      issue(
        ctx,
        ["sourceBytes"],
        "source bytes must exactly bind the singleton candidate asset and proof invocation",
      );
    }
    if (
      report.outputBytes.sizeBytes !== proof.report.output.sizeBytes ||
      report.outputBytes.sha256 !== proof.report.output.sha256
    ) {
      issue(
        ctx,
        ["outputBytes"],
        "output bytes must exactly bind the embedded proof report",
      );
    }
    if (
      stableCanonicalJson(toCanonicalJson(report.claimedRuntimeContext)) !==
        stableCanonicalJson(
          toCanonicalJson(invocation.claimedRuntimeContext),
        ) ||
      computeFoundryDerivativeNormalizationExpectedExecutorSha256(
        report.expectedExecutor,
      ) !==
        computeFoundryDerivativeNormalizationExpectedExecutorSha256(
          invocation.expectedExecutor,
        ) ||
      report.quarantineLocator.profileSha256 !==
        invocation.quarantineProfileSha256
    ) {
      issue(ctx, ["activation"], "report custody posture binding mismatch");
    }
  },
);

export const FoundryDerivativeNormalizationOutputReportV0Schema =
  ReportPayloadObjectSchema.extend({ reportSha256: RuntimeSha256Schema })
    .strict()
    .superRefine((report, ctx) => {
      const { reportSha256: _reportSha256, ...payload } = report;
      const parsed = ReportPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        for (const entry of parsed.error.issues) ctx.addIssue(entry);
        return;
      }
      if (report.reportSha256 !== digest(REPORT_DOMAIN, parsed.data)) {
        issue(ctx, ["reportSha256"], "normalization output report digest mismatch");
      }
    });

export type FoundryDerivativeNormalizationOutputReportV0 = z.infer<
  typeof FoundryDerivativeNormalizationOutputReportV0Schema
>;

export function computeFoundryDerivativeNormalizationOutputReportSha256(
  input: unknown,
): string {
  return digest(REPORT_DOMAIN, ReportPayloadSchema.parse(input));
}

const NormalizedArtifactSchema = z
  .object({
    path: z.literal(FOUNDRY_DERIVATIVE_NORMALIZED_GLB_PATH),
    role: z.literal("authority_none_normalized_glb"),
    mediaType: z.literal("model/gltf-binary"),
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(FOUNDRY_NORMALIZE_MESH_GLB_MAX_BYTES),
    sha256: RuntimeSha256Schema,
    subjectSha256: RuntimeSha256Schema,
  })
  .strict();

const ReportArtifactSchema = z
  .object({
    path: z.literal(FOUNDRY_DERIVATIVE_NORMALIZATION_REPORT_PATH),
    role: z.literal("authority_none_normalization_report"),
    mediaType: z.literal("application/json"),
    sizeBytes: z.number().int().positive().max(64 * 1024 * 1024),
    sha256: RuntimeSha256Schema,
    subjectSha256: RuntimeSha256Schema,
  })
  .strict();

const ArtifactIndexPayloadSchema = z
  .object({
    schemaVersion: z.literal(
      FOUNDRY_DERIVATIVE_NORMALIZATION_ARTIFACT_INDEX_V0,
    ),
    bundleInvocationSha256: RuntimeSha256Schema,
    reportSha256: RuntimeSha256Schema,
    candidateSha256: RuntimeSha256Schema,
    candidateReservationReceiptSha256: RuntimeSha256Schema,
    baseExecutionSubjectSha256: RuntimeSha256Schema,
    bindingSetSha256: RuntimeSha256Schema,
    restrictionLineageSetSha256: RuntimeSha256Schema,
    outputPolicySha256: RuntimeSha256Schema,
    claimedRuntimeContext: ClaimedRuntimeContextSchema,
    expectedExecutorSha256: RuntimeSha256Schema,
    quarantineProfileSha256: RuntimeSha256Schema,
    quarantineLocator:
      FoundryDerivativeNormalizationQuarantineLocatorV0Schema,
    artifacts: z.tuple([NormalizedArtifactSchema, ReportArtifactSchema]),
    commitMarker: z.literal("artifact_index_content_fsynced_last"),
    activation: AbsentActivationSchema,
    outputCommitAuthority: OutputCommitNonAuthoritySchema,
    capabilities: CapabilityDenialSchema,
    authority: z.literal("none"),
    executionEligible: z.literal(false),
  })
  .strict();

export const FoundryDerivativeNormalizationArtifactIndexV0Schema =
  ArtifactIndexPayloadSchema.extend({
    artifactIndexSha256: RuntimeSha256Schema,
  })
    .strict()
    .superRefine((index, ctx) => {
      const { artifactIndexSha256: _artifactIndexSha256, ...payload } = index;
      const parsed = ArtifactIndexPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        for (const entry of parsed.error.issues) ctx.addIssue(entry);
        return;
      }
      if (index.artifactIndexSha256 !== digest(INDEX_DOMAIN, parsed.data)) {
        issue(ctx, ["artifactIndexSha256"], "artifact index digest mismatch");
      }
    });

export type FoundryDerivativeNormalizationArtifactIndexV0 = z.infer<
  typeof FoundryDerivativeNormalizationArtifactIndexV0Schema
>;

export function computeFoundryDerivativeNormalizationArtifactIndexSha256(
  input: unknown,
): string {
  return digest(INDEX_DOMAIN, ArtifactIndexPayloadSchema.parse(input));
}

export type FoundryDerivativeNormalizationOutputReportPayloadV0 = z.infer<
  typeof ReportPayloadSchema
>;
export type FoundryDerivativeNormalizationArtifactIndexPayloadV0 = z.infer<
  typeof ArtifactIndexPayloadSchema
>;
