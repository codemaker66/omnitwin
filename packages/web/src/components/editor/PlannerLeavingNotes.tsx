import { type ReactElement } from "react";
import { useShallow } from "zustand/react/shallow";
import { leftBehindWords, restoreReceipt } from "../../lib/editor-save-status.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { ActivityIndicator } from "../shared/Activity.js";

// ---------------------------------------------------------------------------
// Today's chrome (v1): the receipt for work restored from this device, and the
// note left when another layout opened before the last changes arrived (QoL
// D-01, D-X3). The new chrome says the same words on its slate. Docked where
// the save-error toast docks, which owns the spot while a save has failed or
// a conflict waits.
// ---------------------------------------------------------------------------

export function PlannerLeavingNotes(): ReactElement | null {
  const facts = useEditorStore(useShallow((state) => ({
    restored: state.restoredFromDevice,
    leftBehind: state.leftBehind,
    isSaving: state.isSaving,
    isDirty: state.isDirty,
    isOnline: state.isOnline,
    keptOnDevice: state.keptOnDevice,
    lastSavedAt: state.lastSavedAt,
    saveError: state.saveError,
    saveConflict: state.saveConflict,
  })));
  if (facts.saveError !== null || facts.saveConflict !== null) return null;
  const receipt = facts.restored === null ? null : restoreReceipt({
    restored: facts.restored,
    isSaving: facts.isSaving,
    isDirty: facts.isDirty,
    isOnline: facts.isOnline,
    keptOnDevice: facts.keptOnDevice,
    lastSavedAt: facts.lastSavedAt,
  });
  const note = facts.leftBehind === null ? null : leftBehindWords(facts.leftBehind);
  if (receipt === null && note === null) return null;
  const dismiss = (): void => { useEditorStore.setState({ restoredFromDevice: null, leftBehind: null }); };
  return (
    <div
      data-testid="planner-leaving-notes"
      style={{
        position: "fixed", left: "50%", transform: "translateX(-50%)",
        bottom: "calc(var(--toolbox-bottom, 0px) + 16px)",
        zIndex: 40,
        background: "rgba(20,19,17,0.95)",
        border: "1px solid rgba(201, 138, 91,0.5)",
        borderRadius: 8,
        padding: "12px 16px",
        display: "flex", alignItems: "center", gap: 12,
        fontFamily: "'Inter', system-ui, sans-serif",
        color: "#f5f0e8", fontSize: 13,
        maxWidth: "90vw",
        boxShadow: "0 8px 24px -8px rgba(0,0,0,0.6)",
      }}
    >
      {/* The words alone are the live region: the dismiss key is not news. */}
      <span role="status" aria-live="polite" style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
        {note !== null ? <span>{note}</span> : null}
        {receipt !== null ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            {receipt.working ? <ActivityIndicator size={16} /> : null}
            <span>{receipt.lead} · {receipt.status}</span>
          </span>
        ) : null}
      </span>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        style={{
          padding: "4px 10px", fontSize: 14, background: "transparent",
          color: "#f5f0e8", border: "1px solid rgba(245,240,232,0.25)",
          borderRadius: 4, cursor: "pointer",
        }}
      >
        ✕
      </button>
    </div>
  );
}
