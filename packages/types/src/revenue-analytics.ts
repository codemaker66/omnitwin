import { z } from "zod";
import { VenueIdSchema } from "./venue.js";
import { EventIdSchema } from "./event-phase-graph.js";
import { ConfigurationIdSchema } from "./configuration.js";
import { SpaceIdSchema } from "./space.js";
import { UserIdSchema } from "./user.js";
import { CurrencySchema } from "./pricing.js";
import { QuoteIdSchema, MinorUnitAmountSchema } from "./proposal.js";

// ---------------------------------------------------------------------------
// Revenue and Executive Analytics v0
//
// Commercial planning insight only. Money is exact integer minor units.
// Comfort constraints and review gates are first-class; no output here should
// be read as a guarantee, approval, or authority override.
// ---------------------------------------------------------------------------

export const REVENUE_SCENARIO_STATUSES = ["draft", "active", "archived"] as const;
export const REVENUE_SCENARIO_KINDS = ["quote_based", "layout_based", "manual"] as const;
export const COMFORT_CONSTRAINT_TYPES = [
  "space_per_guest",
  "circulation",
  "bar_queue",
  "service_access",
  "review_gate",
] as const;
export const COMFORT_CONSTRAINT_STATUSES = ["ok", "warning", "review_required", "not_checked"] as const;
export const ANALYTICS_SNAPSHOT_TYPES = [
  "venue_dashboard",
  "pipeline_summary",
  "room_utilisation",
] as const;

export const RevenueScenarioIdSchema = z.string().uuid();
export type RevenueScenarioId = z.infer<typeof RevenueScenarioIdSchema>;

export const PricingAssumptionIdSchema = z.string().uuid();
export type PricingAssumptionId = z.infer<typeof PricingAssumptionIdSchema>;

export const ComfortConstraintIdSchema = z.string().uuid();
export type ComfortConstraintId = z.infer<typeof ComfortConstraintIdSchema>;

export const ScenarioComparisonIdSchema = z.string().uuid();
export type ScenarioComparisonId = z.infer<typeof ScenarioComparisonIdSchema>;

export const AnalyticsSnapshotIdSchema = z.string().uuid();
export type AnalyticsSnapshotId = z.infer<typeof AnalyticsSnapshotIdSchema>;

export const RevenueScenarioStatusSchema = z.enum(REVENUE_SCENARIO_STATUSES);
export type RevenueScenarioStatus = z.infer<typeof RevenueScenarioStatusSchema>;

export const RevenueScenarioKindSchema = z.enum(REVENUE_SCENARIO_KINDS);
export type RevenueScenarioKind = z.infer<typeof RevenueScenarioKindSchema>;

export const ComfortConstraintTypeSchema = z.enum(COMFORT_CONSTRAINT_TYPES);
export type ComfortConstraintType = z.infer<typeof ComfortConstraintTypeSchema>;

export const ComfortConstraintStatusSchema = z.enum(COMFORT_CONSTRAINT_STATUSES);
export type ComfortConstraintStatus = z.infer<typeof ComfortConstraintStatusSchema>;

export const AnalyticsSnapshotTypeSchema = z.enum(ANALYTICS_SNAPSHOT_TYPES);
export type AnalyticsSnapshotType = z.infer<typeof AnalyticsSnapshotTypeSchema>;

const PercentSchema = z.number().int().min(0).max(100);
const SafeCommercialTextSchema = z.string().trim().min(1).max(500).refine((value) => {
  const lower = value.toLowerCase();
  return ![
    "fire approved",
    "certified safe",
    "legally compliant",
    "survey-grade",
    "approved for occupancy",
    "guaranteed accessible",
    "production ready",
    "photoreal digital twin",
  ].some((phrase) => lower.includes(phrase));
}, "Unsupported certainty wording is not allowed in revenue analytics text");

export const PricingAssumptionInputSchema = z.object({
  key: z.string().trim().min(1).max(120),
  label: SafeCommercialTextSchema,
  valueMinor: MinorUnitAmountSchema.nullable().optional(),
  valueNumber: z.number().finite().nullable().optional(),
  valueText: SafeCommercialTextSchema.nullable().optional(),
  source: SafeCommercialTextSchema,
}).strict();
export type PricingAssumptionInput = z.infer<typeof PricingAssumptionInputSchema>;

export const ComfortConstraintInputSchema = z.object({
  constraintType: ComfortConstraintTypeSchema,
  label: SafeCommercialTextSchema,
  threshold: z.number().finite().nullable().optional(),
  actualValue: z.number().finite().nullable().optional(),
  status: ComfortConstraintStatusSchema,
  reviewRequired: z.boolean(),
  note: SafeCommercialTextSchema.nullable().optional(),
}).strict();
export type ComfortConstraintInput = z.infer<typeof ComfortConstraintInputSchema>;

export const RevenueScenarioSchema = z.object({
  id: RevenueScenarioIdSchema,
  venueId: VenueIdSchema,
  eventId: EventIdSchema.nullable(),
  configurationId: ConfigurationIdSchema.nullable(),
  quoteId: QuoteIdSchema.nullable(),
  name: SafeCommercialTextSchema,
  scenarioKind: RevenueScenarioKindSchema,
  status: RevenueScenarioStatusSchema,
  currency: CurrencySchema,
  plannedGuestCount: z.number().int().nonnegative(),
  estimatedRevenueMinor: MinorUnitAmountSchema,
  estimatedCostMinor: MinorUnitAmountSchema,
  estimatedMarginMinor: z.number().int().min(-100_000_000).max(100_000_000),
  comfortStatus: ComfortConstraintStatusSchema,
  reviewGateCount: z.number().int().nonnegative(),
  createdBy: UserIdSchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).superRefine((scenario, ctx) => {
  if (scenario.estimatedMarginMinor !== scenario.estimatedRevenueMinor - scenario.estimatedCostMinor) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["estimatedMarginMinor"],
      message: "estimatedMarginMinor must equal estimatedRevenueMinor - estimatedCostMinor exactly",
    });
  }
});
export type RevenueScenario = z.infer<typeof RevenueScenarioSchema>;

export const PricingAssumptionSchema = PricingAssumptionInputSchema.extend({
  id: PricingAssumptionIdSchema,
  revenueScenarioId: RevenueScenarioIdSchema,
  createdAt: z.string().datetime(),
}).strict();
export type PricingAssumption = z.infer<typeof PricingAssumptionSchema>;

export const ComfortConstraintSchema = ComfortConstraintInputSchema.extend({
  id: ComfortConstraintIdSchema,
  revenueScenarioId: RevenueScenarioIdSchema,
  createdAt: z.string().datetime(),
}).strict();
export type ComfortConstraint = z.infer<typeof ComfortConstraintSchema>;

export const ScenarioComparisonSchema = z.object({
  id: ScenarioComparisonIdSchema,
  venueId: VenueIdSchema,
  eventId: EventIdSchema.nullable(),
  leftScenarioId: RevenueScenarioIdSchema,
  rightScenarioId: RevenueScenarioIdSchema,
  currency: CurrencySchema,
  revenueDeltaMinor: z.number().int().min(-100_000_000).max(100_000_000),
  marginDeltaMinor: z.number().int().min(-100_000_000).max(100_000_000),
  comfortDeltaLabel: SafeCommercialTextSchema,
  reviewGateDelta: z.number().int().min(-10_000).max(10_000),
  recommendationStatus: ComfortConstraintStatusSchema,
  createdAt: z.string().datetime(),
}).strict();
export type ScenarioComparison = z.infer<typeof ScenarioComparisonSchema>;

export const AnalyticsSnapshotPayloadSchema = z.object({
  generatedFrom: SafeCommercialTextSchema,
  notes: z.array(SafeCommercialTextSchema).max(20),
  values: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
}).strict();
export type AnalyticsSnapshotPayload = z.infer<typeof AnalyticsSnapshotPayloadSchema>;

export const AnalyticsSnapshotSchema = z.object({
  id: AnalyticsSnapshotIdSchema,
  venueId: VenueIdSchema,
  snapshotType: AnalyticsSnapshotTypeSchema,
  payload: AnalyticsSnapshotPayloadSchema,
  generatedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
}).strict();
export type AnalyticsSnapshot = z.infer<typeof AnalyticsSnapshotSchema>;

export const CreateRevenueScenarioSchema = z.object({
  venueId: VenueIdSchema,
  eventId: EventIdSchema.nullable().optional(),
  configurationId: ConfigurationIdSchema.nullable().optional(),
  quoteId: QuoteIdSchema.nullable().optional(),
  name: SafeCommercialTextSchema,
  scenarioKind: RevenueScenarioKindSchema.default("manual"),
  currency: CurrencySchema.default("GBP"),
  plannedGuestCount: z.number().int().nonnegative().default(0),
  estimatedRevenueMinor: MinorUnitAmountSchema,
  estimatedCostMinor: MinorUnitAmountSchema.default(0),
  comfortStatus: ComfortConstraintStatusSchema.default("not_checked"),
  reviewGateCount: z.number().int().nonnegative().default(0),
  pricingAssumptions: z.array(PricingAssumptionInputSchema).max(30).default([]),
  comfortConstraints: z.array(ComfortConstraintInputSchema).max(30).default([]),
}).strict();
export type CreateRevenueScenario = z.infer<typeof CreateRevenueScenarioSchema>;

export const RevenueScenarioBundleSchema = z.object({
  scenario: RevenueScenarioSchema,
  pricingAssumptions: z.array(PricingAssumptionSchema),
  comfortConstraints: z.array(ComfortConstraintSchema),
}).strict();
export type RevenueScenarioBundle = z.infer<typeof RevenueScenarioBundleSchema>;

export const RevenueSummarySchema = z.object({
  eventId: EventIdSchema,
  currency: CurrencySchema,
  scenarioCount: z.number().int().nonnegative(),
  totalScenarioRevenueMinor: MinorUnitAmountSchema,
  bestScenarioId: RevenueScenarioIdSchema.nullable(),
  comfortWarnings: z.number().int().nonnegative(),
  reviewBottlenecks: z.number().int().nonnegative(),
  scenarios: z.array(RevenueScenarioSchema),
}).strict();
export type RevenueSummary = z.infer<typeof RevenueSummarySchema>;

export const PipelineSummarySchema = z.object({
  currency: CurrencySchema,
  pipelineValueMinor: MinorUnitAmountSchema,
  enquiryCount: z.number().int().nonnegative(),
  proposalCount: z.number().int().nonnegative(),
  acceptedProposalCount: z.number().int().nonnegative(),
  conversionPercent: PercentSchema,
  proposalStatusCounts: z.record(z.number().int().nonnegative()),
}).strict();
export type PipelineSummary = z.infer<typeof PipelineSummarySchema>;

export const RoomUtilisationRowSchema = z.object({
  spaceId: SpaceIdSchema.nullable(),
  roomName: z.string().trim().min(1).max(200),
  bookedEvents: z.number().int().nonnegative(),
  proposedEvents: z.number().int().nonnegative(),
  utilisationPercent: PercentSchema,
  reviewBottlenecks: z.number().int().nonnegative(),
}).strict();
export type RoomUtilisationRow = z.infer<typeof RoomUtilisationRowSchema>;

export const VenueDashboardAnalyticsSchema = z.object({
  generatedAt: z.string().datetime(),
  currency: CurrencySchema,
  pipelineValueMinor: MinorUnitAmountSchema,
  enquiryConversionPercent: PercentSchema,
  proposalStatusCounts: z.record(z.number().int().nonnegative()),
  roomUtilisation: z.array(RoomUtilisationRowSchema),
  revenueScenarios: z.array(RevenueScenarioSchema),
  comfortFloorWarnings: z.array(SafeCommercialTextSchema),
  reviewBottlenecks: z.array(SafeCommercialTextSchema),
  disclosure: z.literal("Commercial planning insight - review constraints preserved"),
}).strict();
export type VenueDashboardAnalytics = z.infer<typeof VenueDashboardAnalyticsSchema>;

export function computeScenarioMarginMinor(
  estimatedRevenueMinor: number,
  estimatedCostMinor: number,
): number {
  return estimatedRevenueMinor - estimatedCostMinor;
}

export function compareRevenueScenarios(input: {
  readonly left: RevenueScenario;
  readonly right: RevenueScenario;
}): Pick<ScenarioComparison, "currency" | "revenueDeltaMinor" | "marginDeltaMinor" | "comfortDeltaLabel" | "reviewGateDelta" | "recommendationStatus"> {
  const revenueDeltaMinor = input.right.estimatedRevenueMinor - input.left.estimatedRevenueMinor;
  const marginDeltaMinor = input.right.estimatedMarginMinor - input.left.estimatedMarginMinor;
  const reviewGateDelta = input.right.reviewGateCount - input.left.reviewGateCount;
  const recommendationStatus: ComfortConstraintStatus =
    input.right.comfortStatus === "review_required" || reviewGateDelta > 0
      ? "review_required"
      : input.right.comfortStatus;

  return {
    currency: input.right.currency,
    revenueDeltaMinor,
    marginDeltaMinor,
    comfortDeltaLabel: `Comfort status ${input.left.comfortStatus} -> ${input.right.comfortStatus}`,
    reviewGateDelta,
    recommendationStatus,
  };
}

export function formatMinorUnitMoney(amountMinor: number, currency: z.infer<typeof CurrencySchema>): string {
  const sign = amountMinor < 0 ? "-" : "";
  const absolute = Math.abs(amountMinor);
  const major = Math.floor(absolute / 100);
  const minor = absolute % 100;
  return `${sign}${currency} ${major.toLocaleString("en-GB")}.${minor.toString().padStart(2, "0")}`;
}
