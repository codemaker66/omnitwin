import type { ReactElement } from "react";
import { HALL_MOOD_NAMES, type HallMoodName } from "../grand-hall/hall-mood.js";
import { useModelledGrandHall } from "../grand-hall/hall-space.js";
import { useHallViewStore, type HallViewPreset } from "../../stores/hall-view-store.js";
import { usePlannerHudStore } from "../../stores/planner-hud-store.js";
import { MoreGlyph } from "./glyphs.js";

// ---------------------------------------------------------------------------
// The view, at the right of the top bar: how the room is looked at (Plan,
// Room, Walk) and lit (Daylight, Evening, Candlelight), as words in the steps'
// own style, then one "more" glyph for everything used less often. The views
// and the light are the drawn Grand Hall's; another room shows the glyph alone.
// ---------------------------------------------------------------------------

const VIEWS: readonly { readonly preset: HallViewPreset; readonly label: string; readonly tip: string }[] = [
  { preset: "plan", label: "Plan", tip: "From straight above" },
  { preset: "room", label: "Room", tip: "The whole room at an angle" },
  { preset: "walk", label: "Walk", tip: "Inside the room, at eye height" },
];

const MOOD_WORDS: Readonly<Record<HallMoodName, string>> = {
  daylight: "Daylight",
  evening: "Evening",
  candlelight: "Candlelight",
};

export function ViewStation(): ReactElement {
  const hall = useModelledGrandHall();
  const activePreset = useHallViewStore((state) => state.activePreset);
  const mood = useHallViewStore((state) => state.mood);
  const toolsOpen = usePlannerHudStore((state) => state.sheet === "tools");
  const nextMood = HALL_MOOD_NAMES[(HALL_MOOD_NAMES.indexOf(mood) + 1) % HALL_MOOD_NAMES.length] ?? "daylight";
  return (
    <div className="hud-view" role="group" aria-label="The view">
      {hall ? (
        <>
          <div className="hud-view__switch" role="radiogroup" aria-label="How to look at the room">
            {VIEWS.map((view) => (
              <button
                key={view.preset}
                type="button"
                role="radio"
                className="hud-option"
                aria-checked={activePreset === view.preset}
                title={view.tip}
                onClick={() => { useHallViewStore.getState().requestView(view.preset); }}
              >
                {view.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="hud-option"
            aria-label={`The light: ${MOOD_WORDS[mood]}. Press for ${MOOD_WORDS[nextMood]}`}
            title={`Press for ${MOOD_WORDS[nextMood]}`}
            onClick={() => { useHallViewStore.getState().setMood(nextMood); }}
          >
            {MOOD_WORDS[mood]}
          </button>
        </>
      ) : null}
      <button
        type="button"
        className="hud-glyph-key"
        aria-label="More tools"
        aria-expanded={toolsOpen}
        title={hall ? "Measure, draw, snapping and sound" : "Measure, draw, walls, snapping and sound"}
        onClick={() => { usePlannerHudStore.getState().toggleSheet("tools"); }}
      >
        <MoreGlyph />
      </button>
    </div>
  );
}
