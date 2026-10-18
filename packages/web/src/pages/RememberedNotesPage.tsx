import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { DIETARY_MEMORY_CONSENT, DIETARY_NOTE_RETENTION, type RememberedDietaryNote } from "@omnitwin/types";
import { ActivityIndicator, ActivityStatus } from "../components/shared/Activity.js";
import { listRememberedDietaryNotes, removeRememberedDietaryNote } from "../api/dietary-memory.js";
import { longDate } from "../lib/dietary-memory.js";
import "./RememberedNotesPage.css";

// ---------------------------------------------------------------------------
// The client's remembered allergy notes ("ask once, then remember", Blake,
// 17 October 2026): what is kept with their account, from which layout,
// what they agreed to and when, and a way to remove it at any time. The API
// answers for the signed-in account only.
// ---------------------------------------------------------------------------

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly notes: readonly RememberedDietaryNote[] };

interface Removed { readonly id: string; readonly venueName: string; readonly on: string }

export function RememberedNotesPage(): React.ReactElement {
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [removed, setRemoved] = useState<readonly Removed[]>([]);

  useEffect(() => {
    const previous = document.title;
    document.title = "Remembered allergy notes · Venviewer";
    return () => { document.title = previous; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoad({ kind: "loading" });
    listRememberedDietaryNotes(controller.signal).then(
      (notes) => { if (!controller.signal.aborted) setLoad({ kind: "ready", notes }); },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setLoad({ kind: "error", message: error instanceof Error ? error.message : "The request did not finish." });
      },
    );
    return () => { controller.abort(); };
  }, [attempt]);

  const onRemoved = useCallback((note: RememberedDietaryNote) => {
    setLoad((current) => current.kind === "ready"
      ? { kind: "ready", notes: current.notes.filter((candidate) => candidate.id !== note.id) }
      : current);
    setRemoved((current) => [...current, { id: note.id, venueName: note.venueName, on: longDate(new Date().toISOString()) }]);
  }, []);

  return (
    <main className="rn-page">
      <section className="rn-sheet" aria-labelledby="rn-title">
        <Link to="/" className="rn-back">Venviewer home</Link>
        <p className="rn-kicker">Your account</p>
        <h1 id="rn-title">Remembered allergy notes</h1>
        <p className="rn-lede">
          Notes you asked us to keep for your next event, by ticking &ldquo;{DIETARY_MEMORY_CONSENT.question}&rdquo; beside them.
          Each one fills in your next layout at that venue. They are shown to you alone.
        </p>

        {removed.map((entry) => (
          <p key={entry.id} className="rn-removed" role="status">
            Removed from your account on {entry.on}. Your next layout at {entry.venueName} will not be filled in.
          </p>
        ))}

        {load.kind === "loading" && <ActivityStatus variant="panel">Loading your remembered notes…</ActivityStatus>}

        {load.kind === "error" && (
          <div className="rn-problem" role="alert">
            <p>Your remembered notes could not be loaded. {load.message}</p>
            <button type="button" className="rn-button" onClick={() => { setAttempt((n) => n + 1); }}>Try again</button>
          </div>
        )}

        {load.kind === "ready" && load.notes.length === 0 && removed.length === 0 && (
          <div className="rn-empty">
            <p>No allergy notes are remembered with your account.</p>
            <p>
              When you add an allergy note to a layout, the box beside it asks whether to keep it for your next event.
              It starts unticked, and nothing is kept unless you tick it.
            </p>
            <Link className="rn-button" to="/plan">Open the planner</Link>
          </div>
        )}

        {load.kind === "ready" && load.notes.length > 0 && (
          <ul className="rn-notes">
            {load.notes.map((note) => <NoteCard key={note.id} note={note} onRemoved={onRemoved} />)}
          </ul>
        )}
      </section>
    </main>
  );
}

function NoteCard({ note, onRemoved }: {
  readonly note: RememberedDietaryNote;
  readonly onRemoved: (note: RememberedDietaryNote) => void;
}): React.ReactElement {
  const [removing, setRemoving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const consequenceId = `rn-consequence-${note.id}`;

  const remove = async (): Promise<void> => {
    setRemoving(true);
    setProblem(null);
    try {
      await removeRememberedDietaryNote(note.id);
      onRemoved(note);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "The request did not finish.");
      setRemoving(false);
    }
  };

  return (
    <li className="rn-note">
      <p className="rn-venue">{note.venueName}</p>
      <blockquote className="rn-text">{note.otherAllergies}</blockquote>
      <p className="rn-meta">
        Remembered on {longDate(note.consentedAt)}
        {note.updatedAt !== note.consentedAt && <> · last saved {longDate(note.updatedAt)}</>}
        {note.sourceLayout !== null && <> · from your layout &ldquo;{note.sourceLayout.name}&rdquo;</>}
      </p>
      <details className="rn-agreed">
        <summary>What you agreed to</summary>
        <p>{note.consentWording}</p>
        <p>Agreed on {longDate(note.consentedAt)}.</p>
      </details>
      <div className="rn-actions">
        <button
          type="button"
          className="rn-button"
          disabled={removing}
          aria-busy={removing}
          aria-describedby={consequenceId}
          onClick={() => { void remove(); }}
        >
          {removing && <ActivityIndicator size={16} />}
          {removing ? "Removing…" : "Remove this note"}
        </button>
        <p id={consequenceId} className="rn-consequence">
          Takes the note off your account now. A layout that already carries it keeps it until {DIETARY_NOTE_RETENTION.daysAfterEvent} days
          after its event; the venue&apos;s events team can take it off sooner if you ask.
        </p>
      </div>
      {problem !== null && (
        <p className="rn-problem" role="alert">The note was not removed. {problem} Try again, or ask the venue&apos;s events team to remove it.</p>
      )}
    </li>
  );
}
