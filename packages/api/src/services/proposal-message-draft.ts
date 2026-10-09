import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import {
  moneyWords,
  occasionLabel,
  rotaLocalDate,
  type CanonicalJsonValue,
  type ProposalMessageDraft,
  type ProposalMessageDraftQuote,
} from "@omnitwin/types";
import {
  bookings,
  contacts,
  enquiries,
  opportunities,
  proposalComments,
  proposalStatusHistory,
  proposalVersions,
  proposals,
  spaces,
  venues,
} from "../db/schema.js";
import type { Database } from "../db/client.js";
import { clientEvent } from "./proposal-taken.js";

// ---------------------------------------------------------------------------
// What the AI is told of a proposal to draft its message to the client
// (roadmap X1, "Use in proposal"): the event as the venue holds it, the
// client's name, the client's words from their enquiry and their latest
// words on the proposal since it was last sent (a change they asked for, not
// one a version sent since has answered). With a quote from the composer, the
// figures the coordinator is about to send, it is told that quote and the
// one the client last saw; and it is told the diary's holds for the client's
// enquiry, in the diary's own words ("Provisional · 1st option", until its
// decision date). Everything but the composer's quote is built here, at the
// proposal's own venue, so nothing of another venue's or another client's
// can be sent. It carries no id and no email address or phone number: a name
// holding either (a public enquiry sent without a name stores its email as
// the name) is left out, and contact details in the client's words, the
// occasion and the quote's lines are taken out. Anything else the client
// typed (a date, a budget) goes as written. A part with nothing in it is
// left out rather than sent empty, so a proposal without a quote or a hold
// is told exactly what it was told before either was added.
// ---------------------------------------------------------------------------

/** The longest part of the client's words passed on: enough for the draft to
 *  answer what they asked, without sending a long thread. */
export const MAX_CLIENT_NOTES_LENGTH = 2000;

/** The most holds passed on: a client holding more dates than this is rare,
 *  and the earliest are the ones in play. */
export const MAX_HOLDS_TOLD = 10;

type DraftFrom = Pick<typeof proposals.$inferSelect, "id" | "venueId" | "opportunityId" | "enquiryId" | "configurationId" | "sentVersion">;

export interface MessageDraftContext {
  readonly context: Record<string, CanonicalJsonValue>;
  /** What the AI is given to draw on, so the screen claims only that. */
  readonly drewOn: ProposalMessageDraft["drewOn"];
}

const EMAIL = /[^\s@<>()[\]]+@[^\s@<>()[\]]+\.[^\s@<>()[\].,;:!?]+/gu;

// Characters that read as others when finding numbers: wide and non-breaking
// spaces as spaces, hyphen, minus and figure-dash variants as hyphens, and
// full-width and Arabic-Indic digits as digits. Nothing else is changed, so
// "1½ hours" and "m²" reach the AI as the client wrote them.
const AS_SPACE = /[\u00a0\u2000-\u200a\u202f\u205f\u3000]/gu;
const AS_HYPHEN = /[\u2010\u2011\u2012\u2212\ufe63\uff0d]/gu;

function plain(text: string): string {
  return text
    .replace(AS_SPACE, " ")
    .replace(AS_HYPHEN, "-")
    .replace(/[\uff10-\uff19]/gu, (digit) => String(digit.charCodeAt(0) - 0xff10))
    .replace(/[\u0660-\u0669]/gu, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/gu, (digit) => String(digit.charCodeAt(0) - 0x06f0));
}

// Phone numbers are found as people write them. A run of digits and the marks
// numbers are written with (spaces and tabs, dots, dashes, slashes,
// brackets), on one line, is split where one number may end and another
// begin; a date, a date range or a time in it is kept; a part is a phone
// number when it holds ten digits or more, or nine from "+", a bracket or a
// leading 0; and a part too short alone, starting like a phone number and not
// a date or time, takes in up to four parts after it while together they hold
// at most fifteen digits (no phone number holds more), so the work stays in
// proportion to the text. So "0141 552 1234 / 07700 900123" is two numbers,
// "0141 - 552 - 1234", "(+353) 87 123 4567" and "06.12.34.56.78" are one
// each, and "12.06.2027 19.30", "0930 - 1700 - 2200", "15000-20000" and
// "(150 guests)" are none.
const NUMBER_RUN = /(?<![\d+(])[+(]{0,2}\d(?:[\d \t().\-\u2013\u2014/]*[\d)])?/gu;
const NUMBER_BREAK = /(\s+\/\s+|\s{2,}|\s+[-\u2013\u2014]\s+|\s+(?=\()|(?<=\))\s+)/u;
const DATE_OR_TIME = new RegExp(
  "((?<![\\d./:-])(?:"
    + "\\d{1,2}(?:[./]\\d{1,2}(?:[./]\\d{2,4})?)?[-\\u2013]\\d{1,2}[./]\\d{1,2}[./](?:\\d{4}|\\d{2})"
    + "|\\d{1,2}[./-]\\d{1,2}[./-](?:\\d{4}|\\d{2})"
    + "|\\d{4}-\\d{2}-\\d{2}"
    + "|\\d{1,2}[.:]\\d{2}"
    + ")(?![./:-]?\\d))",
  "u",
);
const PHONE_START = /^\(?\+|^[+(]?0/u;
// Where a number written in parts may start: as above, or a closed bracketed
// area code ("(415) 555-0123"), never a bare bracket ("(15000 - 20000)").
const CHAIN_START = /^\(?\+|^[+(]?0|^\(\d{2,5}\)$/u;
// A time of day written as four figures or with a dot or colon ("0930", "19.30").
const TIME_LIKE = /^(?:[01]\d|2[0-3])[0-5]\d$|^\d{1,2}[.:]\d{2}$/u;
// A country code or "(0)" that a whole number after it belongs with.
const NUMBER_PREFIX = /^(?:\(?\+\d{1,3}\)?|\(0\))(?:\s*\(0\))?$/u;
const AMOUNT_RANGE = /^([1-9]\d{2,6})\s?[-\u2013\u2014]\s?([1-9]\d{2,6})$/u;
const MOST_PHONE_DIGITS = 15;
const MOST_PHONE_PARTS = 5;

function digitsIn(text: string): number {
  return text.replace(/\D/gu, "").length;
}

/** Two amounts of about the same size joined by a dash ("15000-20000"): a range. */
function amountRange(text: string): boolean {
  const range = AMOUNT_RANGE.exec(text);
  return range !== null && Math.abs((range[1] ?? "").length - (range[2] ?? "").length) <= 1;
}

function phoneShaped(text: string): boolean {
  const trimmed = text.trim();
  if (amountRange(trimmed)) return false;
  const digits = digitsIn(trimmed);
  return digits >= 10 || (digits === 9 && PHONE_START.test(trimmed));
}

/** One written number, its dates and times kept and the rest replaced when
 *  it is a phone number. */
function scrubNumber(part: string): string {
  return part.split(DATE_OR_TIME).map((piece, index) => {
    if (index % 2 === 1 || !phoneShaped(piece)) return piece;
    const lead = /^\s*/u.exec(piece)?.[0] ?? "";
    const trail = /\s*$/u.exec(piece)?.[0] ?? "";
    return `${lead}(phone number)${trail}`;
  }).join("");
}

function scrubRun(found: string): string {
  // A closing bracket the run did not open belongs to the words around it.
  const unopened = found.endsWith(")") && (found.match(/\)/gu) ?? []).length > (found.match(/\(/gu) ?? []).length;
  const run = unopened ? found.slice(0, -1) : found;
  const pieces = run.split(NUMBER_BREAK);
  const parts: string[] = [];
  const breaks: string[] = [];
  pieces.forEach((piece, index) => { (index % 2 === 0 ? parts : breaks).push(piece); });
  const out: string[] = [];
  let at = 0;
  while (at < parts.length) {
    const part = parts[at] ?? "";
    const alone = scrubNumber(part);
    if (alone === part && CHAIN_START.test(part.trim()) && !DATE_OR_TIME.test(part)) {
      let text = part;
      let end = at;
      let digits = digitsIn(part);
      while (end + 1 < parts.length && end - at + 1 < MOST_PHONE_PARTS && !/\//u.test(breaks[end] ?? "")) {
        const next = parts[end + 1] ?? "";
        // A number already whole joins only the country code or "(0)" before it.
        if (scrubNumber(next) !== next && !NUMBER_PREFIX.test(text.trim())) break;
        digits += digitsIn(next);
        if (digits > MOST_PHONE_DIGITS) break;
        text = `${text}${breaks[end] ?? ""}${next}`;
        end += 1;
        if (scrubNumber(text) !== text) break;
      }
      // Times joined by dashes are a timetable, not a number ("0930 - 1700 - 2200").
      const times = parts.slice(at, end + 1).every((piece) => TIME_LIKE.test(piece.trim()));
      const joined = scrubNumber(text);
      if (end > at && joined !== text && !times) {
        out.push(joined, breaks[end] ?? "");
        at = end + 1;
        continue;
      }
    }
    out.push(alone, breaks[at] ?? "");
    at += 1;
  }
  return `${out.join("")}${unopened ? ")" : ""}`;
}

function scrub(text: string | null | undefined): string {
  return plain(text ?? "").replace(EMAIL, "(email address)").replace(NUMBER_RUN, scrubRun).trim();
}

/** The client's words with any email address or phone number taken out,
 *  trimmed and cut to length; null when nothing is left. */
export function clientWords(text: string | null | undefined): string | null {
  const scrubbed = scrub(text);
  if (scrubbed === "") return null;
  return scrubbed.length > MAX_CLIENT_NOTES_LENGTH ? `${scrubbed.slice(0, MAX_CLIENT_NOTES_LENGTH)}…` : scrubbed;
}

/** Free text with any email address or phone number taken out by the same
 *  scrub as the client's words, nothing cut, and whether anything was taken
 *  out: for a planner's description of an event before an AI reads it
 *  (T-650). */
export function scrubContactDetails(text: string): { readonly text: string; readonly removed: boolean } {
  const scrubbed = scrub(text);
  return { text: scrubbed, removed: scrubbed !== plain(text).trim() };
}

/** The first name given that is a name: one holding an email address or a
 *  phone number is not. */
function nameOf(...candidates: readonly (string | null | undefined)[]): string | null {
  for (const candidate of candidates) {
    const name = candidate?.trim() ?? "";
    if (name !== "" && !name.includes("@") && scrub(name) === plain(name).trim()) return name;
  }
  return null;
}

export interface QuoteLineIn { readonly description: string; readonly quantity: number; readonly unitAmountMinor: number }

/** A quote as the client reads it: each line's words (contact details taken
 *  out), how many, the price of one and of all, and the total, in the quote's
 *  money. Totals are worked out in whole pence; a line too long is cut. The
 *  evaluation builds its cases' quotes with it too. */
export function quoteWords(currency: string, lines: readonly QuoteLineIn[]): Record<string, CanonicalJsonValue> {
  let total = 0;
  const told = lines.map((line) => {
    const lineTotal = line.quantity * line.unitAmountMinor;
    total += lineTotal;
    return {
      description: scrub(line.description).slice(0, MAX_CLIENT_NOTES_LENGTH),
      quantity: line.quantity,
      unitPrice: moneyWords(line.unitAmountMinor, currency),
      lineTotal: moneyWords(lineTotal, currency),
    };
  });
  return { lines: told, total: moneyWords(total, currency) };
}

function ordinal(rank: number): string {
  const tens = rank % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : rank % 10 === 1 ? "st" : rank % 10 === 2 ? "nd" : rank % 10 === 3 ? "rd" : "th";
  return `${String(rank)}${suffix}`;
}

/** A hold's standing in the diary's words, as its reminders say it:
 *  "Provisional · 1st option", "Provisional · Joint 1st", "Provisional", or
 *  "Confirmed" for a booking in ink. The evaluation words its cases' holds
 *  with it too. */
export function standingWords(kind: string, rank: number | null, jointFlag: boolean): string {
  if (kind === "ink") return "Confirmed";
  if (rank === null) return "Provisional";
  if (rank === 1 && jointFlag) return "Provisional · Joint 1st";
  return `Provisional · ${ordinal(rank)} option`;
}

/** A hold as the diary holds it, its dates already in the venue's calendar. */
export interface HoldIn {
  readonly date: string;
  readonly room: string;
  readonly kind: string;
  readonly rank: number | null;
  readonly jointFlag: boolean;
  readonly heldUntil: string | null;
}

/** A hold as the AI is told it: the date and room, its standing in the
 *  diary's words and, for a hold, the date it is held until. The evaluation
 *  words its cases' holds with it too. */
export function holdWords(hold: HoldIn): Record<string, CanonicalJsonValue> {
  return {
    date: hold.date,
    room: hold.room,
    standing: standingWords(hold.kind, hold.rank, hold.jointFlag),
    ...(hold.kind === "hold" && hold.heldUntil !== null ? { heldUntil: hold.heldUntil } : {}),
  };
}

/** The diary's live holds and confirmed bookings for one enquiry at the
 *  venue: the date and room each holds, its standing and, for a hold, the
 *  date it is held until, in the venue's own calendar. */
async function holdsFor(db: Database, venueId: string, enquiryId: string): Promise<Record<string, CanonicalJsonValue>[]> {
  const [venue] = await db.select({ timezone: venues.timezone }).from(venues).where(eq(venues.id, venueId)).limit(1);
  const timeZone = venue?.timezone ?? "Europe/London";
  const rows = await db.select({
    kind: bookings.kind,
    rank: bookings.rank,
    jointFlag: bookings.jointFlag,
    startsAt: bookings.startsAt,
    decisionAt: bookings.decisionAt,
    room: spaces.name,
  })
    .from(bookings)
    .innerJoin(spaces, and(eq(spaces.id, bookings.spaceId), eq(spaces.venueId, venueId)))
    .where(and(
      eq(bookings.venueId, venueId),
      eq(bookings.enquiryId, enquiryId),
      eq(bookings.status, "active"),
      isNull(bookings.deletedAt),
      inArray(bookings.kind, ["hold", "ink"]),
    ))
    .orderBy(asc(bookings.startsAt))
    .limit(MAX_HOLDS_TOLD);
  return rows.map((row) => holdWords({
    date: rotaLocalDate(row.startsAt.getTime(), timeZone),
    room: row.room,
    kind: row.kind,
    rank: row.rank,
    jointFlag: row.jointFlag,
    heldUntil: row.decisionAt === null ? null : rotaLocalDate(row.decisionAt.getTime(), timeZone),
  }));
}

/** The quote in the version the client was last sent, if it has one. */
async function quoteLastSent(db: Database, proposal: DraftFrom): Promise<Record<string, CanonicalJsonValue> | null> {
  if (proposal.sentVersion === null) return null;
  const [sent] = await db.select({ payload: proposalVersions.payload })
    .from(proposalVersions)
    .where(and(eq(proposalVersions.proposalId, proposal.id), eq(proposalVersions.version, proposal.sentVersion)))
    .limit(1);
  const quote = sent?.payload.quote ?? null;
  if (quote === null || quote.lineItems.length === 0) return null;
  return quoteWords(quote.currency, quote.lineItems);
}

export async function messageDraftContext(db: Database, proposal: DraftFrom, quote?: ProposalMessageDraftQuote): Promise<MessageDraftContext> {
  const { facts } = await clientEvent(db, proposal);
  const [deal] = proposal.opportunityId === null ? [] : await db.select({
    sourceEnquiryId: opportunities.sourceEnquiryId,
    contactName: contacts.name,
  })
    .from(opportunities)
    .leftJoin(contacts, and(
      eq(contacts.id, opportunities.primaryContactId),
      eq(contacts.venueId, proposal.venueId),
      isNull(contacts.deletedAt),
    ))
    .where(and(eq(opportunities.id, proposal.opportunityId), eq(opportunities.venueId, proposal.venueId), isNull(opportunities.deletedAt)))
    .limit(1);
  const enquiryId = proposal.enquiryId ?? deal?.sourceEnquiryId ?? null;
  const [enquiry] = enquiryId === null ? [] : await db.select({
    guestName: enquiries.guestName,
    name: enquiries.name,
    message: enquiries.message,
  })
    .from(enquiries)
    .where(and(eq(enquiries.id, enquiryId), eq(enquiries.venueId, proposal.venueId)))
    .limit(1);
  // The client's latest words on this proposal since it was last sent: a
  // question, or the change they asked for, that no version sent since has
  // answered (a version saved and not yet sent has not). The latest send is
  // read as the desk reads it: its stamp, or a move to "sent" after it. The
  // proposal is already known to be this venue's.
  const lastSent = sql`COALESCE(GREATEST(
    (SELECT ${proposals.sentAt} FROM ${proposals} WHERE ${proposals.id} = ${proposal.id}),
    (SELECT max(${proposalStatusHistory.createdAt}) FROM ${proposalStatusHistory}
      WHERE ${proposalStatusHistory.proposalId} = ${proposal.id} AND ${proposalStatusHistory.toStatus} = 'sent')
  ), '-infinity'::timestamptz)`;
  const [latest] = await db.select({ body: proposalComments.body })
    .from(proposalComments)
    .where(and(
      eq(proposalComments.proposalId, proposal.id),
      eq(proposalComments.authorType, "client"),
      inArray(proposalComments.kind, ["comment", "request_changes"]),
      gt(proposalComments.createdAt, lastSent),
    ))
    .orderBy(desc(proposalComments.createdAt))
    .limit(1);

  const clientNotes = clientWords(enquiry?.message);
  const clientLatestMessage = clientWords(latest?.body);
  // The occasion in words ("Drinks reception", not "reception"); one typed in
  // free on the public form is scrubbed like the client's other words.
  const occasion = scrub(occasionLabel(facts.occasion));
  const event = facts.occasion !== null || facts.eventDate !== null || facts.guestCount !== null || facts.roomName !== null;
  // The quote the client last saw goes only beside the composer's, so the
  // draft can say what changed; alone it would be a price nobody is sending.
  const sentQuote = quote === undefined ? null : await quoteLastSent(db, proposal);
  const holds = enquiryId === null ? [] : await holdsFor(db, proposal.venueId, enquiryId);
  return {
    context: {
      clientName: nameOf(deal?.contactName, enquiry?.guestName, enquiry?.name),
      occasion: occasion === "" ? null : occasion,
      eventDate: facts.eventDate,
      guestCount: facts.guestCount,
      roomName: facts.roomName,
      ...(quote === undefined ? {} : { quote: quoteWords(quote.currency, quote.lineItems) }),
      ...(sentQuote === null ? {} : { quoteLastSent: sentQuote }),
      ...(holds.length === 0 ? {} : { holds }),
      clientNotes,
      clientLatestMessage,
    },
    drewOn: {
      event,
      quote: quote !== undefined,
      holds: holds.length > 0,
      enquiry: clientNotes !== null,
      clientWords: clientLatestMessage !== null,
    },
  };
}
