import { useEffect, useRef, useState } from "react";
import { FileText } from "lucide-react";
import { ActivityIndicator } from "../shared/Activity.js";
import { captureEditorSession, isCurrentEditorSession, useEditorStore } from "../../stores/editor-store.js";
import { useAuthStore } from "../../stores/auth-store.js";
import {
  copyForEditorSaveStatus,
  deriveEditorSaveStatus,
} from "../../lib/editor-save-status.js";
import { GuestEnquiryModal } from "./GuestEnquiryModal.js";
import { VisitorPlanPdfSheet } from "./VisitorPlanPdfSheet.js";
import { prepareLayoutForGuestEnquiry } from "./send-layout-flow.js";
import { useLayoutTimelinePreviewStore } from "../../stores/layout-timeline-preview-store.js";
import { isLayoutTimelineMutationLocked } from "../../lib/layout-timeline-preview-lock.js";

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
  fontWeight: 600,
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
  fontSize: 11,
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
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 5,
  minHeight: 44,
  minWidth: 58,
  padding: "0 14px",
  borderRadius: 999,
  border: "1px solid rgba(122,31,42,0.16)",
  background: "#7a1f2a",
  color: "#fff8ed",
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: 0,
  cursor: "pointer",
  boxShadow: "0 8px 18px rgba(122,31,42,0.2)",
};

// The plan-as-PDF control sits beside Send: the same 44 px pill height, the
// bar's own ink, quieter than Send because asking the venue is the main act.
const planPdfStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 44,
  height: 44,
  padding: 0,
  borderRadius: 999,
  border: "1px solid rgba(36,25,19,0.14)",
  background: "rgba(36,25,19,0.06)",
  color: "#241913",
  cursor: "pointer",
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
    fontWeight: 600,
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
  const saveConflict = useEditorStore((s) => s.saveConflict);
  const lastSavedAt = useEditorStore((s) => s.lastSavedAt);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isPublicPreview = useEditorStore((s) => s.isPublicPreview);
  const timelinePreviewMode = useLayoutTimelinePreviewStore((state) => state.mode);
  const timelinePreviewRuntime = useLayoutTimelinePreviewStore((state) => state.activeVenueRuntime);
  const timelinePreviewActive = timelinePreviewMode !== "inactive";
  const roomName = timelinePreviewActive
    ? timelinePreviewRuntime?.spaceName ?? "Room unavailable"
    : space?.name ?? "Grand Hall";
  const layoutName = timelinePreviewActive
    ? timelinePreviewRuntime === null ? "Room preview unavailable" : "Frozen phase preview"
    : "Banquet Draft";
  const online = useOnlineStatus();
  const [showEnquiry, setShowEnquiry] = useState(false);
  const [showPlanPdf, setShowPlanPdf] = useState(false);
  const [sending, setSending] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const status = deriveEditorSaveStatus({
    configId,
    isDirty,
    isSaving,
    saveError,
    lastSavedAt,
    isOnline: online,
  });
  const saveCopy = copyForEditorSaveStatus(status);

  const retrySave = (): void => {
    if (timelinePreviewActive || isLayoutTimelineMutationLocked()) return;
    if (saveConflict !== null) {
      void useEditorStore.getState().reloadAfterConflict(isAuthenticated);
      return;
    }
    useEditorStore.getState().clearSaveError();
    void useEditorStore.getState().saveToServer(isAuthenticated);
  };

  const sendLayout = (): void => {
    if (configId === null || timelinePreviewActive) return;
    const session = captureEditorSession();
    setSending(true);
    void prepareLayoutForGuestEnquiry(configId)
      .then((readyToSend) => {
        if (!mountedRef.current) return;
        setSending(false);
        if (readyToSend && isCurrentEditorSession(session)) {
          setShowEnquiry(true);
        }
      })
      .catch(() => {
        if (mountedRef.current) {
          setSending(false);
        }
      });
  };

  // A guest plan (no account) can go to anyone as a PDF or a view-only link;
  // phones have no Share lens, so the bar offers it beside Send (fix-first
  // item 11).
  const canSendPlanPdf = isPublicPreview && objectCount > 0 && configId !== null;

  return (
    <>
      <div
        data-testid="mobile-planner-topbar"
        style={canSendPlanPdf
          ? { ...topBarStyle, gridTemplateColumns: "minmax(0, 1fr) auto auto auto" }
          : topBarStyle}
      >
        <div style={titleStyle}>
          <div data-testid="mobile-planner-room-name" style={roomStyle}>{roomName}</div>
          <div data-testid="mobile-planner-layout-name" style={layoutStyle}>{layoutName}</div>
          {status === "failed" ? (
            <button
              type="button"
              style={saveRetryStyle}
              onClick={retrySave}
              aria-label={saveConflict === null ? "Save failed - retry" : "Save conflict - reload"}
              disabled={timelinePreviewActive}
              title={timelinePreviewActive ? "Exit the room timeline preview before retrying this save." : undefined}
            >
              {timelinePreviewActive
                ? saveConflict === null ? "Exit preview to retry" : "Exit preview to reload"
                : saveConflict === null ? saveCopy.label : "Reload layout"}
            </button>
          ) : (
            <div role="status" aria-live="polite" style={saveStyle}>
              {status === "saving" && <ActivityIndicator size={16} />}
              {saveCopy.label}
            </div>
          )}
        </div>

        <div style={segmentStyle} role="group" aria-label="View mode">
          <button
            type="button"
            style={segmentButtonStyle(mode === "2d")}
            onClick={() => { if (!timelinePreviewActive) onModeChange("2d"); }}
            aria-pressed={mode === "2d"}
            disabled={timelinePreviewActive}
            title={timelinePreviewActive ? "Exit the room timeline preview to view 2D." : undefined}
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

        {canSendPlanPdf ? (
          <button
            type="button"
            style={{ ...planPdfStyle, opacity: timelinePreviewActive ? 0.68 : 1 }}
            aria-label="Send your plan"
            aria-haspopup="dialog"
            onClick={() => { if (!timelinePreviewActive) setShowPlanPdf(true); }}
            disabled={timelinePreviewActive}
            title={timelinePreviewActive
              ? "Exit the room timeline preview to send this plan."
              : "Send your plan to someone as a PDF or a view-only link"}
            data-testid="mobile-plan-pdf"
          >
            <FileText size={20} aria-hidden="true" />
          </button>
        ) : null}

        {objectCount > 0 && configId !== null ? (
          <button
            type="button"
            style={{
              ...sendStyle,
              opacity: sending || timelinePreviewActive ? 0.68 : 1,
            }}
            aria-label="Send to Events Team"
            onClick={sendLayout}
            disabled={sending || timelinePreviewActive}
            title={timelinePreviewActive
              ? "Exit the room timeline preview before sending this saved plan."
              : undefined}
          >
            {sending && <ActivityIndicator size={18} />}
            {sending ? "Sending" : timelinePreviewActive ? "Exit preview" : "Send"}
          </button>
        ) : null}
      </div>

      {showPlanPdf && configId !== null ? (
        <VisitorPlanPdfSheet
          configId={configId}
          roomName={space?.name ?? "Room"}
          onClose={() => { setShowPlanPdf(false); }}
        />
      ) : null}

      {showEnquiry && configId !== null ? (
        <GuestEnquiryModal
          configId={configId}
          onClose={() => { setShowEnquiry(false); }}
        />
      ) : null}
    </>
  );
}
