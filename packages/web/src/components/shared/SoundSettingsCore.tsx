import { Fragment, useId, useLayoutEffect, useRef, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { SOUND_SHORTCUT, chooseMode } from "../../lib/planner-sound-shortcut.js";
import { setPlannerSoundLevel, usePlannerSoundSettings, type PlannerSoundMode } from "../../lib/sound-registry.js";

// ---------------------------------------------------------------------------
// The planner's sound setting with no chrome's look (T-700): Off, Quiet or
// Full, what each plays, the level, and the keys that mute. Each chrome dresses
// it in its own: v2 lends it its segmented control, key caps and class names
// (planner-chrome/SoundControl.tsx); v1's menus give it theirs
// (editor/MenuSoundSettings.tsx). It imports nothing of either, so neither
// chrome's styles reach the other's planner through it (T-671).
// ---------------------------------------------------------------------------

/** The level runs from a tenth up: silence is Off, one name per thing. */
export const SOUND_LEVEL_MIN_PERCENT = 10;
const SOUND_LEVEL_STEP_PERCENT = 5;

export interface SoundModeOption {
  readonly value: PlannerSoundMode;
  readonly label: string;
}

export const SOUND_MODE_OPTIONS: readonly SoundModeOption[] = [
  { value: "off", label: "Off" },
  { value: "quiet", label: "Quiet" },
  { value: "full", label: "Full" },
];

/** What each set plays, in the venue's words (spec 9's palette). */
export const SOUND_MODE_LINES: Readonly<Record<PlannerSoundMode, string>> = {
  off: "Nothing plays.",
  quiet: "Pieces set down in the room, refusals, the evening, Present and Send.",
  full: "Quiet, with pieces lifted, snaps, measurements and each hour.",
};

/** What a chrome's own control for the three sets is given. */
export interface SoundModesProps {
  readonly label: string;
  readonly value: PlannerSoundMode;
  readonly options: readonly SoundModeOption[];
  readonly onChange: (mode: PlannerSoundMode) => void;
}

export interface SoundModeRadiosProps extends SoundModesProps {
  readonly className?: string;
  readonly optionClassName?: string;
}

/**
 * Off · Quiet · Full as a plain radio group: one tab stop on the chosen set;
 * the arrows move the choice and wrap, Home and End go to the ends.
 */
export function SoundModeRadios({ label, value, options, onChange, className, optionClassName }: SoundModeRadiosProps): ReactElement {
  const refs = useRef(new Map<PlannerSoundMode, HTMLButtonElement>());

  const choose = (next: PlannerSoundMode): void => {
    if (next !== value) onChange(next);
    refs.current.get(next)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const index = options.findIndex((option) => option.value === value);
    let next: SoundModeOption | undefined;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = options[(index + 1) % options.length];
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = options[(index - 1 + options.length) % options.length];
    else if (event.key === "Home") next = options[0];
    else if (event.key === "End") next = options.at(-1);
    if (next === undefined) return;
    event.preventDefault();
    choose(next.value);
  };

  return (
    <div className={className} role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            ref={(element) => {
              if (element === null) refs.current.delete(option.value);
              else refs.current.set(option.value, element);
            }}
            type="button"
            role="radio"
            className={optionClassName}
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => { choose(option.value); }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** The class names a chrome dresses the setting in, part by part. */
export interface SoundSettingsClasses {
  readonly root?: string;
  /** The sets with their line; the level. */
  readonly section?: string;
  /** The plain radio group and its options, when the chrome lends no control of its own. */
  readonly modes?: string;
  readonly mode?: string;
  /** What the chosen set plays. */
  readonly line?: string;
  /** The level's label and figure, and its range. */
  readonly level?: string;
  readonly levelLabel?: string;
  readonly levelFigure?: string;
  readonly range?: string;
  /** The keys that mute, and each key when the chrome lends no key cap of its own. */
  readonly foot?: string;
  readonly keys?: string;
  readonly key?: string;
}

export interface SoundSettingsCoreProps {
  readonly classes?: SoundSettingsClasses;
  /** The chrome's own control for the three sets; a plain radio group otherwise. */
  readonly renderModes?: (props: SoundModesProps) => ReactNode;
  /** The chrome's own key cap; a plain kbd otherwise. */
  readonly renderKey?: (key: string) => ReactNode;
  /** A CSS custom property the range's fill, 0 to 1, is written to, for a chrome that draws the track itself. */
  readonly levelFillProperty?: string;
}

const NO_CLASSES: SoundSettingsClasses = {};

/** Off · Quiet · Full, what it plays, the level and the shortcut, in whatever look the chrome gives them. */
export function SoundSettingsCore({ classes = NO_CLASSES, renderModes, renderKey, levelFillProperty }: SoundSettingsCoreProps): ReactElement {
  const { mode, level } = usePlannerSoundSettings();
  const levelId = useId();
  const rangeRef = useRef<HTMLInputElement>(null);
  const percent = Math.max(SOUND_LEVEL_MIN_PERCENT, Math.round(level * 100));

  // A drawn track's fill follows the thumb through a CSS variable, never an inline style.
  useLayoutEffect(() => {
    if (levelFillProperty === undefined) return;
    const along = (percent - SOUND_LEVEL_MIN_PERCENT) / (100 - SOUND_LEVEL_MIN_PERCENT);
    rangeRef.current?.style.setProperty(levelFillProperty, along.toFixed(3));
  }, [percent, levelFillProperty]);

  const modes: SoundModesProps = { label: "Sound", value: mode, options: SOUND_MODE_OPTIONS, onChange: chooseMode };

  return (
    <div className={classes.root}>
      <div className={classes.section}>
        {renderModes === undefined
          ? <SoundModeRadios {...modes} className={classes.modes} optionClassName={classes.mode} />
          : renderModes(modes)}
        <p className={classes.line}>{SOUND_MODE_LINES[mode]}</p>
      </div>
      <div className={classes.section}>
        <div className={classes.level}>
          <label className={classes.levelLabel} htmlFor={levelId}>Level</label>
          <span className={classes.levelFigure} aria-hidden="true">{percent}%</span>
        </div>
        <input
          ref={rangeRef}
          id={levelId}
          className={classes.range}
          type="range"
          min={SOUND_LEVEL_MIN_PERCENT}
          max={100}
          step={SOUND_LEVEL_STEP_PERCENT}
          value={percent}
          aria-valuetext={`${String(percent)}%`}
          onChange={(event) => { setPlannerSoundLevel(Number(event.target.value) / 100); }}
        />
      </div>
      <p className={classes.foot}>
        <span className={classes.keys}>
          {SOUND_SHORTCUT.map((key) => (renderKey === undefined
            ? <kbd key={key} className={classes.key}>{key}</kbd>
            : <Fragment key={key}>{renderKey(key)}</Fragment>))}
        </span>
        <span>mutes and unmutes</span>
      </p>
    </div>
  );
}
