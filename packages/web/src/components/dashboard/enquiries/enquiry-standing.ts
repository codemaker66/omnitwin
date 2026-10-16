import { publishedRoomCapacity, TRADES_HALL_PUBLIC_PROFILE, type Booking, type RoomCapacity } from "@omnitwin/types";
import type { Enquiry } from "../../../api/enquiries.js";
import { BOARD_COPY } from "../../../pages/diary/board-copy.js";
import { formatInlineDay } from "../../../pages/diary/lib/board-time.js";
import { freeRoomsSaid, type DayAnswerLine, type DayAnswerRoom } from "../../../pages/diary/lib/day-answer.js";
import { HOLDABLE_ENQUIRY_STATES } from "../../../pages/diary/lib/enquiry-link.js";
import { ENQUIRY_EVENT_TYPES } from "../../../pages/fresh/enquiry-fit.js";
import { theRoom } from "../proposals/template-format.js";

// ---------------------------------------------------------------------------
// Where an enquiry stands in the Diary, in the panel's words (T-635, roadmap
// Tier A #4; docs/design/enquiry-day-answer-2026-10-13): the fact beside the
// date, guests and room, the In the Diary list, and what Approve says before
// the client is emailed. Pure: use-enquiry-day.ts brings the asked day's
// rooms and entries and the enquiry's own live bookings, and every state is
// worded here. A day's lines are the Diary's own (day-answer.ts), so a date
// reads the same here as on the board and in Find.
// ---------------------------------------------------------------------------

type Format = keyof RoomCapacity;

/** The published figure a room is read by for an occasion, as the public
 *  composer measures it: a wedding or a dinner seated for dinner, a
 *  conference theatre style, a drinks reception standing. Null for any other
 *  occasion, so no fit is guessed. */
export function occasionFormat(eventType: string | null): Format | null {
  const key = eventType?.trim().toLowerCase() ?? "";
  return ENQUIRY_EVENT_TYPES.find((type) => type.key === key)?.format ?? null;
}

const FIGURE_WORDS: Readonly<Record<Format, (count: number) => string>> = {
  dinner: (count) => `seats ${String(count)} for dinner`,
  theatre: (count) => `seats ${String(count)} theatre style`,
  classroom: (count) => `seats ${String(count)} classroom style`,
  reception: (count) => `holds ${String(count)} standing`,
};

const LIST = new Intl.ListFormat("en-GB", { style: "long", type: "conjunction" });

export interface StandingInput {
  readonly enquiry: Pick<Enquiry, "state" | "spaceId" | "roomChosen" | "estimatedGuests" | "eventType">;
  /** The day asked for, room by room in the Diary's words, with its bounds;
   *  null when no day is read (no date asked, or a closed enquiry). */
  readonly day: { readonly rooms: readonly DayAnswerRoom[]; readonly startMs: number; readonly endMs: number } | null;
  /** The enquiry's own live bookings. */
  readonly own: readonly Booking[];
  /** The venue's rooms by id: names for the enquiry's own bookings, slugs
   *  for the published figures. */
  readonly rooms: ReadonlyMap<string, { readonly name: string; readonly slug: string }>;
  /** The venue publishes its rooms' figures (Trades Hall's, confirmed by its
   *  team); another venue's rooms of the same name never borrow them. */
  readonly published: boolean;
  readonly nowMs: number;
}

export interface StandingLine {
  readonly key: string;
  readonly kind: DayAnswerLine["kind"];
  readonly text: string;
  /** The enquiry's own booking, marked "For this enquiry". */
  readonly own: boolean;
}

export interface StandingRoom {
  readonly id: string;
  readonly name: string;
  /** The room the guest asked for. */
  readonly asked: boolean;
  /** The room's published figure for the occasion: "seats 180 for dinner". */
  readonly figure: string | null;
  readonly free: boolean;
  readonly lines: readonly StandingLine[];
}

export interface EnquiryStanding {
  /** One fact, read at a glance: "Free · seats 60 for dinner". */
  readonly fact: string;
  /** How the fact is marked: free, taken, the enquiry's own, or nothing to mark. */
  readonly mark: "free" | "taken" | "own" | "none";
  /** What the panel's polite region says once the answer lands. */
  readonly said: string;
  /** The enquiry's own live bookings that the day's list does not show. */
  readonly elsewhere: readonly { readonly key: string; readonly text: string }[];
  /** The day asked for, room by room: the room asked for, the rooms that hold
   *  the guests, then the rest. Empty when no day was read. */
  readonly rooms: readonly StandingRoom[];
  /** What Approve says before the client is emailed. */
  readonly approve: string;
}

function byStart(a: Booking, b: Booking): number {
  return Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id);
}

/** A room said inside a sentence, "the Grand Hall"; one the Diary no longer
 *  lists, in the Diary's words. */
function roomPhrase(name: string | null): string {
  return name === null ? BOARD_COPY.decisions.roomUnknown : theRoom(name);
}

function sentenceStart(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/** A room's lines as one fact: the line itself, or several briefly, their
 *  titles left to the list: "2 bookings: Confirmed 08:00–11:00 · 1st option
 *  18:00–23:00, decides Tue 1 Dec". */
function roomSays(room: DayAnswerRoom, joiner: ": " | ", "): string {
  const [first] = room.lines;
  if (room.lines.length === 1 && first !== undefined) return first.text;
  const briefs = room.lines.map((line) => line.brief).join(" · ");
  const bookings = room.lines.every((line) => line.kind === "confirmed" || line.kind === "hold" || line.kind === "block");
  return bookings ? `${String(room.lines.length)} bookings${joiner}${briefs}` : briefs;
}

export function enquiryStanding(input: StandingInput): EnquiryStanding {
  const { enquiry, day, nowMs } = input;
  const open = HOLDABLE_ENQUIRY_STATES.includes(enquiry.state);
  const askedId = enquiry.roomChosen === false ? null : enquiry.spaceId;
  const guests = enquiry.estimatedGuests !== null && enquiry.estimatedGuests > 0 ? enquiry.estimatedGuests : null;
  const format = occasionFormat(enquiry.eventType);
  const nameOf = (roomId: string): string | null => input.rooms.get(roomId)?.name ?? null;
  const figureOf = (roomId: string): number | null => {
    const slug = input.rooms.get(roomId)?.slug;
    if (!input.published || format === null || slug === undefined) return null;
    return publishedRoomCapacity(TRADES_HALL_PUBLIC_PROFILE, slug)?.[format] ?? null;
  };

  // The enquiry's own bookings, in the Diary's hold words.
  const ownIds = new Set(input.own.map((booking) => booking.id));
  const own = [...input.own].sort(byStart);
  const place = (booking: Booking): string => booking.kind === "ink" ? BOARD_COPY.goTo.places.confirmed
    : booking.kind === "prospect" ? "Interest only"
      : booking.kind === "internal_block" ? BOARD_COPY.goTo.places.block
        : BOARD_COPY.decisions.option(booking.rank, booking.jointFlag);
  const decision = (booking: Booking): string => {
    if (booking.kind !== "hold" || booking.decisionAt === null) return "";
    const decisionMs = Date.parse(booking.decisionAt);
    return `, ${BOARD_COPY.goTo.decision(formatInlineDay(decisionMs, nowMs), decisionMs < nowMs)}`;
  };
  const dayOf = (booking: Booking): string => formatInlineDay(Date.parse(booking.startsAt), nowMs);
  const ownElsewhere = (booking: Booking): string =>
    `${place(booking)} for this enquiry: ${nameOf(booking.spaceId) ?? BOARD_COPY.decisions.roomUnknown}, ${dayOf(booking)}${decision(booking)}`;

  const askedRoom = askedId === null ? undefined : day?.rooms.find((room) => room.id === askedId);
  const shownIn = (room: DayAnswerRoom | undefined, bookingId: string): boolean =>
    room?.lines.some((line) => line.bookingId === bookingId) ?? false;
  const shownAnywhere = (bookingId: string): boolean => day?.rooms.some((room) => shownIn(room, bookingId)) ?? false;
  const startsOnDay = (booking: Booking): boolean => day !== null
    && Date.parse(booking.startsAt) >= day.startMs && Date.parse(booking.startsAt) < day.endMs;
  // In the room asked for, that day: shown among its lines, or behind what
  // holds it (a hold behind a confirmed booking, or interest only).
  const here = askedId === null || day === null ? [] : own.filter((booking) => booking.spaceId === askedId
    && (shownIn(askedRoom, booking.id) || startsOnDay(booking)));
  const upcoming = own.filter((booking) => Date.parse(booking.endsAt) > nowMs);
  const lead = here.find((booking) => shownIn(askedRoom, booking.id)) ?? here[0] ?? upcoming[0] ?? own[own.length - 1];
  const more = own.length > 1 ? ` · ${String(own.length - 1)} more below` : "";

  // The day, room by room: the room asked for, the rooms that hold the
  // guests, then the rest, each in the Diary's order.
  const holdsGuests = (roomId: string): boolean => {
    const figure = figureOf(roomId);
    return guests !== null && figure !== null && figure >= guests;
  };
  const rank = (room: DayAnswerRoom): number => room.id === askedId ? 0 : holdsGuests(room.id) ? 1 : 2;
  const rooms: StandingRoom[] = (day?.rooms ?? [])
    .map((room, index) => ({ room, index }))
    .sort((a, b) => rank(a.room) - rank(b.room) || a.index - b.index)
    .map(({ room }) => {
      const figure = figureOf(room.id);
      return {
        id: room.id,
        name: room.name,
        asked: room.id === askedId,
        figure: figure === null || format === null ? null : FIGURE_WORDS[format](figure),
        free: room.free,
        lines: room.lines.map((line) => ({
          key: line.key, kind: line.kind, text: line.text, own: line.bookingId !== null && ownIds.has(line.bookingId),
        })),
      };
    });
  const elsewhere = own.filter((booking) => !shownAnywhere(booking.id))
    .map((booking) => ({ key: booking.id, text: ownElsewhere(booking) }));

  const standing = (fact: string, mark: EnquiryStanding["mark"], approve: string): EnquiryStanding =>
    ({ fact, mark, said: `In the Diary: ${fact}.`, elsewhere, rooms, approve });

  // A closed enquiry reads no day; it says only what it still holds.
  if (!open) {
    if (lead === undefined) return standing("Nothing held for this enquiry", "none", "");
    return standing(
      `Still held for this enquiry: ${place(lead)}, ${nameOf(lead.spaceId) ?? BOARD_COPY.decisions.roomUnknown}, ${dayOf(lead)}${more}`,
      "own", "",
    );
  }

  // The enquiry's own booking leads, wherever it is.
  if (lead !== undefined) {
    const leadRoom = roomPhrase(nameOf(lead.spaceId));
    if (here.includes(lead) && askedRoom !== undefined) {
      const askedPhrase = roomPhrase(askedRoom.name);
      if (shownIn(askedRoom, lead.id)) {
        return standing(`${place(lead)} for this enquiry${decision(lead)}${more}`, "own",
          `The Diary holds ${askedPhrase} for this enquiry: ${place(lead)}${decision(lead)}.`);
      }
      if (askedRoom.free) {
        return standing(`${place(lead)} for this enquiry · ${roomSays(askedRoom, ": ")}${more}`, "own",
          `${sentenceStart(askedPhrase)} is free that day; this enquiry has ${place(lead).toLowerCase()} there. The email does not mention it.`);
      }
      const ahead = askedRoom.lines[0]?.text ?? "";
      return standing(`${place(lead)} for this enquiry, behind ${ahead}${more}`, "own",
        `That day the Diary has ${askedPhrase}: ${ahead}. This enquiry is held behind it (${place(lead)}). The email does not mention it.`);
    }
    const sameDay = day !== null && (shownAnywhere(lead.id) || startsOnDay(lead));
    const approve = sameDay
      ? askedId === null
        ? `The Diary holds ${leadRoom} for this enquiry that day: ${place(lead)}${decision(lead)}.`
        : `The Diary holds ${leadRoom} for this enquiry that day (${place(lead)}), not ${roomPhrase(nameOf(askedId))}, which the email names.`
      : day === null
        ? `The Diary holds ${leadRoom} on ${dayOf(lead)} for this enquiry: ${place(lead)}${decision(lead)}.`
        : `The Diary holds ${leadRoom} on ${dayOf(lead)} for this enquiry (${place(lead)}), not the date the email names.`;
    return standing(`${ownElsewhere(lead)}${more}`, "own", approve);
  }

  if (day === null) return standing("No date to look up", "none", "No date was given, so the Diary was not read.");

  // The room asked for, that day.
  if (askedId !== null) {
    if (askedRoom === undefined) {
      return standing("The room asked for is not in the Diary", "none",
        "The room asked for is not in the Diary, so this does not say whether it is free.");
    }
    const askedPhrase = roomPhrase(askedRoom.name);
    if (askedRoom.free) {
      const figure = figureOf(askedRoom.id);
      const small = format !== null && guests !== null && figure !== null && figure < guests ? FIGURE_WORDS[format](figure) : null;
      return standing(`${roomSays(askedRoom, ": ")}${small === null ? "" : ` · ${small}`}`, "free",
        `${sentenceStart(askedPhrase)} is free that day${small === null ? "" : ` and ${small}`}. Nothing holds it for this enquiry yet.`);
    }
    return standing(roomSays(askedRoom, ": "), "taken",
      `That day the Diary has ${askedPhrase}: ${roomSays(askedRoom, ", ")}. The email does not mention it.`);
  }

  // No room chosen: the rooms that hold the guests and are free, or, without
  // a guest count or a format, how many rooms are free.
  if (guests !== null && format !== null && input.published) {
    const seats = FIGURE_WORDS[format](guests);
    const fitting = day.rooms.filter((room) => holdsGuests(room.id));
    const free = fitting.filter((room) => room.free).map((room) => room.name);
    if (fitting.length === 0) {
      return standing(`No room ${seats}`, "taken", `No room was chosen, and no room ${seats}. The email does not mention it.`);
    }
    if (free.length === 0) {
      return standing(`No room that ${seats} is free`, "taken",
        `No room was chosen. No room that ${seats} is free that day. The email does not mention it.`);
    }
    return standing(`Free and ${seats}: ${LIST.format(free)}`, "free",
      `No room was chosen. Free that day and ${seats}: ${LIST.format(free)}.`);
  }
  const count = freeRoomsSaid(day.rooms, true);
  const anyFree = day.rooms.some((room) => room.free);
  return standing(count, anyFree ? "free" : "taken", `No room was chosen. ${count} that day.`);
}

/** What Approve says when the Diary could not be read for the enquiry. */
export function approveUnread(enquiry: Pick<Enquiry, "roomChosen" | "preferredDate">, askedName: string | null): string {
  if (enquiry.preferredDate === null) return "The Diary could not be read, so this does not say what it holds for this enquiry.";
  if (enquiry.roomChosen === false) return "The Diary could not be read, so this does not say which rooms are free that day.";
  return `The Diary could not be read, so this does not say whether ${askedName === null ? "the room" : theRoom(askedName)} is free.`;
}
