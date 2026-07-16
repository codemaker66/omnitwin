import { describe, expect, it } from "vitest";
import { findUnsupportedProposalClaim } from "@omnitwin/types";
import {
  TRADES_HALL_ROOM_CAPACITIES,
  TRADES_HALL_WEDDING_PRICING,
} from "../../../lib/trades-hall-venue-truth.js";
import {
  ENQUIRY_EVENT_TYPES,
  allEnquiryFitCopy,
  alsoFitsSentence,
  composeEnquiry,
  enquiryYear,
  fitReport,
  fitSentence,
  prettyEnquiryDate,
  weddingRateLine,
  weddingScopeNote,
} from "../enquiry-fit.js";

// ---------------------------------------------------------------------------
// enquiry-fit — the composer must only ever say published numbers. Fit is
// arithmetic; suggestions are the snuggest adequate room; overflow is honest;
// every sentence and composed email passes the claim guard.
// ---------------------------------------------------------------------------

describe("fitReport", () => {
  it("suggests the snuggest room that fits, venue order breaking ties", () => {
    // 60 seated for dinner: Saloon, Robert Adam Room, and Reception Room all
    // publish exactly 60 — venue order makes the Saloon the suggestion.
    const report = fitReport("dinner", 60);
    expect(report.suggestion?.slug).toBe("saloon");
    expect(report.suggestion?.capacity).toBe(60);
    expect(report.alsoFits.map((r) => r.slug)).toEqual([
      "robert-adam-room",
      "reception-room",
      "grand-hall",
    ]);
  });

  it("steps up to the Grand Hall when the number outgrows the 60s", () => {
    const report = fitReport("dinner", 61);
    expect(report.suggestion?.slug).toBe("grand-hall");
    expect(report.alsoFits).toHaveLength(0);
  });

  it("admits when no single room reaches the number", () => {
    const report = fitReport("reception", 251);
    expect(report.suggestion).toBeNull();
    expect(report.largest.slug).toBe("grand-hall");
    expect(report.largest.capacity).toBe(
      TRADES_HALL_ROOM_CAPACITIES["grand-hall"].reception,
    );
    expect(fitSentence(report)).toContain("no single room");
    expect(fitSentence(report)).toContain("250");
  });

  it("measures each event against its published format", () => {
    expect(fitReport("conference", 100).eventType.format).toBe("theatre");
    expect(fitReport("wedding", 100).eventType.format).toBe("dinner");
    expect(fitReport("reception", 100).eventType.format).toBe("reception");
    // 100 theatre-style: the 80-seat rooms drop out, Grand Hall carries it.
    expect(fitReport("conference", 100).suggestion?.slug).toBe("grand-hall");
  });

  it("includes the galleries the photo cards cannot show", () => {
    const report = fitReport("dinner", 30);
    expect(report.suggestion?.slug).toBe("north-gallery");
    expect(report.rooms).toHaveLength(6);
  });

  it("names an exact fit as exact", () => {
    expect(fitSentence(fitReport("dinner", 180))).toContain("exactly");
  });

  it("lists the other fitting rooms with their numbers", () => {
    const line = alsoFitsSentence(fitReport("dinner", 60));
    expect(line).toContain("The Robert Adam Room (60)");
    expect(line).toContain("The Reception Room (60)");
    expect(line).toContain("The Grand Hall (180)");
  });
});

describe("wedding rate context", () => {
  it("quotes the published band for known seasons only", () => {
    expect(weddingRateLine(2026)).toContain("£1,500–£2,800");
    expect(weddingRateLine(2027)).toContain("£650–£2,900");
    expect(weddingRateLine(2028)).toContain("2027/28");
    expect(weddingRateLine(2029)).toBeNull();
    expect(weddingRateLine(null)).toBeNull();
  });

  it("derives its bands from the pricing module, never restated figures", () => {
    const season = TRADES_HALL_WEDDING_PRICING.seasons.find((s) => s.years === "2026");
    const prices = season?.rates.map((r) => r.priceGBP) ?? [];
    const line2026 = weddingRateLine(2026) ?? "";
    expect(line2026).toContain(
      `£${Math.min(...prices).toLocaleString("en-GB")}`,
    );
    expect(line2026).toContain(
      `£${Math.max(...prices).toLocaleString("en-GB")}`,
    );
  });

  it("flags the 180-guest package scope honestly", () => {
    expect(weddingScopeNote(180)).toBeNull();
    expect(weddingScopeNote(181)).toContain("180");
  });
});

describe("dates", () => {
  it("formats ISO dates the British way and rejects nonsense", () => {
    expect(prettyEnquiryDate("2027-03-14")).toBe("14 March 2027");
    expect(prettyEnquiryDate("")).toBeNull();
    expect(prettyEnquiryDate("not-a-date")).toBeNull();
    expect(enquiryYear("2027-03-14")).toBe(2027);
    expect(enquiryYear("")).toBeNull();
  });
});

describe("composeEnquiry", () => {
  it("writes subject and body from the draft, with the suggested room", () => {
    const composed = composeEnquiry(
      { eventKey: "wedding", guests: 120, dateISO: "2027-03-14" },
      "events@example.com",
    );
    expect(composed.subject).toBe("Enquiry — Wedding for 120, 14 March 2027");
    expect(composed.body).toContain("The Grand Hall looks the right scale");
    expect(composed.mailtoHref.startsWith("mailto:events@example.com?subject=")).toBe(
      true,
    );
    expect(composed.mailtoHref).toContain(encodeURIComponent("14 March 2027"));
  });

  it("leaves the date open honestly when none is chosen", () => {
    const composed = composeEnquiry(
      { eventKey: "dinner", guests: 40, dateISO: "" },
      "events@example.com",
    );
    expect(composed.subject).toBe("Enquiry — Dinner for 40");
    expect(composed.body).toContain("date still open");
  });
});

describe("claim safety", () => {
  it("every sentence the composer can produce passes the claim guard", () => {
    for (const s of allEnquiryFitCopy()) {
      expect(findUnsupportedProposalClaim(s), `claim guard tripped on: ${s}`).toBeNull();
    }
  });

  it("event types map onto the published capacity formats", () => {
    const formats = new Set(ENQUIRY_EVENT_TYPES.map((t) => t.format));
    expect(formats.has("dinner")).toBe(true);
    expect(formats.has("theatre")).toBe(true);
    expect(formats.has("reception")).toBe(true);
  });
});
