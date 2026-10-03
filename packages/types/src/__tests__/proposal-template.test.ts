import { describe, expect, it } from "vitest";
import {
  CreateProposalTemplateSchema,
  MAX_TEMPLATE_LINES,
  ProposalTemplateContentSchema,
  ReplaceProposalTemplateSchema,
} from "../proposal-template.js";
import { ENQUIRY_OCCASION_KEYS, occasionLabel } from "../enquiry.js";

// ---------------------------------------------------------------------------
// Proposal templates (T-635, roadmap X1; Tier B #16): what a template may
// keep, in the shape the API stores and the composer matches.
// ---------------------------------------------------------------------------

const ENTRY = "1D6B3F3A-4C8B-4B6E-9A51-7E2D8C9F0A11";
const ROOM = "00000000-0000-4000-8000-000000000011";

const valid = {
  name: "  Grand Hall wedding ",
  spaceId: ROOM,
  occasion: " Wedding ",
  message: "Thank you for thinking of the Grand Hall.",
  lines: [
    { kind: "price_list", pricingRuleId: ENTRY, name: "Grand Hall — Evening Event", ruleType: "flat_rate", quantity: 1 },
    { kind: "price_list", pricingRuleId: ENTRY, name: "Dinner", ruleType: "per_head", quantity: null },
    { kind: "typed", description: "Piper", quantity: 1 },
  ],
};

describe("a template to keep", () => {
  it("keeps a name, room, occasion, message and lines in the shape they are matched on", () => {
    const parsed = CreateProposalTemplateSchema.parse(valid);
    expect(parsed.name).toBe("Grand Hall wedding");
    expect(parsed.occasion).toBe("wedding");
    expect(parsed.lines[0]).toMatchObject({ pricingRuleId: ENTRY.toLowerCase() });
    expect(CreateProposalTemplateSchema.parse({ ...valid, spaceId: null, occasion: null }).occasion).toBeNull();
  });

  it("keeps a message of nothing but spaces as none, and refuses an empty template", () => {
    expect(CreateProposalTemplateSchema.parse({ ...valid, message: "   " }).message).toBe("");
    const empty = CreateProposalTemplateSchema.safeParse({ ...valid, message: "  ", lines: [] });
    expect(empty.success).toBe(false);
    expect(empty.error?.issues[0]?.message).toBe("A template keeps a message or at least one line");
  });

  it("holds the message to what the venue may promise, as a proposal's is", () => {
    const promise = CreateProposalTemplateSchema.safeParse({ ...valid, message: "The Grand Hall is guaranteed accessible." });
    expect(promise.success).toBe(false);
    expect(promise.error?.issues[0]?.path).toEqual(["message"]);
  });

  it("keeps no quantity for a price a head or a tiered price, which takes the event's guests", () => {
    for (const ruleType of ["per_head", "tiered"] as const) {
      const kept = CreateProposalTemplateSchema.safeParse({
        ...valid, lines: [{ kind: "price_list", pricingRuleId: ENTRY, name: "Dinner", ruleType, quantity: 120 }],
      });
      expect(kept.success).toBe(false);
      expect(kept.error?.issues[0]?.path).toEqual(["lines", 0, "quantity"]);
    }
    for (const ruleType of ["flat_rate", "per_hour"] as const) {
      expect(CreateProposalTemplateSchema.safeParse({
        ...valid, lines: [{ kind: "price_list", pricingRuleId: ENTRY, name: "Late bar", ruleType, quantity: 4 }],
      }).success).toBe(true);
    }
  });

  it("refuses more lines than a template keeps, an unknown kind, and anything extra", () => {
    const line = { kind: "typed", description: "Piper", quantity: 1 };
    expect(CreateProposalTemplateSchema.safeParse({ ...valid, lines: Array.from({ length: MAX_TEMPLATE_LINES }, () => line) }).success).toBe(true);
    expect(CreateProposalTemplateSchema.safeParse({ ...valid, lines: Array.from({ length: MAX_TEMPLATE_LINES + 1 }, () => line) }).success).toBe(false);
    expect(CreateProposalTemplateSchema.safeParse({ ...valid, lines: [{ kind: "package", description: "Dinner" }] }).success).toBe(false);
    expect(CreateProposalTemplateSchema.safeParse({ ...valid, lines: [{ ...line, unitAmountMinor: 25_000 }] }).success).toBe(false);
    expect(CreateProposalTemplateSchema.safeParse({ ...valid, venueId: ROOM }).success).toBe(false);
  });

  it("refuses a name or an occasion longer than is kept, measured as kept", () => {
    expect(CreateProposalTemplateSchema.safeParse({ ...valid, name: "N".repeat(121) }).success).toBe(false);
    expect(CreateProposalTemplateSchema.safeParse({ ...valid, name: "   " }).success).toBe(false);
    expect(CreateProposalTemplateSchema.safeParse({ ...valid, occasion: "o".repeat(100) }).success).toBe(true);
    // Lower-cased, "İ" becomes two characters: 100 typed are 101 kept.
    expect(CreateProposalTemplateSchema.safeParse({ ...valid, occasion: `İ${"o".repeat(99)}` }).success).toBe(false);
  });

  it("refuses a NUL anywhere in its words, which PostgreSQL cannot keep", () => {
    const [hire, dinner, piper] = valid.lines;
    for (const carrying of [
      { name: "Grand Hall\u0000wedding" },
      { occasion: "wed\u0000ding" },
      { message: "Thank you\u0000." },
      { lines: [{ ...hire, name: "Grand Hall\u0000hire" }, dinner, piper] },
      { lines: [hire, dinner, { ...piper, description: "Pip\u0000er" }] },
    ]) {
      expect(CreateProposalTemplateSchema.safeParse({ ...valid, ...carrying }).success, JSON.stringify(carrying)).toBe(false);
    }
    expect(ProposalTemplateContentSchema.safeParse({ message: "Thank you\u0000.", lines: [] }).success).toBe(false);
  });

  it("refuses half a surrogate pair anywhere in its words, which jsonb cannot keep, and keeps a whole one", () => {
    const [hire, dinner, piper] = valid.lines;
    for (const carrying of [
      { name: "Wedding \ud83c" },
      { occasion: "wedding \udc00" },
      { message: "Thank you \ud83c." },
      { lines: [{ ...hire, name: "Dinner \udc00" }, dinner, piper] },
      { lines: [hire, dinner, { ...piper, description: "Piper \ud83c" }] },
    ]) {
      expect(CreateProposalTemplateSchema.safeParse({ ...valid, ...carrying }).success, JSON.stringify(carrying)).toBe(false);
    }
    expect(CreateProposalTemplateSchema.safeParse({ ...valid, name: "Wedding 🎉", lines: [hire, dinner, { ...piper, description: "Piper 🎵" }] }).success)
      .toBe(true);
  });
});

describe("replacing a template", () => {
  it("names the moment it was read", () => {
    expect(ReplaceProposalTemplateSchema.safeParse(valid).success).toBe(false);
    expect(ReplaceProposalTemplateSchema.safeParse({ ...valid, expectedUpdatedAt: "2026-09-29T10:00:00.123Z" }).success).toBe(true);
    expect(ReplaceProposalTemplateSchema.safeParse({ ...valid, expectedUpdatedAt: "yesterday" }).success).toBe(false);
  });

  it("names only a moment PostgreSQL can hold: UTC years 1 to 9999", () => {
    const at = (expectedUpdatedAt: string): boolean => ReplaceProposalTemplateSchema.safeParse({ ...valid, expectedUpdatedAt }).success;
    expect(at("0001-01-01T00:00:00Z")).toBe(true);
    expect(at("9999-12-31T23:59:59.999Z")).toBe(true);
    expect(at("0000-06-01T00:00:00Z")).toBe(false);
    // Within range as written, outside it once in UTC.
    expect(at("0001-01-01T00:30:00+01:00")).toBe(false);
    expect(at("9999-12-31T23:00:00-05:00")).toBe(false);
  });
});

describe("a stored template's content", () => {
  it("reads what was kept, and refuses what no longer fits", () => {
    expect(ProposalTemplateContentSchema.safeParse({ message: valid.message, lines: valid.lines }).success).toBe(true);
    expect(ProposalTemplateContentSchema.safeParse({ message: "", lines: "not lines" }).success).toBe(false);
    expect(ProposalTemplateContentSchema.safeParse({ message: "", lines: [{ kind: "typed", description: "", quantity: 1 }] }).success).toBe(false);
  });
});

describe("the occasions a template can be for", () => {
  it("offers every occasion the venue names, each with its label", () => {
    expect(ENQUIRY_OCCASION_KEYS).toEqual(["wedding", "dinner", "conference", "reception", "corporate", "ceremony", "concert", "private", "other"]);
    expect(ENQUIRY_OCCASION_KEYS.map((key) => occasionLabel(key))).not.toContain(null);
  });
});
