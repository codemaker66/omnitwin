import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { toCsv } from "../../lib/guest-list/export.js";
import { SEATS_DEFAULT, SEATS_MAX, SEATS_MIN, TABLES_MAX, type GuestList } from "../../lib/guest-list/model.js";
import type { Sheet } from "../../lib/guest-list/paper.js";
import type { PlanTables } from "../../lib/guest-list/plan-tables.js";
import { seatEveryone, summary } from "../../lib/guest-list/seating.js";
import { ActivityIndicator, ActivityStatus } from "../shared/Activity.js";
import { counted, keepingLine, NOT_YET_PRINTED, printedOn, shortDay, weekday } from "./words.js";

// ---------------------------------------------------------------------------
// The forest panel beside the sheet: the event's three facts, the one next
// step (chosen by the list's state), what is still needed before the paper,
// the four sheets, and the list's keeping: where it is kept and until when,
// downloading it, deleting it (asked here, never in a browser dialog) and
// undoing the last change.
// ---------------------------------------------------------------------------

/** What the one read of the plan found. */
export type RoomState =
  | { readonly status: "waiting" }
  | { readonly status: "ready"; readonly name: string; readonly tables: PlanTables }
  | { readonly status: "failed" };

export type NextStep =
  | { readonly kind: "paste" }
  | { readonly kind: "room-tables"; readonly count: number }
  | { readonly kind: "set-tables" }
  | { readonly kind: "seat" }
  | { readonly kind: "print" };

/** The one next step, in this order: paste, tables, seat everyone, print. */
export function nextStep(list: GuestList, room: RoomState): NextStep {
  const counts = summary(list);
  if (counts.guests === 0) return { kind: "paste" };
  if (counts.tables === 0) {
    const fromRoom = room.status === "ready" ? Math.min(room.tables.tables, TABLES_MAX) : 0;
    return fromRoom > 0 ? { kind: "room-tables", count: fromRoom } : { kind: "set-tables" };
  }
  // Seating everyone is offered only while it would seat someone: a party too
  // large for every free stretch stays to seat, and the paper comes next.
  if (counts.toSeat > 0 && counts.freeSeats > 0 && summary(seatEveryone(list)).seated > counts.seated) {
    return { kind: "seat" };
  }
  return { kind: "print" };
}

/** A sheet's address. It carries the kit's switch, so a device that cannot remember it still reaches the paper. */
export function paperAddress(planId: string, sheet: Sheet): string {
  return `/plan/${planId}/guests/paper?kit=on&sheet=${sheet}`;
}

/** How long the downloaded file's address is kept before it is let go. */
const DOWNLOAD_ADDRESS_KEPT_MS = 10_000;

/** The list as a file the planner keeps: made here, handed over, never sent. */
function download(list: GuestList): void {
  const url = URL.createObjectURL(new Blob([toCsv(list)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "guest-list.csv";
  document.body.append(link);
  link.click();
  link.remove();
  // Some browsers (Safari) read the file after the click returns: its address is let go only after a while.
  window.setTimeout(() => { URL.revokeObjectURL(url); }, DOWNLOAD_ADDRESS_KEPT_MS);
}

export interface GuestPanelProps {
  readonly planId: string;
  readonly list: GuestList;
  /** The event's name as shown: the list's title, else the plan's name. */
  readonly title: string;
  readonly kept: boolean;
  /** False while a list may be kept here that the page could not read: deleting is not offered then. */
  readonly canDelete: boolean;
  readonly canUndo: boolean;
  readonly room: RoomState;
  readonly tablesFormOpen: boolean;
  /** Takes the next step's control, to move focus to it after a step. */
  readonly nextRef: (element: HTMLElement | null) => void;
  readonly tablesFieldRef: (element: HTMLInputElement | null) => void;
  readonly onPaste: () => void;
  readonly onUseRoomTables: () => void;
  readonly onOpenTablesForm: () => void;
  readonly onCloseTablesForm: () => void;
  /** Returns false when the numbers change nothing (a blank one). */
  readonly onSetTables: (count: number, seats: number) => boolean;
  readonly onSeatEveryone: () => void;
  readonly onUndo: () => void;
  readonly onErase: () => Promise<void>;
}

export function GuestPanel(props: GuestPanelProps): ReactElement {
  const { planId, list, title, kept, canUndo, room } = props;
  const id = useId();
  const counts = summary(list);
  const step = nextStep(list, room);

  const owed: { readonly text: string; readonly aside?: string }[] = [];
  if (counts.toSeat > 0) owed.push({ text: `${counted(counts.toSeat, "guest has", "guests have")} no seat` });
  if (counts.tables === 0) owed.push({ text: "There are no tables yet" });
  // The version belongs to the paper as a whole (all four sheets), so these speak of the paper.
  if (list.paperVersion === 0 || list.printedAt === null) {
    owed.push({ text: "The paper is not yet printed" });
  } else if (list.changedSincePrint) {
    owed.push({ text: "The paper has changed since it was printed", aside: printedOn(list.printedAt) });
  }

  const sheets: readonly { readonly sheet: Sheet; readonly label: string; readonly aside: string }[] = [
    { sheet: "table-plan", label: "Table plan for the door", aside: list.paperVersion > 0 ? `Version ${String(list.paperVersion)}` : NOT_YET_PRINTED },
    { sheet: "by-table", label: "Guests by table", aside: counted(counts.tables, "table", "tables") },
    { sheet: "place-cards", label: "Place cards", aside: counted(counts.seated, "card", "cards") },
    { sheet: "covers", label: "Covers by table, for the caterer", aside: "No names" },
  ];

  return (
    <aside className="gl-panel" data-register="forest" aria-label="The event">
      <div className="gl-panel__body">
        <div className="gl-panel__head">
          <p className="gl-eyebrow">The event</p>
          <h2 className="gl-panel__title" translate="no">{title}</h2>
        </div>

        <div className="gl-facts">
          <div>
            <b>{list.eventDate === null ? "Not set" : shortDay(list.eventDate)}</b>
            <span>{list.eventDate === null ? "date" : weekday(list.eventDate)}</span>
          </div>
          <div><b>{String(counts.guests)}</b><span>{counts.guests === 1 ? "guest" : "guests"}</span></div>
          <div><b>{String(counts.tables)}</b><span>{counts.tables === 1 ? "table" : "tables"}</span></div>
        </div>

        <section className="gl-panel__section" aria-labelledby={`${id}-next`}>
          <h3 className="gl-eyebrow" id={`${id}-next`}>Next step</h3>
          {props.tablesFormOpen ? (
            <SetTablesForm list={list} firstRef={props.tablesFieldRef} onSet={props.onSetTables} onCancel={props.onCloseTablesForm} />
          ) : (
            <div className="gl-actions">
              {step.kind === "paste" && (
                <button type="button" ref={props.nextRef} className="gl-button gl-button--primary" onClick={props.onPaste}>Paste a list</button>
              )}
              {step.kind === "room-tables" && (
                <button type="button" ref={props.nextRef} className="gl-button gl-button--primary" onClick={props.onUseRoomTables}>
                  {`Use the room's ${String(step.count)} tables`}
                </button>
              )}
              {step.kind === "set-tables" && (
                <button type="button" ref={props.nextRef} className="gl-button gl-button--primary" onClick={props.onOpenTablesForm}>Set the tables</button>
              )}
              {step.kind === "seat" && (
                <button type="button" ref={props.nextRef} className="gl-button gl-button--primary" onClick={props.onSeatEveryone}>Seat everyone</button>
              )}
              {step.kind === "print" && (
                <Link ref={props.nextRef} className="gl-button gl-button--primary" to={paperAddress(planId, "table-plan")}>Print the table plan</Link>
              )}
              <Link className="gl-button gl-button--quiet" to={`/plan/${planId}`}>Open the room</Link>
            </div>
          )}
          {step.kind === "set-tables" && room.status === "waiting" && (
            <ActivityStatus className="gl-panel__working">Counting the room's tables…</ActivityStatus>
          )}
        </section>

        <section className="gl-panel__section" aria-labelledby={`${id}-owed`}>
          <h3 className="gl-eyebrow" id={`${id}-owed`}>Still needed</h3>
          {owed.length === 0 ? (
            <p className="gl-panel__note">Nothing else is needed for the paper.</p>
          ) : (
            <ul className="gl-owed">
              {owed.map((line) => (
                <li key={line.text}>
                  <span>{line.text}</span>
                  {line.aside !== undefined && <small>{line.aside}</small>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="gl-panel__section" aria-labelledby={`${id}-paper`}>
          <h3 className="gl-eyebrow" id={`${id}-paper`}>Paper</h3>
          <ul className="gl-paper">
            {sheets.map((sheet) => (
              <li key={sheet.sheet}>
                <Link className="gl-paper__link" to={paperAddress(planId, sheet.sheet)}>{sheet.label}</Link>
                <small>{sheet.aside}</small>
              </li>
            ))}
          </ul>
        </section>

        <section className="gl-panel__section gl-keeping" aria-label="Keeping the list">
          {kept && <p className="gl-panel__note">{keepingLine(list)}</p>}
          <div className="gl-actions">
            <button type="button" className="gl-button gl-button--quiet" onClick={() => { download(list); }}>Download the list</button>
            <button type="button" className="gl-button gl-button--quiet" disabled={!canUndo} onClick={props.onUndo}>Undo</button>
          </div>
          {props.canDelete && <DeleteList guests={counts.guests} onErase={props.onErase} />}
        </section>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Setting the tables by hand: two numbers. A blank number changes nothing.
// ---------------------------------------------------------------------------

interface SetTablesFormProps {
  readonly list: GuestList;
  readonly firstRef: (element: HTMLInputElement | null) => void;
  readonly onSet: (count: number, seats: number) => boolean;
  readonly onCancel: () => void;
}

function numberIn(field: string): number {
  return field.trim() === "" ? Number.NaN : Number(field);
}

function SetTablesForm({ list, firstRef, onSet, onCancel }: SetTablesFormProps): ReactElement {
  const id = useId();
  const [count, setCount] = useState(list.tables.length > 0 ? String(list.tables.length) : "");
  const [seats, setSeats] = useState(String(SEATS_DEFAULT));
  const [missing, setMissing] = useState(false);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setMissing(!onSet(numberIn(count), numberIn(seats)));
  };

  return (
    <form className="gl-tables-form" aria-label="Set the tables" onSubmit={submit}>
      <div className="gl-fields">
        <div className="gl-field">
          <label className="gl-field__label" htmlFor={`${id}-count`}>Tables</label>
          <input
            ref={firstRef}
            id={`${id}-count`}
            className="gl-input gl-input--number"
            type="number"
            inputMode="numeric"
            min={0}
            max={TABLES_MAX}
            value={count}
            onChange={(event) => { setCount(event.target.value); setMissing(false); }}
          />
        </div>
        <div className="gl-field">
          <label className="gl-field__label" htmlFor={`${id}-seats`}>
            {list.tables.length > 0 ? "Seats at each new table" : "Seats at each table"}
          </label>
          <input
            id={`${id}-seats`}
            className="gl-input gl-input--number"
            type="number"
            inputMode="numeric"
            min={SEATS_MIN}
            max={SEATS_MAX}
            value={seats}
            onChange={(event) => { setSeats(event.target.value); setMissing(false); }}
          />
        </div>
      </div>
      {missing && <p className="gl-field__error" role="alert">Both numbers are needed.</p>}
      <div className="gl-actions">
        <button type="submit" className="gl-button gl-button--primary">Set the tables</button>
        <button type="button" className="gl-button gl-button--quiet" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Deleting the list from this device: asked here, in two steps, with the
// safe answer first under the keyboard.
// ---------------------------------------------------------------------------

function DeleteList({ guests, onErase }: { readonly guests: number; readonly onErase: () => Promise<void> }): ReactElement {
  const id = useId();
  const [asking, setAsking] = useState(false);
  const [erasing, setErasing] = useState(false);
  const keepRef = useRef<HTMLButtonElement>(null);
  const askRef = useRef<HTMLButtonElement>(null);
  const wasAsking = useRef(false);

  useEffect(() => {
    if (asking) keepRef.current?.focus();
    else if (wasAsking.current) askRef.current?.focus();
    wasAsking.current = asking;
  }, [asking]);

  const erase = async (): Promise<void> => {
    if (erasing) return;
    setErasing(true);
    try {
      await onErase();
    } finally {
      setErasing(false);
      setAsking(false);
    }
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Escape" || erasing) return;
    event.preventDefault();
    setAsking(false);
  };

  if (!asking) {
    return (
      <button ref={askRef} type="button" className="gl-button gl-button--quiet" onClick={() => { setAsking(true); }}>
        Delete the list from this device
      </button>
    );
  }
  return (
    <div className="gl-confirm" role="group" aria-labelledby={`${id}-question`} onKeyDown={onKey}>
      <p className="gl-confirm__question" id={`${id}-question`}>
        {guests > 0
          ? `Delete the ${counted(guests, "name", "names")} from this browser? Undo cannot bring them back.`
          : "Delete this list from this browser? Undo cannot bring it back."}
      </p>
      <div className="gl-actions">
        <button
          type="button"
          className="gl-button gl-button--alert"
          aria-busy={erasing}
          aria-disabled={erasing}
          onClick={() => { void erase(); }}
        >
          {erasing && <ActivityIndicator size={16} />}
          {erasing ? "Deleting the list…" : guests > 0 ? `Delete ${counted(guests, "name", "names")} for good` : "Delete the list for good"}
        </button>
        <button ref={keepRef} type="button" className="gl-button gl-button--quiet" disabled={erasing} onClick={() => { setAsking(false); }}>
          Keep the list
        </button>
      </div>
    </div>
  );
}
