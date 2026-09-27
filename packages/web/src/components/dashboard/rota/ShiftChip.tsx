import type { ReactElement } from "react";
import { ROTA_SKILL_LABELS, type RotaShift } from "@omnitwin/types";
import { openIssues, shiftName, shiftTimes } from "./rota-format.js";

// ---------------------------------------------------------------------------
// One shift on the rota: its times, role and room, whether it is still a
// draft, and the first thing it needs, in a few plain words. The whole chip
// is the way into the shift; its name, read aloud, carries all of it.
// ---------------------------------------------------------------------------

export function ShiftChip({
  shift, personName, timeZone, selected, onOpen,
}: {
  readonly shift: RotaShift;
  readonly personName: string | null;
  readonly timeZone: string;
  readonly selected: boolean;
  readonly onOpen: ((shift: RotaShift, trigger: HTMLElement) => void) | null;
}): ReactElement {
  const times = shiftTimes(shift, timeZone);
  const open = openIssues(shift);
  const block = open.find((issue) => issue.severity === "block");
  const warning = open.find((issue) => issue.severity === "warning");
  const kept = shift.issues.filter((issue) => issue.kept !== null).length;
  const unfilled = shift.staffMemberId === null;
  const tone = block !== undefined ? "alert" : warning !== undefined ? "attention" : "calm";
  const place = shift.spaceName === null ? ROTA_SKILL_LABELS[shift.role] : `${ROTA_SKILL_LABELS[shift.role]} · ${shift.spaceName}`;

  const body = (
    <>
      <span className="rota-shift__time" aria-hidden="true">{times.text}</span>
      <span className="rota-shift__role" aria-hidden="true">{place}</span>
      {/* A draft shows by its dashed edge, explained once beside the week;
          its name, read aloud, says "draft". */}
      {shift.status === "cancelled" && <span className="rota-shift__state" aria-hidden="true">Cancelled</span>}
      {block !== undefined && <span className="rota-shift__issue" data-tone="alert" aria-hidden="true">{block.short}</span>}
      {block === undefined && warning !== undefined && (
        <span className="rota-shift__issue" data-tone="attention" aria-hidden="true">
          {warning.short}{open.length > 1 ? ` · ${String(open.length - 1)} more` : ""}
        </span>
      )}
      {open.length === 0 && kept > 0 && (
        <span className="rota-shift__issue" data-tone="kept" aria-hidden="true">{kept === 1 ? "Warning kept" : `${String(kept)} warnings kept`}</span>
      )}
    </>
  );

  const className = `rota-shift${unfilled ? " ws-plane" : ""}`;
  if (onOpen === null) {
    return (
      <div className={className} data-status={shift.status} data-tone={tone} role="group" aria-label={shiftName(shift, personName, timeZone)}>
        {body}
      </div>
    );
  }
  return (
    <button type="button" className={className} data-status={shift.status} data-tone={tone}
      aria-label={shiftName(shift, personName, timeZone)} aria-current={selected ? "true" : undefined}
      data-shift-id={shift.id}
      onClick={(event) => { onOpen(shift, event.currentTarget); }}>
      {body}
    </button>
  );
}
