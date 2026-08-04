import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  FOUNDRY_INGEST_MANIFEST_V0,
  FOUNDRY_INTAKE_ADMISSION_CAPABILITIES,
  FOUNDRY_INTAKE_ADMISSION_RESULT_V0,
  FOUNDRY_TRUSTED_WORKER_PROFILE_V0,
  FoundryIngestManifestV0Schema,
  FoundryIntakeAdmissionResultPayloadSchema,
  FoundryIntakeAdmissionResultV0Schema,
  computeFoundryIngestManifestSha256,
  computeFoundryIntakeAdmissionResultSha256,
  decideFoundryJobDispatch,
  type FoundryIngestManifestV0,
  type FoundryIntakeAdmissionResultV0,
  type FoundryWorkerOperationClass,
} from "@omnitwin/types";
import {
  FOUNDRY_PLAN_PREVIEW_V0,
  FoundryPlanPreviewV0Schema,
  compileFoundryPlanPreview,
  computeFoundryPlanPreviewSha256,
} from "../plan-preview.js";
/*
 * Keep the worker fixture derived from the same public routing compiler used by
 * production preview code. Tests still assert the exact routes independently.
 */
import {
  compileFoundryStageAssetRoutingV0,
  type FoundryPipelineWorkerRole,
  type FoundryReconstructionRecipeOptionsV0,
} from "../pipeline-recipe.js";

const NOW = "2026-07-13T12:00:00.000Z";
const CAPTURED_OPTIONS: FoundryReconstructionRecipeOptionsV0 = {
  hdAppearance: "captured_only",
  includeSemanticInference: false,
  buildOperationalMesh: true,
  buildNeuralRepresentation: false,
};

const OPERATION_BY_ROLE: Readonly<
  Record<FoundryPipelineWorkerRole, FoundryWorkerOperationClass>
> = {
  inspect_sources: "read_only_inspection",
  decode_xgrids: "deterministic_transformation",
  normalize_point_cloud: "deterministic_transformation",
  normalize_mesh: "deterministic_transformation",
  extract_video_frames: "deterministic_transformation",
  reconstruct_from_images: "deterministic_transformation",
  register_sources: "deterministic_transformation",
  fuse_measured_geometry: "deterministic_transformation",
  build_operational_mesh: "deterministic_transformation",
  enhance_captured_appearance: "deterministic_transformation",
  infer_hd_appearance: "model_inference",
  infer_semantics: "model_inference",
  optimize_neural_scene: "model_training",
  qa_candidate: "read_only_inspection",
  package_candidate: "redistribution_packaging",
};

function asset(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "e57-main",
    sourceRootId: "source-root",
    relativePath: "capture.e57",
    inputType: "generic_e57",
    mediaType: "model/e57",
    sizeBytes: 2_048,
    sha256: `sha256:${"a".repeat(64)}`,
    immutable: true,
    captureState: "raw_capture",
    accessState: "direct",
    capturedAt: null,
    coordinateFrameId: "venue-control",
    calibrationAssetIds: [],
    parentAssetIds: [],
    rights: {
      basis: "customer_owned",
      commercialUse: "allowed",
      modelTrainingUse: "allowed",
      redistribution: "allowed",
      termsReviewedAt: "2026-07-13T10:00:00.000Z",
      termsReference: "https://rights.example/reception-room",
      restrictions: [],
    },
    provenanceClass: "captured",
    evidenceKinds: [],
    inspection: {
      geometryValue: "high",
      appearanceValue: "none",
      calibrationValue: "medium",
      scaleValue: "high",
      metadataKeys: ["astmE57Signature"],
      decisiveNextTest: "Run the bounded E57 metadata worker.",
    },
    notes: [],
    ...overrides,
  };
}

function manifest(
  assetOverrides: Record<string, unknown> = {},
  measuredFrame = true,
): FoundryIngestManifestV0 {
  const sourceAsset = asset({
    ...(measuredFrame ? {} : { coordinateFrameId: null }),
    ...assetOverrides,
  });
  return FoundryIngestManifestV0Schema.parse({
    schemaVersion: FOUNDRY_INGEST_MANIFEST_V0,
    projectId: "reception-room",
    createdAt: "2026-07-13T10:00:00.000Z",
    createdBy: "intake-reviewer",
    sourceRoots: [{
      id: "source-root",
      kind: "local_directory",
      displayName: "Reviewed read-only capture",
      locationRedacted: "FOUNDRY_SOURCE/[redacted]",
      caseSensitivity: "insensitive",
      readOnly: true,
    }],
    coordinateFrames: measuredFrame
      ? [{
          id: "venue-control",
          kind: "venue_control",
          units: "meters",
          handedness: "right",
          upAxis: "z",
          authority: "measured",
          provenanceAssetIds: ["e57-main"],
          crs: null,
        }]
      : [],
    transforms: [],
    assets: [sourceAsset],
    provenanceEdges: [],
    generatedRegions: [],
    legalReviewState: "requires_review",
    sourceMutationPermitted: false,
  });
}

function mixedAppearanceManifest(): FoundryIngestManifestV0 {
  const base = manifest();
  return FoundryIngestManifestV0Schema.parse({
    ...base,
    assets: [
      ...base.assets,
      asset({
        id: "splat-enhanced",
        relativePath: "enhanced/scene.spz",
        inputType: "spz",
        mediaType: "application/octet-stream",
        sizeBytes: 4_096,
        sha256: `sha256:${"d".repeat(64)}`,
        captureState: "official_export",
        accessState: "official_export",
        provenanceClass: "enhanced_captured",
        inspection: {
          geometryValue: "low",
          appearanceValue: "high",
          calibrationValue: "low",
          scaleValue: "medium",
          metadataKeys: ["fixture-splat"],
          decisiveNextTest: "Review this splat only as an appearance source.",
        },
      }),
    ],
  });
}

function admissionResult(
  sourceManifest: FoundryIngestManifestV0,
): FoundryIntakeAdmissionResultV0 {
  const payload = FoundryIntakeAdmissionResultPayloadSchema.parse({
    schemaVersion: FOUNDRY_INTAKE_ADMISSION_RESULT_V0,
    receiptSha256: "b".repeat(64),
    reviewSha256: `sha256:${"c".repeat(64)}`,
    manifestSha256: computeFoundryIngestManifestSha256(sourceManifest),
    manifest: sourceManifest,
    exclusions: [],
    authority: "none",
    capabilities: FOUNDRY_INTAKE_ADMISSION_CAPABILITIES,
  });
  return FoundryIntakeAdmissionResultV0Schema.parse({
    ...payload,
    resultSha256: computeFoundryIntakeAdmissionResultSha256(payload),
  });
}

function workerBindings(
  sourceManifest: FoundryIngestManifestV0,
  options: FoundryReconstructionRecipeOptionsV0,
) {
  return compileFoundryStageAssetRoutingV0(sourceManifest, options).map((route, index) => {
    const role = route.role;
    const gpu = role === "infer_hd_appearance" || role === "infer_semantics" ||
      role === "optimize_neural_scene";
    return {
      role,
      profile: {
        schemaVersion: FOUNDRY_TRUSTED_WORKER_PROFILE_V0,
        profileId: `${role}-worker`,
        profileVersion: "v1",
        operationClass: OPERATION_BY_ROLE[role],
        containerImage:
          `registry.example/${role}@sha256:${(index + 1).toString(16).padStart(64, "0")}`,
        command: ["foundry-worker", role],
        networkAccess: "none" as const,
        localExecutionAllowed: role !== "optimize_neural_scene",
        reviewedBy: "security-reviewer",
        reviewedAt: "2026-07-13T09:00:00.000Z",
        expiresAt: "2026-07-14T09:00:00.000Z",
      },
      cpuCores: 4,
      ramGiB: 16,
      gpuCount: gpu ? 1 : 0,
      minimumGpuVramGiB: gpu ? 24 : 0,
      scratchGiB: 20,
      checkpoint: "stage_boundary" as const,
      resumable: true,
    };
  });
}

function capacity() {
  return {
    cpuCores: 16,
    ramGiB: 64,
    gpuCount: 1,
    perGpuVramGiB: 32,
    scratchGiB: 200,
    maximumInputBytes: 1_000_000,
  };
}

function estimateSnapshot() {
  return {
    currency: "USD" as const,
    observedAt: "2026-07-13T11:00:00.000Z",
    expiresAt: "2026-07-13T13:00:00.000Z",
    sourceReference: "trusted-provider-snapshot:reception-001",
    breakdown: {
      computeUsd: 2,
      storageUsd: 0.25,
      egressUsd: 0.1,
      imageAndModelPullUsd: 0.15,
      retryAllowanceUsd: 0.2,
      safetyMarginUsd: 0.3,
    },
    budgetCapUsd: 5,
  };
}

function previewInput(
  sourceManifest = manifest(),
  options: FoundryReconstructionRecipeOptionsV0 = CAPTURED_OPTIONS,
  includeWorkerBindings = true,
) {
  return {
    id: "reception-hd-preview",
    displayName: "Reception Room HD planning preview",
    createdAt: NOW,
    admissionResult: admissionResult(sourceManifest),
    manifest: sourceManifest,
    options,
    workerBindings: includeWorkerBindings ? workerBindings(sourceManifest, options) : [],
    localRoutes: [{
      providerKind: "local_cuda" as const,
      providerAdapterId: "local-cuda-v0",
      capacity: capacity(),
    }],
    remoteRoutes: [{
      providerKind: "runpod" as const,
      providerAdapterId: "runpod-v0",
      objectStorageProfile: "foundry-private",
      capacity: capacity(),
      estimateSnapshot: estimateSnapshot(),
    }],
  };
}

describe("Foundry plan preview bridge", () => {
  it("deterministically binds a plain-language local/cloud preview to exact non-executable artifacts", () => {
    const input = previewInput();
    const first = compileFoundryPlanPreview(input);
    const second = compileFoundryPlanPreview(input);

    expect(second).toEqual(first);
    expect(FoundryPlanPreviewV0Schema.parse(first)).toEqual(first);
    expect(first).toMatchObject({
      schemaVersion: FOUNDRY_PLAN_PREVIEW_V0,
      status: "plan_available",
      authority: "none",
      planningGate: { status: "clear", blockers: [] },
      capabilities: {
        planning: "preview_only",
        execution: "not_authorized",
        processLaunch: "not_available",
        networkAccess: "not_available",
        providerSdk: "not_available",
        credentialAccess: "not_available",
        spend: "not_authorized",
        sourceMutation: "not_authorized",
      },
      exactArtifacts: { state: "compiled" },
    });
    expect(first.routes.local[0]).toMatchObject({
      status: "plan_available",
      cost: { state: "not_supplied", amountUsd: null },
    });
    expect(first.routes.local[0]?.cost.explanation).toContain("does not call local computing free");
    expect(first.routes.cloud[0]).toMatchObject({
      status: "plan_available",
      cost: {
        state: "calculated_from_supplied_snapshot",
        amountUsd: 3,
        budgetCapUsd: 5,
        sourceReference: "trusted-provider-snapshot:reception-001",
      },
    });
    expect(first.truthSeparation).toMatchObject({
      measuredCoordinateFrameIds: ["venue-control"],
      sourceAssetIds: {
        captured: ["e57-main"],
        enhancedCaptured: [],
        generatedCinematic: [],
        conceptImagination: [],
      },
      outputStageIds: {
        measuredEligibleCapturedDerivatives: [
          "build_operational_mesh",
          "fuse_measured_geometry",
        ],
        enhancedCapturedDerivatives: ["enhance_captured_appearance"],
        aiGeneratedDerivatives: [],
        mixedCandidates: ["package_candidate", "qa_candidate"],
      },
    });

    if (first.exactArtifacts.state !== "compiled") {
      throw new Error("expected compiled exact artifacts");
    }
    const consume = vi.fn(() => true);
    for (const candidate of first.exactArtifacts.planOnlyDossier.candidates) {
      expect(candidate.jobSpec).not.toBeNull();
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

  it("uses locale-independent code-unit ordering for punctuation-bearing route IDs", () => {
    const input = previewInput();
    const remoteTemplate = input.remoteRoutes[0]!;
    input.localRoutes = [];
    input.remoteRoutes = [
      { ...remoteTemplate, providerAdapterId: "adapter_a" },
      { ...remoteTemplate, providerAdapterId: "adapter.a" },
      { ...remoteTemplate, providerAdapterId: "adapter-a" },
    ];

    const preview = compileFoundryPlanPreview(input);

    expect(preview.routes.cloud.map((route) => route.providerAdapterId)).toEqual([
      "adapter-a",
      "adapter.a",
      "adapter_a",
    ]);
    expect(FoundryPlanPreviewV0Schema.parse(preview)).toEqual(preview);
  });

  it("keeps AI appearance and semantic outputs outside measured geometry", () => {
    const options: FoundryReconstructionRecipeOptionsV0 = {
      hdAppearance: "pretrained_inference",
      includeSemanticInference: true,
      buildOperationalMesh: true,
      buildNeuralRepresentation: false,
    };
    const preview = compileFoundryPlanPreview(previewInput(manifest(), options));
    expect(preview.truthSeparation.outputStageIds.aiGeneratedDerivatives).toEqual([
      "infer_hd_appearance",
      "infer_semantics",
    ]);
    if (preview.exactArtifacts.state !== "compiled") {
      throw new Error("expected compiled exact artifacts");
    }
    const generated = preview.exactArtifacts.reconstructionRecipe.outputs.filter(
      (output) => output.derivativeClass === "ai_derived",
    );
    expect(generated.every(
      (output) => output.namespace === "ai" && !output.mayEnterMeasuredGeometry,
    )).toBe(true);
    expect(
      preview.exactArtifacts.reconstructionRecipe.outputs
        .filter((output) => output.derivativeClass === "mixed_candidate")
        .every((output) => !output.mayEnterMeasuredGeometry),
    ).toBe(true);
  });

  it("stops proprietary XBIN before recipe creation, even without a fake decoder worker", () => {
    const xbinManifest = manifest({
      id: "xbin-main",
      relativePath: "capture.xbin",
      inputType: "xgrids_xbin",
      mediaType: "application/octet-stream",
      captureState: "reference",
      accessState: "blocked_technical",
      coordinateFrameId: null,
      rights: {
        basis: "unknown",
        commercialUse: "unknown",
        modelTrainingUse: "unknown",
        redistribution: "unknown",
        termsReviewedAt: null,
        termsReference: null,
        restrictions: ["Decoder and rights review are not established."],
      },
    }, false);
    const input = previewInput(xbinManifest, CAPTURED_OPTIONS, false);
    const preview = compileFoundryPlanPreview(input);
    expect(preview.status).toBe("blocked_before_recipe");
    expect(preview.planningGate.blockers.map((blocker) => blocker.code)).toEqual([
      "proprietary_xgrids_xbin_decoder_not_verified",
    ]);
    expect(preview.exactArtifacts).toEqual({
      state: "withheld_planning_gate_blocked",
      reconstructionRecipe: null,
      planOnlyDossier: null,
    });
    expect([...preview.routes.local, ...preview.routes.cloud].every(
      (route) => route.status === "blocked" && route.jobSpecSha256 === null,
    )).toBe(true);
    expect(preview.human.summary).toContain(".xbin remains unchanged as evidence");
  });

  it("compiles separated enhanced-appearance inputs without sending them into measured geometry", () => {
    const sourceManifest = mixedAppearanceManifest();
    const options: FoundryReconstructionRecipeOptionsV0 = {
      ...CAPTURED_OPTIONS,
      hdAppearance: "pretrained_inference",
    };
    const preview = compileFoundryPlanPreview(previewInput(sourceManifest, options));

    expect(preview.planningGate).toEqual({ status: "clear", blockers: [] });
    expect(preview.truthSeparation.sourceAssetIds.enhancedCaptured).toEqual([
      "splat-enhanced",
    ]);
    expect(preview.exactArtifacts.state).toBe("compiled");
    if (preview.exactArtifacts.state !== "compiled") {
      throw new Error("expected exact mixed-source planning artifacts");
    }
    const recipe = preview.exactArtifacts.reconstructionRecipe;
    const measuredRoles = new Set([
      "normalize_point_cloud",
      "normalize_mesh",
      "reconstruct_from_images",
      "register_sources",
      "fuse_measured_geometry",
      "build_operational_mesh",
    ]);
    expect(
      recipe.stages
        .filter((stage) => measuredRoles.has(stage.id))
        .every((stage) => !stage.inputAssetIds.includes("splat-enhanced")),
    ).toBe(true);
    expect(
      recipe.stages.find((stage) => stage.id === "infer_hd_appearance")?.inputAssetIds,
    ).toEqual(["e57-main", "splat-enhanced"]);
    expect(recipe.stages.find((stage) => stage.id === "qa_candidate")?.inputAssetIds)
      .toEqual(["e57-main", "splat-enhanced"]);
    expect(recipe.stages.find((stage) => stage.id === "package_candidate")?.inputAssetIds)
      .toEqual(["e57-main", "splat-enhanced"]);

    const localCandidate = preview.exactArtifacts.planOnlyDossier.candidates.find(
      (candidate) => candidate.providerKind === "local_cuda",
    );
    const cloudCandidate = preview.exactArtifacts.planOnlyDossier.candidates.find(
      (candidate) => candidate.providerKind === "runpod",
    );
    expect(localCandidate?.jobSpec?.stages).toEqual(recipe.stages);
    expect(cloudCandidate?.jobSpec?.stages).toEqual(recipe.stages);
  });

  it("shows RunPod as blocked when no estimate exists without inventing a zero", () => {
    const input = previewInput();
    input.remoteRoutes[0]!.estimateSnapshot = null as never;
    const preview = compileFoundryPlanPreview(input);

    expect(preview.status).toBe("plan_available");
    expect(preview.routes.local[0]?.status).toBe("plan_available");
    expect(preview.routes.cloud[0]).toMatchObject({
      status: "blocked",
      jobSpecSha256: null,
      blockers: [{ code: "provider_estimate_not_supplied" }],
      cost: {
        state: "not_supplied",
        amountUsd: null,
        budgetCapUsd: null,
        sourceReference: null,
      },
    });
    if (preview.exactArtifacts.state !== "compiled") {
      throw new Error("expected local-only exact dossier");
    }
    expect(preview.exactArtifacts.planOnlyDossier.candidates).toHaveLength(1);
    expect(preview.exactArtifacts.planOnlyDossier.candidates[0]?.providerKind).toBe(
      "local_cuda",
    );
  });

  it("withholds a dossier when every route lacks capacity or pricing facts", () => {
    const input = previewInput();
    input.localRoutes[0]!.capacity = null as never;
    input.remoteRoutes[0]!.capacity = null as never;
    input.remoteRoutes[0]!.estimateSnapshot = null as never;
    const preview = compileFoundryPlanPreview(input);

    expect(preview.status).toBe("all_routes_blocked");
    expect(preview.exactArtifacts.state).toBe("recipe_compiled_routes_incomplete");
    expect(preview.routes.local[0]?.blockers.map((blocker) => blocker.code)).toEqual([
      "route_capacity_not_supplied",
    ]);
    expect(preview.routes.cloud[0]?.blockers.map((blocker) => blocker.code)).toEqual([
      "provider_estimate_not_supplied",
      "route_capacity_not_supplied",
    ]);
    expect(preview.human.summary).toContain("no local or cloud route");
  });

  it("turns unknown rights and missing workers into explicit blockers", () => {
    const unknownRightsManifest = manifest({
      rights: {
        basis: "unknown",
        commercialUse: "unknown",
        modelTrainingUse: "unknown",
        redistribution: "unknown",
        termsReviewedAt: null,
        termsReference: null,
        restrictions: ["Rights have not been reviewed."],
      },
    });
    const rightsPreview = compileFoundryPlanPreview({
      ...previewInput(unknownRightsManifest),
      remoteRoutes: [],
    });
    expect(rightsPreview.status).toBe("all_routes_blocked");
    expect(rightsPreview.routes.local[0]?.blockers.some(
      (blocker) =>
        blocker.code.includes("rights_record_incomplete") &&
        blocker.explanation.includes("rights record"),
    )).toBe(true);

    const missingWorkers = compileFoundryPlanPreview({
      ...previewInput(),
      workerBindings: [],
    });
    expect(missingWorkers.status).toBe("blocked_before_recipe");
    expect(missingWorkers.planningGate.blockers[0]).toMatchObject({
      code: "trusted_worker_binding_missing",
      affectedWorkerRoles: expect.arrayContaining([
        "inspect_sources",
        "normalize_point_cloud",
        "package_candidate",
      ]),
    });
    const { previewSha256: _previewSha256, ...blockedPayload } = missingWorkers;
    const falseOutputPayload = {
      ...blockedPayload,
      truthSeparation: {
        ...blockedPayload.truthSeparation,
        outputStageIds: {
          ...blockedPayload.truthSeparation.outputStageIds,
          capturedDerivatives: ["inspect_sources"],
        },
      },
    };
    expect(() => computeFoundryPlanPreviewSha256(falseOutputPayload)).toThrow(
      "a blocked preview cannot claim compiled output stages",
    );
  });

  it("rejects manifest substitution, extra credential fields, and preview tampering", () => {
    const input = previewInput();
    const otherManifest = manifest({
      sizeBytes: 2_049,
      sha256: `sha256:${"d".repeat(64)}`,
    });
    expect(() => compileFoundryPlanPreview({
      ...input,
      manifest: otherManifest,
    })).toThrow("not the exact manifest bound by the admission result");
    expect(() => compileFoundryPlanPreview({
      ...input,
      apiKey: "must-not-be-accepted",
    })).toThrow("plan preview input is invalid");

    const preview = compileFoundryPlanPreview(input);
    expect(FoundryPlanPreviewV0Schema.safeParse({
      ...preview,
      human: { ...preview.human, headline: "tampered" },
    }).success).toBe(false);
  });

  it("keeps the production bridge free of filesystem, process, network, and SDK calls", async () => {
    const source = await readFile(new URL("../plan-preview.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from\s+["']node:/u);
    expect(source).not.toMatch(/\b(?:fetch|spawn|execFile|fork)\s*\(/u);
    expect(source).not.toMatch(/child_process|node:worker_threads/u);
    expect(source).not.toMatch(/\bprocess\.(?:env|cwd|argv|exit)/u);
    expect(source).not.toMatch(/@aws-sdk|runpod\/sdk|dockerode/u);
  });
});
