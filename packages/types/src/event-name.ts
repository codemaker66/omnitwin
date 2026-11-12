import { occasionLabel } from "./occasion.js";
import { resolveRotaTimeZone } from "./staff-rota-checks.js";

// ---------------------------------------------------------------------------
// What an event is called (the release lead's ruling of 12 November 2026 on
// #397). An event made for a booking takes the booking's title. A booking can
// have no usable title: rows written before #350 took a public enquiry's
// blank name as their title, so they hold "" or the bare " — <occasion>" the
// enquiry conversion then made of it. Such an event is called by its occasion
// and the venue's own day of its start: "Wedding, 14 March 2027", or "Event,
// 14 March 2027" when there is no occasion.
//
// Only what is known about the event is used, never the enquiry's email or
// anyone's name: the event's name travels to the client, the hallkeeper's
// sheet, supplier passes and notifications. A title holding an email address
// counts as no title, when an event is named and when it is shown, so an
// event already stored as "<email> — Wedding" (a guest who gave no name is
// filed under their email) shows as "Wedding, <day>" with no migration.
//
// The wording is the release lead's default and the owner's to change: it is
// written here and nowhere else. The API names a new event with it
// (createEventFor), and every screen that shows an event stored without a
// name shows this one, for display only.
// ---------------------------------------------------------------------------

/** What an event is called when there is no occasion to call it by. */
const NO_OCCASION = "Event";

/** An event's name is at most this long (events.name, CreateEventSchema). */
const MAX_EVENT_NAME_LENGTH = 200;

/** The bare " — <occasion>" an enquiry with a blank name gave a title before
 *  #350: a dash with nothing before it (em dash as written; an en dash or a
 *  hyphen as somebody may type it). */
const BARE_OCCASION_TITLE = /^[—–-]\s*(.*)$/su;

/** An email address anywhere in a title. A guest who gave no name is filed
 *  under their email, and the hold made for them is titled by it ("<email> —
 *  Wedding"); a title holding an address says who asked, never what the event
 *  is, so it counts as no title. */
const EMAIL_ADDRESS = /[^\s@<>()]+@[^\s@<>()]+\.[A-Za-z]{2,}/gu;

const dayFormats = new Map<string, Intl.DateTimeFormat>();

/** "14 March 2027": the calendar day of an instant on the venue's clock. A
 *  stored zone no clock knows is read as the house's, as the rota reads it
 *  (resolveRotaTimeZone), so naming an event never throws: the name is made
 *  inside the Diary's read, the room's timeline and a booking's save. */
function venueDay(startsAt: Date | string | null, timeZone: string): string | null {
  if (startsAt === null) return null;
  const instant = typeof startsAt === "string" ? Date.parse(startsAt) : startsAt.getTime();
  if (!Number.isFinite(instant)) return null;
  let format = dayFormats.get(timeZone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat("en-GB", { timeZone: resolveRotaTimeZone(timeZone), day: "numeric", month: "long", year: "numeric" });
    dayFormats.set(timeZone, format);
  }
  return format.format(instant);
}

export interface EventNameInput {
  /** The booking's title, or the event's stored name. */
  readonly title: string;
  /** The occasion, as stored: a slug ("wedding") or as typed. */
  readonly eventType: string | null | undefined;
  /** When the event starts; its day names it. */
  readonly startsAt: Date | string | null;
  /** The venue's IANA time zone, whose calendar the day is read on. */
  readonly timeZone: string;
}

/**
 * The name a person reads for an event: the title, trimmed, when it says
 * something and holds no email address; otherwise "<Occasion>, <the venue's
 * day>" ("Wedding, 14 March 2027"), "Event, …" with no occasion, and the
 * occasion alone when the event has no start. The occasion is the event's
 * own, else the one a title's " — <occasion>" names.
 */
export function eventNameFor(input: EventNameInput): string {
  const title = input.title.trim();
  // What the title says once any address is taken out of it.
  const said = title.replace(EMAIL_ADDRESS, "").trim();
  const bare = BARE_OCCASION_TITLE.exec(said);
  if (said === title && title !== "" && bare === null) return title.slice(0, MAX_EVENT_NAME_LENGTH);
  const fromTitle = bare?.[1]?.trim() ?? "";
  const occasion = occasionLabel(input.eventType) ?? (fromTitle === "" ? NO_OCCASION : fromTitle);
  const day = venueDay(input.startsAt, input.timeZone);
  return (day === null ? occasion : `${occasion}, ${day}`).slice(0, MAX_EVENT_NAME_LENGTH);
}

/** The fields of a stored event its shown name is made from. */
export interface NamedEvent {
  readonly name: string;
  readonly eventType: string | null;
  readonly startsAt: Date | string | null;
}

/**
 * The name to show for a stored event: its own, or eventNameFor's when it was
 * stored without one. For display only: the stored name stays as it is (reads
 * carry it as stored), and only a person gives the event a name.
 */
export function eventDisplayName(event: NamedEvent, timeZone: string): string {
  return eventNameFor({ title: event.name, eventType: event.eventType, startsAt: event.startsAt, timeZone });
}
