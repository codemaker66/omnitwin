import { describe, expect, it } from "vitest";
import type { RememberedDietaryNote } from "@omnitwin/types";
import {
  MEMORY_OFF,
  longDate,
  memoryChoiceChanged,
  memoryStepOnSave,
  rememberedForVenue,
  shouldPrefill,
  startsTicked,
  type DietaryMemoryState,
} from "../dietary-memory.js";

// "Ask once, then remember": what the Event details sheet does with a
// client's remembered allergy note, decided without a browser.

const VENUE = "00000000-0000-4000-8000-000000000001";
const LAYOUT = "00000000-0000-4000-8000-0000000000aa";
const NOTE = "Two guests: sesame, severe.";

function remembered(overrides: Partial<RememberedDietaryNote> = {}): RememberedDietaryNote {
  return {
    id: "00000000-0000-4000-8000-0000000000f1",
    venueId: VENUE,
    venueName: "Trades Hall",
    otherAllergies: NOTE,
    consentWording: "Remember these for our next event? …",
    consentedAt: "2026-10-17T10:00:00.000Z",
    updatedAt: "2026-10-17T10:00:00.000Z",
    sourceLayout: { id: LAYOUT, name: "Annual dinner" },
    ...overrides,
  };
}

function state(overrides: Partial<DietaryMemoryState>): DietaryMemoryState {
  return { status: "ready", remembered: null, initiallyTicked: false, ticked: false, prefilled: false, ...overrides };
}

describe("the box beside the allergy note", () => {
  it("starts unticked on the first ask, and ticked only for the note already remembered", () => {
    expect(startsTicked(null, NOTE, false)).toBe(false);
    expect(startsTicked(remembered(), NOTE, false)).toBe(true);
    expect(startsTicked(remembered(), "One guest: shellfish.", false)).toBe(false);
    expect(startsTicked(remembered(), "", true)).toBe(true);
  });

  it("fills in only a layout whose event details were never saved", () => {
    expect(shouldPrefill(remembered(), false)).toBe(true);
    expect(shouldPrefill(remembered(), true)).toBe(false);
    expect(shouldPrefill(null, false)).toBe(false);
  });

  it("picks the note remembered for this layout's venue, never another venue's", () => {
    const other = remembered({ id: "00000000-0000-4000-8000-0000000000f2", venueId: "00000000-0000-4000-8000-000000000002" });
    expect(rememberedForVenue([other, remembered()], VENUE)?.id).toBe(remembered().id);
    expect(rememberedForVenue([other], VENUE)).toBeNull();
  });
});

describe("what saving does to the remembered note", () => {
  it("does nothing without a tick (the note stays with this event only)", () => {
    expect(memoryStepOnSave(state({}), NOTE, LAYOUT)).toBe("none");
  });

  it("remembers a ticked note, and replaces a different one", () => {
    expect(memoryStepOnSave(state({ ticked: true }), NOTE, LAYOUT)).toBe("remember");
    expect(memoryStepOnSave(state({ ticked: true, initiallyTicked: true, remembered: remembered() }), `${NOTE} One more.`, LAYOUT)).toBe("remember");
  });

  it("counts saving it with another layout as use, and leaves an unchanged note on its own layout alone", () => {
    const standing = state({ ticked: true, initiallyTicked: true, remembered: remembered() });
    expect(memoryStepOnSave(standing, NOTE, "00000000-0000-4000-8000-0000000000bb")).toBe("remember");
    expect(memoryStepOnSave(standing, NOTE, LAYOUT)).toBe("none");
    expect(memoryStepOnSave({ ...standing, remembered: remembered({ sourceLayout: null }) }, NOTE, LAYOUT)).toBe("remember");
  });

  it("removes the remembered note only when the client takes away a tick that was there", () => {
    expect(memoryStepOnSave(state({ initiallyTicked: true, ticked: false, remembered: remembered() }), NOTE, LAYOUT)).toBe("forget");
    // A layout carrying a different note, its box left unticked: the
    // remembered one is not this layout's to remove.
    expect(memoryStepOnSave(state({ initiallyTicked: false, ticked: false, remembered: remembered() }), "Other", LAYOUT)).toBe("none");
  });

  it("changes nothing remembered when the note is emptied, the box is not offered, or memory has not loaded", () => {
    const standing = state({ ticked: false, initiallyTicked: true, remembered: remembered() });
    expect(memoryStepOnSave(standing, "   ", LAYOUT)).toBe("none");
    expect(memoryStepOnSave({ ...MEMORY_OFF, ticked: true }, NOTE, LAYOUT)).toBe("none");
    expect(memoryStepOnSave(state({ status: "loading", ticked: true }), NOTE, LAYOUT)).toBe("none");
  });

  it("still asks once when the remembered notes could not be loaded: a tick remembers, no tick does nothing", () => {
    expect(memoryStepOnSave(state({ status: "error", ticked: true }), NOTE, LAYOUT)).toBe("remember");
    expect(memoryStepOnSave(state({ status: "error" }), NOTE, LAYOUT)).toBe("none");
  });
});

describe("an unsaved change", () => {
  it("is a box the client changed, beside a note", () => {
    expect(memoryChoiceChanged(state({ ticked: true }), NOTE)).toBe(true);
    expect(memoryChoiceChanged(state({ ticked: true, initiallyTicked: true }), NOTE)).toBe(false);
    expect(memoryChoiceChanged(state({ ticked: true }), "")).toBe(false);
    expect(memoryChoiceChanged({ ...MEMORY_OFF, ticked: true }, NOTE)).toBe(false);
  });
});

describe("dates", () => {
  it("reads as the venue writes them", () => {
    expect(longDate("2026-10-17T10:00:00.000Z")).toBe("17 October 2026");
    expect(longDate("not a date")).toBe("");
  });
});
