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

const EDGE_MARGIN_PX = 8;
const KEYBOARD_NUDGE_PX = 8;
const KEYBOARD_LARGE_NUDGE_PX = 24;

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

function viewportSurface(): SurfaceSize {
  if (typeof window === "undefined") {
    return { width: 1440, height: 900 };
  }
  return {
    width: Math.max(320, window.innerWidth),
    height: Math.max(240, window.innerHeight),
  };
}

function surfaceForElement(element: HTMLElement, strategy: FloatingWidgetStrategy): SurfaceSize {
  if (strategy === "fixed") return viewportSurface();
  const parent = element.offsetParent instanceof HTMLElement ? element.offsetParent : element.parentElement;
  if (parent === null) return viewportSurface();
  const rect = parent.getBoundingClientRect();
  return {
    width: rect.width > 0 ? rect.width : parent.clientWidth || viewportSurface().width,
    height: rect.height > 0 ? rect.height : parent.clientHeight || viewportSurface().height,
  };
}

function widgetSize(element: HTMLElement): SurfaceSize {
  const rect = element.getBoundingClientRect();
  return {
    width: rect.width > 0 ? rect.width : element.offsetWidth || 220,
    height: rect.height > 0 ? rect.height : element.offsetHeight || 44,
  };
}

function clampPosition(
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

function resolvePlacement(
  element: HTMLElement,
  placement: FloatingWidgetPlacement,
  strategy: FloatingWidgetStrategy,
): FloatingWidgetPosition {
  const surface = surfaceForElement(element, strategy);
  const widget = widgetSize(element);
  if (placement.type === "percent") {
    return clampPosition({
      left: surface.width * placement.xPercent,
      top: surface.height * placement.yPercent,
    }, surface, widget);
  }

  const fromRight = surface.width - widget.width - placement.offsetX;
  const fromBottom = surface.height - widget.height - placement.offsetY;
  const position: FloatingWidgetPosition = {
    left: placement.anchor.endsWith("right") ? fromRight : placement.offsetX,
    top: placement.anchor.startsWith("bottom") ? fromBottom : placement.offsetY,
  };
  return clampPosition(position, surface, widget);
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
      : clampPosition(nextPosition, surfaceForElement(root, strategy), widgetSize(root));
    positionRef.current = clamped;
    setPosition(clamped);
    persistState(clamped, minimized);
  }, [minimized, persistState, strategy]);

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
    const next = storedState === null
      ? resolvePlacement(root, stableDefaultPlacement, strategy)
      : clampPosition({
        left: storedState.left,
        top: storedState.top,
      }, surfaceForElement(root, strategy), widgetSize(root));
    positionRef.current = next;
    setPosition(next);
    setMinimized(nextMinimized);
    persistState(next, nextMinimized);
  // Resolve once when mounted or when the target placement changes. Stored
  // user positions should win until reset.
  }, [defaultMinimized, persistState, resolvedStorageIdentity, stableDefaultPlacement, strategy]);

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
    dragStateRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startLeft: positionRef.current.left,
      startTop: positionRef.current.top,
    };
    setDragging(true);
  }, []);

  const onDragMove = useCallback((event: PointerEvent<HTMLButtonElement>): void => {
    const dragState = dragStateRef.current;
    const root = rootRef.current;
    if (dragState === null || root === null || dragState.pointerId !== event.pointerId) return;
    const next = clampPosition({
      left: dragState.startLeft + (event.clientX - dragState.startClientX),
      top: dragState.startTop + (event.clientY - dragState.startClientY),
    }, surfaceForElement(root, strategy), widgetSize(root));
    positionRef.current = next;
    root.style.transform = transformForPosition(next);
  }, [strategy]);

  const onDragEnd = useCallback((event: PointerEvent<HTMLButtonElement>): void => {
    const dragState = dragStateRef.current;
    if (dragState === null || dragState.pointerId !== event.pointerId) return;
    dragStateRef.current = null;
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
