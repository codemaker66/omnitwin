import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactElement } from "react";
import { X } from "lucide-react";
import {
  ROTA_SKILLS,
  ROTA_SKILL_LABELS,
  RotaWarningCodeSchema,
  rotaDayMonth,
  rotaDurationWords,
  rotaIsUnder18On,
  rotaWeekdayName,
  type RotaIssue,
  type RotaShift,
  type RotaWarningCode,
  type RotaWeek,
  type StaffRecord,
} from "@omnitwin/types";
import {
  cancelRotaShift, createRotaShift, keepRotaWarning, removeRotaShift, rotaRefusalWords, shiftFromRefusal, updateRotaShift,
} from "../../../api/rota.js";
import { ActivityIndicator } from "../../shared/Activity.js";
import {
  draftFromShift, draftInstants, nameList, noticeSentence, prefillShift, shiftTimes, suggestedBreak,
  type DayFunctions, type FunctionLine, type ShiftDraft,
} from "./rota-format.js";

// ---------------------------------------------------------------------------
// One shift, beside the week: add it, change it, remove a draft, cancel a
// published one, or keep a warning with the reason why. Consequences are said
// before acting: who is told, and how much notice they have. A colleague's
// newer change is shown, never overwritten.
// ---------------------------------------------------------------------------

/** What the panel says after an action; the view keeps it across re-reads. */
export interface PanelMessage {
  readonly tone: "alert" | "settled";
  readonly text: string;
}

function warningCode(issue: RotaIssue): RotaWarningCode | null {
  const parsed = RotaWarningCodeSchema.safeParse(issue.code);
  return issue.severity === "warning" && parsed.success ? parsed.data : null;
}

function sameDraft(left: ShiftDraft, right: ShiftDraft): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function workMinutes(draft: ShiftDraft): number | null {
  const match = (clock: string): number | null => {
    const found = /^(\d{2}):(\d{2})$/u.exec(clock);
    return found === null ? null : Number(found[1]) * 60 + Number(found[2]);
  };
  const start = match(draft.start);
  const end = match(draft.end);
  if (start === null || end === null) return null;
  return (end <= start ? end + 1440 : end) - start;
}

/**
 * Mounted afresh for each shift and each saved revision of it (the view keys
 * it so), so the form always starts from what is saved and nobody's typing is
 * replaced underneath them.
 */
export function ShiftEditor({
  venueId, week, functions, shift, newDraft, canManage, message, onSaved, onRemoved, onClose,
}: {
  readonly venueId: string;
  readonly week: RotaWeek;
  readonly functions: ReadonlyMap<string, DayFunctions> | null;
  /** The saved shift, or null for a new one described by `newDraft`. */
  readonly shift: RotaShift | null;
  readonly newDraft: ShiftDraft | null;
  readonly canManage: boolean;
  readonly message: PanelMessage | null;
  readonly onSaved: (shift: RotaShift, message: PanelMessage) => void;
  readonly onRemoved: (words: string) => void;
  readonly onClose: () => void;
}): ReactElement {
  const titleId = useId();
  const formId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const tz = week.timeZone;
  const dayFunctions = (date: string): readonly FunctionLine[] => functions?.get(date)?.confirmed ?? [];
  const [initial] = useState<ShiftDraft>(() => {
    if (shift === null) return newDraft ?? prefillShift({ record: null, date: week.weekStart, functions: [], timeZone: tz });
    const date = draftFromShift(shift, tz, []).date;
    return draftFromShift(shift, tz, functions?.get(date)?.confirmed ?? []);
  });
  const [draft, setDraft] = useState<ShiftDraft>(initial);
  const [timesTouched, setTimesTouched] = useState(shift !== null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"remove" | "cancel" | null>(null);
  const [notice, setNotice] = useState<PanelMessage | null>(null);
  const [keeping, setKeeping] = useState<{ readonly code: RotaWarningCode; readonly reason: string } | null>(null);

  // Focus. Mounted after an action (the view remounts the editor for each
  // saved revision), the panel starts at what the action said; otherwise at
  // its heading. A question takes the place of the button that asked it, and
  // focus goes back to that button when the question is put away.
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const questionRef = useRef<HTMLParagraphElement>(null);
  const removeRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const keepButtons = useRef(new Map<string, HTMLButtonElement>());
  const lastConfirming = useRef<"remove" | "cancel" | null>(null);
  const lastKeeping = useRef<RotaWarningCode | null>(null);
  const keepingCode = keeping?.code ?? null;

  useEffect(() => { (noticeRef.current ?? headingRef.current)?.focus(); }, []);
  useEffect(() => {
    if (confirming !== null) questionRef.current?.focus();
    else if (lastConfirming.current === "remove") removeRef.current?.focus();
    else if (lastConfirming.current === "cancel") cancelRef.current?.focus();
    lastConfirming.current = confirming;
  }, [confirming]);
  useEffect(() => {
    if (keepingCode === null && lastKeeping.current !== null) keepButtons.current.get(lastKeeping.current)?.focus();
    lastKeeping.current = keepingCode;
  }, [keepingCode]);

  const records = useMemo(() => new Map(week.records.map((record) => [record.id, record])), [week.records]);
  const person: StaffRecord | undefined = draft.staffMemberId === null ? undefined : records.get(draft.staffMemberId);
  const originalPerson = shift?.staffMemberId === null || shift === null ? undefined : records.get(shift.staffMemberId);
  const under18 = person !== undefined && rotaIsUnder18On(person.turns18On, draft.date);
  const minutes = workMinutes(draft);
  const instants = draftInstants(draft, tz);
  const breakValid = minutes !== null && draft.breakMinutes >= 0 && draft.breakMinutes < minutes;
  const dirty = shift === null || !sameDraft(draft, initial);
  const canSave = canManage && instants !== null && breakValid && dirty && busy === null && shift?.status !== "cancelled";
  const published = shift?.status === "published";

  const update = (change: Partial<ShiftDraft>): void => {
    setNotice(null);
    setDraft((current) => ({ ...current, ...change }));
  };

  const choosePerson = (id: string): void => {
    const next = id === "" ? null : records.get(id) ?? null;
    const change: Partial<ShiftDraft> = { staffMemberId: next?.id ?? null };
    // A new shift takes the person's own first skill, as it was prefilled.
    if (shift === null && next !== null) {
      const role = ROTA_SKILLS.find((skill) => next.skills.includes(skill));
      if (role !== undefined) Object.assign(change, { role });
    }
    update(change);
  };

  const chooseFunction = (id: string): void => {
    const line = dayFunctions(draft.date).find((candidate) => candidate.id === id);
    if (line === undefined) {
      update({ functionId: null, eventId: null });
      return;
    }
    const change: Partial<ShiftDraft> = { functionId: line.id, eventId: line.eventId, spaceId: line.spaceId };
    if (!timesTouched) {
      const suggested = prefillShift({ record: person ?? null, date: draft.date, functions: [line], timeZone: tz });
      Object.assign(change, { start: suggested.start, end: suggested.end, breakMinutes: suggested.breakMinutes });
    }
    update(change);
  };

  const changeTimes = (change: Partial<Pick<ShiftDraft, "start" | "end">>): void => {
    setTimesTouched(true);
    const next = { ...draft, ...change };
    const worked = workMinutes(next);
    // Keep the break the law asks for in step while nobody has chosen one.
    const breakMinutes = worked !== null && draft.breakMinutes === suggestedBreak(workMinutes(draft) ?? 0, under18)
      ? suggestedBreak(worked, under18) : draft.breakMinutes;
    update({ ...change, breakMinutes });
  };

  const who = (id: string | null): string => (id === null ? null : records.get(id)?.displayName) ?? "Nobody";
  const told = (id: string | null): boolean => week.people.find((candidate) => candidate.id === id)?.hasAccount ?? false;

  /** Who hears of a change to a published shift, said before it is saved. */
  const changeConsequence = (): string | null => {
    if (!published) return null;
    const affected = [...new Set([shift.staffMemberId, draft.staffMemberId].filter((id): id is string => id !== null))];
    if (affected.length === 0) return "Nobody is on this shift, so nobody is told.";
    const inApp = affected.filter(told).map(who);
    const inPerson = affected.filter((id) => !told(id)).map(who);
    const parts: string[] = [];
    if (inApp.length > 0) parts.push(`${nameList(inApp)} will be told in the app.`);
    if (inPerson.length > 0) parts.push(`${nameList(inPerson)} ${inPerson.length === 1 ? "has" : "have"} no account, so let them know yourself.`);
    return parts.join(" ");
  };

  const refused = (error: unknown, fallback: string): void => {
    const current = shiftFromRefusal(error);
    if (current !== null) {
      onSaved(current, { tone: "alert", text: "Someone changed this shift a moment ago. Here is how it stands now." });
      return;
    }
    setNotice({ tone: "alert", text: rotaRefusalWords(error, fallback) });
  };

  const save = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!canSave) return;
    setBusy("save");
    setNotice(null);
    const body = {
      staffMemberId: draft.staffMemberId,
      role: draft.role,
      startsAt: instants.startsAt,
      endsAt: instants.endsAt,
      breakMinutes: draft.breakMinutes,
      eventId: draft.eventId,
      spaceId: draft.spaceId,
      note: draft.note.trim() === "" ? null : draft.note.trim(),
    };
    try {
      if (shift === null) {
        const created = await createRotaShift(venueId, body);
        onSaved(created, { tone: "settled", text: "Added as a draft. Nobody is told until the week is published." });
      } else {
        const saved = await updateRotaShift(venueId, shift.id, { ...body, expectedRevision: shift.revision });
        onSaved(saved, { tone: "settled", text: published ? `Saved. ${changeConsequence() ?? ""}`.trim() : "Saved." });
      }
    } catch (error) {
      refused(error, "The shift could not be saved. Nothing has changed; try again.");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (): Promise<void> => {
    if (shift === null) return;
    setBusy("remove");
    setNotice(null);
    try {
      await removeRotaShift(venueId, shift);
      onRemoved("Removed the draft. Nobody had been told of it.");
    } catch (error) {
      setConfirming(null);
      refused(error, "The shift could not be removed. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const cancel = async (): Promise<void> => {
    if (shift === null) return;
    setBusy("cancel");
    setNotice(null);
    try {
      const cancelled = await cancelRotaShift(venueId, shift);
      const name = who(shift.staffMemberId);
      setConfirming(null);
      onSaved(cancelled, {
        tone: "settled",
        text: shift.staffMemberId === null ? "Cancelled." : told(shift.staffMemberId)
          ? `Cancelled. ${name} has been told in the app.` : `Cancelled. Let ${name} know yourself.`,
      });
    } catch (error) {
      setConfirming(null);
      refused(error, "The shift could not be cancelled. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const keep = async (issue: RotaIssue, reason: string): Promise<void> => {
    const code = warningCode(issue);
    if (shift === null || code === null) return;
    setBusy(`keep:${code}`);
    setNotice(null);
    try {
      const kept = await keepRotaWarning(venueId, shift, code, reason.trim());
      setKeeping(null);
      onSaved(kept, { tone: "settled", text: "Kept, with your reason." });
    } catch (error) {
      refused(error, "The warning could not be kept. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    if (confirming !== null) { setConfirming(null); return; }
    if (keeping !== null) { setKeeping(null); return; }
    onClose();
  };

  const heading = shift === null ? "New shift" : shift.status === "cancelled" ? "Cancelled shift" : shift.status === "draft" ? "Draft shift" : "Shift";
  const subtitle = `${who(draft.staffMemberId === null ? null : draft.staffMemberId)} · ${rotaWeekdayName(draft.date)} ${rotaDayMonth(draft.date)}`;
  const functionOptions = dayFunctions(draft.date);
  const linkedElsewhere = draft.eventId !== null && !functionOptions.some((line) => line.eventId === draft.eventId);
  const activePeople = week.records.filter((record) => record.isActive || record.id === draft.staffMemberId);
  const neededBreak = minutes === null ? 0 : suggestedBreak(minutes, under18);
  const endsNextDay = instants !== null && draft.end <= draft.start;
  const consequence = changeConsequence();
  // What the last action said stops being true once the form is changed again.
  const said = notice ?? (dirty ? null : message);

  return (
    <section className="rota-panel" aria-labelledby={titleId} onKeyDown={onKeyDown}>
      <header className="rota-panel__head">
        <div>
          <h2 id={titleId} ref={headingRef} tabIndex={-1}>{heading}</h2>
          <p className="rota-panel__sub">{shift === null ? subtitle : `${who(shift.staffMemberId)} · ${rotaWeekdayName(draft.date)} ${rotaDayMonth(draft.date)}`}</p>
        </div>
        <button type="button" className="rota-icon-button" aria-label="Close" onClick={onClose}><X aria-hidden="true" size={18} /></button>
      </header>

      {said !== null && (
        <p className="rota-notice" data-tone={said.tone} role={said.tone === "alert" ? "alert" : "status"} ref={noticeRef} tabIndex={-1}>{said.text}</p>
      )}

      {/* What the shift needs comes first: it is why the panel was opened. */}
      {canManage && shift !== null && shift.issues.length > 0 && (
        <section className="rota-issues" aria-label="Warnings">
          <h3>{shift.issues.some((issue) => issue.severity === "block") ? "Before this can be published" : "Warnings"}</h3>
          {dirty && shift.status !== "cancelled" && <p className="rota-field__hint">These are for the shift as saved. Save to check your changes.</p>}
          <ul>
            {shift.issues.map((issue) => (
              <li key={issue.code} className="rota-issue" data-tone={issue.severity === "block" ? "alert" : issue.kept === null ? "attention" : "kept"}>
                <p className="rota-issue__message">{issue.message}</p>
                {issue.kept !== null && (
                  <p className="rota-issue__kept">
                    Kept{issue.kept.byName === null ? "" : ` by ${issue.kept.byName}`}: {issue.kept.reason}
                  </p>
                )}
                {warningCode(issue) !== null && issue.kept === null && originalPerson !== undefined && keeping?.code !== issue.code && (
                  <button type="button" className="rota-link" disabled={busy !== null}
                    ref={(element) => { if (element === null) keepButtons.current.delete(issue.code); else keepButtons.current.set(issue.code, element); }}
                    onClick={() => { const code = warningCode(issue); if (code !== null) setKeeping({ code, reason: "" }); }}>Keep as it is…</button>
                )}
                {keeping?.code === issue.code && (
                  <form className="rota-keep" noValidate onSubmit={(event) => { event.preventDefault(); void keep(issue, keeping.reason); }}>
                    <label className="rota-field">
                      <span>Why it stays as it is</span>
                      <input type="text" maxLength={300} value={keeping.reason} autoFocus disabled={busy !== null}
                        placeholder="Morag asked for this swap; Monday off instead"
                        onChange={(event) => { setKeeping({ code: keeping.code, reason: event.target.value }); }} />
                    </label>
                    <div className="rota-actions">
                      <button type="submit" className="rota-button rota-button--primary" disabled={keeping.reason.trim().length < 3 || busy !== null}
                        aria-busy={busy === `keep:${issue.code}`}>
                        {busy === `keep:${issue.code}` && <ActivityIndicator size={16} />}
                        {busy === `keep:${issue.code}` ? "Saving…" : "Keep, with this reason"}
                      </button>
                      <button type="button" className="rota-button" disabled={busy !== null} onClick={() => { setKeeping(null); }}>Not now</button>
                    </div>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {shift !== null && shift.status === "cancelled" && (
        <p className="rota-panel__fact">
          Cancelled{shift.cancellationNoticeHours === null ? "" : ` with ${String(shift.cancellationNoticeHours)} hours' notice`}. {shiftTimes(shift, tz).spoken}.
        </p>
      )}

      {!canManage && shift !== null && (
        <dl className="rota-facts">
          <div><dt>When</dt><dd>{shiftTimes(shift, tz).spoken}</dd></div>
          <div><dt>Role</dt><dd>{ROTA_SKILL_LABELS[shift.role]}</dd></div>
          {shift.spaceName !== null && <div><dt>Room</dt><dd>{shift.spaceName}</dd></div>}
          {shift.eventName !== null && <div><dt>For</dt><dd>{shift.eventName}</dd></div>}
          {shift.breakMinutes > 0 && <div><dt>Break</dt><dd>{String(shift.breakMinutes)} minutes</dd></div>}
          {shift.note !== null && <div><dt>Note</dt><dd>{shift.note}</dd></div>}
        </dl>
      )}

      {canManage && shift?.status !== "cancelled" && (
        <form id={formId} className="rota-form" noValidate onSubmit={(event) => { void save(event); }}>
          <div className="rota-form__grid">
            <label className="rota-field rota-field--wide">
              <span>Who</span>
              <select value={draft.staffMemberId ?? ""} disabled={busy !== null} onChange={(event) => { choosePerson(event.target.value); }}>
                <option value="">Nobody yet (an unfilled need)</option>
                {activePeople.map((record) => <option key={record.id} value={record.id}>{record.displayName}</option>)}
              </select>
            </label>
            <label className="rota-field">
              <span>Role</span>
              <select value={draft.role} disabled={busy !== null}
                onChange={(event) => { const role = ROTA_SKILLS.find((skill) => skill === event.target.value); if (role !== undefined) update({ role }); }}>
                {ROTA_SKILLS.map((skill) => <option key={skill} value={skill}>{ROTA_SKILL_LABELS[skill]}</option>)}
              </select>
            </label>
            <label className="rota-field">
              <span>Day</span>
              <input type="date" value={draft.date} disabled={busy !== null} required
                onChange={(event) => { if (/^\d{4}-\d{2}-\d{2}$/u.test(event.target.value)) update({ date: event.target.value, functionId: null }); }} />
            </label>
            <label className="rota-field">
              <span>Starts</span>
              <input type="time" step={900} value={draft.start} disabled={busy !== null} required
                onChange={(event) => { changeTimes({ start: event.target.value }); }} />
            </label>
            <label className="rota-field">
              <span>Ends</span>
              <input type="time" step={900} value={draft.end} disabled={busy !== null} required aria-describedby={`${formId}-ends`}
                onChange={(event) => { changeTimes({ end: event.target.value }); }} />
            </label>
            <p className="rota-field__hint rota-field--wide" id={`${formId}-ends`} aria-live="polite">
              {instants === null || minutes === null ? "Enter a start and an end."
                : `${rotaDurationWords(minutes)}${endsNextDay ? ", ending the next day" : ""}.`}
            </p>
            <label className="rota-field">
              <span>Break, minutes</span>
              <input type="number" inputMode="numeric" min={0} max={720} step={5} value={draft.breakMinutes} disabled={busy !== null}
                aria-describedby={`${formId}-break`}
                onChange={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 0) update({ breakMinutes: value }); }} />
            </label>
            <p className="rota-field__hint rota-field__hint--beside" id={`${formId}-break`}>
              {minutes !== null && !breakValid ? "The break must be shorter than the shift."
                : neededBreak <= draft.breakMinutes ? ""
                  : under18 ? `Someone under 18 needs a break of ${String(neededBreak)} minutes on a shift this long.`
                    : `A shift this long needs a break of ${String(neededBreak)} minutes.`}
            </p>
            <label className="rota-field rota-field--wide">
              <span>For</span>
              <select value={draft.functionId ?? (linkedElsewhere ? "linked" : "")} disabled={busy !== null}
                onChange={(event) => { if (event.target.value !== "linked") chooseFunction(event.target.value); }}>
                <option value="">No particular function</option>
                {linkedElsewhere && <option value="linked">{shift?.eventName ?? "Its linked event"}</option>}
                {functionOptions.map((line) => <option key={line.id} value={line.id}>{line.title}, {line.times}</option>)}
              </select>
            </label>
            <label className="rota-field rota-field--wide">
              <span>Room</span>
              <select value={draft.spaceId ?? ""} disabled={busy !== null} onChange={(event) => { update({ spaceId: event.target.value === "" ? null : event.target.value }); }}>
                <option value="">No particular room</option>
                {week.rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
              </select>
            </label>
            <label className="rota-field rota-field--wide">
              <span>Note</span>
              <input type="text" maxLength={500} value={draft.note} disabled={busy !== null} placeholder="Keys from the hallkeeper at 07:45"
                onChange={(event) => { update({ note: event.target.value }); }} />
            </label>
          </div>

          <div className="rota-actions">
            <button type="submit" className="rota-button rota-button--primary" disabled={!canSave} aria-busy={busy === "save"}>
              {busy === "save" && <ActivityIndicator size={16} />}
              {busy === "save" ? "Saving…" : shift === null ? "Add shift" : "Save changes"}
            </button>
            {shift?.status === "draft" && confirming === null && (
              <button type="button" className="rota-button" ref={removeRef} disabled={busy !== null} onClick={() => { setConfirming("remove"); }}>Remove…</button>
            )}
            {published && confirming === null && (
              <button type="button" className="rota-button" ref={cancelRef} data-tone="alert" disabled={busy !== null} onClick={() => { setConfirming("cancel"); }}>Cancel this shift…</button>
            )}
          </div>
          <p className="rota-panel__consequence">
            {shift === null || shift.status === "draft" ? "Nobody is told until the week is published." : consequence}
          </p>
        </form>
      )}

      {confirming === "remove" && shift !== null && (
        <div className="rota-confirm" role="group" aria-labelledby={`${formId}-confirm`}>
          <p className="rota-confirm__question" id={`${formId}-confirm`} ref={questionRef} tabIndex={-1}>Remove this draft?</p>
          <p className="rota-confirm__consequence">Nobody has been told of it, so it simply goes.</p>
          <div className="rota-actions">
            <button type="button" className="rota-button rota-button--primary" disabled={busy !== null} aria-busy={busy === "remove"} onClick={() => { void remove(); }}>
              {busy === "remove" && <ActivityIndicator size={16} />}
              {busy === "remove" ? "Removing…" : "Remove"}
            </button>
            <button type="button" className="rota-button" disabled={busy !== null} onClick={() => { setConfirming(null); }}>Keep it</button>
          </div>
        </div>
      )}

      {confirming === "cancel" && shift !== null && (
        <div className="rota-confirm" role="group" aria-labelledby={`${formId}-cancel`}>
          <p className="rota-confirm__question" id={`${formId}-cancel`} ref={questionRef} tabIndex={-1}>
            Cancel {rotaWeekdayName(draft.date)}&apos;s shift?
          </p>
          <p className="rota-confirm__consequence">
            {shift.staffMemberId === null ? "Nobody is on it, so nobody is told."
              : told(shift.staffMemberId) ? `${who(shift.staffMemberId)} will be told in the app.`
                : `${who(shift.staffMemberId)} has no account, so let them know yourself.`}
            {" "}{noticeSentence(shift.startsAt, Date.now())}
          </p>
          <div className="rota-actions">
            <button type="button" className="rota-button rota-button--primary" disabled={busy !== null} aria-busy={busy === "cancel"} onClick={() => { void cancel(); }}>
              {busy === "cancel" && <ActivityIndicator size={16} />}
              {busy === "cancel" ? "Cancelling…" : "Cancel the shift"}
            </button>
            <button type="button" className="rota-button" disabled={busy !== null} onClick={() => { setConfirming(null); }}>Keep it</button>
          </div>
        </div>
      )}
    </section>
  );
}
