import { describe, expect, it } from "vitest";
import {
  FoundryLocalSandboxExecutionRequestV0Schema,
} from "../../services/foundry-local-command-adapter.js";
import {
  FoundryLocalOsSandboxInstanceSpecV0Schema,
  FoundryLocalOsSandboxPolicyV0Schema,
  compileFoundryLocalOsSandboxInstanceSpec,
} from "../../services/foundry-local-os-sandbox-policy.js";
import {
  createLocalOsSandboxFixturePolicy,
  createLocalOsSandboxFixtureRequest,
  LOCAL_SANDBOX_FIXTURE_OUTPUT_RESERVATION,
  LOCAL_SANDBOX_FIXTURE_SOURCE_BINDING,
} from "../support/foundry-local-os-sandbox-fixture.js";

function compile() {
  return compileFoundryLocalOsSandboxInstanceSpec({
    request: createLocalOsSandboxFixtureRequest(),
    policy: createLocalOsSandboxFixturePolicy(),
    source: LOCAL_SANDBOX_FIXTURE_SOURCE_BINDING,
    output: LOCAL_SANDBOX_FIXTURE_OUTPUT_RESERVATION,
  });
}

describe("Foundry production-disabled local OS sandbox policy", () => {
  it("binds one CPU/network-none normalization lease without release authority", () => {
    const first = compile();
    const second = compile();
    expect(second).toEqual(first);
    expect(first).toMatchObject({
      providerKind: "local_cpu",
      stageId: "normalize_mesh",
      cpuCores: 1,
      memoryBytes: 1_073_741_824,
      source: LOCAL_SANDBOX_FIXTURE_SOURCE_BINDING,
      output: LOCAL_SANDBOX_FIXTURE_OUTPUT_RESERVATION,
      authority: "none",
      proofLimitations: {
        stdioEnforcement: "persistence_disabled_emission_unmetered",
        wallClockEnforcement: "reconcile_poll_only_not_continuous",
        processTreeEvidence: "docker_stopped_init_pid_only",
        nativeWindowsCustody: "not_proved",
        linuxSecurityModule: "not_proved",
        semanticNormalization: "not_proved_by_transport_fixture",
      },
      capabilities: {
        executionActivation: "absent",
        databaseAdmission: "not_proved",
        outputCustody: "test_only_untrusted_for_release",
        signing: "not_authorized",
        publication: "not_authorized",
        promotion: "not_authorized",
      },
    });
    expect(FoundryLocalOsSandboxInstanceSpecV0Schema.parse(first)).toEqual(first);
    expect(first.stageLeaseIdentitySha256).not.toBe(first.instanceSpecSha256);
  });

  it("rejects re-digested policy or instance substitutions", () => {
    const policy = createLocalOsSandboxFixturePolicy();
    expect(FoundryLocalOsSandboxPolicyV0Schema.safeParse({
      ...policy,
      hardLimits: { ...policy.hardLimits, maximumPids: 17 },
    }).success).toBe(false);

    const spec = compile();
    expect(FoundryLocalOsSandboxInstanceSpecV0Schema.safeParse({
      ...spec,
      capabilities: { ...spec.capabilities, publication: "not_authorized" },
      workerCommand: [...spec.workerCommand, "substituted"],
    }).success).toBe(false);
  });

  it("independently rejects backend-request binding drift", () => {
    const request = createLocalOsSandboxFixtureRequest();
    const mutations = [
      {
        ...request,
        authorizationSha256: `sha256:${"0".repeat(64)}`,
      },
      {
        ...request,
        command: { ...request.command, fencingToken: "8" },
      },
      {
        ...request,
        sandbox: {
          ...request.sandbox,
          stagedInputs: {
            ...request.sandbox.stagedInputs,
            assetIds: ["other-source"],
          },
        },
      },
      {
        ...request,
        sandbox: {
          ...request.sandbox,
          stageDag: [{ ...request.authorization.stages[0], command: ["other"] }],
        },
      },
      {
        ...request,
        sandbox: {
          ...request.sandbox,
          output: {
            ...request.sandbox.output,
            isolatedPrefix: "foundry/substituted",
          },
        },
      },
    ];
    expect(mutations.every(
      (mutation) => !FoundryLocalSandboxExecutionRequestV0Schema.safeParse(mutation).success,
    )).toBe(true);
  });

  it("fails closed for network, GPU, source, output, and hard-limit broadening", () => {
    const policy = createLocalOsSandboxFixturePolicy();
    const cases = [
      {
        request: createLocalOsSandboxFixtureRequest({
          stage: { networkAccess: "object_storage_only" },
        }),
        source: LOCAL_SANDBOX_FIXTURE_SOURCE_BINDING,
        output: LOCAL_SANDBOX_FIXTURE_OUTPUT_RESERVATION,
        message: "network-none",
      },
      {
        request: createLocalOsSandboxFixtureRequest({
          stage: {
            requestedResources: {
              cpuCores: 1,
              ramGiB: 1,
              gpuCount: 1,
              minimumGpuVramGiB: 8,
              scratchGiB: 1,
            },
            authorizedCapacity: {
              cpuCores: 1,
              ramGiB: 1,
              gpuCount: 1,
              perGpuVramGiB: 8,
              scratchGiB: 1,
            },
          },
        }),
        source: LOCAL_SANDBOX_FIXTURE_SOURCE_BINDING,
        output: LOCAL_SANDBOX_FIXTURE_OUTPUT_RESERVATION,
        message: "CPU-only",
      },
      {
        request: createLocalOsSandboxFixtureRequest(),
        source: { ...LOCAL_SANDBOX_FIXTURE_SOURCE_BINDING, assetId: "other-source" },
        output: LOCAL_SANDBOX_FIXTURE_OUTPUT_RESERVATION,
        message: "one source",
      },
      {
        request: createLocalOsSandboxFixtureRequest(),
        source: LOCAL_SANDBOX_FIXTURE_SOURCE_BINDING,
        output: {
          ...LOCAL_SANDBOX_FIXTURE_OUTPUT_RESERVATION,
          maximumOutputBytes: policy.hardLimits.maximumFileBytes + 1,
        },
        message: "hard policy",
      },
    ];
    for (const candidate of cases) {
      expect(() => compileFoundryLocalOsSandboxInstanceSpec({
        request: candidate.request,
        policy,
        source: candidate.source,
        output: candidate.output,
      })).toThrow(candidate.message);
    }
  });
});
