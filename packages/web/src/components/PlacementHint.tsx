import { useEffect, useMemo, useRef, useState } from "react";
import { getCatalogueItem } from "../lib/catalogue.js";
import { useCatalogueStore } from "../stores/catalogue-store.js";
import { usePlacementStore } from "../stores/placement-store.js";
import { useCockpitStore } from "../stores/cockpit-store.js";
import { useIsCoarsePointer, useIsNarrowViewport } from "../hooks/use-media-query.js";
import { FloatingWidgetFrame, type FloatingWidgetPlacement } from "./shared/FloatingWidgetFrame.js";

// ---------------------------------------------------------------------------
// PlacementHint - contextual placement coach + invalid placement feedback.
//
// It deliberately reuses the shared floating-widget frame so guidance can be
// moved, minimized, reset, and persisted like the other planner overlays.
// ---------------------------------------------------------------------------

const STORAGE_KEY = "omni-placement-hint-dismissed";
const REASON_DISPLAY_MS = 2_200;

const DEFAULT_PLACEMENT: FloatingWidgetPlacement = {
  type: "anchor",
  anchor: "bottom-left",
  offsetX: 204,
  offsetY: 276,
};

const AVOID_SELECTORS = [
  ".planner-status-header",
  ".cockpit-layer-controls",
  "[data-testid='planner-toolbar']",
  "[data-floating-widget-id='planner-view-mode']",
  "[data-floating-widget-id='planner-spatial-hud']",
  "[data-floating-widget-id='cockpit-minimap']",
  ".planner-command-deck",
  ".planner-section-slider-dock",
  "[data-testid='truth-mode-indicator']",
  "[data-testid='truth-mode-popover']",
  "[data-testid='cockpit-bottom']",
] as const;

const GOLD = "#c9a84c";
const CYAN = "#62d7df";
const AMBER = "#f0a33a";

function readDismissedPreference(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeDismissedPreference(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // Storage is a convenience. The in-session state still dismisses it.
  }
}

const coachBodyStyle: React.CSSProperties = {
  display: "grid",
  gap: 10,
  minWidth: 300,
  maxWidth: 360,
  padding: "12px 14px 14px",
  fontFamily: "\"Inter\", system-ui, sans-serif",
};

const statusStyle: React.CSSProperties = {
  display: "grid",
  gap: 4,
  minWidth: 0,
};

const eyebrowStyle: React.CSSProperties = {
  color: GOLD,
  fontSize: 10,
  fontWeight: 820,
  letterSpacing: "0.14em",
  lineHeight: 1,
  textTransform: "uppercase",
};

const titleStyle: React.CSSProperties = {
  overflow: "hidden",
  color: "#fff7e8",
  fontFamily: "Georgia, \"Times New Roman\", serif",
  fontSize: 19,
  fontWeight: 650,
  letterSpacing: 0,
  lineHeight: 1.06,
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const detailStyle: React.CSSProperties = {
  color: "rgba(246, 239, 227, 0.68)",
  fontSize: 12,
  fontWeight: 650,
  letterSpacing: 0,
  lineHeight: 1.35,
};

const invalidReasonStyle: React.CSSProperties = {
  border: `1px solid rgba(240, 163, 58, 0.35)`,
  borderRadius: 8,
  background: "rgba(240, 163, 58, 0.1)",
  color: "#ffd49a",
  fontSize: 12,
  fontWeight: 760,
  letterSpacing: 0,
  lineHeight: 1.25,
  padding: "8px 10px",
};

const shortcutGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: 7,
};

function shortcutStyle(accent: string): React.CSSProperties {
  return {
    display: "grid",
    gap: 4,
    minWidth: 0,
    border: "1px solid rgba(255, 255, 255, 0.08)",
    borderRadius: 8,
    background: "rgba(255, 255, 255, 0.045)",
    padding: "8px 8px 9px",
    color: "rgba(246, 239, 227, 0.72)",
    fontSize: 11,
    fontWeight: 700,
    lineHeight: 1.15,
    textAlign: "center",
    boxShadow: `inset 0 1px 0 rgba(255, 255, 255, 0.04), 0 0 0 1px ${accent}12`,
  };
}

function keycapStyle(accent: string): React.CSSProperties {
  return {
    justifySelf: "center",
    minWidth: 30,
    border: `1px solid ${accent}55`,
    borderRadius: 5,
    background: `${accent}1f`,
    color: accent,
    fontSize: 11,
    fontWeight: 840,
    lineHeight: "19px",
    padding: "0 7px",
  };
}

const dismissButtonStyle: React.CSSProperties = {
  justifySelf: "start",
  minHeight: 30,
  border: "1px solid rgba(255, 255, 255, 0.1)",
  borderRadius: 7,
  background: "rgba(255, 255, 255, 0.045)",
  color: "rgba(246, 239, 227, 0.62)",
  cursor: "pointer",
  font: "760 11px/1 \"Inter\", system-ui, sans-serif",
  letterSpacing: 0,
  padding: "0 10px",
};

export function PlacementHint(): React.ReactElement | null {
  const selectedItemId = useCatalogueStore((state) => state.selectedItemId);
  const ghostInvalidReason = usePlacementStore((state) => state.ghostInvalidReason);
  const snapEnabled = usePlacementStore((state) => state.snapEnabled);
  const cameraInteractionActive = useCockpitStore((state) => state.cameraInteractionActive);
  const isTouch = useIsCoarsePointer();
  const isNarrow = useIsNarrowViewport();
  const [dismissed, setDismissed] = useState(readDismissedPreference);
  const [shownReason, setShownReason] = useState<string | null>(null);
  const reasonTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedItem = useMemo(
    () => (selectedItemId === null ? undefined : getCatalogueItem(selectedItemId)),
    [selectedItemId],
  );

  const isActive = selectedItemId !== null;
  const suppressedForViewport = isTouch || isNarrow;

  useEffect(() => {
    if (reasonTimerRef.current !== null) {
      clearTimeout(reasonTimerRef.current);
      reasonTimerRef.current = null;
    }

    if (suppressedForViewport || !isActive || ghostInvalidReason === null) {
      setShownReason(null);
      return undefined;
    }

    setShownReason(ghostInvalidReason);
    reasonTimerRef.current = setTimeout(() => {
      setShownReason(null);
      reasonTimerRef.current = null;
    }, REASON_DISPLAY_MS);

    return () => {
      if (reasonTimerRef.current !== null) {
        clearTimeout(reasonTimerRef.current);
        reasonTimerRef.current = null;
      }
    };
  }, [ghostInvalidReason, isActive, suppressedForViewport]);

  if (suppressedForViewport || !isActive) return null;

  const showShortcutCoach = !dismissed;
  if (!showShortcutCoach && shownReason === null) return null;

  const handleDismiss = (): void => {
    writeDismissedPreference();
    setDismissed(true);
  };

  const itemName = selectedItem?.name ?? "selected item";
  const snapCopy = snapEnabled ? "Grid snap is on" : "Free placement is on";

  return (
    <FloatingWidgetFrame
      id="placement-coach"
      title="Placement coach"
      compactLabel="Place"
      className="placement-coach-widget"
      bodyClassName="placement-coach-widget__body"
      defaultPlacement={DEFAULT_PLACEMENT}
      avoidSelectors={AVOID_SELECTORS}
      avoidPaddingPx={14}
      zIndex={50}
      autoCompact={cameraInteractionActive}
    >
      <div data-testid="placement-hint" style={coachBodyStyle}>
        <div style={statusStyle}>
          <div style={eyebrowStyle}>Placing now</div>
          <div style={titleStyle}>{itemName}</div>
          <div style={detailStyle}>
            Click a valid floor point. {snapCopy}; use the Snap button when you need freehand placement.
          </div>
        </div>

        {shownReason !== null && (
          <div role="status" data-testid="placement-invalid-reason" style={invalidReasonStyle}>
            {shownReason}
          </div>
        )}

        {showShortcutCoach && (
          <>
            <div style={shortcutGridStyle} aria-label="Placement shortcuts">
              <div style={shortcutStyle(CYAN)}>
                <span style={keycapStyle(CYAN)}>Click</span>
                Place
              </div>
              <div style={shortcutStyle(GOLD)}>
                <span style={keycapStyle(GOLD)}>Q / E</span>
                Rotate
              </div>
              <div style={shortcutStyle(AMBER)}>
                <span style={keycapStyle(AMBER)}>Esc</span>
                Cancel
              </div>
            </div>
            <button
              type="button"
              aria-label="Don't show placement tip again"
              style={dismissButtonStyle}
              onClick={handleDismiss}
            >
              Don't show again
            </button>
          </>
        )}
      </div>
    </FloatingWidgetFrame>
  );
}
