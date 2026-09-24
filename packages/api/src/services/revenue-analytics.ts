import {
  RevenueSummarySchema,
  VenueDashboardAnalyticsSchema,
  PipelineSummarySchema,
  RoomUtilisationRowSchema,
  compareRevenueScenarios,
  type ComfortConstraint,
  type PipelineSummary,
  type RevenueScenario,
  type RevenueSummary,
  type RoomUtilisationRow,
  type VenueDashboardAnalytics,
} from "@omnitwin/types";

// ---------------------------------------------------------------------------
// Revenue analytics services — pure aggregation helpers.
//
// Commercial insight only. These helpers preserve comfort and review signals
// beside money so dashboards cannot imply an unconstrained recommendation.
// ---------------------------------------------------------------------------

export function summarizeRevenueScenarios(input: {
  readonly eventId: string;
  readonly scenarios: readonly RevenueScenario[];
}): RevenueSummary {
  const currency = input.scenarios[0]?.currency ?? "GBP";
  const totalScenarioRevenueMinor = input.scenarios.reduce(
    (sum, scenario) => sum + scenario.estimatedRevenueMinor,
    0,
  );
  const bestScenario = input.scenarios.reduce<RevenueScenario | null>((best, scenario) => {
    if (best === null) return scenario;
    return scenario.estimatedMarginMinor > best.estimatedMarginMinor ? scenario : best;
  }, null);

  return RevenueSummarySchema.parse({
    eventId: input.eventId,
    currency,
    scenarioCount: input.scenarios.length,
    totalScenarioRevenueMinor,
    bestScenarioId: bestScenario?.id ?? null,
    comfortWarnings: input.scenarios.filter((scenario) => (
      scenario.comfortStatus === "warning" || scenario.comfortStatus === "review_required"
    )).length,
    reviewBottlenecks: input.scenarios.reduce((sum, scenario) => sum + scenario.reviewGateCount, 0),
    scenarios: input.scenarios,
  });
}

/** Inputs are the venue's aggregates (quote total, enquiry count, proposals
 *  per status), computed by the database rather than from every row. */
export function buildPipelineSummary(input: {
  readonly pipelineValueMinor: number;
  readonly enquiryCount: number;
  readonly proposalStatusCounts: Readonly<Record<string, number>>;
}): PipelineSummary {
  const proposalStatusCounts = { ...input.proposalStatusCounts };
  const acceptedProposalCount = proposalStatusCounts["accepted"] ?? 0;
  const conversionPercent = input.enquiryCount > 0
    ? Math.round((acceptedProposalCount / input.enquiryCount) * 100)
    : 0;

  return PipelineSummarySchema.parse({
    currency: "GBP",
    pipelineValueMinor: input.pipelineValueMinor,
    enquiryCount: input.enquiryCount,
    proposalCount: Object.values(proposalStatusCounts).reduce((sum, count) => sum + count, 0),
    acceptedProposalCount,
    conversionPercent,
    proposalStatusCounts,
  });
}

/** `quotesBySpaceId` holds each room's quote count and accepted-quote count;
 *  the null key collects quotes without a room. */
export function buildRoomUtilisationRows(input: {
  readonly rooms: readonly { readonly spaceId: string | null; readonly roomName: string }[];
  readonly quotesBySpaceId: ReadonlyMap<string | null, { readonly proposed: number; readonly booked: number }>;
  readonly reviewBottlenecksBySpaceId: ReadonlyMap<string, number>;
}): readonly RoomUtilisationRow[] {
  return input.rooms.map((room) => {
    const quotesForRoom = input.quotesBySpaceId.get(room.spaceId);
    const proposedEvents = quotesForRoom?.proposed ?? 0;
    const bookedEvents = quotesForRoom?.booked ?? 0;
    const utilisationPercent = proposedEvents > 0 ? Math.min(100, Math.round((bookedEvents / proposedEvents) * 100)) : 0;
    return RoomUtilisationRowSchema.parse({
      spaceId: room.spaceId,
      roomName: room.roomName,
      bookedEvents,
      proposedEvents,
      utilisationPercent,
      reviewBottlenecks: room.spaceId === null ? 0 : (input.reviewBottlenecksBySpaceId.get(room.spaceId) ?? 0),
    });
  });
}

export function buildVenueDashboardAnalytics(input: {
  readonly generatedAt: string;
  readonly pipeline: PipelineSummary;
  readonly roomUtilisation: readonly RoomUtilisationRow[];
  readonly revenueScenarios: readonly RevenueScenario[];
  readonly comfortConstraints: readonly ComfortConstraint[];
}): VenueDashboardAnalytics {
  const comfortFloorWarnings = input.comfortConstraints
    .filter((constraint) => constraint.status === "warning" || constraint.status === "review_required")
    .map((constraint) => constraint.note ?? constraint.label)
    .slice(0, 8);
  const reviewBottlenecks = [
    ...input.revenueScenarios
      .filter((scenario) => scenario.reviewGateCount > 0)
      .map((scenario) => `${scenario.name}: ${String(scenario.reviewGateCount)} review gate(s)`),
    ...input.comfortConstraints
      .filter((constraint) => constraint.reviewRequired)
      .map((constraint) => constraint.label),
  ].slice(0, 8);

  return VenueDashboardAnalyticsSchema.parse({
    generatedAt: input.generatedAt,
    currency: input.pipeline.currency,
    pipelineValueMinor: input.pipeline.pipelineValueMinor,
    enquiryConversionPercent: input.pipeline.conversionPercent,
    proposalStatusCounts: input.pipeline.proposalStatusCounts,
    roomUtilisation: input.roomUtilisation,
    revenueScenarios: input.revenueScenarios,
    comfortFloorWarnings,
    reviewBottlenecks,
    disclosure: "Commercial planning insight - review constraints preserved",
  });
}

export function comparisonSignals(input: {
  readonly left: RevenueScenario;
  readonly right: RevenueScenario;
}): ReturnType<typeof compareRevenueScenarios> {
  return compareRevenueScenarios(input);
}
