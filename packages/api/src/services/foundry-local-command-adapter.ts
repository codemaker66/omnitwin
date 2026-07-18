import { createHash } from "node:crypto";
import {
  FoundryProviderAdapterVersionSchema,
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
  FoundryClaimedProviderCommandV0Schema,
  FoundryProviderAdapterClaimBindingsV0Schema,
  FoundryVerifiedCheckpointEvidenceV0Schema,
  computeFoundryProviderCheckpointEvidenceSha256,
  computeFoundryProviderRequestSha256,
  type FoundryClaimedProviderCommandV0,
  type FoundryProviderAdapterOutcomeV0,
  type FoundryProviderCommandAdapter,
} from "./foundry-provider-command-executor.js";
import {
  FoundryProviderActionV0Schema,
  FoundryProviderAuthorizedStageV0Schema,
  FoundryProviderCommandRefSchema,
  FoundryProviderResourceLimitV0Schema,
  FoundryProviderResourceRequestV0Schema,
  FoundryProviderRequestAuthorizationV0Schema,
  FoundryProviderRuntimeBindingV0Schema,
  type FoundryProviderRequestAuthorizationV0,
} from "./foundry-provider-request-authorization.js";

export const FOUNDRY_LOCAL_SANDBOX_ADAPTER_ID = "local-sandbox";
export const FOUNDRY_LOCAL_SANDBOX_ADAPTER_VERSION = "1.0.0";
export const FOUNDRY_LOCAL_SANDBOX_EXECUTION_REQUEST_V0 =
  "omnitwin.foundry.local-sandbox-execution-request.v0";
export const FOUNDRY_LOCAL_SANDBOX_RESOURCE_MARKER_V0 =
  "omnitwin.foundry.local-sandbox-resource-marker.v0";
export const FOUNDRY_LOCAL_SANDBOX_ENFORCEMENT_RECEIPT_V0 =
  "omnitwin.foundry.local-sandbox-enforcement-receipt.v0";
export const FOUNDRY_LOCAL_SANDBOX_ADAPTER_CONFIGURATION_V0 =
  "omnitwin.foundry.local-sandbox.adapter-configuration.v0";

type FoundryLocalProviderKind = "local_cpu" | "local_cuda";

export type FoundryDeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer U)[]
    ? readonly FoundryDeepReadonly<U>[]
    : T extends object
      ? { readonly [K in keyof T]: FoundryDeepReadonly<T[K]> }
      : T;

const LocalProviderKindSchema = z.enum(["local_cpu", "local_cuda"]);

const LocalTerminalEnforcementBindingSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("required"),
      policySha256: RuntimeSha256Schema,
      securityProfileSha256: RuntimeSha256Schema,
    })
    .strict(),
  z.object({ mode: z.literal("not_supported") }).strict(),
]);

export const FoundryLocalSandboxAdapterConfigurationV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_LOCAL_SANDBOX_ADAPTER_CONFIGURATION_V0),
    runnerProfileId: RuntimeManifestKeySchema,
    terminalEnforcement: LocalTerminalEnforcementBindingSchema,
  })
  .strict();
export type FoundryLocalSandboxAdapterConfigurationV0 = z.infer<
  typeof FoundryLocalSandboxAdapterConfigurationV0Schema
>;

const LocalAdapterBindingSchema = z
  .object({
    providerAdapterConfigurationSha256: RuntimeSha256Schema,
    providerRequestProfileId: RuntimeManifestKeySchema,
    providerRequestProfileVersion: RuntimeManifestKeySchema,
    providerRequestProfileSha256: RuntimeSha256Schema,
    runnerProfileId: RuntimeManifestKeySchema,
    terminalEnforcement: LocalTerminalEnforcementBindingSchema,
  })
  .strict()
  .superRefine((binding, ctx) => {
    const configuration = {
      schemaVersion: FOUNDRY_LOCAL_SANDBOX_ADAPTER_CONFIGURATION_V0,
      runnerProfileId: binding.runnerProfileId,
      terminalEnforcement: binding.terminalEnforcement,
    };
    if (
      computeFoundryLocalSandboxAdapterConfigurationSha256(configuration) !==
        binding.providerAdapterConfigurationSha256
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["providerAdapterConfigurationSha256"],
        message:
          "local runner and terminal enforcement must match the durable adapter configuration digest",
      });
    }
  });

export type FoundryLocalSandboxAdapterBinding = z.infer<
  typeof LocalAdapterBindingSchema
>;

const DurableResourceMarkerContentSchema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_LOCAL_SANDBOX_RESOURCE_MARKER_V0),
    providerKind: LocalProviderKindSchema,
    executionSubjectSha256: RuntimeSha256Schema,
    providerIdempotencyKey: RuntimeManifestKeySchema,
  })
  .strict();

export type FoundryLocalSandboxDurableResourceMarkerContent = z.infer<
  typeof DurableResourceMarkerContentSchema
>;

function domainDigest(domain: string, value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(`${domain}\n${stableCanonicalJson(toCanonicalJson(value))}`, "utf8")
    .digest("hex")}`;
}

export function computeFoundryLocalSandboxAdapterConfigurationSha256(
  input: unknown,
): string {
  const configuration =
    FoundryLocalSandboxAdapterConfigurationV0Schema.parse(input);
  return domainDigest(
    FOUNDRY_LOCAL_SANDBOX_ADAPTER_CONFIGURATION_V0,
    configuration,
  );
}

export function computeFoundryLocalSandboxResourceMarkerSha256(
  input: unknown,
): string {
  const marker = DurableResourceMarkerContentSchema.parse(input);
  return domainDigest(FOUNDRY_LOCAL_SANDBOX_RESOURCE_MARKER_V0, marker);
}

const DurableResourceMarkerSchema = DurableResourceMarkerContentSchema.extend({
  markerSha256: RuntimeSha256Schema,
}).superRefine((marker, ctx) => {
  const content: FoundryLocalSandboxDurableResourceMarkerContent = {
    schemaVersion: marker.schemaVersion,
    providerKind: marker.providerKind,
    executionSubjectSha256: marker.executionSubjectSha256,
    providerIdempotencyKey: marker.providerIdempotencyKey,
  };
  if (
    marker.markerSha256 !==
      computeFoundryLocalSandboxResourceMarkerSha256(content)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["markerSha256"],
      message: "local sandbox resource marker digest mismatch",
    });
  }
});

export type FoundryLocalSandboxDurableResourceMarker = z.infer<
  typeof DurableResourceMarkerSchema
>;

type AuthorizedStage = FoundryProviderRequestAuthorizationV0["stages"][number];

const LocalSandboxRequestCommandSchema = z
  .object({
    commandKind: z.enum([
      "provider_submit",
      "provider_reconcile",
      "provider_poll",
      "provider_checkpoint",
      "provider_stop",
    ]),
    commandId: z.string().uuid(),
    commandSequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    claimToken: z.string().uuid(),
    fencingToken: z.string().regex(/^[1-9][0-9]*$/u),
    providerCommandRef: FoundryProviderCommandRefSchema.nullable(),
    action: FoundryProviderActionV0Schema,
  })
  .strict();

const LocalSandboxNetworkPolicySchema = z
  .object({
    enforcement: z.literal("per_stage_exact"),
    stages: z.array(
      z
        .object({
          stageId: RuntimeManifestKeySchema,
          networkAccess: z.enum(["none", "object_storage_only", "restricted"]),
        })
        .strict(),
    ).min(1).max(1_000),
  })
  .strict();

const LocalSandboxResourcePolicySchema = z
  .object({
    enforcement: z.literal("hard_limits"),
    stages: z.array(
      z
        .object({
          stageId: RuntimeManifestKeySchema,
          requested: FoundryProviderResourceRequestV0Schema,
          limit: FoundryProviderResourceLimitV0Schema,
        })
        .strict(),
    ).min(1).max(1_000),
  })
  .strict();

function canonicalValuesEqual(left: unknown, right: unknown): boolean {
  return stableCanonicalJson(toCanonicalJson(left)) ===
    stableCanonicalJson(toCanonicalJson(right));
}

function addRequestBindingIssue(
  ctx: z.RefinementCtx,
  path: readonly (string | number)[],
  message: string,
): void {
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: [...path],
    message,
  });
}

/**
 * Independently validates the exact credential-free request handed to a local
 * sandbox backend. The backend must parse this schema again at its trust
 * boundary; TypeScript readonly annotations are not a runtime authority.
 */
export const FoundryLocalSandboxExecutionRequestV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_LOCAL_SANDBOX_EXECUTION_REQUEST_V0),
    providerKind: LocalProviderKindSchema,
    command: LocalSandboxRequestCommandSchema,
    authorizationSha256: RuntimeSha256Schema,
    authorization: FoundryProviderRequestAuthorizationV0Schema,
    durableResourceMarker: DurableResourceMarkerSchema,
    sandbox: z
      .object({
        runnerProfileId: RuntimeManifestKeySchema,
        imagePolicy: z.literal("pinned_digest_only"),
        terminalEnforcement: LocalTerminalEnforcementBindingSchema,
        stagedInputs: z
          .object({
            mountMode: z.literal("read_only"),
            intakeStagingIndexSha256: RuntimeSha256Schema,
            reviewedIngestManifestSha256: RuntimeSha256Schema,
            assetIds: z.array(RuntimeManifestKeySchema).min(1).max(100_000),
          })
          .strict(),
        output: z
          .object({
            writeMode: z.literal("isolated_exact_attempt_prefix"),
            authorizedPrefix: z.string().min(1).max(1_024),
            isolatedPrefix: z.string().min(1).max(1_024),
          })
          .strict(),
        stageDag: z
          .array(FoundryProviderAuthorizedStageV0Schema)
          .min(1)
          .max(1_000),
        networkPolicy: LocalSandboxNetworkPolicySchema,
        resourcePolicy: LocalSandboxResourcePolicySchema,
        deadlines: FoundryProviderRuntimeBindingV0Schema.extend({
          claimExpiresAt: FoundryUtcInstantSchema,
        }).strict(),
      })
      .strict(),
  })
  .strict()
  .superRefine((request, ctx) => {
    const authorization = request.authorization;
    const expectedMarker = markerFor(request.providerKind, authorization);
    const expectedAssetIds = [...new Set(
      authorization.stages.flatMap((stage) => stage.inputAssetIds),
    )].sort();
    const expectedNetworkStages = authorization.stages.map((stage) => ({
      stageId: stage.stageId,
      networkAccess: stage.networkAccess,
    }));
    const expectedResourceStages = authorization.stages.map((stage) => ({
      stageId: stage.stageId,
      requested: stage.requestedResources,
      limit: stage.authorizedCapacity,
    }));
    const actionReference = authorization.action.providerCommandRef;
    const claimExpiresAt = request.sandbox.deadlines.claimExpiresAt;

    if (
      request.authorizationSha256 !==
        computeFoundryProviderRequestSha256(authorization)
    ) {
      addRequestBindingIssue(
        ctx,
        ["authorizationSha256"],
        "local sandbox authorization digest must match the exact authorization",
      );
    }
    if (
      request.providerKind !== authorization.provider.providerKind ||
      authorization.provider.target.targetKind !== "local_worker"
    ) {
      addRequestBindingIssue(
        ctx,
        ["providerKind"],
        "local sandbox provider and target must match the local authorization",
      );
    }
    if (
      request.command.commandKind !== authorization.commandKind ||
      request.command.commandId !== authorization.commandId ||
      request.command.commandSequence !== authorization.commandSequence ||
      request.command.fencingToken !==
        authorization.execution.fencingToken.toString() ||
      request.command.providerCommandRef !== actionReference ||
      !canonicalValuesEqual(request.command.action, authorization.action)
    ) {
      addRequestBindingIssue(
        ctx,
        ["command"],
        "local sandbox command must match the exact authorized action",
      );
    }
    if (!exactMarkerMatch(request.durableResourceMarker, expectedMarker)) {
      addRequestBindingIssue(
        ctx,
        ["durableResourceMarker"],
        "local sandbox durable marker must match the authorized resource identity",
      );
    }
    if (
      authorization.provider.target.targetKind !== "local_worker" ||
      request.sandbox.runnerProfileId !==
        authorization.provider.target.runnerProfileId
    ) {
      addRequestBindingIssue(
        ctx,
        ["sandbox", "runnerProfileId"],
        "local sandbox runner must match the authorized local target",
      );
    }
    const adapterConfiguration = {
      schemaVersion: FOUNDRY_LOCAL_SANDBOX_ADAPTER_CONFIGURATION_V0,
      runnerProfileId: request.sandbox.runnerProfileId,
      terminalEnforcement: request.sandbox.terminalEnforcement,
    };
    if (
      computeFoundryLocalSandboxAdapterConfigurationSha256(
        adapterConfiguration,
      ) !== authorization.provider.providerAdapterConfigurationSha256
    ) {
      addRequestBindingIssue(
        ctx,
        ["sandbox", "terminalEnforcement"],
        "local sandbox runner and terminal enforcement must match the authorized adapter configuration digest",
      );
    }
    if (
      request.sandbox.stagedInputs.intakeStagingIndexSha256 !==
        authorization.evidence.intakeStagingIndexSha256 ||
      request.sandbox.stagedInputs.reviewedIngestManifestSha256 !==
        authorization.evidence.reviewedIngestManifestSha256 ||
      !canonicalValuesEqual(
        request.sandbox.stagedInputs.assetIds,
        expectedAssetIds,
      )
    ) {
      addRequestBindingIssue(
        ctx,
        ["sandbox", "stagedInputs"],
        "local sandbox staged inputs must equal the authorization lineage",
      );
    }
    if (
      request.sandbox.output.authorizedPrefix !==
        authorization.storage.outputPrefix ||
      request.sandbox.output.isolatedPrefix !==
        `${authorization.storage.outputPrefix}/.foundry-sandbox/${expectedMarker.markerSha256.slice(7)}`
    ) {
      addRequestBindingIssue(
        ctx,
        ["sandbox", "output"],
        "local sandbox output must use the exact marker-isolated prefix",
      );
    }
    if (!canonicalValuesEqual(request.sandbox.stageDag, authorization.stages)) {
      addRequestBindingIssue(
        ctx,
        ["sandbox", "stageDag"],
        "local sandbox DAG must equal the exact authorized stages",
      );
    }
    if (
      !canonicalValuesEqual(
        request.sandbox.networkPolicy.stages,
        expectedNetworkStages,
      )
    ) {
      addRequestBindingIssue(
        ctx,
        ["sandbox", "networkPolicy"],
        "local sandbox network policy must preserve every authorized stage mode",
      );
    }
    if (
      !canonicalValuesEqual(
        request.sandbox.resourcePolicy.stages,
        expectedResourceStages,
      )
    ) {
      addRequestBindingIssue(
        ctx,
        ["sandbox", "resourcePolicy"],
        "local sandbox resource policy must preserve every authorized hard limit",
      );
    }
    if (
      typeof claimExpiresAt !== "string" ||
      !canonicalValuesEqual(request.sandbox.deadlines, {
        ...authorization.runtime,
        claimExpiresAt,
      })
    ) {
      addRequestBindingIssue(
        ctx,
        ["sandbox", "deadlines"],
        "local sandbox deadlines must preserve the authorization and claim boundary",
      );
    }
  });

/**
 * Complete credential-free request passed to a local sandbox backend. Deriving
 * this readonly type from the runtime schema prevents compile-time and trust-
 * boundary validation from drifting apart.
 */
export type FoundryLocalSandboxExecutionRequestV0 = FoundryDeepReadonly<
  z.infer<typeof FoundryLocalSandboxExecutionRequestV0Schema>
>;

const BackendReasonCodeSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._:-]{0,63}$/u);

const ObservedLifecycleSchema = z.enum([
  "queued",
  "running",
  "exited",
  "terminated",
]);

const LocalSandboxProviderCommandRefSchema =
  FoundryProviderCommandRefSchema.refine(
    (value) => value.startsWith("local-sandbox:"),
    "local sandbox references must use the local-sandbox namespace",
  );

const EnforcementReceiptPayloadSchema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_LOCAL_SANDBOX_ENFORCEMENT_RECEIPT_V0),
    instanceSpecSha256: RuntimeSha256Schema,
    policySha256: RuntimeSha256Schema,
    markerSha256: RuntimeSha256Schema,
    providerCommandRef: LocalSandboxProviderCommandRefSchema,
    engineIdentitySha256: RuntimeSha256Schema,
    containerIdentitySha256: RuntimeSha256Schema,
    securityProfileSha256: RuntimeSha256Schema,
    inputVolumeReceiptSha256: RuntimeSha256Schema,
    outputVolumeReceiptSha256: RuntimeSha256Schema,
    exitCode: z.number().int(),
    oomKilled: z.boolean(),
    deadlineExceeded: z.boolean(),
    terminationIntent: z.enum(["none", "deadline", "operator_stop"]),
    containerInitPidZero: z.literal(true),
    processTreeEvidence: z.literal("docker_inspect_stopped_init_only"),
    outputVerified: z.boolean(),
    containerFinishedAt: FoundryUtcInstantSchema,
  })
  .strict();

export function computeFoundryLocalSandboxEnforcementReceiptSha256(
  input: unknown,
): string {
  return domainDigest(
    FOUNDRY_LOCAL_SANDBOX_ENFORCEMENT_RECEIPT_V0,
    EnforcementReceiptPayloadSchema.parse(input),
  );
}

export const FoundryLocalSandboxEnforcementReceiptV0Schema =
  EnforcementReceiptPayloadSchema.extend({
    receiptSha256: RuntimeSha256Schema,
  })
    .strict()
    .superRefine((receipt, ctx) => {
      const { receiptSha256: _receiptSha256, ...payload } = receipt;
      if (
        receipt.deadlineExceeded !==
          (receipt.terminationIntent === "deadline")
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["deadlineExceeded"],
          message: "deadline flag must match the durable termination reason",
        });
      }
      if (
        receipt.receiptSha256 !==
          computeFoundryLocalSandboxEnforcementReceiptSha256(payload)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["receiptSha256"],
          message: "local sandbox enforcement receipt digest mismatch",
        });
      }
    });
export type FoundryLocalSandboxEnforcementReceiptV0 = z.infer<
  typeof FoundryLocalSandboxEnforcementReceiptV0Schema
>;

const BackendResultIdentitySchema = z.object({
  providerKind: LocalProviderKindSchema,
  durableResourceMarker: DurableResourceMarkerSchema,
});

const FoundryLocalSandboxBackendResultSchema = z.discriminatedUnion("kind", [
  BackendResultIdentitySchema.extend({
    kind: z.literal("observed"),
    providerCommandRef: LocalSandboxProviderCommandRefSchema,
    lifecycle: ObservedLifecycleSchema,
    verifiedCheckpoint: FoundryVerifiedCheckpointEvidenceV0Schema.optional(),
    enforcementReceipt: FoundryLocalSandboxEnforcementReceiptV0Schema.optional(),
  }).strict(),
  BackendResultIdentitySchema.extend({
    kind: z.literal("not_found"),
  }).strict(),
  BackendResultIdentitySchema.extend({
    kind: z.literal("rejected"),
    reasonCode: BackendReasonCodeSchema,
  }).strict(),
  BackendResultIdentitySchema.extend({
    kind: z.literal("unknown"),
    reasonCode: BackendReasonCodeSchema,
    providerCommandRef: LocalSandboxProviderCommandRefSchema.nullable(),
  }).strict(),
]);

export type FoundryLocalSandboxBackendResult = z.infer<
  typeof FoundryLocalSandboxBackendResultSchema
>;

/**
 * Side-effect boundary for a reviewed local process/container sandbox.
 *
 * `submitExact` must atomically reserve `durableResourceMarker` before launch
 * and return the same sandbox for retries of that marker. The remaining
 * methods must never create a sandbox: reconciliation is marker-only lookup,
 * while poll/checkpoint/stop operate on the exact command reference. Every
 * result must echo the marker, allowing the adapter to reject cross-attempt or
 * cross-provider observations. Implementations also own enforcement of the
 * frozen mount, output namespace, network, resource and deadline contract.
 */
export interface FoundryLocalSandboxBackend {
  readonly submitExact: (
    request: FoundryDeepReadonly<FoundryLocalSandboxExecutionRequestV0>,
    signal: AbortSignal,
  ) => Promise<unknown>;
  readonly reconcileExact: (
    request: FoundryDeepReadonly<FoundryLocalSandboxExecutionRequestV0>,
    signal: AbortSignal,
  ) => Promise<unknown>;
  readonly pollExact: (
    request: FoundryDeepReadonly<FoundryLocalSandboxExecutionRequestV0>,
    signal: AbortSignal,
  ) => Promise<unknown>;
  readonly checkpointExact: (
    request: FoundryDeepReadonly<FoundryLocalSandboxExecutionRequestV0>,
    signal: AbortSignal,
  ) => Promise<unknown>;
  readonly stopExact: (
    request: FoundryDeepReadonly<FoundryLocalSandboxExecutionRequestV0>,
    signal: AbortSignal,
  ) => Promise<unknown>;
}

export interface FoundryLocalSandboxAdapterOptions {
  readonly providerAdapterArtifactSha256: string;
  readonly providerDeploymentSha256: string;
  readonly binding: FoundryLocalSandboxAdapterBinding;
  readonly backend: FoundryLocalSandboxBackend;
  /** Trusted local clock; injectable only to make expiry behavior testable. */
  readonly now?: () => Date;
}

function deepFreezeJson<T>(value: T): FoundryDeepReadonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreezeJson(child);
    }
    Object.freeze(value);
  }
  return value as FoundryDeepReadonly<T>;
}

function markerFor(
  providerKind: FoundryLocalProviderKind,
  authorization: FoundryProviderRequestAuthorizationV0,
): FoundryLocalSandboxDurableResourceMarker {
  const content: FoundryLocalSandboxDurableResourceMarkerContent = {
    schemaVersion: FOUNDRY_LOCAL_SANDBOX_RESOURCE_MARKER_V0,
    providerKind,
    executionSubjectSha256:
      authorization.requestIdentity.resourceMarker.executionSubjectSha256,
    providerIdempotencyKey:
      authorization.requestIdentity.resourceMarker.providerIdempotencyKey,
  };
  return DurableResourceMarkerSchema.parse({
    ...content,
    markerSha256: computeFoundryLocalSandboxResourceMarkerSha256(content),
  });
}

function exactMarkerMatch(
  left: FoundryLocalSandboxDurableResourceMarker,
  right: FoundryLocalSandboxDurableResourceMarker,
): boolean {
  return left.providerKind === right.providerKind &&
    left.executionSubjectSha256 === right.executionSubjectSha256 &&
    left.providerIdempotencyKey === right.providerIdempotencyKey &&
    left.markerSha256 === right.markerSha256;
}

function resourcesFit(stage: AuthorizedStage): boolean {
  const requested = stage.requestedResources;
  const limit = stage.authorizedCapacity;
  return requested.cpuCores <= limit.cpuCores &&
    requested.ramGiB <= limit.ramGiB &&
    requested.gpuCount <= limit.gpuCount &&
    requested.minimumGpuVramGiB <= limit.perGpuVramGiB &&
    requested.scratchGiB <= limit.scratchGiB;
}

function validateLocalBinding(
  command: FoundryClaimedProviderCommandV0,
  providerKind: FoundryLocalProviderKind,
  providerAdapterVersion: string,
  providerAdapterArtifactSha256: string,
  providerDeploymentSha256: string,
  binding: FoundryLocalSandboxAdapterBinding,
): { readonly valid: true } | { readonly valid: false; readonly reasonCode: string } {
  const authorization = command.payload.providerRequest;
  if (
    command.providerKind !== providerKind ||
    command.providerAdapterId !== FOUNDRY_LOCAL_SANDBOX_ADAPTER_ID ||
    command.providerAdapterVersion !== providerAdapterVersion ||
    command.providerAdapterArtifactSha256 !== providerAdapterArtifactSha256 ||
    command.providerDeploymentSha256 !== providerDeploymentSha256
  ) {
    return { valid: false, reasonCode: "local_adapter_binding_mismatch" };
  }
  if (
    authorization.provider.providerKind !== providerKind ||
    authorization.provider.providerAdapterId !==
      FOUNDRY_LOCAL_SANDBOX_ADAPTER_ID ||
    authorization.provider.providerAdapterVersion !== providerAdapterVersion ||
    authorization.provider.providerAdapterArtifactSha256 !==
      providerAdapterArtifactSha256 ||
    authorization.provider.providerDeploymentSha256 !==
      providerDeploymentSha256 ||
    authorization.provider.providerAdapterConfigurationSha256 !==
      binding.providerAdapterConfigurationSha256 ||
    authorization.provider.providerRequestProfileId !==
      binding.providerRequestProfileId ||
    authorization.provider.providerRequestProfileVersion !==
      binding.providerRequestProfileVersion ||
    authorization.provider.providerRequestProfileSha256 !==
      binding.providerRequestProfileSha256 ||
    authorization.provider.target.targetKind !== "local_worker" ||
    authorization.provider.target.runnerProfileId !== binding.runnerProfileId
  ) {
    return { valid: false, reasonCode: "local_request_binding_mismatch" };
  }
  if (
    command.payload.providerCommandRef !== null &&
    !command.payload.providerCommandRef.startsWith("local-sandbox:")
  ) {
    return {
      valid: false,
      reasonCode: "local_command_ref_namespace_mismatch",
    };
  }
  if (authorization.stages.some((stage) => !resourcesFit(stage))) {
    return { valid: false, reasonCode: "local_resource_limit_exceeded" };
  }
  if (
    providerKind === "local_cpu" &&
    authorization.stages.some(
      (stage) =>
        stage.requestedResources.gpuCount !== 0 ||
        stage.requestedResources.minimumGpuVramGiB !== 0 ||
        stage.authorizedCapacity.gpuCount !== 0 ||
        stage.authorizedCapacity.perGpuVramGiB !== 0,
    )
  ) {
    return { valid: false, reasonCode: "local_cpu_gpu_resource_rejected" };
  }
  return { valid: true };
}

function buildBackendRequest(
  command: FoundryClaimedProviderCommandV0,
  providerKind: FoundryLocalProviderKind,
  binding: FoundryLocalSandboxAdapterBinding,
): FoundryDeepReadonly<FoundryLocalSandboxExecutionRequestV0> {
  const authorization = command.payload.providerRequest;
  const marker = markerFor(providerKind, authorization);
  const assetIds = [...new Set(
    authorization.stages.flatMap((stage) => stage.inputAssetIds),
  )].sort();
  const request: FoundryLocalSandboxExecutionRequestV0 = {
    schemaVersion: FOUNDRY_LOCAL_SANDBOX_EXECUTION_REQUEST_V0,
    providerKind,
    command: {
      commandKind: command.commandKind,
      commandId: command.commandId,
      commandSequence: command.commandSequence,
      claimToken: command.claimToken,
      fencingToken: command.fencingToken,
      providerCommandRef: command.payload.providerCommandRef,
      action: authorization.action,
    },
    authorizationSha256: command.payload.providerRequestSha256,
    authorization,
    durableResourceMarker: marker,
    sandbox: {
      runnerProfileId: binding.runnerProfileId,
      imagePolicy: "pinned_digest_only",
      terminalEnforcement: binding.terminalEnforcement,
      stagedInputs: {
        mountMode: "read_only",
        intakeStagingIndexSha256:
          authorization.evidence.intakeStagingIndexSha256,
        reviewedIngestManifestSha256:
          authorization.evidence.reviewedIngestManifestSha256,
        assetIds,
      },
      output: {
        writeMode: "isolated_exact_attempt_prefix",
        authorizedPrefix: authorization.storage.outputPrefix,
        isolatedPrefix: `${authorization.storage.outputPrefix}/.foundry-sandbox/${marker.markerSha256.slice(7)}`,
      },
      stageDag: authorization.stages,
      networkPolicy: {
        enforcement: "per_stage_exact",
        stages: authorization.stages.map((stage) => ({
          stageId: stage.stageId,
          networkAccess: stage.networkAccess,
        })),
      },
      resourcePolicy: {
        enforcement: "hard_limits",
        stages: authorization.stages.map((stage) => ({
          stageId: stage.stageId,
          requested: stage.requestedResources,
          limit: stage.authorizedCapacity,
        })),
      },
      deadlines: {
        ...authorization.runtime,
        claimExpiresAt: command.claimExpiresAt,
      },
    },
  };
  return deepFreezeJson(
    FoundryLocalSandboxExecutionRequestV0Schema.parse(request),
  );
}

function internalEvidence(
  command: FoundryClaimedProviderCommandV0,
  outcomeCode: string,
  phase: string,
  detail?: unknown,
): string {
  return domainDigest("omnitwin.foundry.local-sandbox-adapter-evidence.v0", {
    commandId: command.commandId,
    commandKind: command.commandKind,
    executionSubjectSha256: command.payload.executionSubjectSha256,
    outcomeCode,
    phase,
    ...(detail === undefined ? {} : { detail }),
  });
}

function failedBeforeBackend(
  command: FoundryClaimedProviderCommandV0,
  outcomeCode: string,
  phase: string,
): FoundryProviderAdapterOutcomeV0 {
  return {
    status: "failed",
    outcomeCode,
    providerLifecycle: "not_observed",
    providerCommandRef: command.payload.providerCommandRef,
    evidenceSha256: internalEvidence(command, outcomeCode, phase),
  };
}

function uncertain(
  command: FoundryClaimedProviderCommandV0,
  outcomeCode: string,
  providerCommandRef: string | null,
  phase: string,
  detail?: unknown,
): FoundryProviderAdapterOutcomeV0 {
  return {
    status: "uncertain",
    outcomeCode,
    providerLifecycle: "unknown",
    providerCommandRef,
    evidenceSha256: internalEvidence(command, outcomeCode, phase, detail),
  };
}

function expectedReferenceMatches(
  command: FoundryClaimedProviderCommandV0,
  result: FoundryLocalSandboxBackendResult,
): boolean {
  const expected = command.payload.providerCommandRef;
  if (result.kind === "unknown") {
    if (command.commandKind === "provider_submit") return expected === null;
    if (command.commandKind === "provider_reconcile") {
      return expected === null || result.providerCommandRef === expected;
    }
    return result.providerCommandRef === expected;
  }
  if (result.kind !== "observed") return true;
  if (command.commandKind === "provider_submit") return expected === null;
  if (command.commandKind === "provider_reconcile") {
    return expected === null || expected === result.providerCommandRef;
  }
  return expected === result.providerCommandRef;
}

function evidenceForResult(
  command: FoundryClaimedProviderCommandV0,
  outcomeCode: string,
  result: FoundryLocalSandboxBackendResult,
): string {
  return internalEvidence(command, outcomeCode, "backend_result", result);
}

function normalizeBackendResult(
  command: FoundryClaimedProviderCommandV0,
  expectedMarker: FoundryLocalSandboxDurableResourceMarker,
  binding: FoundryLocalSandboxAdapterBinding,
  input: unknown,
): FoundryProviderAdapterOutcomeV0 {
  const parsed = FoundryLocalSandboxBackendResultSchema.safeParse(input);
  if (!parsed.success) {
    return uncertain(
      command,
      "local_backend_result_unknown",
      command.payload.providerCommandRef,
      "backend_result_validation",
    );
  }
  const result = parsed.data;
  if (
    result.providerKind !== expectedMarker.providerKind ||
    !exactMarkerMatch(result.durableResourceMarker, expectedMarker) ||
    !expectedReferenceMatches(command, result)
  ) {
    return uncertain(
      command,
      "local_backend_identity_unknown",
      command.payload.providerCommandRef,
      "backend_identity_validation",
      result,
    );
  }
  if (
    result.kind === "observed" &&
    result.verifiedCheckpoint !== undefined &&
    command.commandKind !== "provider_checkpoint"
  ) {
    return uncertain(
      command,
      "local_checkpoint_evidence_misplaced_unknown",
      command.payload.providerCommandRef,
      "backend_checkpoint_evidence_validation",
      result,
    );
  }
  const terminalObservation = result.kind === "observed" &&
    (result.lifecycle === "exited" || result.lifecycle === "terminated");
  if (
    terminalObservation &&
    binding.terminalEnforcement.mode === "required" &&
    result.enforcementReceipt === undefined
  ) {
    return uncertain(
      command,
      "local_enforcement_receipt_required_unknown",
      command.payload.providerCommandRef,
      "backend_enforcement_receipt_validation",
      result,
    );
  }
  if (
    result.kind === "observed" &&
    binding.terminalEnforcement.mode === "not_supported" &&
    result.enforcementReceipt !== undefined
  ) {
    return uncertain(
      command,
      "local_enforcement_receipt_unsupported_unknown",
      command.payload.providerCommandRef,
      "backend_enforcement_receipt_validation",
      result,
    );
  }
  if (result.kind === "observed" && result.enforcementReceipt !== undefined) {
    const receipt = result.enforcementReceipt;
    if (
      receipt.markerSha256 !== expectedMarker.markerSha256 ||
      receipt.providerCommandRef !== result.providerCommandRef ||
      (
        binding.terminalEnforcement.mode === "required" &&
        (
          receipt.policySha256 !== binding.terminalEnforcement.policySha256 ||
          receipt.securityProfileSha256 !==
            binding.terminalEnforcement.securityProfileSha256
        )
      ) ||
      (result.lifecycle !== "exited" && result.lifecycle !== "terminated")
    ) {
      return uncertain(
        command,
        "local_enforcement_receipt_identity_unknown",
        command.payload.providerCommandRef,
        "backend_enforcement_receipt_validation",
        result,
      );
    }
    if (
      result.lifecycle === "exited" &&
      (
        receipt.exitCode !== 0 ||
        receipt.oomKilled ||
        receipt.deadlineExceeded ||
        receipt.terminationIntent !== "none" ||
        !receipt.outputVerified
      )
    ) {
      return uncertain(
        command,
        "local_terminal_enforcement_failed_unknown",
        result.providerCommandRef,
        "backend_enforcement_receipt_validation",
        result,
      );
    }
  }

  if (result.kind === "unknown") {
    const outcomeCode = `local_${command.commandKind.slice(9)}_unknown`;
    return {
      status: "uncertain",
      outcomeCode,
      providerLifecycle: "unknown",
      providerCommandRef: command.commandKind === "provider_submit"
        ? result.providerCommandRef
        : command.payload.providerCommandRef,
      evidenceSha256: evidenceForResult(command, outcomeCode, result),
    };
  }

  switch (command.commandKind) {
    case "provider_submit": {
      if (result.kind === "observed") {
        if (result.lifecycle !== "queued" && result.lifecycle !== "running") {
          return uncertain(
            command,
            "local_submit_terminal_state_unknown",
            result.providerCommandRef,
            "backend_result_normalization",
            result,
          );
        }
        const outcomeCode = "local_submit_accepted";
        return {
          status: "succeeded",
          outcomeCode,
          providerLifecycle: result.lifecycle,
          providerCommandRef: result.providerCommandRef,
          evidenceSha256: evidenceForResult(command, outcomeCode, result),
        };
      }
      const outcomeCode = result.kind === "rejected"
        ? "local_submit_rejected"
        : "local_submit_not_observed";
      return {
        status: "failed",
        outcomeCode,
        providerLifecycle: "not_observed",
        providerCommandRef: null,
        evidenceSha256: evidenceForResult(command, outcomeCode, result),
      };
    }
    case "provider_reconcile": {
      if (result.kind === "observed") {
        const outcomeCode = "local_reconcile_observed";
        return {
          status: "succeeded",
          outcomeCode,
          providerLifecycle: result.lifecycle,
          providerCommandRef: result.providerCommandRef,
          evidenceSha256: evidenceForResult(command, outcomeCode, result),
        };
      }
      if (result.kind === "not_found") {
        const outcomeCode = "local_reconcile_not_found";
        return {
          status: "succeeded",
          outcomeCode,
          providerLifecycle: "not_found",
          providerCommandRef: null,
          evidenceSha256: evidenceForResult(command, outcomeCode, result),
        };
      }
      const outcomeCode = "local_reconcile_rejected";
      return {
        status: "failed",
        outcomeCode,
        providerLifecycle: "not_observed",
        providerCommandRef: command.payload.providerCommandRef,
        evidenceSha256: evidenceForResult(command, outcomeCode, result),
      };
    }
    case "provider_poll": {
      if (result.kind === "observed") {
        const outcomeCode = `local_poll_${result.lifecycle}`;
        return {
          status: "succeeded",
          outcomeCode,
          providerLifecycle: result.lifecycle,
          providerCommandRef: result.providerCommandRef,
          evidenceSha256: evidenceForResult(command, outcomeCode, result),
        };
      }
      const outcomeCode = result.kind === "not_found"
        ? "local_poll_not_found"
        : "local_poll_rejected";
      return {
        status: "failed",
        outcomeCode,
        providerLifecycle: result.kind === "not_found"
          ? "not_found"
          : "not_observed",
        providerCommandRef: command.payload.providerCommandRef,
        evidenceSha256: evidenceForResult(command, outcomeCode, result),
      };
    }
    case "provider_checkpoint": {
      if (result.kind === "observed") {
        if (result.lifecycle === "queued") {
          return uncertain(
            command,
            "local_checkpoint_not_reached_unknown",
            result.providerCommandRef,
            "backend_result_normalization",
            result,
          );
        }
        if (result.verifiedCheckpoint === undefined) {
          return uncertain(
            command,
            "local_checkpoint_evidence_missing_unknown",
            result.providerCommandRef,
            "backend_checkpoint_evidence_validation",
            result,
          );
        }
        const outcomeCode = `local_checkpoint_${result.lifecycle}`;
        return {
          status: "succeeded",
          outcomeCode,
          providerLifecycle: result.lifecycle,
          providerCommandRef: result.providerCommandRef,
          evidenceSha256: computeFoundryProviderCheckpointEvidenceSha256(
            result.verifiedCheckpoint,
          ),
          verifiedCheckpoint: result.verifiedCheckpoint,
        };
      }
      const outcomeCode = result.kind === "not_found"
        ? "local_checkpoint_not_found"
        : "local_checkpoint_rejected";
      return {
        status: "failed",
        outcomeCode,
        providerLifecycle: result.kind === "not_found"
          ? "not_found"
          : "not_observed",
        providerCommandRef: command.payload.providerCommandRef,
        evidenceSha256: evidenceForResult(command, outcomeCode, result),
      };
    }
    case "provider_stop": {
      if (result.kind === "observed") {
        if (result.lifecycle !== "exited" && result.lifecycle !== "terminated") {
          return uncertain(
            command,
            "local_stop_incomplete_unknown",
            result.providerCommandRef,
            "backend_result_normalization",
            result,
          );
        }
        const outcomeCode = `local_stop_${result.lifecycle}`;
        return {
          status: "succeeded",
          outcomeCode,
          providerLifecycle: result.lifecycle,
          providerCommandRef: result.providerCommandRef,
          evidenceSha256: evidenceForResult(command, outcomeCode, result),
        };
      }
      if (result.kind === "not_found") {
        const outcomeCode = "local_stop_already_absent";
        return {
          status: "succeeded",
          outcomeCode,
          providerLifecycle: "not_found",
          providerCommandRef: command.payload.providerCommandRef,
          evidenceSha256: evidenceForResult(command, outcomeCode, result),
        };
      }
      const outcomeCode = "local_stop_rejected";
      return {
        status: "failed",
        outcomeCode,
        providerLifecycle: "not_observed",
        providerCommandRef: command.payload.providerCommandRef,
        evidenceSha256: evidenceForResult(command, outcomeCode, result),
      };
    }
  }
}

function invokeBackend(
  backend: FoundryLocalSandboxBackend,
  request: FoundryDeepReadonly<FoundryLocalSandboxExecutionRequestV0>,
  signal: AbortSignal,
): Promise<unknown> {
  switch (request.command.commandKind) {
    case "provider_submit":
      return backend.submitExact(request, signal);
    case "provider_reconcile":
      return backend.reconcileExact(request, signal);
    case "provider_poll":
      return backend.pollExact(request, signal);
    case "provider_checkpoint":
      return backend.checkpointExact(request, signal);
    case "provider_stop":
      return backend.stopExact(request, signal);
  }
}

function signalIsAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

function createLocalAdapter(
  providerKind: FoundryLocalProviderKind,
  options: FoundryLocalSandboxAdapterOptions,
): FoundryProviderCommandAdapter {
  const providerAdapterArtifactSha256 = RuntimeSha256Schema.parse(
    options.providerAdapterArtifactSha256,
  );
  const providerDeploymentSha256 = RuntimeSha256Schema.parse(
    options.providerDeploymentSha256,
  );
  const providerAdapterVersion = FoundryProviderAdapterVersionSchema.parse(
    FOUNDRY_LOCAL_SANDBOX_ADAPTER_VERSION,
  );
  const binding = deepFreezeJson(LocalAdapterBindingSchema.parse(options.binding));
  const claimBindings = deepFreezeJson(
    FoundryProviderAdapterClaimBindingsV0Schema.parse([
      {
        providerKind,
        providerAdapterId: FOUNDRY_LOCAL_SANDBOX_ADAPTER_ID,
        providerAdapterVersion,
        providerAdapterArtifactSha256,
        providerAdapterConfigurationSha256:
          binding.providerAdapterConfigurationSha256,
        providerDeploymentSha256,
        providerRequestProfileId: binding.providerRequestProfileId,
        providerRequestProfileVersion: binding.providerRequestProfileVersion,
        providerRequestProfileSha256: binding.providerRequestProfileSha256,
        targetKind: "local_worker",
        targetId: binding.runnerProfileId,
      },
    ]),
  );
  const now = options.now ?? (() => new Date());
  const requiredBackendMethods = [
    options.backend.submitExact,
    options.backend.reconcileExact,
    options.backend.pollExact,
    options.backend.checkpointExact,
    options.backend.stopExact,
  ];
  if (requiredBackendMethods.some((method) => typeof method !== "function")) {
    throw new TypeError("local sandbox backend is missing a required exact operation");
  }
  // Capture the reviewed boundary once. Mutating the caller's options object
  // after construction cannot silently swap an operation implementation.
  const backend: FoundryLocalSandboxBackend = Object.freeze({
    submitExact: options.backend.submitExact,
    reconcileExact: options.backend.reconcileExact,
    pollExact: options.backend.pollExact,
    checkpointExact: options.backend.checkpointExact,
    stopExact: options.backend.stopExact,
  });

  const adapter: FoundryProviderCommandAdapter = {
    providerKind,
    providerAdapterId: FOUNDRY_LOCAL_SANDBOX_ADAPTER_ID,
    providerAdapterVersion,
    providerAdapterArtifactSha256,
    providerDeploymentSha256,
    claimBindings,
    validateClaimedCommand(command) {
      const parsed = FoundryClaimedProviderCommandV0Schema.safeParse(command);
      if (!parsed.success) {
        return { valid: false, reasonCode: "local_claim_schema_rejected" };
      }
      return validateLocalBinding(
        parsed.data,
        providerKind,
        providerAdapterVersion,
        providerAdapterArtifactSha256,
        providerDeploymentSha256,
        binding,
      );
    },
    async executeClaimedCommand(command, signal) {
      const validation = adapter.validateClaimedCommand(command);
      if (!validation.valid) {
        return failedBeforeBackend(
          command,
          validation.reasonCode,
          "pre_invocation_validation",
        );
      }
      // Parse again into a detached snapshot so caller mutation between pure
      // validation and invocation cannot alter the authorized request.
      const safeCommand = FoundryClaimedProviderCommandV0Schema.parse(command);
      if (signalIsAborted(signal)) {
        return failedBeforeBackend(
          safeCommand,
          "local_call_aborted_before_backend",
          "pre_backend_abort",
        );
      }
      let nowMilliseconds: number;
      try {
        nowMilliseconds = now().getTime();
      } catch {
        return failedBeforeBackend(
          safeCommand,
          "local_clock_invalid",
          "pre_backend_clock",
        );
      }
      if (!Number.isFinite(nowMilliseconds)) {
        return failedBeforeBackend(
          safeCommand,
          "local_clock_invalid",
          "pre_backend_clock",
        );
      }
      if (Date.parse(safeCommand.claimExpiresAt) <= nowMilliseconds) {
        return failedBeforeBackend(
          safeCommand,
          "local_claim_expired",
          "pre_backend_deadline",
        );
      }
      if (
        safeCommand.commandKind === "provider_submit" &&
        Date.parse(safeCommand.payload.providerRequest.runtime.dispatchDeadline) <=
          nowMilliseconds
      ) {
        return failedBeforeBackend(
          safeCommand,
          "local_dispatch_deadline_expired",
          "pre_backend_deadline",
        );
      }
      const request = buildBackendRequest(safeCommand, providerKind, binding);
      try {
        const result = await invokeBackend(backend, request, signal);
        return normalizeBackendResult(
          safeCommand,
          request.durableResourceMarker,
          binding,
          result,
        );
      } catch (error: unknown) {
        return uncertain(
          safeCommand,
          signalIsAborted(signal)
            ? "local_backend_abort_unknown"
            : "local_backend_exception_unknown",
          safeCommand.payload.providerCommandRef,
          "backend_exception",
          { errorName: error instanceof Error ? error.name : "unknown" },
        );
      }
    },
  };
  return Object.freeze(adapter);
}

export function createFoundryLocalCpuCommandAdapter(
  options: FoundryLocalSandboxAdapterOptions,
): FoundryProviderCommandAdapter {
  return createLocalAdapter("local_cpu", options);
}

export function createFoundryLocalCudaCommandAdapter(
  options: FoundryLocalSandboxAdapterOptions,
): FoundryProviderCommandAdapter {
  return createLocalAdapter("local_cuda", options);
}
