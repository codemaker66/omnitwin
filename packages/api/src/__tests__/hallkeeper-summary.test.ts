import { describe, expect, it } from "vitest";
import { EventInstructionsSchema, ManifestRowV2Schema, PhaseSchema, type HallkeeperSheetV2 } from "@omnitwin/types";
import { summarizeSheet } from "../lib/hallkeeper-summary.js";

// ---------------------------------------------------------------------------
// The Day Board's line about a sheet counts as the sheet counts: every row of
// every zone of every phase, checked when its key carries a mark.
// ---------------------------------------------------------------------------

const CONFIG = "00000000-0000-4000-8000-000000000501";

function row(key: string): unknown {
  return ManifestRowV2Schema.parse({ key, name: key.split("|")[2] ?? key, category: "table", qty: 1, afterDepth: 0, isAccessory: false });
}

const phases: HallkeeperSheetV2["phases"] = [
  PhaseSchema.parse({ phase: "furniture", zones: [
    { zone: "Centre", rows: [row("furniture|Centre|Round table|0"), row("furniture|Centre|Chair|0")] },
    { zone: "North wall", rows: [row("furniture|North wall|Lectern|0")] },
  ] }),
  PhaseSchema.parse({ phase: "dress", zones: [
    { zone: "Centre", rows: [row("dress|Centre|Tablecloth|1")] },
  ] }),
];

const timing: HallkeeperSheetV2["timing"] = {
  eventStart: "2026-10-03T17:30:00.000Z",
  setupBy: "2026-10-03T15:00:00.000Z",
  bufferMinutes: 150,
};

describe("summarizeSheet", () => {
  // timing.setupBy is when setup STARTS (the name is historical): the board's
  // "Ready by" is the sheet's, the planner's final time or else guests in.
  it("counts every row across phases and zones, and those checked, ready when guests come in", () => {
    expect(summarizeSheet(CONFIG, { phases, timing, instructions: null }, ["furniture|Centre|Round table|0", "dress|Centre|Tablecloth|1"])).toEqual({
      configId: CONFIG,
      readyBy: "2026-10-03T17:30:00.000Z",
      eventStart: "2026-10-03T17:30:00.000Z",
      total: 4,
      checked: 2,
    });
  });

  it("gives the planner's final time as the ready-by time", () => {
    const instructions = EventInstructionsSchema.parse({ phaseDeadlines: [{ phase: "final", deadline: "2026-10-03T17:00:00.000Z" }] });
    expect(summarizeSheet(CONFIG, { phases, timing, instructions }, []).readyBy).toBe("2026-10-03T17:00:00.000Z");
  });

  it("does not count a mark left on a row a re-save removed, or the same mark twice", () => {
    const summary = summarizeSheet(CONFIG, { phases, timing, instructions: null }, [
      "furniture|Centre|Chair|0", "furniture|Centre|Chair|0", "furniture|Centre|Trestle table|0",
    ]);
    expect(summary.checked).toBe(1);
    expect(summary.total).toBe(4);
  });

  it("is ready when guests come in where no changeover rule opens the setup, and has no time without timing", () => {
    expect(summarizeSheet(CONFIG, { phases, timing: { ...timing, setupBy: null, bufferMinutes: null }, instructions: null }, []).readyBy)
      .toBe("2026-10-03T17:30:00.000Z");
    const untimed = summarizeSheet(CONFIG, { phases, timing: null, instructions: null }, []);
    expect(untimed.readyBy).toBeNull();
    expect(untimed.eventStart).toBeNull();
  });

  it("reads nothing placed as none of none", () => {
    expect(summarizeSheet(CONFIG, { phases: [], timing, instructions: null }, ["furniture|Centre|Chair|0"])).toMatchObject({ total: 0, checked: 0 });
  });
});
