import {
  FoundryIngestManifestV0Schema,
  FoundryJobStageSchema,
  FoundryTrustedWorkerProfileV0Schema,
  FoundryUtcInstantSchema,
  RuntimeManifestKeySchema,
  RuntimeSha256Schema,
  computeFoundryIngestManifestSha256,
  computeFoundryTrustedWorkerProfileSha256,
  type FoundryIngestManifestV0,
  type FoundryInputType,
  type FoundryJobSpecV0,
  type FoundryWorkerOperationClass,
} from "@omnitwin/types";
import { z } from "zod";
import { domainSeparatedSha256, toCanonicalJson } from "./canonical-json.js";
import { compareCanonicalStrings } from "./canonical-order.js";
import { FoundryIntegrityError } from "./errors.js";

export const FOUNDRY_RECONSTRUCTION_RECIPE_V0 =
  "omnitwin.foundry.reconstruction-recipe.v0";

export const FOUNDRY_PIPELINE_WORKER_ROLES = [
  "inspect_sources",
  "decode_xgrids",
  "normalize_point_cloud",
  "normalize_mesh",
  "extract_video_frames",
  "reconstruct_from_images",
  "register_sources",
  "fuse_measured_geometry",
  "build_operational_mesh",
  "enhance_captured_appearance",
  "infer_hd_appearance",
  "infer_semantics",
  "optimize_neural_scene",
  "qa_candidate",
  "package_candidate",
] as const;

export const FoundryPipelineWorkerRoleSchema = z.enum(
  FOUNDRY_PIPELINE_WORKER_ROLES,
);
export type FoundryPipelineWorkerRole = z.infer<
  typeof FoundryPipelineWorkerRoleSchema
>;

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

const STAGE_KIND_BY_ROLE: Readonly<
  Record<FoundryPipelineWorkerRole, FoundryJobSpecV0["stages"][number]["kind"]>
> = {
  inspect_sources: "inspect",
  decode_xgrids: "inspect",
  normalize_point_cloud: "geometry",
  normalize_mesh: "geometry",
  extract_video_frames: "inspect",
  reconstruct_from_images: "geometry",
  register_sources: "register",
  fuse_measured_geometry: "geometry",
  build_operational_mesh: "geometry",
  enhance_captured_appearance: "enhance",
  infer_hd_appearance: "appearance",
  infer_semantics: "semantics",
  optimize_neural_scene: "appearance",
  qa_candidate: "qa",
  package_candidate: "package",
};

const RIGHT_BY_OPERATION = {
  read_only_inspection: "commercial_internal_use",
  deterministic_transformation: "commercial_internal_use",
  model_inference: "commercial_internal_use",
  model_training: "model_training",
  redistribution_packaging: "redistribution",
  public_release: "public_release",
} as const;

export const FoundryPipelineWorkerBindingV0Schema = z
  .object({
    role: FoundryPipelineWorkerRoleSchema,
    profile: FoundryTrustedWorkerProfileV0Schema,
    cpuCores: z.number().int().positive().max(1_024),
    ramGiB: z.number().positive().max(100_000),
    gpuCount: z.number().int().nonnegative().max(128),
    minimumGpuVramGiB: z.number().nonnegative().max(1_000),
    scratchGiB: z.number().positive().max(1_000_000),
    checkpoint: z.enum(["none", "stage_boundary", "periodic"]),
    resumable: z.boolean(),
  })
  .strict()
  .superRefine((binding, ctx) => {
    if (binding.profile.operationClass !== OPERATION_BY_ROLE[binding.role]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["profile", "operationClass"],
        message: "worker profile operation does not match its trusted pipeline role",
      });
    }
    if (binding.gpuCount === 0 && binding.minimumGpuVramGiB !== 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["minimumGpuVramGiB"],
        message: "CPU worker bindings cannot request GPU VRAM",
      });
    }
    if (binding.resumable && binding.checkpoint === "none") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["checkpoint"],
        message: "resumable worker bindings require checkpoints",
      });
    }
  });
export type FoundryPipelineWorkerBindingV0 = z.infer<
  typeof FoundryPipelineWorkerBindingV0Schema
>;

export const FoundryReconstructionRecipeOptionsV0Schema = z
  .object({
    hdAppearance: z.enum([
      "captured_only",
      "pretrained_inference",
      "rights_gated_training",
    ]),
    includeSemanticInference: z.boolean(),
    buildOperationalMesh: z.boolean(),
    buildNeuralRepresentation: z.boolean(),
  })
  .strict()
  .superRefine((options, ctx) => {
    if (
      options.buildNeuralRepresentation &&
      options.hdAppearance !== "rights_gated_training"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["buildNeuralRepresentation"],
        message: "neural scene optimization requires the explicit rights-gated training mode",
      });
    }
  });
export type FoundryReconstructionRecipeOptionsV0 = z.infer<
  typeof FoundryReconstructionRecipeOptionsV0Schema
>;

const MEASURED_ELIGIBLE_OUTPUT_STAGE_IDS: ReadonlySet<string> = new Set([
  "fuse_measured_geometry",
  "build_operational_mesh",
]);

const FoundryRecipeOutputSchema = z
  .object({
    stageId: RuntimeManifestKeySchema,
    name: RuntimeManifestKeySchema,
    derivativeClass: z.enum([
      "captured_derived",
      "enhanced_captured_derived",
      "ai_derived",
      "mixed_candidate",
    ]),
    namespace: z.enum(["captured", "enhanced", "ai", "candidate"]),
    sourceAssetIds: z.array(RuntimeManifestKeySchema).max(100_000),
    mayEnterMeasuredGeometry: z.boolean(),
  })
  .strict()
  .superRefine((output, ctx) => {
    const expectedNamespace = output.derivativeClass === "captured_derived"
      ? "captured"
      : output.derivativeClass === "enhanced_captured_derived"
        ? "enhanced"
        : output.derivativeClass === "ai_derived"
          ? "ai"
          : "candidate";
    if (output.namespace !== expectedNamespace) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["namespace"],
        message: "derivative class must use its isolated output namespace",
      });
    }
    if (
      output.mayEnterMeasuredGeometry &&
      (
        output.derivativeClass !== "captured_derived" ||
        !MEASURED_ELIGIBLE_OUTPUT_STAGE_IDS.has(output.stageId)
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mayEnterMeasuredGeometry"],
        message:
          "only fused captured geometry and operational-mesh outputs can enter measured-geometry review",
      });
    }
  });

const FoundryReconstructionRecipePayloadObjectV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_RECONSTRUCTION_RECIPE_V0),
    id: RuntimeManifestKeySchema,
    displayName: z.string().trim().min(1).max(160),
    projectId: RuntimeManifestKeySchema,
    createdAt: FoundryUtcInstantSchema,
    ingestManifestSha256: RuntimeSha256Schema,
    options: FoundryReconstructionRecipeOptionsV0Schema,
    stages: z.array(FoundryJobStageSchema).min(1).max(1_000),
    workerProfileSha256s: z.array(RuntimeSha256Schema).min(1).max(1_000),
    outputs: z.array(FoundryRecipeOutputSchema).min(1).max(10_000),
    authority: z.literal("none"),
    capabilities: z
      .object({
        planning: z.literal("recipe_compiled"),
        execution: z.literal("not_authorized"),
        signing: z.literal("not_authorized"),
        publication: z.literal("not_authorized"),
        promotion: z.literal("not_authorized"),
      })
      .strict(),
  })
  .strict();

type RecipePayloadObject = z.infer<
  typeof FoundryReconstructionRecipePayloadObjectV0Schema
>;

function validateRecipePayload(
  recipe: RecipePayloadObject,
  ctx: z.RefinementCtx,
): void {
    const profileDigests = recipe.workerProfileSha256s;
    if (
      new Set(profileDigests).size !== profileDigests.length ||
      profileDigests.some((digest, index) => {
        const previous = index > 0 ? profileDigests[index - 1] : undefined;
        return previous !== undefined && previous >= digest;
      })
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["workerProfileSha256s"],
        message: "worker profile digests must be unique and sorted",
      });
    }
    const stageIds = new Set(recipe.stages.map((stage) => stage.id));
    if (recipe.outputs.some((output) => !stageIds.has(output.stageId))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["outputs"],
        message: "every recipe output must belong to a declared stage",
      });
    }
}

const FoundryReconstructionRecipePayloadV0Schema =
  FoundryReconstructionRecipePayloadObjectV0Schema.superRefine(
    validateRecipePayload,
  );

export const FoundryReconstructionRecipeV0Schema =
  FoundryReconstructionRecipePayloadObjectV0Schema.extend({
    recipeSha256: RuntimeSha256Schema,
  })
    .strict()
    .superRefine((recipe, ctx) => {
      validateRecipePayload(recipe, ctx);
      const { recipeSha256: _recipeSha256, ...payload } = recipe;
      const parsed = FoundryReconstructionRecipePayloadV0Schema.safeParse(payload);
      if (!parsed.success) return;
      if (recipe.recipeSha256 !== computeFoundryReconstructionRecipeSha256(parsed.data)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["recipeSha256"],
          message: "reconstruction recipe digest must match its exact payload",
        });
      }
    });
export type FoundryReconstructionRecipeV0 = z.infer<
  typeof FoundryReconstructionRecipeV0Schema
>;

type RecipePayload = z.infer<typeof FoundryReconstructionRecipePayloadV0Schema>;

export function computeFoundryReconstructionRecipeSha256(
  input: RecipePayload,
): string {
  const parsed = FoundryReconstructionRecipePayloadV0Schema.parse(input);
  return `sha256:${domainSeparatedSha256(
    "OMNITWIN_FOUNDRY_RECONSTRUCTION_RECIPE_V0",
    toCanonicalJson(parsed),
  )}`;
}

const POINT_CLOUD_TYPES: ReadonlySet<FoundryInputType> = new Set([
  "matterport_e57",
  "generic_e57",
  "las_laz",
  "xyz_point_cloud",
  "ply_point_cloud",
  "rgbd",
]);
const MESH_TYPES: ReadonlySet<FoundryInputType> = new Set([
  "obj",
  "fbx",
  "glb_gltf",
  "cad_bim",
  "openusd",
]);
const IMAGE_TYPES: ReadonlySet<FoundryInputType> = new Set([
  "matterport_panorama",
  "dslr_image",
  "generic_image",
  "panorama_360",
  "phone_image",
  "drone_media",
]);
const APPEARANCE_SPLAT_TYPES: ReadonlySet<FoundryInputType> = new Set([
  "spz",
  "sog",
  "gaussian_ply",
]);
const VISUAL_TYPES: ReadonlySet<FoundryInputType> = new Set<FoundryInputType>([
  ...POINT_CLOUD_TYPES,
  ...MESH_TYPES,
  ...IMAGE_TYPES,
  "video",
  ...APPEARANCE_SPLAT_TYPES,
]);
const RECONSTRUCTION_SUPPORT_TYPES: ReadonlySet<FoundryInputType> = new Set([
  "calibration_bundle",
  "trajectory",
  "colmap_database",
  "colmap_sparse_model",
]);
const REGISTRATION_SUPPORT_TYPES: ReadonlySet<FoundryInputType> = new Set([
  "imu",
  "gnss_rtk",
  "calibration_bundle",
  "trajectory",
  "control_network",
  "colmap_database",
  "colmap_sparse_model",
]);
const SEMANTIC_CONTEXT_TYPES: ReadonlySet<FoundryInputType> = new Set([
  ...VISUAL_TYPES,
  "floor_plan",
]);

const PIPELINE_ROLE_ORDER = new Map<FoundryPipelineWorkerRole, number>(
  FOUNDRY_PIPELINE_WORKER_ROLES.map((role, index) => [role, index]),
);

export interface FoundryStageAssetRouteV0 {
  readonly role: FoundryPipelineWorkerRole;
  readonly dependsOn: readonly FoundryPipelineWorkerRole[];
  readonly inputAssetIds: readonly string[];
}

export type FoundryStageAssetRoutingV0 = readonly FoundryStageAssetRouteV0[];

function fail(code: string, message: string): never {
  throw new FoundryIntegrityError(code, message);
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareCanonicalStrings);
}

function sortedRoles(
  values: readonly FoundryPipelineWorkerRole[],
): FoundryPipelineWorkerRole[] {
  return [...new Set(values)].sort(
    (left, right) =>
      (PIPELINE_ROLE_ORDER.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (PIPELINE_ROLE_ORDER.get(right) ?? Number.MAX_SAFE_INTEGER),
  );
}

/**
 * Compiles the exact manifest assets that each planning stage may read.
 * It is deterministic, performs no I/O, and grants no execution authority.
 */
export function compileFoundryStageAssetRoutingV0(
  manifestInput: unknown,
  optionsInput: unknown,
): FoundryStageAssetRoutingV0 {
  const manifest = FoundryIngestManifestV0Schema.parse(manifestInput);
  const options = FoundryReconstructionRecipeOptionsV0Schema.parse(optionsInput);
  const assets = [...manifest.assets].sort((left, right) =>
    compareCanonicalStrings(left.id, right.id)
  );
  const allAssetIds = assets.map((asset) => asset.id);
  const xbinAssetIds = assets
    .filter((asset) => asset.inputType === "xgrids_xbin")
    .map((asset) => asset.id);
  if (xbinAssetIds.length > 0) {
    fail(
      "PIPELINE_INPUT_UNROUTABLE_XGRIDS_XBIN",
      `Raw XGRIDS .xbin assets have no verified processing route: ${xbinAssetIds.join(", ")}.`,
    );
  }

  const ids = (
    predicate: (asset: FoundryIngestManifestV0["assets"][number]) => boolean,
  ): string[] => assets.filter(predicate).map((asset) => asset.id);
  const captured = (asset: FoundryIngestManifestV0["assets"][number]): boolean =>
    asset.provenanceClass === "captured";
  const capturedPointCloudIds = ids(
    (asset) => captured(asset) && POINT_CLOUD_TYPES.has(asset.inputType),
  );
  const capturedMeshIds = ids(
    (asset) => captured(asset) && MESH_TYPES.has(asset.inputType),
  );
  const capturedImageIds = ids(
    (asset) => captured(asset) && IMAGE_TYPES.has(asset.inputType),
  );
  const capturedVideoIds = ids(
    (asset) => captured(asset) && asset.inputType === "video",
  );
  const capturedReconstructionSupportIds = ids(
    (asset) => captured(asset) && RECONSTRUCTION_SUPPORT_TYPES.has(asset.inputType),
  );
  const capturedRegistrationSupportIds = ids(
    (asset) => captured(asset) && REGISTRATION_SUPPORT_TYPES.has(asset.inputType),
  );
  const measuredGeometrySourceIds = sortedUnique([
    ...capturedPointCloudIds,
    ...capturedMeshIds,
    ...capturedImageIds,
    ...capturedVideoIds,
  ]);
  const measuredGeometrySourceIdSet = new Set(measuredGeometrySourceIds);
  const referencedRegistrationAssetIds = new Set<string>();
  for (const asset of assets) {
    if (!measuredGeometrySourceIdSet.has(asset.id)) continue;
    for (const calibrationAssetId of asset.calibrationAssetIds) {
      referencedRegistrationAssetIds.add(calibrationAssetId);
    }
  }
  for (const transform of manifest.transforms) {
    if (transform.state !== "reviewed") continue;
    const referencedIds = [
      ...transform.provenanceAssetIds,
      transform.transformArtifactAssetId,
      transform.residualReportAssetId,
      transform.projectionArtifactAssetId,
      transform.reviewerAttestationAssetId,
    ].filter((value): value is string => value !== null);
    for (const referencedId of referencedIds) {
      referencedRegistrationAssetIds.add(referencedId);
    }
  }
  const capturedReferencedRegistrationAssetIds = ids(
    (asset) => captured(asset) && referencedRegistrationAssetIds.has(asset.id),
  );
  const registeredSourceIds = sortedUnique([
    ...measuredGeometrySourceIds,
    ...capturedRegistrationSupportIds,
    ...capturedReferencedRegistrationAssetIds,
  ]);
  const reconstructionSourceIds = sortedUnique([
    ...capturedImageIds,
    ...capturedVideoIds,
    ...capturedReconstructionSupportIds,
  ]);
  const capturedAppearanceIds = ids(
    (asset) => captured(asset) && VISUAL_TYPES.has(asset.inputType),
  );
  const conditionable = (asset: FoundryIngestManifestV0["assets"][number]): boolean =>
    asset.provenanceClass === "captured" || asset.provenanceClass === "enhanced_captured";
  const conditionableAppearanceIds = ids(
    (asset) => conditionable(asset) && VISUAL_TYPES.has(asset.inputType),
  );
  const semanticContextIds = ids(
    (asset) => conditionable(asset) && SEMANTIC_CONTEXT_TYPES.has(asset.inputType),
  );

  const routes: FoundryStageAssetRouteV0[] = [];
  const addRoute = (
    role: FoundryPipelineWorkerRole,
    dependsOn: readonly FoundryPipelineWorkerRole[],
    inputAssetIds: readonly string[],
  ): void => {
    routes.push({
      role,
      dependsOn: sortedRoles(dependsOn),
      inputAssetIds: sortedUnique(inputAssetIds),
    });
  };

  addRoute("inspect_sources", [], allAssetIds);
  if (capturedPointCloudIds.length > 0) {
    addRoute("normalize_point_cloud", ["inspect_sources"], capturedPointCloudIds);
  }
  if (capturedMeshIds.length > 0) {
    addRoute("normalize_mesh", ["inspect_sources"], capturedMeshIds);
  }
  if (capturedVideoIds.length > 0) {
    addRoute("extract_video_frames", ["inspect_sources"], capturedVideoIds);
  }
  if (capturedImageIds.length + capturedVideoIds.length > 0) {
    addRoute(
      "reconstruct_from_images",
      [
        "inspect_sources",
        ...(capturedVideoIds.length > 0 ? ["extract_video_frames" as const] : []),
      ],
      reconstructionSourceIds,
    );
  }

  const geometryProducerRoles = routes
    .filter((route) =>
      route.role === "normalize_point_cloud" || route.role === "normalize_mesh" ||
      route.role === "reconstruct_from_images"
    )
    .map((route) => route.role);
  let geometryTerminalRole: FoundryPipelineWorkerRole | null = null;
  if (geometryProducerRoles.length > 0) {
    addRoute("register_sources", geometryProducerRoles, registeredSourceIds);
    addRoute("fuse_measured_geometry", ["register_sources"], registeredSourceIds);
    geometryTerminalRole = "fuse_measured_geometry";
    if (options.buildOperationalMesh) {
      addRoute("build_operational_mesh", ["fuse_measured_geometry"], registeredSourceIds);
      geometryTerminalRole = "build_operational_mesh";
    }
  }

  let appearanceBaseRole: FoundryPipelineWorkerRole | null = geometryTerminalRole;
  let appearanceSourceIds = geometryTerminalRole === null ? [] : registeredSourceIds;
  if (capturedAppearanceIds.length > 0) {
    appearanceSourceIds = sortedUnique([
      ...appearanceSourceIds,
      ...capturedAppearanceIds,
    ]);
    addRoute(
      "enhance_captured_appearance",
      [geometryTerminalRole ?? "inspect_sources"],
      appearanceSourceIds,
    );
    appearanceBaseRole = "enhance_captured_appearance";
  }
  if (
    options.hdAppearance !== "captured_only" &&
    conditionableAppearanceIds.length > 0
  ) {
    appearanceSourceIds = sortedUnique([
      ...appearanceSourceIds,
      ...conditionableAppearanceIds,
    ]);
    addRoute(
      "infer_hd_appearance",
      [appearanceBaseRole ?? "inspect_sources"],
      appearanceSourceIds,
    );
  }
  if (options.includeSemanticInference && semanticContextIds.length > 0) {
    addRoute(
      "infer_semantics",
      [appearanceBaseRole ?? "inspect_sources"],
      sortedUnique([...appearanceSourceIds, ...semanticContextIds]),
    );
  }
  if (options.buildNeuralRepresentation && geometryTerminalRole !== null) {
    addRoute(
      "optimize_neural_scene",
      ["fuse_measured_geometry"],
      registeredSourceIds,
    );
  }

  const referencedDependencies = new Set(
    routes.flatMap((route) => route.dependsOn),
  );
  const terminalRoles = routes
    .map((route) => route.role)
    .filter((role) => role !== "inspect_sources" && !referencedDependencies.has(role));
  addRoute(
    "qa_candidate",
    terminalRoles.length > 0 ? terminalRoles : ["inspect_sources"],
    allAssetIds,
  );
  addRoute("package_candidate", ["qa_candidate"], allAssetIds);
  const routeByRole = new Map(routes.map((route) => [route.role, route] as const));
  const routeIndexByRole = new Map(routes.map((route, index) => [route.role, index] as const));
  const routeSourceIdsByRole = new Map(
    routes.map((route) => [route.role, new Set(route.inputAssetIds)] as const),
  );
  if (routeByRole.size !== routes.length) {
    fail("PIPELINE_ROUTING_ROLE_DUPLICATE", "Deterministic stage routing contains a duplicate role.");
  }
  for (const [routeIndex, route] of routes.entries()) {
    if (route.inputAssetIds.length === 0) {
      fail(
        "PIPELINE_ROUTING_SOURCE_SET_EMPTY",
        `Stage ${route.role} has no meaningful manifest-source input.`,
      );
    }
    for (const dependencyRole of route.dependsOn) {
      const dependency = routeByRole.get(dependencyRole);
      if (
        dependency === undefined ||
        (routeIndexByRole.get(dependencyRole) ?? Number.MAX_SAFE_INTEGER) >= routeIndex
      ) {
        fail(
          "PIPELINE_ROUTING_SOURCE_CLOSURE_INVALID",
          `Stage ${route.role} has an invalid dependency on ${dependencyRole}.`,
        );
      }
      if (
        dependencyRole !== "inspect_sources" &&
        dependency.inputAssetIds.some(
          (assetId) => routeSourceIdsByRole.get(route.role)?.has(assetId) !== true,
        )
      ) {
        fail(
          "PIPELINE_ROUTING_SOURCE_CLOSURE_INVALID",
          `Stage ${route.role} does not preserve the manifest-source closure of ${dependencyRole}.`,
        );
      }
    }
  }
  return routes;
}

function outputClass(
  role: FoundryPipelineWorkerRole,
  sourceAssetIds: readonly string[],
  provenanceByAssetId: ReadonlyMap<
    string,
    FoundryIngestManifestV0["assets"][number]["provenanceClass"]
  >,
): {
  readonly derivativeClass:
    | "captured_derived"
    | "enhanced_captured_derived"
    | "ai_derived"
    | "mixed_candidate";
  readonly namespace: "captured" | "enhanced" | "ai" | "candidate";
  readonly mayEnterMeasuredGeometry: boolean;
} {
  if (
    role === "infer_hd_appearance" || role === "infer_semantics" ||
    role === "optimize_neural_scene"
  ) {
    return {
      derivativeClass: "ai_derived",
      namespace: "ai",
      mayEnterMeasuredGeometry: false,
    };
  }
  if (role === "enhance_captured_appearance") {
    return {
      derivativeClass: "enhanced_captured_derived",
      namespace: "enhanced",
      mayEnterMeasuredGeometry: false,
    };
  }
  if (
    role === "qa_candidate" || role === "package_candidate" ||
    sourceAssetIds.some((assetId) => provenanceByAssetId.get(assetId) !== "captured")
  ) {
    return {
      derivativeClass: "mixed_candidate",
      namespace: "candidate",
      mayEnterMeasuredGeometry: false,
    };
  }
  return {
    derivativeClass: "captured_derived",
    namespace: "captured",
    // Container/format normalization does not establish control, registration,
    // or physical accuracy. A normalized mesh remains in captured provenance,
    // but only later fusion and operational-mesh stages may make geometry eligible.
    mayEnterMeasuredGeometry:
      role === "fuse_measured_geometry" || role === "build_operational_mesh",
  };
}

function stageFor(
  role: FoundryPipelineWorkerRole,
  binding: FoundryPipelineWorkerBindingV0,
  dependsOn: readonly string[],
  assetIds: readonly string[],
): FoundryJobSpecV0["stages"][number] {
  return FoundryJobStageSchema.parse({
    ...roleDerivedStageFields(role),
    dependsOn,
    containerImage: binding.profile.containerImage,
    command: binding.profile.command,
    inputAssetIds: assetIds,
    cpuCores: binding.cpuCores,
    ramGiB: binding.ramGiB,
    gpuCount: binding.gpuCount,
    minimumGpuVramGiB: binding.minimumGpuVramGiB,
    scratchGiB: binding.scratchGiB,
    networkAccess: binding.profile.networkAccess,
    checkpoint: binding.checkpoint,
    resumable: binding.resumable,
  });
}

type FoundryRoleDerivedStageFields = Pick<
  FoundryJobSpecV0["stages"][number],
  "id" | "kind" | "outputNames" | "rightsPurposes"
>;

function roleDerivedStageFields(
  role: FoundryPipelineWorkerRole,
): FoundryRoleDerivedStageFields {
  const operation = OPERATION_BY_ROLE[role];
  return {
    id: role,
    kind: STAGE_KIND_BY_ROLE[role],
    outputNames: [`${role}-output`],
    rightsPurposes: [RIGHT_BY_OPERATION[operation]],
  };
}

export interface CompileFoundryReconstructionRecipeInput {
  readonly id: string;
  readonly displayName: string;
  readonly createdAt: string;
  readonly manifest: unknown;
  readonly options: unknown;
  readonly workerBindings: readonly unknown[];
}

export function compileFoundryReconstructionRecipe(
  input: CompileFoundryReconstructionRecipeInput,
): FoundryReconstructionRecipeV0 {
  const manifest = FoundryIngestManifestV0Schema.parse(input.manifest);
  const options = FoundryReconstructionRecipeOptionsV0Schema.parse(input.options);
  const createdAt = FoundryUtcInstantSchema.parse(input.createdAt);
  const routing = compileFoundryStageAssetRoutingV0(manifest, options);
  const roles = routing.map((route) => route.role);
  const bindings = input.workerBindings.map((binding) =>
    FoundryPipelineWorkerBindingV0Schema.parse(binding)
  );
  const bindingByRole = new Map<
    FoundryPipelineWorkerRole,
    FoundryPipelineWorkerBindingV0
  >();
  for (const binding of bindings) {
    if (bindingByRole.has(binding.role)) {
      fail("PIPELINE_WORKER_ROLE_DUPLICATE", `Duplicate worker role: ${binding.role}.`);
    }
    bindingByRole.set(binding.role, binding);
  }
  for (const role of roles) {
    if (!bindingByRole.has(role)) {
      fail("PIPELINE_WORKER_MISSING", `Trusted worker binding is missing for ${role}.`);
    }
  }
  if (
    bindings.some((binding) => !roles.includes(binding.role))
  ) {
    fail("PIPELINE_WORKER_UNUSED", "Recipe input contains an unused trusted worker binding.");
  }
  const stages: FoundryJobSpecV0["stages"] = routing.map((route) => {
    const binding = bindingByRole.get(route.role);
    if (binding === undefined) {
      fail("PIPELINE_WORKER_MISSING", `Missing worker ${route.role}.`);
    }
    return stageFor(route.role, binding, route.dependsOn, route.inputAssetIds);
  });
  const provenanceByAssetId = new Map(
    manifest.assets.map((asset) => [asset.id, asset.provenanceClass] as const),
  );
  const outputs = routing.map((route) => ({
    stageId: route.role,
    name: `${route.role}-output`,
    ...outputClass(route.role, route.inputAssetIds, provenanceByAssetId),
    sourceAssetIds: route.inputAssetIds,
  }));
  const workerProfileSha256s = bindings
    .map((binding) => computeFoundryTrustedWorkerProfileSha256(binding.profile))
    .sort(compareCanonicalStrings);
  const payload = FoundryReconstructionRecipePayloadV0Schema.parse({
    schemaVersion: FOUNDRY_RECONSTRUCTION_RECIPE_V0,
    id: input.id,
    displayName: input.displayName,
    projectId: manifest.projectId,
    createdAt,
    ingestManifestSha256: computeFoundryIngestManifestSha256(manifest),
    options,
    stages,
    workerProfileSha256s,
    outputs,
    authority: "none",
    capabilities: {
      planning: "recipe_compiled",
      execution: "not_authorized",
      signing: "not_authorized",
      publication: "not_authorized",
      promotion: "not_authorized",
    },
  });
  const recipe = FoundryReconstructionRecipeV0Schema.parse({
    ...payload,
    recipeSha256: computeFoundryReconstructionRecipeSha256(payload),
  });
  return verifyFoundryReconstructionRecipeRoutingV0(recipe, manifest);
}

function equalStringArrays(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Recomputes manifest-aware routing and rejects a recipe whose stage access or
 * output lineage differs, even when the altered payload has been rehashed.
 */
export function verifyFoundryReconstructionRecipeRoutingV0(
  recipeInput: unknown,
  manifestInput: unknown,
): FoundryReconstructionRecipeV0 {
  const manifest = FoundryIngestManifestV0Schema.parse(manifestInput);
  const recipe = FoundryReconstructionRecipeV0Schema.parse(recipeInput);
  if (recipe.ingestManifestSha256 !== computeFoundryIngestManifestSha256(manifest)) {
    fail(
      "PIPELINE_RECIPE_MANIFEST_MISMATCH",
      "The reconstruction recipe does not bind the supplied ingest manifest.",
    );
  }
  const expectedRouting = compileFoundryStageAssetRoutingV0(manifest, recipe.options);
  if (recipe.stages.length !== expectedRouting.length) {
    fail(
      "PIPELINE_RECIPE_STAGE_ROUTING_MISMATCH",
      "The recipe stage routing does not match the deterministic manifest route.",
    );
  }
  for (const [index, expected] of expectedRouting.entries()) {
    const actual = recipe.stages[index];
    if (
      actual === undefined || actual.id !== expected.role ||
      !equalStringArrays(actual.dependsOn, expected.dependsOn) ||
      !equalStringArrays(actual.inputAssetIds, expected.inputAssetIds)
    ) {
      fail(
        "PIPELINE_RECIPE_STAGE_ROUTING_MISMATCH",
        "The recipe stage routing does not match the deterministic manifest route.",
      );
    }
    const expectedPolicy = roleDerivedStageFields(expected.role);
    if (
      actual.kind !== expectedPolicy.kind ||
      !equalStringArrays(actual.outputNames, expectedPolicy.outputNames) ||
      !equalStringArrays(actual.rightsPurposes, expectedPolicy.rightsPurposes)
    ) {
      fail(
        "PIPELINE_RECIPE_STAGE_POLICY_MISMATCH",
        "The recipe stage policy does not match its deterministic pipeline role.",
      );
    }
  }

  if (recipe.outputs.length !== expectedRouting.length) {
    fail(
      "PIPELINE_RECIPE_OUTPUT_SET_MISMATCH",
      "The recipe output set does not match the deterministic manifest route.",
    );
  }
  const provenanceByAssetId = new Map(
    manifest.assets.map((asset) => [asset.id, asset.provenanceClass] as const),
  );
  for (const [index, expected] of expectedRouting.entries()) {
    const output = recipe.outputs[index];
    if (output === undefined || output.stageId !== expected.role) {
      fail(
        "PIPELINE_RECIPE_OUTPUT_SET_MISMATCH",
        "The recipe output set does not match the deterministic manifest route.",
      );
    }
    if (!equalStringArrays(output.sourceAssetIds, expected.inputAssetIds)) {
      fail(
        "PIPELINE_RECIPE_OUTPUT_LINEAGE_MISMATCH",
        "The recipe output lineage does not match the deterministic manifest route.",
      );
    }
    const expectedClass = outputClass(
      expected.role,
      expected.inputAssetIds,
      provenanceByAssetId,
    );
    if (
      output.name !== `${expected.role}-output` ||
      output.derivativeClass !== expectedClass.derivativeClass ||
      output.namespace !== expectedClass.namespace ||
      output.mayEnterMeasuredGeometry !== expectedClass.mayEnterMeasuredGeometry
    ) {
      fail(
        "PIPELINE_RECIPE_OUTPUT_CLASS_MISMATCH",
        "The recipe output class does not match its deterministic source route.",
      );
    }
  }
  return recipe;
}

export function toFoundryPlanOnlyRecipe(
  recipeInput: unknown,
): {
  readonly id: string;
  readonly displayName: string;
  readonly stages: FoundryJobSpecV0["stages"];
} {
  const recipe = FoundryReconstructionRecipeV0Schema.parse(recipeInput);
  return {
    id: recipe.id,
    displayName: recipe.displayName,
    stages: recipe.stages,
  };
}
