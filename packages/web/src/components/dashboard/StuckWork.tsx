import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactElement } from "react";
import { CloseStuckJobSchema, type StuckJob, type StuckWork as StuckWorkReading } from "@omnitwin/types";
import { closeStuckJob, getStuckWork, retryStuckJob, runSelfTest } from "../../api/jobs.js";
import { ActivityStatus } from "../shared/Activity.js";
import "./AdminPanel.css";

// ---------------------------------------------------------------------------
// Stuck work: the jobs that ran out of tries, for platform administrators.
// The list is read when the page opens and after each action, never on a
// timer. A refusal is shown in the server's own words.
// ---------------------------------------------------------------------------

const NOTE_MAX_LENGTH = 500;
const COLUMN_COUNT = 6;
const WHEN_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
});

interface Reading {
  readonly work: StuckWorkReading;
  /** The browser's clock when the list was read, the one moment "ago" is counted from. */
  readonly readAt: number;
}

type ReadResult =
  | { readonly status: "read"; readonly work: StuckWorkReading }
  | { readonly status: "failed" }
  | { readonly status: "replaced" };

type RowWork = "retry" | "close";

interface Failure {
  readonly kind: string;
  readonly message: string;
}

type SelfTest =
  | { readonly state: "running" }
  | { readonly state: "ran" }
  | { readonly state: "unfinished" }
  | { readonly state: "failed"; readonly message: string };

function words(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}

function without<V>(map: ReadonlyMap<string, V>, key: string): Map<string, V> {
  const next = new Map(map);
  next.delete(key);
  return next;
}

function unit(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

function ago(milliseconds: number): string {
  const minutes = Math.floor(Math.max(0, milliseconds) / 60_000);
  if (minutes < 1) return "less than a minute ago";
  if (minutes < 60) return `${unit(minutes, "minute", "minutes")} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${unit(hours, "hour", "hours")} ago`;
  return `${unit(Math.floor(hours / 24), "day", "days")} ago`;
}

function workerSentence(reading: Reading): string {
  const { worker } = reading.work;
  if ("worker" in worker) return "The worker is switched off.";
  if (worker.fault === "database") return "The worker cannot reach the database.";
  if (worker.fault === "loop") return "The worker has stopped after an error.";
  if (worker.lastPassAt === null) return "The worker has not run yet.";
  return `The worker last ran ${ago(reading.readAt - worker.lastPassAt)}.`;
}

/** One sentence of real counts, as separate parts so each reads on its own. */
function summary(reading: Reading): readonly string[] {
  const { dead, queued } = reading.work.counts;
  return [
    dead === 0 ? "Nothing is stuck." : `${unit(dead, "job gave", "jobs gave")} up.`,
    ...(queued > 0 ? [`${String(queued)} ${queued === 1 ? "is" : "are"} waiting.`] : []),
    workerSentence(reading),
  ];
}

function oldSendsSentence(count: number): string {
  return `${String(count)} old ${count === 1 ? "send was" : "sends were"} never recorded as sent or failed.`;
}

function selfTestSentence(outcome: SelfTest): string | null {
  if (outcome.state === "ran") return "The self-test ran.";
  if (outcome.state === "unfinished") return "The self-test did not finish. It is on the list above.";
  return null;
}

export function StuckWork(): ReactElement {
  const [reading, setReading] = useState<Reading | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [isReading, setIsReading] = useState(true);
  const [busy, setBusy] = useState<ReadonlyMap<string, RowWork>>(new Map());
  const [failures, setFailures] = useState<ReadonlyMap<string, Failure>>(new Map());
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [selfTest, setSelfTest] = useState<SelfTest | null>(null);

  const controller = useRef<AbortController | null>(null);
  const active = useRef(true);
  const busyIds = useRef(new Set<string>());
  const selfTestRunning = useRef(false);
  const jobIds = useRef<ReadonlySet<string>>(new Set());
  const noteInput = useRef<HTMLInputElement | null>(null);
  const closeButtons = useRef(new Map<string, HTMLButtonElement>());
  const heading = useRef<HTMLHeadingElement | null>(null);
  const refocus = useRef(false);

  /** Read the list. A newer read aborts this one; an older or aborted answer is dropped. */
  const read = useCallback(async (): Promise<ReadResult> => {
    if (!active.current) return { status: "replaced" };
    controller.current?.abort();
    const mine = new AbortController();
    controller.current = mine;
    setIsReading(true);
    try {
      const work = await getStuckWork(mine.signal);
      if (controller.current !== mine) return { status: "replaced" };
      setReading({ work, readAt: Date.now() });
      setReadError(null);
      return { status: "read", work };
    } catch (error) {
      if (controller.current !== mine) return { status: "replaced" };
      setReadError(words(error, "The list could not be read."));
      return { status: "failed" };
    } finally {
      if (controller.current === mine) setIsReading(false);
    }
  }, []);

  useEffect(() => {
    active.current = true;
    void read();
    return () => {
      active.current = false;
      controller.current?.abort();
      controller.current = null;
    };
  }, [read]);

  useEffect(() => {
    jobIds.current = new Set(reading?.work.jobs.map((job) => job.id));
  }, [reading]);

  useEffect(() => {
    if (noteFor !== null) noteInput.current?.focus();
  }, [noteFor]);

  // A row that went away took the focus with it: land on the heading instead of the page's top.
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    if (document.activeElement === null || document.activeElement === document.body) heading.current?.focus();
  }, [reading]);

  const runRowAction = useCallback(async (job: StuckJob, work: RowWork, run: () => Promise<void>): Promise<boolean> => {
    if (busyIds.current.has(job.id)) return false;
    busyIds.current.add(job.id);
    setBusy((current) => new Map(current).set(job.id, work));
    // A refusal for a job that has left the list has no row to stand in; it clears with the next action.
    setFailures((current) => new Map([...current].filter(([id]) => id !== job.id && jobIds.current.has(id))));
    let succeeded = false;
    try {
      await run();
      succeeded = true;
    } catch (error) {
      setFailures((current) => new Map(current).set(job.id, {
        kind: job.kind,
        message: words(error, "This could not be done."),
      }));
    }
    refocus.current = true;
    await read();
    busyIds.current.delete(job.id);
    setBusy((current) => without(current, job.id));
    return succeeded;
  }, [read]);

  const tryAgain = (job: StuckJob): void => {
    void runRowAction(job, "retry", () => retryStuckJob(job.id));
  };

  const openNote = (job: StuckJob): void => {
    if (noteFor === job.id) {
      noteInput.current?.focus();
      return;
    }
    setNote("");
    setNoteFor(job.id);
  };

  const cancelNote = (job: StuckJob): void => {
    setNoteFor(null);
    setNote("");
    closeButtons.current.get(job.id)?.focus();
  };

  const submitNote = (event: FormEvent, job: StuckJob): void => {
    event.preventDefault();
    const parsed = CloseStuckJobSchema.safeParse({ note });
    if (!parsed.success) return;
    void runRowAction(job, "close", () => closeStuckJob(job.id, parsed.data.note)).then((closed) => {
      if (!closed) return;
      setNoteFor(null);
      setNote("");
    });
  };

  const startSelfTest = async (): Promise<void> => {
    if (selfTestRunning.current) return;
    selfTestRunning.current = true;
    setSelfTest({ state: "running" });
    let started: string | null = null;
    let outcome: SelfTest | null = null;
    try {
      started = (await runSelfTest()).id;
    } catch (error) {
      outcome = { state: "failed", message: words(error, "The self-test could not be started.") };
    }
    const result = await read();
    if (outcome === null && started !== null && result.status === "read") {
      outcome = { state: result.work.jobs.some((stuckJob) => stuckJob.id === started) ? "unfinished" : "ran" };
    }
    selfTestRunning.current = false;
    setSelfTest(outcome);
  };

  const anyWork = busy.size > 0 || selfTest?.state === "running";
  const jobs = reading?.work.jobs ?? [];
  const listedIds = new Set(jobs.map((job) => job.id));
  const orphans = [...failures].filter(([id]) => !listedIds.has(id));
  const parsedNote = CloseStuckJobSchema.safeParse({ note });
  const selfTestText = selfTest === null ? null : selfTestSentence(selfTest);

  return (
    <section className="admin-panel-shell" aria-labelledby="stuck-work-title">
      <header className="admin-panel-header">
        <div>
          <p className="admin-panel-kicker">Platform admin</p>
          <h2 id="stuck-work-title" ref={heading} tabIndex={-1}>Stuck work</h2>
          {reading !== null && (
            <p>
              {summary(reading).map((part, index) => (
                <span key={part}>{index > 0 ? " " : ""}<span>{part}</span></span>
              ))}
            </p>
          )}
          {reading !== null && reading.work.counts.oldPendingSends > 0 && <p>{oldSendsSentence(reading.work.counts.oldPendingSends)}</p>}
        </div>
        <div>
          <button type="button" className="admin-panel-button admin-panel-button--secondary"
            disabled={selfTest?.state === "running"} aria-busy={selfTest?.state === "running"}
            onClick={() => { void startSelfTest(); }}>
            Run the self-test
          </button>
          {selfTest?.state === "running" && <ActivityStatus>Running the self-test…</ActivityStatus>}
          {selfTestText !== null && <p role="status">{selfTestText}</p>}
          {selfTest?.state === "failed" && (
            <div className="admin-panel-inline-error" role="alert"><span>{selfTest.message}</span></div>
          )}
        </div>
      </header>

      {reading === null && isReading && <ActivityStatus>Reading the list…</ActivityStatus>}
      {readError !== null && !(reading === null && isReading) && (
        <div className="admin-panel-inline-error" role="alert">
          <span>{readError}</span>
          <button type="button" className="admin-panel-button admin-panel-button--secondary" disabled={isReading}
            onClick={() => { void read(); }}>
            {reading === null ? "Try again" : "Read the list again"}
          </button>
        </div>
      )}
      {reading !== null && isReading && !anyWork && readError === null && <ActivityStatus>Reading the list again…</ActivityStatus>}

      {orphans.map(([id, failure]) => (
        <div key={id} className="admin-panel-inline-error" role="alert">
          <span>{failure.message}</span> <span>({failure.kind})</span>
        </div>
      ))}

      {jobs.length > 0 && (
        <div className="admin-panel-table-wrap">
          <table className="admin-panel-table">
            <caption className="vv-sr-only">Jobs that gave up, newest first</caption>
            <thead>
              <tr>
                <th scope="col">What kind</th>
                <th scope="col">Venue</th>
                <th scope="col">Gave up</th>
                <th scope="col">Tries</th>
                <th scope="col">Reason</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const working = busy.get(job.id);
                const failure = failures.get(job.id);
                const editing = noteFor === job.id;
                return (
                  <Fragment key={job.id}>
                  <tr>
                    <td>{job.kind}</td>
                    <td>{job.venueName ?? "The platform"}</td>
                    <td><time dateTime={job.gaveUpAt}>{WHEN_FORMAT.format(new Date(job.gaveUpAt))}</time></td>
                    <td>{job.attempts}</td>
                    <td style={{ whiteSpace: "normal", minWidth: "16rem" }}>{job.reason ?? "No reason was recorded."}</td>
                    <td>
                      <div className="admin-panel-row-actions">
                        <button type="button" className="admin-panel-button admin-panel-button--secondary"
                          disabled={working !== undefined} onClick={() => { tryAgain(job); }}>
                          Try again
                        </button>
                        <button type="button" className="admin-panel-button admin-panel-button--danger-subtle"
                          ref={(element) => {
                            if (element === null) closeButtons.current.delete(job.id);
                            else closeButtons.current.set(job.id, element);
                          }}
                          aria-expanded={editing} disabled={working !== undefined}
                          onClick={() => { openNote(job); }}>
                          Close with a note
                        </button>
                      </div>
                    </td>
                  </tr>
                  {(working !== undefined || editing || failure !== undefined) && (
                    <tr>
                      <td colSpan={COLUMN_COUNT}>
                        {working !== undefined && (
                          <ActivityStatus>{working === "retry" ? "Putting it back on the list…" : "Closing it…"}</ActivityStatus>
                        )}
                        {editing && (
                          <form
                            onSubmit={(event) => { submitNote(event, job); }}
                            onKeyDown={(event: KeyboardEvent) => { if (event.key === "Escape" && working === undefined) cancelNote(job); }}
                          >
                            <label className="admin-panel-field">
                              <span>Note</span>
                              <input ref={noteInput} type="text" value={note} maxLength={NOTE_MAX_LENGTH}
                                aria-describedby="stuck-work-note-hint" disabled={working !== undefined}
                                onChange={(event) => { setNote(event.target.value); }} />
                            </label>
                            <p id="stuck-work-note-hint">
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
                                disabled={working !== undefined} onClick={() => { cancelNote(job); }}>
                                Cancel
                              </button>
                            </div>
                          </form>
                        )}
                        {failure !== undefined && (
                          <div className="admin-panel-inline-error" role="alert"><span>{failure.message}</span></div>
                        )}
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
