import { describe, expect, it } from "vitest";
import { findUnsupportedProposalClaim } from "@omnitwin/types";
import { CAPACITY_GUIDANCE_DISCLOSURE } from "../../../lib/proposal-capacity-note.js";
import { publicRoomSelectionCards } from "../../../lib/trades-hall-room-showcase.js";
import {
  CAPACITY_DISCLOSURE,
  ROOM_CHAPTERS,
  ROOM_INDEX_CARDS,
  allRiteCopy,
  buildMagnitudeMeasures,
} from "../rite-copy.js";

describe("rite-copy — claim safety", () => {
  it("holds the entire script to the claim guard", () => {
    for (const line of allRiteCopy()) {
      expect(
        findUnsupportedProposalClaim(line),
        `unsupported claim in: "${line}"`,
      ).toBeNull();
    }
  });

  it("pairs every capacity figure with the standing SAFE disclosure", () => {
    expect(CAPACITY_DISCLOSURE).toBe(CAPACITY_GUIDANCE_DISCLOSURE);
    expect(allRiteCopy()).toContain(CAPACITY_GUIDANCE_DISCLOSURE);
  });
});

describe("rite-copy — magnitude derives from planner geometry", () => {
  it("measures the Grand Hall as the planner knows it", () => {
    const measures = buildMagnitudeMeasures();
    const figures = measures.map((m) => m.figure);
    expect(figures).toEqual(["21", "7", "240", "1791"]);
  });

  it("names the seven-metre dome above the ceiling", () => {
    const ceiling = buildMagnitudeMeasures()[1];
    expect(ceiling?.label).toContain("7-metre dome");
  });

  it("counts only the dinner figure", () => {
    const counted = buildMagnitudeMeasures().filter((m) => m.countTo !== null);
    expect(counted).toHaveLength(1);
    expect(counted[0]?.countTo).toBe(240);
  });
});

describe("rite-copy — chapters cannot drift from the showcase cards", () => {
  it("builds all four principal chapters", () => {
    expect(ROOM_CHAPTERS.map((c) => c.slug)).toEqual([
      "grand-hall",
      "saloon",
      "robert-adam-room",
      "reception-room",
    ]);
  });

  it("takes name, image, and route from the shared card, verbatim", () => {
    for (const chapter of ROOM_CHAPTERS) {
      const card = publicRoomSelectionCards.find(
        (candidate) => candidate.canonicalRoomSlug === chapter.slug,
      );
      expect(card, `no card for ${chapter.slug}`).toBeDefined();
      expect(chapter.name).toBe(card?.name);
      expect(chapter.image).toBe(card?.image);
      expect(chapter.showcaseHref).toBe(card?.routeHref);
    }
  });

  it("keeps the venue-published planning figures", () => {
    const bySlug = new Map(ROOM_CHAPTERS.map((c) => [c.slug, c]));
    expect(bySlug.get("grand-hall")).toMatchObject({ standing: 400, banquet: 240 });
    expect(bySlug.get("saloon")).toMatchObject({ standing: 150, banquet: 90 });
    expect(bySlug.get("robert-adam-room")).toMatchObject({ standing: 120, banquet: 80 });
    expect(bySlug.get("reception-room")).toMatchObject({ standing: 80, banquet: 50 });
  });
});

describe("rite-copy — the index leaves no room orphaned", () => {
  it("lists all eight rooms", () => {
    expect(ROOM_INDEX_CARDS).toHaveLength(8);
    expect(ROOM_INDEX_CARDS).toBe(publicRoomSelectionCards);
  });
});
