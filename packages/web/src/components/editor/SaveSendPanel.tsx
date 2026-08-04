import { useEffect, useRef, useState } from "react";
import { useEditorStore } from "../../stores/editor-store.js";
import { GuestEnquiryModal } from "./GuestEnquiryModal.js";
import { useIsCoarsePointer, useIsNarrowViewport } from "../../hooks/use-media-query.js";
import { prepareLayoutForGuestEnquiry } from "./send-layout-flow.js";
import { FloatingWidgetFrame, type FloatingWidgetPlacement } from "../shared/FloatingWidgetFrame.js";
import { useCockpitStore } from "../../stores/cockpit-store.js";

const DEFAULT_PANEL_RIGHT_PX = 72;
const COCKPIT_RIGHT_DOCK_WIDTH_PX = 360;
const COCKPIT_DOCK_CLEARANCE_PX = 24;

interface SaveSendPanelProps {
  readonly avoidRightDock?: boolean;
}

export function saveSendPanelPlacement(avoidRightDock: boolean): FloatingWidgetPlacement {
  return {
    type: "anchor",
    anchor: "top-right",
    offsetX: avoidRightDock
      ? COCKPIT_RIGHT_DOCK_WIDTH_PX + COCKPIT_DOCK_CLEARANCE_PX
      : DEFAULT_PANEL_RIGHT_PX,
    offsetY: 84,
  };
}

const SAVE_SEND_AVOID_SELECTORS = [
  ".planner-status-header",
  ".cockpit-topbar",
  ".cockpit-layer-controls",
  "[data-testid='planner-toolbar']",
  "[data-floating-widget-id='planner-view-mode']",
  "[data-floating-widget-id='cockpit-minimap']",
  "[data-floating-widget-id='planner-spatial-hud']",
  "[data-testid='truth-mode-indicator']",
  "[data-testid='truth-mode-popover']",
  "[data-testid='cockpit-truth-rail']",
  ".lens-panel",
  "[data-testid='cockpit-bottom']",
  ".planner-command-deck",
] as const;

const sendBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "100%",
  padding: "9px 20px",
  fontSize: 13,
  fontWeight: 760,
  letterSpacing: 0,
  border: "1px solid rgba(201,168,76,0.3)",
  borderRadius: 6,
  cursor: "pointer",
  background: "linear-gradient(135deg, #c9a84c 0%, #a8893e 100%)",
  color: "#1a1a1a",
  boxShadow: "0 2px 12px rgba(201,168,76,0.2)",
};

export function SaveSendPanel({
  avoidRightDock = false,
}: SaveSendPanelProps = {}): React.ReactElement | null {
  const objects = useEditorStore((s) => s.objects);
  const configId = useEditorStore((s) => s.configId);
  const isNarrow = useIsNarrowViewport();
  const isTouch = useIsCoarsePointer();
  const cameraInteractionActive = useCockpitStore((state) => state.cameraInteractionActive);
  const [showEnquiry, setShowEnquiry] = useState(false);
  const [flushing, setFlushing] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  if (objects.length === 0 || configId === null) return null;
  if (isNarrow || isTouch) return null;

  const handleSend = (): void => {
    setFlushing(true);
    void prepareLayoutForGuestEnquiry(configId)
      .then((readyToSend) => {
        if (!mountedRef.current) return;
        setFlushing(false);
        if (readyToSend) {
          setShowEnquiry(true);
        }
      })
      .catch(() => {
        if (mountedRef.current) {
          setFlushing(false);
        }
      });
  };

  return (
    <>
      <FloatingWidgetFrame
        id="save-send-panel"
        title="Client handoff"
        compactLabel="Send"
        className="save-send-widget"
        defaultPlacement={saveSendPanelPlacement(avoidRightDock)}
        avoidSelectors={SAVE_SEND_AVOID_SELECTORS}
        avoidPaddingPx={14}
        strategy="fixed"
        testId="save-send-panel"
        zIndex={avoidRightDock ? 34 : 60}
        storageScope={avoidRightDock ? "cockpit" : "planner"}
        autoCompact={cameraInteractionActive}
      >
        <button
          type="button"
          aria-label="Send to Events Team"
          style={{
            ...sendBtn,
            opacity: flushing ? 0.6 : 1,
          }}
          onClick={handleSend}
          disabled={flushing}
        >
          Send to Events Team
        </button>
      </FloatingWidgetFrame>

      {showEnquiry && (
        <GuestEnquiryModal
          configId={configId}
          onClose={() => { setShowEnquiry(false); }}
        />
      )}
    </>
  );
}
