import type { ReactElement } from "react";
import { Volume1, Volume2, VolumeOff } from "lucide-react";
import { SOUND_SHORTCUT, usePlannerSoundShortcut } from "../../lib/planner-sound-shortcut.js";
import { usePlannerSoundArming, usePlannerSoundSettings, type PlannerSoundMode } from "../../lib/sound-registry.js";
import { SoundSettingsCore, type SoundSettingsClasses } from "../shared/SoundSettingsCore.js";
import { Segmented } from "./Controls.js";
import { Kbd } from "./Kbd.js";
import { Key } from "./Keys.js";
import { Popover, usePopoverState } from "./Popover.js";
import type { TooltipSide } from "./Tooltip.js";
import "./chrome.css";

// ---------------------------------------------------------------------------
// SoundControl — the speaker in the utilities (spec 9).
//
// The speaker names the set in use ("Sound: quiet") and opens Off · Quiet ·
// Full with the level in a Popover off its bar. Shift M mutes and brings back
// what was muted, over a 30 ms fade. Both are kept per device by the registry.
// Choosing makes no sound (popovers are silent by design); a choice of Quiet
// or Full is itself a deliberate gesture, so it arms the planner's one audio
// context at once.
//
// SoundSettings is the panel's content alone, so the slate's menu can hold
// the same controls (spec 5.4). It is the chrome-free setting
// (components/shared/SoundSettingsCore.tsx) in this chrome's look: its
// segmented control, key caps and class names. The shortcut is
// lib/planner-sound-shortcut.ts's, which every chrome shares, and v1's menus
// show the same setting in their own look (editor/MenuSoundSettings.tsx), so
// nothing here reaches the default planner (T-671).
// ---------------------------------------------------------------------------

/** The speaker's name: the set in use ("Sound: quiet"). */
export function soundKeyLabel(mode: PlannerSoundMode): string {
  return `Sound: ${mode}`;
}

function SoundIcon({ mode }: { readonly mode: PlannerSoundMode }): ReactElement {
  if (mode === "off") return <VolumeOff className="pc-icon" aria-hidden="true" />;
  if (mode === "full") return <Volume2 className="pc-icon" aria-hidden="true" />;
  return <Volume1 className="pc-icon" aria-hidden="true" />;
}

/** This chrome's class names for the shared setting. */
const SOUND_SETTINGS_CLASSES: SoundSettingsClasses = {
  root: "pc-sound-settings",
  section: "pc-popover__section",
  line: "pc-meta pc-popover__line",
  level: "pc-level",
  levelLabel: "pc-caps pc-popover__heading",
  levelFigure: "pc-level__figure pc-num",
  range: "pc-range",
  foot: "pc-meta pc-popover__foot",
  keys: "pc-popover__keys",
};

/** Off · Quiet · Full, the level and the shortcut: the speaker's panel, or the slate menu's rows. */
export function SoundSettings(): ReactElement {
  return (
    <SoundSettingsCore
      classes={SOUND_SETTINGS_CLASSES}
      renderModes={(modes) => <Segmented label={modes.label} value={modes.value} options={modes.options} onChange={modes.onChange} />}
      renderKey={(key) => <Kbd>{key}</Kbd>}
      levelFillProperty="--pc-range-f"
    />
  );
}

export interface SoundControlProps {
  /** The edge of the speaker's bar the panel lines up with: its right ("end", the utilities) or its left. */
  readonly align?: "start" | "end";
  readonly tooltipSide?: TooltipSide;
}

/** The speaker: a key that names the set in use and opens its panel from its bar's edge. */
export function SoundControl({ align = "end", tooltipSide = "below" }: SoundControlProps): ReactElement {
  const { mode } = usePlannerSoundSettings();
  usePlannerSoundArming();
  usePlannerSoundShortcut();
  const popover = usePopoverState();
  return (
    <>
      <Key
        ref={popover.triggerRef}
        label={soundKeyLabel(mode)}
        icon={<SoundIcon mode={mode} />}
        iconOnly
        small
        on={popover.open}
        expanded={popover.open}
        shortcut={SOUND_SHORTCUT}
        tooltipSide={tooltipSide}
        {...popover.triggerProps}
        onPress={popover.toggle}
      />
      <Popover state={popover} label="Sound" align={align} chrome="sound">
        <SoundSettings />
      </Popover>
    </>
  );
}
