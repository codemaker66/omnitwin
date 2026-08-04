import { describe, expect, it } from "vitest";
import {
  FOUNDRY_LOCAL_ADAPTER_INVENTORY_V0,
  FOUNDRY_ROUTE_CANDIDATE_V0,
  FOUNDRY_ROUTE_INPUT_V0,
  FOUNDRY_ROUTE_POLICY_V0,
  FoundryRouteDecisionError,
  computeFoundryLocalAdapterInventorySha256,
  computeFoundryRouteCandidateSha256,
  computeFoundryRouteDecisionSha256,
  computeFoundryRouteInputSha256,
  computeFoundryRoutePolicySha256,
  decideFoundryRoute,
  validateFoundryRouteDecision,
  type FoundryLocalAdapterBindingV0,
  type FoundryLocalAdapterInventoryV0,
  type FoundryRouteCandidateV0,
  type FoundryRouteDecisionInputV0,
  type FoundryRouteDecisionRequestV0,
  type FoundryRoutePolicyV0,
} from "../../services/foundry-route-decision.js";

const DIGEST = {
  job: `sha256:${"1".repeat(64)}`,
  manifest: `sha256:${"2".repeat(64)}`,
  cpuPlan: `sha256:${"3".repeat(64)}`,
  cudaPlan: `sha256:${"4".repeat(64)}`,
  remotePlan: `sha256:${"5".repeat(64)}`,
  cpuArtifact: `sha256:${"6".repeat(64)}`,
  cudaArtifact: `sha256:${"7".repeat(64)}`,
  remoteArtifact: `sha256:${"8".repeat(64)}`,
  cpuConfig: `sha256:${"9".repeat(64)}`,
  cudaConfig: `sha256:${"a".repeat(64)}`,
  remoteConfig: `sha256:${"b".repeat(64)}`,
  cpuDeployment: `sha256:${"c".repeat(64)}`,
  cudaDeployment: `sha256:${"d".repeat(64)}`,
  remoteDeployment: `sha256:${"e".repeat(64)}`,
  drift: `sha256:${"f".repeat(64)}`,
} as const;

const CPU_BINDING = {
  providerKind: "local_cpu",
  providerAdapterId: "local-cpu-adapter",
  providerAdapterVersion: "1.0.0",
  providerAdapterArtifactSha256: DIGEST.cpuArtifact,
  providerAdapterConfigurationSha256: DIGEST.cpuConfig,
  providerDeploymentSha256: DIGEST.cpuDeployment,
  providerRequestProfileId: "local-cpu-request-profile",
  providerRequestProfileVersion: "1.0.0",
  providerRequestProfileSha256: DIGEST.job,
  targetKind: "local_worker",
  targetId: "local-cpu-runner",
} satisfies FoundryLocalAdapterBindingV0;

const CUDA_BINDING = {
  providerKind: "local_cuda",
  providerAdapterId: "local-cuda-adapter",
  providerAdapterVersion: "1.0.0",
  providerAdapterArtifactSha256: DIGEST.cudaArtifact,
  providerAdapterConfigurationSha256: DIGEST.cudaConfig,
  providerDeploymentSha256: DIGEST.cudaDeployment,
  providerRequestProfileId: "local-cuda-request-profile",
  providerRequestProfileVersion: "1.0.0",
  providerRequestProfileSha256: DIGEST.manifest,
  targetKind: "local_worker",
  targetId: "local-cuda-runner",
} satisfies FoundryLocalAdapterBindingV0;

function policyEvidence() {
  const value = {
    schemaVersion: FOUNDRY_ROUTE_POLICY_V0,
    policyId: "automatic-route-policy",
    policyRevision: 7,
    authority: "none",
    signing: "not_authorized",
    publication: "not_authorized",
    localCpu: {
      maximumInputBytes: 1_000,
      maximumAssetCount: 2,
      maximumStageCount: 3,
      maximumPeakCpuCores: 4,
      maximumPeakRamGiB: 16,
      maximumPeakGpuCount: 0,
      maximumPerGpuVramGiB: 0,
      maximumDeadlineSeconds: 600,
      allowedNetworkAccess: ["none"],
    },
    localCuda: {
      maximumInputBytes: 10_000,
      maximumAssetCount: 20,
      maximumStageCount: 30,
      maximumPeakCpuCores: 16,
      maximumPeakRamGiB: 64,
      maximumPeakGpuCount: 2,
      maximumPerGpuVramGiB: 24,
      maximumDeadlineSeconds: 3_600,
      allowedNetworkAccess: ["none", "object_storage_only"],
    },
  } satisfies FoundryRoutePolicyV0;
  return { sha256: computeFoundryRoutePolicySha256(value), value };
}

const SMALL_INPUT = {
  schemaVersion: FOUNDRY_ROUTE_INPUT_V0,
  inputId: "route-input-001",
  jobSpecSha256: DIGEST.job,
  ingestManifestSha256: DIGEST.manifest,
  inputBytes: 500,
  assetCount: 2,
  stageCount: 3,
  peakCpuCores: 4,
  peakRamGiB: 16,
  peakGpuCount: 0,
  minimumPerGpuVramGiB: 0,
  deadlineSeconds: 600,
  networkAccess: "none",
} as const;

function inputEvidence(
  overrides: Partial<FoundryRouteDecisionInputV0> = {},
) {
  const value = { ...SMALL_INPUT, ...overrides };
  return { sha256: computeFoundryRouteInputSha256(value), value };
}

function inventoryEvidence(
  bindings: readonly FoundryLocalAdapterBindingV0[] = [
    CPU_BINDING,
    CUDA_BINDING,
  ],
) {
  const value: FoundryLocalAdapterInventoryV0 = {
    schemaVersion: FOUNDRY_LOCAL_ADAPTER_INVENTORY_V0,
    inventoryId: "local-adapters-001",
    inventoryRevision: 11,
    bindings: [...bindings],
  };
  return {
    sha256: computeFoundryLocalAdapterInventorySha256(value),
    value,
  };
}

function candidateEvidence(
  candidateId: string,
  providerKind: "local_cpu" | "local_cuda" | "other",
  policySha256: string,
  routeInputSha256: string,
) {
  const selector = providerKind === "local_cpu"
    ? { binding: CPU_BINDING, planSha256: DIGEST.cpuPlan }
    : providerKind === "local_cuda"
      ? { binding: CUDA_BINDING, planSha256: DIGEST.cudaPlan }
      : {
          binding: {
            providerKind: "other" as const,
            providerAdapterId: "remote-provider-adapter",
            providerAdapterVersion: "1.0.0",
            providerAdapterArtifactSha256: DIGEST.remoteArtifact,
            providerAdapterConfigurationSha256: DIGEST.remoteConfig,
            providerDeploymentSha256: DIGEST.remoteDeployment,
            providerRequestProfileId: "remote-request-profile",
            providerRequestProfileVersion: "1.0.0",
            providerRequestProfileSha256: DIGEST.remotePlan,
            targetKind: "remote_worker_pool" as const,
            targetId: "remote-pool",
          },
          planSha256: DIGEST.remotePlan,
        };
  const value: FoundryRouteCandidateV0 = {
    schemaVersion: FOUNDRY_ROUTE_CANDIDATE_V0,
    candidateId,
    viability: "viable" as const,
    authority: "none" as const,
    signing: "not_authorized" as const,
    publication: "not_authorized" as const,
    routePolicySha256: policySha256,
    routeInputSha256,
    planSha256: selector.planSha256,
    providerKind,
    adapterBinding: selector.binding,
  };
  return { sha256: computeFoundryRouteCandidateSha256(value), value };
}

function request(
  overrides: Partial<FoundryRouteDecisionInputV0> = {},
  bindings?: readonly FoundryLocalAdapterBindingV0[],
): FoundryRouteDecisionRequestV0 {
  const policy = policyEvidence();
  const input = inputEvidence(overrides);
  return {
    policy,
    input,
    candidates: [
      candidateEvidence("candidate-cpu", "local_cpu", policy.sha256, input.sha256),
      candidateEvidence("candidate-cuda", "local_cuda", policy.sha256, input.sha256),
      candidateEvidence("candidate-remote", "other", policy.sha256, input.sha256),
    ],
    localAdapterInventory: inventoryEvidence(bindings),
  };
}

function expectRouteError(
  operation: () => unknown,
  code: FoundryRouteDecisionError["code"],
): void {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(FoundryRouteDecisionError);
    expect((error as FoundryRouteDecisionError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}.`);
}

describe("Foundry provider-neutral route decision", () => {
  it("selects a small job for an exactly bound, explicitly available local CPU adapter", () => {
    const decision = decideFoundryRoute(request());

    expect(decision).toMatchObject({
      routeClass: "small_local_cpu",
      status: "executable_local",
      providerKind: "local_cpu",
      selectedCandidateId: "candidate-cpu",
      selectedPlanSha256: DIGEST.cpuPlan,
      authority: "none",
      executionAuthority: "not_authorized",
      signing: "not_authorized",
      publication: "not_authorized",
    });
    expect(decision.matchedLocalAdapterBindingSha256).not.toBeNull();
    expect(validateFoundryRouteDecision(decision, request())).toEqual({
      valid: true,
    });
  });

  it.each([
    ["input bytes", { inputBytes: 1_001 }],
    ["asset count", { assetCount: 3 }],
    ["stage count", { stageCount: 4 }],
    ["CPU", { peakCpuCores: 5 }],
    ["RAM", { peakRamGiB: 17 }],
    ["GPU", { peakGpuCount: 1, minimumPerGpuVramGiB: 8 }],
    ["deadline", { deadlineSeconds: 601 }],
    ["network", { networkAccess: "object_storage_only" as const }],
  ])("routes a CPU-threshold exceedance in %s to eligible local CUDA", (_label, overrides) => {
    const decision = decideFoundryRoute(request(overrides));

    expect(decision.routeClass).toBe("medium_local_cuda");
    expect(decision.providerKind).toBe("local_cuda");
    expect(decision.status).toBe("executable_local");
  });

  it.each([
    ["input bytes", { inputBytes: 10_001 }],
    ["asset count", { assetCount: 21 }],
    ["stage count", { stageCount: 31 }],
    ["CPU", { peakCpuCores: 17 }],
    ["RAM", { peakRamGiB: 65 }],
    ["GPU", { peakGpuCount: 3, minimumPerGpuVramGiB: 8 }],
    ["VRAM", { peakGpuCount: 1, minimumPerGpuVramGiB: 25 }],
    ["deadline", { deadlineSeconds: 3_601 }],
    ["network", { networkAccess: "restricted" as const }],
  ])("routes a CUDA-threshold exceedance in %s to remote", (_label, overrides) => {
    const decision = decideFoundryRoute(request(overrides));

    expect(decision).toMatchObject({
      routeClass: "oversized_remote",
      status: "awaiting_provider_adapter",
      providerKind: "other",
      selectedCandidateId: "candidate-remote",
      authority: "none",
      executionAuthority: "not_authorized",
      signing: "not_authorized",
      publication: "not_authorized",
    });
    expect(decision.matchedLocalAdapterBindingSha256).toBeNull();
  });

  it("never turns a remote selection executable from a similarly named local binding", () => {
    const similarlyNamedLocal = {
      providerKind: "local_cpu",
      providerAdapterId: "remote-provider-adapter",
      providerAdapterVersion: "1.0.0",
      providerAdapterArtifactSha256: DIGEST.remoteArtifact,
      providerAdapterConfigurationSha256: DIGEST.remoteConfig,
      providerDeploymentSha256: DIGEST.remoteDeployment,
      providerRequestProfileId: "remote-request-profile",
      providerRequestProfileVersion: "1.0.0",
      providerRequestProfileSha256: DIGEST.remotePlan,
      targetKind: "local_worker",
      targetId: "lookalike-local-runner",
    } satisfies FoundryLocalAdapterBindingV0;

    const decision = decideFoundryRoute(
      request({ inputBytes: 10_001 }, [similarlyNamedLocal, CUDA_BINDING]),
    );

    expect(decision.providerKind).toBe("other");
    expect(decision.status).toBe("awaiting_provider_adapter");
    expect(decision.matchedLocalAdapterBindingSha256).toBeNull();
  });

  it.each([
    ["kind", { providerKind: "local_cuda" as const }],
    ["adapter ID", { providerAdapterId: "different-adapter" }],
    ["version", { providerAdapterVersion: "2.0.0" }],
    ["artifact", { providerAdapterArtifactSha256: DIGEST.drift }],
    ["configuration", { providerAdapterConfigurationSha256: DIGEST.drift }],
    ["deployment", { providerDeploymentSha256: DIGEST.drift }],
    ["request profile ID", { providerRequestProfileId: "different-profile" }],
    ["request profile version", { providerRequestProfileVersion: "2.0.0" }],
    ["request profile digest", { providerRequestProfileSha256: DIGEST.drift }],
    ["runner", { targetId: "different-runner" }],
  ])("does not mark a local route executable when the available binding differs by %s", (_label, change) => {
    const different = { ...CPU_BINDING, ...change } as FoundryLocalAdapterBindingV0;
    const decision = decideFoundryRoute(request({}, [different, CUDA_BINDING]));

    expect(decision.status).toBe("awaiting_local_adapter_binding");
    expect(decision.matchedLocalAdapterBindingSha256).toBeNull();
  });

  it("rejects multiple lowering bindings for one executor adapter identity", () => {
    const conflicting = {
      ...CPU_BINDING,
      providerAdapterConfigurationSha256: DIGEST.drift,
      providerRequestProfileId: "conflicting-profile",
      providerRequestProfileSha256: DIGEST.drift,
      targetId: "conflicting-runner",
    } satisfies FoundryLocalAdapterBindingV0;

    expect(() => request({}, [CPU_BINDING, conflicting, CUDA_BINDING]))
      .toThrow("one executor adapter identity cannot advertise multiple local lowering bindings");
  });

  it("is independent of candidate ordering and binds the complete candidate set", () => {
    const original = request();
    const reversed = { ...original, candidates: [...original.candidates].reverse() };

    expect(decideFoundryRoute(reversed)).toEqual(decideFoundryRoute(original));

    const removed = { ...original, candidates: original.candidates.slice(0, 2) };
    expect(
      validateFoundryRouteDecision(decideFoundryRoute(original), removed),
    ).toEqual({ valid: false, reason: "decision_content_mismatch" });
  });

  it("rejects unresolved candidate ties instead of silently choosing by array order", () => {
    const current = request();
    const tied = candidateEvidence(
      "candidate-cpu-tie",
      "local_cpu",
      current.policy.sha256,
      current.input.sha256,
    );

    expectRouteError(
      () => decideFoundryRoute({
        ...current,
        candidates: [...current.candidates, tied],
      }),
      "AMBIGUOUS_ROUTE_CANDIDATES",
    );
  });

  it("rejects multiple remote candidates because policy supplies no provider preference", () => {
    const current = request({ inputBytes: 10_001 });
    const tied = candidateEvidence(
      "candidate-remote-tie",
      "other",
      current.policy.sha256,
      current.input.sha256,
    );

    expectRouteError(
      () => decideFoundryRoute({
        ...current,
        candidates: [...current.candidates, tied],
      }),
      "AMBIGUOUS_ROUTE_CANDIDATES",
    );
  });

  it("fails closed when the policy-selected route has no candidate", () => {
    const current = request();
    expectRouteError(
      () => decideFoundryRoute({
        ...current,
        candidates: current.candidates.filter(
          (candidate) => candidate.value.providerKind !== "local_cpu",
        ),
      }),
      "ROUTE_CANDIDATE_NOT_FOUND",
    );
  });

  it("rejects stale persisted policy, input, candidate, and inventory digests", () => {
    const current = request();
    const cases: readonly [FoundryRouteDecisionRequestV0, FoundryRouteDecisionError["code"]][] = [
      [{ ...current, policy: { ...current.policy, sha256: DIGEST.drift } }, "POLICY_DIGEST_MISMATCH"],
      [{ ...current, input: { ...current.input, sha256: DIGEST.drift } }, "INPUT_DIGEST_MISMATCH"],
      [{
        ...current,
        candidates: [
          { ...current.candidates[0]!, sha256: DIGEST.drift },
          ...current.candidates.slice(1),
        ],
      }, "CANDIDATE_DIGEST_MISMATCH"],
      [{
        ...current,
        localAdapterInventory: {
          ...current.localAdapterInventory,
          sha256: DIGEST.drift,
        },
      }, "LOCAL_ADAPTER_INVENTORY_DIGEST_MISMATCH"],
    ];

    for (const [drifted, code] of cases) {
      expectRouteError(() => decideFoundryRoute(drifted), code);
    }
  });

  it("rejects a candidate rebound to a different policy even with a recomputed candidate digest", () => {
    const current = request();
    const value = {
      ...current.candidates[0]!.value,
      routePolicySha256: DIGEST.drift,
    };
    const rebound = {
      value,
      sha256: computeFoundryRouteCandidateSha256(value),
    };

    expectRouteError(
      () => decideFoundryRoute({
        ...current,
        candidates: [rebound, ...current.candidates.slice(1)],
      }),
      "CANDIDATE_SUBJECT_MISMATCH",
    );
  });

  it("detects decision tampering even when the attacker recomputes its digest", () => {
    const current = request();
    const decision = decideFoundryRoute(current);
    const payload = {
      ...decision,
      selectedPlanSha256: DIGEST.drift,
      decisionSha256: undefined,
    };
    const { decisionSha256: _ignored, ...withoutDigest } = payload;
    const tampered = {
      ...withoutDigest,
      decisionSha256: computeFoundryRouteDecisionSha256(withoutDigest),
    };

    expect(validateFoundryRouteDecision(tampered, current)).toEqual({
      valid: false,
      reason: "decision_content_mismatch",
    });
    expect(
      validateFoundryRouteDecision(
        { ...decision, decisionSha256: DIGEST.drift },
        current,
      ),
    ).toEqual({ valid: false, reason: "decision_digest_mismatch" });
  });

  it("rejects non-monotonic persisted thresholds", () => {
    const current = request();
    const value = {
      ...current.policy.value,
      localCpu: {
        ...current.policy.value.localCpu,
        maximumInputBytes: 20_000,
      },
    };
    const drifted = {
      ...current,
      policy: { value, sha256: current.policy.sha256 },
    };

    expectRouteError(
      () => decideFoundryRoute(drifted),
      "INVALID_ROUTE_DECISION_REQUEST",
    );
  });
});
