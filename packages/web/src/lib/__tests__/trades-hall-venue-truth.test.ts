import { describe, expect, it } from "vitest";
import { findUnsupportedProposalClaim } from "@omnitwin/types";
import {
  CAPACITY_FORMATS,
  TRADES_HALL_ROOM_CAPACITIES,
  TRADES_HALL_WEDDING_PRICING,
  VENUE_TRUTH_PROVENANCE,
  formatPriceGBP,
} from "../trades-hall-venue-truth.js";
import { publicRoomSelectionCards } from "../trades-hall-room-showcase.js";
import { ROOM_CHAPTERS } from "../../pages/landing/rite-copy.js";

// ---------------------------------------------------------------------------
// trades-hall-venue-truth — the single venue-confirmed source for capacities
// and wedding pricing. Figures were supplied by the client on 2026-07-09 and
// match tradeshallglasgow.co.uk. These tests pin the module to that message
// verbatim, pin the Rite's chapter figures to this module (no drift between
// surfaces), and sweep every public string through the claim guard.
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

  it("uses slugs that resolve to real room showcase cards", () => {
    const known = new Set(publicRoomSelectionCards.map((c) => c.canonicalRoomSlug ?? c.id));
    for (const slug of Object.keys(TRADES_HALL_ROOM_CAPACITIES)) {
      expect(known.has(slug), `showcase card missing for ${slug}`).toBe(true);
    }
  });

  it("agrees with the Rite's chapter figures — no drift between surfaces", () => {
    for (const chapter of ROOM_CHAPTERS) {
      const truth = TRADES_HALL_ROOM_CAPACITIES[chapter.slug as keyof typeof TRADES_HALL_ROOM_CAPACITIES];
      expect(truth, `venue truth missing for chapter room ${chapter.slug}`).toBeTruthy();
      expect(chapter.standing).toBe(truth.reception);
      expect(chapter.banquet).toBe(truth.dinner);
    }
  });

  it("lists the four published formats in display order", () => {
    expect(CAPACITY_FORMATS.map((f) => f.key)).toEqual(["theatre", "classroom", "dinner", "reception"]);
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

describe("claim safety", () => {
  it("every public string passes the proposal claim guard", () => {
    const strings = [
      VENUE_TRUTH_PROVENANCE.capacities,
      VENUE_TRUTH_PROVENANCE.pricing,
      TRADES_HALL_WEDDING_PRICING.scope,
      ...TRADES_HALL_WEDDING_PRICING.seasons.flatMap((s) => s.rates.map((r) => r.packageName)),
      ...CAPACITY_FORMATS.map((f) => f.label),
    ];
    for (const s of strings) {
      expect(findUnsupportedProposalClaim(s), `claim guard tripped on: ${s}`).toBeNull();
    }
  });

  it("provenance names its date and source", () => {
    expect(VENUE_TRUTH_PROVENANCE.capacities).toContain("2026-07-09");
    expect(VENUE_TRUTH_PROVENANCE.pricing).toContain("2026-07-09");
  });
});
