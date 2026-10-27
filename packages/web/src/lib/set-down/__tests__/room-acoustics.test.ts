import { describe, expect, it } from "vitest";
import type { BandValues } from "../bands.js";
import { CATALOGUE_ITEMS } from "../../catalogue.js";
import { createPlacedItem, type PlacedItem } from "../../placement.js";
import {
  absorberFor,
  contentsAbsorption,
  referenceDinner,
  reverberantGain,
  reverberationTimes,
  roomAcousticsFor,
  roomState,
} from "../room-acoustics.js";
import { ROOM_ACOUSTICS, ROOM_PLANS, type RoomAcoustics, type RoomSlug } from "../rooms.js";

const NO_CONTENTS: BandValues = [0, 0, 0, 0, 0, 0, 0];
const BANDS = [0, 1, 2, 3, 4, 5, 6] as const;
const GRAND_HALL = ROOM_ACOUSTICS["grand-hall"];
const ROOM_SLUGS: readonly RoomSlug[] = [
  "grand-hall",
  "saloon",
  "robert-adam-room",
  "reception-room",
  "north-gallery",
  "south-gallery",
];

/** A placed piece by slug (the catalogue accepts a slug in place of its id). */
function piece(slug: string, x = 0, z = 0, extra: Partial<PlacedItem> = {}): PlacedItem {
  return { ...createPlacedItem(slug, x, z, 0, null, 0, `test-${slug}-${String(x)}-${String(z)}`), ...extra };
}

function timesWith(room: RoomAcoustics, items: readonly PlacedItem[]): BandValues {
  return reverberationTimes(room, contentsAbsorption(items.map(absorberFor)));
}

/** The mean of the 500 Hz and 1 kHz times. */
function midBand(rt: BandValues): number {
  return (rt[2] + rt[3]) / 2;
}

describe("Trades Hall rooms", () => {
  it("gives the Grand Hall about 1,647 m3 with its dome", () => {
    expect(GRAND_HALL.volumeM3).toBeGreaterThan(1640);
    expect(GRAND_HALL.volumeM3).toBeLessThan(1655);
  });

  it("puts the empty Grand Hall, curtains included, between 2.0 and 2.6 s at 1 kHz", () => {
    const rt = reverberationTimes(GRAND_HALL, NO_CONTENTS);
    expect(rt[3]).toBeGreaterThan(2.0);
    expect(rt[3]).toBeLessThan(2.6);
  });

  it("puts the Grand Hall without its curtains between 3.4 and 4.1 s at 1 kHz", () => {
    const bare: RoomAcoustics = {
      ...GRAND_HALL,
      surfaces: GRAND_HALL.surfaces.filter((surface) => surface.material !== "velour-drape"),
    };
    expect(bare.surfaces.length).toBeLessThan(GRAND_HALL.surfaces.length);
    const rt = reverberationTimes(bare, NO_CONTENTS);
    expect(rt[3]).toBeGreaterThan(3.4);
    expect(rt[3]).toBeLessThan(4.1);
  });

  it("keeps every room's surfaces and calibration well formed", () => {
    for (const slug of ROOM_SLUGS) {
      const room = ROOM_ACOUSTICS[slug];
      expect(room.slug).toBe(slug);
      expect(room.volumeM3).toBeGreaterThan(0);
      expect(room.calibration).toEqual([1, 1, 1, 1, 1, 1, 1]);
      expect(room.source.length).toBeGreaterThan(0);
      for (const surface of room.surfaces) {
        expect(Number.isFinite(surface.areaM2)).toBe(true);
        expect(surface.areaM2).toBeGreaterThan(0);
      }
      for (const t of reverberationTimes(room, NO_CONTENTS)) {
        expect(Number.isFinite(t)).toBe(true);
        expect(t).toBeGreaterThan(0);
      }
    }
  });

  it("makes each gallery's empty mid band under 1.0 s and under a third of the Grand Hall's", () => {
    const hall = midBand(reverberationTimes(GRAND_HALL, NO_CONTENTS));
    for (const slug of ["north-gallery", "south-gallery"] as const) {
      const gallery = midBand(reverberationTimes(ROOM_ACOUSTICS[slug], NO_CONTENTS));
      expect(gallery).toBeLessThan(1.0);
      expect(gallery).toBeLessThan(hall / 3);
    }
  });

  it("keeps each gallery's 125 Hz time under 1.5 s", () => {
    for (const slug of ["north-gallery", "south-gallery"] as const) {
      expect(reverberationTimes(ROOM_ACOUSTICS[slug], NO_CONTENTS)[0]).toBeLessThan(1.5);
    }
  });

  it("panels the Grand Hall's dado to its scanned 1.95 m cap rail", () => {
    // The perimeter less the openings' widths (15.62 m), times 1.95 m.
    const expected = (2 * (21.135 + 10.59) - 15.62) * 1.95;
    const dado = GRAND_HALL.surfaces.filter(
      (surface) => surface.material === "hardwood-panelling" && Math.abs(surface.areaM2 - expected) < 1e-6,
    );
    expect(dado).toHaveLength(1);
  });
});

describe("the reference dinner", () => {
  it("seats each room's published dinner capacity with a round for every ten", () => {
    const capacity: Record<RoomSlug, number> = {
      "grand-hall": 180,
      saloon: 60,
      "robert-adam-room": 60,
      "reception-room": 60,
      "north-gallery": 40,
      "south-gallery": 40,
    };
    for (const slug of ROOM_SLUGS) {
      const items = referenceDinner(slug);
      const chairs = items.filter((item) => absorberFor(item).kind === "chair-cushioned");
      const rounds = items.filter((item) => absorberFor(item).kind === "round-clothed");
      expect(chairs).toHaveLength(capacity[slug]);
      expect(rounds).toHaveLength(Math.ceil(capacity[slug] / 10));
      expect(items).toHaveLength(chairs.length + rounds.length);
      const plan = ROOM_PLANS[slug];
      for (const item of items) {
        expect(Math.abs(item.x)).toBeLessThanOrEqual(plan.lengthM / 2);
        expect(Math.abs(item.z)).toBeLessThanOrEqual(plan.widthM / 2);
      }
      expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
    }
  });

  it("shortens the Grand Hall's mid band by 15-32 % with 180 Chiavari chairs and 18 white rounds", () => {
    const empty = midBand(reverberationTimes(GRAND_HALL, NO_CONTENTS));
    const dressed = midBand(timesWith(GRAND_HALL, referenceDinner("grand-hall")));
    const drop = 1 - dressed / empty;
    expect(drop).toBeGreaterThan(0.15);
    expect(drop).toBeLessThan(0.32);
  });

  it("shortens it by 25-42 % with 180 banquet chairs and 18 clothed rounds", () => {
    const items = referenceDinner("grand-hall").map((item) =>
      absorberFor(item).kind === "chair-cushioned"
        ? { ...item, catalogueItemId: "banquet-chair" }
        : { ...item, catalogueItemId: "round-table-6ft", clothed: true },
    );
    expect(items.filter((item) => absorberFor(item).kind === "chair-upholstered")).toHaveLength(180);
    expect(items.filter((item) => absorberFor(item).kind === "round-clothed")).toHaveLength(18);
    const empty = midBand(reverberationTimes(GRAND_HALL, NO_CONTENTS));
    const dressed = midBand(timesWith(GRAND_HALL, items));
    const drop = 1 - dressed / empty;
    expect(drop).toBeGreaterThan(0.25);
    expect(drop).toBeLessThan(0.42);
  });
});

describe("contents", () => {
  it("never lengthens any band when one more piece of any kind is added", () => {
    const bases: readonly (readonly PlacedItem[])[] = [[], referenceDinner("grand-hall")];
    for (const base of bases) {
      const before = timesWith(GRAND_HALL, base);
      for (const entry of CATALOGUE_ITEMS) {
        const after = timesWith(GRAND_HALL, [...base, piece(entry.slug, 1.3, -2.1)]);
        for (const band of BANDS) expect(after[band]).toBeLessThanOrEqual(before[band] + 1e-12);
      }
    }
  });

  it("never lengthens any band when a chair fills a hole in a packed block", () => {
    // A block packed 0.25 m apart, so the density cap binds, with one 0.5 m
    // cell at its centre left empty.
    const block: PlacedItem[] = [];
    for (let i = -6; i <= 6; i += 1) {
      for (let j = -6; j <= 6; j += 1) {
        if ((i === 0 || i === 1) && (j === 0 || j === 1)) continue;
        block.push(piece("banquet-chair", i * 0.25 + 0.01, j * 0.25 + 0.01));
      }
    }
    const uncapped = upholsteredChairs(block.length);
    const capped = contentsAbsorption(block.map(absorberFor));
    expect(capped[3]).toBeLessThan(uncapped[3]);
    const before = timesWith(GRAND_HALL, block);
    const after = timesWith(GRAND_HALL, [...block, piece("banquet-chair", 0.01, 0.01)]);
    for (const band of BANDS) expect(after[band]).toBeLessThanOrEqual(before[band] + 1e-12);
  });

  it("leaves every band within 1 % with 40 dance floor panels", () => {
    const panels: PlacedItem[] = [];
    for (let i = 0; i < 40; i += 1) panels.push(piece("dancefloor-panel", (i % 8) - 3.5, Math.floor(i / 8) - 2));
    const before = reverberationTimes(GRAND_HALL, NO_CONTENTS);
    const after = timesWith(GRAND_HALL, panels);
    for (const band of BANDS) {
      expect(Math.abs(after[band] - before[band]) / before[band]).toBeLessThan(0.01);
    }
  });

  it("adds absorption, without NaN, for a piece scaled to 2", () => {
    const single = contentsAbsorption([absorberFor(piece("chiavari-chair"))]);
    const scaled = contentsAbsorption([absorberFor(piece("chiavari-chair", 0, 0, { scale: 2 }))]);
    const deck = contentsAbsorption([absorberFor(piece("staging-deck-6x4", 0, 0, { scale: 2 }))]);
    for (const band of BANDS) {
      expect(Number.isFinite(scaled[band])).toBe(true);
      expect(scaled[band]).toBeGreaterThan(single[band]);
      expect(Number.isFinite(deck[band])).toBe(true);
      expect(deck[band]).toBeGreaterThan(0);
    }
    const rt = timesWith(GRAND_HALL, [piece("chiavari-chair", 0, 0, { scale: 2 })]);
    for (const t of rt) expect(Number.isFinite(t)).toBe(true);
  });

  it("maps the catalogue's pieces to their absorbers", () => {
    expect(absorberFor(piece("chiavari-chair")).kind).toBe("chair-cushioned");
    for (const slug of ["burgess-turini-18-3", "checked-banquet-chair", "gallery-chair-red-gold", "pink-chair", "banquet-chair"]) {
      expect(absorberFor(piece(slug)).kind).toBe("chair-upholstered");
    }
    expect(absorberFor(piece("highchair-wooden")).kind).toBe("chair-hard");
    expect(absorberFor(piece("round-table-6ft")).kind).toBe("table-bare");
    expect(absorberFor(piece("round-table-6ft", 0, 0, { clothed: true })).kind).toBe("round-clothed");
    expect(absorberFor(piece("round-table-6ft-black")).kind).toBe("round-clothed");
    expect(absorberFor(piece("cake-cutting-table")).kind).toBe("table-bare");
    expect(absorberFor(piece("trestle-6ft-white")).kind).toBe("trestle-clothed");
    expect(absorberFor(piece("trestle-6ft-wooden")).kind).toBe("table-bare");
    expect(absorberFor(piece("round-cafe-table-white")).kind).toBe("trestle-clothed");
    expect(absorberFor(piece("bar-counter", 0, 0, { clothed: true })).kind).toBe("trestle-clothed");
    expect(absorberFor(piece("servery-unit")).kind).toBe("table-bare");
    expect(absorberFor(piece("poseur-table-white")).kind).toBe("poseur-covered");
    expect(absorberFor(piece("poseur-table")).kind).toBe("table-bare");
    for (const slug of ["platform", "dancefloor-panel", "projector", "lectern"]) {
      expect(absorberFor(piece(slug)).kind).toBe("none");
    }
    const deck = absorberFor(piece("staging-deck-6x4"));
    expect(deck.kind).toBe("fabric-face");
    expect(deck.fabricM2).toBeCloseTo(2 * (1.83 + 1.22) * 0.4 * 0.6, 9);
    const divider = absorberFor(piece("room-divider"));
    expect(divider.kind).toBe("fabric-face");
    expect(divider.fabricM2).toBeCloseTo(4.2 * 1.8 * 2 * 0.5, 9);
    const placed = absorberFor(piece("chiavari-chair", 2.5, -1.5));
    expect([placed.x, placed.z, placed.fabricM2]).toEqual([2.5, -1.5, 0]);
  });

  it("gives an unknown piece its category's absorber, and none for 'other'", () => {
    const definition = (category: "other" | "chair" | "table") => ({
      assetDefinitionId: "00000000-0000-4000-8000-000000000001",
      category,
      widthM: 1,
      depthM: 1,
      heightM: 1,
      seatCount: null,
      collisionType: "box",
    });
    expect(absorberFor(piece("imported-thing", 0, 0, { embeddedAssetDefinition: definition("other") })).kind).toBe("none");
    expect(absorberFor(piece("imported-thing")).kind).toBe("none");
    expect(absorberFor(piece("imported-thing", 0, 0, { embeddedAssetDefinition: definition("chair") })).kind).toBe("chair-hard");
    expect(absorberFor(piece("imported-thing", 0, 0, { embeddedAssetDefinition: definition("table") })).kind).toBe("table-bare");
  });
});

describe("room state", () => {
  it("gives a null space a finite default 10 x 8 x 4 m room", () => {
    const room = roomAcousticsFor(null);
    expect(room.volumeM3).toBeCloseTo(320, 9);
    expect(room.calibration).toEqual([1, 1, 1, 1, 1, 1, 1]);
    const state = roomState(room, []);
    for (const t of state.rt) {
      expect(Number.isFinite(t)).toBe(true);
      expect(t).toBeGreaterThan(0);
    }
    expect(Number.isFinite(state.reverberantGain)).toBe(true);
  });

  it("builds an unknown space from its own dimensions, and finds a known one by slug", () => {
    const room = roomAcousticsFor({ slug: "lady-convenors-room", widthM: "6", lengthM: "9", heightM: "3.5" });
    expect(room.slug).toBe("lady-convenors-room");
    expect(room.volumeM3).toBeCloseTo(189, 9);
    const materials = new Set(room.surfaces.map((surface) => surface.material));
    expect(materials).toEqual(new Set(["timber-on-slab", "plaster-masonry"]));
    const broken = roomAcousticsFor({ slug: "odd", widthM: "", lengthM: "NaN", heightM: "-2" });
    expect(Number.isFinite(broken.volumeM3)).toBe(true);
    expect(broken.volumeM3).toBeGreaterThan(0);
    expect(roomAcousticsFor({ slug: "saloon", widthM: "7", lengthM: "12", heightM: "5.4" })).toBe(ROOM_ACOUSTICS.saloon);
  });

  it("holds the empty Grand Hall's reverberant gain at 1", () => {
    expect(Math.abs(reverberantGain(GRAND_HALL, NO_CONTENTS) - 1)).toBeLessThan(1e-9);
  });

  it("lowers every room's reverberant gain as contents are added", () => {
    for (const slug of ROOM_SLUGS) {
      const room = ROOM_ACOUSTICS[slug];
      const dinner = referenceDinner(slug);
      const empty = roomState(room, []).reverberantGain;
      const half = roomState(room, dinner.slice(0, Math.floor(dinner.length / 2))).reverberantGain;
      const full = roomState(room, dinner).reverberantGain;
      expect(Number.isFinite(full)).toBe(true);
      expect(half).toBeLessThan(empty);
      expect(full).toBeLessThan(half);
    }
  });

  it("puts a small, lightly absorbing room's reverberant gain above 1", () => {
    // Less total absorption than the hall means a stronger diffuse field.
    for (const slug of ["north-gallery", "south-gallery"] as const) {
      expect(reverberantGain(ROOM_ACOUSTICS[slug], NO_CONTENTS)).toBeGreaterThan(1);
    }
  });

  it("keys the state by the seven times rounded to 0.02 s", () => {
    const state = roomState(GRAND_HALL, []);
    const parts = state.key.split(",");
    expect(parts).toHaveLength(7);
    for (const band of BANDS) {
      expect(Number(parts[band])).toBeCloseTo(Math.round(state.rt[band] / 0.02) * 0.02, 9);
    }
    expect(roomState(GRAND_HALL, [piece("dancefloor-panel")]).key).toBe(state.key);
    expect(roomState(GRAND_HALL, referenceDinner("grand-hall")).key).not.toBe(state.key);
  });
});

/** The plain sum of `n` upholstered chairs, without the density cap. */
function upholsteredChairs(n: number): BandValues {
  const one = contentsAbsorption([{ kind: "chair-upholstered", fabricM2: 0, x: 0, z: 0 }]);
  return [one[0] * n, one[1] * n, one[2] * n, one[3] * n, one[4] * n, one[5] * n, one[6] * n];
}
