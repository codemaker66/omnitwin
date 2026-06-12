import { z } from "zod";
import { ConfigurationIdSchema } from "./configuration.js";
import { UserIdSchema } from "./user.js";
import { CanonicalJsonValueSchema, sha256Hex, stableCanonicalJson } from "./canonical-layout-snapshot.js";

export const EVIDENCE_RUNTIME_SCHEMA_VERSION = "evidence_runtime.v0";
export const EVIDENCE_PACK_PAYLOAD_SCHEMA_VERSION = "evidence_pack.v0";
export const EVIDENCE_PACK_DIGEST_DOMAIN_PREFIX = "venviewer.evidence_pack.v0\n";

const UUID = z.string().uuid();
const SHA256_HEX = /^[a-f0-9]{64}$/;

export const EvidenceItemIdSchema = UUID.brand<"EvidenceItemId">();
export type EvidenceItemId = z.infer<typeof EvidenceItemIdSchema>;

export const CheckResultIdSchema = UUID.brand<"CheckResultId">();
export type CheckResultId = z.infer<typeof CheckResultIdSchema>;

export const AssumptionRecordIdSchema = UUID.brand<"AssumptionRecordId">();
export type AssumptionRecordId = z.infer<typeof AssumptionRecordIdSchema>;

export const ReviewGateIdSchema = UUID.brand<"ReviewGateId">();
export type ReviewGateId = z.infer<typeof ReviewGateIdSchema>;

export const ClaimStateIdSchema = UUID.brand<"ClaimStateId">();
export type ClaimStateId = z.infer<typeof ClaimStateIdSchema>;

export const EvidencePackIdSchema = UUID.brand<"EvidencePackId">();
export type EvidencePackId = z.infer<typeof EvidencePackIdSchema>;

export const EvidencePackItemIdSchema = UUID.brand<"EvidencePackItemId">();
export type EvidencePackItemId = z.infer<typeof EvidencePackItemIdSchema>;

export const StaleEvidenceEventIdSchema = UUID.brand<"StaleEvidenceEventId">();
export type StaleEvidenceEventId = z.infer<typeof StaleEvidenceEventIdSchema>;

export const GeneralAuditLogIdSchema = UUID.brand<"GeneralAuditLogId">();
export type GeneralAuditLogId = z.infer<typeof GeneralAuditLogIdSchema>;

export const EVIDENCE_TARGET_TYPES = [
  "configuration",
  "layout_snapshot",
  "event_phase",
  "layout_variant",
  "table",
  "route",
  "room",
  "runtime_asset",
  "review_gate",
] as const;
export const EvidenceTargetTypeSchema = z.enum(EVIDENCE_TARGET_TYPES);
export type EvidenceTargetType = z.infer<typeof EvidenceTargetTypeSchema>;

export const EVIDENCE_STATUSES = [
  "current",
  "stale",
  "partial",
  "missing",
  "not_checked",
] as const;
export const EvidenceRuntimeStatusSchema = z.enum(EVIDENCE_STATUSES);
export type EvidenceRuntimeStatus = z.infer<typeof EvidenceRuntimeStatusSchema>;

export const EVIDENCE_CONFIDENCE_LEVELS = [
  "high",
  "medium",
  "low",
  "unknown",
] as const;
export const EvidenceConfidenceSchema = z.enum(EVIDENCE_CONFIDENCE_LEVELS);
export type EvidenceConfidence = z.infer<typeof EvidenceConfidenceSchema>;

export const EVIDENCE_ITEM_TYPES = [
  "layout_snapshot",
  "capacity_result",
  "route_clearance_result",
  "runtime_asset_status",
  "assumption",
  "review_gate",
  "safe_wording",
  "human_review_required",
] as const;
export const EvidenceItemTypeSchema = z.enum(EVIDENCE_ITEM_TYPES);
export type EvidenceItemType = z.infer<typeof EvidenceItemTypeSchema>;

export const EVIDENCE_SOURCE_TYPES = [
  "approved_layout_snapshot",
  "configuration_record",
  "runtime_asset_registry",
  "operator_assumption",
  "system_generated",
  "human_review",
] as const;
export const EvidenceSourceTypeSchema = z.enum(EVIDENCE_SOURCE_TYPES);
export type EvidenceSourceType = z.infer<typeof EvidenceSourceTypeSchema>;

export const CHECK_RESULT_TYPES = [
  "snapshot_hash",
  "layout_count",
  "capacity",
  "route_clearance",
  "runtime_asset_status",
] as const;
export const CheckResultTypeSchema = z.enum(CHECK_RESULT_TYPES);
export type CheckResultType = z.infer<typeof CheckResultTypeSchema>;

export const CHECK_RESULT_STATUSES = [
  "passed",
  "failed",
  "not_checked",
  "not_available",
  "requires_review",
] as const;
export const CheckResultStatusSchema = z.enum(CHECK_RESULT_STATUSES);
export type CheckResultStatus = z.infer<typeof CheckResultStatusSchema>;

export const REVIEW_GATE_STATUSES = [
  "open",
  "approved",
  "rejected",
  "waived",
] as const;
export const ReviewGateStatusSchema = z.enum(REVIEW_GATE_STATUSES);
export type ReviewGateStatus = z.infer<typeof ReviewGateStatusSchema>;

export const REVIEW_GATE_TYPES = [
  "human_review_required",
  "missing_route_clearance",
  "runtime_asset_unverified",
  "stale_snapshot",
  "operator_assumption",
] as const;
export const ReviewGateTypeSchema = z.enum(REVIEW_GATE_TYPES);
export type ReviewGateType = z.infer<typeof ReviewGateTypeSchema>;

export const CLAIM_STATE_STATUSES = [
  "planning_evidence",
  "human_review_required",
  "not_checked",
  "unsupported",
  "stale",
] as const;
export const ClaimStateStatusSchema = z.enum(CLAIM_STATE_STATUSES);
export type ClaimStateStatus = z.infer<typeof ClaimStateStatusSchema>;

export const EVIDENCE_PACK_STATUSES = [
  "generated",
  "superseded",
  "stale",
] as const;
export const EvidencePackStatusSchema = z.enum(EVIDENCE_PACK_STATUSES);
export type EvidencePackStatus = z.infer<typeof EvidencePackStatusSchema>;

export const STALENESS_STATES = [
  "current",
  "review_due",
  "stale",
  "unknown",
] as const;
export const EvidenceStalenessSchema = z.enum(STALENESS_STATES);
export type EvidenceStaleness = z.infer<typeof EvidenceStalenessSchema>;

export const UNSAFE_PUBLIC_CLAIM_PHRASES = [
  "fire approved",
  "certified safe",
  "legally compliant",
  "survey-grade",
  "approved for occupancy",
  "guaranteed accessible",
  "Black Label",
  "production ready",
  "photoreal digital twin",
] as const;

const UNSAFE_PUBLIC_CLAIM_REPLACEMENTS: Readonly<Record<string, string>> = {
  "fire approved": "requires appropriate fire review",
  "certified safe": "requires human review",
  "legally compliant": "not legally certified",
  "survey-grade": "planning evidence",
  "approved for occupancy": "human review required",
  "guaranteed accessible": "accessibility review required",
  "Black Label": "review-gated tier",
  "production ready": "not yet production reviewed",
  "photoreal digital twin": "runtime visual preview",
};

function escapedPhrase(phrase: string): string {
  return phrase.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function findUnsafePublicClaim(text: string): string | null {
  for (const phrase of UNSAFE_PUBLIC_CLAIM_PHRASES) {
    const pattern = new RegExp(`\\b${escapedPhrase(phrase)}\\b`, "iu");
    if (pattern.test(text)) return phrase;
  }
  return null;
}

export function safePlanningLanguage(text: string): string {
  let safeText = text;
  for (const [unsafe, replacement] of Object.entries(UNSAFE_PUBLIC_CLAIM_REPLACEMENTS)) {
    safeText = safeText.replace(new RegExp(`\\b${escapedPhrase(unsafe)}\\b`, "giu"), replacement);
  }
  return safeText;
}

export const SafePlanningWordingSchema = z.string().trim().min(1).max(500).superRefine((text, ctx) => {
  const unsafe = findUnsafePublicClaim(text);
  if (unsafe !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Unsafe public/client claim phrase "${unsafe}" is not allowed.`,
    });
  }
});

export const EvidenceItemSchema = z.object({
  id: EvidenceItemIdSchema,
  configId: ConfigurationIdSchema.nullable(),
  targetType: EvidenceTargetTypeSchema,
  targetId: z.string().trim().min(1).max(160),
  itemType: EvidenceItemTypeSchema,
  sourceType: EvidenceSourceTypeSchema,
  sourceLabel: z.string().trim().min(1).max(200),
  confidence: EvidenceConfidenceSchema,
  status: EvidenceRuntimeStatusSchema,
  staleState: EvidenceStalenessSchema,
  wording: SafePlanningWordingSchema,
  metadata: z.record(z.unknown()).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

export const CheckResultSchema = z.object({
  id: CheckResultIdSchema,
  evidenceItemId: EvidenceItemIdSchema.nullable(),
  configId: ConfigurationIdSchema.nullable(),
  targetType: EvidenceTargetTypeSchema,
  targetId: z.string().trim().min(1).max(160),
  checkType: CheckResultTypeSchema,
  status: CheckResultStatusSchema,
  severity: z.enum(["info", "warning", "blocking"]),
  message: SafePlanningWordingSchema,
  measuredValue: z.number().finite().nullable(),
  thresholdValue: z.number().finite().nullable(),
  unit: z.string().trim().min(1).max(40).nullable(),
  sourceLabel: z.string().trim().min(1).max(200),
  createdAt: z.string().datetime(),
}).strict();
export type CheckResult = z.infer<typeof CheckResultSchema>;

export const AssumptionRecordSchema = z.object({
  id: AssumptionRecordIdSchema,
  configId: ConfigurationIdSchema.nullable(),
  targetType: EvidenceTargetTypeSchema,
  targetId: z.string().trim().min(1).max(160),
  assumptionType: z.string().trim().min(1).max(80),
  value: CanonicalJsonValueSchema,
  sourceLabel: z.string().trim().min(1).max(200),
  status: z.enum(["active", "superseded", "rejected"]),
  createdAt: z.string().datetime(),
}).strict();
export type AssumptionRecord = z.infer<typeof AssumptionRecordSchema>;

export const ReviewGateSchema = z.object({
  id: ReviewGateIdSchema,
  configId: ConfigurationIdSchema.nullable(),
  targetType: EvidenceTargetTypeSchema,
  targetId: z.string().trim().min(1).max(160),
  gateType: ReviewGateTypeSchema,
  status: ReviewGateStatusSchema,
  title: z.string().trim().min(1).max(200),
  description: SafePlanningWordingSchema,
  requiredRole: z.string().trim().min(1).max(80).nullable(),
  decisionBy: UserIdSchema.nullable(),
  decisionAt: z.string().datetime().nullable(),
  decisionNote: z.string().trim().max(1000).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
export type ReviewGate = z.infer<typeof ReviewGateSchema>;

export const ClaimStateSchema = z.object({
  id: ClaimStateIdSchema,
  configId: ConfigurationIdSchema.nullable(),
  targetType: EvidenceTargetTypeSchema,
  targetId: z.string().trim().min(1).max(160),
  claimKey: z.string().trim().min(1).max(120),
  status: ClaimStateStatusSchema,
  safeWording: SafePlanningWordingSchema,
  evidencePackId: EvidencePackIdSchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
export type ClaimState = z.infer<typeof ClaimStateSchema>;

export const EvidencePackCheckSummarySchema = z.object({
  checkType: CheckResultTypeSchema,
  status: CheckResultStatusSchema,
  message: SafePlanningWordingSchema,
}).strict();
export type EvidencePackCheckSummary = z.infer<typeof EvidencePackCheckSummarySchema>;

export const EvidencePackRuntimeAssetStatusSchema = z.object({
  status: EvidenceRuntimeStatusSchema,
  runtimePackageId: z.string().uuid().nullable(),
  evidenceStatus: z.string().trim().min(1).max(80).nullable(),
  wording: SafePlanningWordingSchema,
}).strict();
export type EvidencePackRuntimeAssetStatus = z.infer<typeof EvidencePackRuntimeAssetStatusSchema>;

export const EvidencePackAssumptionSchema = z.object({
  assumptionType: z.string().trim().min(1).max(80),
  value: CanonicalJsonValueSchema,
  sourceLabel: z.string().trim().min(1).max(200),
}).strict();
export type EvidencePackAssumption = z.infer<typeof EvidencePackAssumptionSchema>;

export const EvidencePackReviewGateSummarySchema = z.object({
  gateType: ReviewGateTypeSchema,
  status: ReviewGateStatusSchema,
  title: z.string().trim().min(1).max(200),
  description: SafePlanningWordingSchema,
}).strict();
export type EvidencePackReviewGateSummary = z.infer<typeof EvidencePackReviewGateSummarySchema>;

export const EvidencePackPayloadSchema = z.object({
  schemaVersion: z.literal(EVIDENCE_PACK_PAYLOAD_SCHEMA_VERSION),
  snapshotHash: z.string().regex(SHA256_HEX),
  layoutCount: z.number().int().nonnegative(),
  capacityResult: EvidencePackCheckSummarySchema,
  routeClearanceResult: EvidencePackCheckSummarySchema,
  runtimeAssetStatus: EvidencePackRuntimeAssetStatusSchema,
  assumptions: z.array(EvidencePackAssumptionSchema),
  reviewGates: z.array(EvidencePackReviewGateSummarySchema),
  safeWording: z.array(SafePlanningWordingSchema),
  humanReviewRequired: z.boolean(),
}).strict();
export type EvidencePackPayload = z.infer<typeof EvidencePackPayloadSchema>;

export function evidencePackPayloadDigest(payload: EvidencePackPayload): string {
  const parsed = EvidencePackPayloadSchema.parse(payload);
  return sha256Hex(`${EVIDENCE_PACK_DIGEST_DOMAIN_PREFIX}${stableCanonicalJson(parsed)}`);
}

export const EvidencePackSchema = z.object({
  id: EvidencePackIdSchema,
  configId: ConfigurationIdSchema,
  snapshotId: z.string().uuid(),
  snapshotHash: z.string().regex(SHA256_HEX),
  payloadHash: z.string().regex(SHA256_HEX),
  status: EvidencePackStatusSchema,
  humanReviewRequired: z.boolean(),
  payload: EvidencePackPayloadSchema,
  generatedBy: UserIdSchema.nullable(),
  generatedAt: z.string().datetime(),
  staleAt: z.string().datetime().nullable(),
}).strict();
export type EvidencePack = z.infer<typeof EvidencePackSchema>;

export const EvidencePackItemSchema = z.object({
  id: EvidencePackItemIdSchema,
  evidencePackId: EvidencePackIdSchema,
  evidenceItemId: EvidenceItemIdSchema,
  itemRole: EvidenceItemTypeSchema,
  createdAt: z.string().datetime(),
}).strict();
export type EvidencePackItem = z.infer<typeof EvidencePackItemSchema>;

export const StaleEvidenceEventSchema = z.object({
  id: StaleEvidenceEventIdSchema,
  configId: ConfigurationIdSchema,
  targetType: EvidenceTargetTypeSchema,
  targetId: z.string().trim().min(1).max(160),
  evidencePackId: EvidencePackIdSchema.nullable(),
  reason: z.string().trim().min(1).max(200),
  previousHash: z.string().regex(SHA256_HEX).nullable(),
  newHash: z.string().regex(SHA256_HEX).nullable(),
  createdAt: z.string().datetime(),
}).strict();
export type StaleEvidenceEvent = z.infer<typeof StaleEvidenceEventSchema>;

export const GeneralAuditLogSchema = z.object({
  id: GeneralAuditLogIdSchema,
  actorUserId: UserIdSchema.nullable(),
  action: z.string().trim().min(1).max(120),
  targetType: z.string().trim().min(1).max(80),
  targetId: z.string().trim().min(1).max(160),
  summary: SafePlanningWordingSchema,
  metadata: z.record(z.unknown()).nullable(),
  createdAt: z.string().datetime(),
}).strict();
export type GeneralAuditLog = z.infer<typeof GeneralAuditLogSchema>;

export const EvidencePackBundleSchema = z.object({
  pack: EvidencePackSchema,
  evidenceItems: z.array(EvidenceItemSchema),
  checkResults: z.array(CheckResultSchema),
  assumptions: z.array(AssumptionRecordSchema),
  reviewGates: z.array(ReviewGateSchema),
  claimStates: z.array(ClaimStateSchema),
}).strict();
export type EvidencePackBundle = z.infer<typeof EvidencePackBundleSchema>;

export const ReviewGateDecisionInputSchema = z.object({
  status: ReviewGateStatusSchema.refine((status) => status !== "open", {
    message: "Decision status must close or waive the review gate.",
  }),
  note: z.string().trim().max(1000).nullable().optional(),
}).strict();
export type ReviewGateDecisionInput = z.infer<typeof ReviewGateDecisionInputSchema>;

export const TruthModeSummarySchema = z.object({
  targetType: EvidenceTargetTypeSchema,
  targetId: z.string().trim().min(1).max(160),
  source: SafePlanningWordingSchema,
  confidence: EvidenceConfidenceSchema,
  assumption: SafePlanningWordingSchema,
  evidenceStatus: EvidenceRuntimeStatusSchema,
  reviewGate: SafePlanningWordingSchema,
  staleState: EvidenceStalenessSchema,
  safeWording: z.array(SafePlanningWordingSchema),
  humanReviewRequired: z.boolean(),
  counts: z.object({
    evidenceItems: z.number().int().nonnegative(),
    checkResults: z.number().int().nonnegative(),
    assumptions: z.number().int().nonnegative(),
    reviewGates: z.number().int().nonnegative(),
    staleEvents: z.number().int().nonnegative(),
  }).strict(),
}).strict();
export type TruthModeSummary = z.infer<typeof TruthModeSummarySchema>;
