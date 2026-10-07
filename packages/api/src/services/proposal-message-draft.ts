import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { occasionLabel, type CanonicalJsonValue, type ProposalMessageDraft } from "@omnitwin/types";
import { contacts, enquiries, opportunities, proposalComments, proposalVersions, proposals } from "../db/schema.js";
import type { Database } from "../db/client.js";
import { clientEvent } from "./proposal-taken.js";

// ---------------------------------------------------------------------------
// What the AI is told of a proposal to draft its message to the client
// (roadmap X1, "Use in proposal"): the event as the venue holds it, the
// client's name, the client's words from their enquiry and their latest
// words on the proposal since its latest version (a change they asked for,
// not one a version has already answered). It is built here, at the
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
// A phone number as people write one: from a "+", a leading 0 or a bracket,
// digits in groups split by spaces, dots, dashes, slashes or brackets, 9 to
// 15 digits in all. A date (12.06.2027), a date range, a time, a guest count
// or a budget (15000 - 20000) is never one.
const PHONE_LIKE = /(?:\+|\(|(?<![\d.,])\b0)[\d\s().\-–/]{7,}\d/gu;
const DATE_LIKE = /\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/u;

function scrub(text: string | null | undefined): string {
  return (text ?? "")
    .replace(EMAIL, "(email address)")
    .replace(PHONE_LIKE, (run) => {
      const digits = run.replace(/\D/gu, "").length;
      return digits >= 9 && digits <= 15 && !DATE_LIKE.test(run) ? "(phone number)" : run;
    })
    .trim();
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
  // The client's latest words on this proposal since its latest version: a
  // question, or the change they asked for, that no version has answered
  // yet. The proposal is already known to be this venue's.
  const [version] = await db.select({ createdAt: proposalVersions.createdAt })
    .from(proposalVersions)
    .where(eq(proposalVersions.proposalId, proposal.id))
    .orderBy(desc(proposalVersions.version))
    .limit(1);
  const [latest] = await db.select({ body: proposalComments.body })
    .from(proposalComments)
    .where(and(
      eq(proposalComments.proposalId, proposal.id),
      eq(proposalComments.authorType, "client"),
      inArray(proposalComments.kind, ["comment", "request_changes"]),
      ...(version === undefined ? [] : [gt(proposalComments.createdAt, version.createdAt)]),
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
