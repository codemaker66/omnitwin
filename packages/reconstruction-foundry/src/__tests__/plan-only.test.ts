import { describe, expect, it, vi } from "vitest";
import {
  FOUNDRY_INGEST_MANIFEST_V0,
  FoundryIngestManifestV0Schema,
  decideFoundryJobDispatch,
  computeFoundryIngestManifestSha256,
  type FoundryIngestManifestV0,
} from "@omnitwin/types";
import {
  FOUNDRY_PLAN_ONLY_REQUEST_V0,
  FoundryPlanOnlyDossierV0Schema,
  compileFoundryPlanOnlyDossier,
} from "../plan-only.js";

const NOW = "2026-07-13T12:00:00.000Z";
const IMAGE = `registry.example/foundry-inspect@sha256:${"b".repeat(64)}`;

function manifest(
  rightsOverrides: Partial<FoundryIngestManifestV0["assets"][number]["rights"]> = {},
): FoundryIngestManifestV0 {
  return FoundryIngestManifestV0Schema.parse({
    schemaVersion: FOUNDRY_INGEST_MANIFEST_V0,
    projectId: "plan-fixture",
    createdAt: "2026-07-13T10:00:00.000Z",
    createdBy: "operator-fixture",
    sourceRoots: [{
      id: "source-root",
      kind: "local_directory",
      displayName: "Verified stage",
      locationRedacted: "FOUNDRY_STAGE/[redacted]",
      caseSensitivity: "insensitive",
      readOnly: true,
    }],
    coordinateFrames: [],
    transforms: [],
    assets: [{
      id: "e57-main",
      sourceRootId: "source-root",
      relativePath: "capture.e57",
      inputType: "generic_e57",
      mediaType: "model/e57",
      sizeBytes: 1_024,
      sha256: `sha256:${"a".repeat(64)}`,
      immutable: true,
      captureState: "raw_capture",
      accessState: "direct",
      capturedAt: null,
      coordinateFrameId: null,
      calibrationAssetIds: [],
      parentAssetIds: [],
      rights: {
        basis: "customer_owned",
        commercialUse: "allowed",
        modelTrainingUse: "allowed",
        redistribution: "allowed",
        termsReviewedAt: "2026-07-13T10:00:00.000Z",
        termsReference: "https://rights.example/plan-fixture",
        restrictions: [],
        ...rightsOverrides,
      },
      provenanceClass: "captured",
      evidenceKinds: [],
      inspection: {
        geometryValue: "medium",
        appearanceValue: "none",
        calibrationValue: "unknown",
        scaleValue: "unknown",
        metadataKeys: ["astmE57Signature"],
        decisiveNextTest: "Run the bounded E57 metadata worker.",
      },
      notes: [],
    }],
    provenanceEdges: [],
    generatedRegions: [],
    legalReviewState: "requires_review",
    sourceMutationPermitted: false,
  });
}

function stage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "inspect",
    kind: "inspect",
    dependsOn: [],
    containerImage: IMAGE,
    command: ["foundry", "inspect", "--manifest", "manifest.json"],
    inputAssetIds: ["e57-main"],
    outputNames: ["inspection-report"],
    rightsPurposes: ["commercial_internal_use"],
    cpuCores: 4,
    ramGiB: 16,
    gpuCount: 0,
    minimumGpuVramGiB: 0,
    scratchGiB: 50,
    networkAccess: "none",
    checkpoint: "stage_boundary",
    resumable: true,
    ...overrides,
  };
}

function request(
  sourceManifest: FoundryIngestManifestV0,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaVersion: FOUNDRY_PLAN_ONLY_REQUEST_V0,
    id: "inspect-plan",
    projectId: sourceManifest.projectId,
    ingestManifestSha256: computeFoundryIngestManifestSha256(sourceManifest),
    createdAt: NOW,
    recipe: {
      id: "inspection-v0",
      displayName: "Read-only inspection",
      stages: [stage()],
    },
    localRoutes: [{
      providerKind: "local_cpu",
      providerAdapterId: "local-cpu-v0",
      capacity: {
        cpuCores: 8,
        ramGiB: 32,
        gpuCount: 0,
        perGpuVramGiB: 0,
        scratchGiB: 100,
        maximumInputBytes: 10_000,
      },
    }],
    remoteRoutes: [{
      providerKind: "runpod",
      providerAdapterId: "runpod-v0",
      objectStorageProfile: "foundry-candidate-r2",
      capacity: {
        cpuCores: 16,
        ramGiB: 128,
        gpuCount: 1,
        perGpuVramGiB: 80,
        scratchGiB: 500,
        maximumInputBytes: 100_000,
      },
      estimateSnapshot: {
        currency: "USD",
        observedAt: "2026-07-13T11:00:00.000Z",
        expiresAt: "2026-07-13T13:00:00.000Z",
        sourceReference: "operator-supplied-rate-card:fixture",
        breakdown: {
          computeUsd: 4,
          storageUsd: 0.25,
          egressUsd: 0.25,
          imageAndModelPullUsd: 0.1,
          retryAllowanceUsd: 0.2,
          safetyMarginUsd: 0.2,
        },
        budgetCapUsd: 10,
      },
    }],
    ...overrides,
  };
}

describe("Foundry plan-only compiler", () => {
  it("produces deterministic local and remote plans that cannot dispatch", () => {
    const sourceManifest = manifest();
    const input = request(sourceManifest);

    const first = compileFoundryPlanOnlyDossier(input, sourceManifest);
    const second = compileFoundryPlanOnlyDossier(input, sourceManifest);

    expect(second).toEqual(first);
    expect(first.candidates.map((candidate) => candidate.providerKind)).toEqual([
      "local_cpu",
      "runpod",
    ]);
    expect(first.candidates.every((candidate) => candidate.status === "viable_plan_only")).toBe(
      true,
    );
    expect(first.candidates.every((candidate) =>
      candidate.jobSpec?.executionIntent === "plan_only" &&
      candidate.jobSpec.computeApprovalId === null
    )).toBe(true);
    expect(first.capabilities).toEqual({
      jobPlanning: "completed_plan_only",
      execution: "not_authorized",
      modelTraining: "not_authorized",
      objectStorageMutation: "not_authorized",
      signing: "not_authorized",
      publication: "not_authorized",
      promotion: "not_authorized",
    });
    const consume = vi.fn(() => true);
    for (const candidate of first.candidates) {
      expect(
        decideFoundryJobDispatch(candidate.jobSpec, {
          now: new Date(NOW),
          trustedConfirmation: null,
          consumeExecutionConfirmation: consume,
          trustedApproval: null,
          trustedRightsApproval: null,
          trustedRightsPolicy: null,
        }),
      ).toEqual({ allowed: false, reason: "plan_only" });
    }
    expect(consume).not.toHaveBeenCalled();
  });

  it("routes model-training plans away from local execution", () => {
    const sourceManifest = manifest();
    const trainingStage = stage({
      kind: "appearance",
      rightsPurposes: ["model_training"],
      gpuCount: 1,
      minimumGpuVramGiB: 24,
    });
    const input = request(sourceManifest, {
      recipe: {
        id: "captured-radiance-v0",
        displayName: "Captured radiance training",
        stages: [trainingStage],
      },
      localRoutes: [{
        providerKind: "local_cuda",
        providerAdapterId: "local-cuda-v0",
        capacity: {
          cpuCores: 16,
          ramGiB: 64,
          gpuCount: 1,
          perGpuVramGiB: 24,
          scratchGiB: 500,
          maximumInputBytes: 10_000,
        },
      }],
    });

    const dossier = compileFoundryPlanOnlyDossier(input, sourceManifest);
    expect(dossier.candidates[0]).toMatchObject({
      providerKind: "local_cuda",
      status: "blocked_plan_only",
      blockers: ["d016_local_model_training_forbidden"],
    });
    expect(dossier.candidates[1]).toMatchObject({
      providerKind: "runpod",
      status: "viable_plan_only",
    });
  });

  it("surfaces purpose-aware rights blockers without manufacturing approval", () => {
    const sourceManifest = manifest({ modelTrainingUse: "prohibited" });
    const input = request(sourceManifest, {
      recipe: {
        id: "training-v0",
        displayName: "Training plan",
        stages: [stage({
          kind: "appearance",
          rightsPurposes: ["model_training"],
          gpuCount: 1,
          minimumGpuVramGiB: 24,
        })],
      },
      localRoutes: [],
    });

    const candidate = compileFoundryPlanOnlyDossier(input, sourceManifest).candidates[0];
    if (candidate === undefined) throw new Error("missing rights-blocked candidate");
    expect(candidate.status).toBe("blocked_plan_only");
    expect(candidate.blockers).toContain("rights:inspect:e57-main:model_training_not_allowed");
    expect(candidate.jobSpec?.executionIntent).toBe("plan_only");
  });

  it("blocks stale estimates, capacity misses, and cost above cap", () => {
    const sourceManifest = manifest();
    const base = request(sourceManifest);
    const remote = (base.remoteRoutes as Array<Record<string, unknown>>)[0];
    if (remote === undefined) throw new Error("missing remote route fixture");
    const snapshot = remote.estimateSnapshot as Record<string, unknown>;
    const breakdown = snapshot.breakdown as Record<string, unknown>;
    const input = request(sourceManifest, {
      localRoutes: [],
      remoteRoutes: [{
        ...remote,
        capacity: {
          ...(remote.capacity as Record<string, unknown>),
          cpuCores: 1,
        },
        estimateSnapshot: {
          ...snapshot,
          observedAt: "2026-07-13T09:00:00.000Z",
          expiresAt: "2026-07-13T11:00:00.000Z",
          breakdown: { ...breakdown, computeUsd: 20 },
          budgetCapUsd: 10,
        },
      }],
    });

    const candidate = compileFoundryPlanOnlyDossier(input, sourceManifest).candidates[0];
    if (candidate === undefined) throw new Error("missing constrained route candidate");
    expect(candidate.status).toBe("blocked_plan_only");
    expect(candidate.blockers).toEqual([
      "estimate_snapshot_expired",
      "estimated_cost_exceeds_budget_cap",
      "inspect:cpu_capacity_exceeded",
      "job_spec_invalid",
    ]);
    expect(candidate.jobSpec).toBeNull();
  });

  it("rejects a manifest mismatch, mutable image, and cyclic recipe", () => {
    const sourceManifest = manifest();
    expect(() => compileFoundryPlanOnlyDossier({
      ...request(sourceManifest),
      ingestManifestSha256: `sha256:${"0".repeat(64)}`,
    }, sourceManifest)).toThrow("Plan request does not bind the supplied ingest manifest");

    expect(() => compileFoundryPlanOnlyDossier(request(sourceManifest, {
      recipe: {
        id: "mutable-worker",
        displayName: "Invalid mutable worker",
        stages: [stage({ containerImage: "registry.example/foundry:latest" })],
      },
    }), sourceManifest)).toThrow("Foundry plan-only request is invalid");

    expect(() => compileFoundryPlanOnlyDossier(request(sourceManifest, {
      recipe: {
        id: "cyclic-recipe",
        displayName: "Cyclic recipe",
        stages: [
          stage({ dependsOn: ["qa"] }),
          stage({ id: "qa", kind: "qa", dependsOn: ["inspect"], outputNames: ["qa-report"] }),
        ],
      },
    }), sourceManifest)).toThrow("Plan recipe does not form a valid acyclic JobSpec stage graph");
  });

  it("detects dossier tampering", () => {
    const sourceManifest = manifest();
    const dossier = compileFoundryPlanOnlyDossier(request(sourceManifest), sourceManifest);
    expect(
      FoundryPlanOnlyDossierV0Schema.safeParse({
        ...dossier,
        authority: "release",
      }).success,
    ).toBe(false);
    expect(
      FoundryPlanOnlyDossierV0Schema.safeParse({
        ...dossier,
        dossierSha256: `sha256:${"f".repeat(64)}`,
      }).success,
    ).toBe(false);
  });
});
