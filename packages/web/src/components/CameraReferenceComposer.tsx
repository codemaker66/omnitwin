import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { Camera, Check, X } from "lucide-react";
import {
  DEFAULT_CUSTOM_EYE_HEIGHT_M,
  MAX_CUSTOM_EYE_HEIGHT_M,
  MIN_CUSTOM_EYE_HEIGHT_M,
  resolveCameraEyeHeight,
  type CameraEyeHeightMode,
} from "../lib/camera-animation.js";
import { useBookmarkStore } from "../stores/bookmark-store.js";
import { useCameraReferenceStore } from "../stores/camera-reference-store.js";

const GOLD = "#c9a84c";
const DIALOG_MARGIN_PX = 16;
const PANEL_WIDTH_PX = 340;
const PANEL_FALLBACK_HEIGHT_PX = 324;

export interface CameraReferenceDialogPosition {
  readonly left: number;
  readonly top: number;
}

interface CameraReferenceDialogSize {
  readonly width: number;
  readonly height: number;
}

interface CameraReferenceViewportSize {
  readonly width: number;
  readonly height: number;
}

interface DragState {
  readonly pointerId: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly panelSize: CameraReferenceDialogSize;
}

function getViewportSize(): CameraReferenceViewportSize {
  if (typeof window === "undefined") return { width: 1024, height: 768 };
  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

function getDefaultPanelSize(viewportWidth: number): CameraReferenceDialogSize {
  return {
    width: Math.min(PANEL_WIDTH_PX, Math.max(0, viewportWidth - DIALOG_MARGIN_PX * 2)),
    height: PANEL_FALLBACK_HEIGHT_PX,
  };
}

export function clampCameraReferenceDialogPosition(
  position: CameraReferenceDialogPosition,
  viewport: CameraReferenceViewportSize,
  panelSize: CameraReferenceDialogSize = getDefaultPanelSize(viewport.width),
): CameraReferenceDialogPosition {
  const maxLeft = Math.max(DIALOG_MARGIN_PX, viewport.width - panelSize.width - DIALOG_MARGIN_PX);
  const maxTop = Math.max(DIALOG_MARGIN_PX, viewport.height - panelSize.height - DIALOG_MARGIN_PX);
  return {
    left: Math.min(Math.max(position.left, DIALOG_MARGIN_PX), maxLeft),
    top: Math.min(Math.max(position.top, DIALOG_MARGIN_PX), maxTop),
  };
}

export function getInitialCameraReferenceDialogPosition(
  screenX: number,
  screenY: number,
  viewport: CameraReferenceViewportSize = getViewportSize(),
): CameraReferenceDialogPosition {
  return clampCameraReferenceDialogPosition(
    { left: screenX + 12, top: screenY + 12 },
    viewport,
    getDefaultPanelSize(viewport.width),
  );
}

const panelStyle: CSSProperties = {
  position: "fixed",
  width: 340,
  maxWidth: "calc(100vw - 32px)",
  padding: 14,
  borderRadius: 16,
  border: "1px solid rgba(201,168,76,0.22)",
  background: "linear-gradient(145deg, rgba(17,17,17,0.96), rgba(28,28,28,0.96))",
  boxShadow: "0 22px 70px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06)",
  color: "#f4f0e8",
  fontFamily: "'Inter', system-ui, sans-serif",
  backdropFilter: "blur(18px)",
  WebkitBackdropFilter: "blur(18px)",
  zIndex: 80,
  pointerEvents: "auto",
  userSelect: "none",
  WebkitUserSelect: "none",
};

const heightGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr 1fr",
  gap: 8,
};

function heightButtonStyle(active: boolean): CSSProperties {
  return {
    minHeight: 48,
    borderRadius: 12,
    border: active ? `1px solid ${GOLD}` : "1px solid rgba(255,255,255,0.12)",
    background: active
      ? "linear-gradient(145deg, rgba(201,168,76,0.28), rgba(201,168,76,0.12))"
      : "rgba(255,255,255,0.04)",
    color: active ? "#fff7df" : "rgba(255,255,255,0.72)",
    fontSize: 12,
    fontWeight: 750,
    cursor: "pointer",
    transition: "background 0.16s, border-color 0.16s, color 0.16s",
  };
}

function formatHeight(heightM: number): string {
  return `${heightM.toFixed(2)} m`;
}

function sourceCopy(sourceLabel: string, source: "floor" | "furniture"): string {
  return source === "furniture"
    ? `${sourceLabel} viewpoint`
    : "Floor grid viewpoint";
}

export function CameraReferenceComposer(): React.ReactElement | null {
  const draft = useCameraReferenceStore((s) => s.draft);
  const closeDraft = useCameraReferenceStore((s) => s.closeDraft);
  const [name, setName] = useState("");
  const [heightMode, setHeightMode] = useState<CameraEyeHeightMode>("sitting");
  const [customHeightM, setCustomHeightM] = useState(DEFAULT_CUSTOM_EYE_HEIGHT_M);
  const [dialogPosition, setDialogPosition] = useState<CameraReferenceDialogPosition | null>(null);
  const [isDraggingDialog, setIsDraggingDialog] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLFormElement>(null);
  const dragStateRef = useRef<DragState | null>(null);

  useEffect(() => {
    if (draft === null) {
      setDialogPosition(null);
      return;
    }
    setName(draft.suggestedName);
    setHeightMode(draft.source === "furniture" ? "sitting" : "standing");
    setCustomHeightM(DEFAULT_CUSTOM_EYE_HEIGHT_M);
    setDialogPosition(getInitialCameraReferenceDialogPosition(draft.screenX, draft.screenY));
    const focusTimer = window.setTimeout(() => {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    }, 0);
    return () => {
      window.clearTimeout(focusTimer);
    };
  }, [draft]);

  useEffect(() => {
    if (draft === null) return;
    function onResize(): void {
      setDialogPosition((current) => {
        if (current === null) return current;
        const rect = panelRef.current?.getBoundingClientRect();
        const panelSize = rect === undefined
          ? getDefaultPanelSize(getViewportSize().width)
          : { width: rect.width, height: rect.height };
        return clampCameraReferenceDialogPosition(current, getViewportSize(), panelSize);
      });
    }
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, [draft]);

  useEffect(() => {
    if (draft === null) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") closeDraft();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [draft, closeDraft]);

  const panelPosition = useMemo<CSSProperties>(() => {
    if (draft === null) return {};
    return dialogPosition ?? getInitialCameraReferenceDialogPosition(draft.screenX, draft.screenY);
  }, [dialogPosition, draft]);

  if (draft === null) return null;

  const activeDraft = draft;
  const resolvedHeight = resolveCameraEyeHeight(heightMode, customHeightM);
  const cleanName = name.trim().length > 0 ? name.trim() : activeDraft.suggestedName;

  function addReference(): void {
    const id = useBookmarkStore.getState().addReferenceBookmark({
      name: cleanName,
      source: activeDraft.source,
      sourceLabel: activeDraft.sourceLabel,
      point: activeDraft.point,
      baseY: activeDraft.baseY,
      yaw: activeDraft.yaw,
      heightMode,
      customEyeHeightM: customHeightM,
    });
    useBookmarkStore.getState().requestNavigation(id);
    closeDraft();
  }

  function beginDialogDrag(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return;
    const rect = panelRef.current?.getBoundingClientRect();
    const currentPosition = dialogPosition ?? getInitialCameraReferenceDialogPosition(activeDraft.screenX, activeDraft.screenY);
    dragStateRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - (rect?.left ?? currentPosition.left),
      offsetY: event.clientY - (rect?.top ?? currentPosition.top),
      panelSize: rect === undefined
        ? getDefaultPanelSize(getViewportSize().width)
        : { width: rect.width, height: rect.height },
    };
    setIsDraggingDialog(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    window.getSelection()?.removeAllRanges();
    event.preventDefault();
    event.stopPropagation();
  }

  function moveDialog(event: ReactPointerEvent<HTMLDivElement>): void {
    const dragState = dragStateRef.current;
    if (dragState === null || dragState.pointerId !== event.pointerId) return;
    setDialogPosition(clampCameraReferenceDialogPosition(
      {
        left: event.clientX - dragState.offsetX,
        top: event.clientY - dragState.offsetY,
      },
      getViewportSize(),
      dragState.panelSize,
    ));
    window.getSelection()?.removeAllRanges();
    event.preventDefault();
    event.stopPropagation();
  }

  function endDialogDrag(event: ReactPointerEvent<HTMLDivElement>): void {
    const dragState = dragStateRef.current;
    if (dragState === null || dragState.pointerId !== event.pointerId) return;
    dragStateRef.current = null;
    setIsDraggingDialog(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    window.getSelection()?.removeAllRanges();
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <form
      ref={panelRef}
      aria-label="Add camera POV"
      data-testid="camera-reference-composer"
      data-camera-keyboard-lock="true"
      role="dialog"
      style={{ ...panelStyle, ...panelPosition }}
      onSubmit={(event) => {
        event.preventDefault();
        addReference();
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div
          data-testid="camera-reference-drag-handle"
          aria-label="Move camera POV dialog"
          onPointerDown={beginDialogDrag}
          onPointerMove={moveDialog}
          onPointerUp={endDialogDrag}
          onPointerCancel={endDialogDrag}
          onLostPointerCapture={() => {
            dragStateRef.current = null;
            setIsDraggingDialog(false);
          }}
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            minWidth: 0,
            flex: 1,
            cursor: isDraggingDialog ? "grabbing" : "grab",
            touchAction: "none",
          }}
        >
          <div
            aria-hidden="true"
            style={{
              width: 38,
              height: 38,
              borderRadius: 12,
              background: "rgba(201,168,76,0.14)",
              border: "1px solid rgba(201,168,76,0.25)",
              display: "grid",
              placeItems: "center",
              color: GOLD,
              flex: "0 0 auto",
            }}
          >
            <Camera size={18} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ color: GOLD, fontSize: 10, fontWeight: 800, letterSpacing: 1.8, textTransform: "uppercase" }}>
              Camera point of reference
            </div>
            <div style={{ fontSize: 18, lineHeight: 1.15, fontWeight: 850, marginTop: 3 }}>
              Add POV
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.58)", marginTop: 5 }}>
              {sourceCopy(draft.sourceLabel, draft.source)}
            </div>
          </div>
        </div>
        <button
          type="button"
          aria-label="Cancel camera POV"
          onClick={closeDraft}
          style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.1)",
            background: "rgba(255,255,255,0.04)",
            color: "rgba(255,255,255,0.72)",
            cursor: "pointer",
            display: "grid",
            placeItems: "center",
          }}
        >
          <X size={16} />
        </button>
      </div>

      <label style={{ display: "block", marginTop: 14 }}>
        <span style={{ display: "block", fontSize: 10, fontWeight: 800, letterSpacing: 1.6, textTransform: "uppercase", color: "rgba(255,255,255,0.5)", marginBottom: 7 }}>
          Name
        </span>
        <input
          ref={nameInputRef}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
          style={{
            width: "100%",
            minHeight: 44,
            boxSizing: "border-box",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.13)",
            background: "rgba(255,255,255,0.06)",
            color: "#fff",
            padding: "0 12px",
            fontSize: 14,
            outline: "none",
            userSelect: "text",
            WebkitUserSelect: "text",
          }}
        />
      </label>

      <div style={{ marginTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, marginBottom: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.6, textTransform: "uppercase", color: "rgba(255,255,255,0.5)" }}>
            Eye height
          </span>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.52)" }}>
            {formatHeight(resolvedHeight)}
          </span>
        </div>
        <div style={heightGridStyle}>
          {(["sitting", "standing", "custom"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              style={heightButtonStyle(heightMode === mode)}
              onClick={() => {
                setHeightMode(mode);
              }}
            >
              {mode === "sitting" ? "Sitting" : mode === "standing" ? "Standing" : "Custom"}
            </button>
          ))}
        </div>
        {heightMode === "custom" && (
          <input
            aria-label="Custom eye height"
            type="number"
            min={MIN_CUSTOM_EYE_HEIGHT_M}
            max={MAX_CUSTOM_EYE_HEIGHT_M}
            step={0.05}
            value={customHeightM}
            onChange={(event) => {
              setCustomHeightM(Number(event.target.value));
            }}
            style={{
              marginTop: 8,
              width: "100%",
              minHeight: 44,
              boxSizing: "border-box",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.13)",
              background: "rgba(255,255,255,0.06)",
              color: "#fff",
              padding: "0 12px",
              fontSize: 14,
              outline: "none",
              userSelect: "text",
              WebkitUserSelect: "text",
            }}
          />
        )}
      </div>

      <button
        type="submit"
        style={{
          width: "100%",
          minHeight: 48,
          marginTop: 14,
          borderRadius: 12,
          border: "1px solid rgba(201,168,76,0.35)",
          background: "linear-gradient(145deg, #d3b35f, #ad8b2b)",
          color: "#111",
          fontWeight: 850,
          fontSize: 14,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          boxShadow: "0 10px 26px rgba(201,168,76,0.22)",
        }}
      >
        <Check size={16} />
        Add + view
      </button>
    </form>
  );
}

export function CameraReferenceHeightSwitch(): React.ReactElement | null {
  const activeReferenceId = useBookmarkStore((s) => s.activeReferenceId);
  const bookmark = useBookmarkStore((s) =>
    activeReferenceId === null
      ? undefined
      : s.bookmarks.find((b) => b.id === activeReferenceId),
  );

  if (activeReferenceId === null || bookmark?.kind !== "reference" || bookmark.reference === undefined) {
    return null;
  }

  const activeMode = bookmark.reference.heightMode;

  return (
    <div
      aria-label="POV height"
      style={{
        position: "fixed",
        left: "calc(var(--toolbox-offset, 68px) + 18px)",
        top: 18,
        zIndex: 56,
        pointerEvents: "auto",
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: 8,
        borderRadius: 16,
        border: "1px solid rgba(201,168,76,0.22)",
        background: "linear-gradient(145deg, rgba(17,17,17,0.92), rgba(28,28,28,0.92))",
        color: "#f5f0e8",
        fontFamily: "'Inter', system-ui, sans-serif",
        boxShadow: "0 16px 48px rgba(0,0,0,0.38), inset 0 1px 0 rgba(255,255,255,0.06)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
      }}
    >
      <div style={{ padding: "0 6px", minWidth: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 850, letterSpacing: 1.5, color: GOLD, textTransform: "uppercase" }}>
          POV height
        </div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.58)", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {bookmark.name}
        </div>
      </div>
      {(["sitting", "standing"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          onClick={() => {
            useBookmarkStore.getState().updateReferenceHeight(activeReferenceId, mode);
          }}
          style={{
            minWidth: 76,
            minHeight: 44,
            borderRadius: 12,
            border: activeMode === mode ? `1px solid ${GOLD}` : "1px solid rgba(255,255,255,0.12)",
            background: activeMode === mode ? "rgba(201,168,76,0.2)" : "rgba(255,255,255,0.04)",
            color: activeMode === mode ? "#fff7df" : "rgba(255,255,255,0.72)",
            fontSize: 12,
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          {mode === "sitting" ? "Sitting" : "Standing"}
        </button>
      ))}
    </div>
  );
}
