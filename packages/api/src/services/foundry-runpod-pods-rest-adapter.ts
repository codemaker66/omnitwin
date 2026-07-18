import { createHash } from "node:crypto";
import {
  FoundryProviderAdapterVersionSchema,
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
  type FoundryClaimedProviderCommandV0,
  type FoundryProviderAdapterOutcomeV0,
  type FoundryProviderCommandAdapter,
} from "./foundry-provider-command-executor.js";
import {
  FoundryProviderRequestProfileV0Schema,
  computeFoundryProviderRequestProfileSha256,
  deriveFoundryProviderClientRequestId,
} from "./foundry-provider-request-authorization.js";

export const RUNPOD_PODS_REST_V1_ADAPTER_ID = "runpod-pods-rest-v1";
export const RUNPOD_PODS_REST_V1_ADAPTER_VERSION = "1.0.0";
export const RUNPOD_PODS_REST_V1_BASE_URL = "https://rest.runpod.io/v1";
export const RUNPOD_PODS_REST_V1_ADAPTER_CONFIGURATION_V0 =
  "omnitwin.foundry.runpod-pods-rest.adapter-configuration.v0";
export const RUNPOD_PODS_REST_V1_LOWERING_PROFILE_V0 =
  "omnitwin.foundry.runpod-pods-rest.lowering-profile.v0";

export const RUNPOD_PROVIDER_SUBMIT_REQUEST_V0 =
  "omnitwin.foundry.runpod-pods-rest.provider-submit.v0";
export const RUNPOD_PROVIDER_RECONCILE_REQUEST_V0 =
  "omnitwin.foundry.runpod-pods-rest.provider-reconcile.v0";
export const RUNPOD_PROVIDER_POLL_REQUEST_V0 =
  "omnitwin.foundry.runpod-pods-rest.provider-poll.v0";
export const RUNPOD_PROVIDER_STOP_REQUEST_V0 =
  "omnitwin.foundry.runpod-pods-rest.provider-stop.v0";

const RunPodPodIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9_-]*$/u);

const RunPodProviderRefSchema = z
  .string()
  .regex(/^runpod:[a-z0-9][a-z0-9_-]{0,127}$/u);

const RunPodContainerImageSchema = z
  .string()
  .max(512)
  .regex(/^[a-z0-9][a-z0-9._/:@-]*@sha256:[a-f0-9]{64}$/u);

const RunPodDataCenterIdSchema = z
  .string()
  .max(32)
  .regex(/^[A-Z]{2,3}-[A-Z0-9]{2,8}-[0-9]{1,3}$/u);

const RunPodGpuTypeIdSchema = z
  .string()
  .min(1)
  .max(120)
  .refine(
    (value) =>
      value === value.trim() &&
      value === value.normalize("NFC") &&
      !Array.from(value).some((character) => {
        const codePoint = character.codePointAt(0);
        return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
      }),
    "GPU type ID must be canonical printable text",
  );

const RunPodCudaVersionSchema = z.enum([
  "11.8",
  "12.0",
  "12.1",
  "12.2",
  "12.3",
  "12.4",
  "12.5",
  "12.6",
  "12.7",
  "12.8",
  "12.9",
  "13.0",
]);

const RunPodCpuFlavorSchema = z.enum([
  "cpu3c",
  "cpu3g",
  "cpu3m",
  "cpu5c",
  "cpu5g",
  "cpu5m",
]);

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

const SortedDataCenterIdsSchema = z
  .array(RunPodDataCenterIdSchema)
  .min(1)
  .max(32)
  .refine(isStrictlySortedUnique, "data center IDs must be unique and sorted");

const SortedGpuTypeIdsSchema = z
  .array(RunPodGpuTypeIdSchema)
  .min(1)
  .max(32)
  .refine(isStrictlySortedUnique, "GPU type IDs must be unique and sorted");

const SortedCudaVersionsSchema = z
  .array(RunPodCudaVersionSchema)
  .min(1)
  .max(32)
  .refine(isStrictlySortedUnique, "CUDA versions must be unique and sorted");

const SortedCpuFlavorIdsSchema = z
  .array(RunPodCpuFlavorSchema)
  .min(1)
  .max(6)
  .refine(isStrictlySortedUnique, "CPU flavor IDs must be unique and sorted");

const RunPodMarkerEnvironmentSchema = z
  .object({
    OMNITWIN_EXECUTION_SUBJECT_SHA256: RuntimeSha256Schema,
    OMNITWIN_PROVIDER_IDEMPOTENCY_KEY: RuntimeManifestKeySchema,
    OMNITWIN_CLIENT_REQUEST_ID: RuntimeManifestKeySchema,
    OMNITWIN_PROVIDER_REQUEST_PROFILE_SHA256: RuntimeSha256Schema,
    OMNITWIN_REMOTE_WORKER_POOL_ID: RuntimeManifestKeySchema,
  })
  .strict();

const RunPodSubmitPodCommonShape = {
  name: z.string().regex(/^omnitwin-[a-f0-9]{16}-[a-f0-9]{16}$/u),
  imageName: RunPodContainerImageSchema,
  cloudType: z.enum(["SECURE", "COMMUNITY"]),
  containerDiskInGb: z.number().int().positive().max(1_000_000),
  volumeInGb: z.number().int().nonnegative().max(1_000_000),
  volumeMountPath: z
    .string()
    .min(1)
    .max(240)
    .regex(/^\/(?:[a-z0-9._-]+(?:\/[a-z0-9._-]+)*)?$/u),
  networkVolumeId: RuntimeManifestKeySchema.nullable(),
  dockerEntrypoint: z.tuple([]),
  dockerStartCmd: z.tuple([]),
  env: RunPodMarkerEnvironmentSchema,
  interruptible: z.boolean(),
  locked: z.literal(false),
  dataCenterIds: SortedDataCenterIdsSchema,
  dataCenterPriority: z.literal("custom"),
};

const RunPodGpuSubmitPodSchema = z
  .object({
    ...RunPodSubmitPodCommonShape,
    computeType: z.literal("GPU"),
    gpuCount: z.number().int().positive().max(128),
    gpuTypeIds: SortedGpuTypeIdsSchema,
    gpuTypePriority: z.literal("custom"),
    allowedCudaVersions: SortedCudaVersionsSchema,
    minRAMPerGPU: z.number().int().positive().max(1_000_000),
    minVCPUPerGPU: z.number().int().positive().max(1_024),
  })
  .strict();

const RunPodCpuSubmitPodSchema = z
  .object({
    ...RunPodSubmitPodCommonShape,
    computeType: z.literal("CPU"),
    vcpuCount: z.number().int().positive().max(1_024),
    cpuFlavorIds: SortedCpuFlavorIdsSchema,
    cpuFlavorPriority: z.literal("custom"),
  })
  .strict();

const RunPodSubmitPodSchema = z.discriminatedUnion("computeType", [
  RunPodGpuSubmitPodSchema,
  RunPodCpuSubmitPodSchema,
]);

const RunPodTransientRequestBindingShape = {
  executionSubjectSha256: RuntimeSha256Schema,
  providerIdempotencyKey: RuntimeManifestKeySchema,
  clientRequestId: RuntimeManifestKeySchema,
  providerRequestProfileSha256: RuntimeSha256Schema,
  remoteWorkerPoolId: RuntimeManifestKeySchema,
};

export const RunPodProviderSubmitRequestV0Schema = z
  .object({
    schemaVersion: z.literal(RUNPOD_PROVIDER_SUBMIT_REQUEST_V0),
    ...RunPodTransientRequestBindingShape,
    pod: RunPodSubmitPodSchema,
  })
  .strict();
export type RunPodProviderSubmitRequestV0 = z.infer<
  typeof RunPodProviderSubmitRequestV0Schema
>;

export const RunPodProviderReconcileRequestV0Schema = z
  .object({
    schemaVersion: z.literal(RUNPOD_PROVIDER_RECONCILE_REQUEST_V0),
    ...RunPodTransientRequestBindingShape,
    expectedPodName: z.string().regex(/^omnitwin-[a-f0-9]{16}-[a-f0-9]{16}$/u),
    submitCommandId: z.string().uuid(),
    submitProviderRequestAuthorizationSha256: RuntimeSha256Schema,
    targetProviderCommandRef: RunPodProviderRefSchema.nullable(),
  })
  .strict();
export type RunPodProviderReconcileRequestV0 = z.infer<
  typeof RunPodProviderReconcileRequestV0Schema
>;

const RunPodKnownPodRequestShape = {
  ...RunPodTransientRequestBindingShape,
  expectedPodName: z.string().regex(/^omnitwin-[a-f0-9]{16}-[a-f0-9]{16}$/u),
  podId: RunPodPodIdSchema,
};

export const RunPodProviderPollRequestV0Schema = z
  .object({
    schemaVersion: z.literal(RUNPOD_PROVIDER_POLL_REQUEST_V0),
    ...RunPodKnownPodRequestShape,
  })
  .strict();
export type RunPodProviderPollRequestV0 = z.infer<
  typeof RunPodProviderPollRequestV0Schema
>;

export const RunPodProviderStopRequestV0Schema = z
  .object({
    schemaVersion: z.literal(RUNPOD_PROVIDER_STOP_REQUEST_V0),
    ...RunPodKnownPodRequestShape,
    stopIntentId: z.string().uuid(),
  })
  .strict();
export type RunPodProviderStopRequestV0 = z.infer<
  typeof RunPodProviderStopRequestV0Schema
>;

const RunPodLoweringCapacityCommonShape = {
  capacityClass: RuntimeManifestKeySchema,
  cloudType: z.enum(["SECURE", "COMMUNITY"]),
  interruptible: z.boolean(),
  dataCenterIds: SortedDataCenterIdsSchema,
};

const RunPodGpuLoweringCapacitySchema = z
  .object({
    ...RunPodLoweringCapacityCommonShape,
    computeType: z.literal("GPU"),
    gpuTypeIds: SortedGpuTypeIdsSchema,
    allowedCudaVersions: SortedCudaVersionsSchema,
  })
  .strict();

const RunPodCpuLoweringCapacitySchema = z
  .object({
    ...RunPodLoweringCapacityCommonShape,
    computeType: z.literal("CPU"),
    cpuFlavorIds: SortedCpuFlavorIdsSchema,
  })
  .strict();

const RunPodLoweringCapacitySchema = z.discriminatedUnion("computeType", [
  RunPodGpuLoweringCapacitySchema,
  RunPodCpuLoweringCapacitySchema,
]);

/**
 * Exact, secret-free RunPod selector configuration. Its digest is carried by
 * the durable provider profile and command independently of any one profile
 * version, avoiding a digest cycle between profile and lowering registration.
 */
export const RunPodPodsRestV1AdapterConfigurationV0Schema = z
  .object({
    schemaVersion: z.literal(
      RUNPOD_PODS_REST_V1_ADAPTER_CONFIGURATION_V0,
    ),
    capacityClasses: z
      .array(RunPodLoweringCapacitySchema)
      .min(1)
      .max(1_000)
      .refine(
        (values) =>
          isStrictlySortedUnique(values.map((value) => value.capacityClass)),
        "capacity classes must be unique and sorted",
      ),
  })
  .strict();
export type RunPodPodsRestV1AdapterConfigurationV0 = z.infer<
  typeof RunPodPodsRestV1AdapterConfigurationV0Schema
>;

/**
 * Secret-free deployment configuration used only inside the adapter. The
 * authorization selects it by exact adapter-configuration and reviewed
 * provider-profile digests; callers cannot place RunPod selectors in durable
 * command JSON.
 */
export const RunPodPodsRestV1LoweringProfileV0Schema = z
  .object({
    schemaVersion: z.literal(RUNPOD_PODS_REST_V1_LOWERING_PROFILE_V0),
    providerRequestProfile: FoundryProviderRequestProfileV0Schema,
    providerRequestProfileSha256: RuntimeSha256Schema,
    capacityClasses: z
      .array(RunPodLoweringCapacitySchema)
      .min(1)
      .max(1_000)
      .refine(
        (values) =>
          isStrictlySortedUnique(values.map((value) => value.capacityClass)),
        "capacity classes must be unique and sorted",
      ),
  })
  .strict()
  .superRefine((profile, ctx) => {
    if (
      computeFoundryProviderRequestProfileSha256(
        profile.providerRequestProfile,
      ) !== profile.providerRequestProfileSha256
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["providerRequestProfileSha256"],
        message: "lowering profile must bind the exact reviewed provider-request profile digest",
      });
    }
    if (
      profile.providerRequestProfile.providerKind !== "runpod" ||
      profile.providerRequestProfile.providerAdapterId !==
        RUNPOD_PODS_REST_V1_ADAPTER_ID ||
      profile.providerRequestProfile.providerAdapterVersion !==
        RUNPOD_PODS_REST_V1_ADAPTER_VERSION ||
      profile.providerRequestProfile.target.targetKind !== "remote_worker_pool"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["providerRequestProfile"],
        message: "RunPod lowering requires this exact RunPod adapter and a remote-worker-pool profile",
      });
    }
    if (
      profile.providerRequestProfile.supportedCommandKinds.includes(
        "provider_checkpoint",
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["providerRequestProfile", "supportedCommandKinds"],
        message: "RunPod Pods REST v1 does not support provider checkpoints",
      });
    }
    const adapterConfiguration = {
      schemaVersion: RUNPOD_PODS_REST_V1_ADAPTER_CONFIGURATION_V0,
      capacityClasses: profile.capacityClasses,
    };
    if (
      computeRunPodPodsRestV1AdapterConfigurationSha256(
        adapterConfiguration,
      ) !==
      profile.providerRequestProfile.providerAdapterConfigurationSha256
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [
          "providerRequestProfile",
          "providerAdapterConfigurationSha256",
        ],
        message: "RunPod lowering selectors do not match the durable adapter configuration digest",
      });
    }
    const configuredCapacityClasses = profile.capacityClasses.map(
      (capacity) => capacity.capacityClass,
    );
    if (
      configuredCapacityClasses.length !==
        profile.providerRequestProfile.allowedCapacityClasses.length ||
      configuredCapacityClasses.some(
        (capacityClass, index) =>
          capacityClass !==
          profile.providerRequestProfile.allowedCapacityClasses[index],
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["capacityClasses"],
        message: "RunPod selectors must cover exactly the reviewed capacity classes",
      });
    }
  });
export type RunPodPodsRestV1LoweringProfileV0 = z.infer<
  typeof RunPodPodsRestV1LoweringProfileV0Schema
>;

export interface RunPodPodsRestV1LoweringProfileRegistration {
  readonly profile: unknown;
  readonly loweringProfileSha256: string;
}

export interface RunPodPodsRestV1HttpRequest {
  readonly method: "POST" | "GET" | "DELETE";
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly bodyText: string | null;
}

export interface RunPodPodsRestV1HttpResponse {
  readonly status: number;
  /** Exact UTF-8 response text. It is hashed, parsed in memory, and never returned. */
  readonly bodyText: string;
}

export interface RunPodPodsRestV1HttpClient {
  /**
   * Perform exactly one HTTP request with redirects and retries disabled. The
   * implementation applies RunPod authorization out of band; credentials must
   * never be added to this request value or any durable command payload.
   */
  requestOnce(
    request: RunPodPodsRestV1HttpRequest,
    signal: AbortSignal,
  ): Promise<RunPodPodsRestV1HttpResponse>;
}

export interface RunPodPodsRestV1AdapterOptions {
  readonly providerAdapterArtifactSha256: string;
  readonly providerDeploymentSha256: string;
  readonly loweringProfiles: readonly RunPodPodsRestV1LoweringProfileRegistration[];
  /**
   * Sorted unique lookup pairs referenced by every live or effect-unknown
   * durable attempt. Startup is rejected unless every exact pair is
   * represented; additional expired historical profiles remain loadable.
   */
  readonly requiredLiveLoweringProfileBindings: readonly RunPodPodsRestV1RequiredLiveLoweringProfileBinding[];
  readonly httpClient: RunPodPodsRestV1HttpClient;
}

export const RunPodPodsRestV1RequiredLiveLoweringProfileBindingSchema = z
  .object({
    providerAdapterConfigurationSha256: RuntimeSha256Schema,
    providerRequestProfileSha256: RuntimeSha256Schema,
  })
  .strict();
export type RunPodPodsRestV1RequiredLiveLoweringProfileBinding = z.infer<
  typeof RunPodPodsRestV1RequiredLiveLoweringProfileBindingSchema
>;

const RequiredLiveLoweringProfileBindingsSchema = z
  .array(RunPodPodsRestV1RequiredLiveLoweringProfileBindingSchema)
  .max(1_000)
  .refine(
    (bindings) =>
      isStrictlySortedUnique(
        bindings.map((binding) =>
          loweringProfileKey(
            binding.providerAdapterConfigurationSha256,
            binding.providerRequestProfileSha256,
          )
        ),
      ),
    "required live lowering-profile bindings must be unique and sorted",
  );

const HttpResponseSchema = z
  .object({
    status: z.number().int().min(100).max(599),
    bodyText: z.string().max(8 * 1_024 * 1_024),
  })
  .strict();

const RunPodPodObservationSchema = z
  .object({
    id: RunPodPodIdSchema,
    name: z.string(),
    env: z.record(z.string(), z.unknown()),
    desiredStatus: z.enum(["RUNNING", "EXITED", "TERMINATED"]),
  })
  .passthrough();

const RunPodPodListSchema = z.array(RunPodPodObservationSchema).max(100_000);

function sha256Utf8(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function domainDigest(domain: string, value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(`${domain}\n${stableCanonicalJson(toCanonicalJson(value))}`, "utf8")
    .digest("hex")}`;
}

export function computeRunPodPodsRestV1AdapterConfigurationSha256(
  input: unknown,
): string {
  const configuration =
    RunPodPodsRestV1AdapterConfigurationV0Schema.parse(input);
  return domainDigest(
    RUNPOD_PODS_REST_V1_ADAPTER_CONFIGURATION_V0,
    configuration,
  );
}

export function computeRunPodPodsRestV1LoweringProfileSha256(
  input: unknown,
): string {
  const profile = RunPodPodsRestV1LoweringProfileV0Schema.parse(input);
  return domainDigest(RUNPOD_PODS_REST_V1_LOWERING_PROFILE_V0, profile);
}

export function runPodPodsRestV1DeterministicPodName(
  executionSubjectSha256Input: unknown,
  providerIdempotencyKeyInput: unknown,
): string {
  const executionSubjectSha256 = RuntimeSha256Schema.parse(
    executionSubjectSha256Input,
  );
  const providerIdempotencyKey = RuntimeManifestKeySchema.parse(
    providerIdempotencyKeyInput,
  );
  const subjectPrefix = executionSubjectSha256.slice("sha256:".length, 23);
  const idempotencyPrefix = createHash("sha256")
    .update(providerIdempotencyKey, "utf8")
    .digest("hex")
    .slice(0, 16);
  return `omnitwin-${subjectPrefix}-${idempotencyPrefix}`;
}

function responseEvidence(
  command: FoundryClaimedProviderCommandV0,
  request: RunPodPodsRestV1HttpRequest,
  response: RunPodPodsRestV1HttpResponse,
  classification: string,
): string {
  return domainDigest("omnitwin.foundry.runpod-pods-rest.response-evidence.v0", {
    adapterArtifactSha256: command.providerAdapterArtifactSha256,
    commandId: command.commandId,
    classification,
    deploymentSha256: command.providerDeploymentSha256,
    method: request.method,
    requestBodySha256:
      request.bodyText === null ? null : sha256Utf8(request.bodyText),
    responseBodySha256: sha256Utf8(response.bodyText),
    status: response.status,
    url: request.url,
  });
}

function internalEvidence(
  command: FoundryClaimedProviderCommandV0,
  classification: string,
  detail: string,
): string {
  return domainDigest("omnitwin.foundry.runpod-pods-rest.internal-evidence.v0", {
    adapterArtifactSha256: command.providerAdapterArtifactSha256,
    classification,
    commandId: command.commandId,
    deploymentSha256: command.providerDeploymentSha256,
    detail,
  });
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

function exactMarkersMatch(
  pod: z.infer<typeof RunPodPodObservationSchema>,
  executionSubjectSha256: string,
  providerIdempotencyKey: string,
  clientRequestId: string | null,
  providerRequestProfileSha256: string,
  remoteWorkerPoolId: string,
  expectedPodName: string,
): boolean {
  return (
    pod.name === expectedPodName &&
    pod.env.OMNITWIN_EXECUTION_SUBJECT_SHA256 === executionSubjectSha256 &&
    pod.env.OMNITWIN_PROVIDER_IDEMPOTENCY_KEY === providerIdempotencyKey &&
    (clientRequestId === null ||
      pod.env.OMNITWIN_CLIENT_REQUEST_ID === clientRequestId) &&
    pod.env.OMNITWIN_PROVIDER_REQUEST_PROFILE_SHA256 ===
      providerRequestProfileSha256 &&
    pod.env.OMNITWIN_REMOTE_WORKER_POOL_ID === remoteWorkerPoolId
  );
}

function providerRefForPodId(podId: string): string {
  return `runpod:${podId}`;
}

function podIdFromProviderRef(value: string | null): string | null {
  const parsed = RunPodProviderRefSchema.safeParse(value);
  return parsed.success ? parsed.data.slice("runpod:".length) : null;
}

function requestHeaders(hasBody: boolean): Readonly<Record<string, string>> {
  return hasBody
    ? { Accept: "application/json", "Content-Type": "application/json" }
    : { Accept: "application/json" };
}

function genericHttpOutcome(
  command: FoundryClaimedProviderCommandV0,
  request: RunPodPodsRestV1HttpRequest,
  response: RunPodPodsRestV1HttpResponse,
  operation: string,
): FoundryProviderAdapterOutcomeV0 {
  const definitelyRejected =
    response.status >= 400 &&
    response.status < 500 &&
    ![408, 409, 425, 429].includes(response.status);
  const status = definitelyRejected ? "failed" : "uncertain";
  const outcomeCode = definitelyRejected
    ? `runpod_${operation}_rejected_${String(response.status)}`
    : `runpod_${operation}_http_${String(response.status)}_unknown`;
  const providerLifecycle = response.status === 404 && operation === "poll"
    ? "not_found"
    : status === "uncertain"
      ? "unknown"
      : "not_observed";
  return {
    status,
    outcomeCode,
    providerLifecycle,
    providerCommandRef: command.payload.providerCommandRef,
    evidenceSha256: responseEvidence(command, request, response, outcomeCode),
  };
}

type RequestResult =
  | {
      readonly kind: "response";
      readonly response: RunPodPodsRestV1HttpResponse;
    }
  | {
      readonly kind: "outcome";
      readonly outcome: FoundryProviderAdapterOutcomeV0;
    };

class RunPodHttpAbortError extends Error {
  constructor() {
    super("RunPod HTTP request was aborted");
    this.name = "RunPodHttpAbortError";
  }
}

async function invokeHttpClientOnce(
  client: RunPodPodsRestV1HttpClient,
  request: RunPodPodsRestV1HttpRequest,
  signal: AbortSignal,
): Promise<RunPodPodsRestV1HttpResponse> {
  if (signal.aborted) throw new RunPodHttpAbortError();
  let abortHandler: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    abortHandler = () => {
      reject(new RunPodHttpAbortError());
    };
    signal.addEventListener("abort", abortHandler, { once: true });
  });
  try {
    return await Promise.race([
      client.requestOnce(request, signal),
      aborted,
    ]);
  } finally {
    if (abortHandler !== undefined) {
      signal.removeEventListener("abort", abortHandler);
    }
  }
}

async function requestOnce(
  client: RunPodPodsRestV1HttpClient,
  command: FoundryClaimedProviderCommandV0,
  request: RunPodPodsRestV1HttpRequest,
  signal: AbortSignal,
): Promise<RequestResult> {
  try {
    const response = HttpResponseSchema.parse(
      await invokeHttpClientOnce(client, request, signal),
    );
    return { kind: "response", response };
  } catch (error: unknown) {
    const outcomeCode = signal.aborted
      ? "runpod_http_timeout_unknown"
      : error instanceof z.ZodError
        ? "runpod_http_client_contract_unknown"
        : "runpod_http_network_unknown";
    return {
      kind: "outcome",
      outcome: {
        status: "uncertain",
        outcomeCode,
        providerLifecycle: "unknown",
        providerCommandRef: command.payload.providerCommandRef,
        evidenceSha256: internalEvidence(
          command,
          outcomeCode,
          error instanceof Error ? error.name : "unknown",
        ),
      },
    };
  }
}

type RunPodLoweredProviderRequest =
  | RunPodProviderSubmitRequestV0
  | RunPodProviderReconcileRequestV0
  | RunPodProviderPollRequestV0
  | RunPodProviderStopRequestV0;

type RunPodLoweringResult =
  | { readonly valid: true; readonly request: RunPodLoweredProviderRequest }
  | { readonly valid: false; readonly reasonCode: string };

type RunPodLoweringProfileMap = ReadonlyMap<
  string,
  RunPodPodsRestV1LoweringProfileV0
>;

function loweringProfileKey(
  providerAdapterConfigurationSha256: string,
  providerRequestProfileSha256: string,
): string {
  return `${providerAdapterConfigurationSha256}\n${providerRequestProfileSha256}`;
}

function profileRemoteWorkerPoolId(
  profile: RunPodPodsRestV1LoweringProfileV0,
): string {
  const target = profile.providerRequestProfile.target;
  if (target.targetKind !== "remote_worker_pool") {
    throw new Error("RunPod lowering profile lost its remote worker pool");
  }
  return target.poolId;
}

function commonTransientBinding(
  command: FoundryClaimedProviderCommandV0,
  profile: RunPodPodsRestV1LoweringProfileV0,
) {
  const authorization = command.payload.providerRequest;
  return {
    executionSubjectSha256: authorization.execution.executionSubjectSha256,
    providerIdempotencyKey:
      authorization.requestIdentity.providerIdempotencyKey,
    clientRequestId: authorization.requestIdentity.clientRequestId,
    providerRequestProfileSha256:
      authorization.provider.providerRequestProfileSha256,
    remoteWorkerPoolId: profileRemoteWorkerPoolId(profile),
  };
}

function exactLoweringProfileMatches(
  command: FoundryClaimedProviderCommandV0,
  profile: RunPodPodsRestV1LoweringProfileV0,
): boolean {
  const provider = command.payload.providerRequest.provider;
  const requestProfile = profile.providerRequestProfile;
  const remoteWorkerPoolId = profileRemoteWorkerPoolId(profile);
  return (
    provider.providerRequestProfileId === requestProfile.profileId &&
    provider.providerRequestProfileVersion ===
      requestProfile.profileVersion &&
    provider.providerRequestProfileSha256 ===
      profile.providerRequestProfileSha256 &&
    provider.providerAdapterConfigurationSha256 ===
      requestProfile.providerAdapterConfigurationSha256 &&
    command.providerAdapterConfigurationSha256 ===
      requestProfile.providerAdapterConfigurationSha256 &&
    provider.providerKind === requestProfile.providerKind &&
    provider.providerAdapterId === requestProfile.providerAdapterId &&
    provider.providerAdapterVersion === requestProfile.providerAdapterVersion &&
    provider.providerAdapterArtifactSha256 ===
      requestProfile.providerAdapterArtifactSha256 &&
    provider.providerDeploymentSha256 ===
      requestProfile.providerDeploymentSha256 &&
    provider.target.targetKind === "remote_worker_pool" &&
    provider.target.poolId === remoteWorkerPoolId &&
    command.payload.providerRequest.runtime.maximumApiCallSeconds ===
      requestProfile.maximumApiCallSeconds
  );
}

function loweringProfileAllowsAuthorization(
  command: FoundryClaimedProviderCommandV0,
  profile: RunPodPodsRestV1LoweringProfileV0,
): boolean {
  const authorization = command.payload.providerRequest;
  const requestProfile = profile.providerRequestProfile;
  const storageProfile = authorization.storage.objectStorageProfile;
  return (
    (storageProfile === null ||
      requestProfile.allowedObjectStorageProfiles.includes(storageProfile)) &&
    authorization.stages.every(
      (stage) =>
        requestProfile.allowedContainerImages.includes(stage.containerImage) &&
        requestProfile.allowedNetworkAccess.includes(stage.networkAccess) &&
        profile.capacityClasses.some(
          (capacity) => capacity.capacityClass === stage.capacityClass,
        ),
    )
  );
}

function lowerSubmitPod(
  command: FoundryClaimedProviderCommandV0,
  profile: RunPodPodsRestV1LoweringProfileV0,
): RunPodProviderSubmitRequestV0 | null {
  const authorization = command.payload.providerRequest;
  const firstStage = authorization.stages[0];
  if (firstStage === undefined) return null;
  if (
    authorization.stages.some(
      (stage) =>
        stage.containerImage !== firstStage.containerImage ||
        stage.capacityClass !== firstStage.capacityClass,
    )
  ) {
    return null;
  }
  const capacity = profile.capacityClasses.find(
    (candidate) => candidate.capacityClass === firstStage.capacityClass,
  );
  if (capacity === undefined) return null;

  const maximum = (
    select: (stage: (typeof authorization.stages)[number]) => number,
  ): number => Math.max(...authorization.stages.map(select));
  const gpuCount = maximum((stage) => stage.requestedResources.gpuCount);
  const cpuCores = maximum((stage) => stage.requestedResources.cpuCores);
  const ramGiB = maximum((stage) => stage.requestedResources.ramGiB);
  const scratchGiB = maximum((stage) => stage.requestedResources.scratchGiB);
  if (
    authorization.stages.some((stage) =>
      stage.requestedResources.cpuCores > stage.authorizedCapacity.cpuCores ||
      stage.requestedResources.ramGiB > stage.authorizedCapacity.ramGiB ||
      stage.requestedResources.gpuCount > stage.authorizedCapacity.gpuCount ||
      stage.requestedResources.minimumGpuVramGiB >
        stage.authorizedCapacity.perGpuVramGiB ||
      stage.requestedResources.scratchGiB >
        stage.authorizedCapacity.scratchGiB
    )
  ) {
    return null;
  }

  const commonPod = {
    name: runPodPodsRestV1DeterministicPodName(
      authorization.execution.executionSubjectSha256,
      authorization.requestIdentity.providerIdempotencyKey,
    ),
    imageName: firstStage.containerImage,
    cloudType: capacity.cloudType,
    containerDiskInGb: Math.ceil(scratchGiB),
    volumeInGb: 0,
    volumeMountPath: "/workspace",
    networkVolumeId: null,
    dockerEntrypoint: [] as const,
    dockerStartCmd: [] as const,
    env: {
      OMNITWIN_EXECUTION_SUBJECT_SHA256:
        authorization.execution.executionSubjectSha256,
      OMNITWIN_PROVIDER_IDEMPOTENCY_KEY:
        authorization.requestIdentity.providerIdempotencyKey,
      OMNITWIN_CLIENT_REQUEST_ID:
        authorization.requestIdentity.clientRequestId,
      OMNITWIN_PROVIDER_REQUEST_PROFILE_SHA256:
        authorization.provider.providerRequestProfileSha256,
      OMNITWIN_REMOTE_WORKER_POOL_ID: profileRemoteWorkerPoolId(profile),
    },
    interruptible: capacity.interruptible,
    locked: false as const,
    dataCenterIds: capacity.dataCenterIds,
    dataCenterPriority: "custom" as const,
  };
  const pod = capacity.computeType === "GPU"
    ? gpuCount > 0
      ? {
          ...commonPod,
          computeType: "GPU" as const,
          gpuCount,
          gpuTypeIds: capacity.gpuTypeIds,
          gpuTypePriority: "custom" as const,
          allowedCudaVersions: capacity.allowedCudaVersions,
          minRAMPerGPU: Math.ceil(ramGiB / gpuCount),
          minVCPUPerGPU: Math.ceil(cpuCores / gpuCount),
        }
      : null
    : gpuCount === 0
      ? {
          ...commonPod,
          computeType: "CPU" as const,
          vcpuCount: cpuCores,
          cpuFlavorIds: capacity.cpuFlavorIds,
          cpuFlavorPriority: "custom" as const,
        }
      : null;
  if (pod === null) return null;
  const parsed = RunPodProviderSubmitRequestV0Schema.safeParse({
    schemaVersion: RUNPOD_PROVIDER_SUBMIT_REQUEST_V0,
    ...commonTransientBinding(command, profile),
    pod,
  });
  return parsed.success ? parsed.data : null;
}

function lowerProviderRequest(
  command: FoundryClaimedProviderCommandV0,
  profiles: RunPodLoweringProfileMap,
): RunPodLoweringResult {
  const authorization = command.payload.providerRequest;
  const profile = profiles.get(
    loweringProfileKey(
      authorization.provider.providerAdapterConfigurationSha256,
      authorization.provider.providerRequestProfileSha256,
    ),
  );
  if (profile === undefined) {
    return {
      valid: false,
      reasonCode: "runpod_lowering_profile_unavailable",
    };
  }
  if (!exactLoweringProfileMatches(command, profile)) {
    return {
      valid: false,
      reasonCode: "runpod_lowering_profile_binding_mismatch",
    };
  }
  if (!loweringProfileAllowsAuthorization(command, profile)) {
    return {
      valid: false,
      reasonCode: "runpod_authorization_outside_profile",
    };
  }
  const binding = commonTransientBinding(command, profile);
  const expectedPodName = runPodPodsRestV1DeterministicPodName(
    binding.executionSubjectSha256,
    binding.providerIdempotencyKey,
  );
  switch (command.payload.commandKind) {
    case "provider_submit": {
      if (authorization.action.kind !== "provider_submit") {
        return { valid: false, reasonCode: "runpod_action_binding_mismatch" };
      }
      const request = lowerSubmitPod(command, profile);
      return request === null
        ? { valid: false, reasonCode: "runpod_submit_lowering_unsupported" }
        : { valid: true, request };
    }
    case "provider_reconcile": {
      const submitLineage = command.payload.submitLineage;
      if (
        authorization.action.kind !== "provider_reconcile" ||
        submitLineage === null ||
        authorization.action.submitCommandId !== submitLineage.submitCommandId ||
        authorization.action.submitProviderRequestAuthorizationSha256 !==
          submitLineage.providerRequestSha256 ||
        !RunPodProviderRefSchema.nullable().safeParse(
          authorization.action.providerCommandRef,
        ).success
      ) {
        return { valid: false, reasonCode: "runpod_action_binding_mismatch" };
      }
      const request = RunPodProviderReconcileRequestV0Schema.parse({
        schemaVersion: RUNPOD_PROVIDER_RECONCILE_REQUEST_V0,
        ...binding,
        expectedPodName,
        submitCommandId: authorization.action.submitCommandId,
        submitProviderRequestAuthorizationSha256:
          authorization.action.submitProviderRequestAuthorizationSha256,
        targetProviderCommandRef: authorization.action.providerCommandRef,
      });
      return { valid: true, request };
    }
    case "provider_poll": {
      if (authorization.action.kind !== "provider_poll") {
        return { valid: false, reasonCode: "runpod_action_binding_mismatch" };
      }
      const podId = podIdFromProviderRef(authorization.action.providerCommandRef);
      if (podId === null) {
        return { valid: false, reasonCode: "runpod_provider_ref_rejected" };
      }
      return {
        valid: true,
        request: RunPodProviderPollRequestV0Schema.parse({
          schemaVersion: RUNPOD_PROVIDER_POLL_REQUEST_V0,
          ...binding,
          expectedPodName,
          podId,
        }),
      };
    }
    case "provider_stop": {
      if (authorization.action.kind !== "provider_stop") {
        return { valid: false, reasonCode: "runpod_action_binding_mismatch" };
      }
      const podId = podIdFromProviderRef(authorization.action.providerCommandRef);
      if (podId === null) {
        return { valid: false, reasonCode: "runpod_provider_ref_rejected" };
      }
      return {
        valid: true,
        request: RunPodProviderStopRequestV0Schema.parse({
          schemaVersion: RUNPOD_PROVIDER_STOP_REQUEST_V0,
          ...binding,
          expectedPodName,
          podId,
          stopIntentId: authorization.action.stopIntentId,
        }),
      };
    }
    case "provider_checkpoint":
      return { valid: false, reasonCode: "runpod_checkpoint_unsupported" };
  }
}

function validateRequestBinding(
  command: FoundryClaimedProviderCommandV0,
  profiles: RunPodLoweringProfileMap,
): { readonly valid: true } | { readonly valid: false; readonly reasonCode: string } {
  const lowered = lowerProviderRequest(command, profiles);
  return lowered.valid
    ? { valid: true }
    : { valid: false, reasonCode: lowered.reasonCode };
}

function normalizedLifecycleForDesiredStatus(
  desiredStatus: z.infer<typeof RunPodPodObservationSchema>["desiredStatus"],
): "queued" | "exited" | "terminated" {
  switch (desiredStatus) {
    case "RUNNING":
      // RunPod exposes desired status, not proof that the workload is running.
      return "queued";
    case "EXITED":
      return "exited";
    case "TERMINATED":
      return "terminated";
  }
}

async function executeSubmit(
  client: RunPodPodsRestV1HttpClient,
  command: FoundryClaimedProviderCommandV0,
  providerRequest: RunPodProviderSubmitRequestV0,
  signal: AbortSignal,
): Promise<FoundryProviderAdapterOutcomeV0> {
  const podBody = providerRequest.pod.networkVolumeId === null
    ? Object.fromEntries(
        Object.entries(providerRequest.pod).filter(
          ([key]) => key !== "networkVolumeId",
        ),
      )
    : providerRequest.pod;
  const request: RunPodPodsRestV1HttpRequest = {
    method: "POST",
    url: `${RUNPOD_PODS_REST_V1_BASE_URL}/pods`,
    headers: requestHeaders(true),
    bodyText: stableCanonicalJson(toCanonicalJson(podBody)),
  };
  const result = await requestOnce(client, command, request, signal);
  if (result.kind === "outcome") return result.outcome;
  const { response } = result;
  if (response.status !== 201) {
    return genericHttpOutcome(command, request, response, "submit");
  }
  let parsed: z.SafeParseReturnType<unknown, z.infer<typeof RunPodPodObservationSchema>>;
  try {
    parsed = RunPodPodObservationSchema.safeParse(parseJson(response.bodyText));
  } catch {
    parsed = { success: false, error: new z.ZodError([]) };
  }
  if (
    !parsed.success ||
    !exactMarkersMatch(
      parsed.data,
      providerRequest.executionSubjectSha256,
      providerRequest.providerIdempotencyKey,
      providerRequest.clientRequestId,
      providerRequest.providerRequestProfileSha256,
      providerRequest.remoteWorkerPoolId,
      providerRequest.pod.name,
    )
  ) {
    const outcomeCode = "runpod_submit_response_identity_unknown";
    return {
      status: "uncertain",
      outcomeCode,
      providerLifecycle: "unknown",
      providerCommandRef: parsed.success
        ? providerRefForPodId(parsed.data.id)
        : null,
      evidenceSha256: responseEvidence(command, request, response, outcomeCode),
    };
  }
  const providerLifecycle = normalizedLifecycleForDesiredStatus(
    parsed.data.desiredStatus,
  );
  if (providerLifecycle !== "queued") {
    const outcomeCode = "runpod_submit_response_lifecycle_unknown";
    return {
      status: "uncertain",
      outcomeCode,
      providerLifecycle: "unknown",
      providerCommandRef: providerRefForPodId(parsed.data.id),
      evidenceSha256: responseEvidence(command, request, response, outcomeCode),
    };
  }
  const outcomeCode = "runpod_submit_accepted";
  return {
    status: "succeeded",
    outcomeCode,
    providerLifecycle,
    providerCommandRef: providerRefForPodId(parsed.data.id),
    evidenceSha256: responseEvidence(command, request, response, outcomeCode),
  };
}

async function executeReconcile(
  client: RunPodPodsRestV1HttpClient,
  command: FoundryClaimedProviderCommandV0,
  providerRequest: RunPodProviderReconcileRequestV0,
  signal: AbortSignal,
): Promise<FoundryProviderAdapterOutcomeV0> {
  const request: RunPodPodsRestV1HttpRequest = {
    method: "GET",
    url: `${RUNPOD_PODS_REST_V1_BASE_URL}/pods`,
    headers: requestHeaders(false),
    bodyText: null,
  };
  const result = await requestOnce(client, command, request, signal);
  if (result.kind === "outcome") return result.outcome;
  const { response } = result;
  if (response.status !== 200) {
    return genericHttpOutcome(command, request, response, "reconcile");
  }
  let parsed: z.SafeParseReturnType<unknown, z.infer<typeof RunPodPodListSchema>>;
  try {
    parsed = RunPodPodListSchema.safeParse(parseJson(response.bodyText));
  } catch {
    parsed = { success: false, error: new z.ZodError([]) };
  }
  if (!parsed.success) {
    const outcomeCode = "runpod_reconcile_response_unknown";
    return {
      status: "uncertain",
      outcomeCode,
      providerLifecycle: "unknown",
      providerCommandRef: command.payload.providerCommandRef,
      evidenceSha256: responseEvidence(command, request, response, outcomeCode),
    };
  }
  const matches = parsed.data.filter((pod) =>
    exactMarkersMatch(
      pod,
      providerRequest.executionSubjectSha256,
      providerRequest.providerIdempotencyKey,
      deriveFoundryProviderClientRequestId(
        "provider_submit",
        providerRequest.submitCommandId,
      ),
      providerRequest.providerRequestProfileSha256,
      providerRequest.remoteWorkerPoolId,
      providerRequest.expectedPodName,
    ) &&
    (providerRequest.targetProviderCommandRef === null ||
      providerRefForPodId(pod.id) === providerRequest.targetProviderCommandRef),
  );
  if (matches.length === 0) {
    const outcomeCode = "runpod_reconcile_not_found_unknown";
    return {
      status: "uncertain",
      outcomeCode,
      providerLifecycle: "unknown",
      providerCommandRef: command.payload.providerCommandRef,
      evidenceSha256: responseEvidence(command, request, response, outcomeCode),
    };
  }
  if (matches.length !== 1) {
    const outcomeCode = "runpod_reconcile_duplicate_identity_unknown";
    return {
      status: "uncertain",
      outcomeCode,
      providerLifecycle: "unknown",
      providerCommandRef: command.payload.providerCommandRef,
      evidenceSha256: responseEvidence(command, request, response, outcomeCode),
    };
  }
  const match = matches[0];
  if (match === undefined) {
    throw new Error("RunPod reconciliation match disappeared after exact filtering");
  }
  const outcomeCode = `runpod_reconcile_${match.desiredStatus.toLowerCase()}`;
  return {
    status: "succeeded",
    outcomeCode,
    providerLifecycle: normalizedLifecycleForDesiredStatus(match.desiredStatus),
    providerCommandRef: providerRefForPodId(match.id),
    evidenceSha256: responseEvidence(command, request, response, outcomeCode),
  };
}

async function executePoll(
  client: RunPodPodsRestV1HttpClient,
  command: FoundryClaimedProviderCommandV0,
  providerRequest: RunPodProviderPollRequestV0,
  signal: AbortSignal,
): Promise<FoundryProviderAdapterOutcomeV0> {
  const request: RunPodPodsRestV1HttpRequest = {
    method: "GET",
    url: `${RUNPOD_PODS_REST_V1_BASE_URL}/pods/${encodeURIComponent(providerRequest.podId)}`,
    headers: requestHeaders(false),
    bodyText: null,
  };
  const result = await requestOnce(client, command, request, signal);
  if (result.kind === "outcome") return result.outcome;
  const { response } = result;
  if (response.status !== 200) {
    return genericHttpOutcome(command, request, response, "poll");
  }
  let parsed: z.SafeParseReturnType<unknown, z.infer<typeof RunPodPodObservationSchema>>;
  try {
    parsed = RunPodPodObservationSchema.safeParse(parseJson(response.bodyText));
  } catch {
    parsed = { success: false, error: new z.ZodError([]) };
  }
  if (
    !parsed.success ||
    parsed.data.id !== providerRequest.podId ||
    !exactMarkersMatch(
      parsed.data,
      providerRequest.executionSubjectSha256,
      providerRequest.providerIdempotencyKey,
      null,
      providerRequest.providerRequestProfileSha256,
      providerRequest.remoteWorkerPoolId,
      providerRequest.expectedPodName,
    )
  ) {
    const outcomeCode = "runpod_poll_response_identity_unknown";
    return {
      status: "uncertain",
      outcomeCode,
      providerLifecycle: "unknown",
      providerCommandRef: command.payload.providerCommandRef,
      evidenceSha256: responseEvidence(command, request, response, outcomeCode),
    };
  }
  const outcomeCode = `runpod_poll_${parsed.data.desiredStatus.toLowerCase()}`;
  return {
    status: "succeeded",
    outcomeCode,
    providerLifecycle: normalizedLifecycleForDesiredStatus(
      parsed.data.desiredStatus,
    ),
    providerCommandRef: providerRefForPodId(parsed.data.id),
    evidenceSha256: responseEvidence(command, request, response, outcomeCode),
  };
}

async function executeStop(
  client: RunPodPodsRestV1HttpClient,
  command: FoundryClaimedProviderCommandV0,
  providerRequest: RunPodProviderStopRequestV0,
  signal: AbortSignal,
): Promise<FoundryProviderAdapterOutcomeV0> {
  const request: RunPodPodsRestV1HttpRequest = {
    method: "DELETE",
    url: `${RUNPOD_PODS_REST_V1_BASE_URL}/pods/${encodeURIComponent(providerRequest.podId)}`,
    headers: requestHeaders(false),
    bodyText: null,
  };
  const result = await requestOnce(client, command, request, signal);
  if (result.kind === "outcome") return result.outcome;
  const { response } = result;
  if (response.status === 204 || response.status === 404) {
    const outcomeCode = response.status === 204
      ? "runpod_terminate_accepted"
      : "runpod_terminate_already_absent";
    return {
      status: "succeeded",
      outcomeCode,
      providerLifecycle: response.status === 204 ? "terminated" : "not_found",
      providerCommandRef: providerRefForPodId(providerRequest.podId),
      evidenceSha256: responseEvidence(command, request, response, outcomeCode),
    };
  }
  return genericHttpOutcome(command, request, response, "terminate");
}

function deepFreezeJson<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreezeJson(child);
    }
    Object.freeze(value);
  }
  return value;
}

function parseLoweringProfiles(
  registrations: readonly RunPodPodsRestV1LoweringProfileRegistration[],
  providerAdapterArtifactSha256: string,
  providerDeploymentSha256: string,
  requiredLiveLoweringProfileBindingsInput: readonly RunPodPodsRestV1RequiredLiveLoweringProfileBinding[],
): RunPodLoweringProfileMap {
  if (registrations.length === 0 || registrations.length > 1_000) {
    throw new Error("RunPod adapter requires 1-1000 immutable lowering profiles");
  }
  const requiredLiveLoweringProfileBindings =
    RequiredLiveLoweringProfileBindingsSchema.parse(
      requiredLiveLoweringProfileBindingsInput,
    );
  const profiles = new Map<string, RunPodPodsRestV1LoweringProfileV0>();
  for (const registration of registrations) {
    const profile = RunPodPodsRestV1LoweringProfileV0Schema.parse(
      registration.profile,
    );
    const suppliedSha256 = RuntimeSha256Schema.parse(
      registration.loweringProfileSha256,
    );
    if (
      computeRunPodPodsRestV1LoweringProfileSha256(profile) !==
      suppliedSha256
    ) {
      throw new Error("RunPod lowering profile digest mismatch");
    }
    if (
      profile.providerRequestProfile.providerAdapterArtifactSha256 !==
        providerAdapterArtifactSha256 ||
      profile.providerRequestProfile.providerDeploymentSha256 !==
        providerDeploymentSha256
    ) {
      throw new Error("RunPod lowering profile adapter binding mismatch");
    }
    const providerAdapterConfigurationSha256 =
      profile.providerRequestProfile.providerAdapterConfigurationSha256;
    const key = loweringProfileKey(
      providerAdapterConfigurationSha256,
      profile.providerRequestProfileSha256,
    );
    if (profiles.has(key)) {
      throw new Error(
        "Duplicate RunPod adapter-configuration/provider-request profile binding",
      );
    }
    profiles.set(key, deepFreezeJson(profile));
  }
  const missingBinding = requiredLiveLoweringProfileBindings.find(
    (binding) =>
      !profiles.has(
        loweringProfileKey(
          binding.providerAdapterConfigurationSha256,
          binding.providerRequestProfileSha256,
        ),
      ),
  );
  if (missingBinding !== undefined) {
    throw new Error(
      "Required live RunPod lowering-profile binding is unavailable: " +
        `${missingBinding.providerAdapterConfigurationSha256}/` +
        missingBinding.providerRequestProfileSha256,
    );
  }
  return profiles;
}

export function createRunPodPodsRestV1Adapter(
  options: RunPodPodsRestV1AdapterOptions,
): FoundryProviderCommandAdapter {
  const providerAdapterArtifactSha256 = RuntimeSha256Schema.parse(
    options.providerAdapterArtifactSha256,
  );
  const providerDeploymentSha256 = RuntimeSha256Schema.parse(
    options.providerDeploymentSha256,
  );
  const providerAdapterVersion = FoundryProviderAdapterVersionSchema.parse(
    RUNPOD_PODS_REST_V1_ADAPTER_VERSION,
  );
  const loweringProfiles = parseLoweringProfiles(
    options.loweringProfiles,
    providerAdapterArtifactSha256,
    providerDeploymentSha256,
    options.requiredLiveLoweringProfileBindings,
  );
  const claimBindingKey = (binding: {
    readonly providerKind: string;
    readonly providerAdapterId: string;
    readonly providerAdapterVersion: string;
    readonly providerAdapterArtifactSha256: string;
    readonly providerAdapterConfigurationSha256: string;
    readonly providerDeploymentSha256: string;
    readonly providerRequestProfileId: string;
    readonly providerRequestProfileVersion: string;
    readonly providerRequestProfileSha256: string;
    readonly targetKind: string;
    readonly targetId: string;
  }): string => [
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
  const claimBindings = deepFreezeJson(
    FoundryProviderAdapterClaimBindingsV0Schema.parse(
      [...loweringProfiles.values()]
        .map((profile) => ({
          providerKind: "runpod" as const,
          providerAdapterId: RUNPOD_PODS_REST_V1_ADAPTER_ID,
          providerAdapterVersion,
          providerAdapterArtifactSha256,
          providerAdapterConfigurationSha256:
            profile.providerRequestProfile.providerAdapterConfigurationSha256,
          providerDeploymentSha256,
          providerRequestProfileId: profile.providerRequestProfile.profileId,
          providerRequestProfileVersion:
            profile.providerRequestProfile.profileVersion,
          providerRequestProfileSha256: profile.providerRequestProfileSha256,
          targetKind: "remote_worker_pool" as const,
          targetId: profile.providerRequestProfile.target.targetKind ===
              "remote_worker_pool"
            ? profile.providerRequestProfile.target.poolId
            : "",
        }))
        .sort((left, right) => {
          const leftKey = claimBindingKey(left);
          const rightKey = claimBindingKey(right);
          return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
        }),
    ),
  );

  const adapter: FoundryProviderCommandAdapter = {
    providerKind: "runpod",
    providerAdapterId: RUNPOD_PODS_REST_V1_ADAPTER_ID,
    providerAdapterVersion,
    providerAdapterArtifactSha256,
    providerDeploymentSha256,
    claimBindings,
    validateClaimedCommand(command) {
      const parsed = FoundryClaimedProviderCommandV0Schema.safeParse(command);
      if (!parsed.success) {
        return { valid: false, reasonCode: "runpod_claim_schema_rejected" };
      }
      if (
        parsed.data.providerKind !== "runpod" ||
        parsed.data.providerAdapterId !== RUNPOD_PODS_REST_V1_ADAPTER_ID ||
        parsed.data.providerAdapterVersion !== providerAdapterVersion ||
        parsed.data.providerAdapterArtifactSha256 !==
          providerAdapterArtifactSha256 ||
        parsed.data.providerDeploymentSha256 !== providerDeploymentSha256
      ) {
        return { valid: false, reasonCode: "runpod_adapter_binding_mismatch" };
      }
      return validateRequestBinding(parsed.data, loweringProfiles);
    },
    async executeClaimedCommand(command, signal) {
      const validation = adapter.validateClaimedCommand(command);
      if (!validation.valid) {
        return {
          status: "failed",
          outcomeCode: validation.reasonCode,
          providerLifecycle: "not_observed",
          providerCommandRef: command.payload.providerCommandRef,
          evidenceSha256: internalEvidence(
            command,
            validation.reasonCode,
            "pre_invocation_validation",
          ),
        };
      }
      // Work only from the schema-cloned snapshot after validation so caller
      // mutation cannot change the provider request between checks and I/O.
      const safeCommand = FoundryClaimedProviderCommandV0Schema.parse(command);
      const lowered = lowerProviderRequest(safeCommand, loweringProfiles);
      if (!lowered.valid) {
        return {
          status: "failed",
          outcomeCode: lowered.reasonCode,
          providerLifecycle: "not_observed",
          providerCommandRef: safeCommand.payload.providerCommandRef,
          evidenceSha256: internalEvidence(
            safeCommand,
            lowered.reasonCode,
            "pre_invocation_lowering",
          ),
        };
      }
      switch (safeCommand.payload.commandKind) {
        case "provider_submit":
          return executeSubmit(
            options.httpClient,
            safeCommand,
            RunPodProviderSubmitRequestV0Schema.parse(lowered.request),
            signal,
          );
        case "provider_reconcile":
          return executeReconcile(
            options.httpClient,
            safeCommand,
            RunPodProviderReconcileRequestV0Schema.parse(lowered.request),
            signal,
          );
        case "provider_poll":
          return executePoll(
            options.httpClient,
            safeCommand,
            RunPodProviderPollRequestV0Schema.parse(lowered.request),
            signal,
          );
        case "provider_stop":
          return executeStop(
            options.httpClient,
            safeCommand,
            RunPodProviderStopRequestV0Schema.parse(lowered.request),
            signal,
          );
        case "provider_checkpoint":
          return {
            status: "failed",
            outcomeCode: "runpod_checkpoint_unsupported",
            providerLifecycle: "not_observed",
            providerCommandRef: safeCommand.payload.providerCommandRef,
            evidenceSha256: internalEvidence(
              safeCommand,
              "runpod_checkpoint_unsupported",
              "pre_invocation_validation",
            ),
          };
      }
    },
  };
  return Object.freeze(adapter);
}
