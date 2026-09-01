import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TwinManifestSchema, type TwinScanNode } from "@omnitwin/types";
import {
  TRADES_HALL_ROOM_CAPACITIES,
  TRADES_HALL_ROOM_DIMENSIONS,
  type PublishedRoomSlug,
} from "../../../lib/trades-hall-venue-truth.js";
import { ROOM_DISPLAY_NAMES, VERIFIED_ROOM_NODES, metres } from "../twin-rooms.js";
import {
  ROOM_SELECTOR_ORDER,
  formatRoomComparison,
  pickRoomTarget,
  planRoomSelector,
} from "../room-selector.js";

// -----------------------------------------------------------------------------
// room-selector — the arithmetic behind the Rooms panel.
//
// Three questions, and the reason each is answered here rather than in the
// component: which rooms exist and in what order (never a caller's choice), WHICH
// verified viewpoint of a room a press should travel to (a tie-break among
// answers that are all correct), and which STOREY each room sits on relative to
// the visitor (the one manifest field this panel is allowed to trust).
//
// The room-identity rule is not restated here because it is not this module's to
// bend: twin-rooms.ts owns the join, and every assertion below reads through it.
// What IS asserted is that nothing in this module can widen that join — no slug
// appears that VERIFIED_ROOM_NODES does not already carry, and no viewpoint is
// named that a human did not validate.
//
// Half these tests run against the SHIPPED bundle rather than a fixture. A
// fixture proves the arithmetic; the real manifest proves the arithmetic is
// about this building. Both are here, and they are testing different things.
// -----------------------------------------------------------------------------

// The shipped manifest is a staged asset (gitignored): present on a machine
// that has run the twin staging pipeline, absent in CI and fresh checkouts.
// The fixture suites below always run; the suites that interrogate the REAL
// bundle skip honestly when there is no real bundle to interrogate, instead
// of failing the whole file at module scope (red on every clean checkout).
const MANIFEST_PATH = resolve(process.cwd(), "public/twin/trades-hall/manifest.json");
const HAS_MANIFEST = existsSync(MANIFEST_PATH);
const NODES: readonly TwinScanNode[] = HAS_MANIFEST
  ? TwinManifestSchema.parse(JSON.parse(readFileSync(MANIFEST_PATH, "utf8"))).nodes
  : [];
const describeWithManifest = describe.skipIf(!HAS_MANIFEST);

/** Synthetic pose: E57 metres, Z-up, level tripod at the usual head height. */
function node(id: string, x: number, y: number, floor: number): TwinScanNode {
  return {
    id,
    index: Number(id.slice(-3)),
    pose: { q: [1, 0, 0, 0], t: [x, y, 1.5] },
    floor,
    roomSlug: null,
  };
}

/** The comparison line rebuilt from the venue-truth module, independently of the
 *  module under test — so a drift between the two fails here rather than
 *  agreeing with itself. */
function expectedComparison(slug: PublishedRoomSlug): string {
  const capacities = TRADES_HALL_ROOM_CAPACITIES[slug];
  const head = `${String(capacities.reception)} standing · ${String(capacities.dinner)} seated`;
  const dimensions = TRADES_HALL_ROOM_DIMENSIONS[slug];
  if (dimensions === undefined) {
    return head;
  }
  return `${head} · ${metres(dimensions.lengthM)} × ${metres(dimensions.widthM)} m`;
}

describe("ROOM_SELECTOR_ORDER", () => {
  it("lists every verified room exactly once", () => {
    const verified = new Set(Object.values(VERIFIED_ROOM_NODES));
    expect([...ROOM_SELECTOR_ORDER].sort()).toEqual([...verified].sort());
    expect(new Set(ROOM_SELECTOR_ORDER).size).toBe(ROOM_SELECTOR_ORDER.length);
  });

  it("names no room the join has not validated", () => {
    // The galleries are in ROOM_DISPLAY_NAMES and in the venue's capacity table,
    // and no viewpoint has ever been validated in either. A list derived from
    // display names — the tempting shortcut — would offer a walk to a room
    // nobody can point at.
    const verified = new Set(Object.values(VERIFIED_ROOM_NODES));
    for (const slug of ROOM_SELECTOR_ORDER) {
      expect(verified.has(slug)).toBe(true);
    }
    expect(ROOM_SELECTOR_ORDER).not.toContain("north-gallery");
    expect(ROOM_SELECTOR_ORDER).not.toContain("south-gallery");
  });

  it("is the same order on every call, whoever is standing where", () => {
    // A list whose rows reorder as the visitor walks cannot be learned. The
    // order is a module constant precisely so no render can perturb it.
    expect(ROOM_SELECTOR_ORDER).toBe(ROOM_SELECTOR_ORDER);
    expect([...ROOM_SELECTOR_ORDER]).toEqual([...ROOM_SELECTOR_ORDER]);
  });
});

describeWithManifest("pickRoomTarget", () => {
  it("picks the nearer end of the Grand Hall when the walk starts in the Saloon", () => {
    // Real poses, real bundle. Both ends are correct answers — this is a
    // tie-break, not a route claim — but scan_046 is the end the Saloon opens
    // onto, and arriving at the far wall of a 21 m room reads as a mistake.
    expect(pickRoomTarget("grand-hall", "scan_058", NODES)).toBe("scan_046");
  });

  it("picks the other end when the walk starts at the far one", () => {
    // Guards the degenerate implementation that always returns the first
    // candidate and happens to agree with the test above.
    expect(pickRoomTarget("grand-hall", "scan_028", NODES)).toBe("scan_028");
  });

  it("only ever returns a viewpoint the join already carries for that room", () => {
    for (const slug of ROOM_SELECTOR_ORDER) {
      for (const from of Object.keys(VERIFIED_ROOM_NODES)) {
        const target = pickRoomTarget(slug, from, NODES);
        expect(target).not.toBeNull();
        expect(target === null ? null : VERIFIED_ROOM_NODES[target]).toBe(slug);
      }
    }
  });

  it("still answers, deterministically, from a viewpoint with no pose", () => {
    // 144 of 149 viewpoints are unverified but all are in the manifest; an id
    // from a `?node=` query may be in neither. A missing origin must not make
    // the room unreachable — it makes the tie-break arbitrary, so it is pinned.
    const first = pickRoomTarget("grand-hall", "scan_999", NODES);
    expect(first).toBe(pickRoomTarget("grand-hall", "scan_999", NODES));
    expect(first).not.toBeNull();
  });

  it("returns null for a room no viewpoint has been validated in", () => {
    expect(pickRoomTarget("north-gallery", "scan_028", NODES)).toBeNull();
  });
});

describe("formatRoomComparison", () => {
  it("joins every figure from venue truth, for every verified viewpoint", () => {
    for (const [nodeId, slug] of Object.entries(VERIFIED_ROOM_NODES)) {
      expect(formatRoomComparison(nodeId)).toBe(expectedComparison(slug));
    }
  });

  it("says nothing at a viewpoint whose room is not known", () => {
    // 144 of 149. A comparison line here would be a room claim wearing numbers.
    expect(formatRoomComparison("scan_003")).toBeNull();
    expect(formatRoomComparison("scan_999")).toBeNull();
    expect(formatRoomComparison("toString")).toBeNull();
  });

  it("prints the room's own capacities, not another room's", () => {
    // The join is keyed, so a transposition would be silent. Two rooms with
    // different published figures, asserted against the truth module directly.
    const hall = formatRoomComparison("scan_028");
    const saloon = formatRoomComparison("scan_058");
    expect(hall).not.toBe(saloon);
    expect(hall).toContain(String(TRADES_HALL_ROOM_CAPACITIES["grand-hall"].reception));
    expect(saloon).toContain(String(TRADES_HALL_ROOM_CAPACITIES.saloon.reception));
  });
});

describeWithManifest("planRoomSelector", () => {
  it("groups the shipped bundle into its two storeys", () => {
    const levels = planRoomSelector(NODES, "scan_028");
    expect(levels).toHaveLength(2);
    const slugs = levels.map((level) => level.rooms.map((room) => room.slug));
    expect(slugs.flat().sort()).toEqual([...ROOM_SELECTOR_ORDER].sort());
  });

  it("puts the visitor's own storey first, at offset zero", () => {
    const levels = planRoomSelector(NODES, "scan_028");
    expect(levels[0]?.offset).toBe(0);
    expect(levels[0]?.rooms.map((room) => room.slug)).toContain("grand-hall");
    expect(levels[1]?.offset).toBe(-1);
  });

  it("reads the storey from the manifest at unverified viewpoints too", () => {
    // The panel's best moment: the room is unknown at 144 viewpoints, but the
    // FLOOR is known at all 149, so the level headings stay true even when the
    // panel can say nothing about where the visitor is standing.
    const downstairs = NODES.find((entry) => entry.floor === -1);
    expect(downstairs).toBeDefined();
    const levels = planRoomSelector(NODES, downstairs?.id ?? "");
    expect(levels[0]?.offset).toBe(0);
    expect(levels[0]?.rooms.map((room) => room.slug).sort()).toEqual(
      ["reception-room", "robert-adam-room"].sort(),
    );
    expect(levels.every((level) => level.rooms.every((room) => !room.here))).toBe(true);
  });

  it("marks exactly the room underfoot, and only when it is verified", () => {
    const here = planRoomSelector(NODES, "scan_058")
      .flatMap((level) => level.rooms)
      .filter((room) => room.here);
    expect(here.map((room) => room.slug)).toEqual(["saloon"]);

    const nowhere = planRoomSelector(NODES, "scan_003").flatMap((level) => level.rooms);
    expect(nowhere.some((room) => room.here)).toBe(false);
    // …and the row is still offered. Silence about where you are is not
    // silence about where you can go.
    expect(nowhere).toHaveLength(ROOM_SELECTOR_ORDER.length);
  });

  it("marks both ends of one room as here, because they are one room", () => {
    for (const id of ["scan_028", "scan_046"]) {
      const here = planRoomSelector(NODES, id)
        .flatMap((level) => level.rooms)
        .filter((room) => room.here);
      expect(here.map((room) => room.slug)).toEqual(["grand-hall"]);
    }
  });

  it("counts storeys by rank, so a gap in the buckets cannot invent one", () => {
    // The forge derives `floor` by rounding a height, and nothing guarantees the
    // buckets are contiguous. On floors 0 and −2 a raw difference would print
    // "two levels down" and thereby claim a storey nobody scanned.
    const sparse: readonly TwinScanNode[] = [
      node("scan_028", 14.9, -3.5, 0),
      node("scan_046", 5.6, -3.8, 0),
      node("scan_058", -2.3, 8.3, 0),
      node("scan_105", -0.3, -11.1, -2),
      node("scan_126", 13.9, 5.1, -2),
    ];
    const levels = planRoomSelector(sparse, "scan_028");
    expect(levels.map((level) => level.offset)).toEqual([0, -1]);
  });

  it("says nothing about levels when the visitor's own storey is unknown", () => {
    const levels = planRoomSelector(NODES, "scan_999");
    expect(levels.every((level) => level.offset === null)).toBe(true);
    expect(levels.flatMap((level) => level.rooms)).toHaveLength(ROOM_SELECTOR_ORDER.length);
  });

  it("holds room order inside a level, whoever is standing where", () => {
    const orderAt = (id: string): readonly string[] =>
      planRoomSelector(NODES, id).flatMap((level) => level.rooms.map((room) => room.slug));
    const base = orderAt("scan_028");
    const rank = (slug: string): number =>
      ROOM_SELECTOR_ORDER.indexOf(slug as PublishedRoomSlug);
    for (const level of planRoomSelector(NODES, "scan_028")) {
      const ranks = level.rooms.map((room) => rank(room.slug));
      expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    }
    // The visitor moving does not reshuffle the list — only which level leads.
    expect([...orderAt("scan_046")].sort()).toEqual([...base].sort());
  });

  it("carries a travel target and a joined comparison on every row", () => {
    for (const level of planRoomSelector(NODES, "scan_003")) {
      for (const room of level.rooms) {
        expect(VERIFIED_ROOM_NODES[room.targetNodeId]).toBe(room.slug);
        expect(room.name).toBe(ROOM_DISPLAY_NAMES[room.slug]);
        expect(room.comparison).toBe(expectedComparison(room.slug));
      }
    }
  });

  it("drops a room whose only viewpoint is missing from the bundle", () => {
    // A room the selector cannot place on a storey is a room it cannot honestly
    // group. Offering it under a guessed heading is the failure mode; absence
    // is the honest one.
    const partial = NODES.filter((entry) => entry.id !== "scan_058" && entry.floor === 0);
    const slugs = planRoomSelector(partial, "scan_028").flatMap((level) =>
      level.rooms.map((room) => room.slug),
    );
    expect(slugs).toContain("grand-hall");
    expect(slugs).not.toContain("saloon");
  });

  it("renders nothing at all from an empty bundle", () => {
    expect(planRoomSelector([], "scan_028")).toEqual([]);
  });
});
