import { describe, expect, it } from "vitest";
import {
  TRUTH_EVIDENCE_SOURCE_STATES,
  TruthEvidenceSourceStateSchema,
} from "../truth-mode.js";
import {
  LAYOUT_PROOF_CLAIM_FAMILIES,
  LAYOUT_PROOF_CLAIM_STATUSES,
  LAYOUT_PROOF_EVIDENCE_ASSURANCE_LEVELS,
  LAYOUT_PROOF_LIFECYCLE_STATES,
  LAYOUT_PROOF_SCENARIO_ASSUMPTION_CATEGORIES,
  LAYOUT_PROOF_STALE_REASONS,
  LayoutProofClaimFamilySchema,
  LayoutProofClaimStatusSchema,
  LayoutProofEvidenceAssuranceLevelSchema,
  LayoutProofLifecycleStateSchema,
  LayoutProofScenarioAssumptionCategorySchema,
  LayoutProofStaleReasonSchema,
} from "../layout-proof-object.js";

function overlap(left: readonly string[], right: readonly string[]): readonly string[] {
  const rightValues = new Set(right);
  return left.filter((value) => rightValues.has(value));
}

describe("Layout Proof Object metadata vocabulary", () => {
  it("pins all documented claim families", () => {
    expect(LAYOUT_PROOF_CLAIM_FAMILIES).toEqual([
      "capacity",
      "egress",
      "accessibility",
      "budget",
      "heritage",
      "operational_setup",
      "supplier_load_in",
      "venue_specific",
    ]);

    for (const family of LAYOUT_PROOF_CLAIM_FAMILIES) {
      expect(LayoutProofClaimFamilySchema.safeParse(family).success).toBe(true);
    }
  });

  it("pins all documented claim statuses", () => {
    expect(LAYOUT_PROOF_CLAIM_STATUSES).toEqual([
      "pass",
      "warn",
      "fail",
      "not_checked",
      "inapplicable",
      "requires_human_review",
      "stale",
    ]);

    for (const status of LAYOUT_PROOF_CLAIM_STATUSES) {
      expect(LayoutProofClaimStatusSchema.safeParse(status).success).toBe(true);
    }
  });

  it("keeps stale reasons separate from claim statuses", () => {
    expect(LAYOUT_PROOF_STALE_REASONS).toEqual([
      "layout_changed",
      "venue_geometry_changed",
      "policy_bundle_changed",
      "validator_changed",
      "scenario_changed",
      "event_metadata_changed",
    ]);

    expect(overlap(LAYOUT_PROOF_STALE_REASONS, LAYOUT_PROOF_CLAIM_STATUSES)).toEqual([]);
    expect(LayoutProofStaleReasonSchema.safeParse("layout_changed").success).toBe(true);
    expect(LayoutProofStaleReasonSchema.safeParse("stale").success).toBe(false);
  });

  it("makes human review explicit instead of treating it as a pass", () => {
    expect(LAYOUT_PROOF_CLAIM_STATUSES).toContain("requires_human_review");
    expect(LayoutProofClaimStatusSchema.safeParse("requires_human_review").success).toBe(true);
  });

  it("does not encode public legal certification wording as default status", () => {
    const bannedLegalStatuses = [
      "certified",
      "legally_compliant",
      "fire_approved",
      "regulator_approved",
      "survey_grade",
      "approved_for_occupancy",
    ] as const;

    for (const status of bannedLegalStatuses) {
      expect(LayoutProofClaimStatusSchema.safeParse(status).success).toBe(false);
    }
  });

  it("pins evidence assurance levels without mixing them with Truth Mode source states", () => {
    expect(LAYOUT_PROOF_EVIDENCE_ASSURANCE_LEVELS).toEqual([
      "draft_evidence",
      "replayable_evidence",
      "signed_evidence",
      "expert_reviewed",
      "formal_evidence",
    ]);

    expect(overlap(LAYOUT_PROOF_EVIDENCE_ASSURANCE_LEVELS, TRUTH_EVIDENCE_SOURCE_STATES)).toEqual([]);
    expect(LayoutProofEvidenceAssuranceLevelSchema.safeParse("replayable_evidence").success).toBe(true);
    expect(LayoutProofEvidenceAssuranceLevelSchema.safeParse("scan_observed").success).toBe(false);
    expect(TruthEvidenceSourceStateSchema.safeParse("draft_evidence").success).toBe(false);
  });

  it("pins scenario assumption categories for future validator inputs", () => {
    expect(LAYOUT_PROOF_SCENARIO_ASSUMPTION_CATEGORIES).toEqual([
      "event_type",
      "guest_count",
      "seating_style",
      "accessibility_profile",
      "service_model",
      "staffing_model",
      "load_in_model",
      "pricing_model",
      "tolerance_policy",
      "time_window",
    ]);

    expect(LayoutProofScenarioAssumptionCategorySchema.safeParse("guest_count").success).toBe(true);
    expect(LayoutProofScenarioAssumptionCategorySchema.safeParse("fire_approved").success).toBe(false);
  });

  it("pins proof object lifecycle states separately from claim status", () => {
    expect(LAYOUT_PROOF_LIFECYCLE_STATES).toEqual([
      "not_generated",
      "draft",
      "current",
      "partial",
      "stale",
      "superseded",
      "revoked",
    ]);

    expect(LayoutProofLifecycleStateSchema.safeParse("current").success).toBe(true);
    expect(LayoutProofLifecycleStateSchema.safeParse("pass").success).toBe(false);
    expect(LayoutProofClaimStatusSchema.safeParse("current").success).toBe(false);
  });

  it("is metadata-only string vocabulary for future validator-kernel work", () => {
    const everyValue = [
      ...LAYOUT_PROOF_CLAIM_FAMILIES,
      ...LAYOUT_PROOF_CLAIM_STATUSES,
      ...LAYOUT_PROOF_EVIDENCE_ASSURANCE_LEVELS,
      ...LAYOUT_PROOF_STALE_REASONS,
      ...LAYOUT_PROOF_SCENARIO_ASSUMPTION_CATEGORIES,
      ...LAYOUT_PROOF_LIFECYCLE_STATES,
    ];

    expect(everyValue.every((value) => typeof value === "string")).toBe(true);
  });
});

