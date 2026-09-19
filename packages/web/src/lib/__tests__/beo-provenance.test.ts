import { describe, expect, it } from "vitest";
import { splitBeoProvenance } from "../beo-provenance.js";

// ---------------------------------------------------------------------------
// The BEO block is printed and carried. A 64-character digest in the middle of
// it is developer vocabulary on a user-facing surface — but the digests are
// also the only proof of which approved snapshot a handoff came from, so they
// are moved, never dropped.
// ---------------------------------------------------------------------------

const HASH = "1f1a849f6e6e9d4b05e0f7d9ccf6586353d0d9487af3bf7163d0692d1e1af82c";
const DIGEST = "8cf7288c0f634ef9b28227c315a6226bb674bbb1322f458b4222d4c098d25437";

const BODY = [
  "BEO internal operations handoff for Mackenzie-Ross wedding breakfast.",
  "Venue: Trades Hall Glasgow; room: Grand Hall.",
  `Snapshot: v1; hash ${HASH}.`,
  "Pick list items: 2; total quantity 126.",
  `Compiler digest: ${DIGEST}.`,
].join("\n");

describe("splitBeoProvenance", () => {
  it("keeps every prose line a hallkeeper reads", () => {
    const { body } = splitBeoProvenance(BODY);
    expect(body).toContain("BEO internal operations handoff");
    expect(body).toContain("room: Grand Hall");
    expect(body).toContain("Pick list items: 2");
  });

  it("takes the digests out of the printed block", () => {
    const { body } = splitBeoProvenance(BODY);
    expect(body).not.toContain(HASH);
    expect(body).not.toContain(DIGEST);
  });

  it("keeps them, in order, as provenance rather than dropping them", () => {
    const { provenance } = splitBeoProvenance(BODY);
    expect(provenance).toHaveLength(2);
    expect(provenance[0]).toContain(HASH);
    expect(provenance[1]).toContain(DIGEST);
  });

  it("leaves prose that merely mentions a snapshot alone", () => {
    // Conservative on purpose: only a long hex run marks a line as provenance.
    const prose = "Review note: this is an internal handoff from approved planning data.";
    const { body, provenance } = splitBeoProvenance(prose);
    expect(body).toBe(prose);
    expect(provenance).toEqual([]);
  });

  it("does not leave a gap where a removed line used to be", () => {
    const { body } = splitBeoProvenance(`First line.\n\nCompiler digest: ${DIGEST}.\n\nLast line.`);
    expect(body).toBe("First line.\n\nLast line.");
  });

  it("handles a body with no provenance at all", () => {
    const { body, provenance } = splitBeoProvenance("Just the wording.");
    expect(body).toBe("Just the wording.");
    expect(provenance).toEqual([]);
  });
});
