import { createHash } from "node:crypto";
import {
  FoundryCanonicalActorSchema,
  FoundryProviderAdapterVersionSchema,
  FoundryProviderKindSchema,
  FoundryUtcInstantSchema,
  RuntimeManifestKeySchema,
  RuntimeSha256Schema,
} from "@omnitwin/types";
import {
  stableCanonicalJson,
  toCanonicalJson,
} from "@omnitwin/reconstruction-foundry";
import { z } from "zod";
import {
  FoundryProviderCommandRefSchema,
  FoundryProviderRequestAuthorizationV0Schema,
  computeFoundryProviderRequestAuthorizationSha256,
  deriveFoundryProviderClientRequestId,
  deriveFoundryProviderIdempotencyKey,
} from "./foundry-provider-request-authorization.js";

export const FOUNDRY_CLAIMED_PROVIDER_COMMAND_V0 =
  "omnitwin.foundry.claimed-provider-command.v0";
export const FOUNDRY_PROVIDER_COMMAND_OUTCOME_V0 =
  "omnitwin.foundry.provider-command-outcome.v0";
export const FOUNDRY_PROVIDER_ADAPTER_OUTCOME_V0 =
  "omnitwin.foundry.provider-adapter-outcome.v0";
export const FOUNDRY_PROVIDER_CHECKPOINT_EVIDENCE_V0 =
  "omnitwin.foundry.provider-checkpoint-evidence.v0";

const PositiveFenceSchema = z
  .string()
  .regex(/^[1-9][0-9]{0,18}$/u)
  .refine((value) => BigInt(value) <= 9_223_372_036_854_775_807n);

const ProviderCommandKindSchema = z.enum([
  "provider_submit",
  "provider_reconcile",
  "provider_poll",
  "provider_checkpoint",
  "provider_stop",
]);

const ProviderSubmitLineageSchema = z
  .object({
    submitCommandId: z.string().uuid(),
    executionSubjectSha256: RuntimeSha256Schema,
    providerIdempotencyKey: RuntimeManifestKeySchema,
    providerRequestSha256: RuntimeSha256Schema,
  })
  .strict();

const ProviderCommandPayloadSchema = z
  .object({
    commandKind: ProviderCommandKindSchema,
    executionSubjectSha256: RuntimeSha256Schema,
    providerRequest: FoundryProviderRequestAuthorizationV0Schema,
    providerRequestSha256: RuntimeSha256Schema,
    providerIdempotencyKey: RuntimeManifestKeySchema,
    stageIds: z.array(RuntimeManifestKeySchema).min(1).max(1_000),
    maximumApiCallSeconds: z.number().int().positive().max(300),
    providerCommandRef: FoundryProviderCommandRefSchema.nullable(),
    submitLineage: ProviderSubmitLineageSchema.nullable(),
    stopIntentId: z.string().uuid().nullable(),
  })
  .strict()
  .superRefine((payload, ctx) => {
    if (
      payload.providerRequestSha256 !==
      digestFoundryProviderRequest(payload.providerRequest)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["providerRequestSha256"],
        message: "provider request digest does not match its exact canonical JSON",
      });
    }
    if (
      payload.providerRequest.commandKind !== payload.commandKind ||
      payload.providerRequest.execution.executionSubjectSha256 !==
        payload.executionSubjectSha256 ||
      payload.providerRequest.requestIdentity.providerIdempotencyKey !==
        payload.providerIdempotencyKey ||
      payload.providerRequest.runtime.maximumApiCallSeconds !==
        payload.maximumApiCallSeconds
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["providerRequest"],
        message: "closed provider authorization lost its exact command, subject, request identity, or runtime binding",
      });
    }
    const authorizedStageIds = payload.providerRequest.stages.map(
      (stage) => stage.stageId,
    );
    if (
      authorizedStageIds.length !== payload.stageIds.length ||
      authorizedStageIds.some(
        (stageId, index) => stageId !== payload.stageIds[index],
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stageIds"],
        message: "provider command stages must equal the closed authorization stage set",
      });
    }
    if (
      payload.providerRequest.action.providerCommandRef !==
      payload.providerCommandRef
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["providerCommandRef"],
        message: "provider command reference must equal the closed authorization action",
      });
    }
    if (
      payload.commandKind === "provider_submit" &&
      payload.providerCommandRef !== null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["providerCommandRef"],
        message: "provider submit forbids an existing provider command reference",
      });
    }
    if (
      (payload.commandKind === "provider_poll" ||
        payload.commandKind === "provider_checkpoint" ||
        payload.commandKind === "provider_stop") &&
      payload.providerCommandRef === null
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["providerCommandRef"],
        message: "poll, checkpoint, and stop require an exact provider command reference",
      });
    }
    if (payload.commandKind === "provider_reconcile") {
      if (payload.submitLineage === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["submitLineage"],
          message: "provider reconciliation requires immutable original-submit lineage",
        });
      } else {
        if (
          payload.submitLineage.executionSubjectSha256 !==
          payload.executionSubjectSha256
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["submitLineage", "executionSubjectSha256"],
            message: "reconciliation lineage must bind the same execution subject",
          });
        }
        if (
          payload.submitLineage.providerIdempotencyKey !==
          payload.providerIdempotencyKey
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["submitLineage", "providerIdempotencyKey"],
            message: "reconciliation lineage must bind the original provider idempotency key",
          });
        }
        if (
          payload.submitLineage.providerRequestSha256 ===
          payload.providerRequestSha256
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["submitLineage", "providerRequestSha256"],
            message: "reconciliation lineage must bind the original submit request, not the reconciliation request",
          });
        }
        if (
          payload.providerRequest.action.kind !== "provider_reconcile" ||
          payload.providerRequest.action.submitCommandId !==
            payload.submitLineage.submitCommandId ||
          payload.providerRequest.action
            .submitProviderRequestAuthorizationSha256 !==
            payload.submitLineage.providerRequestSha256
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["submitLineage"],
            message: "reconciliation lineage must equal the closed authorization action lineage",
          });
        }
      }
    } else if (payload.submitLineage !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["submitLineage"],
        message: "only provider reconciliation may carry original-submit lineage",
      });
    }
    if (payload.commandKind === "provider_stop") {
      if (payload.stopIntentId === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["stopIntentId"],
          message: "provider stop requires one exact immutable stop intent",
        });
      } else if (
        payload.providerRequest.action.kind !== "provider_stop" ||
        payload.providerRequest.action.stopIntentId !== payload.stopIntentId
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["stopIntentId"],
          message: "provider stop intent must equal the closed authorization action causation",
        });
      }
    } else if (payload.stopIntentId !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stopIntentId"],
        message: "only provider stop may carry a stop intent",
      });
    }
    const sorted = [...payload.stageIds].sort();
    if (
      new Set(payload.stageIds).size !== payload.stageIds.length ||
      payload.stageIds.some((stageId, index) => stageId !== sorted[index])
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stageIds"],
        message: "provider command stage IDs must be unique and sorted",
      });
    }
  });
export type FoundryProviderCommandPayloadV0 = z.infer<
  typeof ProviderCommandPayloadSchema
>;

export const FoundryClaimedProviderCommandV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_CLAIMED_PROVIDER_COMMAND_V0),
    commandKind: ProviderCommandKindSchema,
    commandId: z.string().uuid(),
    executionId: z.string().uuid(),
    attemptId: z.string().uuid(),
    projectId: RuntimeManifestKeySchema,
    jobId: RuntimeManifestKeySchema,
    executionEnvelopeSha256: RuntimeSha256Schema,
    providerKind: FoundryProviderKindSchema,
    providerAdapterId: RuntimeManifestKeySchema,
    providerAdapterVersion: FoundryProviderAdapterVersionSchema,
    providerAdapterArtifactSha256: RuntimeSha256Schema,
    providerAdapterConfigurationSha256: RuntimeSha256Schema,
    providerDeploymentSha256: RuntimeSha256Schema,
    providerRequestProfileId: RuntimeManifestKeySchema,
    providerRequestProfileVersion: RuntimeManifestKeySchema,
    providerRequestProfileSha256: RuntimeSha256Schema,
    attemptOrdinal: z.literal(1),
    fencingToken: PositiveFenceSchema,
    commandSequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    claimedBy: FoundryCanonicalActorSchema,
    claimToken: z.string().uuid(),
    claimedAt: FoundryUtcInstantSchema,
    claimExpiresAt: FoundryUtcInstantSchema,
    payload: ProviderCommandPayloadSchema,
    payloadSha256: RuntimeSha256Schema,
  })
  .strict()
  .superRefine((claim, ctx) => {
    if (claim.commandKind !== claim.payload.commandKind) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payload", "commandKind"],
        message: "top-level command kind must exactly match the immutable payload command kind",
      });
    }
    if (Date.parse(claim.claimedAt) >= Date.parse(claim.claimExpiresAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["claimExpiresAt"],
        message: "provider command claim must expire after it was acquired",
      });
    }
    if (claim.payloadSha256 !== digestFoundryProviderCommandPayload(claim.payload)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payloadSha256"],
        message: "provider command payload digest does not match its exact content",
      });
    }
    const authorization = claim.payload.providerRequest;
    if (
      authorization.commandId !== claim.commandId ||
      authorization.commandSequence !== claim.commandSequence ||
      authorization.execution.executionId !== claim.executionId ||
      authorization.execution.attemptId !== claim.attemptId ||
      authorization.execution.fencingToken !== claim.fencingToken ||
      authorization.execution.projectId !== claim.projectId ||
      authorization.execution.jobId !== claim.jobId ||
      authorization.evidence.executionEnvelopeSha256 !==
        claim.executionEnvelopeSha256 ||
      authorization.provider.providerKind !== claim.providerKind ||
      authorization.provider.providerAdapterId !== claim.providerAdapterId ||
      authorization.provider.providerAdapterVersion !==
        claim.providerAdapterVersion ||
      authorization.provider.providerAdapterArtifactSha256 !==
        claim.providerAdapterArtifactSha256 ||
      authorization.provider.providerAdapterConfigurationSha256 !==
        claim.providerAdapterConfigurationSha256 ||
      authorization.provider.providerDeploymentSha256 !==
        claim.providerDeploymentSha256 ||
      authorization.evidence.providerDeploymentSha256 !==
        claim.providerDeploymentSha256 ||
      authorization.provider.providerRequestProfileId !==
        claim.providerRequestProfileId ||
      authorization.provider.providerRequestProfileVersion !==
        claim.providerRequestProfileVersion ||
      authorization.provider.providerRequestProfileSha256 !==
        claim.providerRequestProfileSha256
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payload", "providerRequest"],
        message: "closed provider authorization does not bind the exact durable claim scope",
      });
    }
    if (
      authorization.requestIdentity.providerIdempotencyKey !==
        deriveFoundryProviderIdempotencyKey(
          claim.payload.executionSubjectSha256,
          claim.attemptId,
        ) ||
      authorization.requestIdentity.clientRequestId !==
        deriveFoundryProviderClientRequestId(claim.commandKind, claim.commandId)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payload", "providerRequest", "requestIdentity"],
        message: "provider request identities are not deterministically derived from the exact attempt and command",
      });
    }
    if (
      claim.payload.commandKind === "provider_reconcile" &&
      claim.payload.submitLineage?.submitCommandId === claim.commandId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payload", "submitLineage", "submitCommandId"],
        message: "reconciliation cannot claim itself as the original submit command",
      });
    }
  });
export type FoundryClaimedProviderCommandV0 = z.infer<
  typeof FoundryClaimedProviderCommandV0Schema
>;

export const FoundryProviderAdapterClaimBindingV0Schema = z
  .object({
    providerKind: FoundryProviderKindSchema,
    providerAdapterId: RuntimeManifestKeySchema,
    providerAdapterVersion: FoundryProviderAdapterVersionSchema,
    providerAdapterArtifactSha256: RuntimeSha256Schema,
    providerAdapterConfigurationSha256: RuntimeSha256Schema,
    providerDeploymentSha256: RuntimeSha256Schema,
    providerRequestProfileId: RuntimeManifestKeySchema,
    providerRequestProfileVersion: RuntimeManifestKeySchema,
    providerRequestProfileSha256: RuntimeSha256Schema,
    targetKind: z.enum(["local_worker", "remote_worker_pool"]),
    targetId: RuntimeManifestKeySchema,
  })
  .strict();
export type FoundryProviderAdapterClaimBindingV0 = z.infer<
  typeof FoundryProviderAdapterClaimBindingV0Schema
>;

function claimBindingKey(binding: FoundryProviderAdapterClaimBindingV0): string {
  return [
    binding.providerKind,
    binding.providerAdapterId,
    binding.providerAdapterVersion,
    binding.providerAdapterArtifactSha256,
    binding.providerAdapterConfigurationSha256,
    binding.providerDeploymentSha256,
    binding.providerRequestProfileId,
    binding.providerRequestProfileVersion,
    binding.providerRequestProfileSha256,
    binding.targetKind,
    binding.targetId,
  ].join("\u0000");
}

export const FoundryProviderAdapterClaimBindingsV0Schema = z
  .array(FoundryProviderAdapterClaimBindingV0Schema)
  .min(1)
  .max(1_000)
  .superRefine((bindings, ctx) => {
    const keys = bindings.map(claimBindingKey);
    const sorted = [...keys].sort();
    if (
      new Set(keys).size !== keys.length ||
      keys.some((key, index) => key !== sorted[index])
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "provider adapter claim bindings must be unique and canonically sorted",
      });
    }
  });
export type FoundryProviderAdapterClaimBindingsV0 = readonly FoundryProviderAdapterClaimBindingV0[];

const ProviderCheckpointUtcInstantSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(?:Z|\+00:00)$/u,
    "provider checkpoint time must be an exact UTC millisecond instant",
  )
  .refine((value) => {
    if (value.startsWith("0000-")) return false;
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) return false;
    const canonical = value.endsWith("Z")
      ? `${value.slice(0, -1)}+00:00`
      : value;
    return parsed.toISOString().replace(/Z$/u, "+00:00") === canonical;
  }, "provider checkpoint time must be a real proleptic-Gregorian instant in years 0001..9999")
  .transform((value) => value.endsWith("Z")
    ? `${value.slice(0, -1)}+00:00`
    : value);

export const FoundryVerifiedCheckpointEvidenceV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_PROVIDER_CHECKPOINT_EVIDENCE_V0),
    checkpointKind: z.string().regex(/^[a-z][a-z0-9_]{0,59}$/u),
    checkpointSha256: RuntimeSha256Schema,
    evidenceRef: z.string().trim().min(1).max(2_048),
    providerCheckpointId: z.string().trim().min(1).max(240),
    providerCreatedAt: ProviderCheckpointUtcInstantSchema,
  })
  .strict();
export type FoundryVerifiedCheckpointEvidenceV0 = z.infer<
  typeof FoundryVerifiedCheckpointEvidenceV0Schema
>;

const ProviderOutcomeCodeSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._:-]{0,127}$/u);

export const FoundryNormalizedProviderLifecycleSchema = z.enum([
  "not_observed",
  "unknown",
  "queued",
  "running",
  "exited",
  "terminated",
  "not_found",
]);
export type FoundryNormalizedProviderLifecycle = z.infer<
  typeof FoundryNormalizedProviderLifecycleSchema
>;

export const FoundryProviderAdapterOutcomeV0Schema = z.discriminatedUnion(
  "status",
  [
    z.object({
      status: z.literal("succeeded"),
      outcomeCode: ProviderOutcomeCodeSchema,
      providerLifecycle: FoundryNormalizedProviderLifecycleSchema,
      providerCommandRef: FoundryProviderCommandRefSchema.nullable(),
      evidenceSha256: RuntimeSha256Schema,
      verifiedCheckpoint: FoundryVerifiedCheckpointEvidenceV0Schema.optional(),
    }).strict(),
    z.object({
      status: z.literal("failed"),
      outcomeCode: ProviderOutcomeCodeSchema,
      providerLifecycle: FoundryNormalizedProviderLifecycleSchema,
      providerCommandRef: FoundryProviderCommandRefSchema.nullable(),
      evidenceSha256: RuntimeSha256Schema,
      verifiedCheckpoint: FoundryVerifiedCheckpointEvidenceV0Schema.optional(),
    }).strict(),
    z.object({
      status: z.literal("uncertain"),
      outcomeCode: ProviderOutcomeCodeSchema,
      providerLifecycle: FoundryNormalizedProviderLifecycleSchema,
      providerCommandRef: FoundryProviderCommandRefSchema.nullable(),
      evidenceSha256: RuntimeSha256Schema,
      verifiedCheckpoint: FoundryVerifiedCheckpointEvidenceV0Schema.optional(),
    }).strict(),
  ],
).superRefine((outcome, ctx) => {
  if (outcome.status === "uncertain" && outcome.providerLifecycle !== "unknown") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["providerLifecycle"],
      message: "an uncertain provider effect must have unknown normalized lifecycle",
    });
  }
  if (outcome.status !== "succeeded" && outcome.verifiedCheckpoint !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["verifiedCheckpoint"],
      message: "only a successful checkpoint command may carry verified checkpoint evidence",
    });
  }
});
export type FoundryProviderAdapterOutcomeV0 = z.infer<
  typeof FoundryProviderAdapterOutcomeV0Schema
>;

export type FoundryProviderResultTerminalDisposition =
  | "late_eligible"
  | "already_authoritative"
  | "terminal_conflict"
  | "not_eligible";

export interface FoundryProviderResultClassificationDisposition {
  readonly status: "classified";
  readonly classificationId: string;
  readonly completionEventId: string;
  readonly disposition: FoundryProviderResultTerminalDisposition;
  readonly classifiedAt: string;
}

export type FoundryProviderResultObservationDisposition = {
  readonly status: "observed" | "replayed";
  readonly observationId: string;
  readonly invocationEventId: string;
  readonly workerObservedAt: string;
  readonly recordedAt: string;
  readonly classification:
    | { readonly status: "held" }
    | FoundryProviderResultClassificationDisposition;
};

export type FoundryProviderCommandCompletionDisposition =
  | { readonly status: "completed" | "replayed" }
  | {
      readonly status: "result_observation_classified";
      readonly observationId: string;
      readonly classification: FoundryProviderResultClassificationDisposition;
    };

export type FoundryLateResultCustodyDisposition =
  | FoundryProviderResultObservationDisposition
  | { readonly status: "not_conclusive" }
  | {
      readonly status: "failed";
      readonly errorName: string;
      readonly message: string;
    };

type FoundryProviderOutcomeContractResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly reasonCode: string };

function lifecycleIs(
  lifecycle: FoundryNormalizedProviderLifecycle,
  allowed: readonly FoundryNormalizedProviderLifecycle[],
): boolean {
  return allowed.includes(lifecycle);
}

/**
 * Validates the semantic relationship between a claimed command and an
 * otherwise well-formed adapter outcome. This is deliberately separate from
 * the provider-neutral shape schema because legal references and lifecycle
 * states depend on the immutable command kind.
 */
export function validateFoundryProviderOutcomeForCommand(
  command: FoundryClaimedProviderCommandV0,
  outcome: FoundryProviderAdapterOutcomeV0,
): FoundryProviderOutcomeContractResult {
  const hasVerifiedCheckpoint = outcome.verifiedCheckpoint !== undefined;
  if (
    hasVerifiedCheckpoint !==
      (command.commandKind === "provider_checkpoint" && outcome.status === "succeeded")
  ) {
    return {
      valid: false,
      reasonCode: hasVerifiedCheckpoint
        ? "verified_checkpoint_evidence_misplaced"
        : "verified_checkpoint_evidence_missing",
    };
  }
  if (
    hasVerifiedCheckpoint &&
    outcome.evidenceSha256 !==
      computeFoundryProviderCheckpointEvidenceSha256(outcome.verifiedCheckpoint)
  ) {
    return {
      valid: false,
      reasonCode: "verified_checkpoint_evidence_digest_mismatch",
    };
  }
  if (outcome.status === "uncertain") {
    if (outcome.providerLifecycle !== "unknown") {
      return { valid: false, reasonCode: "uncertain_lifecycle_must_be_unknown" };
    }
    const mayDiscoverReference =
      command.commandKind === "provider_submit" &&
      command.payload.providerCommandRef === null;
    return mayDiscoverReference ||
        outcome.providerCommandRef === command.payload.providerCommandRef
      ? { valid: true }
      : { valid: false, reasonCode: "uncertain_provider_reference_mismatch" };
  }

  switch (command.commandKind) {
    case "provider_submit":
      if (outcome.status === "succeeded") {
        return outcome.providerCommandRef !== null &&
          lifecycleIs(outcome.providerLifecycle, ["queued", "running"])
          ? { valid: true }
          : { valid: false, reasonCode: "submit_success_contract_invalid" };
      }
      return outcome.providerCommandRef === null &&
        outcome.providerLifecycle === "not_observed"
        ? { valid: true }
        : { valid: false, reasonCode: "submit_failure_contract_invalid" };

    case "provider_reconcile":
      if (outcome.status === "succeeded") {
        const conclusiveAbsence =
          outcome.providerLifecycle === "not_found" &&
          outcome.providerCommandRef === null;
        const observedResource =
          outcome.providerCommandRef !== null &&
          (command.payload.providerCommandRef === null ||
            outcome.providerCommandRef === command.payload.providerCommandRef) &&
          lifecycleIs(outcome.providerLifecycle, [
            "queued",
            "running",
            "exited",
            "terminated",
          ]);
        return conclusiveAbsence || observedResource
          ? { valid: true }
          : { valid: false, reasonCode: "reconcile_success_contract_invalid" };
      }
      return outcome.providerLifecycle === "not_observed" &&
          outcome.providerCommandRef === command.payload.providerCommandRef
        ? { valid: true }
        : { valid: false, reasonCode: "reconcile_failure_contract_invalid" };

    case "provider_poll": {
      const exactReference =
        outcome.providerCommandRef !== null &&
        outcome.providerCommandRef === command.payload.providerCommandRef;
      if (outcome.status === "succeeded") {
        return exactReference &&
          lifecycleIs(outcome.providerLifecycle, [
            "queued",
            "running",
            "exited",
            "terminated",
          ])
          ? { valid: true }
          : { valid: false, reasonCode: "observation_success_contract_invalid" };
      }
      return exactReference &&
        lifecycleIs(outcome.providerLifecycle, ["not_observed", "not_found"])
        ? { valid: true }
          : { valid: false, reasonCode: "observation_failure_contract_invalid" };
    }

    case "provider_checkpoint": {
      const exactReference =
        outcome.providerCommandRef !== null &&
        outcome.providerCommandRef === command.payload.providerCommandRef;
      if (outcome.status === "succeeded") {
        return exactReference &&
          lifecycleIs(outcome.providerLifecycle, [
            "running",
            "exited",
            "terminated",
          ])
          ? { valid: true }
          : { valid: false, reasonCode: "checkpoint_success_contract_invalid" };
      }
      return exactReference &&
        lifecycleIs(outcome.providerLifecycle, ["not_observed", "not_found"])
        ? { valid: true }
        : { valid: false, reasonCode: "checkpoint_failure_contract_invalid" };
    }

    case "provider_stop": {
      const exactReference =
        outcome.providerCommandRef !== null &&
        outcome.providerCommandRef === command.payload.providerCommandRef;
      if (outcome.status === "succeeded") {
        return exactReference &&
          lifecycleIs(outcome.providerLifecycle, [
            "exited",
            "terminated",
            "not_found",
          ])
          ? { valid: true }
          : { valid: false, reasonCode: "stop_success_contract_invalid" };
      }
      return exactReference &&
        lifecycleIs(outcome.providerLifecycle, ["not_observed", "not_found"])
        ? { valid: true }
        : { valid: false, reasonCode: "stop_failure_contract_invalid" };
    }
  }
}

const FoundryProviderCommandOutcomePayloadV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_PROVIDER_COMMAND_OUTCOME_V0),
    commandId: z.string().uuid(),
    executionId: z.string().uuid(),
    attemptId: z.string().uuid(),
    claimToken: z.string().uuid(),
    fencingToken: PositiveFenceSchema,
    status: z.enum(["succeeded", "failed", "uncertain"]),
    outcomeCode: ProviderOutcomeCodeSchema,
    providerLifecycle: FoundryNormalizedProviderLifecycleSchema,
    providerCommandRef: FoundryProviderCommandRefSchema.nullable(),
    evidenceSha256: RuntimeSha256Schema,
    completedBy: z
      .object({
        actorKind: z.enum(["service", "watchdog", "system"]),
        actorKey: FoundryCanonicalActorSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((outcome, ctx) => {
    if (
      outcome.status === "uncertain" &&
      outcome.providerLifecycle !== "unknown"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["providerLifecycle"],
        message: "an uncertain durable outcome must have unknown normalized lifecycle",
      });
    }
  });
export type FoundryProviderCommandOutcomePayloadV0 = z.infer<
  typeof FoundryProviderCommandOutcomePayloadV0Schema
>;

export interface FoundryProviderCommandAdapter {
  readonly providerKind: FoundryClaimedProviderCommandV0["providerKind"];
  readonly providerAdapterId: string;
  readonly providerAdapterVersion: string;
  readonly providerAdapterArtifactSha256: string;
  readonly providerDeploymentSha256: string;
  /** Exact bounded DB claim eligibility advertised before any row is locked. */
  readonly claimBindings: FoundryProviderAdapterClaimBindingsV0;
  /** Pure validation only: this must not perform I/O or mutate external state. */
  validateClaimedCommand(
    command: FoundryClaimedProviderCommandV0,
  ):
    | { readonly valid: true }
    | { readonly valid: false; readonly reasonCode: string };
  executeClaimedCommand(
    command: FoundryClaimedProviderCommandV0,
    signal: AbortSignal,
  ): Promise<FoundryProviderAdapterOutcomeV0>;
}

export interface FoundryProviderCommandExecutorStore {
  /** Must claim with DB time, a live fence, and the guarded 0053 trigger. */
  claimNextCommand(
    workerId: string,
    eligibleBindings: FoundryProviderAdapterClaimBindingsV0,
  ): Promise<FoundryClaimedProviderCommandV0 | null>;
  /**
   * Must atomically compare the exact subject, request, claim token, live lease,
   * and fence, then record irreversible invocation-start evidence. Submit must
   * additionally require current rights/confirmation/compute authority, a live
   * deadline, no kill, and cost headroom. Stop/reconcile/observation commands
   * must remain callable after revocation, expiry, kill, or a budget stop.
   */
  authorizeAndRecordInvocationStart(
    command: FoundryClaimedProviderCommandV0,
  ): Promise<
    | { readonly authorized: true }
    | { readonly authorized: false; readonly reasonCode: string }
  >;
  /** Completes a claim that was rejected before any provider call occurred. */
  completeBeforeInvocation(
    command: FoundryClaimedProviderCommandV0,
    outcome: FoundryProviderCommandOutcomePayloadV0,
    outcomeSha256: string,
  ): Promise<void>;
  /**
   * Must compare claim token + fence and append the matching ledger event.
   * A provider-submit completion failure may never cause a blind resubmit.
   */
  completeAfterInvocation(
    command: FoundryClaimedProviderCommandV0,
    outcome: FoundryProviderCommandOutcomePayloadV0,
    outcomeSha256: string,
    verifiedCheckpoint: FoundryVerifiedCheckpointEvidenceV0 | null,
    workerObservedAt: string,
  ): Promise<FoundryProviderCommandCompletionDisposition>;
  /**
   * Persists one conclusive adapter response before or after terminal command
   * completion. The observation and its optional terminal classification are
   * audit evidence only: neither may mutate authority or projections.
   */
  retainProviderResultObservation(
    command: FoundryClaimedProviderCommandV0,
    adapterOutcome: FoundryProviderAdapterOutcomeV0,
    adapterOutcomeSha256: string,
    workerObservedAt: string,
  ): Promise<FoundryProviderResultObservationDisposition>;
}

export type FoundryProviderCommandExecutorResult =
  | { readonly status: "idle" }
  | {
    readonly status: "completed";
      readonly commandId: string;
      readonly outcome: FoundryProviderCommandOutcomePayloadV0;
      readonly outcomeSha256: string;
      readonly completion: FoundryProviderCommandCompletionDisposition;
      readonly lateResultCustody: Promise<FoundryLateResultCustodyDisposition> | null;
    };

export class FoundryProviderCommandExecutorError extends Error {
  constructor(
    readonly code:
      | "INVALID_CLAIMED_COMMAND"
      | "ADAPTER_BINDING_MISSING"
      | "ADAPTER_BINDING_MISMATCH"
      | "ADAPTER_REQUEST_REJECTED"
      | "CLAIM_OWNER_MISMATCH"
      | "INVOCATION_START_REJECTED"
      | "COMMAND_COMPLETION_FAILED"
      | "PROVIDER_RESULT_CUSTODY_FAILED",
    message: string,
    options?: ErrorOptions,
    readonly lateResultCustody: Promise<FoundryLateResultCustodyDisposition> | null = null,
  ) {
    super(message, options);
    this.name = "FoundryProviderCommandExecutorError";
  }
}

function domainDigest(domain: string, value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(`${domain}\n${stableCanonicalJson(toCanonicalJson(value))}`, "utf8")
    .digest("hex")}`;
}

export function computeFoundryProviderCheckpointEvidenceSha256(
  input: unknown,
): string {
  const evidence = FoundryVerifiedCheckpointEvidenceV0Schema.parse(input);
  return domainDigest(FOUNDRY_PROVIDER_CHECKPOINT_EVIDENCE_V0, evidence);
}

function digestFoundryProviderCommandPayload(value: unknown): string {
  return domainDigest("omnitwin.foundry.provider-command-payload.v0", value);
}

function digestFoundryProviderRequest(value: unknown): string {
  return computeFoundryProviderRequestAuthorizationSha256(value);
}

export function computeFoundryProviderCommandPayloadSha256(
  input: unknown,
): string {
  const payload = ProviderCommandPayloadSchema.parse(input);
  return digestFoundryProviderCommandPayload(payload);
}

export function computeFoundryProviderRequestSha256(input: unknown): string {
  const request = FoundryProviderRequestAuthorizationV0Schema.parse(input);
  return digestFoundryProviderRequest(request);
}

export function computeFoundryProviderCommandOutcomeSha256(
  input: FoundryProviderCommandOutcomePayloadV0,
): string {
  const outcome = FoundryProviderCommandOutcomePayloadV0Schema.parse(input);
  return domainDigest(FOUNDRY_PROVIDER_COMMAND_OUTCOME_V0, outcome);
}

export function computeFoundryProviderAdapterOutcomeSha256(
  input: unknown,
): string {
  const outcome = FoundryProviderAdapterOutcomeV0Schema.parse(input);
  return domainDigest(FOUNDRY_PROVIDER_ADAPTER_OUTCOME_V0, outcome);
}

function claimAdapterKey(command: FoundryClaimedProviderCommandV0): string {
  return claimBindingKey({
    providerKind: command.providerKind,
    providerAdapterId: command.providerAdapterId,
    providerAdapterVersion: command.providerAdapterVersion,
    providerAdapterArtifactSha256: command.providerAdapterArtifactSha256,
    providerAdapterConfigurationSha256:
      command.providerAdapterConfigurationSha256,
    providerDeploymentSha256: command.providerDeploymentSha256,
    providerRequestProfileId: command.providerRequestProfileId,
    providerRequestProfileVersion: command.providerRequestProfileVersion,
    providerRequestProfileSha256: command.providerRequestProfileSha256,
    targetKind: command.payload.providerRequest.provider.target.targetKind,
    targetId: command.payload.providerRequest.provider.target.targetKind ===
        "local_worker"
      ? command.payload.providerRequest.provider.target.runnerProfileId
      : command.payload.providerRequest.provider.target.poolId,
  });
}

function adapterClaimBindings(
  adapters: readonly FoundryProviderCommandAdapter[],
): {
  readonly bindings: FoundryProviderAdapterClaimBindingsV0;
  readonly adapterByBinding: ReadonlyMap<string, FoundryProviderCommandAdapter>;
} {
  const entries: {
    readonly binding: FoundryProviderAdapterClaimBindingV0;
    readonly adapter: FoundryProviderCommandAdapter;
  }[] = [];
  for (const adapter of adapters) {
    const rawBindings = Array.isArray(adapter.claimBindings)
      ? adapter.claimBindings
      : [];
    for (const rawBinding of rawBindings) {
      const binding = FoundryProviderAdapterClaimBindingV0Schema.parse(rawBinding);
      if (
        binding.providerKind !== adapter.providerKind ||
        binding.providerAdapterId !== adapter.providerAdapterId ||
        binding.providerAdapterVersion !== adapter.providerAdapterVersion ||
        binding.providerAdapterArtifactSha256 !==
          adapter.providerAdapterArtifactSha256 ||
        binding.providerDeploymentSha256 !== adapter.providerDeploymentSha256
      ) {
        throw new FoundryProviderCommandExecutorError(
          "ADAPTER_BINDING_MISMATCH",
          "An adapter advertised a claim binding outside its immutable deployment identity.",
        );
      }
      entries.push({ binding, adapter });
    }
  }
  if (entries.length === 0) {
    throw new FoundryProviderCommandExecutorError(
      "ADAPTER_BINDING_MISSING",
      "At least one exact provider adapter claim binding is required before claiming work.",
    );
  }
  entries.sort((left, right) => {
    const leftKey = claimBindingKey(left.binding);
    const rightKey = claimBindingKey(right.binding);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  let previousKey: string | undefined;
  const adapterByBinding = new Map<string, FoundryProviderCommandAdapter>();
  for (const entry of entries) {
    const key = claimBindingKey(entry.binding);
    if (key === previousKey) {
      throw new FoundryProviderCommandExecutorError(
        "ADAPTER_BINDING_MISMATCH",
        "Provider adapter claim bindings must be globally unique and unambiguous.",
      );
    }
    previousKey = key;
    adapterByBinding.set(key, entry.adapter);
  }
  let bindings: FoundryProviderAdapterClaimBindingsV0;
  try {
    bindings = FoundryProviderAdapterClaimBindingsV0Schema.parse(
      entries.map((entry) => entry.binding),
    );
  } catch (error: unknown) {
    throw new FoundryProviderCommandExecutorError(
      entries.length > 1_000
        ? "ADAPTER_BINDING_MISMATCH"
        : "ADAPTER_BINDING_MISSING",
      "Provider adapter claim eligibility must be non-empty, bounded, unique, and canonically sorted.",
      { cause: error },
    );
  }
  return { bindings, adapterByBinding };
}

function outcomeFor(
  command: FoundryClaimedProviderCommandV0,
  workerId: string,
  adapterOutcome: FoundryProviderAdapterOutcomeV0,
): FoundryProviderCommandOutcomePayloadV0 {
  return FoundryProviderCommandOutcomePayloadV0Schema.parse({
    schemaVersion: FOUNDRY_PROVIDER_COMMAND_OUTCOME_V0,
    commandId: command.commandId,
    executionId: command.executionId,
    attemptId: command.attemptId,
    claimToken: command.claimToken,
    fencingToken: command.fencingToken,
    status: adapterOutcome.status,
    outcomeCode: adapterOutcome.outcomeCode,
    providerLifecycle: adapterOutcome.providerLifecycle,
    providerCommandRef: adapterOutcome.providerCommandRef,
    evidenceSha256: adapterOutcome.evidenceSha256,
    completedBy: {
      actorKind: "service",
      actorKey: workerId,
    },
  });
}

function internalEvidence(code: string, commandId: string): string {
  return domainDigest("omnitwin.foundry.provider-command-internal-evidence.v0", {
    code,
    commandId,
  });
}

export function computeFoundryProviderCommandInternalEvidenceSha256(
  code: string,
  commandId: string,
): string {
  const outcomeCode = ProviderOutcomeCodeSchema.parse(code);
  return internalEvidence(outcomeCode, z.string().uuid().parse(commandId));
}

function normalizeAdapterOutcomeForCommand(
  command: FoundryClaimedProviderCommandV0,
  input: unknown,
): FoundryProviderAdapterOutcomeV0 {
  const parsed = FoundryProviderAdapterOutcomeV0Schema.safeParse(input);
  if (!parsed.success) {
    const outcomeCode = "adapter_outcome_schema_unknown";
    return {
      status: "uncertain",
      outcomeCode,
      providerLifecycle: "unknown",
      providerCommandRef: command.payload.providerCommandRef,
      evidenceSha256: domainDigest(
        "omnitwin.foundry.provider-adapter-outcome-rejection.v0",
        {
          commandId: command.commandId,
          commandKind: command.commandKind,
          outcomeCode,
        },
      ),
    };
  }
  const contract = validateFoundryProviderOutcomeForCommand(
    command,
    parsed.data,
  );
  if (contract.valid) return parsed.data;
  const outcomeCode = "adapter_outcome_contract_unknown";
  return {
    status: "uncertain",
    outcomeCode,
    providerLifecycle: "unknown",
    providerCommandRef: command.payload.providerCommandRef,
    evidenceSha256: domainDigest(
      "omnitwin.foundry.provider-adapter-outcome-rejection.v0",
      {
        commandId: command.commandId,
        commandKind: command.commandKind,
        outcomeCode,
        reasonCode: contract.reasonCode,
        rejectedOutcome: parsed.data,
      },
    ),
  };
}

interface FoundryObservedAdapterOutcome {
  readonly outcome: FoundryProviderAdapterOutcomeV0;
  readonly workerObservedAt: string;
}

interface FoundryProviderInvocationResult {
  readonly selected: FoundryObservedAdapterOutcome;
  readonly lateConclusiveResult: Promise<FoundryObservedAdapterOutcome | null> | null;
}

function adapterExceptionOutcome(
  command: FoundryClaimedProviderCommandV0,
  code: "adapter_timeout_unknown" | "adapter_exception_unknown",
  errorName: string,
): FoundryProviderAdapterOutcomeV0 {
  return {
    status: "uncertain",
    outcomeCode: code,
    providerLifecycle: "unknown",
    providerCommandRef: command.payload.providerCommandRef,
    evidenceSha256: domainDigest(
      "omnitwin.foundry.provider-adapter-exception.v0",
      { code, commandId: command.commandId, errorName },
    ),
  };
}

async function invokeOnce(
  adapter: FoundryProviderCommandAdapter,
  command: FoundryClaimedProviderCommandV0,
): Promise<FoundryProviderInvocationResult> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const invocation = Promise.resolve()
    .then(() => adapter.executeClaimedCommand(command, controller.signal))
    .then(
      (outcome): FoundryProviderAdapterOutcomeV0 =>
        normalizeAdapterOutcomeForCommand(command, outcome),
      (error: unknown): FoundryProviderAdapterOutcomeV0 => {
        const code = controller.signal.aborted
          ? "adapter_timeout_unknown"
          : "adapter_exception_unknown";
        return adapterExceptionOutcome(
          command,
          code,
          error instanceof Error ? error.name : "unknown",
        );
      },
    )
    .then((outcome): FoundryObservedAdapterOutcome => ({
      outcome,
      workerObservedAt: new Date().toISOString(),
    }));
  const timeoutOutcome = new Promise<FoundryObservedAdapterOutcome>((resolve) => {
    timeout = setTimeout(() => {
      controller.abort(new Error("provider adapter call timed out"));
      resolve({
        outcome: adapterExceptionOutcome(
          command,
          "adapter_timeout_unknown",
          "AbortError",
        ),
        workerObservedAt: new Date().toISOString(),
      });
    }, command.payload.maximumApiCallSeconds * 1_000);
  });
  const winner = await Promise.race([
    invocation.then((observed) => ({ source: "adapter" as const, observed })),
    timeoutOutcome.then((observed) => ({ source: "timeout" as const, observed })),
  ]);
  if (timeout !== undefined) clearTimeout(timeout);
  if (winner.source === "adapter") {
    return { selected: winner.observed, lateConclusiveResult: null };
  }
  return {
    selected: winner.observed,
    lateConclusiveResult: invocation.then((observed) =>
      observed.outcome.status === "uncertain" ? null : observed
    ),
  };
}

const MAXIMUM_COMPLETION_ATTEMPTS = 2;
const MAXIMUM_RESULT_OBSERVATION_ATTEMPTS = 3;
const MAXIMUM_LATE_RESULT_OBSERVATION_ATTEMPTS = 72;
const RESULT_OBSERVATION_RETRY_BACKOFF_MS = 250;
const MAXIMUM_LATE_RESULT_OBSERVATION_RETRY_BACKOFF_MS = 5_000;
const LATE_RESULT_OBSERVATION_GRACE_MS = 30_000;
const RETRYABLE_RESULT_OBSERVATION_TRANSPORT_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "EPIPE",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "EAI_AGAIN",
]);

function isRetryableDatabaseErrorCode(code: string): boolean {
  return code.startsWith("08") ||
    code === "40001" ||
    code === "40003" ||
    code === "40P01" ||
    code === "57P01" ||
    code === "57P02" ||
    code === "57P03";
}

function isRetryableCompletionError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== "object" || current === null) return false;
    const candidate = current as {
      readonly code?: unknown;
      readonly cause?: unknown;
    };
    if (
      typeof candidate.code === "string" &&
      isRetryableDatabaseErrorCode(candidate.code)
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

/**
 * Observation writes are exact, append-only, and idempotent, so their bounded
 * retry policy may include explicit database-transport failures. Completion
 * deliberately keeps the narrower SQLSTATE-only policy above.
 */
function isRetryableProviderResultObservationError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== "object" || current === null) return false;
    const candidate = current as {
      readonly code?: unknown;
      readonly cause?: unknown;
    };
    if (
      (typeof candidate.code === "string" &&
        (isRetryableDatabaseErrorCode(candidate.code) ||
          RETRYABLE_RESULT_OBSERVATION_TRANSPORT_CODES.has(candidate.code))) ||
      candidate.code === 1006
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

async function completeAfterInvocationWithRetry(
  store: FoundryProviderCommandExecutorStore,
  command: FoundryClaimedProviderCommandV0,
  outcome: FoundryProviderCommandOutcomePayloadV0,
  outcomeSha256: string,
  verifiedCheckpoint: FoundryVerifiedCheckpointEvidenceV0 | null,
  workerObservedAt: string,
): Promise<FoundryProviderCommandCompletionDisposition> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAXIMUM_COMPLETION_ATTEMPTS; attempt += 1) {
    try {
      return await store.completeAfterInvocation(
        command,
        outcome,
        outcomeSha256,
        verifiedCheckpoint,
        workerObservedAt,
      );
    } catch (error: unknown) {
      lastError = error;
      if (!isRetryableCompletionError(error)) throw error;
    }
  }
  throw lastError;
}

async function persistProviderResultObservationWithRetry(
  store: FoundryProviderCommandExecutorStore,
  command: FoundryClaimedProviderCommandV0,
  observed: FoundryObservedAdapterOutcome,
  retryPolicy: "timely" | "late_horizon",
): Promise<FoundryProviderResultObservationDisposition> {
  const adapterOutcomeSha256 =
    computeFoundryProviderAdapterOutcomeSha256(observed.outcome);
  const maximumAttempts = retryPolicy === "late_horizon"
    ? MAXIMUM_LATE_RESULT_OBSERVATION_ATTEMPTS
    : MAXIMUM_RESULT_OBSERVATION_ATTEMPTS;
  // A genuinely late callback always receives a local grace window, while a
  // callback observed before lease expiry may retry through the durable lease
  // plus grace. Custody ends at the earlier of this fixed semantic deadline or
  // the bounded operational attempt cap; year-long leases are never retained
  // indefinitely in worker memory.
  const retryDeadlineMs = retryPolicy === "late_horizon"
    ? Math.max(Date.now(), Date.parse(command.claimExpiresAt)) +
      LATE_RESULT_OBSERVATION_GRACE_MS
    : null;
  let lastError: unknown;
  for (
    let attempt = 1;
    attempt <= maximumAttempts;
    attempt += 1
  ) {
    try {
      return await store.retainProviderResultObservation(
        command,
        observed.outcome,
        adapterOutcomeSha256,
        observed.workerObservedAt,
      );
    } catch (error: unknown) {
      lastError = error;
      if (!isRetryableProviderResultObservationError(error)) throw error;
      if (attempt === maximumAttempts) {
        if (retryPolicy === "late_horizon") {
          throw new Error(
            `Provider-result observation custody exhausted its hard ${String(MAXIMUM_LATE_RESULT_OBSERVATION_ATTEMPTS)}-attempt retry cap.`,
            { cause: error },
          );
        }
        throw error;
      }
      let delayMs = retryPolicy === "late_horizon"
        ? Math.min(
            RESULT_OBSERVATION_RETRY_BACKOFF_MS * (2 ** (attempt - 1)),
            MAXIMUM_LATE_RESULT_OBSERVATION_RETRY_BACKOFF_MS,
          )
        : RESULT_OBSERVATION_RETRY_BACKOFF_MS * attempt;
      if (retryDeadlineMs !== null) {
        const remainingMs = retryDeadlineMs - Date.now();
        if (remainingMs <= 0) {
          throw new Error(
            "Provider-result observation custody exhausted its lease/grace retry deadline.",
            { cause: error },
          );
        }
        delayMs = Math.min(delayMs, remainingMs);
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, delayMs);
      });
    }
  }
  throw lastError;
}

function observeProviderResultWithoutRejection(
  store: FoundryProviderCommandExecutorStore,
  command: FoundryClaimedProviderCommandV0,
  observedResult: Promise<FoundryObservedAdapterOutcome | null>,
  completionSettled: Promise<"succeeded" | "failed"> | null,
  retryPolicy: "timely" | "late_horizon",
): Promise<FoundryLateResultCustodyDisposition> {
  return observedResult.then(async (observed) => {
    if (observed === null) return { status: "not_conclusive" as const };
    const initial = await persistProviderResultObservationWithRetry(
      store,
      command,
      observed,
      retryPolicy,
    );
    if (initial.classification.status === "classified" || completionSettled === null) {
      return initial;
    }
    // The raw observation is already durable. Once completion settles, make
    // one opportunistic idempotent classification pass; a failed pass leaves
    // the held row for the bounded database-only recovery scanner.
    await completionSettled;
    try {
      return await persistProviderResultObservationWithRetry(
        store,
        command,
        observed,
        "timely",
      );
    } catch {
      return initial;
    }
  }).catch((error: unknown) => ({
    status: "failed" as const,
    errorName: error instanceof Error ? error.name : "unknown",
    message: error instanceof Error
      ? error.message.slice(0, 500)
      : "Provider-result observation failed with a non-Error value.",
  }));
}

export async function executeNextFoundryProviderCommand(
  store: FoundryProviderCommandExecutorStore,
  adapters: readonly FoundryProviderCommandAdapter[],
  workerIdInput: unknown,
): Promise<FoundryProviderCommandExecutorResult> {
  const workerId = FoundryCanonicalActorSchema.parse(workerIdInput);
  const eligible = adapterClaimBindings(adapters);
  const commandInput = await store.claimNextCommand(workerId, eligible.bindings);
  if (commandInput === null) return { status: "idle" };
  const commandResult = FoundryClaimedProviderCommandV0Schema.safeParse(commandInput);
  if (!commandResult.success) {
    throw new FoundryProviderCommandExecutorError(
      "INVALID_CLAIMED_COMMAND",
      "The durable store returned an invalid or tampered provider command claim.",
    );
  }
  const command = commandResult.data;
  if (command.claimedBy !== workerId) {
    throw new FoundryProviderCommandExecutorError(
      "CLAIM_OWNER_MISMATCH",
      "The durable command claim owner does not match the executing worker.",
    );
  }
  const exactKey = claimAdapterKey(command);
  const adapter = eligible.adapterByBinding.get(exactKey);
  if (adapter === undefined) {
    const code = "adapter_binding_missing";
    const outcome = outcomeFor(command, workerId, {
      status: "failed",
      outcomeCode: code,
      providerLifecycle: "not_observed",
      providerCommandRef: command.payload.providerCommandRef,
      evidenceSha256: internalEvidence(code, command.commandId),
    });
    const outcomeSha256 = computeFoundryProviderCommandOutcomeSha256(outcome);
    await store.completeBeforeInvocation(command, outcome, outcomeSha256);
    throw new FoundryProviderCommandExecutorError(
      "ADAPTER_BINDING_MISSING",
      "No single adapter matches the exact immutable provider deployment binding.",
    );
  }
  let validation:
    | { readonly valid: true }
    | { readonly valid: false; readonly reasonCode: string };
  try {
    validation = adapter.validateClaimedCommand(command);
  } catch (error: unknown) {
    validation = {
      valid: false,
      reasonCode: error instanceof z.ZodError
        ? "adapter_request_schema_rejected"
        : "adapter_request_validation_exception",
    };
  }
  if (!validation.valid) {
    const reasonCode = ProviderOutcomeCodeSchema.parse(validation.reasonCode);
    const outcome = outcomeFor(command, workerId, {
      status: "failed",
      outcomeCode: reasonCode,
      providerLifecycle: "not_observed",
      providerCommandRef: command.payload.providerCommandRef,
      evidenceSha256: internalEvidence(reasonCode, command.commandId),
    });
    const outcomeSha256 = computeFoundryProviderCommandOutcomeSha256(outcome);
    await store.completeBeforeInvocation(command, outcome, outcomeSha256);
    throw new FoundryProviderCommandExecutorError(
      "ADAPTER_REQUEST_REJECTED",
      `The exact adapter rejected the immutable provider request: ${reasonCode}.`,
    );
  }
  const authorization = await store.authorizeAndRecordInvocationStart(command);
  if (!authorization.authorized) {
    const outcome = outcomeFor(command, workerId, {
      status: "failed",
      outcomeCode: "invocation_authority_rejected",
      providerLifecycle: "not_observed",
      providerCommandRef: command.payload.providerCommandRef,
      evidenceSha256: internalEvidence(
        authorization.reasonCode,
        command.commandId,
      ),
    });
    const outcomeSha256 = computeFoundryProviderCommandOutcomeSha256(outcome);
    await store.completeBeforeInvocation(command, outcome, outcomeSha256);
    throw new FoundryProviderCommandExecutorError(
      "INVOCATION_START_REJECTED",
      `Database invocation authority rejected the claim: ${authorization.reasonCode}.`,
    );
  }
  const invocation = await invokeOnce(adapter, command);
  const adapterOutcome = invocation.selected.outcome;
  const outcome = outcomeFor(command, workerId, adapterOutcome);
  const outcomeSha256 = computeFoundryProviderCommandOutcomeSha256(outcome);
  let settleCompletion: ((status: "succeeded" | "failed") => void) | undefined;
  const completionSettled = new Promise<"succeeded" | "failed">((resolve) => {
    settleCompletion = resolve;
  });
  const timeoutLoserCustody = invocation.lateConclusiveResult === null
    ? null
    : observeProviderResultWithoutRejection(
        store,
        command,
        invocation.lateConclusiveResult,
        completionSettled,
        "late_horizon",
      );
  const selectedConclusiveCustody = adapterOutcome.status === "uncertain"
    ? null
    : observeProviderResultWithoutRejection(
        store,
        command,
        Promise.resolve(invocation.selected),
        null,
        "timely",
      );
  // Persist a timely conclusive response in its own committed transaction
  // before attempting terminal completion. If this write fails, completion is
  // still attempted because an exact successful completion is authoritative.
  const initialSelectedCustody = selectedConclusiveCustody === null
    ? null
    : await selectedConclusiveCustody;
  const supervisedResultCustody = timeoutLoserCustody ?? selectedConclusiveCustody;
  let completionFailed = true;
  let completion: FoundryProviderCommandCompletionDisposition;
  try {
    completion = await completeAfterInvocationWithRetry(
      store,
      command,
      outcome,
      outcomeSha256,
      adapterOutcome.verifiedCheckpoint ?? null,
      invocation.selected.workerObservedAt,
    );
    completionFailed = false;
  } catch (error: unknown) {
    const custodyAlsoFailed =
      adapterOutcome.status !== "uncertain" &&
      initialSelectedCustody?.status === "failed";
    const failureCustody = custodyAlsoFailed
      ? observeProviderResultWithoutRejection(
          store,
          command,
          Promise.resolve(invocation.selected),
          null,
          "late_horizon",
        )
      : supervisedResultCustody;
    throw new FoundryProviderCommandExecutorError(
      custodyAlsoFailed
        ? "PROVIDER_RESULT_CUSTODY_FAILED"
        : "COMMAND_COMPLETION_FAILED",
      custodyAlsoFailed
        ? "Provider command ran, but neither its conclusive result observation nor terminal completion became durable."
        : "Provider command ran, but durable completion failed; its result observation remains evidence for reconciliation and the command must never be blindly resubmitted.",
      { cause: error },
      failureCustody,
    );
  } finally {
    settleCompletion?.(completionFailed ? "failed" : "succeeded");
  }
  const selectedPostCompletionCustody = adapterOutcome.status === "uncertain"
    ? null
    : observeProviderResultWithoutRejection(
        store,
        command,
        Promise.resolve(invocation.selected),
        null,
        "timely",
      );
  return {
    status: "completed",
    commandId: command.commandId,
    outcome,
    outcomeSha256,
    completion,
    lateResultCustody: timeoutLoserCustody ?? selectedPostCompletionCustody,
  };
}
