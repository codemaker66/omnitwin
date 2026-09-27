import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactElement, type RefObject } from "react";
import { ChevronLeft, X } from "lucide-react";
import {
  ROTA_SKILLS,
  ROTA_SKILL_LABELS,
  STAFF_EMPLOYMENT_LABELS,
  STAFF_EMPLOYMENT_TYPES,
  STAFF_UNAVAILABILITY_LABELS,
  addRotaDays,
  rotaInstant,
  type RotaSkill,
  type RotaWeek,
  type StaffEmploymentType,
  type StaffRecord,
  type StaffUnavailabilityReason,
} from "@omnitwin/types";
import {
  addUnavailability, createStaffMember, recordFromRefusal, removeUnavailability, rotaRefusalWords, updateStaffMember,
} from "../../../api/rota.js";
import { ActivityIndicator, ActivityStatus } from "../../shared/Activity.js";
import { leaveSpan, personFacts, personMeta } from "./rota-format.js";
import type { PanelMessage } from "./ShiftEditor.js";

// ---------------------------------------------------------------------------
// Staff records, in a drawer beside the week. A person needs no login to be
// rostered; linking an account of the venue's team means publishing tells
// them in the app. The facts the law needs sit here: the right-to-work check,
// bar training, an under-18's eighteenth birthday and the 48-hour opt-out.
// ---------------------------------------------------------------------------

type DrawerView = { readonly kind: "list" } | { readonly kind: "person"; readonly id: string } | { readonly kind: "new" };

interface PersonDraft {
  readonly displayName: string;
  readonly email: string;
  readonly phone: string;
  readonly employmentType: StaffEmploymentType;
  readonly skills: readonly RotaSkill[];
  readonly barTrainedOn: string;
  readonly turns18On: string;
  readonly rightToWorkCheckedOn: string;
  readonly rightToWorkExpiresOn: string;
  readonly workingTimeOptOut: boolean;
  /** "" for no account. */
  readonly userId: string;
}

const EMPTY: PersonDraft = {
  displayName: "", email: "", phone: "", employmentType: "casual", skills: [], barTrainedOn: "", turns18On: "",
  rightToWorkCheckedOn: "", rightToWorkExpiresOn: "", workingTimeOptOut: false, userId: "",
};

function draftOf(record: StaffRecord): PersonDraft {
  return {
    displayName: record.displayName,
    email: record.email ?? "",
    phone: record.phone ?? "",
    employmentType: record.employmentType,
    skills: record.skills,
    barTrainedOn: record.barTrainedOn ?? "",
    turns18On: record.turns18On ?? "",
    rightToWorkCheckedOn: record.rightToWorkCheckedOn ?? "",
    rightToWorkExpiresOn: record.rightToWorkExpiresOn ?? "",
    workingTimeOptOut: record.workingTimeOptOut,
    userId: record.userId ?? "",
  };
}

const orNull = (value: string): string | null => value.trim() === "" ? null : value.trim();

/** What the form would save, or why it cannot yet. */
function problemWith(draft: PersonDraft): string | null {
  if (draft.displayName.trim() === "") return "Give their name.";
  if (draft.email.trim() !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(draft.email.trim())) return "Check the email address.";
  if (draft.rightToWorkExpiresOn !== "" && draft.rightToWorkCheckedOn === "") return "Record the right-to-work check before its expiry.";
  if (draft.rightToWorkExpiresOn !== "" && draft.rightToWorkExpiresOn < draft.rightToWorkCheckedOn) return "The expiry comes after the check.";
  return null;
}

function Notice({ message, noticeRef }: {
  readonly message: PanelMessage | null;
  readonly noticeRef?: RefObject<HTMLParagraphElement>;
}): ReactElement | null {
  if (message === null) return null;
  return (
    <p className="rota-notice" data-tone={message.tone} role={message.tone === "alert" ? "alert" : "status"} ref={noticeRef} tabIndex={-1}>
      {message.text}
    </p>
  );
}

function PersonForm({ venueId, week, record, message, onSaved, onBack }: {
  readonly venueId: string;
  readonly week: RotaWeek;
  readonly record: StaffRecord | null;
  /** What the last save said; shown beside the buttons that made it. */
  readonly message: PanelMessage | null;
  readonly onSaved: (record: StaffRecord, message: PanelMessage) => void;
  readonly onBack: () => void;
}): ReactElement {
  const formId = useId();
  const [draft, setDraft] = useState<PersonDraft>(() => record === null ? EMPTY : draftOf(record));
  const [busy, setBusy] = useState<"save" | "active" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const problem = problemWith(draft);

  // Each saved revision mounts the form afresh, so focus starts at what the
  // save said, or at the person's name when the form is first opened. "Take
  // off the rota" asks in the button's place, and focus goes back to the
  // button when the question is put away.
  const titleRef = useRef<HTMLHeadingElement>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const questionRef = useRef<HTMLParagraphElement>(null);
  const takeOffRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  useEffect(() => { (noticeRef.current ?? titleRef.current)?.focus(); }, []);
  useEffect(() => {
    if (confirmingRemoval) questionRef.current?.focus();
    else if (wasConfirming.current) takeOffRef.current?.focus();
    wasConfirming.current = confirmingRemoval;
  }, [confirmingRemoval]);
  const dirty = record === null || JSON.stringify(draft) !== JSON.stringify(draftOf(record));
  const takenAccounts = new Set(week.records.filter((other) => other.id !== record?.id && other.userId !== null).map((other) => other.userId));
  const accounts = week.accounts.filter((account) => !takenAccounts.has(account.id));

  const update = (change: Partial<PersonDraft>): void => {
    setError(null);
    setDraft((current) => ({ ...current, ...change }));
  };

  const fields = () => ({
    displayName: draft.displayName.trim(),
    email: orNull(draft.email),
    phone: orNull(draft.phone),
    employmentType: draft.employmentType,
    skills: [...draft.skills],
    barTrainedOn: orNull(draft.barTrainedOn),
    turns18On: orNull(draft.turns18On),
    rightToWorkCheckedOn: orNull(draft.rightToWorkCheckedOn),
    rightToWorkExpiresOn: orNull(draft.rightToWorkExpiresOn),
    workingTimeOptOut: draft.workingTimeOptOut,
    userId: orNull(draft.userId),
  });

  const refused = (caught: unknown, fallback: string): void => {
    const current = recordFromRefusal(caught);
    if (current !== null) {
      onSaved(current, { tone: "alert", text: "Someone changed this record a moment ago. Here is how it stands now." });
      return;
    }
    setError(rotaRefusalWords(caught, fallback));
  };

  const save = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (problem !== null || !dirty || busy !== null) return;
    setBusy("save");
    setError(null);
    try {
      const saved = record === null
        ? await createStaffMember(venueId, fields())
        : await updateStaffMember(venueId, record.id, { ...fields(), expectedRevision: record.revision });
      onSaved(saved, { tone: "settled", text: record === null ? `Added ${saved.displayName} to the rota.` : "Saved." });
    } catch (caught) {
      refused(caught, "The record could not be saved. Nothing has changed; try again.");
    } finally {
      setBusy(null);
    }
  };

  const setActive = async (isActive: boolean): Promise<void> => {
    if (record === null) return;
    setBusy("active");
    setError(null);
    try {
      const saved = await updateStaffMember(venueId, record.id, { isActive, expectedRevision: record.revision });
      setConfirmingRemoval(false);
      onSaved(saved, { tone: "settled", text: isActive ? `${saved.displayName} is back on the rota.` : `${saved.displayName} is off the rota. Their shifts stay as they were.` });
    } catch (caught) {
      refused(caught, "That could not be saved. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const toggleSkill = (skill: RotaSkill, on: boolean): void => {
    update({ skills: ROTA_SKILLS.filter((candidate) => candidate === skill ? on : draft.skills.includes(candidate)) });
  };

  return (
    <form className="rota-form" noValidate aria-labelledby={`${formId}-title`} onSubmit={(event) => { void save(event); }}>
      <button type="button" className="rota-link rota-back" onClick={onBack}>
        <ChevronLeft aria-hidden="true" size={16} /> All staff
      </button>
      <h3 id={`${formId}-title`} className="rota-form__title" ref={titleRef} tabIndex={-1}>{record === null ? "Add a person" : record.displayName}</h3>
      {error !== null && <p className="rota-notice" data-tone="alert" role="alert">{error}</p>}
      <div className="rota-form__grid">
        <label className="rota-field rota-field--wide">
          <span>Name</span>
          <input type="text" maxLength={120} value={draft.displayName} disabled={busy !== null} required autoComplete="off"
            onChange={(event) => { update({ displayName: event.target.value }); }} />
        </label>
        <fieldset className="rota-choice rota-field--wide">
          <legend>Employed as</legend>
          <div className="rota-choice__options">
            {STAFF_EMPLOYMENT_TYPES.map((type) => (
              <label key={type} className="rota-choice__option">
                <input type="radio" name={`${formId}-employment`} value={type} checked={draft.employmentType === type} disabled={busy !== null}
                  onChange={() => { update({ employmentType: type }); }} />
                <span>{STAFF_EMPLOYMENT_LABELS[type]}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="rota-choice rota-field--wide">
          <legend>Skills</legend>
          <div className="rota-choice__options">
            {ROTA_SKILLS.map((skill) => (
              <label key={skill} className="rota-choice__option">
                <input type="checkbox" checked={draft.skills.includes(skill)} disabled={busy !== null}
                  onChange={(event) => { toggleSkill(skill, event.target.checked); }} />
                <span>{ROTA_SKILL_LABELS[skill]}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="rota-field">
          <span>Email</span>
          <input type="email" maxLength={255} value={draft.email} disabled={busy !== null} autoComplete="off"
            onChange={(event) => { update({ email: event.target.value }); }} />
        </label>
        <label className="rota-field">
          <span>Phone</span>
          <input type="tel" maxLength={40} value={draft.phone} disabled={busy !== null} autoComplete="off"
            onChange={(event) => { update({ phone: event.target.value }); }} />
        </label>
        <label className="rota-field rota-field--wide">
          <span>Their account</span>
          <select value={draft.userId} disabled={busy !== null} aria-describedby={`${formId}-account`}
            onChange={(event) => { update({ userId: event.target.value }); }}>
            <option value="">No account</option>
            {accounts.map((account) => <option key={account.id} value={account.id}>{account.name} ({account.email})</option>)}
          </select>
        </label>
        <p className="rota-field__hint rota-field--wide" id={`${formId}-account`}>
          {draft.userId === "" ? "Without an account they are told of their shifts in person." : "Publishing tells them in the app, and they always see their own shifts."}
        </p>
        <label className="rota-field">
          <span>Right to work checked on</span>
          <input type="date" value={draft.rightToWorkCheckedOn} disabled={busy !== null}
            onChange={(event) => { update({ rightToWorkCheckedOn: event.target.value }); }} />
        </label>
        <label className="rota-field">
          <span>Check runs out on</span>
          <input type="date" value={draft.rightToWorkExpiresOn} disabled={busy !== null} aria-describedby={`${formId}-expiry`}
            onChange={(event) => { update({ rightToWorkExpiresOn: event.target.value }); }} />
        </label>
        <p className="rota-field__hint rota-field--wide" id={`${formId}-expiry`}>
          A first shift cannot be published until the check is recorded. Leave the end blank for a permanent right to work.
        </p>
        <label className="rota-field">
          <span>Bar training done on</span>
          <input type="date" value={draft.barTrainedOn} disabled={busy !== null}
            onChange={(event) => { update({ barTrainedOn: event.target.value }); }} />
        </label>
        <label className="rota-field">
          <span>Turns 18 on</span>
          <input type="date" value={draft.turns18On} disabled={busy !== null} aria-describedby={`${formId}-young`}
            onChange={(event) => { update({ turns18On: event.target.value }); }} />
        </label>
        <p className="rota-field__hint rota-field--wide" id={`${formId}-young`}>Only for someone under 18: the rota then keeps to the rules for young workers.</p>
        <label className="rota-check rota-field--wide">
          <input type="checkbox" checked={draft.workingTimeOptOut} disabled={busy !== null}
            onChange={(event) => { update({ workingTimeOptOut: event.target.checked }); }} />
          <span>Has opted out of the 48-hour week, in writing</span>
        </label>
      </div>
      <div className="rota-actions">
        <button type="submit" className="rota-button rota-button--primary" disabled={problem !== null || !dirty || busy !== null} aria-busy={busy === "save"}>
          {busy === "save" && <ActivityIndicator size={16} />}
          {busy === "save" ? "Saving…" : record === null ? "Add to the rota" : "Save"}
        </button>
        {record !== null && record.isActive && !confirmingRemoval && (
          <button type="button" className="rota-button" ref={takeOffRef} disabled={busy !== null} onClick={() => { setConfirmingRemoval(true); }}>Take off the rota…</button>
        )}
        {record !== null && !record.isActive && (
          <button type="button" className="rota-button" disabled={busy !== null} aria-busy={busy === "active"} onClick={() => { void setActive(true); }}>
            {busy === "active" && <ActivityIndicator size={16} />}
            {busy === "active" ? "Saving…" : "Put back on the rota"}
          </button>
        )}
      </div>
      {/* "Saved." stops being true once the form is changed again. */}
      <Notice message={error === null && !dirty ? message : null} noticeRef={noticeRef} />
      {problem !== null && draft !== EMPTY && <p className="rota-field__hint">{problem}</p>}
      {confirmingRemoval && record !== null && (
        <div className="rota-confirm" role="group" aria-labelledby={`${formId}-off`}>
          <p className="rota-confirm__question" id={`${formId}-off`} ref={questionRef} tabIndex={-1}>Take {record.displayName} off the rota?</p>
          <p className="rota-confirm__consequence">Their shifts stay as they were. Their record is kept, and they can be put back.</p>
          <div className="rota-actions">
            <button type="button" className="rota-button rota-button--primary" disabled={busy !== null} aria-busy={busy === "active"}
              onClick={() => { void setActive(false); }}>
              {busy === "active" && <ActivityIndicator size={16} />}
              {busy === "active" ? "Saving…" : "Take off the rota"}
            </button>
            <button type="button" className="rota-button" disabled={busy !== null} onClick={() => { setConfirmingRemoval(false); }}>Keep them on</button>
          </div>
        </div>
      )}
    </form>
  );
}

function LeaveSection({ venueId, week, record, message, onChanged }: {
  readonly venueId: string;
  readonly week: RotaWeek;
  readonly record: StaffRecord;
  readonly message: PanelMessage | null;
  readonly onChanged: (message: PanelMessage) => void;
}): ReactElement {
  const formId = useId();
  const [from, setFrom] = useState(week.weekStart);
  const [to, setTo] = useState(week.weekStart);
  const [reason, setReason] = useState<StaffUnavailabilityReason>("leave");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const entries = week.unavailability.filter((entry) => entry.staffMemberId === record.id);
  const valid = /^\d{4}-\d{2}-\d{2}$/u.test(from) && /^\d{4}-\d{2}-\d{2}$/u.test(to) && to >= from;

  const add = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!valid || busy !== null) return;
    setBusy("add");
    setError(null);
    try {
      await addUnavailability(venueId, {
        staffMemberId: record.id,
        startsAt: new Date(rotaInstant(from, 0, week.timeZone)).toISOString(),
        endsAt: new Date(rotaInstant(addRotaDays(to, 1), 0, week.timeZone)).toISOString(),
        reason,
        note: note.trim() === "" ? null : note.trim(),
      });
      setNote("");
      onChanged({ tone: "settled", text: `${STAFF_UNAVAILABILITY_LABELS[reason]} recorded for ${record.displayName}. Shifts on those days now say so.` });
    } catch (caught) {
      setError(rotaRefusalWords(caught, "That could not be recorded. Try again."));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string): Promise<void> => {
    setBusy(id);
    setError(null);
    try {
      await removeUnavailability(venueId, id);
      onChanged({ tone: "settled", text: "Removed." });
    } catch (caught) {
      setError(rotaRefusalWords(caught, "That could not be removed. Try again."));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rota-leave" aria-labelledby={`${formId}-title`}>
      <h3 id={`${formId}-title`}>Leave and unavailability</h3>
      {error !== null && <p className="rota-notice" data-tone="alert" role="alert">{error}</p>}
      {entries.length === 0
        ? <p className="rota-field__hint">Nothing recorded for this week.</p>
        : (
          <ul className="rota-leave__list">
            {entries.map((entry) => (
              <li key={entry.id}>
                <span>{STAFF_UNAVAILABILITY_LABELS[entry.reason]} · {leaveSpan(entry, week.timeZone)}{entry.note === null ? "" : ` · ${entry.note}`}</span>
                <button type="button" className="rota-link" disabled={busy !== null} aria-busy={busy === entry.id}
                  aria-label={`Remove ${STAFF_UNAVAILABILITY_LABELS[entry.reason].toLowerCase()}, ${leaveSpan(entry, week.timeZone)}`}
                  onClick={() => { void remove(entry.id); }}>
                  {busy === entry.id && <ActivityIndicator size={14} />}
                  {busy === entry.id ? "Removing…" : "Remove"}
                </button>
              </li>
            ))}
          </ul>
        )}
      <form className="rota-form__grid" noValidate onSubmit={(event) => { void add(event); }}>
        <label className="rota-field">
          <span>From</span>
          <input type="date" value={from} disabled={busy !== null} onChange={(event) => { setFrom(event.target.value); if (event.target.value > to) setTo(event.target.value); }} />
        </label>
        <label className="rota-field">
          <span>To, and including</span>
          <input type="date" value={to} min={from} disabled={busy !== null} onChange={(event) => { setTo(event.target.value); }} />
        </label>
        <fieldset className="rota-choice rota-field--wide">
          <legend>Reason</legend>
          <div className="rota-choice__options">
            {(["leave", "unavailable"] as const).map((value) => (
              <label key={value} className="rota-choice__option">
                <input type="radio" name={`${formId}-reason`} value={value} checked={reason === value} disabled={busy !== null}
                  onChange={() => { setReason(value); }} />
                <span>{STAFF_UNAVAILABILITY_LABELS[value]}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="rota-field rota-field--wide">
          <span>Note</span>
          <input type="text" maxLength={300} value={note} disabled={busy !== null} onChange={(event) => { setNote(event.target.value); }} />
        </label>
        <div className="rota-actions rota-field--wide">
          <button type="submit" className="rota-button" disabled={!valid || busy !== null} aria-busy={busy === "add"}>
            {busy === "add" && <ActivityIndicator size={16} />}
            {busy === "add" ? "Recording…" : "Record"}
          </button>
        </div>
      </form>
      <Notice message={error === null ? message : null} />
    </section>
  );
}

export function StaffDrawer({ venueId, week, today, openPersonId, onChanged, onClose }: {
  readonly venueId: string;
  readonly week: RotaWeek;
  /** The venue's date today, for what has run out and who is under 18. */
  readonly today: string;
  /** Open straight at one person's record; "new" for the add form. */
  readonly openPersonId: string | null;
  /** Something changed: the saved record when there is one, then read the week again. */
  readonly onChanged: (saved: StaffRecord | null) => void;
  readonly onClose: () => void;
}): ReactElement {
  const titleId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [view, setView] = useState<DrawerView>(() => openPersonId === "new" ? { kind: "new" }
    : openPersonId === null ? { kind: "list" } : { kind: "person", id: openPersonId });
  const [said, setSaid] = useState<{ readonly place: "person" | "leave"; readonly message: PanelMessage } | null>(null);
  const listButtons = useRef(new Map<string, HTMLButtonElement>());
  const leftPerson = useRef<string | null>(null);
  const record = view.kind === "person" ? week.records.find((candidate) => candidate.id === view.id) ?? null : null;
  const active = week.records.filter((candidate) => candidate.isActive);
  const inactive = week.records.filter((candidate) => !candidate.isActive);

  // Opened at the list, focus starts at the drawer's heading; opened at a
  // record, the record's form takes it.
  useEffect(() => { if (openPersonId === null) headingRef.current?.focus(); }, []);

  const show = (next: DrawerView): void => {
    setSaid(null);
    leftPerson.current = view.kind === "person" ? view.id : null;
    setView(next);
  };

  // Back at the list, focus returns to the person just left, or to the heading.
  useEffect(() => {
    if (view.kind !== "list" || leftPerson.current === null) return;
    (listButtons.current.get(leftPerson.current) ?? headingRef.current)?.focus();
    leftPerson.current = null;
  }, [view]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    onClose();
  };

  const item = (candidate: StaffRecord): ReactElement => {
    const facts = personFacts(candidate, today);
    return (
      <li key={candidate.id}>
        <button type="button" className="rota-staff__item"
          ref={(element) => { if (element === null) listButtons.current.delete(candidate.id); else listButtons.current.set(candidate.id, element); }}
          onClick={() => { show({ kind: "person", id: candidate.id }); }}>
          <span className="rota-staff__name">{candidate.displayName}</span>
          <span className="rota-staff__meta">{personMeta(candidate)}</span>
          {facts.map((fact) => (
            <span key={fact.text} className="rota-staff__fact" data-tone={fact.attention ? "attention" : undefined}>{fact.text}</span>
          ))}
        </button>
      </li>
    );
  };

  return (
    <section className="rota-panel" aria-labelledby={titleId} onKeyDown={onKeyDown}>
      <header className="rota-panel__head">
        <div>
          <h2 id={titleId} ref={headingRef} tabIndex={-1}>Staff</h2>
          <p className="rota-panel__sub">The people you roster. They need no login.</p>
        </div>
        <button type="button" className="rota-icon-button" aria-label="Close staff" onClick={onClose}><X aria-hidden="true" size={18} /></button>
      </header>

      {view.kind === "list" && (
        <>
          <div className="rota-actions">
            <button type="button" className="rota-button rota-button--primary" onClick={() => { show({ kind: "new" }); }}>Add a person</button>
          </div>
          {week.records.length === 0 && <p className="rota-field__hint">Nobody is on the rota yet. Add the people you roster, with or without an account.</p>}
          <ul className="rota-staff">{active.map(item)}</ul>
          {inactive.length > 0 && (
            <>
              <h3 className="rota-staff__group">No longer on the rota</h3>
              <ul className="rota-staff">{inactive.map(item)}</ul>
            </>
          )}
        </>
      )}

      {view.kind === "new" && (
        <PersonForm venueId={venueId} week={week} record={null} message={null} onBack={() => { show({ kind: "list" }); }}
          onSaved={(saved, next) => { onChanged(saved); setView({ kind: "person", id: saved.id }); setSaid({ place: "person", message: next }); }} />
      )}

      {view.kind === "person" && record === null && (
        <ActivityStatus>Loading the record…</ActivityStatus>
      )}

      {view.kind === "person" && record !== null && (
        <>
          <PersonForm key={`${record.id}:${String(record.revision)}`} venueId={venueId} week={week} record={record}
            message={said?.place === "person" ? said.message : null}
            onBack={() => { show({ kind: "list" }); }}
            onSaved={(saved, next) => { onChanged(saved); setSaid({ place: "person", message: next }); }} />
          <LeaveSection venueId={venueId} week={week} record={record} message={said?.place === "leave" ? said.message : null}
            onChanged={(next) => { onChanged(null); setSaid({ place: "leave", message: next }); }} />
        </>
      )}
    </section>
  );
}
