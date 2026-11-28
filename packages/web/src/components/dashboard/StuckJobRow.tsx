import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactElement } from "react";
import { CloseStuckJobSchema, type StuckJob } from "@omnitwin/types";
import { ActivityStatus } from "../shared/Activity.js";

// ---------------------------------------------------------------------------
// One job on Stuck work: its row, and under it the working state, the note
// form and any refusal. The row owns its own note draft and its own focus, so
// nothing another row does can touch what a person is typing here. The kind
// is the row's header cell; each control is described by the row's kind and
// venue and by what it will do, so no two rows' controls sound alike.
// ---------------------------------------------------------------------------

export const STUCK_JOB_COLUMN_COUNT = 6;
/** The page's own lines that say what Try again and Close with a note do; each row's buttons point at them. */
export const TRY_AGAIN_MEANS_ID = "stuck-work-try-again-means";
export const CLOSE_MEANS_ID = "stuck-work-close-means";
const NOTE_MAX_LENGTH = 500;
const WHEN_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
});

export type RowWork = "retry" | "close";

/** Where focus goes back to: a row's Try again, its note box (a refused Close), or its Close with a note button (a Close that went through). */
export type RefocusTarget = "retry" | "note" | "close-button";

/** A request, used once, to put focus back on one of a row's controls. */
export interface RefocusRequest {
  readonly target: RefocusTarget;
}

/** Focus has been lost: nothing holds it, as when the control that had it went away. The page moves focus only then, or when it is still in the row that acted. */
export function focusIsLost(): boolean {
  const focused = document.activeElement;
  return focused === null || focused === document.body;
}

interface StuckJobRowProps {
  readonly job: StuckJob;
  /** The action in flight on this job, if any. */
  readonly working: RowWork | undefined;
  /** The server's words for the last action on this job that was refused. */
  readonly failure: string | undefined;
  readonly refocus: RefocusRequest | undefined;
  /** Told when the request has been honoured or dropped, so it is never used twice. */
  readonly onRefocusHandled: () => void;
  readonly onTryAgain: () => void;
  /** Resolves true when the job was closed. */
  readonly onClose: (note: string) => Promise<boolean>;
}

export function StuckJobRow({ job, working, failure, refocus, onRefocusHandled, onTryAgain, onClose }: StuckJobRowProps): ReactElement {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");
  const alive = useRef(true);
  const retryButton = useRef<HTMLButtonElement | null>(null);
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const noteInput = useRef<HTMLInputElement | null>(null);
  const mainRow = useRef<HTMLTableRowElement | null>(null);
  const detailRow = useRef<HTMLTableRowElement | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    if (editing) noteInput.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (refocus === undefined) return;
    const focused = document.activeElement;
    const mine = focused !== null && (mainRow.current?.contains(focused) === true || detailRow.current?.contains(focused) === true);
    if (focusIsLost() || mine) {
      // A refused Close leaves its note open: the person is in the form, so they go back to it.
      const target = refocus.target === "retry" ? retryButton.current
        : refocus.target === "note" ? noteInput.current ?? closeButton.current : closeButton.current;
      target?.focus();
    }
    onRefocusHandled();
  }, [refocus, onRefocusHandled]);

  const parsedNote = CloseStuckJobSchema.safeParse({ note });
  // The row's own header cell and venue: what each of its controls is described by, so no two rows' sound alike.
  const kindId = `stuck-job-${job.id}-kind`;
  const venueId = `stuck-job-${job.id}-venue`;
  const hintId = `stuck-note-hint-${job.id}`;
  const closeMeansId = `stuck-note-means-${job.id}`;
  const venueName = job.venueName ?? "The platform";

  const openNote = (): void => {
    if (editing) noteInput.current?.focus();
    else setEditing(true);
  };

  const cancelNote = (): void => {
    setEditing(false);
    setNote("");
    closeButton.current?.focus();
  };

  const submitNote = (event: FormEvent): void => {
    event.preventDefault();
    if (!parsedNote.success) return;
    void onClose(parsedNote.data.note).then((closed) => {
      if (!closed || !alive.current) return;
      setEditing(false);
      setNote("");
    });
  };

  return (
    <>
      <tr ref={mainRow}>
        <th scope="row" id={kindId} className="admin-panel-table-row-header">{job.kind}</th>
        <td id={venueId}>{venueName}</td>
        <td><time dateTime={job.gaveUpAt}>{WHEN_FORMAT.format(new Date(job.gaveUpAt))}</time></td>
        <td>{job.attempts}</td>
        <td className="admin-panel-table-cell--wrap">{job.reason ?? "No reason was recorded."}</td>
        <td>
          <div className="admin-panel-row-actions">
            <button type="button" className="admin-panel-button admin-panel-button--secondary" ref={retryButton}
              aria-describedby={`${kindId} ${venueId} ${TRY_AGAIN_MEANS_ID}`}
              disabled={working !== undefined} onClick={onTryAgain}>
              Try again
            </button>
            <button type="button" className="admin-panel-button admin-panel-button--danger-subtle" ref={closeButton}
              aria-describedby={`${kindId} ${venueId} ${CLOSE_MEANS_ID}`}
              aria-expanded={editing} disabled={working !== undefined} onClick={openNote}>
              Close with a note
            </button>
          </div>
        </td>
      </tr>
      {(working !== undefined || editing || failure !== undefined) && (
        <tr ref={detailRow}>
          <td colSpan={STUCK_JOB_COLUMN_COUNT}>
            {working !== undefined && (
              <ActivityStatus>{working === "retry" ? "Putting it back on the list…" : "Closing it…"}</ActivityStatus>
            )}
            {editing && (
              <form
                onSubmit={submitNote}
                onKeyDown={(event: KeyboardEvent) => { if (event.key === "Escape" && working === undefined) cancelNote(); }}
              >
                <label className="admin-panel-field">
                  <span>Note<span className="vv-sr-only"> for {job.kind}, {venueName}</span></span>
                  <input ref={noteInput} type="text" value={note} maxLength={NOTE_MAX_LENGTH}
                    aria-describedby={`${closeMeansId} ${hintId}`} disabled={working !== undefined}
                    onChange={(event) => { setNote(event.target.value); }} />
                </label>
                <p id={closeMeansId}>Closing stops this job for good. It will not run again. Your note is kept with it.</p>
                <p id={hintId}>
                  {note.trim().length > 0 && !parsedNote.success
                    ? "The note holds a character that cannot be stored."
                    : `1 to ${String(NOTE_MAX_LENGTH)} characters.`}
                </p>
                <div className="admin-panel-row-actions">
                  <button type="submit" className="admin-panel-button admin-panel-button--primary"
                    aria-describedby={`${kindId} ${venueId} ${closeMeansId}`}
                    disabled={!parsedNote.success || working !== undefined}>
                    Close the job
                  </button>
                  <button type="button" className="admin-panel-button admin-panel-button--secondary"
                    disabled={working !== undefined} onClick={cancelNote}>
                    Cancel
                  </button>
                </div>
              </form>
            )}
            {failure !== undefined && (
              <div className="admin-panel-inline-error" role="alert"><span>{failure}</span></div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
