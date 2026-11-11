import { useEffect, useId, useRef, useState, type FormEvent, type ReactElement } from "react";
import type { CreateSupplierArrival, SupplierArrival, SupplierArrivalStep } from "@omnitwin/types";
import { ActivityIndicator, ActivityStatus } from "../../components/shared/Activity.js";
import { formatInlineDay, formatWallTime, msToWallInput, wallInputToMs } from "../diary/lib/board-time.js";
import type { DayBoardSlot } from "./lib/day-board-state.js";
import { ARRIVAL_LATE_AFTER_MS, isLateAtDoor } from "./lib/supplier-notices.js";
import { boardDayOf, supplierTimes, type SupplierTimes } from "./lib/supplier-times.js";
import { newArrivalKey, type SupplierArrivalsApi } from "./lib/use-supplier-arrivals.js";

// ---------------------------------------------------------------------------
// Who comes to the building for this booking (T-692): each supplier with
// when they are due, the door they come in by, who to ring and the office's
// note. The floor marks each one arrived and gone on today's board, and can
// undo a mistaken tap; the office adds, changes and removes them. Times are
// typed for the board's day: one before the boundary hour is that night. A
// change goes from the copy the form was opened on, so a colleague's newer
// change is refused rather than overwritten. Each refusal says so in words,
// beside the supplier it is about, and the keyboard's place is kept.
// ---------------------------------------------------------------------------

type ArrivalsActions = Pick<SupplierArrivalsApi,
  "status" | "reading" | "busy" | "failures" | "step" | "undo" | "add" | "change" | "remove" | "refresh">;

interface Draft {
  readonly supplierName: string;
  readonly category: string;
  readonly arrives: string;
  readonly leaves: string;
  readonly entrance: string;
  readonly contact: string;
  readonly note: string;
}

const EMPTY_DRAFT: Draft = { supplierName: "", category: "", arrives: "", leaves: "", entrance: "", contact: "", note: "" };

/** Where the keyboard goes back to after the add form closes. */
const ADD_TARGET = "add";

function draftOf(arrival: SupplierArrival, timeZone: string): Draft {
  const clock = (iso: string | null): string => (iso === null ? "" : msToWallInput(Date.parse(iso), timeZone).slice(11, 16));
  return {
    supplierName: arrival.supplierName,
    category: arrival.category ?? "",
    arrives: clock(arrival.arrivesAt),
    leaves: clock(arrival.leavesBy),
    entrance: arrival.entrance ?? "",
    contact: arrival.contact ?? "",
    note: arrival.note ?? "",
  };
}

function blank(value: string): string | null {
  return value.trim().length === 0 ? null : value.trim();
}

/** "Due Sun 15 Nov at 00:30, leaving by 02:00.": the form says back what it will save. */
function dueWords(times: SupplierTimes, timeZone: string, nowMs: number): string {
  const day = (ms: number): string => formatInlineDay(ms, nowMs, timeZone);
  const clock = (ms: number): string => formatWallTime(ms, timeZone);
  const arrives = `Due ${day(times.arrivesMs)} at ${clock(times.arrivesMs)}`;
  if (times.leavesMs === null) return `${arrives}.`;
  const sameDate = msToWallInput(times.leavesMs, timeZone).slice(0, 10) === msToWallInput(times.arrivesMs, timeZone).slice(0, 10);
  return `${arrives}, leaving by ${sameDate ? "" : `${day(times.leavesMs)} at `}${clock(times.leavesMs)}.`;
}

function SupplierForm({ title, initial, boardDay, dayBoundaryHour, timeZone, nowMs, busy, submitLabel, onSubmit, onCancel }: {
  readonly title: string;
  readonly initial: Draft;
  /** The board's day the times are typed for, YYYY-MM-DD on the venue's clock. */
  readonly boardDay: string;
  readonly dayBoundaryHour: number;
  readonly timeZone: string;
  readonly nowMs: number;
  readonly busy: boolean;
  readonly submitLabel: string;
  readonly onSubmit: (fields: Omit<CreateSupplierArrival, "bookingId">) => void;
  readonly onCancel: () => void;
}): ReactElement {
  const [draft, setDraft] = useState<Draft>(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const id = useId();
  // Opening the form takes the keyboard to its first field.
  const firstRef = useRef<HTMLInputElement>(null);
  useEffect(() => { firstRef.current?.focus(); }, []);
  const field = (name: keyof Draft) => ({
    id: `${id}-${name}`,
    value: draft[name],
    onChange: (event: { readonly target: { readonly value: string } }) => { setDraft((current) => ({ ...current, [name]: event.target.value })); },
  });
  const times = supplierTimes(draft.arrives, draft.leaves, boardDay, dayBoundaryHour, timeZone);
  const when = times === null
    ? `For ${formatInlineDay(wallInputToMs(`${boardDay}T12:00`, timeZone) ?? nowMs, nowMs, timeZone)}.`
    : dueWords(times, timeZone, nowMs);
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (busy) return;
    if (blank(draft.supplierName) === null || times === null) {
      setProblem("Name the supplier and when they arrive.");
      return;
    }
    if (times.skipped !== null) {
      // The night the clocks go forward has no 01:30: say what would be kept.
      const { field: which, typed, stored } = times.skipped;
      setDraft((current) => ({ ...current, [which]: stored }));
      setProblem(`The clocks go forward that night, so there is no ${typed}. It reads ${stored} now; save again to keep it.`);
      return;
    }
    setProblem(null);
    onSubmit({
      supplierName: draft.supplierName.trim(),
      category: blank(draft.category),
      arrivesAt: new Date(times.arrivesMs).toISOString(),
      leavesBy: times.leavesMs === null ? null : new Date(times.leavesMs).toISOString(),
      entrance: blank(draft.entrance),
      contact: blank(draft.contact),
      note: blank(draft.note),
    });
  };
  return (
    <form className="dayboard-supplier-form" aria-label={title} onSubmit={submit}>
      <div className="dayboard-supplier-fields">
        <label htmlFor={`${id}-supplierName`}>Supplier<input {...field("supplierName")} ref={firstRef} required maxLength={160} autoComplete="off" /></label>
        <label htmlFor={`${id}-category`}>What they do<input {...field("category")} maxLength={40} placeholder="florist, band" autoComplete="off" /></label>
        <label htmlFor={`${id}-arrives`}>Arrives<input {...field("arrives")} type="time" required aria-describedby={`${id}-when`} /></label>
        <label htmlFor={`${id}-leaves`}>Leaves by<input {...field("leaves")} type="time" aria-describedby={`${id}-when`} /></label>
        <p id={`${id}-when`} className="dayboard-supplier-form-when">{when}</p>
        <label htmlFor={`${id}-entrance`} className="is-wide">Door<input {...field("entrance")} maxLength={100} placeholder="the Saloon’s side door" autoComplete="off" /></label>
        <label htmlFor={`${id}-contact`} className="is-wide">Contact on the day<input {...field("contact")} maxLength={160} autoComplete="off" /></label>
        <label htmlFor={`${id}-note`} className="is-wide">Note<textarea {...field("note")} maxLength={500} rows={2} /></label>
      </div>
      {problem !== null && <p className="dayboard-supplier-problem" role="status">{problem}</p>}
      <div className="dayboard-supplier-form-actions">
        <button type="submit" className="dayboard-seen-button" aria-busy={busy} aria-disabled={busy}>
          {busy && <ActivityIndicator size={14} />}
          {submitLabel}
        </button>
        <button type="button" className="dayboard-text-button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/** Where a supplier stands at the door, in the floor's words; late only on today's board. */
function doorWords(
  arrival: SupplierArrival,
  { nowMs, today, dayBoundaryHour, timeZone }: { readonly nowMs: number; readonly today: boolean; readonly dayBoundaryHour: number; readonly timeZone: string },
): { readonly words: string; readonly late: boolean } | null {
  const dueDay = boardDayOf(Date.parse(arrival.arrivesAt), dayBoundaryHour, timeZone);
  // A tap on another board's day than the one they were due says which.
  const at = (iso: string): string => {
    const ms = Date.parse(iso);
    const elsewhere = boardDayOf(ms, dayBoundaryHour, timeZone) !== dueDay;
    return `${formatWallTime(ms, timeZone)}${elsewhere ? ` on ${formatInlineDay(ms, nowMs, timeZone)}` : ""}`;
  };
  const by = (name: string | null): string => (name === null ? "" : ` · ${name}`);
  if (arrival.leftAt !== null) {
    return { words: `In at ${at(arrival.arrivedAt ?? arrival.leftAt)}, gone at ${at(arrival.leftAt)}${by(arrival.leftByName)}`, late: false };
  }
  if (arrival.arrivedAt !== null) return { words: `In at ${at(arrival.arrivedAt)}${by(arrival.arrivedByName)}`, late: false };
  if (today && isLateAtDoor(arrival, nowMs)) return { words: "Not marked in yet", late: true };
  if (Date.parse(arrival.arrivesAt) <= nowMs - ARRIVAL_LATE_AFTER_MS) return { words: "Not marked in", late: false };
  return null;
}

/** What a screen reader hears once a tap is made. */
function tapSaid(name: string, act: "step" | "undo", which: SupplierArrivalStep): string {
  const mark = which === "arrived" ? "in" : "gone";
  return act === "step" ? `${name} marked ${mark}.` : `${name} no longer marked ${mark}.`;
}

type Editing = { readonly kind: "add" } | { readonly kind: "change"; readonly id: string; readonly revision: number } | null;

export function SuppliersSection({ slot, arrivals, boardDate, dayBoundaryHour, timeZone, nowMs, today, canPlan, canMark, actions }: {
  readonly slot: DayBoardSlot;
  readonly arrivals: readonly SupplierArrival[];
  /** The board's day, YYYY-MM-DD on the venue's clock: new times are typed for it. */
  readonly boardDate: string;
  /** The hour the board's day runs to on the next date (04:00 at Trades Hall; 0 is midnight). */
  readonly dayBoundaryHour: number;
  readonly timeZone: string;
  readonly nowMs: number;
  /** The board shows today: a supplier nobody has marked in is late in copper only then. */
  readonly today: boolean;
  /** The office: adds, changes and removes. */
  readonly canPlan: boolean;
  /** The floor, on today's board: marks the door and undoes a mistaken tap. Never the wall. */
  readonly canMark: boolean;
  readonly actions: ArrivalsActions;
}): ReactElement | null {
  const [editing, setEditing] = useState<Editing>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  // The control each arrival's tap went from, so its own button shows the work.
  const [working, setWorking] = useState<ReadonlyMap<string, string>>(new Map());
  const [said, setSaid] = useState("");
  const [retried, setRetried] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  // A tapped button leaves with its step; if that dropped the keyboard's place
  // to the document, it goes to the supplier's next control (or, after the add
  // form or a removal, to "Add a supplier"). A place moved elsewhere stays.
  const focusTarget = useRef<string | null>(null);
  const [focusAsked, setFocusAsked] = useState(0);
  useEffect(() => {
    const target = focusTarget.current;
    const section = sectionRef.current;
    if (target === null || section === null) return;
    focusTarget.current = null;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    const marked = (attribute: string): HTMLElement | undefined =>
      [...section.querySelectorAll<HTMLElement>(`[${attribute}]`)].find((element) => element.getAttribute(attribute) === target);
    const item = marked("data-arrival");
    const next = marked("data-focus") ?? item?.querySelector<HTMLButtonElement>(".dayboard-supplier-actions button") ?? item;
    (next ?? section.querySelector<HTMLElement>(`[data-focus="${ADD_TARGET}"]`) ?? section).focus();
  }, [focusAsked]);
  const keepFocus = (target: string): void => { focusTarget.current = target; setFocusAsked((count) => count + 1); };
  const begin = (id: string, what: string): void => { setWorking((current) => new Map(current).set(id, what)); };
  const end = (id: string): void => { setWorking((current) => { const next = new Map(current); next.delete(id); return next; }); };

  const addKey = newArrivalKey(slot.bookingId);
  if (arrivals.length === 0 && !canPlan && actions.status !== "failed") return null;
  const time = (iso: string): string => formatWallTime(Date.parse(iso), timeZone);
  const shows = (id: string, what: string): boolean => actions.busy.has(id) && working.get(id) === what;

  // One tap at a time per supplier, from this panel's own record as well as
  // the hook's, so a double tap sends once.
  const inFlight = (id: string): boolean => actions.busy.has(id) || working.has(id);
  const tap = (arrival: SupplierArrival, act: "step" | "undo", which: SupplierArrivalStep): void => {
    if (inFlight(arrival.id)) return;
    begin(arrival.id, act === "step" ? which : `undo-${which}`);
    void (act === "step" ? actions.step : actions.undo)(arrival, which).then((outcome) => {
      end(arrival.id);
      if (outcome === "saved") setSaid(tapSaid(arrival.supplierName, act, which));
      keepFocus(arrival.id);
    });
  };

  return (
    <section ref={sectionRef} className="dayboard-suppliers dayboard-detail-section" aria-label="Suppliers" tabIndex={-1}>
      <h3 className="dayboard-detail-heading">Suppliers</h3>
      {actions.status === "loading" && arrivals.length === 0 && <ActivityStatus>Reading the suppliers…</ActivityStatus>}
      {actions.status === "failed" && (
        <div className="dayboard-changeover-failed">
          <p className="dayboard-changeover-note">
            {arrivals.length === 0 ? "The suppliers could not be read just now." : "The suppliers could not be read just now; these are as last read."}
          </p>
          <button type="button" className="dayboard-seen-button" aria-busy={retried && actions.reading}
            onClick={() => { setRetried(true); actions.refresh(); }}>
            {retried && actions.reading && <ActivityIndicator size={14} />}Try again
          </button>
        </div>
      )}
      {actions.status === "ready" && arrivals.length === 0 && editing?.kind !== "add" && (
        <p className="dayboard-changeover-note">No suppliers are down for this booking.</p>
      )}
      {arrivals.length > 0 && (
        <ul className="dayboard-supplier-list">
          {arrivals.map((arrival) => {
            const busy = inFlight(arrival.id);
            const door = doorWords(arrival, { nowMs, today, dayBoundaryHour, timeZone });
            const opened = editing?.kind === "change" && editing.id === arrival.id ? editing : null;
            return (
              <li key={arrival.id} className={opened === null ? "dayboard-supplier" : undefined} data-arrival={arrival.id} tabIndex={-1}>
                {opened !== null ? (
                  <SupplierForm
                    title={`Change ${arrival.supplierName}`}
                    initial={draftOf(arrival, timeZone)}
                    boardDay={boardDayOf(Date.parse(arrival.arrivesAt), dayBoundaryHour, timeZone)}
                    dayBoundaryHour={dayBoundaryHour}
                    timeZone={timeZone}
                    nowMs={nowMs}
                    busy={busy}
                    submitLabel="Save"
                    onSubmit={(fields) => {
                      // From the copy the form opened on: a colleague's change since is refused.
                      void actions.change(arrival, opened.revision, fields).then((outcome) => {
                        if (outcome === "failed") return;
                        setEditing(null);
                        if (outcome === "saved") setSaid(`${fields.supplierName} saved.`);
                        keepFocus(arrival.id);
                      });
                    }}
                    onCancel={() => { setEditing(null); keepFocus(arrival.id); }}
                  />
                ) : (
                  <>
                    <p className="dayboard-supplier-name">
                      <strong>{arrival.supplierName}</strong>
                      {arrival.category !== null && <span className="dayboard-supplier-kind"> · {arrival.category}</span>}
                    </p>
                    <p className="dayboard-supplier-when">
                      {arrival.leavesBy === null ? `From ${time(arrival.arrivesAt)}` : `${time(arrival.arrivesAt)}–${time(arrival.leavesBy)}`}
                      {arrival.entrance !== null && ` · ${arrival.entrance}`}
                    </p>
                    {(arrival.contact !== null || arrival.note !== null) && (
                      <p className="dayboard-supplier-note">{[arrival.contact, arrival.note].filter((part) => part !== null).join(" · ")}</p>
                    )}
                    {door !== null && <p className={`dayboard-supplier-door${door.late ? " is-late" : ""}`}>{door.words}</p>}
                    {(canMark || canPlan) && (
                      <div className="dayboard-supplier-actions">
                        {canMark && arrival.arrivedAt === null && (
                          <button type="button" className="dayboard-seen-button" aria-busy={shows(arrival.id, "arrived")} aria-disabled={busy}
                            aria-label={`${arrival.supplierName} arrived`}
                            onClick={() => { tap(arrival, "step", "arrived"); }}>
                            {shows(arrival.id, "arrived") && <ActivityIndicator size={14} />}Arrived
                          </button>
                        )}
                        {canMark && arrival.arrivedAt !== null && arrival.leftAt === null && (
                          <>
                            <button type="button" className="dayboard-seen-button" aria-busy={shows(arrival.id, "left")} aria-disabled={busy}
                              aria-label={`${arrival.supplierName} gone`}
                              onClick={() => { tap(arrival, "step", "left"); }}>
                              {shows(arrival.id, "left") && <ActivityIndicator size={14} />}Gone
                            </button>
                            <button type="button" className="dayboard-text-button" aria-busy={shows(arrival.id, "undo-arrived")} aria-disabled={busy}
                              aria-label={`Undo: ${arrival.supplierName} marked in`}
                              onClick={() => { tap(arrival, "undo", "arrived"); }}>
                              {shows(arrival.id, "undo-arrived") && <ActivityIndicator size={14} />}Undo
                            </button>
                          </>
                        )}
                        {canMark && arrival.leftAt !== null && (
                          <button type="button" className="dayboard-text-button" aria-busy={shows(arrival.id, "undo-left")} aria-disabled={busy}
                            aria-label={`Undo: ${arrival.supplierName} marked gone`}
                            onClick={() => { tap(arrival, "undo", "left"); }}>
                            {shows(arrival.id, "undo-left") && <ActivityIndicator size={14} />}Undo
                          </button>
                        )}
                        {canPlan && removing !== arrival.id && (
                          <>
                            <button type="button" className="dayboard-text-button" aria-label={`Change ${arrival.supplierName}`}
                              onClick={() => { setEditing({ kind: "change", id: arrival.id, revision: arrival.revision }); }}>Change</button>
                            <button type="button" className="dayboard-text-button" aria-label={`Remove ${arrival.supplierName}`}
                              onClick={() => { setRemoving(arrival.id); keepFocus(`keep:${arrival.id}`); }}>Remove</button>
                          </>
                        )}
                        {canPlan && removing === arrival.id && (
                          <span className="dayboard-supplier-confirm" role="group" aria-label={`Remove ${arrival.supplierName}?`}>
                            Remove {arrival.supplierName}?
                            <button type="button" className="dayboard-text-button" aria-busy={shows(arrival.id, "remove")} aria-disabled={busy}
                              onClick={() => {
                                if (inFlight(arrival.id)) return;
                                begin(arrival.id, "remove");
                                void actions.remove(arrival).then((outcome) => {
                                  end(arrival.id);
                                  if (outcome === "failed") return;
                                  setRemoving(null);
                                  if (outcome === "saved") setSaid(`${arrival.supplierName} removed.`);
                                  keepFocus(outcome === "saved" ? ADD_TARGET : arrival.id);
                                });
                              }}>
                              {shows(arrival.id, "remove") && <ActivityIndicator size={14} />}Remove
                            </button>
                            <button type="button" className="dayboard-text-button" data-focus={`keep:${arrival.id}`}
                              onClick={() => { setRemoving(null); keepFocus(arrival.id); }}>Keep</button>
                          </span>
                        )}
                      </div>
                    )}
                  </>
                )}
                <p className="dayboard-supplier-problem" role="status">{actions.failures.get(arrival.id) ?? ""}</p>
              </li>
            );
          })}
        </ul>
      )}
      {canPlan && editing?.kind === "add" && (
        <SupplierForm
          title="Add a supplier"
          initial={EMPTY_DRAFT}
          boardDay={boardDate}
          dayBoundaryHour={dayBoundaryHour}
          timeZone={timeZone}
          nowMs={nowMs}
          busy={actions.busy.has(addKey)}
          submitLabel="Add"
          onSubmit={(fields) => {
            void actions.add({ bookingId: slot.bookingId, ...fields }).then((outcome) => {
              if (outcome !== "saved") return;
              setEditing(null);
              setSaid(`${fields.supplierName} added.`);
              keepFocus(ADD_TARGET);
            });
          }}
          onCancel={() => { setEditing(null); keepFocus(ADD_TARGET); }}
        />
      )}
      {canPlan && editing?.kind !== "add" && (
        <button type="button" className="dayboard-text-button dayboard-supplier-add" data-focus={ADD_TARGET}
          onClick={() => { setEditing({ kind: "add" }); }}>Add a supplier</button>
      )}
      <p className="dayboard-supplier-problem" role="status">{actions.failures.get(addKey) ?? ""}</p>
      <p className="dayboard-sr" role="status">{said}</p>
    </section>
  );
}
