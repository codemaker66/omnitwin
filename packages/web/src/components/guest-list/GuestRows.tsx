import { useEffect, useId, useRef, useState, type FormEvent, type ReactElement } from "react";
import { GuestListSchema, type Guest, type GuestList } from "../../lib/guest-list/model.js";
import { groupAZ, planLabel, sortKey } from "../../lib/guest-list/paper.js";
import { removeGuest, renameGuest } from "../../lib/guest-list/seating.js";

// ---------------------------------------------------------------------------
// The ledger by guest, A to Z under their letters: every guest, the seated or
// those still to seat. A name is a button that chooses the guest to be moved
// (a seat or a table is then chosen in the tables view); each guest can be
// edited in place (name and party only) or removed.
// ---------------------------------------------------------------------------

export type GuestFilter = "all" | "seated" | "to-seat";

type Change = (list: GuestList) => GuestList;

export interface GuestRowsProps {
  readonly list: GuestList;
  readonly filter: GuestFilter;
  readonly moving: string | null;
  readonly onChoose: (guestId: string) => void;
  readonly onChange: (change: Change) => void;
  /** A removal left no row in this view to take the focus. */
  readonly onFocusHead: () => void;
}

const EMPTY: Readonly<Record<GuestFilter, string>> = {
  all: "There are no guests on this list yet.",
  seated: "No one has a seat yet.",
  "to-seat": "Everyone has a seat.",
};

const PARTY_MAX = GuestListSchema.shape.guests.element.shape.party.maxLength ?? 60;

interface Entry {
  readonly guest: Guest;
  readonly key: string;
  readonly label: string;
  /** "Table 7, seat 3", or null with no seat. */
  readonly seat: string | null;
}

function entriesOf(list: GuestList, filter: GuestFilter): readonly { readonly letter: string; readonly entries: readonly Entry[] }[] {
  const numbers = new Map(list.tables.map((t) => [t.id, t.number]));
  const entries: Entry[] = [];
  for (const guest of list.guests) {
    const number = guest.tableId === null ? undefined : numbers.get(guest.tableId);
    const seat = number === undefined || guest.seat === null ? null : `Table ${String(number)}, seat ${String(guest.seat)}`;
    if (filter === "seated" && seat === null) continue;
    if (filter === "to-seat" && seat !== null) continue;
    entries.push({ guest, key: sortKey(guest.name, list.sortBy), label: planLabel(guest.name, list.sortBy), seat });
  }
  // The table plan's own A to Z: the same order and the same letters, one section a letter.
  return groupAZ(entries);
}

/** Keeps an element per guest id while it is mounted, for moving the focus to it. */
function keep(into: Map<string, HTMLButtonElement>, guestId: string) {
  return (node: HTMLButtonElement | null): void => {
    if (node === null) into.delete(guestId);
    else into.set(guestId, node);
  };
}

export function GuestRows({ list, filter, moving, onChoose, onChange, onFocusHead }: GuestRowsProps): ReactElement {
  const id = useId();
  const [editing, setEditing] = useState<string | null>(null);
  const names = useRef(new Map<string, HTMLButtonElement>());
  const edits = useRef(new Map<string, HTMLButtonElement>());
  /** Where the focus goes once the rows have drawn again: a guest's name or their Edit button. */
  const [focusAsk, setFocusAsk] = useState<{ readonly on: "name" | "edit"; readonly guestId: string; readonly n: number } | null>(null);

  useEffect(() => {
    if (focusAsk === null) return;
    (focusAsk.on === "name" ? names : edits).current.get(focusAsk.guestId)?.focus();
  }, [focusAsk]);

  const focusLater = (on: "name" | "edit", guestId: string): void => {
    setFocusAsk((was) => ({ on, guestId, n: (was?.n ?? 0) + 1 }));
  };

  const groups = entriesOf(list, filter);
  if (groups.length === 0) return <p className="gl-empty">{EMPTY[filter]}</p>;
  const order = groups.flatMap((group) => group.entries.map((entry) => entry.guest.id));

  // The focus goes to the next row, or the row before when this was the last; with none left, to the ledger's head.
  const remove = (guestId: string): void => {
    const at = order.indexOf(guestId);
    const next = order[at + 1] ?? (at > 0 ? order[at - 1] : undefined);
    onChange((l) => removeGuest(l, guestId));
    if (next === undefined) onFocusHead();
    else focusLater("name", next);
  };

  return (
    <div className="gl-guests">
      <p className="gl-sr-only" id={`${id}-how`}>Choose a name, then a free seat or a table.</p>
      {groups.map(({ letter, entries }, at) => (
        <section key={letter} className="gl-letter" aria-labelledby={`${id}-letter-${String(at)}`}>
          <h3 className="gl-group" id={`${id}-letter-${String(at)}`}>
            {letter}<span className="gl-group__count">{String(entries.length)}</span>
          </h3>
          <ul className="gl-guest-list">
            {entries.map((entry) => (
              <li key={entry.guest.id} className="gl-guest">
                {editing === entry.guest.id ? (
                  <GuestEdit
                    list={list}
                    guest={entry.guest}
                    onChange={onChange}
                    onDone={() => {
                      setEditing(null);
                      focusLater("edit", entry.guest.id);
                    }}
                  />
                ) : (
                  <>
                    <div className="gl-guest__main">
                      <button
                        ref={keep(names.current, entry.guest.id)}
                        type="button"
                        className="gl-guest__name"
                        aria-pressed={moving === entry.guest.id}
                        aria-describedby={`${id}-how`}
                        onClick={() => { onChoose(entry.guest.id); }}
                      >
                        {entry.label}
                      </button>
                      {entry.guest.party !== "" && <span className="gl-guest__party">{entry.guest.party}</span>}
                    </div>
                    <span className="gl-guest__seat" data-none={entry.seat === null ? "true" : undefined}>
                      {entry.seat ?? "No seat yet"}
                    </span>
                    <div className="gl-guest__actions">
                      <button ref={keep(edits.current, entry.guest.id)} type="button" className="gl-button gl-button--quiet" onClick={() => { setEditing(entry.guest.id); }}>
                        Edit<span className="gl-sr-only">{` ${entry.guest.name}`}</span>
                      </button>
                      <button type="button" className="gl-button gl-button--quiet" onClick={() => { remove(entry.guest.id); }}>
                        Remove<span className="gl-sr-only">{` ${entry.guest.name}`}</span>
                      </button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

interface GuestEditProps {
  readonly list: GuestList;
  readonly guest: Guest;
  readonly onChange: (change: Change) => void;
  readonly onDone: () => void;
}

/** A guest's name and party, edited in place. A refused name is said in fixed words, never with the name in them. */
function GuestEdit({ list, guest, onChange, onDone }: GuestEditProps): ReactElement {
  const id = useId();
  const [name, setName] = useState(guest.name);
  const [party, setParty] = useState(guest.party);
  const [refused, setRefused] = useState(false);

  const save = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if ("refused" in renameGuest(list, guest.id, name, party)) {
      setRefused(true);
      return;
    }
    onChange((l) => {
      const renamed = renameGuest(l, guest.id, name, party);
      return "refused" in renamed ? l : renamed;
    });
    onDone();
  };

  return (
    <form className="gl-guest__edit" aria-label="Edit a guest" onSubmit={save}>
      <div className="gl-field">
        <label className="gl-field__label" htmlFor={`${id}-name`}>Name</label>
        <input
          id={`${id}-name`}
          className="gl-input"
          value={name}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={refused}
          aria-describedby={refused ? `${id}-refused` : undefined}
          onChange={(event) => { setName(event.target.value); setRefused(false); }}
        />
      </div>
      <div className="gl-field">
        <label className="gl-field__label" htmlFor={`${id}-party`}>Party</label>
        <input
          id={`${id}-party`}
          className="gl-input"
          value={party}
          maxLength={PARTY_MAX}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => { setParty(event.target.value); }}
        />
      </div>
      {refused && <p className="gl-field__error" id={`${id}-refused`} role="alert">A name needs 1 to 80 characters.</p>}
      <div className="gl-guest__edit-actions">
        <button type="submit" className="gl-button gl-button--primary">Save</button>
        <button type="button" className="gl-button" onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}
