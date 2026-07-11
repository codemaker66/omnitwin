import { describe, expect, it } from "vitest";
import { BOARD_COPY } from "../board-copy.js";

// ---------------------------------------------------------------------------
// Claim guard (house pattern from rite-copy/spotlight-copy): the Board's copy
// is planning-support language, never compliance vocabulary, and keeps the
// Canon §18 vocabulary locks.
// ---------------------------------------------------------------------------

function allStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "function") {
    // Copy functions take a single label/count argument.
    const fn = value as (arg: never) => string;
    return [fn("Sample" as never), fn(2 as never)].filter(
      (result): result is string => typeof result === "string",
    );
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

  it("keeps the Canon vocabulary: inked, pencil — never 'strong enquiry'", () => {
    expect(corpus.toLowerCase()).not.toContain("strong enquiry");
    expect(BOARD_COPY.legend.ink.toLowerCase()).toContain("inked");
    expect(BOARD_COPY.legend.hold.toLowerCase()).toContain("pencil");
  });

  it("prospects are described as never blocking", () => {
    expect(BOARD_COPY.legend.prospect.toLowerCase()).toContain("never blocks");
  });

  it("turnaround checks admit when they are not checked", () => {
    expect(BOARD_COPY.conflicts.turnaround.not_checked.toLowerCase()).toContain("not checked");
  });
});
