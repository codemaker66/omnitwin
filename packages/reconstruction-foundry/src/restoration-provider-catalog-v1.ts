import { RuntimeSha256Schema } from "@omnitwin/types";
import { z } from "zod";
import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "./canonical-json.js";
import { FoundryIntegrityError } from "./errors.js";

export const FOUNDRY_RESTORATION_PROVIDER_CATALOG_V1 =
  "omnitwin.foundry.restoration-provider-catalog.v1";
export const FOUNDRY_RESTORATION_PROVIDER_PROFILE_V1 =
  "omnitwin.foundry.restoration-provider-profile.v1";

export const FOUNDRY_RESTORATION_PROVIDER_LANES_V1 = [
  "artifixer3d_plus",
  "difix3d_plus",
  "gr3en",
  "gsfix3d",
] as const;
export const FoundryRestorationProviderLaneV1Schema = z.enum(
  FOUNDRY_RESTORATION_PROVIDER_LANES_V1,
);
export type FoundryRestorationProviderLaneV1 = z.infer<
  typeof FoundryRestorationProviderLaneV1Schema
>;

export const FOUNDRY_RESTORATION_PROVIDER_VARIANTS_V1 = [
  "artifixer_14b",
  "artifixer_1_3b",
  "difix",
  "difix_ref",
  "gr3en_video",
  "gsfix3d_lift",
  "gsfixer_base",
  "gsfixer_full",
] as const;
export const FoundryRestorationProviderVariantV1Schema = z.enum(
  FOUNDRY_RESTORATION_PROVIDER_VARIANTS_V1,
);
export type FoundryRestorationProviderVariantV1 = z.infer<
  typeof FoundryRestorationProviderVariantV1Schema
>;

const VARIANTS_BY_LANE: Readonly<
  Record<FoundryRestorationProviderLaneV1, readonly FoundryRestorationProviderVariantV1[]>
> = {
  artifixer3d_plus: ["artifixer_14b", "artifixer_1_3b"],
  difix3d_plus: ["difix", "difix_ref"],
  gr3en: ["gr3en_video"],
  gsfix3d: ["gsfix3d_lift", "gsfixer_base", "gsfixer_full"],
};

export const FOUNDRY_RESTORATION_PROVIDER_PROFILE_V1_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_RESTORATION_PROVIDER_PROFILE_V1";
export const FOUNDRY_RESTORATION_PROVIDER_CATALOG_V1_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_RESTORATION_PROVIDER_CATALOG_V1";
const GitRevisionSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const UpstreamIdSchema = z.string().regex(
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u,
);
const RoleSchema = z.string().regex(/^[a-z][a-z0-9_]{0,79}$/u);
const SafeRelativePathSchema = z
  .string()
  .regex(/^(?!\/)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/u)
  .refine(
    (value) => value.split("/").every((segment) => segment !== "." && segment !== ".."),
    "relative path cannot contain dot segments",
  );
const MediaTypeSchema = z.string().regex(
  /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u,
);

function digest(domain: string, value: unknown): string {
  return `sha256:${domainSeparatedSha256(domain, toCanonicalJson(value))}`;
}

function uniqueSorted(values: readonly string[]): boolean {
  return values.every((value, index) => {
    const previous = values[index - 1];
    return index === 0 || (previous !== undefined && previous < value);
  });
}

function sameMembers(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const member of Object.values(value as Record<string, unknown>)) {
      deepFreeze(member);
    }
    Object.freeze(value);
  }
  return value;
}

const FoundryRestorationWeightPinV1Schema = z
  .object({
    relativePath: SafeRelativePathSchema,
    sizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    sha256: RuntimeSha256Schema,
  })
  .strict();

const FoundryRestorationRepositoryPinV1Schema = z
  .object({
    role: RoleSchema,
    repositoryId: UpstreamIdSchema,
    revision: GitRevisionSchema,
  })
  .strict();

const FoundryRestorationModelPinV1Schema = z
  .object({
    role: RoleSchema,
    modelId: UpstreamIdSchema,
    revision: GitRevisionSchema.nullable(),
    identityStatus: z.enum(["pinned", "unresolved_upstream_revision"]),
    access: z.enum(["public", "gated"]),
    snapshotSizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
    variants: z.array(FoundryRestorationProviderVariantV1Schema).min(1).max(8),
    requiredWeights: z.array(FoundryRestorationWeightPinV1Schema).max(32),
  })
  .strict();

const FoundryRestorationInputContractV1Schema = z
  .object({
    role: RoleSchema,
    truthLayer: z.enum([
      "CAPTURED_TRUTH",
      "STRUCTURAL_TRUTH",
      "SOURCE_DERIVED_TRUTH",
      "GENERATED_CINEMATIC",
      "OPERATOR_CONTROL",
    ]),
    artifactClass: RoleSchema,
    mediaType: MediaTypeSchema,
    requiresImageDimensions: z.boolean(),
    variants: z.array(FoundryRestorationProviderVariantV1Schema).min(1).max(8),
  })
  .strict();

const FoundryRestorationReadinessV1Schema = z
  .object({
    status: z.literal("wait"),
    scope: z.enum(["single_frame_2d_internal_r_and_d", "scene_level_internal_r_and_d"]),
    publicCapability: z.enum([
      "single_frame_image_repair",
      "scene_finetuned_image_repair",
      "scene_repair_and_distillation",
      "inference_video_only",
    ]),
    minimumGpuVramGiB: z.number().int().positive().max(1_024).nullable(),
    blockers: z.array(RoleSchema).min(1).max(64),
  })
  .strict();

const FoundryRestorationComparisonModeV1Schema = z.enum([
  "direct_candidate_image",
  "render_candidate_reconstruction",
  "aligned_relighting_video",
]);

const FoundryRestorationSequenceAlignmentV1Schema = z
  .object({
    framesInputRole: RoleSchema,
    masksInputRole: RoleSchema,
    exactItemCount: z.literal(81),
    itemMediaType: z.literal("image/png"),
    correspondence: z.literal("basename_and_index"),
    sharedDimensionsAndOrderRequired: z.literal(true),
    candidateDecodedFrameCountAndOrderMustMatch: z.literal(true),
  })
  .strict();

const FoundryRestorationProviderConfigurationBindingV1Schema = z
  .object({
    canonicalInputRole: RoleSchema,
    compiledMediaType: z.literal("application/yaml"),
    candidateMustBindCanonicalAndCompiledBytes: z.literal(true),
  })
  .strict();

export const FoundryRestorationExecutionContractV1Schema = z
  .object({
    variant: FoundryRestorationProviderVariantV1Schema,
    readiness: FoundryRestorationReadinessV1Schema,
    candidateArtifactClass: z.enum([
      "restoration_candidate",
      "reconstruction_candidate",
      "relighting_candidate",
    ]),
    allowedCandidateMediaTypes: z.array(MediaTypeSchema).min(1).max(8),
    comparisonMode: FoundryRestorationComparisonModeV1Schema,
    comparisonSourceInputRole: RoleSchema,
    candidateBindingInputRoles: z.array(RoleSchema).min(1).max(32),
    candidateEvidenceBinding: z.enum([
      "exact_candidate_bytes",
      "candidate_checkpoint_and_derived_render_bytes",
    ]),
    sequenceAlignment: FoundryRestorationSequenceAlignmentV1Schema.nullable(),
    providerConfigurationBinding:
      FoundryRestorationProviderConfigurationBindingV1Schema.nullable(),
  })
  .strict();
export type FoundryRestorationExecutionContractV1 = z.infer<
  typeof FoundryRestorationExecutionContractV1Schema
>;

const FoundryRestorationProviderProfilePayloadObjectV1Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_RESTORATION_PROVIDER_PROFILE_V1),
    lane: FoundryRestorationProviderLaneV1Schema,
    displayName: z.string().trim().min(1).max(160),
    requiredUsePosture: z.literal("private_internal_r_and_d_only"),
    repositories: z.array(FoundryRestorationRepositoryPinV1Schema).min(1).max(16),
    models: z.array(FoundryRestorationModelPinV1Schema).max(16),
    inputs: z.array(FoundryRestorationInputContractV1Schema).min(1).max(32),
    executionContracts: z.array(FoundryRestorationExecutionContractV1Schema).min(1).max(8),
    executionPolicy: z
      .object({
        dispatchAuthorized: z.literal(false),
        commercialUseAllowed: z.literal(false),
        publicDistributionAllowed: z.literal(false),
        sourceTruthReplacementAllowed: z.literal(false),
        generatedOutputRequiresHumanArchitectureReview: z.literal(true),
      })
      .strict(),
  })
  .strict();

export type FoundryRestorationProviderProfilePayloadV1 = z.infer<
  typeof FoundryRestorationProviderProfilePayloadObjectV1Schema
>;

function validateProfile(
  profile: FoundryRestorationProviderProfilePayloadV1,
  ctx: z.RefinementCtx,
): void {
  const variants = VARIANTS_BY_LANE[profile.lane];
  const actualVariants = profile.executionContracts.map((contract) => contract.variant);
  if (!sameMembers(actualVariants, variants)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["executionContracts"],
      message: `${profile.lane} must contain exactly its versioned execution variants`,
    });
  }
  for (const [path, roles] of [
    ["repositories", profile.repositories.map((entry) => entry.role)],
    ["models", profile.models.map((entry) => entry.role)],
    ["inputs", profile.inputs.map((entry) => entry.role)],
  ] as const) {
    if (!uniqueSorted(roles)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [path],
        message: `${path} must be unique and ordinal-sorted by role`,
      });
    }
  }
  for (const model of profile.models) {
    if (
      !uniqueSorted(model.variants) ||
      model.variants.some((variant) => !variants.includes(variant)) ||
      (model.identityStatus === "pinned") !== (model.revision !== null) ||
      !uniqueSorted(model.requiredWeights.map((weight) => weight.relativePath))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["models"],
        message: `model contract ${model.role} has an invalid identity, variant, or weight closure`,
      });
    }
  }
  for (const input of profile.inputs) {
    if (!uniqueSorted(input.variants) || input.variants.some((variant) => !variants.includes(variant))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["inputs"],
        message: `input contract ${input.role} has an invalid variant set`,
      });
    }
  }
  for (const contract of profile.executionContracts) {
    const expectedBindingInputRoles = profile.inputs
      .filter((input) => input.variants.includes(contract.variant))
      .map((input) => input.role);
    if (
      !uniqueSorted(contract.readiness.blockers) ||
      !uniqueSorted(contract.allowedCandidateMediaTypes) ||
      !uniqueSorted(contract.candidateBindingInputRoles) ||
      !sameMembers(contract.candidateBindingInputRoles, expectedBindingInputRoles)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["executionContracts"],
        message: `execution contract ${contract.variant} must bind every applicable input exactly once in ordinal order`,
      });
    }
    const sourceInput = profile.inputs.find(
      (input) =>
        input.role === contract.comparisonSourceInputRole &&
        input.variants.includes(contract.variant),
    );
    if (
      contract.comparisonMode === "direct_candidate_image" &&
      (sourceInput?.mediaType !== "image/png" ||
        !sourceInput.requiresImageDimensions ||
        contract.candidateArtifactClass !== "restoration_candidate" ||
        !sameMembers(contract.allowedCandidateMediaTypes, ["image/png"]) ||
        contract.candidateEvidenceBinding !== "exact_candidate_bytes" ||
        contract.sequenceAlignment !== null ||
        contract.providerConfigurationBinding !== null)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["executionContracts"],
        message: `direct image contract ${contract.variant} must bind its exact source image and candidate bytes`,
      });
    }
    if (
      contract.comparisonMode === "render_candidate_reconstruction" &&
      (sourceInput?.artifactClass !== "source_derived_reconstruction" ||
        contract.candidateArtifactClass !== "reconstruction_candidate" ||
        contract.candidateEvidenceBinding !==
          "candidate_checkpoint_and_derived_render_bytes" ||
        contract.sequenceAlignment !== null ||
        contract.providerConfigurationBinding !== null)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["executionContracts"],
        message: `reconstruction contract ${contract.variant} must compare a derived candidate render`,
      });
    }
    if (
      contract.comparisonMode === "aligned_relighting_video" &&
      (sourceInput?.mediaType !==
        "application/vnd.venviewer.content-addressed-png-sequence+json" ||
        contract.candidateArtifactClass !== "relighting_candidate" ||
        !sameMembers(contract.allowedCandidateMediaTypes, ["video/mp4"]) ||
        contract.candidateEvidenceBinding !== "exact_candidate_bytes" ||
        contract.sequenceAlignment === null ||
        contract.providerConfigurationBinding === null)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["executionContracts"],
        message: `relighting contract ${contract.variant} must bind aligned source and candidate video bytes`,
      });
    }
    if (contract.sequenceAlignment !== null) {
      const { framesInputRole, masksInputRole } = contract.sequenceAlignment;
      const sequenceInputs = [framesInputRole, masksInputRole].map((role) =>
        profile.inputs.find(
          (input) => input.role === role && input.variants.includes(contract.variant),
        ),
      );
      if (
        framesInputRole === masksInputRole ||
        sequenceInputs.some(
          (input) =>
            input?.mediaType !==
              "application/vnd.venviewer.content-addressed-png-sequence+json" ||
            !input.requiresImageDimensions,
        ) ||
        framesInputRole !== contract.comparisonSourceInputRole
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["executionContracts"],
          message: `sequence contract ${contract.variant} must bind compatible frame and mask manifests`,
        });
      }
    }
    if (contract.providerConfigurationBinding !== null) {
      const configurationInput = profile.inputs.find(
        (input) =>
          input.role === contract.providerConfigurationBinding?.canonicalInputRole &&
          input.variants.includes(contract.variant),
      );
      if (configurationInput?.mediaType !== "application/json") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["executionContracts"],
          message: `provider configuration for ${contract.variant} must originate from its canonical JSON input`,
        });
      }
    }
  }
}

const FoundryRestorationProviderProfilePayloadV1Schema =
  FoundryRestorationProviderProfilePayloadObjectV1Schema.superRefine(validateProfile);

export function computeFoundryRestorationProviderProfileSha256V1(
  payload: FoundryRestorationProviderProfilePayloadV1,
): string {
  const parsed = FoundryRestorationProviderProfilePayloadV1Schema.parse(payload);
  return digest(FOUNDRY_RESTORATION_PROVIDER_PROFILE_V1_DIGEST_DOMAIN, parsed);
}

export const FoundryRestorationProviderProfileV1Schema =
  FoundryRestorationProviderProfilePayloadObjectV1Schema.extend({
    profileSha256: RuntimeSha256Schema,
  })
    .strict()
    .superRefine((profile, ctx) => {
      const { profileSha256: _profileSha256, ...payload } = profile;
      const parsed = FoundryRestorationProviderProfilePayloadV1Schema.safeParse(payload);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) ctx.addIssue(issue);
        return;
      }
      if (
        profile.profileSha256 !==
        computeFoundryRestorationProviderProfileSha256V1(parsed.data)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["profileSha256"],
          message: "provider profile digest must bind the exact v1 payload",
        });
      }
    });
export type FoundryRestorationProviderProfileV1 = z.infer<
  typeof FoundryRestorationProviderProfileV1Schema
>;

const EXECUTION_POLICY = {
  dispatchAuthorized: false,
  commercialUseAllowed: false,
  publicDistributionAllowed: false,
  sourceTruthReplacementAllowed: false,
  generatedOutputRequiresHumanArchitectureReview: true,
} as const;

function createProfile(
  payload: FoundryRestorationProviderProfilePayloadV1,
): FoundryRestorationProviderProfileV1 {
  const parsed = FoundryRestorationProviderProfilePayloadV1Schema.parse(payload);
  return FoundryRestorationProviderProfileV1Schema.parse({
    ...parsed,
    profileSha256: computeFoundryRestorationProviderProfileSha256V1(parsed),
  });
}

const PROFILES: readonly FoundryRestorationProviderProfileV1[] = [
  createProfile({
    schemaVersion: FOUNDRY_RESTORATION_PROVIDER_PROFILE_V1,
    lane: "artifixer3d_plus",
    displayName: "ArtiFixer3D+ non-destructive reconstruction repair",
    requiredUsePosture: "private_internal_r_and_d_only",
    repositories: [
      {
        role: "artifixer_source",
        repositoryId: "nv-tlabs/ArtiFixer",
        revision: "a392c4dfe17459ef9952407accdb9fcdcdddba98",
      },
      {
        role: "three_d_grut_source",
        repositoryId: "nv-tlabs/3dgrut",
        revision: "62e1038b74b2edc01440fd4ddf5f080109b6faba",
      },
    ],
    models: [
      {
        role: "artifixer_01_3b_checkpoint",
        modelId: "nvidia/ArtiFixer",
        revision: "f96352ad72c84a628d5844b6543e94ae8c4479b3",
        identityStatus: "pinned",
        access: "public",
        snapshotSizeBytes: null,
        variants: ["artifixer_1_3b"],
        requiredWeights: [{
          relativePath: "artifixer-1.3b.pt",
          sizeBytes: 6_715_346_651,
          sha256: "sha256:23e909fb4232c6a74a1c59eaf0ebfd419dd188e601aa0ab0145b9aaea821e059",
        }],
      },
      {
        role: "artifixer_14b_checkpoint",
        modelId: "nvidia/ArtiFixer",
        revision: "f96352ad72c84a628d5844b6543e94ae8c4479b3",
        identityStatus: "pinned",
        access: "public",
        snapshotSizeBytes: null,
        variants: ["artifixer_14b"],
        requiredWeights: [{
          relativePath: "artifixer-14b.pt",
          sizeBytes: 67_644_337_412,
          sha256: "sha256:c1a6d31fb849211d4c682a28b40980549cd8f807ee309e7bc0141a336ffcd16b",
        }],
      },
      {
        role: "wan_2_1_t2v_01_3b_base",
        modelId: "Wan-AI/Wan2.1-T2V-1.3B-Diffusers",
        revision: null,
        identityStatus: "unresolved_upstream_revision",
        access: "public",
        snapshotSizeBytes: null,
        variants: ["artifixer_1_3b"],
        requiredWeights: [],
      },
      {
        role: "wan_2_1_t2v_14b_base",
        modelId: "Wan-AI/Wan2.1-T2V-14B-Diffusers",
        revision: null,
        identityStatus: "unresolved_upstream_revision",
        access: "public",
        snapshotSizeBytes: null,
        variants: ["artifixer_14b"],
        requiredWeights: [],
      },
    ],
    inputs: [
      { role: "colmap_scene", truthLayer: "STRUCTURAL_TRUTH", artifactClass: "source_derived_colmap_scene", mediaType: "application/zip", requiresImageDimensions: false, variants: ["artifixer_14b", "artifixer_1_3b"] },
      { role: "source_reconstruction", truthLayer: "SOURCE_DERIVED_TRUTH", artifactClass: "source_derived_reconstruction", mediaType: "application/octet-stream", requiresImageDimensions: false, variants: ["artifixer_14b", "artifixer_1_3b"] },
      { role: "source_training_images", truthLayer: "SOURCE_DERIVED_TRUTH", artifactClass: "source_derived_capture_observation", mediaType: "application/zip", requiresImageDimensions: false, variants: ["artifixer_14b", "artifixer_1_3b"] },
    ],
    executionContracts: [
      {
        variant: "artifixer_14b",
        readiness: { status: "wait", scope: "scene_level_internal_r_and_d", publicCapability: "scene_repair_and_distillation", minimumGpuVramGiB: null, blockers: ["colmap_scene_not_proven", "exact_license_document_not_proven", "model_weights_not_materialized", "source_camera_acceptance_not_proven", "supported_hardware_not_proven", "three_d_grut_environment_not_proven", "wan_base_model_revision_not_proven"] },
        candidateArtifactClass: "reconstruction_candidate",
        allowedCandidateMediaTypes: ["application/octet-stream"],
        comparisonMode: "render_candidate_reconstruction",
        comparisonSourceInputRole: "source_reconstruction",
        candidateBindingInputRoles: ["colmap_scene", "source_reconstruction", "source_training_images"],
        candidateEvidenceBinding: "candidate_checkpoint_and_derived_render_bytes",
        sequenceAlignment: null,
        providerConfigurationBinding: null,
      },
      {
        variant: "artifixer_1_3b",
        readiness: { status: "wait", scope: "scene_level_internal_r_and_d", publicCapability: "scene_repair_and_distillation", minimumGpuVramGiB: 80, blockers: ["colmap_scene_not_proven", "exact_license_document_not_proven", "model_weights_not_materialized", "source_camera_acceptance_not_proven", "supported_80_gib_gpu_not_available", "three_d_grut_environment_not_proven", "wan_base_model_revision_not_proven"] },
        candidateArtifactClass: "reconstruction_candidate",
        allowedCandidateMediaTypes: ["application/octet-stream"],
        comparisonMode: "render_candidate_reconstruction",
        comparisonSourceInputRole: "source_reconstruction",
        candidateBindingInputRoles: ["colmap_scene", "source_reconstruction", "source_training_images"],
        candidateEvidenceBinding: "candidate_checkpoint_and_derived_render_bytes",
        sequenceAlignment: null,
        providerConfigurationBinding: null,
      },
    ],
    executionPolicy: EXECUTION_POLICY,
  }),
  createProfile({
    schemaVersion: FOUNDRY_RESTORATION_PROVIDER_PROFILE_V1,
    lane: "difix3d_plus",
    displayName: "Difix3D+ non-destructive fixed-camera repair",
    requiredUsePosture: "private_internal_r_and_d_only",
    repositories: [{
      role: "difix3d_source",
      repositoryId: "nv-tlabs/Difix3D",
      revision: "c76edc595586e16732c91ddee82f3a6d83a8a9cc",
    }],
    models: [
      { role: "difix_checkpoint", modelId: "nvidia/difix", revision: "2b0c6fb5797c26b01154dfdeb19d36e5e2eaf388", identityStatus: "pinned", access: "public", snapshotSizeBytes: null, variants: ["difix"], requiredWeights: [] },
      { role: "difix_ref_checkpoint", modelId: "nvidia/difix_ref", revision: "d4830559772a5795c9d136302c5b197d6418d3fb", identityStatus: "pinned", access: "public", snapshotSizeBytes: null, variants: ["difix_ref"], requiredWeights: [] },
    ],
    inputs: [
      { role: "captured_reference_image", truthLayer: "CAPTURED_TRUTH", artifactClass: "captured_observation", mediaType: "image/png", requiresImageDimensions: true, variants: ["difix_ref"] },
      { role: "source_fixed_camera_render", truthLayer: "SOURCE_DERIVED_TRUTH", artifactClass: "source_derived_reconstruction_render", mediaType: "image/png", requiresImageDimensions: true, variants: ["difix", "difix_ref"] },
      { role: "source_reconstruction", truthLayer: "SOURCE_DERIVED_TRUTH", artifactClass: "source_derived_reconstruction", mediaType: "application/vnd.venviewer.grand-hall.reconstruction+json", requiresImageDimensions: false, variants: ["difix", "difix_ref"] },
    ],
    executionContracts: [
      {
        variant: "difix",
        readiness: { status: "wait", scope: "single_frame_2d_internal_r_and_d", publicCapability: "single_frame_image_repair", minimumGpuVramGiB: null, blockers: ["evaluator_configuration_not_proven", "fixed_camera_render_closure_not_proven", "local_model_manifest_not_proven", "local_weight_file_not_proven", "protected_generated_masks_not_proven", "required_input_artifacts_not_proven", "runtime_environment_not_proven"] },
        candidateArtifactClass: "restoration_candidate",
        allowedCandidateMediaTypes: ["image/png"],
        comparisonMode: "direct_candidate_image",
        comparisonSourceInputRole: "source_fixed_camera_render",
        candidateBindingInputRoles: ["source_fixed_camera_render", "source_reconstruction"],
        candidateEvidenceBinding: "exact_candidate_bytes",
        sequenceAlignment: null,
        providerConfigurationBinding: null,
      },
      {
        variant: "difix_ref",
        readiness: { status: "wait", scope: "single_frame_2d_internal_r_and_d", publicCapability: "single_frame_image_repair", minimumGpuVramGiB: null, blockers: ["evaluator_configuration_not_proven", "fixed_camera_render_closure_not_proven", "local_model_manifest_not_proven", "local_weight_file_not_proven", "protected_generated_masks_not_proven", "required_input_artifacts_not_proven", "runtime_environment_not_proven"] },
        candidateArtifactClass: "restoration_candidate",
        allowedCandidateMediaTypes: ["image/png"],
        comparisonMode: "direct_candidate_image",
        comparisonSourceInputRole: "source_fixed_camera_render",
        candidateBindingInputRoles: ["captured_reference_image", "source_fixed_camera_render", "source_reconstruction"],
        candidateEvidenceBinding: "exact_candidate_bytes",
        sequenceAlignment: null,
        providerConfigurationBinding: null,
      },
    ],
    executionPolicy: EXECUTION_POLICY,
  }),
  createProfile({
    schemaVersion: FOUNDRY_RESTORATION_PROVIDER_PROFILE_V1,
    lane: "gr3en",
    displayName: "GR3EN non-destructive video relighting",
    requiredUsePosture: "private_internal_r_and_d_only",
    repositories: [{
      role: "gr3en_source",
      repositoryId: "xyxingx/gr3en",
      revision: "78fd3844a6e0fdd4eb50d0e7986ede1e7f76763b",
    }],
    models: [{
      role: "gr3en_checkpoint",
      modelId: "xyxingx/GR3EN",
      revision: "8aa83a10af8b031d015e6170fd01609d54423f4c",
      identityStatus: "pinned",
      access: "gated",
      snapshotSizeBytes: 33_785_456_692,
      variants: ["gr3en_video"],
      requiredWeights: [],
    }],
    inputs: [
      { role: "provider_execution_configuration", truthLayer: "OPERATOR_CONTROL", artifactClass: "source_derived_relighting_control", mediaType: "application/json", requiresImageDimensions: false, variants: ["gr3en_video"] },
      { role: "source_camera_trajectory", truthLayer: "OPERATOR_CONTROL", artifactClass: "source_derived_camera_trajectory", mediaType: "application/json", requiresImageDimensions: false, variants: ["gr3en_video"] },
      { role: "source_frame_sequence_manifest", truthLayer: "SOURCE_DERIVED_TRUTH", artifactClass: "source_derived_ordered_image_sequence", mediaType: "application/vnd.venviewer.content-addressed-png-sequence+json", requiresImageDimensions: true, variants: ["gr3en_video"] },
      { role: "source_light_control_mask_sequence_manifest", truthLayer: "OPERATOR_CONTROL", artifactClass: "source_derived_relighting_control", mediaType: "application/vnd.venviewer.content-addressed-png-sequence+json", requiresImageDimensions: true, variants: ["gr3en_video"] },
      { role: "source_reconstruction", truthLayer: "SOURCE_DERIVED_TRUTH", artifactClass: "source_derived_reconstruction", mediaType: "application/octet-stream", requiresImageDimensions: false, variants: ["gr3en_video"] },
    ],
    executionContracts: [{
      variant: "gr3en_video",
      readiness: { status: "wait", scope: "scene_level_internal_r_and_d", publicCapability: "inference_video_only", minimumGpuVramGiB: 48, blockers: ["exact_license_document_not_proven", "gated_hugging_face_terms_not_accepted", "local_model_snapshot_not_materialized", "public_3d_distillation_unreleased", "relighting_input_frames_and_control_masks_not_proven", "runtime_environment_not_proven", "supported_48_gib_gpu_not_available"] },
      candidateArtifactClass: "relighting_candidate",
      allowedCandidateMediaTypes: ["video/mp4"],
      comparisonMode: "aligned_relighting_video",
      comparisonSourceInputRole: "source_frame_sequence_manifest",
      candidateBindingInputRoles: ["provider_execution_configuration", "source_camera_trajectory", "source_frame_sequence_manifest", "source_light_control_mask_sequence_manifest", "source_reconstruction"],
      candidateEvidenceBinding: "exact_candidate_bytes",
      sequenceAlignment: {
        framesInputRole: "source_frame_sequence_manifest",
        masksInputRole: "source_light_control_mask_sequence_manifest",
        exactItemCount: 81,
        itemMediaType: "image/png",
        correspondence: "basename_and_index",
        sharedDimensionsAndOrderRequired: true,
        candidateDecodedFrameCountAndOrderMustMatch: true,
      },
      providerConfigurationBinding: {
        canonicalInputRole: "provider_execution_configuration",
        compiledMediaType: "application/yaml",
        candidateMustBindCanonicalAndCompiledBytes: true,
      },
    }],
    executionPolicy: EXECUTION_POLICY,
  }),
  createProfile({
    schemaVersion: FOUNDRY_RESTORATION_PROVIDER_PROFILE_V1,
    lane: "gsfix3d",
    displayName: "GSFix3D/GSFixer non-destructive repair and lift",
    requiredUsePosture: "private_internal_r_and_d_only",
    repositories: [{
      role: "gsfix_source",
      repositoryId: "GSFix3D/GSFix3D",
      revision: "88b03c0230ceef58455cd0cb7eda4a58923cf4ab",
    }],
    models: [
      {
        role: "gsfixer_base_checkpoint",
        modelId: "goldoak1421/gsfixer-base",
        revision: "10da3bf12c1c299d559a85572601f17054dd4d2a",
        identityStatus: "pinned",
        access: "public",
        snapshotSizeBytes: null,
        variants: ["gsfixer_base"],
        requiredWeights: [
          { relativePath: "text_encoder/model.safetensors", sizeBytes: 1_361_597_018, sha256: "sha256:cce6febb0b6d876ee5eb24af35e27e764eb4f9b1d0b7c026c8c3333d4cfc916c" },
          { relativePath: "unet/diffusion_pytorch_model.safetensors", sizeBytes: 3_463_772_592, sha256: "sha256:c9d5901413231caa38115a907cdcb54dacf35cb16333bb83f3b5877b74b3b9f8" },
          { relativePath: "vae/diffusion_pytorch_model.safetensors", sizeBytes: 334_643_276, sha256: "sha256:a1d993488569e928462932c8c38a0760b874d166399b14414135bd9c42df5815" },
        ],
      },
      {
        role: "gsfixer_full_checkpoint",
        modelId: "goldoak1421/gsfixer-full",
        revision: "b492e659359325e83a2277763ee862453ae8a7e7",
        identityStatus: "pinned",
        access: "public",
        snapshotSizeBytes: null,
        variants: ["gsfixer_full"],
        requiredWeights: [
          { relativePath: "text_encoder/model.safetensors", sizeBytes: 1_361_597_018, sha256: "sha256:cce6febb0b6d876ee5eb24af35e27e764eb4f9b1d0b7c026c8c3333d4cfc916c" },
          { relativePath: "unet/diffusion_pytorch_model.safetensors", sizeBytes: 3_463_818_688, sha256: "sha256:e0d59badd66cd9ac9269e2cb18f6144d4eb2502940df495d5441b683bdbaf87a" },
          { relativePath: "vae/diffusion_pytorch_model.safetensors", sizeBytes: 334_643_276, sha256: "sha256:a1d993488569e928462932c8c38a0760b874d166399b14414135bd9c42df5815" },
        ],
      },
    ],
    inputs: [
      { role: "captured_training_images", truthLayer: "CAPTURED_TRUTH", artifactClass: "captured_observation", mediaType: "application/zip", requiresImageDimensions: false, variants: ["gsfix3d_lift", "gsfixer_full"] },
      { role: "fixed_novel_view_images", truthLayer: "GENERATED_CINEMATIC", artifactClass: "generated_restoration_observation", mediaType: "application/zip", requiresImageDimensions: false, variants: ["gsfix3d_lift"] },
      { role: "gs_training_renders", truthLayer: "SOURCE_DERIVED_TRUTH", artifactClass: "source_derived_reconstruction_render_set", mediaType: "application/zip", requiresImageDimensions: false, variants: ["gsfixer_full"] },
      { role: "mesh_training_renders", truthLayer: "SOURCE_DERIVED_TRUTH", artifactClass: "source_derived_reconstruction_render_set", mediaType: "application/zip", requiresImageDimensions: false, variants: ["gsfixer_full"] },
      { role: "novel_view_camera_set", truthLayer: "OPERATOR_CONTROL", artifactClass: "source_derived_camera_solution", mediaType: "application/json", requiresImageDimensions: false, variants: ["gsfix3d_lift"] },
      { role: "refinement_capture_dataset_manifest", truthLayer: "SOURCE_DERIVED_TRUTH", artifactClass: "source_derived_capture_dataset_manifest", mediaType: "application/json", requiresImageDimensions: false, variants: ["gsfix3d_lift"] },
      { role: "source_3dgs_checkpoint", truthLayer: "SOURCE_DERIVED_TRUTH", artifactClass: "source_derived_reconstruction", mediaType: "application/octet-stream", requiresImageDimensions: false, variants: ["gsfix3d_lift"] },
      { role: "source_fixed_camera_render", truthLayer: "SOURCE_DERIVED_TRUTH", artifactClass: "source_derived_reconstruction_render", mediaType: "image/png", requiresImageDimensions: true, variants: ["gsfixer_base"] },
      { role: "source_gs_fixed_camera_render", truthLayer: "SOURCE_DERIVED_TRUTH", artifactClass: "source_derived_reconstruction_render", mediaType: "image/png", requiresImageDimensions: true, variants: ["gsfixer_full"] },
      { role: "source_mesh_fixed_camera_render", truthLayer: "SOURCE_DERIVED_TRUTH", artifactClass: "source_derived_reconstruction_render", mediaType: "image/png", requiresImageDimensions: true, variants: ["gsfixer_full"] },
      { role: "source_reconstruction", truthLayer: "SOURCE_DERIVED_TRUTH", artifactClass: "source_derived_reconstruction", mediaType: "application/vnd.venviewer.grand-hall.reconstruction+json", requiresImageDimensions: false, variants: ["gsfixer_base", "gsfixer_full"] },
      { role: "source_training_camera_calibration", truthLayer: "STRUCTURAL_TRUTH", artifactClass: "source_derived_camera_solution", mediaType: "application/json", requiresImageDimensions: false, variants: ["gsfix3d_lift"] },
    ],
    executionContracts: [
      {
        variant: "gsfix3d_lift",
        readiness: { status: "wait", scope: "scene_level_internal_r_and_d", publicCapability: "scene_repair_and_distillation", minimumGpuVramGiB: null, blockers: ["captured_training_images_not_proven", "exact_license_document_not_proven", "fixed_novel_view_images_not_proven", "noncommercial_dependency", "provider_output_requires_human_architecture_review", "refinement_capture_dataset_manifest_not_proven", "source_training_camera_calibration_not_proven", "supported_custom_scene_adapter_not_proven"] },
        candidateArtifactClass: "reconstruction_candidate",
        allowedCandidateMediaTypes: ["application/octet-stream"],
        comparisonMode: "render_candidate_reconstruction",
        comparisonSourceInputRole: "source_3dgs_checkpoint",
        candidateBindingInputRoles: ["captured_training_images", "fixed_novel_view_images", "novel_view_camera_set", "refinement_capture_dataset_manifest", "source_3dgs_checkpoint", "source_training_camera_calibration"],
        candidateEvidenceBinding: "candidate_checkpoint_and_derived_render_bytes",
        sequenceAlignment: null,
        providerConfigurationBinding: null,
      },
      {
        variant: "gsfixer_base",
        readiness: { status: "wait", scope: "single_frame_2d_internal_r_and_d", publicCapability: "single_frame_image_repair", minimumGpuVramGiB: 24, blockers: ["exact_license_document_not_proven", "provider_output_requires_human_architecture_review"] },
        candidateArtifactClass: "restoration_candidate",
        allowedCandidateMediaTypes: ["image/png"],
        comparisonMode: "direct_candidate_image",
        comparisonSourceInputRole: "source_fixed_camera_render",
        candidateBindingInputRoles: ["source_fixed_camera_render", "source_reconstruction"],
        candidateEvidenceBinding: "exact_candidate_bytes",
        sequenceAlignment: null,
        providerConfigurationBinding: null,
      },
      {
        variant: "gsfixer_full",
        readiness: { status: "wait", scope: "scene_level_internal_r_and_d", publicCapability: "scene_finetuned_image_repair", minimumGpuVramGiB: null, blockers: ["captured_training_pairs_not_proven", "exact_license_document_not_proven", "noncommercial_dependency", "provider_output_requires_human_architecture_review", "supported_custom_scene_adapter_not_proven"] },
        candidateArtifactClass: "restoration_candidate",
        allowedCandidateMediaTypes: ["image/png"],
        comparisonMode: "direct_candidate_image",
        comparisonSourceInputRole: "source_gs_fixed_camera_render",
        candidateBindingInputRoles: ["captured_training_images", "gs_training_renders", "mesh_training_renders", "source_gs_fixed_camera_render", "source_mesh_fixed_camera_render", "source_reconstruction"],
        candidateEvidenceBinding: "exact_candidate_bytes",
        sequenceAlignment: null,
        providerConfigurationBinding: null,
      },
    ],
    executionPolicy: EXECUTION_POLICY,
  }),
];

const FoundryRestorationProviderCatalogPayloadV1Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_RESTORATION_PROVIDER_CATALOG_V1),
    profiles: z.array(FoundryRestorationProviderProfileV1Schema).length(4),
  })
  .strict()
  .superRefine((catalog, ctx) => {
    const lanes = catalog.profiles.map((profile) => profile.lane);
    if (!sameMembers(lanes, FOUNDRY_RESTORATION_PROVIDER_LANES_V1)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["profiles"],
        message: "catalog must contain every provider lane exactly once in ordinal order",
      });
    }
  });
export type FoundryRestorationProviderCatalogPayloadV1 = z.infer<
  typeof FoundryRestorationProviderCatalogPayloadV1Schema
>;

export function computeFoundryRestorationProviderCatalogSha256V1(
  payload: FoundryRestorationProviderCatalogPayloadV1,
): string {
  const parsed = FoundryRestorationProviderCatalogPayloadV1Schema.parse(payload);
  return digest(FOUNDRY_RESTORATION_PROVIDER_CATALOG_V1_DIGEST_DOMAIN, parsed);
}

export const FoundryRestorationProviderCatalogV1Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_RESTORATION_PROVIDER_CATALOG_V1),
    profiles: z.array(FoundryRestorationProviderProfileV1Schema).length(4),
    catalogSha256: RuntimeSha256Schema,
  })
  .strict()
  .superRefine((catalog, ctx) => {
    const { catalogSha256: _catalogSha256, ...payload } = catalog;
    const parsed = FoundryRestorationProviderCatalogPayloadV1Schema.safeParse(payload);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) ctx.addIssue(issue);
      return;
    }
    if (
      catalog.catalogSha256 !==
      computeFoundryRestorationProviderCatalogSha256V1(parsed.data)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["catalogSha256"],
        message: "provider catalog digest must bind the exact v1 payload",
      });
    }
  });
export type FoundryRestorationProviderCatalogV1 = z.infer<
  typeof FoundryRestorationProviderCatalogV1Schema
>;

const CATALOG_PAYLOAD = FoundryRestorationProviderCatalogPayloadV1Schema.parse({
  schemaVersion: FOUNDRY_RESTORATION_PROVIDER_CATALOG_V1,
  profiles: PROFILES,
});

export const FOUNDRY_RESTORATION_PROVIDER_CATALOG: FoundryRestorationProviderCatalogV1 =
  deepFreeze(FoundryRestorationProviderCatalogV1Schema.parse({
    ...CATALOG_PAYLOAD,
    catalogSha256: computeFoundryRestorationProviderCatalogSha256V1(CATALOG_PAYLOAD),
  }));

export function verifyFoundryRestorationProviderCatalogV1(
  candidate: unknown,
): FoundryRestorationProviderCatalogV1 {
  const parsed = FoundryRestorationProviderCatalogV1Schema.parse(candidate);
  if (
    parsed.catalogSha256 !== FOUNDRY_RESTORATION_PROVIDER_CATALOG.catalogSha256 ||
    stableCanonicalJson(toCanonicalJson(parsed)) !==
      stableCanonicalJson(toCanonicalJson(FOUNDRY_RESTORATION_PROVIDER_CATALOG))
  ) {
    throw new FoundryIntegrityError(
      "RESTORATION_PROVIDER_CATALOG_V1_CANONICAL_MISMATCH",
      "The supplied v1 provider catalog is self-consistent but is not the audited canonical catalog.",
    );
  }
  return parsed;
}

export function getFoundryRestorationProviderProfileV1(
  lane: FoundryRestorationProviderLaneV1,
): FoundryRestorationProviderProfileV1 {
  const parsedLane = FoundryRestorationProviderLaneV1Schema.parse(lane);
  const profile = FOUNDRY_RESTORATION_PROVIDER_CATALOG.profiles.find(
    (candidate) => candidate.lane === parsedLane,
  );
  if (profile === undefined) {
    throw new FoundryIntegrityError(
      "RESTORATION_PROVIDER_PROFILE_V1_MISSING",
      `The v1 provider catalog does not contain ${parsedLane}.`,
    );
  }
  return FoundryRestorationProviderProfileV1Schema.parse(profile);
}

export function getFoundryRestorationExecutionContractV1(
  lane: FoundryRestorationProviderLaneV1,
  variant: FoundryRestorationProviderVariantV1,
): FoundryRestorationExecutionContractV1 {
  const profile = getFoundryRestorationProviderProfileV1(lane);
  const parsedVariant = FoundryRestorationProviderVariantV1Schema.parse(variant);
  const contract = profile.executionContracts.find(
    (candidate) => candidate.variant === parsedVariant,
  );
  if (contract === undefined) {
    throw new FoundryIntegrityError(
      "RESTORATION_PROVIDER_VARIANT_V1_MISMATCH",
      `${parsedVariant} is not an execution contract for ${lane}.`,
    );
  }
  return FoundryRestorationExecutionContractV1Schema.parse(contract);
}
