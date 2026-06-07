import { describe, expect, it } from "vitest";
import {
  LAYOUT_PROOF_CLAIM_STATUSES,
  LayoutProofClaimStatusSchema,
} from "../layout-proof-object.js";
import {
  TRUTH_EVIDENCE_SOURCE_STATES,
  TRUTH_VERIFICATION_STATES,
  TruthEvidenceSourceStateSchema,
  TruthVerificationStateSchema,
} from "../truth-mode.js";
import {
  REVIEW_GATE_BLOCKING_MODES,
  REVIEW_GATE_LIFECYCLE_STATUSES,
  REVIEW_GATE_MESSAGE_KEY_FAMILIES,
  REVIEW_GATE_REASONS,
  REVIEW_GATE_REQUIRED_DATA_CATEGORIES,
  REVIEW_GATE_REVIEWER_ROLES,
  ReviewGateBlockingModeSchema,
  ReviewGateLifecycleStatusSchema,
  ReviewGateMessageKeyFamilySchema,
  ReviewGateReasonSchema,
  ReviewGateRequiredDataCategorySchema,
  ReviewGateReviewerRoleSchema,
} from "../review-gate.js";

function overlap(left: readonly string[], right: readonly string[]): readonly string[] {
  const rightValues = new Set(right);
  return left.filter((value) => rightValues.has(value));
}

describe("Review Gate vocabulary", () => {
  it("pins machine-readable review reasons from REVIEW-GATE-001", () => {
    expect(REVIEW_GATE_REASONS).toEqual([
      "missing_required_data",
      "unanswered_venue_data_request",
      "near_threshold",
      "historic_stair_or_protected_door",
      "partial_accessible_route",
      "temporary_structure",
      "protected_heritage_zone",
      "high_risk_activity",
      "venue_policy_requires_review",
      "incomplete_guest_flow_assumptions",
      "exceeds_planning_evidence_scope",
    ]);

    for (const reason of REVIEW_GATE_REASONS) {
      expect(ReviewGateReasonSchema.safeParse(reason).success).toBe(true);
    }
  });

  it("pins required reviewer roles", () => {
    expect(REVIEW_GATE_REVIEWER_ROLES).toEqual([
      "venue_events_team",
      "hallkeeper",
      "venue_operations_manager",
      "accessibility_reviewer",
      "fire_safety_reviewer",
      "heritage_reviewer",
      "supplier_coordinator",
      "technical_admin",
    ]);

    for (const role of REVIEW_GATE_REVIEWER_ROLES) {
      expect(ReviewGateReviewerRoleSchema.safeParse(role).success).toBe(true);
    }
  });

  it("pins required-data categories for handoff and venue data request links", () => {
    expect(REVIEW_GATE_REQUIRED_DATA_CATEGORIES).toEqual([
      "venue_data_request_field",
      "policy_reference",
      "submitted_route",
      "door_widths",
      "protected_surface_rule",
      "accessibility_route",
      "guest_flow_assumptions",
      "temporary_structure_details",
      "event_risk_metadata",
      "affected_object_refs",
      "affected_route_refs",
      "affected_zone_refs",
    ]);

    for (const category of REVIEW_GATE_REQUIRED_DATA_CATEGORIES) {
      expect(ReviewGateRequiredDataCategorySchema.safeParse(category).success).toBe(true);
    }
  });

  it("pins blocking modes without making them claim status values", () => {
    expect(REVIEW_GATE_BLOCKING_MODES).toEqual([
      "blocking",
      "non_blocking",
      "blocks_export_only",
      "blocks_public_exposure",
    ]);

    expect(overlap(REVIEW_GATE_BLOCKING_MODES, LAYOUT_PROOF_CLAIM_STATUSES)).toEqual([]);
    expect(ReviewGateBlockingModeSchema.safeParse("blocking").success).toBe(true);
    expect(ReviewGateBlockingModeSchema.safeParse("pass").success).toBe(false);
    expect(LayoutProofClaimStatusSchema.safeParse("blocking").success).toBe(false);
  });

  it("pins gate lifecycle statuses separately from Layout Proof and Truth Mode states", () => {
    expect(REVIEW_GATE_LIFECYCLE_STATUSES).toEqual([
      "gate_open",
      "gate_queued",
      "gate_in_review",
      "gate_resolved",
      "gate_stale",
      "gate_superseded",
      "gate_withdrawn",
    ]);

    expect(overlap(REVIEW_GATE_LIFECYCLE_STATUSES, LAYOUT_PROOF_CLAIM_STATUSES)).toEqual([]);
    expect(overlap(REVIEW_GATE_LIFECYCLE_STATUSES, TRUTH_VERIFICATION_STATES)).toEqual([]);
    expect(overlap(REVIEW_GATE_LIFECYCLE_STATUSES, TRUTH_EVIDENCE_SOURCE_STATES)).toEqual([]);
    expect(ReviewGateLifecycleStatusSchema.safeParse("gate_open").success).toBe(true);
    expect(ReviewGateLifecycleStatusSchema.safeParse("requires_human_review").success).toBe(false);
    expect(TruthVerificationStateSchema.safeParse("gate_open").success).toBe(false);
    expect(TruthEvidenceSourceStateSchema.safeParse("gate_open").success).toBe(false);
  });

  it("pins review gate message key families", () => {
    expect(REVIEW_GATE_MESSAGE_KEY_FAMILIES).toEqual([
      "review_gate_missing_data",
      "review_gate_near_threshold",
      "review_gate_policy_scope",
      "review_gate_accessibility",
      "review_gate_heritage",
      "review_gate_guest_flow",
      "review_gate_temporary_structure",
      "review_gate_venue_policy",
    ]);

    for (const family of REVIEW_GATE_MESSAGE_KEY_FAMILIES) {
      expect(ReviewGateMessageKeyFamilySchema.safeParse(family).success).toBe(true);
    }
  });

  it("uses metadata-only string vocabularies", () => {
    const vocabularies = [
      REVIEW_GATE_REASONS,
      REVIEW_GATE_REVIEWER_ROLES,
      REVIEW_GATE_REQUIRED_DATA_CATEGORIES,
      REVIEW_GATE_BLOCKING_MODES,
      REVIEW_GATE_LIFECYCLE_STATUSES,
      REVIEW_GATE_MESSAGE_KEY_FAMILIES,
    ] as const;

    for (const vocabulary of vocabularies) {
      expect(vocabulary.every((value) => typeof value === "string")).toBe(true);
      expect(new Set(vocabulary).size).toBe(vocabulary.length);
    }
  });
});
