import { type ReactElement } from "react";
import { Link } from "react-router-dom";
import { Check, Save } from "lucide-react";
import { useEditorStore } from "../../../stores/editor-store.js";
import { useAuthStore } from "../../../stores/auth-store.js";
import { useLayoutTimelinePreviewStore } from "../../../stores/layout-timeline-preview-store.js";
import { ActivityIndicator } from "../../shared/Activity.js";

/** Room identity and the real save state, outside the camera's sightline. */
export function ReferenceRoomHeader(): ReactElement {
  const spaceName = useEditorStore((state) => state.space?.name ?? "Venue planner");
  const saving = useEditorStore((state) => state.isSaving);
  const dirty = useEditorStore((state) => state.isDirty);
  const saveError = useEditorStore((state) => state.saveError);
  const configId = useEditorStore((state) => state.configId);
  const authenticated = useAuthStore((state) => state.isAuthenticated);
  const previewLocked = useLayoutTimelinePreviewStore((state) => state.mode !== "inactive");
  const saveLabel = configId === null ? "No saved layout" : saving ? "Saving layout" : saveError !== null ? "Retry save" : dirty ? "Save layout" : "Layout saved";
  return (
    <header className="reference-room-header" aria-label="Room and save status">
      <Link to={authenticated ? "/diary" : "/"} className="reference-wordmark" aria-label={authenticated ? "Venviewer diary" : "Venviewer home"}>
        <img src="/images/brand/coat-of-arms-mark-64.webp" width="25" height="30" alt="" />
        <span>VENVIEWER<small>{spaceName}</small></span>
      </Link>
      <button type="button" className="reference-save" disabled={saving || previewLocked || configId === null}
        aria-label={saveLabel} title={previewLocked ? "Return to the saved plan before saving" : saveLabel}
        aria-busy={saving} onClick={() => { void useEditorStore.getState().saveToServer(authenticated); }}>
        {saving ? <ActivityIndicator size={18} /> : !dirty && saveError === null ? <Check size={16} aria-hidden /> : <Save size={16} aria-hidden />}
      </button>
      <span className="reference-save-status" role="status">{saveLabel}</span>
    </header>
  );
}
