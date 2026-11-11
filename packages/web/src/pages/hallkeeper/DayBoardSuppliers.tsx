import { useId, useState, type FormEvent, type ReactElement } from "react";
import { addRotaDays, type CreateSupplierArrival, type SupplierArrival } from "@omnitwin/types";
import { ActivityIndicator } from "../../components/shared/Activity.js";
import { formatWallTime, msToWallInput, wallInputToMs } from "../diary/lib/board-time.js";
import type { DayBoardSlot } from "./lib/day-board-state.js";
import { ARRIVAL_LATE_AFTER_MS } from "./lib/supplier-notices.js";
import type { SupplierArrivalsApi } from "./lib/use-supplier-arrivals.js";

// ---------------------------------------------------------------------------
// Who comes to the building for this booking (T-692): each supplier with
// when they are due, the door they come in by, who to ring and the office's
// note. The floor marks each one arrived and gone; the office adds, changes
// and removes them. A tap answers with the arrival as it now stands, and a
// refusal says so in words.
// ---------------------------------------------------------------------------

type ArrivalsActions = Pick<SupplierArrivalsApi, "busy" | "failure" | "step" | "add" | "change" | "remove" | "refresh">;

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

/** The draft's times on the venue's clock, on `date`; a leaving time before
 *  the arrival is the next morning (a band out at 00:45). */
function draftTimes(draft: Draft, date: string, timeZone: string): { readonly arrivesAt: string; readonly leavesBy: string | null } | null {
  const arrivesMs = wallInputToMs(`${date}T${draft.arrives}`, timeZone);
  if (arrivesMs === null) return null;
  if (draft.leaves === "") return { arrivesAt: new Date(arrivesMs).toISOString(), leavesBy: null };
  const sameDay = wallInputToMs(`${date}T${draft.leaves}`, timeZone);
  const leavesMs = sameDay !== null && sameDay > arrivesMs ? sameDay : wallInputToMs(`${addRotaDays(date, 1)}T${draft.leaves}`, timeZone);
  if (leavesMs === null) return null;
  return { arrivesAt: new Date(arrivesMs).toISOString(), leavesBy: new Date(leavesMs).toISOString() };
}

function blank(value: string): string | null {
  return value.trim().length === 0 ? null : value.trim();
}

function SupplierForm({ title, initial, date, timeZone, busy, submitLabel, onSubmit, onCancel }: {
  readonly title: string;
  readonly initial: Draft;
  readonly date: string;
  readonly timeZone: string;
  readonly busy: boolean;
  readonly submitLabel: string;
  readonly onSubmit: (fields: Omit<CreateSupplierArrival, "bookingId">) => void;
  readonly onCancel: () => void;
}): ReactElement {
  const [draft, setDraft] = useState<Draft>(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const id = useId();
  const field = (name: keyof Draft) => ({
    id: `${id}-${name}`,
    value: draft[name],
    onChange: (event: { readonly target: { readonly value: string } }) => { setDraft((current) => ({ ...current, [name]: event.target.value })); },
  });
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (busy) return;
    const times = draftTimes(draft, date, timeZone);
    if (blank(draft.supplierName) === null || times === null) {
      setProblem("Name the supplier and when they arrive.");
      return;
    }
    setProblem(null);
    onSubmit({
      supplierName: draft.supplierName.trim(),
      category: blank(draft.category),
      arrivesAt: times.arrivesAt,
      leavesBy: times.leavesBy,
      entrance: blank(draft.entrance),
      contact: blank(draft.contact),
      note: blank(draft.note),
    });
  };
  return (
    <form className="dayboard-supplier-form" aria-label={title} onSubmit={submit}>
      <div className="dayboard-supplier-fields">
        <label htmlFor={`${id}-supplierName`}>Supplier<input {...field("supplierName")} required maxLength={160} autoComplete="off" /></label>
        <label htmlFor={`${id}-category`}>What they do<input {...field("category")} maxLength={40} placeholder="florist, band" autoComplete="off" /></label>
        <label htmlFor={`${id}-arrives`}>Arrives<input {...field("arrives")} type="time" required /></label>
        <label htmlFor={`${id}-leaves`}>Leaves by<input {...field("leaves")} type="time" /></label>
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

/** Where a supplier stands at the door, in the floor's words. */
function doorWords(arrival: SupplierArrival, nowMs: number, timeZone: string): { readonly words: string; readonly late: boolean } | null {
  const time = (iso: string): string => formatWallTime(Date.parse(iso), timeZone);
  if (arrival.leftAt !== null) {
    return { words: `In at ${time(arrival.arrivedAt ?? arrival.leftAt)}, gone at ${time(arrival.leftAt)}${arrival.leftByName === null ? "" : ` · ${arrival.leftByName}`}`, late: false };
  }
  if (arrival.arrivedAt !== null) {
    return { words: `In at ${time(arrival.arrivedAt)}${arrival.arrivedByName === null ? "" : ` · ${arrival.arrivedByName}`}`, late: false };
  }
  if (Date.parse(arrival.arrivesAt) <= nowMs - ARRIVAL_LATE_AFTER_MS) return { words: "Not here yet", late: true };
  return null;
}

export function SuppliersSection({ slot, arrivals, timeZone, nowMs, canPlan, canMark, actions, unread = false }: {
  readonly slot: DayBoardSlot;
  readonly arrivals: readonly SupplierArrival[];
  /** The last read failed: what shows is as last read, or nothing yet. */
  readonly unread?: boolean;
  readonly timeZone: string;
  readonly nowMs: number;
  /** The office: adds, changes and removes. */
  readonly canPlan: boolean;
  /** The floor: marks the door. Never the wall. */
  readonly canMark: boolean;
  readonly actions: ArrivalsActions;
}): ReactElement | null {
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  if (arrivals.length === 0 && !canPlan && !unread) return null;
  const bookingDate = msToWallInput(slot.startsAtMs, timeZone).slice(0, 10);
  const time = (iso: string): string => formatWallTime(Date.parse(iso), timeZone);

  return (
    <section className="dayboard-suppliers dayboard-detail-section" aria-label="Suppliers">
      <h3 className="dayboard-detail-heading">Suppliers</h3>
      {unread && (
        <div className="dayboard-changeover-failed">
          <p className="dayboard-changeover-note">
            {arrivals.length === 0 ? "The suppliers could not be read just now." : "The suppliers could not be read just now; these are as last read."}
          </p>
          <button type="button" className="dayboard-seen-button" onClick={actions.refresh}>Try again</button>
        </div>
      )}
      {!unread && arrivals.length === 0 && editing !== "new" && <p className="dayboard-changeover-note">No suppliers are down for this booking.</p>}
      {arrivals.length > 0 && (
        <ul className="dayboard-supplier-list">
          {arrivals.map((arrival) => {
            const busy = actions.busy.has(arrival.id);
            const door = doorWords(arrival, nowMs, timeZone);
            if (editing === arrival.id) {
              return (
                <li key={arrival.id}>
                  <SupplierForm
                    title={`Change ${arrival.supplierName}`}
                    initial={draftOf(arrival, timeZone)}
                    date={msToWallInput(Date.parse(arrival.arrivesAt), timeZone).slice(0, 10)}
                    timeZone={timeZone}
                    busy={busy}
                    submitLabel="Save"
                    onSubmit={(fields) => { void actions.change(arrival, fields).then((saved) => { if (saved) setEditing(null); }); }}
                    onCancel={() => { setEditing(null); }}
                  />
                </li>
              );
            }
            return (
              <li key={arrival.id} className="dayboard-supplier">
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
                      <button type="button" className="dayboard-seen-button" aria-busy={busy} aria-disabled={busy}
                        aria-label={`${arrival.supplierName} arrived`}
                        onClick={() => { if (!busy) void actions.step(arrival, "arrived"); }}>
                        {busy && <ActivityIndicator size={14} />}Arrived
                      </button>
                    )}
                    {canMark && arrival.arrivedAt !== null && arrival.leftAt === null && (
                      <button type="button" className="dayboard-seen-button" aria-busy={busy} aria-disabled={busy}
                        aria-label={`${arrival.supplierName} gone`}
                        onClick={() => { if (!busy) void actions.step(arrival, "left"); }}>
                        {busy && <ActivityIndicator size={14} />}Gone
                      </button>
                    )}
                    {canPlan && removing !== arrival.id && (
                      <>
                        <button type="button" className="dayboard-text-button" aria-label={`Change ${arrival.supplierName}`} onClick={() => { setEditing(arrival.id); }}>Change</button>
                        <button type="button" className="dayboard-text-button" aria-label={`Remove ${arrival.supplierName}`} onClick={() => { setRemoving(arrival.id); }}>Remove</button>
                      </>
                    )}
                    {canPlan && removing === arrival.id && (
                      <span className="dayboard-supplier-confirm" role="group" aria-label={`Remove ${arrival.supplierName}?`}>
                        Remove {arrival.supplierName}?
                        <button type="button" className="dayboard-text-button" aria-busy={busy}
                          onClick={() => { void actions.remove(arrival).then((done) => { if (done) setRemoving(null); }); }}>Remove</button>
                        <button type="button" className="dayboard-text-button" onClick={() => { setRemoving(null); }}>Keep</button>
                      </span>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canPlan && editing === "new" && (
        <SupplierForm
          title="Add a supplier"
          initial={EMPTY_DRAFT}
          date={bookingDate}
          timeZone={timeZone}
          busy={actions.busy.has("new")}
          submitLabel="Add"
          onSubmit={(fields) => { void actions.add({ bookingId: slot.bookingId, ...fields }).then((saved) => { if (saved) setEditing(null); }); }}
          onCancel={() => { setEditing(null); }}
        />
      )}
      {canPlan && editing !== "new" && (
        <button type="button" className="dayboard-text-button dayboard-supplier-add" onClick={() => { setEditing("new"); }}>Add a supplier</button>
      )}
      <p className="dayboard-supplier-problem" role="status">{actions.failure ?? ""}</p>
    </section>
  );
}
