import { useEffect, useState, type ReactElement } from "react";
import {
  MEASURE_CENTRE_PICK_LABEL,
  MEASURE_CLEAR_LABEL,
  MEASURE_CONFIDENCE_NOTE,
  MEASURE_DONE_LABEL,
  MEASURE_FIRST_PROMPT,
  MEASURE_GROUP_LABEL,
  MEASURE_SECOND_PROMPT,
  MEASURE_STAT_PLAN,
  MEASURE_STAT_STRAIGHT,
  measureAnnouncement,
  measureRiseWord,
} from "./measure-copy.js";
import { measureBetween, type MeasureVec3 } from "./measure-math.js";
import "./measure.css";

// -----------------------------------------------------------------------------
// MeasureLayer — the two-point measure, drawn over the walkthrough.
//
// WHERE THE POINTS COME FROM, AND WHY NOT FROM HERE. This component does no
// raycasting and holds no picks. The host owns the camera, the pano mesh and
// the dollhouse collider, so the host is the only thing that can turn a click
// into a world point; it passes the picks down and this layer renders them.
// Splitting it that way keeps the whole feature testable without R3F, and —
// more usefully — means the pick strategy can change (pano depth today, mesh
// collider tomorrow) without touching a line of the presentation.
//
// The host also supplies each pick's SCREEN position as a fraction of the
// stage, because it is the only thing holding the camera to project with. The
// layer draws in percentages, so a window resize needs no re-projection at all:
// only a camera move does, which the host is already re-rendering for.
//
// MOUNTING IS ARMING. There is no `active` prop. The tool exists while it is
// mounted and its Escape listener lives exactly that long — a window listener
// that outlived its component would quietly swallow Escape for the fullscreen
// control and the enquiry modal.
//
// It floats over a live 3D view, which drives the same three rules the room
// dossier records. The frame takes no pointer events and only the panel takes
// them back (enforced in measure.css, not merely intended here) because
// click-anywhere travel is the primary movement mechanic and an unstyled block
// would silently disable walking across its whole width. It never traps focus.
// And every figure it prints carries its approximation mark, because a bare
// number from a measuring tool is the one output of this product somebody
// spends money against.
//
// WHAT THIS COMPONENT NO LONGER TAKES, and why the absence is the feature. It
// used to accept the manifest `tier` and print a ± derived from it. `tier` is
// an argv default in the forge CLI, not a measured quantity, so that ± was a
// command-line flag dressed as an instrument spec. The prop is gone rather than
// merely unrendered: a value this component is never handed is a value it can
// never leak, and there is now no route by which a host could reintroduce one.
// measure-math.ts records what a real ± would require.
//
// No JS animation lives here, so there is no `prefersReducedMotion` read: the
// panel's only motion is a CSS entrance, and measure.css cancels it under
// `prefers-reduced-motion: reduce`. A JS spring would have needed the runtime
// check; a stylesheet keyframe is honestly answered in the stylesheet.
// -----------------------------------------------------------------------------

/** A picked point's position on the stage, as a fraction of its width/height —
 *  (0,0) top-left, (1,1) bottom-right. Fractions, not pixels, so the overlay
 *  never needs to know the stage's size or re-measure it on resize. */
export interface MeasureScreenPoint {
  readonly x: number;
  readonly y: number;
}

/** One pick: where it is in the building, and where that currently appears. */
export interface MeasurePoint {
  /** three.js world metres — `[v.x, v.y, v.z]` from the host's raycast hit. */
  readonly world: MeasureVec3;
  /** Null when the point is behind the camera or otherwise unprojectable. The
   *  measurement is still true then; only its drawing is impossible, and the
   *  layer degrades to the figures alone rather than drawing a wrong line. */
  readonly screen: MeasureScreenPoint | null;
}

export interface MeasureLayerProps {
  /** The picks so far, in pick order. Empty = waiting for the first; one =
   *  waiting for the second; two = a complete measurement. A longer list is a
   *  host bug and the layer measures the first two rather than throwing over
   *  a visitor's view. */
  readonly points: readonly MeasurePoint[];
  /** Put the tool away. Escape with nothing picked, and the Close control. */
  readonly onDismiss: () => void;
  /** Drop the picks but stay in the tool. Absent → no Clear control at all
   *  (never a dead one) and Escape falls straight through to dismissal. */
  readonly onClear?: () => void;
  /** Place a point where the camera is looking. Absent → no button, because a
   *  control that cannot do what it says is worse than a missing one. Wiring
   *  it is what makes the tool usable without a mouse. */
  readonly onPickAtCentre?: () => void;
}

/**
 * A stage fraction as an SVG/CSS percentage, trimmed to three decimals —
 * sub-pixel on any display, and it keeps `0.25` rendering as "25%" instead of
 * the "25.000000000000004%" a naive multiply produces.
 */
function percent(fraction: number): string {
  return `${String(Math.round(fraction * 1e5) / 1e3)}%`;
}

/** Keeps the floating figure inside the stage. `.vv-twin-stage` clips its
 *  overflow, so an unclamped midpoint — the common case once one end of the
 *  span is behind you — would take the answer off-screen with it. */
function onStage(fraction: number): number {
  return Math.min(Math.max(fraction, 0.02), 0.98);
}

export function MeasureLayer({
  points,
  onDismiss,
  onClear,
  onPickAtCentre,
}: MeasureLayerProps): ReactElement {
  const from = points[0];
  const to = points[1];
  const span =
    from === undefined || to === undefined ? null : measureBetween(from.world, to.world);

  const pickCount = points.length;
  const canClear = onClear !== undefined && pickCount > 0;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") {
        return;
      }
      // The two-stage Escape every drawing tool uses: the first press throws
      // away the work in hand, the second the tool. Exiting on the first press
      // would make a mis-hit cost the visitor their picks AND their tool.
      //
      // `canClear` is a const alias for `onClear !== undefined && …`, so
      // TypeScript narrows `onClear` here through it — no optional call, which
      // would only have hidden a future refactor that broke the narrowing.
      if (canClear) {
        onClear();
        return;
      }
      onDismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [canClear, onClear, onDismiss]);

  // Announced one tick after the region mounts, on purpose: a live region that
  // appears in the DOM already carrying its text is silent in most screen
  // readers, which announce mutations to a region they were already watching.
  const announcementText = span === null ? "" : measureAnnouncement(span);
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    if (announcementText === "") {
      setAnnouncement("");
      return;
    }
    const timer = window.setTimeout(() => {
      setAnnouncement(announcementText);
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [announcementText]);

  const fromScreen = from?.screen ?? null;
  const toScreen = to?.screen ?? null;
  const drawSegment = fromScreen !== null && toScreen !== null;

  return (
    <div className="vv-twin-measure" data-testid="twin-measure">
      {/* The drawing. aria-hidden and pointer-events:none throughout: it is a
          picture of numbers the panel below already states, and a click that
          lands on it must still reach the canvas and travel. */}
      <svg className="vv-twin-measure-canvas" aria-hidden focusable="false">
        {drawSegment && (
          <>
            {/* A dark casing under the gold line — the map-label trick the
                viewer disclosure already uses. A hairline of gold alone
                disappears over the bright parquet of the entrance. */}
            <line
              className="vv-twin-measure-casing"
              x1={percent(fromScreen.x)}
              y1={percent(fromScreen.y)}
              x2={percent(toScreen.x)}
              y2={percent(toScreen.y)}
            />
            <line
              className="vv-twin-measure-line"
              data-testid="twin-measure-segment"
              x1={percent(fromScreen.x)}
              y1={percent(fromScreen.y)}
              x2={percent(toScreen.x)}
              y2={percent(toScreen.y)}
            />
          </>
        )}
        {/* Sliced to the two points the arithmetic actually used. An
            over-long list is a host bug either way, but drawing a third dot
            beside a figure computed from the first two would be the drawing
            disagreeing with the number — the one inconsistency a measuring
            tool cannot afford. */}
        {points.slice(0, 2).map((point, index) =>
          point.screen === null ? null : (
            <circle
              className="vv-twin-measure-dot"
              // Radius as an attribute, not CSS: `r` is an SVG2 geometry
              // property and a browser that ignores it draws nothing at all.
              r={4}
              // Pick order IS identity here: the host replaces the whole array
              // on every pick and there is no reordering to survive.
              key={`${String(index)}:${String(point.world[0])},${String(point.world[1])},${String(point.world[2])}`}
              data-testid={`twin-measure-point-${String(index)}`}
              cx={percent(point.screen.x)}
              cy={percent(point.screen.y)}
            />
          ),
        )}
      </svg>

      {/* The headline figure rides the segment, where the eye already is.
          aria-hidden because the panel and the live region below both carry it
          — a screen reader hearing it three times learns nothing new. */}
      {span !== null && drawSegment && (
        <p
          className="vv-twin-measure-tag"
          data-testid="twin-measure-tag"
          aria-hidden
          style={{
            left: percent(onStage((fromScreen.x + toScreen.x) / 2)),
            top: percent(onStage((fromScreen.y + toScreen.y) / 2)),
          }}
        >
          {span.straightLabel}
        </p>
      )}

      {/* A named group, not a dialog: ambient chrome over a live view that must
          never take focus on arrival nor hold it once given. */}
      <div
        className="vv-twin-measure-panel"
        role="group"
        aria-label={MEASURE_GROUP_LABEL}
        data-testid="twin-measure-panel"
      >
        <p className="vv-sr-only" aria-live="polite" data-testid="twin-measure-live">
          {announcement}
        </p>

        {span === null ? (
          <p className="vv-twin-measure-prompt">
            {pickCount === 0 ? MEASURE_FIRST_PROMPT : MEASURE_SECOND_PROMPT}
          </p>
        ) : (
          <>
            <dl className="vv-twin-measure-stats">
              <div className="vv-twin-measure-stat">
                <dt className="vv-twin-measure-stat-label">{MEASURE_STAT_STRAIGHT}</dt>
                <dd className="vv-twin-measure-stat-value">{span.straightLabel}</dd>
              </div>
              <div className="vv-twin-measure-stat">
                <dt className="vv-twin-measure-stat-label">{MEASURE_STAT_PLAN}</dt>
                <dd className="vv-twin-measure-stat-value">{span.planLabel}</dd>
              </div>
              <div className="vv-twin-measure-stat">
                <dt className="vv-twin-measure-stat-label">
                  {measureRiseWord(span.riseM)}
                </dt>
                <dd className="vv-twin-measure-stat-value">{span.riseLabel}</dd>
              </div>
            </dl>
            {/* The qualification lands WITH the figures, never before them.
                Parked over the prompt states too it would be a caveat about a
                number that does not exist yet — and a paragraph a visitor has
                already learned to skip past is a paragraph they will skip when
                it finally matters. Rendering it only here also makes one
                invariant true and testable: the note appears on this screen if
                and only if there is a measurement for it to qualify. */}
            <p className="vv-twin-measure-note">{MEASURE_CONFIDENCE_NOTE}</p>
          </>
        )}

        {/* DOM order is the only order, so tab order and reading order are the
            visual order by construction rather than by a second declaration
            free to drift. */}
        <div className="vv-twin-measure-actions">
          {onPickAtCentre !== undefined && (
            <button
              type="button"
              className="vv-twin-measure-button"
              onClick={onPickAtCentre}
              data-testid="twin-measure-centre-pick"
            >
              {MEASURE_CENTRE_PICK_LABEL}
            </button>
          )}
          {canClear && (
            <button
              type="button"
              className="vv-twin-measure-button vv-twin-measure-button--quiet"
              onClick={() => {
                // Narrowed by the `canClear` alias, same as the Escape path.
                onClear();
              }}
              data-testid="twin-measure-clear"
            >
              {MEASURE_CLEAR_LABEL}
            </button>
          )}
          <button
            type="button"
            className="vv-twin-measure-button vv-twin-measure-button--quiet"
            onClick={onDismiss}
            data-testid="twin-measure-done"
          >
            {MEASURE_DONE_LABEL}
          </button>
        </div>
      </div>
    </div>
  );
}
