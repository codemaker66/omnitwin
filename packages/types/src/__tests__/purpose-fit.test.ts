import { describe, expect, it } from "vitest";
import { ARTIFACT_EXPOSURE_TIERS, ArtifactExposureTierSchema } from "../artifact-manifest.js";
import {
  LAYOUT_PROOF_CLAIM_STATUSES,
  LayoutProofClaimStatusSchema,
} from "../layout-proof-object.js";
import {
  TRUTH_CONFIDENCE_TIERS,
  TruthConfidenceTierSchema,
} from "../truth-mode.js";
import {
  PURPOSE_CONFIDENCE_LABELS,
  PURPOSE_EVIDENCE_REQUIREMENT_REFS,
  PURPOSE_FIT_CATEGORIES,
  PURPOSE_FIT_STATUSES,
  PurposeConfidenceLabelSchema,
  PurposeEvidenceRequirementRefSchema,
  PurposeFitCategorySchema,
  PurposeFitStatusSchema,
} from "../purpose-fit.js";

function overlap(left: readonly string[], right: readonly string[]): readonly string[] {
  const rightValues = new Set(right);
  return left.filter((value) => rightValues.has(value));
}

describe("Purpose-fit evidence vocabulary", () => {
  it("pins purpose categories from PURPOSE-FIT-001", () => {
    expect(PURPOSE_FIT_CATEGORIES).toEqual([
      "visual_presentation",
      "event_layout",
      "hallkeeper_setup",
      "guest_flow",
      "accessibility_planning",
      "egress_planning",
      "pricing",
      "heritage_interpretation",
      "architectural_survey",
      "marketing_render",
    ]);

    for (const category of PURPOSE_FIT_CATEGORIES) {
      expect(PurposeFitCategorySchema.safeParse(category).success).toBe(true);
    }
  });

  it("pins purpose-fit statuses without reusing generic claim statuses", () => {
    expect(PURPOSE_FIT_STATUSES).toEqual([
      "fit_for_purpose",
      "fit_with_limitations",
      "partially_fit",
      "not_fit_for_purpose",
      "not_checked_for_purpose",
      "stale_for_purpose",
      "requires_review_for_purpose",
      "unsupported_for_purpose",
    ]);

    expect(overlap(PURPOSE_FIT_STATUSES, LAYOUT_PROOF_CLAIM_STATUSES)).toEqual([]);
    expect(PurposeFitStatusSchema.safeParse("fit_for_purpose").success).toBe(true);
    expect(PurposeFitStatusSchema.safeParse("pass").success).toBe(false);
    expect(PurposeFitStatusSchema.safeParse("requires_human_review").success).toBe(false);
    expect(LayoutProofClaimStatusSchema.safeParse("fit_for_purpose").success).toBe(false);
  });

  it("pins evidence requirement references for purpose-specific checks", () => {
    expect(PURPOSE_EVIDENCE_REQUIREMENT_REFS).toEqual([
      "source_provenance",
      "metric_geometry",
      "object_dimensions",
      "current_layout_snapshot",
      "runtime_reference",
      "policy_bundle",
      "assumption_set",
      "route_or_walkable_model",
      "simulation_replay",
      "human_review",
      "price_book",
      "inventory_reference",
      "heritage_source",
      "exposure_review",
      "copy_guard_review",
    ]);

    for (const ref of PURPOSE_EVIDENCE_REQUIREMENT_REFS) {
      expect(PurposeEvidenceRequirementRefSchema.safeParse(ref).success).toBe(true);
    }
  });

  it("pins purpose confidence labels separately from Truth Mode confidence tiers", () => {
    expect(PURPOSE_CONFIDENCE_LABELS).toEqual([
      "strong_for_purpose",
      "adequate_for_purpose",
      "weak_for_purpose",
      "unknown_for_purpose",
      "not_applicable_for_purpose",
    ]);

    expect(overlap(PURPOSE_CONFIDENCE_LABELS, TRUTH_CONFIDENCE_TIERS)).toEqual([]);
    expect(PurposeConfidenceLabelSchema.safeParse("strong_for_purpose").success).toBe(true);
    expect(PurposeConfidenceLabelSchema.safeParse("ops_grade").success).toBe(false);
    expect(TruthConfidenceTierSchema.safeParse("strong_for_purpose").success).toBe(false);
  });

  it("keeps purpose categories separate from exposure tiers", () => {
    expect(overlap(PURPOSE_FIT_CATEGORIES, ARTIFACT_EXPOSURE_TIERS)).toEqual([]);
    expect(PurposeFitCategorySchema.safeParse("public_marketing").success).toBe(false);
    expect(ArtifactExposureTierSchema.safeParse("marketing_render").success).toBe(false);
  });

  it("uses metadata-only string vocabularies", () => {
    const vocabularies = [
      PURPOSE_FIT_CATEGORIES,
      PURPOSE_FIT_STATUSES,
      PURPOSE_EVIDENCE_REQUIREMENT_REFS,
      PURPOSE_CONFIDENCE_LABELS,
    ] as const;

    for (const vocabulary of vocabularies) {
      expect(vocabulary.every((value) => typeof value === "string")).toBe(true);
      expect(new Set(vocabulary).size).toBe(vocabulary.length);
    }
  });
});
