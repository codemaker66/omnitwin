import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { App as Editor3D } from "../App.js";
import { useEditorStore } from "../stores/editor-store.js";
import { useAuthStore } from "../stores/auth-store.js";
import { SpacePicker } from "../components/editor/SpacePicker.js";
import { SaveSendPanel } from "../components/editor/SaveSendPanel.js";
import { EditorBridge } from "../components/editor/EditorBridge.js";

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
    <>
      <EditorBridge />
      <div style={{ height: "100vh", boxSizing: "border-box" }}>
        <Editor3D />
      </div>
      <SaveSendPanel />
    </>
  );
}
