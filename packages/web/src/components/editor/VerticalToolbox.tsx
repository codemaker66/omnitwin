import { useState, useCallback } from "react";
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
        {/* Select */}
        <button type="button" style={btnStyle(activeTool === "select")} onClick={() => { handleToolClick("select"); }} title="Select (V)">
          <MousePointer2 size={ICON_SIZE} />
        </button>

        {/* Add Furniture */}
        <button type="button" style={btnStyle(activeTool === "add")} onClick={() => { handleToolClick("add"); }} title="Add Furniture">
          <Armchair size={ICON_SIZE} />
        </button>

        {/* Rotate */}
        <button type="button" style={btnStyle(activeTool === "rotate")} onClick={() => { handleToolClick("rotate"); }} title="Rotate (R)">
          <RotateCw size={ICON_SIZE} />
        </button>

        {/* Delete */}
        <button type="button" style={btnStyle(activeTool === "delete")} onClick={() => { handleToolClick("delete"); }} title="Delete (Del)">
          <Trash2 size={ICON_SIZE} />
        </button>

        <div style={dividerStyle} />

        {/* Undo */}
        <button type="button" style={btnStyle(false, !canUndo)} onClick={handleUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">
          <Undo2 size={ICON_SIZE} />
        </button>

        {/* Redo */}
        <button type="button" style={btnStyle(false, !canRedo)} onClick={handleRedo} disabled={!canRedo} title="Redo (Ctrl+Y)">
          <Redo2 size={ICON_SIZE} />
        </button>

        <div style={dividerStyle} />

        {/* Camera */}
        <button type="button" style={btnStyle(cameraOpen)} onClick={() => { setCameraOpen((p) => !p); setPanelOpen(false); }} title="Camera Views">
          <Camera size={ICON_SIZE} />
        </button>

        {/* Snap */}
        <button type="button" style={btnStyle(snapEnabled)} onClick={handleSnapToggle} title="Grid Snap (G)">
          <Grid3X3 size={ICON_SIZE} />
        </button>

        {/* Show All Walls */}
        <button type="button" style={btnStyle(allWallsUp)} onClick={handleToggleAllWalls} title="Show All Walls">
          <Eye size={ICON_SIZE} />
        </button>

        {/* Save */}
        <button type="button" style={btnStyle(saveFlash)} onClick={handleSave} title="Save" disabled={isSaving}>
          <Save size={ICON_SIZE} />
        </button>

        {/* Generate Events Sheet */}
        <button type="button" style={btnStyle(false)} onClick={handleGenerateSheet} title="Events Sheet">
          <FileText size={ICON_SIZE} />
        </button>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* User */}
        <button type="button" style={btnStyle(false)} title={isAuthenticated ? "Account" : "Sign In"}>
          <User size={ICON_SIZE} />
        </button>
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
