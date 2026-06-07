import { describe, expect, it } from "vitest";
import { EventObjectHumanReviewTriggerSchema } from "../event-object-semantics.js";
import { LayoutProofClaimStatusSchema } from "../layout-proof-object.js";
import { ReviewGateReasonSchema } from "../review-gate.js";
import {
  REGULATORY_TRIGGER_REVIEW_OUTCOMES,
  REGULATORY_TRIGGER_TAGS,
  REGULATORY_TRIGGER_TAG_HUMAN_REVIEW_TRIGGERS,
  REGULATORY_TRIGGER_TAG_REVIEW_REASONS,
  RegulatoryTriggerReviewOutcomeSchema,
  RegulatoryTriggerTagSchema,
} from "../regulatory-trigger-tags.js";

describe("Regulatory Trigger Tags vocabulary", () => {
  it("pins regulatory trigger tags from STACK-001", () => {
    expect(REGULATORY_TRIGGER_TAGS).toEqual([
      "raised_structure",
      "stage_platform",
      "truss_rigging",
      "heat_source",
      "fabric_drape",
      "heavy_load",
      "cable_crossing",
      "external_catering_equipment",
      "heritage_contact_risk",
    ]);

    for (const tag of REGULATORY_TRIGGER_TAGS) {
      expect(RegulatoryTriggerTagSchema.safeParse(tag).success).toBe(true);
    }
  });

  it("pins safe review outcomes for trigger handling", () => {
    expect(REGULATORY_TRIGGER_REVIEW_OUTCOMES).toEqual([
      "create_review_gate",
      "requires_venue_policy_review",
      "requires_specialist_review",
      "block_public_exposure_until_reviewed",
    ]);

    for (const outcome of REGULATORY_TRIGGER_REVIEW_OUTCOMES) {
      expect(RegulatoryTriggerReviewOutcomeSchema.safeParse(outcome).success).toBe(true);
    }
  });

  it("maps every regulatory trigger tag to a review-gate reason", () => {
    expect(Object.keys(REGULATORY_TRIGGER_TAG_REVIEW_REASONS).sort()).toEqual(
      [...REGULATORY_TRIGGER_TAGS].sort(),
    );

    for (const tag of REGULATORY_TRIGGER_TAGS) {
      expect(ReviewGateReasonSchema.safeParse(REGULATORY_TRIGGER_TAG_REVIEW_REASONS[tag]).success)
        .toBe(true);
    }
  });

  it("maps every regulatory trigger tag to event-object review triggers", () => {
    expect(Object.keys(REGULATORY_TRIGGER_TAG_HUMAN_REVIEW_TRIGGERS).sort()).toEqual(
      [...REGULATORY_TRIGGER_TAGS].sort(),
    );

    for (const tag of REGULATORY_TRIGGER_TAGS) {
      const triggers = REGULATORY_TRIGGER_TAG_HUMAN_REVIEW_TRIGGERS[tag];
      expect(triggers.length).toBeGreaterThan(0);

      for (const trigger of triggers) {
        expect(EventObjectHumanReviewTriggerSchema.safeParse(trigger).success).toBe(true);
      }
    }
  });

  it("keeps trigger tags out of claim statuses and forbidden approval wording", () => {
    expect(RegulatoryTriggerTagSchema.safeParse("pass").success).toBe(false);
    expect(RegulatoryTriggerTagSchema.safeParse("fail").success).toBe(false);
    expect(RegulatoryTriggerTagSchema.safeParse("certified").success).toBe(false);
    expect(RegulatoryTriggerTagSchema.safeParse("approved").success).toBe(false);
    expect(LayoutProofClaimStatusSchema.safeParse("stage_platform").success).toBe(false);
    expect(LayoutProofClaimStatusSchema.safeParse("heritage_contact_risk").success).toBe(false);
  });

  it("uses metadata-only string vocabularies", () => {
    const vocabularies = [REGULATORY_TRIGGER_TAGS, REGULATORY_TRIGGER_REVIEW_OUTCOMES] as const;

    for (const vocabulary of vocabularies) {
      expect(vocabulary.every((value) => typeof value === "string")).toBe(true);
      expect(new Set(vocabulary).size).toBe(vocabulary.length);
    }
  });
});
