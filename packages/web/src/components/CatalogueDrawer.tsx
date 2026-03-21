import { useCallback, useEffect, useRef, useState } from "react";
import type { FurnitureCategory } from "@omnitwin/types";
import { useCatalogueStore } from "../stores/catalogue-store.js";
import { usePlacementStore } from "../stores/placement-store.js";
import { useSelectionStore } from "../stores/selection-store.js";
import {
  CATALOGUE_CATEGORIES,
  getCatalogueByCategory,
  categoryLabel,
} from "../lib/catalogue.js";
import type { CatalogueItem } from "../lib/catalogue.js";

// ---------------------------------------------------------------------------
// TFT-style bottom shop bar — full-width panel along the bottom
// ---------------------------------------------------------------------------

/** When dragging a placed item near the bar, fade the bar so 3D shows through. */
const DRAG_NEAR_OPACITY = 0.45;

const shopBarBaseStyle: React.CSSProperties = {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,
  background: "linear-gradient(to top, rgba(10, 12, 18, 0.97), rgba(18, 22, 32, 0.95))",
  borderTop: "1px solid rgba(120, 160, 220, 0.25)",
  display: "flex",
  flexDirection: "column",
  zIndex: 30,
  boxShadow: "0 -4px 24px rgba(0,0,0,0.5), 0 -1px 0 rgba(80,120,180,0.15)",
  fontFamily: "system-ui, -apple-system, sans-serif",
  transition: "opacity 0.2s ease-out",
};

const topRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "6px 16px",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
};

const tabRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 2,
};

const tabBtnBase: React.CSSProperties = {
  fontSize: 11,
  fontFamily: "system-ui, -apple-system, sans-serif",
  fontWeight: 600,
  padding: "5px 14px",
  border: "none",
  background: "transparent",
  color: "rgba(180, 195, 220, 0.6)",
  cursor: "pointer",
  transition: "color 0.15s, background 0.15s",
  textTransform: "uppercase",
  letterSpacing: 0.8,
  borderBottom: "2px solid transparent",
};

const tabBtnActive: React.CSSProperties = {
  ...tabBtnBase,
  color: "#c8daf0",
  borderBottom: "2px solid rgba(100, 160, 255, 0.7)",
  background: "rgba(80, 130, 200, 0.08)",
};

const closeBtnStyle: React.CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: 4,
  border: "1px solid rgba(255,255,255,0.1)",
  background: "rgba(255,255,255,0.05)",
  color: "rgba(180, 195, 220, 0.5)",
  cursor: "pointer",
  fontSize: 14,
  lineHeight: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const itemRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  padding: "10px 16px 14px",
  overflowX: "auto",
  overflowY: "hidden",
  alignItems: "stretch",
};

const cardBase: React.CSSProperties = {
  flex: "0 0 auto",
  width: 120,
  borderRadius: 8,
  border: "1px solid rgba(80, 120, 180, 0.2)",
  background: "linear-gradient(135deg, rgba(30, 40, 60, 0.9), rgba(20, 28, 45, 0.95))",
  padding: "10px 8px 8px",
  cursor: "grab",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 6,
  transition: "border-color 0.15s, box-shadow 0.15s, transform 0.1s",
  userSelect: "none",
  WebkitUserSelect: "none",
};

const cardHoverEffect = "0 0 12px rgba(80, 140, 255, 0.15), inset 0 1px 0 rgba(255,255,255,0.05)";

const previewContainerStyle: React.CSSProperties = {
  width: 52,
  height: 52,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const cardNameStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "#d0daea",
  textAlign: "center",
  lineHeight: 1.2,
  letterSpacing: 0.2,
};

const cardDimStyle: React.CSSProperties = {
  fontSize: 9,
  fontFamily: "'SF Mono', 'Consolas', monospace",
  color: "rgba(140, 165, 200, 0.7)",
  textAlign: "center",
  letterSpacing: 0.3,
};

const dragHintStyle: React.CSSProperties = {
  fontSize: 9,
  color: "rgba(140, 165, 200, 0.35)",
  textAlign: "center",
  padding: "0 16px 6px",
  letterSpacing: 0.3,
};

// ---------------------------------------------------------------------------
// Trash zone styles — three states: idle, ready (item selected), hover
// ---------------------------------------------------------------------------

const trashZoneIdle: React.CSSProperties = {
  flex: "0 0 140px",
  alignSelf: "stretch",
  borderRadius: 10,
  border: "2px dashed rgba(255, 100, 100, 0.25)",
  background: "rgba(255, 60, 60, 0.04)",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  transition: "border-color 0.3s, background 0.3s, box-shadow 0.3s, transform 0.2s",
  marginLeft: "auto",
  position: "relative",
  overflow: "visible",
};

/** Ready state — item is selected, trash pulses gently to invite. */
const trashZoneReady: React.CSSProperties = {
  ...trashZoneIdle,
  border: "2px dashed rgba(255, 80, 80, 0.6)",
  background: "rgba(255, 40, 40, 0.08)",
  boxShadow:
    "0 0 16px rgba(255, 60, 60, 0.25), " +
    "inset 0 0 12px rgba(255, 40, 40, 0.08)",
};

/** Hover state — item is over the trash, full black-hole glow. */
const trashZoneHover: React.CSSProperties = {
  ...trashZoneIdle,
  border: "2px solid rgba(255, 50, 50, 0.9)",
  background: "rgba(255, 20, 20, 0.2)",
  boxShadow:
    "0 0 24px rgba(255, 40, 40, 0.5), " +
    "0 0 48px rgba(255, 20, 20, 0.25), " +
    "inset 0 0 20px rgba(255, 40, 40, 0.15)",
  transform: "scale(1.05)",
};

const trashLabelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: "rgba(255, 140, 140, 0.6)",
  letterSpacing: 0.4,
  textTransform: "uppercase",
};

// ---------------------------------------------------------------------------
// Black hole animation timing
// ---------------------------------------------------------------------------

/** Total spaghettification + swallow duration in ms. */
const BLACK_HOLE_DURATION = 700;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lighten(hex: string, amount: number): string {
  const r = Math.min(255, parseInt(hex.slice(1, 3), 16) + amount);
  const g = Math.min(255, parseInt(hex.slice(3, 5), 16) + amount);
  const b = Math.min(255, parseInt(hex.slice(5, 7), 16) + amount);
  return `rgb(${String(r)}, ${String(g)}, ${String(b)})`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CategoryTab({
  category,
  active,
  onClick,
}: {
  readonly category: FurnitureCategory;
  readonly active: boolean;
  readonly onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      style={active ? tabBtnActive : tabBtnBase}
      onClick={onClick}
    >
      {categoryLabel(category)}
    </button>
  );
}

function ShopCard({
  item,
  onDragStart,
}: {
  readonly item: CatalogueItem;
  readonly onDragStart: (id: string) => void;
}): React.ReactElement {
  const dims = `${item.width.toFixed(1)} × ${item.depth.toFixed(1)} × ${item.height.toFixed(1)}m`;

  return (
    <div
      style={cardBase}
      onPointerDown={(e) => {
        if (e.button === 0) {
          e.preventDefault();
          onDragStart(item.id);
        }
      }}
      onPointerEnter={(e) => {
        const el = e.currentTarget;
        el.style.borderColor = "rgba(100, 160, 255, 0.5)";
        el.style.boxShadow = cardHoverEffect;
        el.style.transform = "translateY(-2px)";
      }}
      onPointerLeave={(e) => {
        const el = e.currentTarget;
        el.style.borderColor = "rgba(80, 120, 180, 0.2)";
        el.style.boxShadow = "none";
        el.style.transform = "none";
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onDragStart(item.id); }}
    >
      <div style={previewContainerStyle} title={item.name}>
        <ItemPreviewIcon item={item} />
      </div>
      <span style={cardNameStyle}>{item.name}</span>
      <span style={cardDimStyle}>{dims}</span>
    </div>
  );
}

/** SVG silhouette for a round table — circle top on pedestal. */
function RoundTableIcon({ color }: { readonly color: string }): React.ReactElement {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
      <ellipse cx="24" cy="16" rx="18" ry="6" fill={color} opacity="0.9" />
      <ellipse cx="24" cy="16" rx="18" ry="6" stroke={lighten(color, 50)} strokeWidth="0.8" fill="none" opacity="0.4" />
      <rect x="22" y="16" width="4" height="18" rx="1" fill={color} opacity="0.7" />
      <ellipse cx="24" cy="36" rx="10" ry="3" fill={color} opacity="0.6" />
    </svg>
  );
}

/** SVG silhouette for a trestle/rectangular table — flat top on four legs. */
function TrestleTableIcon({ color }: { readonly color: string }): React.ReactElement {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
      <path d="M4 14 L44 14 L40 20 L8 20 Z" fill={color} opacity="0.9" />
      <path d="M4 14 L44 14 L40 20 L8 20 Z" stroke={lighten(color, 50)} strokeWidth="0.8" fill="none" opacity="0.4" />
      <rect x="9" y="20" width="3" height="18" fill={color} opacity="0.6" />
      <rect x="36" y="20" width="3" height="18" fill={color} opacity="0.6" />
      <rect x="14" y="20" width="2.5" height="16" fill={color} opacity="0.4" />
      <rect x="31" y="20" width="2.5" height="16" fill={color} opacity="0.4" />
      <rect x="11" y="30" width="26" height="2" rx="0.5" fill={color} opacity="0.35" />
    </svg>
  );
}

/** SVG silhouette for a banquet chair — seat + backrest + legs. */
function ChairIcon({ color }: { readonly color: string }): React.ReactElement {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
      <path d="M12 6 L36 6 L34 24 L14 24 Z" fill={color} opacity="0.85" />
      <path d="M12 6 L36 6 L34 24 L14 24 Z" stroke={lighten(color, 50)} strokeWidth="0.8" fill="none" opacity="0.4" />
      <rect x="12" y="24" width="24" height="5" rx="1.5" fill={color} opacity="0.75" />
      <rect x="13" y="29" width="3" height="14" fill={color} opacity="0.55" />
      <rect x="32" y="29" width="3" height="14" fill={color} opacity="0.55" />
      <rect x="15" y="29" width="2.5" height="12" fill={color} opacity="0.35" />
      <rect x="30" y="29" width="2.5" height="12" fill={color} opacity="0.35" />
    </svg>
  );
}

/** SVG silhouette for a stage platform — thick block with edge strip. */
function PlatformIcon({ color }: { readonly color: string }): React.ReactElement {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
      <path d="M6 18 L42 18 L38 28 L10 28 Z" fill={color} opacity="0.85" />
      <path d="M6 18 L42 18 L38 28 L10 28 Z" stroke={lighten(color, 80)} strokeWidth="0.8" fill="none" opacity="0.5" />
      <path d="M10 28 L38 28 L38 38 L10 38 Z" fill={color} opacity="0.6" />
      <rect x="10" y="27" width="28" height="2.5" fill="#888" opacity="0.6" />
    </svg>
  );
}

/** SVG silhouette for a tablecloth — draped fabric shape. */
function ClothIcon({ color }: { readonly color: string }): React.ReactElement {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
      <path
        d="M10 10 L38 10 Q40 10 40 12 L40 28 Q38 34 34 36 Q30 38 26 36 Q22 38 18 36 Q14 34 10 32 L8 12 Q8 10 10 10 Z"
        fill={color}
        opacity="0.85"
      />
      <path
        d="M10 10 L38 10 Q40 10 40 12 L40 28 Q38 34 34 36 Q30 38 26 36 Q22 38 18 36 Q14 34 10 32 L8 12 Q8 10 10 10 Z"
        stroke={lighten(color, 80)}
        strokeWidth="0.8"
        fill="none"
        opacity="0.4"
      />
      <path d="M18 14 Q20 24 18 32" stroke={lighten(color, 30)} strokeWidth="1" opacity="0.3" fill="none" />
      <path d="M28 12 Q30 22 28 34" stroke={lighten(color, 30)} strokeWidth="1" opacity="0.3" fill="none" />
    </svg>
  );
}

/** Returns the appropriate preview SVG for a catalogue item. */
function ItemPreviewIcon({ item }: { readonly item: CatalogueItem }): React.ReactElement {
  const c = item.color;
  switch (item.category) {
    case "table":
      return item.tableShape === "round"
        ? <RoundTableIcon color={c} />
        : <TrestleTableIcon color={c} />;
    case "chair":
      return <ChairIcon color={c} />;
    case "stage":
      return <PlatformIcon color={c} />;
    case "decor":
      return <ClothIcon color={c} />;
    default:
      return <PlatformIcon color={c} />;
  }
}

/** Animated trash bin SVG — lid opens/closes. */
function TrashBinIcon({ size, color, lidOpen }: {
  readonly size: number;
  readonly color: string;
  readonly lidOpen: boolean;
}): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Body */}
      <path d="M5 6h10l-1 11H6L5 6z" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
      {/* Lid — rotates when open */}
      <g
        style={{
          transformOrigin: "3px 6px",
          transform: lidOpen ? "rotate(-45deg)" : "rotate(0deg)",
          transition: "transform 0.25s ease-out",
        }}
      >
        <path d="M3 6h14" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M8 6V4a1 1 0 011-1h2a1 1 0 011 1v2" stroke={color} strokeWidth="1.5" />
      </g>
      {/* Internal lines */}
      <line x1="8.5" y1="9" x2="8.5" y2="14" stroke={color} strokeWidth="1.2" />
      <line x1="11.5" y1="9" x2="11.5" y2="14" stroke={color} strokeWidth="1.2" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Black hole spaghettification animation overlay
// ---------------------------------------------------------------------------

interface BlackHoleAnimState {
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  readonly startTime: number;
}

/**
 * Black hole suck-in: the object stretches vertically toward the trash center
 * (spaghettification), spirals inward, and collapses to a point. A dark
 * implosion ring follows.
 */
function BlackHoleOverlay({ anim }: { readonly anim: BlackHoleAnimState }): React.ReactElement {
  const objRef = useRef<HTMLDivElement>(null);
  const vortexRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const obj = objRef.current;
    const vortex = vortexRef.current;
    if (obj === null || vortex === null) return;

    let raf = 0;
    function tick(): void {
      if (obj === null || vortex === null) return;
      const elapsed = performance.now() - anim.startTime;
      const t = Math.min(1, elapsed / BLACK_HOLE_DURATION);

      // Ease: slow start, rapid acceleration at the end (gravity well)
      const eased = t * t * t;

      // Position: move from start toward trash center
      const x = anim.fromX + (anim.toX - anim.fromX) * eased;
      const y = anim.fromY + (anim.toY - anim.fromY) * eased;

      // Spaghettification: stretch vertically, compress horizontally
      const stretchY = 1 + eased * 3.5;  // gets tall
      const squashX = Math.max(0.05, 1 - eased * 0.95); // gets thin

      // Spiral rotation
      const rotation = eased * 720;

      // Opacity: fully visible until last 20%, then fades
      const opacity = t > 0.8 ? Math.max(0, 1 - (t - 0.8) / 0.2) : 1;

      // Object size shrinks as it enters the hole
      const scale = Math.max(0, 1 - eased * 0.6);

      obj.style.transform =
        `translate(${String(x)}px, ${String(y)}px) ` +
        `rotate(${String(rotation)}deg) ` +
        `scale(${String(squashX * scale)}, ${String(stretchY * scale)})`;
      obj.style.opacity = String(opacity);

      // Vortex ring: grows from 0, peaks at t=0.5, fades
      const vortexScale = Math.sin(t * Math.PI) * 2.5;
      const vortexOpacity = Math.sin(t * Math.PI) * 0.7;
      const vortexRotation = t * 360;
      vortex.style.transform =
        `translate(${String(anim.toX)}px, ${String(anim.toY)}px) ` +
        `rotate(${String(vortexRotation)}deg) ` +
        `scale(${String(vortexScale)})`;
      vortex.style.opacity = String(vortexOpacity);

      if (t < 1) {
        raf = requestAnimationFrame(tick);
      }
    }

    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); };
  }, [anim]);

  return (
    <>
      {/* The object being sucked in */}
      <div
        ref={objRef}
        style={{
          position: "fixed",
          left: -15,
          top: -15,
          width: 30,
          height: 30,
          borderRadius: 4,
          background: "radial-gradient(circle, rgba(200,160,120,0.9), rgba(140,100,60,0.8))",
          boxShadow: "0 0 12px rgba(255,80,40,0.6)",
          pointerEvents: "none",
          zIndex: 9999,
          willChange: "transform, opacity",
        }}
      />
      {/* Vortex swirl at trash center */}
      <div
        ref={vortexRef}
        style={{
          position: "fixed",
          left: -30,
          top: -30,
          width: 60,
          height: 60,
          borderRadius: "50%",
          background: "conic-gradient(from 0deg, transparent 0%, rgba(80,0,0,0.6) 25%, transparent 50%, rgba(120,0,0,0.4) 75%, transparent 100%)",
          border: "2px solid rgba(255,40,40,0.3)",
          pointerEvents: "none",
          zIndex: 9998,
          willChange: "transform, opacity",
        }}
      />
    </>
  );
}

/** Dark implosion burst after the object is swallowed. */
function ImplosionBurst({ x, y }: { readonly x: number; readonly y: number }): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const start = performance.now();
    let raf = 0;

    function tick(): void {
      if (el === null) return;
      const elapsed = performance.now() - start;
      const t = Math.min(1, elapsed / 400);

      // Implosion: starts big, contracts to nothing, then a small burst
      const phase1 = Math.min(1, t / 0.4); // contract phase
      const phase2 = Math.max(0, (t - 0.4) / 0.6); // burst phase

      let scale: number;
      let opacity: number;
      if (t < 0.4) {
        // Contract inward
        scale = 2.0 * (1 - phase1 * 0.9);
        opacity = 0.8;
      } else {
        // Small dark burst outward
        scale = 0.2 + phase2 * 1.5;
        opacity = Math.max(0, 0.8 - phase2);
      }

      el.style.transform = `translate(${String(x)}px, ${String(y)}px) scale(${String(scale)})`;
      el.style.opacity = String(opacity);
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      }
    }

    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); };
  }, [x, y]);

  return (
    <div
      ref={ref}
      style={{
        position: "fixed",
        left: -20,
        top: -20,
        width: 40,
        height: 40,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(20,0,0,0.9), rgba(60,0,0,0.6) 40%, rgba(255,40,40,0.3) 70%, transparent 100%)",
        boxShadow: "0 0 20px rgba(80,0,0,0.6), inset 0 0 10px rgba(0,0,0,0.8)",
        pointerEvents: "none",
        zIndex: 9999,
        willChange: "transform, opacity",
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * TFT-style shop bar along the bottom of the screen.
 *
 * Key behaviors:
 * - Bar becomes pointer-transparent when dragging a selected item so the
 *   3D object flows smoothly through without freezing.
 * - Trash zone glows immediately when any item is selected (ready state).
 * - Dropping on trash triggers a black-hole spaghettification animation.
 */
export function CatalogueDrawer(): React.ReactElement | null {
  const drawerOpen = useCatalogueStore((s) => s.drawerOpen);
  const activeCategory = useCatalogueStore((s) => s.activeCategory);

  /** True when pointer is over the trash zone while dragging. */
  const [trashHover, setTrashHover] = useState(false);
  /** True when a placed item is being dragged near/over the shop bar area. */
  const [dragNearBar, setDragNearBar] = useState(false);
  /** True when any items are selected (trash should glow in ready state). */
  const [hasSelection, setHasSelection] = useState(false);
  /** True when left button is held while items selected — bar goes pointer-transparent. */
  const [isDraggingItem, setIsDraggingItem] = useState(false);
  /** Black hole animation state. */
  const [blackHoleAnim, setBlackHoleAnim] = useState<BlackHoleAnimState | null>(null);
  /** Implosion burst position. */
  const [burstPos, setBurstPos] = useState<{ x: number; y: number } | null>(null);
  /** Whether the trash lid is open (during hover/animation). */
  const [trashLidOpen, setTrashLidOpen] = useState(false);

  const barRef = useRef<HTMLDivElement>(null);

  const handleClose = useCallback(() => {
    useCatalogueStore.getState().closeDrawer();
  }, []);

  const handleSetCategory = useCallback((category: FurnitureCategory) => {
    useCatalogueStore.getState().setCategory(category);
  }, []);

  const handleDragStart = useCallback((id: string) => {
    useCatalogueStore.getState().startDrag(id);
  }, []);

  // Track selection state for immediate trash glow
  useEffect(() => {
    return useSelectionStore.subscribe((state) => {
      setHasSelection(state.selectedIds.size > 0);
    });
  }, []);

  // Keyboard: F to toggle, Escape to close
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;

      if (event.code === "KeyF" && !event.ctrlKey && !event.metaKey) {
        useCatalogueStore.getState().toggleDrawer();
      } else if (event.code === "Escape" && useCatalogueStore.getState().drawerOpen) {
        useCatalogueStore.getState().closeDrawer();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); };
  }, []);

  // Global pointermove: detect dragging state, trash hover, bar proximity
  useEffect(() => {
    function onPointerMove(event: PointerEvent): void {
      const selected = useSelectionStore.getState().selectedIds.size > 0;
      const isLeftDown = (event.buttons & 1) !== 0;
      const dragging = selected && isLeftDown;

      setIsDraggingItem(dragging);

      // Trash zone hover detection
      const trashEl = document.querySelector("[data-trash-zone]");
      if (trashEl !== null && dragging) {
        const rect = trashEl.getBoundingClientRect();
        const expandedTop = rect.top - 50;
        const over =
          event.clientX >= rect.left - 20 &&
          event.clientX <= rect.right + 20 &&
          event.clientY >= expandedTop &&
          event.clientY <= rect.bottom + 10;
        setTrashHover(over);
        setTrashLidOpen(over);
      } else {
        setTrashHover(false);
      }

      // Detect if pointer is near the bar (within 80px above bar top)
      const barEl = barRef.current;
      if (barEl !== null && dragging) {
        const barRect = barEl.getBoundingClientRect();
        const nearBar = event.clientY >= barRect.top - 80;
        setDragNearBar(nearBar);
      } else {
        setDragNearBar(false);
      }
    }

    function onPointerUp(): void {
      setDragNearBar(false);
      setTrashHover(false);
      setIsDraggingItem(false);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, []);

  // Global pointerup: black hole animation if over trash
  useEffect(() => {
    function onPointerUp(event: PointerEvent): void {
      const trashEl = document.querySelector("[data-trash-zone]");
      if (trashEl !== null) {
        const rect = trashEl.getBoundingClientRect();
        const expandedTop = rect.top - 50;
        const overTrash =
          event.clientX >= rect.left - 20 &&
          event.clientX <= rect.right + 20 &&
          event.clientY >= expandedTop &&
          event.clientY <= rect.bottom + 10;

        if (overTrash) {
          const selectedIds = useSelectionStore.getState().selectedIds;
          if (selectedIds.size > 0) {
            const trashCenterX = rect.left + rect.width / 2;
            const trashCenterY = rect.top + rect.height / 2;

            // Open the lid for the swallow
            setTrashLidOpen(true);

            setBlackHoleAnim({
              fromX: event.clientX,
              fromY: event.clientY,
              toX: trashCenterX,
              toY: trashCenterY,
              startTime: performance.now(),
            });

            setTimeout(() => {
              usePlacementStore.getState().removeItems(selectedIds);
              useSelectionStore.getState().clearSelection();
              setBlackHoleAnim(null);

              // Close the lid
              setTrashLidOpen(false);

              // Implosion burst
              setBurstPos({ x: trashCenterX, y: trashCenterY });
              setTimeout(() => { setBurstPos(null); }, 450);
            }, BLACK_HOLE_DURATION);
          }
        }
      }

      if (useCatalogueStore.getState().dragActive) {
        requestAnimationFrame(() => {
          useCatalogueStore.getState().endDrag();
        });
      }
    }
    window.addEventListener("pointerup", onPointerUp);
    return () => { window.removeEventListener("pointerup", onPointerUp); };
  }, []);

  if (!drawerOpen) return null;

  const items = getCatalogueByCategory(activeCategory);

  // When dragging a placed item near the bar, fade bar so 3D shows through
  const barOpacity = dragNearBar ? DRAG_NEAR_OPACITY : 1;

  // When dragging a selected item, make bar pointer-transparent so the 3D
  // object doesn't freeze when the cursor enters the bar's DOM area.
  const barPointerEvents = isDraggingItem ? "none" as const : "auto" as const;

  // Trash zone style: idle → ready (item selected) → hover (over trash)
  let trashStyle: React.CSSProperties;
  if (trashHover) {
    trashStyle = trashZoneHover;
  } else if (hasSelection) {
    trashStyle = trashZoneReady;
  } else {
    trashStyle = trashZoneIdle;
  }

  const trashIconColor = trashHover
    ? "rgba(255, 70, 70, 0.95)"
    : hasSelection
      ? "rgba(255, 100, 100, 0.7)"
      : "rgba(255, 140, 140, 0.45)";
  const trashIconSize = trashHover ? 36 : hasSelection ? 32 : 30;

  return (
    <>
      <div
        ref={barRef}
        style={{
          ...shopBarBaseStyle,
          opacity: barOpacity,
          pointerEvents: barPointerEvents,
        }}
      >
        <div style={topRowStyle}>
          <div style={tabRowStyle}>
            {CATALOGUE_CATEGORIES.map((cat) => (
              <CategoryTab
                key={cat}
                category={cat}
                active={cat === activeCategory}
                onClick={() => { handleSetCategory(cat); }}
              />
            ))}
          </div>
          <button
            type="button"
            style={closeBtnStyle}
            onClick={handleClose}
            title="Close (Esc)"
          >
            ×
          </button>
        </div>
        <div style={itemRowStyle}>
          {items.map((item) => (
            <ShopCard
              key={item.id}
              item={item}
              onDragStart={handleDragStart}
            />
          ))}
          {/* Trash zone — glows when items selected, intensifies on hover */}
          <div
            data-trash-zone=""
            style={trashStyle}
          >
            <TrashBinIcon
              size={trashIconSize}
              color={trashIconColor}
              lidOpen={trashLidOpen}
            />
            <span style={trashLabelStyle}>Trash</span>
          </div>
        </div>
        <div style={dragHintStyle}>Drag onto the scene to place &middot; Drag items to trash to remove</div>
      </div>
      {blackHoleAnim !== null && <BlackHoleOverlay anim={blackHoleAnim} />}
      {burstPos !== null && <ImplosionBurst x={burstPos.x} y={burstPos.y} />}
    </>
  );
}
