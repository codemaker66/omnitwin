import { useState, type ReactElement } from "react";
import { ArrowRightLeft } from "lucide-react";
import type { VenueHandler } from "@omnitwin/types";
import { handoverShift, listVenueHandlers } from "../../api/requests.js";
import { ActivityIndicator, ActivityStatus } from "../shared/Activity.js";
import "./slot-requests.css";

// ---------------------------------------------------------------------------
// "Hand over my shift" (goal 19 S7, people matrix §2). An outgoing
// hallkeeper names one relief and every open request they hold passes in
// one go; each stays theirs until the relief takes it, and a relief who does
// not escalates after the venue's relief window. The words come back from
// the server: who, and how many.
// ---------------------------------------------------------------------------

export const SHIFT_HANDOVER_COPY = {
  open: "Hand over my shift",
  finding: "Finding the floor…",
  handTo: "Hand to",
  choose: "Choose a colleague",
  confirm: "Hand over",
  notNow: "Not now",
  nothing: "You hold no open request.",
  handed: (count: number, toName: string): string =>
    `Handed ${String(count)} ${count === 1 ? "request" : "requests"} to ${toName}. Each stays yours until they take it.`,
  /** Requests that had moved on while the handover ran (a colleague resolved one). */
  leftAlone: (count: number): string =>
    count === 1 ? " One had moved on meanwhile and was left as it was." : ` ${String(count)} had moved on meanwhile and were left as they were.`,
  failed: "Could not hand over. Nothing changed.",
} as const;

function errorWords(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error && (error as { readonly code: unknown }).code === "NOTHING_TO_HAND_OVER") {
    return SHIFT_HANDOVER_COPY.nothing;
  }
  return error instanceof Error && error.message.trim().length > 0 ? error.message : SHIFT_HANDOVER_COPY.failed;
}

export interface ShiftHandoverProps {
  readonly venueId: string;
  readonly meId: string | null;
}

export function ShiftHandover({ venueId, meId }: ShiftHandoverProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [floor, setFloor] = useState<readonly VenueHandler[] | null>(null);
  const [floorError, setFloorError] = useState<string | null>(null);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ readonly kind: "done" | "failed"; readonly text: string } | null>(null);

  const begin = (): void => {
    setOpen(true);
    setOutcome(null);
    setFloorError(null);
    if (floor === null) {
      listVenueHandlers(venueId)
        .then(setFloor)
        .catch((error: unknown) => { setFloorError(errorWords(error)); });
    }
  };

  const confirm = async (): Promise<void> => {
    if (target === "" || busy) return;
    setBusy(true);
    try {
      const result = await handoverShift(venueId, target);
      const leftAlone = result.refused > 0 ? SHIFT_HANDOVER_COPY.leftAlone(result.refused) : "";
      setOutcome({ kind: "done", text: `${SHIFT_HANDOVER_COPY.handed(result.handedOver.length, result.toName)}${leftAlone}` });
      setOpen(false);
      setTarget("");
    } catch (error: unknown) {
      setOutcome({ kind: "failed", text: errorWords(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="vv-shift-handover">
      {!open && (
        <button type="button" className="vv-chime-toggle" onClick={begin}>
          <ArrowRightLeft size={16} aria-hidden="true" />
          {SHIFT_HANDOVER_COPY.open}
        </button>
      )}
      {open && (
        <div className="vv-request-followup">
          {floor === null && floorError === null && <ActivityStatus>{SHIFT_HANDOVER_COPY.finding}</ActivityStatus>}
          {floorError !== null && <p className="vv-request-error" role="alert">{floorError}</p>}
          {floor !== null && (
            <label className="vv-request-field">
              {SHIFT_HANDOVER_COPY.handTo}
              <select value={target} disabled={busy} onChange={(event) => { setTarget(event.target.value); }}>
                <option value="">{SHIFT_HANDOVER_COPY.choose}</option>
                {floor.filter((person) => person.id !== meId).map((person) => (
                  <option key={person.id} value={person.id}>{person.name}</option>
                ))}
              </select>
            </label>
          )}
          <div className="vv-request-actions">
            <button
              type="button"
              className="vv-request-action vv-request-action--take"
              disabled={target === "" || busy}
              aria-busy={busy}
              onClick={() => { void confirm(); }}
            >
              {busy && <ActivityIndicator size={14} />} {SHIFT_HANDOVER_COPY.confirm}
            </button>
            <button type="button" className="vv-request-action" disabled={busy} onClick={() => { setOpen(false); setOutcome(null); }}>
              {SHIFT_HANDOVER_COPY.notNow}
            </button>
          </div>
        </div>
      )}
      {outcome !== null && (
        <p className={outcome.kind === "failed" ? "vv-request-error" : "vv-shift-handover-done"} role={outcome.kind === "failed" ? "alert" : "status"}>
          {outcome.text}
        </p>
      )}
    </div>
  );
}

export default ShiftHandover;
