import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";
import { useCockpitStore } from "../../../stores/cockpit-store.js";
import { useLayoutTimelinePreviewStore } from "../../../stores/layout-timeline-preview-store.js";
import { COCKPIT_MODES, type CockpitMode } from "../../../lib/cockpit-modes.js";
import { isSpringSettled, stepSpring, type SpringState } from "../../../lib/springs.js";
import { prefersReducedMotion } from "../../../lib/reduced-motion.js";
import { useEscapeToClose, useFocusTrap } from "../../../lib/use-focus-trap.js";
import { panelForMode } from "./CockpitRightDock.js";
import {
  LENS_SHEET_EXIT_MARGIN_PX,
  LENS_SHEET_SPRING,
  lensSheetDragOffset,
  lensSheetScrimOpacity,
  resolveLensSheetRelease,
} from "./lens-sheet-motion.js";
import "./LensSheet.css";

// ---------------------------------------------------------------------------
// LensSheet — the planner's lenses on phones and tablets.
//
// The desktop cockpit shows a lens in its right dock. Touch and narrow screens
// have no right dock, so choosing Guests, Costs or any other lens from "More"
// used to set the lens and show nothing: a visitor at 375 px never reached the
// published capacities or "Ask us for a quote". Here the same registered panel
// (CockpitRightDock's LENS_PANELS) rises as a bottom sheet instead.
//
// The sheet IS the lens on these screens: it is open exactly while a lens with
// a panel is active, and closing it (Close, Escape, the scrim, or a swipe down)
// returns the planner to Design. There is no hidden lens state to get lost in.
//
// It is a modal dialog: focus moves into it and back to the opener ("More")
// when it closes, Tab stays inside, and the scene behind is dimmed rather than
// covered. Motion runs on the shared spring core; the finger is followed 1:1
// even under reduced motion, while the spring itself becomes a snap.
// ---------------------------------------------------------------------------

/** Elements that keep their own pointer behaviour inside a drag zone. */
const INTERACTIVE_SELECTOR = "button, a[href], input, select, textarea, summary, label, [role='button'], [contenteditable='true']";
/** Where a drag may start: the handle row and the lens panel's own header. */
const DRAG_ZONE_SELECTOR = ".lens-sheet__grab, .lens-panel__head";
/** A release this long after the last movement carries no flick. */
const STALE_VELOCITY_MS = 100;
/** Pixel and px/s tolerance for calling the spring settled. */
const SETTLE_EPSILON = 0.5;

function lensSheetWanted(): boolean {
  return useLayoutTimelinePreviewStore.getState().mode === "inactive"
    && panelForMode(useCockpitStore.getState().activeMode) !== null;
}

function returnToDesign(): void {
  useCockpitStore.getState().setMode("design");
}

/**
 * Mount on touch and narrow layouts only (PlannerCockpit's `mobile`). The
 * sheet stays mounted through its exit so it can leave on the spring, then
 * unmounts. During a room timeline preview it stands aside, as the desktop
 * dock does, so no lens control can change the plan while history is shown.
 */
export function LensSheet(): ReactElement | null {
  const activeMode = useCockpitStore((state) => state.activeMode);
  const previewActive = useLayoutTimelinePreviewStore((state) => state.mode !== "inactive");
  const open = !previewActive && panelForMode(activeMode) !== null;
  const [shownMode, setShownMode] = useState<CockpitMode | null>(open ? activeMode : null);
  if (open && shownMode !== activeMode) setShownMode(activeMode);
  const handleExited = useCallback((): void => {
    if (!lensSheetWanted()) setShownMode(null);
  }, []);
  if (shownMode === null || typeof document === "undefined") return null;
  return createPortal(
    <LensSheetSurface mode={shownMode} open={open} onExited={handleExited} />,
    document.body,
  );
}

interface DragState {
  readonly pointerId: number;
  readonly startY: number;
  readonly startOffset: number;
  lastY: number;
  lastTime: number;
  velocity: number;
}

function LensSheetSurface({
  mode,
  open,
  onExited,
}: {
  readonly mode: CockpitMode;
  readonly open: boolean;
  readonly onExited: () => void;
}): ReactElement {
  const label = COCKPIT_MODES.find((lens) => lens.id === mode)?.label ?? "Lens";
  const Panel = panelForMode(mode);
  const sheetRef = useFocusTrap<HTMLDivElement>(open);
  const scrimRef = useRef<HTMLDivElement>(null);
  const motion = useRef<SpringState>({ value: 0, velocity: 0 });
  const target = useRef<"open" | "closed">("open");
  const frame = useRef<number | null>(null);
  const lastFrameTime = useRef<number | null>(null);
  const drag = useRef<DragState | null>(null);
  const placed = useRef(false);
  const exited = useRef(onExited);
  exited.current = onExited;

  useEscapeToClose(returnToDesign, open);

  /** Fully away: the sheet's own height plus room for its shadow. */
  const closedOffset = useCallback((): number => {
    const height = sheetRef.current?.offsetHeight ?? 0;
    return (height > 0 ? height : window.innerHeight) + LENS_SHEET_EXIT_MARGIN_PX;
  }, [sheetRef]);

  /** Writes the spring's position straight to the DOM; no React render per frame. */
  const paint = useCallback((): void => {
    const sheet = sheetRef.current;
    if (sheet === null) return;
    const offset = motion.current.value;
    sheet.style.transform = `translate3d(0, ${offset.toFixed(2)}px, 0)`;
    const scrim = scrimRef.current;
    if (scrim !== null) scrim.style.opacity = lensSheetScrimOpacity(offset, closedOffset()).toFixed(3);
  }, [closedOffset, sheetRef]);

  const stop = useCallback((): void => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    lastFrameTime.current = null;
  }, []);

  /** Puts the sheet at its target now, and hands back once it is away. */
  const settle = useCallback((): void => {
    const goal = target.current === "open" ? 0 : closedOffset();
    motion.current.value = goal;
    motion.current.velocity = 0;
    paint();
    if (target.current === "closed") exited.current();
  }, [closedOffset, paint]);

  const animate = useCallback((): void => {
    if (prefersReducedMotion() || typeof requestAnimationFrame !== "function") {
      stop();
      settle();
      return;
    }
    // A running loop reads the target every frame, so it simply retargets.
    if (frame.current !== null) return;
    lastFrameTime.current = null;
    const step = (now: number): void => {
      const dt = lastFrameTime.current === null ? 1 / 60 : Math.max(0, (now - lastFrameTime.current) / 1000);
      lastFrameTime.current = now;
      const goal = target.current === "open" ? 0 : closedOffset();
      stepSpring(motion.current, goal, dt, LENS_SHEET_SPRING);
      if (isSpringSettled(motion.current, goal, SETTLE_EPSILON)) {
        frame.current = null;
        lastFrameTime.current = null;
        settle();
        return;
      }
      paint();
      frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  }, [closedOffset, paint, settle, stop]);

  // Before the first paint the sheet waits below the screen, then rises; each
  // later change of `open` retargets the same spring from wherever it is, so a
  // released swipe keeps its speed into the exit.
  useLayoutEffect(() => {
    target.current = open ? "open" : "closed";
    drag.current = null;
    if (!placed.current) {
      placed.current = true;
      motion.current.value = closedOffset();
      motion.current.velocity = 0;
      paint();
    }
    animate();
  }, [animate, closedOffset, open, paint]);

  useEffect(() => stop, [stop]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!open || !event.isPrimary) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const origin = event.target;
    if (!(origin instanceof Element)) return;
    if (origin.closest(INTERACTIVE_SELECTOR) !== null) return;
    if (origin.closest(DRAG_ZONE_SELECTOR) === null) return;
    stop();
    drag.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startOffset: motion.current.value,
      lastY: event.clientY,
      lastTime: event.timeStamp,
      velocity: 0,
    };
    // Capture keeps the drag when the finger leaves the sheet's edge. It is a
    // refinement: a browser that refuses it still delivers the drag events.
    const sheet = event.currentTarget;
    try {
      sheet.setPointerCapture(event.pointerId);
    } catch {
      // The pointer is no longer active (released between events).
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const current = drag.current;
    if (current === null || current.pointerId !== event.pointerId) return;
    const elapsed = event.timeStamp - current.lastTime;
    if (elapsed > 0) {
      const instant = ((event.clientY - current.lastY) / elapsed) * 1000;
      current.velocity = current.velocity * 0.2 + instant * 0.8;
    }
    current.lastY = event.clientY;
    current.lastTime = event.timeStamp;
    motion.current.value = lensSheetDragOffset(current.startOffset + event.clientY - current.startY);
    motion.current.velocity = 0;
    paint();
  };

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean): void => {
    const current = drag.current;
    if (current === null || current.pointerId !== event.pointerId) return;
    drag.current = null;
    const velocity = event.timeStamp - current.lastTime > STALE_VELOCITY_MS ? 0 : current.velocity;
    motion.current.velocity = velocity;
    const release = cancelled
      ? "open"
      : resolveLensSheetRelease({
        offsetPx: motion.current.value,
        velocityPxPerS: velocity,
        sheetHeightPx: sheetRef.current?.offsetHeight ?? 0,
      });
    if (release === "close") {
      returnToDesign();
      return;
    }
    target.current = "open";
    animate();
  };

  // The sheet is modal: the planner's single-key shortcuts (F, D, V, undo)
  // must not act on the scene behind it. Escape and Tab are handled by the
  // document-level listeners above, which run first.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    event.stopPropagation();
  };

  return (
    <div className="lens-sheet-layer" data-testid="lens-sheet-layer" data-state={open ? "open" : "closing"}>
      <div
        ref={scrimRef}
        className="lens-sheet__scrim"
        data-testid="lens-sheet-scrim"
        aria-hidden="true"
        onClick={returnToDesign}
      />
      <div
        ref={sheetRef}
        className="lens-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        data-testid="lens-sheet"
        data-lens={mode}
        tabIndex={-1}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => { finishDrag(event, false); }}
        onPointerCancel={(event) => { finishDrag(event, true); }}
        onKeyDown={onKeyDown}
      >
        <div className="lens-sheet__grab" data-testid="lens-sheet-grab">
          <span className="lens-sheet__handle" aria-hidden="true" />
          <button
            type="button"
            className="lens-sheet__close"
            aria-label={`Close ${label}`}
            onClick={returnToDesign}
          >
            Close
          </button>
        </div>
        {Panel !== null ? <Panel /> : null}
      </div>
    </div>
  );
}
