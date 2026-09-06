import { useEffect, useRef, type ReactElement } from "react";
import { SPRING_PRESETS, isSpringSettled, stepSpring, type SpringState } from "../../../lib/springs.js";
import { useStageRuntime } from "./stage-runtime.js";

// -----------------------------------------------------------------------------
// InkLayer — an inline SVG whose path draws itself on scene entry.
//
// The ink is a stroke-dashoffset draw under a spring scalar, never a CSS
// animation: `pathLength` pins the path's length to the manifest's segments
// count so the dash arithmetic is exact regardless of the path's true
// length, and the offset runs from `segments` (nothing drawn) to 0 (drawn)
// as a `heavy` spring (280/120, overdamped) carries a scalar from 0 to 1.
// Heavy's slow root is 2.39/s, so the stroke arrives over about two seconds
// and decelerates like a pen lifting; nothing overshoots, nothing loops.
//
// Reduced motion: the path arrives already drawn, and the entry timestamp is
// still stamped so a reduced-motion run keeps every beat's time.
// -----------------------------------------------------------------------------

/** The dash offset for a draw progress in 0..1 against a pinned path length. */
export function inkDashOffset(segments: number, progress: number): number {
  const p = progress < 0 ? 0 : progress > 1 ? 1 : progress;
  return segments * (1 - p);
}

const DRAW_SETTLE_EPSILON = 0.0015;

export interface InkLayerProps {
  /** The `d` of the one path; the art module owns its authoring. */
  readonly pathData: string;
  /** The manifest's ink.segments: the visible-path budget and the pinned pathLength. */
  readonly segments: number;
  readonly viewBox: string;
  readonly reducedMotion: boolean;
  /** Milliseconds after entry before the pen touches paper; default 0. */
  readonly delayMs?: number;
  readonly stroke?: string;
  readonly strokeWidth?: number;
  readonly className?: string;
  readonly onDrawn?: () => void;
}

export function InkLayer({
  pathData, segments, viewBox, reducedMotion, delayMs = 0, stroke = "currentColor", strokeWidth = 1.2, className, onDrawn,
}: InkLayerProps): ReactElement {
  const runtime = useStageRuntime();
  const svgRef = useRef<SVGSVGElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const onDrawnRef = useRef(onDrawn);
  onDrawnRef.current = onDrawn;

  useEffect(() => {
    const svg = svgRef.current;
    const path = pathRef.current;
    if (svg === null || path === null) return undefined;

    const startedAt = performance.now();
    svg.dataset["inkStartedAt"] = startedAt.toFixed(0);
    delete svg.dataset["inkDrawnAt"];

    const finish = (atMs: number): void => {
      path.style.strokeDashoffset = "0";
      svg.dataset["inkDrawnAt"] = atMs.toFixed(0);
      onDrawnRef.current?.();
    };

    if (reducedMotion) {
      finish(startedAt);
      return undefined;
    }

    path.style.strokeDashoffset = String(inkDashOffset(segments, 0));
    const progress: SpringState = { value: 0, velocity: 0 };
    let elapsedMs = 0;
    const remove = runtime.loop.add((nowMs, dt) => {
      elapsedMs += dt * 1000;
      if (elapsedMs < delayMs) return true;
      stepSpring(progress, 1, dt, SPRING_PRESETS.heavy);
      path.style.strokeDashoffset = String(inkDashOffset(segments, progress.value));
      if (isSpringSettled(progress, 1, DRAW_SETTLE_EPSILON)) {
        finish(nowMs);
        return false;
      }
      return true;
    });
    return remove;
  }, [delayMs, pathData, reducedMotion, runtime, segments]);

  return (
    <svg
      ref={svgRef}
      className={className === undefined ? "stage-ink" : `stage-ink ${className}`}
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <path
        ref={pathRef}
        d={pathData}
        pathLength={segments}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={segments}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
