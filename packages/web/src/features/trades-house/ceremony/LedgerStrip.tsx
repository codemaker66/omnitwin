import { useLayoutEffect, useRef, type ReactElement } from "react";
import { SPRING_PRESETS, isSpringSettled, stepSpring, type SpringState } from "../../../lib/springs.js";
import { stampBeat } from "./beats.js";
import { createFrameLoop } from "./spring-loop.js";

// -----------------------------------------------------------------------------
// LedgerStrip — the eye's progress: twelve faint slots in the frame's left
// margin, and one gold stroke per scene that draws itself.
//
// After the reply the page raises strokeIndex by one and the newest stroke
// draws by stroke-dashoffset under a spring scalar (camera 120/14: a pen, not
// a snap), stamping data-beat-at="ledger" on its first frame. Reduced motion
// draws it whole on that same frame with the same stamp. The screen reader's
// progress is the page's "Question N of 12" region; this strip is aria-hidden
// so nobody hears the year twice. No Math.random: the hand-ruled wobble is a
// fixed table, identical for everyone.
// -----------------------------------------------------------------------------

export interface LedgerStripProps {
  /** Strokes drawn so far, 0..slots; raising it by one draws the newest. */
  readonly strokeIndex: number;
  /** Twelve scenes, twelve slots. */
  readonly slots?: number;
  readonly reducedMotion?: boolean;
  /** The newest stroke has settled (or arrived whole under reduced motion). */
  readonly onStrokeSettled?: (strokeIndex: number) => void;
  readonly className?: string;
}

export const LEDGER_SLOTS = 12;
/** The dash length: at least any stroke's true length, so offset = length hides it. */
export const LEDGER_STROKE_LENGTH = 26;

const SLOT_PITCH = 20;
const SLOT_TOP = 12;
const VIEW_WIDTH = 24;

/** A hand-ruled wobble per slot, in user units; the same for everyone. */
const WOBBLE: readonly (readonly [number, number, number])[] = [
  [0.3, -0.6, 0.4], [-0.4, 0.5, -0.2], [0.5, 0.2, -0.5], [-0.2, -0.4, 0.6],
  [0.4, 0.6, -0.3], [-0.5, -0.2, 0.2], [0.2, -0.5, -0.4], [-0.3, 0.4, 0.5],
  [0.6, -0.3, 0.1], [-0.1, 0.3, -0.6], [0.4, -0.2, 0.3], [-0.6, 0.1, -0.1],
];

function slotY(index: number): number {
  return SLOT_TOP + index * SLOT_PITCH;
}

/** The faint slot: a short rule. */
export function slotPath(index: number): string {
  const y = slotY(index);
  return `M4 ${String(y)} H20`;
}

/** The gold stroke: a slightly bowed line with a hooked end, wobbled per slot. */
export function strokePath(index: number): string {
  const y = slotY(index);
  const [a, b, c] = WOBBLE[index % WOBBLE.length] ?? [0, 0, 0];
  const start = `M3.5 ${(y + a).toFixed(2)}`;
  const bow = `C 8 ${(y - 1 + b).toFixed(2)}, 14 ${(y + 1.2 + c).toFixed(2)}, 20.5 ${(y - 0.4).toFixed(2)}`;
  return `${start} ${bow}`;
}

function strokeElements(svg: SVGSVGElement): SVGPathElement[] {
  return Array.from(svg.querySelectorAll<SVGPathElement>(".ceremony-ledger-stroke"));
}

export function LedgerStrip({
  strokeIndex,
  slots = LEDGER_SLOTS,
  reducedMotion = false,
  onStrokeSettled,
  className,
}: LedgerStripProps): ReactElement {
  if (!Number.isInteger(strokeIndex) || strokeIndex < 0) {
    throw new RangeError(`strokeIndex must be a non-negative integer; got ${String(strokeIndex)}`);
  }
  if (!Number.isInteger(slots) || slots < 1) {
    throw new RangeError(`slots must be a positive integer; got ${String(slots)}`);
  }
  const drawn = Math.min(strokeIndex, slots);

  const rootRef = useRef<SVGSVGElement>(null);
  /** Strokes already at offset 0 (drawn in an earlier scene, or settled). */
  const settledRef = useRef(0);
  const reducedRef = useRef(reducedMotion);
  reducedRef.current = reducedMotion;
  const onSettledRef = useRef(onStrokeSettled);
  onSettledRef.current = onStrokeSettled;

  useLayoutEffect(() => {
    const svg = rootRef.current;
    if (svg === null) return undefined;
    if (drawn < settledRef.current) settledRef.current = drawn; // a new run
    const strokes = strokeElements(svg);
    strokes.forEach((path, index) => {
      const complete = index < drawn - 1 || index < settledRef.current;
      path.setAttribute("stroke-dashoffset", complete ? "0" : String(LEDGER_STROKE_LENGTH));
    });
    if (drawn <= settledRef.current) return undefined;
    const newest = strokes[drawn - 1];
    if (newest === undefined) return undefined;

    const spring: SpringState = { value: 0, velocity: 0 };
    let stamped = false;
    const finish = (): void => {
      newest.setAttribute("stroke-dashoffset", "0");
      settledRef.current = drawn;
      onSettledRef.current?.(drawn);
    };
    const loop = createFrameLoop((nowMs, dt) => {
      if (!stamped) {
        stamped = true;
        stampBeat(svg, "ledger", nowMs);
      }
      if (reducedRef.current) {
        finish();
        return false;
      }
      stepSpring(spring, 1, dt, SPRING_PRESETS.camera);
      if (isSpringSettled(spring, 1)) {
        finish();
        return false;
      }
      const offset = Math.max(0, LEDGER_STROKE_LENGTH * (1 - spring.value));
      newest.setAttribute("stroke-dashoffset", offset.toFixed(2));
      return true;
    });
    loop.wake();
    return () => { loop.stop(); };
  }, [drawn]);

  const height = SLOT_TOP * 2 + (slots - 1) * SLOT_PITCH;
  const indices = Array.from({ length: slots }, (_, index) => index);

  return (
    <svg
      ref={rootRef}
      className={className === undefined ? "ceremony-ledger" : `ceremony-ledger ${className}`}
      viewBox={`0 0 ${String(VIEW_WIDTH)} ${String(height)}`}
      aria-hidden="true"
      data-strokes={drawn}
    >
      {indices.map((index) => (
        <path key={`slot-${String(index)}`} className="ceremony-ledger-slot" d={slotPath(index)} />
      ))}
      {indices.slice(0, drawn).map((index) => (
        <path
          key={`stroke-${String(index)}`}
          className="ceremony-ledger-stroke"
          data-stroke={index}
          d={strokePath(index)}
          strokeDasharray={LEDGER_STROKE_LENGTH}
        />
      ))}
    </svg>
  );
}
