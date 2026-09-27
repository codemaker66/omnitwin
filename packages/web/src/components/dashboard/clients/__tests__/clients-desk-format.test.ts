import { describe, expect, it } from "vitest";
import type { ContactProfile } from "../../../../api/clients.js";
import {
  clientRefFromSearchValue, clientRefToSearchValue, contactFacts, dealStageWords, initials, proposalStatusWords, sameClient,
} from "../clients-desk-format.js";

const ID = "00000000-0000-4000-8000-00000000A001";

describe("the client in the address", () => {
  it("reads ?client=kind:uuid, and nothing else", () => {
    expect(clientRefFromSearchValue(`contact:${ID}`)).toEqual({ kind: "contact", id: ID.toLowerCase() });
    expect(clientRefFromSearchValue(` lead:${ID} `)).toEqual({ kind: "lead", id: ID.toLowerCase() });
    for (const value of [null, "", ID, `deal:${ID}`, "user:not-a-uuid", `user:${ID}:extra`, `USER:${ID}`]) {
      expect(clientRefFromSearchValue(value), String(value)).toBeNull();
    }
  });

  it("writes back what it reads", () => {
    const ref = { kind: "user", id: ID.toLowerCase() } as const;
    expect(clientRefFromSearchValue(clientRefToSearchValue(ref))).toEqual(ref);
    expect(sameClient(ref, { kind: "user", id: ID.toLowerCase() })).toBe(true);
    expect(sameClient(ref, { kind: "lead", id: ID.toLowerCase() })).toBe(false);
    expect(sameClient(ref, null)).toBe(false);
  });
});

describe("initials", () => {
  it("takes the first and last names' letters, or an email's first", () => {
    expect(initials("Ailsa Henderson")).toBe("AH");
    expect(initials("Mary Anne O'Neill")).toBe("MO");
    expect(initials("kirsty@example.test")).toBe("K");
    expect(initials("Éilis Ní Bhriain")).toBe("ÉB");
    expect(initials("—")).toBe("·");
  });
});

describe("words", () => {
  it("names stages and statuses in the venue's words, never the schema's", () => {
    expect(dealStageWords("proposal_sent")).toBe("Proposal sent");
    expect(dealStageWords("something_new")).toBe("In the pipeline");
    expect(proposalStatusWords("changes_requested")).toBe("Changes asked for");
    expect(proposalStatusWords("something_new")).toBe("Proposal");
  });
});

describe("a contact's lifetime", () => {
  function profile(deals: { stage: string; value: number; currency?: string }[]): ContactProfile {
    return {
      contact: {
        id: ID, venueId: "venue", name: "Ailsa Henderson", email: "ailsa@example.test", phone: null, roleLabel: null,
        sourceEnquiryId: null, createdAt: "2026-01-01T00:00:00.000Z", account: null,
      },
      deals: deals.map((deal, index) => ({
        id: `deal-${String(index)}`, title: `Deal ${String(index)}`, stage: deal.stage, preferredDate: null, guestCount: null,
        estimatedValueMinor: deal.value, currency: deal.currency ?? "GBP", updatedAt: "2026-01-02T00:00:00.000Z",
      })),
      proposals: [],
    };
  }

  it("adds up only what was won", () => {
    expect(contactFacts(profile([{ stage: "won", value: 1_000_000 }, { stage: "won", value: 250_000 }, { stage: "negotiation", value: 9_000_000 }])))
      .toEqual([
        { value: "3", label: "deals" },
        { value: "0", label: "proposals" },
        { value: "£12,500.00", label: "won" },
      ]);
  });

  it("says none yet rather than £0, and never adds two currencies together", () => {
    expect(contactFacts(profile([{ stage: "lost", value: 500_000 }]))[2]).toEqual({ value: "None yet", label: "won", tone: "muted" });
    expect(contactFacts(profile([
      { stage: "won", value: 100_000 }, { stage: "won", value: 900_000, currency: "EUR" }, { stage: "won", value: 50_000 },
    ]))[2]).toEqual({ value: "£1,500.00 + €9,000.00", label: "won" });
  });
});
