import { useState, type ReactElement } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Building2, Check, Save } from "lucide-react";
import { useEditorStore } from "../../../stores/editor-store.js";
import { useAuthStore } from "../../../stores/auth-store.js";
import { useLayoutTimelinePreviewStore } from "../../../stores/layout-timeline-preview-store.js";
import { ActivityIndicator } from "../../shared/Activity.js";
import { isLayoutTimelineMutationLocked } from "../../../lib/layout-timeline-preview-lock.js";
import { usePlannerVenueIdentity } from "../../../hooks/use-planner-venue-identity.js";
import { canReadInternalEventData, customerEventPath, isCustomerRole } from "../../../lib/event-access.js";

/** Room identity and the real save state, outside the camera's sightline. */
export function ReferenceRoomHeader(): ReactElement {
  const venueId = useEditorStore((state) => state.venueId);
  const venue = usePlannerVenueIdentity(venueId);
  const [failedLogo, setFailedLogo] = useState<string | null>(null);
  const spaceName = useEditorStore((state) => state.space?.name ?? "Venue planner");
  const saving = useEditorStore((state) => state.isSaving);
  const dirty = useEditorStore((state) => state.isDirty);
  const saveError = useEditorStore((state) => state.saveError);
  const saveConflict = useEditorStore((state) => state.saveConflict);
  const configId = useEditorStore((state) => state.configId);
  const auth = useAuthStore();
  const authenticated = !auth.isLoading && auth.isAuthenticated;
  const [searchParams] = useSearchParams();
  const eventId = searchParams.get("eventId");
  const operational = canReadInternalEventData(auth);
  const customer = !operational && isCustomerRole(auth.user?.role);
  const homePath = operational ? "/diary" : authenticated && customer && eventId !== null ? customerEventPath(eventId) : "/";
  const homeLabel = operational ? "diary" : authenticated && customer && eventId !== null ? "event details" : "home";
  const previewLocked = useLayoutTimelinePreviewStore((state) => state.mode !== "inactive");
  const saveLabel = configId === null ? "No saved layout" : saving ? "Saving layout" : saveConflict !== null ? "Reload layout" : saveError !== null ? "Retry save" : dirty ? "Save layout" : "Layout saved";
  return (
    <header className="reference-room-header" aria-label="Room and save status">
      <Link to={homePath} className="reference-wordmark" aria-busy={venue.loading} aria-label={`${venue.name} ${homeLabel}`}>
        {venue.logoUrl !== null && venue.logoUrl !== failedLogo
          ? <img src={venue.logoUrl} width="32" height="40" alt="" onError={() => { setFailedLogo(venue.logoUrl); }} />
          : <Building2 className="reference-venue-icon" size={28} aria-hidden="true" />}
        <span className="reference-venue-copy">
          <span className="reference-venue-name">{venue.loading && <ActivityIndicator size={12} />}{venue.name}</span>
          <small>{spaceName}</small>
        </span>
      </Link>
      <button type="button" className="reference-save" disabled={saving || previewLocked || configId === null}
        aria-label={saveLabel} title={previewLocked ? "Return to the saved plan before saving" : saveLabel}
        aria-busy={saving} onClick={() => {
          if (isLayoutTimelineMutationLocked()) return;
          const editor = useEditorStore.getState();
          if (editor.saveConflict !== null) void editor.reloadAfterConflict(authenticated);
          else void editor.saveToServer(authenticated);
        }}>
        {saving ? <ActivityIndicator size={18} /> : !dirty && saveError === null && saveConflict === null ? <Check size={16} aria-hidden /> : <Save size={16} aria-hidden />}
      </button>
      <span className="reference-save-status" role="status">{saveLabel}</span>
    </header>
  );
}
