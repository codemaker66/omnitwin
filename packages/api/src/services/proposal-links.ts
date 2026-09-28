import { and, eq, inArray, isNull } from "drizzle-orm";
import { configurations, enquiries, opportunities } from "../db/schema.js";
import type { Database } from "../db/client.js";

// ---------------------------------------------------------------------------
// A proposal's links (roadmap X1): the deal it is for, the enquiry that deal
// came from, and that enquiry's own layout. The server works out what a
// request leaves out and refuses links that contradict each other, so a
// proposal never carries one client's deal with another's enquiry or layout.
//
// In a request, a field left out is worked out, null means none, and an id is
// checked. With a deal, the enquiry is always the deal's own (null or left out
// both mean it), and the layout is that enquiry's own while it is live at the
// venue. Without a deal or an enquiry (the editor's Share lens), any live
// layout at the venue may be named. Nothing else is ever taken as the layout:
// not an event's, not another proposal's.
// ---------------------------------------------------------------------------

export interface ProposalLinks {
  readonly opportunityId: string | null;
  readonly enquiryId: string | null;
  readonly configurationId: string | null;
}

/** Each field: undefined to work it out, null for none, an id to check. */
export interface ProposalLinkRequest {
  readonly opportunityId?: string | null | undefined;
  readonly enquiryId?: string | null | undefined;
  readonly configurationId?: string | null | undefined;
}

export interface ProposalLinkRefusal {
  readonly ok: false;
  readonly status: 404 | 422;
  readonly code: "NOT_FOUND" | "VENUE_MISMATCH" | "LINK_MISMATCH";
  readonly error: string;
  readonly field?: "enquiryId" | "configurationId";
}

export type ProposalLinkResult = { readonly ok: true; readonly links: ProposalLinks } | ProposalLinkRefusal;

/** Live rows only: the deal asked for, the enquiry named or implied, and any layout named or implied. */
export interface ProposalLinkRows {
  readonly deal?: { readonly venueId: string; readonly sourceEnquiryId: string | null } | undefined;
  readonly enquiry?: { readonly id: string; readonly venueId: string; readonly configurationId: string | null } | undefined;
  readonly layouts: readonly { readonly id: string; readonly venueId: string }[];
}

function refuse(
  status: 404 | 422,
  code: ProposalLinkRefusal["code"],
  error: string,
  field?: ProposalLinkRefusal["field"],
): ProposalLinkRefusal {
  return field === undefined ? { ok: false, status, code, error } : { ok: false, status, code, error, field };
}

/** The links a request comes to at a venue, or why they are refused. Pure. */
export function planProposalLinks(venueId: string, request: ProposalLinkRequest, rows: ProposalLinkRows): ProposalLinkResult {
  const dealId = request.opportunityId ?? null;
  let enquiry = rows.enquiry;
  let enquiryId: string | null;
  if (dealId !== null) {
    const deal = rows.deal;
    if (deal === undefined) return refuse(404, "NOT_FOUND", "Opportunity not found");
    if (deal.venueId !== venueId) return refuse(422, "VENUE_MISMATCH", "Opportunity belongs to a different venue");
    const own = deal.sourceEnquiryId;
    if (request.enquiryId !== undefined && request.enquiryId !== null && request.enquiryId !== own) {
      return refuse(422, "LINK_MISMATCH", "That enquiry is not this deal's enquiry.", "enquiryId");
    }
    // The deal's own enquiry, read at this venue; one elsewhere is none.
    const ownHere = own !== null && enquiry !== undefined && enquiry.id === own && enquiry.venueId === venueId;
    enquiryId = ownHere ? own : null;
    if (!ownHere) enquiry = undefined;
  } else if (request.enquiryId !== undefined && request.enquiryId !== null) {
    if (enquiry === undefined || enquiry.id !== request.enquiryId) return refuse(404, "NOT_FOUND", "Enquiry not found");
    if (enquiry.venueId !== venueId) return refuse(422, "VENUE_MISMATCH", "Enquiry belongs to a different venue");
    enquiryId = enquiry.id;
  } else {
    enquiryId = null;
    enquiry = undefined;
  }

  const liveLayout = (id: string) => rows.layouts.find((layout) => layout.id === id);
  const enquiryLayoutId = enquiry?.configurationId ?? null;
  let configurationId: string | null;
  if (request.configurationId === undefined) {
    const derived = enquiryLayoutId === null ? undefined : liveLayout(enquiryLayoutId);
    configurationId = derived !== undefined && derived.venueId === venueId ? derived.id : null;
  } else if (request.configurationId === null) {
    configurationId = null;
  } else {
    const named = liveLayout(request.configurationId);
    if (named === undefined) return refuse(404, "NOT_FOUND", "Configuration not found");
    if (named.venueId !== venueId) return refuse(422, "VENUE_MISMATCH", "Configuration belongs to a different venue");
    if ((dealId !== null || enquiryId !== null) && named.id !== enquiryLayoutId) {
      return refuse(422, "LINK_MISMATCH", "That layout is not the one on their enquiry.", "configurationId");
    }
    configurationId = named.id;
  }
  return { ok: true, links: { opportunityId: dealId, enquiryId, configurationId } };
}

/**
 * What a PATCH asks of the links, laid over what is stored: null when it
 * sends no link, so a title alone reads and changes nothing. A deal sent works
 * out the enquiry and layout it leaves out; an enquiry sent works out the
 * layout.
 */
export function patchLinkRequest(body: ProposalLinkRequest, stored: ProposalLinks): ProposalLinkRequest | null {
  const dealSent = body.opportunityId !== undefined;
  const enquirySent = body.enquiryId !== undefined;
  const layoutSent = body.configurationId !== undefined;
  if (!dealSent && !enquirySent && !layoutSent) return null;
  return {
    opportunityId: dealSent ? body.opportunityId : stored.opportunityId,
    enquiryId: enquirySent ? body.enquiryId : dealSent ? undefined : stored.enquiryId,
    configurationId: layoutSent ? body.configurationId : dealSent || enquirySent ? undefined : stored.configurationId,
  };
}

/** Reads the live rows a request needs and plans its links. */
export async function resolveProposalLinks(
  db: Pick<Database, "select">,
  venueId: string,
  request: ProposalLinkRequest,
): Promise<ProposalLinkResult> {
  const dealId = request.opportunityId ?? null;
  const [deal] = dealId === null ? [] : await db.select({
    venueId: opportunities.venueId,
    sourceEnquiryId: opportunities.sourceEnquiryId,
  }).from(opportunities)
    .where(and(eq(opportunities.id, dealId), isNull(opportunities.deletedAt)))
    .limit(1);
  // Another venue's deal is refused without reading its enquiry.
  const enquiryId = dealId !== null
    ? (deal !== undefined && deal.venueId === venueId ? deal.sourceEnquiryId : null)
    : request.enquiryId ?? null;
  const [enquiry] = enquiryId === null ? [] : await db.select({
    id: enquiries.id,
    venueId: enquiries.venueId,
    configurationId: enquiries.configurationId,
  }).from(enquiries)
    .where(eq(enquiries.id, enquiryId))
    .limit(1);
  const layoutIds = [...new Set([request.configurationId, enquiry?.configurationId]
    .filter((id): id is string => typeof id === "string"))];
  const layouts = layoutIds.length === 0 ? [] : await db.select({
    id: configurations.id,
    venueId: configurations.venueId,
  }).from(configurations)
    .where(and(inArray(configurations.id, layoutIds), isNull(configurations.deletedAt)));
  return planProposalLinks(venueId, request, { deal, enquiry, layouts });
}
