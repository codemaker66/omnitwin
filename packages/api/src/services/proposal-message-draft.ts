import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { occasionLabel, type CanonicalJsonValue, type ProposalMessageDraft } from "@omnitwin/types";
import { contacts, enquiries, opportunities, proposalComments, proposalStatusHistory, proposals } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { clientEvent } from "./proposal-taken.js";

// ---------------------------------------------------------------------------
// What the AI is told of a proposal to draft its message to the client
// (roadmap X1, "Use in proposal"): the event as the venue holds it, the
// client's name, the client's words from their enquiry and their latest
// words on the proposal since it was last sent (a change they asked for, not
// one a version sent since has answered). It is built here, at the
// proposal's own venue, never taken from the browser, so nothing of another
// venue's can be sent and nothing can be added to it. It carries no id, no
// price and no email address or phone number: a name holding either (a
// public enquiry sent without a name stores its email as the name) is left
// out, and contact details in the client's words and occasion are taken
// out. Anything else the client typed (a date, a budget) goes as written.
// ---------------------------------------------------------------------------

/** The longest part of the client's words passed on: enough for the draft to
 *  answer what they asked, without sending a long thread. */
export const MAX_CLIENT_NOTES_LENGTH = 2000;

type DraftFrom = Pick<typeof proposals.$inferSelect, "id" | "venueId" | "opportunityId" | "enquiryId" | "configurationId">;

export interface MessageDraftContext {
  readonly context: Record<string, CanonicalJsonValue>;
  /** What the AI is given to draw on, so the screen claims only that. */
  readonly drewOn: ProposalMessageDraft["drewOn"];
}

const EMAIL = /[^\s@<>()[\]]+@[^\s@<>()[\]]+\.[^\s@<>()[\].,;:!?]+/gu;

// Phone numbers are found as people write them. A run of digits and the marks
// numbers are written with (spaces, dots, dashes, slashes, brackets), on one
// line, is split where one number ends and another begins; a date or a time
// in it is kept; what is left is a phone number when it holds ten digits or
// more, or nine from a "+", a bracket or a leading 0. So "0141 552 1234 /
// 07700 900123" is two numbers, "415-555-0123" and "06.12.34.56.78" are
// numbers, and "12.06.2027 19.30", "15000 - 20000" and "(150 guests)" are not.
const NUMBER_RUN = /(?<![\d+(])[+(]?\d(?:[\d ().\-–/]*[\d)])?/gu;
const NUMBER_BREAK = /(\s+\/\s+|\s{2,}|\s+[-–]\s+|\s+(?=\()|(?<=\))\s+)/u;
const DATE_OR_TIME = /((?<![\d./:-])(?:\d{1,2}[./-]\d{1,2}[./-](?:\d{4}|\d{2})|\d{4}-\d{2}-\d{2}|\d{1,2}[.:]\d{2})(?![./:-]?\d))/u;
const PHONE_START = /^[+(]?0|^\+/u;

function phoneShaped(text: string): boolean {
  const digits = text.replace(/\D/gu, "").length;
  return digits >= 10 || (digits === 9 && PHONE_START.test(text.trim()));
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

function scrubRun(run: string): string {
  const pieces = run.split(NUMBER_BREAK);
  const parts: string[] = [];
  const breaks: string[] = [];
  pieces.forEach((piece, index) => { (index % 2 === 0 ? parts : breaks).push(piece); });
  const out = parts.map(scrubNumber);
  // A number written across a spaced dash from a leading 0 or "+" ("0141 –
  // 552 1234"), or across its brackets ("(0141) 552 1234"), is one number
  // when neither half is one alone; a country code before one goes with it.
  for (let at = 0; at + 1 < parts.length; at += 1) {
    const left = parts[at] ?? "";
    const right = parts[at + 1] ?? "";
    const gap = breaks[at] ?? "";
    const dashed = /[-–]/u.test(gap) && PHONE_START.test(left.trim());
    const bracketed = left.endsWith(")") || right.startsWith("(");
    const untouched = out[at] === left && out[at + 1] === right;
    const joined = scrubNumber(`${left}${gap}${right}`);
    if ((dashed || bracketed) && untouched && joined !== `${left}${gap}${right}`) {
      out[at] = joined;
      out[at + 1] = "";
      breaks[at] = "";
      parts[at + 1] = joined;
    } else if (/^\+\d{1,3}$/u.test(left.trim()) && out[at + 1] !== right) {
      out[at] = "";
      breaks[at] = "";
    }
  }
  return out.map((part, index) => `${part}${breaks[index] ?? ""}`).join("");
}

function scrub(text: string | null | undefined): string {
  return (text ?? "").replace(EMAIL, "(email address)").replace(NUMBER_RUN, scrubRun).trim();
}

/** The client's words with any email address or phone number taken out,
 *  trimmed and cut to length; null when nothing is left. */
export function clientWords(text: string | null | undefined): string | null {
  const scrubbed = scrub(text);
  if (scrubbed === "") return null;
  return scrubbed.length > MAX_CLIENT_NOTES_LENGTH ? `${scrubbed.slice(0, MAX_CLIENT_NOTES_LENGTH)}…` : scrubbed;
}

/** The first name given that is a name: one holding an email address or a
 *  phone number is not. */
function nameOf(...candidates: readonly (string | null | undefined)[]): string | null {
  for (const candidate of candidates) {
    const name = candidate?.trim() ?? "";
    if (name !== "" && scrub(name) === name && !name.includes("@")) return name;
  }
  return null;
}

export async function messageDraftContext(db: Database, proposal: DraftFrom): Promise<MessageDraftContext> {
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
  return {
    context: {
      clientName: nameOf(deal?.contactName, enquiry?.guestName, enquiry?.name),
      occasion: occasion === "" ? null : occasion,
      eventDate: facts.eventDate,
      guestCount: facts.guestCount,
      roomName: facts.roomName,
      clientNotes,
      clientLatestMessage,
    },
    drewOn: { event, enquiry: clientNotes !== null, clientWords: clientLatestMessage !== null },
  };
}
