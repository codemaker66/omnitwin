import { useEffect, useId, useLayoutEffect, useRef, type ReactElement } from "react";
import { Volume1, Volume2, VolumeOff } from "lucide-react";
import {
  armPlannerSound,
  setPlannerSoundLevel,
  setPlannerSoundMode,
  togglePlannerSoundMute,
  usePlannerSoundArming,
  usePlannerSoundSettings,
  type PlannerSoundMode,
} from "../../lib/sound-registry.js";
import { Segmented, type SegmentedOption } from "./Controls.js";
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
// SoundSettings is the panel's content alone, so the phone's More sheet can
// hold the same controls (spec 5.4).
// ---------------------------------------------------------------------------

export const SOUND_SHORTCUT: readonly string[] = ["Shift", "M"];

/** The level runs from a tenth up: silence is Off, one name per thing. */
export const SOUND_LEVEL_MIN_PERCENT = 10;
const SOUND_LEVEL_STEP_PERCENT = 5;

const MODE_OPTIONS: readonly SegmentedOption<PlannerSoundMode>[] = [
  { value: "off", label: "Off" },
  { value: "quiet", label: "Quiet" },
  { value: "full", label: "Full" },
];

/** What each set plays, in the venue's words (spec 9's palette). */
export const SOUND_MODE_LINES: Readonly<Record<PlannerSoundMode, string>> = {
  off: "Nothing plays.",
  quiet: "Pieces set down, refusals, the evening, Present and Send.",
  full: "Quiet, with pieces lifted, snaps, measurements and each hour.",
};

/** The speaker's name: the set in use ("Sound: quiet"). */
export function soundKeyLabel(mode: PlannerSoundMode): string {
  return `Sound: ${mode}`;
}

const NOT_TYPED_INPUTS = new Set(["range", "checkbox", "radio", "button", "submit", "reset", "color", "file", "image"]);

/** Whether keys pressed here type text, so a letter shortcut must leave them alone. */
function typesText(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && !NOT_TYPED_INPUTS.has(target.type);
}

/** Shift M: not while typing, not with Ctrl, Alt or Cmd, not a held key repeating. */
export function isSoundShortcut(
  event: Pick<globalThis.KeyboardEvent, "key" | "shiftKey" | "ctrlKey" | "altKey" | "metaKey" | "repeat" | "target">,
): boolean {
  if (!event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.repeat) return false;
  if (event.key.toLowerCase() !== "m") return false;
  return !typesText(event.target);
}

function chooseMode(mode: PlannerSoundMode): void {
  setPlannerSoundMode(mode);
  if (mode !== "off") armPlannerSound();
}

/** While mounted, Shift M mutes the planner and brings back what was muted. */
export function usePlannerSoundShortcut(): void {
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.defaultPrevented || !isSoundShortcut(event)) return;
      event.preventDefault();
      chooseMode(togglePlannerSoundMute());
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); };
  }, []);
}

function SoundIcon({ mode }: { readonly mode: PlannerSoundMode }): ReactElement {
  if (mode === "off") return <VolumeOff className="pc-icon" aria-hidden="true" />;
  if (mode === "full") return <Volume2 className="pc-icon" aria-hidden="true" />;
  return <Volume1 className="pc-icon" aria-hidden="true" />;
}

/** Off · Quiet · Full, the level and the shortcut: the speaker's panel, or a phone sheet's rows. */
export function SoundSettings(): ReactElement {
  const { mode, level } = usePlannerSoundSettings();
  const levelId = useId();
  const rangeRef = useRef<HTMLInputElement>(null);
  const percent = Math.max(SOUND_LEVEL_MIN_PERCENT, Math.round(level * 100));

  // The track is cream up to the thumb (a CSS variable, never an inline style).
  useLayoutEffect(() => {
    const along = (percent - SOUND_LEVEL_MIN_PERCENT) / (100 - SOUND_LEVEL_MIN_PERCENT);
    rangeRef.current?.style.setProperty("--pc-range-f", along.toFixed(3));
  }, [percent]);

  return (
    <div className="pc-sound-settings">
      <div className="pc-popover__section">
        <Segmented label="Sound" value={mode} options={MODE_OPTIONS} onChange={chooseMode} />
        <p className="pc-meta pc-popover__line">{SOUND_MODE_LINES[mode]}</p>
      </div>
      <div className="pc-popover__section">
        <div className="pc-level">
          <label className="pc-caps pc-popover__heading" htmlFor={levelId}>Level</label>
          <span className="pc-level__figure pc-num" aria-hidden="true">{percent}%</span>
        </div>
        <input
          ref={rangeRef}
          id={levelId}
          className="pc-range"
          type="range"
          min={SOUND_LEVEL_MIN_PERCENT}
          max={100}
          step={SOUND_LEVEL_STEP_PERCENT}
          value={percent}
          aria-valuetext={`${String(percent)}%`}
          onChange={(event) => { setPlannerSoundLevel(Number(event.target.value) / 100); }}
        />
      </div>
      <p className="pc-meta pc-popover__foot">
        <span className="pc-popover__keys">
          {SOUND_SHORTCUT.map((key) => <Kbd key={key}>{key}</Kbd>)}
        </span>
        <span>mutes and unmutes</span>
      </p>
    </div>
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
