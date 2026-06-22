import { useEffect, useRef, useState } from "react";
import { useEditorStore } from "../../stores/editor-store.js";
import { GuestEnquiryModal } from "./GuestEnquiryModal.js";
import { useIsCoarsePointer, useIsNarrowViewport } from "../../hooks/use-media-query.js";
import { prepareLayoutForGuestEnquiry } from "./send-layout-flow.js";

const DEFAULT_PANEL_RIGHT_PX = 72;
const COCKPIT_RIGHT_DOCK_WIDTH_PX = 360;
const COCKPIT_DOCK_CLEARANCE_PX = 24;

interface SaveSendPanelProps {
  readonly avoidRightDock?: boolean;
}

function panelStyle(avoidRightDock: boolean): React.CSSProperties {
  return {
    position: "fixed",
    top: 84,
    right: avoidRightDock
      ? COCKPIT_RIGHT_DOCK_WIDTH_PX + COCKPIT_DOCK_CLEARANCE_PX
      : DEFAULT_PANEL_RIGHT_PX,
    zIndex: avoidRightDock ? 32 : 60,
    display: "flex",
    flexDirection: "row",
    gap: 10,
    fontFamily: "'Inter', sans-serif",
  };
}

const sendBtn: React.CSSProperties = {
  padding: "9px 20px",
  fontSize: 13,
  fontWeight: 500,
  letterSpacing: 0.3,
  border: "1px solid rgba(201,168,76,0.3)",
  borderRadius: 6,
  cursor: "pointer",
  transition: "all 0.2s",
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
      <div style={panelStyle(avoidRightDock)} data-testid="save-send-panel">
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
      </div>

      {showEnquiry && (
        <GuestEnquiryModal
          configId={configId}
          onClose={() => { setShowEnquiry(false); }}
        />
      )}
    </>
  );
}
