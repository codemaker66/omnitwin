import { describe, expect, it } from "vitest";
import {
  FOUNDRY_INGEST_MANIFEST_V0,
  FOUNDRY_TRUSTED_WORKER_PROFILE_V0,
  FoundryIngestManifestV0Schema,
  type FoundryInputType,
  type FoundryWorkerOperationClass,
} from "@omnitwin/types";
import {
  FOUNDRY_PIPELINE_WORKER_ROLES,
  FOUNDRY_RECONSTRUCTION_RECIPE_V0,
  FoundryReconstructionRecipeV0Schema,
  compileFoundryReconstructionRecipe,
  compileFoundryStageAssetRoutingV0,
  computeFoundryReconstructionRecipeSha256,
  toFoundryPlanOnlyRecipe,
  verifyFoundryReconstructionRecipeRoutingV0,
  type FoundryPipelineWorkerRole,
} from "../pipeline-recipe.js";
import {
  FOUNDRY_PLAN_ONLY_REQUEST_V0,
  compileFoundryPlanOnlyDossier,
} from "../plan-only.js";

const NOW = "2026-07-13T10:00:00.000Z";

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

function asset(
  id: string,
  relativePath: string,
  inputType: FoundryInputType,
  index: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    sourceRootId: "source-root",
    relativePath,
    inputType,
    mediaType: "application/octet-stream",
    sizeBytes: 100 + index,
    sha256: `sha256:${index.toString(16).padStart(64, "0")}`,
    immutable: true as const,
    captureState: "official_export" as const,
    accessState: "official_export" as const,
    capturedAt: null,
    coordinateFrameId: "venue-control",
    calibrationAssetIds: [],
    parentAssetIds: [],
    rights: {
      basis: "customer_owned" as const,
      commercialUse: "allowed" as const,
      modelTrainingUse: "allowed" as const,
      redistribution: "allowed" as const,
      termsReviewedAt: NOW,
      termsReference: `https://rights.example/${id}`,
      restrictions: [],
    },
    provenanceClass: "captured" as const,
    evidenceKinds: [],
    inspection: {
      geometryValue: "high" as const,
      appearanceValue: "medium" as const,
      calibrationValue: "medium" as const,
      scaleValue: "high" as const,
      metadataKeys: ["fixture"],
      decisiveNextTest: `Inspect ${relativePath}.`,
    },
    notes: [],
    ...overrides,
  };
}

function manifest() {
  const assets = [
    asset("e57-main", "capture.e57", "generic_e57", 1),
    asset("mesh-main", "model.obj", "obj", 2),
    asset("mesh-glb", "model.glb", "glb_gltf", 3),
    asset("image-main", "frame.jpg", "dslr_image", 4),
    asset("video-main", "walkthrough.mp4", "video", 5),
    asset("splat-captured", "scene.spz", "spz", 6),
  ];
  return FoundryIngestManifestV0Schema.parse({
    schemaVersion: FOUNDRY_INGEST_MANIFEST_V0,
    projectId: "project-001",
    createdAt: "2026-07-13T09:59:00.000Z",
    createdBy: "intake@example.test",
    sourceRoots: [{
      id: "source-root",
      kind: "local_directory",
      displayName: "Read-only sources",
      locationRedacted: "FOUNDRY_SOURCE_ROOT",
      caseSensitivity: "insensitive",
      readOnly: true,
    }],
    coordinateFrames: [{
      id: "venue-control",
      kind: "venue_control",
      units: "meters",
      handedness: "right",
      upAxis: "z",
      authority: "measured",
      provenanceAssetIds: assets.map((candidate) => candidate.id),
      crs: null,
    }],
    transforms: [],
    assets,
    provenanceEdges: [],
    generatedRegions: [],
    legalReviewState: "approved",
    sourceMutationPermitted: false,
  });
}

function mixedProvenanceManifest() {
  const base = manifest();
  const generatedMask = asset(
    "generated-mask",
    "generated/mask.json",
    "evidence_record",
    7,
    {
      captureState: "reference",
      coordinateFrameId: null,
      evidenceKinds: ["mask"],
    },
  );
  const generatedSplat = asset(
    "generated-splat",
    "generated/scene.spz",
    "spz",
    8,
    {
      captureState: "derived",
      provenanceClass: "generated_cinematic",
      parentAssetIds: ["e57-main", "generated-mask"],
    },
  );
  const assets = [
    ...base.assets,
    asset("control-main", "control.json", "control_network", 9),
    asset("splat-enhanced", "enhanced/scene.spz", "spz", 10, {
      provenanceClass: "enhanced_captured",
    }),
    generatedMask,
    generatedSplat,
  ];
  return FoundryIngestManifestV0Schema.parse({
    ...base,
    coordinateFrames: base.coordinateFrames.map((frame) => ({
      ...frame,
      provenanceAssetIds: assets.map((candidate) => candidate.id),
    })),
    assets,
    provenanceEdges: [{
      id: "generated-splat-edge",
      operationId: "generated-splat-operation",
      inputAssetIds: ["e57-main", "generated-mask"],
      outputAssetId: "generated-splat",
      operationVersion: "v1",
      environmentDigest: `sha256:${"a".repeat(64)}`,
      createdAt: NOW,
    }],
    generatedRegions: [{
      id: "generated-splat-region",
      outputAssetId: "generated-splat",
      sourceAssetIds: ["e57-main"],
      maskAssetId: "generated-mask",
      provenanceClass: "generated_cinematic",
      modelName: "fixture-model",
      modelVersion: "v1",
      checkpointSha256: `sha256:${"b".repeat(64)}`,
      promptOrConditionDigest: `sha256:${"c".repeat(64)}`,
      confidence: 0.75,
      exportRestrictions: ["Fixture output remains separately labelled."],
      truthModeDisclosure:
        "This fixture region is generated appearance and is never measured geometry.",
    }],
  });
}

function binding(role: FoundryPipelineWorkerRole, index: number) {
  return {
    role,
    profile: {
      schemaVersion: FOUNDRY_TRUSTED_WORKER_PROFILE_V0,
      profileId: `${role}-worker`,
      profileVersion: "v1",
      operationClass: OPERATION_BY_ROLE[role],
      containerImage:
        `ghcr.io/omnitwin/${role}@sha256:${index.toString(16).padStart(64, "0")}`,
      command: ["foundry-worker", role],
      networkAccess: "object_storage_only",
      localExecutionAllowed: role !== "optimize_neural_scene",
      reviewedBy: "security@example.test",
      reviewedAt: "2026-07-13T09:00:00.000Z",
      expiresAt: "2026-07-14T09:00:00.000Z",
    },
    cpuCores: 8,
    ramGiB: 32,
    gpuCount: role.includes("infer") || role === "optimize_neural_scene" ? 1 : 0,
    minimumGpuVramGiB:
      role.includes("infer") || role === "optimize_neural_scene" ? 24 : 0,
    scratchGiB: 100,
    checkpoint: "stage_boundary",
    resumable: true,
  };
}

function compile(
  options: {
    hdAppearance: "captured_only" | "pretrained_inference" | "rights_gated_training";
    includeSemanticInference: boolean;
    buildOperationalMesh: boolean;
    buildNeuralRepresentation: boolean;
  },
  sourceManifest = manifest(),
) {
  const required = new Set<FoundryPipelineWorkerRole>(
    compileFoundryStageAssetRoutingV0(sourceManifest, options).map((route) => route.role),
  );
  return compileFoundryReconstructionRecipe({
    id: "multimodal-hd-v1",
    displayName: "Multimodal HD reconstruction",
    createdAt: NOW,
    manifest: sourceManifest,
    options,
    workerBindings: FOUNDRY_PIPELINE_WORKER_ROLES
      .filter((role) => required.has(role))
      .map((role, index) => binding(role, index + 1)),
  });
}

describe("Foundry reconstruction recipe compiler", () => {
  it("compiles a deterministic E57/OBJ/GLB/image/video/splat DAG without execution authority", () => {
    const recipe = compile({
      hdAppearance: "captured_only",
      includeSemanticInference: false,
      buildOperationalMesh: true,
      buildNeuralRepresentation: false,
    });
    expect(recipe).toMatchObject({
      schemaVersion: FOUNDRY_RECONSTRUCTION_RECIPE_V0,
      authority: "none",
      capabilities: {
        planning: "recipe_compiled",
        execution: "not_authorized",
      },
    });
    expect(recipe.stages.map((stage) => stage.id)).toEqual([
      "inspect_sources",
      "normalize_point_cloud",
      "normalize_mesh",
      "extract_video_frames",
      "reconstruct_from_images",
      "register_sources",
      "fuse_measured_geometry",
      "build_operational_mesh",
      "enhance_captured_appearance",
      "qa_candidate",
      "package_candidate",
    ]);
    expect(recipe.outputs.filter((output) => output.derivativeClass === "ai_derived"))
      .toEqual([]);
    expect(recipe.outputs.find((output) => output.stageId === "normalize_mesh"))
      .toMatchObject({
        derivativeClass: "captured_derived",
        namespace: "captured",
        mayEnterMeasuredGeometry: false,
      });
    expect(recipe.outputs.find((output) => output.stageId === "register_sources"))
      .toMatchObject({ mayEnterMeasuredGeometry: false });
    expect(recipe.outputs.find((output) => output.stageId === "fuse_measured_geometry"))
      .toMatchObject({ mayEnterMeasuredGeometry: true });
    expect(recipe.outputs.find((output) => output.stageId === "enhance_captured_appearance"))
      .toMatchObject({
        derivativeClass: "enhanced_captured_derived",
        namespace: "enhanced",
        mayEnterMeasuredGeometry: false,
      });
    expect(recipe.outputs.find((output) => output.stageId === "qa_candidate"))
      .toMatchObject({
        derivativeClass: "mixed_candidate",
        namespace: "candidate",
        mayEnterMeasuredGeometry: false,
      });
    expect(FoundryReconstructionRecipeV0Schema.parse(recipe)).toEqual(recipe);
    expect(compile({
      hdAppearance: "captured_only",
      includeSemanticInference: false,
      buildOperationalMesh: true,
      buildNeuralRepresentation: false,
    })).toEqual(recipe);
  });

  it("routes mixed modalities through exact source lanes and a stable non-linear DAG", () => {
    const sourceManifest = mixedProvenanceManifest();
    const options = {
      hdAppearance: "captured_only" as const,
      includeSemanticInference: false,
      buildOperationalMesh: true,
      buildNeuralRepresentation: false,
    };
    const routes = compileFoundryStageAssetRoutingV0(sourceManifest, options);
    const byRole = new Map(routes.map((route) => [route.role, route] as const));
    const allAssetIds = [
      "control-main",
      "e57-main",
      "generated-mask",
      "generated-splat",
      "image-main",
      "mesh-glb",
      "mesh-main",
      "splat-captured",
      "splat-enhanced",
      "video-main",
    ];
    const measuredSourceIds = [
      "control-main",
      "e57-main",
      "image-main",
      "mesh-glb",
      "mesh-main",
      "video-main",
    ];

    expect(routes.map((route) => route.role)).toEqual([
      "inspect_sources",
      "normalize_point_cloud",
      "normalize_mesh",
      "extract_video_frames",
      "reconstruct_from_images",
      "register_sources",
      "fuse_measured_geometry",
      "build_operational_mesh",
      "enhance_captured_appearance",
      "qa_candidate",
      "package_candidate",
    ]);
    expect(byRole.get("inspect_sources")).toEqual({
      role: "inspect_sources",
      dependsOn: [],
      inputAssetIds: allAssetIds,
    });
    expect(byRole.get("normalize_point_cloud")).toEqual({
      role: "normalize_point_cloud",
      dependsOn: ["inspect_sources"],
      inputAssetIds: ["e57-main"],
    });
    expect(byRole.get("normalize_mesh")).toEqual({
      role: "normalize_mesh",
      dependsOn: ["inspect_sources"],
      inputAssetIds: ["mesh-glb", "mesh-main"],
    });
    expect(byRole.get("extract_video_frames")).toEqual({
      role: "extract_video_frames",
      dependsOn: ["inspect_sources"],
      inputAssetIds: ["video-main"],
    });
    expect(byRole.get("reconstruct_from_images")).toEqual({
      role: "reconstruct_from_images",
      dependsOn: ["inspect_sources", "extract_video_frames"],
      inputAssetIds: ["image-main", "video-main"],
    });
    expect(byRole.get("register_sources")).toEqual({
      role: "register_sources",
      dependsOn: [
        "normalize_point_cloud",
        "normalize_mesh",
        "reconstruct_from_images",
      ],
      inputAssetIds: measuredSourceIds,
    });
    expect(byRole.get("fuse_measured_geometry")).toEqual({
      role: "fuse_measured_geometry",
      dependsOn: ["register_sources"],
      inputAssetIds: measuredSourceIds,
    });
    expect(byRole.get("build_operational_mesh")).toEqual({
      role: "build_operational_mesh",
      dependsOn: ["fuse_measured_geometry"],
      inputAssetIds: measuredSourceIds,
    });
    expect(byRole.get("enhance_captured_appearance")).toEqual({
      role: "enhance_captured_appearance",
      dependsOn: ["build_operational_mesh"],
      inputAssetIds: [
        "control-main",
        "e57-main",
        "image-main",
        "mesh-glb",
        "mesh-main",
        "splat-captured",
        "video-main",
      ],
    });
    expect(byRole.get("qa_candidate")).toEqual({
      role: "qa_candidate",
      dependsOn: ["enhance_captured_appearance"],
      inputAssetIds: allAssetIds,
    });
    expect(byRole.get("package_candidate")).toEqual({
      role: "package_candidate",
      dependsOn: ["qa_candidate"],
      inputAssetIds: allAssetIds,
    });
  });

  it("keeps enhanced/generated splats outside measured geometry and is order-independent", () => {
    const sourceManifest = mixedProvenanceManifest();
    const options = {
      hdAppearance: "pretrained_inference" as const,
      includeSemanticInference: true,
      buildOperationalMesh: true,
      buildNeuralRepresentation: false,
    };
    const routes = compileFoundryStageAssetRoutingV0(sourceManifest, options);
    const measuredRoles = new Set<FoundryPipelineWorkerRole>([
      "normalize_point_cloud",
      "normalize_mesh",
      "reconstruct_from_images",
      "register_sources",
      "fuse_measured_geometry",
      "build_operational_mesh",
    ]);
    const provenanceById = new Map(
      sourceManifest.assets.map((candidate) => [candidate.id, candidate.provenanceClass]),
    );
    expect(
      routes
        .filter((route) => measuredRoles.has(route.role))
        .flatMap((route) => route.inputAssetIds)
        .every((assetId) => provenanceById.get(assetId) === "captured"),
    ).toBe(true);
    expect(
      routes
        .filter((route) => measuredRoles.has(route.role))
        .flatMap((route) => route.inputAssetIds)
        .some((assetId) =>
          ["splat-captured", "splat-enhanced", "generated-splat"].includes(assetId)
        ),
    ).toBe(false);
    expect(routes.find((route) => route.role === "infer_hd_appearance")?.inputAssetIds)
      .toEqual([
        "control-main",
        "e57-main",
        "image-main",
        "mesh-glb",
        "mesh-main",
        "splat-captured",
        "splat-enhanced",
        "video-main",
      ]);
    expect(
      routes
        .filter((route) =>
          !["inspect_sources", "qa_candidate", "package_candidate"].includes(route.role)
        )
        .every((route) => !route.inputAssetIds.includes("generated-splat")),
    ).toBe(true);

    const reordered = FoundryIngestManifestV0Schema.parse({
      ...sourceManifest,
      assets: [...sourceManifest.assets].reverse(),
      provenanceEdges: [...sourceManifest.provenanceEdges].reverse(),
      generatedRegions: [...sourceManifest.generatedRegions].reverse(),
    });
    expect(compileFoundryStageAssetRoutingV0(reordered, options)).toEqual(routes);
  });

  it("orders punctuation-bearing asset IDs by explicit code-unit order", () => {
    const base = manifest();
    const assets = [
      asset("a_1", "captures/a_1.e57", "generic_e57", 91),
      asset("a.1", "captures/a.1.e57", "generic_e57", 92),
      asset("a-1", "captures/a-1.e57", "generic_e57", 90),
    ];
    const sourceManifest = FoundryIngestManifestV0Schema.parse({
      ...base,
      coordinateFrames: base.coordinateFrames.map((frame) => ({
        ...frame,
        provenanceAssetIds: assets.map((candidate) => candidate.id),
      })),
      assets,
    });
    const options = {
      hdAppearance: "captured_only" as const,
      includeSemanticInference: false,
      buildOperationalMesh: true,
      buildNeuralRepresentation: false,
    };
    const routes = compileFoundryStageAssetRoutingV0(sourceManifest, options);

    expect(routes.find((route) => route.role === "inspect_sources")?.inputAssetIds)
      .toEqual(["a-1", "a.1", "a_1"]);
    expect(routes.find((route) => route.role === "normalize_point_cloud")?.inputAssetIds)
      .toEqual(["a-1", "a.1", "a_1"]);
    expect(compileFoundryStageAssetRoutingV0({
      ...sourceManifest,
      assets: [...sourceManifest.assets].reverse(),
    }, options)).toEqual(routes);
  });

  it("blocks raw XBIN when no verified processing route exists", () => {
    const base = manifest();
    const xbinManifest = FoundryIngestManifestV0Schema.parse({
      ...base,
      assets: [
        ...base.assets,
        asset("xgrids-main", "capture.xbin", "xgrids_xbin", 99, {
          captureState: "reference",
          accessState: "blocked_technical",
          coordinateFrameId: null,
        }),
      ],
    });
    const options = {
      hdAppearance: "captured_only",
      includeSemanticInference: false,
      buildOperationalMesh: true,
      buildNeuralRepresentation: false,
    } as const;
    expect(() => compileFoundryStageAssetRoutingV0(xbinManifest, options))
      .toThrow("Raw XGRIDS .xbin assets have no verified processing route");
    expect(() => compileFoundryReconstructionRecipe({
      id: "blocked-xbin",
      displayName: "Blocked XBIN",
      createdAt: NOW,
      manifest: xbinManifest,
      options,
      workerBindings: [{ invalid: "must not be parsed before routing" }],
    })).toThrow("Raw XGRIDS .xbin assets have no verified processing route");
  });

  it("keeps opaque vendor containers in inspection, QA, and package lanes only", () => {
    const base = manifest();
    const opaqueIds = ["lcc-main", "lcc2-main", "matterpak-main", "mcap-main"];
    const sourceManifest = FoundryIngestManifestV0Schema.parse({
      ...base,
      assets: [
        ...base.assets,
        asset("lcc-main", "archive/scene.lcc", "lcc", 70),
        asset("lcc2-main", "archive/scene.lcc2", "lcc2", 71),
        asset("matterpak-main", "archive/space.zip", "matterpak_bundle", 72),
        asset("mcap-main", "archive/sensors.mcap", "sensor_log_mcap", 73),
      ],
    });
    const routes = compileFoundryStageAssetRoutingV0(sourceManifest, {
      hdAppearance: "captured_only",
      includeSemanticInference: false,
      buildOperationalMesh: true,
      buildNeuralRepresentation: false,
    });
    for (const opaqueId of opaqueIds) {
      expect(
        routes
          .filter((route) => route.inputAssetIds.includes(opaqueId))
          .map((route) => route.role),
      ).toEqual(["inspect_sources", "qa_candidate", "package_candidate"]);
    }
  });

  it("verifies exact stage routing and rejects rehashed route or output substitutions", () => {
    const sourceManifest = mixedProvenanceManifest();
    const options = {
      hdAppearance: "captured_only" as const,
      includeSemanticInference: false,
      buildOperationalMesh: true,
      buildNeuralRepresentation: false,
    };
    const recipe = compile(options, sourceManifest);
    expect(verifyFoundryReconstructionRecipeRoutingV0(recipe, sourceManifest)).toEqual(recipe);

    const { recipeSha256: _recipeSha256, ...payload } = recipe;
    const routeSubstitutionPayload = {
      ...payload,
      stages: payload.stages.map((stage) =>
        stage.id === "fuse_measured_geometry"
          ? {
            ...stage,
            inputAssetIds: [...stage.inputAssetIds, "generated-splat"],
          }
          : stage
      ),
    };
    const routeSubstitution = {
      ...routeSubstitutionPayload,
      recipeSha256: computeFoundryReconstructionRecipeSha256(routeSubstitutionPayload),
    };
    expect(() => verifyFoundryReconstructionRecipeRoutingV0(
      routeSubstitution,
      sourceManifest,
    )).toThrow("stage routing does not match the deterministic manifest route");

    const outputSubstitutionPayload = {
      ...payload,
      outputs: payload.outputs.map((output) =>
        output.stageId === "normalize_point_cloud"
          ? { ...output, sourceAssetIds: ["generated-splat"] }
          : output
      ),
    };
    const outputSubstitution = {
      ...outputSubstitutionPayload,
      recipeSha256: computeFoundryReconstructionRecipeSha256(outputSubstitutionPayload),
    };
    expect(() => verifyFoundryReconstructionRecipeRoutingV0(
      outputSubstitution,
      sourceManifest,
    )).toThrow("output lineage does not match the deterministic manifest route");

    const reorderedOutputPayload = {
      ...payload,
      outputs: [...payload.outputs].reverse(),
    };
    expect(() => verifyFoundryReconstructionRecipeRoutingV0({
      ...reorderedOutputPayload,
      recipeSha256: computeFoundryReconstructionRecipeSha256(reorderedOutputPayload),
    }, sourceManifest)).toThrow(
      "output set does not match the deterministic manifest route",
    );
  });

  it("rejects rehashed mutations of deterministic stage policy fields", () => {
    const sourceManifest = manifest();
    const recipe = compile({
      hdAppearance: "rights_gated_training",
      includeSemanticInference: false,
      buildOperationalMesh: true,
      buildNeuralRepresentation: true,
    }, sourceManifest);
    const { recipeSha256: _recipeSha256, ...payload } = recipe;
    const mutations = [
      payload.stages.map((stage) =>
        stage.id === "optimize_neural_scene"
          ? { ...stage, rightsPurposes: ["commercial_internal_use" as const] }
          : stage
      ),
      payload.stages.map((stage) =>
        stage.id === "fuse_measured_geometry"
          ? { ...stage, kind: "inspect" as const }
          : stage
      ),
      payload.stages.map((stage) =>
        stage.id === "fuse_measured_geometry"
          ? { ...stage, outputNames: ["forged-output"] }
          : stage
      ),
    ];

    for (const stages of mutations) {
      const mutatedPayload = { ...payload, stages };
      const mutatedRecipe = {
        ...mutatedPayload,
        recipeSha256: computeFoundryReconstructionRecipeSha256(mutatedPayload),
      };
      expect(FoundryReconstructionRecipeV0Schema.safeParse(mutatedRecipe).success).toBe(true);
      expect(() => verifyFoundryReconstructionRecipeRoutingV0(
        mutatedRecipe,
        sourceManifest,
      )).toThrow("stage policy does not match its deterministic pipeline role");
    }
  });

  it("isolates pretrained AI appearance and semantics from measured geometry", () => {
    const recipe = compile({
      hdAppearance: "pretrained_inference",
      includeSemanticInference: true,
      buildOperationalMesh: true,
      buildNeuralRepresentation: false,
    });
    const aiOutputs = recipe.outputs.filter(
      (output) => output.derivativeClass === "ai_derived",
    );
    expect(aiOutputs.map((output) => output.stageId)).toEqual([
      "infer_hd_appearance",
      "infer_semantics",
    ]);
    expect(aiOutputs.every(
      (output) => output.namespace === "ai" && !output.mayEnterMeasuredGeometry,
    )).toBe(true);
    expect(recipe.stages.find((stage) => stage.id === "infer_hd_appearance")?.rightsPurposes)
      .toEqual(["commercial_internal_use"]);
  });

  it("rejects premature measured eligibility even if a caller tries to rehash it", () => {
    const recipe = compile({
      hdAppearance: "captured_only",
      includeSemanticInference: false,
      buildOperationalMesh: true,
      buildNeuralRepresentation: false,
    });
    const { recipeSha256: _recipeSha256, ...payload } = recipe;
    const ineligibleCapturedStageIds = payload.outputs
      .filter((output) =>
        output.derivativeClass === "captured_derived" &&
        !output.mayEnterMeasuredGeometry
      )
      .map((output) => output.stageId);
    expect(ineligibleCapturedStageIds).toEqual([
      "inspect_sources",
      "normalize_point_cloud",
      "normalize_mesh",
      "extract_video_frames",
      "reconstruct_from_images",
      "register_sources",
    ]);

    for (const stageId of ineligibleCapturedStageIds) {
      const unsafePayload = {
        ...payload,
        outputs: payload.outputs.map((output) =>
          output.stageId === stageId
            ? { ...output, mayEnterMeasuredGeometry: true }
            : output
        ),
      };
      expect(() => computeFoundryReconstructionRecipeSha256(unsafePayload))
        .toThrow("only fused captured geometry and operational-mesh outputs");
    }
  });

  it("marks neural optimization as rights-gated training and routes it away from local", () => {
    const recipe = compile({
      hdAppearance: "rights_gated_training",
      includeSemanticInference: false,
      buildOperationalMesh: true,
      buildNeuralRepresentation: true,
    });
    expect(recipe.stages.find((stage) => stage.id === "optimize_neural_scene")?.rightsPurposes)
      .toEqual(["model_training"]);
    const planRecipe = toFoundryPlanOnlyRecipe(recipe);
    const capacity = {
      cpuCores: 64,
      ramGiB: 256,
      gpuCount: 4,
      perGpuVramGiB: 80,
      scratchGiB: 2_000,
      maximumInputBytes: 1_000_000,
    };
    const dossier = compileFoundryPlanOnlyDossier({
      schemaVersion: FOUNDRY_PLAN_ONLY_REQUEST_V0,
      id: "neural-route-v1",
      projectId: "project-001",
      ingestManifestSha256: recipe.ingestManifestSha256,
      createdAt: NOW,
      recipe: planRecipe,
      localRoutes: [{
        providerKind: "local_cuda",
        providerAdapterId: "local-cuda-v1",
        capacity,
      }],
      remoteRoutes: [{
        providerKind: "runpod",
        providerAdapterId: "runpod-v1",
        objectStorageProfile: "foundry-private",
        capacity,
        estimateSnapshot: {
          currency: "USD",
          observedAt: "2026-07-13T09:59:00.000Z",
          expiresAt: "2026-07-13T11:00:00.000Z",
          sourceReference: "trusted-pricing-snapshot-001",
          breakdown: {
            computeUsd: 1,
            storageUsd: 0.1,
            egressUsd: 0.1,
            imageAndModelPullUsd: 0.1,
            retryAllowanceUsd: 0,
            safetyMarginUsd: 0.2,
          },
          budgetCapUsd: 2,
        },
      }],
    }, manifest());
    expect(dossier.candidates.find((candidate) => candidate.providerKind === "local_cuda"))
      .toMatchObject({
        status: "blocked_plan_only",
        blockers: expect.arrayContaining(["d016_local_model_training_forbidden"]),
      });
    expect(dossier.candidates.find((candidate) => candidate.providerKind === "runpod"))
      .toMatchObject({ status: "viable_plan_only" });
  });

  it("preserves upstream source rights through neural-stage dependencies", () => {
    const sourceManifest = mixedProvenanceManifest();
    const restrictedManifest = FoundryIngestManifestV0Schema.parse({
      ...sourceManifest,
      legalReviewState: "requires_review",
      assets: sourceManifest.assets.map((candidate) =>
        candidate.id === "control-main"
          ? {
            ...candidate,
            rights: {
              ...candidate.rights,
              modelTrainingUse: "prohibited",
            },
          }
          : candidate
      ),
    });
    const recipe = compile({
      hdAppearance: "rights_gated_training",
      includeSemanticInference: false,
      buildOperationalMesh: true,
      buildNeuralRepresentation: true,
    }, restrictedManifest);
    expect(
      recipe.stages.find((stage) => stage.id === "optimize_neural_scene")?.inputAssetIds,
    ).toContain("control-main");

    const planRecipe = toFoundryPlanOnlyRecipe(recipe);
    const dossier = compileFoundryPlanOnlyDossier({
      schemaVersion: FOUNDRY_PLAN_ONLY_REQUEST_V0,
      id: "neural-rights-closure-v1",
      projectId: restrictedManifest.projectId,
      ingestManifestSha256: recipe.ingestManifestSha256,
      createdAt: NOW,
      recipe: planRecipe,
      localRoutes: [],
      remoteRoutes: [{
        providerKind: "runpod",
        providerAdapterId: "runpod-rights-closure-v1",
        objectStorageProfile: "foundry-private",
        capacity: {
          cpuCores: 64,
          ramGiB: 256,
          gpuCount: 4,
          perGpuVramGiB: 80,
          scratchGiB: 2_000,
          maximumInputBytes: 1_000_000,
        },
        estimateSnapshot: {
          currency: "USD",
          observedAt: "2026-07-13T09:59:00.000Z",
          expiresAt: "2026-07-13T11:00:00.000Z",
          sourceReference: "trusted-pricing-snapshot-rights-closure",
          breakdown: {
            computeUsd: 1,
            storageUsd: 0.1,
            egressUsd: 0.1,
            imageAndModelPullUsd: 0.1,
            retryAllowanceUsd: 0,
            safetyMarginUsd: 0.2,
          },
          budgetCapUsd: 2,
        },
      }],
    }, restrictedManifest);
    expect(dossier.candidates[0]).toMatchObject({
      status: "blocked_plan_only",
      blockers: expect.arrayContaining([
        "rights:optimize_neural_scene:control-main:model_training_not_allowed",
      ]),
    });
  });

  it("fails closed for missing, unused, or operation-mismatched worker identity", () => {
    const baseOptions = {
      hdAppearance: "captured_only" as const,
      includeSemanticInference: false,
      buildOperationalMesh: true,
      buildNeuralRepresentation: false,
    };
    const complete = compile(baseOptions);
    const roles = complete.stages.map((stage) => stage.id as FoundryPipelineWorkerRole);
    const bindings = roles.map((role, index) => binding(role, index + 1));
    expect(() => compileFoundryReconstructionRecipe({
      id: "missing-worker",
      displayName: "Missing worker",
      createdAt: NOW,
      manifest: manifest(),
      options: baseOptions,
      workerBindings: bindings.slice(1),
    })).toThrow("Trusted worker binding is missing");
    expect(() => compileFoundryReconstructionRecipe({
      id: "unused-worker",
      displayName: "Unused worker",
      createdAt: NOW,
      manifest: manifest(),
      options: baseOptions,
      workerBindings: [...bindings, binding("infer_semantics", 99)],
    })).toThrow("unused trusted worker binding");
    expect(() => compileFoundryReconstructionRecipe({
      id: "wrong-operation",
      displayName: "Wrong operation",
      createdAt: NOW,
      manifest: manifest(),
      options: baseOptions,
      workerBindings: bindings.map((candidate) =>
        candidate.role === "inspect_sources"
          ? {
            ...candidate,
            profile: {
              ...candidate.profile,
              operationClass: "model_inference",
            },
          }
          : candidate
      ),
    })).toThrow();
  });

  it("rejects derivative namespace tampering", () => {
    const recipe = compile({
      hdAppearance: "pretrained_inference",
      includeSemanticInference: false,
      buildOperationalMesh: true,
      buildNeuralRepresentation: false,
    });
    expect(FoundryReconstructionRecipeV0Schema.safeParse({
      ...recipe,
      outputs: recipe.outputs.map((output) =>
        output.derivativeClass === "ai_derived"
          ? { ...output, namespace: "captured", mayEnterMeasuredGeometry: true }
          : output
      ),
    }).success).toBe(false);
  });
});
