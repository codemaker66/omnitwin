import { and, eq, isNull } from "drizzle-orm";
import { contacts, enquiries, opportunities, proposals } from "../db/schema.js";
import type { Database } from "../db/client.js";

// ---------------------------------------------------------------------------
// The client a proposal is addressed to (Plan 19 L5): the deal's primary
// contact when they have an email, else the person who made the enquiry (the
// proposal's own, or its deal's). Read only at the proposal's own venue, so
// another venue's people are never named. A name and email are taken as a
// pair from one record, never one from each.
//
// A share link is minted for the proposal, not for a person; the person the
// venue addressed the proposal to is the identity a link speaks for. The
// contract names them and their email, and a signature records that email.
// ---------------------------------------------------------------------------

export interface ProposalClient {
  readonly name: string | null;
  readonly email: string | null;
}

export async function proposalClient(
  db: Pick<Database, "select">,
  proposal: Pick<typeof proposals.$inferSelect, "venueId" | "opportunityId" | "enquiryId">,
): Promise<ProposalClient> {
  let contact: { readonly name: string; readonly email: string | null } | undefined;
  let sourceEnquiryId: string | null = null;
  if (proposal.opportunityId !== null) {
    const [deal] = await db.select({ contactId: opportunities.primaryContactId, sourceEnquiryId: opportunities.sourceEnquiryId })
      .from(opportunities)
      .where(and(eq(opportunities.id, proposal.opportunityId), eq(opportunities.venueId, proposal.venueId), isNull(opportunities.deletedAt)))
      .limit(1);
    sourceEnquiryId = deal?.sourceEnquiryId ?? null;
    if (deal?.contactId !== undefined && deal.contactId !== null) {
      [contact] = await db.select({ name: contacts.name, email: contacts.email }).from(contacts)
        .where(and(eq(contacts.id, deal.contactId), eq(contacts.venueId, proposal.venueId), isNull(contacts.deletedAt)))
        .limit(1);
    }
  }
  if (contact !== undefined && contact.email !== null && contact.email.trim() !== "") {
    return { name: contact.name, email: contact.email.trim() };
  }
  const enquiryId = proposal.enquiryId ?? sourceEnquiryId;
  if (enquiryId !== null) {
    const [enquiry] = await db.select({ name: enquiries.name, email: enquiries.email }).from(enquiries)
      .where(and(eq(enquiries.id, enquiryId), eq(enquiries.venueId, proposal.venueId)))
      .limit(1);
    if (enquiry !== undefined && enquiry.email.trim() !== "") return { name: enquiry.name, email: enquiry.email.trim() };
  }
  return { name: contact?.name ?? null, email: null };
}
