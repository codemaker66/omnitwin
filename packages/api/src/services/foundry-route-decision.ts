import {
  FoundryProviderAdapterVersionSchema,
  FoundryProviderKindSchema,
  RuntimeManifestKeySchema,
  RuntimeSha256Schema,
  type FoundryProviderKind,
} from "@omnitwin/types";
import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "@omnitwin/reconstruction-foundry";
import { z } from "zod";

export const FOUNDRY_ROUTE_POLICY_V0 =
  "omnitwin.foundry.route-policy.v0";
export const FOUNDRY_ROUTE_INPUT_V0 =
  "omnitwin.foundry.route-input.v0";
export const FOUNDRY_ROUTE_CANDIDATE_V0 =
  "omnitwin.foundry.route-candidate.v0";
export const FOUNDRY_LOCAL_ADAPTER_INVENTORY_V0 =
  "omnitwin.foundry.local-adapter-inventory.v0";
export const FOUNDRY_ROUTE_DECISION_V0 =
  "omnitwin.foundry.route-decision.v0";

const ROUTE_POLICY_DIGEST_DOMAIN = "OMNITWIN.FOUNDRY.ROUTE-POLICY.V0";
const ROUTE_INPUT_DIGEST_DOMAIN = "OMNITWIN.FOUNDRY.ROUTE-INPUT.V0";
const ROUTE_CANDIDATE_DIGEST_DOMAIN =
  "OMNITWIN.FOUNDRY.ROUTE-CANDIDATE.V0";
const ROUTE_CANDIDATE_SET_DIGEST_DOMAIN =
  "OMNITWIN.FOUNDRY.ROUTE-CANDIDATE-SET.V0";
const ROUTE_ADAPTER_BINDING_DIGEST_DOMAIN =
  "OMNITWIN.FOUNDRY.ROUTE-ADAPTER-BINDING.V0";
const LOCAL_ADAPTER_INVENTORY_DIGEST_DOMAIN =
  "OMNITWIN.FOUNDRY.LOCAL-ADAPTER-INVENTORY.V0";
const ROUTE_DECISION_DIGEST_DOMAIN =
  "OMNITWIN.FOUNDRY.ROUTE-DECISION.V0";

const MAXIMUM_INPUT_BYTES = Number.MAX_SAFE_INTEGER;
const MAXIMUM_ASSET_COUNT = 100_000;
const MAXIMUM_STAGE_COUNT = 1_000;
const MAXIMUM_CPU_CORES = 1_024;
const MAXIMUM_RAM_GIB = 100_000;
const MAXIMUM_GPU_COUNT = 128;
const MAXIMUM_GPU_VRAM_GIB = 1_000;
const MAXIMUM_DEADLINE_SECONDS = 31_536_000;
const MAXIMUM_RECORD_REVISION = Number.MAX_SAFE_INTEGER;

const FoundryRouteNetworkAccessSchema = z.enum([
  "none",
  "object_storage_only",
  "restricted",
]);
const FoundryLocalProviderKindSchema = z.enum(["local_cpu", "local_cuda"]);
type FoundryLocalProviderKind = z.infer<
  typeof FoundryLocalProviderKindSchema
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

const AllowedNetworkAccessSchema = z
  .array(FoundryRouteNetworkAccessSchema)
  .min(1)
  .max(3)
  .refine(
    isStrictlySortedUnique,
    "allowed network modes must be unique and canonically sorted",
  );

const FoundryRouteThresholdsV0Schema = z
  .object({
    maximumInputBytes: z.number().int().safe().nonnegative(),
    maximumAssetCount: z.number().int().nonnegative().max(MAXIMUM_ASSET_COUNT),
    maximumStageCount: z.number().int().positive().max(MAXIMUM_STAGE_COUNT),
    maximumPeakCpuCores: z.number().int().positive().max(MAXIMUM_CPU_CORES),
    maximumPeakRamGiB: z.number().int().positive().max(MAXIMUM_RAM_GIB),
    maximumPeakGpuCount: z.number().int().nonnegative().max(MAXIMUM_GPU_COUNT),
    maximumPerGpuVramGiB: z
      .number()
      .int()
      .nonnegative()
      .max(MAXIMUM_GPU_VRAM_GIB),
    maximumDeadlineSeconds: z
      .number()
      .int()
      .positive()
      .max(MAXIMUM_DEADLINE_SECONDS),
    allowedNetworkAccess: AllowedNetworkAccessSchema,
  })
  .strict();

type FoundryRouteThresholdsV0 = z.infer<
  typeof FoundryRouteThresholdsV0Schema
>;

const MONOTONIC_THRESHOLD_FIELDS = [
  "maximumInputBytes",
  "maximumAssetCount",
  "maximumStageCount",
  "maximumPeakCpuCores",
  "maximumPeakRamGiB",
  "maximumDeadlineSeconds",
] as const satisfies readonly (keyof FoundryRouteThresholdsV0)[];

export const FoundryRoutePolicyV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_ROUTE_POLICY_V0),
    policyId: RuntimeManifestKeySchema,
    policyRevision: z
      .number()
      .int()
      .positive()
      .max(MAXIMUM_RECORD_REVISION),
    authority: z.literal("none"),
    signing: z.literal("not_authorized"),
    publication: z.literal("not_authorized"),
    localCpu: FoundryRouteThresholdsV0Schema,
    localCuda: FoundryRouteThresholdsV0Schema,
  })
  .strict()
  .superRefine((policy, ctx) => {
    if (
      policy.localCpu.maximumPeakGpuCount !== 0 ||
      policy.localCpu.maximumPerGpuVramGiB !== 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["localCpu"],
        message: "local CPU thresholds must prohibit GPUs and GPU VRAM",
      });
    }
    if (
      policy.localCuda.maximumPeakGpuCount === 0 ||
      policy.localCuda.maximumPerGpuVramGiB === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["localCuda"],
        message: "local CUDA thresholds must declare positive GPU capacity",
      });
    }
    for (const field of MONOTONIC_THRESHOLD_FIELDS) {
      if (policy.localCpu[field] > policy.localCuda[field]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["localCpu", field],
          message: "local CPU thresholds must not exceed local CUDA thresholds",
        });
      }
    }
    if (
      policy.localCpu.allowedNetworkAccess.some(
        (mode) => !policy.localCuda.allowedNetworkAccess.includes(mode),
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["localCpu", "allowedNetworkAccess"],
        message: "local CPU network modes must be a subset of local CUDA modes",
      });
    }
  });
export type FoundryRoutePolicyV0 = z.infer<typeof FoundryRoutePolicyV0Schema>;

export const FoundryRouteDecisionInputV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_ROUTE_INPUT_V0),
    inputId: RuntimeManifestKeySchema,
    jobSpecSha256: RuntimeSha256Schema,
    ingestManifestSha256: RuntimeSha256Schema,
    inputBytes: z
      .number()
      .int()
      .safe()
      .nonnegative()
      .max(MAXIMUM_INPUT_BYTES),
    assetCount: z.number().int().positive().max(MAXIMUM_ASSET_COUNT),
    stageCount: z.number().int().positive().max(MAXIMUM_STAGE_COUNT),
    peakCpuCores: z.number().int().positive().max(MAXIMUM_CPU_CORES),
    peakRamGiB: z.number().int().positive().max(MAXIMUM_RAM_GIB),
    peakGpuCount: z.number().int().nonnegative().max(MAXIMUM_GPU_COUNT),
    minimumPerGpuVramGiB: z
      .number()
      .int()
      .nonnegative()
      .max(MAXIMUM_GPU_VRAM_GIB),
    deadlineSeconds: z
      .number()
      .int()
      .positive()
      .max(MAXIMUM_DEADLINE_SECONDS),
    networkAccess: FoundryRouteNetworkAccessSchema,
  })
  .strict()
  .superRefine((input, ctx) => {
    const hasGpu = input.peakGpuCount > 0;
    const hasVram = input.minimumPerGpuVramGiB > 0;
    if (hasGpu !== hasVram) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minimumPerGpuVramGiB"],
        message: "GPU count and per-GPU VRAM requirements must both be zero or both be positive",
      });
    }
  });
export type FoundryRouteDecisionInputV0 = z.infer<
  typeof FoundryRouteDecisionInputV0Schema
>;

const FoundryRouteAdapterBindingShape = {
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
} as const;

export const FoundryRouteAdapterBindingV0Schema = z
  .object(FoundryRouteAdapterBindingShape)
  .strict()
  .superRefine((binding, ctx) => {
    const local = isLocalProviderKind(binding.providerKind);
    if (local !== (binding.targetKind === "local_worker")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetKind"],
        message: "local providers require a local runner and remote providers require a remote pool",
      });
    }
  });
export type FoundryRouteAdapterBindingV0 = z.infer<
  typeof FoundryRouteAdapterBindingV0Schema
>;

function isLocalProviderKind(
  providerKind: FoundryProviderKind,
): providerKind is FoundryLocalProviderKind {
  return providerKind === "local_cpu" || providerKind === "local_cuda";
}

export const FoundryLocalAdapterBindingV0Schema = z
  .object({
    ...FoundryRouteAdapterBindingShape,
    providerKind: FoundryLocalProviderKindSchema,
    targetKind: z.literal("local_worker"),
  })
  .strict();
export type FoundryLocalAdapterBindingV0 = z.infer<
  typeof FoundryLocalAdapterBindingV0Schema
>;

export const FoundryRouteCandidateV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_ROUTE_CANDIDATE_V0),
    candidateId: RuntimeManifestKeySchema,
    viability: z.literal("viable"),
    authority: z.literal("none"),
    signing: z.literal("not_authorized"),
    publication: z.literal("not_authorized"),
    routePolicySha256: RuntimeSha256Schema,
    routeInputSha256: RuntimeSha256Schema,
    planSha256: RuntimeSha256Schema,
    providerKind: FoundryProviderKindSchema,
    adapterBinding: FoundryRouteAdapterBindingV0Schema,
  })
  .strict()
  .superRefine((candidate, ctx) => {
    if (candidate.providerKind !== candidate.adapterBinding.providerKind) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["adapterBinding", "providerKind"],
        message: "candidate and adapter binding provider kinds must match",
      });
    }
  });
export type FoundryRouteCandidateV0 = z.infer<
  typeof FoundryRouteCandidateV0Schema
>;

export const FoundryLocalAdapterInventoryV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_LOCAL_ADAPTER_INVENTORY_V0),
    inventoryId: RuntimeManifestKeySchema,
    inventoryRevision: z
      .number()
      .int()
      .positive()
      .max(MAXIMUM_RECORD_REVISION),
    bindings: z.array(FoundryLocalAdapterBindingV0Schema).max(1_000),
  })
  .strict()
  .superRefine((inventory, ctx) => {
    const canonicalBindings = inventory.bindings.map((binding) =>
      stableCanonicalJson(toCanonicalJson(binding)),
    );
    if (new Set(canonicalBindings).size !== canonicalBindings.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bindings"],
        message: "local adapter inventory bindings must be unique",
      });
    }
    const executorBindingKeys = inventory.bindings.map((binding) =>
      stableCanonicalJson(toCanonicalJson({
        providerKind: binding.providerKind,
        providerAdapterId: binding.providerAdapterId,
        providerAdapterVersion: binding.providerAdapterVersion,
        providerAdapterArtifactSha256:
          binding.providerAdapterArtifactSha256,
        providerDeploymentSha256: binding.providerDeploymentSha256,
      })),
    );
    if (new Set(executorBindingKeys).size !== executorBindingKeys.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bindings"],
        message: "one executor adapter identity cannot advertise multiple local lowering bindings",
      });
    }
  });
export type FoundryLocalAdapterInventoryV0 = z.infer<
  typeof FoundryLocalAdapterInventoryV0Schema
>;

const StoredRoutePolicyV0Schema = z
  .object({
    sha256: RuntimeSha256Schema,
    value: FoundryRoutePolicyV0Schema,
  })
  .strict();
const StoredRouteInputV0Schema = z
  .object({
    sha256: RuntimeSha256Schema,
    value: FoundryRouteDecisionInputV0Schema,
  })
  .strict();
const StoredRouteCandidateV0Schema = z
  .object({
    sha256: RuntimeSha256Schema,
    value: FoundryRouteCandidateV0Schema,
  })
  .strict();
const StoredLocalAdapterInventoryV0Schema = z
  .object({
    sha256: RuntimeSha256Schema,
    value: FoundryLocalAdapterInventoryV0Schema,
  })
  .strict();

export const FoundryRouteDecisionRequestV0Schema = z
  .object({
    policy: StoredRoutePolicyV0Schema,
    input: StoredRouteInputV0Schema,
    candidates: z.array(StoredRouteCandidateV0Schema).min(1).max(1_000),
    localAdapterInventory: StoredLocalAdapterInventoryV0Schema,
  })
  .strict();
export type FoundryRouteDecisionRequestV0 = z.infer<
  typeof FoundryRouteDecisionRequestV0Schema
>;

const FoundryRouteDecisionPayloadShapeV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_ROUTE_DECISION_V0),
    routeClass: z.enum([
      "small_local_cpu",
      "medium_local_cuda",
      "oversized_remote",
    ]),
    status: z.enum([
      "executable_local",
      "awaiting_local_adapter_binding",
      "awaiting_provider_adapter",
    ]),
    routePolicySha256: RuntimeSha256Schema,
    routeInputSha256: RuntimeSha256Schema,
    candidateSetSha256: RuntimeSha256Schema,
    localAdapterInventorySha256: RuntimeSha256Schema,
    selectedCandidateId: RuntimeManifestKeySchema,
    selectedCandidateSha256: RuntimeSha256Schema,
    selectedPlanSha256: RuntimeSha256Schema,
    providerKind: FoundryProviderKindSchema,
    adapterBindingSha256: RuntimeSha256Schema,
    matchedLocalAdapterBindingSha256: RuntimeSha256Schema.nullable(),
    authority: z.literal("none"),
    executionAuthority: z.literal("not_authorized"),
    signing: z.literal("not_authorized"),
    publication: z.literal("not_authorized"),
  })
  .strict();

const FoundryRouteDecisionPayloadV0Schema =
  FoundryRouteDecisionPayloadShapeV0Schema.superRefine((decision, ctx) => {
    validateDecisionState(decision, ctx);
  });
export type FoundryRouteDecisionPayloadV0 = z.infer<
  typeof FoundryRouteDecisionPayloadV0Schema
>;

const FoundryRouteDecisionEnvelopeV0Schema =
  FoundryRouteDecisionPayloadShapeV0Schema.extend({
    decisionSha256: RuntimeSha256Schema,
  })
    .strict()
    .superRefine((decision, ctx) => {
      validateDecisionState(decision, ctx);
    });

export const FoundryRouteDecisionV0Schema =
  FoundryRouteDecisionEnvelopeV0Schema.superRefine((decision, ctx) => {
    const payload = routeDecisionPayload(decision);
    if (decision.decisionSha256 !== computeFoundryRouteDecisionSha256(payload)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["decisionSha256"],
        message: "route decision digest must match its canonical payload",
      });
    }
  });
export type FoundryRouteDecisionV0 = z.infer<
  typeof FoundryRouteDecisionV0Schema
>;

interface DecisionStateShape {
  readonly routeClass:
    | "small_local_cpu"
    | "medium_local_cuda"
    | "oversized_remote";
  readonly status:
    | "executable_local"
    | "awaiting_local_adapter_binding"
    | "awaiting_provider_adapter";
  readonly providerKind: FoundryProviderKind;
  readonly matchedLocalAdapterBindingSha256: string | null;
}

function validateDecisionState(
  decision: DecisionStateShape,
  ctx: z.RefinementCtx,
): void {
  const expectedClass = decision.providerKind === "local_cpu"
    ? "small_local_cpu"
    : decision.providerKind === "local_cuda"
      ? "medium_local_cuda"
      : "oversized_remote";
  if (decision.routeClass !== expectedClass) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["routeClass"],
      message: "route class must match the selected provider kind",
    });
  }
  const local = isLocalProviderKind(decision.providerKind);
  if (!local && decision.status !== "awaiting_provider_adapter") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["status"],
      message: "every remote route must await a provider adapter",
    });
  }
  if (local && decision.status === "awaiting_provider_adapter") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["status"],
      message: "local routes cannot use the remote provider-adapter state",
    });
  }
  const matched = decision.matchedLocalAdapterBindingSha256 !== null;
  if ((decision.status === "executable_local") !== matched) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["matchedLocalAdapterBindingSha256"],
      message: "only an executable local route may carry an available local binding",
    });
  }
}

export class FoundryRouteDecisionError extends Error {
  constructor(
    readonly code:
      | "INVALID_ROUTE_DECISION_REQUEST"
      | "POLICY_DIGEST_MISMATCH"
      | "INPUT_DIGEST_MISMATCH"
      | "CANDIDATE_DIGEST_MISMATCH"
      | "LOCAL_ADAPTER_INVENTORY_DIGEST_MISMATCH"
      | "DUPLICATE_ROUTE_CANDIDATE"
      | "CANDIDATE_SUBJECT_MISMATCH"
      | "ROUTE_CANDIDATE_NOT_FOUND"
      | "AMBIGUOUS_ROUTE_CANDIDATES",
    message: string,
  ) {
    super(message);
    this.name = "FoundryRouteDecisionError";
  }
}

function digest(domain: string, value: unknown): string {
  return `sha256:${domainSeparatedSha256(domain, toCanonicalJson(value))}`;
}

export function computeFoundryRoutePolicySha256(input: unknown): string {
  return digest(
    ROUTE_POLICY_DIGEST_DOMAIN,
    FoundryRoutePolicyV0Schema.parse(input),
  );
}

export function computeFoundryRouteInputSha256(input: unknown): string {
  return digest(
    ROUTE_INPUT_DIGEST_DOMAIN,
    FoundryRouteDecisionInputV0Schema.parse(input),
  );
}

export function computeFoundryRouteCandidateSha256(input: unknown): string {
  return digest(
    ROUTE_CANDIDATE_DIGEST_DOMAIN,
    FoundryRouteCandidateV0Schema.parse(input),
  );
}

export function computeFoundryRouteAdapterBindingSha256(
  input: unknown,
): string {
  return digest(
    ROUTE_ADAPTER_BINDING_DIGEST_DOMAIN,
    FoundryRouteAdapterBindingV0Schema.parse(input),
  );
}

export function computeFoundryLocalAdapterInventorySha256(
  input: unknown,
): string {
  return digest(
    LOCAL_ADAPTER_INVENTORY_DIGEST_DOMAIN,
    FoundryLocalAdapterInventoryV0Schema.parse(input),
  );
}

export function computeFoundryRouteCandidateSetSha256(
  candidatesInput: unknown,
): string {
  const candidates = z.array(StoredRouteCandidateV0Schema).parse(candidatesInput);
  const candidateSha256s = candidates
    .map((candidate) => candidate.sha256)
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  return digest(ROUTE_CANDIDATE_SET_DIGEST_DOMAIN, { candidateSha256s });
}

export function computeFoundryRouteDecisionSha256(input: unknown): string {
  return digest(
    ROUTE_DECISION_DIGEST_DOMAIN,
    FoundryRouteDecisionPayloadV0Schema.parse(input),
  );
}

function routeDecisionPayload(
  decision: z.infer<typeof FoundryRouteDecisionEnvelopeV0Schema>,
): FoundryRouteDecisionPayloadV0 {
  return {
    schemaVersion: decision.schemaVersion,
    routeClass: decision.routeClass,
    status: decision.status,
    routePolicySha256: decision.routePolicySha256,
    routeInputSha256: decision.routeInputSha256,
    candidateSetSha256: decision.candidateSetSha256,
    localAdapterInventorySha256: decision.localAdapterInventorySha256,
    selectedCandidateId: decision.selectedCandidateId,
    selectedCandidateSha256: decision.selectedCandidateSha256,
    selectedPlanSha256: decision.selectedPlanSha256,
    providerKind: decision.providerKind,
    adapterBindingSha256: decision.adapterBindingSha256,
    matchedLocalAdapterBindingSha256:
      decision.matchedLocalAdapterBindingSha256,
    authority: decision.authority,
    executionAuthority: decision.executionAuthority,
    signing: decision.signing,
    publication: decision.publication,
  };
}

function verifyStoredDigests(request: FoundryRouteDecisionRequestV0): void {
  if (computeFoundryRoutePolicySha256(request.policy.value) !== request.policy.sha256) {
    throw new FoundryRouteDecisionError(
      "POLICY_DIGEST_MISMATCH",
      "Persisted route-policy digest does not match its canonical thresholds.",
    );
  }
  if (computeFoundryRouteInputSha256(request.input.value) !== request.input.sha256) {
    throw new FoundryRouteDecisionError(
      "INPUT_DIGEST_MISMATCH",
      "Persisted route-input digest does not match its canonical requirements.",
    );
  }
  for (const candidate of request.candidates) {
    if (computeFoundryRouteCandidateSha256(candidate.value) !== candidate.sha256) {
      throw new FoundryRouteDecisionError(
        "CANDIDATE_DIGEST_MISMATCH",
        `Route candidate ${candidate.value.candidateId} has a stale digest.`,
      );
    }
  }
  if (
    computeFoundryLocalAdapterInventorySha256(
      request.localAdapterInventory.value,
    ) !== request.localAdapterInventory.sha256
  ) {
    throw new FoundryRouteDecisionError(
      "LOCAL_ADAPTER_INVENTORY_DIGEST_MISMATCH",
      "Local adapter inventory digest does not match its canonical snapshot.",
    );
  }
}

function verifyCandidateSet(request: FoundryRouteDecisionRequestV0): void {
  const candidateIds = request.candidates.map(
    (candidate) => candidate.value.candidateId,
  );
  const candidateDigests = request.candidates.map((candidate) => candidate.sha256);
  if (
    new Set(candidateIds).size !== candidateIds.length ||
    new Set(candidateDigests).size !== candidateDigests.length
  ) {
    throw new FoundryRouteDecisionError(
      "DUPLICATE_ROUTE_CANDIDATE",
      "Route candidates must have unique IDs and canonical digests.",
    );
  }
  for (const candidate of request.candidates) {
    if (
      candidate.value.routePolicySha256 !== request.policy.sha256 ||
      candidate.value.routeInputSha256 !== request.input.sha256
    ) {
      throw new FoundryRouteDecisionError(
        "CANDIDATE_SUBJECT_MISMATCH",
        `Route candidate ${candidate.value.candidateId} does not bind the exact policy and input.`,
      );
    }
  }
}

function fitsThresholds(
  input: FoundryRouteDecisionInputV0,
  thresholds: FoundryRouteThresholdsV0,
): boolean {
  return (
    input.inputBytes <= thresholds.maximumInputBytes &&
    input.assetCount <= thresholds.maximumAssetCount &&
    input.stageCount <= thresholds.maximumStageCount &&
    input.peakCpuCores <= thresholds.maximumPeakCpuCores &&
    input.peakRamGiB <= thresholds.maximumPeakRamGiB &&
    input.peakGpuCount <= thresholds.maximumPeakGpuCount &&
    input.minimumPerGpuVramGiB <= thresholds.maximumPerGpuVramGiB &&
    input.deadlineSeconds <= thresholds.maximumDeadlineSeconds &&
    thresholds.allowedNetworkAccess.includes(input.networkAccess)
  );
}

type FoundryRouteClass = FoundryRouteDecisionPayloadV0["routeClass"];

function classifyRoute(
  input: FoundryRouteDecisionInputV0,
  policy: FoundryRoutePolicyV0,
): FoundryRouteClass {
  if (fitsThresholds(input, policy.localCpu)) return "small_local_cpu";
  if (fitsThresholds(input, policy.localCuda)) return "medium_local_cuda";
  return "oversized_remote";
}

function candidateMatchesClass(
  candidate: FoundryRouteCandidateV0,
  routeClass: FoundryRouteClass,
): boolean {
  if (routeClass === "small_local_cpu") {
    return candidate.providerKind === "local_cpu";
  }
  if (routeClass === "medium_local_cuda") {
    return candidate.providerKind === "local_cuda";
  }
  return !isLocalProviderKind(candidate.providerKind);
}

function selectCandidate(
  request: FoundryRouteDecisionRequestV0,
  routeClass: FoundryRouteClass,
): FoundryRouteDecisionRequestV0["candidates"][number] {
  const matching = request.candidates.filter((candidate) =>
    candidateMatchesClass(candidate.value, routeClass),
  );
  if (matching.length === 0) {
    throw new FoundryRouteDecisionError(
      "ROUTE_CANDIDATE_NOT_FOUND",
      `No viable candidate exists for policy route ${routeClass}.`,
    );
  }
  if (matching.length !== 1) {
    throw new FoundryRouteDecisionError(
      "AMBIGUOUS_ROUTE_CANDIDATES",
      `Policy route ${routeClass} has ${String(matching.length)} unresolved viable candidates.`,
    );
  }
  const selected = matching[0];
  if (selected === undefined) {
    throw new FoundryRouteDecisionError(
      "ROUTE_CANDIDATE_NOT_FOUND",
      `No viable candidate exists for policy route ${routeClass}.`,
    );
  }
  return selected;
}

function bindingsEqual(
  left: FoundryRouteAdapterBindingV0,
  right: FoundryRouteAdapterBindingV0,
): boolean {
  return stableCanonicalJson(toCanonicalJson(left)) ===
    stableCanonicalJson(toCanonicalJson(right));
}

function matchingLocalBindingSha256(
  candidate: FoundryRouteCandidateV0,
  inventory: FoundryLocalAdapterInventoryV0,
): string | null {
  if (!isLocalProviderKind(candidate.providerKind)) return null;
  const matched = inventory.bindings.find((binding) =>
    bindingsEqual(candidate.adapterBinding, binding),
  );
  return matched === undefined
    ? null
    : computeFoundryRouteAdapterBindingSha256(matched);
}

function decisionStatus(
  providerKind: FoundryProviderKind,
  matchedLocalBindingSha256: string | null,
): FoundryRouteDecisionPayloadV0["status"] {
  if (!isLocalProviderKind(providerKind)) return "awaiting_provider_adapter";
  return matchedLocalBindingSha256 === null
    ? "awaiting_local_adapter_binding"
    : "executable_local";
}

/**
 * Selects one already-viable candidate. This pure decision is readiness
 * evidence only: it creates no provider request, execution grant, signature,
 * publication grant, or spend authority.
 */
export function decideFoundryRoute(input: unknown): FoundryRouteDecisionV0 {
  const parsed = FoundryRouteDecisionRequestV0Schema.safeParse(input);
  if (!parsed.success) {
    throw new FoundryRouteDecisionError(
      "INVALID_ROUTE_DECISION_REQUEST",
      "Route decision request failed its closed canonical schema.",
    );
  }
  const request = parsed.data;
  verifyStoredDigests(request);
  verifyCandidateSet(request);
  const routeClass = classifyRoute(request.input.value, request.policy.value);
  const selected = selectCandidate(request, routeClass);
  const matchedLocalAdapterBindingSha256 = matchingLocalBindingSha256(
    selected.value,
    request.localAdapterInventory.value,
  );
  const payload: FoundryRouteDecisionPayloadV0 = {
    schemaVersion: FOUNDRY_ROUTE_DECISION_V0,
    routeClass,
    status: decisionStatus(
      selected.value.providerKind,
      matchedLocalAdapterBindingSha256,
    ),
    routePolicySha256: request.policy.sha256,
    routeInputSha256: request.input.sha256,
    candidateSetSha256: computeFoundryRouteCandidateSetSha256(
      request.candidates,
    ),
    localAdapterInventorySha256: request.localAdapterInventory.sha256,
    selectedCandidateId: selected.value.candidateId,
    selectedCandidateSha256: selected.sha256,
    selectedPlanSha256: selected.value.planSha256,
    providerKind: selected.value.providerKind,
    adapterBindingSha256: computeFoundryRouteAdapterBindingSha256(
      selected.value.adapterBinding,
    ),
    matchedLocalAdapterBindingSha256,
    authority: "none",
    executionAuthority: "not_authorized",
    signing: "not_authorized",
    publication: "not_authorized",
  };
  return FoundryRouteDecisionV0Schema.parse({
    ...payload,
    decisionSha256: computeFoundryRouteDecisionSha256(payload),
  });
}

export type FoundryRouteDecisionValidation =
  | { readonly valid: true }
  | {
      readonly valid: false;
      readonly reason:
        | "invalid_decision"
        | "decision_digest_mismatch"
        | "invalid_request"
        | "decision_content_mismatch";
    };

/** Recompiles from trusted evidence and rejects digest or semantic drift. */
export function validateFoundryRouteDecision(
  decisionInput: unknown,
  requestInput: unknown,
): FoundryRouteDecisionValidation {
  const parsed = FoundryRouteDecisionEnvelopeV0Schema.safeParse(decisionInput);
  if (!parsed.success) return { valid: false, reason: "invalid_decision" };
  const payload = routeDecisionPayload(parsed.data);
  if (
    parsed.data.decisionSha256 !==
    computeFoundryRouteDecisionSha256(payload)
  ) {
    return { valid: false, reason: "decision_digest_mismatch" };
  }
  let expected: FoundryRouteDecisionV0;
  try {
    expected = decideFoundryRoute(requestInput);
  } catch {
    return { valid: false, reason: "invalid_request" };
  }
  return stableCanonicalJson(toCanonicalJson(expected)) ===
    stableCanonicalJson(toCanonicalJson(parsed.data))
    ? { valid: true }
    : { valid: false, reason: "decision_content_mismatch" };
}
