import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { App as Editor3D } from "../App.js";
import { useEditorStore } from "../stores/editor-store.js";
import { useAuthStore } from "../stores/auth-store.js";
import { SpacePicker } from "../components/editor/SpacePicker.js";
import { SaveSendPanel } from "../components/editor/SaveSendPanel.js";
import { AuthModal } from "../components/editor/AuthModal.js";
import { EditorBridge } from "../components/editor/EditorBridge.js";

// ---------------------------------------------------------------------------
// EditorPage — public 3D editor with space picker + save/send flow
// The existing bottom Toolbar handles furniture placement — no separate
// asset palette or top toolbar needed here.
// ---------------------------------------------------------------------------

export function EditorPage(): React.ReactElement {
  const { configId: urlConfigId } = useParams<{ configId?: string }>();
  const navigate = useNavigate();
  const storeConfigId = useEditorStore((s) => s.configId);
  const isLoading = useEditorStore((s) => s.isLoading);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [showAuth, setShowAuth] = useState(false);

  // Load config from URL on mount.
  // The endpoint depends on auth state — see editor-store.loadConfiguration
  // for the contract. Re-runs if auth state flips (e.g. user signs in
  // mid-session and the public endpoint would now 404 a claimed config).
  useEffect(() => {
    if (urlConfigId !== undefined && urlConfigId !== storeConfigId) {
      void useEditorStore.getState().loadConfiguration(urlConfigId, isAuthenticated);
    }
  }, [urlConfigId, storeConfigId, isAuthenticated]);

  // Handle space selection → create config → navigate
  const handleSelectSpace = (spaceId: string, _venueId: string): void => {
    void useEditorStore.getState().createPublicConfig(spaceId)
      .then((newConfigId) => { void navigate(`/editor/${newConfigId}`, { replace: true }); })
      .catch(() => { /* error already surfaced via store.error */ });
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

  return (
    <>
      <EditorBridge />
      <div style={{ height: "100vh", boxSizing: "border-box" }}>
        <Editor3D />
      </div>
      <SaveSendPanel />
      {showAuth && <AuthModal onClose={() => { setShowAuth(false); }} />}
    </>
  );
}
