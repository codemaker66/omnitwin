import { addAfterEffect } from "@react-three/fiber";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement, type ReactNode } from "react";
import { toRealWorld, toRenderSpace } from "../../constants/scale.js";
import { GRAND_HALL_WALL_NAMES, grandHallExits, type RoomSide } from "../../lib/auto-fill.js";
import { liveAisles, type AisleLine } from "../../lib/clearance-ring.js";
import { computeFluidFurnitureDragFrame } from "../../lib/furniture-drag.js";
import { wholeSelection } from "../../lib/placement-edit.js";
import { dragMovingIds, snapPositionToGrid, type PlacedItem } from "../../lib/placement.js";
import { plannerFeatureEnabled } from "../../lib/planner-features.js";
import { KEY_PRIORITY, letter, useEscapeLayer, usePlannerKeyBindings, type KeyBinding } from "../../lib/planner-keys.js";
import { arrowFloorDirection, moveSelectionTo, nudgeMetres, nudgeSelection, pasteAt } from "../../lib/planner-keymap.js";
import {
  DRAWING_SCREEN_UP,
  bestArea,
  drawingAreas,
  drawingSummary,
  drawnRoom,
  drawnUnits,
  fitView,
  panBy,
  piecesInBox,
  toFloor,
  toScreen,
  zoomAbout,
  type DrawingView,
  type DrawnPoint,
  type DrawnRoom,
  type DrawnUnit,
  type Rect,
} from "../../lib/plan-drawing-model.js";
import * as screenAnchors from "../../lib/screen-anchors.js";
import type { SnapGuide } from "../../lib/snap-guide.js";
import { SPRING_PRESETS } from "../../lib/springs.js";
import { createSpringDriver, type SpringDriver } from "../../lib/use-spring-value.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { usePlacementStore } from "../../stores/placement-store.js";
import { CHROME_GUTTER_PX, usePlannerChromeStore } from "../../stores/planner-chrome-store.js";
import { useRoomDimensionsStore } from "../../stores/room-dimensions-store.js";
import { useSelectionStore } from "../../stores/selection-store.js";
import { usePlanDrawingRules, usePlanDrawingShown, usePlanDrawingStore } from "./plan-drawing-mode.js";
import "./chrome.css";
import "./plan-drawing.css";

// ---------------------------------------------------------------------------
// Plan's Drawing (T-674; approved spec §6.3, §7.2, §7.4). Over the room, in
// place of the model, the layout set on paper: the register for what leaves
// the building. Ink lines on the sheet; the hall's walls, doors, windows and
// fireplace named as staff name them; each table drawn with its chairs and
// its own number; the selection in copper, with its aisles in the planner's
// bands where the planner measures them. Nothing else of v1's blueprint page
// comes with it: the dock, the caption and the keys do the work, as they do
// over the model.
//
// One layout, one selection, one undo. A tap selects (Shift or Ctrl adds), a
// drag on a piece moves it with its chairs as one undo step through the
// editor's own pointer gesture, a drag on the floor selects an area, and the
// keymap's commands (turn, duplicate, remove, seats, cloth) act unchanged.
// The arrows nudge by the page. Esc lets go of a drag in progress, putting
// the pieces back where they were. The camera under the paper never moves, so
// the model comes back exactly as it was left.
//
// The caption follows its piece on the paper: while the drawing shows, it
// projects the screen anchors itself, after any frame the hidden canvas draws
// (lane C's `holdScreenAnchors`, when it lands, makes this the canvas's own
// rule; see WIRING.md).
// ---------------------------------------------------------------------------

/** Pixels a press may travel and still be a tap. */
const TAP_SLOP_PX = 4;
/** Pixels between the paper's edge zones and the chrome. */
const ZONE_GAP_PX = 12;
/** The fade's longest run (`--house-motion-reveal`) and a frame's grace: then the paper is gone. */
const FADE_OUT_MS = 260;

interface ScreenAnchorHold {
  readonly project: (world: screenAnchors.WorldPoint) => screenAnchors.ScreenPoint;
  readonly pick: (x: number, y: number) => { readonly x: number; readonly z: number } | null;
  readonly frame: () => void;
}

/** Lane C's seam (WIRING.md, Drawing): while held, the canvas's projector stands aside and the floor under a pixel is the drawing's. */
function anchorHold(): ((hold: ScreenAnchorHold) => () => void) | null {
  const candidate: unknown = (screenAnchors as Readonly<Record<string, unknown>>)["holdScreenAnchors"];
  return typeof candidate === "function" ? (candidate as (hold: ScreenAnchorHold) => () => void) : null;
}

interface Stage {
  readonly width: number;
  readonly height: number;
  readonly free: Rect;
  readonly slate: Rect | null;
}

const NO_STAGE: Stage = { width: 0, height: 0, free: { left: 0, top: 0, right: 0, bottom: 0 }, slate: null };

/** The union of some elements' boxes, relative to `origin`; null when none is on screen. */
function boxOf(elements: readonly Element[], origin: DOMRect): Rect | null {
  let box: Rect | null = null;
  for (const element of elements) {
    const r = element.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const next = { left: r.left - origin.left, top: r.top - origin.top, right: r.right - origin.left, bottom: r.bottom - origin.top };
    box = box === null ? next : { left: Math.min(box.left, next.left), top: Math.min(box.top, next.top), right: Math.max(box.right, next.right), bottom: Math.max(box.bottom, next.bottom) };
  }
  return box;
}

/** Where the drawing may stand: the stage less its gutters, the switch above, the rail and dock below, any side panel, and the slate. */
function measureStage(root: HTMLElement): Stage {
  const origin = root.getBoundingClientRect();
  const width = origin.width;
  const height = origin.height;
  const offset = usePlannerChromeStore.getState().viewOffset(window.innerWidth);
  const top = boxOf([...document.querySelectorAll("[data-testid='planner-plan-switch']")], origin);
  const bottom = boxOf([...document.querySelectorAll("[data-testid='planner-rail'], [data-testid='planner-dock']")], origin);
  const slate = boxOf([...document.querySelectorAll("[data-pc-zone='slate'] > *")], origin);
  return {
    width,
    height,
    free: {
      left: CHROME_GUTTER_PX + offset.left,
      right: width - CHROME_GUTTER_PX - offset.right,
      top: Math.max(CHROME_GUTTER_PX, (top?.bottom ?? 0) + ZONE_GAP_PX),
      bottom: Math.min(height - CHROME_GUTTER_PX, (bottom?.top ?? height) - ZONE_GAP_PX),
    },
    slate,
  };
}

function sameStage(a: Stage, b: Stage): boolean {
  const near = (p: number, q: number): boolean => Math.abs(p - q) < 0.5;
  const sameRect = (r: Rect | null, s: Rect | null): boolean => (r === null || s === null ? r === s
    : near(r.left, s.left) && near(r.top, s.top) && near(r.right, s.right) && near(r.bottom, s.bottom));
  return near(a.width, b.width) && near(a.height, b.height) && sameRect(a.free, b.free) && sameRect(a.slate, b.slate);
}

function sameView(a: DrawingView, b: DrawingView): boolean {
  return Math.abs(a.scale - b.scale) < 1e-6 && Math.abs(a.originX - b.originX) < 0.01 && Math.abs(a.originY - b.originY) < 0.01;
}

function mix(a: DrawingView, b: DrawingView, t: number): DrawingView {
  return { scale: a.scale + (b.scale - a.scale) * t, originX: a.originX + (b.originX - a.originX) * t, originY: a.originY + (b.originY - a.originY) * t };
}

function n(value: number): string {
  return String(Math.round(value * 10) / 10);
}

function pathOf(points: readonly DrawnPoint[], view: DrawingView): string {
  return `${points.map((point, index) => {
    const at = toScreen(view, point);
    return `${index === 0 ? "M" : "L"}${n(at.x)} ${n(at.y)}`;
  }).join(" ")} Z`;
}

/** About how wide a run of Inter is at `size` px, for whether a label fits its piece. */
function textWidth(text: string, size: number): number {
  return text.length * size * 0.56;
}

// -- The gesture under the pointer -------------------------------------------

interface Press {
  readonly kind: "press";
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
  readonly pieceId: string | null;
  readonly additive: boolean;
  readonly button: number;
}

interface Carry {
  readonly kind: "move";
  readonly pointerId: number;
  readonly token: symbol;
  readonly primaryId: string;
  /** From the pointer's floor point to the primary piece's centre, render space. */
  readonly grab: { readonly x: number; readonly z: number };
  readonly moving: ReadonlySet<string>;
  /** Every moving piece as it was, to put back on Esc. */
  readonly before: ReadonlyMap<string, PlacedItem>;
}

interface Area {
  readonly kind: "box";
  readonly pointerId: number;
  readonly start: DrawnPoint;
  readonly additive: boolean;
  readonly before: readonly string[];
}

interface Pan {
  readonly kind: "pan";
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
}

interface Pinch {
  readonly kind: "pinch";
  readonly distance: number;
  readonly middle: { readonly x: number; readonly y: number };
  readonly view: DrawingView;
}

type Gesture = Press | Carry | Area | Pan | Pinch;

/** Holds a pointer to the paper for its whole gesture; one the browser has already let go of cannot be held, and the gesture still runs. */
function capture(element: Element | null, pointerId: number): void {
  try {
    element?.setPointerCapture(pointerId);
  } catch {
    // Nothing to hold: the browser has let go of this pointer.
  }
}

function release(element: Element | null, pointerId: number): void {
  try {
    if (element?.hasPointerCapture(pointerId) === true) element.releasePointerCapture(pointerId);
  } catch {
    // Already let go.
  }
}

/** The pieces a move carried, back exactly as they were, so the open gesture records nothing. */
function putBack(before: ReadonlyMap<string, PlacedItem>): void {
  usePlacementStore.setState({ placedItems: usePlacementStore.getState().placedItems.map((item) => before.get(item.id) ?? item) });
}

// -- The drawing --------------------------------------------------------------

export function PlanDrawing(): ReactElement | null {
  usePlanDrawingRules();
  const shown = usePlanDrawingShown();
  // Mounted while shown and while it fades out; nothing at all otherwise.
  const [present, setPresent] = useState(shown);
  useEffect(() => {
    if (shown) setPresent(true);
  }, [shown]);
  if (!present && !shown) return null;
  return <DrawingSheet shown={shown} onGone={() => { setPresent(false); }} />;
}

function DrawingSheet({ shown, onGone }: { readonly shown: boolean; readonly onGone: () => void }): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const hatchId = `pc-drawing-hatch-${useId().replace(/:/gu, "")}`;
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const goneRef = useRef(onGone);
  goneRef.current = onGone;

  const placedItems = usePlacementStore((state) => state.placedItems);
  const selectedIds = useSelectionStore((state) => state.selectedIds);
  const guides = useSelectionStore((state) => state.activeGuides);
  const dimensions = useRoomDimensionsStore((state) => state.dimensions);
  const grandHall = useEditorStore((state) => state.space?.slug === "grand-hall");
  const roomName = useEditorStore((state) => state.space?.name ?? null);
  const left = usePlannerChromeStore((state) => state.left);
  const right = usePlannerChromeStore((state) => state.right);
  const fitRequest = usePlanDrawingStore((state) => state.fitRequest);

  const room = useMemo(() => drawnRoom(dimensions, grandHall), [dimensions, grandHall]);
  const units = useMemo(() => drawnUnits(placedItems), [placedItems]);
  const selectedUnits = useMemo(() => {
    const keys = new Set<string>();
    for (const unit of units) if (unit.pieces.some((piece) => selectedIds.has(piece.id))) keys.add(unit.key);
    return keys;
  }, [units, selectedIds]);

  // -- Coming and going: a cross-fade, never a move (spec §8). --
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    if (!shown) {
      setEntered(false);
      const gone = window.setTimeout(() => { goneRef.current(); }, FADE_OUT_MS);
      return () => { window.clearTimeout(gone); };
    }
    const frame = window.requestAnimationFrame(() => { setEntered(true); });
    return () => { window.cancelAnimationFrame(frame); };
  }, [shown]);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root !== null) root.inert = !shown;
  }, [shown]);

  // -- Where the paper may draw, and the fit. --
  const [stage, setStage] = useState<Stage>(NO_STAGE);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root === null) return undefined;
    const update = (): void => {
      const next = measureStage(root);
      setStage((was) => (sameStage(was, next) ? was : next));
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(root);
    for (const element of document.querySelectorAll("[data-pc-zone='slate'], [data-pc-zone='top-centre'], [data-testid='planner-dock-stack']")) observer?.observe(element);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [left, right]);

  const fit = useMemo((): DrawingView | null => {
    if (stage.width === 0) return null;
    const area = bestArea(room, drawingAreas(stage.free, stage.slate, ZONE_GAP_PX));
    return area === null ? null : fitView(room, area);
  }, [room, stage]);
  const fitRef = useRef(fit);
  fitRef.current = fit;

  // The person's own zoom and pan; null is the fit. Fit, Plan chosen again, and a new fit all return to it.
  const [userView, setUserView] = useState<DrawingView | null>(null);
  useEffect(() => { setUserView(null); }, [fitRequest, fit]);
  const view = userView ?? fit;
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    usePlanDrawingStore.getState().setZoomed(userView !== null && fit !== null && userView.scale > fit.scale + 1e-6);
  }, [userView, fit]);
  useEffect(() => () => { usePlanDrawingStore.getState().setZoomed(false); }, []);

  // -- The caption follows its piece on the paper. --
  const floorAt = (x: number, y: number): { readonly x: number; readonly z: number } | null => {
    const now = viewRef.current;
    if (now === null) return null;
    const floor = toFloor(now, x, y);
    if (Math.abs(floor.x) > room.widthM / 2 || Math.abs(floor.z) > room.lengthM / 2) return null;
    return { x: toRenderSpace(floor.x), z: toRenderSpace(floor.z) };
  };
  const floorAtRef = useRef(floorAt);
  floorAtRef.current = floorAt;

  const project = (now: DrawingView, world: screenAnchors.WorldPoint): screenAnchors.ScreenPoint => {
    const at = toScreen(now, { x: toRealWorld(world[0]), z: toRealWorld(world[2]) });
    const width = rootRef.current?.clientWidth ?? 0;
    const height = rootRef.current?.clientHeight ?? 0;
    return { x: at.x, y: at.y, visible: at.x >= 0 && at.y >= 0 && at.x <= width && at.y <= height };
  };
  /** The view the paper shows this frame: a glide's own, while one runs. */
  const shownView = useRef<DrawingView | null>(null);
  const projectAnchors = (): void => {
    const now = shownView.current ?? viewRef.current;
    if (now === null || !shownRef.current || screenAnchors.screenAnchorCount() === 0) return;
    screenAnchors.projectScreenAnchors((world) => project(now, world));
  };
  const projectRef = useRef(projectAnchors);
  projectRef.current = projectAnchors;

  /** Projects on the next frame, after this commit's effects (the caption registers its anchor in one). */
  const projectSoon = useRef<() => void>(() => undefined);
  useEffect(() => {
    if (!shown) return undefined;
    let frame = 0;
    const soon = (): void => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => { projectRef.current(); });
    };
    projectSoon.current = soon;
    const hold = anchorHold();
    if (hold !== null) {
      const release = hold({
        project: (world) => {
          const now = shownView.current ?? viewRef.current;
          return now === null ? { x: 0, y: 0, visible: false } : project(now, world);
        },
        pick: (x, y) => floorAtRef.current(x, y),
        frame: soon,
      });
      soon();
      return () => {
        window.cancelAnimationFrame(frame);
        projectSoon.current = () => undefined;
        release();
      };
    }
    // Until that seam lands: the hidden canvas still projects when it draws a frame, so the paper projects again straight
    // after it in the same frame, and the caption's Move lands where the paper says.
    const stopAfter = addAfterEffect(() => { projectRef.current(); });
    const landMove = (event: MouseEvent): void => {
      const target = event.target;
      const root = rootRef.current;
      if (!(target instanceof Element) || root === null || target.closest("[data-testid='planner-caption-catcher']") === null) return;
      event.stopPropagation();
      event.preventDefault();
      const box = root.getBoundingClientRect();
      const at = floorAtRef.current(event.clientX - box.left, event.clientY - box.top);
      // Off the floor, or refused (the notice says why): still waiting for a tap on the floor.
      if (at !== null && moveSelectionTo(at)) soon();
    };
    window.addEventListener("click", landMove, true);
    soon();
    return () => {
      window.cancelAnimationFrame(frame);
      projectSoon.current = () => undefined;
      stopAfter();
      window.removeEventListener("click", landMove, true);
      // The model's own projector places the caption again on its next frame.
      screenAnchors.requestScreenAnchorFrame();
    };
  }, [shown]);
  // Every drawn frame places the caption at once, and once more after the effects of the same commit.
  useLayoutEffect(() => { projectRef.current(); });
  useEffect(() => { projectSoon.current(); });

  // A panel opening or closing makes room: the paper glides to its new fit on `dialGlide` (a direct set under reduced motion).
  const glide = useRef<SpringDriver | null>(null);
  const lastFit = useRef<DrawingView | null>(null);
  useLayoutEffect(() => {
    const svg = svgRef.current;
    const previous = shownView.current ?? lastFit.current;
    lastFit.current = fit;
    glide.current?.dispose();
    glide.current = null;
    shownView.current = null;
    if (svg !== null) svg.style.transform = "";
    if (svg === null || fit === null || previous === null || !shownRef.current || sameView(previous, fit)) return;
    const from = previous;
    const to = fit;
    const write = (t: number): void => {
      const now = mix(from, to, t);
      const k = now.scale / to.scale;
      const settled = Math.abs(1 - t) < 1e-3;
      svg.style.transform = settled ? "" : `translate(${n(now.originX - k * to.originX)}px, ${n(now.originY - k * to.originY)}px) scale(${String(k)})`;
      shownView.current = settled ? null : now;
      projectRef.current();
    };
    write(0);
    const driver = createSpringDriver({ initial: 0, config: SPRING_PRESETS.dialGlide, write, epsilon: 0.001 });
    glide.current = driver;
    driver.setTarget(1);
  }, [fit]);
  useEffect(() => () => { glide.current?.dispose(); }, []);

  /** A hand on the paper ends a glide where it is going: the drawing under the pointer is the one it will touch. */
  const settleGlide = (): void => {
    if (glide.current === null) return;
    glide.current.jump(1);
    glide.current.dispose();
    glide.current = null;
    shownView.current = null;
    if (svgRef.current !== null) svgRef.current.style.transform = "";
  };

  // -- Pointer: a tap, a drag, an area, a pan, a pinch, the wheel. --
  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const lastFloor = useRef<{ readonly x: number; readonly z: number } | null>(null);
  const [box, setBox] = useState<{ readonly a: DrawnPoint; readonly b: DrawnPoint } | null>(null);
  const [gestureKind, setGestureKind] = useState<Gesture["kind"] | null>(null);

  const local = (event: { readonly clientX: number; readonly clientY: number }): { x: number; y: number } => {
    const r = rootRef.current?.getBoundingClientRect();
    return { x: event.clientX - (r?.left ?? 0), y: event.clientY - (r?.top ?? 0) };
  };

  const begin = (next: Gesture | null): void => {
    gesture.current = next;
    setGestureKind(next?.kind ?? null);
  };

  /** Lets go of a move in progress: set down where it is (`keep`), or put back as it was. */
  const endMove = (keep: boolean): void => {
    const current = gesture.current;
    if (current?.kind !== "move") return;
    if (keep) {
      // Set down: the whole formation settles onto the grid by its primary's snap, as in the room.
      const placement = usePlacementStore.getState();
      const primary = placement.placedItems.find((item) => item.id === current.primaryId);
      if (placement.snapEnabled && primary !== undefined) {
        const snapped = snapPositionToGrid(primary.x, primary.z);
        const dx = snapped[0] - primary.x;
        const dz = snapped[2] - primary.z;
        if (dx !== 0 || dz !== 0) placement.moveItemsByDelta(current.moving, dx, dz);
      }
    } else {
      putBack(current.before);
    }
    useEditorStore.getState().endHistoryGesture(current.token);
    useSelectionStore.getState().setActiveGuides([]);
  };

  const cancelGesture = (): void => {
    const current = gesture.current;
    if (current?.kind === "move") endMove(false);
    if (current?.kind === "box") useSelectionStore.getState().selectMultiple(current.before);
    setBox(null);
    begin(null);
  };
  const cancelRef = useRef(cancelGesture);
  cancelRef.current = cancelGesture;

  // Esc lets go of a drag or an area in progress, one layer before the selection (spec §4.5).
  useEscapeLayer("operation", {
    open: () => gesture.current?.kind === "move" || gesture.current?.kind === "box",
    onEscape: () => { cancelRef.current(); },
  });
  useEffect(() => {
    if (!shown) cancelRef.current();
  }, [shown]);
  useEffect(() => () => { cancelRef.current(); }, []);

  const dragTo = (at: { x: number; y: number }): void => {
    const current = gesture.current;
    const now = viewRef.current;
    if (current?.kind !== "move" || now === null) return;
    if (!useEditorStore.getState().isHistoryGestureCurrent(current.token)) {
      // The layout changed under the hand (a save's new ids, a colleague's edit): let go where it is.
      useSelectionStore.getState().setActiveGuides([]);
      begin(null);
      return;
    }
    const placed = usePlacementStore.getState().placedItems;
    const primary = placed.find((item) => item.id === current.primaryId);
    if (primary === undefined) return;
    const floor = toFloor(now, at.x, at.y);
    const frame = computeFluidFurnitureDragFrame(primary, { x: toRenderSpace(floor.x), z: toRenderSpace(floor.z) }, current.grab, placed, current.moving);
    usePlacementStore.getState().moveItemsByDelta(current.moving, frame.dx, frame.dz);
    useSelectionStore.getState().setActiveGuides(frame.guides);
  };

  const startMove = (press: Press, at: { x: number; y: number }): void => {
    const now = viewRef.current;
    if (now === null || press.pieceId === null) return;
    const token = useEditorStore.getState().beginHistoryGesture();
    if (token === null) {
      // Nothing can move now (an act's layout is showing).
      begin(null);
      return;
    }
    const placed = usePlacementStore.getState().placedItems;
    const primary = placed.find((item) => item.id === press.pieceId);
    if (primary === undefined) {
      useEditorStore.getState().endHistoryGesture(token);
      begin(null);
      return;
    }
    const moving = dragMovingIds(primary.id, useSelectionStore.getState().selectedIds, placed);
    const start = toFloor(now, press.x, press.y);
    begin({
      kind: "move",
      pointerId: press.pointerId,
      token,
      primaryId: primary.id,
      grab: { x: toRenderSpace(start.x) - primary.x, z: toRenderSpace(start.z) - primary.z },
      moving,
      before: new Map(placed.filter((item) => moving.has(item.id)).map((item) => [item.id, item])),
    });
    dragTo(at);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!shown) return;
    settleGlide();
    const at = local(event);
    pointers.current.set(event.pointerId, at);
    capture(rootRef.current, event.pointerId);
    const now = viewRef.current;
    if (now === null) return;
    // A second finger: the drag or area gives way to a pinch.
    if (event.pointerType === "touch" && pointers.current.size === 2) {
      cancelGesture();
      const [a, b] = [...pointers.current.values()];
      if (a === undefined || b === undefined) return;
      begin({ kind: "pinch", distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), middle: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, view: now });
      return;
    }
    if (gesture.current !== null) return;
    const target = event.target instanceof Element ? event.target.closest("[data-piece]") : null;
    const pieceId = target?.getAttribute("data-piece") ?? null;
    if (event.button === 1) {
      begin({ kind: "pan", pointerId: event.pointerId, x: at.x, y: at.y });
      return;
    }
    if (event.button !== 0 && event.button !== 2) return;
    const additive = event.button === 0 && (event.shiftKey || event.ctrlKey || event.metaKey);
    // As in the room: a press on a piece not yet selected selects it at once, so a drag carries it.
    if (event.button === 0 && pieceId !== null && !additive && !useSelectionStore.getState().selectedIds.has(pieceId)) {
      useSelectionStore.getState().select(pieceId);
    }
    begin({ kind: "press", pointerId: event.pointerId, x: at.x, y: at.y, pieceId, additive, button: event.button });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const at = local(event);
    if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, at);
    const now = viewRef.current;
    if (now !== null) {
      const floor = toFloor(now, at.x, at.y);
      lastFloor.current = { x: toRenderSpace(floor.x), z: toRenderSpace(floor.z) };
    }
    const current = gesture.current;
    if (current === null || now === null || fit === null) return;
    if (current.kind === "pinch") {
      const [a, b] = [...pointers.current.values()];
      if (a === undefined || b === undefined) return;
      const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const scaled = zoomAbout(current.view, fit, distance / current.distance, current.middle.x, current.middle.y);
      const next = panBy(scaled, fit, middle.x - current.middle.x, middle.y - current.middle.y);
      setUserView(sameView(next, fit) ? null : next);
      return;
    }
    if (current.pointerId !== event.pointerId) return;
    if (current.kind === "press") {
      if (Math.hypot(at.x - current.x, at.y - current.y) <= TAP_SLOP_PX) return;
      if (current.button === 2) {
        // A right drag moves the zoomed paper (spec §11).
        begin({ kind: "pan", pointerId: current.pointerId, x: current.x, y: current.y });
      } else if (current.pieceId !== null && !current.additive) {
        startMove(current, at);
        return;
      } else {
        begin({ kind: "box", pointerId: current.pointerId, start: toFloor(now, current.x, current.y), additive: current.additive, before: [...useSelectionStore.getState().selectedIds] });
      }
    }
    const active = gesture.current;
    if (active?.kind === "move") {
      dragTo(at);
    } else if (active?.kind === "pan") {
      const next = panBy(now, fit, at.x - active.x, at.y - active.y);
      setUserView(sameView(next, fit) ? null : next);
      gesture.current = { ...active, x: at.x, y: at.y };
    } else if (active?.kind === "box") {
      const end = toFloor(now, at.x, at.y);
      setBox({ a: active.start, b: end });
      const inside = piecesInBox(usePlacementStore.getState().placedItems, active.start, end);
      useSelectionStore.getState().selectMultiple(active.additive ? [...new Set([...active.before, ...inside])] : inside);
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    pointers.current.delete(event.pointerId);
    release(rootRef.current, event.pointerId);
    const current = gesture.current;
    if (current === null) return;
    if (current.kind === "pinch") {
      if (pointers.current.size < 2) begin(null);
      return;
    }
    if (current.pointerId !== event.pointerId) return;
    if (current.kind === "press") {
      const selection = useSelectionStore.getState();
      if (current.pieceId !== null) {
        // A tap selects; with Shift or Ctrl it adds or takes away; a right click selects, so the caption opens beside it.
        if (current.additive) selection.toggleSelect(current.pieceId);
        else selection.select(current.pieceId);
      } else if (!current.additive && current.button === 0) {
        selection.clearSelection();
      }
    } else if (current.kind === "move") {
      endMove(true);
    }
    setBox(null);
    begin(null);
  };

  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>): void => {
    pointers.current.delete(event.pointerId);
    cancelGesture();
  };

  // The wheel zooms about the pointer (passive: false, so the page never scrolls instead).
  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return undefined;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const fitted = fitRef.current;
      if (!shownRef.current || fitted === null) return;
      settleGlide();
      const now = viewRef.current ?? fitted;
      const at = local(event);
      // A wheel with no pointer position (some synthetic ones) zooms about the middle of the paper.
      const x = Number.isFinite(at.x) ? at.x : root.clientWidth / 2;
      const y = Number.isFinite(at.y) ? at.y : root.clientHeight / 2;
      const lines = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
      const next = zoomAbout(now, fitted, Math.exp(-event.deltaY * lines * 0.0015), x, y);
      setUserView(sameView(next, fitted) ? null : next);
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => { root.removeEventListener("wheel", onWheel); };
  }, []);

  // -- Keys by the page: the arrows nudge up the page (towards the window wall) and across it, and with nothing selected
  // they move the zoomed paper; never the hidden camera. Ctrl V pastes where the pointer is on the paper. --
  const keys = useMemo((): KeyBinding[] => [
    {
      keys: ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].map((code) => ({ code, shift: "any" as const, alt: "any" as const })),
      priority: KEY_PRIORITY.selection + 1,
      repeat: true,
      when: () => shownRef.current,
      run: (event) => {
        if (useSelectionStore.getState().selectedIds.size > 0) {
          const direction = arrowFloorDirection(event.code, DRAWING_SCREEN_UP);
          if (direction === null) return false;
          cancelRef.current();
          nudgeSelection(direction, nudgeMetres(event));
          return undefined;
        }
        const step = event.shiftKey ? 160 : 48;
        const dx = event.code === "ArrowLeft" ? step : event.code === "ArrowRight" ? -step : 0;
        const dy = event.code === "ArrowUp" ? step : event.code === "ArrowDown" ? -step : 0;
        setUserView((was) => {
          const fitted = fitRef.current;
          return was === null || fitted === null ? was : panBy(was, fitted, dx, dy);
        });
        return undefined;
      },
    },
    {
      keys: letter("v", { mod: true }),
      priority: KEY_PRIORITY.selection + 1,
      when: () => shownRef.current && plannerFeatureEnabled("editingKeys"),
      mutates: true,
      run: () => (pasteAt(lastFloor.current) ? undefined : false),
    },
  ], []);
  usePlannerKeyBindings(keys);

  // -- What is drawn. --
  const aisles = useMemo((): readonly AisleLine[] => {
    if (!plannerFeatureEnabled("liveAisles") || selectedIds.size === 0) return [];
    const set = wholeSelection(selectedIds, placedItems);
    if (set.length === 0) return [];
    return liveAisles(set, placedItems, dimensions, { exits: grandHall ? grandHallExits() : null, ...(grandHall ? { wallNames: GRAND_HALL_WALL_NAMES } : {}) });
  }, [selectedIds, placedItems, dimensions, grandHall]);

  const summary = `The drawing of the ${roomName ?? "room"}: ${drawingSummary(units)}`;

  return (
    <div
      ref={rootRef}
      className="pc-paper pc-drawing"
      data-testid="planner-plan-drawing"
      data-shown={shown && entered ? "" : undefined}
      data-gesture={gestureKind ?? undefined}
      aria-hidden={shown ? undefined : true}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={(event) => { event.preventDefault(); }}
    >
      {view === null ? null : (
        <svg ref={svgRef} className="pc-drawing__svg" width={stage.width} height={stage.height} viewBox={`0 0 ${n(stage.width)} ${n(stage.height)}`} role="img" aria-label={summary}>
          <defs>
            <pattern id={hatchId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" className="pc-drawing__hatch" />
            </pattern>
          </defs>
          <RoomDrawing room={room} view={view} hatch={`url(#${hatchId})`} />
          {units.length === 0 ? <EmptyNote view={view} /> : null}
          {units.map((unit) => <UnitDrawing key={unit.key} unit={unit} view={view} selected={selectedUnits.has(unit.key)} />)}
          {gestureKind === "move" ? guides.map((guide, index) => <GuideLine key={String(index)} guide={guide} view={view} />) : null}
          {aisles.map((aisle, index) => <AisleDrawing key={String(index)} aisle={aisle} view={view} />)}
          {box === null ? null : <BoxDrawing a={box.a} b={box.b} view={view} />}
        </svg>
      )}
    </div>
  );
}

// -- The room --------------------------------------------------------------

function outward(side: RoomSide): DrawnPoint {
  switch (side) {
    case "xMin": return { x: -1, z: 0 };
    case "xMax": return { x: 1, z: 0 };
    case "zMin": return { x: 0, z: -1 };
    case "zMax": return { x: 0, z: 1 };
  }
}

function Segment({ a, b, view, className }: { readonly a: DrawnPoint; readonly b: DrawnPoint; readonly view: DrawingView; readonly className: string }): ReactElement {
  const p = toScreen(view, a);
  const q = toScreen(view, b);
  return <line className={className} x1={n(p.x)} y1={n(p.y)} x2={n(q.x)} y2={n(q.y)} />;
}

function RoomDrawing({ room, view, hatch }: { readonly room: DrawnRoom; readonly view: DrawingView; readonly hatch: string }): ReactElement {
  const half = { x: room.widthM / 2, z: room.lengthM / 2 };
  const thick = (side: RoomSide): number => room.walls.find((wall) => wall.side === side)?.thickness ?? 0;
  const inner: DrawnPoint[] = [{ x: -half.x, z: -half.z }, { x: half.x, z: -half.z }, { x: half.x, z: half.z }, { x: -half.x, z: half.z }];
  const outer: DrawnPoint[] = [
    { x: -half.x - thick("xMin"), z: -half.z - thick("zMin") }, { x: half.x + thick("xMax"), z: -half.z - thick("zMin") },
    { x: half.x + thick("xMax"), z: half.z + thick("zMax") }, { x: -half.x - thick("xMin"), z: half.z + thick("zMax") },
  ];
  // A cut runs a pixel and a half past both faces, so neither face's line crosses an opening.
  const pad = 1.5 / view.scale;
  const cuts: ReactNode[] = [];
  const marks: ReactNode[] = [];
  const names: ReactNode[] = [];
  room.openings.forEach((opening, index) => {
    const key = String(index);
    const out = outward(opening.side);
    const depth = thick(opening.side);
    const length = Math.hypot(opening.to.x - opening.from.x, opening.to.z - opening.from.z);
    const unit = { x: (opening.to.x - opening.from.x) / Math.max(1e-9, length), z: (opening.to.z - opening.from.z) / Math.max(1e-9, length) };
    const at = (u: number, d: number): DrawnPoint => ({ x: opening.from.x + unit.x * u + out.x * d, z: opening.from.z + unit.z * u + out.z * d });
    cuts.push(<path key={`cut-${key}`} className="pc-drawing__cut" d={pathOf([at(0, -pad), at(length, -pad), at(length, depth + pad), at(0, depth + pad)], view)} />);
    marks.push(<Segment key={`j0-${key}`} a={at(0, 0)} b={at(0, depth)} view={view} className="pc-drawing__wall-edge" />);
    marks.push(<Segment key={`j1-${key}`} a={at(length, 0)} b={at(length, depth)} view={view} className="pc-drawing__wall-edge" />);
    if (opening.kind === "window") {
      marks.push(<Segment key={`g0-${key}`} a={at(0, depth * 0.42)} b={at(length, depth * 0.42)} view={view} className="pc-drawing__glass" />);
      marks.push(<Segment key={`g1-${key}`} a={at(0, depth * 0.58)} b={at(length, depth * 0.58)} view={view} className="pc-drawing__glass" />);
      return;
    }
    // The hall's doors are pairs hung at the hall face that open outward (hall-spec HALL_DOORS): each leaf drawn open, with its swing.
    const leaf = length / 2;
    const radius = n(leaf * view.scale);
    const swing = (hingeU: number, shutU: number): string => {
      const hinge = toScreen(view, at(hingeU, 0));
      const open = toScreen(view, at(hingeU, leaf));
      const shut = toScreen(view, at(shutU, 0));
      const turn = (open.x - hinge.x) * (shut.y - hinge.y) - (open.y - hinge.y) * (shut.x - hinge.x);
      return `M${n(open.x)} ${n(open.y)} A${radius} ${radius} 0 0 ${turn > 0 ? "1" : "0"} ${n(shut.x)} ${n(shut.y)}`;
    };
    marks.push(<Segment key={`l0-${key}`} a={at(0, 0)} b={at(0, leaf)} view={view} className="pc-drawing__leaf" />);
    marks.push(<Segment key={`l1-${key}`} a={at(length, 0)} b={at(length, leaf)} view={view} className="pc-drawing__leaf" />);
    marks.push(<path key={`s0-${key}`} className="pc-drawing__swing" d={swing(0, leaf)} />);
    marks.push(<path key={`s1-${key}`} className="pc-drawing__swing" d={swing(length, length - leaf)} />);
    if (opening.name !== null) {
      const middle = toScreen(view, at(length / 2, depth));
      names.push(<SideText key={`n-${key}`} side={opening.side} x={middle.x} y={middle.y} gap={12} className="pc-drawing__door-name">{opening.name}</SideText>);
    }
  });
  const fireplace = room.fireplace;
  const fireLabel = fireplace === null ? null : toScreen(view, fireplace.labelAt);
  return (
    <g className="pc-drawing__room">
      <path className="pc-drawing__floor" d={pathOf(inner, view)} />
      <path className="pc-drawing__wall" fill={hatch} fillRule="evenodd" d={`${pathOf(outer, view)} ${pathOf(inner, view)}`} />
      <path className="pc-drawing__wall-face" d={pathOf(inner, view)} />
      <path className="pc-drawing__wall-edge" d={pathOf(outer, view)} />
      {cuts}
      {fireplace === null ? null : (
        <>
          <path className="pc-drawing__cut" d={pathOf(fireplace.firebox, view)} />
          <path className="pc-drawing__firebox" d={pathOf(fireplace.firebox, view)} />
          <path className="pc-drawing__surround" d={pathOf(fireplace.surround, view)} />
        </>
      )}
      {marks}
      {fireLabel === null ? null : <text className="pc-drawing__feature" x={n(fireLabel.x)} y={n(fireLabel.y)} dominantBaseline="middle">Fireplace</text>}
      {room.walls.map((wall) => {
        if (wall.name === null) return null;
        const across = wall.side === "xMin" || wall.side === "xMax";
        const out = outward(wall.side);
        const face = across ? { x: out.x * (half.x + wall.thickness), z: wall.nameAt } : { x: wall.nameAt, z: out.z * (half.z + wall.thickness) };
        const at = toScreen(view, face);
        return <SideText key={wall.side} side={wall.side} x={at.x} y={at.y} gap={12} className="pc-drawing__wall-name">{wall.name}</SideText>;
      })}
      {names}
      <ScaleBar room={room} view={view} />
    </g>
  );
}

/** Words set just outside a wall, reading along it; the end walls' turn to run up and down the page. */
function SideText({ side, x, y, gap, className, children }: { readonly side: RoomSide; readonly x: number; readonly y: number; readonly gap: number; readonly className: string; readonly children: string }): ReactElement {
  const out = outward(side);
  const px = x + out.x * gap;
  const py = y + out.z * gap;
  const turn = side === "xMin" ? -90 : side === "xMax" ? 90 : 0;
  return (
    <text className={className} x={n(px)} y={n(py)} textAnchor="middle" dominantBaseline="middle" transform={turn === 0 ? undefined : `rotate(${String(turn)} ${n(px)} ${n(py)})`}>
      {children}
    </text>
  );
}

/** A scale bar over the far end of the top wall, a round length about 90–200 px long. */
function ScaleBar({ room, view }: { readonly room: DrawnRoom; readonly view: DrawingView }): ReactElement | null {
  const metres = [1, 2, 5, 10].find((m) => m * view.scale >= 90) ?? 10;
  const top = room.walls.find((wall) => wall.side === "zMin")?.thickness ?? 0;
  const end = room.walls.find((wall) => wall.side === "xMax")?.thickness ?? 0;
  const corner = toScreen(view, { x: room.widthM / 2 + end, z: -room.lengthM / 2 - top });
  const y = corner.y - 12;
  const x1 = corner.x;
  const x0 = x1 - metres * view.scale;
  if (x0 < 0 || y < 0) return null;
  return (
    <g className="pc-drawing__scale" aria-hidden="true">
      <line x1={n(x0)} y1={n(y)} x2={n(x1)} y2={n(y)} />
      <line x1={n(x0)} y1={n(y - 3)} x2={n(x0)} y2={n(y + 3)} />
      <line x1={n(x1)} y1={n(y - 3)} x2={n(x1)} y2={n(y + 3)} />
      <text x={n(x0 - 6)} y={n(y)} textAnchor="end" dominantBaseline="middle">{`${String(metres)} m`}</text>
    </g>
  );
}

function EmptyNote({ view }: { readonly view: DrawingView }): ReactElement {
  const at = toScreen(view, { x: 0, z: 0 });
  return <text className="pc-drawing__empty" x={n(at.x)} y={n(at.y)} textAnchor="middle" dominantBaseline="middle">Nothing on the floor yet</text>;
}

// -- The pieces --------------------------------------------------------------

/** The number alone ("7") where "Table 7" will not fit its table. */
function shortLabel(label: string): string | null {
  const match = /^Table (\d+)$/u.exec(label);
  return match === null ? null : match[1] ?? null;
}

function UnitDrawing({ unit, view, selected }: { readonly unit: DrawnUnit; readonly view: DrawingView; readonly selected: boolean }): ReactElement {
  const across = unit.span * view.scale;
  let label: string | null = null;
  if (unit.label !== null) {
    if (textWidth(unit.label, 12) + 8 <= across) label = unit.label;
    else if (unit.labelKind === "number") {
      const short = shortLabel(unit.label);
      if (short !== null && textWidth(short, 12) + 6 <= across) label = short;
    }
  }
  const at = toScreen(view, unit.labelAt);
  const detail = label !== null && unit.detail !== null && textWidth(unit.detail, 11) + 8 <= across ? unit.detail : null;
  return (
    <g className="pc-drawing__unit" data-selected={selected ? "" : undefined} data-unit={unit.mainId}>
      {unit.pieces.map((piece) => {
        const className = `pc-drawing__piece pc-drawing__piece--${piece.role}`;
        if (piece.shape.kind === "circle") {
          const c = toScreen(view, piece.shape.centre);
          return <circle key={piece.id} data-piece={piece.id} className={className} cx={n(c.x)} cy={n(c.y)} r={n(piece.shape.radius * view.scale)} />;
        }
        return (
          <g key={piece.id}>
            <path data-piece={piece.id} className={className} d={pathOf(piece.shape.points, view)} />
            {piece.back === null ? null : <Segment a={piece.back[0]} b={piece.back[1]} view={view} className="pc-drawing__back" />}
          </g>
        );
      })}
      {unit.outline === null ? null : <path className="pc-drawing__outline" d={pathOf(unit.outline, view)} />}
      {label === null ? null : (
        <text className={`pc-drawing__label pc-drawing__label--${unit.labelKind ?? "name"}`} x={n(at.x)} y={n(at.y + (detail === null ? 0 : -7))} textAnchor="middle" dominantBaseline="middle">
          {label}
        </text>
      )}
      {detail === null ? null : <text className="pc-drawing__detail" x={n(at.x)} y={n(at.y + 9)} textAnchor="middle" dominantBaseline="middle">{detail}</text>}
    </g>
  );
}

function AisleDrawing({ aisle, view }: { readonly aisle: AisleLine; readonly view: DrawingView }): ReactElement {
  const a = toScreen(view, aisle.from);
  const b = toScreen(view, aisle.to);
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const ux = length === 0 ? 1 : (b.x - a.x) / length;
  const uy = length === 0 ? 0 : (b.y - a.y) / length;
  const tick = (p: { readonly x: number; readonly y: number }): ReactElement => <line x1={n(p.x - uy * 4)} y1={n(p.y + ux * 4)} x2={n(p.x + uy * 4)} y2={n(p.y - ux * 4)} />;
  const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const width = textWidth(aisle.words, 12) + 12;
  return (
    <g className={`pc-drawing__aisle pc-drawing__aisle--${aisle.tone}`} aria-hidden="true">
      <line x1={n(a.x)} y1={n(a.y)} x2={n(b.x)} y2={n(b.y)} />
      {tick(a)}
      {tick(b)}
      <rect className="pc-drawing__aisle-plate" x={n(middle.x - width / 2)} y={n(middle.y - 10)} width={n(width)} height="20" rx="4" />
      <text x={n(middle.x)} y={n(middle.y)} textAnchor="middle" dominantBaseline="middle">{aisle.words}</text>
    </g>
  );
}

function GuideLine({ guide, view }: { readonly guide: SnapGuide; readonly view: DrawingView }): ReactElement {
  const along = (value: number): DrawnPoint => (guide.axis === "x"
    ? { x: toRealWorld(value), z: toRealWorld(guide.coord) }
    : { x: toRealWorld(guide.coord), z: toRealWorld(value) });
  return <Segment a={along(guide.start)} b={along(guide.end)} view={view} className="pc-drawing__guide" />;
}

function BoxDrawing({ a, b, view }: { readonly a: DrawnPoint; readonly b: DrawnPoint; readonly view: DrawingView }): ReactElement {
  const p = toScreen(view, a);
  const q = toScreen(view, b);
  return <rect className="pc-drawing__box" x={n(Math.min(p.x, q.x))} y={n(Math.min(p.y, q.y))} width={n(Math.abs(q.x - p.x))} height={n(Math.abs(q.y - p.y))} />;
}
