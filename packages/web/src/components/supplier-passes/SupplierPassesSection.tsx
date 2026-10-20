import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { KeyRound, RefreshCw } from "lucide-react";
import { ApiError } from "../../api/client.js";
import {
  getEventSupplierPasses,
  withdrawSupplierPass,
  type SupplierPassBoard,
  type SupplierPassSummary,
} from "../../api/supplier-coordination.js";
import { ActivityIndicator, ActivityStatus } from "../shared/Activity.js";
import { IssuePassSheet, type IssuePassRequest } from "./IssuePassSheet.js";
import {
  boardSummary,
  dayAndTime,
  linkWords,
  openQuestion,
  partsSummary,
  passState,
  planChangedWords,
  readWords,
} from "./supplier-pass-words.js";
import "./supplier-passes.css";

// ---------------------------------------------------------------------------
// Supplier passes on the event board (A Door for Everyone Outside, stage 1).
//
// The call board for everyone outside the venue who has a part in the event:
// who has a pass, whether they have opened and read it, whether the plan has
// moved on since it was made, and any question they sent. The events team
// issue and withdraw passes here; a hallkeeper reads the same board.
//
// The board is read beside the event board, never in front of it: a slow or
// failed read here never holds the rest of the page.
// ---------------------------------------------------------------------------

/** Passes change when a supplier opens or answers one; a minute is honest. */
const POLL_INTERVAL_MS = 60_000;

type BoardState =
  | { readonly kind: "loading" }
  | { readonly kind: "hidden" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly board: SupplierPassBoard };

/** What a pass says first: the fact that decides what to do next. */
export function passKicker(pass: SupplierPassSummary): string {
  const state = passState(pass);
  if (state === "withdrawn") return "Withdrawn";
  if (openQuestion(pass) !== null) return "Question waiting";
  if (state === "draft") return "Not sent";
  if (state === "ended") return "Ended";
  if (pass.acknowledgements.some((ack) => ack.status === "acknowledged")) return "Read";
  if (pass.openedAt !== null) return "Opened";
  return "Sent";
}

function passTone(pass: SupplierPassSummary): "attention" | "settled" | "quiet" {
  const state = passState(pass);
  if (state === "withdrawn" || state === "ended") return "quiet";
  if (openQuestion(pass) !== null || pass.planChangedAt !== null || state === "draft") return "attention";
  if (pass.acknowledgements.some((ack) => ack.status === "acknowledged")) return "settled";
  return "quiet";
}

function madeWords(pass: SupplierPassSummary, timeZone: string): string {
  const when = dayAndTime(pass.createdAt, timeZone) ?? "";
  return pass.madeBy === null ? `Made ${when}.` : `Made ${when} by ${pass.madeBy.name}.`;
}

function failureWords(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.status === 403) return "Only the events team can change passes. Ask them to do it.";
  if (err instanceof ApiError && err.status === 409) return err.message;
  return fallback;
}

export function SupplierPassesSection({ eventId }: { readonly eventId: string }): ReactElement | null {
  const [state, setState] = useState<BoardState>({ kind: "loading" });
  const [sheet, setSheet] = useState<IssuePassRequest | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ readonly passId: string; readonly message: string } | null>(null);
  const issueButtonRef = useRef<HTMLButtonElement>(null);
  // Reads are numbered as they set out, so an older answer never overrides a
  // newer one, and one background read is out at a time.
  const readsIssued = useRef(0);
  const readsLanded = useRef(0);
  const inFlight = useRef<AbortController | null>(null);
  const currentEvent = useRef(eventId);
  currentEvent.current = eventId;

  // "first" shows the loading state; "changed" follows something this page
  // did, so it replaces any read already out (that read set out before the
  // change); "poll" is the quiet minute tick and never doubles up.
  const read = useCallback((mode: "first" | "changed" | "poll"): void => {
    if (inFlight.current !== null) {
      if (mode === "poll") return;
      inFlight.current.abort();
    }
    const controller = new AbortController();
    inFlight.current = controller;
    readsIssued.current += 1;
    const seq = readsIssued.current;
    const forEvent = eventId;
    if (mode === "first") setState({ kind: "loading" });
    void getEventSupplierPasses(forEvent, controller.signal)
      .then((board) => {
        if (currentEvent.current !== forEvent || seq < readsLanded.current) return;
        readsLanded.current = seq;
        setState({ kind: "ready", board });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || currentEvent.current !== forEvent || seq < readsLanded.current) return;
        // Not this person's board to see: the section stays out of the way.
        if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
          setState({ kind: "hidden" });
          return;
        }
        // A failed refresh keeps the last good board on screen.
        setState((previous) => previous.kind === "ready" ? previous : { kind: "error" });
      })
      .finally(() => {
        if (inFlight.current === controller) inFlight.current = null;
      });
  }, [eventId]);

  useEffect(() => {
    read("first");
    return () => {
      inFlight.current?.abort();
      inFlight.current = null;
    };
  }, [read]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      read("poll");
    }, POLL_INTERVAL_MS);
    return () => { window.clearInterval(timer); };
  }, [read]);

  const withdraw = useCallback((pass: SupplierPassSummary) => {
    if (busyId !== null) return;
    setBusyId(pass.id);
    setRowError(null);
    setNotice(null);
    void withdrawSupplierPass(pass.id)
      .then(() => {
        setNotice(`${pass.title}: pass withdrawn. The link no longer opens; what they confirmed stays on record.`);
        read("changed");
      })
      .catch((err: unknown) => {
        setRowError({ passId: pass.id, message: failureWords(err, "The pass could not be withdrawn, so its link still opens. Try again.") });
      })
      .finally(() => { setBusyId(null); });
  }, [busyId, read]);

  const closeSheet = useCallback((changed: boolean) => {
    setSheet(null);
    if (changed) read("changed");
    window.requestAnimationFrame(() => { issueButtonRef.current?.focus({ preventScroll: true }); });
  }, [read]);

  const board = state.kind === "ready" ? state.board : null;
  const [current, withdrawn] = useMemo(() => {
    const passes = board?.passes ?? [];
    return [
      passes.filter((pass) => passState(pass) !== "withdrawn"),
      passes.filter((pass) => passState(pass) === "withdrawn"),
    ] as const;
  }, [board]);

  if (state.kind === "hidden") return null;

  const subtitle = board === null
    ? "Who outside the venue has their part of this event, and whether they have read it."
    : board.handoff === null
      ? "Passes open once the layout is approved and compiled for this event."
      : boardSummary(board.passes);
  const canMakePasses = board !== null && board.canIssue && board.handoff !== null && board.scope.length > 0;

  const passItem = (pass: SupplierPassSummary): ReactElement => {
    const timeZone = board?.venueTimeZone ?? "Europe/London";
    const kind = passState(pass);
    const question = openQuestion(pass);
    const changed = kind === "withdrawn" ? null : planChangedWords(pass.planChangedAt, timeZone);
    const busy = busyId === pass.id;
    const actions: ReactElement[] = [];
    if (board?.canIssue === true) {
      const fresh = (
        <button
          key="fresh"
          type="button"
          className="supplier-passes-action"
          disabled={!canMakePasses || busyId !== null}
          onClick={() => { setSheet({ mode: "issue", replace: pass }); }}
        >
          Make a fresh pass
        </button>
      );
      if (kind === "live" || kind === "draft") {
        if (changed !== null) actions.push(fresh);
        actions.push(
          <button
            key="link"
            type="button"
            className="supplier-passes-action"
            disabled={busyId !== null}
            onClick={() => { setSheet({ mode: "link", pass }); }}
          >
            {kind === "draft" ? "Make the link" : "New link"}
          </button>,
          <button
            key="withdraw"
            type="button"
            className="supplier-passes-action is-withdraw"
            aria-label={`Withdraw ${pass.title}'s pass`}
            disabled={busyId !== null}
            aria-busy={busy}
            onClick={() => { withdraw(pass); }}
          >
            {busy && <ActivityIndicator size={18} />}
            {busy ? "Withdrawing…" : "Withdraw"}
          </button>,
        );
      } else {
        actions.push(fresh);
      }
    }
    return (
      <li key={pass.id} className="supplier-passes-item" data-tone={passTone(pass)} data-state={kind}>
        <div className="supplier-passes-body">
          <span className="supplier-passes-kicker">{passKicker(pass)}</span>
          <h3>{pass.title}</h3>
          <p>{partsSummary(pass)}</p>
          <p>{readWords(pass, timeZone)}</p>
          {question !== null && (
            <blockquote className="supplier-passes-question">
              <p>{question.note ?? "They marked a question without a note."}</p>
              <footer>
                {question.acknowledgedByName === null ? "" : `Name given on the link: ${question.acknowledgedByName}. `}
                Sent {dayAndTime(question.createdAt, timeZone) ?? ""}.
              </footer>
            </blockquote>
          )}
          {changed !== null && <p className="supplier-passes-changed">{changed} Make a fresh pass so they see it.</p>}
          <small>{madeWords(pass, timeZone)} {linkWords(pass, timeZone)}</small>
          {rowError?.passId === pass.id && <p className="supplier-passes-error" role="alert">{rowError.message}</p>}
        </div>
        {actions.length > 0 && (
          <div className="supplier-passes-actions" aria-label={`${pass.title} pass actions`}>{actions}</div>
        )}
      </li>
    );
  };

  return (
    <section className="event-day-section supplier-passes" aria-labelledby="supplier-passes-heading">
      <div className="event-day-section-head supplier-passes-head">
        <KeyRound aria-hidden="true" />
        <div>
          <h2 id="supplier-passes-heading">Supplier passes</h2>
          <p>{subtitle}</p>
          {/* The one next step, always in the same place under the count. */}
          {board !== null && board.canIssue && (
            <button
              ref={issueButtonRef}
              type="button"
              className="event-day-button primary supplier-passes-issue"
              disabled={!canMakePasses}
              aria-describedby={canMakePasses ? undefined : "supplier-passes-why"}
              onClick={() => { setSheet({ mode: "issue", replace: null }); }}
            >
              Issue pass
            </button>
          )}
        </div>
      </div>

      <div className="supplier-passes-content">
        {state.kind === "loading" && <ActivityStatus>Reading the supplier passes…</ActivityStatus>}

        {state.kind === "error" && (
          <div className="supplier-passes-failed">
            <p>Couldn't read the supplier passes. Nothing about them has changed.</p>
            <button type="button" className="event-day-button secondary" onClick={() => { read("first"); }}>
              <RefreshCw aria-hidden="true" />
              Read the passes again
            </button>
          </div>
        )}

        {board !== null && (
          <>
            {board.canIssue && !canMakePasses && (
              <p id="supplier-passes-why" className="event-day-muted">
                {board.handoff === null
                  ? "A pass shows a supplier their part of the approved layout, so there is nothing to send until it is approved and compiled."
                  : "The approved layout names no supplier parts yet. Add arrivals or notes for suppliers to the plan and compile it again."}
              </p>
            )}
            {!board.canIssue && board.passes.length > 0 && (
              <p className="event-day-muted">The events team issue and withdraw passes. Ask them for a change.</p>
            )}
            {notice !== null && <p className="supplier-passes-notice" role="status">{notice}</p>}
            {current.length > 0 && <ul className="supplier-passes-list">{current.map(passItem)}</ul>}
            {withdrawn.length > 0 && (
              <>
                <h3 className="supplier-passes-group">No longer open</h3>
                <ul className="supplier-passes-list is-withdrawn">{withdrawn.map(passItem)}</ul>
              </>
            )}
            {board.canIssue && board.passes.length > 0 && (
              <p className="supplier-passes-legend">
                Withdraw stops a pass's link at once. New link makes a fresh link to the same pass and stops the earlier one. What a supplier confirmed always stays on record.
              </p>
            )}
          </>
        )}
      </div>

      {board !== null && sheet !== null && (
        <IssuePassSheet board={board} request={sheet} onClose={closeSheet} />
      )}
    </section>
  );
}
