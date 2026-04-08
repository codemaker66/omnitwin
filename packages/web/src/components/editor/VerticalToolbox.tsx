import { useState, useCallback, useRef } from "react";
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
import {
  CATALOGUE_CATEGORIES,
  getCatalogueByCategory,
  categoryLabel,
} from "../../lib/catalogue.js";
import type { CatalogueItem } from "../../lib/catalogue.js";
import type { FurnitureCategory } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const TOOLBAR_W = 52;
const PANEL_W = 260;
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
  background: "rgba(26,26,26,0.97)", borderRight: "1px solid #333",
  zIndex: 49, overflowY: "auto", padding: "16px 12px",
  fontFamily: "'Inter', sans-serif", color: "#ccc",
  backdropFilter: "blur(12px)",
};

const categoryHeaderStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1,
  color: "#777", padding: "12px 8px 6px", cursor: "pointer",
  display: "flex", justifyContent: "space-between", alignItems: "center",
};

const assetRowStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 10, padding: "8px 8px",
  borderRadius: 6, cursor: "pointer", fontSize: 13, color: "#ddd",
  transition: "background 0.15s",
};

const cameraDropdownStyle: React.CSSProperties = {
  position: "fixed", left: TOOLBAR_W + 8, background: "#222", borderRadius: 8,
  padding: 4, zIndex: 51, boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
  border: "1px solid #444", minWidth: 160,
};

const cameraItemStyle: React.CSSProperties = {
  display: "block", width: "100%", padding: "8px 12px", fontSize: 13,
  background: "none", border: "none", color: "#ccc", cursor: "pointer",
  textAlign: "left", borderRadius: 4,
};

// ---------------------------------------------------------------------------
// Category colour dots
// ---------------------------------------------------------------------------

const CATEGORY_COLORS: Partial<Record<FurnitureCategory, string>> = {
  table: "#8b6914",
  chair: "#a82020",
  stage: "#4a4a4a",
  decor: "#1a1a1a",
};

// ---------------------------------------------------------------------------
// Tooltip — rich animated popout labels
// ---------------------------------------------------------------------------

const TOOLTIP_ANIM_ID = "omni-tooltip-anims";
if (typeof document !== "undefined" && document.getElementById(TOOLTIP_ANIM_ID) === null) {
  const s = document.createElement("style");
  s.id = TOOLTIP_ANIM_ID;
  s.textContent = `
    @keyframes omni-tooltip-in {
      0% { opacity: 0; transform: translateX(-8px) scale(0.9); }
      50% { transform: translateX(4px) scale(1.02); }
      100% { opacity: 1; transform: translateX(0) scale(1); }
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
  const [hovered, setHovered] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onEnter = (): void => {
    timeoutRef.current = setTimeout(() => { setHovered(true); }, 250);
  };
  const onLeave = (): void => {
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    setHovered(false);
  };

  return (
    <div style={{ position: "relative" }} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <button
        type="button"
        style={btnStyle(active, disabled)}
        onClick={onClick}
        disabled={disabled}
      >
        {children}
      </button>
      {hovered && !disabled && (
        <div style={{
          position: "absolute",
          left: 52,
          top: "50%",
          transform: "translateY(-50%)",
          zIndex: 100,
          pointerEvents: "none",
          animation: "omni-tooltip-in 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards",
        }}>
          {/* Arrow */}
          <div style={{
            position: "absolute",
            left: -6,
            top: "50%",
            transform: "translateY(-50%)",
            width: 0, height: 0,
            borderTop: "7px solid transparent",
            borderBottom: "7px solid transparent",
            borderRight: "7px solid #1a1a1a",
          }} />
          <div style={{
            background: "linear-gradient(135deg, #1a1a1a, #222)",
            border: `1px solid rgba(201,168,76,0.25)`,
            borderRadius: 12,
            padding: "10px 16px",
            minWidth: 160,
            boxShadow: "0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(201,168,76,0.1)",
          }}>
            <div style={{
              fontSize: 15,
              fontWeight: 700,
              color: "#fff",
              letterSpacing: -0.2,
              fontFamily: "'Inter', system-ui, sans-serif",
            }}>
              {label}
            </div>
            <div style={{
              fontSize: 12,
              color: "#888",
              marginTop: 3,
              lineHeight: 1.4,
              fontFamily: "'Inter', system-ui, sans-serif",
            }}>
              {description}
            </div>
            {shortcut !== undefined && (
              <div style={{
                marginTop: 6,
                display: "inline-block",
                padding: "2px 8px",
                borderRadius: 4,
                background: "rgba(201,168,76,0.12)",
                color: GOLD,
                fontSize: 11,
                fontWeight: 600,
                fontFamily: "'Inter', system-ui, sans-serif",
                letterSpacing: 0.5,
              }}>
                {shortcut}
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
  const [activeTool, setActiveTool] = useState<ActiveTool>("select");
  const [panelOpen, setPanelOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [saveFlash, setSaveFlash] = useState(false);

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
    void useEditorStore.getState().saveToServer(true).then(() => {
      setSaveFlash(true);
      setTimeout(() => { setSaveFlash(false); }, 1500);
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

  return (
    <>
      {/* === Toolbar strip === */}
      <div style={toolbarStyle}>
        <ToolBtn active={activeTool === "select"} label="Select" description="Click to select furniture, drag to move" shortcut="V" onClick={() => { handleToolClick("select"); }}>
          <MousePointer2 size={ICON_SIZE} />
        </ToolBtn>

        <ToolBtn active={activeTool === "add"} label="Add Furniture" description="Browse tables, chairs, AV and more" onClick={() => { handleToolClick("add"); }}>
          <Armchair size={ICON_SIZE} />
        </ToolBtn>

        <ToolBtn active={activeTool === "rotate"} label="Rotate" description="Spin selected items 15° at a time" shortcut="Q / E" onClick={() => { handleToolClick("rotate"); }}>
          <RotateCw size={ICON_SIZE} />
        </ToolBtn>

        <ToolBtn active={activeTool === "delete"} label="Delete" description="Remove selected furniture" shortcut="Del" onClick={() => { handleToolClick("delete"); }}>
          <Trash2 size={ICON_SIZE} />
        </ToolBtn>

        <div style={dividerStyle} />

        <ToolBtn active={false} disabled={!canUndo} label="Undo" description="Reverse your last action" shortcut="Ctrl+Z" onClick={handleUndo}>
          <Undo2 size={ICON_SIZE} />
        </ToolBtn>

        <ToolBtn active={false} disabled={!canRedo} label="Redo" description="Bring back what you undid" shortcut="Ctrl+Y" onClick={handleRedo}>
          <Redo2 size={ICON_SIZE} />
        </ToolBtn>

        <div style={dividerStyle} />

        <ToolBtn active={cameraOpen} label="Camera Views" description="Jump to saved viewpoints" onClick={() => { setCameraOpen((p) => !p); setPanelOpen(false); }}>
          <Camera size={ICON_SIZE} />
        </ToolBtn>

        <ToolBtn active={snapEnabled} label="Grid Snap" description="Align items to the floor grid" shortcut="G" onClick={handleSnapToggle}>
          <Grid3X3 size={ICON_SIZE} />
        </ToolBtn>

        <ToolBtn active={allWallsUp} label="Show All Walls" description="Keep every wall visible while you work" onClick={handleToggleAllWalls}>
          <Eye size={ICON_SIZE} />
        </ToolBtn>

        <ToolBtn active={saveFlash} disabled={isSaving} label="Save" description="Save your layout to the cloud" onClick={handleSave}>
          <Save size={ICON_SIZE} />
        </ToolBtn>

        <ToolBtn active={false} label="Events Sheet" description="Generate a setup sheet for the crew" onClick={handleGenerateSheet}>
          <FileText size={ICON_SIZE} />
        </ToolBtn>

        <div style={{ flex: 1 }} />

        <ToolBtn active={false} label={isAuthenticated ? "Account" : "Sign In"} description={isAuthenticated ? "Manage your account settings" : "Sign in to save your layouts"} onClick={() => {}}>
          <User size={ICON_SIZE} />
        </ToolBtn>
      </div>

      {/* === Slide-out asset panel === */}
      {panelOpen && (
        <div style={panelStyle}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", marginBottom: 12 }}>
            Furniture
          </div>
          {CATALOGUE_CATEGORIES.map((cat) => {
            const items = getCatalogueByCategory(cat);
            if (items.length === 0) return null;
            const collapsed = collapsedCategories.has(cat);
            return (
              <div key={cat}>
                <div style={categoryHeaderStyle} onClick={() => { toggleCategory(cat); }}>
                  <span>{categoryLabel(cat)}</span>
                  <span style={{ fontSize: 14 }}>{collapsed ? "+" : "−"}</span>
                </div>
                {!collapsed && items.map((item) => (
                  <div
                    key={item.id}
                    style={assetRowStyle}
                    onClick={() => { handleAssetClick(item); }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === "Enter") handleAssetClick(item); }}
                  >
                    <div style={{
                      width: 8, height: 8, borderRadius: 2,
                      background: CATEGORY_COLORS[cat] ?? "#666",
                    }} />
                    <span>{item.name}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* === Camera dropdown === */}
      {cameraOpen && bookmarks.length > 0 && (
        <div style={{ ...cameraDropdownStyle, top: 280 }}>
          {bookmarks.map((bm, i) => (
            <button
              key={bm.id}
              type="button"
              style={cameraItemStyle}
              onClick={() => { handleCameraPreset(i); }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              {bm.name}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
