import { describe, expect, it } from "vitest";
import {
  RUNTIME_LAYER_KINDS,
  RuntimeLayerKindSchema,
} from "../runtime-venue-manifest.js";
import {
  DEFAULT_RESIDUAL_COMPOSITION_MODE,
  RESIDUAL_ALPHA_OVER_APPROVED_SEMANTIC_CLASSES,
  RESIDUAL_BINDING_STRATEGIES,
  RESIDUAL_COMPOSITION_MODES,
  RESIDUAL_EXPERIMENT_SURFACES,
  RESIDUAL_FAILURE_GATE_NAMES,
  RESIDUAL_LAYER_ROLES,
  RESIDUAL_METRIC_NAMES,
  RESIDUAL_RESEARCH_TRACK_STATUSES,
  ResidualBindingStrategySchema,
  ResidualCompositionPolicySchema,
  ResidualExperimentSurfaceSchema,
  ResidualFailureGateNameSchema,
  ResidualLayerRoleSchema,
  ResidualMetricNameSchema,
  ResidualResearchTrackStatusSchema,
  isResidualAlphaOverSemanticClass,
  isResidualCompositionPolicyAllowed,
} from "../residual-radiance.js";

function overlap(left: readonly string[], right: readonly string[]): readonly string[] {
  const rightValues = new Set(right);
  return left.filter((value) => rightValues.has(value));
}

describe("Residual Radiance metadata vocabulary", () => {
  it("pins residual layer roles documented by the doctrine and RRL-001 plan", () => {
    expect(RESIDUAL_LAYER_ROLES).toEqual([
      "surface_bound_gaussian_residual",
      "uv_space_residual_texture",
      "neural_texture_residual",
      "pbr_lightmap_probe_fallback",
    ]);

    expect(ResidualLayerRoleSchema.safeParse("surface_bound_gaussian_residual").success).toBe(true);
    expect(ResidualLayerRoleSchema.safeParse("gaussian_splat").success).toBe(false);
  });

  it("pins experiment surfaces without adding production runtime layer kinds", () => {
    expect(RESIDUAL_EXPERIMENT_SURFACES).toEqual([
      "mesh_only_baseline",
      "full_splat_baseline",
      "mesh_plus_residual_output",
      "frosting_only_optional",
    ]);

    expect(ResidualExperimentSurfaceSchema.safeParse("mesh_plus_residual_output").success).toBe(true);
    expect(RuntimeLayerKindSchema.safeParse("mesh_plus_residual_output").success).toBe(false);
    expect(RUNTIME_LAYER_KINDS).toEqual(["gaussian_splat", "mesh"]);
  });

  it("covers all documented residual binding strategies", () => {
    expect(RESIDUAL_BINDING_STRATEGIES).toEqual([
      "mesh_triangle_id",
      "barycentric_coordinate",
      "uv_coordinate",
      "local_tangent_frame",
      "semantic_region_id",
      "semantic_class",
      "approved_free_space_splat",
    ]);

    for (const strategy of [
      "mesh_triangle_id",
      "barycentric_coordinate",
      "uv_coordinate",
      "semantic_region_id",
    ] as const) {
      expect(ResidualBindingStrategySchema.safeParse(strategy).success).toBe(true);
    }
  });

  it("pins additive as the default documented composition mode", () => {
    expect(RESIDUAL_COMPOSITION_MODES).toEqual(["additive", "alpha_over"]);
    expect(DEFAULT_RESIDUAL_COMPOSITION_MODE).toBe("additive");
    expect(ResidualCompositionPolicySchema.parse({})).toEqual({ mode: "additive" });
  });

  it("requires an approved semantic class for alpha-over composition", () => {
    expect(RESIDUAL_ALPHA_OVER_APPROVED_SEMANTIC_CLASSES).toEqual([
      "curtain",
      "chandelier",
      "crystal_pendant",
      "thin_fixture",
      "transparent_decor",
      "semi_transparent_decor",
      "stained_glass_glow",
    ]);

    expect(isResidualCompositionPolicyAllowed({ mode: "additive" })).toBe(true);
    expect(isResidualCompositionPolicyAllowed({ mode: "alpha_over" })).toBe(false);
    expect(
      isResidualCompositionPolicyAllowed({
        mode: "alpha_over",
        semanticClass: "stained_glass_glow",
      }),
    ).toBe(true);
    expect(isResidualAlphaOverSemanticClass("chandelier")).toBe(true);
    expect(isResidualAlphaOverSemanticClass("wall")).toBe(false);
  });

  it("pins residual metric names including the experiment-specific gates", () => {
    expect(RESIDUAL_METRIC_NAMES).toEqual([
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
    ]);

    for (const metric of [
      "residual_energy_ratio",
      "semantic_leakage",
      "edit_consistency",
      "insertion_realism",
    ] as const) {
      expect(ResidualMetricNameSchema.safeParse(metric).success).toBe(true);
    }
  });

  it("pins residual failure gate names", () => {
    expect(RESIDUAL_FAILURE_GATE_NAMES).toEqual([
      "residual_carries_most_of_scene",
      "semantic_region_leakage",
      "editability_breaks",
      "object_insertion_regression",
      "runtime_size_or_performance_unacceptable",
      "requires_arbitrary_relighting",
      "cannot_disable_without_planning_value",
      "truth_mode_unexplainable",
      "untracked_transform_dependency",
    ]);

    expect(ResidualFailureGateNameSchema.safeParse("truth_mode_unexplainable").success).toBe(true);
    expect(ResidualFailureGateNameSchema.safeParse("verified").success).toBe(false);
  });

  it("pins research-track statuses separately from task and runtime state", () => {
    expect(RESIDUAL_RESEARCH_TRACK_STATUSES).toEqual([
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
    ]);

    expect(ResidualResearchTrackStatusSchema.safeParse("blocked_on_production_evidence").success).toBe(true);
    expect(ResidualResearchTrackStatusSchema.safeParse("gaussian_splat").success).toBe(false);
    expect(overlap(RESIDUAL_RESEARCH_TRACK_STATUSES, RUNTIME_LAYER_KINDS)).toEqual([]);
  });
});
