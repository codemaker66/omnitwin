import { z } from "zod";

export const PURPOSE_FIT_CATEGORIES = [
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
] as const;
export const PurposeFitCategorySchema = z.enum(PURPOSE_FIT_CATEGORIES);
export type PurposeFitCategory = z.infer<typeof PurposeFitCategorySchema>;

export const PURPOSE_FIT_STATUSES = [
  "fit_for_purpose",
  "fit_with_limitations",
  "partially_fit",
  "not_fit_for_purpose",
  "not_checked_for_purpose",
  "stale_for_purpose",
  "requires_review_for_purpose",
  "unsupported_for_purpose",
] as const;
export const PurposeFitStatusSchema = z.enum(PURPOSE_FIT_STATUSES);
export type PurposeFitStatus = z.infer<typeof PurposeFitStatusSchema>;

export const PURPOSE_EVIDENCE_REQUIREMENT_REFS = [
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
] as const;
export const PurposeEvidenceRequirementRefSchema = z.enum(PURPOSE_EVIDENCE_REQUIREMENT_REFS);
export type PurposeEvidenceRequirementRef = z.infer<typeof PurposeEvidenceRequirementRefSchema>;

export const PURPOSE_CONFIDENCE_LABELS = [
  "strong_for_purpose",
  "adequate_for_purpose",
  "weak_for_purpose",
  "unknown_for_purpose",
  "not_applicable_for_purpose",
] as const;
export const PurposeConfidenceLabelSchema = z.enum(PURPOSE_CONFIDENCE_LABELS);
export type PurposeConfidenceLabel = z.infer<typeof PurposeConfidenceLabelSchema>;

