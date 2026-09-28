import { describe, expect, it } from "vitest";
import { patchLinkRequest, planProposalLinks, type ProposalLinkRows } from "../services/proposal-links.js";

// A proposal's links (roadmap X1): the deal, the enquiry it came from and that
// enquiry's own layout, worked out on the server and never contradicting one
// another or the venue.

const VENUE = "venue-1";
const OTHER = "venue-2";
const DEAL = "deal-1";
const ENQUIRY = "enquiry-1";
const LAYOUT = "layout-1";
const OTHER_LAYOUT = "layout-2";

const own: ProposalLinkRows = {
  deal: { venueId: VENUE, sourceEnquiryId: ENQUIRY },
  enquiry: { id: ENQUIRY, venueId: VENUE, configurationId: LAYOUT },
  layouts: [{ id: LAYOUT, venueId: VENUE }, { id: OTHER_LAYOUT, venueId: VENUE }],
};

describe("planProposalLinks", () => {
  it("works out the deal's enquiry and that enquiry's layout", () => {
    expect(planProposalLinks(VENUE, { opportunityId: DEAL }, own))
      .toEqual({ ok: true, links: { opportunityId: DEAL, enquiryId: ENQUIRY, configurationId: LAYOUT } });
  });

  it("refuses a deal that is missing or at another venue", () => {
    expect(planProposalLinks(VENUE, { opportunityId: DEAL }, { layouts: [] }))
      .toMatchObject({ ok: false, status: 404, code: "NOT_FOUND" });
    expect(planProposalLinks(VENUE, { opportunityId: DEAL }, { ...own, deal: { venueId: OTHER, sourceEnquiryId: ENQUIRY } }))
      .toMatchObject({ ok: false, status: 422, code: "VENUE_MISMATCH" });
  });

  it("takes the deal's own enquiry whether it is named, null or left out, and refuses another", () => {
    for (const enquiryId of [ENQUIRY, null, undefined]) {
      expect(planProposalLinks(VENUE, { opportunityId: DEAL, enquiryId }, own))
        .toMatchObject({ ok: true, links: { enquiryId: ENQUIRY } });
    }
    expect(planProposalLinks(VENUE, { opportunityId: DEAL, enquiryId: "enquiry-2" }, own))
      .toEqual({ ok: false, status: 422, code: "LINK_MISMATCH", error: "That enquiry is not this deal's enquiry.", field: "enquiryId" });
    const noEnquiry: ProposalLinkRows = { deal: { venueId: VENUE, sourceEnquiryId: null }, layouts: [] };
    expect(planProposalLinks(VENUE, { opportunityId: DEAL, enquiryId: ENQUIRY }, noEnquiry))
      .toMatchObject({ ok: false, code: "LINK_MISMATCH", field: "enquiryId" });
    expect(planProposalLinks(VENUE, { opportunityId: DEAL }, noEnquiry))
      .toEqual({ ok: true, links: { opportunityId: DEAL, enquiryId: null, configurationId: null } });
  });

  it("links a deal's enquiry at another venue as none", () => {
    const elsewhere: ProposalLinkRows = { ...own, enquiry: { id: ENQUIRY, venueId: OTHER, configurationId: LAYOUT } };
    expect(planProposalLinks(VENUE, { opportunityId: DEAL }, elsewhere))
      .toEqual({ ok: true, links: { opportunityId: DEAL, enquiryId: null, configurationId: null } });
  });

  it("derives no layout that is removed, at another venue or absent", () => {
    expect(planProposalLinks(VENUE, { opportunityId: DEAL }, { ...own, layouts: [] }))
      .toMatchObject({ ok: true, links: { configurationId: null } });
    expect(planProposalLinks(VENUE, { opportunityId: DEAL }, { ...own, layouts: [{ id: LAYOUT, venueId: OTHER }] }))
      .toMatchObject({ ok: true, links: { configurationId: null } });
    expect(planProposalLinks(VENUE, { opportunityId: DEAL }, { ...own, enquiry: { id: ENQUIRY, venueId: VENUE, configurationId: null } }))
      .toMatchObject({ ok: true, links: { enquiryId: ENQUIRY, configurationId: null } });
  });

  it("checks a named layout against the venue and the enquiry, and takes null as none", () => {
    expect(planProposalLinks(VENUE, { opportunityId: DEAL, configurationId: null }, own))
      .toEqual({ ok: true, links: { opportunityId: DEAL, enquiryId: ENQUIRY, configurationId: null } });
    expect(planProposalLinks(VENUE, { opportunityId: DEAL, configurationId: LAYOUT }, own))
      .toMatchObject({ ok: true, links: { configurationId: LAYOUT } });
    expect(planProposalLinks(VENUE, { opportunityId: DEAL, configurationId: OTHER_LAYOUT }, own))
      .toEqual({ ok: false, status: 422, code: "LINK_MISMATCH", error: "That layout is not the one on their enquiry.", field: "configurationId" });
    expect(planProposalLinks(VENUE, { opportunityId: DEAL, configurationId: OTHER_LAYOUT }, { deal: { venueId: VENUE, sourceEnquiryId: null }, layouts: own.layouts }))
      .toMatchObject({ ok: false, code: "LINK_MISMATCH", field: "configurationId" });
    expect(planProposalLinks(VENUE, { configurationId: "missing" }, own))
      .toMatchObject({ ok: false, status: 404, code: "NOT_FOUND" });
    expect(planProposalLinks(VENUE, { configurationId: OTHER_LAYOUT }, { layouts: [{ id: OTHER_LAYOUT, venueId: OTHER }] }))
      .toMatchObject({ ok: false, status: 422, code: "VENUE_MISMATCH" });
    // The editor's Share lens: no deal, no enquiry, any live layout here.
    expect(planProposalLinks(VENUE, { configurationId: OTHER_LAYOUT }, { layouts: own.layouts }))
      .toEqual({ ok: true, links: { opportunityId: null, enquiryId: null, configurationId: OTHER_LAYOUT } });
  });

  it("checks an enquiry named without a deal, and derives its layout", () => {
    expect(planProposalLinks(VENUE, { enquiryId: ENQUIRY }, { layouts: [] }))
      .toMatchObject({ ok: false, status: 404, code: "NOT_FOUND" });
    expect(planProposalLinks(VENUE, { enquiryId: ENQUIRY }, { enquiry: { id: ENQUIRY, venueId: OTHER, configurationId: null }, layouts: [] }))
      .toMatchObject({ ok: false, status: 422, code: "VENUE_MISMATCH" });
    expect(planProposalLinks(VENUE, { enquiryId: ENQUIRY }, { enquiry: own.enquiry, layouts: own.layouts }))
      .toEqual({ ok: true, links: { opportunityId: null, enquiryId: ENQUIRY, configurationId: LAYOUT } });
  });

  it("links nothing when nothing is asked", () => {
    expect(planProposalLinks(VENUE, {}, { layouts: [] }))
      .toEqual({ ok: true, links: { opportunityId: null, enquiryId: null, configurationId: null } });
  });
});

describe("patchLinkRequest", () => {
  const stored = { opportunityId: DEAL, enquiryId: ENQUIRY, configurationId: LAYOUT };

  it("asks nothing of the links when none is sent", () => {
    expect(patchLinkRequest({}, stored)).toBeNull();
  });

  it("keeps the stored deal and enquiry when only a layout is sent", () => {
    expect(patchLinkRequest({ configurationId: null }, stored))
      .toEqual({ opportunityId: DEAL, enquiryId: ENQUIRY, configurationId: null });
  });

  it("works out the layout again when an enquiry is sent", () => {
    expect(patchLinkRequest({ enquiryId: "enquiry-2" }, stored))
      .toEqual({ opportunityId: DEAL, enquiryId: "enquiry-2", configurationId: undefined });
  });

  it("works out the enquiry and layout again when a deal is sent, or cleared", () => {
    expect(patchLinkRequest({ opportunityId: "deal-2" }, stored))
      .toEqual({ opportunityId: "deal-2", enquiryId: undefined, configurationId: undefined });
    expect(patchLinkRequest({ opportunityId: null }, stored))
      .toEqual({ opportunityId: null, enquiryId: undefined, configurationId: undefined });
  });
});
