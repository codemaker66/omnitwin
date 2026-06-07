import { z } from "zod";
import { ClaimLifecycleActorCategorySchema } from "./claim-lifecycle.js";
import { ReviewGateReviewerRoleSchema } from "./review-gate.js";

export const HUMAN_REVIEW_OVERLAY_SCHEMA_VERSION = "venviewer.human-review-overlay.v0";

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T/;
const SLUG_TOKEN = /^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/;

export const HUMAN_REVIEW_DECISIONS = [
  "support_claim",
  "contest_claim",
  "resolve_gate",
  "keep_gate_open",
  "supersede_prior_review",
  "defer_review",
  "withdraw_review",
] as const;
export const HumanReviewDecisionSchema = z.enum(HUMAN_REVIEW_DECISIONS);
export type HumanReviewDecision = z.infer<typeof HumanReviewDecisionSchema>;

export const HUMAN_REVIEW_REASON_CATEGORIES = [
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
] as const;
export const HumanReviewReasonCategorySchema = z.enum(HUMAN_REVIEW_REASON_CATEGORIES);
export type HumanReviewReasonCategory = z.infer<typeof HumanReviewReasonCategorySchema>;

export const HUMAN_REVIEW_SCOPES = [
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
] as const;
export const HumanReviewScopeSchema = z.enum(HUMAN_REVIEW_SCOPES);
export type HumanReviewScope = z.infer<typeof HumanReviewScopeSchema>;

export const HUMAN_REVIEW_REFERENCE_TYPES = [
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
] as const;
export const HumanReviewReferenceTypeSchema = z.enum(HUMAN_REVIEW_REFERENCE_TYPES);
export type HumanReviewReferenceType = z.infer<typeof HumanReviewReferenceTypeSchema>;

export const HUMAN_REVIEW_LIFECYCLE_EFFECTS = [
  "records_human_review",
  "supports_current_claim",
  "contests_current_claim",
  "resolves_review_gate",
  "keeps_review_gate_open",
  "supersedes_prior_overlay",
  "expires_review_overlay",
  "no_lifecycle_change",
] as const;
export const HumanReviewLifecycleEffectSchema = z.enum(HUMAN_REVIEW_LIFECYCLE_EFFECTS);
export type HumanReviewLifecycleEffect = z.infer<typeof HumanReviewLifecycleEffectSchema>;

export const HumanReviewReferenceSchema = z.object({
  refType: HumanReviewReferenceTypeSchema,
  ref: z.string().trim().min(1).max(512),
  role: z.string().trim().min(1).max(80).regex(SLUG_TOKEN).optional(),
}).strict();
export type HumanReviewReference = z.infer<typeof HumanReviewReferenceSchema>;

export const HumanReviewOverlaySchema = z.object({
  schemaVersion: z.literal(HUMAN_REVIEW_OVERLAY_SCHEMA_VERSION),
  overlayId: z.string().trim().min(1).max(160).regex(SLUG_TOKEN),
  reviewerRole: ReviewGateReviewerRoleSchema,
  reviewerActorCategory: ClaimLifecycleActorCategorySchema,
  reviewerId: z.string().trim().min(1).max(255).optional(),
  decision: HumanReviewDecisionSchema,
  reason: HumanReviewReasonCategorySchema,
  reviewedAt: z.string().regex(ISO_DATE_TIME, "reviewedAt must be an ISO datetime."),
  scope: HumanReviewScopeSchema,
  expiresAt: z
    .string()
    .regex(ISO_DATE_TIME, "expiresAt must be an ISO datetime.")
    .nullable(),
  sourceWitnessRefs: z.array(HumanReviewReferenceSchema).min(1),
  affectedClaims: z.array(z.string().trim().min(1).max(255)),
  affectedEvidence: z.array(HumanReviewReferenceSchema),
  lifecycleEffect: HumanReviewLifecycleEffectSchema,
  machineWitnessMutationPolicy: z.literal("never_mutate_machine_witness"),
  replacesOverlayId: z.string().trim().min(1).max(160).regex(SLUG_TOKEN).optional(),
  reviewNote: z.string().trim().min(1).max(2000).optional(),
}).strict().superRefine((overlay, ctx) => {
  const reviewedAt = Date.parse(overlay.reviewedAt);
  const expiresAt = overlay.expiresAt === null ? null : Date.parse(overlay.expiresAt);

  if (expiresAt !== null && !Number.isNaN(reviewedAt) && !Number.isNaN(expiresAt) && expiresAt <= reviewedAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["expiresAt"],
      message: "expiresAt must be later than reviewedAt.",
    });
  }

  if (
    (overlay.decision === "support_claim" || overlay.decision === "contest_claim") &&
    overlay.affectedClaims.length === 0
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["affectedClaims"],
      message: "Claim review decisions must name at least one affected claim.",
    });
  }

  if (
    (overlay.decision === "resolve_gate" || overlay.decision === "keep_gate_open") &&
    !overlay.affectedEvidence.some((reference) => reference.refType === "review_gate")
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["affectedEvidence"],
      message: "Gate review decisions must reference a review gate.",
    });
  }
});
export type HumanReviewOverlay = z.infer<typeof HumanReviewOverlaySchema>;
