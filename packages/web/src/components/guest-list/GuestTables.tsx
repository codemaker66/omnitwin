import { useEffect, useId, useState, type KeyboardEvent, type ReactElement } from "react";
import { GuestListSchema, SEATS_MAX, SEATS_MIN, type Guest, type GuestList, type KitTable } from "../../lib/guest-list/model.js";
import { nameTable, removeTable, setTableSeats, summary } from "../../lib/guest-list/seating.js";
import { sentBackWords } from "./words.js";

// ---------------------------------------------------------------------------
// The ledger by table: a row a table (its number, the planner's own name for
// it, its guests in a line, how full it is). One row can be open, showing its
// seats by number; there a guest still to seat can be chosen, a free seat can
// take the chosen guest, and the table can be named, given more or fewer seats
// or removed. A change that sends guests back to seat says how many.
// ---------------------------------------------------------------------------

type Change = (list: GuestList) => GuestList;

export interface GuestTablesProps {
  readonly list: GuestList;
  readonly openTableId: string | null;
  readonly onToggle: (tableId: string) => void;
  /** The guest chosen to be moved, if any. */
  readonly moving: string | null;
  readonly onChoose: (guestId: string) => void;
  /** Seat the chosen guest at this table: at this seat, or the lowest free one. */
  readonly onPlace: (tableId: string, seat?: number) => void;
  readonly onChange: (change: Change) => void;
  /** Words to show after a change, in numbers only. */
  readonly onNotice: (words: string) => void;
}

/** How many of the guests still to seat an open row offers by name. */
const TO_SEAT_SHOWN = 8;
const TABLE_NAME_MAX = GuestListSchema.shape.tables.element.shape.name.maxLength ?? 60;

function toSeat(list: GuestList): number {
  return summary(list).toSeat;
}

export function GuestTables(props: GuestTablesProps): ReactElement {
  const { list } = props;
  if (list.tables.length === 0) return <p className="gl-empty">There are no tables yet.</p>;

  const tables = [...list.tables].sort((a, b) => a.number - b.number);
  const known = new Set(tables.map((t) => t.id));
  const seatedAt = new Map<string, Map<number, Guest>>();
  const unseated: Guest[] = [];
  for (const guest of list.guests) {
    if (guest.tableId === null || guest.seat === null || !known.has(guest.tableId)) {
      unseated.push(guest);
      continue;
    }
    const seats = seatedAt.get(guest.tableId) ?? new Map<number, Guest>();
    seats.set(guest.seat, guest);
    seatedAt.set(guest.tableId, seats);
  }
  const movingGuest = props.moving === null ? undefined : list.guests.find((g) => g.id === props.moving);

  return (
    <ul className="gl-tables">
      {tables.map((table) => (
        <TableRow
          key={table.id}
          {...props}
          table={table}
          seated={seatedAt.get(table.id) ?? new Map<number, Guest>()}
          unseated={unseated}
          open={props.openTableId === table.id}
          movingHere={movingGuest?.tableId === table.id}
        />
      ))}
    </ul>
  );
}

interface TableRowProps extends GuestTablesProps {
  readonly table: KitTable;
  readonly seated: ReadonlyMap<number, Guest>;
  readonly unseated: readonly Guest[];
  readonly open: boolean;
  /** The chosen guest already sits at this table. */
  readonly movingHere: boolean;
}

function TableRow(props: TableRowProps): ReactElement {
  const { table, seated, unseated, open, movingHere, moving, onToggle, onChoose, onPlace } = props;
  const id = useId();
  const number = String(table.number);
  const count = seated.size;
  const free = Math.max(0, table.seats - count);
  const inLine = [...seated.entries()].sort(([a], [b]) => a - b).map(([, guest]) => guest.name).join(", ");

  return (
    <li className="gl-table" data-open={open ? "true" : undefined}>
      <span className="gl-tile" aria-hidden="true"><small>Table</small><b>{number}</b></span>
      <div className="gl-table__main">
        <h3 className="gl-table__name">
          <button
            type="button"
            className="gl-table__toggle"
            aria-expanded={open}
            aria-controls={open ? `${id}-detail` : undefined}
            onClick={() => { onToggle(table.id); }}
          >
            {table.name === "" ? `Table ${number}` : <><span className="gl-sr-only">{`Table ${number}: `}</span>{table.name}</>}
          </button>
        </h3>
        {!open && <p className="gl-table__names">{inLine === "" ? "No one yet" : inLine}</p>}
        {open && (
          <div className="gl-table__detail" id={`${id}-detail`}>
            <ol className="gl-seats">
              {Array.from({ length: table.seats }, (_, at) => at + 1).map((seat) => {
                const guest = seated.get(seat);
                return (
                  <li key={seat} className="gl-seat" data-free={guest === undefined ? "true" : undefined}>
                    <span className="gl-seat__number">{seat}</span>
                    {guest !== undefined ? (
                      <button type="button" className="gl-seat__guest" aria-pressed={moving === guest.id} onClick={() => { onChoose(guest.id); }}>
                        {guest.name}
                      </button>
                    ) : moving !== null ? (
                      <button type="button" className="gl-button gl-button--place" onClick={() => { onPlace(table.id, seat); }}>
                        Seat here<span className="gl-sr-only">{` at table ${number}, seat ${String(seat)}`}</span>
                      </button>
                    ) : (
                      <span className="gl-seat__free">Free</span>
                    )}
                  </li>
                );
              })}
            </ol>
            {free > 0 && unseated.length > 0 && (
              <div className="gl-to-seat">
                <p className="gl-to-seat__lead">Choose a name, then a free seat:</p>
                <div className="gl-to-seat__names">
                  {unseated.slice(0, TO_SEAT_SHOWN).map((guest) => (
                    <button key={guest.id} type="button" className="gl-chip-button" aria-pressed={moving === guest.id} onClick={() => { onChoose(guest.id); }}>
                      {guest.name}
                    </button>
                  ))}
                </div>
                {unseated.length > TO_SEAT_SHOWN && (
                  <p className="gl-to-seat__more">{`and ${String(unseated.length - TO_SEAT_SHOWN)} more, under To seat`}</p>
                )}
              </div>
            )}
            <TableEdit list={props.list} table={table} seatedCount={count} onChange={props.onChange} onNotice={props.onNotice} />
          </div>
        )}
      </div>
      <div className="gl-table__state">
        <span className="gl-table__count">{`${String(count)} of ${String(table.seats)}`}</span>
        {free > 0 && <span className="gl-chip" data-tone="copper">{`${String(free)} free`}</span>}
        {moving !== null && !movingHere && (
          <button type="button" className="gl-button gl-button--place" onClick={() => { onPlace(table.id); }}>
            Seat here<span className="gl-sr-only">{` at table ${number}`}</span>
          </button>
        )}
      </div>
    </li>
  );
}

interface TableEditProps {
  readonly list: GuestList;
  readonly table: KitTable;
  readonly seatedCount: number;
  readonly onChange: (change: Change) => void;
  readonly onNotice: (words: string) => void;
}

/** Name, seats and removal for one table. Fields are kept when left (or on Enter), never while typed in. */
function TableEdit({ list, table, seatedCount, onChange, onNotice }: TableEditProps): ReactElement {
  const id = useId();
  const number = String(table.number);
  const [name, setName] = useState(table.name);
  const [seats, setSeats] = useState(String(table.seats));

  // A change from elsewhere (undo) shows in the fields.
  useEffect(() => { setName(table.name); }, [table.name]);
  useEffect(() => { setSeats(String(table.seats)); }, [table.seats]);

  const keepName = (): void => {
    if (name.trim() === table.name) return;
    onChange((l) => nameTable(l, table.id, name));
  };

  const keepSeats = (): void => {
    const asked = seats.trim() === "" ? Number.NaN : Number(seats);
    const next = setTableSeats(list, table.id, asked);
    const now = next.tables.find((t) => t.id === table.id)?.seats;
    // A blank or unreadable number changes nothing, and neither does the same number.
    if (next === list || now === undefined || now === table.seats) {
      setSeats(String(table.seats));
      return;
    }
    const sentBack = toSeat(next) - toSeat(list);
    onChange((l) => setTableSeats(l, table.id, asked));
    setSeats(String(now));
    if (sentBack > 0) onNotice(`Table ${number} now has ${String(now)} seats. ${sentBackWords(sentBack)}`);
  };

  const remove = (): void => {
    onChange((l) => removeTable(l, table.id));
    onNotice(seatedCount > 0
      ? `Table ${number} was removed. Its ${sentBackWords(seatedCount)}`
      : `Table ${number} was removed.`);
  };

  const onEnter = (keep: () => void) => (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    keep();
  };

  return (
    <div className="gl-table__edit">
      <div className="gl-field gl-field--wide">
        <label className="gl-field__label" htmlFor={`${id}-name`}>{`Name of table ${number}`}</label>
        <input
          id={`${id}-name`}
          className="gl-input"
          value={name}
          maxLength={TABLE_NAME_MAX}
          autoComplete="off"
          onChange={(event) => { setName(event.target.value); }}
          onBlur={keepName}
          onKeyDown={onEnter(keepName)}
        />
      </div>
      <div className="gl-field">
        <label className="gl-field__label" htmlFor={`${id}-seats`}>{`Seats at table ${number}`}</label>
        <input
          id={`${id}-seats`}
          className="gl-input gl-input--number"
          type="number"
          inputMode="numeric"
          min={SEATS_MIN}
          max={SEATS_MAX}
          value={seats}
          onChange={(event) => { setSeats(event.target.value); }}
          onBlur={keepSeats}
          onKeyDown={onEnter(keepSeats)}
        />
      </div>
      <button type="button" className="gl-button gl-button--alert" onClick={remove}>{`Remove table ${number}`}</button>
    </div>
  );
}
