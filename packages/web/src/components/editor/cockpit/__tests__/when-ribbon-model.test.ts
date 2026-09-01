import { describe, expect, it } from "vitest";
import type { CalendarResponse } from "@omnitwin/types";
import {
  MIN_INGOT_DURATION_MS,
  beginRibbonDrag,
  buildRibbonDay,
  dropRibbonDrag,
  moveRibbonDrag,
  resolveTurnaroundGuideline,
} from "../when-ribbon-model.js";

// ---------------------------------------------------------------------------
// The When ribbon's pure model (Day Board S2) — tests written FIRST.
//
// Everything the ribbon believes is decided here, deterministically: which
// booking is the plan's ingot, which bookings are ghosts, where the hard
// (inked) exclusion zones and the hatched guideline buffers sit, how a drag
// proposal snaps/clamps/records overshoot for the rubber-band, and what a
// release commits. The DOM shell only converts pixels to milliseconds.
//
// Doctrine pinned here:
//  - Ink-vs-ink is DB truth → HARD clamp (the bounce).
//  - Turnaround is guidance → soft flag, never a clamp (the team judges).
//  - A pencil under an ink is a warning, never a block (diary parity).
//  - Buffers mirror the server engine EXACTLY: ink occupancies only, rule
//    resolved for the INCOMING side's eventType, most-specific wins, ties
//    toward the largest minutes.
// ---------------------------------------------------------------------------

const VENUE = "00000000-0000-4000-8000-000000000001";
const ROOM = "00000000-0000-4000-8000-0000000000a1";
const OTHER_ROOM = "00000000-0000-4000-8000-0000000000a2";
const EVENT = "00000000-0000-4000-8000-0000000000e1";
const SELF = "00000000-0000-4000-8000-0000000000b1";
const GHOST = "00000000-0000-4000-8000-0000000000c1";
const GHOST_2 = "00000000-0000-4000-8000-0000000000c2";

const MIN = 60_000;
/** Noon UTC, a September Wednesday — 13:00 venue wall time. */
const NOON = Date.parse("2026-09-16T12:00:00.000Z");

function booking(
  id: string,
  startMs: number,
  endMs: number,
  overrides: Record<string, unknown> = {},
): CalendarResponse["entries"][number] {
  return {
    entryType: "booking",
    id,
    spaceId: ROOM,
    kind: "ink",
    status: "active",
    state: "ink",
    title: `Booking ${id.slice(-2)}`,
    eventType: "dinner",
    startsAt: new Date(startMs).toISOString(),
    endsAt: new Date(endMs).toISOString(),
    rank: null,
    jointFlag: false,
    decisionAt: null,
    ownerUserId: null,
    nextAction: null,
    nextActionDueAt: null,
    eventId: null,
    seriesId: null,
    ...overrides,
  } as CalendarResponse["entries"][number];
}

function response(
  entries: CalendarResponse["entries"],
  turnaroundRules?: CalendarResponse["turnaroundRules"],
): CalendarResponse {
  return {
    venueId: VENUE,
    range: {
      from: new Date(NOON - 24 * 60 * MIN).toISOString(),
      to: new Date(NOON + 24 * 60 * MIN).toISOString(),
    },
    rooms: [
      { id: ROOM, name: "Grand Hall", slug: "grand-hall", sortOrder: 0 },
      { id: OTHER_ROOM, name: "Saloon", slug: "saloon", sortOrder: 1 },
    ],
    entries,
    conflicts: {
      conflicts: [],
      checks: {
        inkDoubleBook: { status: "checked" },
        holdOverlap: { status: "checked" },
        turnaround: { status: "checked", uncoveredPairCount: 0, detail: "All gaps covered." },
      },
    },
    ...(turnaroundRules === undefined ? {} : { turnaroundRules }),
  };
}

const HOUSE_RULES = [
  { spaceId: null, eventType: null, name: "House default", minutes: 90, isActive: true },
  { spaceId: ROOM, eventType: null, name: "Grand Hall", minutes: 120, isActive: true },
  { spaceId: ROOM, eventType: "wedding", name: "Grand Hall wedding", minutes: 180, isActive: true },
];

function selfBooking(startMs: number, endMs: number, overrides: Record<string, unknown> = {}) {
  return booking(SELF, startMs, endMs, { eventId: EVENT, ...overrides });
}

// --- rule resolution: the server engine's semantics, mirrored --------------

describe("resolveTurnaroundGuideline", () => {
  it("falls back to the house-wide default", () => {
    const hit = resolveTurnaroundGuideline(HOUSE_RULES, OTHER_ROOM, "dinner");
    expect(hit).toEqual({ minutes: 90, name: "House default" });
  });

  it("a space rule beats the default; space+type beats space", () => {
    expect(resolveTurnaroundGuideline(HOUSE_RULES, ROOM, "dinner")?.minutes).toBe(120);
    expect(resolveTurnaroundGuideline(HOUSE_RULES, ROOM, "wedding")?.minutes).toBe(180);
  });

  it("a typed rule never matches a null incoming eventType", () => {
    const rules = [
      { spaceId: null, eventType: "wedding", name: "Weddings", minutes: 180, isActive: true },
    ];
    expect(resolveTurnaroundGuideline(rules, ROOM, null)).toBeNull();
  });

  it("inactive rules are ignored; ties resolve toward the LARGEST minutes", () => {
    const rules = [
      { spaceId: ROOM, eventType: null, name: "Old", minutes: 240, isActive: false },
      { spaceId: ROOM, eventType: null, name: "Short", minutes: 60, isActive: true },
      { spaceId: ROOM, eventType: null, name: "Long", minutes: 150, isActive: true },
    ];
    expect(resolveTurnaroundGuideline(rules, ROOM, "dinner")).toEqual({
      minutes: 150,
      name: "Long",
    });
  });

  it("no rules → null (guidelines unavailable, not zero)", () => {
    expect(resolveTurnaroundGuideline(undefined, ROOM, "dinner")).toBeNull();
    expect(resolveTurnaroundGuideline([], ROOM, "dinner")).toBeNull();
  });
});

// --- day construction ------------------------------------------------------

describe("buildRibbonDay", () => {
  it("finds the plan's booking by eventId and anchors the day on it", () => {
    const day = buildRibbonDay(
      response([selfBooking(NOON, NOON + 120 * MIN)], HOUSE_RULES),
      EVENT,
    );
    expect(day?.self.id).toBe(SELF);
    expect(day?.range.fromMs).toBeLessThanOrEqual(NOON);
    expect(day?.range.toMs).toBeGreaterThan(NOON + 120 * MIN);
  });

  it("no booking carries the plan's eventId → null (the not-in-the-Diary state)", () => {
    expect(buildRibbonDay(response([booking(GHOST, NOON, NOON + 60 * MIN)]), EVENT)).toBeNull();
  });

  it("ghosts are same-room, same-day bookings; other rooms and self are excluded", () => {
    const day = buildRibbonDay(
      response(
        [
          selfBooking(NOON, NOON + 60 * MIN),
          booking(GHOST, NOON + 120 * MIN, NOON + 180 * MIN),
          booking(GHOST_2, NOON + 120 * MIN, NOON + 180 * MIN, { spaceId: OTHER_ROOM }),
        ],
        HOUSE_RULES,
      ),
      EVENT,
    );
    expect(day?.ghosts.map((ghost) => ghost.id)).toEqual([GHOST]);
  });

  it("ink ghosts are HARD exclusions for an ink self, warnings for a pencil self", () => {
    const inkGhost = booking(GHOST, NOON + 120 * MIN, NOON + 180 * MIN);
    const asInk = buildRibbonDay(
      response([selfBooking(NOON, NOON + 60 * MIN), inkGhost], HOUSE_RULES),
      EVENT,
    );
    expect(asInk?.ghosts[0]?.exclusion).toBe("hard");

    const asPencil = buildRibbonDay(
      response(
        [selfBooking(NOON, NOON + 60 * MIN, { kind: "hold", state: "hold" }), inkGhost],
        HOUSE_RULES,
      ),
      EVENT,
    );
    expect(asPencil?.ghosts[0]?.exclusion).toBe("warning");
  });

  it("a pencil ghost is never an exclusion — holds overlap by design", () => {
    const day = buildRibbonDay(
      response(
        [
          selfBooking(NOON, NOON + 60 * MIN),
          booking(GHOST, NOON + 120 * MIN, NOON + 180 * MIN, { kind: "hold", state: "hold" }),
        ],
        HOUSE_RULES,
      ),
      EVENT,
    );
    expect(day?.ghosts[0]?.exclusion).toBe("none");
  });

  it("buffers hug ink ghosts only, sized by the engine's own resolution: incoming side's type", () => {
    // Ghost is a wedding — the buffer BEFORE it protects the changeover INTO
    // the wedding (180m); the buffer AFTER it protects the changeover into
    // the incoming self, a dinner (120m in this room).
    const day = buildRibbonDay(
      response(
        [
          selfBooking(NOON, NOON + 60 * MIN),
          booking(GHOST, NOON + 300 * MIN, NOON + 420 * MIN, { eventType: "wedding" }),
        ],
        HOUSE_RULES,
      ),
      EVENT,
    );
    const before = day?.buffers.find((buffer) => buffer.side === "before");
    const after = day?.buffers.find((buffer) => buffer.side === "after");
    expect(before?.minutes).toBe(180);
    expect(before?.endMs).toBe(NOON + 300 * MIN);
    expect(after?.minutes).toBe(120);
    expect(after?.startMs).toBe(NOON + 420 * MIN);
    expect(day?.guidelinesAvailable).toBe(true);
  });

  it("a pencil self earns no buffers — the engine never measures pencil turnarounds", () => {
    const day = buildRibbonDay(
      response(
        [
          selfBooking(NOON, NOON + 60 * MIN, { kind: "hold", state: "hold" }),
          booking(GHOST, NOON + 300 * MIN, NOON + 420 * MIN),
        ],
        HOUSE_RULES,
      ),
      EVENT,
    );
    expect(day?.buffers).toEqual([]);
  });

  it("without rules on the response, buffers are absent and honestly flagged unavailable", () => {
    const day = buildRibbonDay(
      response([selfBooking(NOON, NOON + 60 * MIN), booking(GHOST, NOON + 300 * MIN, NOON + 420 * MIN)]),
      EVENT,
    );
    expect(day?.buffers).toEqual([]);
    expect(day?.guidelinesAvailable).toBe(false);
  });

  it("a ghost's occupancy stretches over its event's phases in the room", () => {
    const day = buildRibbonDay(
      response(
        [
          selfBooking(NOON, NOON + 60 * MIN),
          booking(GHOST, NOON + 300 * MIN, NOON + 420 * MIN, { eventId: "00000000-0000-4000-8000-0000000000e2" }),
          {
            entryType: "phase",
            id: "00000000-0000-4000-8000-0000000000f1",
            spaceId: ROOM,
            eventId: "00000000-0000-4000-8000-0000000000e2",
            eventName: "Ghost do",
            name: "Setup",
            startsAt: new Date(NOON + 240 * MIN).toISOString(),
            endsAt: new Date(NOON + 300 * MIN).toISOString(),
            sortOrder: 0,
          } as CalendarResponse["entries"][number],
        ],
        HOUSE_RULES,
      ),
      EVENT,
    );
    expect(day?.ghosts[0]?.occStartMs).toBe(NOON + 240 * MIN);
    expect(day?.ghosts[0]?.occEndMs).toBe(NOON + 420 * MIN);
  });
});

// --- the drag reducer ------------------------------------------------------

function dayWithGhost(selfOverrides: Record<string, unknown> = {}) {
  const day = buildRibbonDay(
    response(
      [
        selfBooking(NOON, NOON + 120 * MIN, selfOverrides),
        booking(GHOST, NOON + 300 * MIN, NOON + 420 * MIN),
      ],
      HOUSE_RULES,
    ),
    EVENT,
  );
  if (day === null) throw new Error("fixture day did not build");
  return day;
}

describe("moveRibbonDrag", () => {
  it("snaps a move to 15 minutes, preserving duration exactly", () => {
    const day = dayWithGhost();
    const drag = moveRibbonDrag(beginRibbonDrag("move", day.self), day, 22 * MIN, false);
    expect(drag.proposedStartMs).toBe(NOON + 15 * MIN);
    expect(drag.proposedEndMs - drag.proposedStartMs).toBe(120 * MIN);
  });

  it("fine mode snaps to the minute", () => {
    const day = dayWithGhost();
    const drag = moveRibbonDrag(beginRibbonDrag("move", day.self), day, 22.4 * MIN, true);
    expect(drag.proposedStartMs).toBe(NOON + 22 * MIN);
  });

  it("an ink self CLAMPS at an ink ghost's edge and records the overshoot for the rubber-band", () => {
    const day = dayWithGhost();
    // Dragging right by 240m would land 16:00–18:00 over the 17:00 ghost.
    const drag = moveRibbonDrag(beginRibbonDrag("move", day.self), day, 240 * MIN, false);
    expect(drag.proposedEndMs).toBe(NOON + 300 * MIN); // touching, half-open, legal
    expect(drag.overshootMs).toBe(60 * MIN);
  });

  it("clamps from the left too when dragging back across a ghost", () => {
    const day = buildRibbonDay(
      response(
        [
          selfBooking(NOON + 480 * MIN, NOON + 540 * MIN),
          booking(GHOST, NOON + 300 * MIN, NOON + 420 * MIN),
        ],
        HOUSE_RULES,
      ),
      EVENT,
    );
    if (day === null) throw new Error("fixture");
    const drag = moveRibbonDrag(beginRibbonDrag("move", day.self), day, -120 * MIN, false);
    expect(drag.proposedStartMs).toBe(NOON + 420 * MIN);
    expect(drag.overshootMs).toBe(-60 * MIN);
  });

  it("a pencil self passes UNDER the ink with a warning, never a clamp", () => {
    const day = dayWithGhost({ kind: "hold", state: "hold" });
    const drag = moveRibbonDrag(beginRibbonDrag("move", day.self), day, 240 * MIN, false);
    expect(drag.proposedStartMs).toBe(NOON + 240 * MIN);
    expect(drag.overshootMs).toBe(0);
    expect(drag.coveredInkTitle).not.toBeNull();
  });

  it("entering a hatched buffer sets the soft flag — guidance, not a wall", () => {
    const day = dayWithGhost();
    // Move to 14:30–16:30: the tail sits inside the 120m guideline before the
    // 17:00 ghost (buffer 15:00–17:00) without touching the ghost itself.
    const drag = moveRibbonDrag(beginRibbonDrag("move", day.self), day, 150 * MIN, false);
    expect(drag.overshootMs).toBe(0);
    expect(drag.bufferHit?.minutes).toBe(120);
  });

  it("resize-end honours the minimum duration and clamps at a hard ghost", () => {
    const day = dayWithGhost();
    const shrink = moveRibbonDrag(beginRibbonDrag("resize-end", day.self), day, -600 * MIN, false);
    expect(shrink.proposedEndMs - shrink.proposedStartMs).toBe(MIN_INGOT_DURATION_MS);

    const grow = moveRibbonDrag(beginRibbonDrag("resize-end", day.self), day, 400 * MIN, false);
    expect(grow.proposedEndMs).toBe(NOON + 300 * MIN); // ghost start
    expect(grow.proposedStartMs).toBe(NOON); // the anchored edge never moves
  });

  it("resize-start moves only the opening edge", () => {
    const day = dayWithGhost();
    const drag = moveRibbonDrag(beginRibbonDrag("resize-start", day.self), day, 30 * MIN, false);
    expect(drag.proposedStartMs).toBe(NOON + 30 * MIN);
    expect(drag.proposedEndMs).toBe(NOON + 120 * MIN);
  });
});

describe("dropRibbonDrag", () => {
  it("an unmoved release is a noop — no PATCH, no confirm", () => {
    const day = dayWithGhost();
    const drop = dropRibbonDrag(moveRibbonDrag(beginRibbonDrag("move", day.self), day, 4 * MIN, false), day);
    // 4m snaps back to 0 — unchanged.
    expect(drop.effect).toBe("noop");
  });

  it("a moved ink requires the confirm step — ink resists", () => {
    const day = dayWithGhost();
    const drop = dropRibbonDrag(moveRibbonDrag(beginRibbonDrag("move", day.self), day, 60 * MIN, false), day);
    expect(drop.effect).toBe("commit");
    if (drop.effect !== "commit") return;
    expect(drop.needsInkConfirm).toBe(true);
    expect(drop.startsAt).toBe(new Date(NOON + 60 * MIN).toISOString());
    expect(drop.endsAt).toBe(new Date(NOON + 180 * MIN).toISOString());
  });

  it("a moved pencil commits without the confirm step, carrying its warning", () => {
    const day = dayWithGhost({ kind: "hold", state: "hold" });
    const drop = dropRibbonDrag(moveRibbonDrag(beginRibbonDrag("move", day.self), day, 240 * MIN, false), day);
    expect(drop.effect).toBe("commit");
    if (drop.effect !== "commit") return;
    expect(drop.needsInkConfirm).toBe(false);
    expect(drop.warning).toContain("cannot convert");
  });

  it("a release inside a buffer commits WITH the guideline copy — the team judges", () => {
    const day = dayWithGhost();
    const drop = dropRibbonDrag(moveRibbonDrag(beginRibbonDrag("move", day.self), day, 150 * MIN, false), day);
    expect(drop.effect).toBe("commit");
    if (drop.effect !== "commit") return;
    expect(drop.warning).toContain("guideline");
    expect(drop.warning).toContain("120");
  });
});
