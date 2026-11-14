import { describe, expect, it } from "vitest";
import {
  SURFACES,
  floorKindForRoom,
  surfaceKindForSupport,
  surfaceResponse,
  type SurfaceKind,
} from "../surfaces.js";
import type { RoomSlug } from "../rooms.js";

const FLOORS: readonly (readonly [RoomSlug, SurfaceKind])[] = [
  ["grand-hall", "oak-boards-joists"],
  ["saloon", "oak-parquet"],
  ["robert-adam-room", "oak-boards-joists"],
  ["reception-room", "timber-on-slab"],
  ["north-gallery", "carpet"],
  ["south-gallery", "carpet"],
];

describe("floors by room", () => {
  it.each(FLOORS)("puts %s on %s", (room, kind) => {
    expect(floorKindForRoom(room)).toBe(kind);
  });

  it("puts no room, and a room it does not know, on timber over a slab", () => {
    expect(floorKindForRoom(null)).toBe("timber-on-slab");
    expect(floorKindForRoom("not-a-room")).toBe("timber-on-slab");
    expect(floorKindForRoom("")).toBe("timber-on-slab");
    // Object prototype names are not rooms.
    expect(floorKindForRoom("constructor")).toBe("timber-on-slab");
    expect(floorKindForRoom("__proto__")).toBe("timber-on-slab");
  });
});

describe("the surface under a landing", () => {
  it("lands on a staging deck or platform as the stage deck", () => {
    expect(surfaceKindForSupport("staging-deck-6x4", "grand-hall")).toBe("stage-deck");
    expect(surfaceKindForSupport("staging-deck-6x3", "saloon")).toBe("stage-deck");
    expect(surfaceKindForSupport("platform", "grand-hall")).toBe("stage-deck");
    expect(surfaceKindForSupport("platform-narrow", null)).toBe("stage-deck");
  });

  it("lands on a dance-floor panel as the dance floor", () => {
    expect(surfaceKindForSupport("dancefloor-panel", "grand-hall")).toBe("dance-floor");
  });

  it("lands on any table as a table top", () => {
    expect(surfaceKindForSupport("round-table-6ft", null)).toBe("table-top");
    expect(surfaceKindForSupport("trestle-6ft-wooden", "saloon")).toBe("table-top");
    expect(surfaceKindForSupport("poseur-table", "grand-hall")).toBe("table-top");
  });

  it("lands on the room's floor when nothing is under the foot", () => {
    expect(surfaceKindForSupport(null, "saloon")).toBe("oak-parquet");
    expect(surfaceKindForSupport(null, "north-gallery")).toBe("carpet");
    expect(surfaceKindForSupport(null, null)).toBe("timber-on-slab");
  });

  it("lands on the floor when the support is not a surface (a chair, an unknown piece)", () => {
    expect(surfaceKindForSupport("chiavari-chair", "grand-hall")).toBe("oak-boards-joists");
    expect(surfaceKindForSupport("imported-thing", "reception-room")).toBe("timber-on-slab");
  });
});

describe("surface responses", () => {
  it("sets the carpet's high cut-off under 3 kHz and every hard surface's above it", () => {
    expect(SURFACES.carpet.highCutHz).toBeLessThan(3000);
    for (const kind of ["oak-boards-joists", "oak-parquet", "timber-on-slab", "stage-deck", "dance-floor", "table-top"] as const) {
      expect(SURFACES[kind].highCutHz, kind).toBeGreaterThan(3000);
    }
  });

  it("pins every kind's own numbers: hardness, banks, thump and cavity, as surfaces.ts states and sources them", () => {
    const boards = SURFACES["oak-boards-joists"];
    expect(boards.hardness).toBe(1);
    expect(boards.boards).toEqual({ lowHz: 150, highHz: 300, count: 24, eta: 0.07, gainDb: 0 });
    expect(boards.thump).toEqual({ hz: 14, zeta: 0.03 });
    expect(boards.highCutHz).toBe(16000);
    expect(SURFACES["oak-parquet"].boards).toEqual({ lowHz: 220, highHz: 480, count: 20, eta: 0.09, gainDb: 0 });
    expect(SURFACES["oak-parquet"].thump).toEqual({ hz: 16, zeta: 0.04 });
    // Oak's face on a slab is as hard as on joists (ruling R47); every use of hardness holds it to 1 anyway.
    expect(SURFACES["timber-on-slab"].hardness).toBe(1);
    expect(SURFACES["timber-on-slab"].boards).toEqual({ lowHz: 400, highHz: 900, count: 12, eta: 0.12, gainDb: 0 });
    expect(SURFACES["timber-on-slab"].thump).toBeNull();
    expect(SURFACES.carpet.hardness).toBe(0.05);
    expect(SURFACES["stage-deck"].hardness).toBe(0.9);
    expect(SURFACES["stage-deck"].cavity).toEqual({ lowHz: 90, highHz: 160, count: 10, eta: 0.05, gainDb: 0 });
    expect(SURFACES["stage-deck"].boards).toEqual({ lowHz: 200, highHz: 600, count: 18, eta: 0.06, gainDb: 0 });
    expect(SURFACES["dance-floor"].boards).toEqual({ lowHz: 300, highHz: 700, count: 14, eta: 0.08, gainDb: 0 });
    expect(SURFACES["table-top"].hardness).toBe(0.8);
    expect(SURFACES["table-top"].boards).toEqual({ lowHz: 120, highHz: 900, count: 30, eta: 0.04, gainDb: 0 });
  });

  it("keeps the base definitions free of a floor beneath", () => {
    for (const response of Object.values(SURFACES)) expect(response.beneath).toBeNull();
  });

  it("lays carpet over the timber sub-floor, 18 dB down", () => {
    const resolved = surfaceResponse("carpet", "north-gallery");
    const timber = SURFACES["oak-boards-joists"].boards;
    expect(timber).not.toBeNull();
    expect(resolved.kind).toBe("carpet");
    expect(resolved.beneath).toEqual({ ...timber, gainDb: -18 });
    // The same whichever room asks: carpet's sub-floor is always the attic timber.
    expect(surfaceResponse("carpet", null).beneath).toEqual(resolved.beneath);
  });

  it("lays the dance floor over the room's own floor, 10 dB down", () => {
    expect(surfaceResponse("dance-floor", "saloon").beneath).toEqual({ ...SURFACES["oak-parquet"].boards, gainDb: -10 });
    expect(surfaceResponse("dance-floor", "grand-hall").beneath).toEqual({ ...SURFACES["oak-boards-joists"].boards, gainDb: -10 });
    expect(surfaceResponse("dance-floor", "reception-room").beneath).toEqual({ ...SURFACES["timber-on-slab"].boards, gainDb: -10 });
    expect(surfaceResponse("dance-floor", null).beneath).toEqual({ ...SURFACES["timber-on-slab"].boards, gainDb: -10 });
    // A dance floor on a carpeted gallery stands on the timber under the carpet.
    expect(surfaceResponse("dance-floor", "south-gallery").beneath).toEqual({ ...SURFACES["oak-boards-joists"].boards, gainDb: -10 });
  });

  it("leaves every other kind with nothing beneath, whatever the room", () => {
    for (const kind of ["oak-boards-joists", "oak-parquet", "timber-on-slab", "stage-deck", "table-top"] as const) {
      expect(surfaceResponse(kind, "saloon").beneath, kind).toBeNull();
      expect(surfaceResponse(kind, "saloon").kind).toBe(kind);
    }
  });

  it("does not change the base definitions when it resolves one", () => {
    surfaceResponse("carpet", "north-gallery");
    surfaceResponse("dance-floor", "saloon");
    expect(SURFACES.carpet.beneath).toBeNull();
    expect(SURFACES["dance-floor"].beneath).toBeNull();
  });
});
