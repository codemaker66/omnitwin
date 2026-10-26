import { useId, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { actAt, actSegments, labelRows, type LabelBox, type TimedAct } from "../../lib/evening-acts.js";
import {
  bodyEvents,
  bodyRuns,
  degreesScale,
  skyAt,
  skyBand,
  skyStars,
  splitRun,
  sunHighest,
  type PathPoint,
} from "../../lib/evening-sky.js";
import { xAtTime, type TimeWindow } from "../../lib/evening-window.js";
import { formatWallTime } from "../../pages/diary/lib/board-time.js";
import { MoonGlyph } from "./HourChip.js";
import "./evening.css";

// ---------------------------------------------------------------------------
// The evening's sky and its line (T-674, v2 slice 10; spec 6.2; frames 03, 11).
//
// One drawing: the sky above a horizon, and on the ground below it the
// running order. The sky is the product's palette across the window by the
// sun's true altitude, with the city's warm glow along the horizon at night
// and the stars where the palette lets them out; guides at 10°, 20° (and 30°
// on a desktop); the moon's path where it is up, travelled solid and ahead
// dotted, with the moon in its phase at the hour and a soft halo; moonrise,
// sunrise and sunset marked on the horizon. No blur and no filter: a glow is
// a wide stroke at 16 %, a halo a radial gradient.
//
// The horizon is the line. Each act's bar runs along it (past acts copper at
// 55 %, the current act full copper, the rest cream at 38 %), and each act is
// labelled at its start tick, its name over its start time; two labels within
// 12 px never share a row (the shorter takes the second, with its tick drawn
// down as a leader; the act under the playhead never moves). Without acts the
// line names the day's own stops instead. The playhead is a cream disc with a
// copper glow. A phone draws the line bare: its acts are chips below.
// ---------------------------------------------------------------------------

export interface DayStop {
  readonly at: number;
  readonly name: string;
}

export interface EveningSkyProps {
  readonly span: TimeWindow;
  /** The drawing's width, px. */
  readonly width: number;
  /** The sky's height above the horizon, px (128 on a desktop, 112 on a phone). */
  readonly skyHeight: number;
  readonly at: number;
  /** The acts on this evening's line, in the order they begin. */
  readonly acts: readonly TimedAct[];
  /** Without acts: the day's stops (sunrise, noon, sunset, moonrise), named on the line. */
  readonly dayStops: readonly DayStop[];
  /** The phone's sheet: the line bare, the guides at 10° and 20° only. */
  readonly compact: boolean;
}

const LINE_ONE_ROW = 52;
const LINE_TWO_ROWS = 92;
const LINE_BARE = 22;
const NAME_Y = [12, 54] as const;
const TIME_Y = [31, 73] as const;
const LABEL_INSET = 6;

/** Label widths measured on screen, by weight, size and words; estimated until then. */
const measuredWidths = new Map<string, number>();

function widthOf(text: string, size: 12 | 14, weight: number): number {
  const known = measuredWidths.get(`${String(weight)}/${String(size)}/${text}`);
  if (known !== undefined) return known;
  return text.length * (size === 14 ? (weight >= 600 ? 8.1 : 7.8) : 7);
}

function pathOf(points: readonly PathPoint[], x: (time: number) => number, y: (degrees: number) => number): string {
  return points.map((point, index) => `${index === 0 ? "M" : "L"}${x(point.t).toFixed(1)},${y(point.alt).toFixed(1)}`).join(" ");
}

interface LineLabel {
  readonly key: string;
  readonly x: number;
  readonly name: string;
  readonly time: string;
  readonly span: number;
  readonly current: boolean;
}

export function EveningSky({ span, width, skyHeight, at, acts, dayStops, compact }: EveningSkyProps): ReactElement {
  const ids = useId().replace(/[^a-zA-Z0-9_-]/gu, "");
  const id = (name: string): string => `pc-ev-${ids}-${name}`;
  const svgRef = useRef<SVGSVGElement>(null);
  const [, setMeasured] = useState(0);

  const { start, end } = span;
  const band = useMemo(() => skyBand({ start, end }), [start, end]);
  const stars = useMemo(() => skyStars({ start, end }, width, skyHeight), [start, end, width, skyHeight]);
  const perDegree = useMemo(() => degreesScale(skyHeight, sunHighest({ start, end })), [start, end, skyHeight]);
  const moonRuns = useMemo(() => bodyRuns({ start, end }, "moon"), [start, end]);
  const sunRuns = useMemo(() => bodyRuns({ start, end }, "sun"), [start, end]);
  const marks = useMemo(() => {
    const sun = bodyEvents({ start, end }, "sun");
    const moon = bodyEvents({ start, end }, "moon");
    return [
      ...sun.rises.map((time) => ({ at: time, name: "Sunrise" })),
      ...sun.sets.map((time) => ({ at: time, name: "Sunset" })),
      ...moon.rises.map((time) => ({ at: time, name: "Moonrise" })),
      ...moon.sets.map((time) => ({ at: time, name: "Moonset" })),
    ].sort((a, b) => a.at - b.at);
  }, [start, end]);

  const x = (time: number): number => xAtTime(span, width, time);
  const y = (degrees: number): number => skyHeight - degrees * perDegree;
  const reading = skyAt(at);
  const headX = Math.max(0, Math.min(width, x(at)));

  // The line's labels: the acts, or the day's stops without them.
  const place = actAt(acts, at);
  const labels: LineLabel[] = compact ? [] : acts.length > 0
    ? acts.map((act, index) => ({
      key: act.id,
      x: x(act.start),
      name: act.name,
      time: formatWallTime(act.start),
      span: act.end - act.start,
      current: place.kind === "in" && place.index === index,
    }))
    : dayStops.map((stop) => ({ key: `${stop.name}-${String(stop.at)}`, x: x(stop.at), name: stop.name, time: formatWallTime(stop.at), span: 0, current: false }));
  const boxes: LabelBox[] = labels.map((label) => {
    const labelWidth = Math.max(widthOf(label.name, 14, label.current ? 600 : 500), widthOf(label.time, 12, 400));
    return { left: Math.max(0, Math.min(width - labelWidth, label.x + LABEL_INSET)), width: labelWidth, span: label.span, current: label.current };
  });
  const rows = labelRows(boxes);
  const lineHeight = compact ? LINE_BARE : rows.includes(1) ? LINE_TWO_ROWS : LINE_ONE_ROW;
  const height = skyHeight + lineHeight;

  // Measure the labels as the screen sets them, once per word, and lay out again if the estimate was off.
  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (svg === null) return;
    let changed = false;
    for (const text of svg.querySelectorAll<SVGTextContentElement>("[data-pc-measure]")) {
      if (typeof text.getComputedTextLength !== "function") return;
      const key = text.dataset.pcMeasure ?? "";
      const measured = text.getComputedTextLength();
      if (measured > 0 && Math.abs((measuredWidths.get(key) ?? -1) - measured) > 0.5) {
        measuredWidths.set(key, measured);
        changed = true;
      }
    }
    if (changed) setMeasured((count) => count + 1);
  });

  const guides = compact ? [10, 20] : [10, 20, 30];
  const markLabels = acts.length > 0 || compact;

  const segments = actSegments(acts, at);
  return (
    <svg
      ref={svgRef}
      className="pc-evening__drawing"
      width={width}
      height={height}
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      aria-hidden="true"
      data-testid="planner-evening-drawing"
    >
      <defs>
        <linearGradient id={id("zenith")} x1="0" x2="1" y1="0" y2="0">
          {band.map((stop) => <stop key={stop.offset} offset={stop.offset} stopColor={stop.zenith} />)}
        </linearGradient>
        <linearGradient id={id("horizon")} x1="0" x2="1" y1="0" y2="0">
          {band.map((stop) => <stop key={stop.offset} offset={stop.offset} stopColor={stop.horizon} />)}
        </linearGradient>
        <linearGradient id={id("rise")} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="white" stopOpacity={0} />
          <stop offset="0.55" stopColor="white" stopOpacity={0.35} />
          <stop offset="1" stopColor="white" stopOpacity={1} />
        </linearGradient>
        <mask id={id("low")} maskUnits="userSpaceOnUse" x="0" y="0" width={width} height={skyHeight}>
          <rect width={width} height={skyHeight} fill={`url(#${id("rise")})`} />
        </mask>
        <linearGradient id={id("city-across")} x1="0" x2="1" y1="0" y2="0">
          {band.map((stop) => <stop key={stop.offset} offset={stop.offset} stopColor="white" stopOpacity={stop.city} />)}
        </linearGradient>
        <mask id={id("city")} maskUnits="userSpaceOnUse" x="0" y={skyHeight - 30} width={width} height={30}>
          <rect y={skyHeight - 30} width={width} height={30} fill={`url(#${id("city-across")})`} />
        </mask>
        <linearGradient id={id("city-up")} x1="0" x2="0" y1="1" y2="0">
          <stop className="pc-evening__warm-stop" offset="0" stopOpacity={0.2} />
          <stop className="pc-evening__warm-stop" offset="1" stopOpacity={0} />
        </linearGradient>
        <radialGradient id={id("halo")}>
          <stop className="pc-evening__light-stop" offset="0" stopOpacity={0.5} />
          <stop className="pc-evening__light-stop" offset="0.4" stopOpacity={0.12} />
          <stop className="pc-evening__light-stop" offset="1" stopOpacity={0} />
        </radialGradient>
        <radialGradient id={id("sun-halo")}>
          <stop className="pc-evening__warm-stop" offset="0" stopOpacity={0.55} />
          <stop className="pc-evening__warm-stop" offset="1" stopOpacity={0} />
        </radialGradient>
        <radialGradient id={id("head-glow")}>
          <stop className="pc-evening__warm-stop" offset="0.4" stopOpacity={0.4} />
          <stop className="pc-evening__warm-stop" offset="1" stopOpacity={0} />
        </radialGradient>
        <clipPath id={id("sky")}>
          <rect width={width} height={skyHeight} rx={6} />
        </clipPath>
      </defs>

      <g clipPath={`url(#${id("sky")})`}>
        <rect width={width} height={skyHeight} fill={`url(#${id("zenith")})`} />
        <rect width={width} height={skyHeight} fill={`url(#${id("horizon")})`} mask={`url(#${id("low")})`} />
        <rect y={skyHeight - 30} width={width} height={30} fill={`url(#${id("city-up")})`} mask={`url(#${id("city")})`} />
        {stars.map((star, index) => (
          <circle key={index} className="pc-evening__star" cx={star.x.toFixed(1)} cy={star.y.toFixed(1)} r={star.r} opacity={star.opacity} />
        ))}
        {guides.filter((degrees) => y(degrees) > 10).map((degrees) => (
          <g key={degrees}>
            <line className="pc-evening__guide" x1={0} x2={width} y1={y(degrees)} y2={y(degrees)} />
            <text className="pc-evening__guide-label" x={width - 8} y={y(degrees) - 5} textAnchor="end">{`${String(degrees)}°`}</text>
          </g>
        ))}
        {[...sunRuns.map((run) => ({ run, body: "sun" as const })), ...moonRuns.map((run) => ({ run, body: "moon" as const }))].map(({ run, body }, index) => {
          const altitudeNow = body === "sun" ? reading.sun.altitude : reading.moon.altitude;
          const { done, ahead } = splitRun(run, at, altitudeNow);
          return (
            <g key={`${body}-${String(index)}`} className={`pc-evening__path pc-evening__path--${body}`}>
              {done.length > 1 ? <path className="pc-evening__path-glow" d={pathOf(done, x, y)} /> : null}
              {done.length > 1 ? <path className="pc-evening__path-done" d={pathOf(done, x, y)} /> : null}
              {ahead.length > 1 ? <path className="pc-evening__path-ahead" d={pathOf(ahead, x, y)} /> : null}
            </g>
          );
        })}
        {reading.moon.up ? (
          <g data-testid="planner-evening-moon">
            {reading.sun.up ? null : <line className="pc-evening__drop" x1={headX} x2={headX} y1={skyHeight} y2={y(reading.moon.altitude) + 13} />}
            <circle cx={headX} cy={y(reading.moon.altitude)} r={30} fill={`url(#${id("halo")})`} />
            <g transform={`translate(${(headX - 11).toFixed(1)} ${(y(reading.moon.altitude) - 11).toFixed(1)})`}>
              <MoonGlyph lit={reading.moon.illuminated} waxing={reading.moon.waxing} risen size={22} />
            </g>
          </g>
        ) : null}
        {reading.sun.up ? (
          <g data-testid="planner-evening-sun">
            <line className="pc-evening__drop" x1={headX} x2={headX} y1={skyHeight} y2={y(reading.sun.altitude) + 9} />
            <circle cx={headX} cy={y(reading.sun.altitude)} r={26} fill={`url(#${id("sun-halo")})`} />
            <circle className="pc-evening__sun" cx={headX} cy={y(reading.sun.altitude)} r={6} />
          </g>
        ) : null}
        {marks.map((mark, index) => {
          const mx = x(mark.at);
          const previous = marks[index - 1];
          const raised = previous !== undefined && mx - x(previous.at) < 110 ? 16 : 0;
          const anchor = mx < 56 ? "start" : mx > width - 56 ? "end" : "middle";
          return (
            <g key={`${mark.name}-${String(mark.at)}`} className="pc-evening__mark">
              <line className="pc-evening__mark-tick" x1={mx} x2={mx} y1={skyHeight - 24 - raised} y2={skyHeight - 3} />
              {markLabels ? (
                <text className="pc-evening__mark-label" x={mx} y={skyHeight - 30 - raised} textAnchor={anchor}>
                  {`${mark.name} ${formatWallTime(mark.at)}`}
                </text>
              ) : null}
            </g>
          );
        })}
      </g>

      <g transform={`translate(0 ${String(skyHeight)})`}>
        <line className="pc-evening__axis" x1={0} x2={width} y1={0} y2={0} />
        {marks.map((mark) => (
          <circle key={`dot-${mark.name}-${String(mark.at)}`} className="pc-evening__mark-dot" cx={x(mark.at)} cy={0} r={3.2} />
        ))}
        {segments.map((segment) => {
          const from = x(segment.from);
          const to = x(segment.to);
          const current = segment.tone === "current";
          return (
            <rect
              key={segment.act.id}
              className={`pc-evening__bar pc-evening__bar--${segment.tone}`}
              data-testid={`planner-evening-bar-${segment.tone}`}
              x={from + 1}
              y={current ? -2.5 : -1.5}
              width={Math.max(0, to - from - 2)}
              height={current ? 5 : 3}
              rx={current ? 2.5 : 1.5}
            />
          );
        })}
        {labels.map((label, index) => {
          const row = rows[index] ?? 0;
          const box = boxes[index];
          const left = box?.left ?? label.x + LABEL_INSET;
          const weight = label.current ? 600 : 500;
          return (
            <g key={label.key} className={label.current ? "pc-evening__label is-current" : "pc-evening__label"} data-row={row}>
              <line className={row === 1 ? "pc-evening__leader" : "pc-evening__tick"} x1={label.x} x2={label.x} y1={-2} y2={row === 1 ? NAME_Y[1] : 7} />
              <text
                className="pc-evening__act-name"
                x={left}
                y={NAME_Y[row]}
                dominantBaseline="hanging"
                data-pc-measure={`${String(weight)}/14/${label.name}`}
              >
                {label.name}
              </text>
              <text
                className="pc-evening__act-time"
                x={left}
                y={TIME_Y[row]}
                dominantBaseline="hanging"
                data-pc-measure={`400/12/${label.time}`}
              >
                {label.time}
              </text>
            </g>
          );
        })}
        <g className="pc-evening__head" data-testid="planner-evening-playhead">
          <circle cx={headX} cy={0} r={22} fill={`url(#${id("head-glow")})`} />
          <circle className="pc-evening__head-ring" cx={headX} cy={0} r={9.5} />
          <circle className="pc-evening__head-disc" cx={headX} cy={0} r={8} />
        </g>
      </g>
    </svg>
  );
}
