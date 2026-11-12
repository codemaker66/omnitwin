import { useState, type ReactElement } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Building2, Check, CloudOff, Save } from "lucide-react";
import { useEditorStore } from "../../../stores/editor-store.js";
import { useAuthStore } from "../../../stores/auth-store.js";
import { useLayoutTimelinePreviewStore } from "../../../stores/layout-timeline-preview-store.js";
import { ActivityIndicator } from "../../shared/Activity.js";
import { isLayoutTimelineMutationLocked } from "../../../lib/layout-timeline-preview-lock.js";
import { refusedOverHeldNote } from "../../../lib/guest-plan-notes.js";
import { usePlannerVenueIdentity } from "../../../hooks/use-planner-venue-identity.js";
import { canReadInternalEventData, customerEventPath, isCustomerRole } from "../../../lib/event-access.js";
import { useOnlineStatus } from "../../../hooks/use-online-status.js";
import { useChromePresenceStore } from "../../../stores/chrome-presence-store.js";
import { CrestLabel, useCrestLabel } from "./CrestLabel.js";

interface HeaderSaveState {
  readonly configId: string | null;
  readonly saving: boolean;
  readonly dirty: boolean;
  readonly saveError: string | null;
  /** The save was refused because it would change a note this browser is not
   *  shown (409 NOTE_HELD): `saveError` is then the API's own sentence. */
  readonly refusedForHeldNote?: boolean;
  readonly conflicted: boolean;
  readonly online: boolean;
}

/** The header's one line about the layout. It never says "saved" while the
 *  browser is offline with changes the server has not had (QoL D-03). A save
 *  refused over a held note is said in the API's own sentence: the same save
 *  meets the same refusal, so "Retry save" would be the wrong thing to say. */
export function headerSaveLabel(state: HeaderSaveState): string {
  if (state.configId === null) return "No saved layout";
  if (state.saving) return "Saving…";
  if (state.conflicted) return "Reload layout";
  if (!state.online && (state.dirty || state.saveError !== null)) return "Offline · not saved yet";
  if (state.saveError !== null) return state.refusedForHeldNote === true ? state.saveError : "Retry save";
  return state.dirty ? "Save layout" : "Layout saved";
}

/** Room identity and the real save state, outside the camera's sightline. */
export function ReferenceRoomHeader(): ReactElement {
  const venueId = useEditorStore((state) => state.venueId);
  const venue = usePlannerVenueIdentity(venueId);
  const [failedLogo, setFailedLogo] = useState<string | null>(null);
  const spaceName = useEditorStore((state) => state.space?.name ?? "Venue planner");
  const saving = useEditorStore((state) => state.isSaving);
  const dirty = useEditorStore((state) => state.isDirty);
  const saveError = useEditorStore((state) => state.saveError);
  const refusedForHeldNote = useEditorStore((state) => refusedOverHeldNote(state.saveErrorCode));
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
  const online = useOnlineStatus();
  const offlineUnsaved = !online && (dirty || saveError !== null);
  const saveLabel = headerSaveLabel({ configId, saving, dirty, saveError, refusedForHeldNote, conflicted: saveConflict !== null, online });
  // The crest hides and shows the planner's tools; the name beside it is the
  // way home (Blake, 28 Oct 2026: "Crest hides; name goes home", T-680).
  const toolsCleared = useChromePresenceStore((state) => state.cleared);
  const crestLabel = toolsCleared ? "Show the tools" : "Hide the tools";
  const crestName = useCrestLabel();
  return (
    <header className="reference-room-header" aria-label="Room and save status">
      <div className="reference-identity">
        <button type="button" className="reference-crest" data-planner-crest aria-label={crestLabel}
          aria-keyshortcuts={"\\"} {...crestName.handlers}
          onClick={() => { useChromePresenceStore.getState().toggleCleared(); }}>
          {venue.logoUrl !== null && venue.logoUrl !== failedLogo
            ? <img src={venue.logoUrl} width="32" height="40" alt="" onError={() => { setFailedLogo(venue.logoUrl); }} />
            : <Building2 className="reference-venue-icon" size={28} aria-hidden="true" />}
          <CrestLabel text={`${crestLabel} · \\`} shown={crestName.shown} />
        </button>
        <Link to={homePath} className="reference-wordmark" aria-busy={venue.loading} aria-label={`${venue.name} ${homeLabel}`}>
          <span className="reference-venue-copy">
            <span className="reference-venue-name">{venue.loading && <ActivityIndicator size={12} />}{venue.name}</span>
            <small>{spaceName}</small>
          </span>
        </Link>
      </div>
      <button type="button" className="reference-save" disabled={saving || previewLocked || configId === null}
        aria-label={saveLabel} title={previewLocked ? "Return to the saved plan before saving" : offlineUnsaved ? "The connection has dropped. Press to save once it is back." : saveLabel}
        aria-busy={saving} onClick={() => {
          if (isLayoutTimelineMutationLocked()) return;
          const editor = useEditorStore.getState();
          if (editor.saveConflict !== null) void editor.reloadAfterConflict(authenticated);
          else void editor.saveToServer(authenticated);
        }}>
        {saving ? <ActivityIndicator size={18} /> : offlineUnsaved ? <CloudOff size={16} aria-hidden /> : !dirty && saveError === null && saveConflict === null ? <Check size={16} aria-hidden /> : <Save size={16} aria-hidden />}
      </button>
      <span className="reference-save-status" role="status">{saveLabel}</span>
    </header>
  );
}
