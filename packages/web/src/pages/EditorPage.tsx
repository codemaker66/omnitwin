import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { App as Editor3D } from "../App.js";
import { useEditorStore } from "../stores/editor-store.js";
import { SpacePicker } from "../components/editor/SpacePicker.js";
import { EditorToolbar } from "../components/editor/EditorToolbar.js";
import { AssetPalette } from "../components/editor/AssetPalette.js";
import { SaveSendPanel } from "../components/editor/SaveSendPanel.js";
import { AuthModal } from "../components/editor/AuthModal.js";
import { EditorBridge } from "../components/editor/EditorBridge.js";

// ---------------------------------------------------------------------------
// EditorPage — public 3D editor with space picker + save/send flow
// ---------------------------------------------------------------------------

export function EditorPage(): React.ReactElement {
  const { configId: urlConfigId } = useParams<{ configId?: string }>();
  const navigate = useNavigate();
  const storeConfigId = useEditorStore((s) => s.configId);
  const isLoading = useEditorStore((s) => s.isLoading);
  const [showAuth, setShowAuth] = useState(false);

  // Load config from URL on mount
  useEffect(() => {
    if (urlConfigId !== undefined && urlConfigId !== storeConfigId) {
      void useEditorStore.getState().loadConfiguration(urlConfigId);
    }
  }, [urlConfigId, storeConfigId]);

  // Handle space selection → create config → navigate
  const handleSelectSpace = (spaceId: string, _venueId: string): void => {
    void useEditorStore.getState().createPublicConfig(spaceId).then((newConfigId) => {
      navigate(`/editor/${newConfigId}`, { replace: true });
    });
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
      <EditorToolbar onSignIn={() => { setShowAuth(true); }} />
      <div style={{ paddingTop: 48, paddingLeft: 220, height: "100vh", boxSizing: "border-box" }}>
        <Editor3D />
      </div>
      <AssetPalette />
      <SaveSendPanel />
      {showAuth && <AuthModal onClose={() => { setShowAuth(false); }} />}
    </>
  );
}
