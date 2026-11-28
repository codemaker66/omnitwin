import type { OpportunityStage } from "./commercial-spine.js";
import { isBookingEnquiry, type EnquiryStatus } from "./enquiry.js";
import type { ProposalStatus } from "./proposal.js";

// ---------------------------------------------------------------------------
// Which records must have an event (the spine's links, design section 5.1).
//
// A proposal, a deal (opportunity) and an enquiry each carry an event_id. This
// file is the one definition of when that link must be filled; the SQL that
// counts or repairs gaps mirrors it. Three rules, in plain words:
//
//   1. A proposal must have an event once it has left the drawing board
//      (sent, changes requested, accepted), or when it is a draft written for a
//      deal or an enquiry, or when an agreement or a deposit request in force
//      stands on it. A deleted proposal never must.
//   2. A deal must have an event while it is open (any stage but lost or
//      archived). A deleted deal never must.
//   3. An enquiry must have an event once it has been worked and is still open,
//      or when something made from it already has one. A draft, or an enquiry
//      that asks to book nothing, never has one and never may.
// ---------------------------------------------------------------------------

/** Deal stages that still need their event. */
export const OPEN_OPPORTUNITY_STAGES = [
  "new",
  "qualified",
  "proposal_drafting",
  "proposal_sent",
  "negotiation",
  "won",
] as const satisfies readonly OpportunityStage[];

/** Deal stages that are over: the deal need not have an event. */
export const CLOSED_OPPORTUNITY_STAGES = ["lost", "archived"] as const satisfies readonly OpportunityStage[];

const OPEN_STAGE_SET: ReadonlySet<OpportunityStage> = new Set(OPEN_OPPORTUNITY_STAGES);

/** True when a deal at this stage is still live. */
export function isOpenOpportunityStage(stage: OpportunityStage): boolean {
  return OPEN_STAGE_SET.has(stage);
}

/** Proposal statuses that mean the customer has been given the proposal. */
export const SENT_PROPOSAL_STATUSES = [
  "sent",
  "changes_requested",
  "accepted",
] as const satisfies readonly ProposalStatus[];

/** Enquiry states that are finished: no further work is expected. */
export const CLOSED_ENQUIRY_STATES = ["rejected", "withdrawn", "archived"] as const satisfies readonly EnquiryStatus[];

const SENT_PROPOSAL_SET: ReadonlySet<ProposalStatus> = new Set(SENT_PROPOSAL_STATUSES);
const CLOSED_ENQUIRY_SET: ReadonlySet<EnquiryStatus> = new Set(CLOSED_ENQUIRY_STATES);

/** What the rule needs to know about a proposal. */
export interface ProposalEventFacts {
  readonly status: ProposalStatus;
  readonly deleted: boolean;
  readonly hasDeal: boolean;
  readonly hasEnquiry: boolean;
  readonly hasAgreement: boolean;
  readonly hasDepositRequestInForce: boolean;
}

/** True when this proposal cannot be left without an event. */
export function proposalMustHaveEvent(facts: ProposalEventFacts): boolean {
  if (facts.deleted) return false;
  if (SENT_PROPOSAL_SET.has(facts.status)) return true;
  if (facts.hasAgreement || facts.hasDepositRequestInForce) return true;
  return facts.status === "draft" && (facts.hasDeal || facts.hasEnquiry);
}

/** True when this deal cannot be left without an event. */
export function dealMustHaveEvent(facts: { readonly stage: OpportunityStage; readonly deleted: boolean }): boolean {
  return !facts.deleted && isOpenOpportunityStage(facts.stage);
}

/** Signs that someone has done something about an enquiry. */
export interface EnquiryWorkFacts {
  readonly replied: boolean;
  readonly hasHeldDate: boolean;
  readonly hasViewing: boolean;
  readonly hasDeal: boolean;
  readonly hasProposal: boolean;
  readonly hasQuote: boolean;
}

/** True when any one sign of work is present. */
export function enquiryWorked(facts: EnquiryWorkFacts): boolean {
  return (
    facts.replied || facts.hasHeldDate || facts.hasViewing || facts.hasDeal || facts.hasProposal || facts.hasQuote
  );
}

/** True when an enquiry is allowed to be joined to an event at all. */
export function enquiryMayBecomeEvent(facts: { readonly state: EnquiryStatus; readonly eventType: string | null }): boolean {
  return facts.state !== "draft" && isBookingEnquiry(facts.eventType);
}

/** True when this enquiry cannot be left without an event. */
export function enquiryMustHaveEvent(facts: {
  readonly state: EnquiryStatus;
  readonly eventType: string | null;
  readonly worked: boolean;
  readonly childHasEvent: boolean;
}): boolean {
  if (!enquiryMayBecomeEvent(facts)) return false;
  return facts.childHasEvent || (facts.worked && !CLOSED_ENQUIRY_SET.has(facts.state));
}
