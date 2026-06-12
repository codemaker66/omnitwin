import { describe, expect, it } from "vitest";
import {
  CreateProposalSchema,
  CreateQuoteSchema,
  findUnsupportedProposalClaim,
  isProposalEditable,
  isValidProposalTransition,
  isValidQuoteTransition,
  MAX_MINOR_UNIT_AMOUNT,
  MinorUnitAmountSchema,
  PROPOSAL_STATUSES,
  PROPOSAL_STATUSES_REQUIRING_SENT_AT,
  PROPOSAL_UNSUPPORTED_CLAIM_PHRASES,
  PROPOSAL_VERSION_PAYLOAD_SCHEMA_VERSION,
  ProposalSchema,
  ProposalStatusHistoryEntrySchema,
  ProposalVersionPayloadSchema,
  proposalVersionPayloadDigest,
  ProposalVersionSchema,
  QUOTE_STATUSES,
  QuoteLineItemSchema,
  QuoteSchema,
  QuoteSnapshotSchema,
  QuoteWithLineItemsSchema,
  VALID_PROPOSAL_TRANSITIONS,
  VALID_QUOTE_TRANSITIONS,
  type ProposalStatus,
  type ProposalVersionPayload,
  type QuoteStatus,
} from "../proposal.js";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const UUID_C = "33333333-3333-4333-8333-333333333333";
const UUID_D = "44444444-4444-4444-8444-444444444444";
const NOW = "2026-06-11T00:00:00.000Z";

describe("proposal status vocabulary", () => {
  it("has eight unique statuses", () => {
    expect(PROPOSAL_STATUSES).toHaveLength(8);
    expect(new Set(PROPOSAL_STATUSES).size).toBe(8);
  });

  it("declares a transition row for every status", () => {
    for (const status of PROPOSAL_STATUSES) {
      expect(VALID_PROPOSAL_TRANSITIONS[status]).toBeDefined();
    }
  });

  it("only ever transitions into known statuses", () => {
    const known = new Set<ProposalStatus>(PROPOSAL_STATUSES);
    for (const targets of Object.values(VALID_PROPOSAL_TRANSITIONS)) {
      for (const target of targets) {
        expect(known.has(target)).toBe(true);
      }
    }
  });

  it("permits the documented happy path", () => {
    expect(isValidProposalTransition("draft", "sent")).toBe(true);
    expect(isValidProposalTransition("sent", "accepted")).toBe(true);
    expect(isValidProposalTransition("sent", "changes_requested")).toBe(true);
    expect(isValidProposalTransition("changes_requested", "sent")).toBe(true);
    expect(isValidProposalTransition("accepted", "archived")).toBe(true);
  });

  it("rejects illegal jumps", () => {
    expect(isValidProposalTransition("draft", "accepted")).toBe(false);
    expect(isValidProposalTransition("accepted", "declined")).toBe(false);
    expect(isValidProposalTransition("archived", "draft")).toBe(false);
    expect(isValidProposalTransition("withdrawn", "sent")).toBe(false);
  });

  it("archived is the only status with no exits", () => {
    const terminal = PROPOSAL_STATUSES.filter(
      (status) => VALID_PROPOSAL_TRANSITIONS[status].length === 0,
    );
    expect(terminal).toEqual(["archived"]);
  });

  it("treats draft and changes_requested as editable", () => {
    const editable = PROPOSAL_STATUSES.filter(isProposalEditable);
    expect(editable).toEqual(["draft", "changes_requested"]);
  });

  it("statuses requiring sentAt are exactly the post-send lifecycle", () => {
    expect(PROPOSAL_STATUSES_REQUIRING_SENT_AT).toEqual([
      "sent",
      "changes_requested",
      "accepted",
      "declined",
      "expired",
    ]);
    for (const status of PROPOSAL_STATUSES_REQUIRING_SENT_AT) {
      expect(PROPOSAL_STATUSES).toContain(status);
    }
  });
});

describe("quote status vocabulary", () => {
  it("has six unique statuses with a transition row for each", () => {
    expect(QUOTE_STATUSES).toHaveLength(6);
    expect(new Set(QUOTE_STATUSES).size).toBe(6);
    for (const status of QUOTE_STATUSES) {
      expect(VALID_QUOTE_TRANSITIONS[status]).toBeDefined();
    }
  });

  it("permits draft→issued→accepted and rejects resurrection", () => {
    expect(isValidQuoteTransition("draft", "issued")).toBe(true);
    expect(isValidQuoteTransition("issued", "accepted")).toBe(true);
    expect(isValidQuoteTransition("issued", "superseded")).toBe(true);
    expect(isValidQuoteTransition("accepted", "draft")).toBe(false);
    expect(isValidQuoteTransition("superseded", "issued")).toBe(false);
  });

  it("all post-issue statuses are terminal", () => {
    const terminal = QUOTE_STATUSES.filter(
      (status: QuoteStatus) => VALID_QUOTE_TRANSITIONS[status].length === 0,
    );
    expect(terminal).toEqual(["accepted", "declined", "superseded", "expired"]);
  });
});

describe("MinorUnitAmountSchema — exact minor-unit money", () => {
  it("accepts zero and the £1,000,000 ceiling", () => {
    expect(MinorUnitAmountSchema.safeParse(0).success).toBe(true);
    expect(MinorUnitAmountSchema.safeParse(MAX_MINOR_UNIT_AMOUNT).success).toBe(true);
  });

  it("rejects negatives, fractions, and over-ceiling amounts", () => {
    expect(MinorUnitAmountSchema.safeParse(-1).success).toBe(false);
    expect(MinorUnitAmountSchema.safeParse(12.5).success).toBe(false);
    expect(MinorUnitAmountSchema.safeParse(MAX_MINOR_UNIT_AMOUNT + 1).success).toBe(false);
  });
});

function validLineItem(): Record<string, unknown> {
  return {
    id: UUID_A,
    quoteId: UUID_B,
    pricingRuleId: null,
    description: "Round table hire",
    quantity: 12,
    unitAmountMinor: 1250,
    lineTotalMinor: 15000,
    sortOrder: 0,
  };
}

describe("QuoteLineItemSchema", () => {
  it("accepts an exact line total (unit × quantity)", () => {
    expect(QuoteLineItemSchema.safeParse(validLineItem()).success).toBe(true);
  });

  it("rejects a drifted line total", () => {
    const result = QuoteLineItemSchema.safeParse({
      ...validLineItem(),
      lineTotalMinor: 15001,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["lineTotalMinor"]);
    }
  });

  it("rejects zero quantity and fractional money", () => {
    expect(QuoteLineItemSchema.safeParse({ ...validLineItem(), quantity: 0 }).success).toBe(false);
    expect(
      QuoteLineItemSchema.safeParse({
        ...validLineItem(),
        unitAmountMinor: 12.5,
        lineTotalMinor: 150,
      }).success,
    ).toBe(false);
  });
});

function validQuote(): Record<string, unknown> {
  return {
    id: UUID_B,
    venueId: UUID_C,
    opportunityId: null,
    proposalId: null,
    enquiryId: null,
    spaceId: null,
    name: "Wedding package quote",
    status: "draft",
    currency: "GBP",
    subtotalMinor: 15000,
    totalMinor: 15000,
    validUntil: "2026-07-01",
    supersededByQuoteId: null,
    notes: null,
    createdBy: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  };
}

describe("QuoteSchema / QuoteWithLineItemsSchema", () => {
  it("accepts a valid quote row", () => {
    expect(QuoteSchema.safeParse(validQuote()).success).toBe(true);
  });

  it("rejects an unknown currency and a bad validUntil format", () => {
    expect(QuoteSchema.safeParse({ ...validQuote(), currency: "USD" }).success).toBe(false);
    expect(QuoteSchema.safeParse({ ...validQuote(), validUntil: "01/07/2026" }).success).toBe(false);
  });

  it("requires the subtotal to be the exact sum of line totals", () => {
    const ok = QuoteWithLineItemsSchema.safeParse({
      ...validQuote(),
      lineItems: [validLineItem()],
    });
    expect(ok.success).toBe(true);

    const drifted = QuoteWithLineItemsSchema.safeParse({
      ...validQuote(),
      subtotalMinor: 14999,
      lineItems: [validLineItem()],
    });
    expect(drifted.success).toBe(false);
    if (!drifted.success) {
      expect(drifted.error.issues[0]?.path).toEqual(["subtotalMinor"]);
    }
  });
});

describe("CreateQuoteSchema", () => {
  it("defaults currency to GBP and requires at least one line item", () => {
    const parsed = CreateQuoteSchema.parse({
      venueId: UUID_C,
      name: "Gala dinner quote",
      lineItems: [{ description: "Banquet chair", quantity: 100, unitAmountMinor: 350 }],
    });
    expect(parsed.currency).toBe("GBP");

    expect(
      CreateQuoteSchema.safeParse({
        venueId: UUID_C,
        name: "Empty quote",
        lineItems: [],
      }).success,
    ).toBe(false);
  });

  it("does not accept client-supplied totals", () => {
    const parsed = CreateQuoteSchema.parse({
      venueId: UUID_C,
      name: "Quote",
      subtotalMinor: 999999,
      lineItems: [{ description: "Stage deck", quantity: 1, unitAmountMinor: 20000 }],
    });
    expect("subtotalMinor" in parsed).toBe(false);
  });
});

function validPayload(): ProposalVersionPayload {
  return ProposalVersionPayloadSchema.parse({
    schemaVersion: PROPOSAL_VERSION_PAYLOAD_SCHEMA_VERSION,
    title: "Summer wedding — Grand Hall",
    clientMessage:
      "Planning-grade draft for your review. Human review required before anything is finalised.",
    configurationId: UUID_D,
    layoutRevision: 3,
    capacityNote:
      "Comfortable for around 120 guests at this layout style — planning estimate only, not a legal occupancy figure.",
    quote: {
      quoteId: null,
      currency: "GBP",
      lineItems: [
        { description: "Grand Hall hire", quantity: 1, unitAmountMinor: 250000, lineTotalMinor: 250000 },
        { description: "Round table", quantity: 12, unitAmountMinor: 1250, lineTotalMinor: 15000 },
      ],
      subtotalMinor: 265000,
      totalMinor: 265000,
    },
  });
}

describe("ProposalVersionPayloadSchema — claim guard", () => {
  it("accepts SAFE planning-grade wording", () => {
    expect(() => validPayload()).not.toThrow();
  });

  it("rejects every unsupported claim phrase in client-facing text", () => {
    for (const phrase of PROPOSAL_UNSUPPORTED_CLAIM_PHRASES) {
      const result = ProposalVersionPayloadSchema.safeParse({
        ...validPayload(),
        clientMessage: `This layout is ${phrase}.`,
      });
      expect(result.success).toBe(false);
    }
  });

  it("matches claim phrases case-insensitively and in capacityNote", () => {
    const result = ProposalVersionPayloadSchema.safeParse({
      ...validPayload(),
      capacityNote: "This room is Fire APPROVED for 200 guests.",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["capacityNote"]);
    }
  });

  it("findUnsupportedProposalClaim returns the phrase or null", () => {
    expect(findUnsupportedProposalClaim("totally fine wording")).toBeNull();
    expect(findUnsupportedProposalClaim("it is Survey-Grade accurate")).toBe("survey-grade");
  });

  it("rejects an unknown schemaVersion and a snapshot with drifted subtotal", () => {
    expect(
      ProposalVersionPayloadSchema.safeParse({
        ...validPayload(),
        schemaVersion: "venviewer.proposal-version.v2",
      }).success,
    ).toBe(false);

    expect(
      QuoteSnapshotSchema.safeParse({
        quoteId: null,
        currency: "GBP",
        lineItems: [{ description: "Hire", quantity: 1, unitAmountMinor: 100, lineTotalMinor: 100 }],
        subtotalMinor: 101,
        totalMinor: 101,
      }).success,
    ).toBe(false);
  });
});

describe("proposalVersionPayloadDigest", () => {
  it("produces a stable 64-hex digest", () => {
    const digest = proposalVersionPayloadDigest(validPayload());
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(proposalVersionPayloadDigest(validPayload())).toBe(digest);
  });

  it("changes when the payload changes", () => {
    const base = proposalVersionPayloadDigest(validPayload());
    const changed = proposalVersionPayloadDigest({
      ...validPayload(),
      title: "Winter wedding — Grand Hall",
    });
    expect(changed).not.toBe(base);
  });

  it("is independent of object key insertion order", () => {
    const payload = validPayload();
    const reorderedEntries = Object.entries(payload).reverse();
    const reordered = ProposalVersionPayloadSchema.parse(
      Object.fromEntries(reorderedEntries),
    );
    expect(proposalVersionPayloadDigest(reordered)).toBe(proposalVersionPayloadDigest(payload));
  });
});

describe("ProposalSchema / ProposalVersionSchema / history", () => {
  const proposal = {
    id: UUID_A,
    venueId: UUID_C,
    opportunityId: null,
    enquiryId: null,
    configurationId: UUID_D,
    title: "Summer wedding proposal",
    status: "draft",
    currentVersion: 0,
    shareCode: null,
    sentAt: null,
    createdBy: UUID_B,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  };

  it("accepts a valid proposal row and rejects malformed fields", () => {
    expect(ProposalSchema.safeParse(proposal).success).toBe(true);
    expect(ProposalSchema.safeParse({ ...proposal, shareCode: "ab" }).success).toBe(false);
    expect(ProposalSchema.safeParse({ ...proposal, currentVersion: -1 }).success).toBe(false);
    expect(ProposalSchema.safeParse({ ...proposal, status: "approved" }).success).toBe(false);
  });

  it("accepts a valid CreateProposal input and rejects an empty title", () => {
    expect(
      CreateProposalSchema.safeParse({ venueId: UUID_C, title: "New proposal" }).success,
    ).toBe(true);
    expect(CreateProposalSchema.safeParse({ venueId: UUID_C, title: "" }).success).toBe(false);
  });

  it("requires a positive version and a lowercase 64-hex source hash", () => {
    const version = {
      id: UUID_B,
      proposalId: UUID_A,
      version: 1,
      payload: validPayload(),
      sourceHash: proposalVersionPayloadDigest(validPayload()),
      createdBy: null,
      createdAt: NOW,
    };
    expect(ProposalVersionSchema.safeParse(version).success).toBe(true);
    expect(ProposalVersionSchema.safeParse({ ...version, version: 0 }).success).toBe(false);
    expect(
      ProposalVersionSchema.safeParse({
        ...version,
        sourceHash: version.sourceHash.toUpperCase(),
      }).success,
    ).toBe(false);
  });

  it("accepts a valid status-history entry and rejects unknown statuses", () => {
    const entry = {
      id: UUID_D,
      proposalId: UUID_A,
      fromStatus: "draft",
      toStatus: "sent",
      changedBy: null,
      note: "Sent to client after internal review.",
      createdAt: NOW,
    };
    expect(ProposalStatusHistoryEntrySchema.safeParse(entry).success).toBe(true);
    expect(
      ProposalStatusHistoryEntrySchema.safeParse({ ...entry, toStatus: "emailed" }).success,
    ).toBe(false);
  });
});
