import {
  CAPACITY_FORMATS,
  TRADES_HALL_ROOM_CAPACITIES,
  VENUE_TRUTH_PROVENANCE,
  type PublishedRoomSlug,
  type RoomCapacity,
} from "@omnitwin/types";
import {
  FRESH_ENQUIRY_LEDE,
  FRESH_ENQUIRY_TITLE,
  FRESH_FOOTER_NOTE,
  FRESH_LEGAL_LINKS,
  FRESH_RATES_NOTE,
  FRESH_RATES_TITLE,
} from "./fresh/fresh-copy.js";
import { ENQUIRY_ROOM_NAMES } from "./fresh/enquiry-fit.js";

// -----------------------------------------------------------------------------
// home-copy — every word on the front door, as data, swept by its test.
//
// T-616 made `/` the one canonical public home. The captured rooms were
// already here; the published capacities, the wedding rates and the enquiry
// composer used to live only on /fresh. All of it is on this page now, so this
// module is where its words live — the arrangement fresh-copy.ts, rite-copy.ts
// and spotlight-copy.ts already use.
//
// Register: plain, warm, specific. Sentence case. British spelling. Every
// figure is imported from trades-hall-venue-truth, never typed here, and the
// rates and composer headings are /fresh's own constants, so neither a number
// nor a heading can drift between the two pages that show them.
// -----------------------------------------------------------------------------

/** Kept in sync with the static tags in index.html — scrapers read those, the
 *  page sets these, and a visitor should not meet two different sentences. */
export const HOME_META_TITLE = "Trades Hall of Glasgow — weddings and events";
export const HOME_META_DESCRIPTION =
  "Robert Adam's guild hall on Glassford Street — weddings, dinners, and conferences in the room Glasgow has celebrated in since 1791.";

/** The room walk's own title, so a shared /room/:slug link names its room. */
export function roomWalkMetaTitle(roomName: string): string {
  return `${roomName} — Trades Hall of Glasgow`;
}

export const HOME_VENUE = "Trades Hall of Glasgow";
export const HOME_WORDMARK = "Venviewer";

/** Primary nav. Staff destinations (Dashboard, Diary, Hallkeeper) are gone:
 *  each one bounced an anonymous visitor into a login wall, so the front door
 *  advertised three doors the public cannot open. "Log in" is the one way in
 *  for the people who do have an account, and it takes them to their
 *  workspace. */
export const HOME_NAV_PLAN = "Plan an event";
export const HOME_NAV_ENQUIRE = "Ask about a date";
export const HOME_NAV_LOGIN = "Log in";

/** The hero: the venue's own photograph of its signature room. */
export const HOME_HERO_LEDE =
  "Weddings, dinners and conferences in Robert Adam's Glasgow hall.";
export const HOME_HERO_ALT = "The Grand Hall set for a wedding beneath its chandeliers";
export const HOME_HERO_PLAN = "Plan Grand Hall";
export const HOME_HERO_WALK = "Walk the room";
/** Founder hold of 19 September 2026 (lib/splat-access.ts): outside local
 *  development no captured room opens, and the page says so in these words. */
export const HOME_HERO_SPLATS_HELD = "Gaussian splats · Work in progress";
export const HOME_HERO_TOUR = "Try the virtual tour · Work in progress";
export const HOME_CARD_HELD = "Work in progress";

export const HOME_ROOMS_TITLE = "More rooms";

export const HOME_CAPACITY_TITLE = "What each room holds";
/** Every layout the venue publishes, per room — never one number for the
 *  building. The table's last row gives each layout's range across them. */
export const HOME_CAPACITY_LEDE = "The venue's published capacities, by layout.";
export const HOME_CAPACITY_NOTE = VENUE_TRUTH_PROVENANCE.capacities;
export const HOME_CAPACITY_ROOM_HEADING = "Room";
export const HOME_CAPACITY_RANGE_HEADING = "Across the rooms";

export const HOME_RATES_TITLE = FRESH_RATES_TITLE;
export const HOME_RATES_NOTE = FRESH_RATES_NOTE;
export const HOME_RATES_PROVENANCE = VENUE_TRUTH_PROVENANCE.pricing;

export const HOME_ENQUIRY_TITLE = FRESH_ENQUIRY_TITLE;
export const HOME_ENQUIRY_LEDE = FRESH_ENQUIRY_LEDE;

export const HOME_FOOT_ABOUT = "About the venue";
export const HOME_FOOT_TWIN = "Virtual tour · Work in progress";
export const HOME_FOOT_TWIN_HREF = "/venues/trades-hall/twin";
export const HOME_FOOT_ENQUIRE = "Ask about a date";
export const HOME_FOOT_SCAN_NOTE = "Scan dimensions are estimates. Confirm measurements with the venue.";
export const HOME_FOOT_NOTE = FRESH_FOOTER_NOTE;
/** The page collects personal data through the composer, so the privacy
 *  notice must be reachable from it (UK GDPR transparency), as on /fresh. */
export const HOME_LEGAL_LINKS = FRESH_LEGAL_LINKS;

/** The house's display names for the published rooms: the composer's own
 *  map, so the table and the composer beside it name a room the same way. */
export const HOME_ROOM_NAMES: Readonly<Record<PublishedRoomSlug, string>> = ENQUIRY_ROOM_NAMES;

export interface CapacityEnvelope {
  readonly key: keyof RoomCapacity;
  readonly label: string;
  readonly smallest: number;
  readonly largest: number;
}

/**
 * The house's envelope for one layout: the smallest and largest published
 * capacity across the rooms. "180" alone reads as the building's number;
 * "40 to 180" is what the venue actually publishes.
 */
export function capacityEnvelopes(): readonly CapacityEnvelope[] {
  const slugs = Object.keys(TRADES_HALL_ROOM_CAPACITIES) as readonly PublishedRoomSlug[];
  return CAPACITY_FORMATS.map((format) => {
    const counts = slugs.map((slug) => TRADES_HALL_ROOM_CAPACITIES[slug][format.key]);
    return {
      key: format.key,
      label: format.label,
      smallest: Math.min(...counts),
      largest: Math.max(...counts),
    };
  });
}

/** An envelope in words — or the single figure when a layout happens to be
 *  flat across every room. It is not flat today; do not assume it stays so. */
export function envelopeLine(envelope: CapacityEnvelope): string {
  return envelope.smallest === envelope.largest
    ? String(envelope.smallest)
    : `${String(envelope.smallest)} to ${String(envelope.largest)}`;
}

/** Everything user-visible on this page, for the public copy sweep. */
export function allHomeCopy(): readonly string[] {
  return [
    HOME_META_TITLE,
    HOME_META_DESCRIPTION,
    HOME_VENUE,
    HOME_WORDMARK,
    HOME_NAV_PLAN,
    HOME_NAV_ENQUIRE,
    HOME_NAV_LOGIN,
    HOME_HERO_LEDE,
    HOME_HERO_ALT,
    HOME_HERO_PLAN,
    HOME_HERO_WALK,
    HOME_HERO_SPLATS_HELD,
    HOME_HERO_TOUR,
    HOME_CARD_HELD,
    HOME_ROOMS_TITLE,
    HOME_CAPACITY_TITLE,
    HOME_CAPACITY_LEDE,
    HOME_CAPACITY_NOTE,
    HOME_CAPACITY_ROOM_HEADING,
    HOME_CAPACITY_RANGE_HEADING,
    HOME_RATES_TITLE,
    HOME_RATES_NOTE,
    HOME_RATES_PROVENANCE,
    HOME_ENQUIRY_TITLE,
    HOME_ENQUIRY_LEDE,
    HOME_FOOT_ABOUT,
    HOME_FOOT_TWIN,
    HOME_FOOT_ENQUIRE,
    HOME_FOOT_SCAN_NOTE,
    HOME_FOOT_NOTE,
    ...HOME_LEGAL_LINKS.map((link) => link.label),
    ...Object.values(HOME_ROOM_NAMES),
    ...capacityEnvelopes().flatMap((envelope) => [envelope.label, envelopeLine(envelope)]),
  ];
}
