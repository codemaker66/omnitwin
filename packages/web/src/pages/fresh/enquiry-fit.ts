import {
  TRADES_HALL_ROOM_CAPACITIES,
  TRADES_HALL_WEDDING_PRICING,
  formatPriceGBP,
  type PublishedRoomSlug,
  type RoomCapacity,
} from "../../lib/trades-hall-venue-truth.js";

// -----------------------------------------------------------------------------
// enquiry-fit — the thinking half of the Enquiry Composer.
//
// Pure functions only: given an event shape, answer with room fit using the
// venue's published capacities, and compose the enquiry text. Every figure
// comes from trades-hall-venue-truth; every sentence template here is swept
// by the claim guard in the tests, including composed outputs. No
// availability claims — fit is arithmetic on published numbers, nothing more.
// -----------------------------------------------------------------------------

export type EnquiryEventKey = "wedding" | "dinner" | "conference" | "reception";

export interface EnquiryEventType {
  readonly key: EnquiryEventKey;
  readonly label: string;
  /** Which published capacity format this event is measured against. */
  readonly format: keyof RoomCapacity;
  /** Reads naturally after a number: "120 seated for dinner". */
  readonly formatPhrase: string;
}

export const ENQUIRY_EVENT_TYPES: readonly EnquiryEventType[] = [
  {
    key: "wedding",
    label: "Wedding",
    format: "dinner",
    formatPhrase: "seated for the wedding breakfast",
  },
  { key: "dinner", label: "Dinner", format: "dinner", formatPhrase: "seated for dinner" },
  {
    key: "conference",
    label: "Conference",
    format: "theatre",
    formatPhrase: "seated theatre style",
  },
  {
    key: "reception",
    label: "Drinks reception",
    format: "reception",
    formatPhrase: "standing with drinks",
  },
] as const;

/** Display names for every published room — the four photographed rooms use
 *  the same names as their cards; the galleries are named as the venue does. */
export const ENQUIRY_ROOM_NAMES: Readonly<Record<PublishedRoomSlug, string>> = {
  "grand-hall": "The Grand Hall",
  saloon: "The Saloon",
  "robert-adam-room": "The Robert Adam Room",
  "reception-room": "The Reception Room",
  "north-gallery": "The North Gallery",
  "south-gallery": "The South Gallery",
} as const;

const ROOM_ORDER = Object.keys(ENQUIRY_ROOM_NAMES) as readonly PublishedRoomSlug[];

export interface RoomFit {
  readonly slug: PublishedRoomSlug;
  readonly name: string;
  readonly capacity: number;
  readonly fits: boolean;
}

export interface FitReport {
  readonly eventType: EnquiryEventType;
  readonly guests: number;
  /** Every room with its published capacity for this format, venue order. */
  readonly rooms: readonly RoomFit[];
  /** The snuggest room that fits — smallest adequate capacity, venue order
   *  breaking ties. Null when no single room holds the number. */
  readonly suggestion: RoomFit | null;
  /** The other rooms that also fit, beyond the suggestion. */
  readonly alsoFits: readonly RoomFit[];
  /** The largest published capacity for this format, for honest overflow. */
  readonly largest: RoomFit;
}

export function fitReport(eventKey: EnquiryEventKey, guestsRaw: number): FitReport {
  const eventType =
    ENQUIRY_EVENT_TYPES.find((t) => t.key === eventKey) ?? ENQUIRY_EVENT_TYPES[0];
  if (eventType === undefined) throw new Error("no enquiry event types defined");
  const guests = Math.max(1, Math.round(guestsRaw));
  const rooms: RoomFit[] = ROOM_ORDER.map((slug) => {
    const capacity = TRADES_HALL_ROOM_CAPACITIES[slug][eventType.format];
    return { slug, name: ENQUIRY_ROOM_NAMES[slug], capacity, fits: capacity >= guests };
  });
  const fitting = [...rooms]
    .filter((room) => room.fits)
    .sort((a, b) => a.capacity - b.capacity);
  const suggestion = fitting[0] ?? null;
  const alsoFits = fitting.slice(1);
  const largest = rooms.reduce((top, room) => (room.capacity > top.capacity ? room : top));
  return { eventType, guests, rooms, suggestion, alsoFits, largest };
}

/** One sentence answering the visitor's numbers, from published figures. */
export function fitSentence(report: FitReport): string {
  const { eventType, guests, suggestion, largest } = report;
  const who = `${String(guests)} ${eventType.formatPhrase}`;
  if (suggestion === null) {
    return `For ${who}, no single room reaches that number — ${largest.name} is the largest published at ${String(largest.capacity)}. Speak with the team about larger evenings.`;
  }
  if (suggestion.capacity === guests) {
    return `For ${who}, ${suggestion.name} holds exactly your number — published capacity ${String(suggestion.capacity)}.`;
  }
  return `For ${who}, ${suggestion.name} is the right scale — published capacity ${String(suggestion.capacity)}.`;
}

/** The quieter second line: what else would hold them. Empty when nothing. */
export function alsoFitsSentence(report: FitReport): string {
  if (report.alsoFits.length === 0) return "";
  const names = report.alsoFits.map((r) => `${r.name} (${String(r.capacity)})`);
  const list =
    names.length === 1
      ? (names[0] ?? "")
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1] ?? ""}`;
  return `${list} would also hold you.`;
}

/** Published wedding room-hire band for the chosen year, or null when the
 *  venue has published no rates that far out — never extrapolate. */
export function weddingRateLine(year: number | null): string | null {
  if (year === null) return null;
  const season = TRADES_HALL_WEDDING_PRICING.seasons.find((s) =>
    s.years === "2027/28" ? year === 2027 || year === 2028 : s.years === String(year),
  );
  if (season === undefined) return null;
  const prices = season.rates.map((r) => r.priceGBP);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return `Published ${season.years} wedding room hire runs ${formatPriceGBP(min)}–${formatPriceGBP(max)} by package.`;
}

/** Wedding packages are published for up to 180 guests — say so when asked
 *  for more, rather than letting the rate line imply otherwise. */
export function weddingScopeNote(guests: number): string | null {
  return guests > 180
    ? "Published wedding packages cover up to 180 guests — beyond that, talk to the team."
    : null;
}

export interface EnquiryDraft {
  readonly eventKey: EnquiryEventKey;
  readonly guests: number;
  /** ISO date (yyyy-mm-dd) from the date input, or empty when undecided. */
  readonly dateISO: string;
}

export function prettyEnquiryDate(dateISO: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO);
  if (match === null) return null;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "long" }).format(date);
}

export function enquiryYear(dateISO: string): number | null {
  const match = /^(\d{4})-/.exec(dateISO);
  return match === null ? null : Number(match[1]);
}

export interface ComposedEnquiry {
  readonly subject: string;
  readonly body: string;
  readonly mailtoHref: string;
}

/** The enquiry, written out — visible on the page, copyable, and openable
 *  in the visitor's own mail app. The email address is the venue's real one. */
export function composeEnquiry(draft: EnquiryDraft, email: string): ComposedEnquiry {
  const report = fitReport(draft.eventKey, draft.guests);
  const when = prettyEnquiryDate(draft.dateISO);
  const subject = `Enquiry — ${report.eventType.label} for ${String(report.guests)}${
    when === null ? "" : `, ${when}`
  }`;
  const roomLine =
    report.suggestion === null
      ? "We know we're beyond a single room's published capacity and would value your advice."
      : `${report.suggestion.name} looks the right scale for our numbers.`;
  const body = [
    "Hello,",
    "",
    `We're considering Trades Hall for a ${report.eventType.label.toLowerCase()} — ${String(
      report.guests,
    )} guests, ${when === null ? "date still open" : `on ${when}`}.`,
    roomLine,
    "",
    "Could you tell us about availability and next steps?",
    "",
    "Thank you,",
  ].join("\n");
  const mailtoHref = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return { subject, body, mailtoHref };
}

/** Everything this module can say, for the page's claim-guard sweep —
 *  static labels plus composed samples across the fit boundaries. */
export function allEnquiryFitCopy(): readonly string[] {
  const samples: string[] = [];
  for (const type of ENQUIRY_EVENT_TYPES) {
    for (const guests of [2, 40, 60, 61, 120, 180, 250, 400]) {
      const report = fitReport(type.key, guests);
      samples.push(fitSentence(report), alsoFitsSentence(report));
      const composed = composeEnquiry(
        { eventKey: type.key, guests, dateISO: "2027-03-14" },
        "someone@example.com",
      );
      samples.push(composed.subject, composed.body);
    }
  }
  const rateLines = [2026, 2027, 2028]
    .map((year) => weddingRateLine(year))
    .filter((line): line is string => line !== null);
  const scopeNote = weddingScopeNote(200);
  return [
    ...Object.values(ENQUIRY_ROOM_NAMES),
    ...ENQUIRY_EVENT_TYPES.flatMap((t) => [t.label, t.formatPhrase]),
    ...samples.filter((s) => s !== ""),
    ...rateLines,
    ...(scopeNote === null ? [] : [scopeNote]),
  ];
}
