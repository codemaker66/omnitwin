import { useState, type ReactElement } from "react";
import { Check, LoaderCircle, Link2 } from "lucide-react";
import type { FreezePhaseLayoutSnapshotResponse } from "../../../api/room-layout-timeline.js";
import type { AuthUser } from "../../../stores/auth-store.js";
import { useFreezePhaseLayoutSnapshot } from "../../../hooks/use-freeze-phase-layout-snapshot.js";
import { useLayoutTimelinePreviewStore } from "../../../stores/layout-timeline-preview-store.js";
import { isLayoutTimelineMutationLocked } from "../../../lib/layout-timeline-preview-lock.js";
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
  return user.venueId === venueId && (user.role === "admin" || user.role === "staff");
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

  const freezeSavedPlan = async (): Promise<void> => {
    if (
      previewActive
      || isLayoutTimelineMutationLocked()
      || freeze.status === "saving"
      || freeze.status === "success"
    ) return;
    setCompletedLabel(null);
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
        disabled={previewActive || freeze.status === "saving" || freeze.status === "success"}
        title={previewActive ? "Exit the room timeline preview before freezing a layout." : undefined}
        onClick={() => { void freezeSavedPlan(); }}
      >
        {freeze.status === "saving"
          ? <LoaderCircle className="is-spinning" size={13} aria-hidden="true" />
          : freeze.status === "success"
            ? <Check size={13} aria-hidden="true" />
            : <Link2 size={13} aria-hidden="true" />}
        {previewActive
          ? "Exit preview to freeze"
          : freeze.status === "saving" ? "Freezing saved plan…" : "Freeze current saved plan"}
      </button>
      <span
        className={`phase-layout-freeze-action__status${freeze.status === "error" ? " is-error" : ""}`}
        role={freeze.status === "error" ? "alert" : "status"}
        aria-live="polite"
      >
        {freeze.error ?? completedLabel ?? ""}
      </span>
    </div>
  );
}
