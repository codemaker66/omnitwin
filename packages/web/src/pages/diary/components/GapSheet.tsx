import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactElement } from "react";
import { Link } from "react-router-dom";
import type { TurnaroundRuleSetting, TurnaroundRulesResponse } from "@omnitwin/types";
import {
  createTurnaroundRule, listTurnaroundRules, ruleFromRefusal, updateTurnaroundRule,
} from "../../../api/turnaround-rules.js";
import { ActivityIndicator, ActivityStatus } from "../../../components/shared/Activity.js";
import {
  changeoverDuration, changeoverDurationWords, confirmationWords, eventTypeLabel, parseMinutes, roomLabel,
} from "../../../components/dashboard/changeovers/changeover-format.js";
import { resolveTurnaroundRule } from "../../../lib/turnaround-guidelines.js";
import { BOARD_COPY } from "../board-copy.js";
import { gapFit, type GapFit, type LaneGap } from "../lib/board-layout.js";
import { formatWallTime } from "../lib/board-time.js";

// ---------------------------------------------------------------------------
// The changeover sheet (T-637, slice A). A gap between two functions on the
// timeline opens it beside the lanes: how long the room has, the time the
// room needs and who set it, and whether the gap is enough. The venue's
// administrators keep a demo time, change it, or give the room its own, in
// place. A colleague's newer change is shown rather than overwritten, as in
// Venue settings → Changeovers, which reads and writes the same rules.
// ---------------------------------------------------------------------------

const COPY = BOARD_COPY.changeover;

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "error" }
  | { readonly status: "ready"; readonly data: TurnaroundRulesResponse };

/** Reading, or one of the sheet's two edits: the time that applies, or a
 *  new time for this room alone. */
type Editing =
  | { readonly kind: "none" }
  | { readonly kind: "change"; readonly rule: TurnaroundRuleSetting; readonly minutes: string }
  | { readonly kind: "room"; readonly minutes: string };

export interface GapSheetProps {
  readonly venueId: string;
  readonly room: { readonly id: string; readonly name: string };
  readonly gap: LaneGap;
  /** The venue's administrators change times; everyone else who reads the
   *  Diary sees them. The API enforces the same line. */
  readonly canEdit: boolean;
  readonly onClose: () => void;
  /** A time was kept, changed or set: the board re-reads its gaps. */
  readonly onChanged: () => void;
}

function upsert(rules: readonly TurnaroundRuleSetting[], rule: TurnaroundRuleSetting): TurnaroundRuleSetting[] {
  return rules.some((candidate) => candidate.id === rule.id)
    ? rules.map((candidate) => candidate.id === rule.id ? rule : candidate)
    : [...rules, rule];
}

function fitWords(fit: GapFit): string | null {
  switch (fit.kind) {
    case "enough": return COPY.enough;
    case "short": return COPY.short(changeoverDuration(fit.byMinutes));
    case "unchecked": return COPY.unchecked;
    case "none": return null;
  }
}

export function GapSheet({ venueId, room, gap, canEdit, onClose, onChanged }: GapSheetProps): ReactElement {
  const titleId = useId();
  const ruleHeadingId = useId();
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [reloadCount, setReloadCount] = useState(0);
  const [editing, setEditing] = useState<Editing>({ kind: "none" });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const changeRef = useRef<HTMLButtonElement | null>(null);
  /** After an edit, focus returns to the sheet's own controls. */
  const refocus = useRef(false);

  useEffect(() => { closeRef.current?.focus(); }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoad({ status: "loading" });
    listTurnaroundRules(venueId, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setLoad({ status: "ready", data });
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoad({ status: "error" });
      });
    return () => { controller.abort(); };
  }, [venueId, reloadCount]);

  useEffect(() => {
    if (!refocus.current || editing.kind !== "none") return;
    refocus.current = false;
    (changeRef.current ?? closeRef.current)?.focus();
  });

  const data = load.status === "ready" ? load.data : null;
  const roomNames = useMemo(() => new Map((data?.rooms ?? []).map((entry) => [entry.id, entry.name])), [data]);
  const rule = data === null ? null : resolveTurnaroundRule(data.rules, room.id, gap.after.eventType);
  const fit = gapFit(gap, rule);
  const scopeOf = (candidate: Pick<TurnaroundRuleSetting, "spaceId" | "eventType">): string =>
    `${roomLabel(candidate.spaceId, roomNames)}, ${eventTypeLabel(candidate.eventType).toLowerCase()}`;
  const editScope = editing.kind === "change" ? scopeOf(editing.rule) : `${room.name}, any event`;
  const draftMinutes = editing.kind === "none" ? null : parseMinutes(editing.minutes);

  const finish = (saved: TurnaroundRuleSetting): void => {
    setLoad((previous) => previous.status !== "ready" ? previous
      : { status: "ready", data: { ...previous.data, rules: upsert(previous.data.rules, saved) } });
    refocus.current = true;
    setEditing({ kind: "none" });
    setAnnouncement(COPY.saved(scopeOf(saved), changeoverDuration(saved.minutes)));
    onChanged();
  };

  const refused = (error: unknown, words: (duration: string) => string): void => {
    const current = ruleFromRefusal(error);
    if (current === null) {
      setNotice(COPY.saveFailed);
      return;
    }
    setLoad((previous) => previous.status !== "ready" ? previous
      : { status: "ready", data: { ...previous.data, rules: upsert(previous.data.rules, current) } });
    refocus.current = true;
    setEditing({ kind: "none" });
    setNotice(words(changeoverDuration(current.minutes)));
    onChanged();
  };

  const save = async (target: TurnaroundRuleSetting, minutes: number): Promise<void> => {
    setBusy(true);
    setNotice(null);
    try {
      finish(await updateTurnaroundRule(venueId, target, minutes));
    } catch (error) {
      refused(error, COPY.stale);
    } finally {
      setBusy(false);
    }
  };

  const setForRoom = async (minutes: number): Promise<void> => {
    setBusy(true);
    setNotice(null);
    try {
      finish(await createTurnaroundRule(venueId, { spaceId: room.id, eventType: null, minutes }));
    } catch (error) {
      refused(error, COPY.exists);
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (draftMinutes === null || busy) return;
    if (editing.kind === "change") void save(editing.rule, draftMinutes);
    else if (editing.kind === "room") void setForRoom(draftMinutes);
  };

  const cancelEdit = (): void => {
    refocus.current = true;
    setEditing({ kind: "none" });
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
    if (event.key !== "Escape" || busy) return;
    event.preventDefault();
    // Escape steps back one level: out of an edit first, then the sheet.
    if (editing.kind !== "none") cancelEdit();
    else onClose();
  };

  const words = fitWords(fit);

  return (
    <aside
      className="diary-drawer diary-changeover"
      role="dialog"
      aria-labelledby={titleId}
      aria-busy={busy}
      onKeyDown={onKeyDown}
    >
      <header className="diary-drawer-header">
        <h2 id={titleId} className="diary-drawer-title">{COPY.title}</h2>
        <button ref={closeRef} type="button" className="diary-button" onClick={onClose} disabled={busy}>
          {COPY.close}
        </button>
      </header>

      <section className="diary-changeover-gap" aria-label={room.name}>
        <p className="diary-changeover-room">{room.name}</p>
        <p className="diary-changeover-figure">
          <span aria-hidden="true">{changeoverDuration(gap.minutes)}</span>
          <span className="vv-sr-only">{changeoverDurationWords(gap.minutes)}</span>
        </p>
        <p className="diary-changeover-between">
          {COPY.between(gap.before.title, formatWallTime(gap.startMs), gap.after.title, formatWallTime(gap.endMs))}
        </p>
      </section>

      {load.status === "loading" ? <ActivityStatus>{COPY.loading}</ActivityStatus> : null}

      {load.status === "error" ? (
        <div className="diary-changeover-failed">
          <p role="alert">{COPY.loadFailed}</p>
          <button type="button" className="diary-button" onClick={() => { setReloadCount((count) => count + 1); }}>
            {COPY.retry}
          </button>
        </div>
      ) : null}

      {data === null ? null : (
        <section className="diary-changeover-rule" data-fit={fit.kind} aria-labelledby={ruleHeadingId}>
          <h3 id={ruleHeadingId} className="diary-changeover-kicker">{COPY.ruleHeading}</h3>
          {rule === null ? (
            <p className="diary-changeover-none">{COPY.noRule(room.name)}</p>
          ) : (
            <>
              <p className="diary-changeover-time">
                <span aria-hidden="true">{changeoverDuration(rule.minutes)}</span>
                <span className="vv-sr-only">{changeoverDurationWords(rule.minutes)}</span>
              </p>
              <p className="diary-changeover-scope">{scopeOf(rule)}</p>
              <p className="diary-changeover-confirmation">{confirmationWords(rule)}</p>
              {rule.spaceId === null ? <p className="diary-changeover-note">{COPY.everyRoom}</p> : null}
              {words === null ? null : <p className="diary-changeover-fit">{words}</p>}
            </>
          )}
        </section>
      )}

      {data !== null && canEdit && editing.kind === "none" ? (
        <div className="diary-changeover-actions">
          {rule !== null && rule.confirmedAt === null ? (
            <button type="button" className="diary-button is-primary" disabled={busy} aria-busy={busy}
              onClick={() => { void save(rule, rule.minutes); }}>
              {busy ? <ActivityIndicator size={14} /> : null}
              {COPY.keep(changeoverDuration(rule.minutes))}
            </button>
          ) : null}
          {rule === null ? null : (
            <button ref={changeRef} type="button" className="diary-button" disabled={busy}
              aria-label={COPY.changeLabel(scopeOf(rule))}
              onClick={() => { setNotice(null); setEditing({ kind: "change", rule, minutes: String(rule.minutes) }); }}>
              {COPY.change}
            </button>
          )}
          {rule === null || rule.spaceId === null ? (
            <button type="button" className={`diary-button${rule === null ? " is-primary" : ""}`} disabled={busy}
              onClick={() => { setNotice(null); setEditing({ kind: "room", minutes: rule === null ? "" : String(rule.minutes) }); }}>
              {COPY.setForRoom(room.name)}
            </button>
          ) : null}
        </div>
      ) : null}

      {data !== null && canEdit && editing.kind !== "none" ? (
        <form className="diary-changeover-edit" noValidate onSubmit={submit}>
          <label className="diary-field">
            <span>{COPY.minutes}</span>
            <input type="number" inputMode="numeric" min={0} max={1440} step={5} value={editing.minutes}
              aria-label={COPY.minutesFor(editScope)} disabled={busy} autoFocus
              onChange={(event) => { setEditing({ ...editing, minutes: event.target.value }); }} />
          </label>
          <span className="diary-changeover-preview" aria-live="polite">
            {draftMinutes === null ? COPY.minutesHint : changeoverDuration(draftMinutes)}
          </span>
          <div className="diary-changeover-actions">
            <button type="submit" className="diary-button is-primary" disabled={draftMinutes === null || busy} aria-busy={busy}>
              {busy ? <ActivityIndicator size={14} /> : null}
              {busy ? COPY.saving : COPY.save}
            </button>
            <button type="button" className="diary-button" disabled={busy} onClick={cancelEdit}>
              {COPY.cancel}
            </button>
          </div>
        </form>
      ) : null}

      {data !== null && !canEdit ? <p className="diary-drawer-note">{COPY.readOnly}</p> : null}
      {notice === null ? null : <p className="diary-changeover-notice" role="status">{notice}</p>}
      <span className="vv-sr-only" role="status" aria-live="polite">{announcement}</span>

      {canEdit ? <Link className="diary-changeover-link" to="/dashboard?view=settings">{COPY.allTimes}</Link> : null}
    </aside>
  );
}
