import { useState } from "react";
import { useEditorStore } from "../../stores/editor-store.js";
import { updatePublicThumbnail } from "../../api/configurations.js";
import { captureOrthographic } from "../../lib/ortho-capture.js";
import { toRenderSpace } from "../../constants/scale.js";
import { GuestEnquiryModal } from "./GuestEnquiryModal.js";
import { flushAutoSave } from "./EditorBridge.js";

// ---------------------------------------------------------------------------
// SaveSendPanel — floating "Send to Events Team" CTA at top-right
// ---------------------------------------------------------------------------

const panelStyle: React.CSSProperties = {
  position: "fixed", top: 16, right: 72, zIndex: 60,
  display: "flex", flexDirection: "row", gap: 10,
  fontFamily: "'Inter', sans-serif",
};

const sendBtn: React.CSSProperties = {
  padding: "9px 20px", fontSize: 13, fontWeight: 500, letterSpacing: 0.3,
  border: "1px solid rgba(201,168,76,0.3)", borderRadius: 6,
  cursor: "pointer", transition: "all 0.2s",
  background: "linear-gradient(135deg, #c9a84c 0%, #a8893e 100%)",
  color: "#1a1a1a", boxShadow: "0 2px 12px rgba(201,168,76,0.2)",
};

export function SaveSendPanel(): React.ReactElement | null {
  const objects = useEditorStore((s) => s.objects);
  const configId = useEditorStore((s) => s.configId);

  const [showEnquiry, setShowEnquiry] = useState(false);
  const [flushing, setFlushing] = useState(false);

  if (objects.length === 0 || configId === null) return null;

  // Punch list #32 + #24: flush pending edits, capture the floor plan
  // diagram, upload it as the config's thumbnail, then open the modal.
  //
  // The capture + upload are best-effort — if the scene isn't available
  // (e.g. component mounted before Canvas), or the capture fails, or the
  // upload fails, the modal opens anyway. The hallkeeper sheet shows its
  // existing placeholder when thumbnailUrl is null, so the user still gets
  // a functional (if diagram-less) submission. No user-facing error for a
  // capture failure because it's a non-critical enhancement.
  const handleSend = (): void => {
    setFlushing(true);
    void (async () => {
      // Step 1: flush any pending auto-save (#32)
      await flushAutoSave();

      // Step 2: capture floor plan + upload thumbnail (#24)
      try {
        const { scene, space, isPublicPreview } = useEditorStore.getState();
        if (scene !== null && space !== null && isPublicPreview) {
          const roomWidthRender = toRenderSpace(parseFloat(space.widthM));
          const roomLengthRender = toRenderSpace(parseFloat(space.lengthM));
          const dataUrl = captureOrthographic(scene, roomWidthRender, roomLengthRender, {
            width: 800,
            height: 533,
          });
          if (dataUrl !== null) {
            await updatePublicThumbnail(configId, dataUrl);
          }
        }
      } catch {
        // Best-effort — capture or upload failed, modal opens regardless.
      }
    })().finally(() => {
      setFlushing(false);
      setShowEnquiry(true);
    });
  };

  return (
    <>
      <div style={panelStyle} data-testid="save-send-panel">
        <button
          type="button"
          style={{ ...sendBtn, opacity: flushing ? 0.6 : 1 }}
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
