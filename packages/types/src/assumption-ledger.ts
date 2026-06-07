import { z } from "zod";

export const ASSUMPTION_CATEGORIES = [
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
] as const;
export const AssumptionCategorySchema = z.enum(ASSUMPTION_CATEGORIES);
export type AssumptionCategory = z.infer<typeof AssumptionCategorySchema>;

export const ASSUMPTION_SOURCES = [
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
] as const;
export const AssumptionSourceSchema = z.enum(ASSUMPTION_SOURCES);
export type AssumptionSource = z.infer<typeof AssumptionSourceSchema>;

export const ASSUMPTION_ASSURANCE_BANDS = [
  "venue_confirmed",
  "staff_reviewed",
  "documented_source",
  "user_supplied",
  "machine_inferred",
  "system_default",
  "low_assurance",
  "unknown_assurance",
] as const;
export const AssumptionAssuranceBandSchema = z.enum(ASSUMPTION_ASSURANCE_BANDS);
export type AssumptionAssuranceBand = z.infer<typeof AssumptionAssuranceBandSchema>;

export const ASSUMPTION_STALE_TRIGGERS = [
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
] as const;
export const AssumptionStaleTriggerSchema = z.enum(ASSUMPTION_STALE_TRIGGERS);
export type AssumptionStaleTrigger = z.infer<typeof AssumptionStaleTriggerSchema>;

export const ASSUMPTION_REVIEW_REQUIREMENTS = [
  "no_review_required",
  "venue_staff_review_required",
  "hallkeeper_review_required",
  "accessibility_review_required",
  "policy_review_required",
  "heritage_review_required",
  "supplier_review_required",
  "pricing_review_required",
  "operational_precedent_required",
] as const;
export const AssumptionReviewRequirementSchema = z.enum(ASSUMPTION_REVIEW_REQUIREMENTS);
export type AssumptionReviewRequirement = z.infer<typeof AssumptionReviewRequirementSchema>;
