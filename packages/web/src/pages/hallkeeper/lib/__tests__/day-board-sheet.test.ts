import { describe, expect, it } from "vitest";
import { describeSlotSheet, sheetHref } from "../day-board-sheet.js";

// ---------------------------------------------------------------------------
// The Day Board → setup sheet corridor (Ship Friday gate line 20).
//
// The states that matter are the EMPTY ones. A slot with no linked layout used
// to render nothing at all, which a hallkeeper reads as "there is no sheet",
// when the truth is usually "nobody linked one yet" — a different problem with
// a different next action. Each empty state is pinned to its own wording here.
// ---------------------------------------------------------------------------

const EVENT = "00000000-0000-4000-8000-0000000000e1";
const CONFIG_A = "00000000-0000-4000-8000-0000000000c1";
const CONFIG_B = "00000000-0000-4000-8000-0000000000c2";

function layout(configurationId: string, name: string): { configurationId: string; name: string; spaceName: string } {
  return { configurationId, name, spaceName: "Grand Hall" };
}

describe("describeSlotSheet", () => {
  it("sends a booking with no event to the Diary, not to a dead sheet link", () => {
    const state = describeSlotSheet({ eventId: null, roomName: "Grand Hall", layouts: [], unavailableCount: 0 });
    expect(state.kind).toBe("no-event");
    if (state.kind !== "no-event") throw new Error("expected no-event");
    expect(state.message).toContain("not linked to an event");
    expect(state.nextAction).toContain("Diary");
  });

  it("names the room in the honest empty state and points at the event", () => {
    const state = describeSlotSheet({ eventId: EVENT, roomName: "Saloon", layouts: [], unavailableCount: 0 });
    expect(state.kind).toBe("no-layout");
    if (state.kind !== "no-layout") throw new Error("expected no-layout");
    expect(state.message).toContain("Saloon");
    expect(state.message).toContain("No setup sheet yet");
    expect(state.nextAction).toBe("Open the event and link the room's layout.");
    expect(state.eventId).toBe(EVENT);
  });

  it("says when layouts exist but this account cannot open them", () => {
    // Access is a different failure from absence: telling a hallkeeper to go
    // and link a layout that already exists wastes their evening.
    const state = describeSlotSheet({ eventId: EVENT, roomName: "Saloon", layouts: [], unavailableCount: 2 });
    if (state.kind !== "no-layout") throw new Error("expected no-layout");
    expect(state.message).toContain("2 linked layouts are outside your access");
    expect(state.nextAction).toContain("venue administrator");
  });

  it("uses singular wording for a single unreadable layout", () => {
    const state = describeSlotSheet({ eventId: EVENT, roomName: "Saloon", layouts: [], unavailableCount: 1 });
    if (state.kind !== "no-layout") throw new Error("expected no-layout");
    expect(state.message).toContain("1 linked layout is outside your access");
  });

  it("gives one tap to the sheet when the room has exactly one layout", () => {
    const state = describeSlotSheet({
      eventId: EVENT, roomName: "Grand Hall",
      layouts: [layout(CONFIG_A, "Banquet 120")], unavailableCount: 0,
    });
    if (state.kind !== "one") throw new Error("expected one");
    expect(state.href).toBe(`/hallkeeper/${CONFIG_A}?eventId=${EVENT}`);
    expect(state.layoutName).toBe("Banquet 120");
    expect(state.label).toBe("Open setup sheet");
  });

  it("offers the choice rather than guessing when a room has several layouts", () => {
    const state = describeSlotSheet({
      eventId: EVENT, roomName: "Grand Hall",
      layouts: [layout(CONFIG_A, "Banquet 120"), layout(CONFIG_B, "Theatre 200")], unavailableCount: 0,
    });
    if (state.kind !== "many") throw new Error("expected many");
    expect(state.choices.map((choice) => choice.name)).toEqual(["Banquet 120", "Theatre 200"]);
    expect(state.choices[1]?.href).toBe(`/hallkeeper/${CONFIG_B}?eventId=${EVENT}`);
  });

  it("carries the event on the sheet link so the sheet shows the right running order", () => {
    expect(sheetHref(CONFIG_A, EVENT)).toBe(`/hallkeeper/${CONFIG_A}?eventId=${EVENT}`);
  });
});
