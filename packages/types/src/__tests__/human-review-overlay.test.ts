import { describe, expect, it } from "vitest";
import { ClaimLifecycleEventSchema } from "../claim-lifecycle.js";
import { LayoutProofClaimStatusSchema } from "../layout-proof-object.js";
import {
  HUMAN_REVIEW_DECISIONS,
  HUMAN_REVIEW_LIFECYCLE_EFFECTS,
  HUMAN_REVIEW_OVERLAY_SCHEMA_VERSION,
  HUMAN_REVIEW_REASON_CATEGORIES,
  HUMAN_REVIEW_REFERENCE_TYPES,
  HUMAN_REVIEW_SCOPES,
  HumanReviewDecisionSchema,
  HumanReviewLifecycleEffectSchema,
  HumanReviewOverlaySchema,
  HumanReviewReasonCategorySchema,
  HumanReviewReferenceTypeSchema,
  HumanReviewScopeSchema,
  type HumanReviewOverlay,
} from "../human-review-overlay.js";

const VALID_OVERLAY: HumanReviewOverlay = {
  schemaVersion: HUMAN_REVIEW_OVERLAY_SCHEMA_VERSION,
  overlayId: "human_review_overlay_grand_hall_capacity_2026_06_07",
  reviewerRole: "venue_events_team",
  reviewerActorCategory: "venue_staff",
  reviewerId: "trades_hall_events_reviewer",
  decision: "support_claim",
  reason: "documented_venue_fact",
  reviewedAt: "2026-06-07T12:00:00.000Z",
  scope: "claim",
  expiresAt: "2026-12-07T12:00:00.000Z",
  sourceWitnessRefs: [
    {
      refType: "witness_block",
      ref: "witness_capacity_grand_hall_layout_001",
      role: "machine_witness",
    },
  ],
  affectedClaims: ["claim_grand_hall_capacity_planning_001"],
  affectedEvidence: [
    {
      refType: "evidence_pack",
      ref: "layout_evidence_pack_grand_hall_001",
      role: "reviewed_evidence",
    },
  ],
  lifecycleEffect: "supports_current_claim",
  machineWitnessMutationPolicy: "never_mutate_machine_witness",
  reviewNote: "Venue reviewer confirmed this claim for the named planning purpose.",
};

describe("Human Review Overlay schema", () => {
  it("pins overlay vocabularies from STACK-001", () => {
    expect(HUMAN_REVIEW_DECISIONS).toEqual([
      "support_claim",
      "contest_claim",
      "resolve_gate",
      "keep_gate_open",
      "supersede_prior_review",
      "defer_review",
      "withdraw_review",
    ]);

    expect(HUMAN_REVIEW_REASON_CATEGORIES).toEqual([
      "venue_policy_judgment",
      "documented_venue_fact",
      "near_threshold_review",
      "missing_or_degraded_data",
      "heritage_constraint",
      "accessibility_route_review",
      "temporary_structure_review",
      "guest_flow_assumption_review",
      "visual_evidence_review",
      "manual_contestation",
    ]);

    expect(HUMAN_REVIEW_SCOPES).toEqual([
      "claim",
      "evidence_pack",
      "review_gate",
      "layout_snapshot",
      "runtime_package",
      "artifact",
      "route",
      "zone",
      "object",
      "scenario_instance",
    ]);
  });

  it("pins reference types and lifecycle effects", () => {
    expect(HUMAN_REVIEW_REFERENCE_TYPES).toEqual([
      "claim",
      "evidence_pack",
      "review_gate",
      "witness_block",
      "proof_object",
      "artifact",
      "layout_snapshot",
      "runtime_package",
      "route",
      "zone",
      "object",
      "scenario_instance",
    ]);

    expect(HUMAN_REVIEW_LIFECYCLE_EFFECTS).toEqual([
      "records_human_review",
      "supports_current_claim",
      "contests_current_claim",
      "resolves_review_gate",
      "keeps_review_gate_open",
      "supersedes_prior_overlay",
      "expires_review_overlay",
      "no_lifecycle_change",
    ]);
  });

  it("parses a strict overlay over machine witness output", () => {
    expect(HumanReviewOverlaySchema.parse(VALID_OVERLAY)).toEqual(VALID_OVERLAY);
  });

  it("requires immutable source witness references", () => {
    expect(HumanReviewOverlaySchema.safeParse({
      ...VALID_OVERLAY,
      sourceWitnessRefs: [],
    }).success).toBe(false);

    expect(HumanReviewOverlaySchema.safeParse({
      ...VALID_OVERLAY,
      machineWitnessMutationPolicy: "patch_machine_witness",
    }).success).toBe(false);

    expect(HumanReviewOverlaySchema.safeParse({
      ...VALID_OVERLAY,
      witnessPatch: {
        status: "human_reviewed",
      },
    }).success).toBe(false);
  });

  it("requires claim decisions to identify affected claims", () => {
    expect(HumanReviewOverlaySchema.safeParse({
      ...VALID_OVERLAY,
      decision: "contest_claim",
      lifecycleEffect: "contests_current_claim",
      affectedClaims: [],
    }).success).toBe(false);
  });

  it("requires gate decisions to reference a review gate", () => {
    expect(HumanReviewOverlaySchema.safeParse({
      ...VALID_OVERLAY,
      decision: "resolve_gate",
      scope: "review_gate",
      lifecycleEffect: "resolves_review_gate",
      affectedClaims: [],
      affectedEvidence: [
        {
          refType: "review_gate",
          ref: "review_gate_missing_route_001",
          role: "resolved_gate",
        },
      ],
    }).success).toBe(true);

    expect(HumanReviewOverlaySchema.safeParse({
      ...VALID_OVERLAY,
      decision: "keep_gate_open",
      scope: "review_gate",
      lifecycleEffect: "keeps_review_gate_open",
      affectedClaims: [],
      affectedEvidence: [],
    }).success).toBe(false);
  });

  it("requires expiry to be later than the review timestamp", () => {
    expect(HumanReviewOverlaySchema.safeParse({
      ...VALID_OVERLAY,
      expiresAt: "2026-06-07T11:59:59.000Z",
    }).success).toBe(false);
  });

  it("keeps decisions separate from lifecycle events and claim statuses", () => {
    expect(HumanReviewDecisionSchema.safeParse("human_reviewed").success).toBe(false);
    expect(HumanReviewDecisionSchema.safeParse("pass").success).toBe(false);
    expect(HumanReviewLifecycleEffectSchema.safeParse("human_reviewed").success).toBe(false);
    expect(ClaimLifecycleEventSchema.safeParse("support_claim").success).toBe(false);
    expect(LayoutProofClaimStatusSchema.safeParse("support_claim").success).toBe(false);
  });

  it("uses metadata-only string vocabularies", () => {
    const vocabularies = [
      HUMAN_REVIEW_DECISIONS,
      HUMAN_REVIEW_REASON_CATEGORIES,
      HUMAN_REVIEW_SCOPES,
      HUMAN_REVIEW_REFERENCE_TYPES,
      HUMAN_REVIEW_LIFECYCLE_EFFECTS,
    ] as const;

    for (const vocabulary of vocabularies) {
      expect(vocabulary.every((value) => typeof value === "string")).toBe(true);
      expect(new Set(vocabulary).size).toBe(vocabulary.length);
    }

    for (const value of HUMAN_REVIEW_DECISIONS) {
      expect(HumanReviewDecisionSchema.safeParse(value).success).toBe(true);
    }

    for (const value of HUMAN_REVIEW_REASON_CATEGORIES) {
      expect(HumanReviewReasonCategorySchema.safeParse(value).success).toBe(true);
    }

    for (const value of HUMAN_REVIEW_SCOPES) {
      expect(HumanReviewScopeSchema.safeParse(value).success).toBe(true);
    }

    for (const value of HUMAN_REVIEW_REFERENCE_TYPES) {
      expect(HumanReviewReferenceTypeSchema.safeParse(value).success).toBe(true);
    }
  });
});
