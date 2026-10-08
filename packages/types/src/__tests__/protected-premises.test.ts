import { describe, expect, it } from "vitest";
import {
  MARTYNS_LAW_THRESHOLDS,
  PROTECTION_PROCEDURES,
  ProtectedPremisesSchema,
  buildProtectedPremisesSummary,
  hasProtectedPremisesContent,
  normalizeProtectedPremises,
  type ProtectedPremises,
  type ProtectedPremisesSummary,
} from "../protected-premises.js";

// T-648: Martyn's Law readiness prompts. These tests pin the rules the
// section exists to keep: values come only from operator entries, absence
// says "Not set" / "Not checked", and no output wording claims or implies
// compliance, approval, certification or safety.

const FILLED: ProtectedPremises = {
  responsiblePerson: "The Trades House of Glasgow",
  dutyLead: { name: "Sarah Kerr", role: "Duty manager" },
  procedures: {
    evacuation: { briefed: true, note: "Evacuation plan v3, section 2" },
    invacuation: { briefed: false },
    lockdown: { briefed: true },
    communication: { note: "PA script in the duty folder" },
  },
  briefingAt: "2026-06-15T16:30:00.000Z",
  doorSupervision: { arranged: true, note: "Two door supervisors from 18:00" },
  notes: "Glassford Street door is the only public entrance after 19:00.",
};

function allText(summary: ProtectedPremisesSummary): string {
  const lines = [...summary.people, ...summary.procedures, ...summary.arrangements];
  return [
    summary.heading,
    summary.intro,
    summary.guestLine,
    ...summary.context,
    ...lines.flatMap((line) => [line.label, line.value, line.note ?? ""]),
  ].join("\n");
}

describe("ProtectedPremisesSchema", () => {
  it("accepts an empty record and adds nothing to it (no defaults)", () => {
    const parsed = ProtectedPremisesSchema.parse({});
    expect(parsed).toEqual({});
    expect(Object.keys(parsed)).toEqual([]);
  });

  it("accepts a fully entered record unchanged", () => {
    expect(ProtectedPremisesSchema.parse(FILLED)).toEqual(FILLED);
  });

  it("does not default a procedure's briefing to briefed or not briefed", () => {
    const parsed = ProtectedPremisesSchema.parse({ procedures: { lockdown: {} } });
    expect(parsed.procedures?.lockdown).toEqual({});
    expect(parsed.procedures?.lockdown?.briefed).toBeUndefined();
  });

  it("rejects a briefing time that is not an ISO datetime", () => {
    expect(ProtectedPremisesSchema.safeParse({ briefingAt: "half five" }).success).toBe(false);
  });

  it("rejects over-long notes", () => {
    expect(ProtectedPremisesSchema.safeParse({ notes: "x".repeat(1501) }).success).toBe(false);
    expect(ProtectedPremisesSchema.safeParse({ procedures: { evacuation: { note: "x".repeat(301) } } }).success).toBe(false);
  });
});

describe("hasProtectedPremisesContent", () => {
  it("treats null, an absent key and an empty record as nothing entered", () => {
    expect(hasProtectedPremisesContent(null)).toBe(false);
    expect(hasProtectedPremisesContent(undefined)).toBe(false);
    expect(hasProtectedPremisesContent({})).toBe(false);
  });

  it("treats blank strings and empty groups as nothing entered", () => {
    expect(hasProtectedPremisesContent({
      responsiblePerson: "  ",
      dutyLead: { name: "", role: " " },
      procedures: { evacuation: { note: "\t" }, lockdown: {} },
      doorSupervision: {},
      notes: "\n",
    })).toBe(false);
  });

  it("counts a single entry, including an explicit 'not briefed'", () => {
    expect(hasProtectedPremisesContent({ procedures: { invacuation: { briefed: false } } })).toBe(true);
    expect(hasProtectedPremisesContent({ doorSupervision: { arranged: false } })).toBe(true);
    expect(hasProtectedPremisesContent({ dutyLead: { role: "Duty manager" } })).toBe(true);
    expect(hasProtectedPremisesContent({ briefingAt: "2026-06-15T16:30:00.000Z" })).toBe(true);
  });
});

describe("normalizeProtectedPremises", () => {
  it("returns undefined when nothing was entered, so a save writes no key", () => {
    expect(normalizeProtectedPremises(undefined)).toBeUndefined();
    expect(normalizeProtectedPremises(null)).toBeUndefined();
    expect(normalizeProtectedPremises({ dutyLead: { name: " " }, procedures: { lockdown: {} } })).toBeUndefined();
  });

  it("trims text and drops blank fields without inventing values", () => {
    expect(normalizeProtectedPremises({
      responsiblePerson: "  The Trades House of Glasgow ",
      dutyLead: { name: "Sarah Kerr", role: "  " },
      procedures: { evacuation: { briefed: false, note: "  " }, lockdown: { note: "" } },
      doorSupervision: { note: " Two door supervisors " },
      notes: "",
    })).toEqual({
      responsiblePerson: "The Trades House of Glasgow",
      dutyLead: { name: "Sarah Kerr" },
      procedures: { evacuation: { briefed: false } },
      doorSupervision: { note: "Two door supervisors" },
    });
  });

  it("keeps a fully entered record intact and schema-valid", () => {
    const normalized = normalizeProtectedPremises(FILLED);
    expect(normalized).toEqual(FILLED);
    expect(ProtectedPremisesSchema.safeParse(normalized).success).toBe(true);
  });
});

describe("buildProtectedPremisesSummary", () => {
  const options = { guestCount: 0, timeZone: "Europe/London" };

  it("prints Not set / Not checked on every line when nothing was entered", () => {
    for (const record of [null, undefined, {}]) {
      const summary = buildProtectedPremisesSummary(record, options);
      expect(summary.heading).toBe("Martyn's Law readiness");
      expect(summary.people.map((line) => [line.label, line.value])).toEqual([
        ["Responsible person", "Not set"],
        ["Lead on duty", "Not set"],
      ]);
      expect(summary.procedures.map((line) => [line.label, line.value])).toEqual([
        ["Evacuation", "Not checked"],
        ["Invacuation", "Not checked"],
        ["Lockdown", "Not checked"],
        ["Communication", "Not checked"],
      ]);
      expect(summary.arrangements.map((line) => [line.label, line.value])).toEqual([
        ["Team briefing", "Not set"],
        ["Door supervision", "Not set"],
        ["Notes", "Not set"],
      ]);
      const lines = [...summary.people, ...summary.procedures, ...summary.arrangements];
      expect(lines.every((line) => !line.entered && line.note === null)).toBe(true);
    }
  });

  it("prints exactly what the operator entered", () => {
    const summary = buildProtectedPremisesSummary(FILLED, { guestCount: 240, timeZone: "Europe/London" });
    expect(summary.people.map((line) => line.value)).toEqual(["The Trades House of Glasgow", "Sarah Kerr · Duty manager"]);
    expect(summary.procedures.map((line) => [line.value, line.note])).toEqual([
      ["Briefed", "Evacuation plan v3, section 2"],
      ["Not briefed", null],
      ["Briefed", null],
      ["Not checked", "PA script in the duty folder"],
    ]);
    expect(summary.procedures[3]?.entered).toBe(false);
    // 16:30 UTC on 15 June is 17:30 on the venue's (BST) clock.
    expect(summary.arrangements[0]?.value).toBe("Mon 15 Jun, 17:30");
    expect(summary.arrangements[1]).toMatchObject({ value: "Arranged", note: "Two door supervisors from 18:00", entered: true });
    expect(summary.arrangements[2]?.value).toBe("Glassford Street door is the only public entrance after 19:00.");
  });

  it("prints the briefing time on the venue's clock, not the reader's", () => {
    const summary = buildProtectedPremisesSummary({ briefingAt: "2026-06-15T16:30:00.000Z" }, { guestCount: 0, timeZone: "America/New_York" });
    expect(summary.arrangements[0]?.value).toBe("Mon 15 Jun, 12:30");
  });

  it("shows a lead's role alone when only the role was entered", () => {
    expect(buildProtectedPremisesSummary({ dutyLead: { role: "Duty manager" } }, options).people[1]?.value).toBe("Duty manager");
  });

  it("states the entered guest count as information and reads 0 as not set", () => {
    expect(buildProtectedPremisesSummary(null, { ...options, guestCount: 0 }).guestLine).toBe("Guest count for this event: not set.");
    expect(buildProtectedPremisesSummary(null, { ...options, guestCount: 950 }).guestLine).toBe("Guest count entered for this event: 950.");
  });

  it("names the Act's thresholds as premises tests and leaves the decision to the responsible person", () => {
    const context = buildProtectedPremisesSummary(null, options).context.join(" ");
    expect(MARTYNS_LAW_THRESHOLDS).toEqual({ standardFrom: 200, enhancedFrom: 800 });
    expect(context).toContain("200 to 799 for the standard tier, 800 or more for the enhanced tier");
    expect(context).toContain("on the premises at the same time, not on one event's guest list");
    expect(context).toContain("The venue's responsible person decides what applies.");
    expect(context).toContain("spring 2027");
  });

  it("never claims or implies compliance, approval, certification, safety or a triggered tier", () => {
    const forbidden = /\b(?:complian(?:t|ce)|approv(?:ed|al)|certif(?:ied|icate|y)|safe|safety|secure[ds]?|guarantee[ds]?|triggers?|in scope|you must|you are)\b/iu;
    for (const record of [null, {}, FILLED]) {
      for (const guestCount of [0, 150, 200, 450, 799, 800, 2500]) {
        const text = allText(buildProtectedPremisesSummary(record, { guestCount, timeZone: "Europe/London" }));
        expect(text).not.toMatch(forbidden);
        // The guest count is never paired with a tier verdict.
        expect(text).not.toMatch(/\b(?:this|the) event (?:is|falls|sits|qualifies)\b/iu);
        expect(text).not.toMatch(/\b(?:standard|enhanced) tier (?:applies|duties apply)\b/iu);
      }
    }
  });

  it("keeps the procedures in the Act's s.5(3) order", () => {
    expect(PROTECTION_PROCEDURES).toEqual(["evacuation", "invacuation", "lockdown", "communication"]);
  });
});
