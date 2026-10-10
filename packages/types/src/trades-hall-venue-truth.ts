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
