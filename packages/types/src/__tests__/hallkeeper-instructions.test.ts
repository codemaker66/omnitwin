import { describe, it, expect } from "vitest";
import {
  DayOfContactSchema,
  PhaseDeadlineSchema,
  EventInstructionsSchema,
  ConfigurationMetadataSchema,
  PlacedObjectMetadataSchema,
  emptyEventInstructions,
  hasInstructionContent,
} from "../hallkeeper-instructions.js";

describe("DayOfContactSchema", () => {
  it("accepts a minimal contact (name only)", () => {
    const parsed = DayOfContactSchema.safeParse({ name: "Sarah Wright" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.role).toBe("");
      expect(parsed.data.phone).toBe("");
      expect(parsed.data.email).toBe("");
    }
  });

  it("accepts a full contact", () => {
    const parsed = DayOfContactSchema.safeParse({
      name: "Sarah Wright",
      role: "Planner",
      phone: "+44 7700 900000",
      email: "sarah@example.com",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts empty-string email (the escape hatch)", () => {
    const parsed = DayOfContactSchema.safeParse({ name: "Sarah", email: "" });
    expect(parsed.success).toBe(true);
  });

  it("rejects a malformed email when non-empty", () => {
    expect(DayOfContactSchema.safeParse({ name: "Sarah", email: "not an email" }).success).toBe(false);
  });

  it("rejects empty name", () => {
    expect(DayOfContactSchema.safeParse({ name: "" }).success).toBe(false);
  });
});

describe("PhaseDeadlineSchema", () => {
  it("accepts a valid deadline for each phase", () => {
    for (const phase of ["structure", "furniture", "dress", "technical", "final"] as const) {
      const parsed = PhaseDeadlineSchema.safeParse({
        phase,
        deadline: "2026-06-15T14:00:00.000Z",
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.reason).toBe("");
    }
  });

  it("rejects an unknown phase", () => {
    expect(PhaseDeadlineSchema.safeParse({
      phase: "decor",
      deadline: "2026-06-15T14:00:00.000Z",
    }).success).toBe(false);
  });

  it("rejects a non-ISO deadline", () => {
    expect(PhaseDeadlineSchema.safeParse({
      phase: "furniture",
      deadline: "2026-06-15 14:00",
    }).success).toBe(false);
  });
});

describe("EventInstructionsSchema", () => {
  it("accepts an empty-ish object with all defaults", () => {
    const parsed = EventInstructionsSchema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.specialInstructions).toBe("");
      expect(parsed.data.dayOfContact).toBeNull();
      expect(parsed.data.phaseDeadlines).toEqual([]);
      expect(parsed.data.accessNotes).toBe("");
    }
  });

  it("caps phase deadlines at the number of setup phases (one per phase)", () => {
    const tooMany = Array.from({ length: 6 }).map(() => ({
      phase: "furniture" as const,
      deadline: "2026-06-15T14:00:00.000Z",
    }));
    expect(EventInstructionsSchema.safeParse({ phaseDeadlines: tooMany }).success).toBe(false);
  });

  it("caps specialInstructions length", () => {
    const tooLong = "x".repeat(4001);
    expect(EventInstructionsSchema.safeParse({ specialInstructions: tooLong }).success).toBe(false);
  });
});

describe("ConfigurationMetadataSchema + PlacedObjectMetadataSchema", () => {
  it("configuration metadata accepts an instructions block", () => {
    const parsed = ConfigurationMetadataSchema.safeParse({
      instructions: {
        specialInstructions: "Keep exit clear",
        dayOfContact: null,
        phaseDeadlines: [],
        accessNotes: "",
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("configuration metadata tolerates unknown keys (future-proof passthrough)", () => {
    const parsed = ConfigurationMetadataSchema.safeParse({ unknownKey: "value" });
    expect(parsed.success).toBe(true);
  });

  it("placed-object metadata accepts groupId + notes", () => {
    const parsed = PlacedObjectMetadataSchema.safeParse({
      groupId: "group-1",
      notes: "VIP table",
    });
    expect(parsed.success).toBe(true);
  });

  it("placed-object notes capped at 500 chars", () => {
    const tooLong = "x".repeat(501);
    expect(PlacedObjectMetadataSchema.safeParse({ notes: tooLong }).success).toBe(false);
  });
});

describe("emptyEventInstructions + hasInstructionContent", () => {
  it("emptyEventInstructions returns a valid empty block", () => {
    const empty = emptyEventInstructions();
    const parsed = EventInstructionsSchema.safeParse(empty);
    expect(parsed.success).toBe(true);
    expect(hasInstructionContent(empty)).toBe(false);
  });

  it("detects content in specialInstructions", () => {
    expect(hasInstructionContent({ ...emptyEventInstructions(), specialInstructions: "note" })).toBe(true);
  });

  it("detects content in accessNotes", () => {
    expect(hasInstructionContent({ ...emptyEventInstructions(), accessNotes: "note" })).toBe(true);
  });

  it("detects a populated dayOfContact", () => {
    expect(hasInstructionContent({
      ...emptyEventInstructions(),
      dayOfContact: { name: "Sarah", role: "", phone: "", email: "" },
    })).toBe(true);
  });

  it("detects phase deadlines", () => {
    expect(hasInstructionContent({
      ...emptyEventInstructions(),
      phaseDeadlines: [{ phase: "furniture", deadline: "2026-06-15T14:00:00.000Z", reason: "" }],
    })).toBe(true);
  });

  it("ignores whitespace-only strings", () => {
    expect(hasInstructionContent({
      ...emptyEventInstructions(),
      specialInstructions: "   \n  ",
      accessNotes: "\t",
    })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T-648: Martyn's Law readiness lives on EventInstructions as an optional,
// default-free key. An absent key must parse, stay absent and count as empty,
// because the live sheet path reads raw JSONB without parsing it.
// ---------------------------------------------------------------------------

describe("EventInstructions.protectedPremises (T-648)", () => {
  it("parsing a pre-T-648 blob adds no protectedPremises key", () => {
    const legacy = {
      specialInstructions: "Fire exits must remain clear.",
      dayOfContact: null,
      phaseDeadlines: [],
      accessNotes: "",
      accessibility: null,
      dietary: null,
      doorSchedule: null,
    };
    const parsed = EventInstructionsSchema.parse(legacy);
    expect("protectedPremises" in parsed).toBe(false);
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(legacy));
  });

  it("emptyEventInstructions keeps the same shape as parsing {}", () => {
    const empty = emptyEventInstructions();
    expect("protectedPremises" in empty).toBe(false);
    expect(JSON.stringify(EventInstructionsSchema.parse({}))).toBe(JSON.stringify(empty));
  });

  it("parses a null and an entered protectedPremises", () => {
    expect(EventInstructionsSchema.parse({ protectedPremises: null }).protectedPremises).toBeNull();
    const entered = EventInstructionsSchema.parse({
      protectedPremises: { dutyLead: { name: "Sarah Kerr" }, procedures: { evacuation: { briefed: true } } },
    });
    expect(entered.protectedPremises).toEqual({ dutyLead: { name: "Sarah Kerr" }, procedures: { evacuation: { briefed: true } } });
  });

  it("rejects a malformed protectedPremises block", () => {
    expect(EventInstructionsSchema.safeParse({ protectedPremises: { briefingAt: "tonight" } }).success).toBe(false);
    expect(EventInstructionsSchema.safeParse({ protectedPremises: { procedures: { evacuation: { briefed: "yes" } } } }).success).toBe(false);
  });

  it("round-trips through ConfigurationMetadataSchema", () => {
    const parsed = ConfigurationMetadataSchema.parse({
      instructions: { protectedPremises: { responsiblePerson: "The Trades House of Glasgow" } },
    });
    expect(parsed.instructions?.protectedPremises).toEqual({ responsiblePerson: "The Trades House of Glasgow" });
  });

  it("hasInstructionContent treats an absent key and an empty block as empty", () => {
    expect(hasInstructionContent(emptyEventInstructions())).toBe(false);
    expect(hasInstructionContent({ ...emptyEventInstructions(), protectedPremises: null })).toBe(false);
    expect(hasInstructionContent({ ...emptyEventInstructions(), protectedPremises: {} })).toBe(false);
    expect(hasInstructionContent({ ...emptyEventInstructions(), protectedPremises: { notes: "  " } })).toBe(false);
  });

  it("hasInstructionContent counts a block holding only Martyn's Law entries", () => {
    expect(hasInstructionContent({
      ...emptyEventInstructions(),
      protectedPremises: { procedures: { lockdown: { briefed: false } } },
    })).toBe(true);
  });

  it("hasInstructionContent accepts a raw JSONB blob with no protectedPremises key", () => {
    // What resolveInstructions hands over for a layout saved before T-648.
    const raw = JSON.parse(JSON.stringify(emptyEventInstructions())) as Parameters<typeof hasInstructionContent>[0];
    expect(hasInstructionContent(raw)).toBe(false);
  });
});
