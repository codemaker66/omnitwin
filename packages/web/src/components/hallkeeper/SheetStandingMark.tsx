import { useId, type ReactElement } from "react";
import type { SheetPaperCheckResult } from "@omnitwin/types";
import "./sheet-standing.css";

// ---------------------------------------------------------------------------
// The mark an open sheet carries once it is no longer the version in force
// (useSheetStanding.ts), above its work on screen and at the head of a print
// made from it. It says which version is in force, in words, and offers the
// one step that fixes it. The paper's own check page (SheetCheckPage) says
// the same states for a printed copy.
// ---------------------------------------------------------------------------

export interface SheetStanding {
  readonly label: string;
  readonly detail: string;
  /** The version in force, when opening it is the next step. */
  readonly inForce: number | null;
}

/** What the sheet says about itself, or null while it is the version in force
 *  (or while nobody can tell). `version` is the sheet's own; null for a draft. */
export function describeSheetStanding(result: SheetPaperCheckResult | null, version: number | null): SheetStanding | null {
  if (result === null) return null;
  switch (result.state) {
    case "superseded": {
      const inForce = `v${String(result.currentVersion)}`;
      return version === null
        ? { label: "Not the approved sheet", detail: `${inForce} has been approved since this draft was opened. Set up from ${inForce}.`, inForce: result.currentVersion }
        : { label: "Superseded", detail: `${inForce} is now in force; this screen shows v${String(version)}. Set up from ${inForce}.`, inForce: result.currentVersion };
    }
    case "not_approved":
      // A draft is expected to be unapproved; its review band says so already.
      return version === null ? null : {
        label: "Being revised",
        detail: `The venue reopened this layout after v${String(version)}. Ask the duty manager before setting up from it.`,
        inForce: null,
      };
    case "retired":
      return { label: "No longer in use", detail: "This room's layout has been closed. Ask the duty manager for the sheet you need.", inForce: null };
    case "current":
    case "unknown":
      return null;
  }
}

/** The mark itself. Without `onOpen` (the print) it carries words only. */
export function SheetStandingMark({ standing, onOpen }: {
  readonly standing: SheetStanding;
  readonly onOpen?: () => void;
}): ReactElement {
  const labelId = useId();
  return <div className="hkf-approval-band is-brick hk-standing" role="alert" aria-labelledby={labelId}>
    <strong id={labelId}>{standing.label}</strong>
    <span>{standing.detail}</span>
    {onOpen !== undefined && standing.inForce !== null && <button type="button" className="hk-standing__open" onClick={onOpen}>
      {`Open v${String(standing.inForce)}`}
    </button>}
  </div>;
}
