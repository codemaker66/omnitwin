import { describe, expect, it } from "vitest";
import {
  LAYOUT_PROOF_CLAIM_STATUSES,
  LayoutProofClaimStatusSchema,
} from "../layout-proof-object.js";
import {
  TRUTH_CONFIDENCE_TIERS,
  TRUTH_EVIDENCE_SOURCE_STATES,
  TruthConfidenceTierSchema,
  TruthEvidenceSourceStateSchema,
} from "../truth-mode.js";
import {
  ASSUMPTION_ASSURANCE_BANDS,
  ASSUMPTION_CATEGORIES,
  ASSUMPTION_REVIEW_REQUIREMENTS,
  ASSUMPTION_SOURCES,
  ASSUMPTION_STALE_TRIGGERS,
  AssumptionAssuranceBandSchema,
  AssumptionCategorySchema,
  AssumptionReviewRequirementSchema,
  AssumptionSourceSchema,
  AssumptionStaleTriggerSchema,
} from "../assumption-ledger.js";

function overlap(left: readonly string[], right: readonly string[]): readonly string[] {
  const rightValues = new Set(right);
  return left.filter((value) => rightValues.has(value));
}

describe("Assumption Ledger vocabulary", () => {
  it("pins assumption categories from ASSUMPTION-001", () => {
    expect(ASSUMPTION_CATEGORIES).toEqual([
      "attendance",
      "event_mode",
      "time_window",
      "door_exits_availability",
      "staff_availability",
      "furniture_inventory",
      "service_rate",
      "accessibility",
      "policy_rule",
      "venue_operating_rule",
      "pricing",
      "simulation",
      "capture_geometry",
    ]);

    for (const category of ASSUMPTION_CATEGORIES) {
      expect(AssumptionCategorySchema.safeParse(category).success).toBe(true);
    }
  });

  it("pins assumption sources without reusing Truth Mode source states", () => {
    expect(ASSUMPTION_SOURCES).toEqual([
      "venue_policy",
      "user_input",
      "staff_review",
      "capture_metadata",
      "pricing_book",
      "simulator_config",
      "imported_event_record",
      "system_default",
      "ai_proposed",
      "external_document",
    ]);

    expect(overlap(ASSUMPTION_SOURCES, TRUTH_EVIDENCE_SOURCE_STATES)).toEqual([]);
    expect(AssumptionSourceSchema.safeParse("venue_policy").success).toBe(true);
    expect(AssumptionSourceSchema.safeParse("scan_observed").success).toBe(false);
    expect(TruthEvidenceSourceStateSchema.safeParse("venue_policy").success).toBe(false);
  });

  it("pins assurance bands separately from Truth Mode confidence tiers", () => {
    expect(ASSUMPTION_ASSURANCE_BANDS).toEqual([
      "venue_confirmed",
      "staff_reviewed",
      "documented_source",
      "user_supplied",
      "machine_inferred",
      "system_default",
      "low_assurance",
      "unknown_assurance",
    ]);

    expect(overlap(ASSUMPTION_ASSURANCE_BANDS, TRUTH_CONFIDENCE_TIERS)).toEqual([]);
    expect(AssumptionAssuranceBandSchema.safeParse("venue_confirmed").success).toBe(true);
    expect(AssumptionAssuranceBandSchema.safeParse("ops_grade").success).toBe(false);
    expect(TruthConfidenceTierSchema.safeParse("venue_confirmed").success).toBe(false);
  });

  it("pins stale triggers and keeps them out of claim statuses", () => {
    expect(ASSUMPTION_STALE_TRIGGERS).toEqual([
      "layout_snapshot_changed",
      "venue_runtime_package_changed",
      "scene_authority_map_changed",
      "policy_bundle_changed",
      "venue_rule_changed",
      "pricing_book_changed",
      "inventory_availability_changed",
      "staff_availability_changed",
      "door_exit_availability_changed",
      "event_metadata_changed",
      "capture_session_superseded",
      "simulator_version_changed",
      "simulator_parameters_changed",
      "seed_policy_changed",
      "navmesh_changed",
      "manual_contestation",
      "expiry_reached",
    ]);

    expect(overlap(ASSUMPTION_STALE_TRIGGERS, LAYOUT_PROOF_CLAIM_STATUSES)).toEqual([]);
    expect(AssumptionStaleTriggerSchema.safeParse("policy_bundle_changed").success).toBe(true);
    expect(AssumptionStaleTriggerSchema.safeParse("stale").success).toBe(false);
    expect(LayoutProofClaimStatusSchema.safeParse("policy_bundle_changed").success).toBe(false);
  });

  it("pins explicit review requirement categories", () => {
    expect(ASSUMPTION_REVIEW_REQUIREMENTS).toEqual([
      "no_review_required",
      "venue_staff_review_required",
      "hallkeeper_review_required",
      "accessibility_review_required",
      "policy_review_required",
      "heritage_review_required",
      "supplier_review_required",
      "pricing_review_required",
      "operational_precedent_required",
    ]);

    for (const requirement of ASSUMPTION_REVIEW_REQUIREMENTS) {
      expect(AssumptionReviewRequirementSchema.safeParse(requirement).success).toBe(true);
    }
  });

  it("uses metadata-only string vocabularies", () => {
    const vocabularies = [
      ASSUMPTION_CATEGORIES,
      ASSUMPTION_SOURCES,
      ASSUMPTION_ASSURANCE_BANDS,
      ASSUMPTION_STALE_TRIGGERS,
      ASSUMPTION_REVIEW_REQUIREMENTS,
    ] as const;

    for (const vocabulary of vocabularies) {
      expect(vocabulary.every((value) => typeof value === "string")).toBe(true);
      expect(new Set(vocabulary).size).toBe(vocabulary.length);
    }
  });
});
