import { forwardRef, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement } from "react";
import { Moon, Sun } from "lucide-react";
import { Color } from "three";
import { useHallTimeStore, type HallTimeMode } from "../../../stores/hall-time-store.js";
import { hallDay, type HallDay } from "../../grand-hall/hall-sun-times.js";
import { HALL_OBSERVER, compassPoint } from "../../grand-hall/hall-site.js";
import { SUN_EVENT_ALTITUDE, moonPosition, sunPosition, type SunPosition } from "../../../lib/sky/ephemeris.js";
import { skyPalette, sunlight } from "../../../lib/sky/sky-palette.js";
import { formatInlineDay, formatWallTime, msToWallInput, wallInputToMs, VENUE_TIME_ZONE } from "../../../pages/diary/lib/board-time.js";
import "./HallSunDial.css";

// ---------------------------------------------------------------------------
// HallSunDial — the hour the Grand Hall is shown at, held in the hand
//
// The day as one band of its own sky, from midnight to midnight, with the
// sun's real path over Glassford Street drawn across it: drag the sun (or
// press anywhere on the day) and the room's light, shadows and sky follow
// as you go. At night the sun's place is taken by the moon in its true
// phase. Ticks mark sunrise and sunset; a gold bar marks when the sun falls
// in at the windows and onto the floor. One tap sends the sun to sunrise,
// the morning, noon, golden hour, sunset or night; the date can be any day,
// such as the event's own; Now follows the clock again. Every time is the
// venue's own (Europe/London). At its foot is the credit the LiDAR survey
// asks for, since the city round the hall is drawn from it.
// ---------------------------------------------------------------------------

const WIDTH = 344;
const HEIGHT = 112;
/** Height of the horizon in the band, px. */
const HORIZON = 78;
/** The sun's highest altitude drawn at the band's top, degrees. */
const TOP_ALTITUDE = 62;
/** Depth below the horizon drawn at the band's foot, degrees. */
const BOTTOM_ALTITUDE = 24;
const MINUTE_MS = 60_000;
/** Within this distance a dragged sun settles on sunrise, noon or sunset, px. */
const SNAP_PX = 5;
/**
 * The years the date field takes. While a year is typed the field reports
 * each partial one in turn ("0002", "0020", "0202"); none of those may send
 * the hall there.
 */
const FIRST_YEAR = 1900;
const LAST_YEAR = 2200;
const DATE_INPUT_PATTERN = /^(\d{4})-\d{2}-\d{2}$/u;

/**
 * The credit the Scottish LiDAR survey asks for wherever its data is shown:
 * the city round the hall and the skylines in its windows are drawn from it.
 */
export const LIDAR_CREDIT = "Contains LiDAR data: Crown copyright Scottish Government and Fugro (2020)";
export const OGL_URL = "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/";

/**
 * Whether the sun counts as up: its true altitude above the horizon that
 * sunrise and sunset are reckoned by (the upper limb on the refracted
 * horizon). One rule for the icon, the knob and the words, so the dial never
 * shows the sun before the sunrise it lists, nor calls it up at −1°.
 */
function sunIsUp(sun: SunPosition): boolean {
  return sun.trueAltitude > SUN_EVENT_ALTITUDE.horizon;
}

/**
 * The first (`inward` 1) or last (`inward` −1) whole minute of the day the
 * sun is up, from a sunrise or sunset. The crossing is found to within a
 * second, so the minute on its edge can still be a whisker below the
 * horizon: step inward until the sun is up.
 */
function wholeMinuteUp(event: number, inward: 1 | -1): number {
  let minute = (inward > 0 ? Math.ceil(event / MINUTE_MS) : Math.floor(event / MINUTE_MS)) * MINUTE_MS;
  for (let step = 0; step < 2 && !sunIsUp(sunPosition(minute, HALL_OBSERVER)); step += 1) minute += inward * MINUTE_MS;
  return minute;
}

/**
 * The clock the hall follows in "now" mode. Read afresh the moment that mode
 * begins (pressing Now, or a plan opening on the clock), before anything is
 * painted, then again as each minute turns: the shown time changes with the
 * venue's clock and never holds the reading from when the control mounted.
 */
function useFollowedClock(mode: HallTimeMode): number {
  const [now, setNow] = useState(() => Date.now());
  useLayoutEffect(() => {
    if (mode !== "now") return undefined;
    let timer = 0;
    const tick = (): void => {
      const time = Date.now();
      setNow(time);
      // The venue's offsets are whole hours, so its minutes turn with UTC's.
      timer = window.setTimeout(tick, MINUTE_MS - (time % MINUTE_MS));
    };
    tick();
    return () => { window.clearTimeout(timer); };
  }, [mode]);
  return now;
}

function altitudeY(altitude: number): number {
  if (altitude >= 0) return HORIZON - (Math.min(altitude, TOP_ALTITUDE) / TOP_ALTITUDE) * (HORIZON - 12);
  return HORIZON + (Math.min(-altitude, BOTTOM_ALTITUDE) / BOTTOM_ALTITUDE) * (HEIGHT - HORIZON - 6);
}

function toHex(rgb: readonly [number, number, number]): string {
  return `#${new Color(rgb[0], rgb[1], rgb[2]).getHexString()}`;
}

/** The band's colour for the sun at `altitude`: the low sky toward it, under its zenith. */
function bandColor(altitude: number): string {
  const palette = skyPalette(altitude);
  const mixed: [number, number, number] = [
    palette.horizonSun[0] * 0.55 + palette.zenith[0] * 0.45,
    palette.horizonSun[1] * 0.55 + palette.zenith[1] * 0.45,
    palette.horizonSun[2] * 0.55 + palette.zenith[2] * 0.45,
  ];
  return toHex(mixed);
}

/** An SVG path for the moon's disc in its phase: lit share `lit`, waxing lit on the right. */
export function moonPhasePath(radius: number, lit: number, waxing: boolean): string {
  const r = radius;
  const k = Math.max(0, Math.min(1, lit));
  const terminator = Math.abs(1 - 2 * k) * r;
  // The lit limb is a half circle; the terminator an ellipse arc bulging
  // toward the lit side while a crescent, away from it once past half.
  const limbSweep = waxing ? 1 : 0;
  const terminatorSweep = (k < 0.5) === waxing ? 0 : 1;
  return `M 0 ${String(-r)} A ${String(r)} ${String(r)} 0 0 ${String(limbSweep)} 0 ${String(r)} A ${terminator.toFixed(3)} ${String(r)} 0 0 ${String(terminatorSweep)} 0 ${String(-r)} Z`;
}

export interface HallSunDialProps {
  /** Laid out across a phone's sheet rather than in a popover. */
  readonly inline?: boolean;
  /** The most height the panel may take, px; it scrolls within. Unbounded when absent. */
  readonly maxHeight?: number;
}

export function HallSunDial({ inline = false, maxHeight }: HallSunDialProps): ReactElement {
  const mode = useHallTimeStore((s) => s.mode);
  const chosen = useHallTimeStore((s) => s.at);
  const gradientId = useId();
  const now = useFollowedClock(mode);
  const at = mode === "now" ? now : chosen;
  // The date field holds what is being typed into it until it is left, so a
  // partial year the hall ignores is not written back over the keystrokes.
  const [dateDraft, setDateDraft] = useState<string | null>(null);
  const dayKey = msToWallInput(at, VENUE_TIME_ZONE).slice(0, 10);
  // Keyed by the date alone: a day's sun times and path are the same for any
  // moment in it, so dragging through the day does not recompute them.
  const day: HallDay = useMemo(() => hallDay(at), [dayKey]);
  const span = day.dayEnd - day.dayStart;
  const x = (time: number): number => ((time - day.dayStart) / span) * WIDTH;
  const timeAtX = (px: number): number => day.dayStart + Math.max(0, Math.min(1, px / WIDTH)) * span;

  const sun = sunPosition(at, HALL_OBSERVER);
  const sunUp = sunIsUp(sun);
  const moon = moonPosition(at, HALL_OBSERVER);
  const knobX = x(at);
  const knobY = altitudeY(sunUp ? sun.altitude : Math.max(sun.altitude, -BOTTOM_ALTITUDE));
  const sunTone = toHex(sunlight(Math.max(sun.altitude, 0.5)).color);

  const stops = useMemo(() => day.path.filter((_, index) => index % 3 === 0).map((sample) => ({
    offset: (sample.at - day.dayStart) / span,
    color: bandColor(sample.altitude),
  })), [day, span]);
  const above = day.path.map((sample) => `${x(sample.at).toFixed(1)},${altitudeY(sample.altitude).toFixed(1)}`).join(" ");

  // Sunrise and sunset as the first and last whole minutes the sun is up
  // (sunIsUp), so the listed time, a hand settled on its tick and the Home
  // and End keys all show the sun.
  const sunriseMinute = day.times.sunrise === null ? null : wholeMinuteUp(day.times.sunrise, 1);
  const sunsetMinute = day.times.sunset === null ? null : wholeMinuteUp(day.times.sunset, -1);
  const marks = [
    sunriseMinute === null ? null : { at: sunriseMinute, label: "Sunrise" },
    { at: day.times.solarNoon, label: "Noon" },
    sunsetMinute === null ? null : { at: sunsetMinute, label: "Sunset" },
  ].filter((mark): mark is { at: number; label: string } => mark !== null);

  const presets = useMemo(() => {
    const t = day.times;
    const hour = (h: number, m = 0) => wallInputToMs(`${dayKey}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`, VENUE_TIME_ZONE) ?? day.dayStart + h * 60 * MINUTE_MS;
    const sunrise = t.sunrise ?? hour(6);
    const sunset = t.sunset ?? hour(18);
    return [
      { id: "sunrise", label: "Sunrise", at: sunrise + 4 * MINUTE_MS },
      { id: "morning", label: "Morning", at: Math.max(hour(10), sunrise + 90 * MINUTE_MS) },
      { id: "noon", label: "Noon", at: t.solarNoon },
      { id: "golden", label: "Golden hour", at: (t.goldenEveningStart ?? sunset - 50 * MINUTE_MS) + 25 * MINUTE_MS },
      { id: "sunset", label: "Sunset", at: sunset + 8 * MINUTE_MS },
      { id: "night", label: "Night", at: Math.min(Math.max(hour(22), (t.civilDusk ?? sunset) + 50 * MINUTE_MS), hour(23, 50)) },
    ] as const;
  }, [day, dayKey]);

  const dragging = useRef(false);
  const dateInput = useRef<HTMLInputElement | null>(null);
  const setFromX = (clientX: number, element: Element, scrubbing: boolean): void => {
    const box = element.getBoundingClientRect();
    const px = ((clientX - box.left) / box.width) * WIDTH;
    let time = timeAtX(px);
    // Settle on the day's named moments as the hand passes them.
    for (const mark of marks) {
      if (Math.abs(x(mark.at) - px) < SNAP_PX * (WIDTH / box.width)) time = mark.at;
    }
    // Held within the day, as the keys are: the band's right end is the next
    // midnight, and a captured hand past it would otherwise carry the date on
    // by a day at every move.
    const minute = Math.round(time / MINUTE_MS) * MINUTE_MS;
    useHallTimeStore.getState().setTime(Math.max(day.dayStart, Math.min(day.dayEnd - MINUTE_MS, minute)), scrubbing);
  };
  const onPointerDown = (event: PointerEvent<SVGSVGElement>): void => {
    if (event.button !== 0) return;
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    setFromX(event.clientX, event.currentTarget, true);
  };
  const onPointerMove = (event: PointerEvent<SVGSVGElement>): void => {
    if (!dragging.current) return;
    setFromX(event.clientX, event.currentTarget, true);
  };
  const endDrag = (event: PointerEvent<SVGSVGElement>): void => {
    if (!dragging.current) return;
    dragging.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    useHallTimeStore.getState().endScrub();
  };
  // A dial closed mid-drag (Escape, or a phone's sheet folding away) never
  // hears the hand leave: end the scrub, or the room's reflections never settle.
  useEffect(() => () => {
    if (!dragging.current) return;
    dragging.current = false;
    useHallTimeStore.getState().endScrub();
  }, []);
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>): void => {
    const step = (event.shiftKey ? 60 : 5) * MINUTE_MS;
    const moves: Record<string, () => number> = {
      ArrowRight: () => at + step,
      ArrowUp: () => at + step,
      ArrowLeft: () => at - step,
      ArrowDown: () => at - step,
      PageUp: () => at + 60 * MINUTE_MS,
      PageDown: () => at - 60 * MINUTE_MS,
      Home: () => sunriseMinute ?? day.dayStart,
      End: () => sunsetMinute ?? day.dayEnd,
    };
    const move = moves[event.key];
    if (move === undefined) return;
    event.preventDefault();
    const next = Math.max(day.dayStart, Math.min(day.dayEnd - MINUTE_MS, move()));
    useHallTimeStore.getState().setTime(Math.round(next / MINUTE_MS) * MINUTE_MS);
  };

  const where = sunUp
    ? `Sun ${String(Math.max(0, Math.round(sun.altitude)))}° up, ${compassPoint(sun.azimuth)}`
    : moon.altitude > 0
      ? `Moon ${String(Math.round(moon.illuminated * 100))}% lit, ${String(Math.round(moon.altitude))}° up`
      : "Sun and moon below the horizon";
  const clock = formatWallTime(at);
  const floor = day.sunOnFloor.length === 0
    ? "No direct sun on the floor this day"
    : `Sun on the floor ${day.sunOnFloor.map((s) => `${formatWallTime(s.start)}–${formatWallTime(s.end)}`).join(", ")}`;

  return (
    <div
      className={inline ? "hall-sun-dial is-inline" : "hall-sun-dial"}
      data-testid="hall-sun-dial"
      style={maxHeight === undefined ? undefined : { maxHeight }}
    >
      <div className="hall-sun-dial__head">
        <div className="hall-sun-dial__reading">
          <time className="hall-sun-dial__clock" dateTime={new Date(at).toISOString()}>{clock}</time>
          <span className="hall-sun-dial__where">{where}</span>
        </div>
        <div className="hall-sun-dial__when">
          <label
            className="hall-sun-dial__date"
            onClick={() => {
              // The whole chip opens the date picker, not only its own icon.
              try { dateInput.current?.showPicker(); } catch { /* the native input still takes typing */ }
            }}
          >
            {/* The year too, once it is not this one: a plan opened at next
                year's event must not read as this year's day. */}
            <span className="hall-sun-dial__date-text">{formatInlineDay(at, now)}</span>
            <input
              ref={dateInput}
              type="date"
              aria-label="Date"
              value={dateDraft ?? dayKey}
              onChange={(event) => {
                const value = event.target.value;
                setDateDraft(value);
                const year = DATE_INPUT_PATTERN.exec(value)?.[1];
                if (year === undefined || Number(year) < FIRST_YEAR || Number(year) > LAST_YEAR) return;
                const next = wallInputToMs(`${value}T${msToWallInput(at, VENUE_TIME_ZONE).slice(11, 16)}`, VENUE_TIME_ZONE);
                if (next !== null) useHallTimeStore.getState().setTime(next);
              }}
              onBlur={() => { setDateDraft(null); }}
            />
          </label>
          <button
            type="button"
            className={mode === "now" ? "hall-sun-dial__now is-active" : "hall-sun-dial__now"}
            aria-pressed={mode === "now"}
            onClick={() => { useHallTimeStore.getState().followNow(); }}
          >
            Now
          </button>
        </div>
      </div>

      <svg
        className="hall-sun-dial__band"
        viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
        role="slider"
        tabIndex={0}
        aria-label="Time of day"
        aria-valuemin={0}
        aria-valuemax={Math.round(span / MINUTE_MS)}
        aria-valuenow={Math.round((at - day.dayStart) / MINUTE_MS)}
        aria-valuetext={`${clock}. ${where}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onKeyDown={onKeyDown}
      >
        <defs>
          <linearGradient id={`${gradientId}-sky`} x1="0" x2="1" y1="0" y2="0">
            {stops.map((stop) => <stop key={stop.offset} offset={stop.offset} stopColor={stop.color} />)}
          </linearGradient>
          <linearGradient id={`${gradientId}-fade`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#000" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity="0.55" />
          </linearGradient>
          <radialGradient id={`${gradientId}-glow`}>
            <stop offset="0" stopColor={sunUp ? sunTone : "#dfe6ff"} stopOpacity="0.85" />
            <stop offset="1" stopColor={sunUp ? sunTone : "#dfe6ff"} stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect x="0" y="0" width={WIDTH} height={HEIGHT} rx="10" fill={`url(#${gradientId}-sky)`} />
        <rect x="0" y={HORIZON} width={WIDTH} height={HEIGHT - HORIZON} rx="0" fill={`url(#${gradientId}-fade)`} />
        {day.sunOnFloor.map((spanOnFloor) => (
          <rect
            key={spanOnFloor.start}
            className="hall-sun-dial__floor-bar"
            x={x(spanOnFloor.start)}
            y={HORIZON + 4}
            width={Math.max(2, x(spanOnFloor.end) - x(spanOnFloor.start))}
            height={3}
            rx={1.5}
          />
        ))}
        <line x1="0" x2={WIDTH} y1={HORIZON} y2={HORIZON} className="hall-sun-dial__horizon" />
        <polyline points={above} className="hall-sun-dial__path" />
        {marks.map((mark) => (
          <line key={mark.label} x1={x(mark.at)} x2={x(mark.at)} y1={HORIZON - 4} y2={HORIZON + 4} className="hall-sun-dial__tick" />
        ))}
        <line x1={knobX} x2={knobX} y1="6" y2={HEIGHT - 6} className="hall-sun-dial__now-line" />
        <g transform={`translate(${knobX.toFixed(2)} ${knobY.toFixed(2)})`} className="hall-sun-dial__knob">
          <circle r="16" fill={`url(#${gradientId}-glow)`} />
          {sunUp ? (
            <circle r="7" fill={sunTone} className="hall-sun-dial__sun" />
          ) : (
            <g className="hall-sun-dial__moon">
              <circle r="7" className="hall-sun-dial__moon-dark" />
              <path d={moonPhasePath(7, moon.illuminated, moon.waxing)} className="hall-sun-dial__moon-lit" />
            </g>
          )}
        </g>
      </svg>
      <div className="hall-sun-dial__marks" aria-hidden="true">
        {marks.map((mark) => {
          const percent = (x(mark.at) / WIDTH) * 100;
          // Kept inside the band at its ends.
          const shift = percent < 14 ? "0" : percent > 86 ? "-100%" : "-50%";
          return (
            <span key={mark.label} style={{ left: `${String(percent)}%`, transform: `translateX(${shift})` }}>
              {mark.label} {formatWallTime(mark.at)}
            </span>
          );
        })}
      </div>
      <p className="hall-sun-dial__floor">
        <span className="hall-sun-dial__floor-swatch" aria-hidden="true" />
        {floor}
      </p>
      <div className="hall-sun-dial__presets" role="group" aria-label="Moments of the day">
        {presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="hall-sun-dial__preset"
            onClick={() => { useHallTimeStore.getState().setTime(Math.round(preset.at / MINUTE_MS) * MINUTE_MS); }}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <p className="hall-sun-dial__credit">
        {LIDAR_CREDIT},{" "}
        <a href={OGL_URL} target="_blank" rel="noopener noreferrer">OGL v3.0</a>
      </p>
    </div>
  );
}

export interface HallSunButtonProps {
  readonly open: boolean;
  readonly onToggle: () => void;
}

/**
 * The light group's button: the shown hour, with the sun or moon. Its ref is
 * the button, so the panel can hand focus back to it when it closes.
 */
export const HallSunButton = forwardRef<HTMLButtonElement, HallSunButtonProps>(function HallSunButton({ open, onToggle }, ref): ReactElement {
  const mode = useHallTimeStore((s) => s.mode);
  const chosen = useHallTimeStore((s) => s.at);
  const now = useFollowedClock(mode);
  const at = mode === "now" ? now : chosen;
  const Icon = sunIsUp(sunPosition(at, HALL_OBSERVER)) ? Sun : Moon;
  const clock = formatWallTime(at);
  return (
    <button
      ref={ref}
      type="button"
      className={open ? "cockpit-layer-btn hall-sun-button is-active" : "cockpit-layer-btn hall-sun-button"}
      // Named for what it is, the shown hour kept in the name: the clock alone
      // would be read out as a bare "14:05, button".
      aria-label={`Time of day, ${clock}`}
      aria-expanded={open}
      aria-haspopup="dialog"
      title="Time of day"
      data-testid="hall-sun-button"
      onClick={onToggle}
    >
      <Icon size={15} aria-hidden="true" />
      <span className="hall-sun-button__time">{clock}</span>
    </button>
  );
});
