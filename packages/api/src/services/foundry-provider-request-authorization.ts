import { createHash, timingSafeEqual } from "node:crypto";
import {
  FOUNDRY_RIGHTS_POLICY_DEFINITION_V0,
  FoundryCommandArgumentSchema,
  FoundryExecutionEnvelopeComputeApprovalV0Schema,
  FoundryExecutionEnvelopeConfirmationV0Schema,
  FoundryExecutionEnvelopeV0Schema,
  FoundryExecutionPolicyV0Schema,
  FoundryIngestManifestV0Schema,
  FoundryJobSpecV0Schema,
  FoundryMicroUsdSchema,
  FoundryProviderAdapterVersionSchema,
  FoundryProviderDeploymentEvidenceV0Schema,
  FoundryProviderKindSchema,
  FoundryProviderPlanEvidenceV0Schema,
  FoundryRelativePathSchema,
  FoundryRightsApprovalSchema,
  FoundryRightsPolicyDefinitionV0Schema,
  FoundryTrustedWorkerProfileV0Schema,
  FoundryUtcInstantSchema,
  RuntimeManifestKeySchema,
  RuntimeSha256Schema,
  computeFoundryExecutionEnvelopeComputeApprovalSha256,
  computeFoundryExecutionEnvelopeConfirmationSha256,
  computeFoundryExecutionEnvelopeSha256,
  computeFoundryExecutionPolicySha256,
  computeFoundryIngestManifestSha256,
  computeFoundryJobSpecSha256,
  computeFoundryProviderDeploymentEvidenceSha256,
  computeFoundryProviderPlanEvidenceSha256,
  computeFoundryTrustedWorkerProfileSha256,
  validateFoundryExecutionAuthorizations,
  validateFoundryExecutionEnvelopeBindings,
  validateFoundryTrustedRightsApproval,
} from "@omnitwin/types";
import {
  FOUNDRY_EXECUTION_MAX_ATTEMPTS_V0,
  FOUNDRY_EXECUTION_SUBJECT_V0,
  computeFoundryExecutionSubjectSha256,
  stableCanonicalJson,
  toCanonicalJson,
  type FoundryExecutionSubjectV0,
} from "@omnitwin/reconstruction-foundry";
import { z } from "zod";

export const FOUNDRY_PROVIDER_REQUEST_PROFILE_V0 =
  "omnitwin.foundry.provider-request-profile.v0";
export const FOUNDRY_PROVIDER_REQUEST_AUTHORIZATION_V0 =
  "omnitwin.foundry.provider-request-authorization.v0";

const PROVIDER_REQUEST_PROFILE_DIGEST_DOMAIN =
  "omnitwin.foundry.provider-request-profile.v0";
const PROVIDER_REQUEST_AUTHORIZATION_DIGEST_DOMAIN =
  "omnitwin.foundry.provider-request-authorization.v0";
const RIGHTS_APPROVAL_DIGEST_DOMAIN =
  "omnitwin.foundry.rights-approval.v0";

const PositiveFenceSchema = z
  .string()
  .regex(/^[1-9][0-9]{0,18}$/u)
  .refine((value) => BigInt(value) <= 9_223_372_036_854_775_807n);

const PinnedContainerImageSchema = z
  .string()
  .max(512)
  .regex(/^[a-z0-9][a-z0-9._/:@-]*@sha256:[a-f0-9]{64}$/u);

function hasValidUnicodeScalarSequence(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

export const FoundryProviderCommandRefSchema = z
  .string()
  .min(1)
  .max(240)
  .refine(
    hasValidUnicodeScalarSequence,
    "provider command reference must contain valid Unicode scalars",
  )
  .refine(
    (value) =>
      value === value.trim() &&
      value === value.normalize("NFC") &&
      !Array.from(value).some((character) => {
        const codePoint = character.codePointAt(0);
        return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
      }),
    "provider command reference must be canonical printable text",
  );

export const FoundryProviderCommandKindV0Schema = z.enum([
  "provider_submit",
  "provider_reconcile",
  "provider_poll",
  "provider_checkpoint",
  "provider_stop",
]);
export type FoundryProviderCommandKindV0 = z.infer<
  typeof FoundryProviderCommandKindV0Schema
>;

function isStrictlySortedUnique(values: readonly string[]): boolean {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous === undefined || current === undefined || previous >= current) {
      return false;
    }
  }
  return true;
}

function isUnique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

const SortedManifestKeysSchema = z
  .array(RuntimeManifestKeySchema)
  .max(1_000)
  .refine(isStrictlySortedUnique, "values must be unique and ASCII sorted");

const SortedNonEmptyManifestKeysSchema = z
  .array(RuntimeManifestKeySchema)
  .min(1)
  .max(1_000)
  .refine(isStrictlySortedUnique, "values must be unique and ASCII sorted");

const SortedContainerImagesSchema = z
  .array(PinnedContainerImageSchema)
  .min(1)
  .max(1_000)
  .refine(isStrictlySortedUnique, "container images must be unique and sorted");

const SortedNetworkModesSchema = z
  .array(z.enum(["none", "object_storage_only", "restricted"]))
  .min(1)
  .max(3)
  .refine(isStrictlySortedUnique, "network modes must be unique and sorted");

const SortedProviderCommandKindsSchema = z
  .array(FoundryProviderCommandKindV0Schema)
  .min(4)
  .max(5)
  .refine(isStrictlySortedUnique, "provider command kinds must be unique and sorted")
  .refine(
    (values) =>
      [
        "provider_poll",
        "provider_reconcile",
        "provider_stop",
        "provider_submit",
      ].every((required) => values.includes(required as FoundryProviderCommandKindV0)),
    "provider request profiles must support submit, reconciliation, polling, and stop",
  );

const ProviderTargetSchema = z.discriminatedUnion("targetKind", [
  z
    .object({
      targetKind: z.literal("local_worker"),
      runnerProfileId: RuntimeManifestKeySchema,
    })
    .strict(),
  z
    .object({
      targetKind: z.literal("remote_worker_pool"),
      poolId: RuntimeManifestKeySchema,
    })
    .strict(),
]);

/**
 * Trusted, secret-free adapter lowering profile. It contains allowlists and a
 * target identity, never credentials, headers, environment secrets, URLs, or
 * an open provider request object.
 */
export const FoundryProviderRequestProfileV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_PROVIDER_REQUEST_PROFILE_V0),
    profileId: RuntimeManifestKeySchema,
    profileVersion: RuntimeManifestKeySchema,
    providerKind: FoundryProviderKindSchema,
    providerAdapterId: RuntimeManifestKeySchema,
    providerAdapterVersion: FoundryProviderAdapterVersionSchema,
    providerAdapterArtifactSha256: RuntimeSha256Schema,
    providerAdapterConfigurationSha256: RuntimeSha256Schema,
    providerDeploymentSha256: RuntimeSha256Schema,
    target: ProviderTargetSchema,
    allowedContainerImages: SortedContainerImagesSchema,
    allowedNetworkAccess: SortedNetworkModesSchema,
    allowedCapacityClasses: SortedNonEmptyManifestKeysSchema,
    allowedObjectStorageProfiles: SortedManifestKeysSchema,
    supportedCommandKinds: SortedProviderCommandKindsSchema,
    maximumApiCallSeconds: z.number().int().positive().max(300),
    reviewedAt: FoundryUtcInstantSchema,
    expiresAt: FoundryUtcInstantSchema,
  })
  .strict()
  .superRefine((profile, ctx) => {
    if (Date.parse(profile.reviewedAt) >= Date.parse(profile.expiresAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiresAt"],
        message: "provider request profile must expire after review",
      });
    }
    const local =
      profile.providerKind === "local_cpu" ||
      profile.providerKind === "local_cuda";
    if (local !== (profile.target.targetKind === "local_worker")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["target"],
        message: "local providers require a local target and remote providers require a remote pool",
      });
    }
  });
export type FoundryProviderRequestProfileV0 = z.infer<
  typeof FoundryProviderRequestProfileV0Schema
>;

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

/** Runtime parser for the admitted immutable subject used by the compiler. */
export const FoundryExecutionSubjectBindingV0Schema = z
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
    workerProfileSha256s: z
      .array(RuntimeSha256Schema)
      .min(1)
      .max(1_000)
      .refine(isStrictlySortedUnique, "worker profile digests must be unique and sorted"),
    pricingSnapshotSha256: RuntimeSha256Schema,
    pricingSnapshotExpiresAt: FoundryUtcInstantSchema,
    createdAt: FoundryUtcInstantSchema,
    dispatchDeadline: FoundryUtcInstantSchema,
    maximumAttempts: z.literal(FOUNDRY_EXECUTION_MAX_ATTEMPTS_V0),
    budgetPolicy: FoundryExecutionBudgetPolicyBindingSchema,
    checkpointContract: FoundryCheckpointContractBindingSchema.nullable(),
  })
  .strict();
export type FoundryExecutionSubjectBindingV0 = z.infer<
  typeof FoundryExecutionSubjectBindingV0Schema
>;

const SubmitLineageInputSchema = z
  .object({
    submitCommandId: z.string().uuid(),
    submitProviderRequestAuthorizationSha256: RuntimeSha256Schema,
  })
  .strict();

export const FoundryProviderRequestCommandInputV0Schema = z
  .object({
    commandKind: FoundryProviderCommandKindV0Schema,
    commandId: z.string().uuid(),
    commandSequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    executionId: z.string().uuid(),
    attemptId: z.string().uuid(),
    attemptOrdinal: z.literal(1),
    fencingToken: PositiveFenceSchema,
    stageIds: z
      .array(RuntimeManifestKeySchema)
      .min(1)
      .max(1_000)
      .refine(isStrictlySortedUnique, "command stage IDs must be unique and sorted"),
    providerIdempotencyKey: RuntimeManifestKeySchema,
    clientRequestId: RuntimeManifestKeySchema,
    providerCommandRef: FoundryProviderCommandRefSchema.nullable(),
    submitLineage: SubmitLineageInputSchema.nullable(),
    stopIntentId: z.string().uuid().nullable(),
  })
  .strict()
  .superRefine((command, ctx) => {
    if (
      (command.commandKind === "provider_stop") !==
      (command.stopIntentId !== null)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stopIntentId"],
        message: "a stop intent is required only for provider stop",
      });
    }
    if (command.commandKind === "provider_submit") {
      if (command.providerCommandRef !== null || command.submitLineage !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "provider submit forbids a provider reference and submit lineage",
        });
      }
      return;
    }
    if (command.commandKind === "provider_reconcile") {
      if (command.submitLineage === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["submitLineage"],
          message: "provider reconciliation requires immutable submit authorization lineage",
        });
      } else if (command.submitLineage.submitCommandId === command.commandId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["submitLineage", "submitCommandId"],
          message: "provider reconciliation cannot identify itself as the submit command",
        });
      }
      return;
    }
    if (command.providerCommandRef === null || command.submitLineage !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "poll, checkpoint, and stop require an exact provider reference and forbid submit lineage",
      });
    }
  });
export type FoundryProviderRequestCommandInputV0 = z.infer<
  typeof FoundryProviderRequestCommandInputV0Schema
>;

const DurationSecondsSchema = z.number().int().positive().max(31_536_000);
const PositiveCpuCoresSchema = z.number().int().positive().max(1_024);
const PositiveRamGiBSchema = z.number().int().positive().max(100_000);
const NonnegativeGpuCountSchema = z.number().int().nonnegative().max(128);
const NonnegativeGpuVramGiBSchema = z.number().int().nonnegative().max(1_000);
const PositiveScratchGiBSchema = z.number().int().positive().max(1_000_000);

export const FoundryProviderResourceRequestV0Schema = z
  .object({
    cpuCores: PositiveCpuCoresSchema,
    ramGiB: PositiveRamGiBSchema,
    gpuCount: NonnegativeGpuCountSchema,
    minimumGpuVramGiB: NonnegativeGpuVramGiBSchema,
    scratchGiB: PositiveScratchGiBSchema,
  })
  .strict()
  .superRefine((resources, ctx) => {
    if (resources.gpuCount === 0 && resources.minimumGpuVramGiB !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minimumGpuVramGiB"],
        message: "CPU requests cannot require GPU VRAM",
      });
    }
  });

export const FoundryProviderResourceLimitV0Schema = z
  .object({
    cpuCores: PositiveCpuCoresSchema,
    ramGiB: PositiveRamGiBSchema,
    gpuCount: NonnegativeGpuCountSchema,
    perGpuVramGiB: NonnegativeGpuVramGiBSchema,
    scratchGiB: PositiveScratchGiBSchema,
  })
  .strict()
  .superRefine((resources, ctx) => {
    if (resources.gpuCount === 0 && resources.perGpuVramGiB !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["perGpuVramGiB"],
        message: "CPU capacity cannot advertise GPU VRAM",
      });
    }
  });

export const FoundryProviderAuthorizedStageV0Schema = z
  .object({
    stageId: RuntimeManifestKeySchema,
    stageKind: z.enum([
      "inspect",
      "register",
      "align",
      "geometry",
      "appearance",
      "semantics",
      "enhance",
      "qa",
      "package",
    ]),
    dependsOn: z.array(RuntimeManifestKeySchema).max(100),
    workerProfileId: RuntimeManifestKeySchema,
    workerProfileVersion: RuntimeManifestKeySchema,
    workerProfileSha256: RuntimeSha256Schema,
    operationClass: z.enum([
      "read_only_inspection",
      "deterministic_transformation",
      "model_inference",
      "model_training",
      "redistribution_packaging",
      "public_release",
    ]),
    containerImage: PinnedContainerImageSchema,
    command: z.array(FoundryCommandArgumentSchema).min(1).max(1_000),
    networkAccess: z.enum(["none", "object_storage_only", "restricted"]),
    inputAssetIds: z.array(RuntimeManifestKeySchema).max(100_000),
    outputNames: z.array(RuntimeManifestKeySchema).min(1).max(1_000),
    rightsPurposes: z
      .array(
        z.enum([
          "commercial_internal_use",
          "model_training",
          "redistribution",
          "public_release",
        ]),
      )
      .min(1)
      .max(4),
    checkpoint: z.enum(["none", "stage_boundary", "periodic"]),
    resumable: z.boolean(),
    capacityClass: RuntimeManifestKeySchema,
    requestedResources: FoundryProviderResourceRequestV0Schema,
    authorizedCapacity: FoundryProviderResourceLimitV0Schema,
    estimatedCostMicroUsd: FoundryMicroUsdSchema,
    maximumRuntimeSeconds: DurationSecondsSchema,
  })
  .strict()
  .superRefine((stage, ctx) => {
    for (const field of [
      "dependsOn",
      "inputAssetIds",
      "outputNames",
      "rightsPurposes",
    ] as const) {
      if (!isUnique(stage[field])) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} must not contain duplicates`,
        });
      }
    }
    if (stage.resumable && stage.checkpoint === "none") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["resumable"],
        message: "a resumable stage must define a checkpoint contract",
      });
    }
  });

const ExecutionIdentitySchema = z
  .object({
    executionId: z.string().uuid(),
    attemptId: z.string().uuid(),
    attemptOrdinal: z.literal(1),
    fencingToken: PositiveFenceSchema,
    executionSubjectSha256: RuntimeSha256Schema,
    subjectId: RuntimeManifestKeySchema,
    projectId: RuntimeManifestKeySchema,
    jobId: RuntimeManifestKeySchema,
  })
  .strict();

const EvidenceLineageSchema = z
  .object({
    jobSpecSha256: RuntimeSha256Schema,
    reviewedIngestManifestSha256: RuntimeSha256Schema,
    intakeAdmissionResultSha256: RuntimeSha256Schema,
    intakeStagingIndexSha256: RuntimeSha256Schema,
    executionEnvelopeSha256: RuntimeSha256Schema,
    executionPolicySha256: RuntimeSha256Schema,
    providerPlanSha256: RuntimeSha256Schema,
    providerDeploymentSha256: RuntimeSha256Schema,
    workerProfileSha256s: z
      .array(RuntimeSha256Schema)
      .min(1)
      .max(1_000)
      .refine(isStrictlySortedUnique),
    executionConfirmationSha256: RuntimeSha256Schema,
    computeApprovalSha256: RuntimeSha256Schema.nullable(),
  })
  .strict();

const ProviderBindingSchema = z
  .object({
    providerKind: FoundryProviderKindSchema,
    providerAdapterId: RuntimeManifestKeySchema,
    providerAdapterVersion: FoundryProviderAdapterVersionSchema,
    providerAdapterArtifactSha256: RuntimeSha256Schema,
    providerAdapterConfigurationSha256: RuntimeSha256Schema,
    providerDeploymentId: RuntimeManifestKeySchema,
    providerDeploymentSha256: RuntimeSha256Schema,
    accountProjectAlias: RuntimeManifestKeySchema,
    region: RuntimeManifestKeySchema,
    dataResidency: RuntimeManifestKeySchema,
    providerRequestProfileId: RuntimeManifestKeySchema,
    providerRequestProfileVersion: RuntimeManifestKeySchema,
    providerRequestProfileSha256: RuntimeSha256Schema,
    target: ProviderTargetSchema,
  })
  .strict();

const RightsBindingSchema = z
  .object({
    rightsApprovalSha256: RuntimeSha256Schema,
    rightsPolicyEvidenceSha256: RuntimeSha256Schema,
    rightsPolicyDefinitionSha256: RuntimeSha256Schema,
    policyVersion: RuntimeManifestKeySchema,
    policyGeneration: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    decision: z.literal("allowed"),
    stagePurposes: z
      .array(
        z
          .object({
            stageId: RuntimeManifestKeySchema,
            purposes: z
              .array(
                z.enum([
                  "commercial_internal_use",
                  "model_training",
                  "redistribution",
                  "public_release",
                ]),
              )
              .min(1)
              .max(4),
          })
          .strict(),
      )
      .min(1)
      .max(1_000),
  })
  .strict();

const StorageBindingSchema = z
  .object({
    sourceMountMode: z.literal("read_only"),
    objectStorageProfile: RuntimeManifestKeySchema.nullable(),
    outputPrefix: FoundryRelativePathSchema,
  })
  .strict();

export const FoundryProviderRuntimeBindingV0Schema = z
  .object({
    maximumApiCallSeconds: z.number().int().positive().max(300),
    maximumWallClockSeconds: DurationSecondsSchema,
    workerSelfDeadlineSeconds: DurationSecondsSchema,
    providerMaximumExecutionTtlSeconds: DurationSecondsSchema,
    dispatchDeadline: FoundryUtcInstantSchema,
    observationIntervalSeconds: DurationSecondsSchema,
    checkpointIntervalSeconds: DurationSecondsSchema.nullable(),
    cancelGracePeriodSeconds: DurationSecondsSchema,
    terminationGracePeriodSeconds: DurationSecondsSchema,
    terminationConfirmationTimeoutSeconds: DurationSecondsSchema,
    budgetPolicy: FoundryExecutionBudgetPolicyBindingSchema,
    checkpointContract: FoundryCheckpointContractBindingSchema.nullable(),
  })
  .strict();

const RequestIdentitySchema = z
  .object({
    providerIdempotencyKey: RuntimeManifestKeySchema,
    clientRequestId: RuntimeManifestKeySchema,
    resourceMarker: z
      .object({
        executionSubjectSha256: RuntimeSha256Schema,
        providerIdempotencyKey: RuntimeManifestKeySchema,
      })
      .strict(),
  })
  .strict();

export const FoundryProviderActionV0Schema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("provider_submit"),
      providerCommandRef: z.null(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("provider_reconcile"),
      providerCommandRef: FoundryProviderCommandRefSchema.nullable(),
      submitCommandId: z.string().uuid(),
      submitProviderRequestAuthorizationSha256: RuntimeSha256Schema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("provider_poll"),
      providerCommandRef: FoundryProviderCommandRefSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("provider_checkpoint"),
      providerCommandRef: FoundryProviderCommandRefSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("provider_stop"),
      providerCommandRef: FoundryProviderCommandRefSchema,
      stopIntentId: z.string().uuid(),
    })
    .strict(),
]);

/** Closed canonical request authorized for one exact durable provider command. */
export const FoundryProviderRequestAuthorizationV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_PROVIDER_REQUEST_AUTHORIZATION_V0),
    authority: z.literal("none"),
    commandKind: FoundryProviderCommandKindV0Schema,
    commandId: z.string().uuid(),
    commandSequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    preparedAt: FoundryUtcInstantSchema,
    execution: ExecutionIdentitySchema,
    requestIdentity: RequestIdentitySchema,
    evidence: EvidenceLineageSchema,
    provider: ProviderBindingSchema,
    rights: RightsBindingSchema,
    storage: StorageBindingSchema,
    runtime: FoundryProviderRuntimeBindingV0Schema,
    stages: z
      .array(FoundryProviderAuthorizedStageV0Schema)
      .min(1)
      .max(1_000)
      .refine(
        (stages) => isStrictlySortedUnique(stages.map((stage) => stage.stageId)),
        "authorized stages must be unique and sorted",
      ),
    action: FoundryProviderActionV0Schema,
  })
  .strict()
  .superRefine((authorization, ctx) => {
    if (authorization.commandKind !== authorization.action.kind) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["action", "kind"],
        message: "action kind must match the durable command kind",
      });
    }
    if (
      authorization.requestIdentity.resourceMarker.executionSubjectSha256 !==
        authorization.execution.executionSubjectSha256 ||
      authorization.requestIdentity.resourceMarker.providerIdempotencyKey !==
        authorization.requestIdentity.providerIdempotencyKey
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["requestIdentity", "resourceMarker"],
        message: "provider resource marker must bind the exact subject and idempotency identity",
      });
    }
    if (
      authorization.stages.some(
        (stage) =>
          stage.maximumRuntimeSeconds > authorization.runtime.maximumWallClockSeconds,
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stages"],
        message: "stage runtime must not exceed the authorized wall-clock budget",
      });
    }

    const stageById = new Map(
      authorization.stages.map((stage) => [stage.stageId, stage] as const),
    );
    let invalidDependency = false;
    for (const stage of authorization.stages) {
      if (
        stage.dependsOn.includes(stage.stageId) ||
        stage.dependsOn.some((dependencyId) => !stageById.has(dependencyId))
      ) {
        invalidDependency = true;
        break;
      }
    }
    if (invalidDependency) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stages"],
        message: "stage dependencies must reference declared stages and must not self-reference",
      });
    } else {
      const visiting = new Set<string>();
      const visited = new Set<string>();
      const hasCycle = (stageId: string): boolean => {
        if (visiting.has(stageId)) return true;
        if (visited.has(stageId)) return false;
        visiting.add(stageId);
        const stage = stageById.get(stageId);
        const cyclic =
          stage?.dependsOn.some((dependencyId) => hasCycle(dependencyId)) ?? false;
        visiting.delete(stageId);
        visited.add(stageId);
        return cyclic;
      };
      const graphHasCycle = authorization.stages.some((stage) =>
        hasCycle(stage.stageId),
      );
      if (graphHasCycle) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["stages"],
          message: "stage dependency graph must be acyclic",
        });
      } else {
        const criticalPathByStage = new Map<string, number>();
        const criticalPath = (stageId: string): number => {
          const cached = criticalPathByStage.get(stageId);
          if (cached !== undefined) return cached;
          const stage = stageById.get(stageId);
          if (stage === undefined) return Number.POSITIVE_INFINITY;
          const dependencyMaximum = stage.dependsOn.reduce(
            (maximum, dependencyId) =>
              Math.max(maximum, criticalPath(dependencyId)),
            0,
          );
          const result = dependencyMaximum + stage.maximumRuntimeSeconds;
          criticalPathByStage.set(stageId, result);
          return result;
        };
        const maximumCriticalPath = authorization.stages.reduce(
          (maximum, stage) => Math.max(maximum, criticalPath(stage.stageId)),
          0,
        );
        if (maximumCriticalPath > authorization.runtime.maximumWallClockSeconds) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["stages"],
            message: "stage critical path must not exceed the authorized wall-clock budget",
          });
        }
      }
    }
  });
export type FoundryProviderRequestAuthorizationV0 = z.infer<
  typeof FoundryProviderRequestAuthorizationV0Schema
>;

export interface FoundryProviderRequestAuthorizationCompilerInput {
  readonly preparedAt: unknown;
  readonly command: unknown;
  readonly executionSubject: unknown;
  readonly executionSubjectSha256: unknown;
  readonly jobSpec: unknown;
  readonly ingestManifest: unknown;
  readonly intakeAdmissionResultSha256: unknown;
  readonly intakeStagingIndexSha256: unknown;
  readonly executionPolicy: unknown;
  readonly providerPlanEvidence: unknown;
  readonly trustedWorkerProfiles: readonly unknown[];
  readonly providerDeploymentEvidence: unknown;
  readonly executionEnvelope: unknown;
  readonly executionConfirmation: unknown;
  readonly computeApproval: unknown;
  readonly rightsApproval: unknown;
  readonly rightsApprovalSha256: unknown;
  readonly activeRightsPolicy: unknown;
  readonly rightsPolicyEvidenceSha256: unknown;
  readonly providerRequestProfile: unknown;
}

export interface CompiledFoundryProviderRequestAuthorizationV0 {
  readonly authorization: FoundryProviderRequestAuthorizationV0;
  readonly authorizationSha256: string;
}

export class FoundryProviderRequestAuthorizationError extends Error {
  constructor(
    readonly code:
      | "INVALID_COMPILER_INPUT"
      | "EXECUTION_BINDING_REJECTED"
      | "EXECUTION_AUTHORIZATION_REJECTED"
      | "RIGHTS_AUTHORIZATION_REJECTED"
      | "EXECUTION_SUBJECT_MISMATCH"
      | "PROVIDER_REQUEST_PROFILE_MISMATCH"
      | "COMMAND_CONTRACT_REJECTED",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "FoundryProviderRequestAuthorizationError";
  }
}

function domainDigest(domain: string, value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(`${domain}\n${stableCanonicalJson(toCanonicalJson(value))}`, "utf8")
    .digest("hex")}`;
}

function digestsEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left.slice("sha256:".length), "hex");
  const rightBytes = Buffer.from(right.slice("sha256:".length), "hex");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function computeFoundryProviderRequestProfileSha256(
  input: unknown,
): string {
  const profile = FoundryProviderRequestProfileV0Schema.parse(input);
  return domainDigest(PROVIDER_REQUEST_PROFILE_DIGEST_DOMAIN, profile);
}

export function computeFoundryProviderRequestAuthorizationSha256(
  input: unknown,
): string {
  const authorization = FoundryProviderRequestAuthorizationV0Schema.parse(input);
  return domainDigest(PROVIDER_REQUEST_AUTHORIZATION_DIGEST_DOMAIN, authorization);
}

export function deriveFoundryProviderIdempotencyKey(
  executionSubjectSha256: string,
  attemptId: string,
): string {
  const subject = RuntimeSha256Schema.parse(executionSubjectSha256).slice(7, 23);
  const attempt = z.string().uuid().parse(attemptId).replaceAll("-", "").slice(0, 16);
  return `foundry-${subject}-${attempt}`;
}

export function deriveFoundryProviderClientRequestId(
  commandKind: FoundryProviderCommandKindV0,
  commandId: string,
): string {
  const kind = FoundryProviderCommandKindV0Schema.parse(commandKind).slice(
    "provider_".length,
  );
  const id = z.string().uuid().parse(commandId).replaceAll("-", "");
  return `foundry-${kind}-${id}`;
}

function parseCompilerInput(input: FoundryProviderRequestAuthorizationCompilerInput) {
  try {
    const subject = FoundryExecutionSubjectBindingV0Schema.parse(
      input.executionSubject,
    );
    const subjectSha256 = RuntimeSha256Schema.parse(input.executionSubjectSha256);
    const jobSpec = FoundryJobSpecV0Schema.parse(input.jobSpec);
    const ingestManifest = FoundryIngestManifestV0Schema.parse(input.ingestManifest);
    const executionPolicy = FoundryExecutionPolicyV0Schema.parse(
      input.executionPolicy,
    );
    const providerPlanEvidence = FoundryProviderPlanEvidenceV0Schema.parse(
      input.providerPlanEvidence,
    );
    const trustedWorkerProfiles = input.trustedWorkerProfiles.map((profile) =>
      FoundryTrustedWorkerProfileV0Schema.parse(profile),
    );
    const providerDeploymentEvidence =
      FoundryProviderDeploymentEvidenceV0Schema.parse(
        input.providerDeploymentEvidence,
      );
    const executionEnvelope = FoundryExecutionEnvelopeV0Schema.parse(
      input.executionEnvelope,
    );
    const executionConfirmation =
      FoundryExecutionEnvelopeConfirmationV0Schema.parse(
        input.executionConfirmation,
      );
    const computeApproval = input.computeApproval === null
      ? null
      : FoundryExecutionEnvelopeComputeApprovalV0Schema.parse(
        input.computeApproval,
      );
    return {
      preparedAt: FoundryUtcInstantSchema.parse(input.preparedAt),
      command: FoundryProviderRequestCommandInputV0Schema.parse(input.command),
      subject,
      subjectSha256,
      jobSpec,
      ingestManifest,
      intakeAdmissionResultSha256: RuntimeSha256Schema.parse(
        input.intakeAdmissionResultSha256,
      ),
      intakeStagingIndexSha256: RuntimeSha256Schema.parse(
        input.intakeStagingIndexSha256,
      ),
      executionPolicy,
      providerPlanEvidence,
      trustedWorkerProfiles,
      providerDeploymentEvidence,
      executionEnvelope,
      executionConfirmation,
      computeApproval,
      rightsApproval: FoundryRightsApprovalSchema.parse(input.rightsApproval),
      rightsApprovalSha256: RuntimeSha256Schema.parse(input.rightsApprovalSha256),
      activeRightsPolicy: FoundryRightsPolicyDefinitionV0Schema.parse(
        input.activeRightsPolicy,
      ),
      rightsPolicyEvidenceSha256: RuntimeSha256Schema.parse(
        input.rightsPolicyEvidenceSha256,
      ),
      providerRequestProfile: FoundryProviderRequestProfileV0Schema.parse(
        input.providerRequestProfile,
      ),
    };
  } catch (error: unknown) {
    throw new FoundryProviderRequestAuthorizationError(
      "INVALID_COMPILER_INPUT",
      `Provider request authorization input failed strict validation: ${error instanceof Error ? error.message : "unknown validation error"}`,
      { cause: error },
    );
  }
}

function assertEvidenceBindings(parsed: ReturnType<typeof parseCompilerInput>): void {
  const binding = validateFoundryExecutionEnvelopeBindings(
    parsed.executionEnvelope,
    {
      jobSpec: parsed.jobSpec,
      ingestManifest: parsed.ingestManifest,
      intakeAdmissionResultSha256: parsed.intakeAdmissionResultSha256,
      intakeStagingIndexSha256: parsed.intakeStagingIndexSha256,
      executionPolicy: parsed.executionPolicy,
      providerPlanEvidence: parsed.providerPlanEvidence,
      trustedWorkerProfiles: parsed.trustedWorkerProfiles,
      providerDeploymentEvidence: parsed.providerDeploymentEvidence,
    },
  );
  if (!binding.valid) {
    throw new FoundryProviderRequestAuthorizationError(
      "EXECUTION_BINDING_REJECTED",
      `Execution evidence binding rejected: ${binding.reason}.`,
    );
  }

  if (parsed.command.commandKind === "provider_submit") {
    const authority = validateFoundryExecutionAuthorizations(
      parsed.executionEnvelope,
      parsed.jobSpec,
      parsed.executionPolicy,
      parsed.executionConfirmation,
      parsed.computeApproval,
      new Date(parsed.preparedAt),
    );
    if (!authority.allowed) {
      throw new FoundryProviderRequestAuthorizationError(
        "EXECUTION_AUTHORIZATION_REJECTED",
        `Provider submit authorization rejected: ${authority.reason}.`,
      );
    }
  }
}

function assertRightsBindings(parsed: ReturnType<typeof parseCompilerInput>): {
  readonly rightsApprovalSha256: string;
  readonly rightsPolicyEvidenceSha256: string;
} {
  const rightsApprovalSha256 = domainDigest(
    RIGHTS_APPROVAL_DIGEST_DOMAIN,
    parsed.rightsApproval,
  );
  const rightsPolicyEvidenceSha256 = domainDigest(
    FOUNDRY_RIGHTS_POLICY_DEFINITION_V0,
    parsed.activeRightsPolicy,
  );
  if (
    !digestsEqual(rightsApprovalSha256, parsed.rightsApprovalSha256) ||
    !digestsEqual(
      rightsPolicyEvidenceSha256,
      parsed.rightsPolicyEvidenceSha256,
    ) ||
    parsed.rightsApproval.policyVersion !==
      parsed.activeRightsPolicy.policyVersion ||
    parsed.rightsApproval.policyGeneration !==
      parsed.activeRightsPolicy.generation ||
    parsed.rightsApproval.policyDefinitionSha256 !==
      parsed.activeRightsPolicy.policyDefinitionSha256
  ) {
    throw new FoundryProviderRequestAuthorizationError(
      "RIGHTS_AUTHORIZATION_REJECTED",
      "Rights approval and policy evidence do not bind the exact generation and persisted digests.",
    );
  }
  if (
    parsed.command.commandKind === "provider_submit" ||
    parsed.command.commandKind === "provider_checkpoint"
  ) {
    const rightsCheckAt = new Date(
      Date.parse(parsed.preparedAt) +
        (parsed.command.commandKind === "provider_checkpoint"
          ? (parsed.providerRequestProfile.maximumApiCallSeconds + 1) * 1_000
          : 0),
    );
    const rights = validateFoundryTrustedRightsApproval(
      parsed.jobSpec,
      parsed.rightsApproval,
      rightsCheckAt,
      parsed.activeRightsPolicy,
    );
    if (!rights.allowed) {
      throw new FoundryProviderRequestAuthorizationError(
        "RIGHTS_AUTHORIZATION_REJECTED",
        `Live rights authorization rejected: ${rights.reason}.`,
      );
    }
  }
  return { rightsApprovalSha256, rightsPolicyEvidenceSha256 };
}

function assertSubjectBindings(
  parsed: ReturnType<typeof parseCompilerInput>,
  rights: ReturnType<typeof assertRightsBindings>,
): {
  readonly executionEnvelopeSha256: string;
  readonly jobSpecSha256: string;
  readonly ingestManifestSha256: string;
  readonly executionPolicySha256: string;
  readonly providerPlanSha256: string;
  readonly providerDeploymentSha256: string;
  readonly workerProfileSha256s: readonly string[];
  readonly executionConfirmationSha256: string;
  readonly computeApprovalSha256: string | null;
} {
  let computedSubjectSha256: string;
  try {
    computedSubjectSha256 = computeFoundryExecutionSubjectSha256(
      parsed.subject as FoundryExecutionSubjectV0,
    );
  } catch (error: unknown) {
    throw new FoundryProviderRequestAuthorizationError(
      "EXECUTION_SUBJECT_MISMATCH",
      "Admitted execution subject failed its canonical runtime invariants.",
      { cause: error },
    );
  }
  const executionEnvelopeSha256 = computeFoundryExecutionEnvelopeSha256(
    parsed.executionEnvelope,
  );
  const jobSpecSha256 = computeFoundryJobSpecSha256(parsed.jobSpec);
  const ingestManifestSha256 = computeFoundryIngestManifestSha256(
    parsed.ingestManifest,
  );
  const executionPolicySha256 = computeFoundryExecutionPolicySha256(
    parsed.executionPolicy,
  );
  const providerPlanSha256 = computeFoundryProviderPlanEvidenceSha256(
    parsed.providerPlanEvidence,
  );
  const providerDeploymentSha256 =
    computeFoundryProviderDeploymentEvidenceSha256(
      parsed.providerDeploymentEvidence,
    );
  const workerProfileSha256s = parsed.trustedWorkerProfiles
    .map((profile) => computeFoundryTrustedWorkerProfileSha256(profile))
    .sort();
  const executionConfirmationSha256 =
    computeFoundryExecutionEnvelopeConfirmationSha256(
      parsed.executionConfirmation,
    );
  const computeApprovalSha256 = parsed.computeApproval === null
    ? null
    : computeFoundryExecutionEnvelopeComputeApprovalSha256(
      parsed.computeApproval,
    );
  const expectedBudgetPolicy = {
    currency: "USD" as const,
    costWarningMicroUsd: parsed.executionPolicy.costWarningMicroUsd,
    costHardStopMicroUsd: parsed.executionPolicy.costHardStopMicroUsd,
    terminationReserveMicroUsd:
      parsed.executionPolicy.terminationReserveMicroUsd,
    absoluteCostCapMicroUsd: parsed.executionPolicy.absoluteCostCapMicroUsd,
    costObservationMaximumAgeSeconds:
      parsed.executionPolicy.costObservationMaximumAgeSeconds,
  };
  const directMismatch =
    !digestsEqual(computedSubjectSha256, parsed.subjectSha256) ||
    parsed.subject.subjectId !== parsed.executionEnvelope.envelopeId ||
    parsed.subject.projectId !== parsed.jobSpec.projectId ||
    parsed.subject.jobSpecSha256 !== jobSpecSha256 ||
    parsed.subject.executionEnvelopeSha256 !== executionEnvelopeSha256 ||
    parsed.subject.ingestManifestSha256 !== ingestManifestSha256 ||
    parsed.subject.intakeAdmissionResultSha256 !==
      parsed.intakeAdmissionResultSha256 ||
    parsed.subject.intakeStagingIndexSha256 !==
      parsed.intakeStagingIndexSha256 ||
    parsed.subject.providerPlanSha256 !== providerPlanSha256 ||
    parsed.subject.executionPolicySha256 !== executionPolicySha256 ||
    parsed.subject.executionConfirmationSha256 !==
      executionConfirmationSha256 ||
    parsed.subject.rightsApprovalSha256 !== rights.rightsApprovalSha256 ||
    parsed.subject.rightsPolicyEvidenceSha256 !==
      rights.rightsPolicyEvidenceSha256 ||
    parsed.subject.rightsPolicyDefinitionSha256 !==
      parsed.activeRightsPolicy.policyDefinitionSha256 ||
    parsed.subject.computeApprovalSha256 !== computeApprovalSha256 ||
    parsed.subject.providerKind !== parsed.executionEnvelope.providerKind ||
    parsed.subject.providerAdapterId !==
      parsed.executionEnvelope.providerAdapterId ||
    parsed.subject.providerAdapterVersion !==
      parsed.executionEnvelope.providerAdapterVersion ||
    parsed.subject.providerAdapterArtifactSha256 !==
      parsed.executionEnvelope.providerAdapterArtifactSha256 ||
    parsed.subject.providerDeploymentSha256 !== providerDeploymentSha256 ||
    stableCanonicalJson(toCanonicalJson(parsed.subject.workerProfileSha256s)) !==
      stableCanonicalJson(toCanonicalJson(workerProfileSha256s)) ||
    parsed.subject.pricingSnapshotSha256 !==
      parsed.executionEnvelope.pricingSnapshotSha256 ||
    parsed.subject.pricingSnapshotExpiresAt !==
      parsed.executionEnvelope.pricingSnapshotExpiresAt ||
    parsed.subject.createdAt !== parsed.executionEnvelope.createdAt ||
    parsed.subject.dispatchDeadline !==
      parsed.executionEnvelope.dispatchDeadline ||
    stableCanonicalJson(toCanonicalJson(parsed.subject.budgetPolicy)) !==
      stableCanonicalJson(toCanonicalJson(expectedBudgetPolicy));
  if (directMismatch) {
    throw new FoundryProviderRequestAuthorizationError(
      "EXECUTION_SUBJECT_MISMATCH",
      "Admitted execution subject does not bind the exact evidence used to compile the provider request.",
    );
  }
  return {
    executionEnvelopeSha256,
    jobSpecSha256,
    ingestManifestSha256,
    executionPolicySha256,
    providerPlanSha256,
    providerDeploymentSha256,
    workerProfileSha256s,
    executionConfirmationSha256,
    computeApprovalSha256,
  };
}

function assertProviderProfileBindings(
  parsed: ReturnType<typeof parseCompilerInput>,
  evidence: ReturnType<typeof assertSubjectBindings>,
): string {
  const profile = parsed.providerRequestProfile;
  const expectedIdempotencyKey = deriveFoundryProviderIdempotencyKey(
    parsed.subjectSha256,
    parsed.command.attemptId,
  );
  const expectedClientRequestId = deriveFoundryProviderClientRequestId(
    parsed.command.commandKind,
    parsed.command.commandId,
  );
  const stageIds = parsed.jobSpec.stages.map((stage) => stage.id).sort();
  const plannedCapacityClasses = parsed.providerPlanEvidence.stages
    .map((stage) => stage.capacityClass)
    .sort();
  const local =
    parsed.executionEnvelope.providerKind === "local_cpu" ||
    parsed.executionEnvelope.providerKind === "local_cuda";
  const objectStorageAllowed = parsed.jobSpec.objectStorageProfile === null ||
    profile.allowedObjectStorageProfiles.includes(
      parsed.jobSpec.objectStorageProfile,
    );
  const checkpointAuthorityHorizon =
    Date.parse(parsed.preparedAt) + (profile.maximumApiCallSeconds + 1) * 1_000;
  const profileMismatch =
    profile.providerKind !== parsed.executionEnvelope.providerKind ||
    profile.providerAdapterId !== parsed.executionEnvelope.providerAdapterId ||
    profile.providerAdapterVersion !==
      parsed.executionEnvelope.providerAdapterVersion ||
    profile.providerAdapterArtifactSha256 !==
      parsed.executionEnvelope.providerAdapterArtifactSha256 ||
    profile.providerDeploymentSha256 !== evidence.providerDeploymentSha256 ||
    local !== (profile.target.targetKind === "local_worker") ||
    !profile.supportedCommandKinds.includes(parsed.command.commandKind) ||
    parsed.jobSpec.stages.some(
      (stage) =>
        !profile.allowedContainerImages.includes(stage.containerImage) ||
        !profile.allowedNetworkAccess.includes(stage.networkAccess),
    ) ||
    plannedCapacityClasses.some(
      (capacityClass) =>
        !profile.allowedCapacityClasses.includes(capacityClass),
    ) ||
    !objectStorageAllowed ||
    (!local && parsed.jobSpec.objectStorageProfile === null) ||
    parsed.command.providerIdempotencyKey !== expectedIdempotencyKey ||
    parsed.command.clientRequestId !== expectedClientRequestId ||
    stableCanonicalJson(toCanonicalJson(parsed.command.stageIds)) !==
      stableCanonicalJson(toCanonicalJson(stageIds));
  if (profileMismatch) {
    throw new FoundryProviderRequestAuthorizationError(
      "PROVIDER_REQUEST_PROFILE_MISMATCH",
      "Provider request profile, derived request identities, or exact stage set does not match the admitted execution.",
    );
  }
  if (
    (parsed.command.commandKind === "provider_submit" ||
      parsed.command.commandKind === "provider_checkpoint") &&
    (Date.parse(profile.reviewedAt) > Date.parse(parsed.preparedAt) ||
      Date.parse(profile.expiresAt) <= Date.parse(parsed.preparedAt) ||
      (parsed.command.commandKind === "provider_checkpoint" &&
        Date.parse(profile.expiresAt) <= checkpointAuthorityHorizon))
  ) {
    throw new FoundryProviderRequestAuthorizationError(
      "PROVIDER_REQUEST_PROFILE_MISMATCH",
      "Provider launch or checkpoint requires a trusted request profile valid through its bounded API-call window.",
    );
  }
  if (
    parsed.command.commandKind === "provider_submit" &&
    Date.parse(profile.expiresAt) <
      Date.parse(parsed.executionEnvelope.dispatchDeadline)
  ) {
    throw new FoundryProviderRequestAuthorizationError(
      "PROVIDER_REQUEST_PROFILE_MISMATCH",
      "Provider submit request profile must remain valid through the dispatch deadline.",
    );
  }
  if (
    parsed.command.commandKind === "provider_checkpoint" &&
    !parsed.jobSpec.stages.some((stage) => stage.checkpoint !== "none")
  ) {
    throw new FoundryProviderRequestAuthorizationError(
      "COMMAND_CONTRACT_REJECTED",
      "Provider checkpoint is not authorized by any exact job stage.",
    );
  }
  return computeFoundryProviderRequestProfileSha256(profile);
}

function compileStages(parsed: ReturnType<typeof parseCompilerInput>) {
  const planByStageId = new Map(
    parsed.providerPlanEvidence.stages.map((stage) => [stage.stageId, stage]),
  );
  const profileBySha256 = new Map(
    parsed.trustedWorkerProfiles.map((profile) => [
      computeFoundryTrustedWorkerProfileSha256(profile),
      profile,
    ]),
  );
  const capacityById = new Map(
    parsed.providerDeploymentEvidence.capacityClasses.map((capacity) => [
      capacity.id,
      capacity,
    ]),
  );
  return [...parsed.jobSpec.stages]
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    .map((stage) => {
      const plan = planByStageId.get(stage.id);
      const profile = plan === undefined
        ? undefined
        : profileBySha256.get(plan.workerProfileSha256);
      const capacity = plan === undefined
        ? undefined
        : capacityById.get(plan.capacityClass);
      if (plan === undefined || profile === undefined || capacity === undefined) {
        throw new FoundryProviderRequestAuthorizationError(
          "EXECUTION_BINDING_REJECTED",
          `Stage ${stage.id} is missing its exact provider plan, worker profile, or capacity binding.`,
        );
      }
      return {
        stageId: stage.id,
        stageKind: stage.kind,
        dependsOn: stage.dependsOn,
        workerProfileId: profile.profileId,
        workerProfileVersion: profile.profileVersion,
        workerProfileSha256: plan.workerProfileSha256,
        operationClass: profile.operationClass,
        containerImage: stage.containerImage,
        command: stage.command,
        networkAccess: stage.networkAccess,
        inputAssetIds: stage.inputAssetIds,
        outputNames: stage.outputNames,
        rightsPurposes: stage.rightsPurposes,
        checkpoint: stage.checkpoint,
        resumable: stage.resumable,
        capacityClass: plan.capacityClass,
        requestedResources: {
          cpuCores: stage.cpuCores,
          ramGiB: stage.ramGiB,
          gpuCount: stage.gpuCount,
          minimumGpuVramGiB: stage.minimumGpuVramGiB,
          scratchGiB: stage.scratchGiB,
        },
        authorizedCapacity: {
          cpuCores: capacity.cpuCores,
          ramGiB: capacity.ramGiB,
          gpuCount: capacity.gpuCount,
          perGpuVramGiB: capacity.perGpuVramGiB,
          scratchGiB: capacity.scratchGiB,
        },
        estimatedCostMicroUsd: plan.estimatedCostMicroUsd,
        maximumRuntimeSeconds: plan.maximumRuntimeSeconds,
      };
    });
}

function compileAction(command: FoundryProviderRequestCommandInputV0) {
  switch (command.commandKind) {
    case "provider_submit":
      return {
        kind: "provider_submit" as const,
        providerCommandRef: null,
      };
    case "provider_reconcile": {
      const lineage = command.submitLineage;
      if (lineage === null) {
        throw new FoundryProviderRequestAuthorizationError(
          "COMMAND_CONTRACT_REJECTED",
          "Provider reconciliation lost immutable submit lineage.",
        );
      }
      return {
        kind: "provider_reconcile" as const,
        providerCommandRef: command.providerCommandRef,
        submitCommandId: lineage.submitCommandId,
        submitProviderRequestAuthorizationSha256:
          lineage.submitProviderRequestAuthorizationSha256,
      };
    }
    case "provider_poll":
    case "provider_checkpoint": {
      const providerCommandRef = command.providerCommandRef;
      if (providerCommandRef === null) {
        throw new FoundryProviderRequestAuthorizationError(
          "COMMAND_CONTRACT_REJECTED",
          `${command.commandKind} lost its exact provider reference.`,
        );
      }
      return { kind: command.commandKind, providerCommandRef };
    }
    case "provider_stop": {
      const providerCommandRef = command.providerCommandRef;
      const stopIntentId = command.stopIntentId;
      if (providerCommandRef === null || stopIntentId === null) {
        throw new FoundryProviderRequestAuthorizationError(
          "COMMAND_CONTRACT_REJECTED",
          "provider_stop lost its exact provider reference or stop intent.",
        );
      }
      return { kind: "provider_stop" as const, providerCommandRef, stopIntentId };
    }
  }
}

/**
 * Pure compiler. It performs no database, filesystem, process, network,
 * provider, credential, or clock reads; callers must pass trusted persisted
 * evidence and a database-clock preparation instant explicitly.
 */
export function compileFoundryProviderRequestAuthorization(
  input: FoundryProviderRequestAuthorizationCompilerInput,
): CompiledFoundryProviderRequestAuthorizationV0 {
  const parsed = parseCompilerInput(input);
  assertEvidenceBindings(parsed);
  const rights = assertRightsBindings(parsed);
  const evidence = assertSubjectBindings(parsed, rights);
  const providerRequestProfileSha256 = assertProviderProfileBindings(
    parsed,
    evidence,
  );
  const stages = compileStages(parsed);
  const authorization = FoundryProviderRequestAuthorizationV0Schema.parse({
    schemaVersion: FOUNDRY_PROVIDER_REQUEST_AUTHORIZATION_V0,
    authority: "none",
    commandKind: parsed.command.commandKind,
    commandId: parsed.command.commandId,
    commandSequence: parsed.command.commandSequence,
    preparedAt: parsed.preparedAt,
    execution: {
      executionId: parsed.command.executionId,
      attemptId: parsed.command.attemptId,
      attemptOrdinal: parsed.command.attemptOrdinal,
      fencingToken: parsed.command.fencingToken,
      executionSubjectSha256: parsed.subjectSha256,
      subjectId: parsed.subject.subjectId,
      projectId: parsed.subject.projectId,
      jobId: parsed.jobSpec.id,
    },
    requestIdentity: {
      providerIdempotencyKey: parsed.command.providerIdempotencyKey,
      clientRequestId: parsed.command.clientRequestId,
      resourceMarker: {
        executionSubjectSha256: parsed.subjectSha256,
        providerIdempotencyKey: parsed.command.providerIdempotencyKey,
      },
    },
    evidence: {
      jobSpecSha256: evidence.jobSpecSha256,
      reviewedIngestManifestSha256: evidence.ingestManifestSha256,
      intakeAdmissionResultSha256: parsed.intakeAdmissionResultSha256,
      intakeStagingIndexSha256: parsed.intakeStagingIndexSha256,
      executionEnvelopeSha256: evidence.executionEnvelopeSha256,
      executionPolicySha256: evidence.executionPolicySha256,
      providerPlanSha256: evidence.providerPlanSha256,
      providerDeploymentSha256: evidence.providerDeploymentSha256,
      workerProfileSha256s: evidence.workerProfileSha256s,
      executionConfirmationSha256: evidence.executionConfirmationSha256,
      computeApprovalSha256: evidence.computeApprovalSha256,
    },
    provider: {
      providerKind: parsed.executionEnvelope.providerKind,
      providerAdapterId: parsed.executionEnvelope.providerAdapterId,
      providerAdapterVersion: parsed.executionEnvelope.providerAdapterVersion,
      providerAdapterArtifactSha256:
        parsed.executionEnvelope.providerAdapterArtifactSha256,
      providerAdapterConfigurationSha256:
        parsed.providerRequestProfile.providerAdapterConfigurationSha256,
      providerDeploymentId:
        parsed.providerDeploymentEvidence.deploymentId,
      providerDeploymentSha256: evidence.providerDeploymentSha256,
      accountProjectAlias:
        parsed.providerDeploymentEvidence.accountProjectAlias,
      region: parsed.providerDeploymentEvidence.region,
      dataResidency: parsed.providerDeploymentEvidence.dataResidency,
      providerRequestProfileId: parsed.providerRequestProfile.profileId,
      providerRequestProfileVersion:
        parsed.providerRequestProfile.profileVersion,
      providerRequestProfileSha256,
      target: parsed.providerRequestProfile.target,
    },
    rights: {
      rightsApprovalSha256: rights.rightsApprovalSha256,
      rightsPolicyEvidenceSha256: rights.rightsPolicyEvidenceSha256,
      rightsPolicyDefinitionSha256:
        parsed.activeRightsPolicy.policyDefinitionSha256,
      policyVersion: parsed.activeRightsPolicy.policyVersion,
      policyGeneration: parsed.activeRightsPolicy.generation,
      decision: "allowed",
      stagePurposes: stages.map((stage) => ({
        stageId: stage.stageId,
        purposes: stage.rightsPurposes,
      })),
    },
    storage: {
      sourceMountMode: parsed.jobSpec.sourceMountMode,
      objectStorageProfile: parsed.jobSpec.objectStorageProfile,
      outputPrefix: parsed.jobSpec.outputPrefix,
    },
    runtime: {
      maximumApiCallSeconds:
        parsed.providerRequestProfile.maximumApiCallSeconds,
      maximumWallClockSeconds:
        parsed.executionPolicy.maximumWallClockSeconds,
      workerSelfDeadlineSeconds:
        parsed.executionPolicy.workerSelfDeadlineSeconds,
      providerMaximumExecutionTtlSeconds:
        parsed.executionPolicy.providerMaximumExecutionTtlSeconds,
      dispatchDeadline: parsed.executionEnvelope.dispatchDeadline,
      observationIntervalSeconds:
        parsed.executionPolicy.observationIntervalSeconds,
      checkpointIntervalSeconds:
        parsed.executionPolicy.checkpointIntervalSeconds,
      cancelGracePeriodSeconds:
        parsed.executionPolicy.cancelGracePeriodSeconds,
      terminationGracePeriodSeconds:
        parsed.executionPolicy.terminationGracePeriodSeconds,
      terminationConfirmationTimeoutSeconds:
        parsed.executionPolicy.terminationConfirmationTimeoutSeconds,
      budgetPolicy: parsed.subject.budgetPolicy,
      checkpointContract: parsed.subject.checkpointContract,
    },
    stages,
    action: compileAction(parsed.command),
  });
  return {
    authorization,
    authorizationSha256:
      computeFoundryProviderRequestAuthorizationSha256(authorization),
  };
}

export type FoundryProviderRequestAuthorizationValidation =
  | { readonly valid: true }
  | {
      readonly valid: false;
      readonly reasonCode:
        | "authorization_schema_rejected"
        | "authorization_digest_mismatch"
        | "trusted_recompile_rejected"
        | "authorization_content_mismatch";
    };

/** Recompiles from trusted evidence and requires byte-equivalent canonical content. */
export function validateFoundryProviderRequestAuthorization(
  authorizationInput: unknown,
  authorizationSha256Input: unknown,
  trustedInput: FoundryProviderRequestAuthorizationCompilerInput,
): FoundryProviderRequestAuthorizationValidation {
  const authorization = FoundryProviderRequestAuthorizationV0Schema.safeParse(
    authorizationInput,
  );
  if (!authorization.success) {
    return { valid: false, reasonCode: "authorization_schema_rejected" };
  }
  const digest = RuntimeSha256Schema.safeParse(authorizationSha256Input);
  if (
    !digest.success ||
    !digestsEqual(
      computeFoundryProviderRequestAuthorizationSha256(authorization.data),
      digest.data,
    )
  ) {
    return { valid: false, reasonCode: "authorization_digest_mismatch" };
  }
  let expected: CompiledFoundryProviderRequestAuthorizationV0;
  try {
    expected = compileFoundryProviderRequestAuthorization(trustedInput);
  } catch {
    return { valid: false, reasonCode: "trusted_recompile_rejected" };
  }
  if (
    !digestsEqual(expected.authorizationSha256, digest.data) ||
    stableCanonicalJson(toCanonicalJson(expected.authorization)) !==
      stableCanonicalJson(toCanonicalJson(authorization.data))
  ) {
    return { valid: false, reasonCode: "authorization_content_mismatch" };
  }
  return { valid: true };
}
