import { z } from "zod";

export const RESIDUAL_LAYER_ROLES = [
  "surface_bound_gaussian_residual",
  "uv_space_residual_texture",
  "neural_texture_residual",
  "pbr_lightmap_probe_fallback",
] as const;

export const ResidualLayerRoleSchema = z.enum(RESIDUAL_LAYER_ROLES);
export type ResidualLayerRole = z.infer<typeof ResidualLayerRoleSchema>;

export const RESIDUAL_EXPERIMENT_SURFACES = [
  "mesh_only_baseline",
  "full_splat_baseline",
  "mesh_plus_residual_output",
  "frosting_only_optional",
] as const;

export const ResidualExperimentSurfaceSchema = z.enum(RESIDUAL_EXPERIMENT_SURFACES);
export type ResidualExperimentSurface = z.infer<typeof ResidualExperimentSurfaceSchema>;

export const RESIDUAL_BINDING_STRATEGIES = [
  "mesh_triangle_id",
  "barycentric_coordinate",
  "uv_coordinate",
  "local_tangent_frame",
  "semantic_region_id",
  "semantic_class",
  "approved_free_space_splat",
] as const;

export const ResidualBindingStrategySchema = z.enum(RESIDUAL_BINDING_STRATEGIES);
export type ResidualBindingStrategy = z.infer<typeof ResidualBindingStrategySchema>;

export const RESIDUAL_COMPOSITION_MODES = [
  "additive",
  "alpha_over",
] as const;

export const DEFAULT_RESIDUAL_COMPOSITION_MODE = "additive" as const;

export const ResidualCompositionModeSchema = z.enum(RESIDUAL_COMPOSITION_MODES);
export type ResidualCompositionMode = z.infer<typeof ResidualCompositionModeSchema>;

export const RESIDUAL_ALPHA_OVER_APPROVED_SEMANTIC_CLASSES = [
  "curtain",
  "chandelier",
  "crystal_pendant",
  "thin_fixture",
  "transparent_decor",
  "semi_transparent_decor",
  "stained_glass_glow",
] as const;

export const ResidualAlphaOverSemanticClassSchema = z.enum(
  RESIDUAL_ALPHA_OVER_APPROVED_SEMANTIC_CLASSES,
);
export type ResidualAlphaOverSemanticClass = z.infer<typeof ResidualAlphaOverSemanticClassSchema>;

export const RESIDUAL_METRIC_NAMES = [
  "psnr",
  "ssim",
  "lpips",
  "residual_energy_ratio",
  "semantic_leakage",
  "edit_consistency",
  "insertion_realism",
  "runtime_fps",
  "memory_footprint",
  "asset_size",
  "truth_mode_explainability",
] as const;

export const ResidualMetricNameSchema = z.enum(RESIDUAL_METRIC_NAMES);
export type ResidualMetricName = z.infer<typeof ResidualMetricNameSchema>;

export const RESIDUAL_FAILURE_GATE_NAMES = [
  "residual_carries_most_of_scene",
  "semantic_region_leakage",
  "editability_breaks",
  "object_insertion_regression",
  "runtime_size_or_performance_unacceptable",
  "requires_arbitrary_relighting",
  "cannot_disable_without_planning_value",
  "truth_mode_unexplainable",
  "untracked_transform_dependency",
] as const;

export const ResidualFailureGateNameSchema = z.enum(RESIDUAL_FAILURE_GATE_NAMES);
export type ResidualFailureGateName = z.infer<typeof ResidualFailureGateNameSchema>;

export const RESIDUAL_RESEARCH_TRACK_STATUSES = [
  "research_planned",
  "blocked_on_production_evidence",
  "data_ready",
  "baseline_ready",
  "experiment_running",
  "metrics_review",
  "promoted",
  "revise",
  "deferred",
  "rejected",
] as const;

export const ResidualResearchTrackStatusSchema = z.enum(RESIDUAL_RESEARCH_TRACK_STATUSES);
export type ResidualResearchTrackStatus = z.infer<typeof ResidualResearchTrackStatusSchema>;

export const ResidualCompositionPolicySchema = z
  .object({
    mode: ResidualCompositionModeSchema.default(DEFAULT_RESIDUAL_COMPOSITION_MODE),
    semanticClass: ResidualAlphaOverSemanticClassSchema.optional(),
  })
  .strict()
  .superRefine((policy, ctx) => {
    if (policy.mode === "alpha_over" && policy.semanticClass === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["semanticClass"],
        message: "alpha_over residual composition requires an approved semantic class",
      });
    }
  });

export type ResidualCompositionPolicyInput = z.input<typeof ResidualCompositionPolicySchema>;
export type ResidualCompositionPolicy = z.infer<typeof ResidualCompositionPolicySchema>;

export function isResidualAlphaOverSemanticClass(
  value: string,
): value is ResidualAlphaOverSemanticClass {
  return RESIDUAL_ALPHA_OVER_APPROVED_SEMANTIC_CLASSES.includes(
    value as ResidualAlphaOverSemanticClass,
  );
}

export function isResidualCompositionPolicyAllowed(
  policy: ResidualCompositionPolicyInput,
): boolean {
  return ResidualCompositionPolicySchema.safeParse(policy).success;
}
