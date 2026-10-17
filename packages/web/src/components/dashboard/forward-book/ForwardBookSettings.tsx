import { useEffect, useId, useRef, useState, type ReactElement } from "react";
import { FORWARD_BOOK_NOTE_MAX_LENGTH, type ForwardBookCheck, type ForwardBookResponse, type RoomForwardBook } from "@omnitwin/types";
import { checkFromRefusal, clearForwardBook, listForwardBook, recordForwardBook } from "../../../api/forward-book.js";
import { ActivityIndicator, ActivityStatus } from "../../shared/Activity.js";
import { clearConsequence, recordConsequence, refusalWords, roomWords } from "./forward-book-format.js";
import "./ForwardBookSettings.css";

// ---------------------------------------------------------------------------
// Dates for assistants and the website (Blake, 17 October 2026: "hide date
// status until checked"). AI assistants (the public MCP) and the website say
// whether a room has bookings on a date only while a record stands that the
// room's whole forward book is on the Diary. Each room shows who checked it
// and when; the venue's admin or manager records the check, or hides the
// dates again, after reading what that does. A colleague's newer record is
// shown, never overwritten.
// ---------------------------------------------------------------------------

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "error" }
  | { readonly status: "ready"; readonly data: ForwardBookResponse };

type Open =
  | { readonly kind: "record"; readonly spaceId: string; readonly note: string }
  | { readonly kind: "clear"; readonly spaceId: string };

interface RowNotice {
  readonly spaceId: string;
  readonly text: string;
}

export interface ForwardBookSettingsProps {
  readonly venueId: string;
  /** Whether this person may record or clear a check: the venue's own admin
   *  or manager (FORWARD_BOOK_RECORD_ROLES). The API enforces the same. */
  readonly canRecord: boolean;
}

export function ForwardBookSettings({ venueId, canRecord }: ForwardBookSettingsProps): ReactElement {
  const titleId = useId();
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [reloadCount, setReloadCount] = useState(0);
  const [open, setOpen] = useState<Open | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<RowNotice | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const focusNext = useRef<{ readonly spaceId: string; readonly target: "action" | "panel" } | null>(null);

  // A venue's records are never shown under another venue's name.
  useEffect(() => {
    const controller = new AbortController();
    setLoad({ status: "loading" });
    setOpen(null);
    listForwardBook(venueId, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setLoad({ status: "ready", data });
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoad({ status: "error" });
      });
    return () => { controller.abort(); };
  }, [venueId, reloadCount]);

  // Focus follows the reader: into a panel when it opens, back to the room's
  // action when it closes or its work is done.
  useEffect(() => {
    const target = focusNext.current;
    if (target === null || sectionRef.current === null) return;
    const element = sectionRef.current.querySelector<HTMLElement>(
      `[data-space-id="${target.spaceId}"][data-focus="${target.target}"]`,
    );
    if (element === null) return;
    focusNext.current = null;
    element.focus();
  });

  const replaceRoom = (spaceId: string, change: (room: RoomForwardBook) => RoomForwardBook): void => {
    setLoad((previous) => previous.status !== "ready" ? previous : {
      status: "ready",
      data: { rooms: previous.data.rooms.map((room) => room.spaceId === spaceId ? change(room) : room) },
    });
  };

  /** A standing record becomes current; a cleared one becomes previous. */
  const applyCheck = (check: ForwardBookCheck): void => {
    replaceRoom(check.spaceId, (room) => check.clearedAt === null
      ? { ...room, current: check, previous: null }
      : { ...room, current: room.current?.id === check.id ? null : room.current, previous: check });
  };

  const close = (spaceId: string): void => {
    focusNext.current = { spaceId, target: "action" };
    setOpen(null);
  };

  const record = async (room: RoomForwardBook, note: string): Promise<void> => {
    setBusy(room.spaceId);
    setNotice(null);
    try {
      applyCheck(await recordForwardBook(venueId, room.spaceId, note));
      close(room.spaceId);
    } catch (error) {
      const standing = checkFromRefusal(error);
      if (standing !== null) {
        applyCheck(standing);
        close(room.spaceId);
        setNotice({ spaceId: room.spaceId, text: refusalWords(standing) });
      } else {
        setNotice({ spaceId: room.spaceId, text: "The check could not be recorded. Nothing has changed; try again." });
      }
    } finally {
      setBusy(null);
    }
  };

  const clear = async (room: RoomForwardBook, check: ForwardBookCheck): Promise<void> => {
    setBusy(room.spaceId);
    setNotice(null);
    try {
      applyCheck(await clearForwardBook(venueId, check.id));
      close(room.spaceId);
    } catch (error) {
      const current = checkFromRefusal(error);
      if (current !== null) {
        applyCheck(current);
        close(room.spaceId);
        setNotice({ spaceId: room.spaceId, text: refusalWords(current) });
      } else {
        setNotice({ spaceId: room.spaceId, text: "The dates could not be hidden. They are still shown; try again." });
      }
    } finally {
      setBusy(null);
    }
  };

  const data = load.status === "ready" ? load.data : null;

  return (
    <section ref={sectionRef} className="forward-book" data-register="ivory" aria-labelledby={titleId}>
      <header className="forward-book__head">
        <h3 id={titleId}>Dates for assistants and the website</h3>
        <p>
          AI assistants and the website say whether a room has bookings on a date only once someone has checked that
          every booking for that room is on the Diary. Until then they tell people to ask the team.
        </p>
      </header>

      {load.status === "loading" && <ActivityStatus>Loading rooms…</ActivityStatus>}

      {load.status === "error" && (
        <div className="forward-book__notice">
          <p role="alert">The rooms could not be loaded.</p>
          <button type="button" className="forward-book__quiet" onClick={() => { setReloadCount((count) => count + 1); }}>
            Try again
          </button>
        </div>
      )}

      {data !== null && (
        <>
          {data.rooms.length === 0 ? (
            <p className="forward-book__empty">This venue has no rooms yet.</p>
          ) : (
            <ul className="forward-book__list">
              {data.rooms.map((room) => {
                const words = roomWords(room);
                const saving = busy === room.spaceId;
                const panel = open?.spaceId === room.spaceId ? open : null;
                const noteId = `${titleId}-note-${room.spaceId}`;
                return (
                  <li key={room.spaceId} className="forward-book__row" data-state={words.state}>
                    <div className="forward-book__room">
                      <span className="forward-book__name">{room.name}</span>
                      <span className="forward-book__state">{words.label}</span>
                    </div>
                    <div className="forward-book__provenance">
                      <p>{words.provenance}</p>
                      {words.note !== null && <p className="forward-book__note">{words.note}</p>}
                    </div>
                    {canRecord && panel === null && (
                      <div className="forward-book__actions">
                        {room.current === null ? (
                          <button type="button" className="forward-book__primary" disabled={busy !== null}
                            data-space-id={room.spaceId} data-focus="action"
                            aria-label={`Record the check for the ${room.name}`}
                            onClick={() => {
                              setNotice(null);
                              focusNext.current = { spaceId: room.spaceId, target: "panel" };
                              setOpen({ kind: "record", spaceId: room.spaceId, note: "" });
                            }}>
                            Record the check
                          </button>
                        ) : (
                          <button type="button" className="forward-book__quiet" disabled={busy !== null}
                            data-space-id={room.spaceId} data-focus="action"
                            aria-label={`Hide the ${room.name}'s dates`}
                            onClick={() => {
                              setNotice(null);
                              focusNext.current = { spaceId: room.spaceId, target: "panel" };
                              setOpen({ kind: "clear", spaceId: room.spaceId });
                            }}>
                            Hide dates
                          </button>
                        )}
                      </div>
                    )}
                    {panel?.kind === "record" && (
                      <form className="forward-book__panel" data-register="forest" noValidate
                        aria-label={`Record the check for the ${room.name}`}
                        onKeyDown={(event) => {
                          if (event.key !== "Escape" || saving) return;
                          event.preventDefault();
                          close(room.spaceId);
                        }}
                        onSubmit={(event) => {
                          event.preventDefault();
                          void record(room, panel.note);
                        }}>
                        <p className="forward-book__consequence">{recordConsequence(room.name)}</p>
                        <div className="forward-book__field">
                          <label htmlFor={noteId}>Note (optional)</label>
                          <textarea id={noteId} rows={2} maxLength={FORWARD_BOOK_NOTE_MAX_LENGTH} value={panel.note}
                            disabled={saving} data-space-id={room.spaceId} data-focus="panel"
                            aria-describedby={`${noteId}-hint`}
                            onChange={(event) => { setOpen({ ...panel, note: event.target.value }); }} />
                          <span id={`${noteId}-hint`} className="forward-book__hint">What was compared, and up to which date.</span>
                        </div>
                        <div className="forward-book__actions">
                          <button type="submit" className="forward-book__primary" disabled={saving} aria-busy={saving}>
                            {saving && <ActivityIndicator size={16} />}
                            {saving ? "Recording…" : "Record the check"}
                          </button>
                          <button type="button" className="forward-book__quiet" disabled={saving}
                            onClick={() => { close(room.spaceId); }}>
                            Cancel
                          </button>
                        </div>
                      </form>
                    )}
                    {panel?.kind === "clear" && room.current !== null && (
                      <div className="forward-book__panel" data-register="forest" role="group"
                        aria-label={`Hide the ${room.name}'s dates?`}
                        onKeyDown={(event) => {
                          if (event.key !== "Escape" || saving) return;
                          event.preventDefault();
                          close(room.spaceId);
                        }}>
                        <p className="forward-book__consequence">{clearConsequence(room.name)}</p>
                        <div className="forward-book__actions">
                          <button type="button" className="forward-book__primary" disabled={saving} aria-busy={saving}
                            data-space-id={room.spaceId} data-focus="panel"
                            onClick={() => { if (room.current !== null) void clear(room, room.current); }}>
                            {saving && <ActivityIndicator size={16} />}
                            {saving ? "Hiding…" : "Hide dates"}
                          </button>
                          <button type="button" className="forward-book__quiet" disabled={saving}
                            onClick={() => { close(room.spaceId); }}>
                            Keep them shown
                          </button>
                        </div>
                      </div>
                    )}
                    {notice?.spaceId === room.spaceId && <p className="forward-book__row-notice" role="status">{notice.text}</p>}
                  </li>
                );
              })}
            </ul>
          )}
          {!canRecord && (
            <p className="forward-book__footnote">The venue&rsquo;s admin or a manager records these checks.</p>
          )}
        </>
      )}
    </section>
  );
}
