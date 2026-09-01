import { describe, expect, it } from "vitest";
import { RIBBON_COPY } from "../when-ribbon-copy.js";

// ---------------------------------------------------------------------------
// Claim guard for the When ribbon's copy — same doctrine as the Diary's
// board-copy guard: planning-support language only. The ribbon may state
// database truth (two inks cannot share a room) but never a compliance
// claim, and turnaround is always a guideline the team judges.
// ---------------------------------------------------------------------------

/** Every string the ribbon can ever show, with functions exercised. */
function allCopyStrings(): string[] {
  const out: string[] = [];
  for (const value of Object.values(RIBBON_COPY)) {
    if (typeof value === "string") out.push(value);
  }
  out.push(
    RIBBON_COPY.bufferWarning(120, "Grand Hall"),
    RIBBON_COPY.pencilUnderInk("Chamber dinner"),
    RIBBON_COPY.inkConfirm("14:00 – 18:00"),
    RIBBON_COPY.moved("14:00 – 18:00"),
    RIBBON_COPY.announceMove("14:00 – 18:00"),
    RIBBON_COPY.announceBlocked("Chamber dinner"),
  );
  return out;
}

describe("when-ribbon copy — claim safety", () => {
  it("never uses compliance vocabulary", () => {
    const forbidden = /complian|certif|guarantee|approved|fire safe|legally|regulation-ready/iu;
    for (const line of allCopyStrings()) {
      expect(line).not.toMatch(forbidden);
    }
  });

  it("carries the planning-support disclosure", () => {
    expect(RIBBON_COPY.disclosure).toContain("Planning support only");
  });

  it("turnaround is a guideline the team judges — never a requirement", () => {
    const buffer = RIBBON_COPY.bufferWarning(120, "Grand Hall");
    expect(buffer).toContain("guideline");
    expect(buffer).toContain("the team judges");
    expect(buffer).not.toMatch(/required|must|enforce/iu);
  });

  it("the only hard wall claimed is the database's own ink exclusion", () => {
    expect(RIBBON_COPY.announceBlocked("X")).toContain("two inked bookings cannot share a room");
  });

  it("ink vocabulary stays inked — a pencil cannot convert under an ink", () => {
    expect(RIBBON_COPY.pencilUnderInk("X")).toContain("cannot convert while that ink stands");
  });
});
