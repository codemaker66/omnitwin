import {
  computeBoundingBox,
  roomGeometries,
} from "../../data/room-geometries.js";
import {
  publicRoomSelectionCards,
  tradesHallVenueImages,
} from "../../lib/trades-hall-room-showcase.js";
import { CAPACITY_GUIDANCE_DISCLOSURE } from "../../lib/proposal-capacity-note.js";

// -----------------------------------------------------------------------------
// rite-copy — every line of copy on The Rite landing page, as data.
//
// Single source of truth for the page's words so tests can hold the whole
// script to the claim guard (findUnsupportedProposalClaim) and so no copy is
// ever buried inside JSX. Numbers in Act II derive from the planner's own
// room geometry — the landing page cannot drift from planner truth.
//
// Design spec: docs/superpowers/specs/2026-07-01-landing-rite-redesign-design.md
// -----------------------------------------------------------------------------

/** The hall's founding year — the anchor for every age claim on the page. */
const HALL_FOUNDED_YEAR = 1791;
/** Derived from the calendar so the figure never rots — the old hard-coded
 *  "230" had silently dated the copy to 2021. */
export const HALL_LIT_YEARS = new Date().getFullYear() - HALL_FOUNDED_YEAR;

/** Applied client-side when the rite mounts (/landing). The static tags in
 *  index.html carry the homepage's SPOTLIGHT_META_* copy — scrapers read
 *  those; this pair only retitles the tab once the rite hydrates. */
export const RITE_META_TITLE =
  "Trades Hall Glasgow — a hall lit since 1791";
export const RITE_META_DESC =
  "Enter the Grand Hall of Trades Hall Glasgow — four principal rooms within Robert Adam's hall, held in candlelight. Then arrange the room for your own evening.";

/** Beat 0 — the threshold. One line in the dark. */
export const THRESHOLD_LINE = `There is a hall in Glasgow that has been lit for ${String(HALL_LIT_YEARS)} years.`;
export const THRESHOLD_ENTER_LABEL = "Enter";

/** Act I — darkness. Whispered lines pacing the descent. */
export const DARKNESS_LINES: readonly string[] = [
  "Your eyes will adjust. They always do.",
  "What you can almost see was drawn by Robert Adam in 1791.",
] as const;

/** Act I — the edge-lit architectural fragments the carried light grazes. */
export interface DarknessFragment {
  readonly id: string;
  readonly image: string;
  readonly alt: string;
  /** object-position crop chosen to isolate an architectural edge. */
  readonly imagePosition: string;
}

export const DARKNESS_FRAGMENTS: readonly DarknessFragment[] = [
  {
    id: "chandelier",
    image: tradesHallVenueImages.grandHall,
    alt: "A chandelier of the Grand Hall, barely visible in darkness",
    imagePosition: "center 8%",
  },
  {
    id: "dome-curve",
    image: tradesHallVenueImages.grandHall,
    alt: "The curve of the Grand Hall dome, barely visible in darkness",
    imagePosition: "center 0%",
  },
  {
    id: "panelling",
    image: tradesHallVenueImages.saloon,
    alt: "Panelled walls of the Saloon, barely visible in darkness",
    imagePosition: "center 60%",
  },
] as const;

/** Act II — magnitude. Measures derived from planner geometry where it exists. */
export interface MagnitudeMeasure {
  /** The number, already formatted for display (tabular figures). */
  readonly figure: string;
  /** Small-caps label set beside or beneath the figure. */
  readonly label: string;
  /** Value for the count-up animation; null renders the figure statically. */
  readonly countTo: number | null;
}

export function buildMagnitudeMeasures(): readonly MagnitudeMeasure[] {
  const grandHall = roomGeometries["Grand Hall"];
  if (grandHall === undefined) {
    throw new Error("rite-copy: Grand Hall geometry missing");
  }
  const bbox = computeBoundingBox(grandHall.wallPolygon);
  const lengthM = Math.round(bbox.width);
  const ceilingM = Math.round(grandHall.ceilingHeight);
  const domeM = Math.round(grandHall.domeRadius * 2);
  return [
    {
      figure: String(lengthM),
      label: "metres, end to end",
      countTo: null,
    },
    {
      figure: String(ceilingM),
      label: `metres of air above the dinner table — a ${String(domeM)}-metre dome above that`,
      countTo: null,
    },
    {
      // Venue-published dinner capacity (tradeshallglasgow.co.uk/rooms/,
      // verified 2026-07-02) — not derivable from geometry.
      figure: "180",
      label: "seats at dinner, beneath the dome",
      countTo: 180,
    },
    {
      figure: "1791",
      label: "the year Robert Adam drew these walls",
      countTo: null,
    },
  ] as const;
}

export const MAGNITUDE_KICKER = "The measure of it";
export const SKIP_TO_ROOMS_LABEL = "Skip to the rooms";

/** Act III — contemplation. The four principal rooms as chapters. */
export interface RoomChapter {
  readonly slug: string;
  readonly name: string;
  readonly line: string;
  readonly image: string;
  readonly alt: string;
  readonly imagePosition: string;
  /** Venue-published planning figures; always shown with the SAFE disclosure. */
  readonly standing: number;
  readonly banquet: number;
  readonly showcaseHref: string;
}

/** The page-owned poetry and planning figures for each chapter. Everything
 *  else (name, image, showcase route) derives from the shared room-selection
 *  cards so the landing page can never drift from the showcase surfaces. */
interface ChapterVoice {
  readonly slug: string;
  readonly line: string;
  readonly alt: string;
  readonly imagePosition: string;
  readonly standing: number;
  readonly banquet: number;
}

/** Capacity figures are the venue's own published numbers
 *  (tradeshallglasgow.co.uk/rooms/, verified 2026-07-02):
 *  standing = the venue's "Reception" figure, banquet = "Dinner". */
const CHAPTER_VOICES: readonly ChapterVoice[] = [
  {
    slug: "grand-hall",
    line: "The room the city keeps its promises in.",
    alt: "The Grand Hall, empty, its chandeliers lit beneath the domed ceiling",
    imagePosition: "center 48%",
    standing: 250,
    banquet: 180,
  },
  {
    slug: "saloon",
    line: "Stained glass, panelled walls, and the quiet before the toast.",
    alt: "The Saloon, empty, stained-glass windows above panelled walls",
    imagePosition: "center 46%",
    standing: 80,
    banquet: 60,
  },
  {
    slug: "robert-adam-room",
    line: "The architect's own hand, at its most intimate scale.",
    alt: "The Robert Adam Room, empty, plasterwork ceiling above",
    imagePosition: "center 36%",
    standing: 150,
    banquet: 60,
  },
  {
    slug: "reception-room",
    line: "Where every evening at Trades Hall begins.",
    alt: "The Reception Room, empty, afternoon light along the aisle",
    imagePosition: "center 52%",
    standing: 100,
    banquet: 60,
  },
] as const;

export const ROOM_CHAPTERS: readonly RoomChapter[] = CHAPTER_VOICES.map(
  (voice) => {
    const card = publicRoomSelectionCards.find(
      (candidate) => candidate.canonicalRoomSlug === voice.slug,
    );
    if (card === undefined || card.routeHref === null) {
      throw new Error(`rite-copy: no showcase card/route for "${voice.slug}"`);
    }
    return {
      slug: voice.slug,
      name: card.name,
      line: voice.line,
      image: card.image,
      alt: voice.alt,
      imagePosition: voice.imagePosition,
      standing: voice.standing,
      banquet: voice.banquet,
      showcaseHref: card.routeHref,
    };
  },
);

/** The quiet index that closes Act III: all eight rooms, none orphaned. */
export const ROOM_INDEX_TITLE = "Eight rooms, each keeping its own hours.";
export const ROOM_INDEX_EXPLORE_LABEL = "Explore";
export const ROOM_INDEX_ENQUIRE_LABEL = "Enquire";
export { publicRoomSelectionCards as ROOM_INDEX_CARDS };

/** The one disclosure that accompanies every capacity figure on this page. */
export const CAPACITY_DISCLOSURE = CAPACITY_GUIDANCE_DISCLOSURE;

export const ROOM_TONE_LABEL = "Room tone";
export const ROOM_TONE_ON_HINT = "The sound of the empty hall. Tap again for silence.";

/** The Return. */
export const RETURN_LINE = "The room is yours to arrange.";
export const RETURN_CTA_LABEL = "Begin with the room";
export const RETURN_CTA_HREF = "/plan?space=grand-hall";
export const RETURN_SECONDARY_LABEL = "Speak with the events team";

/** Nav (appears from Act II onward). */
export const NAV_BRAND_SMALL = "Est. 1791 · Glasgow";
export const NAV_BRAND_NAME = "Trades Hall";
export const NAV_ROOMS_LABEL = "The rooms";
export const NAV_PLAN_LABEL = "Open the planner";
export const NAV_SIGN_IN_LABEL = "Sign in";

/** Footer — practical details, kept verbatim from the venue's records. */
export const FOOTER_ADDRESS_LINES: readonly string[] = [
  "85 Glassford Street, Glasgow, G1 1UH",
  "Event enquiries through the Trades Hall events team.",
  "Use a planning draft as the conversation starter.",
] as const;

/** The venue's published contact details
 *  (tradeshallglasgow.co.uk/contact/, verified 2026-07-02). */
export const FOOTER_PHONE_DISPLAY = "0141 552 2418";
export const FOOTER_PHONE_HREF = "tel:+441415522418";
export const FOOTER_EMAIL = "info@tradeshallglasgow.co.uk";

/** Mailto for the events team, with the room carried in the subject so
 *  per-room "Enquire" links keep their context instead of dead-ending. */
export function enquiryMailtoHref(roomName?: string): string {
  const subject =
    roomName === undefined
      ? "Event enquiry — Trades Hall Glasgow"
      : `Event enquiry — ${roomName}, Trades Hall Glasgow`;
  return `mailto:${FOOTER_EMAIL}?subject=${encodeURIComponent(subject)}`;
}

export const FOOTER_BASELINE =
  "© 2026 The Trades House of Glasgow · Powered by Venviewer";
export const FOOTER_BASELINE_RIGHT = "Built in Glasgow";

export interface FooterLink {
  readonly label: string;
  readonly href: string;
  /** true → react-router Link; false → in-page anchor. */
  readonly routed: boolean;
}

export const FOOTER_LEGAL_LINKS: readonly FooterLink[] = [
  { label: "Terms", href: "/legal/terms", routed: true },
  { label: "Privacy", href: "/legal/privacy", routed: true },
  { label: "Accessibility", href: "/legal/accessibility", routed: true },
] as const;

/** Tab title set when the visitor leaves mid-rite (visibilitychange). */
export const AWAY_TAB_TITLE = "The hall is still lit.";

/**
 * Every user-visible line, flattened, so a single test can sweep the whole
 * script through the claim guard and the no-dead-anchor sweep can trust that
 * copy lives nowhere else.
 */
export function allRiteCopy(): readonly string[] {
  return [
    RITE_META_TITLE,
    RITE_META_DESC,
    THRESHOLD_LINE,
    THRESHOLD_ENTER_LABEL,
    ...DARKNESS_LINES,
    ...DARKNESS_FRAGMENTS.map((f) => f.alt),
    MAGNITUDE_KICKER,
    ...buildMagnitudeMeasures().flatMap((m) => [m.figure, m.label]),
    SKIP_TO_ROOMS_LABEL,
    ...ROOM_CHAPTERS.flatMap((c) => [c.name, c.line, c.alt]),
    ROOM_INDEX_TITLE,
    ROOM_INDEX_EXPLORE_LABEL,
    ROOM_INDEX_ENQUIRE_LABEL,
    CAPACITY_DISCLOSURE,
    ROOM_TONE_LABEL,
    ROOM_TONE_ON_HINT,
    RETURN_LINE,
    RETURN_CTA_LABEL,
    RETURN_SECONDARY_LABEL,
    NAV_BRAND_SMALL,
    NAV_BRAND_NAME,
    NAV_ROOMS_LABEL,
    NAV_PLAN_LABEL,
    NAV_SIGN_IN_LABEL,
    ...FOOTER_ADDRESS_LINES,
    FOOTER_PHONE_DISPLAY,
    FOOTER_EMAIL,
    FOOTER_BASELINE,
    FOOTER_BASELINE_RIGHT,
    ...FOOTER_LEGAL_LINKS.map((l) => l.label),
    AWAY_TAB_TITLE,
  ] as const;
}
