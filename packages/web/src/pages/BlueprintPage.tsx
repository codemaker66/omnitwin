import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type SetStateAction,
} from "react";
import {
  DEFAULT_PIXELS_PER_METRE,
  DEFAULT_SCALE_LABEL,
  computeStatusMetrics,
  countByKind,
  doorPoint,
  formatDimensions,
  getLayerRows,
  inspectorTitle,
  isRoundTable,
  metresToPixels,
  relativeTimeShort,
} from "../lib/blueprint/geometry.js";
import type { LayerRow } from "../lib/blueprint/geometry.js";
import type {
  BlueprintItem,
  BlueprintScene,
  CatalogueChip,
  EventType,
  ItemKind,
} from "../lib/blueprint/types.js";
import { DEFAULT_CATALOGUE } from "../lib/blueprint/types.js";
import { DEMO_SCENE, DEMO_SELECTED_ID } from "../lib/blueprint/demo-scene.js";
import {
  adaptEditorStateToBlueprintScene,
  blueprintPointToEditorPosition,
} from "../lib/blueprint/adapt.js";
import { useEditorStore } from "../stores/editor-store.js";
import {
  NUDGE_STEP_BIG_M,
  NUDGE_STEP_M,
  ROTATE_STEP_DEG,
  TEMPLATES,
  buildItemForChip,
  clampCenterToRoom,
  initialEditorState,
  itemsInsideBox,
  reduce,
  resizeItem,
  snapToAlignment,
  snapToGrid,
  type AlignmentGuide,
  type BlueprintTemplate,
  type ResizeHandle,
  type TemplateId,
} from "../lib/blueprint/reducer.js";
import "./BlueprintPage.css";

// ---------------------------------------------------------------------------
// BlueprintPage — interactive 2D top-down floor-plan editor.
//
// Features (demo mode):
//   · Click-to-select, click-empty-to-deselect
//   · Pointer drag to move items (snap-to-grid on release)
//   · Drag from catalogue chips → drop into canvas adds a new item
//   · Keyboard:   Delete/Backspace  remove selected
//                 Esc               deselect
//                 Arrow keys        nudge 0.1 m (Shift: 1 m)
//                 R                 rotate selected 90°
//                 Ctrl/⌘+Z          undo
//                 Ctrl/⌘+Shift+Z    redo
//   · Live coordinate readout follows the cursor in world metres
//   · Guest count stepper with + and −
//   · Event-type pills toggle the scene state
//   · Dirty / saved indicator + a working "Send for quote" path
// ---------------------------------------------------------------------------

const INK = "#1a1a1a";
const INK_FAINT = "#8c8579";
const PAPER = "#f3ecdd";
const PAPER_DEEP = "#ede4d0";
const PAPER_SIDE = "#eee4cf";
const PAPER_RULE = "#d8cdb6";
const SHAPE_FILL = "#f1d9d0";
const SHAPE_OUTLINE = "#1a1a1a";
const ACCENT_RED = "#8c1f1f";
const ACCENT_RED_DEEP = "#6b1818";

const FONT_SANS = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const FONT_MONO = "'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace";

const CATALOGUE_MIME = "application/x-omnitwin-catalogue-kind";

export interface BlueprintPageProps {
  readonly source?: "demo" | "editor-store";
}

export function BlueprintPage(props: BlueprintPageProps = {}): ReactElement {
  const source = props.source ?? "demo";
  if (source === "editor-store") return <BlueprintFromStore />;
  return <BlueprintDemo />;
}

// ---------------------------------------------------------------------------
// Demo mode — fully interactive local state
// ---------------------------------------------------------------------------

const AUTOSAVE_KEY = "omnitwin:blueprint:demo:v1";

function BlueprintDemo(): ReactElement {
  const [state, dispatch] = useReducer(reduce, undefined, () => {
    // Hydrate from localStorage on mount if a saved draft exists.
    const restored = tryLoadSavedScene();
    if (restored !== null) return initialEditorState(restored, null);
    return initialEditorState(DEMO_SCENE, DEMO_SELECTED_ID);
  });
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState<boolean>(false);
  const [guides, setGuides] = useState<readonly AlignmentGuide[]>([]);
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const nextIdRef = useRef<number>(1);

  // Reset pan whenever the user zooms back to 1× — otherwise they'd see
  // an off-centre room with no obvious "recentre" control.
  useEffect(() => {
    if (zoom === 1 && (pan.x !== 0 || pan.y !== 0)) setPan({ x: 0, y: 0 });
  }, [zoom, pan.x, pan.y]);

  // Autosave on every scene mutation (debounced via a microtask so rapid
  // silent-move frames don't thrash localStorage).
  useEffect(() => {
    const handle = window.setTimeout(() => {
      try { window.localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(state.scene)); } catch { /* quota exceeded — skip */ }
    }, 300);
    return () => { window.clearTimeout(handle); };
  }, [state.scene]);

  useEffect(() => {
    const t = setInterval(() => { setNowMs(Date.now()); }, 60_000);
    return () => { clearInterval(t); };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const target = e.target as HTMLElement | null;
      if (target !== null && isTypingTarget(target)) return;
      const cmd = e.metaKey || e.ctrlKey;
      if (cmd && e.key.toLowerCase() === "z") {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? "redo" : "undo" });
        return;
      }
      if (cmd && e.key.toLowerCase() === "d") {
        e.preventDefault();
        const seed = nextIdRef.current;
        nextIdRef.current += 10;
        dispatch({ type: "duplicate-selected", idSeed: seed });
        return;
      }
      if (cmd && e.key.toLowerCase() === "a") {
        e.preventDefault();
        dispatch({ type: "select-all" });
        return;
      }
      // Zoom — `+` / `=` in / `-` out / `0` reset (desktop companions
      // to the pinch gesture on touch).
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        setZoom((z) => Math.min(4, z + 0.25));
        return;
      }
      if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        setZoom((z) => Math.max(0.5, z - 0.25));
        return;
      }
      if (e.key === "0" && !cmd) {
        e.preventDefault();
        setZoom(() => 1);
        return;
      }
      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        e.preventDefault();
        setHelpOpen((v) => !v);
        return;
      }
      if (e.key === "Escape") {
        setHelpOpen(false);
        dispatch({ type: "select", id: null });
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        dispatch({ type: "remove-selected" });
        return;
      }
      if (e.key.toLowerCase() === "r") {
        dispatch({ type: "rotate-selected", deltaDeg: ROTATE_STEP_DEG });
        return;
      }
      // Lock toggle — ⌘L / Ctrl+L (Figma-style).
      if (cmd && e.key.toLowerCase() === "l") {
        e.preventDefault();
        dispatch({ type: "toggle-lock" });
        return;
      }
      // Z-order — ] raise / [ lower; ⌘⇧ to send to extremes.
      if (e.key === "]") {
        e.preventDefault();
        dispatch({ type: cmd ? "raise-to-top" : "raise-selected" });
        return;
      }
      if (e.key === "[") {
        e.preventDefault();
        dispatch({ type: cmd ? "lower-to-bottom" : "lower-selected" });
        return;
      }
      const step = e.shiftKey ? NUDGE_STEP_BIG_M : NUDGE_STEP_M;
      if (e.key === "ArrowUp")    { e.preventDefault(); dispatch({ type: "nudge-selected", dx: 0, dy: -step }); return; }
      if (e.key === "ArrowDown")  { e.preventDefault(); dispatch({ type: "nudge-selected", dx: 0, dy: step });  return; }
      if (e.key === "ArrowLeft")  { e.preventDefault(); dispatch({ type: "nudge-selected", dx: -step, dy: 0 }); return; }
      if (e.key === "ArrowRight") { e.preventDefault(); dispatch({ type: "nudge-selected", dx: step, dy: 0 });  return; }
    }
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); };
  }, []);

  const selectedItem = useMemo<BlueprintItem | null>(() => {
    if (state.selectedId === null) return null;
    return state.scene.items.find((i) => i.id === state.selectedId) ?? null;
  }, [state.scene.items, state.selectedId]);

  const layers = useMemo(
    () => getLayerRows(state.scene, state.selectedIds),
    [state.scene, state.selectedIds],
  );

  const metrics = useMemo(() => computeStatusMetrics(state.scene), [state.scene]);

  const handleAddFromChip = useCallback((chip: CatalogueChip, center: { x: number; y: number }) => {
    const clamped = clampCenterToRoom(center, state.scene.room, chip.kind);
    const snappedCenter = { x: snapToGrid(clamped.x), y: snapToGrid(clamped.y) };
    const seed = nextIdRef.current;
    nextIdRef.current += 1;
    const item = buildItemForChip(chip, snappedCenter, seed);
    dispatch({ type: "add", item, select: true });
  }, [state.scene.room]);

  /**
   * Drag-path handler. The reducer only sees silent moves during an
   * active pointer drag — history is stamped once on release so undo/redo
   * step by drag, not by animation frame. Applies alignment snapping
   * against every other item so guides pull the dragged item into line.
   */
  const handleDragMove = useCallback((id: string, center: { x: number; y: number }) => {
    const dragged = state.scene.items.find((i) => i.id === id);
    const halfW = dragged !== undefined ? halfExtentW(dragged) : 0.9;
    const halfH = dragged !== undefined ? halfExtentH(dragged) : 0.9;
    const others = state.scene.items.filter((i) => i.id !== id);
    const aligned = snapToAlignment(center, halfW, halfH, others);
    const clamped = clampCenterToRoom(aligned.center, state.scene.room);
    setGuides(aligned.guides);
    dispatch({ type: "move-silent", id, center: clamped });
  }, [state.scene.items, state.scene.room]);

  const clearGuides = useCallback(() => { setGuides([]); }, []);

  const handleSendForQuote = useCallback(() => {
    dispatch({ type: "mark-saved" });
    setToast("Plan sent — our events team will respond within 24 hours.");
    window.setTimeout(() => { setToast(null); }, 3200);
  }, []);

  const handleApplyTemplate = useCallback((id: TemplateId) => {
    const seed = nextIdRef.current;
    nextIdRef.current += 200;
    dispatch({ type: "apply-template", templateId: id, idSeed: seed });
    setToast(`${id.charAt(0).toUpperCase() + id.slice(1)} layout applied — drag items to refine.`);
    window.setTimeout(() => { setToast(null); }, 2500);
  }, []);

  const handleDuplicate = useCallback(() => {
    const seed = nextIdRef.current;
    nextIdRef.current += 1;
    dispatch({ type: "duplicate-selected", idSeed: seed });
  }, []);

  const handleClear = useCallback(() => {
    dispatch({ type: "clear-scene" });
  }, []);

  const handleExportPng = useCallback(() => {
    const svg = document.querySelector<SVGSVGElement>(".bp-canvas svg");
    if (svg === null) return;
    void exportSvgAsPng(svg, `${state.scene.roomName.toLowerCase().replace(/\s+/g, "-")}-plan.png`);
  }, [state.scene.roomName]);

  const savedLabel = state.dirty
    ? "Unsaved changes"
    : `Saved ${relativeTimeShort(state.scene.lastSavedAtMs, nowMs)}`;

  // Tap-to-add fallback (touch devices where HTML5 DnD is unreliable):
  // catalogue chip tap places the item at the room centre.
  const handleTapAdd = useCallback((chip: CatalogueChip) => {
    handleAddFromChip(chip, {
      x: state.scene.room.widthM / 2,
      y: state.scene.room.lengthM / 2,
    });
  }, [handleAddFromChip, state.scene.room.widthM, state.scene.room.lengthM]);

  return (
    <div className="bp-root" style={shell}>
      <Chrome scene={state.scene} savedLabel={savedLabel} dirty={state.dirty} />
      <div className="bp-body" style={body}>
        <LeftSidebar
          scene={state.scene}
          onEventType={(t) => { dispatch({ type: "set-event-type", eventType: t }); }}
          onGuestsDelta={(d) => { dispatch({ type: "set-guests", guestCount: state.scene.guestCount + d }); }}
          onTapAdd={handleTapAdd}
          onApplyTemplate={handleApplyTemplate}
          onClear={handleClear}
          onOpenHelp={() => { setHelpOpen(true); }}
        />
        <CanvasPane
          scene={state.scene}
          selectedId={state.selectedId}
          selectedIds={state.selectedIds}
          onSelect={(id, opts) => {
            if (id === null) { dispatch({ type: "select", id: null }); return; }
            if (opts?.shift === true) { dispatch({ type: "toggle-select", id }); return; }
            dispatch({ type: "select", id });
          }}
          onMoveTo={handleDragMove}
          onDragStart={() => state.scene}
          onDragEnd={(preScene) => { dispatch({ type: "stamp-history", snapshot: preScene }); clearGuides(); }}
          onAddFromChip={handleAddFromChip}
          onCursor={setCursor}
          cursor={cursor}
          canUndo={state.past.length > 0}
          canRedo={state.future.length > 0}
          onUndo={() => { dispatch({ type: "undo" }); }}
          onRedo={() => { dispatch({ type: "redo" }); }}
          onRotateItem={(id) => { dispatch({ type: "select", id }); dispatch({ type: "rotate-selected", deltaDeg: ROTATE_STEP_DEG }); }}
          onRemoveItem={(id) => { dispatch({ type: "remove", id }); }}
          onResizeItem={(item) => { dispatch({ type: "replace-item-silent", item }); }}
          guides={guides}
          zoom={zoom}
          setZoom={setZoom}
          pan={pan}
          setPan={setPan}
        />
        <RightInspector
          scene={state.scene}
          selected={selectedItem}
          onRotate={() => { dispatch({ type: "rotate-selected", deltaDeg: ROTATE_STEP_DEG }); }}
          onRemove={() => { dispatch({ type: "remove-selected" }); }}
          onPatchItem={(item) => {
            dispatch({ type: "stamp-history", snapshot: state.scene });
            dispatch({ type: "replace-item-silent", item });
          }}
          onToggleLock={() => { dispatch({ type: "toggle-lock" }); }}
          onRaise={() => { dispatch({ type: "raise-selected" }); }}
          onLower={() => { dispatch({ type: "lower-selected" }); }}
          onRaiseToTop={() => { dispatch({ type: "raise-to-top" }); }}
          onLowerToBottom={() => { dispatch({ type: "lower-to-bottom" }); }}
          layers={layers}
          onSelectLayer={(id, additive) => {
            if (additive) {
              dispatch({ type: "toggle-select", id });
            } else {
              dispatch({ type: "select", id });
            }
          }}
          onToggleLayerLock={(id) => { dispatch({ type: "toggle-lock", id }); }}
          onReorderLayers={(ids) => { dispatch({ type: "set-items-order", ids }); }}
        />
      </div>
      <StatusBar metrics={metrics} onSendForQuote={handleSendForQuote} onExportPng={handleExportPng} />
      {toast !== null ? <Toast message={toast} /> : null}
      {helpOpen ? <KeyboardHelpOverlay onClose={() => { setHelpOpen(false); }} onDuplicate={handleDuplicate} /> : null}
    </div>
  );
}

function KeyboardHelpOverlay({ onClose, onDuplicate }: { onClose: () => void; onDuplicate: () => void }): ReactElement {
  return (
    <div role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" style={overlayStyle} onClick={onClose}>
      <div style={overlayCardStyle} onClick={(e) => { e.stopPropagation(); }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 500, fontFamily: FONT_SANS }}>Keyboard shortcuts</h2>
          <button type="button" onClick={onClose} style={{ background: "transparent", border: "none", color: INK_FAINT, fontSize: 16, cursor: "pointer" }} aria-label="Close">✕</button>
        </div>
        <HelpGroup title="Selection + movement">
          <HelpRow keys="Click" desc="Select an item" />
          <HelpRow keys="Esc" desc="Deselect" />
          <HelpRow keys="Drag" desc="Move an item (snaps to grid)" />
          <HelpRow keys="← → ↑ ↓" desc="Nudge selected 0.1 m" />
          <HelpRow keys="Shift + Arrows" desc="Nudge 1 m" />
          <HelpRow keys="R" desc="Rotate selected 90°" />
        </HelpGroup>
        <HelpGroup title="Adding + removing">
          <HelpRow keys="Drag chip" desc="Drop a new item on the canvas" />
          <HelpRow keys="Tap chip" desc="(touch) adds at room centre" />
          <HelpRow keys="Del / Backspace" desc="Remove selected" />
          <HelpRow keys="⌘D / Ctrl+D" desc="Duplicate selected" />
        </HelpGroup>
        <HelpGroup title="History">
          <HelpRow keys="⌘Z / Ctrl+Z" desc="Undo" />
          <HelpRow keys="⌘⇧Z / Ctrl+⇧Z" desc="Redo" />
        </HelpGroup>
        <HelpGroup title="Layers + lock">
          <HelpRow keys="⌘L / Ctrl+L" desc="Lock / unlock selected" />
          <HelpRow keys="]" desc="Raise one layer" />
          <HelpRow keys="[" desc="Lower one layer" />
          <HelpRow keys="⌘] / Ctrl+]" desc="Raise to top" />
          <HelpRow keys="⌘[ / Ctrl+[" desc="Lower to bottom" />
        </HelpGroup>
        <HelpGroup title="Touch">
          <HelpRow keys="Pinch" desc="Zoom 0.5× – 4×" />
          <HelpRow keys="Long-press" desc="Open item menu (Rotate / Remove)" />
        </HelpGroup>
        <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
          <button type="button" onClick={() => { onDuplicate(); onClose(); }} style={inspectorBtn}>Duplicate selected</button>
          <button type="button" onClick={onClose} style={{ ...inspectorBtn, background: INK, color: PAPER, borderColor: INK }}>Got it</button>
        </div>
      </div>
    </div>
  );
}

function HelpGroup({ title, children }: { title: string; children: ReactElement | ReactElement[] }): ReactElement {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ color: INK_FAINT, fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 6 }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>{children}</div>
    </div>
  );
}

function HelpRow({ keys, desc }: { keys: string; desc: string }): ReactElement {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, fontSize: 12 }}>
      <kbd style={{ fontFamily: FONT_MONO, color: INK, background: PAPER_DEEP, padding: "2px 8px", borderRadius: 3, border: `1px solid ${PAPER_RULE}` }}>{keys}</kbd>
      <span style={{ color: INK_FAINT, flex: 1, textAlign: "right" }}>{desc}</span>
    </div>
  );
}

/**
 * Rasterise an SVG to PNG and trigger a browser download. Uses the
 * DOM's built-in canvas pipeline so we don't need an external dep.
 * Not covered by unit tests (canvas APIs are stubs in happy-dom);
 * relies on manual + E2E verification.
 */
async function exportSvgAsPng(svg: SVGSVGElement, filename: string): Promise<void> {
  const EXPORT_SCALE = 2; // 2× pixel density → crisp on retina displays
  const bbox = svg.viewBox.baseVal;
  const vbW = bbox.width > 0 ? bbox.width : svg.clientWidth;
  const vbH = bbox.height > 0 ? bbox.height : svg.clientHeight;
  const serializer = new XMLSerializer();
  const source = serializer.serializeToString(svg);
  const withXmlns = source.includes("xmlns=") ? source : source.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  const blob = new Blob([withXmlns], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    const loaded = new Promise<void>((resolve, reject) => {
      img.onload = () => { resolve(); };
      img.onerror = () => { reject(new Error("svg image load failed")); };
    });
    img.src = url;
    await loaded;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(vbW * EXPORT_SCALE));
    canvas.height = Math.max(1, Math.round(vbH * EXPORT_SCALE));
    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new Error("no 2d context");
    ctx.fillStyle = "#f3ecdd"; // paper so transparent SVG areas aren't black
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const pngBlob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => { resolve(b); }, "image/png");
    });
    if (pngBlob === null) throw new Error("png encode failed");
    const pngUrl = URL.createObjectURL(pngBlob);
    const a = document.createElement("a");
    a.href = pngUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(pngUrl);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function isRoundTableItem(item: BlueprintItem): item is BlueprintItem & { shape: "round" } {
  return item.shape === "round";
}

/**
 * Minimap — a 160×80 ish overview of the whole room with every item
 * drawn in miniature. Appears only when the user is zoomed in (otherwise
 * the main canvas already shows the whole room). Click or drag inside to
 * recentre the pan.
 */
function Minimap(props: {
  scene: BlueprintScene;
  zoom: number;
  pan: { x: number; y: number };
  onRecenter: (worldPoint: { x: number; y: number }) => void;
}): ReactElement {
  const { scene, zoom, pan, onRecenter } = props;
  const MM_W = 180;
  const MM_H = Math.max(60, Math.round((MM_W * scene.room.lengthM) / scene.room.widthM));
  const sx = MM_W / scene.room.widthM;
  const sy = MM_H / scene.room.lengthM;

  const handle = (e: ReactPointerEvent<SVGSVGElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const worldX = px / sx;
    const worldY = py / sy;
    onRecenter({ x: worldX, y: worldY });
  };

  // Viewport rectangle: at the current zoom + pan, what portion of the
  // room is visible in the main canvas? Derived from the zoom factor + pan
  // offset, projected back into room-metre space. Approximate (ignores
  // canvas aspect vs room aspect) but good enough for an indicator.
  const viewW = scene.room.widthM / zoom;
  const viewH = scene.room.lengthM / zoom;
  const centreX = scene.room.widthM / 2 - (pan.x / (zoom * DEFAULT_PIXELS_PER_METRE));
  const centreY = scene.room.lengthM / 2 - (pan.y / (zoom * DEFAULT_PIXELS_PER_METRE));
  const vx = centreX - viewW / 2;
  const vy = centreY - viewH / 2;

  return (
    <svg
      viewBox={`0 0 ${String(MM_W)} ${String(MM_H)}`}
      width={MM_W}
      height={MM_H}
      style={minimapStyle}
      onPointerDown={handle}
      onPointerMove={(e) => { if (e.buttons !== 0) handle(e); }}
      role="img"
      aria-label="Minimap — click to recentre"
    >
      <rect x={0} y={0} width={MM_W} height={MM_H} fill={PAPER} />
      <rect x={0} y={0} width={MM_W} height={MM_H} fill="none" stroke={INK} strokeWidth={1} />
      {scene.items.map((item) => {
        if (item.shape === "round") {
          return (
            <circle
              key={item.id}
              cx={item.center.x * sx}
              cy={item.center.y * sy}
              r={(item.diameterM / 2) * ((sx + sy) / 2)}
              fill={SHAPE_FILL}
              stroke={INK}
              strokeWidth={0.5}
            />
          );
        }
        return (
          <rect
            key={item.id}
            x={item.topLeft.x * sx}
            y={item.topLeft.y * sy}
            width={item.widthM * sx}
            height={item.lengthM * sy}
            fill={item.kind === "dancefloor" ? INK : SHAPE_FILL}
            stroke={INK}
            strokeWidth={0.5}
          />
        );
      })}
      <rect
        x={vx * sx}
        y={vy * sy}
        width={viewW * sx}
        height={viewH * sy}
        fill="none"
        stroke={ACCENT_RED}
        strokeWidth={1.5}
        pointerEvents="none"
      />
    </svg>
  );
}

/**
 * Render small chair circles around every seat at a round table.
 *
 * When `item.chairs` is populated (BlueprintFromStore mode — chairs
 * grouped to the table in the 3D scene), each circle is drawn at its
 * actual metre-space position so the 2D view reflects the 3D auto-
 * arrange's wall-clearance offsets exactly. When `item.chairs` is
 * absent (BlueprintDemo mode, or a table without grouped chairs),
 * we fall back to a uniform algorithmic ring derived from `seats`.
 *
 * Visual only — not selectable — purely so a planner can see how each
 * table's capacity sits in the room.
 */
function ChairRing({ item, pxPerM }: { item: BlueprintItem & { shape: "round" }; pxPerM: number }): ReactElement {
  const tableR = metresToPixels(item.diameterM / 2, pxPerM);
  const chairR = Math.max(4, tableR * 0.18);
  const chairs: ReactElement[] = [];

  if (item.chairs !== undefined && item.chairs.length > 0) {
    item.chairs.forEach((p, i) => {
      const x = metresToPixels(p.x, pxPerM);
      const y = metresToPixels(p.y, pxPerM);
      chairs.push(
        <circle
          key={`chair-${String(i)}`}
          cx={x}
          cy={y}
          r={chairR}
          fill={PAPER_DEEP}
          stroke={INK_FAINT}
          strokeWidth={0.6}
          opacity={0.9}
        />,
      );
    });
    return <g pointerEvents="none">{chairs}</g>;
  }

  // Fallback: uniform ring derived from seat count.
  const cx = metresToPixels(item.center.x, pxPerM);
  const cy = metresToPixels(item.center.y, pxPerM);
  const ringR = tableR + chairR + 2;
  const n = Math.max(0, item.seats);
  for (let i = 0; i < n; i += 1) {
    const theta = (Math.PI * 2 * i) / Math.max(1, n) - Math.PI / 2;
    const x = cx + Math.cos(theta) * ringR;
    const y = cy + Math.sin(theta) * ringR;
    chairs.push(
      <circle
        key={`chair-${String(i)}`}
        cx={x}
        cy={y}
        r={chairR}
        fill={PAPER_DEEP}
        stroke={INK_FAINT}
        strokeWidth={0.6}
        opacity={0.9}
      />,
    );
  }
  return <g pointerEvents="none">{chairs}</g>;
}

function halfExtentW(item: BlueprintItem): number {
  if (item.shape === "round") return item.diameterM / 2;
  return item.widthM / 2;
}

function halfExtentH(item: BlueprintItem): number {
  if (item.shape === "round") return item.diameterM / 2;
  return item.lengthM / 2;
}

function isTypingTarget(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
}

/**
 * Best-effort hydrate of a saved demo scene from localStorage. Returns
 * null when nothing's saved, the payload's shape is unfamiliar, or storage
 * access throws (Safari private mode). Never throws.
 */
function tryLoadSavedScene(): BlueprintScene | null {
  try {
    const raw = window.localStorage.getItem(AUTOSAVE_KEY);
    if (raw === null || raw === "") return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return null;
    const maybe = parsed as Partial<BlueprintScene>;
    if (typeof maybe.roomName !== "string" || !Array.isArray(maybe.items)) return null;
    return parsed as BlueprintScene;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Store-backed variant — live from the 3D editor (selection sync + drag)
// ---------------------------------------------------------------------------

function BlueprintFromStore(): ReactElement {
  const space = useEditorStore((s) => s.space);
  const objects = useEditorStore((s) => s.objects);
  const lastSavedAt = useEditorStore((s) => s.lastSavedAt);
  const selectedObjectId = useEditorStore((s) => s.selectedObjectId);

  const [eventType, setEventType] = useState<EventType>("wedding");
  const [guestCount, setGuestCount] = useState<number>(() => Math.max(0, objects.length * 10));
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const t = setInterval(() => { setNowMs(Date.now()); }, 60_000);
    return () => { clearInterval(t); };
  }, []);

  const scene = useMemo<BlueprintScene>(() => adaptEditorStateToBlueprintScene({
    space, objects, lastSavedAt, eventType, guestCount, status: "draft",
  }), [space, objects, lastSavedAt, eventType, guestCount]);

  const selectedItem = useMemo<BlueprintItem | null>(() => {
    if (selectedObjectId === null) return null;
    return scene.items.find((i) => i.id === selectedObjectId) ?? null;
  }, [scene.items, selectedObjectId]);

  const layers = useMemo(
    () => getLayerRows(scene, selectedObjectId === null ? [] : [selectedObjectId]),
    [scene, selectedObjectId],
  );

  const metrics = useMemo(() => computeStatusMetrics(scene), [scene]);

  const handleSelect = (id: string | null): void => {
    const s = useEditorStore.getState();
    if (id === null) s.deselectObject(); else s.selectObject(id);
  };

  // Dispatch drag-to-move to the editor store so the 3D view reflects
  // the same change when you toggle back. When the moved item belongs
  // to a group (e.g. a round table with auto-arranged chairs sharing
  // its groupId), translate every group member by the same delta so
  // chairs travel with the table — the 2D view must move grouped
  // items as one body, matching 3D drag behaviour.
  const handleMoveTo = (id: string, center: { x: number; y: number }): void => {
    const s = useEditorStore.getState();
    const { positionX: newPositionX, positionZ: newPositionZ } =
      blueprintPointToEditorPosition(center, scene.room);

    const moved = s.objects.find((o) => o.id === id);
    if (moved === undefined) return;

    if (moved.groupId !== null) {
      const dx = newPositionX - moved.positionX;
      const dz = newPositionZ - moved.positionZ;
      const groupIds = new Set<string>();
      for (const o of s.objects) {
        if (o.groupId === moved.groupId) groupIds.add(o.id);
      }
      s.moveObjectsByDelta(groupIds, dx, dz);
      return;
    }

    s.updateObject(id, { positionX: newPositionX, positionZ: newPositionZ });
  };

  return (
    <div className="bp-root" style={shell}>
      <Chrome scene={scene} savedLabel={`Saved ${relativeTimeShort(scene.lastSavedAtMs, nowMs)}`} dirty={false} />
      <div className="bp-body" style={body}>
        <LeftSidebar
          scene={scene}
          onEventType={setEventType}
          onGuestsDelta={(d) => { setGuestCount((n) => Math.max(0, n + d)); }}
          onTapAdd={null}
          onApplyTemplate={null}
          onClear={null}
          onOpenHelp={null}
        />
        <CanvasPane
          scene={scene}
          selectedId={selectedObjectId}
          selectedIds={selectedObjectId === null ? EMPTY_IDS : [selectedObjectId]}
          onSelect={(id) => { handleSelect(id); }}
          onMoveTo={handleMoveTo}
          onAddFromChip={null}
          onCursor={setCursor}
          cursor={cursor}
          canUndo={false}
          canRedo={false}
          onUndo={noop}
          onRedo={noop}
          guides={EMPTY_GUIDES}
          zoom={1}
          setZoom={noop as Dispatch<SetStateAction<number>>}
          pan={EMPTY_PAN}
          setPan={noop as Dispatch<SetStateAction<{ x: number; y: number }>>}
        />
        <RightInspector
          scene={scene}
          selected={selectedItem}
          onRotate={noop}
          onRemove={noop}
          onPatchItem={null}
          onToggleLock={null}
          onRaise={null}
          onLower={null}
          onRaiseToTop={null}
          onLowerToBottom={null}
          layers={layers}
          onSelectLayer={(id) => { handleSelect(id); }}
          onToggleLayerLock={null}
          onReorderLayers={null}
        />
      </div>
      <StatusBar metrics={metrics} onSendForQuote={noop} onExportPng={null} />
    </div>
  );
}

const noop = (): void => { /* intentional */ };
const EMPTY_GUIDES: readonly AlignmentGuide[] = [];
const EMPTY_PAN = { x: 0, y: 0 };
const EMPTY_IDS: readonly string[] = [];

// ---------------------------------------------------------------------------
// Chrome
// ---------------------------------------------------------------------------

function Chrome({ scene, savedLabel, dirty }: { scene: BlueprintScene; savedLabel: string; dirty: boolean }): ReactElement {
  return (
    <div className="bp-chrome" style={chrome}>
      <div style={{ display: "flex", gap: 6 }}>
        <Dot color="#e0574f" />
        <Dot color="#e0b140" />
        <Dot color="#66b559" />
      </div>
      <div className="bp-chrome-title" style={{ flex: 1, textAlign: "center", color: INK, fontSize: 13, letterSpacing: 0.3 }}>
        <span style={{ fontWeight: 500 }}>{scene.roomName}</span>
        <span style={{ color: INK_FAINT, margin: "0 8px" }}>·</span>
        <span style={{ color: INK_FAINT }}>{scene.layoutName}</span>
        <span style={{ color: INK_FAINT, margin: "0 8px" }}>·</span>
        <span style={{ color: INK_FAINT, textTransform: "capitalize" }}>{scene.status}</span>
      </div>
      <div style={{
        color: dirty ? ACCENT_RED : INK_FAINT,
        fontSize: 11,
        letterSpacing: 0.8,
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}>
        {dirty ? "● " : ""}{savedLabel}
      </div>
    </div>
  );
}

function Dot({ color }: { color: string }): ReactElement {
  return <div style={{ width: 12, height: 12, borderRadius: 6, background: color }} />;
}

// ---------------------------------------------------------------------------
// Left sidebar
// ---------------------------------------------------------------------------

function LeftSidebar(props: {
  scene: BlueprintScene;
  onEventType: (t: EventType) => void;
  onGuestsDelta: (d: number) => void;
  onTapAdd: ((chip: CatalogueChip) => void) | null;
  onApplyTemplate: ((id: TemplateId) => void) | null;
  onClear: (() => void) | null;
  onOpenHelp: (() => void) | null;
}): ReactElement {
  const { scene, onEventType, onGuestsDelta, onTapAdd, onApplyTemplate, onClear, onOpenHelp } = props;
  return (
    <aside className="bp-left" style={leftPane}>
      <Section label="Room">
        <div style={selectControl}>
          <span style={{ fontWeight: 500 }}>{scene.roomName}</span>
          <span style={{ color: INK_FAINT }}>▾</span>
        </div>
      </Section>

      <Section label="Event type">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Pill active={scene.eventType === "wedding"} onClick={() => { onEventType("wedding"); }}>Wedding</Pill>
          <Pill active={scene.eventType === "gala"} onClick={() => { onEventType("gala"); }}>Gala</Pill>
          <Pill active={scene.eventType === "conference"} onClick={() => { onEventType("conference"); }}>Conference</Pill>
        </div>
      </Section>

      <Section label="Guests">
        <div style={stepper}>
          <button type="button" className="bp-stepper-btn" onClick={() => { onGuestsDelta(-5); }} style={stepperBtn} aria-label="Decrease guest count">−</button>
          <span style={{ fontWeight: 500 }}>{String(scene.guestCount)}</span>
          <button type="button" className="bp-stepper-btn" onClick={() => { onGuestsDelta(5); }} style={stepperBtn} aria-label="Increase guest count">+</button>
        </div>
      </Section>

      {onApplyTemplate !== null ? (
        <Section label="Templates">
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {TEMPLATES.map((t: BlueprintTemplate) => (
              <button
                key={t.id}
                type="button"
                onClick={() => { onApplyTemplate(t.id); }}
                style={templateBtn}
                title={t.description}
              >
                <b style={{ fontWeight: 500 }}>{t.label}</b>
                <span style={{ color: INK_FAINT, fontSize: 11, marginLeft: 6 }}>{t.description}</span>
              </button>
            ))}
            {onClear !== null ? (
              <button type="button" onClick={onClear} style={{ ...templateBtn, color: ACCENT_RED, borderColor: "rgba(140,31,31,0.25)" }}>
                Clear all items
              </button>
            ) : null}
          </div>
        </Section>
      ) : null}

      <Section label="Drag &amp; drop">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {DEFAULT_CATALOGUE.map((chip) => (
            <CatalogueButton key={chip.label} chip={chip} onTap={onTapAdd} />
          ))}
        </div>
        <span style={{ color: INK_FAINT, fontSize: 11, marginTop: 4, display: "block" }}>
          Drag a chip onto the canvas — or tap on touch devices.
        </span>
      </Section>

      {onOpenHelp !== null ? (
        <button type="button" onClick={onOpenHelp} style={helpBtn}>
          Keyboard shortcuts <span style={{ color: INK_FAINT }}>?</span>
        </button>
      ) : null}
    </aside>
  );
}

function Section({ label, children }: { label: string; children: ReactElement | ReactElement[] }): ReactElement {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <span style={sectionLabel}>{label}</span>
      {children}
    </div>
  );
}

function Pill({ children, active, onClick }: { children: string; active: boolean; onClick: () => void }): ReactElement {
  return (
    <button
      type="button"
      className="bp-pill"
      onClick={onClick}
      style={{
        ...pillBase,
        background: active ? INK : "transparent",
        color: active ? PAPER : INK,
        borderColor: active ? INK : "rgba(26,26,26,0.25)",
      }}
    >
      {children}
    </button>
  );
}

function CatalogueButton({ chip, onTap }: { chip: CatalogueChip; onTap: ((chip: CatalogueChip) => void) | null }): ReactElement {
  const onDragStart = (e: DragEvent<HTMLButtonElement>): void => {
    e.dataTransfer.setData(CATALOGUE_MIME, chip.kind);
    e.dataTransfer.setData("text/plain", chip.label);
    e.dataTransfer.effectAllowed = "copy";
  };
  const onClick = (): void => { if (onTap !== null) onTap(chip); };
  return (
    <button
      type="button"
      className="bp-chip-btn"
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      style={chipBtn}
      aria-label={`Add ${chip.label}`}
    >
      <CatalogueMarker marker={chip.marker} />
      <span>{chip.label}</span>
    </button>
  );
}

function CatalogueMarker({ marker }: { marker: CatalogueChip["marker"] }): ReactElement {
  const common: CSSProperties = { width: 14, height: 14, display: "inline-block" };
  switch (marker) {
    case "circle": return <span style={{ ...common, borderRadius: 7, border: `1.2px solid ${INK}` }} />;
    case "square-outline": return <span style={{ ...common, border: `1.2px solid ${INK}` }} />;
    case "square-filled": return <span style={{ ...common, background: INK }} />;
    case "bar": return <span style={{ ...common, height: 4, marginTop: 5, background: INK }} />;
    case "sparkle": return <span style={{ ...common, textAlign: "center", lineHeight: "14px", color: INK }}>✲</span>;
  }
}

// ---------------------------------------------------------------------------
// Canvas — SVG floor plan with full pointer + DnD wiring
// ---------------------------------------------------------------------------

interface CanvasPaneProps {
  readonly scene: BlueprintScene;
  readonly selectedId: string | null;
  readonly selectedIds: readonly string[];
  readonly onSelect: (id: string | null, opts?: { shift?: boolean }) => void;
  /**
   * Live position update while a pointer drag is in flight. Implementations
   * should NOT push history — commit a single snapshot via `onDragStart`
   * at the beginning and rely on `onDragEnd` to stamp it.
   */
  readonly onMoveTo: (id: string, center: { x: number; y: number }) => void;
  /** Snapshot the pre-drag scene so the reducer can stamp it on release. */
  readonly onDragStart?: () => BlueprintScene | null;
  /** Stamp the pre-drag snapshot onto history, coalescing the drag. */
  readonly onDragEnd?: (preScene: BlueprintScene) => void;
  readonly onAddFromChip: ((chip: CatalogueChip, center: { x: number; y: number }) => void) | null;
  readonly onCursor: (p: { x: number; y: number } | null) => void;
  readonly cursor: { x: number; y: number } | null;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onRotateItem?: (id: string) => void;
  readonly onRemoveItem?: (id: string) => void;
  /** Live-resize callback — dispatched per pointermove during a corner drag. */
  readonly onResizeItem?: (item: BlueprintItem) => void;
  /** Alignment guide lines active during the current drag (snap-to-other-items). */
  readonly guides: readonly AlignmentGuide[];
  /** Current zoom level (lifted so keyboard + pinch can both drive it). */
  readonly zoom: number;
  readonly setZoom: Dispatch<SetStateAction<number>>;
  /** Pan offset in CSS px, only meaningful when zoom > 1. */
  readonly pan: { x: number; y: number };
  readonly setPan: Dispatch<SetStateAction<{ x: number; y: number }>>;
}

const PINCH_MIN_ZOOM = 0.5;
const PINCH_MAX_ZOOM = 4;
const LONG_PRESS_MS = 550;
const LONG_PRESS_SLOP_PX = 6;

function CanvasPane(props: CanvasPaneProps): ReactElement {
  const { scene, selectedId, selectedIds, onSelect, onMoveTo, onDragStart, onDragEnd, onAddFromChip, onCursor, cursor, canUndo, canRedo, onUndo, onRedo, onRotateItem, onRemoveItem, onResizeItem, guides, zoom, setZoom, pan, setPan } = props;
  const pxPerM = DEFAULT_PIXELS_PER_METRE;
  const roomWidthPx = metresToPixels(scene.room.widthM, pxPerM);
  const roomHeightPx = metresToPixels(scene.room.lengthM, pxPerM);
  const PAD = 50;
  const vbW = roomWidthPx + PAD * 2;
  const vbH = roomHeightPx + PAD * 2;

  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragState, setDragState] = useState<{ id: string; offsetX: number; offsetY: number; preScene: BlueprintScene | null } | null>(null);
  const [resizeState, setResizeState] = useState<
    | { id: string; mode: "corner"; handle: ResizeHandle; preScene: BlueprintScene | null }
    | { id: string; mode: "radius"; preScene: BlueprintScene | null }
    | null
  >(null);

  // Pinch-to-zoom (two concurrent pointers → scale the SVG via CSS transform).
  // `zoom` + `setZoom` now come from props so keyboard shortcuts higher up
  // can drive the same state. Pinch tracking stays local to this component.
  const pinchRef = useRef<{ startDist: number; startZoom: number } | null>(null);
  const activePointers = useRef<Map<number, { x: number; y: number }>>(new Map());

  // Long-press context menu (550 ms hold on an item → floating menu).
  const [menu, setMenu] = useState<{ id: string; clientX: number; clientY: number } | null>(null);
  const longPressRef = useRef<{ timer: number; startX: number; startY: number } | null>(null);

  // Pan-drag state: engaged only when zoom > 1 and the gesture started on
  // empty stage (not on an item). Tracks the starting pan offset + pointer
  // position so motion is relative.
  const panRef = useRef<{ startPan: { x: number; y: number }; startClient: { x: number; y: number } } | null>(null);

  // Rubber-band box selection. Engaged when the user drags on empty
  // canvas at 1× zoom. State holds the world-space start point + the
  // current end point so we can render a rectangle and, on release,
  // compute which items were enclosed.
  const [rubberBand, setRubberBand] = useState<{ start: { x: number; y: number }; end: { x: number; y: number }; additive: boolean } | null>(null);

  const cancelLongPress = useCallback(() => {
    if (longPressRef.current !== null) {
      window.clearTimeout(longPressRef.current.timer);
      longPressRef.current = null;
    }
  }, []);

  const clientToWorld = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    const svg = svgRef.current;
    if (svg === null) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (ctm === null) return null;
    const local = pt.matrixTransform(ctm.inverse());
    return { x: (local.x - PAD) / pxPerM, y: (local.y - PAD) / pxPerM };
  }, [pxPerM]);

  const onStagePointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    // Track active pointers for pinch detection.
    if (activePointers.current.has(e.pointerId)) {
      activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    // Rubber-band drag takes priority when engaged (zoom 1, empty-canvas gesture).
    if (rubberBand !== null) {
      const w = clientToWorld(e.clientX, e.clientY);
      if (w !== null) setRubberBand((rb) => rb === null ? null : { ...rb, end: w });
      return;
    }
    // Pan drag takes priority when engaged — zoom > 1 single-finger
    // gesture on empty stage.
    if (panRef.current !== null) {
      const dx = e.clientX - panRef.current.startClient.x;
      const dy = e.clientY - panRef.current.startClient.y;
      setPan({
        x: panRef.current.startPan.x + dx,
        y: panRef.current.startPan.y + dy,
      });
      return;
    }
    // Pinch math: when exactly 2 pointers are active, compute their current
    // distance and derive a new zoom factor from the initial gesture state.
    if (activePointers.current.size === 2 && pinchRef.current !== null) {
      const pts = Array.from(activePointers.current.values());
      const a = pts[0];
      const b = pts[1];
      if (a !== undefined && b !== undefined) {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const ratio = dist / pinchRef.current.startDist;
        const next = Math.max(PINCH_MIN_ZOOM, Math.min(PINCH_MAX_ZOOM, pinchRef.current.startZoom * ratio));
        setZoom(next);
      }
      return;
    }
    const w = clientToWorld(e.clientX, e.clientY);
    onCursor(w);
  }, [clientToWorld, onCursor, rubberBand, setPan]);

  const onStagePointerDownCapture = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePointers.current.size === 2) {
      const pts = Array.from(activePointers.current.values());
      const a = pts[0];
      const b = pts[1];
      if (a !== undefined && b !== undefined) {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        pinchRef.current = { startDist: dist || 1, startZoom: zoom };
        // Cancel any in-flight item drag + long-press once the user
        // switches to a pinch gesture.
        setDragState(null);
        cancelLongPress();
      }
    }
  }, [cancelLongPress, zoom]);

  const onStagePointerUpCapture = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    activePointers.current.delete(e.pointerId);
    if (activePointers.current.size < 2) {
      pinchRef.current = null;
    }
  }, []);

  const onStagePointerLeave = useCallback(() => { onCursor(null); cancelLongPress(); }, [cancelLongPress, onCursor]);

  const onDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (onAddFromChip === null) return;
    const kind = e.dataTransfer.getData(CATALOGUE_MIME);
    if (kind === "") return;
    const chip = DEFAULT_CATALOGUE.find((c) => c.kind === (kind as ItemKind));
    if (chip === undefined) return;
    const w = clientToWorld(e.clientX, e.clientY);
    if (w === null) return;
    onAddFromChip(chip, w);
  }, [clientToWorld, onAddFromChip]);

  const onDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (onAddFromChip === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, [onAddFromChip]);

  const handleItemPointerDown = useCallback((item: BlueprintItem, e: ReactPointerEvent<SVGGElement>) => {
    e.stopPropagation();
    onSelect(item.id, { shift: e.shiftKey });
    setMenu(null);
    const w = clientToWorld(e.clientX, e.clientY);
    if (w === null) return;
    const itemCenter = item.shape === "round"
      ? item.center
      : { x: item.topLeft.x + item.widthM / 2, y: item.topLeft.y + item.lengthM / 2 };
    const preScene = onDragStart !== undefined ? onDragStart() : null;
    setDragState({
      id: item.id,
      offsetX: w.x - itemCenter.x,
      offsetY: w.y - itemCenter.y,
      preScene,
    });
    try { (e.currentTarget as unknown as Element).setPointerCapture(e.pointerId); } catch { /* ignore */ }

    // Start long-press timer. If the pointer moves more than LONG_PRESS_SLOP_PX
    // or lifts before LONG_PRESS_MS, we cancel it. Otherwise the menu opens.
    cancelLongPress();
    const startX = e.clientX;
    const startY = e.clientY;
    const itemId = item.id;
    const timer = window.setTimeout(() => {
      longPressRef.current = null;
      // Small haptic tick on touch devices (iOS ignores this; Android + some
      // desktops honour it). Wrapped because `navigator.vibrate` is typed as
      // optional and can throw in iframes.
      try {
        const nav = navigator as { vibrate?: (pattern: number | number[]) => boolean };
        if (typeof nav.vibrate === "function") nav.vibrate(10);
      } catch { /* ignore */ }
      setMenu({ id: itemId, clientX: startX, clientY: startY });
    }, LONG_PRESS_MS);
    longPressRef.current = { timer, startX, startY };
  }, [cancelLongPress, clientToWorld, onDragStart, onSelect]);

  const handleItemPointerMove = useCallback((e: ReactPointerEvent<SVGGElement>) => {
    if (dragState === null) return;
    // Cancel long-press once the user actually moves past the slop threshold.
    if (longPressRef.current !== null) {
      const dx = Math.abs(e.clientX - longPressRef.current.startX);
      const dy = Math.abs(e.clientY - longPressRef.current.startY);
      if (dx > LONG_PRESS_SLOP_PX || dy > LONG_PRESS_SLOP_PX) cancelLongPress();
    }
    const w = clientToWorld(e.clientX, e.clientY);
    if (w === null) return;
    onMoveTo(dragState.id, { x: w.x - dragState.offsetX, y: w.y - dragState.offsetY });
  }, [cancelLongPress, clientToWorld, dragState, onMoveTo]);

  const handleItemPointerUp = useCallback((e: ReactPointerEvent<SVGGElement>) => {
    cancelLongPress();
    if (dragState === null) return;
    // On release, stamp the pre-drag scene onto history so the whole drag
    // coalesces into a single undo step. Skipped when the caller didn't
    // provide a drag-start snapshot (store-mode reads don't push history).
    if (dragState.preScene !== null && onDragEnd !== undefined) {
      onDragEnd(dragState.preScene);
    }
    setDragState(null);
    try { (e.currentTarget as unknown as Element).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }, [cancelLongPress, dragState, onDragEnd]);

  // -------- corner-resize handlers (rect items only) --------
  const handleResizeStart = useCallback((id: string, handle: ResizeHandle, e: ReactPointerEvent<SVGRectElement>) => {
    e.stopPropagation();
    const preScene = onDragStart !== undefined ? onDragStart() : null;
    setResizeState({ id, mode: "corner", handle, preScene });
    try { (e.currentTarget as unknown as Element).setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }, [onDragStart]);

  const handleRadiusStart = useCallback((id: string, e: ReactPointerEvent<SVGRectElement>) => {
    e.stopPropagation();
    const preScene = onDragStart !== undefined ? onDragStart() : null;
    setResizeState({ id, mode: "radius", preScene });
    try { (e.currentTarget as unknown as Element).setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }, [onDragStart]);

  const handleResizePointerMove = useCallback((e: ReactPointerEvent<SVGRectElement>) => {
    if (resizeState === null) return;
    if (onResizeItem === undefined) return;
    const w = clientToWorld(e.clientX, e.clientY);
    if (w === null) return;
    const target = scene.items.find((i) => i.id === resizeState.id);
    if (target === undefined) return;
    if (resizeState.mode === "corner" && target.shape !== "round") {
      onResizeItem(resizeItem(target, resizeState.handle, w));
      return;
    }
    if (resizeState.mode === "radius" && target.shape === "round") {
      const dx = w.x - target.center.x;
      const dy = w.y - target.center.y;
      const newRadius = Math.max(0.3, Math.sqrt(dx * dx + dy * dy));
      onResizeItem({ ...target, diameterM: newRadius * 2 });
    }
  }, [clientToWorld, onResizeItem, resizeState, scene.items]);

  const handleResizePointerUp = useCallback((e: ReactPointerEvent<SVGRectElement>) => {
    if (resizeState === null) return;
    if (resizeState.preScene !== null && onDragEnd !== undefined) {
      onDragEnd(resizeState.preScene);
    }
    setResizeState(null);
    try { (e.currentTarget as unknown as Element).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }, [onDragEnd, resizeState]);

  const onStageBackgroundClick = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    // When zoomed in, a drag on empty canvas pans; otherwise a drag
    // draws a rubber-band selection rectangle. A plain click (no move)
    // still deselects via the pointer-up handler.
    if (zoom > 1) {
      panRef.current = { startPan: pan, startClient: { x: e.clientX, y: e.clientY } };
      try { (e.currentTarget as unknown as Element).setPointerCapture(e.pointerId); } catch { /* ignore */ }
      return;
    }
    const w = clientToWorld(e.clientX, e.clientY);
    if (w === null) { onSelect(null); return; }
    setRubberBand({ start: w, end: w, additive: e.shiftKey });
    try { (e.currentTarget as unknown as Element).setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }, [clientToWorld, onSelect, pan, zoom]);

  const onStagePointerUpPan = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    // Rubber-band commit first — if engaged, compute the selection set.
    if (rubberBand !== null) {
      const dx = Math.abs(rubberBand.end.x - rubberBand.start.x);
      const dy = Math.abs(rubberBand.end.y - rubberBand.start.y);
      setRubberBand(null);
      try { (e.currentTarget as unknown as Element).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      if (dx < 0.05 && dy < 0.05) {
        // Treat as a plain click — deselect.
        if (!rubberBand.additive) onSelect(null);
        return;
      }
      const box = {
        left: rubberBand.start.x, right: rubberBand.end.x,
        top: rubberBand.start.y, bottom: rubberBand.end.y,
      };
      const hitIds = itemsInsideBox(scene.items, box);
      if (rubberBand.additive) {
        // Additive: union existing selection with hits.
        const union = Array.from(new Set([...selectedIds, ...hitIds]));
        // Using `onSelect` twice wouldn't work — we need an atomic set.
        // The parent gets this by passing a `select-ids` equivalent via
        // `onSelect(id, { shift })`. Workaround: fall back to dispatching
        // toggles for each hit.
        for (const id of hitIds) {
          if (!selectedIds.includes(id)) onSelect(id, { shift: true });
        }
        void union;
      } else {
        // Replace selection with hits (first hit as primary).
        onSelect(hitIds[0] ?? null);
        for (let i = 1; i < hitIds.length; i += 1) {
          const id = hitIds[i];
          if (id !== undefined) onSelect(id, { shift: true });
        }
      }
      return;
    }
    if (panRef.current === null) return;
    const dx = Math.abs(e.clientX - panRef.current.startClient.x);
    const dy = Math.abs(e.clientY - panRef.current.startClient.y);
    const wasClickNotDrag = dx < 4 && dy < 4;
    panRef.current = null;
    try { (e.currentTarget as unknown as Element).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (wasClickNotDrag) onSelect(null);
  }, [onSelect, rubberBand, scene.items, selectedIds]);

  return (
    <div
      className="bp-canvas"
      style={canvasPane}
      onPointerMove={onStagePointerMove}
      onPointerLeave={onStagePointerLeave}
      onPointerDown={(e) => { onStagePointerDownCapture(e); onStageBackgroundClick(e); }}
      onPointerUp={(e) => { onStagePointerUpCapture(e); onStagePointerUpPan(e); }}
      onPointerCancel={(e) => { onStagePointerUpCapture(e); onStagePointerUpPan(e); }}
      onWheel={(e) => {
        // Ctrl/⌘+wheel zooms the canvas without scrolling the page —
        // matches the ergonomics of most design tools. Plain wheel
        // lets the page scroll normally.
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        const step = e.deltaY > 0 ? -0.1 : 0.1;
        setZoom((z) => Math.max(0.5, Math.min(4, z + step)));
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <CanvasToolbar
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={onUndo}
        onRedo={onRedo}
        zoom={zoom}
        onZoomIn={() => { setZoom((z) => Math.min(PINCH_MAX_ZOOM, z + 0.25)); }}
        onZoomOut={() => { setZoom((z) => Math.max(PINCH_MIN_ZOOM, z - 0.25)); }}
        onZoomReset={() => { setZoom(1); }}
      />
      <CoordReadout cursor={cursor} />
      <svg
        ref={svgRef}
        viewBox={`0 0 ${String(vbW)} ${String(vbH)}`}
        style={{
          width: "100%",
          height: "100%",
          display: "block",
          transform: zoom === 1 && pan.x === 0 && pan.y === 0
            ? undefined
            : `translate(${String(pan.x)}px, ${String(pan.y)}px) scale(${String(zoom)})`,
          transformOrigin: "center center",
          transition: pinchRef.current === null && panRef.current === null ? "transform 0.12s ease" : "none",
          cursor: panRef.current !== null ? "grabbing" : zoom > 1 ? "grab" : "default",
        }}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <pattern id="grid" width={pxPerM} height={pxPerM} patternUnits="userSpaceOnUse">
            <path d={`M ${String(pxPerM)} 0 L 0 0 0 ${String(pxPerM)}`} fill="none" stroke={PAPER_RULE} strokeWidth={0.5} />
          </pattern>
          <pattern id="hatch" width={10} height={10} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={10} stroke={PAPER_RULE} strokeWidth={1} />
          </pattern>
        </defs>

        <rect x={0} y={0} width={vbW} height={vbH} fill={PAPER} />
        <rect x={0} y={0} width={vbW} height={vbH} fill="url(#grid)" opacity={0.7} />

        <g transform={`translate(${String(PAD)},${String(PAD)})`}>
          <rect x={0} y={0} width={roomWidthPx} height={roomHeightPx} fill="url(#hatch)" opacity={0.55} />
          <rect x={0} y={0} width={roomWidthPx} height={roomHeightPx} fill="none" stroke={INK} strokeWidth={2.2} />

          {(scene.room.doors ?? []).map((door, i) => {
            const p = doorPoint(door.wall, door.distanceM, scene.room);
            return (
              <circle
                key={`door-${String(i)}`}
                cx={metresToPixels(p.x, pxPerM)}
                cy={metresToPixels(p.y, pxPerM)}
                r={6}
                fill={INK_FAINT}
              />
            );
          })}

          {(scene.room.labels ?? []).map((label, i) => (
            <text
              key={`label-${String(i)}`}
              x={metresToPixels(label.position.x, pxPerM)}
              y={metresToPixels(label.position.y, pxPerM)}
              fontFamily={FONT_MONO}
              fontSize={10}
              letterSpacing={1.5}
              fill={INK_FAINT}
            >
              {label.text}
            </text>
          ))}

          {/* Chairs — drawn BEHIND the tables so labels stay legible. */}
          {scene.items.filter(isRoundTableItem).map((item) => (
            <ChairRing key={`chairs-${item.id}`} item={item} pxPerM={pxPerM} />
          ))}

          {scene.items.map((item) => (
            <ItemShape
              key={item.id}
              item={item}
              selected={selectedIds.includes(item.id)}
              dragging={dragState?.id === item.id}
              onSelect={() => { onSelect(item.id); }}
              onPointerDown={(e) => { handleItemPointerDown(item, e); }}
              onPointerMove={handleItemPointerMove}
              onPointerUp={handleItemPointerUp}
              pxPerM={pxPerM}
            />
          ))}
          {/* Lock glyphs — rendered above items so the affordance is visible
              regardless of selection or drag state. */}
          {scene.items.filter((it) => it.locked === true).map((item) => (
            <LockGlyph key={`lock-${item.id}`} item={item} pxPerM={pxPerM} />
          ))}
          {/* Radius handle — for the selected round table only. */}
          {(() => {
            const selected = scene.items.find((i) => i.id === selectedId);
            if (selected === undefined || selected.shape !== "round") return null;
            const cx = metresToPixels(selected.center.x, pxPerM);
            const cy = metresToPixels(selected.center.y, pxPerM);
            const r = metresToPixels(selected.diameterM / 2, pxPerM);
            return (
              <rect
                x={cx + r - 5}
                y={cy - 5}
                width={10}
                height={10}
                fill={PAPER}
                stroke={ACCENT_RED}
                strokeWidth={1.5}
                style={{ cursor: "ew-resize" }}
                onPointerDown={(e) => { handleRadiusStart(selected.id, e); }}
                onPointerMove={handleResizePointerMove}
                onPointerUp={handleResizePointerUp}
              />
            );
          })()}
          {/* Corner resize handles — only for the selected rect item. */}
          {(() => {
            const selected = scene.items.find((i) => i.id === selectedId);
            if (selected === undefined || selected.shape === "round") return null;
            const x = metresToPixels(selected.topLeft.x, pxPerM);
            const y = metresToPixels(selected.topLeft.y, pxPerM);
            const w = metresToPixels(selected.widthM, pxPerM);
            const h = metresToPixels(selected.lengthM, pxPerM);
            const handles: { handle: ResizeHandle; cx: number; cy: number; cursor: string }[] = [
              { handle: "nw", cx: x, cy: y, cursor: "nwse-resize" },
              { handle: "ne", cx: x + w, cy: y, cursor: "nesw-resize" },
              { handle: "sw", cx: x, cy: y + h, cursor: "nesw-resize" },
              { handle: "se", cx: x + w, cy: y + h, cursor: "nwse-resize" },
            ];
            return (
              <g>
                {handles.map((H) => (
                  <rect
                    key={H.handle}
                    x={H.cx - 5}
                    y={H.cy - 5}
                    width={10}
                    height={10}
                    fill={PAPER}
                    stroke={ACCENT_RED}
                    strokeWidth={1.5}
                    style={{ cursor: H.cursor }}
                    onPointerDown={(e) => { handleResizeStart(selected.id, H.handle, e); }}
                    onPointerMove={handleResizePointerMove}
                    onPointerUp={handleResizePointerUp}
                  />
                ))}
              </g>
            );
          })()}
          {/* Rubber-band selection rectangle (while a box drag is in flight). */}
          {rubberBand !== null ? (() => {
            const left = Math.min(rubberBand.start.x, rubberBand.end.x);
            const top = Math.min(rubberBand.start.y, rubberBand.end.y);
            const w = Math.abs(rubberBand.end.x - rubberBand.start.x);
            const h = Math.abs(rubberBand.end.y - rubberBand.start.y);
            return (
              <rect
                x={metresToPixels(left, pxPerM)}
                y={metresToPixels(top, pxPerM)}
                width={metresToPixels(w, pxPerM)}
                height={metresToPixels(h, pxPerM)}
                fill={ACCENT_RED}
                fillOpacity={0.08}
                stroke={ACCENT_RED}
                strokeWidth={1.2}
                strokeDasharray="4 4"
                pointerEvents="none"
              />
            );
          })() : null}
          {/* Alignment guide lines — only shown while a drag snaps to another item. */}
          {guides.map((g, i) => (
            g.axis === "x" ? (
              <line
                key={`guide-${String(i)}`}
                x1={metresToPixels(g.value, pxPerM)}
                x2={metresToPixels(g.value, pxPerM)}
                y1={-PAD}
                y2={roomHeightPx + PAD}
                stroke={ACCENT_RED}
                strokeWidth={1.2}
                strokeDasharray="4 4"
                opacity={0.7}
                pointerEvents="none"
              />
            ) : (
              <line
                key={`guide-${String(i)}`}
                y1={metresToPixels(g.value, pxPerM)}
                y2={metresToPixels(g.value, pxPerM)}
                x1={-PAD}
                x2={roomWidthPx + PAD}
                stroke={ACCENT_RED}
                strokeWidth={1.2}
                strokeDasharray="4 4"
                opacity={0.7}
                pointerEvents="none"
              />
            )
          ))}
        </g>
      </svg>
      {zoom !== 1 ? (
        <div style={zoomBadge}>
          {`${String(Math.round(zoom * 100))}%`}
          <button type="button" onClick={() => { setZoom(1); }} style={zoomResetBtn} aria-label="Reset zoom">⤺</button>
        </div>
      ) : null}
      {zoom > 1 ? (
        <Minimap
          scene={scene}
          zoom={zoom}
          pan={pan}
          onRecenter={(worldPoint) => {
            // Recentre: compute the pan offset that puts this world
            // point at the viewport centre.
            const dx = (scene.room.widthM / 2 - worldPoint.x) * pxPerM * zoom;
            const dy = (scene.room.lengthM / 2 - worldPoint.y) * pxPerM * zoom;
            setPan({ x: dx, y: dy });
          }}
        />
      ) : null}
      {menu !== null ? (
        <ItemContextMenu
          clientX={menu.clientX}
          clientY={menu.clientY}
          onRotate={() => {
            if (onRotateItem !== undefined) onRotateItem(menu.id);
            setMenu(null);
          }}
          onRemove={() => {
            if (onRemoveItem !== undefined) onRemoveItem(menu.id);
            setMenu(null);
          }}
          onClose={() => { setMenu(null); }}
        />
      ) : null}
    </div>
  );
}

function ItemContextMenu(props: { clientX: number; clientY: number; onRotate: () => void; onRemove: () => void; onClose: () => void }): ReactElement {
  const { clientX, clientY, onRotate, onRemove, onClose } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); };
  }, [onClose]);
  return (
    <>
      <div
        onPointerDown={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 40 }}
        aria-hidden="true"
      />
      <div
        role="menu"
        style={{
          position: "fixed",
          top: Math.min(clientY + 8, window.innerHeight - 120),
          left: Math.min(clientX + 8, window.innerWidth - 180),
          minWidth: 160,
          background: PAPER,
          border: `1px solid ${PAPER_RULE}`,
          borderRadius: 6,
          boxShadow: "0 12px 30px -12px rgba(20,10,0,0.3)",
          zIndex: 41,
          padding: 4,
          fontFamily: FONT_SANS,
          fontSize: 13,
        }}
      >
        <button type="button" onClick={onRotate} style={menuItemStyle}>Rotate 90°</button>
        <button type="button" onClick={onRemove} style={{ ...menuItemStyle, color: ACCENT_RED }}>Remove</button>
      </div>
    </>
  );
}

function CanvasToolbar(props: {
  canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void;
  zoom: number; onZoomIn: () => void; onZoomOut: () => void; onZoomReset: () => void;
}): ReactElement {
  const { canUndo, canRedo, onUndo, onRedo, zoom, onZoomIn, onZoomOut, onZoomReset } = props;
  return (
    <div style={toolbarWrap}>
      <div style={toolGroup}>
        <ToolBtn active title="Select (V)">✛</ToolBtn>
        <ToolBtn title="Undo (⌘Z)" disabled={!canUndo} onClick={onUndo}>⟲</ToolBtn>
        <ToolBtn title="Redo (⌘⇧Z)" disabled={!canRedo} onClick={onRedo}>⟳</ToolBtn>
      </div>
      <div style={{ ...toolGroup, marginLeft: 6 }}>
        <ToolBtn title="Zoom out" disabled={zoom <= 0.5} onClick={onZoomOut}>−</ToolBtn>
        <ToolBtn title="Reset zoom" onClick={onZoomReset}>{`${String(Math.round(zoom * 100))}%`}</ToolBtn>
        <ToolBtn title="Zoom in" disabled={zoom >= 4} onClick={onZoomIn}>+</ToolBtn>
      </div>
    </div>
  );
}

function ToolBtn({ children, active, onClick, title, disabled }: { children: string; active?: boolean; onClick?: () => void; title?: string; disabled?: boolean }): ReactElement {
  return (
    <button
      type="button"
      className="bp-tool-btn"
      onClick={onClick}
      title={title}
      disabled={disabled}
      style={{
        ...toolBtn,
        background: active === true ? INK : "transparent",
        color: active === true ? PAPER : INK,
        opacity: disabled === true ? 0.35 : 1,
        cursor: disabled === true ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

function CoordReadout({ cursor }: { cursor: { x: number; y: number } | null }): ReactElement {
  const x = cursor !== null ? cursor.x.toFixed(1) : "—";
  const y = cursor !== null ? cursor.y.toFixed(1) : "—";
  return (
    <div style={coordReadout}>
      X {x} · Y {y} · {DEFAULT_SCALE_LABEL}
    </div>
  );
}

interface ItemShapeProps {
  readonly item: BlueprintItem;
  readonly selected: boolean;
  readonly dragging: boolean;
  readonly onSelect: () => void;
  readonly onPointerDown: (e: ReactPointerEvent<SVGGElement>) => void;
  readonly onPointerMove: (e: ReactPointerEvent<SVGGElement>) => void;
  readonly onPointerUp: (e: ReactPointerEvent<SVGGElement>) => void;
  readonly pxPerM: number;
}

/**
 * Small padlock glyph drawn above a locked item. Uses the item's visual
 * centre in metres and renders at a fixed pixel size so it stays readable
 * at any zoom level. Pure SVG — no emoji dependency.
 */
function LockGlyph({ item, pxPerM }: { item: BlueprintItem; pxPerM: number }): ReactElement {
  const cx = item.shape === "round"
    ? metresToPixels(item.center.x, pxPerM)
    : metresToPixels(item.topLeft.x + item.widthM / 2, pxPerM);
  const cy = item.shape === "round"
    ? metresToPixels(item.center.y, pxPerM)
    : metresToPixels(item.topLeft.y + item.lengthM / 2, pxPerM);
  // Padlock at 14×18 px, centred on (cx, cy).
  const bodyW = 12;
  const bodyH = 10;
  const shackleR = 4;
  const left = cx - bodyW / 2;
  const top = cy - bodyH / 2 + 2; // nudge down so shackle fits above
  return (
    <g pointerEvents="none" aria-hidden>
      <rect x={left - 1} y={top - 1} width={bodyW + 2} height={bodyH + 2} fill={PAPER} opacity={0.85} rx={2} />
      <rect x={left} y={top} width={bodyW} height={bodyH} fill={INK} rx={1.5} />
      <path
        d={`M ${String(cx - shackleR)} ${String(top)} v -2 a ${String(shackleR)} ${String(shackleR)} 0 0 1 ${String(shackleR * 2)} 0 v 2`}
        fill="none"
        stroke={INK}
        strokeWidth={1.5}
      />
      <circle cx={cx} cy={top + bodyH / 2} r={1.3} fill={PAPER} />
    </g>
  );
}

function ItemShape(props: ItemShapeProps): ReactElement {
  const { item, selected, dragging, onSelect, onPointerDown, onPointerMove, onPointerUp, pxPerM } = props;
  const groupStyle: CSSProperties = {
    cursor: dragging ? "grabbing" : "grab",
    opacity: dragging ? 0.9 : 1,
    touchAction: "none",
  };

  if (item.shape === "round") {
    const cx = metresToPixels(item.center.x, pxPerM);
    const cy = metresToPixels(item.center.y, pxPerM);
    const r = metresToPixels(item.diameterM / 2, pxPerM);
    return (
      <g
        className="bp-furn"
        style={groupStyle}
        onClick={onSelect}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {selected ? <circle cx={cx} cy={cy} r={r + 3} fill="none" stroke={ACCENT_RED} strokeWidth={2.5} /> : null}
        <circle cx={cx} cy={cy} r={r} fill={SHAPE_FILL} stroke={SHAPE_OUTLINE} strokeWidth={1} />
        <text x={cx} y={cy + 4} textAnchor="middle" fontFamily={FONT_MONO} fontSize={11} fill={INK}>
          {String(item.seats)}
        </text>
      </g>
    );
  }

  const x = metresToPixels(item.topLeft.x, pxPerM);
  const y = metresToPixels(item.topLeft.y, pxPerM);
  const w = metresToPixels(item.widthM, pxPerM);
  const h = metresToPixels(item.lengthM, pxPerM);
  const isDancefloor = item.kind === "dancefloor";
  const fill = isDancefloor ? INK : SHAPE_FILL;
  const textColor = isDancefloor ? PAPER : INK;
  const tagBg = isDancefloor ? ACCENT_RED_DEEP : INK;
  const label = getRectLabel(item);
  const rotationDeg = item.rotationDeg ?? 0;
  const transform = rotationDeg === 0 ? undefined : `rotate(${String(rotationDeg)} ${String(x + w / 2)} ${String(y + h / 2)})`;

  return (
    <g
      className="bp-furn"
      style={groupStyle}
      transform={transform}
      onClick={onSelect}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {selected ? <rect x={x - 3} y={y - 3} width={w + 6} height={h + 6} fill="none" stroke={ACCENT_RED} strokeWidth={2.5} /> : null}
      <rect x={x} y={y} width={w} height={h} fill={fill} stroke={SHAPE_OUTLINE} strokeWidth={1} />
      <g transform={`translate(${String(x)}, ${String(y - 20)})`}>
        <rect x={0} y={0} width={Math.max(60, label.length * 5.6)} height={16} fill={tagBg} rx={1} />
        <text x={6} y={11} fontFamily={FONT_MONO} fontSize={9} letterSpacing={1.2} fill={PAPER}>
          {label.toUpperCase()}
        </text>
      </g>
      <text x={x + w / 2} y={y + h / 2 + 4} textAnchor="middle" fontFamily={FONT_SANS} fontSize={12} fill={textColor}>
        {getRectBodyLabel(item)}
      </text>
    </g>
  );
}

function getRectLabel(item: BlueprintItem): string {
  if (item.kind === "stage") return `STAGE · ${formatDimensions(item)}`;
  if (item.kind === "top-table") {
    const seats = item.shape === "rect" && typeof item.seats === "number" ? item.seats : 0;
    return `TOP TABLE · ${String(seats)}`;
  }
  if (item.kind === "dancefloor") return `DANCEFLOOR · ${formatDimensions(item)}`;
  if (item.kind === "bar") return `BAR · ${formatM(item.widthM)}m`;
  if (item.kind === "long-table") {
    const seats = item.shape === "rect" && typeof item.seats === "number" ? item.seats : 0;
    return `LONG · ${String(seats)}`;
  }
  return item.kind;
}

function getRectBodyLabel(item: BlueprintItem): string {
  if (item.kind === "stage") return "Stage";
  if (item.kind === "top-table") return "Top table";
  if (item.kind === "dancefloor") return "Parquet";
  if (item.kind === "bar") return "Bar";
  if (item.kind === "long-table") return "Long table";
  return "";
}

function formatM(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

// ---------------------------------------------------------------------------
// Right inspector
// ---------------------------------------------------------------------------

function RightInspector(props: {
  scene: BlueprintScene;
  selected: BlueprintItem | null;
  onRotate: () => void;
  onRemove: () => void;
  onPatchItem: ((item: BlueprintItem) => void) | null;
  onToggleLock: (() => void) | null;
  onRaise: (() => void) | null;
  onLower: (() => void) | null;
  onRaiseToTop: (() => void) | null;
  onLowerToBottom: (() => void) | null;
  layers: readonly LayerRow[];
  onSelectLayer: ((id: string, additive: boolean) => void) | null;
  onToggleLayerLock: ((id: string) => void) | null;
  onReorderLayers: ((itemsOrderedIds: readonly string[]) => void) | null;
}): ReactElement {
  const { scene, selected, onRotate, onRemove, onPatchItem, onToggleLock, onRaise, onLower, onRaiseToTop, onLowerToBottom, layers, onSelectLayer, onToggleLayerLock, onReorderLayers } = props;
  const editable = onPatchItem !== null;
  const isLocked = selected?.locked === true;
  return (
    <aside className="bp-right" style={rightPane}>
      {selected === null ? (
        <span style={{ color: INK_FAINT, fontSize: 12 }}>Select an item to inspect its details.</span>
      ) : (
        <>
          <span style={inspectorTitleStyle}>{inspectorTitle(selected)}</span>
          {isRoundTable(selected) ? (
            <>
              {editable ? (
                <EditableNumberRow
                  label="Diameter (m)"
                  value={selected.diameterM}
                  min={0.6}
                  max={5}
                  step={0.1}
                  onCommit={(v) => { onPatchItem({ ...selected, diameterM: v }); }}
                />
              ) : (
                <InspectorRow label="Diameter" value={`${String(selected.diameterM)} m`} />
              )}
              {editable ? (
                <EditableNumberRow
                  label="Seats"
                  value={selected.seats}
                  min={0}
                  max={20}
                  step={1}
                  onCommit={(v) => { onPatchItem({ ...selected, seats: Math.round(v) }); }}
                />
              ) : (
                <InspectorRow label="Seats" value={String(selected.seats)} />
              )}
              {editable ? (
                <EditableTextRow
                  label="Linen"
                  value={selected.linen ?? ""}
                  onCommit={(v) => { onPatchItem({ ...selected, linen: v === "" ? undefined : v }); }}
                />
              ) : (
                <InspectorRow label="Linen" value={selected.linen ?? "—"} />
              )}
              {editable ? (
                <EditableTextRow
                  label="Centrepiece"
                  value={selected.centrepiece ?? ""}
                  onCommit={(v) => { onPatchItem({ ...selected, centrepiece: v === "" ? undefined : v }); }}
                />
              ) : (
                <InspectorRow label="Centrepiece" value={selected.centrepiece ?? "—"} />
              )}
            </>
          ) : (
            <>
              <InspectorRow label="Dimensions" value={formatDimensions(selected)} />
              {selected.shape === "rect" && typeof selected.seats === "number" ? (
                editable ? (
                  <EditableNumberRow
                    label="Seats"
                    value={selected.seats}
                    min={0}
                    max={40}
                    step={1}
                    onCommit={(v) => { onPatchItem({ ...selected, seats: Math.round(v) }); }}
                  />
                ) : (
                  <InspectorRow label="Seats" value={String(selected.seats)} />
                )
              ) : null}
              {selected.shape === "rect" && selected.linen !== undefined ? (
                editable ? (
                  <EditableTextRow
                    label="Linen"
                    value={selected.linen}
                    onCommit={(v) => { onPatchItem({ ...selected, linen: v === "" ? undefined : v }); }}
                  />
                ) : (
                  <InspectorRow label="Linen" value={selected.linen} />
                )
              ) : null}
              {selected.shape === "rect" && selected.centrepiece !== undefined ? (
                editable ? (
                  <EditableTextRow
                    label="Centrepiece"
                    value={selected.centrepiece}
                    onCommit={(v) => { onPatchItem({ ...selected, centrepiece: v === "" ? undefined : v }); }}
                  />
                ) : (
                  <InspectorRow label="Centrepiece" value={selected.centrepiece} />
                )
              ) : null}
            </>
          )}
          <span style={{ marginTop: 16, color: INK_FAINT, fontSize: 11, letterSpacing: 1 }}>
            {String(countByKind(scene.items, selected.kind))} / {String(estimateTargetForKind(scene, selected.kind))} placed
          </span>
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button type="button" className="bp-inspector-btn" onClick={onRotate} style={inspectorBtn} aria-label="Rotate 90°" disabled={isLocked}>Rotate 90°</button>
            <button type="button" className="bp-inspector-btn" onClick={onRemove} style={{ ...inspectorBtn, background: ACCENT_RED, color: PAPER, borderColor: ACCENT_RED }} aria-label="Remove selected item" disabled={isLocked}>Remove</button>
            {onToggleLock !== null ? (
              <button type="button" className="bp-inspector-btn" onClick={onToggleLock} style={{ ...inspectorBtn, background: isLocked ? INK : PAPER, color: isLocked ? PAPER : INK }} aria-pressed={isLocked} aria-label={isLocked ? "Unlock item" : "Lock item"}>
                {isLocked ? "🔒 Locked" : "Lock"}
              </button>
            ) : null}
          </div>
          {(onRaise !== null || onLower !== null || onRaiseToTop !== null || onLowerToBottom !== null) ? (
            <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
              {onRaiseToTop !== null ? (
                <button type="button" className="bp-inspector-btn" onClick={onRaiseToTop} style={inspectorBtn} title="Bring to front">⇞</button>
              ) : null}
              {onRaise !== null ? (
                <button type="button" className="bp-inspector-btn" onClick={onRaise} style={inspectorBtn} title="Bring forward">↑</button>
              ) : null}
              {onLower !== null ? (
                <button type="button" className="bp-inspector-btn" onClick={onLower} style={inspectorBtn} title="Send backward">↓</button>
              ) : null}
              {onLowerToBottom !== null ? (
                <button type="button" className="bp-inspector-btn" onClick={onLowerToBottom} style={inspectorBtn} title="Send to back">⇟</button>
              ) : null}
            </div>
          ) : null}
          <span style={{ marginTop: 12, color: INK_FAINT, fontSize: 11, lineHeight: 1.5 }}>
            Arrows nudge · Shift+Arrow = 1 m · R rotates · Del removes · Esc deselects · ⌘Z undo
          </span>
        </>
      )}
      <LayersPanel
        layers={layers}
        onSelectLayer={onSelectLayer}
        onToggleLayerLock={onToggleLayerLock}
        onReorderLayers={onReorderLayers}
      />
    </aside>
  );
}

/**
 * Given panel rows (top-to-bottom) and a from/to move within that panel,
 * returns the new items-array order (first = bottom of stack, last = top).
 * Pure — split out so it's trivially testable.
 */
function reorderedItemsArray(
  layers: readonly LayerRow[],
  fromIndex: number,
  toIndex: number,
): readonly string[] {
  const panelIds = layers.map((r) => r.id);
  if (fromIndex < 0 || fromIndex >= panelIds.length) return panelIds.slice().reverse();
  const moved = panelIds[fromIndex];
  if (moved === undefined) return panelIds.slice().reverse();
  const clamped = Math.max(0, Math.min(toIndex, panelIds.length));
  const withoutMoved = panelIds.filter((_, i) => i !== fromIndex);
  const adjustedTo = clamped > fromIndex ? clamped - 1 : clamped;
  withoutMoved.splice(adjustedTo, 0, moved);
  return withoutMoved.slice().reverse();
}

function LayersPanel(props: {
  layers: readonly LayerRow[];
  onSelectLayer: ((id: string, additive: boolean) => void) | null;
  onToggleLayerLock: ((id: string) => void) | null;
  onReorderLayers: ((itemsOrderedIds: readonly string[]) => void) | null;
}): ReactElement | null {
  const { layers, onSelectLayer, onToggleLayerLock, onReorderLayers } = props;
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  if (layers.length === 0) return null;
  const interactive = onSelectLayer !== null;
  const dragEnabled = onReorderLayers !== null;

  return (
    <div style={layersPanelStyle} aria-label="Layers">
      <div style={layersHeaderStyle}>
        <span style={{ letterSpacing: 1.5, textTransform: "uppercase" }}>Layers</span>
        <span style={{ color: INK_FAINT }}>{String(layers.length)}</span>
      </div>
      <div role="list" style={layersListStyle}>
        {layers.map((row, index) => {
          const isDragging = dragId === row.id;
          const showDropAbove = dragEnabled && dropIndex === index && dragId !== row.id;
          return (
            <Fragment key={row.id}>
              {showDropAbove ? <div style={layerDropIndicatorStyle} /> : null}
              <div
                role="listitem"
                draggable={dragEnabled}
                onDragStart={(e) => {
                  if (!dragEnabled) return;
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", row.id);
                  setDragId(row.id);
                }}
                onDragOver={(e) => {
                  if (!dragEnabled || dragId === null) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  const rect = e.currentTarget.getBoundingClientRect();
                  const before = e.clientY < rect.top + rect.height / 2;
                  setDropIndex(before ? index : index + 1);
                }}
                onDragEnd={() => { setDragId(null); setDropIndex(null); }}
                onDrop={(e) => {
                  if (onReorderLayers === null || dragId === null) return;
                  e.preventDefault();
                  const rect = e.currentTarget.getBoundingClientRect();
                  const before = e.clientY < rect.top + rect.height / 2;
                  const toIndex = before ? index : index + 1;
                  const fromIndex = layers.findIndex((r) => r.id === dragId);
                  if (fromIndex >= 0 && fromIndex !== toIndex && fromIndex !== toIndex - 1) {
                    onReorderLayers(reorderedItemsArray(layers, fromIndex, toIndex));
                  }
                  setDragId(null);
                  setDropIndex(null);
                }}
                onClick={(e) => {
                  if (!interactive) return;
                  onSelectLayer(row.id, e.shiftKey || e.metaKey || e.ctrlKey);
                }}
                style={{
                  ...layerRowStyle,
                  background: row.selected ? PAPER_DEEP : "transparent",
                  color: INK,
                  cursor: interactive ? (dragEnabled ? "grab" : "pointer") : "default",
                  fontWeight: row.selected ? 500 : 400,
                  opacity: isDragging ? 0.4 : 1,
                }}
              >
                {dragEnabled ? (
                  <span aria-hidden style={layerGripStyle}>⠿</span>
                ) : null}
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {row.label}
                </span>
                {onToggleLayerLock !== null ? (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onToggleLayerLock(row.id); }}
                    style={layerLockBtnStyle}
                    aria-pressed={row.locked}
                    aria-label={row.locked ? `Unlock ${row.label}` : `Lock ${row.label}`}
                    title={row.locked ? "Unlock" : "Lock"}
                  >
                    {row.locked ? "●" : "○"}
                  </button>
                ) : row.locked ? (
                  <span aria-label="Locked" title="Locked" style={{ color: INK_FAINT, fontSize: 11 }}>●</span>
                ) : null}
              </div>
            </Fragment>
          );
        })}
        {dropIndex === layers.length ? <div style={layerDropIndicatorStyle} /> : null}
      </div>
    </div>
  );
}

function InspectorRow({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
      <span style={{ color: INK, fontSize: 13 }}>{label}</span>
      <span style={{ color: INK, fontSize: 13, fontWeight: 500 }}>{value}</span>
    </div>
  );
}

/**
 * Number field — commits only on blur / Enter so the reducer only sees
 * one history entry per edit (not per keystroke). Scoped input width
 * so long values don't wrap the sidebar.
 */
function EditableNumberRow(props: { label: string; value: number; min?: number; max?: number; step?: number; onCommit: (v: number) => void }): ReactElement {
  const { label, value, min, max, step, onCommit } = props;
  const [local, setLocal] = useState<string>(() => String(value));
  useEffect(() => { setLocal(String(value)); }, [value]);
  const commit = (): void => {
    const parsed = parseFloat(local);
    if (Number.isFinite(parsed) && parsed !== value) {
      const clamped = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, parsed));
      onCommit(clamped);
    } else {
      setLocal(String(value));
    }
  };
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
      <span style={{ color: INK, fontSize: 13 }}>{label}</span>
      <input
        type="number"
        value={local}
        min={min}
        max={max}
        step={step}
        onChange={(e) => { setLocal(e.target.value); }}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") { e.currentTarget.blur(); } }}
        style={editableInputStyle}
      />
    </div>
  );
}

function EditableTextRow(props: { label: string; value: string; onCommit: (v: string) => void }): ReactElement {
  const { label, value, onCommit } = props;
  const [local, setLocal] = useState<string>(value);
  useEffect(() => { setLocal(value); }, [value]);
  const commit = (): void => { if (local !== value) onCommit(local); };
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
      <span style={{ color: INK, fontSize: 13 }}>{label}</span>
      <input
        type="text"
        value={local}
        onChange={(e) => { setLocal(e.target.value); }}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") { e.currentTarget.blur(); } }}
        style={editableInputStyle}
      />
    </div>
  );
}

function estimateTargetForKind(scene: BlueprintScene, kind: BlueprintItem["kind"]): number {
  if (kind === "round-table") return Math.ceil(scene.guestCount / 10);
  return countByKind(scene.items, kind);
}

// ---------------------------------------------------------------------------
// Status bar + toast
// ---------------------------------------------------------------------------

function StatusBar({ metrics, onSendForQuote, onExportPng }: { metrics: ReturnType<typeof computeStatusMetrics>; onSendForQuote: () => void; onExportPng: (() => void) | null }): ReactElement {
  return (
    <div className="bp-status-bar" style={statusBar}>
      <StatusChip label="Seats" value={String(metrics.totalSeats)} />
      <StatusChip label="Rounds" value={String(metrics.roundCount)} />
      <StatusChip label="Floor used" value={`${String(metrics.floorUsedPercent)}%`} />
      <StatusChip
        label="Fire egress"
        value={metrics.fireEgressClear ? "✓ Clear" : "⚠ Blocked"}
        highlight={metrics.fireEgressClear ? "ok" : "warn"}
      />
      <div style={{ flex: 1 }} />
      {onExportPng !== null ? (
        <button type="button" style={ghostCtaStyle} onClick={onExportPng}>Export PNG</button>
      ) : null}
      <button type="button" className="bp-cta" style={cta} onClick={onSendForQuote}>Send for quote →</button>
    </div>
  );
}

function StatusChip({ label, value, highlight }: { label: string; value: string; highlight?: "ok" | "warn" }): ReactElement {
  const okColor = "#2e7a3a";
  const warnColor = ACCENT_RED;
  return (
    <div style={statusChip}>
      <span style={{ color: INK_FAINT, fontSize: 12 }}>{label}</span>
      <span style={{
        color: highlight === "ok" ? okColor : highlight === "warn" ? warnColor : INK,
        fontSize: 13,
        fontWeight: 500,
      }}>{value}</span>
    </div>
  );
}

function Toast({ message }: { message: string }): ReactElement {
  return (
    <div style={toastStyle} role="status" aria-live="polite">
      {message}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const shell: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100vh",
  background: PAPER_SIDE,
  color: INK,
  fontFamily: FONT_SANS,
};

const chrome: CSSProperties = {
  display: "flex",
  alignItems: "center",
  padding: "10px 16px",
  background: PAPER,
  borderBottom: `1px solid ${PAPER_RULE}`,
  gap: 16,
};

const body: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "260px 1fr 260px",
  flex: 1,
  minHeight: 0,
};

const leftPane: CSSProperties = {
  padding: 20,
  display: "flex",
  flexDirection: "column",
  gap: 24,
  background: PAPER_SIDE,
  borderRight: `1px solid ${PAPER_RULE}`,
};

const rightPane: CSSProperties = {
  padding: 20,
  display: "flex",
  flexDirection: "column",
  gap: 10,
  background: PAPER_SIDE,
  borderLeft: `1px solid ${PAPER_RULE}`,
};

const canvasPane: CSSProperties = {
  position: "relative",
  overflow: "hidden",
  background: PAPER_DEEP,
  userSelect: "none",
  touchAction: "none",
};

const sectionLabel: CSSProperties = {
  color: INK_FAINT,
  fontSize: 11,
  letterSpacing: 1.5,
  textTransform: "uppercase",
};

const selectControl: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "10px 12px",
  border: `1px solid ${PAPER_RULE}`,
  borderRadius: 2,
  background: PAPER,
  fontSize: 13,
};

const pillBase: CSSProperties = {
  padding: "6px 14px",
  fontFamily: FONT_SANS,
  fontSize: 12,
  border: `1px solid rgba(26,26,26,0.25)`,
  borderRadius: 14,
  cursor: "pointer",
};

const stepper: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "6px 10px",
  border: `1px solid ${PAPER_RULE}`,
  borderRadius: 2,
  background: PAPER,
  fontSize: 14,
};

const stepperBtn: CSSProperties = {
  width: 26,
  height: 26,
  border: `1px solid ${PAPER_RULE}`,
  borderRadius: 2,
  background: PAPER,
  color: INK,
  cursor: "pointer",
  lineHeight: "22px",
  fontSize: 14,
};

const chipBtn: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 12px",
  border: `1px solid rgba(26,26,26,0.25)`,
  borderRadius: 14,
  background: "transparent",
  cursor: "grab",
  fontSize: 12,
};

const toolbarWrap: CSSProperties = {
  position: "absolute",
  top: 14,
  left: 14,
  zIndex: 2,
};

const toolGroup: CSSProperties = {
  display: "inline-flex",
  background: INK,
  borderRadius: 4,
  padding: 2,
  gap: 2,
};

const toolBtn: CSSProperties = {
  width: 34,
  height: 30,
  border: "none",
  borderRadius: 3,
  fontSize: 14,
};

const coordReadout: CSSProperties = {
  position: "absolute",
  top: 14,
  right: 14,
  padding: "4px 10px",
  background: PAPER,
  border: `1px solid ${PAPER_RULE}`,
  borderRadius: 2,
  fontFamily: FONT_MONO,
  fontSize: 11,
  letterSpacing: 0.5,
  color: INK,
  zIndex: 2,
};

const inspectorTitleStyle: CSSProperties = {
  color: INK_FAINT,
  fontFamily: FONT_MONO,
  fontSize: 11,
  letterSpacing: 1.5,
  marginBottom: 4,
};

const inspectorBtn: CSSProperties = {
  padding: "6px 10px",
  border: `1px solid ${PAPER_RULE}`,
  background: PAPER,
  color: INK,
  fontSize: 12,
  borderRadius: 3,
  cursor: "pointer",
  fontFamily: FONT_SANS,
};

const layersPanelStyle: CSSProperties = {
  marginTop: 14,
  borderTop: `1px solid ${PAPER_RULE}`,
  paddingTop: 10,
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const layersHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  fontSize: 11,
  color: INK,
};

const layersListStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  maxHeight: 240,
  overflowY: "auto",
  fontFamily: FONT_SANS,
  fontSize: 12,
};

const layerRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "4px 6px",
  borderRadius: 2,
  userSelect: "none",
};

const layerLockBtnStyle: CSSProperties = {
  width: 22,
  height: 22,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  border: "none",
  background: "transparent",
  color: INK_FAINT,
  fontSize: 12,
  cursor: "pointer",
  borderRadius: 2,
};

const layerDropIndicatorStyle: CSSProperties = {
  height: 2,
  background: ACCENT_RED,
  margin: "0 4px",
  borderRadius: 1,
};

const layerGripStyle: CSSProperties = {
  color: INK_FAINT,
  fontSize: 10,
  letterSpacing: -1,
  cursor: "grab",
  userSelect: "none",
  lineHeight: 1,
};

const statusBar: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "12px 16px",
  background: PAPER,
  borderTop: `1px solid ${PAPER_RULE}`,
};

const statusChip: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 12px",
  border: `1px solid ${PAPER_RULE}`,
  borderRadius: 14,
  background: PAPER,
};

const cta: CSSProperties = {
  padding: "10px 18px",
  background: ACCENT_RED,
  color: PAPER,
  border: "none",
  borderRadius: 3,
  fontFamily: FONT_SANS,
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
  letterSpacing: 0.3,
};

const zoomBadge: CSSProperties = {
  position: "absolute",
  bottom: 14,
  left: 14,
  padding: "4px 10px",
  background: PAPER,
  border: `1px solid ${PAPER_RULE}`,
  borderRadius: 14,
  fontFamily: FONT_MONO,
  fontSize: 11,
  color: INK_FAINT,
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  zIndex: 3,
};

const zoomResetBtn: CSSProperties = {
  background: "transparent",
  border: "none",
  color: INK,
  cursor: "pointer",
  fontSize: 14,
  padding: 0,
  lineHeight: 1,
};

const menuItemStyle: CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  padding: "10px 12px",
  background: "transparent",
  border: "none",
  color: INK,
  fontFamily: FONT_SANS,
  fontSize: 13,
  cursor: "pointer",
  borderRadius: 4,
};

const minimapStyle: CSSProperties = {
  position: "absolute",
  bottom: 60,
  right: 14,
  border: `1px solid ${PAPER_RULE}`,
  borderRadius: 3,
  background: PAPER,
  boxShadow: "0 8px 24px -12px rgba(20,10,0,0.25)",
  cursor: "pointer",
  zIndex: 3,
  touchAction: "none",
};

const editableInputStyle: CSSProperties = {
  width: 100,
  padding: "4px 8px",
  border: `1px solid ${PAPER_RULE}`,
  borderRadius: 3,
  background: PAPER,
  fontFamily: FONT_SANS,
  fontSize: 13,
  color: INK,
  textAlign: "right",
};

const ghostCtaStyle: CSSProperties = {
  padding: "10px 14px",
  background: "transparent",
  color: INK,
  border: `1px solid ${PAPER_RULE}`,
  borderRadius: 3,
  fontFamily: FONT_SANS,
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
  marginRight: 6,
};

const templateBtn: CSSProperties = {
  display: "block",
  textAlign: "left",
  padding: "8px 10px",
  background: PAPER,
  border: `1px solid ${PAPER_RULE}`,
  borderRadius: 3,
  fontSize: 12,
  color: INK,
  cursor: "pointer",
  fontFamily: FONT_SANS,
};

const helpBtn: CSSProperties = {
  padding: "8px 12px",
  background: "transparent",
  border: `1px solid ${PAPER_RULE}`,
  borderRadius: 3,
  fontFamily: FONT_SANS,
  fontSize: 12,
  color: INK,
  cursor: "pointer",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginTop: "auto",
};

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(20, 15, 8, 0.5)",
  display: "grid",
  placeItems: "center",
  zIndex: 60,
  padding: 20,
};

const overlayCardStyle: CSSProperties = {
  background: PAPER,
  border: `1px solid ${PAPER_RULE}`,
  borderRadius: 8,
  padding: 24,
  width: "min(520px, 100%)",
  maxHeight: "85vh",
  overflow: "auto",
  boxShadow: "0 30px 60px -20px rgba(20,10,0,0.4)",
};

const toastStyle: CSSProperties = {
  position: "fixed",
  bottom: 80,
  left: "50%",
  transform: "translateX(-50%)",
  background: INK,
  color: PAPER,
  padding: "12px 18px",
  borderRadius: 4,
  fontSize: 13,
  boxShadow: "0 12px 30px -12px rgba(20,10,0,0.4)",
  zIndex: 50,
};
