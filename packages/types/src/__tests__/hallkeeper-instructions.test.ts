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

  it("caps phase deadlines at 8", () => {
    const tooMany = Array.from({ length: 9 }).map(() => ({
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
