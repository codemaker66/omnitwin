import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { App as Editor3D } from "../App.js";
import { useEditorStore } from "../stores/editor-store.js";
import { useAuthStore } from "../stores/auth-store.js";
import { SpacePicker } from "../components/editor/SpacePicker.js";
import { SaveSendPanel } from "../components/editor/SaveSendPanel.js";
import { SubmitForReviewPanel } from "../components/editor/SubmitForReviewPanel.js";
import { EditorBridge } from "../components/editor/EditorBridge.js";
import { ObjectNotePanel } from "../components/editor/ObjectNotePanel.js";
import { EventDetailsPanel } from "../components/editor/EventDetailsPanel.js";
import { BlueprintPage } from "./BlueprintPage.js";

// ---------------------------------------------------------------------------
// EditorPage — public 3D editor with space picker + save/send flow
// ---------------------------------------------------------------------------

export function EditorPage(): React.ReactElement {
  const { configId: urlConfigId } = useParams<{ configId?: string }>();
  const navigate = useNavigate();
  const storeConfigId = useEditorStore((s) => s.configId);
  const isLoading = useEditorStore((s) => s.isLoading);
  const error = useEditorStore((s) => s.error);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // Load config from URL on mount. The first load uses the current
  // isAuthenticated value (false before Clerk resolves). For public configs
  // this succeeds immediately. For private/claimed configs the public path
  // may 404 — when auth later resolves and isAuthenticated flips to true,
  // the effect re-fires because storeConfigId is still null (set() is not
  // called on error), retrying via the authenticated endpoint.
  useEffect(() => {
    if (urlConfigId !== undefined && urlConfigId !== storeConfigId) {
      void useEditorStore.getState().loadConfiguration(urlConfigId, isAuthenticated);
    }
  }, [urlConfigId, storeConfigId, isAuthenticated]);

  // Handle space selection → create config → navigate
  const handleSelectSpace = (spaceId: string, _venueId: string): void => {
    void useEditorStore.getState().createPublicConfig(spaceId)
      .then((newConfigId) => { void navigate(`/editor/${newConfigId}`, { replace: true }); })
      .catch(() => { /* error surfaced via store.error */ });
  };

  // No configId in URL and none in store → show space picker
  if (urlConfigId === undefined && storeConfigId === null) {
    return <SpacePicker onSelectSpace={handleSelectSpace} />;
  }

  // Loading config
  if (isLoading) {
    return (
      <div style={{
        minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "'Inter', sans-serif", color: "#999", background: "#f5f5f0",
      }}>
        Loading layout...
      </div>
    );
  }

  // Error loading config — show message with retry
  if (error !== null) {
    return (
      <div style={{
        minHeight: "100vh", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 12,
        fontFamily: "'Inter', sans-serif", color: "#333", background: "#f5f5f0",
      }}>
        <p style={{ fontSize: 16, fontWeight: 600 }}>Failed to load layout</p>
        <p style={{ fontSize: 13, color: "#999" }}>{error}</p>
        <button
          type="button"
          onClick={() => { void navigate("/editor", { replace: true }); }}
          style={{
            padding: "8px 20px", fontSize: 13, fontWeight: 600,
            background: "#1a1a2e", color: "#fff", border: "none",
            borderRadius: 6, cursor: "pointer", marginTop: 8,
          }}
        >
          Start Fresh
        </button>
      </div>
    );
  }

  return (
    <PlannerCommsLayer />
  );
}

/**
 * Groups the 3D editor with the planner-authored comms layer:
 *   - ObjectNotePanel: floating input for per-object notes, appears
 *     when a single object is selected
 *   - EventDetailsPanel: modal for event-level instructions, opened
 *     via a top-right button. Only visible when a config is loaded
 *     (configId !== null).
 *
 * Pulled into its own component because the panel open/close state is
 * local — EditorPage above handles URL/store bootstrap and shouldn't
 * re-render on every UI state flip.
 */
function PlannerCommsLayer(): React.ReactElement {
  const [eventDetailsOpen, setEventDetailsOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"3d" | "2d">("3d");
  const configId = useEditorStore((s) => s.configId);
  const isPublicPreview = useEditorStore((s) => s.isPublicPreview);
  // The Event Details panel writes to the auth-only PATCH endpoint. Showing
  // it on unclaimed public-preview configs would 401 on every save and
  // discard the planner's work with a generic "Failed to save". Hide until
  // the config is claimed; the panel itself renders a sign-in hint if it
  // ever opens in that state (defense-in-depth).
  const canEditEventDetails = configId !== null && !isPublicPreview;
  return (
    <>
      <EditorBridge />
      <div style={{ height: "100vh", boxSizing: "border-box" }}>
        {viewMode === "3d" ? <Editor3D /> : <BlueprintPage source="editor-store" />}
      </div>
      {/* 2D/3D view toggle — floats top-centre so it's always reachable */}
      <ViewModeToggle mode={viewMode} onChange={setViewMode} />
      {canEditEventDetails && viewMode === "3d" && (
        <button
          type="button"
          onClick={() => { setEventDetailsOpen(true); }}
          style={{
            position: "fixed", top: 16, right: 16, zIndex: 30,
            padding: "8px 14px", borderRadius: 8,
            background: "rgba(20,19,17,0.85)",
            backdropFilter: "blur(8px)",
            border: "1px solid rgba(201,168,76,0.35)",
            color: "#c9a84c", fontSize: 12, fontWeight: 600,
            cursor: "pointer", fontFamily: "'Inter', system-ui, sans-serif",
            letterSpacing: "0.04em",
          }}
        >
          ★ EVENT DETAILS
        </button>
      )}
      <EventDetailsPanel open={eventDetailsOpen} onClose={() => { setEventDetailsOpen(false); }} />
      <ObjectNotePanel />
      <SaveSendPanel />
      <SubmitForReviewPanel />
    </>
  );
}

function ViewModeToggle({ mode, onChange }: { mode: "3d" | "2d"; onChange: (m: "3d" | "2d") => void }): React.ReactElement {
  const btn = (label: string, value: "3d" | "2d"): React.ReactElement => {
    const active = mode === value;
    return (
      <button
        type="button"
        onClick={() => { onChange(value); }}
        style={{
          padding: "6px 14px",
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: "0.05em",
          border: "none",
          borderRadius: 6,
          cursor: "pointer",
          background: active ? "#c9a84c" : "transparent",
          color: active ? "#141311" : "#c9a84c",
          fontFamily: "'Inter', system-ui, sans-serif",
        }}
      >
        {label}
      </button>
    );
  };
  return (
    <div
      style={{
        position: "fixed",
        top: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 31,
        display: "inline-flex",
        gap: 2,
        padding: 3,
        borderRadius: 8,
        background: "rgba(20,19,17,0.85)",
        backdropFilter: "blur(8px)",
        border: "1px solid rgba(201,168,76,0.35)",
      }}
      role="group"
      aria-label="View mode"
    >
      {btn("3D", "3d")}
      {btn("2D", "2d")}
    </div>
  );
}
