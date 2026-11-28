import type { ReactElement } from "react";
import { SoundSettingsCore, type SoundSettingsClasses } from "../shared/SoundSettingsCore.js";
import "./MenuSoundSettings.css";

// ---------------------------------------------------------------------------
// The planner's sound setting in v1's menus (T-700): the wide desktop's More
// menu (cockpit/ReferenceSceneSettings) and the phone's More sheet
// (VerticalToolbox). Sound is a device setting and never a button on the
// screen (D1). The setting is the shared core in v1's own look, taken from the
// scene settings beside it; v2's chrome and its global stylesheet never load
// into v1 for it (T-671).
// ---------------------------------------------------------------------------

const MENU_SOUND_CLASSES: SoundSettingsClasses = {
  root: "menu-sound",
  section: "menu-sound__section",
  modes: "menu-sound__modes",
  mode: "menu-sound__mode",
  line: "menu-sound__line",
  level: "menu-sound__level",
  levelLabel: "menu-sound__label",
  levelFigure: "menu-sound__figure",
  range: "menu-sound__range",
  foot: "menu-sound__foot",
  keys: "menu-sound__keys",
  key: "menu-sound__key",
};

/** Off · Quiet · Full, the level and Shift M, as v1's menus show them. */
export function MenuSoundSettings(): ReactElement {
  return <SoundSettingsCore classes={MENU_SOUND_CLASSES} />;
}
