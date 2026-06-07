import { z } from "zod";

export const CLAIM_LIFECYCLE_STATES = [
  "created",
  "supported",
  "machine_checked",
  "human_reviewed",
  "verified",
  "contested",
  "superseded",
  "stale",
  "expired",
  "withdrawn",
  "published",
] as const;
export const ClaimLifecycleStateSchema = z.enum(CLAIM_LIFECYCLE_STATES);
export type ClaimLifecycleState = z.infer<typeof ClaimLifecycleStateSchema>;

export const CLAIM_LIFECYCLE_EVENTS = [
  "capture_ingested",
  "claim_created",
  "evidence_attached",
  "validator_checked",
  "human_reviewed",
  "user_contested",
  "layout_changed",
  "venue_geometry_changed",
  "policy_changed",
  "validator_changed",
  "capture_refreshed",
  "claim_published",
  "claim_withdrawn",
] as const;
export const ClaimLifecycleEventSchema = z.enum(CLAIM_LIFECYCLE_EVENTS);
export type ClaimLifecycleEvent = z.infer<typeof ClaimLifecycleEventSchema>;

export const CLAIM_STALENESS_TRIGGERS = [
  "layout_snapshot_changed",
  "venue_runtime_package_changed",
  "scene_authority_map_changed",
  "policy_bundle_changed",
  "capture_session_superseded",
  "proof_object_superseded",
  "verification_expiry_reached",
  "manual_contestation",
] as const;
export const ClaimStalenessTriggerSchema = z.enum(CLAIM_STALENESS_TRIGGERS);
export type ClaimStalenessTrigger = z.infer<typeof ClaimStalenessTriggerSchema>;

export const CLAIM_REGENERATION_DECISIONS = [
  "regenerate_automatically",
  "queue_human_review",
  "preserve_stale",
  "mark_contested",
  "create_new_claim_version",
  "mark_superseded",
  "unsupported",
] as const;
export const ClaimRegenerationDecisionSchema = z.enum(CLAIM_REGENERATION_DECISIONS);
export type ClaimRegenerationDecision = z.infer<typeof ClaimRegenerationDecisionSchema>;

export const CLAIM_LIFECYCLE_ACTOR_CATEGORIES = [
  "user",
  "venue_staff",
  "hallkeeper",
  "reviewer",
  "validator",
  "system",
  "capture_pipeline",
  "runtime_pipeline",
  "policy_engine",
  "import_job",
  "external_tool",
] as const;
export const ClaimLifecycleActorCategorySchema = z.enum(CLAIM_LIFECYCLE_ACTOR_CATEGORIES);
export type ClaimLifecycleActorCategory = z.infer<typeof ClaimLifecycleActorCategorySchema>;

export const CLAIM_LIFECYCLE_SOURCE_CATEGORIES = [
  "capture_session",
  "runtime_package",
  "scene_authority_map",
  "layout_snapshot",
  "policy_bundle",
  "proof_object",
  "evidence_pack",
  "validator_output",
  "human_review_record",
  "user_report",
  "external_source",
] as const;
export const ClaimLifecycleSourceCategorySchema = z.enum(CLAIM_LIFECYCLE_SOURCE_CATEGORIES);
export type ClaimLifecycleSourceCategory = z.infer<typeof ClaimLifecycleSourceCategorySchema>;

