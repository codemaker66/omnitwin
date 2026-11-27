import { TRADES_HALL_ENQUIRY_VENUE_SLUG } from "./enquiry.js";

// -----------------------------------------------------------------------------
// trades-hall-venue-truth — the single venue-confirmed source for room
// capacities, wedding pricing and the venue's published public profile.
//
// Figures supplied by the client on 2026-07-09 (matching the venue's published
// numbers at tradeshallglasgow.co.uk). Every surface that states a capacity or
// a price must import from here — never restate the numbers. The web pages,
// the page's schema.org description and the API's public discovery endpoint
// (T-649) all read this one module, so they cannot disagree. Tests here pin
// the figures to the client message verbatim; the web package pins its own
// surfaces (the Rite's chapters, the room cards) to these exports.
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
  { key: "theatre", label: "Theatre", description: "Rows of forward-facing seating" },
  { key: "classroom", label: "Classroom", description: "Desk-style seating" },
  { key: "dinner", label: "Dinner", description: "Seated dinner covers" },
  { key: "reception", label: "Reception", description: "Standing reception" },
] as const satisfies readonly { key: keyof RoomCapacity; label: string; description: string }[];

/** Display names for every published room, in the order the venue lists
 *  them — the four photographed rooms use the names on their cards; the
 *  galleries are named as the venue names them. */
export const TRADES_HALL_PUBLISHED_ROOM_NAMES: Readonly<Record<PublishedRoomSlug, string>> = {
  "grand-hall": "The Grand Hall",
  saloon: "The Saloon",
  "robert-adam-room": "The Robert Adam Room",
  "reception-room": "The Reception Room",
  "north-gallery": "The North Gallery",
  "south-gallery": "The South Gallery",
} as const;

/** Whether a room slug is one the venue publishes capacities for. */
export function isPublishedRoomSlug(slug: string): slug is PublishedRoomSlug {
  return Object.prototype.hasOwnProperty.call(TRADES_HALL_ROOM_CAPACITIES, slug);
}

/** One stated extent of a room: the whole room, or one section of a room the
 *  venue publishes in sections. */
export interface RoomExtent {
  /** Which section this is, as the venue names it ("Lower", "Upper"), for a
   *  room published in sections. Absent when the figures are the whole room's. */
  readonly section?: string;
  /** Metres: the venue's own published figures, except the Grand Hall's,
   *  which are measured from the hall's laser scan. */
  readonly lengthM: number;
  readonly widthM: number;
  /** Absent where no height is stated for the room (the galleries). A surface
   *  then shows the length and width alone, never a blank or a guess. */
  readonly heightM?: number;
  /** Qualifier shown with the height, e.g. what the Grand Hall's is measured
   *  to. A few words, because it sits beside the figure in a narrow stat
   *  column (the tour's room dossier); anything longer belongs in `remark`. */
  readonly note?: string;
}

export interface RoomDimensions {
  /** The room's stated extents, in the venue's order: one for a room given as
   *  a whole, one per section for a room published in sections. Never empty,
   *  and a sectioned room has no whole-room figure for a surface to print. */
  readonly extents: readonly [RoomExtent, ...RoomExtent[]];
  /** A full sentence about the room's height that a surface shows apart from
   *  the figure, in its footnote or secondary line: the Grand Hall's dome.
   *  Never a height of its own. */
  readonly remark?: string;
}

/** Room dimensions for the rooms on the official Trades Hall website's rooms
 *  page, read again on 22 November 2026, that a public surface may show. The
 *  Saloon is as the venue publishes it. The Robert Adam Room is published in two
 *  sections, lower and upper, and both are given here in that order: it is one
 *  room on two levels, and neither section's figures are the whole room's.
 *  The North and South Galleries are each published at 11.5 × 4 m; no height
 *  is stated for them here, because the page gives one for the North Gallery
 *  only and does not say what it is measured to (Blake's decisions, 22 November
 *  2026). The Reception Room has no entry: its published size is withheld
 *  (TRADES_HALL_WITHHELD_ROOM_DIMENSIONS below), so a surface shows its
 *  capacities alone.
 *
 *  The Grand Hall is its panelled interior as the Matterport E57 capture of
 *  11 July 2026 measures it, 21.135 m by 10.59 m to about 2 cm, shown as
 *  21.14 × 10.59 m (Blake's decision, 11 November 2026: the measured size);
 *  its height is the clear 6.7 m to the underside of the coffered ceiling. The
 *  dome rises above part of the hall and is never given as the room's height:
 *  the height's note says what it is measured to, and the dome is a separate
 *  remark, shown in a footnote rather than beside the figure. The planner
 *  draws and places in the same interior
 *  (packages/web/src/components/grand-hall/hall-spec.ts). */
export const TRADES_HALL_ROOM_DIMENSIONS: Readonly<
  Partial<Record<PublishedRoomSlug, RoomDimensions>>
> = {
  "grand-hall": {
    extents: [{ lengthM: 21.14, widthM: 10.59, heightM: 6.7, note: "to the coffered ceiling" }],
    remark: "The dome rises above part of the hall.",
  },
  saloon: { extents: [{ lengthM: 12, widthM: 7, heightM: 5.4 }] },
  "robert-adam-room": {
    extents: [
      { section: "Lower", lengthM: 11.2, widthM: 7.6, heightM: 2.8 },
      { section: "Upper", lengthM: 9.7, widthM: 5.6, heightM: 2.18 },
    ],
  },
  "north-gallery": { extents: [{ lengthM: 11.5, widthM: 4 }] },
  "south-gallery": { extents: [{ lengthM: 11.5, widthM: 4 }] },
} as const;

/** Dimensions the venue publishes that no public surface shows, kept here so
 *  the venue's own statement is not lost. Nothing that a visitor reads may
 *  take a figure from this record; a room is in it or in
 *  TRADES_HALL_ROOM_DIMENSIONS, never both.
 *
 *  The Reception Room: the venue's rooms page gives the figures below. The
 *  building survey traces an L-shaped room about a third smaller in area, and
 *  the planner's own outline of the room agrees with the survey
 *  (packages/web/src/data/room-geometries.ts). Blake's decision, 24 November
 *  2026: show the room's capacities and no size until the venue confirms
 *  one. */
export const TRADES_HALL_WITHHELD_ROOM_DIMENSIONS: Readonly<
  Partial<Record<PublishedRoomSlug, RoomDimensions>>
> = {
  "reception-room": { extents: [{ lengthM: 13.4, widthM: 11.2, heightM: 3.2 }] },
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

/** Who stated a set of venue figures, what kind of statement it is, and on
 *  which day, as data rather than a sentence, so a surface can label a figure
 *  "Published guide · Trades Hall · 9 Jul 2026" without parsing prose. */
export interface VenueTruthStatement {
  /** What the figures are, in plain words: "Published guide". */
  readonly kind: string;
  /** Who stated them. */
  readonly statedBy: string;
  /** The day they were stated, ISO 8601 (YYYY-MM-DD). */
  readonly statedOn: string;
}

/** The statements behind the figures in this module. VENUE_TRUTH_PROVENANCE
 *  is written from these, so a short label and the sentence cannot disagree. */
export const VENUE_TRUTH_STATEMENTS = {
  capacities: { kind: "Published guide", statedBy: "Trades Hall", statedOn: "2026-07-09" },
  pricing: { kind: "Published rates", statedBy: "Trades Hall", statedOn: "2026-07-09" },
} as const satisfies Readonly<Record<"capacities" | "pricing", VenueTruthStatement>>;

const statementDay = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** "Published guide · Trades Hall · 9 Jul 2026": who stated a figure and when,
 *  in plain words. A malformed date is shown as written rather than guessed. */
export function venueTruthStatementLabel(statement: VenueTruthStatement): string {
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(statement.statedOn)
    ? Date.parse(`${statement.statedOn}T00:00:00Z`)
    : Number.NaN;
  const day = Number.isFinite(ms) ? statementDay.format(ms) : statement.statedOn;
  return `${statement.kind} · ${statement.statedBy} · ${day}`;
}

/** Where each figure came from, and when — rendered wherever the numbers are. */
export const VENUE_TRUTH_PROVENANCE = {
  capacities:
    `Capacity figures confirmed by the ${VENUE_TRUTH_STATEMENTS.capacities.statedBy} team, ${VENUE_TRUTH_STATEMENTS.capacities.statedOn} — a planning guide; final numbers depend on your layout.`,
  pricing:
    `Room-hire rates provided by the ${VENUE_TRUTH_STATEMENTS.pricing.statedBy} team, ${VENUE_TRUTH_STATEMENTS.pricing.statedOn}. Catering and services are quoted separately by the events team.`,
} as const;

/** A postal address in schema.org's PostalAddress vocabulary. */
export interface PublishedPostalAddress {
  readonly streetAddress: string;
  readonly addressLocality: string;
  readonly postalCode: string;
  /** ISO 3166-1 alpha-2. */
  readonly addressCountry: string;
}

/** What a venue publishes about itself for public discovery: its identity,
 *  where it is, where its own website and Venviewer page are, and how a guest
 *  reaches the team. Everything here is already public on the venue's own
 *  pages; nothing comes from bookings or clients. */
export interface PublicVenueProfile {
  /** The `venues.slug` row this profile describes (the DATABASE namespace —
   *  never the asset slug `trades-hall`; the two differ). */
  readonly dbSlug: string;
  readonly name: string;
  readonly alternateName: string;
  readonly address: PublishedPostalAddress;
  /** The venue's own website. */
  readonly officialWebsite: string;
  /** The venue's public page on Venviewer. */
  readonly venviewerUrl: string;
  /** Where a guest sends an enquiry to the venue team. */
  readonly enquiryUrl: string;
  readonly image: string;
  /** International format, as published. */
  readonly telephone: string;
  readonly email: string;
  /** Display names of the rooms the venue publishes, by room slug, in the
   *  venue's own order. */
  readonly publishedRoomNames: Readonly<Record<string, string>>;
  /** Venue-published capacities by room slug. A room absent here has no
   *  published figure, and nothing may estimate one. */
  readonly publishedCapacities: Readonly<Record<string, RoomCapacity>>;
  /** Who confirmed the capacities, and when. */
  readonly capacityProvenance: string;
}

/** Trades Hall of Glasgow, as the venue publishes itself (its website, and the
 *  front door's own contact details). */
export const TRADES_HALL_PUBLIC_PROFILE: PublicVenueProfile = {
  dbSlug: TRADES_HALL_ENQUIRY_VENUE_SLUG,
  name: "Trades Hall of Glasgow",
  alternateName: "Trades Hall",
  address: {
    streetAddress: "85 Glassford Street",
    addressLocality: "Glasgow",
    postalCode: "G1 1UH",
    addressCountry: "GB",
  },
  officialWebsite: "https://www.tradeshallglasgow.co.uk/",
  venviewerUrl: "https://venviewer.com/",
  enquiryUrl: "https://venviewer.com/#enquire",
  image: "https://venviewer.com/images/venue/trades-hall-exterior-og.jpg",
  telephone: "+44 141 552 2418",
  email: "info@tradeshallglasgow.co.uk",
  publishedRoomNames: TRADES_HALL_PUBLISHED_ROOM_NAMES,
  publishedCapacities: TRADES_HALL_ROOM_CAPACITIES,
  capacityProvenance: VENUE_TRUTH_PROVENANCE.capacities,
};

/** The published capacities of one room, if the venue publishes any. Own
 *  keys only: a slug such as "constructor" is never a room. */
export function publishedRoomCapacity(profile: PublicVenueProfile, roomSlug: string): RoomCapacity | null {
  return Object.prototype.hasOwnProperty.call(profile.publishedCapacities, roomSlug)
    ? profile.publishedCapacities[roomSlug] ?? null
    : null;
}

/** One line, as a person would write the address. */
export function formatPublishedAddress(address: PublishedPostalAddress): string {
  const country = address.addressCountry === "GB" ? "United Kingdom" : address.addressCountry;
  return `${address.streetAddress}, ${address.addressLocality} ${address.postalCode}, ${country}`;
}

const gbp = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

export function formatPriceGBP(priceGBP: number): string {
  return gbp.format(priceGBP);
}
