import { describe, expect, it } from "vitest";
import type { ForwardBookCheck, RoomForwardBook } from "@omnitwin/types";
import { clearConsequence, recordConsequence, refusalWords, roomWords } from "../forward-book-format.js";

// ---------------------------------------------------------------------------
// The words of the forward-book section: who said so and when, and what a
// decision does before it is made. Plain, factual, no system words.
// ---------------------------------------------------------------------------

const ROOM = "00000000-0000-4000-8000-000000000001";

function check(overrides: Partial<ForwardBookCheck> = {}): ForwardBookCheck {
  return {
    id: "00000000-0000-4000-8000-00000000c001", spaceId: ROOM, recordedAt: "2026-10-17T13:02:00.000Z",
    recordedByName: "Moira Brown", note: null, clearedAt: null, clearedByName: null, ...overrides,
  };
}

function room(current: ForwardBookCheck | null, previous: ForwardBookCheck | null = null): RoomForwardBook {
  return { spaceId: ROOM, name: "Grand Hall", current, previous };
}

describe("forward-book words", () => {
  it("names who checked a room and when, in the venue's time", () => {
    expect(roomWords(room(check({ note: "To Dec 2027." })))).toEqual({
      state: "shown", label: "Dates shown", provenance: "Checked by Moira Brown, 17 Oct 2026", note: "To Dec 2027.",
    });
    // 23:30 UTC on 31 October is still the 31st in Glasgow (GMT).
    expect(roomWords(room(check({ recordedAt: "2026-10-31T23:30:00.000Z" }))).provenance).toBe("Checked by Moira Brown, 31 Oct 2026");
  });

  it("names who hid a room's dates and when, or says nobody has checked it", () => {
    const cleared = check({ clearedAt: "2026-10-18T09:00:00.000Z", clearedByName: "Elspeth Grant" });
    expect(roomWords(room(null, cleared))).toEqual({
      state: "hidden", label: "Dates hidden", provenance: "Hidden by Elspeth Grant, 18 Oct 2026", note: null,
    });
    expect(roomWords(room(null))).toEqual({ state: "hidden", label: "Dates hidden", provenance: "Not checked yet", note: null });
  });

  it("says what each decision does, before it is made", () => {
    expect(recordConsequence("Grand Hall")).toContain("Assistants and the website will start saying whether the Grand Hall has bookings on a date");
    expect(recordConsequence("Grand Hall")).toContain("within a minute");
    expect(recordConsequence("Grand Hall")).toContain("wherever it is kept, is on the Diary here");
    expect(clearConsequence("Saloon")).toContain("will stop saying whether the Saloon has bookings on a date, within a minute");
    expect(clearConsequence("Saloon")).toContain("tell people to ask the team instead");
  });

  it("says what a colleague did a moment ago", () => {
    expect(refusalWords(check({ recordedByName: "Iain Fraser" }))).toBe("Iain Fraser recorded this check a moment ago.");
    expect(refusalWords(check({ clearedAt: "2026-10-18T09:00:00.000Z", clearedByName: "Elspeth Grant" })))
      .toBe("Elspeth Grant hid these dates a moment ago.");
  });

  it("uses no system words and no praise", () => {
    const words = [
      recordConsequence("Grand Hall"), clearConsequence("Grand Hall"),
      roomWords(room(check())).provenance, roomWords(room(null)).provenance, refusalWords(check()),
    ].join(" ");
    expect(words).not.toMatch(/\b(?:hash|snapshot|token|handoff|MCP|reconcil\w*|great|success\w*)\b/iu);
  });
});
