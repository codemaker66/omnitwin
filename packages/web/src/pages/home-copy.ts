import {
  CAPACITY_FORMATS,
  TRADES_HALL_ROOM_CAPACITIES,
  VENUE_TRUTH_PROVENANCE,
  type PublishedRoomSlug,
  type RoomCapacity,
} from "../lib/trades-hall-venue-truth.js";

// -----------------------------------------------------------------------------
// home-copy — every word on the front door, as data, swept by its test.
//
// T-616 made `/` the one canonical public home: the photography, the published
// capacities, the wedding rates and the enquiry composer used to live on
// /fresh, and the captured rooms used to live here. Both halves are now on this
// page, so this module is where its words live — the arrangement fresh-copy.ts,
// rite-copy.ts and spotlight-copy.ts already use.
//
// Register: plain, warm, specific. Sentence case. British spelling. Every
// figure is imported from trades-hall-venue-truth, never typed here, so a
// number cannot drift between this page and the room dossiers.
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
 *  each one bounced an anonymous visitor into a Clerk login wall, so the front
 *  door advertised three doors the public cannot open. "Log in" is the one way
 *  in for the people who do have an account. */
export const HOME_NAV_PLAN = "Plan an event";
export const HOME_NAV_ENQUIRE = "Ask about a date";
export const HOME_NAV_LOGIN = "Log in";

export const HOME_HERO_KICKER = "Est. 1791 · Glasgow";
export const HOME_HERO_HEADLINE = "The Grand Hall";
export const HOME_HERO_LEDE =
  "Weddings, dinners and conferences in Robert Adam's Glasgow hall.";
export const HOME_HERO_ENQUIRE = "Ask about a date";
export const HOME_HERO_WALK = "Walk the Grand Hall";

/** The hero photograph: the venue's own room, dressed and candlelit. A
 *  rendered still of the capture is the planner's material, not the front
 *  door's — the resolving-splat hero is Release 2. */
export const HOME_HERO_IMAGE = "/images/rooms/ladder/grand-hall-1120.webp";
export const HOME_HERO_SRCSET =
  "/images/rooms/ladder/grand-hall-480.webp 480w, /images/rooms/ladder/grand-hall-768.webp 768w, /images/rooms/ladder/grand-hall-1120.webp 1120w";
export const HOME_HERO_SIZES = "(max-width: 760px) calc(100vw - 32px), calc(100vw - 88px)";
export const HOME_HERO_ALT = "The Grand Hall dressed and candlelit beneath the dome";

export const HOME_ROOMS_TITLE = "Walk the rooms";
export const HOME_ROOMS_LEDE =
  "Each room was captured on site. Open one to look around it at full size.";

export const HOME_CAPACITY_TITLE = "What each room holds";
/** Envelopes, never one number: a room seats a different count in every
 *  layout, and the venue publishes all four. */
export const HOME_CAPACITY_LEDE =
  "Published figures across the six hireable rooms, by layout.";
export const HOME_CAPACITY_NOTE = VENUE_TRUTH_PROVENANCE.capacities;
export const HOME_CAPACITY_ROOM_HEADING = "Room";

export const HOME_RATES_TITLE = "Wedding hire";
export const HOME_RATES_NOTE =
  "Exclusive wedding hire. Contact the team for other events.";
export const HOME_RATES_PROVENANCE = VENUE_TRUTH_PROVENANCE.pricing;

export const HOME_ENQUIRY_TITLE = "Ask about a date";
export const HOME_ENQUIRY_LEDE =
  "Choose an occasion and a guest count, and the page suggests a room before you write a word.";

export const HOME_FOOT_ABOUT = "About the venue";
export const HOME_FOOT_TWIN = "Walk the whole building";
/** Shown only while FRESH_TOUR_ENABLED is true — the twin bundle is not on the
 *  asset base, and the SPA rewrite answers its missing manifest with a 200, so
 *  an ungated link here would look like a working door and open on nothing. */
export const HOME_FOOT_TWIN_HREF = "/venues/trades-hall/twin";
export const HOME_FOOT_ENQUIRE = "Ask about a date";
export const HOME_FOOT_NOTE = "© 2026 The Trades House of Glasgow · Powered by Venviewer";

/** The house's display names for the published rooms. Matches the names the
 *  enquiry composer uses, so a visitor reads one name for one room. */
export const HOME_ROOM_NAMES: Readonly<Record<PublishedRoomSlug, string>> = {
  "grand-hall": "The Grand Hall",
  saloon: "The Saloon",
  "robert-adam-room": "The Robert Adam Room",
  "reception-room": "The Reception Room",
  "north-gallery": "The North Gallery",
  "south-gallery": "The South Gallery",
} as const;

export interface CapacityEnvelope {
  readonly key: keyof RoomCapacity;
  readonly label: string;
  readonly smallest: number;
  readonly largest: number;
}

/**
 * The house's envelope for one layout: the smallest and largest published
 * capacity across the six rooms. "180" alone reads as the building's number;
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
    HOME_HERO_KICKER,
    HOME_HERO_HEADLINE,
    HOME_HERO_LEDE,
    HOME_HERO_ENQUIRE,
    HOME_HERO_WALK,
    HOME_HERO_ALT,
    HOME_ROOMS_TITLE,
    HOME_ROOMS_LEDE,
    HOME_CAPACITY_TITLE,
    HOME_CAPACITY_LEDE,
    HOME_CAPACITY_NOTE,
    HOME_CAPACITY_ROOM_HEADING,
    HOME_RATES_TITLE,
    HOME_RATES_NOTE,
    HOME_RATES_PROVENANCE,
    HOME_ENQUIRY_TITLE,
    HOME_ENQUIRY_LEDE,
    HOME_FOOT_ABOUT,
    HOME_FOOT_TWIN,
    HOME_FOOT_ENQUIRE,
    HOME_FOOT_NOTE,
    ...Object.values(HOME_ROOM_NAMES),
    ...capacityEnvelopes().flatMap((envelope) => [envelope.label, envelopeLine(envelope)]),
  ];
}
