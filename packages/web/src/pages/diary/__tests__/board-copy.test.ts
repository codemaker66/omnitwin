import { describe, expect, it } from "vitest";
import { BOOKING_KINDS, BOOKING_LOST_REASONS, VALID_BOOKING_TRANSITIONS } from "@omnitwin/types";
import { BOARD_COPY } from "../board-copy.js";

// ---------------------------------------------------------------------------
// Claim guard (house pattern from rite-copy/spotlight-copy): the Board's copy
// is planning-support language, never compliance vocabulary, and speaks
// Blake's hold words (26 September 2026), never the internal ones.
// ---------------------------------------------------------------------------

function allStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "function") {
    // Copy functions take a label, a count, or a list — sweep every shape
    // that produces a string and skip the ones that do not fit.
    const fn = value as (...args: never[]) => string;
    const attempts: readonly unknown[][] = [["Sample"], [2], [["Sample", "Names"]], ["Sample", 2]];
    const results: string[] = [];
    for (const args of attempts) {
      try {
        const out = fn(...(args as never[]));
        if (typeof out === "string") results.push(out);
      } catch {
        // Signature mismatch — try the next shape.
      }
    }
    return results;
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value).flatMap(allStrings);
  }
  return [];
}

describe("board copy claim guard", () => {
  const corpus = allStrings(BOARD_COPY).join(" \n ");

  it("never uses compliance vocabulary", () => {
    expect(corpus.toLowerCase()).not.toMatch(
      /complian|certif|guarantee|approved|fire safe|legally|regulation-ready/,
    );
  });

  it("carries the planning-support disclosure", () => {
    expect(BOARD_COPY.disclosure).toContain("Planning support only");
  });

  it("speaks Blake's hold words, and never says 'strong enquiry'", () => {
    expect(corpus.toLowerCase()).not.toContain("strong enquiry");
    expect(BOARD_COPY.legend.ink).toBe("Confirmed");
    expect(BOARD_COPY.legend.hold).toBe("Provisional");
    expect(BOARD_COPY.decisions.option(1, true)).toBe("Joint 1st");
    expect(BOARD_COPY.decisions.option(2, false)).toBe("2nd option");
  });

  it("never shows the internal words: pencil, ink, prospect or ladder", () => {
    expect(corpus).not.toMatch(/\b(pencil\w*|ink(ed|s)?|prospects?|ladder)\b/iu);
  });

  it("says plainly that an interest never holds the room", () => {
    expect(BOARD_COPY.legend.prospect).toBe("Interest only");
    expect(corpus).toContain("Interest only never holds the room.");
  });

  it("turnaround checks admit when they are not checked", () => {
    expect(BOARD_COPY.conflicts.turnaround.not_checked.toLowerCase()).toContain("not checked");
  });
});

// ---------------------------------------------------------------------------
// Migration 0100 (Blake, 19 October 2026): a viewing is "Viewing" on a label
// and "the viewing" in a sentence, never a commitment; a loss may say why,
// from a short fixed list in plain words.
// ---------------------------------------------------------------------------
describe("viewings and lost reasons, in the board's words", () => {
  it("names a viewing on a label and inside a sentence", () => {
    expect(BOARD_COPY.legend.viewing).toBe("Viewing");
    expect(BOARD_COPY.ending.what.viewing).toBe("the viewing");
    expect(BOARD_COPY.ending.cancelViewing).toBe("Cancel the viewing");
  });

  it("gives every booking kind its legend, its sentence and a move's words", () => {
    for (const kind of BOOKING_KINDS) {
      expect(BOARD_COPY.legend[kind], kind).toMatch(/\S/u);
      expect(BOARD_COPY.ending.what[kind], kind).toMatch(/^the /u);
      expect(BOARD_COPY.transitions[kind], kind).toMatch(/\S/u);
    }
    // Nothing transitions into a viewing; its move's words say what to do instead.
    expect(Object.values(VALID_BOOKING_TRANSITIONS).some((targets) => targets.includes("viewing"))).toBe(false);
    expect(BOARD_COPY.transitions.viewing).toBe("Book a viewing as its own booking");
  });

  it("says each lost reason in plain words", () => {
    expect(BOOKING_LOST_REASONS.map((reason) => BOARD_COPY.ending.lostReason.words[reason])).toEqual([
      "Price", "Date taken by someone else", "Room or capacity didn't suit", "Chose another venue",
      "Plans changed or cancelled", "Stopped replying", "Other",
    ]);
    expect(BOARD_COPY.ending.lostReason.label).toBe("Why it was lost (optional)");
  });
});

// ---------------------------------------------------------------------------
// T-619: strings added from the timetable on speak Blake's hold words
// (26 September 2026) — "Provisional", "1st option", "2nd option", "Joint
// 1st", "Confirmed" — and never the internal ones.
// ---------------------------------------------------------------------------
describe("T-619 copy uses Blake's hold words", () => {
  const INTERNAL = /pencil|\bink|prospect|ladder|hold decision|joint hold/iu;
  const t619 = [
    ...allStrings(BOARD_COPY.create),
    ...allStrings(BOARD_COPY.decisions),
    BOARD_COPY.drawer.summaryLabel,
    BOARD_COPY.drawer.ownerLabel,
    BOARD_COPY.drawer.ownerUnassigned,
    BOARD_COPY.drawer.clientLabel,
    BOARD_COPY.drawer.clientNone,
    BOARD_COPY.drawer.eventLabel,
    BOARD_COPY.drawer.guestsLabel,
  ];

  it("never reaches for the internal vocabulary", () => {
    for (const text of t619) expect(text, text).not.toMatch(INTERNAL);
  });

  it("names a hold's option as Blake does", () => {
    expect(BOARD_COPY.decisions.option(1, false)).toBe("1st option");
    expect(BOARD_COPY.decisions.option(2, false)).toBe("2nd option");
    expect(BOARD_COPY.decisions.option(3, false)).toBe("3rd option");
    expect(BOARD_COPY.decisions.option(1, true)).toBe("Joint 1st");
    expect(BOARD_COPY.decisions.option(null, false)).toBe("Provisional");
    expect(BOARD_COPY.decisions.option(11, false)).toBe("11th option");
  });

  it("keeps the toolbar to the three zooms", () => {
    expect(Object.keys(BOARD_COPY.views)).toEqual(["day", "week", "2w"]);
  });
});

describe("the board's loading and refresh words (roadmap N3)", () => {
  it("puts a week or a fortnight inside the sentence, and a day as it is", () => {
    expect(BOARD_COPY.opening("Week of Mon, 21 Sept 2026")).toBe("Opening the week of Mon, 21 Sept 2026…");
    expect(BOARD_COPY.opening("Fortnight of Mon, 21 Sept 2026")).toBe("Opening the fortnight of Mon, 21 Sept 2026…");
    expect(BOARD_COPY.opening("Mon, 21 Sept 2026")).toBe("Opening Mon, 21 Sept 2026…");
    expect(BOARD_COPY.rangeError("Week of Mon, 21 Sept 2026")).toBe("The week of Mon, 21 Sept 2026 could not be read.");
    expect(BOARD_COPY.rangeError("Mon, 21 Sept 2026")).toBe("Mon, 21 Sept 2026 could not be read.");
  });

  it("says from when the board is shown only once that is a different minute", () => {
    expect(BOARD_COPY.refreshFailed("09:03", "09:00")).toBe("Couldn't refresh at 09:03. Showing the Diary as it was at 09:00.");
    expect(BOARD_COPY.refreshFailed("09:03", "09:03")).toBe("Couldn't refresh at 09:03.");
    expect(BOARD_COPY.refreshFailed("09:03", null)).toBe("Couldn't refresh at 09:03.");
  });
});
