import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import type { SelfTestResult, StuckJob, StuckWork as StuckWorkReading } from "@omnitwin/types";
import { closeStuckJob, getStuckWork, retryStuckJob, runSelfTest } from "../../api/jobs.js";
import { ActivityStatus } from "../shared/Activity.js";
import { CLOSE_MEANS_ID, focusIsLost, StuckJobRow, TRY_AGAIN_MEANS_ID, type RefocusRequest, type RowWork } from "./StuckJobRow.js";
import "./AdminPanel.css";

// ---------------------------------------------------------------------------
// Stuck work: the jobs that ran out of tries, for platform administrators.
// The list is read when the page opens and after each action, never on a
// timer, and the page says when it was read. A refusal is shown in the
// server's own words. The self-test's verdict and each action that went
// through are said in one polite live region, there from the first render.
// ---------------------------------------------------------------------------

interface Reading {
  readonly work: StuckWorkReading;
  /** The browser's clock when the list was read: shown as the time it was read. "Ago" is counted on the server's. */
  readonly readAt: number;
}

type ReadResult =
  | { readonly status: "read"; readonly work: StuckWorkReading }
  | { readonly status: "failed" }
  | { readonly status: "replaced" };

type SelfTest =
  | { readonly state: "running" }
  | { readonly state: "failed"; readonly message: string };

const READ_AT_FORMAT = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

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

/** How long ago the worker last ran, counted on the answering server's own clock, the one `lastPassAt` is on. */
function workerSentence(work: StuckWorkReading): string {
  const { worker } = work;
  if ("worker" in worker) return "The worker is switched off.";
  if (worker.fault === "database") return "The worker cannot reach the database.";
  if (worker.fault === "loop") return "The worker has stopped after an error.";
  if (worker.lastPassAt === null) return "The worker has not run yet.";
  return `The worker last ran ${ago(work.serverNowMs - worker.lastPassAt)}.`;
}

/** One sentence of real counts, as separate parts so each reads on its own, and when the list was read. */
function summary(reading: Reading): readonly string[] {
  const { dead, queued } = reading.work.counts;
  return [
    dead === 0 ? "Nothing is stuck." : `${unit(dead, "job gave", "jobs gave")} up.`,
    ...(queued > 0 ? [`${String(queued)} ${queued === 1 ? "is" : "are"} waiting.`] : []),
    workerSentence(reading.work),
    `The list was read at ${READ_AT_FORMAT.format(new Date(reading.readAt))}.`,
  ];
}

/** A job as the page names it in a sentence: its kind and its venue. */
function jobLabel(job: StuckJob): string {
  return `${job.kind}, ${job.venueName ?? "The platform"}`;
}

function oldSendsSentence(count: number): string {
  return `${String(count)} old ${count === 1 ? "send was" : "sends were"} never recorded as sent or failed.`;
}

/**
 * What the server said became of the self-test's job; whether this server's worker is off is the newest
 * reading's word. Running with it off means another server's worker has the job.
 */
function verdictSentence(result: SelfTestResult, workerOff: boolean): string {
  switch (result.state) {
    case "done":
      return "The self-test ran.";
    case "dead":
      return "The self-test did not finish. It is in the list below.";
    case "abandoned":
      return "The self-test was closed by hand.";
    case "running":
      return workerOff
        ? "The self-test is running on another server."
        : "The self-test is running. It had not finished when the server stopped waiting.";
    case "queued":
      return workerOff
        ? "The self-test is waiting. The worker is switched off."
        : "The self-test has not run yet. It is still waiting.";
  }
}

export function StuckWork(): ReactElement {
  const [reading, setReading] = useState<Reading | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [isReading, setIsReading] = useState(true);
  const [busy, setBusy] = useState<ReadonlyMap<string, RowWork>>(new Map());
  const [failures, setFailures] = useState<ReadonlyMap<string, { readonly kind: string; readonly message: string }>>(new Map());
  const [selfTest, setSelfTest] = useState<SelfTest | null>(null);
  /** The newest verdict or outcome, said in the page's one polite live region. */
  const [news, setNews] = useState("");
  const [refocus, setRefocus] = useState<{ readonly id: string; readonly request: RefocusRequest } | null>(null);
  const [headingRequests, setHeadingRequests] = useState(0);

  const controller = useRef<AbortController | null>(null);
  const newest = useRef<Promise<ReadResult> | null>(null);
  const latestReading = useRef<Reading | null>(null);
  const active = useRef(true);
  const busyIds = useRef(new Set<string>());
  const selfTestRunning = useRef(false);
  const jobIds = useRef<ReadonlySet<string>>(new Set());
  const heading = useRef<HTMLHeadingElement | null>(null);
  /** Read through a call: after an await, a property read would stay narrowed to what it was before. */
  const mounted = (): boolean => active.current;

  /** One read. A newer read aborts it; its answer is then dropped and it reports "replaced". */
  const attempt = useCallback((): Promise<ReadResult> => {
    const mine = new AbortController();
    controller.current = mine;
    setIsReading(true);
    const run = async (): Promise<ReadResult> => {
      try {
        const work = await getStuckWork(mine.signal);
        if (controller.current !== mine) return { status: "replaced" };
        latestReading.current = { work, readAt: Date.now() };
        setReading(latestReading.current);
        setReadError(null);
        return { status: "read", work };
      } catch (error) {
        if (controller.current !== mine) return { status: "replaced" };
        setReadError(words(error, "The list could not be read."));
        return { status: "failed" };
      } finally {
        if (controller.current === mine) setIsReading(false);
      }
    };
    const promise = run();
    newest.current = promise;
    return promise;
  }, []);

  /** Read the list. Resolves when the NEWEST read has settled, so a caller sees the page as the latest answer left it. */
  const read = useCallback(async (): Promise<ReadResult> => {
    if (!mounted()) return { status: "replaced" };
    controller.current?.abort();
    let promise = attempt();
    let result = await promise;
    while (result.status === "replaced") {
      const next = newest.current;
      if (!mounted() || next === null || next === promise) break;
      promise = next;
      result = await next;
    }
    return result;
  }, [attempt]);

  useEffect(() => {
    active.current = true;
    void read();
    return () => {
      active.current = false;
      controller.current?.abort();
      controller.current = null;
      newest.current = null;
    };
  }, [read]);

  useEffect(() => {
    jobIds.current = new Set(reading?.work.jobs.map((job) => job.id));
  }, [reading]);

  // A row that went away took the focus with it: land on the heading instead of the page's top.
  useEffect(() => {
    if (headingRequests === 0) return;
    if (focusIsLost()) heading.current?.focus();
  }, [headingRequests]);

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
      if (!mounted()) return false;
      setFailures((current) => new Map(current).set(job.id, {
        kind: job.kind,
        message: words(error, "This could not be done."),
      }));
    }
    if (!mounted()) return succeeded;
    const result = await read();
    busyIds.current.delete(job.id);
    if (!mounted()) return succeeded;
    setBusy((current) => without(current, job.id));
    if (succeeded) setNews(work === "retry" ? `Put back on the list: ${jobLabel(job)}.` : `Closed: ${jobLabel(job)}.`);
    if (result.status === "read" && result.work.jobs.some((listed) => listed.id === job.id)) {
      setRefocus({ id: job.id, request: { target: work === "retry" ? "retry" : succeeded ? "close-button" : "note" } });
    } else if (result.status !== "replaced") {
      // The row has gone, or the list could not be read again: the heading, if focus was lost.
      setHeadingRequests((count) => count + 1);
    }
    return succeeded;
  }, [read]);

  /** A read a person asked for, after an error: the heading, if focus was lost with the button that asked. */
  const readAgain = async (): Promise<void> => {
    await read();
    if (mounted()) setHeadingRequests((count) => count + 1);
  };

  const startSelfTest = async (): Promise<void> => {
    if (selfTestRunning.current) return;
    selfTestRunning.current = true;
    setSelfTest({ state: "running" });
    let answer: SelfTestResult | null = null;
    let failed: SelfTest | null = null;
    try {
      answer = await runSelfTest();
    } catch (error) {
      failed = { state: "failed", message: words(error, "The self-test could not be started.") };
    }
    if (!mounted()) return;
    // The list is read again either way (the counts change); the verdict does not depend on that read.
    await read();
    if (!mounted()) return;
    selfTestRunning.current = false;
    const worker = latestReading.current?.work.worker;
    setSelfTest(failed);
    if (answer !== null) setNews(verdictSentence(answer, worker !== undefined && "worker" in worker));
  };

  const anyWork = busy.size > 0 || selfTest?.state === "running";
  const jobs = reading?.work.jobs ?? [];
  const listedIds = new Set(jobs.map((job) => job.id));
  const orphans = [...failures].filter(([id]) => !listedIds.has(id));

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
          {/* The one polite region for verdicts and outcomes, there from the first render so a change is read out. */}
          <div role="status" aria-live="polite" aria-atomic="true">
            {news !== "" && <p>{news}</p>}
          </div>
        </div>
        <div>
          <button type="button" className="admin-panel-button admin-panel-button--secondary"
            disabled={selfTest?.state === "running"} aria-busy={selfTest?.state === "running"}
            onClick={() => { void startSelfTest(); }}>
            Run the self-test
          </button>
          {selfTest?.state === "running" && <ActivityStatus>Running the self-test…</ActivityStatus>}
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
            onClick={() => { void readAgain(); }}>
            {reading === null ? "Try again" : "Read the list again"}
          </button>
        </div>
      )}
      {reading !== null && isReading && !anyWork && <ActivityStatus>Reading the list again…</ActivityStatus>}

      {orphans.map(([id, failure]) => (
        <div key={id} className="admin-panel-inline-error" role="alert">
          <span>{failure.message}</span> <span>({failure.kind})</span>
        </div>
      ))}

      {jobs.length > 0 && (
        <p className="admin-panel-field-note">
          <span id={TRY_AGAIN_MEANS_ID}>Try again runs a job again now, from its first try.</span>{" "}
          <span id={CLOSE_MEANS_ID}>Close with a note stops a job for good and keeps your note.</span>
        </p>
      )}
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
              {jobs.map((job) => (
                <StuckJobRow
                  key={job.id}
                  job={job}
                  working={busy.get(job.id)}
                  failure={failures.get(job.id)?.message}
                  refocus={refocus?.id === job.id ? refocus.request : undefined}
                  onRefocusHandled={() => { setRefocus((current) => current?.id === job.id ? null : current); }}
                  onTryAgain={() => { void runRowAction(job, "retry", () => retryStuckJob(job.id)); }}
                  onClose={(note) => runRowAction(job, "close", () => closeStuckJob(job.id, note))}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
