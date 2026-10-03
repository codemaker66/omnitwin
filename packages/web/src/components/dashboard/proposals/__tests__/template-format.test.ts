import { describe, expect, it } from "vitest";
import type { ProposalTemplate, ProposalTemplateLine } from "@omnitwin/types";
import type { PricingRule } from "../../../../api/pricing.js";
import { EMPTY_DRAFT, type ComposerDraft } from "../proposals-desk-format.js";
import {
  applyTemplate,
  hasWords,
  occasionKeyOf,
  suggestedTemplateName,
  templateContents,
  templateFromDraft,
  templateGroups,
  templateScope,
  wordsInComposer,
  type TemplateEvent,
} from "../template-format.js";

// ---------------------------------------------------------------------------
// Proposal templates in the composer (roadmap X1; Tier B #16). A template
// holds no price: its price-list lines are priced from the list as it stands,
// for the event at hand, and whatever cannot be used as saved is said.
// ---------------------------------------------------------------------------

const VENUE = "00000000-0000-4000-8000-000000000001";
const GRAND_HALL = "00000000-0000-4000-8000-000000000011";
const SALOON = "00000000-0000-4000-8000-000000000012";
const HIRE = "00000000-0000-4000-8000-0000000000a1";
const DINNER = "00000000-0000-4000-8000-0000000000a2";
const BAR = "00000000-0000-4000-8000-0000000000a3";
const WINTER = "00000000-0000-4000-8000-0000000000a4";
const BUFFET = "00000000-0000-4000-8000-0000000000a5";
const SALOON_BAR = "00000000-0000-4000-8000-0000000000a6";
const HALL_BAR = "00000000-0000-4000-8000-0000000000a7";

function rule(overrides: Partial<PricingRule> & Pick<PricingRule, "id">): PricingRule {
  return {
    venueId: VENUE, spaceId: null, name: "Entry", type: "flat_rate", amount: "100.00", currency: "GBP",
    minHours: null, minGuests: null, tiers: null, dayOfWeekModifiers: null, seasonalModifiers: null,
    isActive: true, validFrom: null, validTo: null, ...overrides,
  };
}

const HIRE_RULE = rule({ id: HIRE, spaceId: GRAND_HALL, name: "Grand Hall — Evening Event", amount: "2400.00" });
const DINNER_RULE = rule({ id: DINNER, name: "Dinner", type: "per_head", amount: "65.00", minGuests: 100 });
const BAR_RULE = rule({ id: BAR, name: "Late bar", type: "per_hour", amount: "180.00", minHours: 3 });
const WINTER_RULE = rule({ id: WINTER, name: "Winter dinner", type: "per_head", amount: "55.00", validFrom: "2027-11-01", validTo: "2028-02-28" });
const RULES = [HIRE_RULE, DINNER_RULE, BAR_RULE, WINTER_RULE];
const BUFFET_RULE = rule({ id: BUFFET, name: "Buffet", type: "tiered", tiers: [{ upTo: 50, amount: 1000 }, { upTo: 100, amount: 1500 }] });
const SALOON_BAR_RULE = rule({ id: SALOON_BAR, spaceId: SALOON, name: "Saloon bar", amount: "300.00" });
const HALL_BAR_RULE = rule({ id: HALL_BAR, spaceId: GRAND_HALL, name: "Grand Hall bar", amount: "500.00" });

/** Saturday 5 June 2027, a wedding in the Grand Hall for 120. */
const EVENT: TemplateEvent = { spaceId: GRAND_HALL, eventDate: "2027-06-05", guestCount: 120, roomName: "Grand Hall", occasion: "Wedding" };

function nameOfRoom(spaceId: string): string | null {
  return spaceId === GRAND_HALL ? "Grand Hall" : spaceId === SALOON ? "Saloon" : null;
}

function priceList(id: string, name: string, ruleType: PricingRule["type"], quantity: number | null = null): ProposalTemplateLine {
  return { kind: "price_list", pricingRuleId: id, name, ruleType, quantity };
}

function template(overrides: Partial<ProposalTemplate> = {}): ProposalTemplate {
  return {
    id: "00000000-0000-4000-8000-0000000000f1", venueId: VENUE, spaceId: GRAND_HALL, roomName: "Grand Hall", roomListed: true,
    occasion: "wedding", name: "Grand Hall wedding", message: "Thank you for thinking of the Grand Hall.",
    lines: [
      priceList(HIRE, "Grand Hall — Evening Event", "flat_rate", 1),
      priceList(DINNER, "Dinner", "per_head"),
      priceList(BAR, "Late bar", "per_hour", 4),
      { kind: "typed", description: "Piper", quantity: 1 },
    ],
    readable: true, createdAt: "2026-09-29T10:00:00.000Z", updatedAt: "2026-09-29T10:00:00.000Z", updatedByName: "Anna Reid",
    ...overrides,
  };
}

describe("starting from a template", () => {
  it("takes its message and lines, each price from the list as it stands, and asks for the typed price", () => {
    const applied = applyTemplate(template(), RULES, EVENT, EMPTY_DRAFT, "replace", nameOfRoom);
    expect(applied.draft.message).toBe("Thank you for thinking of the Grand Hall.");
    expect(applied.draft.lines.map(({ description, quantity, pounds }) => ({ description, quantity, pounds }))).toEqual([
      { description: "Grand Hall — Evening Event", quantity: "1", pounds: "2400" },
      { description: "Dinner", quantity: "120", pounds: "65" },
      { description: "Late bar", quantity: "4", pounds: "180" },
      { description: "Piper", quantity: "1", pounds: "" },
    ]);
    expect(applied.summary).toBe("Started from Grand Hall wedding: the message and its 4 lines.");
    expect(applied.said).toEqual([]);
    expect(applied.lineSaid).toEqual(["Enter the price for Piper (line 4)."]);
    expect(applied.focus).toEqual({ line: 3, field: "pounds" });
  });

  it("marks each priced line as the list's, so saving it again keeps the entry", () => {
    const applied = applyTemplate(template(), RULES, EVENT, EMPTY_DRAFT, "replace", nameOfRoom);
    expect(applied.draft.lines[1]?.listed).toEqual({ pricingRuleId: DINNER, ruleType: "per_head", description: "Dinner" });
    expect(applied.draft.lines[3]?.listed).toBeUndefined();
  });

  it("uses today's price and the entry's own name, never the template's", () => {
    const raised = [rule({ ...HIRE_RULE, name: "Grand Hall — Evening", amount: "2600.00" }), DINNER_RULE, BAR_RULE];
    const applied = applyTemplate(template(), raised, EVENT, EMPTY_DRAFT, "replace", nameOfRoom);
    expect(applied.draft.lines[0]).toMatchObject({ description: "Grand Hall — Evening", pounds: "2600" });
  });

  it("says what is no longer on the list, or not priced for the date, and leaves it out", () => {
    const withWinter = template({ lines: [...template().lines, priceList(WINTER, "Winter dinner", "per_head")] });
    const withoutBar = RULES.filter((entry) => entry.id !== BAR);
    const applied = applyTemplate(withWinter, withoutBar, EVENT, EMPTY_DRAFT, "replace", nameOfRoom);
    expect(applied.draft.lines.map((line) => line.description)).toEqual(["Grand Hall — Evening Event", "Dinner", "Piper"]);
    expect(applied.summary).toBe("Started from Grand Hall wedding: the message and 3 of its 5 lines.");
    expect(applied.said).toEqual([
      "No longer on the price list: Late bar.",
      "Not priced for 5 June 2027: Winter dinner.",
    ]);
    expect(applied.lineSaid).toEqual(["Enter the price for Piper (line 3)."]);
  });

  it("treats a switched-off entry as off the list", () => {
    const off = [HIRE_RULE, DINNER_RULE, rule({ ...BAR_RULE, isActive: false })];
    expect(applyTemplate(template(), off, EVENT, EMPTY_DRAFT, "replace", nameOfRoom).said[0]).toBe("No longer on the price list: Late bar.");
  });

  it("raises the hours to a new minimum and says so, and asks for hours it never kept", () => {
    const longer = [HIRE_RULE, DINNER_RULE, rule({ ...BAR_RULE, minHours: 5 })];
    const raised = applyTemplate(template(), longer, EVENT, EMPTY_DRAFT, "replace", nameOfRoom);
    expect(raised.draft.lines[2]?.quantity).toBe("5");
    expect(raised.lineSaid).toContain("Late bar is at least 5 hours, so line 3 is 5.");

    const noHours = template({ lines: [priceList(BAR, "Late bar", "per_hour")] });
    const asked = applyTemplate(noHours, RULES, EVENT, EMPTY_DRAFT, "replace", nameOfRoom);
    expect(asked.draft.lines[0]?.quantity).toBe("3");
    expect(asked.lineSaid).toEqual(["Enter the hours for Late bar (line 1)."]);
    expect(asked.focus).toEqual({ line: 0, field: "quantity" });
  });

  it("says the least hours as they stand when the template was saved below them", () => {
    const short = template({ lines: [priceList(BAR, "Late bar", "per_hour", 2)] });
    const applied = applyTemplate(short, RULES, EVENT, EMPTY_DRAFT, "replace", nameOfRoom);
    expect(applied.draft.lines[0]?.quantity).toBe("3");
    expect(applied.lineSaid).toEqual(["Late bar is at least 3 hours, so line 1 is 3."]);
  });

  it("says when an added line's entry is priced for a room other than the event's, room by room", () => {
    const rules = [...RULES, SALOON_BAR_RULE, HALL_BAR_RULE];
    const anyRoom = (lines: readonly ProposalTemplateLine[]): ProposalTemplate => template({ spaceId: null, roomName: null, lines: [...lines] });
    const saloonBar = priceList(SALOON_BAR, "Saloon bar", "flat_rate", 1);
    const inHall = applyTemplate(anyRoom([priceList(HIRE, "Grand Hall — Evening Event", "flat_rate", 1), saloonBar]), rules, EVENT, EMPTY_DRAFT, "replace", nameOfRoom);
    expect(inHall.draft.lines.map((line) => line.description)).toEqual(["Grand Hall — Evening Event", "Saloon bar"]);
    expect(inHall.said).toEqual(["Saloon bar is priced for the Saloon."]);
    expect(applyTemplate(anyRoom([saloonBar]), rules, EVENT, EMPTY_DRAFT, "replace", () => null).said)
      .toEqual(["Saloon bar is priced for another room."]);

    const noRoom: TemplateEvent = { ...EVENT, spaceId: null, roomName: null };
    const all = anyRoom([priceList(HIRE, "Grand Hall — Evening Event", "flat_rate", 1), saloonBar, priceList(HALL_BAR, "Grand Hall bar", "flat_rate", 1), saloonBar]);
    expect(applyTemplate(all, rules, noRoom, EMPTY_DRAFT, "replace", nameOfRoom).said).toEqual([
      "Grand Hall — Evening Event and Grand Hall bar are priced for the Grand Hall.",
      "Saloon bar is priced for the Saloon.",
    ]);

    const quoted: ComposerDraft = { ...EMPTY_DRAFT, lines: [{ description: "Saloon bar", quantity: "1", pounds: "300" }] };
    expect(applyTemplate(anyRoom([saloonBar]), rules, EVENT, quoted, "add", nameOfRoom).said)
      .toEqual(["Already in the quote, so not added again: Saloon bar."]);
  });

  it("says the dates an added entry is priced for while the event has no date, as the list does", () => {
    const winter = template({ lines: [priceList(WINTER, "Winter dinner", "per_head")] });
    const undated: TemplateEvent = { ...EVENT, eventDate: null };
    expect(applyTemplate(winter, RULES, undated, EMPTY_DRAFT, "replace", nameOfRoom).said)
      .toEqual(["Winter dinner is priced 1 November 2027 to 28 February 2028, and the event has no date yet."]);
    const fromOnly = [rule({ ...WINTER_RULE, validTo: null })];
    expect(applyTemplate(winter, fromOnly, undated, EMPTY_DRAFT, "replace", nameOfRoom).said)
      .toEqual(["Winter dinner is priced from 1 November 2027, and the event has no date yet."]);
    expect(applyTemplate(winter, RULES, { ...EVENT, eventDate: "2027-12-04" }, EMPTY_DRAFT, "replace", nameOfRoom).said).toEqual([]);
    const quoted: ComposerDraft = { ...EMPTY_DRAFT, lines: [{ description: "Winter dinner", quantity: "120", pounds: "55" }] };
    expect(applyTemplate(winter, RULES, undated, quoted, "add", nameOfRoom).said)
      .toEqual(["Already in the quote, so not added again: Winter dinner."]);
  });

  it("says when the guests are more than an added entry's tiers go up to, as the list does", () => {
    const buffet = template({ lines: [priceList(BUFFET, "Buffet", "tiered")] });
    const many = applyTemplate(buffet, [...RULES, BUFFET_RULE], EVENT, EMPTY_DRAFT, "replace", nameOfRoom);
    expect(many.draft.lines[0]).toMatchObject({ description: "Buffet", quantity: "1", pounds: "1500" });
    expect(many.said).toEqual(["Buffet is £1,500, the price for the most guests (up to 100), and the event has 120 guests."]);
    expect(applyTemplate(buffet, [...RULES, BUFFET_RULE], { ...EVENT, guestCount: 80 }, EMPTY_DRAFT, "replace", nameOfRoom).said).toEqual([]);

    const fromJanuary = [rule({ ...BUFFET_RULE, validFrom: "2027-01-01" })];
    expect(applyTemplate(buffet, fromJanuary, { ...EVENT, eventDate: null }, EMPTY_DRAFT, "replace", nameOfRoom).said).toEqual([
      "Buffet is priced from 1 January 2027, and the event has no date yet.",
      "Buffet is £1,500, the price for the most guests (up to 100), and the event has 120 guests.",
    ]);
  });

  it("says each fact once when the template holds the same entry twice", () => {
    const twice = template({ lines: [priceList(BAR, "Late bar", "per_hour", 4), priceList(BAR, "Late bar", "per_hour", 4)] });
    const saturdays = [HIRE_RULE, DINNER_RULE, rule({ ...BAR_RULE, dayOfWeekModifiers: { saturday: 1.25 } })];
    const applied = applyTemplate(twice, saturdays, EVENT, EMPTY_DRAFT, "replace", nameOfRoom);
    expect(applied.draft.lines).toHaveLength(2);
    expect(applied.said).toEqual(["Late bar, Saturdays: 25% more, so £225."]);

    expect(applyTemplate(twice, [HIRE_RULE], EVENT, EMPTY_DRAFT, "replace", nameOfRoom).said).toEqual(["No longer on the price list: Late bar."]);
    expect(applyTemplate(twice, [rule({ ...BAR_RULE, currency: "USD" })], EVENT, EMPTY_DRAFT, "replace", nameOfRoom).said)
      .toEqual(["Priced in another currency, and the quote is in pounds: Late bar."]);
    const winterTwice = template({ lines: [priceList(WINTER, "Winter dinner", "per_head"), priceList(WINTER, "Winter dinner", "per_head")] });
    expect(applyTemplate(winterTwice, RULES, EVENT, EMPTY_DRAFT, "replace", nameOfRoom).said).toEqual(["Not priced for 5 June 2027: Winter dinner."]);
    const quoted: ComposerDraft = { ...EMPTY_DRAFT, lines: [{ description: "Late bar", quantity: "4", pounds: "180" }] };
    expect(applyTemplate(twice, RULES, EVENT, quoted, "add", nameOfRoom).said).toEqual(["Already in the quote, so not added again: Late bar."]);
  });

  it("compares an occasion typed as its label with its key, and says it in the venue's words", () => {
    expect(applyTemplate(template({ occasion: "reception" }), RULES, { ...EVENT, occasion: "Drinks reception" }, EMPTY_DRAFT, "replace", nameOfRoom).said)
      .toEqual([]);
    expect(applyTemplate(template(), RULES, { ...EVENT, occasion: "Drinks reception" }, EMPTY_DRAFT, "replace", nameOfRoom).said)
      .toEqual(["This template is for a wedding. The event is a drinks reception."]);
    expect(applyTemplate(template({ occasion: "drinks reception" }), RULES, EVENT, EMPTY_DRAFT, "replace", nameOfRoom).said)
      .toEqual(["This template is for a drinks reception. The event is a wedding."]);
  });

  it("takes the event's guests for a price a head, its minimum when fewer, and asks when there is no count", () => {
    const few = applyTemplate(template(), RULES, { ...EVENT, guestCount: 80 }, EMPTY_DRAFT, "replace", nameOfRoom);
    expect(few.draft.lines[1]?.quantity).toBe("100");
    expect(few.lineSaid).toContain("Dinner is for the minimum of 100 (line 2).");

    const none = applyTemplate(template(), RULES, { ...EVENT, guestCount: null }, EMPTY_DRAFT, "replace", nameOfRoom);
    expect(none.lineSaid).toContain("Enter the guests for Dinner (line 2).");
    expect(none.focus).toEqual({ line: 1, field: "quantity" });
  });

  it("does not trust a kept quantity once the entry is priced differently", () => {
    const perHead = [rule({ ...HIRE_RULE, type: "per_head", amount: "20.00" }), DINNER_RULE, BAR_RULE];
    const applied = applyTemplate(template(), perHead, EVENT, EMPTY_DRAFT, "replace", nameOfRoom);
    expect(applied.draft.lines[0]).toMatchObject({ quantity: "120", pounds: "20" });
    expect(applied.lineSaid).toContain("Grand Hall — Evening Event is priced differently since the template was saved. Check line 1.");
    expect(applied.focus).toEqual({ line: 0, field: "quantity" });
  });

  it("says first when the template is for another room or occasion", () => {
    const saloon: TemplateEvent = { ...EVENT, spaceId: SALOON, roomName: "Saloon", occasion: "conference" };
    const applied = applyTemplate(template(), RULES, saloon, EMPTY_DRAFT, "replace", nameOfRoom);
    expect(applied.said.slice(0, 2)).toEqual([
      "This template is for the Grand Hall. The event is in the Saloon.",
      "This template is for a wedding. The event is a conference.",
    ]);
    const unknown = applyTemplate(template(), RULES, { ...EVENT, spaceId: null, roomName: null, occasion: null }, EMPTY_DRAFT, "replace", nameOfRoom);
    expect(unknown.said.slice(0, 2)).toEqual([
      "This template is for the Grand Hall. The event has no room yet.",
      "This template is for a wedding. The event has no occasion yet.",
    ]);
  });

  it("says a day's adjustment on the date, and that none is applied with no date", () => {
    const saturdays = [rule({ ...HIRE_RULE, dayOfWeekModifiers: { saturday: 1.25 } }), DINNER_RULE, BAR_RULE];
    const dated = applyTemplate(template(), saturdays, EVENT, EMPTY_DRAFT, "replace", nameOfRoom);
    expect(dated.draft.lines[0]?.pounds).toBe("3000");
    expect(dated.said).toContain("Grand Hall — Evening Event, Saturdays: 25% more, so £3,000.");

    const undated = applyTemplate(template(), saturdays, { ...EVENT, eventDate: null }, EMPTY_DRAFT, "replace", nameOfRoom);
    expect(undated.said).toContain("With no date yet, no day or month adjustments are applied.");
    expect(undated.draft.lines[0]?.pounds).toBe("2400");
  });

  it("leaves the message alone when the template has none, and never touches the capacity note", () => {
    const written: ComposerDraft = { message: "Dear Elaine,", capacityNote: "About 120 seated.", lines: [] };
    const applied = applyTemplate(template({ message: "" }), RULES, EVENT, written, "replace", nameOfRoom);
    expect(applied.draft.message).toBe("Dear Elaine,");
    expect(applied.draft.capacityNote).toBe("About 120 seated.");
    expect(applied.summary).toBe("Started from Grand Hall wedding: its 4 lines.");
  });

  it("leaves the quote alone when the template has no lines, or none that can be used, and says so", () => {
    const written: ComposerDraft = { message: "", capacityNote: "", lines: [{ description: "Grand Hall hire", quantity: "1", pounds: "4400" }] };
    const wordsOnly = applyTemplate(template({ lines: [] }), RULES, EVENT, written, "replace", nameOfRoom);
    expect(wordsOnly.draft.lines).toEqual(written.lines);
    expect(wordsOnly.draft.message).toBe("Thank you for thinking of the Grand Hall.");
    expect(wordsOnly.summary).toBe("Started from Grand Hall wedding: the message.");
    const allGone = applyTemplate(template({ lines: [priceList(BAR, "Late bar", "per_hour", 4)] }), [HIRE_RULE], EVENT, written, "replace", nameOfRoom);
    expect(allGone.draft.lines).toEqual(written.lines);
    expect(allGone.said).toContain("None of its lines could be used, so the quote is as it was.");
  });

  it("says a line's adjustment only when the line is added", () => {
    const saturdays = [rule({ ...HIRE_RULE, dayOfWeekModifiers: { saturday: 1.25 } }), DINNER_RULE, BAR_RULE];
    const quoted: ComposerDraft = { ...EMPTY_DRAFT, lines: [{ description: "Grand Hall — Evening Event", quantity: "1", pounds: "2400" }] };
    const added = applyTemplate(template(), saturdays, EVENT, quoted, "add", nameOfRoom);
    expect(added.said).not.toContain("Grand Hall — Evening Event, Saturdays: 25% more, so £3,000.");
    expect(added.said).toContain("Already in the quote, so not added again: Grand Hall — Evening Event.");
  });

  it("says when nothing could be used", () => {
    const applied = applyTemplate(template({ message: "", lines: [priceList(BAR, "Late bar", "per_hour", 4)] }), [HIRE_RULE], EVENT, EMPTY_DRAFT, "replace", nameOfRoom);
    expect(applied.summary).toBe("Nothing from Grand Hall wedding could be used.");
    expect(applied.focus).toBe("message");
  });
});

describe("adding a template's lines", () => {
  const written: ComposerDraft = {
    message: "Dear Elaine,",
    capacityNote: "",
    lines: [{ description: "Grand Hall — Evening Event", quantity: "1", pounds: "2400" }],
  };

  it("keeps the message and the lines there, skips what is already in the quote, and numbers on", () => {
    const applied = applyTemplate(template(), RULES, EVENT, written, "add", nameOfRoom);
    expect(applied.draft.message).toBe("Dear Elaine,");
    expect(applied.draft.lines.map((line) => line.description)).toEqual(["Grand Hall — Evening Event", "Dinner", "Late bar", "Piper"]);
    expect(applied.summary).toBe("Added 3 of Grand Hall wedding's 4 lines.");
    expect(applied.said).toEqual(["Already in the quote, so not added again: Grand Hall — Evening Event."]);
    expect(applied.lineSaid).toEqual(["Enter the price for Piper (line 4)."]);
    expect(applied.focus).toEqual({ line: 3, field: "pounds" });
  });

  it("does not add again an entry quoted under the name the template saved it by, since renamed", () => {
    const savedAs = template({ lines: [priceList(HIRE, "Grand Hall hire", "flat_rate", 1), priceList(DINNER, "Dinner", "per_head")] });
    const carried: ComposerDraft = { ...EMPTY_DRAFT, lines: [{ description: "Grand Hall hire", quantity: "1", pounds: "2400" }] };
    const applied = applyTemplate(savedAs, RULES, EVENT, carried, "add", nameOfRoom);
    expect(applied.draft.lines.map((line) => line.description)).toEqual(["Grand Hall hire", "Dinner"]);
    expect(applied.said).toEqual(["Already in the quote, so not added again: Grand Hall hire."]);
  });

  it("does not add again an entry added from the list and renamed since, while its words are as added", () => {
    const hire = template({ lines: [priceList(HIRE, "Grand Hall — Evening Event", "flat_rate", 1)] });
    const listed = { pricingRuleId: HIRE, ruleType: "flat_rate", description: "Hall hire" } as const;
    const added: ComposerDraft = { ...EMPTY_DRAFT, lines: [{ description: "Hall hire", quantity: "1", pounds: "2400", listed }] };
    const applied = applyTemplate(hire, RULES, EVENT, added, "add", nameOfRoom);
    expect(applied.draft.lines).toHaveLength(1);
    expect(applied.said).toEqual(["Already in the quote, so not added again: Hall hire."]);

    // Its words changed since, so it is the booker's own line, and the entry is added.
    const reworded: ComposerDraft = { ...EMPTY_DRAFT, lines: [{ description: "Hall hire, reduced", quantity: "1", pounds: "2000", listed }] };
    const again = applyTemplate(hire, RULES, EVENT, reworded, "add", nameOfRoom);
    expect(again.draft.lines.map((line) => line.description)).toEqual(["Hall hire, reduced", "Grand Hall — Evening Event"]);
    expect(again.said).toEqual([]);
  });

  it("says when nothing was added", () => {
    const all: ComposerDraft = { ...written, lines: applyTemplate(template(), RULES, EVENT, EMPTY_DRAFT, "replace", nameOfRoom).draft.lines };
    expect(applyTemplate(template(), RULES, EVENT, all, "add", nameOfRoom).summary).toBe("Nothing was added from Grand Hall wedding.");
  });
});

describe("saving the composer as a template", () => {
  const priced = applyTemplate(template(), RULES, EVENT, EMPTY_DRAFT, "replace", nameOfRoom).draft;
  const roomName = (spaceId: string): string | null => (spaceId === GRAND_HALL ? "Grand Hall" : null);

  it("keeps each line from the list as the entry, and typed lines as typed", () => {
    const kept = templateFromDraft({ ...priced, lines: priced.lines.map((line) => (line.description === "Piper" ? { ...line, pounds: "250" } : line)) }, RULES, EVENT, GRAND_HALL, roomName);
    expect(kept.lines).toEqual([
      priceList(HIRE, "Grand Hall — Evening Event", "flat_rate", 1),
      priceList(DINNER, "Dinner", "per_head"),
      priceList(BAR, "Late bar", "per_hour", 4),
      { kind: "typed", description: "Piper", quantity: 1 },
    ]);
    expect(kept.said).toEqual([
      "The message.",
      "From the price list, priced each time it is used: Grand Hall — Evening Event; Dinner, for the event's guests; Late bar, 4 hours.",
      "Typed, with the price entered each time: Piper.",
    ]);
    expect(kept.refusal).toBeNull();
  });

  it("keeps a line whose words were changed as typed, and says when a price differs from the list's", () => {
    const edited = priced.lines.map((line) => (line.description === "Dinner" ? { ...line, pounds: "60" }
      : line.description === "Late bar" ? { ...line, description: "Late bar until 2am" } : line));
    const kept = templateFromDraft({ ...priced, lines: edited, capacityNote: "About 120 seated." }, RULES, EVENT, GRAND_HALL, roomName);
    expect(kept.lines[2]).toEqual({ kind: "typed", description: "Late bar until 2am", quantity: 4 });
    expect(kept.said).toContain("Your price for Dinner, £60, differs from the list's £65. The template takes the list's price each time.");
    expect(kept.said).toContain("The capacity note is not kept.");
  });

  it("says when the hours kept are fewer than the entry's least, which using it raises them to", () => {
    const listed = { pricingRuleId: BAR, ruleType: "per_hour", description: "Late bar" } as const;
    const kept = templateFromDraft({ ...EMPTY_DRAFT, lines: [{ description: "Late bar", quantity: "2", pounds: "180", listed }] }, RULES, EVENT, GRAND_HALL, roomName);
    expect(kept.lines).toEqual([priceList(BAR, "Late bar", "per_hour", 2)]);
    expect(kept.said).toEqual(["From the price list, priced each time it is used: Late bar, 2 hours (it is at least 3 when used)."]);
  });

  it("says each fact once when the composer holds the same line twice", () => {
    const listed = { pricingRuleId: BAR, ruleType: "per_hour", description: "Late bar" } as const;
    const bar = { description: "Late bar", quantity: "4", pounds: "200", listed };
    const piper = { description: "Piper", quantity: "1", pounds: "250" };
    const kept = templateFromDraft({ ...EMPTY_DRAFT, lines: [bar, piper, bar, piper] }, RULES, EVENT, GRAND_HALL, roomName);
    expect(kept.lines).toHaveLength(4);
    expect(kept.said).toEqual([
      "From the price list, priced each time it is used: Late bar, 4 hours.",
      "Typed, with the price entered each time: Piper.",
      "Your price for Late bar, £200, differs from the list's £180. The template takes the list's price each time.",
    ]);
  });

  it("needs a room for a room's price, and refuses an empty template or one over the limit", () => {
    expect(templateFromDraft(priced, RULES, EVENT, null, roomName).refusal)
      .toBe("Grand Hall — Evening Event is priced for the Grand Hall, so this template needs a room.");
    expect(templateFromDraft(EMPTY_DRAFT, RULES, EVENT, null, roomName).refusal)
      .toBe("There is nothing to keep yet. Write the message or add a line first.");
    const many = Array.from({ length: 41 }, (_, index) => ({ description: `Line ${String(index + 1)}`, quantity: "1", pounds: "1" }));
    expect(templateFromDraft({ ...EMPTY_DRAFT, lines: many }, RULES, EVENT, GRAND_HALL, roomName).refusal)
      .toBe("A template keeps up to 40 lines; this quote has 41.");
  });
});

describe("saving lines carried from a saved version", () => {
  const roomName = (): string | null => "Grand Hall";
  const carried: ComposerDraft = {
    message: "",
    capacityNote: "",
    lines: [
      { description: "Grand Hall — Evening Event", quantity: "1", pounds: "2400" },
      { description: "Dinner", quantity: "120", pounds: "60" },
      { description: "Piper", quantity: "1", pounds: "250" },
    ],
  };

  it("keeps a carried line as the one entry that prices it so, and anything else as typed", () => {
    const kept = templateFromDraft(carried, RULES, EVENT, GRAND_HALL, roomName);
    expect(kept.lines).toEqual([
      priceList(HIRE, "Grand Hall — Evening Event", "flat_rate", 1),
      { kind: "typed", description: "Dinner", quantity: 120 },
      { kind: "typed", description: "Piper", quantity: 1 },
    ]);
  });

  it("keeps a carried line as typed when two entries share its name", () => {
    const twice = [...RULES, rule({ id: "00000000-0000-4000-8000-0000000000a9", spaceId: GRAND_HALL, name: "Grand Hall — Evening Event", amount: "2400.00" })];
    expect(templateFromDraft(carried, twice, EVENT, GRAND_HALL, roomName).lines[0]).toEqual({ kind: "typed", description: "Grand Hall — Evening Event", quantity: 1 });
  });
});

describe("the templates offered for an event", () => {
  const forHall = template({ id: "00000000-0000-4000-8000-0000000000f1", name: "Grand Hall wedding" });
  const hallAny = template({ id: "00000000-0000-4000-8000-0000000000f2", name: "Grand Hall any", occasion: null });
  const anyWedding = template({ id: "00000000-0000-4000-8000-0000000000f3", name: "Any wedding", spaceId: null, roomName: null });
  const anyAny = template({ id: "00000000-0000-4000-8000-0000000000f4", name: "Anything", spaceId: null, roomName: null, occasion: null });
  const saloon = template({ id: "00000000-0000-4000-8000-0000000000f5", name: "Saloon drinks", spaceId: SALOON, roomName: "Saloon", occasion: "reception" });
  const gone = template({ id: "00000000-0000-4000-8000-0000000000f6", name: "Old room", spaceId: "00000000-0000-4000-8000-000000000099", roomName: null, roomListed: false });
  const conference = template({ id: "00000000-0000-4000-8000-0000000000f7", name: "Conference", spaceId: null, roomName: null, occasion: "conference" });
  const broken = template({ id: "00000000-0000-4000-8000-0000000000f8", name: "Broken", readable: false, message: "", lines: [] });

  it("puts the closest first, then the rest with why they are not this event's", () => {
    const groups = templateGroups([anyAny, saloon, broken, anyWedding, gone, hallAny, conference, forHall], EVENT);
    expect(groups.map((group) => group.heading)).toEqual(["For this event", "Other templates"]);
    expect(groups[0]?.rows.map((row) => row.template.name)).toEqual(["Grand Hall wedding", "Grand Hall any", "Any wedding", "Anything"]);
    expect(groups[1]?.rows.map((row) => [row.template.name, row.reason])).toEqual([
      ["Broken", null],
      ["Conference", "For a conference"],
      ["Old room", "Its room is no longer listed"],
      ["Saloon drinks", "For the Saloon"],
    ]);
  });

  it("matches an occasion typed as its label to its key, and says it in the venue's words", () => {
    const hallReception = template({ id: "00000000-0000-4000-8000-0000000000f9", name: "Hall reception", occasion: "reception" });
    const groups = templateGroups([hallReception, forHall], { ...EVENT, occasion: "Drinks reception" });
    expect(groups.map((group) => [group.heading, group.rows.map((row) => [row.template.name, row.reason])])).toEqual([
      ["For this event", [["Hall reception", null]]],
      ["Other templates", [["Grand Hall wedding", "For a wedding"]]],
    ]);
    const keptAsWords = template({ id: "00000000-0000-4000-8000-0000000000fa", name: "Hall drinks", occasion: "drinks reception" });
    expect(templateGroups([keptAsWords], { ...EVENT, occasion: "reception" })[0]?.heading).toBe("For this event");
    expect(templateGroups([keptAsWords], EVENT)[0]?.rows[0]?.reason).toBe("For a drinks reception");
    expect(templateScope(keptAsWords)).toBe("Grand Hall · Drinks reception");
  });

  it("keys an occasion typed as its key or its label, and keeps any other as typed, lower-cased", () => {
    expect(occasionKeyOf("reception")).toBe("reception");
    expect(occasionKeyOf("  Drinks Reception ")).toBe("reception");
    expect(occasionKeyOf("Wedding")).toBe("wedding");
    expect(occasionKeyOf("Other occasion")).toBe("other");
    expect(occasionKeyOf(" Burns Supper ")).toBe("burns supper");
    expect(occasionKeyOf("   ")).toBeNull();
    expect(occasionKeyOf(null)).toBeNull();
    expect(occasionKeyOf(undefined)).toBeNull();
  });

  it("offers every template, without ranking, while the event is not known", () => {
    const groups = templateGroups([forHall, anyAny], null);
    expect(groups).toEqual([{ key: "other", heading: "Templates", rows: [
      { template: anyAny, reason: null },
      { template: forHall, reason: null },
    ] }]);
  });

  it("says each template's room, occasion and contents", () => {
    expect(templateScope(forHall)).toBe("Grand Hall · Wedding");
    expect(templateScope(anyAny)).toBe("Any room · Any occasion");
    expect(templateScope(gone)).toBe("A room no longer listed · Wedding");
    expect(templateContents(forHall)).toBe("The message and 4 lines");
    expect(templateContents(template({ message: "" }))).toBe("4 lines");
    expect(templateContents(template({ lines: [] }))).toBe("The message");
    expect(templateContents(template({ message: "", lines: [{ kind: "typed", description: "Piper", quantity: 1 }] }))).toBe("1 line");
    expect(templateContents(broken)).toBe("It can no longer be read, so it can only be removed");
  });

  it("names what the composer holds before a template replaces it", () => {
    expect(wordsInComposer({ ...EMPTY_DRAFT, message: "Dear Elaine,", lines: [{ description: "Hire", quantity: "1", pounds: "" }, { description: "Dinner", quantity: "1", pounds: "" }] }))
      .toBe("The composer already has a message and 2 lines.");
    expect(wordsInComposer({ ...EMPTY_DRAFT, message: "Dear Elaine," })).toBe("The composer already has a message.");
    expect(wordsInComposer({ ...EMPTY_DRAFT, lines: [{ description: "Hire", quantity: "1", pounds: "" }, { description: " ", quantity: "1", pounds: "" }] }))
      .toBe("The composer already has 1 line.");
  });

  it("counts words already in the composer, carried or written, but not a capacity note alone", () => {
    expect(hasWords(EMPTY_DRAFT)).toBe(false);
    expect(hasWords({ ...EMPTY_DRAFT, capacityNote: "About 120" })).toBe(false);
    expect(hasWords({ ...EMPTY_DRAFT, lines: [{ description: "  ", quantity: "1", pounds: "" }] })).toBe(false);
    expect(hasWords({ ...EMPTY_DRAFT, message: "Dear Elaine," })).toBe(true);
    expect(hasWords({ ...EMPTY_DRAFT, lines: [{ description: "Hire", quantity: "1", pounds: "" }] })).toBe(true);
  });
});

describe("the name a template is offered under", () => {
  it("names the room and the occasion, within the limit", () => {
    expect(suggestedTemplateName("Grand Hall", "wedding")).toBe("Grand Hall wedding");
    expect(suggestedTemplateName("Grand Hall", "reception")).toBe("Grand Hall drinks reception");
    expect(suggestedTemplateName(null, "wedding")).toBe("Wedding");
    expect(suggestedTemplateName("Grand Hall", null)).toBe("Grand Hall");
    expect(suggestedTemplateName(null, null)).toBe("");
    expect(suggestedTemplateName("R".repeat(200), "wedding")).toHaveLength(120);
  });

  it("never cuts a character in two at the limit", () => {
    expect(suggestedTemplateName(`${"R".repeat(119)}😀`, null)).toBe("R".repeat(119));
    expect(suggestedTemplateName(`${"R".repeat(118)}😀`, null)).toBe(`${"R".repeat(118)}😀`);
  });
});
