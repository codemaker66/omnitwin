import { describe, expect, it } from "vitest";
import { findUnsupportedProposalClaim } from "@omnitwin/types";
import {
  CAPACITY_FORMATS,
  TRADES_HALL_ROOM_CAPACITIES,
  TRADES_HALL_ROOM_DIMENSIONS,
  TRADES_HALL_WITHHELD_ROOM_DIMENSIONS,
  type PublishedRoomSlug,
  type RoomDimensions,
} from "@omnitwin/types";
import {
  ROOM_DISPLAY_NAMES,
  VERIFIED_ROOM_NODES,
  formatRoomDimensions,
  lookUpRoom,
  metres,
} from "../twin-rooms.js";

// -----------------------------------------------------------------------------
// twin-rooms — the room-identity oracle.
//
// Two things are on trial here. First, silence: every viewpoint outside the
// five validated ones must return null, because the manifest carries
// `roomSlug: null` and a guessed label is worse than no label. Second, the
// join: capacities and dimensions must come back BY REFERENCE from
// trades-hall-venue-truth.ts. So no figure is written literally below — a test
// that hard-coded 250 would agree with a stale module and defeat the very drift
// gate it exists to guard.
// -----------------------------------------------------------------------------

/** The five ids another lane validated against ground-truth photography. */
const VERIFIED_IDS = ["scan_028", "scan_046", "scan_058", "scan_105", "scan_126"] as const;

/** Every published room slug, read off the truth module rather than restated. */
function publishedSlugs(): PublishedRoomSlug[] {
  return Object.keys(TRADES_HALL_ROOM_CAPACITIES) as PublishedRoomSlug[];
}

/** Read published dimensions without a non-null assertion, failing loudly if
 *  the truth module ever stops publishing them for a room that had them. */
function publishedDimensions(slug: PublishedRoomSlug): RoomDimensions {
  const dimensions = TRADES_HALL_ROOM_DIMENSIONS[slug];
  if (dimensions === undefined) {
    throw new Error(`venue truth publishes no dimensions for ${slug}`);
  }
  return dimensions;
}

/** The dimensions of a room given as a whole: one extent, with a height.
 *  Fails loudly if the room is ever published in sections or loses its height,
 *  so an expectation built from it cannot quietly print "undefined". */
function wholeRoom(slug: PublishedRoomSlug): RoomDimensions {
  const dimensions = publishedDimensions(slug);
  if (dimensions.extents.length !== 1 || dimensions.extents[0].heightM === undefined) {
    throw new Error(`venue truth no longer gives ${slug} as one extent with a height`);
  }
  return dimensions;
}

describe("VERIFIED_ROOM_NODES — the short map, and why it stays short", () => {
  it("carries exactly the five validated viewpoints and no sixth", () => {
    expect(Object.keys(VERIFIED_ROOM_NODES).sort()).toEqual([...VERIFIED_IDS]);
  });

  it("binds each viewpoint to the room the venue photography confirms", () => {
    expect(VERIFIED_ROOM_NODES["scan_028"]).toBe("grand-hall");
    // The Grand Hall's south end, captured and validated as its own viewpoint.
    expect(VERIFIED_ROOM_NODES["scan_046"]).toBe("grand-hall");
    expect(VERIFIED_ROOM_NODES["scan_058"]).toBe("saloon");
    expect(VERIFIED_ROOM_NODES["scan_105"]).toBe("robert-adam-room");
    expect(VERIFIED_ROOM_NODES["scan_126"]).toBe("reception-room");
  });

  it("only ever names rooms the venue actually publishes", () => {
    for (const slug of Object.values(VERIFIED_ROOM_NODES)) {
      expect(publishedSlugs()).toContain(slug);
    }
  });

  it("cannot be mutated at runtime — a truth boundary, not a suggestion", () => {
    expect(Object.isFrozen(VERIFIED_ROOM_NODES)).toBe(true);
    expect(Object.isFrozen(ROOM_DISPLAY_NAMES)).toBe(true);

    // Reflect reaches the object the way a caller who has cast the `readonly`
    // away would, without a cast of its own — it reports the write refused
    // rather than throwing, so all three refusals can be asserted directly.
    expect(Reflect.set(VERIFIED_ROOM_NODES, "scan_028", "saloon")).toBe(false);
    expect(Reflect.set(VERIFIED_ROOM_NODES, "scan_000", "grand-hall")).toBe(false);
    expect(Reflect.deleteProperty(VERIFIED_ROOM_NODES, "scan_028")).toBe(false);

    // And the same write from ordinary code: ES modules are strict mode, so it
    // throws rather than failing silently.
    expect(() => Object.assign(VERIFIED_ROOM_NODES, { scan_058: "grand-hall" })).toThrow(TypeError);

    // …and the map is unchanged after all that.
    expect(Object.keys(VERIFIED_ROOM_NODES).sort()).toEqual([...VERIFIED_IDS]);
    expect(lookUpRoom("scan_028")?.slug).toBe("grand-hall");
    expect(lookUpRoom("scan_000")).toBeNull();
  });
});

describe("lookUpRoom", () => {
  it("resolves every validated viewpoint", () => {
    for (const nodeId of VERIFIED_IDS) {
      const room = lookUpRoom(nodeId);
      expect(room, `no room for validated viewpoint ${nodeId}`).not.toBeNull();
      if (room === null) {
        continue;
      }
      expect(room.nodeId).toBe(nodeId);
      expect(room.slug).toBe(VERIFIED_ROOM_NODES[nodeId]);
      expect(room.name).toBe(ROOM_DISPLAY_NAMES[room.slug]);
    }
  });

  it("says nothing at an unverified viewpoint", () => {
    // scan_000 is the entry node and scan_047 sits beside a validated one —
    // neighbourhood is not evidence, so both must stay silent.
    expect(lookUpRoom("scan_000")).toBeNull();
    expect(lookUpRoom("scan_047")).toBeNull();
    expect(lookUpRoom("scan_148")).toBeNull();
  });

  it("says nothing for ids that are not viewpoints at all", () => {
    expect(lookUpRoom("")).toBeNull();
    expect(lookUpRoom("grand-hall")).toBeNull();
    expect(lookUpRoom("scan_28")).toBeNull();
    // Prototype keys must not leak a room through the map lookup.
    expect(lookUpRoom("toString")).toBeNull();
    expect(lookUpRoom("constructor")).toBeNull();
    expect(lookUpRoom("__proto__")).toBeNull();
  });

  it("returns the venue truth's own capacity object, not a copy of it", () => {
    for (const nodeId of VERIFIED_IDS) {
      const room = lookUpRoom(nodeId);
      expect(room).not.toBeNull();
      if (room === null) {
        continue;
      }
      // Identity, not equality: there is exactly one set of capacity figures in
      // this codebase, and it lives in trades-hall-venue-truth.ts.
      expect(room.capacities).toBe(TRADES_HALL_ROOM_CAPACITIES[room.slug]);
      expect(room.dimensions).toBe(TRADES_HALL_ROOM_DIMENSIONS[room.slug] ?? null);
    }
  });

  it("carries all four published capacity formats for every resolved room", () => {
    for (const nodeId of VERIFIED_IDS) {
      const room = lookUpRoom(nodeId);
      expect(room).not.toBeNull();
      if (room === null) {
        continue;
      }
      for (const format of CAPACITY_FORMATS) {
        expect(typeof room.capacities[format.key]).toBe("number");
      }
    }
  });
});

describe("metres", () => {
  // Literal outputs, not a second formatter: the tour's text checks rebuild
  // every figure line through metres() (e2e/support/twin-hud-text.ts), so a
  // change to its rounding has to fail here rather than agree everywhere.
  it("keeps a published figure as the venue prints it", () => {
    expect(metres(21)).toBe("21");
    expect(metres(5.4)).toBe("5.4");
    expect(metres(2.18)).toBe("2.18");
    expect(metres(10.59)).toBe("10.59");
    expect(metres(6.7)).toBe("6.7");
  });

  it("rounds a finer figure to two decimals, with no trailing zero", () => {
    expect(metres(21.135)).toBe("21.14");
    expect(metres(7.6049)).toBe("7.6");
  });
});

describe("formatRoomDimensions", () => {
  it("renders the published extent, joined from venue truth", () => {
    const [whole] = wholeRoom("saloon").extents;
    expect(formatRoomDimensions("saloon")).toBe(
      `${String(whole.lengthM)} × ${String(whole.widthM)} × ${String(whole.heightM)} m`,
    );
  });

  it("gives a room published in sections each section, named, in the venue's order", () => {
    // The Robert Adam Room is one room on two levels. Its line never carries
    // one section's figures as the room's, and never a figure for the two
    // together, because the venue publishes none.
    const truth = publishedDimensions("robert-adam-room");
    expect(truth.extents.length).toBeGreaterThan(1);
    const expected = truth.extents.map((extent) => {
      if (extent.section === undefined || extent.heightM === undefined) {
        throw new Error("a Robert Adam Room section lost its name or its height");
      }
      // Fractional metres stay intact: String(), not a rounding of our own.
      return `${extent.section} section ${String(extent.lengthM)} × ${String(extent.widthM)} × ${String(extent.heightM)} m`;
    });
    expect(formatRoomDimensions("robert-adam-room")).toBe(expected.join("; "));
  });

  it("renders the note and the remark when a room carries them", () => {
    const truth = wholeRoom("grand-hall");
    const [whole] = truth.extents;
    // The Grand Hall is the room carrying a qualifier today: what its height is
    // measured to, then the remark that the dome rises above part of the hall.
    expect(whole.note).toBeDefined();
    expect(truth.remark).toBeDefined();
    const note = whole.note ?? "";
    const remark = truth.remark ?? "";
    expect(formatRoomDimensions("grand-hall")).toBe(
      `${String(whole.lengthM)} × ${String(whole.widthM)} × ${String(whole.heightM)} m — ${note}. ${remark}`,
    );
  });

  it("appends nothing when there is no published note or remark", () => {
    const truth = wholeRoom("saloon");
    const [whole] = truth.extents;
    expect(whole.note).toBeUndefined();
    expect(truth.remark).toBeUndefined();
    expect(formatRoomDimensions("saloon")).toBe(
      `${String(whole.lengthM)} × ${String(whole.widthM)} × ${String(whole.heightM)} m`,
    );
  });

  it("gives no line and no dimensions for a room whose size is withheld", () => {
    // The Reception Room's published size is on record but not shown, so
    // nothing reaches a surface through this module: not the line, and not
    // the figures behind it.
    expect(TRADES_HALL_WITHHELD_ROOM_DIMENSIONS["reception-room"]).toBeDefined();
    expect(formatRoomDimensions("reception-room")).toBeNull();
    const room = lookUpRoom("scan_126");
    expect(room?.slug).toBe("reception-room");
    expect(room?.dimensions).toBeNull();
    expect(room?.dimensionLine).toBeNull();
  });

  it("gives a room with no stated height its length and width alone", () => {
    // The galleries carry the venue's floor size and no height. Their line must
    // not print a third figure, the word "undefined" or a dangling separator.
    for (const slug of ["north-gallery", "south-gallery"] as const) {
      const truth = publishedDimensions(slug);
      expect(truth.extents).toHaveLength(1);
      const [floor] = truth.extents;
      expect(floor.heightM).toBeUndefined();
      expect(formatRoomDimensions(slug)).toBe(`${String(floor.lengthM)} × ${String(floor.widthM)} m`);
    }
  });

  it("surfaces the same line through lookUpRoom", () => {
    for (const nodeId of VERIFIED_IDS) {
      const room = lookUpRoom(nodeId);
      expect(room).not.toBeNull();
      if (room === null) {
        continue;
      }
      expect(room.dimensionLine).toBe(formatRoomDimensions(room.slug));
    }
  });
});

describe("ROOM_DISPLAY_NAMES", () => {
  it("names every published room, title case, no slug leaking through", () => {
    for (const slug of publishedSlugs()) {
      const name = ROOM_DISPLAY_NAMES[slug];
      expect(name.length, `no display name for ${slug}`).toBeGreaterThan(0);
      expect(name).not.toContain("-");
      expect(name).not.toMatch(/^scan_/);
      expect(name.slice(0, 1)).toBe(name.slice(0, 1).toUpperCase());
    }
  });

  it("passes the proposal claim guard, names and dimension lines alike", () => {
    const lines = publishedSlugs()
      .map((slug) => formatRoomDimensions(slug))
      .filter((line): line is string => line !== null);
    for (const value of [...Object.values(ROOM_DISPLAY_NAMES), ...lines]) {
      expect(findUnsupportedProposalClaim(value), `claim guard tripped on: ${value}`).toBeNull();
    }
  });
});
