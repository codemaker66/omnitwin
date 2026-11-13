import { describe, expect, it } from "vitest";
import type { CompetitorPageCheck } from "@omnitwin/types";
import {
  contextLineWords,
  figureWords,
  includesWords,
  lostToWords,
  pageCheckWords,
  poundsTyped,
  runWords,
  sourceWords,
  watchSummary,
} from "../competitor-watch-format.js";
import { capture, competitor } from "./competitor-watch-fixtures.js";

// ---------------------------------------------------------------------------
// The competitor watch's words: every figure with its basis, year, VAT,
// inclusions, who saw it, when and where; a client's figure labelled as
// theirs; the page check in plain sentences.
// ---------------------------------------------------------------------------

describe("a figure", () => {
  it("is said with its basis and its guests", () => {
    expect(figureWords({ amountMinor: 13_000, currency: "GBP", priceBasis: "per_head", guests: 150 })).toBe("£130 a head, at least 150 guests");
    expect(figureWords({ amountMinor: 1_100_000, currency: "GBP", priceBasis: "fixed", guests: 50 })).toBe("£11,000 for 50 guests");
    expect(figureWords({ amountMinor: 299_500, currency: "GBP", priceBasis: "fixed", guests: null })).toBe("£2,995 in total");
  });

  it("is read as typed, thousands and pound sign included", () => {
    expect(poundsTyped("11,000")).toBe(1_100_000);
    expect(poundsTyped("£130.50")).toBe(13_050);
    expect(poundsTyped("1,10")).toBeNull();
    expect(poundsTyped("0")).toBeNull();
    expect(poundsTyped("about 9k")).toBeNull();
  });

  it("names what it includes, and its source by host", () => {
    expect(includesWords(["room_hire", "catering", "drinks"], null)).toBe("Includes room hire, catering and drinks.");
    expect(includesWords(["room_hire"], "a piper.")).toBe("Includes room hire; also a piper.");
    expect(includesWords([], null)).toBe("What it includes was not recorded.");
    expect(sourceWords("own_page", "https://grandcentral.vocohotels.com/wedding-packages/")).toBe("Own site, grandcentral.vocohotels.com");
    expect(sourceWords("brochure", "https://www.files.example.org/b.pdf")).toBe("Brochure, files.example.org");
  });

  it("beside a suggestion, carries every fact with it", () => {
    expect(contextLineWords({
      captureId: "11111111-1111-4111-8111-111111111111", competitorId: "22222222-2222-4222-8222-222222222222",
      competitorName: "voco Grand Central", tier: "primary", packageName: "Grand Central Package", amountMinor: 13_000,
      currency: "GBP", priceBasis: "per_head", guests: 150, priceYear: 2027, includes: ["room_hire", "catering"],
      includesNote: null, vat: "not_stated", seenOn: "2026-10-17", capturedByName: "Callum Reid",
      sourceUrl: "https://grandcentral.vocohotels.com/wedding-packages/", sourceKind: "own_page",
    })).toEqual({
      title: "voco Grand Central · Grand Central Package",
      figure: "£130 a head, at least 150 guests",
      terms: "For 2027 · VAT not stated · Includes room hire and catering.",
      provenance: "Seen 17 Oct 2026 by Callum Reid · Own site, grandcentral.vocohotels.com",
    });
  });
});

describe("who won a lost deal", () => {
  it("labels the client's figure as theirs, unverified", () => {
    expect(lostToWords({ name: "voco Grand Central", competitorId: null, clientFigureMinor: 1_150_000, clientFigureBasis: "fixed", currency: "GBP" }))
      .toBe("Lost to voco Grand Central. Client's figure, unverified: £11,500 in total.");
    expect(lostToWords({ name: "Òran Mór", competitorId: null, clientFigureMinor: null, clientFigureBasis: null, currency: "GBP" }))
      .toBe("Lost to Òran Mór.");
  });
});

describe("the page check", () => {
  const base: CompetitorPageCheck = {
    allowedAt: "2026-10-17T09:00:00.000Z", allowedByName: "Callum Reid", checkedAt: "2026-10-19T06:00:00.000Z",
    outcome: "unchanged", httpStatus: 200, nextCheckAfter: "2026-10-26T06:00:00.000Z", changedAt: null,
  };

  it("says when it is off, and what turns it on", () => {
    expect(pageCheckWords({ ...base, allowedAt: null, allowedByName: null, checkedAt: null, outcome: null }, "Europe/London"))
      .toBe("Off. It is turned on once someone has read the site's terms and its robots.txt and found that both allow it.");
  });

  it("says what happened, when, and when it runs next, on the venue's clock", () => {
    expect(pageCheckWords(base, "Europe/London")).toBe("Checked 19 Oct 2026, 07:00: no change. Next check from 26 Oct 2026, 06:00.");
    expect(pageCheckWords({ ...base, outcome: "refused", httpStatus: 429 }, "Europe/London"))
      .toBe("Checked 19 Oct 2026, 07:00: the site refused (HTTP 429), so it is left alone for four weeks. Next check from 26 Oct 2026, 06:00.");
    expect(pageCheckWords({ ...base, checkedAt: null, outcome: null }, "Europe/London")).toBe("Allowed by Callum Reid, 17 Oct 2026, 10:00. Not checked yet.");
  });

  it("sums up a run in counts", () => {
    const id = (n: number): string => `00000000-0000-4000-8000-00000000000${String(n)}`;
    expect(runWords({ checkedAt: "2026-10-19T06:00:00.000Z", results: [
      { competitorId: id(1), outcome: "changed", nextCheckAfter: null },
      { competitorId: id(2), outcome: "unchanged", nextCheckAfter: null },
      { competitorId: id(3), outcome: "not_due", nextCheckAfter: null },
      { competitorId: id(4), outcome: "not_allowed", nextCheckAfter: null },
      { competitorId: id(5), outcome: "refused", nextCheckAfter: null },
    ] })).toBe("Checked 3 pages: 1 changed, 1 unchanged and 1 not read; each venue says why. 1 read in the last week, so left until the week comes round. 1 with the check off.");
    expect(runWords({ checkedAt: "2026-10-19T06:00:00.000Z", results: [] })).toBe("No page was due a check.");
  });
});

describe("the set", () => {
  it("is summed up with what needs a person", () => {
    expect(watchSummary([])).toBe("No venues in the set yet.");
    expect(watchSummary([
      competitor({ reviewDue: true }),
      competitor({ id: "33333333-3333-4333-8333-333333333333", pageCheck: { ...competitor().pageCheck, changedAt: "2026-10-18T06:00:00.000Z" }, captures: [capture()] }),
    ])).toBe("2 venues in the set, 1 page changed and 1 review due.");
  });
});
