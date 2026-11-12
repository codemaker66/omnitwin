import { describe, expect, it } from "vitest";
import { TRADES_HALL_ENQUIRY_VENUE_SLUG } from "../enquiry.js";
import { findUnsupportedProposalClaim } from "../proposal.js";
import {
  CAPACITY_FORMATS,
  TRADES_HALL_PUBLIC_PROFILE,
  TRADES_HALL_PUBLISHED_ROOM_NAMES,
  TRADES_HALL_ROOM_CAPACITIES,
  TRADES_HALL_ROOM_DIMENSIONS,
  TRADES_HALL_WEDDING_PRICING,
  VENUE_TRUTH_PROVENANCE,
  VENUE_TRUTH_STATEMENTS,
  formatPriceGBP,
  formatPublishedAddress,
  isPublishedRoomSlug,
  publishedRoomCapacity,
  venueTruthStatementLabel,
} from "../trades-hall-venue-truth.js";

// ---------------------------------------------------------------------------
// trades-hall-venue-truth — the single venue-confirmed source for capacities,
// wedding pricing and the venue's public profile. Figures were supplied by the
// client on 2026-07-09 and match tradeshallglasgow.co.uk. These tests pin the
// module to that message verbatim and sweep every public string through the
// claim guard. The web package pins its own surfaces to these exports.
// ---------------------------------------------------------------------------

describe("room capacities — venue-confirmed figures, verbatim", () => {
  it("carries exactly the six published rooms", () => {
    expect(Object.keys(TRADES_HALL_ROOM_CAPACITIES).sort()).toEqual([
      "grand-hall",
      "north-gallery",
      "reception-room",
      "robert-adam-room",
      "saloon",
      "south-gallery",
    ]);
  });

  it("matches the client-supplied numbers exactly", () => {
    expect(TRADES_HALL_ROOM_CAPACITIES["grand-hall"]).toEqual({
      theatre: 250, classroom: 80, dinner: 180, reception: 250,
    });
    expect(TRADES_HALL_ROOM_CAPACITIES.saloon).toEqual({
      theatre: 80, classroom: 40, dinner: 60, reception: 80,
    });
    expect(TRADES_HALL_ROOM_CAPACITIES["robert-adam-room"]).toEqual({
      theatre: 80, classroom: 40, dinner: 60, reception: 150,
    });
    expect(TRADES_HALL_ROOM_CAPACITIES["reception-room"]).toEqual({
      theatre: 80, classroom: 35, dinner: 60, reception: 100,
    });
    expect(TRADES_HALL_ROOM_CAPACITIES["north-gallery"]).toEqual({
      theatre: 40, classroom: 18, dinner: 40, reception: 40,
    });
    expect(TRADES_HALL_ROOM_CAPACITIES["south-gallery"]).toEqual({
      theatre: 40, classroom: 18, dinner: 40, reception: 40,
    });
  });

  it("lists the four published formats in display order, each described", () => {
    expect(CAPACITY_FORMATS.map((f) => f.key)).toEqual(["theatre", "classroom", "dinner", "reception"]);
    for (const format of CAPACITY_FORMATS) expect(format.description.length).toBeGreaterThan(0);
  });

  it("names every published room, and only those", () => {
    expect(Object.keys(TRADES_HALL_PUBLISHED_ROOM_NAMES)).toEqual(Object.keys(TRADES_HALL_ROOM_CAPACITIES));
  });

  it("recognises published room slugs without trusting inherited keys", () => {
    expect(isPublishedRoomSlug("grand-hall")).toBe(true);
    expect(isPublishedRoomSlug("kitchen")).toBe(false);
    expect(isPublishedRoomSlug("constructor")).toBe(false);
    expect(isPublishedRoomSlug("__proto__")).toBe(false);
  });
});

describe("wedding pricing — client-supplied rates, verbatim", () => {
  it("scopes the offer honestly", () => {
    expect(TRADES_HALL_WEDDING_PRICING.scope).toContain("Exclusive wedding use");
    expect(TRADES_HALL_WEDDING_PRICING.scope).toContain("180");
    expect(TRADES_HALL_WEDDING_PRICING.currency).toBe("GBP");
  });

  it("carries the 2026 rates exactly (three packages — no ceremony-only rate published for 2026)", () => {
    const y2026 = TRADES_HALL_WEDDING_PRICING.seasons.find((s) => s.years === "2026");
    expect(y2026?.rates).toEqual([
      { packageName: "Wedding Breakfast and Evening Reception", priceGBP: 2800 },
      { packageName: "Twilight Wedding", priceGBP: 1800 },
      { packageName: "Evening Reception", priceGBP: 1500 },
    ]);
  });

  it("carries the 2027/28 rates exactly", () => {
    const later = TRADES_HALL_WEDDING_PRICING.seasons.find((s) => s.years === "2027/28");
    expect(later?.rates).toEqual([
      { packageName: "Ceremony only", priceGBP: 650 },
      { packageName: "Wedding Breakfast and Evening Reception", priceGBP: 2900 },
      { packageName: "Twilight Wedding", priceGBP: 2000 },
      { packageName: "Evening Reception", priceGBP: 1800 },
    ]);
  });

  it("formats prices as GBP without decimals", () => {
    expect(formatPriceGBP(2800)).toBe("£2,800");
    expect(formatPriceGBP(650)).toBe("£650");
  });
});

describe("public profile — what the venue already publishes", () => {
  it("describes the DATABASE slug, never the asset slug", () => {
    expect(TRADES_HALL_PUBLIC_PROFILE.dbSlug).toBe(TRADES_HALL_ENQUIRY_VENUE_SLUG);
    expect(TRADES_HALL_PUBLIC_PROFILE.dbSlug).toBe("trades-hall-glasgow");
  });

  it("points at the venue's own website and the front door's enquiry composer", () => {
    expect(TRADES_HALL_PUBLIC_PROFILE.officialWebsite).toBe("https://www.tradeshallglasgow.co.uk/");
    expect(TRADES_HALL_PUBLIC_PROFILE.enquiryUrl).toBe("https://venviewer.com/#enquire");
    for (const url of [
      TRADES_HALL_PUBLIC_PROFILE.officialWebsite,
      TRADES_HALL_PUBLIC_PROFILE.venviewerUrl,
      TRADES_HALL_PUBLIC_PROFILE.enquiryUrl,
      TRADES_HALL_PUBLIC_PROFILE.image,
    ]) {
      expect(new URL(url).protocol).toBe("https:");
    }
  });

  it("carries the published capacities and their provenance, and none for other rooms", () => {
    expect(TRADES_HALL_PUBLIC_PROFILE.publishedCapacities).toBe(TRADES_HALL_ROOM_CAPACITIES);
    expect(TRADES_HALL_PUBLIC_PROFILE.publishedRoomNames).toBe(TRADES_HALL_PUBLISHED_ROOM_NAMES);
    expect(TRADES_HALL_PUBLIC_PROFILE.capacityProvenance).toBe(VENUE_TRUTH_PROVENANCE.capacities);
    expect(publishedRoomCapacity(TRADES_HALL_PUBLIC_PROFILE, "saloon")).toEqual(TRADES_HALL_ROOM_CAPACITIES.saloon);
    for (const slug of ["kitchen", "constructor", "__proto__", "hasOwnProperty"]) {
      expect(publishedRoomCapacity(TRADES_HALL_PUBLIC_PROFILE, slug)).toBeNull();
    }
  });

  it("writes the address as one line", () => {
    expect(formatPublishedAddress(TRADES_HALL_PUBLIC_PROFILE.address))
      .toBe("85 Glassford Street, Glasgow G1 1UH, United Kingdom");
  });
});

describe("room dimensions", () => {
  it("gives the Grand Hall's interior as its laser scan measures it", () => {
    // Blake, 11 November 2026: "The measured 21.14 x 10.59 m". The height is the
    // clear 6.7 m to the underside of the coffered ceiling, never the dome's.
    // The note says only what the height is measured to, short enough to sit
    // beside the figure; the dome is a remark of its own, for a footnote.
    expect(TRADES_HALL_ROOM_DIMENSIONS["grand-hall"]).toEqual({
      lengthM: 21.14,
      widthM: 10.59,
      heightM: 6.7,
      note: "to the coffered ceiling",
      remark: "The dome rises above part of the hall.",
    });
  });

  it("states no figure in a height's note or remark, so the only height shown is heightM", () => {
    // The dome is never given as the room's height, and a number in either
    // string would be a second height for a surface to print.
    const texts = Object.values(TRADES_HALL_ROOM_DIMENSIONS)
      .flatMap((d) => [d?.note, d?.remark])
      .filter((text): text is string => text !== undefined);
    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) expect(text).not.toMatch(/\d/);
  });

  it("keeps the other rooms at the venue's published figures", () => {
    expect(TRADES_HALL_ROOM_DIMENSIONS.saloon).toEqual({ lengthM: 12, widthM: 7, heightM: 5.4 });
    expect(TRADES_HALL_ROOM_DIMENSIONS["robert-adam-room"]).toEqual({ lengthM: 9.7, widthM: 5.6, heightM: 2.18 });
    expect(TRADES_HALL_ROOM_DIMENSIONS["reception-room"]).toEqual({ lengthM: 13.4, widthM: 11.2, heightM: 3.2 });
    expect(TRADES_HALL_ROOM_DIMENSIONS["north-gallery"]).toBeUndefined();
    expect(TRADES_HALL_ROOM_DIMENSIONS["south-gallery"]).toBeUndefined();
  });
});

describe("claim safety", () => {
  it("every public string passes the proposal claim guard", () => {
    const strings = [
      VENUE_TRUTH_PROVENANCE.capacities,
      VENUE_TRUTH_PROVENANCE.pricing,
      TRADES_HALL_WEDDING_PRICING.scope,
      ...TRADES_HALL_WEDDING_PRICING.seasons.flatMap((s) => s.rates.map((r) => r.packageName)),
      ...CAPACITY_FORMATS.flatMap((f) => [f.label, f.description]),
      ...Object.values(TRADES_HALL_PUBLISHED_ROOM_NAMES),
      ...Object.values(TRADES_HALL_ROOM_DIMENSIONS)
        .flatMap((d) => [d?.note, d?.remark])
        .filter((text): text is string => text !== undefined),
    ];
    for (const s of strings) {
      expect(findUnsupportedProposalClaim(s), `claim guard tripped on: ${s}`).toBeNull();
    }
  });

  it("provenance names its date and source", () => {
    expect(VENUE_TRUTH_PROVENANCE.capacities).toContain("2026-07-09");
    expect(VENUE_TRUTH_PROVENANCE.pricing).toContain("2026-07-09");
  });

  it("keeps the provenance sentences word for word while writing them from the statements", () => {
    expect(VENUE_TRUTH_PROVENANCE.capacities).toBe(
      "Capacity figures confirmed by the Trades Hall team, 2026-07-09 — a planning guide; final numbers depend on your layout.",
    );
    expect(VENUE_TRUTH_PROVENANCE.pricing).toBe(
      "Room-hire rates provided by the Trades Hall team, 2026-07-09. Catering and services are quoted separately by the events team.",
    );
    expect(VENUE_TRUTH_PROVENANCE.capacities).toContain(VENUE_TRUTH_STATEMENTS.capacities.statedOn);
    expect(VENUE_TRUTH_PROVENANCE.pricing).toContain(VENUE_TRUTH_STATEMENTS.pricing.statedOn);
  });

  it("labels a figure with who stated it and when, in plain words", () => {
    expect(venueTruthStatementLabel(VENUE_TRUTH_STATEMENTS.capacities)).toBe("Published guide · Trades Hall · 9 Jul 2026");
    expect(venueTruthStatementLabel(VENUE_TRUTH_STATEMENTS.pricing)).toBe("Published rates · Trades Hall · 9 Jul 2026");
  });

  it("shows a malformed date as written instead of guessing a day", () => {
    expect(venueTruthStatementLabel({ kind: "Published guide", statedBy: "A venue", statedOn: "July 2026" }))
      .toBe("Published guide · A venue · July 2026");
    expect(venueTruthStatementLabel({ kind: "Published guide", statedBy: "A venue", statedOn: "2026-13-45" }))
      .toBe("Published guide · A venue · 2026-13-45");
  });
});
