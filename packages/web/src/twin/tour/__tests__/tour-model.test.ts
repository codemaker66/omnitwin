import type { TwinNavEdge } from "@omnitwin/types";
import { findUnsupportedProposalClaim } from "@omnitwin/types";
import { describe, expect, it } from "vitest";
import { ROOM_DISPLAY_NAMES, VERIFIED_ROOM_NODES } from "../../shell/twin-rooms.js";
import { MAX_USHER_HOPS } from "../../travel-route.js";
import type { TwinLook } from "../../twin-look.js";
import { HOP_SPRING } from "../../useTwinWalk.js";
import { TOUR_DEFAULT_TITLE, allTourCopy, tourCaption } from "../tour-copy.js";
import {
  DEFAULT_DWELL_MS,
  DEFAULT_TOUR_NODE_ORDER,
  advanceStop,
  buildDefaultTour,
  buildTour,
  hopDurationMs,
  resolveTourLeg,
  resolveTourRoute,
  retreatStop,
  stopIndexAtNode,
  stopReachable,
  tourDurationMs,
  tourNamesOnlyVerifiedRooms,
  type Tour,
} from "../tour-model.js";

// -----------------------------------------------------------------------------
// tour-model — the sequencing, the routing, and the one thing that must never
// happen.
//
// The last of those is why this file leads with it. A guided tour is the surface
// most likely to name a room it has not earned: it is curated, curation implies
// knowledge, and 144 of the twin's 149 viewpoints have no validated room at all.
// So the first suite here is about identity, not about playback, and it is
// written to fail on forgeries rather than merely to pass on the shipped tour — a
// test that only asserts the good case cannot tell you whether the guard exists.
// -----------------------------------------------------------------------------

/**
 * A nav graph over the five validated viewpoints plus two corridor nodes.
 *
 *   scan_126 — hall_a — scan_058 — scan_028 — scan_046 — hall_b — scan_105
 *
 * Synthetic, like __fixtures__/twin-fixture.ts: real bundles are gitignored, and
 * the routing under test cares only about topology. Distances are metre-round.
 */
const EDGES: readonly TwinNavEdge[] = [
  { a: "scan_126", b: "hall_a", distanceM: 2 },
  { a: "hall_a", b: "scan_058", distanceM: 2 },
  { a: "scan_058", b: "scan_028", distanceM: 3 },
  { a: "scan_028", b: "scan_046", distanceM: 8 },
  { a: "scan_046", b: "hall_b", distanceM: 2 },
  { a: "hall_b", b: "scan_105", distanceM: 2 },
];

/** The same graph with nothing reaching scan_105 — the unreachable case, which
 *  must fall back to a teleport rather than stranding the tour. */
const EDGES_WITHOUT_LAST: readonly TwinNavEdge[] = EDGES.filter(
  (edge) => edge.a !== "scan_105" && edge.b !== "scan_105",
);

/** A corridor long enough that the Usher gives up on gliding it. Built from
 *  MAX_USHER_HOPS so it cannot drift away from the constant it is testing. */
function longCorridor(from: string, to: string): readonly TwinNavEdge[] {
  const edges: TwinNavEdge[] = [];
  let previous = from;
  for (let step = 1; step <= MAX_USHER_HOPS; step += 1) {
    const next = `corridor_${String(step)}`;
    edges.push({ a: previous, b: next, distanceM: 1 });
    previous = next;
  }
  edges.push({ a: previous, b: to, distanceM: 1 });
  return edges;
}

describe("the tour can only name rooms the twin has verified", () => {
  it("builds every default stop from a hand-validated viewpoint", () => {
    const tour = buildDefaultTour();

    expect(tour.stops).toHaveLength(DEFAULT_TOUR_NODE_ORDER.length);
    for (const stop of tour.stops) {
      // Not "is a known id" — is the SAME slug twin-rooms binds to that id. A
      // stop carrying grand-hall for scan_058 would pass a weaker assertion and
      // put "Grand Hall" over a photograph of the Saloon.
      expect(VERIFIED_ROOM_NODES[stop.nodeId]).toBe(stop.slug);
    }
    expect(tourNamesOnlyVerifiedRooms(tour)).toBe(true);
  });

  it("drops viewpoints whose room nobody has confirmed", () => {
    // scan_003 is one of the 144 real ids with roomSlug: null. It must not
    // become a stop, and must not become a stop labelled "Unknown" either.
    const tour = buildTour(["scan_028", "scan_003", "scan_058"]);

    expect(tour.stops.map((stop) => stop.nodeId)).toEqual(["scan_028", "scan_058"]);
  });

  it("builds nothing at all from a list of unvalidated viewpoints", () => {
    expect(buildTour(["scan_003", "scan_004"]).stops).toEqual([]);
  });

  it("refuses a tour whose stop carries another room's slug", () => {
    const honest = buildDefaultTour();
    const first = honest.stops[0];
    expect(first).toBeDefined();
    if (first === undefined) {
      return;
    }
    // scan_126 is the Reception Room. Forge it into the Grand Hall — the exact
    // failure the whole module exists to prevent — and keep everything else.
    const forged: Tour = {
      ...honest,
      stops: [{ ...first, slug: "grand-hall", caption: tourCaption("open", "grand-hall") }],
    };

    expect(tourNamesOnlyVerifiedRooms(forged)).toBe(false);
  });

  it("refuses a tour whose caption was written by hand", () => {
    const honest = buildDefaultTour();
    const first = honest.stops[0];
    expect(first).toBeDefined();
    if (first === undefined) {
      return;
    }
    // Correct slug, invented sentence. The slug check alone would pass this,
    // which is why the caption is pinned to the generated set as well.
    const forged: Tour = {
      ...honest,
      stops: [{ ...first, caption: "The Reception Room, with its four west windows." }],
    };

    expect(tourNamesOnlyVerifiedRooms(forged)).toBe(false);
  });

  it("names no room outside twin-rooms' own display map", () => {
    const known = Object.values(ROOM_DISPLAY_NAMES);
    for (const stop of buildDefaultTour().stops) {
      expect(known).toContain(ROOM_DISPLAY_NAMES[stop.slug]);
      expect(stop.caption).toContain(ROOM_DISPLAY_NAMES[stop.slug]);
    }
  });
});

describe("the default tour's shape", () => {
  it("opens, moves on, repeats a room, and closes", () => {
    const tour = buildDefaultTour();

    // scan_028 and scan_046 are the same room; the fourth stop is therefore the
    // only "again", and it is DERIVED — no stop declares its own beat.
    expect(tour.stops.map((stop) => stop.beat)).toEqual([
      "open",
      "onward",
      "onward",
      "again",
      "last",
    ]);
  });

  it("gives every stop the same dwell unless asked otherwise", () => {
    expect(buildDefaultTour().stops.every((stop) => stop.dwellMs === DEFAULT_DWELL_MS)).toBe(true);
    expect(buildDefaultTour({ dwellMs: 3200 }).stops.every((stop) => stop.dwellMs === 3200)).toBe(
      true,
    );
  });

  it("carries the default title", () => {
    expect(buildDefaultTour().title).toBe(TOUR_DEFAULT_TITLE);
  });

  it("ships with no invented camera framing", () => {
    // Only the manifest's entryLook is an authored pose anywhere in this system.
    // A default yaw would be a claim about what is in frame that nobody has made.
    expect(buildDefaultTour().stops.every((stop) => stop.look === null)).toBe(true);
  });

  it("accepts an authored pose and refuses one measured elsewhere", () => {
    const mine: TwinLook = { nodeId: "scan_028", yawDeg: 42, pitchDeg: -3, fovDeg: 70 };
    const stolen: TwinLook = { nodeId: "scan_046", yawDeg: 42, pitchDeg: -3, fovDeg: 70 };

    const kept = buildTour(["scan_028"], { looks: { scan_028: mine } });
    expect(kept.stops[0]?.look).toEqual(mine);

    // Keyed to scan_028 but carrying scan_046's own id: the angles were measured
    // from a different standpoint, so applying them would aim at another room.
    const dropped = buildTour(["scan_028"], { looks: { scan_028: stolen } });
    expect(dropped.stops[0]?.look).toBeNull();
  });
});

describe("sequencing", () => {
  const tour = buildDefaultTour();
  const last = tour.stops.length - 1;

  it("advances and retreats through the middle", () => {
    expect(advanceStop(tour, 0)).toBe(1);
    expect(advanceStop(tour, 2)).toBe(3);
    expect(retreatStop(tour, 3)).toBe(2);
    expect(retreatStop(tour, 1)).toBe(0);
  });

  it("stops at the ends rather than wrapping by default", () => {
    expect(advanceStop(tour, last)).toBeNull();
    expect(retreatStop(tour, 0)).toBeNull();
  });

  it("wraps only when asked", () => {
    expect(advanceStop(tour, last, { loop: true })).toBe(0);
    expect(retreatStop(tour, 0, { loop: true })).toBe(last);
  });

  it("enters at an end from an index that addresses nothing", () => {
    // A host starting from "nowhere", or holding a stale index into a tour that
    // has since been rebuilt shorter. Null there would read as "already over".
    expect(advanceStop(tour, -1)).toBe(0);
    expect(advanceStop(tour, 99)).toBe(0);
    expect(advanceStop(tour, 1.5)).toBe(0);
    expect(retreatStop(tour, -1)).toBe(last);
    expect(retreatStop(tour, 99)).toBe(last);
  });

  it("has nowhere to go in an empty tour, looping or not", () => {
    const empty = buildTour([]);
    expect(advanceStop(empty, 0)).toBeNull();
    expect(retreatStop(empty, 0)).toBeNull();
    expect(advanceStop(empty, 0, { loop: true })).toBeNull();
    expect(retreatStop(empty, 0, { loop: true })).toBeNull();
  });

  it("finds where a viewpoint sits, and says so when it does not", () => {
    expect(stopIndexAtNode(tour, "scan_028")).toBe(2);
    expect(stopIndexAtNode(tour, "scan_003")).toBeNull();
  });
});

describe("reachability", () => {
  const tour = buildDefaultTour();

  it("counts standing on the stop as reached", () => {
    expect(stopReachable(tour, "scan_028", 2, [])).toBe(true);
  });

  it("asks the nav graph for everything else", () => {
    expect(stopReachable(tour, "scan_126", 4, EDGES)).toBe(true);
    expect(stopReachable(tour, "scan_126", 4, EDGES_WITHOUT_LAST)).toBe(false);
  });

  it("returns false for an index that addresses no stop", () => {
    expect(stopReachable(tour, "scan_126", 99, EDGES)).toBe(false);
  });
});

describe("resolving a stop to a journey", () => {
  const tour = buildDefaultTour();
  const grandHall = tour.stops[2];
  const robertAdam = tour.stops[4];

  it("stays put when already standing there", () => {
    expect(grandHall).toBeDefined();
    if (grandHall === undefined) {
      return;
    }
    expect(resolveTourLeg("scan_028", grandHall, EDGES)).toEqual({
      nodeId: "scan_028",
      mode: "stay",
      hops: [],
      reachable: true,
      look: null,
    });
  });

  it("glides the real corridor, target included and origin excluded", () => {
    expect(grandHall).toBeDefined();
    if (grandHall === undefined) {
      return;
    }
    const leg = resolveTourLeg("scan_126", grandHall, EDGES);
    expect(leg.mode).toBe("glide");
    expect(leg.hops).toEqual(["hall_a", "scan_058", "scan_028"]);
    expect(leg.reachable).toBe(true);
  });

  it("teleports under reduced motion, and says the route was still there", () => {
    expect(grandHall).toBeDefined();
    if (grandHall === undefined) {
      return;
    }
    const leg = resolveTourLeg("scan_126", grandHall, EDGES, { instant: true });
    expect(leg.mode).toBe("jump");
    expect(leg.hops).toEqual([]);
    // `reachable` is about the building, not about how we chose to travel it.
    expect(leg.reachable).toBe(true);
  });

  it("teleports when the nav graph does not connect the two", () => {
    expect(robertAdam).toBeDefined();
    if (robertAdam === undefined) {
      return;
    }
    const leg = resolveTourLeg("scan_126", robertAdam, EDGES_WITHOUT_LAST);
    expect(leg.mode).toBe("jump");
    expect(leg.reachable).toBe(false);
  });

  it("teleports rather than walking a visitor down a marathon", () => {
    expect(grandHall).toBeDefined();
    if (grandHall === undefined) {
      return;
    }
    const leg = resolveTourLeg("scan_126", grandHall, longCorridor("scan_126", "scan_028"));
    expect(leg.mode).toBe("jump");
    // Reachable, just too far to be an usher — the distinction the two fields
    // exist for, and the difference between a fallback and a failure.
    expect(leg.reachable).toBe(true);
  });

  it("carries the stop's framing through onto the leg", () => {
    const look: TwinLook = { nodeId: "scan_028", yawDeg: 12, pitchDeg: -4, fovDeg: 68 };
    const framed = buildTour(["scan_028"], { looks: { scan_028: look } }).stops[0];
    expect(framed).toBeDefined();
    if (framed === undefined) {
      return;
    }
    expect(resolveTourLeg("scan_126", framed, EDGES).look).toEqual(look);
  });
});

describe("resolving the whole tour", () => {
  const tour = buildDefaultTour();

  it("chains each leg from the previous stop, not from the start", () => {
    const legs = resolveTourRoute(tour, "scan_126", EDGES);

    expect(legs.map((leg) => leg.nodeId)).toEqual(DEFAULT_TOUR_NODE_ORDER);
    // Standing on stop 1 already: nothing to travel.
    expect(legs[0]?.mode).toBe("stay");
    // The Saloon from the Reception Room, through the one corridor node.
    expect(legs[1]?.hops).toEqual(["hall_a", "scan_058"]);
    // The Grand Hall's far end is one hop from its near end — which is only true
    // if this leg departed from scan_028 rather than from scan_126.
    expect(legs[3]?.hops).toEqual(["scan_046"]);
  });

  it("adds every dwell and every hop", () => {
    const hopMs = 700;
    const legs = resolveTourRoute(tour, "scan_126", EDGES);
    const hops = legs.reduce((total, leg) => total + leg.hops.length, 0);

    expect(tourDurationMs(tour, "scan_126", EDGES, { hopMs })).toBe(
      DEFAULT_DWELL_MS * tour.stops.length + hops * hopMs,
    );
  });

  it("charges a teleport one crossfade, not nothing", () => {
    const hopMs = 700;
    const instant = tourDurationMs(tour, "scan_126", EDGES, { hopMs, instant: true });
    // Four jumps (the first stop is a stay) plus five dwells.
    expect(instant).toBe(DEFAULT_DWELL_MS * tour.stops.length + 4 * hopMs);
  });

  it("estimates the shipped tour at under a minute of standing and walking", () => {
    const hopMs = hopDurationMs(HOP_SPRING.stiffness, HOP_SPRING.damping);
    const ms = tourDurationMs(tour, "scan_126", EDGES, { hopMs });
    // The dwell budget was chosen so five stops plus travel land inside the
    // patience an autoplaying thing gets. If a stop is added or the dwell grows,
    // this is where that decision is re-made rather than drifted past.
    expect(ms).toBeLessThan(60_000);
  });
});

describe("hop duration", () => {
  it("matches the walk's own spring, derived rather than typed in", () => {
    // The drift gate. HOP_SPRING is the walk's real spring; if it is retuned,
    // this fails and the tour's duration estimate is re-derived deliberately
    // instead of quietly meaning something else.
    expect(HOP_SPRING.stiffness).toBe(120);
    expect(HOP_SPRING.damping).toBe(22);
    expect(hopDurationMs(HOP_SPRING.stiffness, HOP_SPRING.damping)).toBe(686);
  });

  it("returns whole milliseconds", () => {
    const ms = hopDurationMs(HOP_SPRING.stiffness, HOP_SPRING.damping);
    expect(Number.isInteger(ms)).toBe(true);
    expect(ms).toBeGreaterThan(0);
  });

  it("solves the critically damped case", () => {
    // k = 100, c = 20, m = 1 → ω₀ = 10, ζ = 1 exactly, so y(t) = 1 − (1+10t)e^(−10t).
    // The first millisecond at which that reaches 0.995.
    expect(hopDurationMs(100, 20)).toBe(744);
  });

  it("settles sooner for a stiffer spring and later for a tighter target", () => {
    expect(hopDurationMs(480, 44)).toBeLessThan(hopDurationMs(120, 22));
    expect(hopDurationMs(120, 22, 0.5)).toBeLessThan(hopDurationMs(120, 22, 0.995));
  });

  it("finds the FIRST crossing of an underdamped spring, not a later one", () => {
    // ζ = 0.2 — heavily oscillatory, so the response crosses 0.995 on the way up
    // and again after every overshoot. A bisection would happily return a later
    // crossing; the answer wanted is the first, and it must land before the
    // response's first peak at t = π/ω_d.
    const first = hopDurationMs(400, 8, 0.995);
    const peakMs = (Math.PI / (Math.sqrt(400) * Math.sqrt(1 - 0.2 * 0.2))) * 1000;
    expect(first).toBeLessThan(Math.round(peakMs));
  });

  it("refuses to guess for a degenerate spring", () => {
    expect(hopDurationMs(0, 22)).toBe(0);
    expect(hopDurationMs(120, -1)).toBe(0);
    expect(hopDurationMs(120, 22, 0.995, 0)).toBe(0);
  });
});

describe("the copy passes the claim guard", () => {
  it("finds no unsupported certainty claim anywhere in the tour's script", () => {
    for (const line of allTourCopy()) {
      expect(findUnsupportedProposalClaim(line)).toBeNull();
    }
  });

  it("sweeps a caption for every room the tour could ever name", () => {
    // A sweep list that drifts from what the component renders is worse than no
    // sweep: it reports green over copy nobody checked. This pins the list to the
    // only thing that can vary — the room names — so a sixth room added to
    // twin-rooms cannot silently ship four unswept captions.
    const swept = allTourCopy();
    for (const name of Object.values(ROOM_DISPLAY_NAMES)) {
      expect(swept.some((line) => line.includes(name))).toBe(true);
    }
  });

  it("publishes a non-empty list", () => {
    // Guards the degenerate pass: an empty list satisfies both assertions above
    // while checking nothing at all.
    expect(allTourCopy().length).toBeGreaterThan(0);
  });

  it("renders every shipped caption from that swept list", () => {
    const swept = allTourCopy();
    for (const stop of buildDefaultTour().stops) {
      expect(swept).toContain(stop.caption);
    }
  });
});
