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
export const FOUNDRY_RESTORATION_EXPERIMENT_V0 =
  "omnitwin.foundry.restoration-experiment.v0";
export const FOUNDRY_RESTORATION_EVIDENCE_V0 =
  "omnitwin.foundry.restoration-evidence.v0";
export const FOUNDRY_RESTORATION_PROMOTION_V0 =
  "omnitwin.foundry.restoration-promotion.v0";

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

const FoundryRestorationLicenseEvidenceV0Schema = z
  .object({
    declaredLicense: z.string().trim().min(1).max(240),
    documentSha256: RuntimeSha256Schema,
    reviewedBy: RuntimeManifestKeySchema,
    reviewedAt: FoundryUtcInstantSchema,
    internalResearchAndDevelopmentOnly: z.literal(true),
    commercialUseAllowed: z.literal(false),
    redistributionAllowed: z.literal(false),
  })
  .strict();

const FoundryRestorationRepositoryRequirementV0Schema = z
  .object({
    role: RuntimeManifestKeySchema,
    repositoryId: z.string().regex(UPSTREAM_ID).nullable(),
    revision: GitRevisionSchema.nullable(),
    licensePosture: z.string().trim().min(1).max(240),
  })
  .strict();

const FoundryRestorationModelRequirementV0Schema = z
  .object({
    role: RuntimeManifestKeySchema,
    modelId: z.string().regex(UPSTREAM_ID).nullable(),
    revision: GitRevisionSchema.nullable(),
    access: z.enum(["public", "gated"]),
    licensePosture: z.string().trim().min(1).max(240),
  })
  .strict();

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
    requiredInputRoles: z.array(RuntimeManifestKeySchema).min(1).max(32),
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
    profile.requiredInputRoles,
    profile.allowedCandidateMediaTypes,
  ];
  if (roleLists.some((values) => !uniqueSorted(values))) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "provider requirement and capability lists must be unique and sorted",
    });
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

const PROFILE_BY_LANE: Readonly<Record<FoundryRestorationLane, FoundryRestorationProviderProfileV0>> = {
  difix3d_plus: createProviderProfile({
    schemaVersion: FOUNDRY_RESTORATION_PROVIDER_PROFILE_V0,
    lane: "difix3d_plus",
    displayName: "Difix3D+ diagnostic image-repair lane",
    readiness: {
      status: "diagnostic_go",
      scope: "single_frame_2d_internal_r_and_d",
      publicCapability: "single_frame_image_repair",
      minimumGpuVramGiB: null,
      blockers: ["checkpoint_revision_and_digest_not_proven", "noncommercial_weights"],
    },
    repositoryRequirements: [{
      role: "difix3d_source",
      repositoryId: "nv-tlabs/Difix3D",
      revision: "c76edc595586e16732c91ddee82f3a6d83a8a9cc",
      licensePosture: "source_licence_review_required",
    }],
    modelRequirements: [
      {
        role: "difix_checkpoint",
        modelId: "nvidia/difix",
        revision: null,
        access: "gated",
        licensePosture: "noncommercial_weights_internal_r_and_d_only",
      },
      {
        role: "difix_ref_checkpoint",
        modelId: "nvidia/difix_ref",
        revision: null,
        access: "gated",
        licensePosture: "noncommercial_weights_internal_r_and_d_only",
      },
    ],
    requiredInputRoles: ["captured_reference_image", "source_fixed_camera_render"],
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
        "model_revision_and_digest_not_proven",
        "three_d_grut_environment_not_proven",
      ],
    },
    repositoryRequirements: [{
      role: "artifixer_source",
      repositoryId: "nv-tlabs/ArtiFixer",
      revision: null,
      licensePosture: "official_revision_and_source_licence_review_required",
    }],
    modelRequirements: [{
      role: "artifixer_checkpoint",
      modelId: "nvidia/ArtiFixer",
      revision: null,
      access: "gated",
      licensePosture: "official_weight_terms_review_required",
    }],
    requiredInputRoles: ["colmap_scene", "source_reconstruction", "source_training_images"],
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
      licensePosture: "official_identity_revision_and_licence_review_required",
    }],
    modelRequirements: [{
      role: "gsfixer_full_checkpoint",
      modelId: "goldoak1421/gsfixer-full",
      revision: null,
      access: "public",
      licensePosture: "noncommercial_dependency_internal_r_and_d_only",
    }],
    requiredInputRoles: ["standard_3dgs_checkpoint", "training_camera_set", "training_images"],
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
        "gated_hugging_face_token_not_proven",
        "model_revision_and_digest_not_proven",
        "public_3d_distillation_unreleased",
      ],
    },
    repositoryRequirements: [{
      role: "gr3en_source",
      repositoryId: "nv-tlabs/GR3EN",
      revision: null,
      licensePosture: "official_revision_and_source_licence_review_required",
    }],
    modelRequirements: [{
      role: "gr3en_checkpoint",
      modelId: "nvidia/GR3EN",
      revision: null,
      access: "gated",
      licensePosture: "gated_weight_terms_review_required",
    }],
    requiredInputRoles: ["source_camera_trajectory", "source_reconstruction"],
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
    exactOfficialIdentityReviewed: z.literal(true),
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

const FoundryRestorationInputCandidateV0Schema = z
  .object({
    role: RuntimeManifestKeySchema,
    artifactId: RuntimeManifestKeySchema,
    namespace: SafeNamespaceSchema,
    relativePath: SafeRelativePathSchema,
    mediaType: MediaTypeSchema,
    sizeBytes: z.number().int().positive().max(MAX_ARTIFACT_BYTES),
    sha256: RuntimeSha256Schema,
    immutable: z.boolean(),
    accessMode: z.literal("read_only"),
    truthClass: z.literal("captured_source_truth"),
  })
  .strict();

const FoundryRestorationImmutableInputV0Schema =
  FoundryRestorationInputCandidateV0Schema.extend({
    immutable: z.literal(true),
  }).strict();

const DigestAddressedJsonArtifactV0Schema = z
  .object({
    artifactId: RuntimeManifestKeySchema,
    relativePath: SafeRelativePathSchema,
    mediaType: z.literal("application/json"),
    sizeBytes: z.number().int().positive().max(MAX_ARTIFACT_BYTES),
    sha256: RuntimeSha256Schema,
    immutable: z.literal(true),
    accessMode: z.literal("read_only"),
    authority: z.literal("none"),
  })
  .strict();

const FoundryRestorationPlannedExecutionInputV0Schema = z
  .object({
    providerAdapterId: RuntimeManifestKeySchema,
    providerAdapterImplementationSha256: RuntimeSha256Schema,
    parameterConfigurationArtifact: DigestAddressedJsonArtifactV0Schema,
    runtimeEnvironmentArtifact: DigestAddressedJsonArtifactV0Schema,
  })
  .strict();

const PlannedExecutionLockPayloadV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_RESTORATION_PLANNED_EXECUTION_LOCK_V0),
    lane: FoundryRestorationLaneSchema,
    providerProfileSha256: RuntimeSha256Schema,
    providerLockSha256: RuntimeSha256Schema,
    providerAdapterId: RuntimeManifestKeySchema,
    providerAdapterImplementationSha256: RuntimeSha256Schema,
    parameterConfigurationArtifact: DigestAddressedJsonArtifactV0Schema,
    runtimeEnvironmentArtifact: DigestAddressedJsonArtifactV0Schema,
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
    createOnly: z.literal(true),
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

function validateProviderLock(
  lock: z.infer<typeof FoundryRestorationProviderLockV0Schema>,
  profile: FoundryRestorationProviderProfileV0,
  ctx: z.RefinementCtx,
): void {
  if (lock.lane !== profile.lane) addIssue(ctx, ["providerLock", "lane"], "provider lock lane must match profile");
  if (!exactRoleSet(lock.repositories.map((item) => item.role), profile.repositoryRequirements.map((item) => item.role))) {
    addIssue(ctx, ["providerLock", "repositories"], "repository locks must exactly cover required roles");
  }
  if (!exactRoleSet(lock.models.map((item) => item.role), profile.modelRequirements.map((item) => item.role))) {
    addIssue(ctx, ["providerLock", "models"], "model locks must exactly cover required roles");
  }
  if (!uniqueSorted(lock.repositories.map((item) => item.role))) {
    addIssue(ctx, ["providerLock", "repositories"], "repository locks must be unique and sorted by role");
  }
  if (!uniqueSorted(lock.models.map((item) => item.role))) {
    addIssue(ctx, ["providerLock", "models"], "model locks must be unique and sorted by role");
  }
  validateRepositoryPins(lock, profile, ctx);
  validateModelPins(lock, profile, ctx);
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
    if (candidate.licenseEvidence.declaredLicense !== requirement.licensePosture) {
      addIssue(ctx, ["providerLock", "repositories"], `repository licence evidence for ${requirement.role} must match the reviewed posture`);
    }
    if (Date.parse(candidate.licenseEvidence.reviewedAt) > Date.parse(lock.reviewedAt)) {
      addIssue(ctx, ["providerLock", "repositories"], `repository licence review for ${requirement.role} cannot postdate the lock review`);
    }
  }
}

function validateModelPins(
  lock: z.infer<typeof FoundryRestorationProviderLockV0Schema>,
  profile: FoundryRestorationProviderProfileV0,
  ctx: z.RefinementCtx,
): void {
  for (const requirement of profile.modelRequirements) {
    const candidate = lock.models.find((entry) => entry.role === requirement.role);
    if (candidate === undefined) continue;
    if (requirement.modelId !== null && candidate.modelId !== requirement.modelId) {
      addIssue(ctx, ["providerLock", "models"], `model identity for ${requirement.role} disagrees with the audited pin`);
    }
    if (requirement.revision !== null && candidate.revision !== requirement.revision) {
      addIssue(ctx, ["providerLock", "models"], `model revision for ${requirement.role} disagrees with the audited pin`);
    }
    if (candidate.access !== requirement.access || candidate.licenseEvidence.declaredLicense !== requirement.licensePosture) {
      addIssue(ctx, ["providerLock", "models"], `model access or licence evidence for ${requirement.role} disagrees with the reviewed posture`);
    }
    if (Date.parse(candidate.licenseEvidence.reviewedAt) > Date.parse(lock.reviewedAt)) {
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
  validateProviderLock(experiment.providerLock, experiment.providerProfile, ctx);
  if (
    experiment.plannedExecutionLock.lane !== experiment.lane ||
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
  if (!exactRoleSet(experiment.inputs.map((input) => input.role), experiment.providerProfile.requiredInputRoles)) {
    addIssue(ctx, ["inputs"], "immutable inputs must exactly cover the provider's required roles");
  }
  const outputNamespace = `experiments/restoration/${experiment.experimentId}/${experiment.lane}`;
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
  providerProfileSha256: string,
  providerLockSha256: string,
): FoundryRestorationPlannedExecutionLockV0 {
  const planned = FoundryRestorationPlannedExecutionInputV0Schema.parse(input);
  const payload = PlannedExecutionLockPayloadV0Schema.parse({
    schemaVersion: FOUNDRY_RESTORATION_PLANNED_EXECUTION_LOCK_V0,
    lane,
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
  const outputNamespace = `experiments/restoration/${parsed.experimentId}/${parsed.lane}`;
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
    profile.profileSha256,
    providerLock.providerLockSha256,
  );
  const payload = ExperimentPayloadV0Schema.parse({
    schemaVersion: FOUNDRY_RESTORATION_EXPERIMENT_V0,
    experimentId: parsed.experimentId,
    projectId: parsed.projectId,
    createdAt: parsed.createdAt,
    lane: parsed.lane,
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
      createOnly: true,
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

const CandidateOutputV0Schema = z
  .object({
    outputId: RuntimeManifestKeySchema,
    namespace: SafeNamespaceSchema,
    relativePath: SafeRelativePathSchema,
    mediaType: MediaTypeSchema,
    sizeBytes: z.number().int().positive().max(MAX_ARTIFACT_BYTES),
    sha256: RuntimeSha256Schema,
    truthClass: z.literal("generated_cinematic"),
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
    candidateOutputSha256s: z.array(RuntimeSha256Schema).min(1).max(10_000),
    providerProcessReceiptArtifactSha256: RuntimeSha256Schema,
    outcome: z.literal("succeeded"),
    exitCode: z.literal(0),
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
  "schemaVersion" | "outcome" | "exitCode" | "authority" | "sourceTruthReplacementAllowed"
>;

export function createFoundryRestorationExecutionReceiptV0(
  input: CreateFoundryRestorationExecutionReceiptV0Input,
): FoundryRestorationExecutionReceiptV0 {
  const payload = ExecutionReceiptPayloadV0Schema.parse({
    schemaVersion: FOUNDRY_RESTORATION_EXECUTION_RECEIPT_V0,
    ...input,
    subjectInputSha256s: ordinalSort(input.subjectInputSha256s),
    candidateOutputSha256s: ordinalSort(input.candidateOutputSha256s),
    outcome: "succeeded",
    exitCode: 0,
    authority: "none",
    sourceTruthReplacementAllowed: false,
  });
  return FoundryRestorationExecutionReceiptV0Schema.parse({
    ...payload,
    executionReceiptSha256: digest(EXECUTION_RECEIPT_DIGEST_DOMAIN, payload),
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
    after: RenderArtifactV0Schema,
    metrics: z
      .object({
        protectedRegionSsim: z.number().min(0).max(1),
        protectedRegionLpips: z.number().min(0).max(1),
        protectedRegionMeanAbsoluteError: z.number().min(0).max(1),
        maximumProtectedEdgeDisplacementPixels: z.number().nonnegative().max(1_000_000),
        forbiddenSemanticDetections: ForbiddenSemanticDetectionsV0Schema,
      })
      .strict(),
  })
  .strict();

function validateObservationCollections(
  observation: {
    readonly candidateOutputs: readonly z.infer<typeof CandidateOutputV0Schema>[];
    readonly cameraComparisons: readonly z.infer<typeof CameraComparisonV0Schema>[];
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
}

export const FoundryRestorationEvidenceObservationV0Schema = z
  .object({
    observedAt: FoundryUtcInstantSchema,
    executionReceipt: FoundryRestorationExecutionReceiptV0Schema,
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
  if (receipt.experimentSha256 !== experiment.experimentSha256) failures.push("experiment digest");
  if (receipt.plannedExecutionLockSha256 !== lock.plannedExecutionLockSha256) failures.push("planned lock digest");
  if (receipt.providerAdapterId !== lock.providerAdapterId) failures.push("provider adapter identity");
  if (receipt.providerAdapterImplementationSha256 !== lock.providerAdapterImplementationSha256) {
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
  return failures;
}

const AutomaticGatesV0Schema = z
  .object({
    executionReceiptBindingPassed: z.boolean(),
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
    experiment.providerProfile.allowedCandidateMediaTypes.includes(output.mediaType),
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
    metrics.protectedRegionSsim >= limits.minimumProtectedRegionSsim &&
    metrics.protectedRegionLpips <= limits.maximumProtectedRegionLpips &&
    metrics.protectedRegionMeanAbsoluteError <= limits.maximumProtectedRegionMeanAbsoluteError &&
    metrics.maximumProtectedEdgeDisplacementPixels <= limits.maximumProtectedEdgeDisplacementPixels,
  );
}

function forbiddenSemanticDetectionsPassed(
  experiment: FoundryRestorationExperimentV0,
  observation: FoundryRestorationEvidenceObservationV0,
): boolean {
  const maximum = experiment.fidelityPolicy.maximumForbiddenSemanticDetections;
  return observation.cameraComparisons.every((comparison) =>
    Object.values(comparison.metrics.forbiddenSemanticDetections).every((count) => count <= maximum),
  );
}

function computeAutomaticGates(
  experiment: FoundryRestorationExperimentV0,
  observation: FoundryRestorationEvidenceObservationV0,
): AutomaticGatesV0 {
  const individual = {
    executionReceiptBindingPassed:
      executionReceiptBindingFailures(experiment, observation).length === 0,
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
  const payload = PromotionPayloadV0Schema.parse({
    schemaVersion: FOUNDRY_RESTORATION_PROMOTION_V0,
    experimentSha256: evidence.experiment.experimentSha256,
    evidenceSha256: evidence.evidenceSha256,
    lane: evidence.experiment.lane,
    promotedBy: input.promotedBy,
    promotedAt: input.promotedAt,
    statement: input.statement,
    candidateOutputSha256s: selected,
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
