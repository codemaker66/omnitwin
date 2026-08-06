import { useState, type ReactElement } from "react";
import { Check, LoaderCircle, Link2 } from "lucide-react";
import type { FreezePhaseLayoutSnapshotResponse } from "@omnitwin/types";
import { useFreezePhaseLayoutSnapshot } from "../../../hooks/use-freeze-phase-layout-snapshot.js";
import "./PhaseLayoutSnapshotAction.css";

interface PhaseLayoutSnapshotActionProps {
  readonly eventId: string;
  readonly phaseId: string;
  readonly configurationId: string | null;
  readonly isDirty: boolean;
  readonly isReadOnly: boolean;
  readonly onLinked: (result: FreezePhaseLayoutSnapshotResponse) => void;
}

export function PhaseLayoutSnapshotAction({
  eventId,
  phaseId,
  configurationId,
  isDirty,
  isReadOnly,
  onLinked,
}: PhaseLayoutSnapshotActionProps): ReactElement {
  const freeze = useFreezePhaseLayoutSnapshot();
  const [completedLabel, setCompletedLabel] = useState<string | null>(null);
  const disabledReason = configurationId === null
    ? "Open a saved plan to link it."
    : isReadOnly
      ? "Sign in with edit access to link this plan."
    : isDirty
      ? "Save changes before using this plan."
      : null;

  const linkCurrentPlan = async (): Promise<void> => {
    if (configurationId === null || isDirty || isReadOnly || freeze.status === "saving") return;
    setCompletedLabel(null);
    const result = await freeze.freeze(
      { eventId, phaseId },
      { configurationId },
    );
    if (result === null) return;
    setCompletedLabel(
      result.outcome === "created" ? "Saved plan linked." : "This saved plan is already linked.",
    );
    onLinked(result);
  };

  return (
    <div className="phase-layout-link-action">
      <button
        type="button"
        className="phase-layout-link-action__button"
        disabled={disabledReason !== null || freeze.status === "saving" || freeze.status === "success"}
        onClick={() => { void linkCurrentPlan(); }}
      >
        {freeze.status === "saving"
          ? <LoaderCircle className="is-spinning" size={13} aria-hidden="true" />
          : freeze.status === "success"
            ? <Check size={13} aria-hidden="true" />
            : <Link2 size={13} aria-hidden="true" />}
        {freeze.status === "saving" ? "Linking saved plan…" : "Use current saved plan"}
      </button>
      <span
        className={`phase-layout-link-action__status${freeze.status === "error" ? " is-error" : ""}`}
        role={freeze.status === "error" ? "alert" : "status"}
        aria-live="polite"
      >
        {freeze.error ?? completedLabel ?? disabledReason ?? ""}
      </span>
    </div>
  );
}
