import {
  FOUNDRY_INPUT_TYPES,
  FoundryIngestManifestV0Schema,
  FoundryInputTypeSchema,
  FoundryRelativePathSchema,
  FoundryUtcInstantSchema,
  RuntimeManifestKeySchema,
  RuntimeSha256Schema,
  computeFoundryIngestManifestSha256,
  type FoundryIngestManifestV0,
  type FoundryInputType,
} from "@omnitwin/types";
import { z } from "zod";
import {
  domainSeparatedSha256,
  stableCanonicalJson,
  toCanonicalJson,
} from "./canonical-json.js";
import { compareCanonicalStrings } from "./canonical-order.js";
import { FoundryIntegrityError } from "./errors.js";
import { FOUNDRY_XBIN_OFFICIAL_EXPORT_NEXT_ACTION } from "./source-facts.js";

export const FOUNDRY_ADAPTER_CAPABILITY_ASSESSMENT_V0 =
  "omnitwin.foundry.adapter-capability-assessment.v0";
export const FOUNDRY_ADAPTER_HOST_CAPABILITY_INVENTORY_V0 =
  "omnitwin.foundry.adapter-host-capability-inventory.v0";
export const FOUNDRY_ADAPTER_CAPABILITY_ASSESSMENT_V0_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_ADAPTER_CAPABILITY_ASSESSMENT_V0";
export const FOUNDRY_ADAPTER_HOST_CAPABILITY_INVENTORY_V0_DIGEST_DOMAIN =
  "VENVIEWER_FOUNDRY_ADAPTER_HOST_CAPABILITY_INVENTORY_V0";

export const FOUNDRY_ADAPTER_CAPABILITY_ASSESSMENT_MEANING =
  "deterministic_adapter_honesty_gate";
export const FOUNDRY_ADAPTER_CAPABILITY_ASSESSMENT_BASIS =
  "exact_ingest_manifest_host_inventory_and_repository_implementation_truth";
export const FOUNDRY_ADAPTER_CAPABILITY_ASSESSMENT_DISCLAIMER =
  "This assessment reports implemented inspection and processing seams plus current blockers. It does not inspect bytes, spawn tools, grant rights, authorize execution, approve accuracy, or create a runtime package.";

const SHA256_HEX = /^[a-f0-9]{64}$/u;

export const FOUNDRY_ADAPTER_HOST_DEPENDENCY_IDS = [
  "pye57_read_only_metadata_probe",
  "pye57_cartesian_geometry_reader",
  "gltf_transform_core",
  "gltf_validator",
  "meshoptimizer",
] as const;
export const FoundryAdapterHostDependencyIdSchema = z.enum(
  FOUNDRY_ADAPTER_HOST_DEPENDENCY_IDS,
);
export type FoundryAdapterHostDependencyId = z.infer<
  typeof FoundryAdapterHostDependencyIdSchema
>;

const EXPECTED_DEPENDENCY_VERSION: Readonly<
  Record<FoundryAdapterHostDependencyId, string>
> = {
  pye57_read_only_metadata_probe: "0.4.19",
  pye57_cartesian_geometry_reader: "0.4.19",
  gltf_transform_core: "4.3.0",
  gltf_validator: "2.0.0-dev.3.10",
  meshoptimizer: "1.2.0",
};

const HostDependencySchema = z
  .object({
    id: FoundryAdapterHostDependencyIdSchema,
    status: z.enum(["available", "missing", "unverified"]),
    version: z.string().trim().min(1).max(100).nullable(),
  })
  .strict()
  .superRefine((dependency, ctx) => {
    if (dependency.status === "available") {
      if (dependency.version !== EXPECTED_DEPENDENCY_VERSION[dependency.id]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["version"],
          message: `available ${dependency.id} must use the reviewed version ${EXPECTED_DEPENDENCY_VERSION[dependency.id]}`,
        });
      }
      return;
    }
    if (dependency.version !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["version"],
        message: "missing or unverified dependencies cannot assert a version",
      });
    }
  });

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export const FoundryAdapterHostCapabilityInventoryV0Schema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_ADAPTER_HOST_CAPABILITY_INVENTORY_V0),
    hostId: RuntimeManifestKeySchema,
    observedAt: FoundryUtcInstantSchema,
    platform: z.enum(["win32", "linux", "darwin", "other"]),
    dependencies: z
      .array(HostDependencySchema)
      .length(FOUNDRY_ADAPTER_HOST_DEPENDENCY_IDS.length),
  })
  .strict()
  .superRefine((inventory, ctx) => {
    if (
      !sameStrings(
        inventory.dependencies.map((dependency) => dependency.id),
        FOUNDRY_ADAPTER_HOST_DEPENDENCY_IDS,
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dependencies"],
        message:
          "host dependencies must cover every known capability exactly once in canonical order",
      });
    }
  });
export type FoundryAdapterHostCapabilityInventoryV0 = z.infer<
  typeof FoundryAdapterHostCapabilityInventoryV0Schema
>;

export function computeFoundryAdapterHostCapabilityInventorySha256(
  inventoryInput: unknown,
): string {
  const inventory =
    FoundryAdapterHostCapabilityInventoryV0Schema.parse(inventoryInput);
  return domainSeparatedSha256(
    FOUNDRY_ADAPTER_HOST_CAPABILITY_INVENTORY_V0_DIGEST_DOMAIN,
    toCanonicalJson(inventory),
  );
}

export const FOUNDRY_ADAPTER_STRUCTURAL_INSPECTION_STATES = [
  "implemented",
  "detection_only",
  "blocked_vendor_format",
] as const;
export const FoundryAdapterStructuralInspectionStateSchema = z.enum(
  FOUNDRY_ADAPTER_STRUCTURAL_INSPECTION_STATES,
);

export const FOUNDRY_ADAPTER_LOCAL_PROCESSING_STATES = [
  "implemented",
  "subset_core_available_exact_asset_unverified",
  "not_implemented",
] as const;
export const FoundryAdapterLocalProcessingStateSchema = z.enum(
  FOUNDRY_ADAPTER_LOCAL_PROCESSING_STATES,
);

export const FOUNDRY_ADAPTER_PRODUCTION_REACHABILITY_STATES = [
  "production_reachable",
  "activation_missing",
  "worker_missing",
  "official_vendor_export_or_sdk_required",
] as const;
export const FoundryAdapterProductionReachabilityStateSchema = z.enum(
  FOUNDRY_ADAPTER_PRODUCTION_REACHABILITY_STATES,
);

type StructuralInspectionState = z.infer<
  typeof FoundryAdapterStructuralInspectionStateSchema
>;
type LocalProcessingState = z.infer<
  typeof FoundryAdapterLocalProcessingStateSchema
>;
type ProductionReachabilityState = z.infer<
  typeof FoundryAdapterProductionReachabilityStateSchema
>;

interface AdapterProfile {
  readonly structuralInspection: StructuralInspectionState;
  readonly localDeterministicProcessing: LocalProcessingState;
  readonly productionReachability: ProductionReachabilityState;
  readonly dependencies: readonly FoundryAdapterHostDependencyId[];
  readonly vendorRequirement:
    | "none"
    | "xgrids_export"
    | "vendor_scene_export_or_sdk";
}

const STRUCTURAL_ONLY: AdapterProfile = {
  structuralInspection: "implemented",
  localDeterministicProcessing: "not_implemented",
  productionReachability: "worker_missing",
  dependencies: [],
  vendorRequirement: "none",
};

const DETECTION_ONLY: AdapterProfile = {
  structuralInspection: "detection_only",
  localDeterministicProcessing: "not_implemented",
  productionReachability: "worker_missing",
  dependencies: [],
  vendorRequirement: "none",
};

const E57_EXACT_ASSET_UNVERIFIED: AdapterProfile = {
  structuralInspection: "implemented",
  localDeterministicProcessing: "not_implemented",
  productionReachability: "worker_missing",
  dependencies: [
    "pye57_read_only_metadata_probe",
    "pye57_cartesian_geometry_reader",
  ],
  vendorRequirement: "none",
};

const PROFILE_BY_INPUT_TYPE = {
  matterport_e57: E57_EXACT_ASSET_UNVERIFIED,
  matterpak_bundle: DETECTION_ONLY,
  generic_e57: E57_EXACT_ASSET_UNVERIFIED,
  las_laz: DETECTION_ONLY,
  xyz_point_cloud: DETECTION_ONLY,
  ply_point_cloud: STRUCTURAL_ONLY,
  matterport_panorama: STRUCTURAL_ONLY,
  dslr_image: STRUCTURAL_ONLY,
  generic_image: STRUCTURAL_ONLY,
  panorama_360: STRUCTURAL_ONLY,
  phone_image: STRUCTURAL_ONLY,
  drone_media: STRUCTURAL_ONLY,
  video: STRUCTURAL_ONLY,
  rgbd: DETECTION_ONLY,
  sensor_log_mcap: DETECTION_ONLY,
  imu: DETECTION_ONLY,
  gnss_rtk: DETECTION_ONLY,
  xgrids_xbin: {
    structuralInspection: "blocked_vendor_format",
    localDeterministicProcessing: "not_implemented",
    productionReachability: "official_vendor_export_or_sdk_required",
    dependencies: [],
    vendorRequirement: "xgrids_export",
  },
  lcc: {
    ...DETECTION_ONLY,
    productionReachability: "official_vendor_export_or_sdk_required",
    vendorRequirement: "vendor_scene_export_or_sdk",
  },
  lcc2: {
    ...DETECTION_ONLY,
    productionReachability: "official_vendor_export_or_sdk_required",
    vendorRequirement: "vendor_scene_export_or_sdk",
  },
  spz: STRUCTURAL_ONLY,
  sog: STRUCTURAL_ONLY,
  gaussian_ply: STRUCTURAL_ONLY,
  obj: STRUCTURAL_ONLY,
  fbx: DETECTION_ONLY,
  glb_gltf: {
    structuralInspection: "implemented",
    localDeterministicProcessing:
      "subset_core_available_exact_asset_unverified",
    productionReachability: "activation_missing",
    dependencies: ["gltf_transform_core", "gltf_validator", "meshoptimizer"],
    vendorRequirement: "none",
  },
  floor_plan: DETECTION_ONLY,
  cad_bim: DETECTION_ONLY,
  openusd: DETECTION_ONLY,
  calibration_bundle: STRUCTURAL_ONLY,
  trajectory: STRUCTURAL_ONLY,
  control_network: DETECTION_ONLY,
  colmap_database: DETECTION_ONLY,
  colmap_sparse_model: DETECTION_ONLY,
  manual_evidence: DETECTION_ONLY,
  evidence_record: DETECTION_ONLY,
} as const satisfies Readonly<Record<FoundryInputType, AdapterProfile>>;

export const FOUNDRY_ADAPTER_CAPABILITY_INPUT_TYPE_COVERAGE = [
  ...FOUNDRY_INPUT_TYPES,
] as const;

export const FOUNDRY_ADAPTER_CAPABILITY_FINDING_CATEGORIES = [
  "rights_review_or_block",
  "official_vendor_export_or_sdk_required",
  "unsupported_variant",
  "processing_worker_missing",
  "missing_dependency",
  "execution_activation_missing",
  "structural_inspection_implemented",
  "local_deterministic_processing_implemented",
] as const;
export const FoundryAdapterCapabilityFindingCategorySchema = z.enum(
  FOUNDRY_ADAPTER_CAPABILITY_FINDING_CATEGORIES,
);
export type FoundryAdapterCapabilityFindingCategory = z.infer<
  typeof FoundryAdapterCapabilityFindingCategorySchema
>;

export const FOUNDRY_ADAPTER_CAPABILITY_FINDING_CODES = [
  "ASSET_RIGHTS_BLOCKED",
  "ASSET_RIGHTS_REVIEW_REQUIRED",
  "XGRIDS_XBIN_OFFICIAL_EXPORT_REQUIRED",
  "VENDOR_SCENE_EXPORT_OR_SDK_REQUIRED",
  "OFFICIAL_API_SDK_REQUIRED",
  "ASSET_ACCESS_BLOCKED_TECHNICAL",
  "ASSET_BYTES_UNAVAILABLE_METADATA_ONLY",
  "ASSET_ACCESS_UNKNOWN",
  "STRUCTURAL_INSPECTION_NOT_IMPLEMENTED",
  "LOCAL_DETERMINISTIC_PROCESSING_NOT_IMPLEMENTED",
  "E57_GEOMETRY_EXACT_ASSET_COMPATIBILITY_UNVERIFIED",
  "GLB_NORMALIZATION_EXACT_ASSET_COMPATIBILITY_UNVERIFIED",
  "HOST_DEPENDENCY_MISSING",
  "HOST_DEPENDENCY_UNVERIFIED",
  "GLB_NORMALIZATION_EXECUTION_ACTIVATION_MISSING",
  "E57_GEOMETRY_EXECUTION_ACTIVATION_MISSING",
  "STRUCTURAL_INSPECTION_IMPLEMENTED",
  "LOCAL_E57_GEOMETRY_CORE_IMPLEMENTED",
  "LOCAL_GLB_NORMALIZATION_CORE_IMPLEMENTED",
] as const;
export const FoundryAdapterCapabilityFindingCodeSchema = z.enum(
  FOUNDRY_ADAPTER_CAPABILITY_FINDING_CODES,
);
export type FoundryAdapterCapabilityFindingCode = z.infer<
  typeof FoundryAdapterCapabilityFindingCodeSchema
>;

const FINDING_CATEGORY_BY_CODE = {
  ASSET_RIGHTS_BLOCKED: "rights_review_or_block",
  ASSET_RIGHTS_REVIEW_REQUIRED: "rights_review_or_block",
  XGRIDS_XBIN_OFFICIAL_EXPORT_REQUIRED:
    "official_vendor_export_or_sdk_required",
  VENDOR_SCENE_EXPORT_OR_SDK_REQUIRED: "official_vendor_export_or_sdk_required",
  OFFICIAL_API_SDK_REQUIRED: "official_vendor_export_or_sdk_required",
  ASSET_ACCESS_BLOCKED_TECHNICAL: "unsupported_variant",
  ASSET_BYTES_UNAVAILABLE_METADATA_ONLY: "unsupported_variant",
  ASSET_ACCESS_UNKNOWN: "unsupported_variant",
  STRUCTURAL_INSPECTION_NOT_IMPLEMENTED: "unsupported_variant",
  LOCAL_DETERMINISTIC_PROCESSING_NOT_IMPLEMENTED: "processing_worker_missing",
  E57_GEOMETRY_EXACT_ASSET_COMPATIBILITY_UNVERIFIED: "unsupported_variant",
  GLB_NORMALIZATION_EXACT_ASSET_COMPATIBILITY_UNVERIFIED: "unsupported_variant",
  HOST_DEPENDENCY_MISSING: "missing_dependency",
  HOST_DEPENDENCY_UNVERIFIED: "missing_dependency",
  GLB_NORMALIZATION_EXECUTION_ACTIVATION_MISSING:
    "execution_activation_missing",
  E57_GEOMETRY_EXECUTION_ACTIVATION_MISSING: "execution_activation_missing",
  STRUCTURAL_INSPECTION_IMPLEMENTED: "structural_inspection_implemented",
  LOCAL_E57_GEOMETRY_CORE_IMPLEMENTED:
    "local_deterministic_processing_implemented",
  LOCAL_GLB_NORMALIZATION_CORE_IMPLEMENTED:
    "local_deterministic_processing_implemented",
} as const satisfies Readonly<
  Record<
    FoundryAdapterCapabilityFindingCode,
    FoundryAdapterCapabilityFindingCategory
  >
>;

const FINDING_PRIORITY_BY_CODE = {
  ASSET_RIGHTS_BLOCKED: 0,
  ASSET_RIGHTS_REVIEW_REQUIRED: 1,
  XGRIDS_XBIN_OFFICIAL_EXPORT_REQUIRED: 10,
  VENDOR_SCENE_EXPORT_OR_SDK_REQUIRED: 11,
  OFFICIAL_API_SDK_REQUIRED: 12,
  ASSET_ACCESS_BLOCKED_TECHNICAL: 20,
  ASSET_BYTES_UNAVAILABLE_METADATA_ONLY: 21,
  ASSET_ACCESS_UNKNOWN: 22,
  STRUCTURAL_INSPECTION_NOT_IMPLEMENTED: 24,
  LOCAL_DETERMINISTIC_PROCESSING_NOT_IMPLEMENTED: 25,
  E57_GEOMETRY_EXACT_ASSET_COMPATIBILITY_UNVERIFIED: 26,
  GLB_NORMALIZATION_EXACT_ASSET_COMPATIBILITY_UNVERIFIED: 35,
  HOST_DEPENDENCY_MISSING: 30,
  HOST_DEPENDENCY_UNVERIFIED: 31,
  GLB_NORMALIZATION_EXECUTION_ACTIVATION_MISSING: 40,
  E57_GEOMETRY_EXECUTION_ACTIVATION_MISSING: 41,
  STRUCTURAL_INSPECTION_IMPLEMENTED: 50,
  LOCAL_E57_GEOMETRY_CORE_IMPLEMENTED: 59,
  LOCAL_GLB_NORMALIZATION_CORE_IMPLEMENTED: 60,
} as const satisfies Readonly<
  Record<FoundryAdapterCapabilityFindingCode, number>
>;

function findingSeverity(
  code: FoundryAdapterCapabilityFindingCode,
): "information" | "blocker" {
  return code === "STRUCTURAL_INSPECTION_IMPLEMENTED" ||
    code === "LOCAL_E57_GEOMETRY_CORE_IMPLEMENTED" ||
    code === "LOCAL_GLB_NORMALIZATION_CORE_IMPLEMENTED"
    ? "information"
    : "blocker";
}

const FindingSchema = z
  .object({
    category: FoundryAdapterCapabilityFindingCategorySchema,
    severity: z.enum(["information", "blocker"]),
    code: FoundryAdapterCapabilityFindingCodeSchema,
    dependencyId: FoundryAdapterHostDependencyIdSchema.nullable(),
    message: z.string().trim().min(1).max(1_000),
    nextAction: z.string().trim().min(1).max(1_000),
  })
  .strict()
  .superRefine((finding, ctx) => {
    if (finding.category !== FINDING_CATEGORY_BY_CODE[finding.code]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["category"],
        message: "finding category must match its stable code",
      });
    }
    if (finding.severity !== findingSeverity(finding.code)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["severity"],
        message: "finding severity must match its stable code",
      });
    }
    const dependencyFinding =
      finding.code === "HOST_DEPENDENCY_MISSING" ||
      finding.code === "HOST_DEPENDENCY_UNVERIFIED";
    if (dependencyFinding !== (finding.dependencyId !== null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dependencyId"],
        message:
          "only dependency findings may carry a host dependency identifier",
      });
    }
  });
type Finding = z.infer<typeof FindingSchema>;

function compareFindings(left: Finding, right: Finding): number {
  const priority =
    FINDING_PRIORITY_BY_CODE[left.code] - FINDING_PRIORITY_BY_CODE[right.code];
  if (priority !== 0) return priority;
  return compareCanonicalStrings(
    left.dependencyId ?? "",
    right.dependencyId ?? "",
  );
}

const AssetOutcomeSchema = z
  .object({
    assetId: RuntimeManifestKeySchema,
    sourceRootId: RuntimeManifestKeySchema,
    relativePath: FoundryRelativePathSchema,
    sha256: RuntimeSha256Schema,
    inputType: FoundryInputTypeSchema,
    accessState: z.enum([
      "direct",
      "official_export",
      "official_api",
      "metadata_only",
      "blocked_technical",
      "blocked_legal",
      "unknown",
    ]),
    structuralInspection: FoundryAdapterStructuralInspectionStateSchema,
    localDeterministicProcessing: FoundryAdapterLocalProcessingStateSchema,
    productionReachability: FoundryAdapterProductionReachabilityStateSchema,
    status: z.enum([
      "blocked",
      "review_required",
      "not_ready",
      "production_ready",
    ]),
    primaryFindingCode: FoundryAdapterCapabilityFindingCodeSchema.nullable(),
    nextAction: z.string().trim().min(1).max(1_000),
    findings: z.array(FindingSchema).min(1).max(32),
  })
  .strict()
  .superRefine((outcome, ctx) => {
    const profile = PROFILE_BY_INPUT_TYPE[outcome.inputType];
    if (
      outcome.structuralInspection !== profile.structuralInspection ||
      outcome.localDeterministicProcessing !==
        profile.localDeterministicProcessing ||
      outcome.productionReachability !== profile.productionReachability
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["structuralInspection"],
        message: "adapter states must match repository implementation truth",
      });
    }
    const sorted = [...outcome.findings].sort(compareFindings);
    if (JSON.stringify(sorted) !== JSON.stringify(outcome.findings)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["findings"],
        message: "findings must use deterministic precedence order",
      });
    }
    const keys = outcome.findings.map(
      (finding) => `${finding.code}:${finding.dependencyId ?? ""}`,
    );
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["findings"],
        message: "findings must be unique by code and dependency",
      });
    }
    const firstBlocker = outcome.findings.find(
      (finding) => finding.severity === "blocker",
    );
    if (outcome.primaryFindingCode !== (firstBlocker?.code ?? null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["primaryFindingCode"],
        message: "primary finding must be the first blocker by precedence",
      });
    }
    if (outcome.status === "production_ready" && firstBlocker !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message: "a production-ready asset cannot retain a blocker",
      });
    }
    if (outcome.status !== "production_ready" && firstBlocker === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message: "a non-ready asset must identify a blocker",
      });
    }
    if (
      outcome.status === "production_ready" &&
      outcome.productionReachability !== "production_reachable"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["status"],
        message: "success requires a production-reachable worker",
      });
    }
  });
export type FoundryAdapterCapabilityAssetOutcomeV0 = z.infer<
  typeof AssetOutcomeSchema
>;

const SummarySchema = z
  .object({
    assetCount: z.number().int().nonnegative(),
    structuralInspectionImplementedCount: z.number().int().nonnegative(),
    localDeterministicProcessingImplementedCount: z
      .number()
      .int()
      .nonnegative(),
    blockedCount: z.number().int().nonnegative(),
    reviewRequiredCount: z.number().int().nonnegative(),
    notReadyCount: z.number().int().nonnegative(),
    productionReadyCount: z.number().int().nonnegative(),
    missingDependencyAssetCount: z.number().int().nonnegative(),
    vendorExportOrSdkRequiredAssetCount: z.number().int().nonnegative(),
    unsupportedVariantAssetCount: z.number().int().nonnegative(),
    processingWorkerMissingAssetCount: z.number().int().nonnegative(),
    activationMissingAssetCount: z.number().int().nonnegative(),
  })
  .strict();

const AssessmentBaseSchema = z
  .object({
    schemaVersion: z.literal(FOUNDRY_ADAPTER_CAPABILITY_ASSESSMENT_V0),
    meaning: z.literal(FOUNDRY_ADAPTER_CAPABILITY_ASSESSMENT_MEANING),
    basis: z.literal(FOUNDRY_ADAPTER_CAPABILITY_ASSESSMENT_BASIS),
    disclaimer: z.literal(FOUNDRY_ADAPTER_CAPABILITY_ASSESSMENT_DISCLAIMER),
    manifestSha256: RuntimeSha256Schema,
    hostCapabilityInventorySha256: z.string().regex(SHA256_HEX),
    hostId: RuntimeManifestKeySchema,
    hostObservedAt: FoundryUtcInstantSchema,
    authority: z.literal("none"),
    execution: z.literal("not_authorized"),
    status: z.enum(["blocked", "not_ready", "production_ready"]),
    summary: SummarySchema,
    assets: z.array(AssetOutcomeSchema).min(1).max(100_000),
    assessmentSha256: z.string().regex(SHA256_HEX),
  })
  .strict();
type AssessmentWithoutValidation = z.infer<typeof AssessmentBaseSchema>;

function assessmentDigest(value: AssessmentWithoutValidation): string {
  const { assessmentSha256: _assessmentSha256, ...payload } = value;
  return domainSeparatedSha256(
    FOUNDRY_ADAPTER_CAPABILITY_ASSESSMENT_V0_DIGEST_DOMAIN,
    toCanonicalJson(payload),
  );
}

function summaryFor(
  assets: readonly FoundryAdapterCapabilityAssetOutcomeV0[],
): z.infer<typeof SummarySchema> {
  const hasCategory = (
    asset: FoundryAdapterCapabilityAssetOutcomeV0,
    category: FoundryAdapterCapabilityFindingCategory,
  ): boolean => asset.findings.some((finding) => finding.category === category);
  return {
    assetCount: assets.length,
    structuralInspectionImplementedCount: assets.filter(
      (asset) => asset.structuralInspection === "implemented",
    ).length,
    localDeterministicProcessingImplementedCount: assets.filter(
      (asset) => asset.localDeterministicProcessing === "implemented",
    ).length,
    blockedCount: assets.filter((asset) => asset.status === "blocked").length,
    reviewRequiredCount: assets.filter(
      (asset) => asset.status === "review_required",
    ).length,
    notReadyCount: assets.filter((asset) => asset.status === "not_ready")
      .length,
    productionReadyCount: assets.filter(
      (asset) => asset.status === "production_ready",
    ).length,
    missingDependencyAssetCount: assets.filter((asset) =>
      hasCategory(asset, "missing_dependency"),
    ).length,
    vendorExportOrSdkRequiredAssetCount: assets.filter((asset) =>
      hasCategory(asset, "official_vendor_export_or_sdk_required"),
    ).length,
    unsupportedVariantAssetCount: assets.filter((asset) =>
      hasCategory(asset, "unsupported_variant"),
    ).length,
    processingWorkerMissingAssetCount: assets.filter((asset) =>
      hasCategory(asset, "processing_worker_missing"),
    ).length,
    activationMissingAssetCount: assets.filter((asset) =>
      hasCategory(asset, "execution_activation_missing"),
    ).length,
  };
}

function validateAssessment(
  value: AssessmentWithoutValidation,
  ctx: z.RefinementCtx,
): void {
  const sortedAssets = [...value.assets].sort((left, right) =>
    compareCanonicalStrings(left.assetId, right.assetId),
  );
  if (JSON.stringify(sortedAssets) !== JSON.stringify(value.assets)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["assets"],
      message:
        "asset outcomes must be unique and ordered by canonical asset ID",
    });
  }
  if (
    new Set(value.assets.map((asset) => asset.assetId)).size !==
    value.assets.length
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["assets"],
      message: "asset outcomes must have unique asset IDs",
    });
  }
  const expectedSummary = summaryFor(value.assets);
  if (JSON.stringify(expectedSummary) !== JSON.stringify(value.summary)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["summary"],
      message: "assessment summary must match the per-asset outcomes",
    });
  }
  const expectedStatus = value.assets.every(
    (asset) => asset.status === "production_ready",
  )
    ? "production_ready"
    : value.assets.some(
          (asset) =>
            asset.status === "blocked" || asset.status === "review_required",
        )
      ? "blocked"
      : "not_ready";
  if (value.status !== expectedStatus) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["status"],
      message: "assessment status must match the per-asset outcomes",
    });
  }
  if (value.assessmentSha256 !== assessmentDigest(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["assessmentSha256"],
      message: "assessment digest does not match the canonical payload",
    });
  }
}

export const FoundryAdapterCapabilityAssessmentV0Schema =
  AssessmentBaseSchema.superRefine(validateAssessment);
export type FoundryAdapterCapabilityAssessmentV0 = z.infer<
  typeof FoundryAdapterCapabilityAssessmentV0Schema
>;

function finding(
  code: FoundryAdapterCapabilityFindingCode,
  message: string,
  nextAction: string,
  dependencyId: FoundryAdapterHostDependencyId | null = null,
): Finding {
  return FindingSchema.parse({
    category: FINDING_CATEGORY_BY_CODE[code],
    severity: findingSeverity(code),
    code,
    dependencyId,
    message,
    nextAction,
  });
}

type InputAsset = FoundryIngestManifestV0["assets"][number];

function rightsFinding(
  asset: InputAsset,
  legalReviewState: FoundryIngestManifestV0["legalReviewState"],
): Finding | null {
  const prohibited =
    asset.rights.commercialUse === "prohibited" ||
    asset.rights.modelTrainingUse === "prohibited" ||
    asset.rights.redistribution === "prohibited";
  if (
    legalReviewState === "blocked" ||
    asset.accessState === "blocked_legal" ||
    prohibited
  ) {
    return finding(
      "ASSET_RIGHTS_BLOCKED",
      `Asset ${asset.id} is legally blocked or declares a prohibited use; no adapter or dependency may process it.`,
      "Exclude the asset or obtain a new purpose-scoped rights decision and rebuild the exact ingest manifest.",
    );
  }
  const incomplete =
    asset.rights.basis === "unknown" ||
    asset.rights.termsReviewedAt === null ||
    asset.rights.termsReference === null ||
    asset.rights.commercialUse !== "allowed" ||
    asset.rights.modelTrainingUse !== "allowed" ||
    asset.rights.redistribution !== "allowed";
  if (legalReviewState !== "approved" || incomplete) {
    return finding(
      "ASSET_RIGHTS_REVIEW_REQUIRED",
      `Asset ${asset.id} lacks a complete approved rights decision for deterministic processing and redistribution.`,
      "Complete the purpose-scoped legal review for this exact asset digest, then issue a new approved manifest.",
    );
  }
  return null;
}

function accessFindings(asset: InputAsset): Finding[] {
  switch (asset.accessState) {
    case "direct":
    case "official_export":
    case "blocked_legal":
      return [];
    case "official_api":
      return [
        finding(
          "OFFICIAL_API_SDK_REQUIRED",
          `Asset ${asset.id} is available only through an official API, and no reviewed local SDK adapter is implemented.`,
          "Obtain a rights-cleared immutable official export, or implement and review an exact SDK adapter before reassessment.",
        ),
      ];
    case "metadata_only":
      return [
        finding(
          "ASSET_BYTES_UNAVAILABLE_METADATA_ONLY",
          `Asset ${asset.id} exposes metadata only; an adapter cannot inspect or process the source bytes.`,
          "Acquire a rights-cleared immutable source byte stream or official export and rebuild the manifest.",
        ),
      ];
    case "blocked_technical":
      return [
        finding(
          "ASSET_ACCESS_BLOCKED_TECHNICAL",
          `Asset ${asset.id} is technically blocked and cannot be read by a supported adapter.`,
          "Resolve the technical access block without mutating the source, then rebuild and review the manifest.",
        ),
      ];
    case "unknown":
      return [
        finding(
          "ASSET_ACCESS_UNKNOWN",
          `Asset ${asset.id} has unknown byte access, so no local capability can be claimed.`,
          "Establish direct, official-export, or reviewed official-API access and rebuild the manifest.",
        ),
      ];
  }
}

function vendorFindings(asset: InputAsset, profile: AdapterProfile): Finding[] {
  if (profile.vendorRequirement === "xgrids_export") {
    return [
      finding(
        "XGRIDS_XBIN_OFFICIAL_EXPORT_REQUIRED",
        "XGRIDS XBIN is an opaque blocked source; the repository has no approved XBIN decoder and does not inspect or process its payload.",
        FOUNDRY_XBIN_OFFICIAL_EXPORT_NEXT_ACTION,
      ),
    ];
  }
  if (profile.vendorRequirement === "vendor_scene_export_or_sdk") {
    return [
      finding(
        "VENDOR_SCENE_EXPORT_OR_SDK_REQUIRED",
        `${asset.inputType} is a vendor scene format with detection only and no reviewed local decoder.`,
        "Obtain a rights-cleared official export in a structurally supported format, or implement and review the official SDK adapter.",
      ),
    ];
  }
  return [];
}

function structuralFindings(
  asset: InputAsset,
  profile: AdapterProfile,
): Finding[] {
  switch (profile.structuralInspection) {
    case "implemented":
      return [
        finding(
          "STRUCTURAL_INSPECTION_IMPLEMENTED",
          `A bounded structural inspector is implemented for ${asset.inputType}; it establishes format facts only, not processing readiness.`,
          "Run the existing bounded inspector against the exact admitted byte stream and retain its digest-bound facts.",
        ),
      ];
    case "detection_only":
      return [
        finding(
          "STRUCTURAL_INSPECTION_NOT_IMPLEMENTED",
          `${asset.inputType} has detector classification only; no format-specific structural inspector is wired into the current Source Facts flow.`,
          "Implement a bounded digest-bound structural inspector for the exact variant before planning any processing.",
        ),
      ];
    case "blocked_vendor_format":
      return [];
  }
}

function processingFindings(
  asset: InputAsset,
  profile: AdapterProfile,
): Finding[] {
  if (
    (asset.inputType === "generic_e57" ||
      asset.inputType === "matterport_e57") &&
    profile.localDeterministicProcessing === "not_implemented"
  ) {
    return [
      finding(
        "LOCAL_DETERMINISTIC_PROCESSING_NOT_IMPLEMENTED",
        "This manifest has no digest-bound proof that the exact E57 asset satisfies the bounded crop seam, so no exact-asset deterministic worker is available from manifest labels alone.",
        "Bind a passing source-facts and reader-description result for the exact digest, or keep the asset worker-missing and implement a compatible bounded worker.",
      ),
      finding(
        "E57_GEOMETRY_EXACT_ASSET_COMPATIBILITY_UNVERIFIED",
        "Generic and Matterport labels do not prove point count, container size, Cartesian fields, complete explicit poses, or the coordinate contract required by the narrow authority-none E57 crop seam.",
        "Run digest-bound E57 source-facts and reader-description checks; any incompatible or over-limit asset remains worker-missing.",
      ),
      finding(
        "LOCAL_E57_GEOMETRY_CORE_IMPLEMENTED",
        "An informational deterministic E57 crop core exists only for a 256 MiB, 1,000,000-point, 64-scan Cartesian subset with complete explicit poses; that core is not evidence that this asset is compatible.",
        "Use the bounded core only after exact digest-bound compatibility succeeds and preserve authority none.",
      ),
    ];
  }
  if (profile.localDeterministicProcessing === "implemented") {
    return [
      finding(
        "LOCAL_GLB_NORMALIZATION_CORE_IMPLEMENTED",
        "The deterministic normalize_mesh_glb/v0 pure core is implemented for its reviewed GLB subset.",
        "Preserve the exact invocation, semantic snapshot, proof, and output digests when a production activation is added.",
      ),
      finding(
        "GLB_NORMALIZATION_EXECUTION_ACTIVATION_MISSING",
        "GLB normalization has no production activation that binds the verified stage, manifest, admission, JobSpec, fence, output custody, and purpose-aware rights.",
        "Implement and review the existing control-plane activation seam; do not call the test-only writer or pure core directly from an operator flow.",
      ),
    ];
  }
  if (
    profile.localDeterministicProcessing ===
    "subset_core_available_exact_asset_unverified"
  ) {
    return [
      finding(
        "GLB_NORMALIZATION_EXACT_ASSET_COMPATIBILITY_UNVERIFIED",
        "A narrow deterministic GLB normalization core exists, but this manifest carries no digest-bound validator proof that the exact asset is GLB rather than glTF JSON or that it satisfies the reviewed static-geometry subset.",
        "Run the bounded exact-byte GLB subset validator and bind its passing report before treating this asset as locally processable.",
      ),
      finding(
        "GLB_NORMALIZATION_EXECUTION_ACTIVATION_MISSING",
        "GLB normalization has no production activation that binds the verified stage, manifest, admission, JobSpec, fence, output custody, and purpose-aware rights.",
        "Implement and review the existing control-plane activation seam; do not call the test-only writer or pure core directly from an operator flow.",
      ),
      finding(
        "LOCAL_GLB_NORMALIZATION_CORE_IMPLEMENTED",
        "The deterministic normalize_mesh_glb/v0 pure core is implemented only for its reviewed GLB subset; no claim is made about this exact asset.",
        "Retain the subset validator proof, exact invocation, semantic snapshot, and output digests when a production activation is added.",
      ),
    ];
  }
  if (profile.vendorRequirement !== "none") return [];
  return [
    finding(
      "LOCAL_DETERMINISTIC_PROCESSING_NOT_IMPLEMENTED",
      `No local deterministic processing worker is implemented for ${asset.inputType}; detection or structural inspection is not processing.`,
      "Implement and review a digest-bound deterministic worker and output contract before adding an execution binding.",
    ),
  ];
}

function dependencyFindings(
  profile: AdapterProfile,
  dependencyById: ReadonlyMap<
    FoundryAdapterHostDependencyId,
    FoundryAdapterHostCapabilityInventoryV0["dependencies"][number]
  >,
): Finding[] {
  return profile.dependencies.flatMap((dependencyId) => {
    const dependency = dependencyById.get(dependencyId);
    if (dependency === undefined) {
      throw new FoundryIntegrityError(
        "ADAPTER_HOST_INVENTORY_INCOMPLETE",
        `Host inventory omitted ${dependencyId}.`,
      );
    }
    if (dependency.status === "available") return [];
    const expectedVersion = EXPECTED_DEPENDENCY_VERSION[dependencyId];
    return [
      finding(
        dependency.status === "missing"
          ? "HOST_DEPENDENCY_MISSING"
          : "HOST_DEPENDENCY_UNVERIFIED",
        dependency.status === "missing"
          ? `Host dependency ${dependencyId} ${expectedVersion} is missing.`
          : `Host dependency ${dependencyId} ${expectedVersion} is unverified.`,
        `Install or verify the pinned ${dependencyId} ${expectedVersion} capability outside the pure compiler, record it in a new host inventory, and reassess. This alone does not authorize execution.`,
        dependencyId,
      ),
    ];
  });
}

function statusFor(
  findings: readonly Finding[],
): FoundryAdapterCapabilityAssetOutcomeV0["status"] {
  const blockerCodes = findings
    .filter((item) => item.severity === "blocker")
    .map((item) => item.code);
  if (blockerCodes.includes("ASSET_RIGHTS_BLOCKED")) return "blocked";
  if (blockerCodes.includes("ASSET_RIGHTS_REVIEW_REQUIRED")) {
    return "review_required";
  }
  return blockerCodes.length === 0 ? "production_ready" : "not_ready";
}

function outcomeFor(
  asset: InputAsset,
  legalReviewState: FoundryIngestManifestV0["legalReviewState"],
  dependencyById: ReadonlyMap<
    FoundryAdapterHostDependencyId,
    FoundryAdapterHostCapabilityInventoryV0["dependencies"][number]
  >,
): FoundryAdapterCapabilityAssetOutcomeV0 {
  const profile = PROFILE_BY_INPUT_TYPE[asset.inputType];
  const rights = rightsFinding(asset, legalReviewState);
  const findings = [
    ...(rights === null ? [] : [rights]),
    ...vendorFindings(asset, profile),
    ...accessFindings(asset),
    ...structuralFindings(asset, profile),
    ...processingFindings(asset, profile),
    ...dependencyFindings(profile, dependencyById),
  ].sort(compareFindings);
  const primary = findings.find((item) => item.severity === "blocker");
  return AssetOutcomeSchema.parse({
    assetId: asset.id,
    sourceRootId: asset.sourceRootId,
    relativePath: asset.relativePath,
    sha256: asset.sha256,
    inputType: asset.inputType,
    accessState: asset.accessState,
    structuralInspection: profile.structuralInspection,
    localDeterministicProcessing: profile.localDeterministicProcessing,
    productionReachability: profile.productionReachability,
    status: statusFor(findings),
    primaryFindingCode: primary?.code ?? null,
    nextAction:
      primary?.nextAction ??
      "Retain the exact evidence and production-reachable worker binding.",
    findings,
  });
}

function issueAssessment(
  payload: Omit<AssessmentWithoutValidation, "assessmentSha256">,
): FoundryAdapterCapabilityAssessmentV0 {
  const candidate: AssessmentWithoutValidation = {
    ...payload,
    assessmentSha256: "0".repeat(64),
  };
  return FoundryAdapterCapabilityAssessmentV0Schema.parse({
    ...payload,
    assessmentSha256: assessmentDigest(candidate),
  });
}

export interface CompileFoundryAdapterCapabilityAssessmentV0Input {
  readonly manifest: unknown;
  readonly hostCapabilities: unknown;
}

/**
 * Pure capability compiler. It validates supplied facts and performs no byte,
 * process, network, provider, filesystem, or environment inspection.
 */
export function compileFoundryAdapterCapabilityAssessmentV0(
  input: CompileFoundryAdapterCapabilityAssessmentV0Input,
): FoundryAdapterCapabilityAssessmentV0 {
  const manifest = FoundryIngestManifestV0Schema.parse(input.manifest);
  const hostCapabilities = FoundryAdapterHostCapabilityInventoryV0Schema.parse(
    input.hostCapabilities,
  );
  const dependencyById = new Map(
    hostCapabilities.dependencies.map(
      (dependency) => [dependency.id, dependency] as const,
    ),
  );
  const assets = manifest.assets
    .map((asset) =>
      outcomeFor(asset, manifest.legalReviewState, dependencyById),
    )
    .sort((left, right) =>
      compareCanonicalStrings(left.assetId, right.assetId),
    );
  const summary = summaryFor(assets);
  const status = assets.every((asset) => asset.status === "production_ready")
    ? "production_ready"
    : assets.some(
          (asset) =>
            asset.status === "blocked" || asset.status === "review_required",
        )
      ? "blocked"
      : "not_ready";
  return issueAssessment({
    schemaVersion: FOUNDRY_ADAPTER_CAPABILITY_ASSESSMENT_V0,
    meaning: FOUNDRY_ADAPTER_CAPABILITY_ASSESSMENT_MEANING,
    basis: FOUNDRY_ADAPTER_CAPABILITY_ASSESSMENT_BASIS,
    disclaimer: FOUNDRY_ADAPTER_CAPABILITY_ASSESSMENT_DISCLAIMER,
    manifestSha256: computeFoundryIngestManifestSha256(manifest),
    hostCapabilityInventorySha256:
      computeFoundryAdapterHostCapabilityInventorySha256(hostCapabilities),
    hostId: hostCapabilities.hostId,
    hostObservedAt: hostCapabilities.observedAt,
    authority: "none",
    execution: "not_authorized",
    status,
    summary,
    assets,
  });
}

export interface VerifyFoundryAdapterCapabilityAssessmentV0Input extends CompileFoundryAdapterCapabilityAssessmentV0Input {
  readonly assessment: unknown;
}

export function verifyFoundryAdapterCapabilityAssessmentV0(
  input: VerifyFoundryAdapterCapabilityAssessmentV0Input,
): FoundryAdapterCapabilityAssessmentV0 {
  const supplied = FoundryAdapterCapabilityAssessmentV0Schema.parse(
    input.assessment,
  );
  const expected = compileFoundryAdapterCapabilityAssessmentV0(input);
  if (
    stableCanonicalJson(toCanonicalJson(supplied)) !==
    stableCanonicalJson(toCanonicalJson(expected))
  ) {
    throw new FoundryIntegrityError(
      "ADAPTER_CAPABILITY_ASSESSMENT_BINDING_MISMATCH",
      "Adapter capability assessment does not match the exact manifest, host inventory, and repository capability truth.",
    );
  }
  return supplied;
}

export function serializeFoundryAdapterCapabilityAssessmentV0(
  value: FoundryAdapterCapabilityAssessmentV0,
): string {
  return stableCanonicalJson(
    toCanonicalJson(FoundryAdapterCapabilityAssessmentV0Schema.parse(value)),
  );
}
