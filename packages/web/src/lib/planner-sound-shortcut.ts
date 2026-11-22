import { useMemo } from "react";
import { shiftedLetter, usePlannerKeyBindings, type KeyBinding } from "./planner-keys.js";
import { armPlannerSound, setPlannerSoundMode, togglePlannerSoundMute, type PlannerSoundMode } from "./sound-registry.js";

// ---------------------------------------------------------------------------
// The planner's sound, by key and by choice (T-700). Shift M mutes and brings
// back what was muted; choosing Quiet or Full is itself a deliberate gesture,
// so it arms the planner's one audio context at once. Every chrome uses these:
// the scene's receipt, v1's menus and v2's speaker and slate. So this module
// imports nothing of any chrome, and nothing of a chrome's styles reaches a
// planner through it (T-671).
// ---------------------------------------------------------------------------

/** The keys that mute and unmute, as they are drawn. */
export const SOUND_SHORTCUT: readonly string[] = ["Shift", "M"];

/** Sets the planner's sound to `mode`; a choice of Quiet or Full arms its audio context. */
export function chooseMode(mode: PlannerSoundMode): void {
  setPlannerSoundMode(mode);
  if (mode !== "off") armPlannerSound();
}

/**
 * Shift M, through the planner's one keyboard owner: never while typing,
 * never with Ctrl, Alt or Cmd, never a held key repeating; and M alone stays
 * Measure's.
 */
const SOUND_CHORDS = shiftedLetter("m");

/**
 * While mounted, Shift M mutes the planner and brings back what was muted.
 * `onToggled` hears the mode each press leaves it in, for a receipt on screen.
 */
export function usePlannerSoundShortcut(onToggled?: (mode: PlannerSoundMode) => void): void {
  const keys = useMemo((): readonly KeyBinding[] => [{
    keys: SOUND_CHORDS,
    run: () => {
      const mode = togglePlannerSoundMute();
      chooseMode(mode);
      onToggled?.(mode);
    },
  }], [onToggled]);
  usePlannerKeyBindings(keys);
}
