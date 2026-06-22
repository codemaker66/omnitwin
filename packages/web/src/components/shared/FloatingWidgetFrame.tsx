import {
  GripHorizontal,
  Maximize2,
  Minimize2,
  RotateCcw,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import "./FloatingWidgetFrame.css";

export type FloatingWidgetAnchor = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type FloatingWidgetStrategy = "absolute" | "fixed";

export type FloatingWidgetPlacement =
  | {
      readonly type: "anchor";
      readonly anchor: FloatingWidgetAnchor;
      readonly offsetX: number;
      readonly offsetY: number;
    }
  | {
      readonly type: "percent";
      readonly xPercent: number;
      readonly yPercent: number;
    };

export interface FloatingWidgetFrameProps {
  readonly id: string;
  readonly title: string;
  readonly children: ReactNode;
  readonly defaultPlacement: FloatingWidgetPlacement;
  readonly avoidPaddingPx?: number;
  readonly avoidSelectors?: readonly string[];
  readonly className?: string;
  readonly bodyClassName?: string;
  readonly compactLabel?: string;
  readonly strategy?: FloatingWidgetStrategy;
  readonly zIndex?: number;
  readonly defaultMinimized?: boolean;
  readonly storageScope?: string;
}

interface FloatingWidgetPosition {
  readonly left: number;
  readonly top: number;
}

interface StoredFloatingWidgetState extends FloatingWidgetPosition {
  readonly minimized: boolean;
}

interface DragState {
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly startLeft: number;
  readonly startTop: number;
}

interface SurfaceSize {
  readonly width: number;
  readonly height: number;
}

interface SurfaceFrame extends SurfaceSize {
  readonly left: number;
  readonly top: number;
}

interface AvoidRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

const EDGE_MARGIN_PX = 8;
const KEYBOARD_NUDGE_PX = 8;
const KEYBOARD_LARGE_NUDGE_PX = 24;
const DEFAULT_AVOID_PADDING_PX = 10;
const MAX_AVOIDANCE_PASSES = 8;
const OVERLAP_SCORE_WEIGHT = 1_000_000;

function storageKey(id: string): string {
  return `venviewer:floating-widget:${id}:v2`;
}

function storageIdentity(id: string, scope: string | undefined): string {
  return scope === undefined ? id : `${id}:${scope}`;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStoredFloatingWidgetState(value: unknown): value is StoredFloatingWidgetState {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return isFiniteNumber(candidate["left"])
    && isFiniteNumber(candidate["top"])
    && typeof candidate["minimized"] === "boolean";
}

function readStoredState(id: string): StoredFloatingWidgetState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(id));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return isStoredFloatingWidgetState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredState(id: string, state: StoredFloatingWidgetState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(id), JSON.stringify(state));
  } catch {
    // Local persistence is a convenience, never a required path.
  }
}

function viewportSurface(): SurfaceFrame {
  if (typeof window === "undefined") {
    return { left: 0, top: 0, width: 1440, height: 900 };
  }
  return {
    left: 0,
    top: 0,
    width: Math.max(320, window.innerWidth),
    height: Math.max(240, window.innerHeight),
  };
}

function surfaceFrameForElement(element: HTMLElement, strategy: FloatingWidgetStrategy): SurfaceFrame {
  if (strategy === "fixed") return viewportSurface();
  const parent = element.offsetParent instanceof HTMLElement ? element.offsetParent : element.parentElement;
  if (parent === null) return viewportSurface();
  const rect = parent.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width > 0 ? rect.width : parent.clientWidth || viewportSurface().width,
    height: rect.height > 0 ? rect.height : parent.clientHeight || viewportSurface().height,
  };
}

function surfaceForElement(element: HTMLElement, strategy: FloatingWidgetStrategy): SurfaceSize {
  const surface = surfaceFrameForElement(element, strategy);
  return { width: surface.width, height: surface.height };
}

function widgetSize(element: HTMLElement): SurfaceSize {
  const rect = element.getBoundingClientRect();
  return {
    width: rect.width > 0 ? rect.width : element.offsetWidth || 220,
    height: rect.height > 0 ? rect.height : element.offsetHeight || 44,
  };
}

function clampToSurface(
  position: FloatingWidgetPosition,
  surface: SurfaceSize,
  widget: SurfaceSize,
): FloatingWidgetPosition {
  const maxLeft = Math.max(EDGE_MARGIN_PX, surface.width - widget.width - EDGE_MARGIN_PX);
  const maxTop = Math.max(EDGE_MARGIN_PX, surface.height - widget.height - EDGE_MARGIN_PX);
  return {
    left: Math.round(Math.max(EDGE_MARGIN_PX, Math.min(maxLeft, position.left))),
    top: Math.round(Math.max(EDGE_MARGIN_PX, Math.min(maxTop, position.top))),
  };
}

function overlapArea(position: FloatingWidgetPosition, widget: SurfaceSize, avoidRect: AvoidRect): number {
  const left = Math.max(position.left, avoidRect.left);
  const right = Math.min(position.left + widget.width, avoidRect.right);
  const top = Math.max(position.top, avoidRect.top);
  const bottom = Math.min(position.top + widget.height, avoidRect.bottom);
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  return width * height;
}

function totalOverlapArea(
  position: FloatingWidgetPosition,
  widget: SurfaceSize,
  avoidRects: readonly AvoidRect[],
): number {
  return avoidRects.reduce((total, rect) => total + overlapArea(position, widget, rect), 0);
}

function positionDistanceSquared(a: FloatingWidgetPosition, b: FloatingWidgetPosition): number {
  const dx = a.left - b.left;
  const dy = a.top - b.top;
  return dx * dx + dy * dy;
}

function bestPositionCandidate(
  desired: FloatingWidgetPosition,
  candidates: readonly FloatingWidgetPosition[],
  widget: SurfaceSize,
  avoidRects: readonly AvoidRect[],
): FloatingWidgetPosition {
  let best = candidates[0] ?? desired;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const score = totalOverlapArea(candidate, widget, avoidRects) * OVERLAP_SCORE_WEIGHT
      + positionDistanceSquared(candidate, desired);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

function avoidOverlaps(
  desired: FloatingWidgetPosition,
  surface: SurfaceSize,
  widget: SurfaceSize,
  avoidRects: readonly AvoidRect[],
): FloatingWidgetPosition {
  let current = clampToSurface(desired, surface, widget);

  for (let pass = 0; pass < MAX_AVOIDANCE_PASSES; pass += 1) {
    const blockingRect = avoidRects.find((rect) => overlapArea(current, widget, rect) > 0);
    if (blockingRect === undefined) return current;

    const candidates = [
      { left: blockingRect.left - widget.width - EDGE_MARGIN_PX, top: current.top },
      { left: blockingRect.right + EDGE_MARGIN_PX, top: current.top },
      { left: current.left, top: blockingRect.top - widget.height - EDGE_MARGIN_PX },
      { left: current.left, top: blockingRect.bottom + EDGE_MARGIN_PX },
    ].map((candidate) => clampToSurface(candidate, surface, widget));

    const next = bestPositionCandidate(desired, candidates, widget, avoidRects);
    if (next.left === current.left && next.top === current.top) return current;
    current = next;
  }

  return current;
}

function clampPosition(
  position: FloatingWidgetPosition,
  surface: SurfaceSize,
  widget: SurfaceSize,
  avoidRects: readonly AvoidRect[] = [],
): FloatingWidgetPosition {
  if (avoidRects.length === 0) return clampToSurface(position, surface, widget);
  return avoidOverlaps(position, surface, widget, avoidRects);
}

function avoidRectsForElement(
  element: HTMLElement,
  strategy: FloatingWidgetStrategy,
  selectors: readonly string[] | undefined,
  paddingPx: number,
): readonly AvoidRect[] {
  if (selectors === undefined || selectors.length === 0) return [];
  const ownerDocument = element.ownerDocument;
  const ownerWindow = ownerDocument.defaultView;
  const surface = surfaceFrameForElement(element, strategy);
  const avoidRects: AvoidRect[] = [];

  for (const selector of selectors) {
    ownerDocument.querySelectorAll<HTMLElement>(selector).forEach((candidate) => {
      if (candidate === element || element.contains(candidate)) return;
      const style = ownerWindow?.getComputedStyle(candidate);
      if (style?.display === "none" || style?.visibility === "hidden") return;

      const rect = candidate.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      avoidRects.push({
        left: rect.left - surface.left - paddingPx,
        top: rect.top - surface.top - paddingPx,
        right: rect.right - surface.left + paddingPx,
        bottom: rect.bottom - surface.top + paddingPx,
      });
    });
  }

  return avoidRects;
}

function resolvePlacement(
  element: HTMLElement,
  placement: FloatingWidgetPlacement,
  strategy: FloatingWidgetStrategy,
  avoidRects: readonly AvoidRect[] = [],
): FloatingWidgetPosition {
  const surface = surfaceForElement(element, strategy);
  const widget = widgetSize(element);
  if (placement.type === "percent") {
    return clampPosition({
      left: surface.width * placement.xPercent,
      top: surface.height * placement.yPercent,
    }, surface, widget, avoidRects);
  }

  const fromRight = surface.width - widget.width - placement.offsetX;
  const fromBottom = surface.height - widget.height - placement.offsetY;
  const position: FloatingWidgetPosition = {
    left: placement.anchor.endsWith("right") ? fromRight : placement.offsetX,
    top: placement.anchor.startsWith("bottom") ? fromBottom : placement.offsetY,
  };
  return clampPosition(position, surface, widget, avoidRects);
}

function transformForPosition(position: FloatingWidgetPosition): string {
  return `translate3d(${String(position.left)}px, ${String(position.top)}px, 0)`;
}

function placementKey(placement: FloatingWidgetPlacement): string {
  if (placement.type === "percent") {
    return `percent:${String(placement.xPercent)}:${String(placement.yPercent)}`;
  }
  return `anchor:${placement.anchor}:${String(placement.offsetX)}:${String(placement.offsetY)}`;
}

function positionStyle(position: FloatingWidgetPosition, zIndex: number | undefined): CSSProperties {
  return {
    transform: transformForPosition(position),
    zIndex,
  };
}

export function FloatingWidgetFrame({
  id,
  title,
  children,
  defaultPlacement,
  avoidPaddingPx = DEFAULT_AVOID_PADDING_PX,
  avoidSelectors,
  className,
  bodyClassName,
  compactLabel,
  strategy = "absolute",
  zIndex,
  defaultMinimized = false,
  storageScope,
}: FloatingWidgetFrameProps): React.ReactElement {
  const bodyId = useId();
  const rootRef = useRef<HTMLElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const dragAvoidRectsRef = useRef<readonly AvoidRect[]>([]);
  const resolvedStorageIdentity = storageIdentity(id, storageScope);
  const [initialStoredState] = useState<StoredFloatingWidgetState | null>(() => (
    readStoredState(resolvedStorageIdentity)
  ));
  const [position, setPosition] = useState<FloatingWidgetPosition>(() => ({
    left: initialStoredState?.left ?? EDGE_MARGIN_PX,
    top: initialStoredState?.top ?? EDGE_MARGIN_PX,
  }));
  const positionRef = useRef<FloatingWidgetPosition>(position);
  const [minimized, setMinimized] = useState(initialStoredState?.minimized ?? defaultMinimized);
  const [dragging, setDragging] = useState(false);
  const resolvedPlacementKey = placementKey(defaultPlacement);
  const stableDefaultPlacement = useMemo(() => defaultPlacement, [resolvedPlacementKey]);

  const persistState = useCallback((nextPosition: FloatingWidgetPosition, nextMinimized: boolean): void => {
    writeStoredState(resolvedStorageIdentity, { ...nextPosition, minimized: nextMinimized });
  }, [resolvedStorageIdentity]);

  const setCommittedPosition = useCallback((nextPosition: FloatingWidgetPosition): void => {
    const root = rootRef.current;
    const clamped = root === null
      ? nextPosition
      : clampPosition(
        nextPosition,
        surfaceForElement(root, strategy),
        widgetSize(root),
        avoidRectsForElement(root, strategy, avoidSelectors, avoidPaddingPx),
      );
    positionRef.current = clamped;
    setPosition(clamped);
    persistState(clamped, minimized);
  }, [avoidPaddingPx, avoidSelectors, minimized, persistState, strategy]);

  const resetPosition = useCallback((): void => {
    const root = rootRef.current;
    if (root === null) return;
    setCommittedPosition(resolvePlacement(root, stableDefaultPlacement, strategy));
  }, [setCommittedPosition, stableDefaultPlacement, strategy]);

  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const storedState = readStoredState(resolvedStorageIdentity);
    const nextMinimized = storedState?.minimized ?? defaultMinimized;
    const avoidRects = avoidRectsForElement(root, strategy, avoidSelectors, avoidPaddingPx);
    const next = storedState === null
      ? resolvePlacement(root, stableDefaultPlacement, strategy, avoidRects)
      : clampPosition({
        left: storedState.left,
        top: storedState.top,
      }, surfaceForElement(root, strategy), widgetSize(root), avoidRects);
    positionRef.current = next;
    setPosition(next);
    setMinimized(nextMinimized);
    persistState(next, nextMinimized);
  // Resolve once when mounted or when the target placement changes. Stored
  // user positions should win until reset.
  }, [avoidPaddingPx, avoidSelectors, defaultMinimized, persistState, resolvedStorageIdentity, stableDefaultPlacement, strategy]);

  useEffect(() => {
    persistState(positionRef.current, minimized);
  }, [minimized, persistState]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onResize = (): void => {
      const root = rootRef.current;
      if (root === null) return;
      setCommittedPosition(positionRef.current);
    };
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); };
  }, [setCommittedPosition]);

  const moveBy = useCallback((deltaX: number, deltaY: number): void => {
    setCommittedPosition({
      left: positionRef.current.left + deltaX,
      top: positionRef.current.top + deltaY,
    });
  }, [setCommittedPosition]);

  const onHandleKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>): void => {
    const amount = event.shiftKey ? KEYBOARD_LARGE_NUDGE_PX : KEYBOARD_NUDGE_PX;
    switch (event.key) {
      case "ArrowLeft":
        event.preventDefault();
        moveBy(-amount, 0);
        break;
      case "ArrowRight":
        event.preventDefault();
        moveBy(amount, 0);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveBy(0, -amount);
        break;
      case "ArrowDown":
        event.preventDefault();
        moveBy(0, amount);
        break;
      case "Home":
        event.preventDefault();
        resetPosition();
        break;
    }
  }, [moveBy, resetPosition]);

  const onDragStart = useCallback((event: PointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return;
    const root = rootRef.current;
    if (root === null) return;
    event.preventDefault();
    if (typeof event.currentTarget.setPointerCapture === "function") {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    dragAvoidRectsRef.current = avoidRectsForElement(root, strategy, avoidSelectors, avoidPaddingPx);
    dragStateRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startLeft: positionRef.current.left,
      startTop: positionRef.current.top,
    };
    setDragging(true);
  }, [avoidPaddingPx, avoidSelectors, strategy]);

  const onDragMove = useCallback((event: PointerEvent<HTMLButtonElement>): void => {
    const dragState = dragStateRef.current;
    const root = rootRef.current;
    if (dragState === null || root === null || dragState.pointerId !== event.pointerId) return;
    const next = clampPosition({
      left: dragState.startLeft + (event.clientX - dragState.startClientX),
      top: dragState.startTop + (event.clientY - dragState.startClientY),
    }, surfaceForElement(root, strategy), widgetSize(root), dragAvoidRectsRef.current);
    positionRef.current = next;
    root.style.transform = transformForPosition(next);
  }, [strategy]);

  const onDragEnd = useCallback((event: PointerEvent<HTMLButtonElement>): void => {
    const dragState = dragStateRef.current;
    if (dragState === null || dragState.pointerId !== event.pointerId) return;
    dragStateRef.current = null;
    dragAvoidRectsRef.current = [];
    try {
      if (typeof event.currentTarget.releasePointerCapture === "function") {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Pointer capture may not exist in component test environments.
    }
    setDragging(false);
    setCommittedPosition(positionRef.current);
  }, [setCommittedPosition]);

  const rootClassName = [
    "vv-floating-widget",
    `vv-floating-widget--${strategy}`,
    minimized ? "is-minimized" : "",
    dragging ? "is-dragging" : "",
    className ?? "",
  ].filter(Boolean).join(" ");

  return (
    <section
      ref={rootRef}
      className={rootClassName}
      style={positionStyle(position, zIndex)}
      aria-label={title}
      data-floating-widget-id={id}
      data-minimized={minimized ? "true" : "false"}
    >
      <div className="vv-floating-widget__bar">
        <button
          type="button"
          className="vv-floating-widget__handle"
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
          onKeyDown={onHandleKeyDown}
          aria-label={`Move ${title}`}
          title="Drag or use arrow keys to move"
        >
          <GripHorizontal size={14} aria-hidden="true" />
          <span>{title}</span>
        </button>
        {minimized && compactLabel !== undefined ? (
          <span className="vv-floating-widget__compact-label">{compactLabel}</span>
        ) : null}
        <button
          type="button"
          className="vv-floating-widget__icon-button"
          onClick={resetPosition}
          aria-label={`Reset ${title} position`}
        >
          <RotateCcw size={13} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="vv-floating-widget__icon-button"
          onClick={() => { setMinimized((value) => !value); }}
          aria-label={`${minimized ? "Expand" : "Minimize"} ${title}`}
          aria-controls={bodyId}
          aria-expanded={!minimized}
        >
          {minimized ? <Maximize2 size={13} aria-hidden="true" /> : <Minimize2 size={13} aria-hidden="true" />}
        </button>
      </div>
      <div
        id={bodyId}
        className={["vv-floating-widget__body", bodyClassName ?? ""].filter(Boolean).join(" ")}
        hidden={minimized}
      >
        {children}
      </div>
    </section>
  );
}
