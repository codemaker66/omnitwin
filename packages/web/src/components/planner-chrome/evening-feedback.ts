import { crossings, type TimedAct } from "../../lib/evening-acts.js";
import { bodyEvents } from "../../lib/evening-sky.js";
import { venueDayOf } from "../../lib/evening-window.js";
import { hourPitchHz } from "../../lib/planner-sound-recipes.js";
import { sunPosition } from "../../lib/sky/ephemeris.js";
import { getPlannerSoundSettings, playPlannerSound } from "../../lib/sound-registry.js";
import { HALL_OBSERVER } from "../grand-hall/hall-site.js";

// ---------------------------------------------------------------------------
// What the hand hears and feels while it drags the hour (T-674, v2 slice 10;
// spec 9, 10).
//
// - planner-cue: the dragged hour crosses an act's start (a wooden click).
// - planner-horizon: the dragged sun crosses sunrise or sunset, gliding up at
//   sunrise and down at sunset.
// - planner-hour: the dragged hour crosses a whole hour, pitched by the sun's
//   height (Full set only; the registry holds its 90 ms gap).
// Keys are silent. On a touch screen the cue taps 6 ms (at most four a
// second) and the horizon 8 ms, tied to the sound control: Off stills both.
// Sound is never the only signal: the line and the head say the same.
// ---------------------------------------------------------------------------

interface SunTurns {
  readonly sunrise: number | null;
  readonly sunset: number | null;
}

const turnsByDay = new Map<number, SunTurns>();

/** Sunrise and sunset on the venue's day containing `at` (remembered for a few days). */
export function sunTurnsOn(at: number): SunTurns {
  const day = venueDayOf(at);
  const known = turnsByDay.get(day.start);
  if (known !== undefined) return known;
  const events = bodyEvents(day, "sun");
  const turns = { sunrise: events.rises[0] ?? null, sunset: events.sets[0] ?? null };
  if (turnsByDay.size > 8) turnsByDay.clear();
  turnsByDay.set(day.start, turns);
  return turns;
}

const CUE_TAP_GAP_MS = 250;
let lastCueTap = Number.NEGATIVE_INFINITY;

function tap(ms: number): void {
  if (getPlannerSoundSettings().mode === "off" || typeof navigator === "undefined") return;
  const device = navigator as { vibrate?: (pattern: number | number[]) => boolean };
  if (typeof device.vibrate === "function") device.vibrate(ms);
}

/** Plays what a pointer passed dragging the hour from `from` to `to`: one of each kind at most, the last passed. */
export function feelTheHour(from: number, to: number, acts: readonly TimedAct[], pointerType: string): void {
  const passed = crossings(from, to, { acts, ...sunTurnsOn(to) });
  if (passed.length === 0) return;
  const touch = pointerType === "touch";
  const horizon = passed.filter((crossing) => crossing.kind === "sunrise" || crossing.kind === "sunset").pop();
  if (horizon !== undefined) {
    playPlannerSound("planner-horizon", { glide: horizon.kind === "sunrise" ? 0.05 : -0.05 });
    if (touch) tap(8);
  }
  if (passed.some((crossing) => crossing.kind === "act")) {
    playPlannerSound("planner-cue");
    const now = typeof performance === "undefined" ? Date.now() : performance.now();
    if (touch && now - lastCueTap >= CUE_TAP_GAP_MS) {
      lastCueTap = now;
      tap(6);
    }
  }
  const hour = passed.filter((crossing) => crossing.kind === "hour").pop();
  if (hour !== undefined) {
    playPlannerSound("planner-hour", { pitchScale: hourPitchHz(sunPosition(hour.at, HALL_OBSERVER).altitude) / 330 });
  }
}
