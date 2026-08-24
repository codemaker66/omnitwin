import { z } from "zod";
import {
  RuntimeManifestKeySchema,
  RuntimeSha256Schema,
  TransformArtifactV0Schema,
} from "./runtime-venue-manifest.js";

export const ROOM_SCENE_MANIFEST_V0_VERSION = "room-scene-manifest/v0";

/**
 * Permanent display-level truth classes requested by the Grand Hall canonical
 * strategy. They complement, rather than replace, the repo's multi-axis Truth
 * Mode vocabulary and TransformArtifact provenance state.
 */
export const ROOM_SCENE_TRUTH_CLASSES = [
  "MEASURED",
  "CAPTURED",
  "RECONSTRUCTED",
  "ENHANCED_CAPTURED",
  "GENERATED_CINEMATIC",
  "PROCEDURAL_PLANNER",
] as const;

/** Fixed compositor slots. A missing real layer is absent, never fabricated. */
export const ROOM_SCENE_LAYER_KINDS = [
  "Appearance",
  "StructuralProxy",
  "Collision",
  "HeroVolume",
  "Semantic",
  "Planner",
  "CinematicDerivative",
] as const;

export const ROOM_SCENE_LAYER_AUTHORITIES = [
  "appearance",
  "geometry",
  "collision",
  "navigation",
  "diagnostic_navigation",
  "semantics",
  "interaction",
  "planning",
  "lighting",
  "export",
] as const;

export const ROOM_SCENE_INTENTS = [
  "inspection",
  "human_diagnostic",
  "dollhouse",
  "planning",
  "cinematic",
] as const;

export const RECONSTRUCTION_PROVIDER_KINDS = [
  "xgrids_import",
  "gsplat",
  "three_dgut",
  "neural_harmonic_textures",
  "brush",
  "other",
] as const;

export const ENHANCEMENT_PROVIDER_KINDS = [
  "fixer",
  "artifixer",
  "gaussian_super_resolution",
  "relighting",
  "material_inference",
  "other",
] as const;

export const MATERIAL_CHANNELS = [
  "normal",
  "albedo",
  "roughness",
  "metallic",
  "reflective_mask",
  "glass_mask",
] as const;

export const LIGHTING_VARIANT_KINDS = [
  "captured_environment",
  "reconstructed_environment",
  "physical_light_rig",
  "generated_relighting",
] as const;

export const SOURCE_RIGHTS_SCOPES = [
  "data_use",
  "reconstruction",
  "training",
  "enhancement",
  "derivatives",
  "commercial_venviewer_development",
  "reverse_engineering",
  "software_integration",
] as const;

export const SOURCE_RIGHTS_ADDITIONAL_PERMISSIONS = [
  "redistribution",
  "third_party_dissemination",
] as const;

export const OWNER_CONFIRMED_AUTHORITY_STATEMENT = "Authority status: confirmed by project owner";
export const OWNER_CONFIRMED_SCOPE_STATEMENT = "Scope: data use, reconstruction, training, enhancement, derivatives, commercial Venviewer development, reverse engineering and software integration";

export const SceneTruthClassSchema = z.enum(ROOM_SCENE_TRUTH_CLASSES);
export const RoomSceneLayerKindSchema = z.enum(ROOM_SCENE_LAYER_KINDS);
export const RoomSceneLayerAuthoritySchema = z.enum(ROOM_SCENE_LAYER_AUTHORITIES);
export const RoomSceneIntentSchema = z.enum(ROOM_SCENE_INTENTS);
export const ReconstructionProviderKindSchema = z.enum(RECONSTRUCTION_PROVIDER_KINDS);
export const EnhancementProviderKindSchema = z.enum(ENHANCEMENT_PROVIDER_KINDS);
export const MaterialChannelSchema = z.enum(MATERIAL_CHANNELS);
export const LightingVariantKindSchema = z.enum(LIGHTING_VARIANT_KINDS);
export const SourceRightsScopeSchema = z.enum(SOURCE_RIGHTS_SCOPES);
export const SourceRightsAdditionalPermissionSchema = z.enum(SOURCE_RIGHTS_ADDITIONAL_PERMISSIONS);

export const SourceRightsV0Schema = z
  .object({
    id: RuntimeManifestKeySchema,
    sourceFamily: RuntimeManifestKeySchema,
    authorityStatus: z.enum([
      "unknown",
      "confirmed_by_project_owner",
      "evidence_reviewed",
      "restricted",
    ]),
    authorityStatement: z.string().trim().min(1).max(240),
    scope: z.array(SourceRightsScopeSchema).min(1),
    scopeStatement: z.string().trim().min(1).max(400),
    additionalPermissions: z.array(SourceRightsAdditionalPermissionSchema).default([]),
    evidenceLocation: z.string().trim().min(1).max(500),
    evidenceLocationStatus: z.enum(["pending", "recorded"]),
    unrelatedLicensesRequireSeparateReview: z.boolean(),
  })
  .strict()
  .superRefine((rights, ctx) => {
    if (
      rights.authorityStatus === "confirmed_by_project_owner"
      && rights.authorityStatement !== OWNER_CONFIRMED_AUTHORITY_STATEMENT
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["authorityStatement"],
        message: "Owner-confirmed rights must retain the canonical authority statement.",
      });
    }
    if (new Set(rights.scope).size !== rights.scope.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scope"],
        message: "Source-rights scope values must be unique.",
      });
    }
    if (new Set(rights.additionalPermissions).size !== rights.additionalPermissions.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["additionalPermissions"],
        message: "Additional permission values must be unique.",
      });
    }
    if (rights.authorityStatus === "confirmed_by_project_owner") {
      const scope = new Set(rights.scope);
      const additionalPermissions = new Set(rights.additionalPermissions);
      if (
        rights.scopeStatement !== OWNER_CONFIRMED_SCOPE_STATEMENT
        || SOURCE_RIGHTS_SCOPES.some((value) => !scope.has(value))
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["scopeStatement"],
          message: "Owner-confirmed rights must retain the canonical scope statement and complete scope vocabulary.",
        });
      }
      if (
        SOURCE_RIGHTS_ADDITIONAL_PERMISSIONS.some(
          (permission) => !additionalPermissions.has(permission),
        )
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["additionalPermissions"],
          message: "Owner-confirmed rights must retain the supplied redistribution and third-party dissemination permissions.",
        });
      }
      if (!rights.unrelatedLicensesRequireSeparateReview) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["unrelatedLicensesRequireSeparateReview"],
          message: "Owner-confirmed source rights do not waive unrelated code, model, or provider licence review.",
        });
      }
    }
    if (rights.authorityStatus === "evidence_reviewed" && rights.evidenceLocationStatus !== "recorded") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidenceLocationStatus"],
        message: "Evidence-reviewed rights require a recorded documentary evidence location.",
      });
    }
  });

export const SourceRightsLedgerRevisionV0Schema = z
  .object({
    revisionId: RuntimeManifestKeySchema,
    recordedOn: z.string().date(),
    authoritySource: z.literal("project_owner_statement"),
    records: z.array(SourceRightsV0Schema).min(1),
    separateLicenseReviewStatement: z.string().trim().min(1).max(500),
  })
  .strict();

export const SourceRightsLedgerV0Schema = z
  .object({
    version: z.literal(1),
    ledgerType: z.literal("source-rights"),
    revisionPolicy: z.literal("append-only"),
    revisions: z.array(SourceRightsLedgerRevisionV0Schema).min(1),
  })
  .strict()
  .superRefine((ledger, ctx) => {
    const revisionIds = new Set<string>();
    for (const [index, revision] of ledger.revisions.entries()) {
      if (revisionIds.has(revision.revisionId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["revisions", index, "revisionId"],
          message: "Source-rights ledger revision IDs must be unique.",
        });
      }
      revisionIds.add(revision.revisionId);
    }
  });

export const QualityEvidenceV0Schema = z
  .object({
    id: RuntimeManifestKeySchema,
    status: z.enum(["unverified", "machine_checked", "human_reviewed", "not_run"]),
    confidence: z.enum([
      "unknown",
      "appearance_only",
      "layout_grade",
      "operations_grade",
      "survey_grade",
    ]),
    evidenceRefs: z.array(z.string().trim().min(1).max(500)).default([]),
    limitations: z.array(z.string().trim().min(1).max(500)).min(1),
  })
  .strict()
  .superRefine((evidence, ctx) => {
    if (
      (evidence.status === "machine_checked" || evidence.status === "human_reviewed")
      && evidence.evidenceRefs.length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidenceRefs"],
        message: "Checked quality evidence must cite at least one evidence artifact.",
      });
    }
    if (evidence.confidence !== "unknown" && evidence.evidenceRefs.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidenceRefs"],
        message: "Declared confidence must cite supporting evidence.",
      });
    }
    if (
      (evidence.status === "not_run" || evidence.status === "unverified")
      && evidence.confidence !== "unknown"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["confidence"],
        message: "Not-run or unverified evidence cannot claim a quality grade.",
      });
    }
    if (
      (evidence.confidence === "layout_grade"
        || evidence.confidence === "operations_grade"
        || evidence.confidence === "survey_grade")
      && evidence.status !== "human_reviewed"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message: "Layout, operations, and survey grades require human-reviewed evidence.",
      });
    }
  });

export const VisualAssetMemberV0Schema = z
  .object({
    id: RuntimeManifestKeySchema,
    assetVersionId: z.string().uuid().nullable().optional(),
    fileName: z.string().trim().min(1).max(255),
    sha256: RuntimeSha256Schema,
    sizeBytes: z.number().int().positive(),
    gaussianCount: z.number().int().positive().optional(),
  })
  .strict();

export const VisualAssetManifestV0Schema = z
  .object({
    id: RuntimeManifestKeySchema,
    truthClass: SceneTruthClassSchema,
    format: z.enum(["lcc", "lcc2", "sog", "spz", "ply", "obj", "glb", "json"]),
    lineageRole: z.enum(["source_master", "runtime_derivative"]),
    parentArtifactRefs: z.array(z.string().trim().min(1).max(500)).min(1),
    sourceRightsId: RuntimeManifestKeySchema,
    qualityEvidenceIds: z.array(RuntimeManifestKeySchema).min(1),
    members: z.array(VisualAssetMemberV0Schema).min(1),
    totalBytes: z.number().int().positive(),
    totalGaussianCount: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const memberIds = new Set<string>();
    let totalBytes = 0;
    let totalGaussianCount = 0;
    let allMembersDeclareGaussians = true;
    for (const [index, member] of manifest.members.entries()) {
      if (memberIds.has(member.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["members", index, "id"],
          message: "Visual asset member IDs must be unique.",
        });
      }
      memberIds.add(member.id);
      totalBytes += member.sizeBytes;
      if (member.gaussianCount === undefined) allMembersDeclareGaussians = false;
      else totalGaussianCount += member.gaussianCount;
    }
    if (manifest.totalBytes !== totalBytes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["totalBytes"],
        message: "Visual asset totalBytes must equal the ordered member total.",
      });
    }
    if (
      manifest.totalGaussianCount !== undefined
      && (!allMembersDeclareGaussians || manifest.totalGaussianCount !== totalGaussianCount)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["totalGaussianCount"],
        message: "Visual asset totalGaussianCount must equal the ordered member total.",
      });
    }
  });

export const RoomSceneLayerSourceSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("visual_asset_set"),
      visualAssetManifestId: RuntimeManifestKeySchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("artifact"),
      artifactRef: z.string().trim().min(1).max(500),
      sha256: RuntimeSha256Schema,
    })
    .strict(),
  z.object({ type: z.literal("planner_state") }).strict(),
  z
    .object({
      type: z.literal("fixture"),
      fixtureRef: z.string().trim().min(1).max(500),
      label: z.string().trim().min(1).max(240),
    })
    .strict(),
]);

export const RoomSceneSpatialRegistrationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("unregistered") }).strict(),
  z
    .object({
      type: z.literal("inspection_placement"),
      bindingRef: RuntimeManifestKeySchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("transform_artifact"),
      transformArtifactId: RuntimeManifestKeySchema,
    })
    .strict(),
  z.object({ type: z.literal("identity_in_rrf") }).strict(),
  z.object({ type: z.literal("not_spatial") }).strict(),
]);

const ProviderAvailabilitySchema = z.enum(["integration_point", "available", "disabled"]);

export const ReconstructionProviderDescriptorV0Schema = z
  .object({
    id: RuntimeManifestKeySchema,
    kind: ReconstructionProviderKindSchema,
    availability: ProviderAvailabilitySchema,
    implementationRef: z.string().trim().min(1).max(500).nullable(),
    limitations: z.array(z.string().trim().min(1).max(500)).min(1),
  })
  .strict()
  .superRefine((provider, ctx) => {
    if (provider.availability === "available" && provider.implementationRef === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["implementationRef"],
        message: "Available reconstruction providers require a real implementation reference.",
      });
    }
  });

export const EnhancementProviderDescriptorV0Schema = z
  .object({
    id: RuntimeManifestKeySchema,
    kind: EnhancementProviderKindSchema,
    availability: ProviderAvailabilitySchema,
    implementationRef: z.string().trim().min(1).max(500).nullable(),
    outputTruthClasses: z
      .array(z.enum(["ENHANCED_CAPTURED", "GENERATED_CINEMATIC"]))
      .min(1),
    limitations: z.array(z.string().trim().min(1).max(500)).min(1),
  })
  .strict()
  .superRefine((provider, ctx) => {
    if (provider.availability === "available" && provider.implementationRef === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["implementationRef"],
        message: "Available enhancement providers require a real implementation reference.",
      });
    }
  });

const SupplementalTruthClassSchema = z.enum([
  "CAPTURED",
  "RECONSTRUCTED",
  "ENHANCED_CAPTURED",
  "GENERATED_CINEMATIC",
]);

export const MaterialAttachmentDescriptorV0Schema = z
  .object({
    id: RuntimeManifestKeySchema,
    truthClass: SupplementalTruthClassSchema,
    source: RoomSceneLayerSourceSchema,
    spatialRegistration: RoomSceneSpatialRegistrationSchema,
    sourceRightsId: RuntimeManifestKeySchema.nullable().optional(),
    qualityEvidenceIds: z.array(RuntimeManifestKeySchema).min(1),
    targetLayerIds: z.array(RuntimeManifestKeySchema).min(1),
    channels: z.array(MaterialChannelSchema).min(1),
  })
  .strict()
  .superRefine((attachment, ctx) => {
    if (attachment.source.type === "planner_state" || attachment.source.type === "fixture") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["source"],
        message: "Material attachments require a real visual-asset or artifact source.",
      });
    }
  });

export const LightingVariantDescriptorV0Schema = z
  .object({
    id: RuntimeManifestKeySchema,
    kind: LightingVariantKindSchema,
    truthClass: SupplementalTruthClassSchema,
    source: RoomSceneLayerSourceSchema,
    spatialRegistration: RoomSceneSpatialRegistrationSchema,
    sourceRightsId: RuntimeManifestKeySchema.nullable().optional(),
    qualityEvidenceIds: z.array(RuntimeManifestKeySchema).min(1),
    targetLayerIds: z.array(RuntimeManifestKeySchema).min(1),
    activation: z.enum(["manual", "event_state", "cinematic_only"]),
  })
  .strict()
  .superRefine((variant, ctx) => {
    if (variant.source.type === "planner_state" || variant.source.type === "fixture") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["source"],
        message: "Lighting variants require a real visual-asset or artifact source.",
      });
    }
    const truthByKind: Record<LightingVariantKind, readonly z.infer<typeof SupplementalTruthClassSchema>[]> = {
      captured_environment: ["CAPTURED"],
      reconstructed_environment: ["RECONSTRUCTED", "ENHANCED_CAPTURED"],
      physical_light_rig: ["RECONSTRUCTED", "ENHANCED_CAPTURED"],
      generated_relighting: ["GENERATED_CINEMATIC"],
    };
    if (!truthByKind[variant.kind].includes(variant.truthClass)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["truthClass"],
        message: "Lighting kind and truth class must describe the same provenance lane.",
      });
    }
  });

export const SpatialLayerDescriptorV0Schema = z
  .object({
    id: RuntimeManifestKeySchema,
    kind: RoomSceneLayerKindSchema,
    truthClass: SceneTruthClassSchema,
    source: RoomSceneLayerSourceSchema,
    authorities: z.array(RoomSceneLayerAuthoritySchema).min(1),
    spatialRegistration: RoomSceneSpatialRegistrationSchema,
    qualityEvidenceIds: z.array(RuntimeManifestKeySchema).min(1),
    sourceRightsId: RuntimeManifestKeySchema.nullable().optional(),
    intents: z.array(RoomSceneIntentSchema).min(1),
    loadPolicy: z.enum(["atomic", "progressive", "synchronous", "external"]),
    visibleByDefault: z.boolean(),
  })
  .strict()
  .superRefine((layer, ctx) => {
    const authorities = new Set(layer.authorities);
    const operationalAuthorities = [
      "geometry",
      "collision",
      "navigation",
      "planning",
      "export",
    ] as const;
    const generatedForbidden = [
      "geometry",
      "collision",
      "navigation",
      "diagnostic_navigation",
      "semantics",
      "interaction",
      "planning",
      "export",
    ] as const;
    if (
      layer.truthClass === "GENERATED_CINEMATIC"
      && generatedForbidden.some((authority) => authorities.has(authority))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["authorities"],
        message: "GENERATED_CINEMATIC layers may own appearance or lighting only.",
      });
    }
    if (layer.kind === "Planner" && layer.truthClass !== "PROCEDURAL_PLANNER") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["truthClass"],
        message: "Planner layers must use PROCEDURAL_PLANNER truth.",
      });
    }
    if (
      (layer.truthClass === "CAPTURED" || layer.truthClass === "ENHANCED_CAPTURED")
      && operationalAuthorities.some((authority) => authorities.has(authority))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["authorities"],
        message: "Captured appearance cannot silently acquire operational authority.",
      });
    }
    if (
      (
        layer.spatialRegistration.type === "unregistered"
        || layer.spatialRegistration.type === "inspection_placement"
        || layer.spatialRegistration.type === "not_spatial"
      )
      && operationalAuthorities.some((authority) => authorities.has(authority))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["spatialRegistration"],
        message: "Unregistered, inspection-only, or non-spatial layers cannot own operational spatial authority.",
      });
    }
    if (
      layer.source.type === "fixture"
      && operationalAuthorities.some((authority) => authorities.has(authority))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["source"],
        message: "Fixture sources cannot own operational spatial authority.",
      });
    }
    if (layer.kind === "Planner") {
      if (layer.source.type !== "planner_state" || !authorities.has("planning")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["source"],
          message: "Planner layers require planner_state source and explicit planning authority.",
        });
      }
    } else if (layer.source.type === "planner_state") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["source"],
        message: "planner_state sources are valid only for Planner layers.",
      });
    }
    if (layer.kind === "Collision") {
      if (
        !authorities.has("collision")
        || (layer.truthClass !== "MEASURED" && layer.truthClass !== "RECONSTRUCTED")
        || (
          layer.spatialRegistration.type !== "transform_artifact"
          && layer.spatialRegistration.type !== "identity_in_rrf"
        )
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["authorities"],
          message: "Collision layers require measured/reconstructed truth and registered collision authority.",
        });
      }
    }
    if (authorities.has("collision") && layer.kind !== "Collision") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["authorities"],
        message: "Collision authority is valid only on an explicit Collision layer.",
      });
    }
    if (authorities.has("diagnostic_navigation") && layer.kind !== "StructuralProxy") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["authorities"],
        message: "Diagnostic navigation authority is valid only on a StructuralProxy layer.",
      });
    }
  });

export const RoomSceneManifestV0Schema = z
  .object({
    schemaVersion: z.literal(ROOM_SCENE_MANIFEST_V0_VERSION),
    manifestId: RuntimeManifestKeySchema,
    venueSlug: RuntimeManifestKeySchema,
    roomSlug: RuntimeManifestKeySchema,
    runtimePackageId: z.string().uuid().nullable(),
    createdAt: z.string().datetime({ offset: true }),
    sourceRights: z.array(SourceRightsV0Schema).default([]),
    qualityEvidence: z.array(QualityEvidenceV0Schema).min(1),
    visualAssetManifests: z.array(VisualAssetManifestV0Schema).default([]),
    transformArtifacts: z.array(TransformArtifactV0Schema).default([]),
    layerDescriptors: z.array(SpatialLayerDescriptorV0Schema).min(1),
    reconstructionProviders: z.array(ReconstructionProviderDescriptorV0Schema).default([]),
    enhancementProviders: z.array(EnhancementProviderDescriptorV0Schema).default([]),
    materialAttachments: z.array(MaterialAttachmentDescriptorV0Schema).default([]),
    lightingVariants: z.array(LightingVariantDescriptorV0Schema).default([]),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const collectIds = <T extends { readonly id: string }>(
      values: readonly T[],
      path: string,
    ): Set<string> => {
      const ids = new Set<string>();
      for (const [index, value] of values.entries()) {
        if (ids.has(value.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [path, index, "id"],
            message: `${path} IDs must be unique.`,
          });
        }
        ids.add(value.id);
      }
      return ids;
    };

    const rightsIds = collectIds(manifest.sourceRights, "sourceRights");
    const evidenceIds = collectIds(manifest.qualityEvidence, "qualityEvidence");
    const visualIds = collectIds(manifest.visualAssetManifests, "visualAssetManifests");
    const visualById = new Map(manifest.visualAssetManifests.map((visual) => [visual.id, visual]));
    const evidenceById = new Map(manifest.qualityEvidence.map((evidence) => [evidence.id, evidence]));
    const transformIds = collectIds(manifest.transformArtifacts, "transformArtifacts");
    const layerIds = collectIds(manifest.layerDescriptors, "layerDescriptors");
    collectIds(manifest.reconstructionProviders, "reconstructionProviders");
    collectIds(manifest.enhancementProviders, "enhancementProviders");
    collectIds(manifest.materialAttachments, "materialAttachments");
    collectIds(manifest.lightingVariants, "lightingVariants");

    for (const [index, visual] of manifest.visualAssetManifests.entries()) {
      if (!rightsIds.has(visual.sourceRightsId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["visualAssetManifests", index, "sourceRightsId"],
          message: "Visual assets must reference declared source rights.",
        });
      }
      for (const [evidenceIndex, evidenceId] of visual.qualityEvidenceIds.entries()) {
        if (!evidenceIds.has(evidenceId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["visualAssetManifests", index, "qualityEvidenceIds", evidenceIndex],
            message: "Visual assets must reference declared quality evidence.",
          });
        }
      }
    }

    for (const [index, layer] of manifest.layerDescriptors.entries()) {
      if (
        layer.source.type === "visual_asset_set"
        && !visualIds.has(layer.source.visualAssetManifestId)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["layerDescriptors", index, "source", "visualAssetManifestId"],
          message: "Layer source must reference a declared visual asset manifest.",
        });
      }
      if (layer.source.type === "visual_asset_set") {
        const visual = visualById.get(layer.source.visualAssetManifestId);
        if (visual !== undefined) {
          if (layer.truthClass !== visual.truthClass) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["layerDescriptors", index, "truthClass"],
              message: "A visual-asset layer must preserve its asset manifest truth class.",
            });
          }
          if (layer.sourceRightsId !== visual.sourceRightsId) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["layerDescriptors", index, "sourceRightsId"],
              message: "A visual-asset layer must preserve its asset manifest source-rights record.",
            });
          }
          const layerEvidence = new Set(layer.qualityEvidenceIds);
          for (const evidenceId of visual.qualityEvidenceIds) {
            if (!layerEvidence.has(evidenceId)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["layerDescriptors", index, "qualityEvidenceIds"],
                message: "A visual-asset layer must retain all asset-manifest quality evidence.",
              });
            }
          }
          if (
            (visual.format === "lcc"
              || visual.format === "lcc2"
              || visual.format === "sog"
              || visual.format === "spz")
            && layer.authorities.some(
              (authority) => authority !== "appearance" && authority !== "lighting",
            )
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["layerDescriptors", index, "authorities"],
              message: "Radiance/splat visual assets may own appearance or lighting only; structural and collision authority requires a separate non-radiance artifact.",
            });
          }
        }
      }
      if (layer.sourceRightsId !== undefined && layer.sourceRightsId !== null && !rightsIds.has(layer.sourceRightsId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["layerDescriptors", index, "sourceRightsId"],
          message: "Layer must reference declared source rights.",
        });
      }
      for (const [evidenceIndex, evidenceId] of layer.qualityEvidenceIds.entries()) {
        if (!evidenceIds.has(evidenceId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["layerDescriptors", index, "qualityEvidenceIds", evidenceIndex],
            message: "Layer must reference declared quality evidence.",
          });
        }
      }
      if (
        layer.spatialRegistration.type === "transform_artifact"
        && !transformIds.has(layer.spatialRegistration.transformArtifactId)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["layerDescriptors", index, "spatialRegistration", "transformArtifactId"],
          message: "Layer must reference a declared TransformArtifactV0.",
        });
      }
      const operationalAuthorities = new Set([
        "geometry",
        "collision",
        "navigation",
        "planning",
        "export",
      ] as const);
      const declaredOperationalAuthorities = layer.authorities.filter(
        (authority) => operationalAuthorities.has(
          authority as "geometry" | "collision" | "navigation" | "planning" | "export",
        ),
      );
      if (declaredOperationalAuthorities.length > 0) {
        const requiredConfidence = declaredOperationalAuthorities.some(
          (authority) => authority !== "geometry",
        )
          ? new Set(["operations_grade", "survey_grade"] as const)
          : new Set(["layout_grade", "operations_grade", "survey_grade"] as const);
        const hasReviewedOperationalEvidence = layer.qualityEvidenceIds.some((evidenceId) => {
          const evidence = evidenceById.get(evidenceId);
          return evidence?.status === "human_reviewed"
            && requiredConfidence.has(
              evidence.confidence as "layout_grade" | "operations_grade" | "survey_grade",
            );
        });
        if (!hasReviewedOperationalEvidence) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["layerDescriptors", index, "qualityEvidenceIds"],
            message: "Operational spatial authority requires human-reviewed evidence at the appropriate metric grade.",
          });
        }
      }
    }

    const validateSupplement = (
      supplement:
        | (typeof manifest.materialAttachments)[number]
        | (typeof manifest.lightingVariants)[number],
      index: number,
      collection: "materialAttachments" | "lightingVariants",
    ): void => {
      for (const [targetIndex, targetLayerId] of supplement.targetLayerIds.entries()) {
        if (!layerIds.has(targetLayerId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [collection, index, "targetLayerIds", targetIndex],
            message: "Supplemental scene records must target declared RoomScene layers.",
          });
        }
      }
      if (
        supplement.sourceRightsId !== undefined
        && supplement.sourceRightsId !== null
        && !rightsIds.has(supplement.sourceRightsId)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [collection, index, "sourceRightsId"],
          message: "Supplemental scene records must reference declared source rights.",
        });
      }
      for (const [evidenceIndex, evidenceId] of supplement.qualityEvidenceIds.entries()) {
        if (!evidenceIds.has(evidenceId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [collection, index, "qualityEvidenceIds", evidenceIndex],
            message: "Supplemental scene records must reference declared quality evidence.",
          });
        }
      }
      if (
        supplement.spatialRegistration.type === "transform_artifact"
        && !transformIds.has(supplement.spatialRegistration.transformArtifactId)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [collection, index, "spatialRegistration", "transformArtifactId"],
          message: "Supplemental scene records must reference a declared TransformArtifactV0.",
        });
      }
      if (supplement.source.type === "visual_asset_set") {
        const visual = visualById.get(supplement.source.visualAssetManifestId);
        if (visual === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [collection, index, "source", "visualAssetManifestId"],
            message: "Supplemental visual sources must reference a declared visual asset manifest.",
          });
          return;
        }
        if (supplement.truthClass !== visual.truthClass) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [collection, index, "truthClass"],
            message: "Supplemental records must preserve visual-asset truth class.",
          });
        }
        if (supplement.sourceRightsId !== visual.sourceRightsId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [collection, index, "sourceRightsId"],
            message: "Supplemental records must preserve visual-asset source rights.",
          });
        }
        const evidence = new Set(supplement.qualityEvidenceIds);
        if (visual.qualityEvidenceIds.some((evidenceId) => !evidence.has(evidenceId))) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [collection, index, "qualityEvidenceIds"],
            message: "Supplemental records must retain visual-asset quality evidence.",
          });
        }
      }
    };

    manifest.materialAttachments.forEach((attachment, index) => {
      validateSupplement(attachment, index, "materialAttachments");
    });
    manifest.lightingVariants.forEach((variant, index) => {
      validateSupplement(variant, index, "lightingVariants");
    });
  });

export type SceneTruthClass = z.infer<typeof SceneTruthClassSchema>;
export type RoomSceneLayerKind = z.infer<typeof RoomSceneLayerKindSchema>;
export type RoomSceneLayerAuthority = z.infer<typeof RoomSceneLayerAuthoritySchema>;
export type RoomSceneIntent = z.infer<typeof RoomSceneIntentSchema>;
export type ReconstructionProviderKind = z.infer<typeof ReconstructionProviderKindSchema>;
export type EnhancementProviderKind = z.infer<typeof EnhancementProviderKindSchema>;
export type MaterialChannel = z.infer<typeof MaterialChannelSchema>;
export type LightingVariantKind = z.infer<typeof LightingVariantKindSchema>;
export type SourceRightsScope = z.infer<typeof SourceRightsScopeSchema>;
export type SourceRightsAdditionalPermission = z.infer<typeof SourceRightsAdditionalPermissionSchema>;
export type SourceRightsV0 = z.infer<typeof SourceRightsV0Schema>;
export type SourceRightsLedgerV0 = z.infer<typeof SourceRightsLedgerV0Schema>;
export type QualityEvidenceV0 = z.infer<typeof QualityEvidenceV0Schema>;
export type VisualAssetMemberV0 = z.infer<typeof VisualAssetMemberV0Schema>;
export type VisualAssetManifestV0 = z.infer<typeof VisualAssetManifestV0Schema>;
export type RoomSceneLayerSource = z.infer<typeof RoomSceneLayerSourceSchema>;
export type RoomSceneSpatialRegistration = z.infer<typeof RoomSceneSpatialRegistrationSchema>;
export type ReconstructionProviderDescriptorV0 = z.infer<typeof ReconstructionProviderDescriptorV0Schema>;
export type EnhancementProviderDescriptorV0 = z.infer<typeof EnhancementProviderDescriptorV0Schema>;
export type MaterialAttachmentDescriptorV0 = z.infer<typeof MaterialAttachmentDescriptorV0Schema>;
export type LightingVariantDescriptorV0 = z.infer<typeof LightingVariantDescriptorV0Schema>;
export type SpatialLayerDescriptorV0 = z.infer<typeof SpatialLayerDescriptorV0Schema>;
export type RoomSceneManifestV0Input = z.input<typeof RoomSceneManifestV0Schema>;
export type RoomSceneManifestV0 = z.infer<typeof RoomSceneManifestV0Schema>;
