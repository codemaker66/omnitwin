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

export function buildPipelineSummary(input: {
  /** Resolved by services/commercial-pipeline.ts — the single definition of
   *  pipeline value that the Pipeline tab and this dashboard both read. It is
   *  passed in rather than derived here so this module stays pure. */
  readonly pipelineValueMinor: number;
  readonly enquiryCount: number;
  readonly proposalStatuses: readonly string[];
}): PipelineSummary {
  const proposalStatusCounts = input.proposalStatuses.reduce<Record<string, number>>((acc, status) => {
    acc[status] = (acc[status] ?? 0) + 1;
    return acc;
  }, {});
  const acceptedProposalCount = proposalStatusCounts["accepted"] ?? 0;
  const conversionPercent = input.enquiryCount > 0
    ? Math.round((acceptedProposalCount / input.enquiryCount) * 100)
    : 0;

  return PipelineSummarySchema.parse({
    currency: "GBP",
    pipelineValueMinor: input.pipelineValueMinor,
    enquiryCount: input.enquiryCount,
    proposalCount: input.proposalStatuses.length,
    acceptedProposalCount,
    conversionPercent,
    proposalStatusCounts,
  });
}

const MS_PER_DAY = 86_400_000;

/** Utilisation window rows are measured over. Ninety days is the horizon a
 *  venue team actually plans against; a room's "utilisation" with no window
 *  is not a number, it is a mood. */
export const ROOM_UTILISATION_WINDOW_DAYS = 90;

/** UTC calendar day key for a moment — the unit a room is booked in. */
function utcDayKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export interface UtilisationBooking {
  readonly spaceId: string | null;
  /** `bookings.kind` — confirmed rooms are "ink"; "prospect"/"hold" are the
   *  pencilled demand above it. "internal_block" is the venue's own use. */
  readonly kind: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/**
 * Room utilisation FROM BOOKINGS.
 *
 * This used to be computed from quotes: `proposedEvents` counted quote rows
 * and `bookedEvents` counted accepted ones, so "utilisation" was really a
 * quote-acceptance rate and read 0% for every venue that quotes outside the
 * app. The diary is where a room is actually spoken for, so:
 *
 *   bookedEvents   — confirmed ("ink") bookings touching the window
 *   proposedEvents — pencilled ("prospect"/"hold") bookings touching it
 *   utilisation    — the share of the window's days that carry a confirmed
 *                    booking; 30 of 90 days inked is 33%.
 *
 * Callers pass only ACTIVE bookings (released/expired/cancelled/lost rows are
 * filtered in SQL) so an abandoned hold never inflates demand.
 */
export function buildRoomUtilisationRows(input: {
  readonly rooms: readonly { readonly spaceId: string | null; readonly roomName: string }[];
  readonly bookings: readonly UtilisationBooking[];
  readonly windowStart: Date;
  readonly windowEnd: Date;
  readonly reviewBottlenecksBySpaceId: ReadonlyMap<string, number>;
}): readonly RoomUtilisationRow[] {
  const windowDays = Math.max(
    1,
    Math.round((input.windowEnd.getTime() - input.windowStart.getTime()) / MS_PER_DAY),
  );

  return input.rooms.map((room) => {
    const roomBookings = input.bookings.filter((booking) => booking.spaceId === room.spaceId);
    const bookedEvents = roomBookings.filter((booking) => booking.kind === "ink").length;
    const proposedEvents = roomBookings.filter(
      (booking) => booking.kind === "prospect" || booking.kind === "hold",
    ).length;

    // Distinct confirmed days, clipped to the window, so overlapping or
    // multi-day bookings cannot push a room past 100%.
    const bookedDays = new Set<string>();
    for (const booking of roomBookings) {
      if (booking.kind !== "ink") continue;
      const from = Math.max(booking.startsAt.getTime(), input.windowStart.getTime());
      const to = Math.min(booking.endsAt.getTime(), input.windowEnd.getTime());
      if (to < from) continue;
      for (let day = from; day <= to; day += MS_PER_DAY) {
        bookedDays.add(utcDayKey(new Date(day)));
      }
      bookedDays.add(utcDayKey(new Date(to)));
    }

    const utilisationPercent = Math.min(100, Math.round((bookedDays.size / windowDays) * 100));

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
