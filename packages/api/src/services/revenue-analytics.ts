import {
  RevenueSummarySchema,
  VenueDashboardAnalyticsSchema,
  PipelineSummarySchema,
  RoomUtilisationRowSchema,
  addRotaDays,
  compareRevenueScenarios,
  rotaLocalDate,
  type ComfortConstraint,
  type PipelineSummary,
  type RevenueScenario,
  type RevenueSummary,
  type RoomUtilisationRow,
  type VenueDashboardAnalytics,
} from "@omnitwin/types";
import { venueDayWindow } from "./public-discovery.js";

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

/** `part` as a whole-number share of `whole`, held to 0–100. A share that is
 *  not a share (more accepted proposals than enquiries, say) reads 100 rather
 *  than failing PercentSchema and taking the whole dashboard down with it. */
function boundedPercent(part: number, whole: number): number {
  if (!(whole > 0) || !(part > 0)) return 0;
  return Math.min(100, Math.round((part / whole) * 100));
}

/** Inputs are the venue's aggregates (open pipeline value, enquiry count,
 *  proposals per status), computed by the database rather than from every row. */
export function buildPipelineSummary(input: {
  /** Resolved by services/commercial-pipeline.ts — the single definition of
   *  pipeline value that the Pipeline tab and this dashboard both read. It is
   *  passed in rather than derived here so this module stays pure. */
  readonly pipelineValueMinor: number;
  readonly enquiryCount: number;
  readonly proposalStatusCounts: Readonly<Record<string, number>>;
}): PipelineSummary {
  const proposalStatusCounts = { ...input.proposalStatusCounts };
  const acceptedProposalCount = proposalStatusCounts["accepted"] ?? 0;
  // Proposals need no enquiry (a deal from a phone call has none), so accepted
  // proposals can outnumber enquiries; the counts beside it stay exact.
  const conversionPercent = boundedPercent(acceptedProposalCount, input.enquiryCount);

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

/** Utilisation window rows are measured over. Ninety days is the horizon a
 *  venue team actually plans against; a room's "utilisation" with no window
 *  is not a number, it is a mood. */
export const ROOM_UTILISATION_WINDOW_DAYS = 90;

/** The venue date whose Diary day (04:00 to 04:00 on the venue's clock) holds
 *  `nowMs`: before 04:00 it is still the previous date, as the Diary reads. */
export function venueOperationalDate(nowMs: number, timeZone: string): string {
  const date = rotaLocalDate(nowMs, timeZone);
  return nowMs < venueDayWindow(date, timeZone).startMs ? addRotaDays(date, -1) : date;
}

/** The venue dates a utilisation figure is measured over, from the venue's
 *  operational today, and the instants they span (half-open). */
export function roomUtilisationWindow(nowMs: number, timeZone: string, days = ROOM_UTILISATION_WINDOW_DAYS): {
  readonly dates: readonly string[];
  readonly startsAt: Date;
  readonly endsAt: Date;
} {
  const first = venueOperationalDate(nowMs, timeZone);
  const dates = Array.from({ length: Math.max(1, days) }, (_, index) => addRotaDays(first, index));
  const last = dates[dates.length - 1] ?? first;
  return {
    dates,
    startsAt: new Date(venueDayWindow(first, timeZone).startMs),
    endsAt: new Date(venueDayWindow(last, timeZone).endMs),
  };
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
 * A day is the Diary's operational day, 04:00 to 04:00 on the venue's clock
 * (public-discovery.ts venueDayWindow), so an evening that runs past midnight
 * is one day in either season. A booking touches a day when it overlaps it,
 * half-open, so a booking that ends exactly at 04:00 does not reach the next.
 *
 * Callers pass only ACTIVE bookings (released/expired/cancelled/lost rows are
 * filtered in SQL) so an abandoned hold never inflates demand.
 */
export function buildRoomUtilisationRows(input: {
  readonly rooms: readonly { readonly spaceId: string | null; readonly roomName: string }[];
  readonly bookings: readonly UtilisationBooking[];
  /** The venue dates measured, YYYY-MM-DD (roomUtilisationWindow). */
  readonly windowDates: readonly string[];
  /** The venue's IANA time zone, which places each date's 04:00. */
  readonly timeZone: string;
  readonly reviewBottlenecksBySpaceId: ReadonlyMap<string, number>;
}): readonly RoomUtilisationRow[] {
  const windowDays = Math.max(1, input.windowDates.length);
  const days = input.windowDates.map((date) => ({ date, ...venueDayWindow(date, input.timeZone) }));

  return input.rooms.map((room) => {
    const roomBookings = input.bookings.filter((booking) => booking.spaceId === room.spaceId);
    const bookedEvents = roomBookings.filter((booking) => booking.kind === "ink").length;
    const proposedEvents = roomBookings.filter(
      (booking) => booking.kind === "prospect" || booking.kind === "hold",
    ).length;

    // Distinct confirmed venue days inside the window, so overlapping or
    // multi-day bookings cannot push a room past 100%.
    const bookedDays = new Set<string>();
    for (const booking of roomBookings) {
      if (booking.kind !== "ink") continue;
      const startsMs = booking.startsAt.getTime();
      const endsMs = booking.endsAt.getTime();
      for (const day of days) {
        if (startsMs < day.endMs && endsMs > day.startMs) bookedDays.add(day.date);
      }
    }

    const utilisationPercent = boundedPercent(bookedDays.size, windowDays);

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
      .map((scenario) => `${scenario.name}: ${String(scenario.reviewGateCount)} review gate${scenario.reviewGateCount === 1 ? "" : "s"}`),
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
