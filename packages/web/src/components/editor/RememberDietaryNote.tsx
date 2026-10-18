import { useId } from "react";
import { DIETARY_MEMORY_CONSENT, DIETARY_NOTE_RETENTION } from "@omnitwin/types";
import { ActivityStatus } from "../shared/Activity.js";
import { REMEMBERED_NOTES_PATH, longDate, type DietaryMemoryState } from "../../lib/dietary-memory.js";
import { BORDER, GOLD, TEXT_SEC } from "../../constants/ui-palette.js";

// ---------------------------------------------------------------------------
// "Remember these for our next event?" — the opt-in beside a client's allergy
// note (Blake, 17 October 2026: ask once, then remember). Unticked until the
// client ticks it; the words beside it are the consent the API records, so
// they come from one definition (DIETARY_MEMORY_CONSENT). Every state says
// what saving will do before the client saves.
// ---------------------------------------------------------------------------

export interface RememberDietaryNoteProps {
  readonly memory: DietaryMemoryState;
  /** The note on this layout, as it stands in the sheet. */
  readonly note: string;
  readonly onTickedChange: (ticked: boolean) => void;
  /** Fill the note in from the remembered one. */
  readonly onFillIn: () => void;
  /** Take a filled-in note back out of this layout. */
  readonly onLeaveOut: () => void;
}

export function RememberDietaryNote({ memory, note, onTickedChange, onFillIn, onLeaveOut }: RememberDietaryNoteProps): React.ReactElement | null {
  const detailId = useId();
  if (memory.status === "off") return null;
  if (memory.status === "loading") {
    return <ActivityStatus style={{ fontSize: 12, color: TEXT_SEC }}>Checking for a remembered note…</ActivityStatus>;
  }

  const remembered = memory.remembered;
  const hasNote = note.trim().length > 0;

  if (!hasNote) {
    if (remembered === null) return null;
    return (
      <div style={rowStyle}>
        <button type="button" onClick={onFillIn} style={quietButtonStyle}>Fill in your remembered note</button>
        <span style={lineStyle}>Remembered with your account since {longDate(remembered.consentedAt)}.</span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {memory.prefilled && remembered !== null && (
        <div style={rowStyle}>
          <span style={lineStyle}>Filled in from the note you asked us to remember on {longDate(remembered.consentedAt)}.</span>
          <button type="button" onClick={onLeaveOut} style={quietButtonStyle}>Leave it out of this event</button>
        </div>
      )}
      <label style={checkboxRowStyle}>
        <input
          type="checkbox"
          checked={memory.ticked}
          onChange={(event) => { onTickedChange(event.target.checked); }}
          aria-describedby={detailId}
          style={{ accentColor: GOLD, width: 18, height: 18, margin: 0, cursor: "pointer", flex: "none" }}
        />
        <span style={{ fontSize: 13, fontWeight: 600, color: "#eee" }}>{DIETARY_MEMORY_CONSENT.question}</span>
      </label>
      <p id={detailId} style={{ ...lineStyle, margin: "0 0 0 28px" }}>{DIETARY_MEMORY_CONSENT.detail}</p>
      <p aria-live="polite" style={{ ...lineStyle, margin: "0 0 0 28px" }}>
        <SaveConsequence memory={memory} note={note} />
      </p>
      {memory.status === "error" && (
        <p style={{ ...lineStyle, margin: "0 0 0 28px" }}>
          We could not check for a remembered note just now, so the box starts unticked. Close and reopen this sheet to check again.
        </p>
      )}
    </div>
  );
}

/** What saving will do to the remembered note, said before the client saves. */
function SaveConsequence({ memory, note }: { readonly memory: DietaryMemoryState; readonly note: string }): React.ReactElement | null {
  const remembered = memory.remembered;
  if (remembered === null) return null;
  const since = longDate(remembered.consentedAt);
  const link = (
    <a href={REMEMBERED_NOTES_PATH} target="_blank" rel="noopener noreferrer" style={{ color: GOLD, textUnderlineOffset: 3 }}>
      See or remove remembered notes
    </a>
  );
  if (memory.ticked) {
    if (remembered.otherAllergies !== note) {
      return <>Saving replaces the note remembered on {since} with this one. {link}</>;
    }
    return <>Remembered with your account since {since}. {link}</>;
  }
  if (memory.initiallyTicked) {
    return (
      <>
        Saving removes the remembered note from your account. This layout keeps its note until{" "}
        {DIETARY_NOTE_RETENTION.daysAfterEvent} days after the event.
      </>
    );
  }
  return <>A different note is remembered with your account, since {since}. It stays as it is unless you tick the box. {link}</>;
}

// Client text: the panel's light ink (12.8:1 on its card), above the 7:1 the
// house asks of anything a client reads.
const lineStyle: React.CSSProperties = { margin: 0, fontSize: 12, lineHeight: 1.5, color: "#ddd" };

const rowStyle: React.CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 };

const checkboxRowStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 10, minHeight: 44, cursor: "pointer",
};

const quietButtonStyle: React.CSSProperties = {
  minHeight: 44, padding: "0 14px", fontSize: 12, fontFamily: "inherit",
  background: "transparent", color: "#eee", border: `1px solid ${BORDER}`, borderRadius: 6, cursor: "pointer",
};
