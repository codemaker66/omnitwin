import {
  FoundryUtcInstantSchema,
  RuntimeManifestKeySchema,
  RuntimeSha256Schema,
} from "@omnitwin/types";
import { z } from "zod";
import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "./canonical-json.js";
import { FoundryIntegrityError } from "./errors.js";

export const FOUNDRY_RESTORATION_PROVIDER_PROFILE_V0 =
  "omnitwin.foundry.restoration-provider-profile.v0";
export const FOUNDRY_RESTORATION_FIXED_CAMERA_V0 =
  "omnitwin.foundry.restoration-fixed-camera.v0";
export const FOUNDRY_RESTORATION_PLANNED_EXECUTION_LOCK_V0 =
  "omnitwin.foundry.restoration-planned-execution-lock.v0";
export const FOUNDRY_RESTORATION_HARDWARE_INVENTORY_V0 =
  "omnitwin.foundry.restoration-hardware-inventory.v0";
export const FOUNDRY_RESTORATION_EXECUTION_RECEIPT_V0 =
  "omnitwin.foundry.restoration-execution-receipt.v0";
export const FOUNDRY_RESTORATION_RENDER_EXECUTION_RECEIPT_V0 =
  "omnitwin.foundry.restoration-render-execution-receipt.v0";
export const FOUNDRY_RESTORATION_CANDIDATE_RENDER_RECEIPT_V0 =
  "omnitwin.foundry.restoration-candidate-render-receipt.v0";
export const FOUNDRY_RESTORATION_CREATE_ONLY_RUN_RECEIPT_V0 =
  "omnitwin.foundry.restoration-create-only-run-receipt.v0";
export const FOUNDRY_RESTORATION_IMAGE_PREPARATION_RECEIPT_V0 =
  "omnitwin.foundry.restoration-image-preparation-receipt.v0";
export const FOUNDRY_RESTORATION_EXPERIMENT_V0 =
  "omnitwin.foundry.restoration-experiment.v0";
export const FOUNDRY_RESTORATION_EVIDENCE_V0 =
  "omnitwin.foundry.restoration-evidence.v0";
export const FOUNDRY_RESTORATION_PROMOTION_V0 =
  "omnitwin.foundry.restoration-promotion.v0";
export const FOUNDRY_RESTORATION_RECONSTRUCTION_DESCRIPTOR_CLOSURE_V0 =
  "omnitwin.foundry.restoration-reconstruction-descriptor-closure.v0";
export const FOUNDRY_RESTORATION_RECONSTRUCTION_DESCRIPTOR_MEDIA_TYPE =
  "application/vnd.venviewer.grand-hall.reconstruction+json";

export const FOUNDRY_RESTORATION_OPT_IN_STATEMENT =
  "I explicitly opt in to compile this isolated internal-R&D restoration experiment. I understand that compilation does not authorize execution, distribution, publication, runtime registration, or replacement of captured source truth.";
export const FOUNDRY_RESTORATION_PROMOTION_STATEMENT =
  "I reviewed the hash-bound fixed-camera evidence and explicitly promote only the selected generated cinematic derivative. Captured source truth remains immutable and authoritative.";

export const FOUNDRY_RESTORATION_LANES = [
  "difix3d_plus",
  "artifixer3d_plus",
  "gsfix3d",
  "gr3en",
] as const;

export const FoundryRestorationLaneSchema = z.enum(FOUNDRY_RESTORATION_LANES);
export type FoundryRestorationLane = z.infer<typeof FoundryRestorationLaneSchema>;
const FoundryRestorationProviderVariantSchema = z.enum(["difix", "difix_ref"]);

const PROFILE_DIGEST_DOMAIN = "VENVIEWER_FOUNDRY_RESTORATION_PROVIDER_PROFILE_V0";
const CAMERA_DIGEST_DOMAIN = "VENVIEWER_FOUNDRY_RESTORATION_FIXED_CAMERA_V0";
const PROVIDER_LOCK_DIGEST_DOMAIN = "VENVIEWER_FOUNDRY_RESTORATION_PROVIDER_LOCK_V0";
const PLANNED_EXECUTION_LOCK_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_RESTORATION_PLANNED_EXECUTION_LOCK_V0";
const HARDWARE_INVENTORY_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_RESTORATION_HARDWARE_INVENTORY_V0";
const EXECUTION_RECEIPT_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_RESTORATION_EXECUTION_RECEIPT_V0";
const EXPERIMENT_DIGEST_DOMAIN = "VENVIEWER_FOUNDRY_RESTORATION_EXPERIMENT_V0";
const EVIDENCE_DIGEST_DOMAIN = "VENVIEWER_FOUNDRY_RESTORATION_EVIDENCE_V0";
const DERIVATION_RECEIPT_DIGEST_DOMAIN = "VENVIEWER_FOUNDRY_RESTORATION_RENDER_DERIVATION_RECEIPT_V0";
const RENDER_EXECUTION_RECEIPT_DIGEST_DOMAIN = "VENVIEWER_FOUNDRY_RESTORATION_RENDER_EXECUTION_RECEIPT_V0";
const CANDIDATE_RENDER_RECEIPT_DIGEST_DOMAIN = "VENVIEWER_FOUNDRY_RESTORATION_CANDIDATE_RENDER_RECEIPT_V0";
const CREATE_ONLY_RUN_RECEIPT_DIGEST_DOMAIN = "VENVIEWER_FOUNDRY_RESTORATION_CREATE_ONLY_RUN_RECEIPT_V0";
const MASK_ANALYSIS_RECEIPT_DIGEST_DOMAIN = "VENVIEWER_FOUNDRY_RESTORATION_MASK_ANALYSIS_RECEIPT_V0";
const IMAGE_PREPARATION_RECEIPT_DIGEST_DOMAIN = "VENVIEWER_FOUNDRY_RESTORATION_IMAGE_PREPARATION_RECEIPT_V0";
const PROTECTED_METRIC_RECEIPT_DIGEST_DOMAIN = "VENVIEWER_FOUNDRY_RESTORATION_PROTECTED_METRIC_RECEIPT_V0";
const SEMANTIC_RECEIPT_DIGEST_DOMAIN = "VENVIEWER_FOUNDRY_RESTORATION_SEMANTIC_RECEIPT_V0";
const PROMOTION_DIGEST_DOMAIN = "VENVIEWER_FOUNDRY_RESTORATION_PROMOTION_V0";
const GIT_REVISION = /^[a-f0-9]{40}$/u;
const UPSTREAM_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u;
const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u;
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u;
const LOGICAL_NAMESPACE = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/u;
const MAX_ARTIFACT_BYTES = Number.MAX_SAFE_INTEGER;

function digest(domain: string, payload: unknown): string {
  return `sha256:${domainSeparatedSha256(domain, toCanonicalJson(payload))}`;
}

function canonicalEqual(left: unknown, right: unknown): boolean {
  return stableCanonicalJson(toCanonicalJson(left)) === stableCanonicalJson(toCanonicalJson(right));
}

function isSafeRelativePath(value: string): boolean {
  if (value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/u.test(value)) return false;
  const segments = value.split("/");
  return segments.length > 0 && segments.every((segment) => SAFE_PATH_SEGMENT.test(segment));
}

function isSameOrChildNamespace(candidate: string, parent: string): boolean {
  return candidate === parent || candidate.startsWith(`${parent}/`);
}

function namespacesOverlap(left: string, right: string): boolean {
  return isSameOrChildNamespace(left, right) || isSameOrChildNamespace(right, left);
}

function uniqueSorted(values: readonly string[]): boolean {
  return new Set(values).size === values.length && values.every((value, index) => {
    const previous = index === 0 ? undefined : values[index - 1];
    return previous === undefined || previous < value;
  });
}

function ordinalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function ordinalSort(values: readonly string[]): string[] {
  return [...values].sort(ordinalCompare);
}

const SafeNamespaceSchema = z.string().min(1).max(1_024).regex(LOGICAL_NAMESPACE);
const SafeRelativePathSchema = z.string().min(1).max(2_048).refine(
  isSafeRelativePath,
  "path must be a traversal-free relative slash-delimited path",
);
const MediaTypeSchema = z.string().min(3).max(160).regex(MEDIA_TYPE);
const GitRevisionSchema = z.string().regex(GIT_REVISION);
function isNoncommercialInternalResearchPosture(value: string): boolean {
  return value === "noncommercial_internal_r_and_d_only";
}

const NoncommercialInternalResearchPostureSchema = z.string().refine(
  isNoncommercialInternalResearchPosture,
  "restoration providers are restricted to noncommercial internal R&D",
);

const FoundryRestorationLicenseDocumentV0Schema = z
  .object({
    locator: z.string().trim().min(1).max(2_048),
    revision: GitRevisionSchema,
    relativePath: SafeRelativePathSchema,
    sizeBytes: z.number().int().positive().max(MAX_ARTIFACT_BYTES),
    sha256: RuntimeSha256Schema,
  })
  .strict();

const FoundryRestorationLicenseComponentV0Schema = z.object({
  componentId: RuntimeManifestKeySchema,
  licenseName: z.string().trim().min(1).max(240),
  scope: RuntimeManifestKeySchema,
  permissionCodes: z.array(RuntimeManifestKeySchema).min(1).max(64),
  conditionCodes: z.array(RuntimeManifestKeySchema).min(1).max(64),
  clauseRefs: z.array(RuntimeManifestKeySchema).min(1).max(64),
}).strict().superRefine((component, ctx) => {
  for (const [field, values] of [["permissionCodes", component.permissionCodes], ["conditionCodes", component.conditionCodes], ["clauseRefs", component.clauseRefs]] as const) {
    if (!uniqueSorted(values)) addIssue(ctx, [field], "licence component codes and clause refs must be unique and ordinal-sorted");
  }
});

const FoundryRestorationLicenseEvidenceV0Schema = z
  .object({
    officialLicenseFacts: z.object({
      document: FoundryRestorationLicenseDocumentV0Schema,
      components: z.array(FoundryRestorationLicenseComponentV0Schema).min(1).max(16),
    }).strict(),
    projectPolicyReview: z.object({
      reviewedUsePosture: NoncommercialInternalResearchPostureSchema,
      reviewedBy: RuntimeManifestKeySchema,
      reviewedAt: FoundryUtcInstantSchema,
      commercialUseAllowed: z.literal(false),
      distributionAllowed: z.literal(false),
    }).strict(),
  })
  .strict();

const FoundryRestorationRepositoryRequirementV0Schema = z
  .object({
    role: RuntimeManifestKeySchema,
    repositoryId: z.string().regex(UPSTREAM_ID).nullable(),
    revision: GitRevisionSchema.nullable(),
    officialLicenseComponents: z.array(FoundryRestorationLicenseComponentV0Schema).min(1).max(16).nullable(),
    requiredUsePosture: NoncommercialInternalResearchPostureSchema,
    licenseDocument: FoundryRestorationLicenseDocumentV0Schema.nullable(),
  })
  .strict();

const FoundryRestorationModelRequirementV0Schema = z
  .object({
    role: RuntimeManifestKeySchema,
    modelId: z.string().regex(UPSTREAM_ID).nullable(),
    revision: GitRevisionSchema.nullable(),
    access: z.enum(["public", "gated"]),
    officialLicenseComponents: z.array(FoundryRestorationLicenseComponentV0Schema).min(1).max(16).nullable(),
    requiredUsePosture: NoncommercialInternalResearchPostureSchema,
    licenseDocument: FoundryRestorationLicenseDocumentV0Schema.nullable(),
    variants: z.array(FoundryRestorationProviderVariantSchema).min(1).max(2).nullable(),
  })
  .strict();

const FoundryRestorationTruthLayerSchema = z.enum([
  "CAPTURED_TRUTH",
  "SOURCE_DERIVED_TRUTH",
  "STRUCTURAL_TRUTH",
]);

const FoundryRestorationInputArtifactClassSchema = z.enum([
  "captured_observation",
  "source_derived_reconstruction_render",
  "source_derived_colmap_scene",
  "source_derived_reconstruction",
  "source_derived_capture_observation",
  "source_derived_camera_solution",
  "source_derived_camera_trajectory",
]);

const FoundryRestorationInputRequirementV0Schema = z
  .object({
    role: RuntimeManifestKeySchema,
    truthLayer: FoundryRestorationTruthLayerSchema,
    artifactClass: FoundryRestorationInputArtifactClassSchema,
    mediaType: MediaTypeSchema,
    requiresImageDimensions: z.boolean(),
    variants: z.array(FoundryRestorationProviderVariantSchema).min(1).max(2).nullable(),
  })
  .strict();

const FoundryRestorationCandidateArtifactClassSchema = z.enum([
  "restoration_candidate",
  "reconstruction_candidate",
  "relighting_candidate",
]);

const FoundryRestorationReadinessV0Schema = z
  .object({
    status: z.enum(["diagnostic_go", "wait"]),
    scope: z.enum([
      "single_frame_2d_internal_r_and_d",
      "scene_level_internal_r_and_d",
    ]),
    publicCapability: z.enum([
      "single_frame_image_repair",
      "scene_repair_and_distillation",
      "inference_video_only",
    ]),
    minimumGpuVramGiB: z.number().positive().max(1_000).nullable(),
    blockers: z.array(RuntimeManifestKeySchema).max(64),
  })
  .strict()
  .superRefine((readiness, ctx) => {
    if (!uniqueSorted(readiness.blockers)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["blockers"],
        message: "readiness blockers must be unique and sorted",
      });
    }
  });

const FoundryRestorationProviderProfilePayloadObjectV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_RESTORATION_PROVIDER_PROFILE_V0),
    lane: FoundryRestorationLaneSchema,
    displayName: z.string().trim().min(1).max(160),
    readiness: FoundryRestorationReadinessV0Schema,
    repositoryRequirements: z.array(FoundryRestorationRepositoryRequirementV0Schema).min(1).max(16),
    modelRequirements: z.array(FoundryRestorationModelRequirementV0Schema).min(1).max(16),
    requiredInputs: z.array(FoundryRestorationInputRequirementV0Schema).min(1).max(32),
    candidateArtifactClass: FoundryRestorationCandidateArtifactClassSchema,
    allowedCandidateMediaTypes: z.array(MediaTypeSchema).min(1).max(16),
    executionPolicy: z
      .object({
        dispatchAuthorized: z.literal(false),
        commercialUseAllowed: z.literal(false),
        publicDistributionAllowed: z.literal(false),
        sourceTruthReplacementAllowed: z.literal(false),
      })
      .strict(),
  })
  .strict();

function validateProviderProfileLists(
  profile: z.infer<typeof FoundryRestorationProviderProfilePayloadObjectV0Schema>,
  ctx: z.RefinementCtx,
): void {
  const roleLists = [
    profile.repositoryRequirements.map((requirement) => requirement.role),
    profile.modelRequirements.map((requirement) => requirement.role),
    profile.requiredInputs.map((requirement) => requirement.role),
    profile.allowedCandidateMediaTypes,
  ];
  if (roleLists.some((values) => !uniqueSorted(values))) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "provider requirement and capability lists must be unique and sorted",
    });
  }
  for (const requirement of [...profile.repositoryRequirements, ...profile.modelRequirements]) {
    const components = requirement.officialLicenseComponents;
    if (components !== null && !uniqueSorted(components.map((component) => component.componentId))) {
      addIssue(ctx, [], "official licence components must be unique and ordinal-sorted");
    }
  }
}

const FoundryRestorationProviderProfilePayloadV0Schema =
  FoundryRestorationProviderProfilePayloadObjectV0Schema.superRefine(
    validateProviderProfileLists,
  );

export const FoundryRestorationProviderProfileV0Schema =
  FoundryRestorationProviderProfilePayloadObjectV0Schema.extend({
    profileSha256: RuntimeSha256Schema,
  })
    .strict()
    .superRefine((profile, ctx) => {
      const { profileSha256: _profileSha256, ...payload } = profile;
      validateProviderProfileLists(payload, ctx);
      const parsed = FoundryRestorationProviderProfilePayloadV0Schema.safeParse(payload);
      if (parsed.success && profile.profileSha256 !== computeProviderProfileSha256(parsed.data)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["profileSha256"],
          message: "provider profile digest must match its exact payload",
        });
      }
    });
export type FoundryRestorationProviderProfileV0 = z.infer<
  typeof FoundryRestorationProviderProfileV0Schema
>;

function computeProviderProfileSha256(
  payload: z.infer<typeof FoundryRestorationProviderProfilePayloadV0Schema>,
): string {
  return digest(PROFILE_DIGEST_DOMAIN, FoundryRestorationProviderProfilePayloadV0Schema.parse(payload));
}

function createProviderProfile(
  payload: z.infer<typeof FoundryRestorationProviderProfilePayloadV0Schema>,
): FoundryRestorationProviderProfileV0 {
  const parsed = FoundryRestorationProviderProfilePayloadV0Schema.parse(payload);
  return FoundryRestorationProviderProfileV0Schema.parse({
    ...parsed,
    profileSha256: computeProviderProfileSha256(parsed),
  });
}

const EXECUTION_POLICY = {
  dispatchAuthorized: false,
  commercialUseAllowed: false,
  publicDistributionAllowed: false,
  sourceTruthReplacementAllowed: false,
} as const;

const DIFIX_LICENSE_COMPONENTS = [
  {
    componentId: "nvidia_license",
    licenseName: "NVIDIA License",
    scope: "nvidia_materials",
    permissionCodes: ["distribute", "prepare_derivative_works", "publicly_display", "publicly_perform", "reproduce", "sublicense", "use"],
    conditionCodes: ["conditional_redistribution", "noncommercial_research_and_evaluation_only"],
    clauseRefs: ["nvidia_section_2_1", "nvidia_section_3_1", "nvidia_section_3_3"],
  },
  {
    componentId: "stability_ai_community_license",
    licenseName: "Stability AI Community License Agreement",
    scope: "stability_ai_materials",
    permissionCodes: ["create_derivative_works", "distribute", "modify", "reproduce", "use"],
    conditionCodes: ["acceptable_use_policy_applies", "attribution_and_notice_required", "commercial_use_registration_required", "enterprise_license_required_above_revenue_threshold", "non_sublicensable", "nontransferable", "revocable"],
    clauseRefs: ["stability_section_ii_research_and_noncommercial_use_license", "stability_section_iii_commercial_use_license", "stability_section_iv_a_distribution_and_attribution", "stability_section_iv_b_acceptable_use_policy_and_use_restrictions", "stability_section_v_definitions"],
  },
];

const PROFILE_BY_LANE: Readonly<Record<FoundryRestorationLane, FoundryRestorationProviderProfileV0>> = {
  difix3d_plus: createProviderProfile({
    schemaVersion: FOUNDRY_RESTORATION_PROVIDER_PROFILE_V0,
    lane: "difix3d_plus",
    displayName: "Difix3D+ diagnostic image-repair lane",
    readiness: {
      status: "wait",
      scope: "single_frame_2d_internal_r_and_d",
      publicCapability: "single_frame_image_repair",
      minimumGpuVramGiB: null,
      blockers: [
        "evaluator_configuration_not_proven",
        "fixed_camera_render_closure_not_proven",
        "local_model_manifest_not_proven",
        "local_weight_file_not_proven",
        "protected_generated_masks_not_proven",
        "required_input_artifacts_not_proven",
        "runtime_environment_not_proven",
      ],
    },
    repositoryRequirements: [{
      role: "difix3d_source",
      repositoryId: "nv-tlabs/Difix3D",
      revision: "c76edc595586e16732c91ddee82f3a6d83a8a9cc",
      officialLicenseComponents: DIFIX_LICENSE_COMPONENTS,
      requiredUsePosture: "noncommercial_internal_r_and_d_only",
      licenseDocument: {
        locator: "https://github.com/nv-tlabs/Difix3D/blob/c76edc595586e16732c91ddee82f3a6d83a8a9cc/LICENSE.txt",
        revision: "c76edc595586e16732c91ddee82f3a6d83a8a9cc",
        relativePath: "LICENSE.txt",
        sizeBytes: 15_842,
        sha256: "sha256:b6207945851e878c5ce4aec6352f61f4741f724674d090b070cf0d468de54fa8",
      },
    }],
    modelRequirements: [
      {
        role: "difix_checkpoint",
        modelId: "nvidia/difix",
        revision: "2b0c6fb5797c26b01154dfdeb19d36e5e2eaf388",
        access: "public",
        officialLicenseComponents: DIFIX_LICENSE_COMPONENTS,
        requiredUsePosture: "noncommercial_internal_r_and_d_only",
        licenseDocument: {
          locator: "https://huggingface.co/nvidia/difix/blob/2b0c6fb5797c26b01154dfdeb19d36e5e2eaf388/LICENSE.txt",
          revision: "2b0c6fb5797c26b01154dfdeb19d36e5e2eaf388",
          relativePath: "LICENSE.txt",
          sizeBytes: 15_848,
          sha256: "sha256:e2f578631a7d4b5aff03be4489b5defbd6536c8878024720c8261a3b0eea6c1a",
        },
        variants: ["difix"],
      },
      {
        role: "difix_ref_checkpoint",
        modelId: "nvidia/difix_ref",
        revision: "d4830559772a5795c9d136302c5b197d6418d3fb",
        access: "public",
        officialLicenseComponents: DIFIX_LICENSE_COMPONENTS,
        requiredUsePosture: "noncommercial_internal_r_and_d_only",
        licenseDocument: {
          locator: "https://huggingface.co/nvidia/difix_ref/blob/d4830559772a5795c9d136302c5b197d6418d3fb/LICENSE.txt",
          revision: "d4830559772a5795c9d136302c5b197d6418d3fb",
          relativePath: "LICENSE.txt",
          sizeBytes: 15_848,
          sha256: "sha256:e2f578631a7d4b5aff03be4489b5defbd6536c8878024720c8261a3b0eea6c1a",
        },
        variants: ["difix_ref"],
      },
    ],
    requiredInputs: [
      { role: "captured_reference_image", truthLayer: "CAPTURED_TRUTH", artifactClass: "captured_observation", mediaType: "image/png", requiresImageDimensions: true, variants: ["difix_ref"] },
      { role: "source_fixed_camera_render", truthLayer: "SOURCE_DERIVED_TRUTH", artifactClass: "source_derived_reconstruction_render", mediaType: "image/png", requiresImageDimensions: true, variants: ["difix", "difix_ref"] },
      { role: "source_reconstruction", truthLayer: "SOURCE_DERIVED_TRUTH", artifactClass: "source_derived_reconstruction", mediaType: FOUNDRY_RESTORATION_RECONSTRUCTION_DESCRIPTOR_MEDIA_TYPE, requiresImageDimensions: false, variants: ["difix", "difix_ref"] },
    ],
    candidateArtifactClass: "restoration_candidate",
    allowedCandidateMediaTypes: ["image/png"],
    executionPolicy: EXECUTION_POLICY,
  }),
  artifixer3d_plus: createProviderProfile({
    schemaVersion: FOUNDRY_RESTORATION_PROVIDER_PROFILE_V0,
    lane: "artifixer3d_plus",
    displayName: "ArtiFixer3D+ scene-repair experiment lane",
    readiness: {
      status: "wait",
      scope: "scene_level_internal_r_and_d",
      publicCapability: "scene_repair_and_distillation",
      minimumGpuVramGiB: 80,
      blockers: [
        "colmap_scene_not_proven",
        "exact_license_document_not_proven",
        "model_revision_and_digest_not_proven",
        "three_d_grut_environment_not_proven",
      ],
    },
    repositoryRequirements: [{
      role: "artifixer_source",
      repositoryId: "nv-tlabs/ArtiFixer",
      revision: null,
      officialLicenseComponents: null,
      requiredUsePosture: "noncommercial_internal_r_and_d_only",
      licenseDocument: null,
    }],
    modelRequirements: [{
      role: "artifixer_checkpoint",
      modelId: "nvidia/ArtiFixer",
      revision: null,
      access: "gated",
      officialLicenseComponents: null,
      requiredUsePosture: "noncommercial_internal_r_and_d_only",
      licenseDocument: null,
      variants: null,
    }],
    requiredInputs: [
      { role: "colmap_scene", truthLayer: "STRUCTURAL_TRUTH", artifactClass: "source_derived_colmap_scene", mediaType: "application/zip", requiresImageDimensions: false, variants: null },
      { role: "source_reconstruction", truthLayer: "SOURCE_DERIVED_TRUTH", artifactClass: "source_derived_reconstruction", mediaType: "application/octet-stream", requiresImageDimensions: false, variants: null },
      { role: "source_training_images", truthLayer: "SOURCE_DERIVED_TRUTH", artifactClass: "source_derived_capture_observation", mediaType: "application/zip", requiresImageDimensions: false, variants: null },
    ],
    candidateArtifactClass: "reconstruction_candidate",
    allowedCandidateMediaTypes: ["application/octet-stream"],
    executionPolicy: EXECUTION_POLICY,
  }),
  gsfix3d: createProviderProfile({
    schemaVersion: FOUNDRY_RESTORATION_PROVIDER_PROFILE_V0,
    lane: "gsfix3d",
    displayName: "GSFix3D/GSFixer scene-repair experiment lane",
    readiness: {
      status: "wait",
      scope: "scene_level_internal_r_and_d",
      publicCapability: "scene_repair_and_distillation",
      minimumGpuVramGiB: null,
      blockers: [
        "exact_license_document_not_proven",
        "noncommercial_dependency",
        "official_repository_identity_not_proven",
        "standard_3dgs_checkpoint_not_proven",
        "training_cameras_not_proven",
      ],
    },
    repositoryRequirements: [{
      role: "gsfix_source",
      repositoryId: null,
      revision: null,
      officialLicenseComponents: null,
      requiredUsePosture: "noncommercial_internal_r_and_d_only",
      licenseDocument: null,
    }],
    modelRequirements: [{
      role: "gsfixer_full_checkpoint",
      modelId: "goldoak1421/gsfixer-full",
      revision: null,
      access: "public",
      officialLicenseComponents: null,
      requiredUsePosture: "noncommercial_internal_r_and_d_only",
      licenseDocument: null,
      variants: null,
    }],
    requiredInputs: [
      { role: "standard_3dgs_checkpoint", truthLayer: "SOURCE_DERIVED_TRUTH", artifactClass: "source_derived_reconstruction", mediaType: "application/octet-stream", requiresImageDimensions: false, variants: null },
      { role: "training_camera_set", truthLayer: "STRUCTURAL_TRUTH", artifactClass: "source_derived_camera_solution", mediaType: "application/json", requiresImageDimensions: false, variants: null },
      { role: "training_images", truthLayer: "SOURCE_DERIVED_TRUTH", artifactClass: "source_derived_capture_observation", mediaType: "application/zip", requiresImageDimensions: false, variants: null },
    ],
    candidateArtifactClass: "reconstruction_candidate",
    allowedCandidateMediaTypes: ["application/octet-stream"],
    executionPolicy: EXECUTION_POLICY,
  }),
  gr3en: createProviderProfile({
    schemaVersion: FOUNDRY_RESTORATION_PROVIDER_PROFILE_V0,
    lane: "gr3en",
    displayName: "GR3EN relighting inference-video experiment lane",
    readiness: {
      status: "wait",
      scope: "scene_level_internal_r_and_d",
      publicCapability: "inference_video_only",
      minimumGpuVramGiB: 48,
      blockers: [
        "exact_license_document_not_proven",
        "gated_hugging_face_token_not_proven",
        "model_revision_and_digest_not_proven",
        "public_3d_distillation_unreleased",
      ],
    },
    repositoryRequirements: [{
      role: "gr3en_source",
      repositoryId: "nv-tlabs/GR3EN",
      revision: null,
      officialLicenseComponents: null,
      requiredUsePosture: "noncommercial_internal_r_and_d_only",
      licenseDocument: null,
    }],
    modelRequirements: [{
      role: "gr3en_checkpoint",
      modelId: "nvidia/GR3EN",
      revision: null,
      access: "gated",
      officialLicenseComponents: null,
      requiredUsePosture: "noncommercial_internal_r_and_d_only",
      licenseDocument: null,
      variants: null,
    }],
    requiredInputs: [
      { role: "source_camera_trajectory", truthLayer: "STRUCTURAL_TRUTH", artifactClass: "source_derived_camera_trajectory", mediaType: "application/json", requiresImageDimensions: false, variants: null },
      { role: "source_reconstruction", truthLayer: "SOURCE_DERIVED_TRUTH", artifactClass: "source_derived_reconstruction", mediaType: "application/octet-stream", requiresImageDimensions: false, variants: null },
    ],
    candidateArtifactClass: "relighting_candidate",
    allowedCandidateMediaTypes: ["video/mp4"],
    executionPolicy: EXECUTION_POLICY,
  }),
};

export function getFoundryRestorationProviderProfileV0(
  lane: FoundryRestorationLane,
): FoundryRestorationProviderProfileV0 {
  return FoundryRestorationProviderProfileV0Schema.parse(
    PROFILE_BY_LANE[FoundryRestorationLaneSchema.parse(lane)],
  );
}

const FoundryRestorationWeightFileV0Schema = z
  .object({
    relativePath: SafeRelativePathSchema,
    sizeBytes: z.number().int().positive().max(MAX_ARTIFACT_BYTES),
    sha256: RuntimeSha256Schema,
  })
  .strict();

const FoundryRestorationRepositoryLockV0Schema = z
  .object({
    role: RuntimeManifestKeySchema,
    repositoryId: z.string().regex(UPSTREAM_ID),
    revision: GitRevisionSchema,
    sourceArchiveSha256: RuntimeSha256Schema,
    licenseEvidence: FoundryRestorationLicenseEvidenceV0Schema,
  })
  .strict();

const FoundryRestorationModelLockV0Schema = z
  .object({
    role: RuntimeManifestKeySchema,
    modelId: z.string().regex(UPSTREAM_ID),
    revision: GitRevisionSchema,
    repositoryManifestSha256: RuntimeSha256Schema,
    access: z.enum(["public", "gated"]),
    licenseEvidence: FoundryRestorationLicenseEvidenceV0Schema,
    weights: z.array(FoundryRestorationWeightFileV0Schema).min(1).max(10_000),
  })
  .strict();

export const FoundryRestorationProviderLockPayloadV0Schema = z
  .object({
    lane: FoundryRestorationLaneSchema,
    reviewedBy: RuntimeManifestKeySchema,
    reviewedAt: FoundryUtcInstantSchema,
    exactOfficialIdentityReviewed: z.boolean(),
    repositories: z.array(FoundryRestorationRepositoryLockV0Schema).min(1).max(16),
    models: z.array(FoundryRestorationModelLockV0Schema).min(1).max(16),
  })
  .strict();
export type FoundryRestorationProviderLockPayloadV0 = z.infer<
  typeof FoundryRestorationProviderLockPayloadV0Schema
>;

const FoundryRestorationProviderLockV0Schema =
  FoundryRestorationProviderLockPayloadV0Schema.extend({
    providerLockSha256: RuntimeSha256Schema,
  })
    .strict()
    .superRefine((lock, ctx) => {
      const { providerLockSha256: _providerLockSha256, ...payload } = lock;
      const expected = digest(
        PROVIDER_LOCK_DIGEST_DOMAIN,
        FoundryRestorationProviderLockPayloadV0Schema.parse(payload),
      );
      if (lock.providerLockSha256 !== expected) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["providerLockSha256"],
          message: "provider lock digest must match its exact payload",
        });
      }
    });

const PreparationArtifactRecordV0Schema = z.object({
  artifactId: RuntimeManifestKeySchema,
  namespace: SafeNamespaceSchema,
  relativePath: SafeRelativePathSchema,
  mediaType: MediaTypeSchema,
  width: z.number().int().positive().max(65_536).nullable(),
  height: z.number().int().positive().max(65_536).nullable(),
  sizeBytes: z.number().int().positive().max(MAX_ARTIFACT_BYTES),
  sha256: RuntimeSha256Schema,
  canonicalization: z.enum(["byte_exact", "rfc8785_json"]),
  immutable: z.literal(true), accessMode: z.literal("read_only"), authority: z.literal("none"),
}).strict();

const ImagePreparationReceiptPayloadV0Schema = z.object({
  schemaVersion: z.literal(FOUNDRY_RESTORATION_IMAGE_PREPARATION_RECEIPT_V0),
  rawParentManifestArtifact: PreparationArtifactRecordV0Schema,
  preparedOutputArtifact: PreparationArtifactRecordV0Schema,
  toolImplementationArtifact: PreparationArtifactRecordV0Schema,
  toolConfigurationArtifact: PreparationArtifactRecordV0Schema,
  toolRuntimeArtifact: PreparationArtifactRecordV0Schema,
  toolProcessReceiptArtifact: PreparationArtifactRecordV0Schema,
  startedAt: FoundryUtcInstantSchema,
  completedAt: FoundryUtcInstantSchema,
  authority: z.literal("none"),
}).strict();

export const FoundryRestorationImagePreparationReceiptV0Schema = ImagePreparationReceiptPayloadV0Schema.extend({
  imagePreparationReceiptSha256: RuntimeSha256Schema,
}).strict().superRefine((receipt, ctx) => {
  const { imagePreparationReceiptSha256: _digest, ...payload } = receipt;
  if (Date.parse(receipt.startedAt) >= Date.parse(receipt.completedAt)) addIssue(ctx, ["completedAt"], "image preparation must complete after it starts");
  if (receipt.imagePreparationReceiptSha256 !== digest(IMAGE_PREPARATION_RECEIPT_DIGEST_DOMAIN, payload)) {
    addIssue(ctx, ["imagePreparationReceiptSha256"], "image preparation receipt digest must match its exact payload");
  }
});
export type FoundryRestorationImagePreparationReceiptV0 = z.infer<typeof FoundryRestorationImagePreparationReceiptV0Schema>;

export function createFoundryRestorationImagePreparationReceiptV0(
  input: Omit<z.infer<typeof ImagePreparationReceiptPayloadV0Schema>, "schemaVersion" | "authority">,
): FoundryRestorationImagePreparationReceiptV0 {
  const payload = ImagePreparationReceiptPayloadV0Schema.parse({
    schemaVersion: FOUNDRY_RESTORATION_IMAGE_PREPARATION_RECEIPT_V0, ...input, authority: "none",
  });
  return FoundryRestorationImagePreparationReceiptV0Schema.parse({
    ...payload, imagePreparationReceiptSha256: digest(IMAGE_PREPARATION_RECEIPT_DIGEST_DOMAIN, payload),
  });
}

const FoundryRestorationReconstructionDescriptorMemberV0Schema = z
  .object({
    relativePath: SafeRelativePathSchema,
    sizeBytes: z.number().int().positive().max(MAX_ARTIFACT_BYTES),
    sha256: RuntimeSha256Schema,
  })
  .strict();

export const FoundryRestorationReconstructionDescriptorClosureV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_RESTORATION_RECONSTRUCTION_DESCRIPTOR_CLOSURE_V0),
    descriptorSchemaVersion: RuntimeManifestKeySchema,
    descriptorSizeBytes: z.number().int().positive().max(MAX_ARTIFACT_BYTES),
    descriptorSha256: RuntimeSha256Schema,
    format: RuntimeManifestKeySchema,
    representationId: RuntimeManifestKeySchema,
    sourceVariant: z.string().min(1).max(160).regex(/^[A-Za-z0-9._-]+$/u),
    decodedElementCount: z.number().int().positive().max(MAX_ARTIFACT_BYTES),
    memberCount: z.number().int().positive().max(100_000),
    totalMemberBytes: z.number().int().positive().max(MAX_ARTIFACT_BYTES),
    members: z
      .array(FoundryRestorationReconstructionDescriptorMemberV0Schema)
      .min(1)
      .max(100_000),
  })
  .strict()
  .superRefine((closure, ctx) => {
    const paths = closure.members.map((member) => member.relativePath);
    if (!uniqueSorted(paths)) {
      addIssue(ctx, ["members"], "reconstruction descriptor members must be unique and ordinal-sorted");
    }
    if (closure.memberCount !== closure.members.length) {
      addIssue(ctx, ["memberCount"], "reconstruction descriptor member count must match its exact member closure");
    }
    if (
      closure.totalMemberBytes !==
      closure.members.reduce((total, member) => total + member.sizeBytes, 0)
    ) {
      addIssue(ctx, ["totalMemberBytes"], "reconstruction descriptor byte total must match its exact member closure");
    }
  });
export type FoundryRestorationReconstructionDescriptorClosureV0 = z.infer<
  typeof FoundryRestorationReconstructionDescriptorClosureV0Schema
>;

export const FoundryRestorationInputCandidateV0Schema = z
  .object({
    role: RuntimeManifestKeySchema,
    artifactId: RuntimeManifestKeySchema,
    namespace: SafeNamespaceSchema,
    relativePath: SafeRelativePathSchema,
    mediaType: MediaTypeSchema,
    width: z.number().int().positive().max(65_536).nullable(),
    height: z.number().int().positive().max(65_536).nullable(),
    sizeBytes: z.number().int().positive().max(MAX_ARTIFACT_BYTES),
    sha256: RuntimeSha256Schema,
    canonicalization: z.enum(["byte_exact", "rfc8785_json"]),
    immutable: z.boolean(),
    accessMode: z.literal("read_only"),
    truthLayer: FoundryRestorationTruthLayerSchema,
    artifactClass: FoundryRestorationInputArtifactClassSchema,
    preparationLineage: FoundryRestorationImagePreparationReceiptV0Schema.nullable(),
    reconstructionDescriptorClosure:
      FoundryRestorationReconstructionDescriptorClosureV0Schema.nullable().optional(),
    authority: z.literal("none"),
  })
  .strict();

const FoundryRestorationImmutableInputV0Schema =
  FoundryRestorationInputCandidateV0Schema.extend({
    immutable: z.literal(true),
  }).strict();

const DigestAddressedArtifactObjectV0Schema = z
  .object({
    artifactId: RuntimeManifestKeySchema,
    relativePath: SafeRelativePathSchema,
    mediaType: MediaTypeSchema,
    sizeBytes: z.number().int().positive().max(MAX_ARTIFACT_BYTES),
    sha256: RuntimeSha256Schema,
    canonicalization: z.enum(["byte_exact", "rfc8785_json"]),
    immutable: z.literal(true),
    accessMode: z.literal("read_only"),
    authority: z.literal("none"),
  })
  .strict();

const DigestAddressedArtifactV0Schema = DigestAddressedArtifactObjectV0Schema.superRefine(
  (artifact, ctx) => {
    const expected = artifact.mediaType === "application/json" || artifact.mediaType.endsWith("+json")
      ? "rfc8785_json"
      : "byte_exact";
    if (artifact.canonicalization !== expected) {
      addIssue(ctx, ["canonicalization"], `canonicalization must be ${expected} for ${artifact.mediaType}`);
    }
  },
);

const DigestAddressedJsonArtifactV0Schema = DigestAddressedArtifactObjectV0Schema.extend({
  mediaType: z.literal("application/json"),
  canonicalization: z.literal("rfc8785_json"),
}).strict();

const DigestAddressedImageArtifactV0Schema = DigestAddressedArtifactObjectV0Schema.extend({
  mediaType: z.literal("image/png"),
  canonicalization: z.literal("byte_exact"),
  width: z.number().int().positive().max(65_536),
  height: z.number().int().positive().max(65_536),
}).strict();

const EvaluatorArtifactBindingV0Schema = z
  .object({
    implementationArtifact: DigestAddressedArtifactV0Schema,
    configurationArtifact: DigestAddressedJsonArtifactV0Schema,
    runtimeEnvironmentArtifact: DigestAddressedJsonArtifactV0Schema,
  })
  .strict();

const RenderDerivationReceiptPayloadV0Schema = z.object({
  schemaVersion: z.literal("foundry.restoration.render-derivation-receipt.v0"),
  sourceReconstructionArtifact: DigestAddressedArtifactV0Schema,
  cameraId: RuntimeManifestKeySchema,
  cameraSha256: RuntimeSha256Schema,
  rendererProfileArtifact: DigestAddressedJsonArtifactV0Schema,
  rendererImplementationArtifact: DigestAddressedArtifactV0Schema,
  rendererRuntimeArtifact: DigestAddressedJsonArtifactV0Schema,
  sourceRenderArtifact: DigestAddressedImageArtifactV0Schema,
  authority: z.literal("none"),
}).strict();

export const FoundryRestorationRenderPlanClosureV0Schema = RenderDerivationReceiptPayloadV0Schema.extend({
  derivationReceiptSha256: RuntimeSha256Schema,
}).strict().superRefine((receipt, ctx) => {
  const { derivationReceiptSha256: _digest, ...payload } = receipt;
  if (receipt.derivationReceiptSha256 !== digest(DERIVATION_RECEIPT_DIGEST_DOMAIN, payload)) {
    addIssue(ctx, ["derivationReceiptSha256"], "render derivation receipt digest must match its exact payload");
  }
});
export type FoundryRestorationRenderPlanClosureV0 = z.infer<typeof FoundryRestorationRenderPlanClosureV0Schema>;

export function createFoundryRestorationRenderDerivationReceiptV0(
  input: Omit<z.infer<typeof RenderDerivationReceiptPayloadV0Schema>, "schemaVersion" | "authority">,
): z.infer<typeof FoundryRestorationRenderPlanClosureV0Schema> {
  const payload = RenderDerivationReceiptPayloadV0Schema.parse({
    schemaVersion: "foundry.restoration.render-derivation-receipt.v0",
    ...input,
    authority: "none",
  });
  return FoundryRestorationRenderPlanClosureV0Schema.parse({
    ...payload,
    derivationReceiptSha256: digest(DERIVATION_RECEIPT_DIGEST_DOMAIN, payload),
  });
}

const MaskAnalysisPayloadV0Schema = z.object({
  maskArtifact: DigestAddressedImageArtifactV0Schema,
  analyzerImplementationArtifact: DigestAddressedArtifactV0Schema,
  analyzerConfigurationArtifact: DigestAddressedJsonArtifactV0Schema,
  analyzerRuntimeArtifact: DigestAddressedJsonArtifactV0Schema,
  analyzerProcessReceiptArtifact: DigestAddressedJsonArtifactV0Schema,
  startedAt: FoundryUtcInstantSchema,
  completedAt: FoundryUtcInstantSchema,
  decodedWidth: z.number().int().positive().max(65_536),
  decodedHeight: z.number().int().positive().max(65_536),
  pixelCount: z.number().int().positive().max(MAX_ARTIFACT_BYTES),
  zeroPixelCount: z.number().int().nonnegative().max(MAX_ARTIFACT_BYTES),
  onePixelCount: z.number().int().nonnegative().max(MAX_ARTIFACT_BYTES),
  nonzeroPixelCount: z.number().int().nonnegative().max(MAX_ARTIFACT_BYTES),
  coverageFraction: z.number().min(0).max(1),
  state: z.enum(["all_zero", "all_one", "partial"]),
}).strict();

export const FoundryRestorationMaskAnalysisReceiptV0Schema = MaskAnalysisPayloadV0Schema.extend({
  maskAnalysisReceiptSha256: RuntimeSha256Schema,
}).strict().superRefine((analysis, ctx) => {
  const { maskAnalysisReceiptSha256: _digest, ...payload } = analysis;
  const count = analysis.decodedWidth * analysis.decodedHeight;
  if (Date.parse(analysis.startedAt) >= Date.parse(analysis.completedAt)) addIssue(ctx, ["completedAt"], "mask analysis must complete after it starts");
  if (analysis.pixelCount !== count || analysis.zeroPixelCount + analysis.nonzeroPixelCount !== count ||
    analysis.onePixelCount > analysis.nonzeroPixelCount ||
    Math.abs(analysis.coverageFraction - analysis.nonzeroPixelCount / count) > Number.EPSILON) {
    addIssue(ctx, [], "mask analysis counts and coverage must be mathematically consistent");
  }
  if ((analysis.state === "all_zero" && (analysis.zeroPixelCount !== count || analysis.nonzeroPixelCount !== 0)) ||
      (analysis.state === "all_one" && (analysis.onePixelCount !== count || analysis.zeroPixelCount !== 0)) ||
      (analysis.state === "partial" && (analysis.zeroPixelCount === 0 || analysis.nonzeroPixelCount === 0))) {
    addIssue(ctx, ["state"], "mask state must agree with decoded pixel counts");
  }
  if (analysis.maskAnalysisReceiptSha256 !== digest(MASK_ANALYSIS_RECEIPT_DIGEST_DOMAIN, payload)) {
    addIssue(ctx, ["maskAnalysisReceiptSha256"], "mask analysis receipt digest must match its exact payload");
  }
});
export type FoundryRestorationMaskAnalysisReceiptV0 = z.infer<typeof FoundryRestorationMaskAnalysisReceiptV0Schema>;

export function createFoundryRestorationMaskAnalysisReceiptV0(
  input: z.infer<typeof MaskAnalysisPayloadV0Schema>,
): z.infer<typeof FoundryRestorationMaskAnalysisReceiptV0Schema> {
  const payload = MaskAnalysisPayloadV0Schema.parse(input);
  return FoundryRestorationMaskAnalysisReceiptV0Schema.parse({ ...payload, maskAnalysisReceiptSha256: digest(MASK_ANALYSIS_RECEIPT_DIGEST_DOMAIN, payload) });
}

const MaskArtifactV0Schema = z.object({
  artifact: DigestAddressedImageArtifactV0Schema,
  maskRole: z.enum(["protected_region", "generated_region"]),
  analysis: FoundryRestorationMaskAnalysisReceiptV0Schema,
}).strict();

const FixedCameraExecutionClosureV0Schema = z
  .object({
    cameraId: RuntimeManifestKeySchema,
    cameraSha256: RuntimeSha256Schema,
    renderDerivationReceipt: FoundryRestorationRenderPlanClosureV0Schema,
    protectedRegionMask: MaskArtifactV0Schema,
    generatedRegionMask: MaskArtifactV0Schema,
    protectedRegionEvaluator: EvaluatorArtifactBindingV0Schema,
    forbiddenSemanticEvaluator: EvaluatorArtifactBindingV0Schema,
  })
  .strict();

const FoundryRestorationPlannedExecutionInputV0Schema = z
  .object({
    providerAdapterId: RuntimeManifestKeySchema,
    providerAdapterImplementationArtifact: DigestAddressedArtifactV0Schema,
    parameterConfigurationArtifact: DigestAddressedJsonArtifactV0Schema,
    runtimeEnvironmentArtifact: DigestAddressedJsonArtifactV0Schema,
    fixedCameraClosures: z.array(FixedCameraExecutionClosureV0Schema).min(1).max(10_000),
  })
  .strict();

const PlannedExecutionLockPayloadV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_RESTORATION_PLANNED_EXECUTION_LOCK_V0),
    lane: FoundryRestorationLaneSchema,
    providerVariant: FoundryRestorationProviderVariantSchema.nullable(),
    providerProfileSha256: RuntimeSha256Schema,
    providerLockSha256: RuntimeSha256Schema,
    providerAdapterId: RuntimeManifestKeySchema,
    providerAdapterImplementationArtifact: DigestAddressedArtifactV0Schema,
    parameterConfigurationArtifact: DigestAddressedJsonArtifactV0Schema,
    runtimeEnvironmentArtifact: DigestAddressedJsonArtifactV0Schema,
    fixedCameraClosures: z.array(FixedCameraExecutionClosureV0Schema).min(1).max(10_000),
    authority: z.literal("none"),
    capabilities: z
      .object({
        execution: z.literal("not_authorized"),
        dispatchEnabled: z.literal(false),
        sourceTruthReplacement: z.literal("prohibited"),
      })
      .strict(),
  })
  .strict();

export const FoundryRestorationPlannedExecutionLockV0Schema =
  PlannedExecutionLockPayloadV0Schema.extend({
    plannedExecutionLockSha256: RuntimeSha256Schema,
  })
    .strict()
    .superRefine((lock, ctx) => {
      const { plannedExecutionLockSha256: _plannedExecutionLockSha256, ...payload } = lock;
      const expected = digest(
        PLANNED_EXECUTION_LOCK_DIGEST_DOMAIN,
        PlannedExecutionLockPayloadV0Schema.parse(payload),
      );
      if (lock.plannedExecutionLockSha256 !== expected) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["plannedExecutionLockSha256"],
          message: "planned execution lock digest must match its exact payload",
        });
      }
    });
export type FoundryRestorationPlannedExecutionLockV0 = z.infer<
  typeof FoundryRestorationPlannedExecutionLockV0Schema
>;

const FixedCameraPayloadV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_RESTORATION_FIXED_CAMERA_V0),
    cameraId: RuntimeManifestKeySchema,
    coordinateFrameId: RuntimeManifestKeySchema,
    viewMatrixColumnMajor: z.array(z.number().finite()).length(16),
    projectionMatrixColumnMajor: z.array(z.number().finite()).length(16),
    width: z.number().int().positive().max(65_536),
    height: z.number().int().positive().max(65_536),
    rendererProfileSha256: RuntimeSha256Schema,
    colorSpace: z.literal("srgb"),
  })
  .strict();

export const FoundryRestorationFixedCameraV0Schema = FixedCameraPayloadV0Schema.extend({
  cameraSha256: RuntimeSha256Schema,
})
  .strict()
  .superRefine((camera, ctx) => {
    const { cameraSha256: _cameraSha256, ...payload } = camera;
    if (camera.cameraSha256 !== digest(CAMERA_DIGEST_DOMAIN, FixedCameraPayloadV0Schema.parse(payload))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cameraSha256"],
        message: "fixed camera digest must match its exact payload",
      });
    }
  });
export type FoundryRestorationFixedCameraV0 = z.infer<
  typeof FoundryRestorationFixedCameraV0Schema
>;

export function createFoundryRestorationFixedCameraV0(
  input: Omit<z.infer<typeof FixedCameraPayloadV0Schema>, "schemaVersion">,
): FoundryRestorationFixedCameraV0 {
  const payload = FixedCameraPayloadV0Schema.parse({
    schemaVersion: FOUNDRY_RESTORATION_FIXED_CAMERA_V0,
    ...input,
  });
  return FoundryRestorationFixedCameraV0Schema.parse({
    ...payload,
    cameraSha256: digest(CAMERA_DIGEST_DOMAIN, payload),
  });
}

const OperatorOptInV0Schema = z
  .object({
    actorId: RuntimeManifestKeySchema,
    acceptedAt: FoundryUtcInstantSchema,
    statement: z.literal(FOUNDRY_RESTORATION_OPT_IN_STATEMENT),
  })
  .strict();

const RestorationOutputPolicyV0Schema = z
  .object({
    namespace: SafeNamespaceSchema,
    createOnlyRequired: z.literal(true),
    createOnlyEnforcedByThisContract: z.literal(false),
    runnerEnforcementRequired: z.literal(true),
    overwriteAllowed: z.literal(false),
    sourceMutationAllowed: z.literal(false),
    sourceTruthReplacementAllowed: z.literal(false),
    automaticPromotionAllowed: z.literal(false),
    runtimeRegistrationAllowed: z.literal(false),
  })
  .strict();

const FidelityPolicyV0Schema = z
  .object({
    minimumProtectedRegionSsim: z.literal(0.98),
    maximumProtectedRegionLpips: z.literal(0.05),
    maximumProtectedRegionMeanAbsoluteError: z.literal(0.01),
    maximumProtectedEdgeDisplacementPixels: z.literal(1.5),
    maximumForbiddenSemanticDetections: z.literal(0),
  })
  .strict();

const FIDELITY_POLICY = {
  minimumProtectedRegionSsim: 0.98,
  maximumProtectedRegionLpips: 0.05,
  maximumProtectedRegionMeanAbsoluteError: 0.01,
  maximumProtectedEdgeDisplacementPixels: 1.5,
  maximumForbiddenSemanticDetections: 0,
} as const;

const ExperimentPayloadV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_RESTORATION_EXPERIMENT_V0),
    experimentId: RuntimeManifestKeySchema,
    projectId: RuntimeManifestKeySchema,
    createdAt: FoundryUtcInstantSchema,
    lane: FoundryRestorationLaneSchema,
    providerVariant: FoundryRestorationProviderVariantSchema.nullable(),
    providerProfile: FoundryRestorationProviderProfileV0Schema,
    providerLock: FoundryRestorationProviderLockV0Schema,
    plannedExecutionLock: FoundryRestorationPlannedExecutionLockV0Schema,
    operatorOptIn: OperatorOptInV0Schema,
    inputs: z.array(FoundryRestorationImmutableInputV0Schema).min(1).max(100_000),
    fixedCameras: z.array(FoundryRestorationFixedCameraV0Schema).min(1).max(10_000),
    outputPolicy: RestorationOutputPolicyV0Schema,
    fidelityPolicy: FidelityPolicyV0Schema,
    authority: z.literal("none"),
    capabilities: z
      .object({
        planning: z.literal("compiled"),
        execution: z.literal("not_authorized"),
        dispatchEnabled: z.literal(false),
        promotion: z.literal("not_recorded"),
        sourceTruthReplacement: z.literal("prohibited"),
      })
      .strict(),
  })
  .strict();

function addIssue(ctx: z.RefinementCtx, path: (string | number)[], message: string): void {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
}

function exactRoleSet(actual: readonly string[], required: readonly string[]): boolean {
  return canonicalEqual(ordinalSort(actual), ordinalSort(required));
}

function requirementAppliesToVariant(
  variants: readonly ("difix" | "difix_ref")[] | null,
  providerVariant: "difix" | "difix_ref" | null,
): boolean {
  return variants === null ? providerVariant === null : providerVariant !== null && variants.includes(providerVariant);
}

function validateProviderLock(
  lock: z.infer<typeof FoundryRestorationProviderLockV0Schema>,
  profile: FoundryRestorationProviderProfileV0,
  providerVariant: "difix" | "difix_ref" | null,
  ctx: z.RefinementCtx,
): void {
  const modelRequirements = profile.modelRequirements.filter((requirement) =>
    requirementAppliesToVariant(requirement.variants, providerVariant),
  );
  const hasUnpinnedFacts = profile.repositoryRequirements.some((requirement) =>
    requirement.repositoryId === null || requirement.revision === null || requirement.officialLicenseComponents === null || requirement.licenseDocument === null,
  ) || modelRequirements.some((requirement) =>
    requirement.modelId === null || requirement.revision === null || requirement.officialLicenseComponents === null || requirement.licenseDocument === null,
  );
  if (lock.exactOfficialIdentityReviewed === hasUnpinnedFacts) {
    addIssue(
      ctx,
      ["providerLock", "exactOfficialIdentityReviewed"],
      hasUnpinnedFacts
        ? "unpinned provider facts must remain explicitly blocked and not exactly reviewed"
        : "fully pinned provider facts require an exact identity review",
    );
  }
  if (lock.lane !== profile.lane) addIssue(ctx, ["providerLock", "lane"], "provider lock lane must match profile");
  if (!exactRoleSet(lock.repositories.map((item) => item.role), profile.repositoryRequirements.map((item) => item.role))) {
    addIssue(ctx, ["providerLock", "repositories"], "repository locks must exactly cover required roles");
  }
  if (!exactRoleSet(lock.models.map((item) => item.role), modelRequirements.map((item) => item.role))) {
    addIssue(ctx, ["providerLock", "models"], "model locks must exactly cover required roles");
  }
  if (!uniqueSorted(lock.repositories.map((item) => item.role))) {
    addIssue(ctx, ["providerLock", "repositories"], "repository locks must be unique and sorted by role");
  }
  if (!uniqueSorted(lock.models.map((item) => item.role))) {
    addIssue(ctx, ["providerLock", "models"], "model locks must be unique and sorted by role");
  }
  validateRepositoryPins(lock, profile, ctx);
  validateModelPins(lock, modelRequirements, ctx);
}

function validateRepositoryPins(
  lock: z.infer<typeof FoundryRestorationProviderLockV0Schema>,
  profile: FoundryRestorationProviderProfileV0,
  ctx: z.RefinementCtx,
): void {
  for (const requirement of profile.repositoryRequirements) {
    const candidate = lock.repositories.find((entry) => entry.role === requirement.role);
    if (candidate === undefined) continue;
    if (requirement.repositoryId !== null && candidate.repositoryId !== requirement.repositoryId) {
      addIssue(ctx, ["providerLock", "repositories"], `repository identity for ${requirement.role} disagrees with the audited pin`);
    }
    if (requirement.revision !== null && candidate.revision !== requirement.revision) {
      addIssue(ctx, ["providerLock", "repositories"], `repository revision for ${requirement.role} disagrees with the audited pin`);
    }
    if (requirement.officialLicenseComponents !== null && !canonicalEqual(candidate.licenseEvidence.officialLicenseFacts.components, requirement.officialLicenseComponents)) {
      addIssue(ctx, ["providerLock", "repositories"], `repository licence components for ${requirement.role} disagree with the official facts`);
    }
    if (candidate.licenseEvidence.projectPolicyReview.reviewedUsePosture !== requirement.requiredUsePosture) {
      addIssue(ctx, ["providerLock", "repositories"], `repository reviewed use posture for ${requirement.role} disagrees with policy`);
    }
    if (
      requirement.licenseDocument !== null &&
      !canonicalEqual(candidate.licenseEvidence.officialLicenseFacts.document, requirement.licenseDocument)
    ) {
      addIssue(ctx, ["providerLock", "repositories"], `repository licence document for ${requirement.role} disagrees with the official identity`);
    }
    if (Date.parse(candidate.licenseEvidence.projectPolicyReview.reviewedAt) > Date.parse(lock.reviewedAt)) {
      addIssue(ctx, ["providerLock", "repositories"], `repository licence review for ${requirement.role} cannot postdate the lock review`);
    }
  }
}

function validateModelPins(
  lock: z.infer<typeof FoundryRestorationProviderLockV0Schema>,
  requirements: FoundryRestorationProviderProfileV0["modelRequirements"],
  ctx: z.RefinementCtx,
): void {
  for (const requirement of requirements) {
    const candidate = lock.models.find((entry) => entry.role === requirement.role);
    if (candidate === undefined) continue;
    if (requirement.modelId !== null && candidate.modelId !== requirement.modelId) {
      addIssue(ctx, ["providerLock", "models"], `model identity for ${requirement.role} disagrees with the audited pin`);
    }
    if (requirement.revision !== null && candidate.revision !== requirement.revision) {
      addIssue(ctx, ["providerLock", "models"], `model revision for ${requirement.role} disagrees with the audited pin`);
    }
    if (candidate.access !== requirement.access) {
      addIssue(ctx, ["providerLock", "models"], `model access for ${requirement.role} disagrees with the official metadata`);
    }
    if (requirement.officialLicenseComponents !== null && !canonicalEqual(candidate.licenseEvidence.officialLicenseFacts.components, requirement.officialLicenseComponents)) {
      addIssue(ctx, ["providerLock", "models"], `model licence components for ${requirement.role} disagree with the official facts`);
    }
    if (candidate.licenseEvidence.projectPolicyReview.reviewedUsePosture !== requirement.requiredUsePosture) {
      addIssue(ctx, ["providerLock", "models"], `model reviewed use posture for ${requirement.role} disagrees with policy`);
    }
    if (
      requirement.licenseDocument !== null &&
      !canonicalEqual(candidate.licenseEvidence.officialLicenseFacts.document, requirement.licenseDocument)
    ) {
      addIssue(ctx, ["providerLock", "models"], `model licence document for ${requirement.role} disagrees with the official identity`);
    }
    if (Date.parse(candidate.licenseEvidence.projectPolicyReview.reviewedAt) > Date.parse(lock.reviewedAt)) {
      addIssue(ctx, ["providerLock", "models"], `model licence review for ${requirement.role} cannot postdate the lock review`);
    }
    const weightKeys = candidate.weights.map((weight) => `${weight.relativePath}:${weight.sha256}`);
    if (!uniqueSorted(weightKeys)) {
      addIssue(ctx, ["providerLock", "models"], `weight files for ${requirement.role} must be unique and sorted`);
    }
  }
}

function validateExperimentPayload(
  experiment: z.infer<typeof ExperimentPayloadV0Schema>,
  ctx: z.RefinementCtx,
): void {
  const canonicalProfile = getFoundryRestorationProviderProfileV0(experiment.lane);
  if (experiment.providerProfile.profileSha256 !== canonicalProfile.profileSha256) {
    addIssue(ctx, ["providerProfile"], "experiment must embed the canonical audited provider profile");
  }
  if (
    (experiment.lane === "difix3d_plus") !== (experiment.providerVariant !== null)
  ) {
    addIssue(ctx, ["providerVariant"], "Difix requires an explicit difix or difix_ref variant; other lanes prohibit one");
  }
  validateProviderLock(
    experiment.providerLock,
    experiment.providerProfile,
    experiment.providerVariant,
    ctx,
  );
  if (
    experiment.plannedExecutionLock.lane !== experiment.lane ||
    experiment.plannedExecutionLock.providerVariant !== experiment.providerVariant ||
    experiment.plannedExecutionLock.providerProfileSha256 !== experiment.providerProfile.profileSha256 ||
    experiment.plannedExecutionLock.providerLockSha256 !== experiment.providerLock.providerLockSha256
  ) {
    addIssue(
      ctx,
      ["plannedExecutionLock"],
      "planned execution lock must bind the experiment lane, provider profile, and provider lock",
    );
  }
  if (Date.parse(experiment.operatorOptIn.acceptedAt) > Date.parse(experiment.createdAt)) {
    addIssue(ctx, ["operatorOptIn", "acceptedAt"], "operator opt-in cannot postdate experiment compilation");
  }
  if (Date.parse(experiment.providerLock.reviewedAt) > Date.parse(experiment.createdAt)) {
    addIssue(ctx, ["providerLock", "reviewedAt"], "provider lock review cannot postdate experiment compilation");
  }
  const requiredInputs = experiment.providerProfile.requiredInputs.filter((requirement) =>
    requirementAppliesToVariant(requirement.variants, experiment.providerVariant),
  );
  if (!exactRoleSet(
    experiment.inputs.map((input) => input.role),
    requiredInputs.map((requirement) => requirement.role),
  )) {
    addIssue(ctx, ["inputs"], "immutable inputs must exactly cover the provider's required roles");
  }
  for (const requirement of requiredInputs) {
    const input = experiment.inputs.find((candidate) => candidate.role === requirement.role);
    if (
      input !== undefined &&
      (input.truthLayer !== requirement.truthLayer || input.artifactClass !== requirement.artifactClass)
    ) {
      addIssue(
        ctx,
        ["inputs"],
        `input ${requirement.role} must match its audited truth layer and artifact class`,
      );
    }
    if (
      input !== undefined &&
      (
        input.mediaType !== requirement.mediaType ||
        requirement.requiresImageDimensions !== (input.width !== null && input.height !== null)
      )
    ) {
      addIssue(ctx, ["inputs"], `input ${requirement.role} must match its exact media and dimension contract`);
    }
  }
  for (const input of experiment.inputs) {
    const descriptorClosure = input.reconstructionDescriptorClosure ?? null;
    const isReconstructionDescriptor =
      input.mediaType === FOUNDRY_RESTORATION_RECONSTRUCTION_DESCRIPTOR_MEDIA_TYPE;
    if (descriptorClosure !== null && !isReconstructionDescriptor) {
      addIssue(
        ctx,
        ["inputs"],
        `input ${input.role} cannot carry a reconstruction descriptor closure for media type ${input.mediaType}`,
      );
    }
    if (
      isReconstructionDescriptor &&
      (
        input.artifactClass !== "source_derived_reconstruction" ||
        input.canonicalization !== "rfc8785_json" ||
        descriptorClosure === null ||
        descriptorClosure.descriptorSha256 !== input.sha256 ||
        descriptorClosure.descriptorSizeBytes !== input.sizeBytes
      )
    ) {
      addIssue(
        ctx,
        ["inputs"],
        `input ${input.role} must bind a complete canonical reconstruction descriptor member closure`,
      );
    }
    const prepared = input.artifactClass === "source_derived_capture_observation";
    if (prepared !== (input.preparationLineage !== null)) {
      addIssue(ctx, ["inputs"], `input ${input.role} must bind parent raw-image manifest and preparation receipt exactly when provider-prepared`);
    }
    if (input.preparationLineage !== null && !canonicalEqual(input.preparationLineage.preparedOutputArtifact, {
      artifactId: input.artifactId, namespace: input.namespace, relativePath: input.relativePath,
      mediaType: input.mediaType, width: input.width, height: input.height, sizeBytes: input.sizeBytes,
      sha256: input.sha256, canonicalization: input.mediaType === "application/json" ? "rfc8785_json" : "byte_exact",
      immutable: true, accessMode: "read_only", authority: "none",
    })) {
      addIssue(ctx, ["inputs"], `input ${input.role} preparation receipt must bind the complete prepared output artifact`);
    }
    if (input.preparationLineage !== null && Date.parse(input.preparationLineage.completedAt) > Date.parse(experiment.createdAt)) {
      addIssue(ctx, ["inputs"], `input ${input.role} preparation receipt cannot complete after experiment compilation`);
    }
  }
  const outputNamespace = `experiments/restoration/${experiment.experimentId}/${experiment.lane}/${experiment.providerVariant ?? "default"}`;
  if (experiment.outputPolicy.namespace !== outputNamespace) {
    addIssue(ctx, ["outputPolicy", "namespace"], "experiment output namespace must be derived and isolated");
  }
  if (experiment.inputs.some((input) => namespacesOverlap(input.namespace, outputNamespace))) {
    addIssue(ctx, ["inputs"], "captured input and derived output namespaces must not overlap");
  }
  if (!uniqueSorted(experiment.inputs.map((input) => `${input.role}:${input.artifactId}:${input.sha256}`))) {
    addIssue(ctx, ["inputs"], "experiment inputs must be unique and canonically sorted");
  }
  if (!uniqueSorted(experiment.fixedCameras.map((camera) => camera.cameraId))) {
    addIssue(ctx, ["fixedCameras"], "fixed cameras must be unique and sorted by camera id");
  }
  const closures = experiment.plannedExecutionLock.fixedCameraClosures;
  if (!exactRoleSet(
    closures.map((closure) => closure.cameraId),
    experiment.fixedCameras.map((camera) => camera.cameraId),
  )) {
    addIssue(ctx, ["plannedExecutionLock", "fixedCameraClosures"], "planned execution must bind every fixed camera exactly once");
  }
  for (const closure of closures) {
    const camera = experiment.fixedCameras.find((candidate) => candidate.cameraId === closure.cameraId);
    if (
      camera === undefined ||
      closure.cameraSha256 !== camera.cameraSha256 ||
      closure.renderDerivationReceipt.cameraId !== camera.cameraId ||
      closure.renderDerivationReceipt.cameraSha256 !== camera.cameraSha256 ||
      closure.renderDerivationReceipt.rendererProfileArtifact.sha256 !== camera.rendererProfileSha256 ||
      closure.renderDerivationReceipt.sourceRenderArtifact.width !== camera.width ||
      closure.renderDerivationReceipt.sourceRenderArtifact.height !== camera.height
    ) {
      addIssue(ctx, ["plannedExecutionLock", "fixedCameraClosures"], `camera closure ${closure.cameraId} disagrees with the fixed camera or renderer profile`);
    }
    if (closure.protectedRegionMask.artifact.sha256 === closure.generatedRegionMask.artifact.sha256) {
      addIssue(ctx, ["plannedExecutionLock", "fixedCameraClosures"], `camera closure ${closure.cameraId} must use distinct protected and generated masks`);
    }
    for (const mask of [closure.protectedRegionMask, closure.generatedRegionMask]) {
      if (camera !== undefined && (mask.artifact.width !== camera.width || mask.artifact.height !== camera.height)) {
        addIssue(ctx, ["plannedExecutionLock", "fixedCameraClosures"], `camera closure ${closure.cameraId} mask dimensions must match the fixed camera`);
      }
      if (mask.analysis.decodedWidth !== mask.artifact.width || mask.analysis.decodedHeight !== mask.artifact.height) {
        addIssue(ctx, ["plannedExecutionLock", "fixedCameraClosures"], `camera closure ${closure.cameraId} mask analysis dimensions must match the exact mask artifact`);
      }
      if (!canonicalEqual(mask.analysis.maskArtifact, mask.artifact)) {
        addIssue(ctx, ["plannedExecutionLock", "fixedCameraClosures"], `camera closure ${closure.cameraId} mask analysis must bind the complete exact mask artifact`);
      }
      if (Date.parse(mask.analysis.completedAt) > Date.parse(experiment.createdAt)) {
        addIssue(ctx, ["plannedExecutionLock", "fixedCameraClosures"], `camera closure ${closure.cameraId} mask analysis cannot complete after experiment compilation`);
      }
    }
    if (closure.protectedRegionMask.maskRole !== "protected_region" || closure.generatedRegionMask.maskRole !== "generated_region") {
      addIssue(ctx, ["plannedExecutionLock", "fixedCameraClosures"], `camera closure ${closure.cameraId} mask roles are invalid`);
    }
    const sourceReconstruction = experiment.inputs.find((input) => input.artifactClass === "source_derived_reconstruction");
    const boundReconstruction = closure.renderDerivationReceipt.sourceReconstructionArtifact;
    if (sourceReconstruction === undefined || !canonicalEqual({
      artifactId: boundReconstruction.artifactId,
      relativePath: boundReconstruction.relativePath,
      mediaType: boundReconstruction.mediaType,
      sizeBytes: boundReconstruction.sizeBytes,
      sha256: boundReconstruction.sha256,
    }, {
      artifactId: sourceReconstruction.artifactId,
      relativePath: sourceReconstruction.relativePath,
      mediaType: sourceReconstruction.mediaType,
      sizeBytes: sourceReconstruction.sizeBytes,
      sha256: sourceReconstruction.sha256,
    })) {
      addIssue(ctx, ["plannedExecutionLock", "fixedCameraClosures"], `camera closure ${closure.cameraId} must bind the exact immutable source reconstruction input`);
    }
  }
  if (experiment.lane === "difix3d_plus") {
    const sourceRender = experiment.inputs.find((input) => input.role === "source_fixed_camera_render");
    const sourceReconstruction = experiment.inputs.find((input) => input.role === "source_reconstruction");
    if (
      sourceRender === undefined ||
      sourceReconstruction === undefined ||
      sourceReconstruction.mediaType !== FOUNDRY_RESTORATION_RECONSTRUCTION_DESCRIPTOR_MEDIA_TYPE ||
      sourceReconstruction.reconstructionDescriptorClosure === null ||
      sourceReconstruction.reconstructionDescriptorClosure === undefined ||
      closures.some((closure) =>
        !canonicalEqual({
          artifactId: closure.renderDerivationReceipt.sourceRenderArtifact.artifactId,
          relativePath: closure.renderDerivationReceipt.sourceRenderArtifact.relativePath,
          mediaType: closure.renderDerivationReceipt.sourceRenderArtifact.mediaType,
          sizeBytes: closure.renderDerivationReceipt.sourceRenderArtifact.sizeBytes,
          sha256: closure.renderDerivationReceipt.sourceRenderArtifact.sha256,
          width: closure.renderDerivationReceipt.sourceRenderArtifact.width,
          height: closure.renderDerivationReceipt.sourceRenderArtifact.height,
        }, {
          artifactId: sourceRender.artifactId,
          relativePath: sourceRender.relativePath,
          mediaType: sourceRender.mediaType,
          sizeBytes: sourceRender.sizeBytes,
          sha256: sourceRender.sha256,
          width: sourceRender.width,
          height: sourceRender.height,
        }) ||
        closure.protectedRegionMask.analysis.state !== "all_one" ||
        closure.generatedRegionMask.analysis.state !== "all_zero",
      )
    ) {
      addIssue(ctx, ["plannedExecutionLock", "fixedCameraClosures"], "Difix camera closures must bind the exact source render input");
    }
  }
  if (experiment.lane === "difix3d_plus" && experiment.fixedCameras.length !== 1) {
    addIssue(ctx, ["fixedCameras"], "the Difix3D+ diagnostic lane is restricted to one fixed camera");
  }
}

export const FoundryRestorationExperimentV0Schema = ExperimentPayloadV0Schema.extend({
  experimentSha256: RuntimeSha256Schema,
})
  .strict()
  .superRefine((experiment, ctx) => {
    const { experimentSha256: _experimentSha256, ...payload } = experiment;
    validateExperimentPayload(payload, ctx);
    if (experiment.experimentSha256 !== digest(EXPERIMENT_DIGEST_DOMAIN, ExperimentPayloadV0Schema.parse(payload))) {
      addIssue(ctx, ["experimentSha256"], "experiment digest must match its exact payload");
    }
  });
export type FoundryRestorationExperimentV0 = z.infer<
  typeof FoundryRestorationExperimentV0Schema
>;

const CompileExperimentInputV0Schema = z
  .object({
    experimentId: RuntimeManifestKeySchema,
    projectId: RuntimeManifestKeySchema,
    createdAt: FoundryUtcInstantSchema,
    lane: FoundryRestorationLaneSchema,
    providerVariant: FoundryRestorationProviderVariantSchema.nullable(),
    providerLock: FoundryRestorationProviderLockPayloadV0Schema,
    plannedExecution: FoundryRestorationPlannedExecutionInputV0Schema,
    operatorOptIn: OperatorOptInV0Schema,
    inputs: z.array(FoundryRestorationInputCandidateV0Schema).min(1).max(100_000),
    fixedCameras: z.array(FoundryRestorationFixedCameraV0Schema).min(1).max(10_000),
  })
  .strict();
export type CompileFoundryRestorationExperimentV0Input = z.infer<
  typeof CompileExperimentInputV0Schema
>;

function sortCompileInputs(
  inputs: CompileFoundryRestorationExperimentV0Input["inputs"],
): CompileFoundryRestorationExperimentV0Input["inputs"] {
  return [...inputs].sort((left, right) =>
    ordinalCompare(
      `${left.role}:${left.artifactId}:${left.sha256}`,
      `${right.role}:${right.artifactId}:${right.sha256}`,
    ),
  );
}

function compileProviderLock(
  payload: FoundryRestorationProviderLockPayloadV0,
): z.infer<typeof FoundryRestorationProviderLockV0Schema> {
  const parsed = FoundryRestorationProviderLockPayloadV0Schema.parse(payload);
  return FoundryRestorationProviderLockV0Schema.parse({
    ...parsed,
    providerLockSha256: digest(PROVIDER_LOCK_DIGEST_DOMAIN, parsed),
  });
}

function compilePlannedExecutionLock(
  input: z.infer<typeof FoundryRestorationPlannedExecutionInputV0Schema>,
  lane: FoundryRestorationLane,
  providerVariant: "difix" | "difix_ref" | null,
  providerProfileSha256: string,
  providerLockSha256: string,
): FoundryRestorationPlannedExecutionLockV0 {
  const planned = FoundryRestorationPlannedExecutionInputV0Schema.parse(input);
  const payload = PlannedExecutionLockPayloadV0Schema.parse({
    schemaVersion: FOUNDRY_RESTORATION_PLANNED_EXECUTION_LOCK_V0,
    lane,
    providerVariant,
    providerProfileSha256,
    providerLockSha256,
    ...planned,
    authority: "none",
    capabilities: {
      execution: "not_authorized",
      dispatchEnabled: false,
      sourceTruthReplacement: "prohibited",
    },
  });
  return FoundryRestorationPlannedExecutionLockV0Schema.parse({
    ...payload,
    plannedExecutionLockSha256: digest(PLANNED_EXECUTION_LOCK_DIGEST_DOMAIN, payload),
  });
}

export function compileFoundryRestorationExperimentV0(
  input: CompileFoundryRestorationExperimentV0Input,
): FoundryRestorationExperimentV0 {
  const parsed = CompileExperimentInputV0Schema.parse(input);
  if (parsed.inputs.some((candidate) => !candidate.immutable)) {
    throw new FoundryIntegrityError("RESTORATION_MUTABLE_INPUT", "Every restoration input must be immutable.");
  }
  const outputNamespace = `experiments/restoration/${parsed.experimentId}/${parsed.lane}/${parsed.providerVariant ?? "default"}`;
  if (parsed.inputs.some((candidate) => namespacesOverlap(candidate.namespace, outputNamespace))) {
    throw new FoundryIntegrityError(
      "RESTORATION_NAMESPACE_OVERLAP",
      "Captured input and generated experiment output namespaces overlap.",
    );
  }
  const profile = getFoundryRestorationProviderProfileV0(parsed.lane);
  const providerLock = compileProviderLock(parsed.providerLock);
  const plannedExecutionLock = compilePlannedExecutionLock(
    parsed.plannedExecution,
    parsed.lane,
    parsed.providerVariant,
    profile.profileSha256,
    providerLock.providerLockSha256,
  );
  const payload = ExperimentPayloadV0Schema.parse({
    schemaVersion: FOUNDRY_RESTORATION_EXPERIMENT_V0,
    experimentId: parsed.experimentId,
    projectId: parsed.projectId,
    createdAt: parsed.createdAt,
    lane: parsed.lane,
    providerVariant: parsed.providerVariant,
    providerProfile: profile,
    providerLock,
    plannedExecutionLock,
    operatorOptIn: parsed.operatorOptIn,
    inputs: sortCompileInputs(parsed.inputs).map((candidate) => ({ ...candidate, immutable: true as const })),
    fixedCameras: [...parsed.fixedCameras].sort((left, right) =>
      ordinalCompare(left.cameraId, right.cameraId),
    ),
    outputPolicy: {
      namespace: outputNamespace,
      createOnlyRequired: true,
      createOnlyEnforcedByThisContract: false,
      runnerEnforcementRequired: true,
      overwriteAllowed: false,
      sourceMutationAllowed: false,
      sourceTruthReplacementAllowed: false,
      automaticPromotionAllowed: false,
      runtimeRegistrationAllowed: false,
    },
    fidelityPolicy: FIDELITY_POLICY,
    authority: "none",
    capabilities: {
      planning: "compiled",
      execution: "not_authorized",
      dispatchEnabled: false,
      promotion: "not_recorded",
      sourceTruthReplacement: "prohibited",
    },
  });
  return FoundryRestorationExperimentV0Schema.parse({
    ...payload,
    experimentSha256: digest(EXPERIMENT_DIGEST_DOMAIN, payload),
  });
}

const ForbiddenSemanticDetectionsV0Schema = z
  .object({
    invented_window: z.number().int().nonnegative().max(1_000_000),
    invented_doorway: z.number().int().nonnegative().max(1_000_000),
    dark_central_floor: z.number().int().nonnegative().max(1_000_000),
    neighbouring_room: z.number().int().nonnegative().max(1_000_000),
    facade: z.number().int().nonnegative().max(1_000_000),
    generated_fill_outside_mask: z.number().int().nonnegative().max(1_000_000),
  })
  .strict();

const EvaluationResultBindingV0Schema = z.object({
  implementationSha256: RuntimeSha256Schema,
  configurationSha256: RuntimeSha256Schema,
  runtimeEnvironmentSha256: RuntimeSha256Schema,
  beforeSha256: RuntimeSha256Schema,
  afterSha256: RuntimeSha256Schema,
  protectedRegionMaskSha256: RuntimeSha256Schema,
  generatedRegionMaskSha256: RuntimeSha256Schema,
}).strict();

const ForbiddenSemanticEvaluationPayloadV0Schema = z
  .object({
    status: z.enum(["evaluated", "not_evaluated"]),
    uncertainty: z.enum(["none", "known", "unknown"]),
    detections: ForbiddenSemanticDetectionsV0Schema.nullable(),
    evaluatorReceiptArtifact: DigestAddressedJsonArtifactV0Schema.nullable(),
    binding: EvaluationResultBindingV0Schema,
  })
  .strict();

const ForbiddenSemanticEvaluationV0Schema = ForbiddenSemanticEvaluationPayloadV0Schema.extend({
  semanticResultSha256: RuntimeSha256Schema,
}).strict()
  .superRefine((evaluation, ctx) => {
    if (
      evaluation.status === "evaluated" &&
      (evaluation.detections === null || evaluation.evaluatorReceiptArtifact === null)
    ) {
      addIssue(ctx, [], "an evaluated semantic result requires detections and an evaluator receipt artifact");
    }
    if (
      evaluation.status === "not_evaluated" &&
      (evaluation.detections !== null || evaluation.evaluatorReceiptArtifact !== null || evaluation.uncertainty !== "unknown")
    ) {
      addIssue(ctx, [], "a not-evaluated semantic result must remain explicitly unknown and carry no detections");
    }
    const { semanticResultSha256: _digest, ...payload } = evaluation;
    if (evaluation.semanticResultSha256 !== digest(SEMANTIC_RECEIPT_DIGEST_DOMAIN, payload)) {
      addIssue(ctx, ["semanticResultSha256"], "semantic result digest must match its exact reported values and bindings");
    }
  });

export function createFoundryRestorationSemanticResultV0(
  input: z.infer<typeof ForbiddenSemanticEvaluationPayloadV0Schema>,
) {
  const payload = ForbiddenSemanticEvaluationPayloadV0Schema.parse(input);
  return ForbiddenSemanticEvaluationV0Schema.parse({
    ...payload,
    semanticResultSha256: digest(SEMANTIC_RECEIPT_DIGEST_DOMAIN, payload),
  });
}

const ProtectedMetricResultPayloadV0Schema = z.object({
  protectedRegionSsim: z.number().min(0).max(1),
  protectedRegionLpips: z.number().finite().nonnegative(),
  protectedRegionMeanAbsoluteError: z.number().min(0).max(1),
  maximumProtectedEdgeDisplacementPixels: z.number().nonnegative().max(1_000_000),
  evaluatorReceiptArtifact: DigestAddressedJsonArtifactV0Schema,
  binding: EvaluationResultBindingV0Schema,
}).strict();

const ProtectedMetricResultV0Schema = ProtectedMetricResultPayloadV0Schema.extend({
  protectedMetricResultSha256: RuntimeSha256Schema,
}).strict().superRefine((result, ctx) => {
  const { protectedMetricResultSha256: _digest, ...payload } = result;
  if (result.protectedMetricResultSha256 !== digest(PROTECTED_METRIC_RECEIPT_DIGEST_DOMAIN, payload)) {
    addIssue(ctx, ["protectedMetricResultSha256"], "protected metric result digest must match its exact reported values and bindings");
  }
});

export function createFoundryRestorationProtectedMetricResultV0(
  input: z.infer<typeof ProtectedMetricResultPayloadV0Schema>,
) {
  const payload = ProtectedMetricResultPayloadV0Schema.parse(input);
  return ProtectedMetricResultV0Schema.parse({
    ...payload,
    protectedMetricResultSha256: digest(PROTECTED_METRIC_RECEIPT_DIGEST_DOMAIN, payload),
  });
}

const RenderArtifactV0Schema = z
  .object({
    namespace: SafeNamespaceSchema,
    relativePath: SafeRelativePathSchema,
    mediaType: z.literal("image/png"),
    sizeBytes: z.number().int().positive().max(MAX_ARTIFACT_BYTES),
    sha256: RuntimeSha256Schema,
    width: z.number().int().positive().max(65_536),
    height: z.number().int().positive().max(65_536),
  })
  .strict();

const CandidateRenderReceiptPayloadV0Schema = z.object({
  schemaVersion: z.literal(FOUNDRY_RESTORATION_CANDIDATE_RENDER_RECEIPT_V0),
  candidateOutputSha256: RuntimeSha256Schema,
  candidateOutputId: RuntimeManifestKeySchema,
  candidateOutputNamespace: SafeNamespaceSchema,
  candidateOutputRelativePath: SafeRelativePathSchema,
  candidateOutputMediaType: MediaTypeSchema,
  candidateOutputSizeBytes: z.number().int().positive().max(MAX_ARTIFACT_BYTES),
  candidateOutputWidth: z.number().int().positive().max(65_536).nullable(),
  candidateOutputHeight: z.number().int().positive().max(65_536).nullable(),
  candidateArtifactClass: FoundryRestorationCandidateArtifactClassSchema,
  candidateTruthLayer: z.literal("GENERATED_CINEMATIC"),
  cameraId: RuntimeManifestKeySchema,
  cameraSha256: RuntimeSha256Schema,
  rendererProfileSha256: RuntimeSha256Schema,
  rendererImplementationArtifact: DigestAddressedArtifactV0Schema,
  rendererRuntimeArtifact: DigestAddressedJsonArtifactV0Schema,
  rendererProcessReceiptArtifact: DigestAddressedJsonArtifactV0Schema,
  startedAt: FoundryUtcInstantSchema,
  completedAt: FoundryUtcInstantSchema,
  renderedEvidenceSha256: RuntimeSha256Schema,
  renderedEvidenceNamespace: SafeNamespaceSchema,
  renderedEvidenceRelativePath: SafeRelativePathSchema,
  renderedEvidenceSizeBytes: z.number().int().positive().max(MAX_ARTIFACT_BYTES),
  renderedEvidenceWidth: z.number().int().positive().max(65_536),
  renderedEvidenceHeight: z.number().int().positive().max(65_536),
  authority: z.literal("none"),
}).strict();

export const FoundryRestorationCandidateRenderReceiptV0Schema = CandidateRenderReceiptPayloadV0Schema.extend({
  candidateRenderReceiptSha256: RuntimeSha256Schema,
}).strict().superRefine((receipt, ctx) => {
  const { candidateRenderReceiptSha256: _digest, ...payload } = receipt;
  if (Date.parse(receipt.startedAt) >= Date.parse(receipt.completedAt)) {
    addIssue(ctx, ["completedAt"], "candidate render must complete after it starts");
  }
  if (receipt.candidateRenderReceiptSha256 !== digest(CANDIDATE_RENDER_RECEIPT_DIGEST_DOMAIN, payload)) {
    addIssue(ctx, ["candidateRenderReceiptSha256"], "candidate render receipt digest must match its exact payload");
  }
});
export type FoundryRestorationCandidateRenderReceiptV0 = z.infer<typeof FoundryRestorationCandidateRenderReceiptV0Schema>;

export function createFoundryRestorationCandidateRenderReceiptV0(
  input: Omit<z.infer<typeof CandidateRenderReceiptPayloadV0Schema>, "schemaVersion" | "authority">,
): z.infer<typeof FoundryRestorationCandidateRenderReceiptV0Schema> {
  const payload = CandidateRenderReceiptPayloadV0Schema.parse({
    schemaVersion: FOUNDRY_RESTORATION_CANDIDATE_RENDER_RECEIPT_V0, ...input, authority: "none",
  });
  return FoundryRestorationCandidateRenderReceiptV0Schema.parse({
    ...payload,
    candidateRenderReceiptSha256: digest(CANDIDATE_RENDER_RECEIPT_DIGEST_DOMAIN, payload),
  });
}

const CandidateOutputV0Schema = z
  .object({
    outputId: RuntimeManifestKeySchema,
    namespace: SafeNamespaceSchema,
    relativePath: SafeRelativePathSchema,
    mediaType: MediaTypeSchema,
    sizeBytes: z.number().int().positive().max(MAX_ARTIFACT_BYTES),
    sha256: RuntimeSha256Schema,
    width: z.number().int().positive().max(65_536).nullable(),
    height: z.number().int().positive().max(65_536).nullable(),
    truthLayer: z.literal("GENERATED_CINEMATIC"),
    artifactClass: FoundryRestorationCandidateArtifactClassSchema,
    authority: z.literal("none"),
  })
  .strict();

const EvaluationToolLockV0Schema = z
  .object({
    implementationSha256: RuntimeSha256Schema,
    configurationSha256: RuntimeSha256Schema,
    runtimeEnvironmentSha256: RuntimeSha256Schema,
  })
  .strict();

const EvaluationToolsV0Schema = z
  .object({
    protectedRegionMetrics: EvaluationToolLockV0Schema,
    forbiddenSemanticDetector: EvaluationToolLockV0Schema,
  })
  .strict();

const CreateOnlyRunnerReceiptPayloadV0Schema = z.object({
  schemaVersion: z.literal(FOUNDRY_RESTORATION_CREATE_ONLY_RUN_RECEIPT_V0),
  experimentSha256: RuntimeSha256Schema,
  plannedExecutionLockSha256: RuntimeSha256Schema,
  executionReceiptSha256: RuntimeSha256Schema,
  startedAt: FoundryUtcInstantSchema,
  completedAt: FoundryUtcInstantSchema,
  runnerImplementationArtifact: DigestAddressedArtifactV0Schema,
  runtimeEnvironmentArtifact: DigestAddressedJsonArtifactV0Schema,
  receiptArtifact: DigestAddressedJsonArtifactV0Schema,
  targets: z.array(z.object({
    namespace: SafeNamespaceSchema,
    relativePath: SafeRelativePathSchema,
    absentBefore: z.literal(true),
    createdSha256: RuntimeSha256Schema,
    createdSizeBytes: z.number().int().positive().max(MAX_ARTIFACT_BYTES),
    createdMediaType: MediaTypeSchema,
    exactPathCreated: z.literal(true),
  }).strict()).min(1).max(20_000),
  enforced: z.literal(true),
  authority: z.literal("none"),
}).strict();

export const FoundryRestorationCreateOnlyRunReceiptV0Schema = CreateOnlyRunnerReceiptPayloadV0Schema.extend({
  createOnlyRunReceiptSha256: RuntimeSha256Schema,
}).strict().superRefine((receipt, ctx) => {
  const { createOnlyRunReceiptSha256: _digest, ...payload } = receipt;
  if (Date.parse(receipt.startedAt) >= Date.parse(receipt.completedAt)) {
    addIssue(ctx, ["completedAt"], "create-only run must complete after it starts");
  }
  const targetKeys = receipt.targets.map((target) => `${target.namespace}/${target.relativePath}:${target.createdSha256}`);
  if (!uniqueSorted(targetKeys)) addIssue(ctx, ["targets"], "create-only targets must be unique and ordinal-sorted");
  if (receipt.createOnlyRunReceiptSha256 !== digest(CREATE_ONLY_RUN_RECEIPT_DIGEST_DOMAIN, payload)) {
    addIssue(ctx, ["createOnlyRunReceiptSha256"], "create-only run receipt digest must match its exact payload");
  }
});
export type FoundryRestorationCreateOnlyRunReceiptV0 = z.infer<typeof FoundryRestorationCreateOnlyRunReceiptV0Schema>;

export function createFoundryRestorationCreateOnlyRunReceiptV0(
  input: Omit<z.infer<typeof CreateOnlyRunnerReceiptPayloadV0Schema>, "schemaVersion" | "authority">,
): FoundryRestorationCreateOnlyRunReceiptV0 {
  const payload = CreateOnlyRunnerReceiptPayloadV0Schema.parse({
    schemaVersion: FOUNDRY_RESTORATION_CREATE_ONLY_RUN_RECEIPT_V0, ...input, authority: "none",
  });
  return FoundryRestorationCreateOnlyRunReceiptV0Schema.parse({
    ...payload,
    createOnlyRunReceiptSha256: digest(CREATE_ONLY_RUN_RECEIPT_DIGEST_DOMAIN, payload),
  });
}

const HardwareGpuV0Schema = z
  .object({
    deviceOrdinal: z.number().int().nonnegative().max(1_024),
    vendor: z.string().trim().min(1).max(160),
    model: z.string().trim().min(1).max(240),
    dedicatedMemoryBytes: z.number().int().nonnegative().max(MAX_ARTIFACT_BYTES),
    driverVersion: z.string().trim().min(1).max(160),
  })
  .strict();

const HardwareInventoryPayloadV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_RESTORATION_HARDWARE_INVENTORY_V0),
    capturedAt: FoundryUtcInstantSchema,
    inventoryCollectorImplementationSha256: RuntimeSha256Schema,
    sourceInventoryArtifactSha256: RuntimeSha256Schema,
    operatingSystem: z.string().trim().min(1).max(240),
    cpuModel: z.string().trim().min(1).max(240),
    logicalProcessorCount: z.number().int().positive().max(16_384),
    physicalMemoryBytes: z.number().int().positive().max(MAX_ARTIFACT_BYTES),
    gpus: z.array(HardwareGpuV0Schema).max(1_024),
  })
  .strict();

function hardwareGpusAreUniqueAndSorted(
  hardware: z.infer<typeof HardwareInventoryPayloadV0Schema>,
): boolean {
  return hardware.gpus.every((gpu, index) => {
    const previous = index === 0 ? undefined : hardware.gpus[index - 1];
    return previous === undefined || previous.deviceOrdinal < gpu.deviceOrdinal;
  });
}

export const FoundryRestorationHardwareInventoryV0Schema =
  HardwareInventoryPayloadV0Schema.extend({
    hardwareInventorySha256: RuntimeSha256Schema,
  })
    .strict()
    .superRefine((hardware, ctx) => {
      const { hardwareInventorySha256: _hardwareInventorySha256, ...payload } = hardware;
      if (!hardwareGpusAreUniqueAndSorted(payload)) {
        addIssue(ctx, ["gpus"], "hardware GPUs must have unique ascending device ordinals");
      }
      if (hardware.hardwareInventorySha256 !== digest(HARDWARE_INVENTORY_DIGEST_DOMAIN, payload)) {
        addIssue(ctx, ["hardwareInventorySha256"], "hardware inventory digest must match its exact payload");
      }
    });
export type FoundryRestorationHardwareInventoryV0 = z.infer<
  typeof FoundryRestorationHardwareInventoryV0Schema
>;

export function createFoundryRestorationHardwareInventoryV0(
  input: Omit<z.infer<typeof HardwareInventoryPayloadV0Schema>, "schemaVersion">,
): FoundryRestorationHardwareInventoryV0 {
  const payload = HardwareInventoryPayloadV0Schema.parse({
    schemaVersion: FOUNDRY_RESTORATION_HARDWARE_INVENTORY_V0,
    ...input,
    gpus: [...input.gpus].sort((left, right) => left.deviceOrdinal - right.deviceOrdinal),
  });
  return FoundryRestorationHardwareInventoryV0Schema.parse({
    ...payload,
    hardwareInventorySha256: digest(HARDWARE_INVENTORY_DIGEST_DOMAIN, payload),
  });
}

const ExecutionReceiptPayloadV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_RESTORATION_EXECUTION_RECEIPT_V0),
    experimentSha256: RuntimeSha256Schema,
    plannedExecutionLockSha256: RuntimeSha256Schema,
    providerAdapterId: RuntimeManifestKeySchema,
    providerAdapterImplementationSha256: RuntimeSha256Schema,
    parameterConfigurationSha256: RuntimeSha256Schema,
    runtimeEnvironmentSha256: RuntimeSha256Schema,
    hardwareInventory: FoundryRestorationHardwareInventoryV0Schema,
    startedAt: FoundryUtcInstantSchema,
    completedAt: FoundryUtcInstantSchema,
    subjectInputSha256s: z.array(RuntimeSha256Schema).min(1).max(100_000),
    candidateOutputSha256s: z.array(RuntimeSha256Schema).max(10_000),
    providerProcessReceiptArtifactSha256: RuntimeSha256Schema,
    outcome: z.enum(["succeeded", "failed", "aborted", "out_of_memory"]),
    exitCode: z.number().int().min(-2_147_483_648).max(2_147_483_647).nullable(),
    failureCode: z.enum(["process_failed", "operator_aborted", "cuda_out_of_memory"]).nullable(),
    authority: z.literal("none"),
    sourceTruthReplacementAllowed: z.literal(false),
  })
  .strict();

function validateExecutionReceiptPayload(
  receipt: z.infer<typeof ExecutionReceiptPayloadV0Schema>,
  ctx: z.RefinementCtx,
): void {
  if (Date.parse(receipt.startedAt) >= Date.parse(receipt.completedAt)) {
    addIssue(ctx, ["completedAt"], "execution must complete after it starts");
  }
  if (receipt.outcome === "succeeded" && (receipt.exitCode !== 0 || receipt.failureCode !== null)) {
    addIssue(ctx, ["outcome"], "a successful attempt requires exit code zero and no failure code");
  }
  if (receipt.outcome === "succeeded" && receipt.candidateOutputSha256s.length === 0) {
    addIssue(ctx, ["candidateOutputSha256s"], "a successful attempt must bind at least one candidate output");
  }
  if (receipt.outcome !== "succeeded" && receipt.failureCode === null) {
    addIssue(ctx, ["failureCode"], "an unsuccessful attempt requires an explicit failure code");
  }
  if (receipt.outcome === "failed" && (receipt.exitCode === null || receipt.exitCode === 0 || receipt.failureCode !== "process_failed")) {
    addIssue(ctx, ["outcome"], "a failed attempt requires a nonzero exit code and process_failed");
  }
  if (receipt.outcome === "aborted" && (receipt.exitCode !== null || receipt.failureCode !== "operator_aborted")) {
    addIssue(ctx, ["outcome"], "an aborted attempt requires no exit code and operator_aborted");
  }
  if (receipt.outcome === "out_of_memory" && (receipt.exitCode === 0 || receipt.failureCode !== "cuda_out_of_memory")) {
    addIssue(ctx, ["outcome"], "an out-of-memory attempt requires null or nonzero exit code and cuda_out_of_memory");
  }
  if (!uniqueSorted(receipt.subjectInputSha256s)) {
    addIssue(ctx, ["subjectInputSha256s"], "execution input digests must be unique and ordinal-sorted");
  }
  if (!uniqueSorted(receipt.candidateOutputSha256s)) {
    addIssue(ctx, ["candidateOutputSha256s"], "execution output digests must be unique and ordinal-sorted");
  }
  const captured = Date.parse(receipt.hardwareInventory.capturedAt);
  if (captured < Date.parse(receipt.startedAt) || captured > Date.parse(receipt.completedAt)) {
    addIssue(ctx, ["hardwareInventory", "capturedAt"], "hardware inventory must be captured during execution");
  }
}

export const FoundryRestorationExecutionReceiptV0Schema =
  ExecutionReceiptPayloadV0Schema.extend({
    executionReceiptSha256: RuntimeSha256Schema,
  })
    .strict()
    .superRefine((receipt, ctx) => {
      const { executionReceiptSha256: _executionReceiptSha256, ...payload } = receipt;
      validateExecutionReceiptPayload(payload, ctx);
      if (receipt.executionReceiptSha256 !== digest(EXECUTION_RECEIPT_DIGEST_DOMAIN, payload)) {
        addIssue(ctx, ["executionReceiptSha256"], "execution receipt digest must match its exact payload");
      }
    });
export type FoundryRestorationExecutionReceiptV0 = z.infer<
  typeof FoundryRestorationExecutionReceiptV0Schema
>;

export type CreateFoundryRestorationExecutionReceiptV0Input = Omit<
  z.infer<typeof ExecutionReceiptPayloadV0Schema>,
  "schemaVersion" | "outcome" | "exitCode" | "failureCode" | "authority" | "sourceTruthReplacementAllowed"
>;

export type CreateFoundryRestorationAttemptReceiptV0Input = Omit<
  z.infer<typeof ExecutionReceiptPayloadV0Schema>,
  "schemaVersion" | "authority" | "sourceTruthReplacementAllowed"
>;

export function createFoundryRestorationAttemptReceiptV0(
  input: CreateFoundryRestorationAttemptReceiptV0Input,
): FoundryRestorationExecutionReceiptV0 {
  const payload = ExecutionReceiptPayloadV0Schema.parse({
    schemaVersion: FOUNDRY_RESTORATION_EXECUTION_RECEIPT_V0,
    ...input,
    subjectInputSha256s: ordinalSort(input.subjectInputSha256s),
    candidateOutputSha256s: ordinalSort(input.candidateOutputSha256s),
    authority: "none",
    sourceTruthReplacementAllowed: false,
  });
  return FoundryRestorationExecutionReceiptV0Schema.parse({
    ...payload,
    executionReceiptSha256: digest(EXECUTION_RECEIPT_DIGEST_DOMAIN, payload),
  });
}

export function createFoundryRestorationExecutionReceiptV0(
  input: CreateFoundryRestorationExecutionReceiptV0Input,
): FoundryRestorationExecutionReceiptV0 {
  return createFoundryRestorationAttemptReceiptV0({
    ...input,
    outcome: "succeeded",
    exitCode: 0,
    failureCode: null,
  });
}

const RenderExecutionReceiptPayloadV0Schema = z.object({
  schemaVersion: z.literal(FOUNDRY_RESTORATION_RENDER_EXECUTION_RECEIPT_V0),
  experimentSha256: RuntimeSha256Schema,
  plannedExecutionLockSha256: RuntimeSha256Schema,
  cameraId: RuntimeManifestKeySchema,
  cameraSha256: RuntimeSha256Schema,
  sourceReconstructionArtifact: DigestAddressedArtifactV0Schema,
  rendererProfileArtifact: DigestAddressedJsonArtifactV0Schema,
  rendererImplementationArtifact: DigestAddressedArtifactV0Schema,
  rendererRuntimeArtifact: DigestAddressedJsonArtifactV0Schema,
  rendererProcessReceiptArtifact: DigestAddressedJsonArtifactV0Schema,
  sourceRenderArtifact: DigestAddressedImageArtifactV0Schema,
  startedAt: FoundryUtcInstantSchema,
  completedAt: FoundryUtcInstantSchema,
  authority: z.literal("none"),
}).strict();

export const FoundryRestorationRenderExecutionReceiptV0Schema = RenderExecutionReceiptPayloadV0Schema.extend({
  renderExecutionReceiptSha256: RuntimeSha256Schema,
}).strict().superRefine((receipt, ctx) => {
  const { renderExecutionReceiptSha256: _digest, ...payload } = receipt;
  if (Date.parse(receipt.startedAt) >= Date.parse(receipt.completedAt)) {
    addIssue(ctx, ["completedAt"], "render execution must complete after it starts");
  }
  if (receipt.renderExecutionReceiptSha256 !== digest(RENDER_EXECUTION_RECEIPT_DIGEST_DOMAIN, payload)) {
    addIssue(ctx, ["renderExecutionReceiptSha256"], "render execution receipt digest must match its exact payload");
  }
});
export type FoundryRestorationRenderExecutionReceiptV0 = z.infer<typeof FoundryRestorationRenderExecutionReceiptV0Schema>;

export function createFoundryRestorationRenderExecutionReceiptV0(
  input: Omit<z.infer<typeof RenderExecutionReceiptPayloadV0Schema>, "schemaVersion" | "authority">,
): FoundryRestorationRenderExecutionReceiptV0 {
  const payload = RenderExecutionReceiptPayloadV0Schema.parse({
    schemaVersion: FOUNDRY_RESTORATION_RENDER_EXECUTION_RECEIPT_V0,
    ...input,
    authority: "none",
  });
  return FoundryRestorationRenderExecutionReceiptV0Schema.parse({
    ...payload,
    renderExecutionReceiptSha256: digest(RENDER_EXECUTION_RECEIPT_DIGEST_DOMAIN, payload),
  });
}

const CameraComparisonV0Schema = z
  .object({
    cameraId: RuntimeManifestKeySchema,
    cameraSha256: RuntimeSha256Schema,
    subjectInputSha256s: z.array(RuntimeSha256Schema).min(1).max(100_000),
    protectedRegionMaskSha256: RuntimeSha256Schema,
    generatedRegionMaskSha256: RuntimeSha256Schema,
    before: RenderArtifactV0Schema,
    beforeSourceArtifact: DigestAddressedImageArtifactV0Schema,
    after: RenderArtifactV0Schema,
    candidateRenderReceipt: FoundryRestorationCandidateRenderReceiptV0Schema,
    metrics: z.object({
      protectedRegion: ProtectedMetricResultV0Schema,
      forbiddenSemanticEvaluation: ForbiddenSemanticEvaluationV0Schema,
    }).strict(),
  })
  .strict();

function validateObservationCollections(
  observation: {
    readonly candidateOutputs: readonly z.infer<typeof CandidateOutputV0Schema>[];
    readonly cameraComparisons: readonly z.infer<typeof CameraComparisonV0Schema>[];
    readonly renderExecutionReceipts: readonly FoundryRestorationRenderExecutionReceiptV0[];
  },
  ctx: z.RefinementCtx,
): void {
  const candidateIdentitySets = [
    observation.candidateOutputs.map((output) => output.outputId),
    observation.candidateOutputs.map((output) => output.sha256),
    observation.candidateOutputs.map((output) => `${output.namespace}/${output.relativePath}`),
  ];
  if (candidateIdentitySets.some((values) => new Set(values).size !== values.length)) {
    addIssue(ctx, ["candidateOutputs"], "candidate output IDs, digests, and logical paths must each be unique");
  }
  const candidateKeys = observation.candidateOutputs.map((output) =>
    `${output.outputId}:${output.sha256}:${output.namespace}/${output.relativePath}`,
  );
  if (!uniqueSorted(candidateKeys)) {
    addIssue(ctx, ["candidateOutputs"], "candidate outputs must be ordinal-sorted by identity");
  }
  if (!uniqueSorted(observation.cameraComparisons.map((comparison) => comparison.cameraId))) {
    addIssue(ctx, ["cameraComparisons"], "camera comparisons must be unique and ordinal-sorted by camera ID");
  }
  if (!uniqueSorted(observation.renderExecutionReceipts.map((receipt) => receipt.cameraId))) {
    addIssue(ctx, ["renderExecutionReceipts"], "render execution receipts must be unique and ordinal-sorted by camera ID");
  }
}

export const FoundryRestorationEvidenceObservationV0Schema = z
  .object({
    observedAt: FoundryUtcInstantSchema,
    executionReceipt: FoundryRestorationExecutionReceiptV0Schema,
    renderExecutionReceipts: z.array(FoundryRestorationRenderExecutionReceiptV0Schema).min(1).max(10_000),
    createOnlyRunnerEvidence: FoundryRestorationCreateOnlyRunReceiptV0Schema,
    evaluationTools: EvaluationToolsV0Schema,
    candidateOutputs: z.array(CandidateOutputV0Schema).min(1).max(10_000),
    cameraComparisons: z.array(CameraComparisonV0Schema).min(1).max(10_000),
  })
  .strict()
  .superRefine(validateObservationCollections);
export type FoundryRestorationEvidenceObservationV0 = z.infer<
  typeof FoundryRestorationEvidenceObservationV0Schema
>;

function executionReceiptBindingFailures(
  experiment: FoundryRestorationExperimentV0,
  observation: FoundryRestorationEvidenceObservationV0,
): string[] {
  const receipt = observation.executionReceipt;
  const lock = experiment.plannedExecutionLock;
  const failures: string[] = [];
  if (!experiment.providerLock.exactOfficialIdentityReviewed) failures.push("exact provider identity review");
  if (receipt.outcome !== "succeeded") failures.push("successful execution outcome");
  if (receipt.experimentSha256 !== experiment.experimentSha256) failures.push("experiment digest");
  if (receipt.plannedExecutionLockSha256 !== lock.plannedExecutionLockSha256) failures.push("planned lock digest");
  if (receipt.providerAdapterId !== lock.providerAdapterId) failures.push("provider adapter identity");
  if (receipt.providerAdapterImplementationSha256 !== lock.providerAdapterImplementationArtifact.sha256) {
    failures.push("provider adapter implementation");
  }
  if (receipt.parameterConfigurationSha256 !== lock.parameterConfigurationArtifact.sha256) {
    failures.push("parameter configuration");
  }
  if (receipt.runtimeEnvironmentSha256 !== lock.runtimeEnvironmentArtifact.sha256) {
    failures.push("runtime environment");
  }
  const expectedInputs = ordinalSort(experiment.inputs.map((input) => input.sha256));
  if (!canonicalEqual(receipt.subjectInputSha256s, expectedInputs)) failures.push("subject input set");
  const expectedOutputs = ordinalSort(observation.candidateOutputs.map((output) => output.sha256));
  if (!canonicalEqual(receipt.candidateOutputSha256s, expectedOutputs)) failures.push("candidate output set");
  if (Date.parse(receipt.startedAt) < Date.parse(experiment.createdAt)) failures.push("execution start time");
  if (Date.parse(receipt.completedAt) > Date.parse(observation.observedAt)) failures.push("execution completion time");
  const created = observation.createOnlyRunnerEvidence.targets;
  if (observation.createOnlyRunnerEvidence.experimentSha256 !== experiment.experimentSha256 ||
      observation.createOnlyRunnerEvidence.plannedExecutionLockSha256 !== lock.plannedExecutionLockSha256 ||
      observation.createOnlyRunnerEvidence.executionReceiptSha256 !== receipt.executionReceiptSha256 ||
      Date.parse(observation.createOnlyRunnerEvidence.startedAt) < Date.parse(receipt.startedAt) ||
      Date.parse(observation.createOnlyRunnerEvidence.completedAt) > Date.parse(receipt.completedAt)) {
    failures.push("create-only runner execution identity and time closure");
  }
  const expectedCreated = observation.candidateOutputs.map((output) =>
    `${output.namespace}/${output.relativePath}:${output.sha256}:${String(output.sizeBytes)}:${output.mediaType}`,
  );
  const actualCreated = created.map((target) =>
    `${target.namespace}/${target.relativePath}:${target.createdSha256}:${String(target.createdSizeBytes)}:${target.createdMediaType}`,
  );
  if (!canonicalEqual(ordinalSort(actualCreated), ordinalSort(expectedCreated))) {
    failures.push("create-only runner created target set");
  }
  for (const comparison of observation.cameraComparisons) {
    const closure = lock.fixedCameraClosures.find((candidate) => candidate.cameraId === comparison.cameraId);
    const renderReceipt = observation.renderExecutionReceipts.find((candidate) => candidate.cameraId === comparison.cameraId);
    if (
      closure === undefined ||
      comparison.cameraSha256 !== closure.cameraSha256 ||
      comparison.protectedRegionMaskSha256 !== closure.protectedRegionMask.artifact.sha256 ||
      comparison.generatedRegionMaskSha256 !== closure.generatedRegionMask.artifact.sha256
    ) {
      failures.push(`camera/render/mask closure ${comparison.cameraId}`);
    }
    if (closure === undefined || renderReceipt === undefined ||
      renderReceipt.experimentSha256 !== experiment.experimentSha256 ||
      renderReceipt.plannedExecutionLockSha256 !== lock.plannedExecutionLockSha256 ||
      renderReceipt.cameraSha256 !== closure.cameraSha256 ||
      !canonicalEqual(renderReceipt.sourceReconstructionArtifact, closure.renderDerivationReceipt.sourceReconstructionArtifact) ||
      !canonicalEqual(renderReceipt.rendererProfileArtifact, closure.renderDerivationReceipt.rendererProfileArtifact) ||
      !canonicalEqual(renderReceipt.rendererImplementationArtifact, closure.renderDerivationReceipt.rendererImplementationArtifact) ||
      !canonicalEqual(renderReceipt.rendererRuntimeArtifact, closure.renderDerivationReceipt.rendererRuntimeArtifact) ||
      !canonicalEqual(renderReceipt.sourceRenderArtifact, closure.renderDerivationReceipt.sourceRenderArtifact) ||
      comparison.before.sha256 !== renderReceipt.sourceRenderArtifact.sha256 ||
      !canonicalEqual(comparison.beforeSourceArtifact, renderReceipt.sourceRenderArtifact) ||
      comparison.before.width !== renderReceipt.sourceRenderArtifact.width ||
      comparison.before.height !== renderReceipt.sourceRenderArtifact.height ||
      comparison.before.sizeBytes !== renderReceipt.sourceRenderArtifact.sizeBytes ||
      Date.parse(renderReceipt.startedAt) < Date.parse(experiment.createdAt) ||
      Date.parse(renderReceipt.completedAt) > Date.parse(observation.observedAt)
    ) {
      failures.push(`observed source render execution closure ${comparison.cameraId}`);
    }
    if (closure !== undefined && experiment.lane === "difix3d_plus") {
      const candidate = observation.candidateOutputs.find((output) => output.sha256 === comparison.after.sha256);
      if (
        comparison.before.sha256 !== closure.renderDerivationReceipt.sourceRenderArtifact.sha256 ||
        candidate === undefined || candidate.mediaType !== "image/png" ||
        candidate.width !== comparison.after.width || candidate.height !== comparison.after.height ||
        candidate.sizeBytes !== comparison.after.sizeBytes
      ) {
        failures.push(`Difix before/source and after/candidate closure ${comparison.cameraId}`);
      }
    }
    if (closure !== undefined) {
      const candidate = observation.candidateOutputs.find(
        (output) => output.sha256 === comparison.candidateRenderReceipt.candidateOutputSha256,
      );
      if (
        candidate === undefined ||
        comparison.candidateRenderReceipt.candidateOutputId !== candidate.outputId ||
        comparison.candidateRenderReceipt.candidateOutputRelativePath !== candidate.relativePath ||
        comparison.candidateRenderReceipt.candidateOutputNamespace !== candidate.namespace ||
        comparison.candidateRenderReceipt.candidateOutputMediaType !== candidate.mediaType ||
        comparison.candidateRenderReceipt.candidateOutputSizeBytes !== candidate.sizeBytes ||
        comparison.candidateRenderReceipt.candidateOutputWidth !== candidate.width ||
        comparison.candidateRenderReceipt.candidateOutputHeight !== candidate.height ||
        comparison.candidateRenderReceipt.candidateArtifactClass !== candidate.artifactClass ||
        comparison.candidateRenderReceipt.cameraId !== comparison.cameraId ||
        comparison.candidateRenderReceipt.cameraSha256 !== comparison.cameraSha256 ||
        comparison.candidateRenderReceipt.rendererProfileSha256 !== closure.renderDerivationReceipt.rendererProfileArtifact.sha256 ||
        !canonicalEqual(comparison.candidateRenderReceipt.rendererImplementationArtifact, closure.renderDerivationReceipt.rendererImplementationArtifact) ||
        !canonicalEqual(comparison.candidateRenderReceipt.rendererRuntimeArtifact, closure.renderDerivationReceipt.rendererRuntimeArtifact) ||
        Date.parse(comparison.candidateRenderReceipt.startedAt) < Date.parse(receipt.completedAt) ||
        Date.parse(comparison.candidateRenderReceipt.startedAt) < Date.parse(observation.createOnlyRunnerEvidence.completedAt) ||
        Date.parse(comparison.candidateRenderReceipt.completedAt) > Date.parse(observation.observedAt) ||
        comparison.candidateRenderReceipt.renderedEvidenceSha256 !== comparison.after.sha256 ||
        comparison.candidateRenderReceipt.renderedEvidenceNamespace !== comparison.after.namespace ||
        comparison.candidateRenderReceipt.renderedEvidenceRelativePath !== comparison.after.relativePath ||
        comparison.candidateRenderReceipt.renderedEvidenceSizeBytes !== comparison.after.sizeBytes ||
        comparison.candidateRenderReceipt.renderedEvidenceWidth !== comparison.after.width ||
        comparison.candidateRenderReceipt.renderedEvidenceHeight !== comparison.after.height
      ) {
        failures.push(`candidate render/generation closure ${comparison.cameraId}`);
      }
    }
    if (closure !== undefined && (
      observation.evaluationTools.protectedRegionMetrics.implementationSha256 !== closure.protectedRegionEvaluator.implementationArtifact.sha256 ||
      observation.evaluationTools.protectedRegionMetrics.configurationSha256 !== closure.protectedRegionEvaluator.configurationArtifact.sha256 ||
      observation.evaluationTools.protectedRegionMetrics.runtimeEnvironmentSha256 !== closure.protectedRegionEvaluator.runtimeEnvironmentArtifact.sha256 ||
      observation.evaluationTools.forbiddenSemanticDetector.implementationSha256 !== closure.forbiddenSemanticEvaluator.implementationArtifact.sha256 ||
      observation.evaluationTools.forbiddenSemanticDetector.configurationSha256 !== closure.forbiddenSemanticEvaluator.configurationArtifact.sha256 ||
      observation.evaluationTools.forbiddenSemanticDetector.runtimeEnvironmentSha256 !== closure.forbiddenSemanticEvaluator.runtimeEnvironmentArtifact.sha256
    )) {
      failures.push(`evaluator closure ${comparison.cameraId}`);
    }
    if (closure !== undefined) {
      const expectedProtectedBinding = {
        implementationSha256: closure.protectedRegionEvaluator.implementationArtifact.sha256,
        configurationSha256: closure.protectedRegionEvaluator.configurationArtifact.sha256,
        runtimeEnvironmentSha256: closure.protectedRegionEvaluator.runtimeEnvironmentArtifact.sha256,
        beforeSha256: comparison.before.sha256,
        afterSha256: comparison.after.sha256,
        protectedRegionMaskSha256: closure.protectedRegionMask.artifact.sha256,
        generatedRegionMaskSha256: closure.generatedRegionMask.artifact.sha256,
      };
      const expectedSemanticBinding = {
        ...expectedProtectedBinding,
        implementationSha256: closure.forbiddenSemanticEvaluator.implementationArtifact.sha256,
        configurationSha256: closure.forbiddenSemanticEvaluator.configurationArtifact.sha256,
        runtimeEnvironmentSha256: closure.forbiddenSemanticEvaluator.runtimeEnvironmentArtifact.sha256,
      };
      if (!canonicalEqual(comparison.metrics.protectedRegion.binding, expectedProtectedBinding)) {
        failures.push(`protected metric result closure ${comparison.cameraId}`);
      }
      if (!canonicalEqual(comparison.metrics.forbiddenSemanticEvaluation.binding, expectedSemanticBinding)) {
        failures.push(`semantic result closure ${comparison.cameraId}`);
      }
    }
  }
  return failures;
}

const AutomaticGatesV0Schema = z
  .object({
    executionReceiptBindingPassed: z.boolean(),
    createOnlyRunnerEvidencePassed: z.boolean(),
    fixedCameraIdentityPassed: z.boolean(),
    matchingDimensionsPassed: z.boolean(),
    exactInputSetPassed: z.boolean(),
    outputIsolationPassed: z.boolean(),
    protectedRegionFidelityPassed: z.boolean(),
    forbiddenSemanticDetectionsPassed: z.boolean(),
    allAutomaticGatesPassed: z.boolean(),
  })
  .strict();
type AutomaticGatesV0 = z.infer<typeof AutomaticGatesV0Schema>;

function fixedCameraIdentityPassed(
  experiment: FoundryRestorationExperimentV0,
  observation: FoundryRestorationEvidenceObservationV0,
): boolean {
  if (observation.cameraComparisons.length !== experiment.fixedCameras.length) return false;
  const subjects = ordinalSort(
    observation.cameraComparisons.map((item) => `${item.cameraId}:${item.cameraSha256}`),
  );
  const expected = ordinalSort(
    experiment.fixedCameras.map((item) => `${item.cameraId}:${item.cameraSha256}`),
  );
  return uniqueSorted(subjects) && canonicalEqual(subjects, expected);
}

function matchingDimensionsPassed(
  experiment: FoundryRestorationExperimentV0,
  observation: FoundryRestorationEvidenceObservationV0,
): boolean {
  return observation.cameraComparisons.every((comparison) => {
    const camera = experiment.fixedCameras.find((candidate) => candidate.cameraId === comparison.cameraId);
    return camera !== undefined &&
      comparison.before.width === camera.width && comparison.before.height === camera.height &&
      comparison.after.width === camera.width && comparison.after.height === camera.height;
  });
}

function exactInputSetPassed(
  experiment: FoundryRestorationExperimentV0,
  observation: FoundryRestorationEvidenceObservationV0,
): boolean {
  const expected = ordinalSort(experiment.inputs.map((input) => input.sha256));
  return observation.cameraComparisons.every((comparison) => {
    const actual = ordinalSort(comparison.subjectInputSha256s);
    return uniqueSorted(actual) && canonicalEqual(actual, expected);
  });
}

function outputIsolationPassed(
  experiment: FoundryRestorationExperimentV0,
  observation: FoundryRestorationEvidenceObservationV0,
): boolean {
  const base = experiment.outputPolicy.namespace;
  const candidates = observation.candidateOutputs.every((output) =>
    isSameOrChildNamespace(output.namespace, `${base}/outputs`) &&
    experiment.providerProfile.allowedCandidateMediaTypes.includes(output.mediaType) &&
    output.artifactClass === experiment.providerProfile.candidateArtifactClass,
  );
  const evidence = observation.cameraComparisons.every((comparison) =>
    isSameOrChildNamespace(comparison.before.namespace, `${base}/evidence/before`) &&
    isSameOrChildNamespace(comparison.after.namespace, `${base}/evidence/after`),
  );
  return candidates && evidence;
}

function protectedRegionFidelityPassed(
  experiment: FoundryRestorationExperimentV0,
  observation: FoundryRestorationEvidenceObservationV0,
): boolean {
  const limits = experiment.fidelityPolicy;
  return observation.cameraComparisons.every(({ metrics }) =>
    metrics.protectedRegion.protectedRegionSsim >= limits.minimumProtectedRegionSsim &&
    metrics.protectedRegion.protectedRegionLpips <= limits.maximumProtectedRegionLpips &&
    metrics.protectedRegion.protectedRegionMeanAbsoluteError <= limits.maximumProtectedRegionMeanAbsoluteError &&
    metrics.protectedRegion.maximumProtectedEdgeDisplacementPixels <= limits.maximumProtectedEdgeDisplacementPixels,
  );
}

function forbiddenSemanticDetectionsPassed(
  experiment: FoundryRestorationExperimentV0,
  observation: FoundryRestorationEvidenceObservationV0,
): boolean {
  const maximum = experiment.fidelityPolicy.maximumForbiddenSemanticDetections;
  return observation.cameraComparisons.every((comparison) => {
    const evaluation = comparison.metrics.forbiddenSemanticEvaluation;
    return evaluation.status === "evaluated" &&
      evaluation.uncertainty === "none" &&
      evaluation.detections !== null &&
      Object.values(evaluation.detections).every((count) => count <= maximum);
  });
}

function computeAutomaticGates(
  experiment: FoundryRestorationExperimentV0,
  observation: FoundryRestorationEvidenceObservationV0,
): AutomaticGatesV0 {
  const individual = {
    executionReceiptBindingPassed:
      executionReceiptBindingFailures(experiment, observation).length === 0,
    createOnlyRunnerEvidencePassed:
      executionReceiptBindingFailures(experiment, observation).every((failure) =>
        !failure.startsWith("create-only runner"),
      ),
    fixedCameraIdentityPassed: fixedCameraIdentityPassed(experiment, observation),
    matchingDimensionsPassed: matchingDimensionsPassed(experiment, observation),
    exactInputSetPassed: exactInputSetPassed(experiment, observation),
    outputIsolationPassed: outputIsolationPassed(experiment, observation),
    protectedRegionFidelityPassed: protectedRegionFidelityPassed(experiment, observation),
    forbiddenSemanticDetectionsPassed: forbiddenSemanticDetectionsPassed(experiment, observation),
  };
  return AutomaticGatesV0Schema.parse({
    ...individual,
    allAutomaticGatesPassed: Object.values(individual).every(Boolean),
  });
}

const EvidencePayloadV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_RESTORATION_EVIDENCE_V0),
    experiment: FoundryRestorationExperimentV0Schema,
    observedAt: FoundryUtcInstantSchema,
    executionReceipt: FoundryRestorationExecutionReceiptV0Schema,
    renderExecutionReceipts: z.array(FoundryRestorationRenderExecutionReceiptV0Schema).min(1).max(10_000),
    createOnlyRunnerEvidence: FoundryRestorationCreateOnlyRunReceiptV0Schema,
    evaluationTools: EvaluationToolsV0Schema,
    candidateOutputs: z.array(CandidateOutputV0Schema).min(1).max(10_000),
    cameraComparisons: z.array(CameraComparisonV0Schema).min(1).max(10_000),
    automaticGates: AutomaticGatesV0Schema,
    promotionState: z.literal("not_promoted"),
    sourceTruthReplacementAllowed: z.literal(false),
    authority: z.literal("none"),
  })
  .strict();

export const FoundryRestorationEvidenceV0Schema = EvidencePayloadV0Schema.extend({
  evidenceSha256: RuntimeSha256Schema,
})
  .strict()
  .superRefine((evidence, ctx) => {
    const { evidenceSha256: _evidenceSha256, ...payload } = evidence;
    const parsedObservation = FoundryRestorationEvidenceObservationV0Schema.safeParse({
      observedAt: evidence.observedAt,
      executionReceipt: evidence.executionReceipt,
      renderExecutionReceipts: evidence.renderExecutionReceipts,
      createOnlyRunnerEvidence: evidence.createOnlyRunnerEvidence,
      evaluationTools: evidence.evaluationTools,
      candidateOutputs: evidence.candidateOutputs,
      cameraComparisons: evidence.cameraComparisons,
    });
    if (!parsedObservation.success) {
      addIssue(ctx, [], "embedded restoration observation must satisfy its strict schema");
      return;
    }
    const observation = parsedObservation.data;
    const expectedGates = computeAutomaticGates(evidence.experiment, observation);
    if (!canonicalEqual(evidence.automaticGates, expectedGates)) {
      addIssue(ctx, ["automaticGates"], "automatic fidelity gates must be derived from hash-bound evidence");
    }
    if (Date.parse(evidence.observedAt) < Date.parse(evidence.experiment.createdAt)) {
      addIssue(ctx, ["observedAt"], "restoration evidence cannot predate its experiment");
    }
    const receiptFailures = executionReceiptBindingFailures(evidence.experiment, observation);
    if (receiptFailures.length > 0) {
      addIssue(
        ctx,
        ["executionReceipt"],
        `execution receipt disagrees with the planned execution lock: ${receiptFailures.join(", ")}`,
      );
    }
    if (evidence.evidenceSha256 !== digest(EVIDENCE_DIGEST_DOMAIN, EvidencePayloadV0Schema.parse(payload))) {
      addIssue(ctx, ["evidenceSha256"], "restoration evidence digest must match its exact payload");
    }
  });
export type FoundryRestorationEvidenceV0 = z.infer<
  typeof FoundryRestorationEvidenceV0Schema
>;

export function evaluateFoundryRestorationEvidenceV0(input: {
  readonly experiment: FoundryRestorationExperimentV0;
  readonly observation: FoundryRestorationEvidenceObservationV0;
}): FoundryRestorationEvidenceV0 {
  const experiment = FoundryRestorationExperimentV0Schema.parse(input.experiment);
  const observation = FoundryRestorationEvidenceObservationV0Schema.parse(input.observation);
  const receiptFailures = executionReceiptBindingFailures(experiment, observation);
  if (receiptFailures.length > 0) {
    throw new FoundryIntegrityError(
      "RESTORATION_EXECUTION_RECEIPT_MISMATCH",
      `Execution receipt disagrees with the planned execution lock: ${receiptFailures.join(", ")}.`,
    );
  }
  const payload = EvidencePayloadV0Schema.parse({
    schemaVersion: FOUNDRY_RESTORATION_EVIDENCE_V0,
    experiment,
    ...observation,
    automaticGates: computeAutomaticGates(experiment, observation),
    promotionState: "not_promoted",
    sourceTruthReplacementAllowed: false,
    authority: "none",
  });
  return FoundryRestorationEvidenceV0Schema.parse({
    ...payload,
    evidenceSha256: digest(EVIDENCE_DIGEST_DOMAIN, payload),
  });
}

const ArchitecturalChecklistV0Schema = z
  .object({
    reviewedBy: RuntimeManifestKeySchema,
    reviewedAt: FoundryUtcInstantSchema,
    checklistArtifact: DigestAddressedJsonArtifactV0Schema,
    confirmedAbsent: z
      .object({
        inventedWindows: z.literal(true),
        inventedDoorways: z.literal(true),
        darkCentralFloor: z.literal(true),
        neighbouringRooms: z.literal(true),
        facade: z.literal(true),
        generatedFillOutsideMask: z.literal(true),
      })
      .strict(),
  })
  .strict();

const PromotionPayloadV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_RESTORATION_PROMOTION_V0),
    experimentSha256: RuntimeSha256Schema,
    evidenceSha256: RuntimeSha256Schema,
    lane: FoundryRestorationLaneSchema,
    promotedBy: RuntimeManifestKeySchema,
    promotedAt: FoundryUtcInstantSchema,
    statement: z.literal(FOUNDRY_RESTORATION_PROMOTION_STATEMENT),
    candidateOutputSha256s: z.array(RuntimeSha256Schema).min(1).max(10_000),
    architecturalChecklist: ArchitecturalChecklistV0Schema,
    promotionScope: z.literal("generated_cinematic_derivative_only"),
    sourceTruthReplacementAllowed: z.literal(false),
    measuredGeometryAuthorityGranted: z.literal(false),
    planningAuthorityGranted: z.literal(false),
    operationalExportAuthorityGranted: z.literal(false),
    authority: z.literal("human_promotion_record_only"),
  })
  .strict();

export const FoundryRestorationPromotionV0Schema = PromotionPayloadV0Schema.extend({
  promotionSha256: RuntimeSha256Schema,
})
  .strict()
  .superRefine((promotion, ctx) => {
    const { promotionSha256: _promotionSha256, ...payload } = promotion;
    if (!uniqueSorted(promotion.candidateOutputSha256s)) {
      addIssue(ctx, ["candidateOutputSha256s"], "promoted candidate digests must be unique and sorted");
    }
    if (promotion.promotionSha256 !== digest(PROMOTION_DIGEST_DOMAIN, PromotionPayloadV0Schema.parse(payload))) {
      addIssue(ctx, ["promotionSha256"], "promotion digest must match its exact payload");
    }
  });
export type FoundryRestorationPromotionV0 = z.infer<
  typeof FoundryRestorationPromotionV0Schema
>;

export function promoteFoundryRestorationCinematicDerivativeV0(input: {
  readonly evidence: FoundryRestorationEvidenceV0;
  readonly promotedBy: string;
  readonly promotedAt: string;
  readonly statement: string;
  readonly candidateOutputSha256s: readonly string[];
  readonly architecturalChecklist: z.infer<typeof ArchitecturalChecklistV0Schema>;
}): FoundryRestorationPromotionV0 {
  const evidence = FoundryRestorationEvidenceV0Schema.parse(input.evidence);
  if (!evidence.automaticGates.allAutomaticGatesPassed) {
    throw new FoundryIntegrityError(
      "RESTORATION_FIDELITY_GATES_FAILED",
      "A cinematic derivative cannot be promoted until all automatic fidelity gates pass.",
    );
  }
  const available = new Set(evidence.candidateOutputs.map((output) => output.sha256));
  const selected = ordinalSort(input.candidateOutputSha256s);
  if (selected.some((candidate) => !available.has(candidate))) {
    throw new FoundryIntegrityError(
      "RESTORATION_PROMOTION_OUTPUT_MISMATCH",
      "Promotion can select only candidate outputs bound by the evidence record.",
    );
  }
  if (Date.parse(input.promotedAt) < Date.parse(evidence.observedAt)) {
    throw new FoundryIntegrityError(
      "RESTORATION_PROMOTION_PREDATES_EVIDENCE",
      "A human promotion record cannot predate the reviewed evidence.",
    );
  }
  const checklist = ArchitecturalChecklistV0Schema.parse(input.architecturalChecklist);
  if (
    checklist.reviewedBy !== input.promotedBy ||
    Date.parse(checklist.reviewedAt) < Date.parse(evidence.observedAt) ||
    Date.parse(checklist.reviewedAt) > Date.parse(input.promotedAt)
  ) {
    throw new FoundryIntegrityError(
      "RESTORATION_ARCHITECTURAL_CHECKLIST_MISMATCH",
      "Promotion requires a matching human architectural checklist reviewed after evidence and before promotion.",
    );
  }
  const payload = PromotionPayloadV0Schema.parse({
    schemaVersion: FOUNDRY_RESTORATION_PROMOTION_V0,
    experimentSha256: evidence.experiment.experimentSha256,
    evidenceSha256: evidence.evidenceSha256,
    lane: evidence.experiment.lane,
    promotedBy: input.promotedBy,
    promotedAt: input.promotedAt,
    statement: input.statement,
    candidateOutputSha256s: selected,
    architecturalChecklist: checklist,
    promotionScope: "generated_cinematic_derivative_only",
    sourceTruthReplacementAllowed: false,
    measuredGeometryAuthorityGranted: false,
    planningAuthorityGranted: false,
    operationalExportAuthorityGranted: false,
    authority: "human_promotion_record_only",
  });
  return FoundryRestorationPromotionV0Schema.parse({
    ...payload,
    promotionSha256: digest(PROMOTION_DIGEST_DOMAIN, payload),
  });
}
