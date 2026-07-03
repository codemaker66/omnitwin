import { tradesHallVenueImages } from "../../lib/trades-hall-room-showcase.js";
import { RETURN_CTA_HREF } from "../landing/rite-copy.js";

// -----------------------------------------------------------------------------
// spotlight-copy — every line of copy on the Spotlight landing page, as data.
//
// Same contract as rite-copy.ts: no copy buried in JSX, and the whole script
// is swept through the claim guard by spotlight-copy.test.ts. This page is
// the white-label landing concept for the Trades Hall website once the venue
// runs Venviewer: a dark, single-viewport hero where a carried light reveals
// the dressed Grand Hall inside the empty one.
// -----------------------------------------------------------------------------

/** Kept in sync with the static tags in index.html — the spotlight page is
 *  the homepage at `/`, so link scrapers read the static copy of this. */
export const SPOTLIGHT_META_TITLE =
  "See your evening before it happens — Trades Hall Glasgow";

/** The two headline lines: italic serif whisper, then the roman answer. */
export const SPOTLIGHT_HEADLINE_ITALIC = "See your evening";
export const SPOTLIGHT_HEADLINE_ROMAN = "before it happens.";

/** Bottom-left — the venue, in the dark. */
export const SPOTLIGHT_VENUE_LINE =
  "Beneath the dome Robert Adam drew in 1791, the Grand Hall waits in the dark — panelled walls, chandeliers, and two centuries of Glasgow's evenings.";

/** Bottom-right — the instrument, and the invitation. */
export const SPOTLIGHT_PRODUCT_LINE =
  "Carry the light across the room and watch it dressed for your night. Then open the planner — every table and every chair, arranged in your browser before you ever enquire.";

export const SPOTLIGHT_CTA_LABEL = "Begin with the room";
/** Same planner entry as the rite's Return CTA — one door, never two. */
export const SPOTLIGHT_CTA_HREF = RETURN_CTA_HREF;

/** The empty hall (converted from the venue's dark-room capture). */
export const SPOTLIGHT_BASE_IMAGE = "/images/venue/grand-hall-dark.jpg";
export const SPOTLIGHT_BASE_ALT =
  "The Grand Hall of Trades Hall Glasgow, dark and empty beneath its dome";

/** The same room, dressed — revealed only inside the carried light. */
export const SPOTLIGHT_REVEAL_IMAGE = tradesHallVenueImages.grandHall;

export const SPOTLIGHT_BRAND_NAME = "Trades Hall";
export const SPOTLIGHT_SIGN_IN_LABEL = "Sign in";
export const SPOTLIGHT_SIGN_IN_HREF = "/login";
export const SPOTLIGHT_MENU_LABEL = "Menu";

export interface SpotlightNavLink {
  readonly label: string;
  readonly href: string;
  /** The pill item for the page the visitor is already on. */
  readonly current: boolean;
}

export const SPOTLIGHT_NAV_LINKS: readonly SpotlightNavLink[] = [
  { label: "The hall", href: "/welcome", current: true },
  { label: "The rooms", href: "/#rooms", current: false },
  { label: "Weddings", href: "/rooms/grand-hall", current: false },
  { label: "Live tour", href: "/venues/trades-hall/twin", current: false },
] as const;

/** Every user-visible line, flattened for the claim-guard sweep. */
export function allSpotlightCopy(): readonly string[] {
  return [
    SPOTLIGHT_META_TITLE,
    SPOTLIGHT_HEADLINE_ITALIC,
    SPOTLIGHT_HEADLINE_ROMAN,
    SPOTLIGHT_VENUE_LINE,
    SPOTLIGHT_PRODUCT_LINE,
    SPOTLIGHT_CTA_LABEL,
    SPOTLIGHT_BASE_ALT,
    SPOTLIGHT_BRAND_NAME,
    SPOTLIGHT_SIGN_IN_LABEL,
    SPOTLIGHT_MENU_LABEL,
    ...SPOTLIGHT_NAV_LINKS.map((link) => link.label),
  ] as const;
}
