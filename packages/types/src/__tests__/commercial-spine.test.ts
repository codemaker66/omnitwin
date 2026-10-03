import { describe, expect, it } from "vitest";
import {
  CreateActivitySchema,
  CreateOpportunitySchema,
  CreateProposalCommentSchema,
  OPPORTUNITY_STAGES,
  OpportunitySchema,
  ProposalCommentSchema,
  ProposalShareTokenSchema,
  VenueReplyBodySchema,
  isValidOpportunityStageTransition,
} from "../commercial-spine.js";

const VENUE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const OPPORTUNITY_ID = "33333333-3333-4333-8333-333333333333";
const PROPOSAL_ID = "44444444-4444-4444-8444-444444444444";
const NOW = "2026-06-12T10:00:00.000Z";

/** A question the client asked through their link. */
const storedComment = {
  id: "44444444-4444-4444-8444-444444444444",
  proposalId: "55555555-5555-4555-8555-555555555555",
  shareTokenId: "66666666-6666-4666-8666-666666666666",
  kind: "comment",
  authorName: null,
  authorEmail: null,
  body: "Is the Grand Hall guaranteed accessible?",
  isClientVisible: true,
  authorType: "client",
  createdAt: "2026-09-29T09:00:00.000Z",
} as const;

describe("commercial spine schemas", () => {
  it("declares the opportunity stage vocabulary and transitions", () => {
    expect(OPPORTUNITY_STAGES).toEqual([
      "new",
      "qualified",
      "proposal_drafting",
      "proposal_sent",
      "negotiation",
      "won",
      "lost",
      "archived",
    ]);
    expect(isValidOpportunityStageTransition("new", "qualified")).toBe(true);
    expect(isValidOpportunityStageTransition("new", "won")).toBe(false);
    expect(isValidOpportunityStageTransition("won", "archived")).toBe(true);
  });

  it("accepts a venue-scoped opportunity with explicit next action", () => {
    const result = OpportunitySchema.safeParse({
      id: OPPORTUNITY_ID,
      venueId: VENUE_ID,
      clientAccountId: null,
      primaryContactId: null,
      sourceEnquiryId: null,
      ownerUserId: USER_ID,
      title: "Grand Hall wedding enquiry",
      stage: "new",
      eventType: "Wedding",
      preferredDate: "2026-09-01",
      guestCount: 120,
      estimatedValueMinor: 450000,
      currency: "GBP",
      nextAction: "Prepare a proposal draft with planning-grade assumptions.",
      nextActionDueAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
      closedAt: null,
      deletedAt: null,
    });
    expect(result.success).toBe(true);
  });

  it("defaults opportunity creation currency and rejects invalid money", () => {
    const parsed = CreateOpportunitySchema.parse({
      venueId: VENUE_ID,
      title: "Reception Room dinner",
    });
    expect(parsed.currency).toBe("GBP");

    expect(CreateOpportunitySchema.safeParse({
      venueId: VENUE_ID,
      title: "Bad value",
      estimatedValueMinor: 12.5,
    }).success).toBe(false);
  });

  it("stores proposal share tokens as hashes, not bearer tokens", () => {
    expect(ProposalShareTokenSchema.safeParse({
      id: "55555555-5555-4555-8555-555555555555",
      proposalId: PROPOSAL_ID,
      tokenHash: "a".repeat(64),
      tokenPrefix: "abc12345",
      createdBy: USER_ID,
      createdAt: NOW,
      expiresAt: null,
      revokedAt: null,
      lastViewedAt: null,
    }).success).toBe(true);

    expect(ProposalShareTokenSchema.safeParse({
      id: "55555555-5555-4555-8555-555555555555",
      proposalId: PROPOSAL_ID,
      tokenHash: "raw-share-token",
      tokenPrefix: "raw-shar",
      createdBy: USER_ID,
      createdAt: NOW,
      expiresAt: null,
      revokedAt: null,
      lastViewedAt: null,
    }).success).toBe(false);
  });

  it("claim-guards the venue's own words: activity notes and replies to the client", () => {
    expect(CreateActivitySchema.safeParse({
      type: "note",
      body: "Client asked for an updated planning-grade quote.",
    }).success).toBe(true);
    expect(CreateActivitySchema.safeParse({ type: "note", body: "This says fire approved." }).success).toBe(false);

    expect(VenueReplyBodySchema.safeParse("There is step-free access from Glassford Street.").success).toBe(true);
    expect(VenueReplyBodySchema.safeParse("Yes, the Grand Hall is guaranteed accessible.").success).toBe(false);
    expect(VenueReplyBodySchema.safeParse("   ").success).toBe(false);
  });

  it("takes a client's comment in their own words, checked for length only", () => {
    expect(CreateProposalCommentSchema.safeParse({
      authorEmail: "client@example.com",
      body: "Please update the package selection.",
      kind: "request_changes",
    }).success).toBe(true);

    const question = CreateProposalCommentSchema.safeParse({ body: "Is the Grand Hall guaranteed accessible?" });
    expect(question.success && question.data.body).toBe("Is the Grand Hall guaranteed accessible?");
    expect(CreateProposalCommentSchema.safeParse({ body: "  " }).success).toBe(false);
    expect(CreateProposalCommentSchema.safeParse({ body: "x".repeat(4001) }).success).toBe(false);
    expect(CreateProposalCommentSchema.safeParse({ body: "x".repeat(4000) }).success).toBe(true);

    // A stored comment holds the client's words as written.
    expect(ProposalCommentSchema.safeParse(storedComment).success).toBe(true);
  });

  it("records who wrote a comment, and keeps a link off the venue's replies", () => {
    // A client's comment keeps its author once its link is deleted.
    expect(ProposalCommentSchema.safeParse({ ...storedComment, shareTokenId: null }).success).toBe(true);
    expect(ProposalCommentSchema.safeParse({ ...storedComment, authorType: "staff", shareTokenId: null }).success).toBe(true);
    const linked = ProposalCommentSchema.safeParse({ ...storedComment, authorType: "staff" });
    expect(linked.success).toBe(false);
    expect(linked.error?.issues[0]?.path).toEqual(["shareTokenId"]);
    expect(ProposalCommentSchema.safeParse({ ...storedComment, authorType: "venue" }).success).toBe(false);
    const { authorType: _dropped, ...unnamed } = storedComment;
    expect(ProposalCommentSchema.safeParse(unnamed).success).toBe(false);
  });
});
