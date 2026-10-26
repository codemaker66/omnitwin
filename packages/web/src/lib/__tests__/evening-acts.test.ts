import { describe, expect, it } from "vitest";
import {
  actAt,
  actSegments,
  actWords,
  crossings,
  labelRows,
  nearStop,
  stepStop,
  timedActs,
  type PhaseTiming,
} from "../evening-acts.js";
import { xAtTime } from "../evening-window.js";

// ---------------------------------------------------------------------------
// The running order on the evening's line (spec 6.2, frame 03; sounds §9).
// ---------------------------------------------------------------------------

const t = (iso: string): number => Date.parse(iso);
const phase = (id: string, name: string, startsAt: string | null, durationMinutes: number, sortOrder?: number): PhaseTiming =>
  ({ id, name, startsAt, durationMinutes, ...(sortOrder === undefined ? {} : { sortOrder }) });

const SAMPLE_PHASES = [
  phase("a", "Arrival", "2026-11-28T18:30:00.000Z", 45, 1),
  phase("b", "Dinner", "2026-11-28T19:15:00.000Z", 90, 2),
  phase("c", "Speeches", "2026-11-28T20:45:00.000Z", 30, 3),
  phase("d", "Ceilidh", "2026-11-28T21:15:00.000Z", 195, 4),
  phase("e", "Carriages", "2026-11-29T00:30:00.000Z", 45, 5),
];
const ACTS = timedActs(SAMPLE_PHASES, null);

describe("acts with times", () => {
  it("takes each phase's own start and its length", () => {
    expect(ACTS.map((act) => act.name)).toEqual(["Arrival", "Dinner", "Speeches", "Ceilidh", "Carriages"]);
    expect(ACTS[3]).toEqual({ id: "d", name: "Ceilidh", start: t("2026-11-28T21:15:00Z"), end: t("2026-11-29T00:30:00Z") });
  });

  it("follows on from the act before (or the event's start) when a phase has only a length", () => {
    const acts = timedActs([
      phase("x", "Drinks", null, 60, 1),
      phase("y", "Dinner", null, 90, 2),
      phase("z", "Dancing", "2026-11-28T22:00:00.000Z", 120, 3),
    ], t("2026-11-28T18:00:00Z"));
    expect(acts.map((act) => [act.name, new Date(act.start).toISOString().slice(11, 16)])).toEqual([
      ["Drinks", "18:00"], ["Dinner", "19:00"], ["Dancing", "22:00"],
    ]);
  });

  it("leaves off phases with nothing to stand on, and orders by start", () => {
    const acts = timedActs([phase("x", "Untimed", null, 60, 1), phase("y", "Late", "2026-11-28T22:00:00.000Z", 30, 2), phase("z", "Early", "2026-11-28T19:00:00.000Z", 30, 3)], null);
    expect(acts.map((act) => act.name)).toEqual(["Early", "Late"]);
  });
});

describe("where the hour stands", () => {
  it("names the act under the hour, the one it waits for, or the last it follows", () => {
    expect(actWords(actAt(ACTS, t("2026-11-28T21:41:00Z")))).toBe("Ceilidh");
    expect(actWords(actAt(ACTS, t("2026-11-28T17:30:00Z")))).toBe("Before Arrival");
    expect(actWords(actAt(ACTS, t("2026-11-29T02:00:00Z")))).toBe("After Carriages");
    expect(actWords(actAt([], t("2026-11-28T21:41:00Z")))).toBeNull();
  });

  it("takes the later of two acts that overlap (the harness's Dinner and Ceilidh both at 19:30)", () => {
    const both = timedActs([phase("d", "Dinner", "2026-11-28T19:30:00.000Z", 120, 1), phase("c", "Ceilidh", "2026-11-28T19:30:00.000Z", 120, 2)], null);
    expect(actWords(actAt(both, t("2026-11-28T20:00:00Z")))).toBe("Ceilidh");
  });

  it("tones each bar: past acts copper at 55 %, the current act full, the rest cream", () => {
    const tones = actSegments(ACTS, t("2026-11-28T21:41:00Z")).map((segment) => segment.tone);
    expect(tones).toEqual(["past", "past", "past", "current", "ahead"]);
  });

  it("cuts a bar short where the next act begins", () => {
    const both = timedActs([phase("d", "Dinner", "2026-11-28T19:30:00.000Z", 120, 1), phase("c", "Ceilidh", "2026-11-28T20:30:00.000Z", 120, 2)], null);
    const [dinner] = actSegments(both, t("2026-11-28T19:00:00Z"));
    expect(dinner?.to).toBe(t("2026-11-28T20:30:00Z"));
  });
});

describe("the labels' rows", () => {
  const window = { start: t("2026-11-28T17:00:00Z"), end: t("2026-11-29T01:15:00Z") };
  // Frame 03's label widths at 14 px Inter (Ceilidh in 600), measured on the render.
  const WIDTHS = [44, 45, 62, 52, 66];
  const boxes = (at: number) => {
    const place = actAt(ACTS, at);
    return ACTS.map((act, index) => ({
      left: xAtTime(window, 868, act.start) + 6,
      width: WIDTHS[index] ?? 0,
      span: act.end - act.start,
      current: place.kind === "in" && place.index === index,
    }));
  };

  it("moves Speeches to the second row so 21:15 sits under Ceilidh (frame 03)", () => {
    expect(labelRows(boxes(t("2026-11-28T21:41:00Z")))).toEqual([0, 0, 1, 0, 0]);
  });

  it("moves the shorter of two crowded acts, and never the act under the playhead", () => {
    expect(labelRows([
      { left: 0, width: 60, span: 90, current: false },
      { left: 50, width: 40, span: 10, current: false },
    ])).toEqual([0, 1]);
    // The current act is the shorter, earlier one: the later moves instead.
    expect(labelRows([
      { left: 0, width: 60, span: 10, current: true },
      { left: 50, width: 40, span: 90, current: false },
    ])).toEqual([0, 1]);
    // The current act is the longer, later one: the earlier moves.
    expect(labelRows([
      { left: 0, width: 60, span: 90, current: false },
      { left: 50, width: 40, span: 10, current: true },
    ])).toEqual([1, 0]);
  });

  it("keeps labels 12 px apart or more on one row", () => {
    expect(labelRows([{ left: 0, width: 40, span: 1, current: false }, { left: 52, width: 40, span: 1, current: false }])).toEqual([0, 0]);
    expect(labelRows([{ left: 0, width: 40, span: 1, current: false }, { left: 51, width: 40, span: 1, current: false }])).toEqual([1, 0]);
  });
});

describe("stops", () => {
  const stops = ACTS.map((act) => act.start);

  it("steps to the next and the previous act with [ and ]", () => {
    expect(stepStop(stops, t("2026-11-28T21:41:00Z"), 1)).toBe(t("2026-11-29T00:30:00Z"));
    expect(stepStop(stops, t("2026-11-28T21:41:00Z"), -1)).toBe(t("2026-11-28T21:15:00Z"));
    // Standing on a stop, the next is the one after it.
    expect(stepStop(stops, t("2026-11-28T21:15:00Z"), -1)).toBe(t("2026-11-28T20:45:00Z"));
    expect(stepStop(stops, t("2026-11-29T00:30:00Z"), 1)).toBeNull();
  });

  it("finds the stop within 6 minutes of a released hour, and none farther", () => {
    expect(nearStop(stops, t("2026-11-28T21:19:00Z"))).toBe(t("2026-11-28T21:15:00Z"));
    expect(nearStop(stops, t("2026-11-28T21:21:00Z"))).toBe(t("2026-11-28T21:15:00Z"));
    expect(nearStop(stops, t("2026-11-28T21:21:01Z"))).toBeNull();
  });
});

describe("what a dragged hour passes (for the cue, the horizon and the hour sounds)", () => {
  const marks = { acts: ACTS, sunrise: t("2026-11-28T08:18:00Z"), sunset: t("2026-11-28T15:51:00Z") };

  it("lists whole hours and act starts in the order they were passed", () => {
    expect(crossings(t("2026-11-28T20:50:00Z"), t("2026-11-28T21:20:00Z"), marks).map((c) => c.kind)).toEqual(["hour", "act"]);
    expect(crossings(t("2026-11-28T21:20:00Z"), t("2026-11-28T20:50:00Z"), marks).map((c) => c.kind)).toEqual(["act", "hour"]);
  });

  it("hears sunset once, going either way", () => {
    expect(crossings(t("2026-11-28T15:40:00Z"), t("2026-11-28T15:55:00Z"), marks).filter((c) => c.kind === "sunset")).toHaveLength(1);
    expect(crossings(t("2026-11-28T15:55:00Z"), t("2026-11-28T15:40:00Z"), marks).filter((c) => c.kind === "sunset")).toHaveLength(1);
    expect(crossings(t("2026-11-28T15:52:00Z"), t("2026-11-28T15:55:00Z"), marks)).toEqual([]);
  });
});
