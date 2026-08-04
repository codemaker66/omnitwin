import { describe, expect, it } from "vitest";
import { findUnsupportedProposalClaim } from "@omnitwin/types";
import {
  CAPACITY_FORMATS,
  TRADES_HALL_ROOM_CAPACITIES,
  TRADES_HALL_ROOM_DIMENSIONS,
  type PublishedRoomSlug,
  type RoomDimensions,
} from "../../../lib/trades-hall-venue-truth.js";
import {
  ROOM_DISPLAY_NAMES,
  VERIFIED_ROOM_NODES,
  formatRoomDimensions,
  lookUpRoom,
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

describe("formatRoomDimensions", () => {
  it("renders the published extent, joined from venue truth", () => {
    const truth = publishedDimensions("saloon");
    expect(formatRoomDimensions("saloon")).toBe(
      `${String(truth.lengthM)} × ${String(truth.widthM)} × ${String(truth.heightM)} m`,
    );
  });

  it("keeps fractional metres intact rather than rounding a room away", () => {
    const truth = publishedDimensions("robert-adam-room");
    const line = formatRoomDimensions("robert-adam-room");
    expect(line).toContain(String(truth.lengthM));
    expect(line).toContain(String(truth.heightM));
  });

  it("renders the published note when the venue publishes one", () => {
    const truth = publishedDimensions("grand-hall");
    // The Grand Hall is the room carrying a qualifier today — its dome.
    expect(truth.note).toBeDefined();
    const note = truth.note ?? "";
    expect(formatRoomDimensions("grand-hall")).toBe(
      `${String(truth.lengthM)} × ${String(truth.widthM)} × ${String(truth.heightM)} m — ${note}`,
    );
  });

  it("appends nothing when there is no published note", () => {
    const truth = publishedDimensions("reception-room");
    expect(truth.note).toBeUndefined();
    expect(formatRoomDimensions("reception-room")).not.toContain("—");
  });

  it("omits dimensions entirely for rooms the venue publishes none for", () => {
    // The galleries publish no dimensions. If the venue ever does publish them,
    // this fails on purpose — someone should look at the new figures.
    expect(TRADES_HALL_ROOM_DIMENSIONS["north-gallery"]).toBeUndefined();
    expect(TRADES_HALL_ROOM_DIMENSIONS["south-gallery"]).toBeUndefined();
    expect(formatRoomDimensions("north-gallery")).toBeNull();
    expect(formatRoomDimensions("south-gallery")).toBeNull();
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
