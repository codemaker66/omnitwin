import type { Competitor, CompetitorCapture, CompetitorWatch } from "@omnitwin/types";

// Shared shapes for the competitor watch's tests: one venue in the set, one
// figure it published, and the watch that holds them. Synthetic values only.

export const VOCO = "aaaaaaaa-1111-4111-8111-000000000001";
export const ART_CLUB = "aaaaaaaa-1111-4111-8111-000000000002";
export const FIGURE = "bbbbbbbb-2222-4222-8222-000000000001";

export function capture(overrides: Partial<CompetitorCapture> = {}): CompetitorCapture {
  return {
    id: FIGURE, competitorId: VOCO, sourceUrl: "https://grandcentral.vocohotels.com/wedding-packages/", sourceKind: "own_page",
    seenOn: "2026-10-17", capturedAt: "2026-10-17T10:00:00.000Z", capturedByName: "Callum Reid", packageName: "Grand Central Package",
    amountMinor: 13_000, currency: "GBP", priceBasis: "per_head", guests: 150, priceYear: 2027, includes: ["room_hire", "catering"],
    includesNote: null, vat: "not_stated", evidenceFileId: null, note: null, supersedesId: null, supersededById: null,
    sourceGoneAt: null, sourceGoneByName: null, freshness: "current",
    ...overrides,
  };
}

export function competitor(overrides: Partial<Competitor> = {}): Competitor {
  return {
    id: VOCO, name: "voco Grand Central", website: "https://grandcentral.vocohotels.com",
    pricePageUrl: "https://grandcentral.vocohotels.com/wedding-packages/", tier: "primary",
    reason: "The only rival that publishes headline prices on its own site.", reviewDueOn: "2027-04-17", reviewDue: false,
    reviewedAt: null, reviewedByName: null, addedAt: "2026-10-17T09:00:00.000Z", addedByName: "Callum Reid",
    pageCheck: { allowedAt: null, allowedByName: null, checkedAt: null, outcome: null, httpStatus: null, nextCheckAfter: null, changedAt: null },
    captures: [], losses: { count: 0, recent: [] },
    ...overrides,
  };
}

export function watch(overrides: Partial<CompetitorWatch> = {}): CompetitorWatch {
  return { today: "2026-10-17", timezone: "Europe/London", limit: 12, suggestedSetOffered: false, competitors: [], ...overrides };
}
