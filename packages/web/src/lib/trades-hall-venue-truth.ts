// -----------------------------------------------------------------------------
// trades-hall-venue-truth — the single venue-confirmed source for room
// capacities and wedding pricing.
//
// Figures supplied by the client on 2026-07-09 (matching the venue's published
// numbers at tradeshallglasgow.co.uk). Every surface that states a capacity or
// a price must import from here — never restate the numbers. The companion
// test pins this module to the client message verbatim and pins the Rite's
// chapter figures to it, so drift between surfaces fails CI.
// -----------------------------------------------------------------------------

export interface RoomCapacity {
  /** Rows of forward-facing seating. */
  readonly theatre: number;
  /** Desk-style seating. */
  readonly classroom: number;
  /** Seated dinner covers. */
  readonly dinner: number;
  /** Standing reception. */
  readonly reception: number;
}

export type PublishedRoomSlug =
  | "grand-hall"
  | "saloon"
  | "robert-adam-room"
  | "reception-room"
  | "north-gallery"
  | "south-gallery";

export const TRADES_HALL_ROOM_CAPACITIES: Readonly<Record<PublishedRoomSlug, RoomCapacity>> = {
  "grand-hall": { theatre: 250, classroom: 80, dinner: 180, reception: 250 },
  saloon: { theatre: 80, classroom: 40, dinner: 60, reception: 80 },
  "robert-adam-room": { theatre: 80, classroom: 40, dinner: 60, reception: 150 },
  "reception-room": { theatre: 80, classroom: 35, dinner: 60, reception: 100 },
  "north-gallery": { theatre: 40, classroom: 18, dinner: 40, reception: 40 },
  "south-gallery": { theatre: 40, classroom: 18, dinner: 40, reception: 40 },
} as const;

/** The venue's four published formats, in display order. */
export const CAPACITY_FORMATS = [
  { key: "theatre", label: "Theatre" },
  { key: "classroom", label: "Classroom" },
  { key: "dinner", label: "Dinner" },
  { key: "reception", label: "Reception" },
] as const satisfies readonly { key: keyof RoomCapacity; label: string }[];

export interface RoomDimensions {
  /** Metres, as published on the venue's own website. */
  readonly lengthM: number;
  readonly widthM: number;
  readonly heightM: number;
  /** Published qualifier, e.g. the Grand Hall's further height under the dome. */
  readonly note?: string;
}

/** Room dimensions as published on the official Trades Hall website —
 *  the four rooms the site lists. The galleries publish no dimensions,
 *  so none are stated for them. */
export const TRADES_HALL_ROOM_DIMENSIONS: Readonly<
  Partial<Record<PublishedRoomSlug, RoomDimensions>>
> = {
  "grand-hall": { lengthM: 21, widthM: 10, heightM: 7, note: "a further 7 m under the dome" },
  saloon: { lengthM: 12, widthM: 7, heightM: 5.4 },
  "robert-adam-room": { lengthM: 9.7, widthM: 5.6, heightM: 2.18 },
  "reception-room": { lengthM: 13.4, widthM: 11.2, heightM: 3.2 },
} as const;

export interface WeddingRate {
  readonly packageName: string;
  readonly priceGBP: number;
}

export interface WeddingSeason {
  /** Published season band, e.g. "2026" or "2027/28". */
  readonly years: string;
  readonly rates: readonly WeddingRate[];
}

/** Room hire for exclusive wedding use — the venue's own package names and
 *  figures, verbatim. 2026 publishes three packages; a ceremony-only rate is
 *  only published from 2027/28. Do not normalise or infer missing rates. */
export const TRADES_HALL_WEDDING_PRICING = {
  currency: "GBP",
  scope: "Exclusive wedding use of Trades Hall, for up to 180 guests",
  seasons: [
    {
      years: "2026",
      rates: [
        { packageName: "Wedding Breakfast and Evening Reception", priceGBP: 2800 },
        { packageName: "Twilight Wedding", priceGBP: 1800 },
        { packageName: "Evening Reception", priceGBP: 1500 },
      ],
    },
    {
      years: "2027/28",
      rates: [
        { packageName: "Ceremony only", priceGBP: 650 },
        { packageName: "Wedding Breakfast and Evening Reception", priceGBP: 2900 },
        { packageName: "Twilight Wedding", priceGBP: 2000 },
        { packageName: "Evening Reception", priceGBP: 1800 },
      ],
    },
  ],
} as const satisfies {
  currency: "GBP";
  scope: string;
  seasons: readonly WeddingSeason[];
};

/** Where each figure came from, and when — rendered wherever the numbers are. */
export const VENUE_TRUTH_PROVENANCE = {
  capacities:
    "Capacity figures confirmed by the Trades Hall team, 2026-07-09 — a planning guide; final numbers depend on your layout.",
  pricing:
    "Room-hire rates provided by the Trades Hall team, 2026-07-09. Catering and services are quoted separately by the events team.",
} as const;

const gbp = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

export function formatPriceGBP(priceGBP: number): string {
  return gbp.format(priceGBP);
}
