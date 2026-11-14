import { describe, expect, it } from "vitest";
import { OPPORTUNITY_STAGES } from "../commercial-spine.js";
import { NON_BOOKING_ENQUIRY_TYPES } from "../enquiry.js";
import {
  CLOSED_ENQUIRY_STATES,
  CLOSED_OPPORTUNITY_STAGES,
  OPEN_OPPORTUNITY_STAGES,
  SENT_PROPOSAL_STATUSES,
  dealMustHaveEvent,
  enquiryMayBecomeEvent,
  enquiryMustHaveEvent,
  enquiryWorked,
  isOpenOpportunityStage,
  proposalMustHaveEvent,
  type ProposalEventFacts,
} from "../event-spine.js";

const bare: ProposalEventFacts = {
  status: "draft",
  deleted: false,
  hasDeal: false,
  hasEnquiry: false,
  hasAgreement: false,
  hasDepositRequestInForce: false,
};

describe("which records must have an event", () => {
  it("a sent proposal must; a declined, expired, withdrawn or archived one need not", () => {
    for (const status of SENT_PROPOSAL_STATUSES) expect(proposalMustHaveEvent({ ...bare, status })).toBe(true);
    for (const status of ["declined", "expired", "withdrawn", "archived"] as const) {
      expect(proposalMustHaveEvent({ ...bare, status })).toBe(false);
    }
  });
  it("a draft must only when it is for a deal or an enquiry", () => {
    expect(proposalMustHaveEvent({ ...bare, status: "draft" })).toBe(false);
    expect(proposalMustHaveEvent({ ...bare, status: "draft", hasDeal: true })).toBe(true);
    expect(proposalMustHaveEvent({ ...bare, status: "draft", hasEnquiry: true })).toBe(true);
  });
  it("an agreement or a deposit request in force makes any proposal need one", () => {
    expect(proposalMustHaveEvent({ ...bare, status: "archived", hasAgreement: true })).toBe(true);
    expect(proposalMustHaveEvent({ ...bare, status: "withdrawn", hasDepositRequestInForce: true })).toBe(true);
  });
  it("a deleted proposal never must", () => {
    expect(proposalMustHaveEvent({ ...bare, status: "accepted", deleted: true })).toBe(false);
  });
  it("a deal must unless it is lost, archived or deleted", () => {
    for (const stage of OPPORTUNITY_STAGES) {
      expect(dealMustHaveEvent({ stage, deleted: false })).toBe(stage !== "lost" && stage !== "archived");
      expect(dealMustHaveEvent({ stage, deleted: true })).toBe(false);
      expect(isOpenOpportunityStage(stage)).toBe(stage !== "lost" && stage !== "archived");
    }
  });
  it("an open enquiry must once it is worked; a closed one only when a child of it has an event", () => {
    expect(enquiryMustHaveEvent({ state: "submitted", eventType: "wedding", worked: false, childHasEvent: false })).toBe(false);
    expect(enquiryMustHaveEvent({ state: "under_review", eventType: null, worked: true, childHasEvent: false })).toBe(true);
    for (const state of CLOSED_ENQUIRY_STATES) {
      expect(enquiryMustHaveEvent({ state, eventType: null, worked: true, childHasEvent: false })).toBe(false);
      expect(enquiryMustHaveEvent({ state, eventType: null, worked: true, childHasEvent: true })).toBe(true);
    }
  });
  it("a draft, or an enquiry that asks to book nothing, never must and never may", () => {
    expect(enquiryMustHaveEvent({ state: "draft", eventType: null, worked: true, childHasEvent: true })).toBe(false);
    for (const eventType of NON_BOOKING_ENQUIRY_TYPES) {
      expect(enquiryMustHaveEvent({ state: "submitted", eventType, worked: true, childHasEvent: true })).toBe(false);
      expect(enquiryMayBecomeEvent({ state: "submitted", eventType })).toBe(false);
    }
    expect(enquiryMayBecomeEvent({ state: "draft", eventType: null })).toBe(false);
    expect(enquiryMayBecomeEvent({ state: "archived", eventType: null })).toBe(true);
  });
  it("an enquiry is worked when any one sign of work is present", () => {
    const none = { replied: false, hasHeldDate: false, hasViewing: false, hasDeal: false, hasProposal: false, hasQuote: false };
    expect(enquiryWorked(none)).toBe(false);
    for (const key of Object.keys(none) as (keyof typeof none)[]) {
      expect(enquiryWorked({ ...none, [key]: true })).toBe(true);
    }
  });
  it("open and closed stages together are every stage", () => {
    expect([...OPEN_OPPORTUNITY_STAGES, ...CLOSED_OPPORTUNITY_STAGES].sort()).toEqual([...OPPORTUNITY_STAGES].sort());
  });
});
