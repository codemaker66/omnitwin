import { useState, useCallback, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  MousePointer2, Armchair, RotateCw, Trash2, Undo2, Redo2,
  Camera, Grid3X3, Save, User, Eye, FileText,
} from "lucide-react";
import { usePlacementStore } from "../../stores/placement-store.js";
import { useSelectionStore } from "../../stores/selection-store.js";
import { useCatalogueStore } from "../../stores/catalogue-store.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { useAuthStore } from "../../stores/auth-store.js";
import { useBookmarkStore } from "../../stores/bookmark-store.js";
import { useVisibilityStore, WALL_KEYS } from "../../stores/visibility-store.js";
import { AuthModal } from "./AuthModal.js";
import {
  CATALOGUE_CATEGORIES,
  getCatalogueByCategory,
  categoryLabel,
  catalogueIcon,
} from "../../lib/catalogue.js";
import type { CatalogueItem } from "../../lib/catalogue.js";


// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const TOOLBAR_W = 52;
const PANEL_W = 290;
const BG = "#1a1a1a";
const GOLD = "#c9a84c";
const ICON_SIZE = 20;

const toolbarStyle: React.CSSProperties = {
  position: "fixed", left: 0, top: 0, bottom: 0, width: TOOLBAR_W,
  background: BG, borderRight: "1px solid #333",
  display: "flex", flexDirection: "column", alignItems: "center",
  padding: "12px 0", gap: 4, zIndex: 50,
  fontFamily: "'Inter', sans-serif",
};

const btnStyle = (active: boolean, disabled = false): React.CSSProperties => ({
  width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center",
  border: "none", borderRadius: 8, cursor: disabled ? "default" : "pointer",
  background: active ? GOLD : "transparent",
  color: active ? BG : disabled ? "#555" : "#aaa",
  transition: "background 0.15s, color 0.15s",
  opacity: disabled ? 0.4 : 1,
});

const dividerStyle: React.CSSProperties = {
  width: 28, height: 1, background: "#333", margin: "4px 0",
};

const panelStyle: React.CSSProperties = {
  position: "fixed", left: TOOLBAR_W, top: 0, bottom: 0, width: PANEL_W,
  background: "linear-gradient(180deg, rgba(16,16,16,0.98) 0%, rgba(22,22,22,0.98) 100%)",
  borderRight: "1px solid rgba(201,168,76,0.1)",
  zIndex: 49, overflowY: "auto", padding: "24px 16px",
  fontFamily: "'Inter', sans-serif", color: "#ccc",
  backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
  boxShadow: "8px 0 40px rgba(0,0,0,0.4), inset -1px 0 0 rgba(201,168,76,0.05)",
};

const categoryHeaderStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 2,
  color: GOLD, padding: "16px 8px 8px", cursor: "pointer",
  display: "flex", justifyContent: "space-between", alignItems: "center",
  borderBottom: "1px solid rgba(201,168,76,0.08)",
};

const assetRowStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
  borderRadius: 8, cursor: "pointer", fontSize: 13, color: "#ddd",
  transition: "background 0.15s, border-color 0.15s",
};

const cameraDropdownStyle: React.CSSProperties = {
  position: "fixed", left: TOOLBAR_W + 8, background: "linear-gradient(145deg, #141414, #1c1c1c)",
  borderRadius: 16, padding: "12px 8px", zIndex: 51,
  boxShadow: "0 12px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(201,168,76,0.12)",
  border: "1px solid rgba(201,168,76,0.15)", minWidth: 200,
};

const cameraItemStyle: React.CSSProperties = {
  display: "block", width: "100%", padding: "10px 14px", fontSize: 14,
  background: "none", border: "none", color: "#ccc", cursor: "pointer",
  textAlign: "left", borderRadius: 8, fontFamily: "'Inter', sans-serif",
};


// ---------------------------------------------------------------------------
// Tooltip — rich animated popout labels
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Delayed unmount hook — keeps element mounted during exit animation
// ---------------------------------------------------------------------------

function useDelayedUnmount(isOpen: boolean, delayMs: number): boolean {
  const [mounted, setMounted] = useState(isOpen);
  // The previous `alive` ref guard (`if (alive.current) setMounted(false)`)
  // was intended to prevent state updates on unmounted components — but React
  // StrictMode double-invokes the mount/unmount cycle, leaving the ref stuck
  // at `false` after the simulated unmount. The timeout callback then skips
  // `setMounted(false)`, so the element is never removed from the DOM.
  // React 18 silently discards state updates on truly unmounted components,
  // making the guard unnecessary. The cleanup return already handles the
  // timeout lifecycle correctly via clearTimeout.
  useEffect(() => {
    if (isOpen) {
      setMounted(true);
    } else {
      const t = setTimeout(() => { setMounted(false); }, delayMs);
      return () => { clearTimeout(t); };
    }
  }, [isOpen, delayMs]);
  return mounted;
}

// Panel entrance animations
const PANEL_ANIM_ID = "omni-panel-anims";
if (typeof document !== "undefined" && document.getElementById(PANEL_ANIM_ID) === null) {
  const ps = document.createElement("style");
  ps.id = PANEL_ANIM_ID;
  ps.textContent = `
    @keyframes omni-panel-slide {
      0% { transform: translateX(-100%); opacity: 0; filter: blur(8px); }
      60% { transform: translateX(8px); filter: blur(0); }
      100% { transform: translateX(0); opacity: 1; }
    }
    @keyframes omni-panel-slide-out {
      0% { transform: translateX(0); opacity: 1; filter: blur(0); }
      100% { transform: translateX(-100%); opacity: 0; filter: blur(8px); }
    }
    @keyframes omni-panel-item {
      0% { opacity: 0; transform: translateX(-16px); }
      100% { opacity: 1; transform: translateX(0); }
    }
    @keyframes omni-dropdown-pop {
      0% { opacity: 0; transform: scale(0.9) translateY(-8px); filter: blur(4px); }
      60% { transform: scale(1.02) translateY(2px); }
      100% { opacity: 1; transform: scale(1) translateY(0); filter: blur(0); }
    }
    @keyframes omni-dropdown-pop-out {
      0% { opacity: 1; transform: scale(1) translateY(0); filter: blur(0); }
      100% { opacity: 0; transform: scale(0.9) translateY(-8px); filter: blur(4px); }
    }
    .omni-asset-row {
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
    }
    .omni-asset-row:hover {
      background: rgba(201,168,76,0.08) !important;
      padding-left: 16px !important;
      border-left: 2px solid rgba(201,168,76,0.5) !important;
    }
    .omni-asset-row:active {
      transform: scale(0.97);
      background: rgba(201,168,76,0.15) !important;
    }
    .omni-cam-item {
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
    }
    .omni-cam-item:hover {
      background: rgba(201,168,76,0.1) !important;
      padding-left: 20px !important;
      color: #dfc06a !important;
    }
  `;
  document.head.appendChild(ps);
}

const TOOLTIP_ANIM_ID = "omni-tooltip-anims-v2";
if (typeof document !== "undefined" && document.getElementById(TOOLTIP_ANIM_ID) === null) {
  const s = document.createElement("style");
  s.id = TOOLTIP_ANIM_ID;
  s.textContent = `
    @keyframes omni-tt-enter {
      0% { opacity: 0; transform: translateX(-16px) scale(0.85); filter: blur(6px); }
      60% { transform: translateX(6px) scale(1.03); filter: blur(0); }
      100% { opacity: 1; transform: translateX(0) scale(1); }
    }
    @keyframes omni-tt-pop-out {
      0% { opacity: 1; transform: translateX(0) scale(1); filter: blur(0); }
      40% { transform: translateX(4px) scale(1.08); }
      100% { opacity: 0; transform: translateX(-12px) scale(0.7); filter: blur(6px); }
    }
    @keyframes omni-tt-glow {
      0%, 100% { box-shadow: 0 12px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(201,168,76,0.15), inset 0 1px 0 rgba(255,255,255,0.04); }
      50% { box-shadow: 0 16px 64px rgba(0,0,0,0.7), 0 0 0 1px rgba(201,168,76,0.3), inset 0 1px 0 rgba(255,255,255,0.06), 0 0 24px rgba(201,168,76,0.08); }
    }
    @keyframes omni-tt-shimmer {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }
    @keyframes omni-tt-arrow {
      0% { opacity: 0; transform: translateY(-50%) translateX(-4px); }
      100% { opacity: 1; transform: translateY(-50%) translateX(0); }
    }
    @keyframes omni-tt-badge {
      0% { opacity: 0; transform: scale(0.8); }
      100% { opacity: 1; transform: scale(1); }
    }
  `;
  document.head.appendChild(s);
}

interface ToolBtnProps {
  readonly active: boolean;
  readonly disabled?: boolean;
  readonly label: string;
  readonly description: string;
  readonly shortcut?: string;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}

function ToolBtn({ active, disabled = false, label, description, shortcut, onClick, children }: ToolBtnProps): React.ReactElement {
  const [showTooltip, setShowTooltip] = useState(false);
  const [exiting, setExiting] = useState(false);
  const enterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onEnter = (): void => {
    if (exitTimer.current !== null) { clearTimeout(exitTimer.current); exitTimer.current = null; }
    setExiting(false);
    enterTimer.current = setTimeout(() => { setShowTooltip(true); }, 200);
  };
  const dismiss = (): void => {
    if (enterTimer.current !== null) { clearTimeout(enterTimer.current); enterTimer.current = null; }
    if (!showTooltip) { setShowTooltip(false); return; }
    setExiting(true);
    exitTimer.current = setTimeout(() => { setShowTooltip(false); setExiting(false); }, 250);
  };
  const onLeave = (): void => { dismiss(); };
  const handleClick = (): void => {
    dismiss();
    onClick();
  };

  return (
    <div style={{ position: "relative" }} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <button
        type="button"
        aria-label={label}
        style={btnStyle(active, disabled)}
        onClick={handleClick}
        disabled={disabled}
      >
        {children}
      </button>
      {showTooltip && !disabled && (
        <div style={{
          position: "absolute",
          left: 58,
          top: "50%",
          transform: "translateY(-50%)",
          zIndex: 100,
          pointerEvents: "none",
          animation: exiting
            ? "omni-tt-pop-out 0.25s cubic-bezier(0.55, 0, 1, 0.45) forwards"
            : "omni-tt-enter 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        }}>
          {/* Arrow — large, gold-tinted */}
          <div style={{
            position: "absolute",
            left: -10,
            top: "50%",
            width: 0, height: 0,
            borderTop: "11px solid transparent",
            borderBottom: "11px solid transparent",
            borderRight: "11px solid #141414",
            animation: "omni-tt-arrow 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards",
          }} />
          {/* Card */}
          <div style={{
            background: "linear-gradient(145deg, #141414 0%, #1c1c1c 50%, #181818 100%)",
            border: "1px solid rgba(201,168,76,0.2)",
            borderRadius: 16,
            padding: "18px 24px 16px",
            minWidth: 240,
            maxWidth: 300,
            animation: "omni-tt-glow 3s ease-in-out infinite",
          }}>
            {/* Gold accent bar at top */}
            <div style={{
              width: 36,
              height: 3,
              borderRadius: 2,
              background: `linear-gradient(90deg, ${GOLD}, rgba(201,168,76,0.3))`,
              marginBottom: 12,
            }} />
            {/* Label */}
            <div style={{
              fontSize: 20,
              fontWeight: 800,
              color: "#fff",
              letterSpacing: -0.4,
              fontFamily: "'Playfair Display', serif",
              lineHeight: 1.1,
            }}>
              {label}
            </div>
            {/* Description */}
            <div style={{
              fontSize: 14,
              color: "#999",
              marginTop: 8,
              lineHeight: 1.5,
              fontFamily: "'Inter', system-ui, sans-serif",
              fontWeight: 400,
            }}>
              {description}
            </div>
            {/* Shortcut badge */}
            {shortcut !== undefined && (
              <div style={{
                marginTop: 12,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 12px",
                borderRadius: 8,
                background: "linear-gradient(135deg, rgba(201,168,76,0.15), rgba(201,168,76,0.08))",
                border: "1px solid rgba(201,168,76,0.2)",
                color: GOLD,
                fontSize: 12,
                fontWeight: 700,
                fontFamily: "'Inter', system-ui, sans-serif",
                letterSpacing: 0.8,
                animation: "omni-tt-badge 0.4s cubic-bezier(0.16, 1, 0.3, 1) 0.15s both",
              }}>
                <span style={{ fontSize: 10, color: "rgba(201,168,76,0.6)", fontWeight: 500 }}>SHORTCUT</span>
                <span>{shortcut}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type ActiveTool = "select" | "add" | "rotate" | "delete";

export function VerticalToolbox(): React.ReactElement {
  const navigate = useNavigate();
  const [activeTool, setActiveTool] = useState<ActiveTool>("select");
  const [panelOpen, setPanelOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [saveFlash, setSaveFlash] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const canUndo = usePlacementStore((s) => s.undoStack.length > 0);
  const canRedo = usePlacementStore((s) => s.redoStack.length > 0);
  const snapEnabled = usePlacementStore((s) => s.snapEnabled);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isSaving = useEditorStore((s) => s.isSaving);
  const wallMode = useVisibilityStore((s) => s.mode);
  const allWallsUp = wallMode === "manual";
  const handleToolClick = useCallback((tool: ActiveTool) => {
    if (tool === "add") {
      setPanelOpen((p) => !p);
      setActiveTool((prev) => prev === "add" ? "select" : "add");
    } else {
      setPanelOpen(false);
      setActiveTool(tool);
    }
    setCameraOpen(false);
  }, []);

  const handleUndo = useCallback(() => {
    usePlacementStore.getState().undo();
    useSelectionStore.getState().clearSelection();
  }, []);

  const handleRedo = useCallback(() => {
    usePlacementStore.getState().redo();
    useSelectionStore.getState().clearSelection();
  }, []);

  const handleSnapToggle = useCallback(() => {
    usePlacementStore.getState().toggleSnap();
  }, []);

  const handleToggleAllWalls = useCallback(() => {
    const store = useVisibilityStore.getState();
    if (store.mode === "manual") {
      // Switch back to auto — camera controls walls again
      store.setMode("auto-3");
    } else {
      // Switch to manual with all walls up, locks cleared
      store.setMode("manual");
      const allUp: Record<string, boolean> = {};
      const allOpacity: Record<string, number> = {};
      for (const key of WALL_KEYS) {
        allUp[key] = true;
        allOpacity[key] = 1;
      }
      useVisibilityStore.setState({
        walls: allUp as Record<typeof WALL_KEYS[number], boolean>,
        wallOpacity: allOpacity as Record<typeof WALL_KEYS[number], number>,
      });
    }
  }, []);

  const handleGenerateSheet = useCallback(() => {
    const configId = useEditorStore.getState().configId;
    if (configId === null) return;
    window.open(`/hallkeeper/${configId}`, "_blank");
  }, []);

  const handleSave = useCallback(() => {
    // Punch list #10: previously called saveToServer(true) unconditionally,
    // forcing the authenticated endpoint even for guests. Guest sessions
    // would 401 silently. Now reads the live auth state at click time so
    // guests hit the public-preview endpoint and authenticated users hit
    // the auth endpoint. The store action's internal isPublicPreview check
    // still applies — if a config is already claimed, the auth path is used
    // regardless of the flag.
    const authed = useAuthStore.getState().isAuthenticated;
    void useEditorStore.getState().saveToServer(authed).then(() => {
      setSaveFlash(true);
      setTimeout(() => { setSaveFlash(false); }, 2000);
    });
  }, []);

  const handleAssetClick = useCallback((item: CatalogueItem) => {
    useCatalogueStore.getState().selectItem(item.id);
    setPanelOpen(false);
    setActiveTool("select");
  }, []);

  const toggleCategory = useCallback((cat: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) { next.delete(cat); } else { next.add(cat); }
      return next;
    });
  }, []);

  const handleCameraPreset = useCallback((presetIndex: number) => {
    const bookmarks = useBookmarkStore.getState().bookmarks;
    const bookmark = bookmarks[presetIndex];
    if (bookmark !== undefined) {
      useBookmarkStore.setState({ pendingNavigationId: bookmark.id });
    }
    setCameraOpen(false);
  }, []);

  const bookmarks = useBookmarkStore((s) => s.bookmarks);

  // Delayed unmount for exit animations
  const panelMounted = useDelayedUnmount(panelOpen, 300);
  const cameraMounted = useDelayedUnmount(cameraOpen, 250);

  // F key opens furniture panel
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === "KeyF" && !e.ctrlKey && !e.metaKey) {
        // Don't conflict with placement rotation (handled by PlacementGhost)
        if (useCatalogueStore.getState().selectedItemId !== null) return;
        handleToolClick("add");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); };
  }, [handleToolClick]);

  return (
    <>
      {/* === Toolbar strip === */}
      <div style={toolbarStyle}>
        <ToolBtn active={activeTool === "select"} label="Select & Move" description="Click any piece of furniture to grab it. Drag to slide it across the room. Shift+click to select multiple." shortcut="V" onClick={() => { handleToolClick("select"); }}>
          <MousePointer2 size={ICON_SIZE} />
        </ToolBtn>

        <ToolBtn active={activeTool === "add"} label="Add Furniture" description="Open the catalogue — round tables, trestle tables, poseur tables, chairs, staging, AV gear, lecterns and more." shortcut="F" onClick={() => { handleToolClick("add"); }}>
          <Armchair size={ICON_SIZE} />
        </ToolBtn>

        <ToolBtn active={activeTool === "rotate"} label="Rotate" description="Twist any selected item 15° at a time. Perfect for angling tables toward the stage or lining up rows." shortcut="Q / E" onClick={() => { handleToolClick("rotate"); }}>
          <RotateCw size={ICON_SIZE} />
        </ToolBtn>

        <ToolBtn active={activeTool === "delete"} label="Delete" description="Remove whatever you've selected. Tables will take their chairs with them — no orphans left behind." shortcut="Del" onClick={() => { handleToolClick("delete"); }}>
          <Trash2 size={ICON_SIZE} />
        </ToolBtn>

        <div style={dividerStyle} />

        <ToolBtn active={false} disabled={!canUndo} label="Undo" description="Made a mistake? Step back in time. Every move, place, and delete can be reversed." shortcut="Ctrl+Z" onClick={handleUndo}>
          <Undo2 size={ICON_SIZE} />
        </ToolBtn>

        <ToolBtn active={false} disabled={!canRedo} label="Redo" description="Changed your mind about undoing? Bring it back exactly as it was." shortcut="Ctrl+Y" onClick={handleRedo}>
          <Redo2 size={ICON_SIZE} />
        </ToolBtn>

        <div style={dividerStyle} />

        <ToolBtn active={cameraOpen} label="Camera Views" description="Teleport to pre-set viewpoints — see the room from the entrance, the stage, or overhead." onClick={() => { setCameraOpen((p) => !p); setPanelOpen(false); }}>
          <Camera size={ICON_SIZE} />
        </ToolBtn>

        <ToolBtn active={snapEnabled} label="Grid Snap" description="Furniture locks to a 1-metre grid for perfectly aligned layouts. Toggle off for freeform placement." shortcut="G" onClick={handleSnapToggle}>
          <Grid3X3 size={ICON_SIZE} />
        </ToolBtn>

        <ToolBtn active={allWallsUp} label="Show All Walls" description="Pin every wall up so you can see the full room structure. Click individual walls to toggle them." onClick={handleToggleAllWalls}>
          <Eye size={ICON_SIZE} />
        </ToolBtn>

        <ToolBtn active={saveFlash} disabled={isSaving} label={saveFlash ? (isAuthenticated ? "Saved!" : "Auto-saved!") : "Save Layout"} description="Your layout is saved to the cloud instantly. Come back anytime to pick up where you left off." onClick={handleSave}>
          <Save size={ICON_SIZE} />
        </ToolBtn>

        <ToolBtn active={false} label="Events Sheet" description="Generate a professional setup sheet the crew can print and use on event day. Tables, chairs, positions — all laid out." onClick={handleGenerateSheet}>
          <FileText size={ICON_SIZE} />
        </ToolBtn>

        <div style={{ flex: 1 }} />

        <ToolBtn active={false} label={isAuthenticated ? "Your Account" : "Sign In"} description={isAuthenticated ? "View your saved layouts, manage your profile, and track your enquiries." : "Create a free account to save layouts, share with your team, and send to the venue."} onClick={() => { if (isAuthenticated) { void navigate("/dashboard"); } else { setShowAuth(true); } }}>
          <User size={ICON_SIZE} />
        </ToolBtn>
      </div>

      {/* === Slide-out asset panel === */}
      {panelMounted && (
        <div
          data-testid="furniture-panel"
          style={{
            ...panelStyle,
            animation: panelOpen
              ? "omni-panel-slide 0.45s cubic-bezier(0.16, 1, 0.3, 1) forwards"
              : "omni-panel-slide-out 0.3s cubic-bezier(0.55, 0, 1, 0.45) forwards",
          }}
        >
          {/* Gold accent */}
          <div style={{ width: 32, height: 3, borderRadius: 2, background: `linear-gradient(90deg, ${GOLD}, rgba(201,168,76,0.2))`, marginBottom: 14 }} />
          <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: 2.5, color: GOLD, marginBottom: 4 }}>
            Catalogue
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#f5f5f5", fontFamily: "'Playfair Display', serif", marginBottom: 16, letterSpacing: -0.3 }}>
            Furniture
          </div>

          {/* Search */}
          <div style={{ position: "relative", marginBottom: 16 }}>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); }}
              placeholder="Search furniture\u2026"
              style={{
                width: "100%", padding: "9px 12px 9px 32px", fontSize: 13,
                fontFamily: "'Inter', system-ui, sans-serif",
                background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 8, color: "#f0f0f0", outline: "none",
                boxSizing: "border-box",
                transition: "border-color 0.2s, box-shadow 0.2s",
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = "rgba(201,168,76,0.3)"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(201,168,76,0.06)"; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.boxShadow = "none"; }}
            />
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2" strokeLinecap="round" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>

          {CATALOGUE_CATEGORIES.map((cat) => {
            const allItems = getCatalogueByCategory(cat);
            const q = searchQuery.trim().toLowerCase();
            const items = q.length > 0 ? allItems.filter((item) => item.name.toLowerCase().includes(q) || item.subtitle.toLowerCase().includes(q) || categoryLabel(cat).toLowerCase().includes(q)) : allItems;
            if (items.length === 0) return null;
            const collapsed = collapsedCategories.has(cat) && q.length === 0;
            return (
              <div key={cat}>
                <div data-testid={`category-header-${cat}`} style={categoryHeaderStyle} onClick={() => { toggleCategory(cat); }}>
                  <span>{categoryLabel(cat)} <span style={{ fontSize: 10, fontWeight: 400, color: "rgba(255,255,255,0.3)" }}>{items.length}</span></span>
                  <span style={{ fontSize: 14 }}>{collapsed ? "+" : "\u2212"}</span>
                </div>
                {!collapsed && items.map((item, idx) => (
                  <div
                    key={item.id}
                    className="omni-asset-row"
                    style={{
                      ...assetRowStyle,
                      animation: `omni-panel-item 0.3s cubic-bezier(0.16, 1, 0.3, 1) ${String(idx * 0.04)}s both`,
                      borderLeft: "2px solid transparent",
                    }}
                    onClick={() => { handleAssetClick(item); }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === "Enter") handleAssetClick(item); }}
                  >
                    {/* SVG thumbnail */}
                    <div
                      style={{
                        width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                        background: "rgba(201,168,76,0.04)",
                        border: "1px solid rgba(201,168,76,0.08)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        padding: 2,
                      }}
                      dangerouslySetInnerHTML={{ __html: catalogueIcon(item) }}
                    />
                    {/* Name + subtitle */}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#eee", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {item.name}
                      </div>
                      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {item.subtitle}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}

          {/* Empty search state */}
          {searchQuery.trim().length > 0 && CATALOGUE_CATEGORIES.every((cat) => {
            const q = searchQuery.trim().toLowerCase();
            return getCatalogueByCategory(cat).filter((item) => item.name.toLowerCase().includes(q) || item.subtitle.toLowerCase().includes(q) || categoryLabel(cat).toLowerCase().includes(q)).length === 0;
          }) && (
            <div style={{ textAlign: "center", padding: "24px 8px", color: "rgba(255,255,255,0.3)", fontSize: 13 }}>
              No items match &ldquo;{searchQuery.trim()}&rdquo;
            </div>
          )}
        </div>
      )}

      {/* === Camera dropdown === */}
      {cameraMounted && bookmarks.length > 0 && (
        <div style={{
          ...cameraDropdownStyle,
          top: 280,
          animation: cameraOpen
            ? "omni-dropdown-pop 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards"
            : "omni-dropdown-pop-out 0.25s cubic-bezier(0.55, 0, 1, 0.45) forwards",
        }}>
          {bookmarks.map((bm, i) => (
            <button
              key={bm.id}
              type="button"
              className="omni-cam-item"
              style={{
                ...cameraItemStyle,
                animation: `omni-panel-item 0.25s cubic-bezier(0.16, 1, 0.3, 1) ${String(i * 0.05)}s both`,
              }}
              onClick={() => { handleCameraPreset(i); }}
            >
              {bm.name}
            </button>
          ))}
        </div>
      )}
      {showAuth && <AuthModal onClose={() => { setShowAuth(false); }} />}
    </>
  );
}
