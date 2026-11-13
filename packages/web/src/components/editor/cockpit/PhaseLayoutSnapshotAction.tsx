import { useState, type ReactElement } from "react";
import { Check, Link2 } from "lucide-react";
import { ActivityIndicator } from "../../shared/Activity.js";
import type { FreezePhaseLayoutSnapshotResponse } from "../../../api/room-layout-timeline.js";
import type { AuthUser } from "../../../stores/auth-store.js";
import { useFreezePhaseLayoutSnapshot } from "../../../hooks/use-freeze-phase-layout-snapshot.js";
import { useLayoutTimelinePreviewStore } from "../../../stores/layout-timeline-preview-store.js";
import { isLayoutTimelineMutationLocked } from "../../../lib/layout-timeline-preview-lock.js";
import { EVENT_WRITE_ROLES, hasRole } from "../../../lib/role-capabilities.js";
import { flushAutoSave } from "../EditorBridge.js";
import "./PhaseLayoutSnapshotAction.css";

interface PhaseLayoutSnapshotActionProps {
  readonly eventId: string;
  readonly phaseId: string;
  readonly configurationId: string;
  readonly onFrozen: (result: FreezePhaseLayoutSnapshotResponse) => void;
}

/** Server policy mirror used only to hide an impossible action; the endpoint
 * remains authoritative. Hallkeeper/planner/client/public contexts fail closed. */
export function canFreezePhaseLayoutForVenue(
  user: AuthUser | null,
  venueId: string | null,
): boolean {
  if (user === null || venueId === null) return false;
  if (user.platformRole === "admin") return true;
  return user.venueId === venueId && hasRole(EVENT_WRITE_ROLES, user.role);
}

/** Explicit server-backed action. Eligibility is fail-closed at the dock. */
export function PhaseLayoutSnapshotAction({
  eventId,
  phaseId,
  configurationId,
  onFrozen,
}: PhaseLayoutSnapshotActionProps): ReactElement {
  const freeze = useFreezePhaseLayoutSnapshot();
  const previewActive = useLayoutTimelinePreviewStore((state) => state.mode !== "inactive");
  const [completedLabel, setCompletedLabel] = useState<string | null>(null);
  const [flushing, setFlushing] = useState(false);
  const [notSaved, setNotSaved] = useState(false);

  const freezeSavedPlan = async (): Promise<void> => {
    if (
      previewActive
      || flushing
      || isLayoutTimelineMutationLocked()
      || freeze.status === "saving"
      || freeze.status === "success"
    ) return;
    setCompletedLabel(null);
    setNotSaved(false);
    // The freeze copies the server's saved layout, so the latest edits must
    // reach the server first, or the act's frozen layout (and the hallkeeper's
    // sheet) silently misses them (QoL D-15).
    setFlushing(true);
    let saved = false;
    try {
      saved = await flushAutoSave();
    } catch {
      saved = false;
    }
    setFlushing(false);
    if (!saved) {
      setNotSaved(true);
      return;
    }
    const result = await freeze.freeze({ eventId, phaseId }, { configurationId });
    if (result === null) return;
    setCompletedLabel(
      result.outcome === "created"
        ? "Frozen layout saved."
        : "This frozen layout is already current.",
    );
    onFrozen(result);
  };

  return (
    <div className="phase-layout-freeze-action">
      <button
        type="button"
        className="phase-layout-freeze-action__button"
        disabled={previewActive || flushing || freeze.status === "saving" || freeze.status === "success"}
        aria-busy={flushing || freeze.status === "saving"}
        title={previewActive ? "Exit the room timeline preview before freezing a layout." : undefined}
        onClick={() => { void freezeSavedPlan(); }}
      >
        {previewActive
          ? <><Link2 size={13} aria-hidden="true" />Exit preview to freeze</>
          : flushing
            ? <><ActivityIndicator size={18} />Saving your changes…</>
            : freeze.status === "saving"
              ? <><ActivityIndicator size={18} />Freezing saved plan…</>
              : freeze.status === "success"
                ? <><Check size={13} aria-hidden="true" />Freeze current saved plan</>
                : <><Link2 size={13} aria-hidden="true" />Freeze current saved plan</>}
      </button>
      <span
        className={`phase-layout-freeze-action__status${notSaved || freeze.status === "error" ? " is-error" : ""}`}
        role={notSaved || freeze.status === "error" ? "alert" : "status"}
        aria-live="polite"
      >
        {notSaved
          ? "Your latest changes have not reached Venviewer yet, so nothing was frozen. Try again."
          : freeze.error ?? completedLabel ?? ""}
      </span>
    </div>
  );
}
