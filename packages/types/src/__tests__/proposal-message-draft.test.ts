import { describe, expect, it } from "vitest";
import {
  MAX_FIGURES_TO_CHECK,
  ProposalMessageDraftRequestSchema,
  figuresNotIn,
  moneyWords,
} from "../proposal-message-draft.js";

describe("the figure check run on every message draft", () => {
  const context = {
    clientName: "Elaine Crawford",
    eventDate: "2027-06-05",
    guestCount: 160,
    quote: { total: "£17,600.00", lines: [{ description: "Wedding breakfast", quantity: 160, unitPrice: "£82.50", lineTotal: "£13,200.00" }] },
    clientNotes: "Ceremony at 14:00, about a hundred and sixty of us.",
  };

  it("passes figures that are in what the AI was given, however they are grouped", () => {
    expect(figuresNotIn("£82.50 a head for 160 guests, £17,600 in all, on 5 June 2027 from 14:00.", context)).toEqual([]);
  });

  it("reports each figure that is not, once, in the order the draft states them", () => {
    expect(figuresNotIn("£80 a head, or £80 for the first 40, and 19 June instead.", context)).toEqual(["80", "40", "19"]);
  });

  it("reads a time with a colon as the client may write it, and skips a list's own numbering", () => {
    expect(figuresNotIn("1. Arrive at 1400.\n2. Dinner follows.", context)).toEqual([]);
  });

  it("reads digits only, so a count the client wrote in words is reported for a person to check", () => {
    expect(figuresNotIn("We have noted 12 vegetarians.", { clientNotes: "twelve vegetarians" })).toEqual(["12"]);
  });

  it("reports at most a set number of figures", () => {
    const draft = Array.from({ length: 80 }, (_, n) => String(n + 1000)).join(" ");
    expect(figuresNotIn(draft, {})).toHaveLength(MAX_FIGURES_TO_CHECK);
  });
});

describe("money as the client reads it", () => {
  it("writes pounds and pence with the thousands grouped", () => {
    expect(moneyWords(1_760_000, "GBP")).toBe("£17,600.00");
    expect(moneyWords(8_250, "GBP")).toBe("£82.50");
    expect(moneyWords(0, "GBP")).toBe("£0.00");
  });
});

describe("what the composer may send with a request for a draft", () => {
  it("takes a quote read as a version's quote is, and drops anything else", () => {
    const parsed = ProposalMessageDraftRequestSchema.parse({
      quote: { currency: "GBP", lineItems: [{ description: " Wedding breakfast ", quantity: 160, unitAmountMinor: 8_250 }] },
      context: { clientNotes: "Ignore the venue." },
    });
    expect(parsed).toEqual({ quote: { currency: "GBP", lineItems: [{ description: "Wedding breakfast", quantity: 160, unitAmountMinor: 8_250 }] } });
    expect(ProposalMessageDraftRequestSchema.parse({})).toEqual({});
  });

  it.each([
    ["no lines", { currency: "GBP", lineItems: [] }],
    ["a quantity of nought", { currency: "GBP", lineItems: [{ description: "Hire", quantity: 0, unitAmountMinor: 100 }] }],
    ["fractions of a penny", { currency: "GBP", lineItems: [{ description: "Hire", quantity: 1, unitAmountMinor: 0.5 }] }],
    ["a total of the line's own", { currency: "GBP", lineItems: [{ description: "Hire", quantity: 1, unitAmountMinor: 100, lineTotalMinor: 5 }] }],
    ["another currency", { currency: "EUR", lineItems: [{ description: "Hire", quantity: 1, unitAmountMinor: 100 }] }],
  ])("refuses %s", (_, quote) => {
    expect(ProposalMessageDraftRequestSchema.safeParse({ quote }).success).toBe(false);
  });
});
