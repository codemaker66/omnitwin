import { z } from "zod";

export const REVIEW_GATE_REASONS = [
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
] as const;
export const ReviewGateReasonSchema = z.enum(REVIEW_GATE_REASONS);
export type ReviewGateReason = z.infer<typeof ReviewGateReasonSchema>;

export const REVIEW_GATE_REVIEWER_ROLES = [
  "venue_events_team",
  "hallkeeper",
  "venue_operations_manager",
  "accessibility_reviewer",
  "fire_safety_reviewer",
  "heritage_reviewer",
  "supplier_coordinator",
  "technical_admin",
] as const;
export const ReviewGateReviewerRoleSchema = z.enum(REVIEW_GATE_REVIEWER_ROLES);
export type ReviewGateReviewerRole = z.infer<typeof ReviewGateReviewerRoleSchema>;

export const REVIEW_GATE_REQUIRED_DATA_CATEGORIES = [
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
] as const;
export const ReviewGateRequiredDataCategorySchema = z.enum(REVIEW_GATE_REQUIRED_DATA_CATEGORIES);
export type ReviewGateRequiredDataCategory = z.infer<typeof ReviewGateRequiredDataCategorySchema>;

export const REVIEW_GATE_BLOCKING_MODES = [
  "blocking",
  "non_blocking",
  "blocks_export_only",
  "blocks_public_exposure",
] as const;
export const ReviewGateBlockingModeSchema = z.enum(REVIEW_GATE_BLOCKING_MODES);
export type ReviewGateBlockingMode = z.infer<typeof ReviewGateBlockingModeSchema>;

export const REVIEW_GATE_LIFECYCLE_STATUSES = [
  "gate_open",
  "gate_queued",
  "gate_in_review",
  "gate_resolved",
  "gate_stale",
  "gate_superseded",
  "gate_withdrawn",
] as const;
export const ReviewGateLifecycleStatusSchema = z.enum(REVIEW_GATE_LIFECYCLE_STATUSES);
export type ReviewGateLifecycleStatus = z.infer<typeof ReviewGateLifecycleStatusSchema>;

export const REVIEW_GATE_MESSAGE_KEY_FAMILIES = [
  "review_gate_missing_data",
  "review_gate_near_threshold",
  "review_gate_policy_scope",
  "review_gate_accessibility",
  "review_gate_heritage",
  "review_gate_guest_flow",
  "review_gate_temporary_structure",
  "review_gate_venue_policy",
] as const;
export const ReviewGateMessageKeyFamilySchema = z.enum(REVIEW_GATE_MESSAGE_KEY_FAMILIES);
export type ReviewGateMessageKeyFamily = z.infer<typeof ReviewGateMessageKeyFamilySchema>;

