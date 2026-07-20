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
export const FRESH_CTA_TOUR = "Walk the building";

/** The whole-building walkthrough — the Twin, at its memorable alias.
 *  149 viewpoints is a capture fact (the scan's own sweep count). */
export const FRESH_TOUR_HREF = "/tour";
export const FRESH_TOUR_TITLE = "Then walk the whole building";
export const FRESH_TOUR_LINE =
  "The full hall in the same capture — 149 viewpoints across every floor, room to room, with dollhouse and plan views.";
export const FRESH_TOUR_CTA = "Open the walkthrough";

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
  /** Rung widths available in /images/venue/ladder/ for this photo. */
  readonly ladder: readonly number[];
  /** Portrait photographs render taller so nobody in them loses their head. */
  readonly portrait?: boolean;
  /** object-position focus, when the subject is not centred. */
  readonly focus?: string;
}

/** Responsive delivery: pre-encoded webp rungs live in
 *  /images/venue/ladder/ as <basename>-<width>.webp — one visitor
 *  downloads one rung, never the full-size original. */
export function ladderSrcSet(imagePath: string, widths: readonly number[]): string {
  const basename = (imagePath.split("/").pop() ?? "").replace(/\.[a-z0-9]+$/i, "");
  return widths
    .map((w) => `/images/venue/ladder/${basename}-${String(w)}.webp ${String(w)}w`)
    .join(", ");
}

export const FRESH_HERO_LADDER = [480, 768, 1120, 1536] as const;
export const FRESH_HERO_SIZES =
  "(max-width: 760px) calc(100vw - 32px), calc(100vw - 88px)";
/** Narrow screens get a purpose-cut portrait of the hall (dome centred) —
 *  the landscape aerial survives no phone crop. Same photograph, one
 *  rendered image: the no-repeat law counts elements, not crops. */
export const FRESH_HERO_PORTRAIT_MEDIA = "(max-width: 760px)";
export const FRESH_HERO_PORTRAIT_SRCSET =
  "/images/venue/ladder/trades-hall-exterior-portrait-480.webp 480w, /images/venue/ladder/trades-hall-exterior-portrait-768.webp 768w";
export const FRESH_ROOM_SIZES = "(max-width: 760px) calc(100vw - 32px), 558px";
export const FRESH_HERITAGE_LADDER = [480, 768, 1120, 1448] as const;
export const FRESH_HERITAGE_SIZES = "(max-width: 980px) calc(100vw - 32px), 900px";

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
    ladder: [480, 768, 1120, 1535],
  },
  {
    slug: "saloon",
    name: "The Saloon",
    line: "Panelled walls and stained glass — made for speeches and toasts.",
    image: tradesHallVenueImages.saloon,
    alt: "The Saloon, stained-glass windows above panelled walls",
    width: 1535,
    height: 1025,
    ladder: [480, 768, 1120, 1535],
  },
  {
    slug: "reception-room",
    name: "The Reception Room",
    line: "Where an evening at Trades Hall begins.",
    image: tradesHallVenueImages.receptionRoom,
    alt: "The Reception Room dressed for a ceremony, candles along the aisle",
    width: 1536,
    height: 1024,
    ladder: [480, 768, 1120, 1536],
  },
  {
    slug: "robert-adam-room",
    name: "The Robert Adam Room",
    line: "The architect's own room, at its most intimate scale.",
    image: tradesHallVenueImages.robertAdamRoom,
    alt: "A bride mid-aisle at a ceremony in the Robert Adam Room",
    width: 1122,
    height: 1402,
    ladder: [480, 768, 1122],
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
export const FRESH_ARMS = "/images/brand/coat-of-arms-240.webp";
export const FRESH_ARMS_MARK = "/images/brand/coat-of-arms-mark-64.webp";
export const FRESH_ARMS_ALT = "The arms of the Trades House of Glasgow";
export const FRESH_MOTTO = "Union is strength";
export const FRESH_MOTTO_ATTR = "The motto of the Trades House of Glasgow";

export const FRESH_GALLERIES_NOTE =
  "The North and South Galleries seat forty each — quieter rooms for planning meetings, drinks, and green-room use.";

export const FRESH_RATES_TITLE = "Weddings, plainly priced";
export const FRESH_RATES_NOTE =
  "Rates below are for exclusive wedding use of the hall. For dinners, conferences, and everything else, ask — every event is quoted on its shape.";

/** The Enquiry Composer — the page answers with published fit, then writes
 *  the email. Sentences it composes live in enquiry-fit.ts, swept there. */
export const FRESH_ENQUIRY_TITLE = "Ask about a date";
export const FRESH_ENQUIRY_LEDE =
  "Tell the page your occasion and it will tell you the room, from the venue's own figures — then send the enquiry as written, or call.";
export const FRESH_ENQUIRY_EVENT_LABEL = "The occasion";
export const FRESH_ENQUIRY_GUESTS_LABEL = "Guests";
export const FRESH_ENQUIRY_DATE_LABEL = "The date, if you have one";
export const FRESH_ENQUIRY_GUESTS_PROMPT =
  "Tell us how many you are, and the rooms will sort themselves.";
export const FRESH_ENQUIRY_SEND = "Open in your email app";
export const FRESH_ENQUIRY_COPY_ACTION = "Copy the enquiry";
export const FRESH_ENQUIRY_COPIED = "Copied";
export const FRESH_ENQUIRY_OR_CALL = "or call";

/** Walk the room — the poster-first capture embed. The poster is a render
 *  of the captured scene (never one of the venue photographs, so the
 *  no-repeat law holds); the room itself loads only when invited. */
export const FRESH_WALK_TITLE = "Walk the room";
export const FRESH_WALK_LEDE =
  "The Reception Room, captured — rendered live in your browser, not a photograph. Step in, look around from where the scanner stood, and move a table with your own hands.";
export const FRESH_WALK_CHIP = "This is not a photograph.";
export const FRESH_WALK_WAKE = "Step in";
export const FRESH_WALK_SIZE_NOTE =
  "Loads the captured room — about 60 MB, best on wifi.";
export const FRESH_WALK_LOADING = "The room is arriving";
export const FRESH_WALK_HINT =
  "Drag to look around · drag the gold table to move it · arrow keys nudge · Esc steps out";
export const FRESH_WALK_FAILED =
  "The captured room couldn't open in this browser — the photographs above still tell the truth.";
export const FRESH_WALK_NOTE =
  "The same capture drives Venviewer, the planning tool beneath this page.";
export const FRESH_WALK_POSTER = "/images/venue/walk-poster-1120.webp";
export const FRESH_WALK_POSTER_SRCSET =
  "/images/venue/walk-poster-560.webp 560w, /images/venue/walk-poster-1120.webp 1120w";
export const FRESH_WALK_POSTER_SIZES = "(max-width: 980px) calc(100vw - 32px), 900px";
export const FRESH_WALK_POSTER_ALT =
  "The Reception Room as a captured scene, rendered by Venviewer — not a photograph";

/** The room dossiers — each card opens into the room's own page-within-
 *  the-page: published dimensions, and every capacity drawn to count. */
export const FRESH_DOSSIER_OPEN = "Open the room";
export const FRESH_DOSSIER_CLOSE = "Close";
export const FRESH_DOSSIER_CTA = "Ask about this room";
export const FRESH_DOSSIER_DRAWN_NOTE = "drawn to count";

export const FRESH_HERITAGE_TITLE = "The house of the trades";
export const FRESH_HERITAGE_BODY =
  "Trades Hall was designed by Robert Adam and has served as the meeting place of the Trades House of Glasgow — the city's fourteen incorporated crafts — since 1791. It is the oldest building in Glasgow still used for its original purpose. When you celebrate here, you are keeping its diary going.";

export const FRESH_CONTACT_TITLE = "Speak with the events team";
export const FRESH_CONTACT_TEL_LABEL = "Telephone";
export const FRESH_CONTACT_EMAIL_LABEL = "Email";
export const FRESH_CONTACT_VISIT_LABEL = "Visit";
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
    FRESH_CTA_TOUR,
    FRESH_TOUR_TITLE,
    FRESH_TOUR_LINE,
    FRESH_TOUR_CTA,
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
    FRESH_ENQUIRY_TITLE,
    FRESH_ENQUIRY_LEDE,
    FRESH_ENQUIRY_EVENT_LABEL,
    FRESH_ENQUIRY_GUESTS_LABEL,
    FRESH_ENQUIRY_DATE_LABEL,
    FRESH_ENQUIRY_GUESTS_PROMPT,
    FRESH_ENQUIRY_SEND,
    FRESH_ENQUIRY_COPY_ACTION,
    FRESH_ENQUIRY_COPIED,
    FRESH_ENQUIRY_OR_CALL,
    FRESH_DOSSIER_OPEN,
    FRESH_DOSSIER_CLOSE,
    FRESH_DOSSIER_CTA,
    FRESH_DOSSIER_DRAWN_NOTE,
    FRESH_WALK_TITLE,
    FRESH_WALK_LEDE,
    FRESH_WALK_CHIP,
    FRESH_WALK_WAKE,
    FRESH_WALK_SIZE_NOTE,
    FRESH_WALK_LOADING,
    FRESH_WALK_HINT,
    FRESH_WALK_FAILED,
    FRESH_WALK_NOTE,
    FRESH_WALK_POSTER_ALT,
    FRESH_HERITAGE_TITLE,
    FRESH_HERITAGE_BODY,
    FRESH_CONTACT_TITLE,
    FRESH_CONTACT_TEL_LABEL,
    FRESH_CONTACT_EMAIL_LABEL,
    FRESH_CONTACT_VISIT_LABEL,
    FRESH_ADDRESS,
    FRESH_THEME_LABEL,
    ...FRESH_THEME_OPTIONS.map((o) => o.label),
    FRESH_FOOTER_NOTE,
  ] as const;
}
