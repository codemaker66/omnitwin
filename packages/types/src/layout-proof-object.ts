import { z } from "zod";

export const LAYOUT_PROOF_CLAIM_FAMILIES = [
  "capacity",
  "egress",
  "accessibility",
  "budget",
  "heritage",
  "operational_setup",
  "supplier_load_in",
  "venue_specific",
] as const;

export const LayoutProofClaimFamilySchema = z.enum(LAYOUT_PROOF_CLAIM_FAMILIES);
export type LayoutProofClaimFamily = z.infer<typeof LayoutProofClaimFamilySchema>;

export const LAYOUT_PROOF_CLAIM_STATUSES = [
  "pass",
  "warn",
  "fail",
  "not_checked",
  "inapplicable",
  "requires_human_review",
  "stale",
] as const;

export const LayoutProofClaimStatusSchema = z.enum(LAYOUT_PROOF_CLAIM_STATUSES);
export type LayoutProofClaimStatus = z.infer<typeof LayoutProofClaimStatusSchema>;

export const LAYOUT_PROOF_EVIDENCE_ASSURANCE_LEVELS = [
  "draft_evidence",
  "replayable_evidence",
  "signed_evidence",
  "expert_reviewed",
  "formal_evidence",
] as const;

export const LayoutProofEvidenceAssuranceLevelSchema = z.enum(
  LAYOUT_PROOF_EVIDENCE_ASSURANCE_LEVELS,
);
export type LayoutProofEvidenceAssuranceLevel = z.infer<
  typeof LayoutProofEvidenceAssuranceLevelSchema
>;

export const LAYOUT_PROOF_STALE_REASONS = [
  "layout_changed",
  "venue_geometry_changed",
  "policy_bundle_changed",
  "validator_changed",
  "scenario_changed",
  "event_metadata_changed",
] as const;

export const LayoutProofStaleReasonSchema = z.enum(LAYOUT_PROOF_STALE_REASONS);
export type LayoutProofStaleReason = z.infer<typeof LayoutProofStaleReasonSchema>;

export const LAYOUT_PROOF_SCENARIO_ASSUMPTION_CATEGORIES = [
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
] as const;

export const LayoutProofScenarioAssumptionCategorySchema = z.enum(
  LAYOUT_PROOF_SCENARIO_ASSUMPTION_CATEGORIES,
);
export type LayoutProofScenarioAssumptionCategory = z.infer<
  typeof LayoutProofScenarioAssumptionCategorySchema
>;

export const LAYOUT_PROOF_LIFECYCLE_STATES = [
  "not_generated",
  "draft",
  "current",
  "partial",
  "stale",
  "superseded",
  "revoked",
] as const;

export const LayoutProofLifecycleStateSchema = z.enum(LAYOUT_PROOF_LIFECYCLE_STATES);
export type LayoutProofLifecycleState = z.infer<typeof LayoutProofLifecycleStateSchema>;

