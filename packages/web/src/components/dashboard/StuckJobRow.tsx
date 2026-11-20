import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactElement } from "react";
import { CloseStuckJobSchema, type StuckJob } from "@omnitwin/types";
import { ActivityStatus } from "../shared/Activity.js";

// ---------------------------------------------------------------------------
// One job on Stuck work: its row, and under it the working state, the note
// form and any refusal. The row owns its own note draft and its own focus, so
// nothing another row does can touch what a person is typing here.
// ---------------------------------------------------------------------------

export const STUCK_JOB_COLUMN_COUNT = 6;
const NOTE_MAX_LENGTH = 500;
const WHEN_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
});

export type RowWork = "retry" | "close";

/** A request, made once, to put focus back on one of a row's buttons. A new object is a new request. */
export interface RefocusRequest {
  readonly target: RowWork;
}

interface StuckJobRowProps {
  readonly job: StuckJob;
  /** The action in flight on this job, if any. */
  readonly working: RowWork | undefined;
  /** The server's words for the last action on this job that was refused. */
  readonly failure: string | undefined;
  readonly refocus: RefocusRequest | undefined;
  readonly onTryAgain: () => void;
  /** Resolves true when the job was closed. */
  readonly onClose: (note: string) => Promise<boolean>;
}

export function StuckJobRow({ job, working, failure, refocus, onTryAgain, onClose }: StuckJobRowProps): ReactElement {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");
  const alive = useRef(true);
  const retryButton = useRef<HTMLButtonElement | null>(null);
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const noteInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    if (editing) noteInput.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (refocus === undefined) return;
    // A refused Close leaves its note open: the person is in the form, so they go back to it.
    const target = refocus.target === "retry" ? retryButton.current : noteInput.current ?? closeButton.current;
    target?.focus();
  }, [refocus]);

  const parsedNote = CloseStuckJobSchema.safeParse({ note });

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
      <tr>
        <td>{job.kind}</td>
        <td>{job.venueName ?? "The platform"}</td>
        <td><time dateTime={job.gaveUpAt}>{WHEN_FORMAT.format(new Date(job.gaveUpAt))}</time></td>
        <td>{job.attempts}</td>
        <td className="admin-panel-table-cell--wrap">{job.reason ?? "No reason was recorded."}</td>
        <td>
          <div className="admin-panel-row-actions">
            <button type="button" className="admin-panel-button admin-panel-button--secondary" ref={retryButton}
              disabled={working !== undefined} onClick={onTryAgain}>
              Try again
            </button>
            <button type="button" className="admin-panel-button admin-panel-button--danger-subtle" ref={closeButton}
              aria-expanded={editing} disabled={working !== undefined} onClick={openNote}>
              Close with a note
            </button>
          </div>
        </td>
      </tr>
      {(working !== undefined || editing || failure !== undefined) && (
        <tr>
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
                  <span>Note</span>
                  <input ref={noteInput} type="text" value={note} maxLength={NOTE_MAX_LENGTH}
                    aria-describedby={`stuck-note-hint-${job.id}`} disabled={working !== undefined}
                    onChange={(event) => { setNote(event.target.value); }} />
                </label>
                <p id={`stuck-note-hint-${job.id}`}>
                  {note.trim().length > 0 && !parsedNote.success
                    ? "The note holds a character that cannot be stored."
                    : `1 to ${String(NOTE_MAX_LENGTH)} characters.`}
                </p>
                <div className="admin-panel-row-actions">
                  <button type="submit" className="admin-panel-button admin-panel-button--primary"
                    disabled={!parsedNote.success || working !== undefined}>
                    Close
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
