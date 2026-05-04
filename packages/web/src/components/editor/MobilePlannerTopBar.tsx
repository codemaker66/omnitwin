import { useEffect, useRef, useState } from "react";
import { useEditorStore } from "../../stores/editor-store.js";
import { useAuthStore } from "../../stores/auth-store.js";
import {
  copyForEditorSaveStatus,
  deriveEditorSaveStatus,
} from "../../lib/editor-save-status.js";
import { GuestEnquiryModal } from "./GuestEnquiryModal.js";
import { prepareLayoutForGuestEnquiry } from "./send-layout-flow.js";

interface MobilePlannerTopBarProps {
  readonly mode: "3d" | "2d";
  readonly onModeChange: (mode: "3d" | "2d") => void;
}

function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(() => {
    if (typeof navigator === "undefined") return true;
    return navigator.onLine;
  });

  useEffect(() => {
    const onOnline = (): void => { setOnline(true); };
    const onOffline = (): void => { setOnline(false); };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  return online;
}

const topBarStyle: React.CSSProperties = {
  position: "fixed",
  top: "calc(env(safe-area-inset-top) + 8px)",
  left: "max(10px, env(safe-area-inset-left))",
  right: "max(10px, env(safe-area-inset-right))",
  zIndex: 72,
  minHeight: 62,
  boxSizing: "border-box",
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto auto",
  alignItems: "center",
  gap: 8,
  padding: "8px 10px 8px 14px",
  borderRadius: 26,
  background: "rgba(248, 242, 230, 0.94)",
  border: "1px solid rgba(74, 44, 28, 0.12)",
  boxShadow: "0 16px 42px rgba(30, 20, 10, 0.18)",
  backdropFilter: "blur(18px)",
  WebkitBackdropFilter: "blur(18px)",
  fontFamily: "'Inter', system-ui, sans-serif",
};

const titleStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  gap: 1,
};

const roomStyle: React.CSSProperties = {
  color: "#241913",
  fontSize: 14,
  fontWeight: 780,
  lineHeight: 1.1,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const layoutStyle: React.CSSProperties = {
  color: "rgba(36,25,19,0.58)",
  fontSize: 11,
  fontWeight: 620,
  lineHeight: 1.1,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const saveStyle: React.CSSProperties = {
  color: "rgba(36,25,19,0.66)",
  fontSize: 10,
  fontWeight: 650,
  lineHeight: 1.1,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const saveRetryStyle: React.CSSProperties = {
  ...saveStyle,
  appearance: "none",
  background: "transparent",
  border: "none",
  padding: 0,
  color: "#8c2432",
  cursor: "pointer",
  textAlign: "left",
};

const segmentStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 2,
  padding: 3,
  borderRadius: 999,
  background: "rgba(36,25,19,0.08)",
  border: "1px solid rgba(36,25,19,0.08)",
};

const sendStyle: React.CSSProperties = {
  minHeight: 44,
  minWidth: 58,
  padding: "0 14px",
  borderRadius: 999,
  border: "1px solid rgba(122,31,42,0.16)",
  background: "#7a1f2a",
  color: "#fff8ed",
  fontSize: 12,
  fontWeight: 760,
  letterSpacing: 0,
  cursor: "pointer",
  boxShadow: "0 8px 18px rgba(122,31,42,0.2)",
};

function segmentButtonStyle(active: boolean): React.CSSProperties {
  return {
    minHeight: 44,
    minWidth: 44,
    padding: "0 10px",
    borderRadius: 999,
    border: "none",
    background: active ? "#241913" : "transparent",
    color: active ? "#fff8ed" : "rgba(36,25,19,0.68)",
    fontSize: 12,
    fontWeight: 780,
    cursor: "pointer",
    transition: "background 160ms ease, color 160ms ease",
  };
}

export function MobilePlannerTopBar({
  mode,
  onModeChange,
}: MobilePlannerTopBarProps): React.ReactElement {
  const space = useEditorStore((s) => s.space);
  const configId = useEditorStore((s) => s.configId);
  const objectCount = useEditorStore((s) => s.objects.length);
  const isSaving = useEditorStore((s) => s.isSaving);
  const isDirty = useEditorStore((s) => s.isDirty);
  const saveError = useEditorStore((s) => s.saveError);
  const lastSavedAt = useEditorStore((s) => s.lastSavedAt);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const online = useOnlineStatus();
  const [showEnquiry, setShowEnquiry] = useState(false);
  const [sending, setSending] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const status = deriveEditorSaveStatus({
    isDirty,
    isSaving,
    saveError,
    lastSavedAt,
    isOnline: online,
  });
  const saveCopy = copyForEditorSaveStatus(status);

  const retrySave = (): void => {
    useEditorStore.getState().clearSaveError();
    void useEditorStore.getState().saveToServer(isAuthenticated);
  };

  const sendLayout = (): void => {
    if (configId === null) return;
    setSending(true);
    void prepareLayoutForGuestEnquiry(configId)
      .then((readyToSend) => {
        if (!mountedRef.current) return;
        setSending(false);
        if (readyToSend) {
          setShowEnquiry(true);
        }
      })
      .catch(() => {
        if (mountedRef.current) {
          setSending(false);
        }
      });
  };

  return (
    <>
      <div data-testid="mobile-planner-topbar" style={topBarStyle}>
        <div style={titleStyle}>
          <div style={roomStyle}>{space?.name ?? "Grand Hall"}</div>
          <div style={layoutStyle}>Banquet Draft</div>
          {status === "failed" ? (
            <button
              type="button"
              style={saveRetryStyle}
              onClick={retrySave}
              aria-label="Save failed - retry"
            >
              {saveCopy.label}
            </button>
          ) : (
            <div role="status" aria-live="polite" style={saveStyle}>
              {saveCopy.label}
            </div>
          )}
        </div>

        <div style={segmentStyle} role="group" aria-label="View mode">
          <button
            type="button"
            style={segmentButtonStyle(mode === "2d")}
            onClick={() => { onModeChange("2d"); }}
            aria-pressed={mode === "2d"}
          >
            2D
          </button>
          <button
            type="button"
            style={segmentButtonStyle(mode === "3d")}
            onClick={() => { onModeChange("3d"); }}
            aria-pressed={mode === "3d"}
          >
            3D
          </button>
        </div>

        {objectCount > 0 && configId !== null ? (
          <button
            type="button"
            style={{
              ...sendStyle,
              opacity: sending ? 0.68 : 1,
            }}
            aria-label="Send to Events Team"
            onClick={sendLayout}
            disabled={sending}
          >
            {sending ? "Sending" : "Send"}
          </button>
        ) : null}
      </div>

      {showEnquiry && configId !== null ? (
        <GuestEnquiryModal
          configId={configId}
          onClose={() => { setShowEnquiry(false); }}
        />
      ) : null}
    </>
  );
}
