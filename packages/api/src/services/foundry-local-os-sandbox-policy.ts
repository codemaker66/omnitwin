import { createHash } from "node:crypto";
import {
  RuntimeManifestKeySchema,
  RuntimeSha256Schema,
} from "@omnitwin/types";
import {
  stableCanonicalJson,
  toCanonicalJson,
} from "@omnitwin/reconstruction-foundry";
import { z } from "zod";
import {
  FOUNDRY_LOCAL_SANDBOX_RESOURCE_MARKER_V0,
  FoundryLocalSandboxExecutionRequestV0Schema,
  type FoundryLocalSandboxExecutionRequestV0,
} from "./foundry-local-command-adapter.js";

export const FOUNDRY_LOCAL_OS_SANDBOX_POLICY_V0 =
  "omnitwin.foundry.local-os-sandbox-policy.v0";
export const FOUNDRY_LOCAL_OS_SANDBOX_INSTANCE_SPEC_V0 =
  "omnitwin.foundry.local-os-sandbox-instance-spec.v0";

const GiB = 1_073_741_824;

function domainDigest(domain: string, value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(`${domain}\n${stableCanonicalJson(toCanonicalJson(value))}`, "utf8")
    .digest("hex")}`;
}

const HardLimitSchema = z
  .object({
    maximumCpuCores: z.number().int().positive().max(64),
    maximumMemoryBytes: z.number().int().safe().positive(),
    memorySwapMode: z.literal("disabled_equal_to_memory"),
    maximumPids: z.number().int().positive().max(1_024),
    maximumPerProcessOpenFiles: z.number().int().positive().max(65_536),
    maximumFileBytes: z.number().int().safe().positive(),
    maximumPersistedStdoutBytes: z.literal(0),
    maximumPersistedStderrBytes: z.literal(0),
    maximumPerProcessCpuSeconds: z.number().int().positive().max(86_400),
    maximumObservedWallClockSeconds: z.number().int().positive().max(86_400),
    terminationGraceSeconds: z.number().int().positive().max(60),
    sharedMemoryBytes: z.number().int().positive().max(16_777_216),
  })
  .strict()
  .superRefine((limits, ctx) => {
    if (limits.maximumFileBytes > limits.maximumMemoryBytes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maximumFileBytes"],
        message: "sandbox file limit must not exceed its hard memory limit",
      });
    }
    if (
      limits.terminationGraceSeconds >=
        limits.maximumObservedWallClockSeconds
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["terminationGraceSeconds"],
        message: "sandbox termination grace must be shorter than its wall deadline",
      });
    }
  });

const PolicyPayloadSchema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_LOCAL_OS_SANDBOX_POLICY_V0),
    policyId: RuntimeManifestKeySchema,
    policyVersion: RuntimeManifestKeySchema,
    runnerArtifactSha256: RuntimeSha256Schema,
    runnerConfigurationSha256: RuntimeSha256Schema,
    securityProfileSha256: RuntimeSha256Schema,
    providerKind: z.literal("local_cpu"),
    workerRole: z.literal("normalize_mesh"),
    stageKind: z.literal("geometry"),
    operationClass: z.literal("deterministic_transformation"),
    expectedOutputName: RuntimeManifestKeySchema,
    persistentOutputFileName: z.literal("normalized.glb"),
    containerPlatform: z.literal("linux/amd64"),
    containerRuntime: z.literal("runc"),
    imagePullPolicy: z.literal("never"),
    rootFilesystem: z.literal("read_only"),
    inputMount: z.literal("engine_volume_read_only"),
    outputMount: z.literal("engine_volume_pre_reserved_single_file"),
    networkMode: z.literal("none"),
    socketSyscalls: z.literal("denied_by_pinned_seccomp"),
    inheritedEnvironment: z.literal("cleared"),
    stdin: z.literal("closed"),
    tty: z.literal("disabled"),
    logDriver: z.literal("none"),
    stdioEnforcement: z.literal(
      "persistence_disabled_emission_unmetered",
    ),
    healthcheck: z.literal("disabled"),
    restartPolicy: z.literal("no"),
    terminationSignal: z.literal("SIGTERM"),
    userId: z.number().int().min(1).max(65_534),
    groupId: z.number().int().min(1).max(65_534),
    capabilities: z.tuple([z.literal("ALL")]),
    noNewPrivileges: z.literal(true),
    ipcMode: z.literal("none"),
    pidNamespace: z.literal("private_default"),
    cgroupNamespace: z.literal("private"),
    imageDeclaredVolumes: z.literal("rejected_or_shadowed_inaccessible"),
    wallClockEnforcement: z.literal(
      "reconcile_poll_only_not_continuous",
    ),
    processTreeEvidence: z.literal("docker_stopped_init_pid_only"),
    nativeWindowsCustody: z.literal("not_proved"),
    linuxSecurityModule: z.literal("not_proved"),
    semanticNormalization: z.literal("not_proved_by_transport_fixture"),
    hardLimits: HardLimitSchema,
    proofScope: z.literal("docker_desktop_linux_transport_only"),
    productionWiring: z.literal("not_authorized"),
  })
  .strict();

export const FoundryLocalOsSandboxPolicyV0Schema = PolicyPayloadSchema.extend({
  policySha256: RuntimeSha256Schema,
})
  .strict()
  .superRefine((policy, ctx) => {
    const { policySha256: _policySha256, ...payload } = policy;
    if (policy.policySha256 !== computeFoundryLocalOsSandboxPolicySha256(payload)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["policySha256"],
        message: "local OS sandbox policy digest must match its exact payload",
      });
    }
  });
export type FoundryLocalOsSandboxPolicyV0 = z.infer<
  typeof FoundryLocalOsSandboxPolicyV0Schema
>;

export function computeFoundryLocalOsSandboxPolicySha256(input: unknown): string {
  return domainDigest(
    "OMNITWIN_FOUNDRY_LOCAL_OS_SANDBOX_POLICY_V0",
    PolicyPayloadSchema.parse(input),
  );
}

const SourceBindingSchema = z
  .object({
    assetId: RuntimeManifestKeySchema,
    sourceRawSha256: RuntimeSha256Schema,
    sourceByteLength: z.number().int().safe().positive(),
    sourceVersion: z.string().trim().min(1).max(240),
  })
  .strict();

const OutputReservationSchema = z
  .object({
    reservationId: z.string().uuid(),
    reservationSha256: RuntimeSha256Schema,
    outputSlot: z.literal("normalized_mesh_glb"),
    maximumOutputBytes: z.number().int().safe().positive(),
  })
  .strict();

const InstanceSpecPayloadSchema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_LOCAL_OS_SANDBOX_INSTANCE_SPEC_V0),
    policySha256: RuntimeSha256Schema,
    providerKind: z.literal("local_cpu"),
    durableResourceMarker: z
      .object({
        schemaVersion: z.literal(FOUNDRY_LOCAL_SANDBOX_RESOURCE_MARKER_V0),
        providerKind: z.literal("local_cpu"),
        executionSubjectSha256: RuntimeSha256Schema,
        providerIdempotencyKey: RuntimeManifestKeySchema,
        markerSha256: RuntimeSha256Schema,
      })
      .strict(),
    executionId: z.string().uuid(),
    attemptId: z.string().uuid(),
    attemptOrdinal: z.literal(1),
    fencingToken: z.string().regex(/^[1-9][0-9]*$/u),
    subjectId: RuntimeManifestKeySchema,
    projectId: RuntimeManifestKeySchema,
    jobId: RuntimeManifestKeySchema,
    reviewedIngestManifestSha256: RuntimeSha256Schema,
    intakeAdmissionResultSha256: RuntimeSha256Schema,
    intakeStagingIndexSha256: RuntimeSha256Schema,
    executionEnvelopeSha256: RuntimeSha256Schema,
    rightsApprovalSha256: RuntimeSha256Schema,
    rightsPolicyEvidenceSha256: RuntimeSha256Schema,
    providerDeploymentSha256: RuntimeSha256Schema,
    runnerProfileId: RuntimeManifestKeySchema,
    stageId: z.literal("normalize_mesh"),
    stageLeaseIdentitySha256: RuntimeSha256Schema,
    workerProfileId: RuntimeManifestKeySchema,
    workerProfileVersion: RuntimeManifestKeySchema,
    workerProfileSha256: RuntimeSha256Schema,
    workerImage: z.string().max(512).regex(/@sha256:[a-f0-9]{64}$/u),
    workerCommand: z.array(z.string().min(1).max(2_048)).min(1).max(1_000),
    source: SourceBindingSchema,
    output: OutputReservationSchema,
    authorizedOutputPrefix: z.string().min(1).max(1_024),
    isolatedOutputPrefix: z.string().min(1).max(1_024),
    cpuCores: z.number().int().positive().max(64),
    memoryBytes: z.number().int().safe().positive(),
    scratchGiB: z.number().int().positive().max(1_000_000),
    maximumRuntimeSeconds: z.number().int().positive().max(86_400),
    hardLimits: HardLimitSchema,
    proofLimitations: z
      .object({
        stdioEnforcement: z.literal(
          "persistence_disabled_emission_unmetered",
        ),
        wallClockEnforcement: z.literal(
          "reconcile_poll_only_not_continuous",
        ),
        processTreeEvidence: z.literal("docker_stopped_init_pid_only"),
        nativeWindowsCustody: z.literal("not_proved"),
        linuxSecurityModule: z.literal("not_proved"),
        semanticNormalization: z.literal(
          "not_proved_by_transport_fixture",
        ),
      })
      .strict(),
    authority: z.literal("none"),
    capabilities: z
      .object({
        executionActivation: z.literal("absent"),
        databaseAdmission: z.literal("not_proved"),
        outputCustody: z.literal("test_only_untrusted_for_release"),
        signing: z.literal("not_authorized"),
        publication: z.literal("not_authorized"),
        promotion: z.literal("not_authorized"),
      })
      .strict(),
  })
  .strict();

export const FoundryLocalOsSandboxInstanceSpecV0Schema =
  InstanceSpecPayloadSchema.extend({
    instanceSpecSha256: RuntimeSha256Schema,
  })
    .strict()
    .superRefine((spec, ctx) => {
      const { instanceSpecSha256: _instanceSpecSha256, ...payload } = spec;
      if (
        spec.instanceSpecSha256 !==
          computeFoundryLocalOsSandboxInstanceSpecSha256(payload)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["instanceSpecSha256"],
          message: "local OS sandbox instance digest must match its exact payload",
        });
      }
    });
export type FoundryLocalOsSandboxInstanceSpecV0 = z.infer<
  typeof FoundryLocalOsSandboxInstanceSpecV0Schema
>;

export function computeFoundryLocalOsSandboxInstanceSpecSha256(
  input: unknown,
): string {
  return domainDigest(
    "OMNITWIN_FOUNDRY_LOCAL_OS_SANDBOX_INSTANCE_SPEC_V0",
    InstanceSpecPayloadSchema.parse(input),
  );
}

export interface CompileFoundryLocalOsSandboxInstanceSpecInput {
  readonly request: unknown;
  readonly policy: unknown;
  readonly source: unknown;
  readonly output: unknown;
}

function reject(message: string): never {
  throw new Error(`LOCAL_OS_SANDBOX_POLICY_REJECTED: ${message}`);
}

export function compileFoundryLocalOsSandboxInstanceSpec(
  input: CompileFoundryLocalOsSandboxInstanceSpecInput,
): FoundryLocalOsSandboxInstanceSpecV0 {
  const request = FoundryLocalSandboxExecutionRequestV0Schema.parse(
    input.request,
  ) as FoundryLocalSandboxExecutionRequestV0;
  const policy = FoundryLocalOsSandboxPolicyV0Schema.parse(input.policy);
  const source = SourceBindingSchema.parse(input.source);
  const output = OutputReservationSchema.parse(input.output);
  const authorization = request.authorization;
  const terminalEnforcement = request.sandbox.terminalEnforcement;
  if (
    terminalEnforcement.mode !== "required" ||
    terminalEnforcement.policySha256 !== policy.policySha256 ||
    terminalEnforcement.securityProfileSha256 !==
      policy.securityProfileSha256
  ) {
    reject("terminal receipt policy and security profile must be bound exactly");
  }
  const stage = authorization.stages[0];
  if (stage === undefined || authorization.stages.length !== 1) {
    reject("proof policy permits exactly one stage");
  }
  if (
    request.providerKind !== policy.providerKind ||
    authorization.provider.providerKind !== policy.providerKind
  ) {
    reject("proof policy permits local CPU only");
  }
  if (
    stage.stageId !== policy.workerRole ||
    stage.stageKind !== policy.stageKind ||
    stage.operationClass !== policy.operationClass ||
    stage.dependsOn.length !== 0
  ) {
    reject("stage identity, kind, operation, and singleton DAG must match policy");
  }
  if (
    stage.networkAccess !== policy.networkMode ||
    stage.checkpoint !== "none" ||
    stage.resumable ||
    stage.requestedResources.gpuCount !== 0 ||
    stage.requestedResources.minimumGpuVramGiB !== 0
  ) {
    reject("stage must be CPU-only, network-none, non-resumable, and checkpoint-free");
  }
  if (
    stage.inputAssetIds.length !== 1 ||
    stage.inputAssetIds[0] !== source.assetId ||
    stage.outputNames.length !== 1 ||
    stage.outputNames[0] !== policy.expectedOutputName
  ) {
    reject("stage must bind the one source and one declared output");
  }
  const memoryBytes = stage.requestedResources.ramGiB * GiB;
  if (
    stage.requestedResources.cpuCores > policy.hardLimits.maximumCpuCores ||
    memoryBytes > policy.hardLimits.maximumMemoryBytes ||
    output.maximumOutputBytes > policy.hardLimits.maximumFileBytes ||
    stage.maximumRuntimeSeconds >
      policy.hardLimits.maximumObservedWallClockSeconds
  ) {
    reject("authorized workload exceeds the independently reviewed hard policy");
  }
  const stageLeaseIdentitySha256 = domainDigest(
    "OMNITWIN_FOUNDRY_LOCAL_OS_SANDBOX_STAGE_LEASE_V0",
    {
      executionId: authorization.execution.executionId,
      attemptId: authorization.execution.attemptId,
      fencingToken: authorization.execution.fencingToken.toString(),
      stage,
      workerRunnerProfileId: request.sandbox.runnerProfileId,
      reviewedIngestManifestSha256:
        authorization.evidence.reviewedIngestManifestSha256,
      intakeStagingIndexSha256:
        authorization.evidence.intakeStagingIndexSha256,
      source,
      output,
    },
  );
  const payload = InstanceSpecPayloadSchema.parse({
    schemaVersion: FOUNDRY_LOCAL_OS_SANDBOX_INSTANCE_SPEC_V0,
    policySha256: policy.policySha256,
    providerKind: "local_cpu",
    durableResourceMarker: request.durableResourceMarker,
    executionId: authorization.execution.executionId,
    attemptId: authorization.execution.attemptId,
    attemptOrdinal: authorization.execution.attemptOrdinal,
    fencingToken: authorization.execution.fencingToken.toString(),
    subjectId: authorization.execution.subjectId,
    projectId: authorization.execution.projectId,
    jobId: authorization.execution.jobId,
    reviewedIngestManifestSha256:
      authorization.evidence.reviewedIngestManifestSha256,
    intakeAdmissionResultSha256:
      authorization.evidence.intakeAdmissionResultSha256,
    intakeStagingIndexSha256:
      authorization.evidence.intakeStagingIndexSha256,
    executionEnvelopeSha256: authorization.evidence.executionEnvelopeSha256,
    rightsApprovalSha256: authorization.rights.rightsApprovalSha256,
    rightsPolicyEvidenceSha256:
      authorization.rights.rightsPolicyEvidenceSha256,
    providerDeploymentSha256:
      authorization.provider.providerDeploymentSha256,
    runnerProfileId: request.sandbox.runnerProfileId,
    stageId: "normalize_mesh",
    stageLeaseIdentitySha256,
    workerProfileId: stage.workerProfileId,
    workerProfileVersion: stage.workerProfileVersion,
    workerProfileSha256: stage.workerProfileSha256,
    workerImage: stage.containerImage,
    workerCommand: stage.command,
    source,
    output,
    authorizedOutputPrefix: request.sandbox.output.authorizedPrefix,
    isolatedOutputPrefix: request.sandbox.output.isolatedPrefix,
    cpuCores: stage.requestedResources.cpuCores,
    memoryBytes,
    scratchGiB: stage.requestedResources.scratchGiB,
    maximumRuntimeSeconds: stage.maximumRuntimeSeconds,
    hardLimits: policy.hardLimits,
    proofLimitations: {
      stdioEnforcement: policy.stdioEnforcement,
      wallClockEnforcement: policy.wallClockEnforcement,
      processTreeEvidence: policy.processTreeEvidence,
      nativeWindowsCustody: policy.nativeWindowsCustody,
      linuxSecurityModule: policy.linuxSecurityModule,
      semanticNormalization: policy.semanticNormalization,
    },
    authority: "none",
    capabilities: {
      executionActivation: "absent",
      databaseAdmission: "not_proved",
      outputCustody: "test_only_untrusted_for_release",
      signing: "not_authorized",
      publication: "not_authorized",
      promotion: "not_authorized",
    },
  });
  return FoundryLocalOsSandboxInstanceSpecV0Schema.parse({
    ...payload,
    instanceSpecSha256:
      computeFoundryLocalOsSandboxInstanceSpecSha256(payload),
  });
}
