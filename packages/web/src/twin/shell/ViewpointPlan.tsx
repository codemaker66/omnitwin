import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
} from "react";
import type { TwinScanNode } from "@omnitwin/types";
import { TWIN_MINIMAP_NORTH } from "../twin-copy.js";
import {
  chooseScaleBarM,
  fitPlanViewBox,
  formatPolygonPoints,
  formatViewBox,
  minimumNodeSpacingM,
  nearestPlanNode,
  nearestPlanNodeInDirection,
  planPointFromClient,
  toPlanNodes,
  viewConePolygon,
  type PlanNode,
  type PlanPoint,
} from "./minimap-geometry.js";
import "./viewpoint-plan.css";

// -----------------------------------------------------------------------------
// ViewpointPlan — the overhead read of where the scanner actually stood.
//
// The design study's plan was hand-drawn: dots scattered by eye, stamped
// "SCHEMATIC" because that was the honest label for them. It did not have to be
// that way. Every node in the manifest carries a surveyed pose, so this panel
// throws the ornament away and plots the survey: each mark is `node.pose.t`
// projected by shell/minimap-geometry, every coordinate is metres, and the scale
// bar is derived from the drawing's own extent. Nothing here is placed by eye,
// so nothing here can be wrong by eye either — it is wrong by test or not at all.
//
// FOUR DECISIONS THAT LOOK LIKE DETAIL AND ARE NOT:
//
// 1. ONE STOREY, AND ONLY IF IT IS KNOWN. The plan draws the nodes whose
//    `node.floor` matches the standing viewpoint's, and draws NOTHING when the
//    standing viewpoint is not in the bundle. Picking a storey to show when
//    nobody knows which storey the visitor is on is the same class of invention
//    as picking a room name (shell/twin-rooms.ts) — a plan of the wrong floor is
//    not a partial answer, it is a confident wrong one. FloorConstellation takes
//    the identical line for the identical reason.
//
// 2. ONE TAB STOP, NOT 149. Every mark carries role="button", a keyboard path
//    and a focus ring — a clickable circle without a keyboard is simply a
//    control some visitors do not have. But 149 individually tabbable marks is
//    a tab trap with a map in it: reaching the content after the plan would
//    take 149 presses. So the marks share one roving tabindex (the WAI-ARIA
//    pattern): Tab lands on where you are standing, arrows move between
//    viewpoints in SCREEN directions, Home/End reach the ends, Enter or Space
//    travels.
//
// 3. EVERY CLICK RESOLVES BY DISTANCE, NEVER BY PAINT ORDER. Two mechanisms,
//    and the first one was wrong in review, so it is written out plainly.
//
//    The marks carry invisible hit discs. A disc expressed purely as a fraction
//    of the viewBox is fine on a four-node room and WRONG at shipped density:
//    at 149 nodes the fitted box is wide enough that HIT_FRACTION alone puts
//    adjacent discs on top of each other, and a click in the overlap goes to
//    whichever mark SVG painted last — DOM order, not distance. The nearest-
//    viewpoint design would then be defeated by its own hit targets. So the
//    radius is CLAMPED to half the minimum node spacing (`minimumNodeSpacingM`),
//    which makes disjointness a property of the drawing rather than a hope:
//    every point inside a disc is provably nearest to that disc's own node.
//    The clamp is pinned by a test at 149 nodes, not at a sparse fixture.
//
//    Disjoint discs necessarily leave gaps, so the plan's floor is itself a
//    click target that resolves to the genuinely nearest viewpoint
//    (`nearestPlanNode`). Past PLAN_CLICK_TOLERANCE_M it resolves to nothing,
//    so a click out on the empty margin does not fling the visitor across the
//    hall. Between them the two mechanisms cover the whole drawing, and both
//    answer the same question the same way: which viewpoint is closest.
//
// 4. THE MARKS DO NOT RE-RENDER WHEN THE VIEW TURNS. Yaw changes on every frame
//    of a look-drag. The mark layer is memoised behind ref-latched callbacks so
//    a yaw change reconciles the cone polygon alone; the 149 groups are built
//    when the storey changes and not again.
//
//    The memo is EXPORTED for the same reason the numbers below are measured:
//    a memo is invisible from the DOM. React reuses keyed host nodes whether or
//    not the component above them re-ran, so "the marks' DOM nodes are
//    identical after a yaw change" passes with `memo` deleted — it pins the
//    absence of a remount, which is worth pinning but is NOT this guarantee.
//    The suite therefore observes the render itself, through the one prop the
//    mark layer reads during render (`viewpointById.get`): if PlanMarks runs,
//    that map is read once per mark, and if it is skipped the map is not
//    touched at all. Both halves are covered — the memo boundary directly, and
//    the referential stability of the props this component feeds it — because
//    a memo handed a fresh callback every frame is decoration.
//
// MEASURED at the shipped 149-node count (Trades Hall), not estimated. Two
// halves, because "render cost" is two different questions:
//
//   REACT RECONCILIATION — happy-dom under vitest, 614 elements: mount 31.0 ms
//   median of 7 (27.1 ms best); a yaw-only update 0.392 ms median of 40; a
//   storey move, which legitimately rebuilds all 149 marks, 14.0 ms median of
//   40. The 36× gap between the last two is the memo earning its keep, and the
//   test "skips the mark layer entirely when only the yaw changes" pins it by
//   COUNTING the marks rendered rather than by a timing threshold that would
//   flake in CI. Mutation-checked both ways: stripping `memo` makes that count
//   149, and so does handing PlanMarks one inline callback.
//
//   THE BROWSER — headless Chromium at 1440×900, driving this component's own
//   renderToStaticMarkup output (620 elements, 149 marks) under the shipped
//   stylesheet: inserting and laying out the entire panel 3.34 ms; a forced
//   style-recalc + layout of the whole subtree 0.019 ms; rewriting the cone's
//   points plus forced layout 0.017 ms; document.elementFromPoint over the
//   dense drawing 0.011 ms. Driving the cone from requestAnimationFrame for
//   three seconds held 181 frames in 3013 ms — a clean 60 fps, vsync-bound
//   rather than work-bound.
//
//   That run measured a 322 × 215 CSS-px panel, which was the slot BEFORE
//   review rejected it for covering the utility rail; PLAN_SLOT is 222 × 148
//   now. The figures are therefore an UPPER BOUND rather than a fresh reading —
//   same element count, fewer pixels to lay out and paint — and they are left
//   labelled as such instead of being quietly restated against a panel nobody
//   measured. A re-measure is only worth doing if the verdict were close, and
//   at a sixtieth of a frame it is not.
//
//   VERDICT: NO VIRTUALISATION at this count, and it is not close. The
//   per-frame path costs a sixtieth of a 16.7 ms frame, the one-off insert a
//   fifth of one, and hit testing is free. Windowing would add scroll state,
//   contradict the roving tabindex's assumption that every mark exists, break
//   Home/End, and buy nothing measurable. The element budget is pinned by a
//   test instead, so if a mark ever grows a fifth child the question is
//   re-argued deliberately rather than discovered on someone's phone.
//
// There is no JS-driven motion here, so nothing reads prefers-reduced-motion:
// the only animation is the panel's entrance, which is CSS and is switched off
// in the stylesheet's reduced-motion block. The CONE is deliberately never
// gated, and carries no transition of its own in the stylesheet either — it
// is a live readout of where the camera points, not decoration, and freezing it
// would leave the plan quietly disagreeing with the view (the lesson from the
// spotlight-reveal regression).
// -----------------------------------------------------------------------------

/** Group name for the plan — announced before the marks inside it, so each
 *  mark's own label can stay as short as "Go to viewpoint 12". */
export const TWIN_PLAN_GROUP_LABEL = "Viewpoints on this floor";

/**
 * A mark's accessible name. It names the 1-based VIEWPOINT, never the raw scan
 * id: twin-copy records the standing rule that "scan_035" reads like a debug
 * tag at a guest. The numeral is the only variable part, and a decimal integer
 * can carry no claim — which is why the sweep list below pins the template
 * rather than enumerating 149 sentences.
 */
export function twinPlanMarkLabel(viewpoint: number): string {
  return `Go to viewpoint ${String(viewpoint)}`;
}

/** The scale bar's caption. Locale-free for the same reason twin-rooms' metres()
 *  is: a plan is not 5,4 m across in one market and 5.4 m in another. */
export function twinPlanScaleLabel(lengthM: number): string {
  return `${String(lengthM)} m`;
}

/**
 * Every user-visible string this panel can render, for the copy-claim sweep in
 * shell/__tests__/shell-copy-claims.test.ts — the same contract as
 * allQuickActionCopy() and allRoomDossierCopy(), and swept in this panel's own
 * suite too, so the guarantee does not depend on a list living elsewhere.
 *
 * The two parameterised lines are sampled rather than enumerated because their
 * only variable is a number. The panel's own test proves it renders nothing but
 * these templates, so a sample is a complete sweep rather than a partial one.
 */
export function allViewpointPlanCopy(): readonly string[] {
  return [
    TWIN_PLAN_GROUP_LABEL,
    TWIN_MINIMAP_NORTH,
    twinPlanMarkLabel(1),
    twinPlanMarkLabel(149),
    twinPlanScaleLabel(5),
  ];
}

/**
 * The plan's own width/height. The stylesheet pins the panel to the SAME ratio,
 * so the drawing fills its frame with no letterboxing and one metre of x is
 * exactly one metre of y on screen.
 *
 * The two cannot drift: viewpoint-plan.css spells the rule as
 * `aspect-ratio: 1.5;` — a bare number, which is what `String(PLAN_ASPECT)`
 * produces — and this panel's suite asserts the stylesheet contains exactly
 * `aspect-ratio: ${String(PLAN_ASPECT)};`. Change this constant without
 * changing the stylesheet and the test fails on the next run.
 */
export const PLAN_ASPECT = 3 / 2;

/**
 * WHERE THE PANEL GOES, and why it is a constant rather than a CSS detail.
 *
 * The first attempt at this panel took `top: 150px; right: 18px` — which sits
 * directly on top of `.vv-twin-controls` (Share, Fullscreen, Enquire) and
 * disabled three shipped controls. A HUD panel that breaks working controls is
 * strictly worse than no panel, and the failure was invisible because nothing
 * in a happy-dom suite lays anything out. So the slot is stated here as
 * numbers, the stylesheet is written to match, and the suite proves the
 * resulting rectangle is disjoint from every other HUD rect at the viewport
 * sizes this actually ships at. See __tests__/ViewpointPlan.test.tsx, "the HUD
 * slot", for the enumeration and the proof.
 *
 * THE SLOT is the right-hand column, in the band between the bottom of the
 * utility rail and the top of the minimap — the one part of that column no
 * shipped element claims. It is the right column and not the left because the
 * left is the dossier's from `top: 62px` down to its `max-height` cap.
 *
 * ON A NARROW VIEWPORT THE BAND CLOSES, and the panel does not render. That is
 * arithmetic, not a shrug: `.vv-twin-dossier` takes `min(320px, 100vw - 130px)`
 * at a 12px inset, so its right edge parks at 332px above 450px wide and sits at
 * `100vw - 118px` below that, while this panel's left edge is `100vw - 240px`.
 * The two meet at 572px and first clear each other by 12px at 584px. The floor
 * is set higher than the bare crossing on purpose — the dossier is another
 * lane's panel and may grow — and below it the minimap, which already carries
 * node positions and the view cone, is the phone's plan. Wanting a real plan on
 * a phone means making the dossier and the plan mutually exclusive, or moving
 * one of them: a layout decision the PARENT owns, which this lane must not take
 * unilaterally by quietly overlapping another panel's card.
 */
export const PLAN_SLOT = {
  /** Clear of `.vv-twin-controls`, which ends at 106 + 131 = 237 CSS px. */
  topPx: 250,
  /** The right column's shared inset — mode, surface, rail and minimap all 18. */
  rightPx: 18,
  /** The minimap's outer width, so the right column reads as ONE column. */
  widthPx: 222,
  /** Floor reserved beneath the panel: the minimap's worst-case height (295)
   *  plus its 18px inset plus a 12px gap. */
  bottomReservePx: 325,
  /** Below this the dossier and the plan run out of gutter — see above. The
   *  bare crossing is at 572px; this keeps ~49px of headroom. */
  minViewportWidthPx: 621,
  /** Below this the band between the rail and the minimap (100dvh − 575) leaves
   *  the map under ~126px tall, which is a sliver holding a tab stop. */
  minViewportHeightPx: 701,
} as const;

/** Breathing room around the outermost viewpoint, in plan metres. Roughly one
 *  scan spacing, so an edge mark never sits on the frame. */
export const PLAN_MARGIN_M = 1.5;

/** How far the view cone reaches, in plan metres — far enough to read as a
 *  heading, short enough not to imply a sight line through a wall the plan does
 *  not draw. The twin has no wall geometry here to occlude against, so a cone
 *  spanning the whole hall would claim a view it cannot verify. */
export const PLAN_CONE_RADIUS_M = 4;

/**
 * Cone spread used until the host wires the real camera.
 *
 * This is the walk's RESTING VERTICAL fov (TwinViewer seeds `fovDeg: 75` and
 * settles travel flights to 75). Read as a horizontal spread it under-states
 * what the visitor can see on any landscape viewport — deliberately, because
 * the two errors are not symmetric: a cone narrower than the view understates,
 * while a wider one claims the visitor can see what they cannot. A host that can
 * measure its viewport should pass `fovRad={horizontalFovRad(camera.fov,
 * aspect)}` and get the true spread.
 */
export const PLAN_DEFAULT_FOV_RAD = (75 * Math.PI) / 180;

/** How far from a viewpoint a floor click still counts, in plan metres. Scans
 *  sit ~1.5 m apart, so this forgives any click inside the building while a
 *  click out on the margin resolves to nothing at all. */
export const PLAN_CLICK_TOLERANCE_M = 5;

/**
 * Mark radii as a FRACTION of the plan's width, not a fixed number of metres.
 *
 * A radius in metres shrinks on screen exactly when the capture gets bigger —
 * the 149-node hall would draw dots half the size of a four-node room's, for no
 * reason a reader could name. Expressed as a fraction of the viewBox they hold
 * a constant on-screen size at any extent.
 */
const DOT_FRACTION = 0.011;
const CURRENT_DOT_FRACTION = 0.018;
const FOCUS_RING_FRACTION = 0.03;

/**
 * The invisible hit disc's radius, as a fraction of the viewBox — and a CEILING
 * rather than the answer.
 *
 * On a sparse capture this is the binding constraint and gives a comfortable
 * target. At shipped density it is not: the fitted box grows with the capture
 * while the scans stay ~1.5 m apart, so this fraction alone puts neighbouring
 * discs on top of one another and hands an ambiguous click to paint order. The
 * radius actually drawn is `min(width × HIT_FRACTION, spacing / 2)` — see
 * `minimumNodeSpacingM`, and the test that pins non-overlap at 149 nodes.
 */
const HIT_FRACTION = 0.038;

/** Scale-bar furniture, also as fractions of the box (see above). */
const SCALE_INSET_X_FRACTION = 0.05;
const SCALE_INSET_Y_FRACTION = 0.05;
const SCALE_TICK_FRACTION = 0.018;
const SCALE_TEXT_FRACTION = 0.042;
/** Padding inside the scale's backing plate. */
const SCALE_PAD_FRACTION = 0.012;
/** The bar is at most a third of the plan wide — long enough to measure by,
 *  short enough not to read as a feature of the building. */
const SCALE_SPAN_FRACTION = 1 / 3;

/** Screen direction per arrow key (plan y grows downward, as SVG y does). */
const ARROW_DIRECTIONS: Readonly<Record<string, PlanPoint>> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
};

export interface ViewpointPlanProps {
  /** Every node in the bundle. The panel picks the storey itself. */
  readonly nodes: readonly TwinScanNode[];
  /** The viewpoint underfoot — chooses the storey and carries the cone. */
  readonly currentId: string;
  /** Live camera yaw in three-space YXZ radians (WalkControls' `state.yaw`). */
  readonly yaw: number;
  /** HORIZONTAL field of view in radians. Omit and the cone falls back to
   *  PLAN_DEFAULT_FOV_RAD; see `horizontalFovRad` for the real value. */
  readonly fovRad?: number;
  /** Travel request — the host wires this to hopTo(id, { teleport: true }). */
  readonly onSelect: (nodeId: string) => void;
}

export interface PlanMarksProps {
  readonly nodes: readonly PlanNode[];
  readonly viewpointById: ReadonlyMap<string, number>;
  readonly currentId: string;
  readonly rovingId: string;
  readonly dotR: number;
  readonly currentR: number;
  readonly focusR: number;
  readonly hitR: number;
  readonly onActivate: (id: string) => void;
  readonly onMarkKeyDown: (event: KeyboardEvent<SVGGElement>, id: string) => void;
  readonly registerMark: (id: string, element: SVGGElement | null) => void;
}

/**
 * The mark layer, memoised.
 *
 * Every prop here is either derived from the node list (recomputed only when the
 * storey changes) or a ref-latched callback, so the common case — the visitor
 * turning on the spot, yaw changing every frame — leaves this component's props
 * referentially identical and React skips all 149 subtrees.
 */
export const PlanMarks = memo(function PlanMarks({
  nodes,
  viewpointById,
  currentId,
  rovingId,
  dotR,
  currentR,
  focusR,
  hitR,
  onActivate,
  onMarkKeyDown,
  registerMark,
}: PlanMarksProps): ReactElement {
  return (
    <g className="vv-twin-plan-marks">
      {nodes.map((node) => {
        const isCurrent = node.id === currentId;
        return (
          <g
            key={node.id}
            ref={(element) => {
              registerMark(node.id, element);
            }}
            className={
              isCurrent
                ? "vv-twin-plan-mark vv-twin-plan-mark--current"
                : "vv-twin-plan-mark"
            }
            role="button"
            aria-label={twinPlanMarkLabel(viewpointById.get(node.id) ?? 0)}
            aria-current={isCurrent ? "location" : undefined}
            tabIndex={node.id === rovingId ? 0 : -1}
            onClick={() => {
              onActivate(node.id);
            }}
            onKeyDown={(event) => {
              onMarkKeyDown(event, node.id);
            }}
          >
            {/* The focus ring is its own element rather than an `outline`: SVG
                outline support is uneven, and a ring drawn in user units with a
                non-scaling stroke is legible at every plan extent. It is always
                present and revealed by :focus-visible in the stylesheet, so the
                ring cannot be lost to a re-render mid-keyboard-walk. */}
            <circle
              className="vv-twin-plan-focus"
              cx={node.point.x}
              cy={node.point.y}
              r={focusR}
              fill="none"
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
            <circle
              className="vv-twin-plan-dot"
              cx={node.point.x}
              cy={node.point.y}
              r={isCurrent ? currentR : dotR}
              pointerEvents="none"
            />
            {/* A forgiving, invisible target. `hitR` arrives already clamped to
                half the minimum node spacing, so no two of these discs can
                overlap and the disc a click lands in is provably the nearest
                node to that click. The gaps between them fall through to the
                floor, which resolves by distance. */}
            <circle
              className="vv-twin-plan-hit"
              cx={node.point.x}
              cy={node.point.y}
              r={hitR}
              fill="transparent"
            />
          </g>
        );
      })}
    </g>
  );
});

export function ViewpointPlan({
  nodes,
  currentId,
  yaw,
  fovRad,
  onSelect,
}: ViewpointPlanProps): ReactElement | null {
  const gradientId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const markRefs = useRef(new Map<string, SVGGElement>());

  const currentNode = nodes.find((node) => node.id === currentId);
  const floor = currentNode?.floor;

  // The storey, resolved once. `floor` is undefined for an unknown viewpoint,
  // which yields an empty list and — below — no panel at all.
  const planNodes = useMemo(
    () => (floor === undefined ? [] : toPlanNodes(nodes.filter((node) => node.floor === floor))),
    [nodes, floor],
  );
  const viewpointById = useMemo(() => {
    const map = new Map<string, number>();
    for (const node of nodes) {
      map.set(node.id, node.index + 1);
    }
    return map;
  }, [nodes]);

  const box = useMemo(
    () =>
      fitPlanViewBox(
        planNodes.map((node) => node.point),
        { marginM: PLAN_MARGIN_M, aspect: PLAN_ASPECT },
      ),
    [planNodes],
  );

  /**
   * The hit disc's radius in plan metres: the fraction of the box, clamped so
   * two discs can never overlap.
   *
   * Computed here rather than inside PlanMarks so it stays a plain number prop
   * — a value that changes only when the storey does, which is what keeps the
   * memo below able to skip a yaw-only update.
   */
  const hitR = useMemo(() => {
    const spacingM = minimumNodeSpacingM(planNodes);
    const ceiling = box.width * HIT_FRACTION;
    return Number.isFinite(spacingM) ? Math.min(ceiling, spacingM / 2) : ceiling;
  }, [planNodes, box.width]);

  // Ref latches: the host's callback and the current node list are read through
  // refs so the handlers below can be created once. Without this every yaw tick
  // would hand PlanMarks new function identities and re-render all 149 marks.
  const onSelectRef = useRef(onSelect);
  const planNodesRef = useRef(planNodes);
  const boxRef = useRef(box);
  useEffect(() => {
    onSelectRef.current = onSelect;
    planNodesRef.current = planNodes;
    boxRef.current = box;
  });

  const [rovingId, setRovingId] = useState(currentId);
  // The roving stop follows the walk: arriving somewhere new re-anchors it, so
  // a visitor who tabs in after travelling starts from where they stand.
  useEffect(() => {
    setRovingId(currentId);
  }, [currentId]);

  const registerMark = useCallback((id: string, element: SVGGElement | null) => {
    if (element === null) {
      markRefs.current.delete(id);
    } else {
      markRefs.current.set(id, element);
    }
  }, []);

  const onActivate = useCallback((id: string) => {
    onSelectRef.current(id);
  }, []);

  const moveRoving = useCallback((id: string) => {
    setRovingId(id);
    // Focus follows the roving stop, or the visitor's caret and the highlight
    // would part company after one arrow press.
    markRefs.current.get(id)?.focus();
  }, []);

  const onMarkKeyDown = useCallback(
    (event: KeyboardEvent<SVGGElement>, id: string) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSelectRef.current(id);
        return;
      }
      const list = planNodesRef.current;
      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        const target = event.key === "Home" ? list[0] : list[list.length - 1];
        if (target !== undefined) {
          moveRoving(target.id);
        }
        return;
      }
      const direction = ARROW_DIRECTIONS[event.key];
      if (direction === undefined) {
        return;
      }
      event.preventDefault();
      const hit = nearestPlanNodeInDirection(list, id, direction);
      if (hit !== null) {
        moveRoving(hit.id);
      }
    },
    [moveRoving],
  );

  const onFloorClick = useCallback((event: MouseEvent<SVGRectElement>) => {
    const svg = svgRef.current;
    if (svg === null) {
      return;
    }
    const point = planPointFromClient(
      svg.getBoundingClientRect(),
      boxRef.current,
      event.clientX,
      event.clientY,
    );
    if (point === null) {
      return;
    }
    const hit = nearestPlanNode(planNodesRef.current, point, {
      maxDistanceM: PLAN_CLICK_TOLERANCE_M,
    });
    if (hit !== null) {
      onSelectRef.current(hit.id);
    }
  }, []);

  // No storey means no plan. Every hook ran first, so this early return is safe.
  if (currentNode === undefined || planNodes.length === 0) {
    return null;
  }

  const current = planNodes.find((node) => node.id === currentId);
  const cone =
    current === undefined
      ? []
      : viewConePolygon({
          origin: current.point,
          yaw,
          fovRad: fovRad ?? PLAN_DEFAULT_FOV_RAD,
          radiusM: PLAN_CONE_RADIUS_M,
        });

  const scaleBarM = chooseScaleBarM(box.width * SCALE_SPAN_FRACTION);
  const scaleX1 = box.x + box.width * SCALE_INSET_X_FRACTION;
  const scaleY = box.y + box.height * (1 - SCALE_INSET_Y_FRACTION);
  const scaleTick = box.height * SCALE_TICK_FRACTION;
  const scaleFont = box.height * SCALE_TEXT_FRACTION;
  const scalePad = box.width * SCALE_PAD_FRACTION;

  return (
    <div className="vv-twin-plan" data-testid="twin-viewpoint-plan">
      <svg
        ref={svgRef}
        className="vv-twin-plan-map"
        viewBox={formatViewBox(box)}
        preserveAspectRatio="xMidYMid meet"
        role="group"
        aria-label={TWIN_PLAN_GROUP_LABEL}
      >
        {/* The floor: the plan's ground tone AND the coarse travel target. It is
            drawn first so every mark sits above it and takes its own clicks. */}
        <rect
          className="vv-twin-plan-floor"
          x={box.x}
          y={box.y}
          width={box.width}
          height={box.height}
          onClick={onFloorClick}
          aria-hidden
        />

        <g className="vv-twin-plan-cone-layer" aria-hidden>
          <defs>
            {/* Centred on the standing viewpoint so the gradient cannot shear as
                the wedge turns — the trick TwinMinimap's cone already uses. */}
            <radialGradient
              id={gradientId}
              gradientUnits="userSpaceOnUse"
              cx={current?.point.x ?? 0}
              cy={current?.point.y ?? 0}
              r={PLAN_CONE_RADIUS_M}
            >
              {/* The colour is set in the stylesheet, not with a stopColor
                  presentation attribute holding a var(). Custom-property
                  substitution inside SVG presentation attributes is not
                  dependable outside Chromium, and when it fails the value is
                  INVALID rather than falling back — a black cone, not a gold
                  one. `stop-color` declared in a real CSS rule substitutes
                  everywhere. Opacity stays inline: it differs per stop and is
                  a plain number, so it carries no such risk. */}
              <stop className="vv-twin-plan-cone-stop" offset="0%" stopOpacity={0.55} />
              <stop className="vv-twin-plan-cone-stop" offset="55%" stopOpacity={0.3} />
              <stop className="vv-twin-plan-cone-stop" offset="100%" stopOpacity={0} />
            </radialGradient>
          </defs>
          {cone.length > 0 && (
            <polygon
              className="vv-twin-plan-cone"
              points={formatPolygonPoints(cone)}
              fill={`url(#${gradientId})`}
            />
          )}
        </g>

        {/* The scale. A plan without one is a diagram: this is the only figure
            here a reader can measure against, and it is derived from the
            drawing's own extent, never from a published venue dimension.

            It carries a backing plate for the same reason a paper map's does.
            The bar sits at a fixed corner while the marks land wherever the
            survey put them, so sooner or later a viewpoint lands across it —
            observed, not imagined: at 149 nodes on a 1.5 m grid the standing
            mark sits squarely on the bar. An unreadable scale is worse than no
            scale, because it still looks like a measurement.

            It is drawn BEFORE the marks, and that ordering is the whole
            resolution of the conflict. Plate over marks made the scale legible
            by hiding a viewpoint — trading an interactive control for a static
            caption, which is the wrong way round. Beneath them, the plate still
            lifts the bar off the grid, while a mark that lands on it stays
            visible, focusable and clickable; an 11 px dot costs a 110 px label
            almost nothing. */}
        <g className="vv-twin-plan-scale" aria-hidden>
          <rect
            className="vv-twin-plan-scale-plate"
            x={scaleX1 - scalePad}
            y={scaleY - scaleTick * 1.6 - scaleFont - scalePad}
            width={scaleBarM + scalePad * 2}
            height={scaleTick * 1.6 + scaleFont + scalePad * 2}
            rx={scalePad}
          />
          <line
            className="vv-twin-plan-scale-bar"
            x1={scaleX1}
            y1={scaleY}
            x2={scaleX1 + scaleBarM}
            y2={scaleY}
            vectorEffect="non-scaling-stroke"
          />
          <line
            className="vv-twin-plan-scale-tick"
            x1={scaleX1}
            y1={scaleY - scaleTick}
            x2={scaleX1}
            y2={scaleY}
            vectorEffect="non-scaling-stroke"
          />
          <line
            className="vv-twin-plan-scale-tick"
            x1={scaleX1 + scaleBarM}
            y1={scaleY - scaleTick}
            x2={scaleX1 + scaleBarM}
            y2={scaleY}
            vectorEffect="non-scaling-stroke"
          />
          <text
            className="vv-twin-plan-scale-label"
            x={scaleX1}
            y={scaleY - scaleTick * 1.6}
            fontSize={scaleFont}
          >
            {twinPlanScaleLabel(scaleBarM)}
          </text>
        </g>

        <PlanMarks
          nodes={planNodes}
          viewpointById={viewpointById}
          currentId={currentId}
          rovingId={rovingId}
          dotR={box.width * DOT_FRACTION}
          currentR={box.width * CURRENT_DOT_FRACTION}
          focusR={box.width * FOCUS_RING_FRACTION}
          hitR={hitR}
          onActivate={onActivate}
          onMarkKeyDown={onMarkKeyDown}
          registerMark={registerMark}
        />
      </svg>

      {/* Screen-up is E57 +Y is north — the fixed reference the cone turns
          against. HTML rather than SVG text so it holds one size at any extent,
          and it reuses TWIN_MINIMAP_NORTH so the two maps cannot disagree. */}
      <span className="vv-twin-plan-north" aria-hidden>
        {TWIN_MINIMAP_NORTH}
      </span>
    </div>
  );
}
