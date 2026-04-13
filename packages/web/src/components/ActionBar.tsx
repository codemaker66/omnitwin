import { useCallback, useEffect } from "react";
import { usePlacementStore } from "../stores/placement-store.js";
import { useSelectionStore } from "../stores/selection-store.js";
import type { PlacedItem } from "../lib/placement.js";

// ---------------------------------------------------------------------------
// ActionBar — undo/redo/snap buttons (top-left floating)
// ---------------------------------------------------------------------------

const barStyle: React.CSSProperties = {
  position: "absolute",
  top: 16,
  left: 16,
  display: "flex",
  flexDirection: "row",
  gap: 6,
  zIndex: 20,
  pointerEvents: "auto",
};

const btnBase: React.CSSProperties = {
  width: 44,
  height: 44,
  borderRadius: 8,
  border: "none",
  background: "rgba(30, 30, 30, 0.85)",
  cursor: "pointer",
  padding: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 1,
  boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
  transition: "background 0.15s, opacity 0.15s",
  color: "#e0e0e0",
};

const btnDisabled: React.CSSProperties = {
  ...btnBase,
  opacity: 0.35,
  cursor: "default",
};

const btnActive: React.CSSProperties = {
  ...btnBase,
  background: "rgba(60, 120, 200, 0.6)",
  boxShadow: "0 2px 8px rgba(60,120,200,0.3), inset 0 0 8px rgba(100,160,255,0.15)",
};

const labelStyle: React.CSSProperties = {
  fontSize: 8,
  fontFamily: "system-ui, -apple-system, sans-serif",
  fontWeight: 500,
  lineHeight: 1,
  opacity: 0.7,
  letterSpacing: 0.3,
};

// ---------------------------------------------------------------------------
// SVG Icons (inline, 20x20)
// ---------------------------------------------------------------------------

function UndoIcon(): React.ReactElement {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 9h8a4 4 0 010 8H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 6L4 9l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RedoIcon(): React.ReactElement {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M16 9H8a4 4 0 000 8h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 6l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GroupIcon(): React.ReactElement {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="3" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="11" y="3" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="3" y="11" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="11" y="11" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="1" y="1" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" opacity="0.5" />
    </svg>
  );
}

function UngroupIcon(): React.ReactElement {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="12" y="2" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="2" y="12" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="12" y="12" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function GridSnapIcon(): React.ReactElement {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Grid lines */}
      <line x1="4" y1="4" x2="4" y2="16" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      <line x1="10" y1="4" x2="10" y2="16" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      <line x1="16" y1="4" x2="16" y2="16" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      <line x1="4" y1="4" x2="16" y2="4" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      <line x1="4" y1="10" x2="16" y2="10" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      <line x1="4" y1="16" x2="16" y2="16" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      {/* Snap dot at intersection */}
      <circle cx="10" cy="10" r="2" fill="currentColor" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Returns true if all selected items share the same non-null groupId. */
function areAllGrouped(selectedIds: ReadonlySet<string>, placedItems: readonly PlacedItem[]): boolean {
  if (selectedIds.size < 2) return false;
  let commonGroup: string | null = null;
  for (const item of placedItems) {
    if (!selectedIds.has(item.id)) continue;
    if (item.groupId === null) return false;
    if (commonGroup === null) {
      commonGroup = item.groupId;
    } else if (item.groupId !== commonGroup) {
      return false;
    }
  }
  return commonGroup !== null;
}

export function ActionBar(): React.ReactElement {
  const undoStack = usePlacementStore((s) => s.undoStack);
  const redoStack = usePlacementStore((s) => s.redoStack);
  const snapEnabled = usePlacementStore((s) => s.snapEnabled);
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const placedItems = usePlacementStore((s) => s.placedItems);

  const canUndo = undoStack.length > 0;
  const canRedo = redoStack.length > 0;
  const hasMultiSelect = selectedIds.size >= 2;
  const allGrouped = areAllGrouped(selectedIds, placedItems);

  const handleUndo = useCallback(() => {
    usePlacementStore.getState().undo();
    useSelectionStore.getState().clearSelection();
  }, []);

  const handleRedo = useCallback(() => {
    usePlacementStore.getState().redo();
    useSelectionStore.getState().clearSelection();
  }, []);

  const handleToggleSnap = useCallback(() => {
    usePlacementStore.getState().toggleSnap();
  }, []);

  const handleGroup = useCallback(() => {
    const ids = useSelectionStore.getState().selectedIds;
    if (ids.size < 2) return;
    const items = usePlacementStore.getState().placedItems;
    if (areAllGrouped(ids, items)) {
      usePlacementStore.getState().ungroupItems(ids);
    } else {
      usePlacementStore.getState().groupItems(ids);
    }
  }, []);

  // Ctrl+G keyboard shortcut for group/ungroup
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.code === "KeyG" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleGroup();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); };
  }, [handleGroup]);

  return (
    <div style={barStyle} role="toolbar" aria-label="Editor actions">
      <button
        type="button"
        style={canUndo ? btnBase : btnDisabled}
        onClick={handleUndo}
        disabled={!canUndo}
        title="Undo (Ctrl+Z)"
        aria-label="Undo"
      >
        <UndoIcon />
        <span style={labelStyle} aria-hidden="true">Undo</span>
      </button>
      <button
        type="button"
        style={canRedo ? btnBase : btnDisabled}
        onClick={handleRedo}
        disabled={!canRedo}
        title="Redo (Ctrl+Y)"
        aria-label="Redo"
      >
        <RedoIcon />
        <span style={labelStyle} aria-hidden="true">Redo</span>
      </button>
      <button
        type="button"
        style={snapEnabled ? btnActive : btnBase}
        onClick={handleToggleSnap}
        title="Toggle Grid Snap (G)"
        aria-label="Toggle grid snap"
        aria-pressed={snapEnabled}
      >
        <GridSnapIcon />
        <span style={labelStyle} aria-hidden="true">Snap</span>
      </button>
      {hasMultiSelect && (
        <button
          type="button"
          style={btnBase}
          onClick={handleGroup}
          title={allGrouped ? "Ungroup (Ctrl+G)" : "Group (Ctrl+G)"}
          aria-label={allGrouped ? "Ungroup selected items" : "Group selected items"}
        >
          {allGrouped ? <UngroupIcon /> : <GroupIcon />}
          <span style={labelStyle} aria-hidden="true">{allGrouped ? "Ungroup" : "Group"}</span>
        </button>
      )}
    </div>
  );
}
