import { describe, expect, it } from "vitest";
import type { CalendarResponse } from "@omnitwin/types";
import {
  MIN_INGOT_DURATION_MS,
  RIBBON_HANDLE_DEFAULTS,
  beginRibbonDrag,
  buildRibbonDay,
  deriveRibbonHandles,
  dropRibbonDrag,
  moveRibbonDrag,
  moveRibbonHandle,
  resolveTurnaroundGuideline,
  ribbonPhaseWrites,
  ribbonSlotWrite,
  type RibbonHandle,
  type RibbonHandles,
  type RibbonPhaseInput,
  type RibbonPhaseWrite,
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
    expect(drop.warning).toContain("cannot be confirmed");
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

// --- the phase handles (goal 19 S6) -----------------------------------------
//
// Four handles — setup, doors, live, clear-down — plus the end. The outer two
// are the booking's own edges (the Diary slot); the inner boundaries are the
// phases the ribbon owns by key: "setup", "arrival" (doors to live) and
// "breakdown" (shown as Clear-down). Every instant below is an explicit UTC
// ISO string, so the machine's zone cannot leak in.

const DAY = "2026-11-07";

/** An absolute UTC instant on the hire day from an "HH:MM" clock. */
function at(clock: string): number {
  return Date.parse(`${DAY}T${clock}:00.000Z`);
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** A full-day hire, 09:00 to 23:00 UTC. */
const HIRE = { startMs: at("09:00"), endMs: at("23:00") };
const MIDNIGHT = Date.parse("2026-11-08T00:00:00.000Z");
const ALL_HANDLES: readonly RibbonHandle[] = ["setup-start", "doors", "live", "clear-down", "end"];

function phaseInput(
  id: string,
  templateKey: string | null,
  name: string,
  startMs: number,
  endMs: number,
): RibbonPhaseInput {
  return { id, templateKey, name, startsAt: iso(startMs), endsAt: iso(endMs) };
}

const SETUP_PHASE = phaseInput("p-setup", "setup", "Setup", at("09:00"), at("10:30"));
const ARRIVAL_PHASE = phaseInput("p-arrival", "arrival", "Arrival", at("10:30"), at("11:15"));
const BREAKDOWN_PHASE = phaseInput("p-breakdown", "breakdown", "Clear-down", at("21:30"), at("23:00"));
const STORED = [SETUP_PHASE, ARRIVAL_PHASE, BREAKDOWN_PHASE];

function expectHandleInvariant(handles: RibbonHandles): void {
  for (const value of Object.values(handles)) expect(Number.isFinite(value)).toBe(true);
  expect(handles.setupStartMs).toBeLessThanOrEqual(handles.doorsMs);
  expect(handles.doorsMs).toBeLessThanOrEqual(handles.liveMs);
  expect(handles.liveMs + MIN_INGOT_DURATION_MS).toBeLessThanOrEqual(handles.clearDownMs);
  expect(handles.clearDownMs).toBeLessThanOrEqual(handles.endMs);
}

/** What the office's store would hold after the shell sent these writes. */
function applyWrites(
  phases: readonly RibbonPhaseInput[],
  writes: readonly RibbonPhaseWrite[],
): readonly RibbonPhaseInput[] {
  let next = [...phases];
  for (const write of writes) {
    const startMs = Date.parse(write.startsAt);
    const endMs = startMs + write.durationMinutes * MIN;
    if (write.op === "delete") {
      next = next.filter((phase) => phase.id !== write.phaseId);
    } else if (write.op === "create") {
      next.push(phaseInput(`new-${write.templateKey}`, write.templateKey, write.name, startMs, endMs));
    } else {
      next = next.map((phase) =>
        phase.id === write.phaseId ? { ...phase, startsAt: write.startsAt, endsAt: iso(endMs) } : phase,
      );
    }
  }
  return next;
}

describe("phase handles (goal 19 S6)", () => {
  describe("deriveRibbonHandles", () => {
    it("no phases → the defaults: setup 60, arrival 30, clear-down 60, hugging the slot", () => {
      const handles = deriveRibbonHandles(HIRE, []);
      expect(handles).toEqual({
        setupStartMs: at("09:00"),
        doorsMs: at("10:00"),
        liveMs: at("10:30"),
        clearDownMs: at("22:00"),
        endMs: at("23:00"),
      });
      expect(deriveRibbonHandles(HIRE, [], RIBBON_HANDLE_DEFAULTS)).toEqual(handles);
      expectHandleInvariant(handles);
    });

    it("honours custom defaults", () => {
      const handles = deriveRibbonHandles(HIRE, [], {
        setupMinutes: 120,
        arrivalMinutes: 45,
        clearDownMinutes: 90,
      });
      expect(iso(handles.doorsMs)).toBe(`${DAY}T11:00:00.000Z`);
      expect(iso(handles.liveMs)).toBe(`${DAY}T11:45:00.000Z`);
      expect(iso(handles.clearDownMs)).toBe(`${DAY}T21:30:00.000Z`);
    });

    it("stored arrival and breakdown phases place doors, live and clear-down", () => {
      expect(deriveRibbonHandles(HIRE, STORED)).toEqual({
        setupStartMs: at("09:00"),
        doorsMs: at("10:30"),
        liveMs: at("11:15"),
        clearDownMs: at("21:30"),
        endMs: at("23:00"),
      });
    });

    it("without an arrival phase, doors fall where the setup phase ends; arrival takes the default", () => {
      const handles = deriveRibbonHandles(HIRE, [SETUP_PHASE]);
      expect(iso(handles.doorsMs)).toBe(`${DAY}T10:30:00.000Z`);
      expect(iso(handles.liveMs)).toBe(`${DAY}T11:00:00.000Z`);
      expect(iso(handles.clearDownMs)).toBe(`${DAY}T22:00:00.000Z`);
    });

    it("an arrival phase outranks a disagreeing setup end for doors", () => {
      const lateSetup = phaseInput("p-setup", "setup", "Setup", at("09:00"), at("12:00"));
      const handles = deriveRibbonHandles(HIRE, [lateSetup, ARRIVAL_PHASE]);
      expect(iso(handles.doorsMs)).toBe(`${DAY}T10:30:00.000Z`);
      expect(iso(handles.liveMs)).toBe(`${DAY}T11:15:00.000Z`);
    });

    it("phases outside the slot are ignored (the Diary moved the booking; its phases stayed)", () => {
      const outside = [
        phaseInput("p-arrival", "arrival", "Arrival", at("07:30"), at("08:00")),
        phaseInput("p-breakdown", "breakdown", "Clear-down", at("22:30"), at("23:30")),
        phaseInput("p-setup", "setup", "Setup", at("08:30"), at("09:30")),
      ];
      expect(deriveRibbonHandles(HIRE, outside)).toEqual(deriveRibbonHandles(HIRE, []));
    });

    it("a phase whose times cannot be read is ignored; NaN never reaches a handle", () => {
      const broken: RibbonPhaseInput = {
        id: "p-x",
        templateKey: "arrival",
        name: "Arrival",
        startsAt: "not a date",
        endsAt: "",
      };
      const handles = deriveRibbonHandles(HIRE, [broken]);
      expectHandleInvariant(handles);
      expect(handles).toEqual(deriveRibbonHandles(HIRE, []));
    });

    it("a short slot shrinks setup first, then clear-down, then arrival, keeping the live minimum", () => {
      // 2 h: 60 + 30 + 15 + 60 = 165 > 120, so setup gives up 45.
      const twoHours = deriveRibbonHandles({ startMs: at("09:00"), endMs: at("11:00") }, []);
      expect(twoHours).toEqual({
        setupStartMs: at("09:00"),
        doorsMs: at("09:15"),
        liveMs: at("09:45"),
        clearDownMs: at("10:00"),
        endMs: at("11:00"),
      });
      // 75 min: setup is gone and clear-down gives up 30.
      const short = deriveRibbonHandles({ startMs: at("09:00"), endMs: at("10:15") }, []);
      expect(short).toEqual({
        setupStartMs: at("09:00"),
        doorsMs: at("09:00"),
        liveMs: at("09:30"),
        clearDownMs: at("09:45"),
        endMs: at("10:15"),
      });
      // 30 min: setup and clear-down are gone and arrival halves.
      const half = deriveRibbonHandles({ startMs: at("09:00"), endMs: at("09:30") }, []);
      expect(half).toEqual({
        setupStartMs: at("09:00"),
        doorsMs: at("09:00"),
        liveMs: at("09:15"),
        clearDownMs: at("09:30"),
        endMs: at("09:30"),
      });
      for (const handles of [twoHours, short, half]) expectHandleInvariant(handles);
    });

    it("a slot of exactly the smallest ingot collapses every phase; live takes the whole slot", () => {
      const start = at("09:00");
      const end = start + MIN_INGOT_DURATION_MS;
      const handles = deriveRibbonHandles({ startMs: start, endMs: end }, []);
      expect(handles).toEqual({
        setupStartMs: start,
        doorsMs: start,
        liveMs: start,
        clearDownMs: end,
        endMs: end,
      });
      expectHandleInvariant(handles);
    });

    it("stored phases that no longer fit are squeezed in the same order", () => {
      // Setup 90 + arrival 45 + live 15 + a clear-down now starting at 11:00
      // (720) = 870 > 840, so setup gives up 30 and the rest keep their lengths.
      const squeezed = deriveRibbonHandles(HIRE, [
        SETUP_PHASE,
        ARRIVAL_PHASE,
        phaseInput("p-breakdown", "breakdown", "Clear-down", at("11:00"), at("23:00")),
      ]);
      expect(squeezed).toEqual({
        setupStartMs: at("09:00"),
        doorsMs: at("10:00"),
        liveMs: at("10:45"),
        clearDownMs: at("11:00"),
        endMs: at("23:00"),
      });
      expectHandleInvariant(squeezed);
    });
  });

  describe("moveRibbonHandle", () => {
    // setup 09:00 | doors 10:30 | live 11:15 | clear-down 21:30 | end 23:00
    const base = deriveRibbonHandles(HIRE, STORED);

    it("snaps to the quarter hour, or to the minute when fine", () => {
      expect(iso(moveRibbonHandle(base, "doors", at("10:07")).doorsMs)).toBe(`${DAY}T10:00:00.000Z`);
      expect(iso(moveRibbonHandle(base, "doors", at("10:08"), { fine: false }).doorsMs)).toBe(
        `${DAY}T10:15:00.000Z`,
      );
      expect(iso(moveRibbonHandle(base, "doors", at("10:07") + 20_000, { fine: true }).doorsMs)).toBe(
        `${DAY}T10:07:00.000Z`,
      );
    });

    it("moves only the handle asked for and always returns a new object", () => {
      const moved = moveRibbonHandle(base, "live", at("12:00"));
      expect(moved).toEqual({ ...base, liveMs: at("12:00") });
      expect(moved).not.toBe(base);
      const same = moveRibbonHandle(base, "live", base.liveMs);
      expect(same).toEqual(base);
      expect(same).not.toBe(base);
    });

    it("inner handles clamp between their neighbours and never push them", () => {
      expect(moveRibbonHandle(base, "doors", at("13:00")).doorsMs).toBe(base.liveMs);
      expect(moveRibbonHandle(base, "doors", at("06:00")).doorsMs).toBe(base.setupStartMs);
      expect(moveRibbonHandle(base, "live", at("22:45")).liveMs).toBe(base.clearDownMs - MIN_INGOT_DURATION_MS);
      expect(moveRibbonHandle(base, "live", at("09:30")).liveMs).toBe(base.doorsMs);
      expect(moveRibbonHandle(base, "clear-down", at("10:00")).clearDownMs).toBe(base.liveMs + MIN_INGOT_DURATION_MS);
      expect(moveRibbonHandle(base, "clear-down", at("23:45")).clearDownMs).toBe(base.endMs);
      for (const handle of ["doors", "live", "clear-down"] as const) {
        const moved = moveRibbonHandle(base, handle, MIDNIGHT);
        expect(moved.setupStartMs).toBe(base.setupStartMs);
        expect(moved.endMs).toBe(base.endMs);
      }
    });

    it("the outer handles are the booking's edges: the start stops at doors, the end at clear-down", () => {
      expect(moveRibbonHandle(base, "setup-start", at("12:00")).setupStartMs).toBe(base.doorsMs);
      expect(moveRibbonHandle(base, "end", at("12:00")).endMs).toBe(base.clearDownMs);
      expect(iso(moveRibbonHandle(base, "setup-start", at("07:00")).setupStartMs)).toBe(`${DAY}T07:00:00.000Z`);
      expect(moveRibbonHandle(base, "end", MIDNIGHT).endMs).toBe(MIDNIGHT);
    });

    it("the invariant survives a table of moves, including absurd and non-finite values", () => {
      const FAR = 1_000_000_000_000; // about 31.7 years in ms
      const values = [
        base.setupStartMs - FAR,
        base.endMs + FAR,
        0,
        -1,
        at("00:00"),
        at("12:00"),
        MIDNIGHT,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
      ];
      for (const handle of ALL_HANDLES) {
        for (const value of values) {
          for (const fine of [false, true]) {
            const moved = moveRibbonHandle(base, handle, value, { fine });
            expectHandleInvariant(moved);
            if (!Number.isFinite(value)) expect(moved).toEqual(base);
          }
        }
      }
    });

    it("degenerate handles (a slot shorter than the smallest ingot) move nothing rather than lie", () => {
      const start = at("09:00");
      const degenerate: RibbonHandles = {
        setupStartMs: start,
        doorsMs: start,
        liveMs: start,
        clearDownMs: start + 5 * MIN,
        endMs: start + 5 * MIN,
      };
      expect(moveRibbonHandle(degenerate, "live", at("12:00"))).toEqual(degenerate);
      expect(moveRibbonHandle(degenerate, "clear-down", at("06:00"))).toEqual(degenerate);
    });

    it("200 seeded pseudo-random moves never break the invariant", () => {
      let state = 20261107;
      const next = (): number => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
      };
      const reach = 48 * 60 * MIN;
      let current = deriveRibbonHandles(HIRE, []);
      for (let step = 0; step < 200; step += 1) {
        const handle = ALL_HANDLES[Math.floor(next() * ALL_HANDLES.length)] ?? "doors";
        const proposed = step % 23 === 22 ? Number.NaN : HIRE.startMs + (next() * 2 - 1) * reach;
        const moved = moveRibbonHandle(current, handle, proposed, { fine: next() < 0.5 });
        expectHandleInvariant(moved);
        expect(moved).not.toBe(current);
        current = moved;
      }
      expect(current.endMs - current.setupStartMs).toBeGreaterThanOrEqual(MIN_INGOT_DURATION_MS);
    });
  });

  describe("ribbonPhaseWrites", () => {
    it("no writes when the handles match the stored phases", () => {
      expect(ribbonPhaseWrites(deriveRibbonHandles(HIRE, STORED), STORED)).toEqual([]);
    });

    it("creates the three owned phases when none exist, in the stable order", () => {
      expect(ribbonPhaseWrites(deriveRibbonHandles(HIRE, []), [])).toEqual([
        { op: "create", phaseId: null, templateKey: "setup", name: "Setup", startsAt: iso(at("09:00")), durationMinutes: 60 },
        { op: "create", phaseId: null, templateKey: "arrival", name: "Arrival", startsAt: iso(at("10:00")), durationMinutes: 30 },
        { op: "create", phaseId: null, templateKey: "breakdown", name: "Clear-down", startsAt: iso(at("22:00")), durationMinutes: 60 },
      ]);
    });

    it("updates only the phases a move changed", () => {
      const moved = moveRibbonHandle(deriveRibbonHandles(HIRE, STORED), "doors", at("10:00"));
      expect(ribbonPhaseWrites(moved, STORED)).toEqual([
        { op: "update", phaseId: "p-setup", templateKey: "setup", name: "Setup", startsAt: iso(at("09:00")), durationMinutes: 60 },
        { op: "update", phaseId: "p-arrival", templateKey: "arrival", name: "Arrival", startsAt: iso(at("10:00")), durationMinutes: 75 },
      ]);
    });

    it("a collapsed span deletes the stored phase, and writes nothing when none exists", () => {
      const noSetup = moveRibbonHandle(deriveRibbonHandles(HIRE, STORED), "doors", at("09:00"));
      const writes = ribbonPhaseWrites(noSetup, STORED);
      expect(writes.map((write) => [write.op, write.templateKey])).toEqual([
        ["delete", "setup"],
        ["update", "arrival"],
      ]);
      expect(writes[0]).toMatchObject({ phaseId: "p-setup", durationMinutes: 0 });
      // The same handles against a store that never had a setup phase: nothing to delete.
      expect(ribbonPhaseWrites(noSetup, [ARRIVAL_PHASE, BREAKDOWN_PHASE]).map((write) => write.op)).toEqual([
        "update",
      ]);
    });

    it("matches key-less phases by name, Clear-down included, but never claims the office's keyed phases", () => {
      const officeNamedSetup = phaseInput("o-ceremony", "ceremony", "Setup", at("12:00"), at("12:30"));
      const named = [
        phaseInput("n-setup", null, " setup ", at("09:00"), at("10:30")),
        phaseInput("n-arrival", null, "ARRIVAL", at("10:30"), at("11:15")),
        phaseInput("n-clear", null, "Clear-down", at("21:30"), at("23:00")),
        officeNamedSetup,
      ];
      const handles = deriveRibbonHandles(HIRE, named);
      expect(iso(handles.doorsMs)).toBe(`${DAY}T10:30:00.000Z`);
      expect(ribbonPhaseWrites(handles, named)).toEqual([]);
      const moved = moveRibbonHandle(handles, "clear-down", at("21:00"));
      expect(ribbonPhaseWrites(moved, named)).toEqual([
        { op: "update", phaseId: "n-clear", templateKey: "breakdown", name: "Clear-down", startsAt: iso(at("21:00")), durationMinutes: 120 },
      ]);
      const onlyOffice = ribbonPhaseWrites(deriveRibbonHandles(HIRE, [officeNamedSetup]), [officeNamedSetup]);
      expect(onlyOffice.map((write) => write.op)).toEqual(["create", "create", "create"]);
    });

    it("writes keep the stable order setup, arrival, breakdown whatever moved first", () => {
      const base = deriveRibbonHandles(HIRE, STORED);
      const moved = moveRibbonHandle(moveRibbonHandle(base, "end", MIDNIGHT), "doors", at("10:45"));
      expect(ribbonPhaseWrites(moved, STORED).map((write) => write.templateKey)).toEqual([
        "setup",
        "arrival",
        "breakdown",
      ]);
    });

    it("applying the writes and deriving again is a fixed point", () => {
      const base = deriveRibbonHandles(HIRE, STORED);
      const moved = moveRibbonHandle(moveRibbonHandle(base, "live", at("12:00")), "end", MIDNIGHT);
      const slot = ribbonSlotWrite(base, moved) ?? HIRE;
      const applied = applyWrites(STORED, ribbonPhaseWrites(moved, STORED));
      expect(deriveRibbonHandles(slot, applied)).toEqual(moved);
      expect(ribbonPhaseWrites(moved, applied)).toEqual([]);
    });

    it("phase names a client may read carry none of the office's words", () => {
      const names = ribbonPhaseWrites(deriveRibbonHandles(HIRE, []), []).map((write) => write.name);
      expect(names).toEqual(["Setup", "Arrival", "Clear-down"]);
      for (const name of names) {
        expect(name).not.toMatch(/\b(pencil\w*|ink(ed|s)?|hold|prospects?|ladder)\b/iu);
      }
    });
  });

  describe("ribbonSlotWrite", () => {
    const base = deriveRibbonHandles(HIRE, STORED);

    it("null when neither outer handle moved: inner handles are phase writes, not a booking write", () => {
      expect(ribbonSlotWrite(base, base)).toBeNull();
      expect(ribbonSlotWrite(base, moveRibbonHandle(base, "doors", at("10:00")))).toBeNull();
      expect(ribbonSlotWrite(base, moveRibbonHandle(base, "clear-down", at("21:00")))).toBeNull();
    });

    it("the booking window when an outer handle moved", () => {
      expect(ribbonSlotWrite(base, moveRibbonHandle(base, "end", MIDNIGHT))).toEqual({
        startMs: at("09:00"),
        endMs: MIDNIGHT,
      });
      expect(ribbonSlotWrite(base, moveRibbonHandle(base, "setup-start", at("08:00")))).toEqual({
        startMs: at("08:00"),
        endMs: at("23:00"),
      });
    });
  });
});
