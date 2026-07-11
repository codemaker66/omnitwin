import { tradesHallVenueImages } from "../../lib/trades-hall-room-showcase.js";
import {
  FOOTER_EMAIL,
  FOOTER_PHONE_DISPLAY,
  FOOTER_PHONE_HREF,
  HALL_LIT_YEARS,
  enquiryMailtoHref,
} from "../landing/rite-copy.js";

// -----------------------------------------------------------------------------
// fresh-copy — every word on /fresh, as data, claim-guarded by its test.
//
// Register: plain, warm, specific. Sentence case throughout. Figures are
// imported (venue truth, derived years), never typed here. Photography is
// the venue's own; alt text describes what the photograph actually shows.
// -----------------------------------------------------------------------------

export const FRESH_META_TITLE = "Trades Hall of Glasgow — weddings and events";

export const FRESH_BRAND_SMALL = "Est. 1791 · Glasgow";
export const FRESH_BRAND_NAME = "Trades Hall";

/** The hero thesis. The word "lit" carries the page's one bold move — a
 *  slow variable-font breath, like candlelight. */
export const FRESH_HEADLINE_BEFORE = "The hall has been";
export const FRESH_HEADLINE_KINETIC = "lit";
export const FRESH_HEADLINE_AFTER = `for ${String(HALL_LIT_YEARS)} years.`;

export const FRESH_LEDE =
  "Robert Adam's guild hall on Glassford Street — home of Glasgow's trades since 1791, and still the room the city celebrates in. Dinners beneath the dome, ceremonies in candlelight, conferences with two centuries of good company.";

export const FRESH_CTA_DATES = "Ask about a date";
export const FRESH_CTA_ROOMS = "See the rooms";

export const FRESH_ROOMS_TITLE = "Six rooms, one house";
export const FRESH_ROOMS_LEDE =
  "Every room is photographed as it is. Capacities are the venue's own published figures.";

export interface FreshRoom {
  readonly slug: "grand-hall" | "saloon" | "reception-room" | "robert-adam-room";
  readonly name: string;
  readonly line: string;
  readonly image: string;
  readonly alt: string;
  readonly width: number;
  readonly height: number;
  /** Portrait photographs render taller so nobody in them loses their head. */
  readonly portrait?: boolean;
  /** object-position focus, when the subject is not centred. */
  readonly focus?: string;
}

/** The hero is the house itself, from above. */
export const FRESH_HERO_IMAGE = tradesHallVenueImages.exterior;
export const FRESH_HERO_ALT =
  "Trades Hall and its dome from above, amid the rooftops of Glasgow's Merchant City";

/** The photographed rooms, newest shoot only (June 2026), one photograph
 *  each — never repeated anywhere on the page. The two galleries are
 *  listed without photography — honestly — below. */
export const FRESH_ROOMS: readonly FreshRoom[] = [
  {
    slug: "grand-hall",
    name: "The Grand Hall",
    line: "Dinner beneath the dome, the silk frieze of the trades above you.",
    image: tradesHallVenueImages.grandHall,
    alt: "The Grand Hall dressed and candlelit beneath the dome",
    width: 1535,
    height: 1024,
  },
  {
    slug: "saloon",
    name: "The Saloon",
    line: "Panelled walls and stained glass — made for speeches and toasts.",
    image: tradesHallVenueImages.saloon,
    alt: "The Saloon, stained-glass windows above panelled walls",
    width: 1535,
    height: 1025,
  },
  {
    slug: "reception-room",
    name: "The Reception Room",
    line: "Where an evening at Trades Hall begins.",
    image: tradesHallVenueImages.receptionRoom,
    alt: "The Reception Room dressed for a ceremony, candles along the aisle",
    width: 1536,
    height: 1024,
  },
  {
    slug: "robert-adam-room",
    name: "The Robert Adam Room",
    line: "The architect's own room, at its most intimate scale.",
    image: tradesHallVenueImages.robertAdamRoom,
    alt: "A bride mid-aisle at a ceremony in the Robert Adam Room",
    width: 1122,
    height: 1402,
    portrait: true,
    focus: "center 18%",
  },
] as const;

/** Today's artwork (2026-07-11): an illustrated portrait of the facade,
 *  and the arms of the Trades House. Labelled as artwork — never as
 *  photography. */
export const FRESH_HERITAGE_ART = "/images/brand/facade-art.webp";
export const FRESH_HERITAGE_ART_ALT =
  "An illustrated portrait of the Trades Hall facade — dome, portico, and lit windows";
export const FRESH_ARMS = "/images/brand/coat-of-arms.webp";
export const FRESH_ARMS_MARK = "/images/brand/coat-of-arms-mark.png";
export const FRESH_ARMS_ALT = "The arms of the Trades House of Glasgow";
export const FRESH_MOTTO = "Union is strength";
export const FRESH_MOTTO_ATTR = "The motto of the Trades House of Glasgow";

export const FRESH_GALLERIES_NOTE =
  "The North and South Galleries seat forty each — quieter rooms for planning meetings, drinks, and green-room use.";

export const FRESH_RATES_TITLE = "Weddings, plainly priced";
export const FRESH_RATES_NOTE =
  "Rates below are for exclusive wedding use of the hall. For dinners, conferences, and everything else, ask — every event is quoted on its shape.";

export const FRESH_HERITAGE_TITLE = "The house of the trades";
export const FRESH_HERITAGE_BODY =
  "Trades Hall was designed by Robert Adam and has served as the meeting place of the Trades House of Glasgow — the city's fourteen incorporated crafts — since 1791. It is the oldest building in Glasgow still used for its original purpose. When you celebrate here, you are keeping its diary going.";

export const FRESH_CONTACT_TITLE = "Speak with the events team";
export const FRESH_CONTACT_PHONE_DISPLAY = FOOTER_PHONE_DISPLAY;
export const FRESH_CONTACT_PHONE_HREF = FOOTER_PHONE_HREF;
export const FRESH_CONTACT_EMAIL = FOOTER_EMAIL;
export const freshEnquiryHref = (): string => enquiryMailtoHref();

export const FRESH_ADDRESS = "85 Glassford Street, Glasgow G1 1UH";
export const FRESH_MAPS_HREF = "https://maps.google.com/?q=Trades+Hall+of+Glasgow,+85+Glassford+Street,+Glasgow+G1+1UH";

export const FRESH_THEME_LABEL = "Theme";
export const FRESH_THEME_OPTIONS = [
  { key: "auto", label: "Auto" },
  { key: "light", label: "Light" },
  { key: "dark", label: "Dark" },
] as const;

export const FRESH_FOOTER_NOTE = "© 2026 The Trades House of Glasgow · Powered by Venviewer";

/** Everything user-visible, for the claim-guard sweep. */
export function allFreshCopy(): readonly string[] {
  return [
    FRESH_META_TITLE,
    FRESH_BRAND_SMALL,
    FRESH_BRAND_NAME,
    FRESH_HEADLINE_BEFORE,
    FRESH_HEADLINE_KINETIC,
    FRESH_HEADLINE_AFTER,
    FRESH_LEDE,
    FRESH_CTA_DATES,
    FRESH_CTA_ROOMS,
    FRESH_ROOMS_TITLE,
    FRESH_ROOMS_LEDE,
    FRESH_HERO_ALT,
    FRESH_HERITAGE_ART_ALT,
    FRESH_ARMS_ALT,
    FRESH_MOTTO,
    FRESH_MOTTO_ATTR,
    ...FRESH_ROOMS.flatMap((r) => [r.name, r.line, r.alt]),
    FRESH_GALLERIES_NOTE,
    FRESH_RATES_TITLE,
    FRESH_RATES_NOTE,
    FRESH_HERITAGE_TITLE,
    FRESH_HERITAGE_BODY,
    FRESH_CONTACT_TITLE,
    FRESH_ADDRESS,
    FRESH_THEME_LABEL,
    ...FRESH_THEME_OPTIONS.map((o) => o.label),
    FRESH_FOOTER_NOTE,
  ] as const;
}
