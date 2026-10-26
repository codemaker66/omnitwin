import { describe, expect, it } from "vitest";
import { emptyDietarySummary, emptyEventInstructions, type DayOfContact, type EventInstructions } from "@omnitwin/types";
import { normalizeForSave } from "../../components/editor/EventDetailsPanel.js";
import {
  ALLERGY_NOTE_LINE,
  changedSections,
  dietOverGuestsLine,
  eventDetailsLogSpec,
  sendableInstructions,
} from "../event-details-save.js";

const ALLERGY = "One guest: shellfish, severe. Table 3: sesame.";
const CONTACT: DayOfContact = { name: "Ailsa Grant", role: "Planner", phone: "+44 7700 900123", email: "ailsa@example.com" };

function withDetails(): EventInstructions {
  return {
    ...emptyEventInstructions(),
    specialInstructions: "Board arriving at 18:45.",
    dayOfContact: CONTACT,
    accessNotes: "South door.",
    dietary: { ...emptyDietarySummary(), vegan: 4, otherAllergies: ALLERGY },
  };
}

describe("what Event details sends", () => {
  it("matches v1's normalizeForSave wherever every field is valid", () => {
    const samples: EventInstructions[] = [
      emptyEventInstructions(),
      withDetails(),
      { ...withDetails(), protectedPremises: { responsiblePerson: "  Trades House  ", notes: "" } },
      { ...withDetails(), protectedPremises: {} },
      { ...withDetails(), dayOfContact: { name: "", role: "", phone: "", email: "" } },
    ];
    for (const sample of samples) {
      expect(sendableInstructions(sample, null).payload).toEqual(normalizeForSave(sample));
    }
  });

  it("keeps the saved email while a new one is half typed, and says so, so nothing else is refused with it", () => {
    const saved = withDetails();
    const draft = { ...saved, accessNotes: "North door.", dayOfContact: { ...CONTACT, email: "ailsa@" } };
    const { payload, held } = sendableInstructions(draft, saved);
    expect(payload?.accessNotes).toBe("North door.");
    expect(payload?.dayOfContact?.email).toBe("ailsa@example.com");
    expect(held.dayOfContact).toBe("Type the whole email address to save it");
  });

  it("keeps the saved contact while its name is cleared to be retyped", () => {
    const saved = withDetails();
    const draft = { ...saved, dayOfContact: { ...CONTACT, name: "" } };
    const { payload, held } = sendableInstructions(draft, saved);
    expect(payload?.dayOfContact?.name).toBe("Ailsa Grant");
    expect(held.dayOfContact).toBe("Add a name to save this contact");
  });

  it("keeps a door's saved name while it is blank, and leaves out a new unnamed door", () => {
    const saved = { ...emptyEventInstructions(), doorSchedule: { entries: [{ label: "Front door", events: [] }] } };
    const draft = { ...saved, doorSchedule: { entries: [{ label: " ", events: [] }, { label: "", events: [] }] } };
    const { payload, held } = sendableInstructions(draft, saved);
    expect(payload?.doorSchedule).toEqual({ entries: [{ label: "Front door", events: [] }] });
    expect(held.doorSchedule).toBe("Name each door to save it");
  });

  it("names the sections a save changed", () => {
    const before = withDetails();
    const after = { ...before, accessNotes: "North door.", dietary: { ...emptyDietarySummary(), vegan: 5, otherAllergies: ALLERGY } };
    expect(changedSections(before, after)).toEqual(["accessNotes", "dietary"]);
    expect(changedSections(before, before)).toEqual([]);
  });
});

describe("what the action log keeps (people-privacy-3)", () => {
  it("records that event details changed, and which sections, never what they say", () => {
    const spec = eventDetailsLogSpec(emptyEventInstructions(), withDetails());
    const changed = ["specialInstructions", "dayOfContact", "accessNotes", "dietary"];
    expect(spec).toEqual({
      intent: "event.details.update",
      tool: "event-details",
      payload: { changed },
      inverse: { changed, contents: "not recorded" },
    });
    const written = JSON.stringify(spec);
    for (const secret of [ALLERGY, "shellfish", "sesame", "Ailsa", "7700", "example.com", "18:45", "South door", "otherAllergies", "vegan"]) {
      expect(written).not.toContain(secret);
    }
  });

  it("records nothing when nothing changed", () => {
    expect(eventDetailsLogSpec(withDetails(), withDetails())).toBeNull();
  });
});

describe("the dietary lines (lens C-15)", () => {
  it("says only what is true: no retention promise until the deletion is real", () => {
    expect(ALLERGY_NOTE_LINE).toBe("Allergens and numbers, not guests' names. Printed on the function sheet for the hallkeeper and kitchen.");
    expect(ALLERGY_NOTE_LINE).not.toMatch(/removed|deleted|days after/i);
  });

  it("says when the counts add to more than the guests, and never blocks", () => {
    const dietary = { ...emptyDietarySummary(), vegetarian: 120, vegan: 40, glutenFree: 36 };
    expect(dietOverGuestsLine(dietary, 180)).toBe("These add to 196, more than the 180 guests.");
    expect(dietOverGuestsLine(dietary, 200)).toBeNull();
    expect(dietOverGuestsLine(dietary, null)).toBeNull();
    expect(dietOverGuestsLine(null, 180)).toBeNull();
  });
});
