import { z } from "zod";
import {
  type EventObjectHumanReviewTrigger,
} from "./event-object-semantics.js";
import { type ReviewGateReason } from "./review-gate.js";

export const REGULATORY_TRIGGER_TAGS = [
  "raised_structure",
  "stage_platform",
  "truss_rigging",
  "heat_source",
  "fabric_drape",
  "heavy_load",
  "cable_crossing",
  "external_catering_equipment",
  "heritage_contact_risk",
] as const;
export const RegulatoryTriggerTagSchema = z.enum(REGULATORY_TRIGGER_TAGS);
export type RegulatoryTriggerTag = z.infer<typeof RegulatoryTriggerTagSchema>;

export const REGULATORY_TRIGGER_REVIEW_OUTCOMES = [
  "create_review_gate",
  "requires_venue_policy_review",
  "requires_specialist_review",
  "block_public_exposure_until_reviewed",
] as const;
export const RegulatoryTriggerReviewOutcomeSchema = z.enum(
  REGULATORY_TRIGGER_REVIEW_OUTCOMES,
);
export type RegulatoryTriggerReviewOutcome = z.infer<
  typeof RegulatoryTriggerReviewOutcomeSchema
>;

export const REGULATORY_TRIGGER_TAG_REVIEW_REASONS = {
  raised_structure: "temporary_structure",
  stage_platform: "temporary_structure",
  truss_rigging: "high_risk_activity",
  heat_source: "high_risk_activity",
  fabric_drape: "venue_policy_requires_review",
  heavy_load: "venue_policy_requires_review",
  cable_crossing: "venue_policy_requires_review",
  external_catering_equipment: "high_risk_activity",
  heritage_contact_risk: "protected_heritage_zone",
} as const satisfies Record<RegulatoryTriggerTag, ReviewGateReason>;

export const REGULATORY_TRIGGER_TAG_HUMAN_REVIEW_TRIGGERS = {
  raised_structure: ["stage_platform_review", "floor_loading_review"],
  stage_platform: ["stage_platform_review", "floor_loading_review"],
  truss_rigging: ["rigging_review"],
  heat_source: ["heat_output_review"],
  fabric_drape: ["venue_policy_review"],
  heavy_load: ["floor_loading_review"],
  cable_crossing: ["venue_policy_review"],
  external_catering_equipment: [
    "heat_output_review",
    "floor_loading_review",
    "venue_policy_review",
  ],
  heritage_contact_risk: ["heritage_contact_review"],
} as const satisfies Record<RegulatoryTriggerTag, readonly EventObjectHumanReviewTrigger[]>;
