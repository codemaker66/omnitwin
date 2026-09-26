import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactElement } from "react";
import type { TurnaroundRuleSetting, TurnaroundRulesResponse } from "@omnitwin/types";
import {
  createTurnaroundRule, listTurnaroundRules, retireTurnaroundRule, ruleFromRefusal, updateTurnaroundRule,
} from "../../../api/turnaround-rules.js";
import { ActivityIndicator, ActivityStatus } from "../../shared/Activity.js";
import {
  changeoverDuration, changeoverDurationWords, confirmationWords, eventTypeLabel, firstOpenRoom, parseMinutes,
  removalConsequence, roomLabel, sortRules,
} from "./changeover-format.js";
import "./ChangeoverSettings.css";

// ---------------------------------------------------------------------------
// Changeovers: how long each room needs between two functions (T-637, slice
// A). The Diary warns when a gap is shorter. Seeded demo values read "Not
// confirmed" until someone keeps or changes them; every save records who set
// the time. A colleague's newer change is never overwritten unseen: the
// section shows what the rule says now instead.
// ---------------------------------------------------------------------------

type LoadState =
  | { readonly status: "loading" }
  | { readonly status: "error" }
  | { readonly status: "ready"; readonly data: TurnaroundRulesResponse };

interface RowNotice {
  readonly id: string;
  readonly text: string;
}

interface Draft {
  /** "" is all rooms. */
  readonly spaceId: string;
  /** "" is any event. */
  readonly eventType: string;
  readonly minutes: string;
}

const NEW_DRAFT: Draft = { spaceId: "", eventType: "", minutes: "60" };

/** Where keyboard focus goes once the next render shows it: a row's control,
 *  or the add form's room when no row is left to land on. */
type FocusTarget =
  | { readonly kind: "row"; readonly ruleId: string; readonly action: "change" | "remove" }
  | { readonly kind: "add" };

export function ChangeoverSettings({ venueId }: { readonly venueId: string }): ReactElement {
  const titleId = useId();
  const formId = useId();
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [reloadCount, setReloadCount] = useState(0);
  const [editing, setEditing] = useState<{ readonly id: string; readonly minutes: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<RowNotice | null>(null);
  const [draft, setDraft] = useState<Draft>(NEW_DRAFT);
  /** Until someone uses the add form, it follows the first room without a time. */
  const [draftTouched, setDraftTouched] = useState(false);
  const [addNotice, setAddNotice] = useState<string | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const focusNext = useRef<FocusTarget | null>(null);

  // A venue's times are never shown under another venue's name, so a new
  // load starts from nothing.
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

  // Focus follows the reader: back to the row's control after an edit, a
  // keep or a cancelled removal; on to the next row after a removal.
  useEffect(() => {
    const target = focusNext.current;
    if (target === null || sectionRef.current === null) return;
    const selector = target.kind === "add"
      ? "[data-add-room]"
      : `[data-rule-id="${target.ruleId}"][data-rule-action="${target.action}"]`;
    const element = sectionRef.current.querySelector<HTMLElement>(selector);
    if (element === null) return;
    focusNext.current = null;
    element.focus();
  });

  const data = load.status === "ready" ? load.data : null;
  const roomNames = useMemo(() => new Map((data?.rooms ?? []).map((room) => [room.id, room.name])), [data]);
  const roomOrder = useMemo(() => (data?.rooms ?? []).map((room) => room.id), [data]);
  const openRoom = data === null ? "" : firstOpenRoom(data.rules, roomOrder);
  const shownDraft = draftTouched ? draft : { ...draft, spaceId: openRoom };

  const replaceRules = (next: (rules: readonly TurnaroundRuleSetting[]) => TurnaroundRuleSetting[]): void => {
    setLoad((previous) => previous.status !== "ready" ? previous
      : { status: "ready", data: { ...previous.data, rules: sortRules(next(previous.data.rules), roomOrder) } });
  };

  const scopeWords = (rule: Pick<TurnaroundRuleSetting, "spaceId" | "eventType">): string =>
    `${roomLabel(rule.spaceId, roomNames)}, ${eventTypeLabel(rule.eventType).toLowerCase()}`;

  const save = async (rule: TurnaroundRuleSetting, minutes: number): Promise<void> => {
    setBusy(rule.id);
    setNotice(null);
    focusNext.current = { kind: "row", ruleId: rule.id, action: "change" };
    try {
      const saved = await updateTurnaroundRule(venueId, rule, minutes);
      replaceRules((rules) => rules.map((candidate) => candidate.id === saved.id ? saved : candidate));
      setEditing(null);
    } catch (error) {
      const current = ruleFromRefusal(error);
      if (current !== null) {
        replaceRules((rules) => rules.map((candidate) => candidate.id === current.id ? current : candidate));
        setEditing(null);
        setNotice({ id: rule.id, text: `Someone changed this a moment ago. It now says ${changeoverDuration(current.minutes)}.` });
      } else {
        setNotice({ id: rule.id, text: "The time could not be saved. Try again." });
      }
    } finally {
      setBusy(null);
    }
  };

  const remove = async (rule: TurnaroundRuleSetting): Promise<void> => {
    setBusy(rule.id);
    setNotice(null);
    const rules = data?.rules ?? [];
    const index = rules.findIndex((candidate) => candidate.id === rule.id);
    const neighbour = rules[index + 1] ?? rules[index - 1];
    try {
      await retireTurnaroundRule(venueId, rule.id);
      focusNext.current = neighbour === undefined ? { kind: "add" } : { kind: "row", ruleId: neighbour.id, action: "change" };
      replaceRules((rules) => rules.filter((candidate) => candidate.id !== rule.id));
      setRemoving(null);
    } catch {
      focusNext.current = { kind: "row", ruleId: rule.id, action: "remove" };
      setNotice({ id: rule.id, text: "The time could not be removed. Try again." });
    } finally {
      setBusy(null);
    }
  };

  const draftMinutes = parseMinutes(shownDraft.minutes);
  const draftSpace = shownDraft.spaceId === "" ? null : shownDraft.spaceId;
  const draftType = shownDraft.eventType === "" ? null : shownDraft.eventType;
  const editDraft = (change: Partial<Draft>): void => {
    setAddNotice(null);
    setDraftTouched(true);
    setDraft({ ...shownDraft, ...change });
  };
  const draftTaken = data?.rules.some((rule) => rule.spaceId === draftSpace && rule.eventType === draftType) ?? false;

  const add = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (draftMinutes === null || draftTaken || busy !== null) return;
    setBusy("new");
    setAddNotice(null);
    try {
      const created = await createTurnaroundRule(venueId, { spaceId: draftSpace, eventType: draftType, minutes: draftMinutes });
      replaceRules((rules) => [...rules, created]);
      setDraft(NEW_DRAFT);
      setDraftTouched(false);
      focusNext.current = { kind: "row", ruleId: created.id, action: "change" };
    } catch (error) {
      const existing = ruleFromRefusal(error);
      if (existing !== null) {
        replaceRules((rules) => rules.some((rule) => rule.id === existing.id) ? [...rules] : [...rules, existing]);
        setAddNotice(`${roomLabel(existing.spaceId, roomNames)} already has a time for ${eventTypeLabel(existing.eventType).toLowerCase()}. It is listed above.`);
      } else {
        setAddNotice("The time could not be added. Try again.");
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <section ref={sectionRef} className="changeovers" data-register="ivory" aria-labelledby={titleId}>
      <header className="changeovers__head">
        <h3 id={titleId}>Changeovers</h3>
        <p>How long a room needs between two functions. The Diary warns when a gap is shorter.</p>
      </header>

      {load.status === "loading" && <ActivityStatus>Loading changeover times…</ActivityStatus>}

      {load.status === "error" && (
        <div className="changeovers__notice">
          <p role="alert">Changeover times could not be loaded.</p>
          <button type="button" className="changeovers__quiet" onClick={() => { setReloadCount((count) => count + 1); }}>
            Try again
          </button>
        </div>
      )}

      {data !== null && (
        <>
          {data.rules.length === 0 ? (
            <p className="changeovers__empty">
              No changeover times yet. Until a room has one, the Diary does not check the gaps between its functions.
            </p>
          ) : (
            <ul className="changeovers__list">
              {data.rules.map((rule) => {
                const scope = scopeWords(rule);
                const saving = busy === rule.id;
                const draftEdit = editing?.id === rule.id ? editing : null;
                const editMinutes = draftEdit === null ? null : parseMinutes(draftEdit.minutes);
                return (
                  <li key={rule.id} className="changeovers__row" data-state={rule.confirmedAt === null ? "unconfirmed" : "confirmed"}>
                    <div className="changeovers__scope">
                      <span className="changeovers__room">{roomLabel(rule.spaceId, roomNames)}</span>
                      <span className="changeovers__kind">{eventTypeLabel(rule.eventType)}</span>
                    </div>
                    <p className="changeovers__time">
                      <span aria-hidden="true">{changeoverDuration(rule.minutes)}</span>
                      <span className="vv-sr-only">{changeoverDurationWords(rule.minutes)}</span>
                    </p>
                    <p className="changeovers__confirmation">{confirmationWords(rule)}</p>
                    {draftEdit === null && removing !== rule.id && (
                      <div className="changeovers__actions">
                        {rule.confirmedAt === null && (
                          <button type="button" className="changeovers__primary" disabled={busy !== null} aria-busy={saving}
                            aria-label={`Keep ${changeoverDurationWords(rule.minutes)} for ${scope}`}
                            onClick={() => { void save(rule, rule.minutes); }}>
                            {saving && <ActivityIndicator size={14} />}
                            Keep {changeoverDuration(rule.minutes)}
                          </button>
                        )}
                        <button type="button" className="changeovers__quiet" disabled={busy !== null}
                          data-rule-id={rule.id} data-rule-action="change"
                          aria-label={`Change the time for ${scope}`}
                          onClick={() => { setNotice(null); setRemoving(null); setEditing({ id: rule.id, minutes: String(rule.minutes) }); }}>
                          Change
                        </button>
                        <button type="button" className="changeovers__quiet" disabled={busy !== null}
                          data-rule-id={rule.id} data-rule-action="remove"
                          aria-label={`Remove the time for ${scope}`}
                          onClick={() => { setNotice(null); setEditing(null); setRemoving(rule.id); }}>
                          Remove
                        </button>
                      </div>
                    )}
                    {draftEdit !== null && (
                      <form className="changeovers__edit" noValidate
                        onSubmit={(event) => {
                          event.preventDefault();
                          if (editMinutes !== null) void save(rule, editMinutes);
                        }}>
                        <label>
                          <span>Minutes</span>
                          <input type="number" inputMode="numeric" min={0} max={1440} step={5} value={draftEdit.minutes}
                            aria-label={`Minutes for ${scope}`} disabled={saving} autoFocus
                            onChange={(event) => { setEditing({ id: rule.id, minutes: event.target.value }); }}
                            onKeyDown={(event) => {
                              if (event.key !== "Escape") return;
                              event.preventDefault();
                              focusNext.current = { kind: "row", ruleId: rule.id, action: "change" };
                              setEditing(null);
                            }} />
                        </label>
                        <span className="changeovers__preview" aria-live="polite">
                          {editMinutes === null ? "Enter 0 to 1,440 minutes" : changeoverDuration(editMinutes)}
                        </span>
                        <button type="submit" className="changeovers__primary" disabled={editMinutes === null || saving} aria-busy={saving}>
                          {saving && <ActivityIndicator size={14} />}
                          {saving ? "Saving…" : "Save"}
                        </button>
                        <button type="button" className="changeovers__quiet" disabled={saving}
                          onClick={() => { focusNext.current = { kind: "row", ruleId: rule.id, action: "change" }; setEditing(null); }}>
                          Cancel
                        </button>
                      </form>
                    )}
                    {removing === rule.id && (
                      <div className="changeovers__confirm" role="group" aria-label={`Remove the time for ${scope}?`}>
                        <p>{removalConsequence(rule, data.rules, roomNames)}</p>
                        <div className="changeovers__actions">
                          <button type="button" className="changeovers__primary" disabled={saving} aria-busy={saving}
                            onClick={() => { void remove(rule); }}>
                            {saving && <ActivityIndicator size={14} />}
                            {saving ? "Removing…" : "Remove"}
                          </button>
                          <button type="button" className="changeovers__quiet" disabled={saving}
                            onClick={() => { focusNext.current = { kind: "row", ruleId: rule.id, action: "remove" }; setRemoving(null); }}>
                            Keep it
                          </button>
                        </div>
                      </div>
                    )}
                    {notice?.id === rule.id && <p className="changeovers__row-notice" role="status">{notice.text}</p>}
                  </li>
                );
              })}
            </ul>
          )}

          <form className="changeovers__add" aria-labelledby={`${formId}-title`} noValidate onSubmit={(event) => { void add(event); }}>
            <h4 id={`${formId}-title`}>Add a changeover time</h4>
            <div className="changeovers__fields">
              <label>
                <span>Room</span>
                <select value={shownDraft.spaceId} disabled={busy === "new"} data-add-room
                  onChange={(event) => { editDraft({ spaceId: event.target.value }); }}>
                  <option value="">All rooms</option>
                  {data.rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
                </select>
              </label>
              <label>
                <span>Event</span>
                <select value={shownDraft.eventType} disabled={busy === "new"}
                  onChange={(event) => { editDraft({ eventType: event.target.value }); }}>
                  <option value="">Any event</option>
                  {data.eventTypes.map((type) => <option key={type} value={type}>{eventTypeLabel(type)}</option>)}
                </select>
              </label>
              <label>
                <span>Minutes</span>
                <input type="number" inputMode="numeric" min={0} max={1440} step={5} value={shownDraft.minutes} disabled={busy === "new"}
                  onChange={(event) => { editDraft({ minutes: event.target.value }); }} />
              </label>
              <span className="changeovers__preview" aria-live="polite">
                {draftMinutes === null ? "Enter 0 to 1,440 minutes" : changeoverDuration(draftMinutes)}
              </span>
              <button type="submit" className="changeovers__primary" disabled={draftMinutes === null || draftTaken || busy !== null}
                aria-busy={busy === "new"}>
                {busy === "new" && <ActivityIndicator size={14} />}
                {busy === "new" ? "Adding…" : "Add"}
              </button>
            </div>
            {draftTaken && addNotice === null && (
              <p className="changeovers__hint">
                {roomLabel(draftSpace, roomNames)} already has a time for {eventTypeLabel(draftType).toLowerCase()}. Change it above.
              </p>
            )}
            {addNotice !== null && <p className="changeovers__hint" role="status">{addNotice}</p>}
          </form>
        </>
      )}
    </section>
  );
}
