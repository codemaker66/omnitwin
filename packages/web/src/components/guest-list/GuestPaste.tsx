import { useId, useMemo, useState, type ReactElement, type Ref } from "react";
import { parsePaste, takeNames, type ColumnPick } from "../../lib/guest-list/parse-paste.js";
import { counted, foundWords, leftOutWords } from "./words.js";

// ---------------------------------------------------------------------------
// Adding guests by pasting a list. The planner pastes into the box (nothing is
// read from the clipboard by script); the reader's guesses (a heading row, and
// which columns hold the name, a second name and the party) are shown for the
// planner to correct; what will be taken is said in counts before anything is
// added. Only names and parties are handed on: every other column stays here.
// ---------------------------------------------------------------------------

export interface PastedGuest {
  readonly name: string;
  readonly party: string;
}

export interface GuestPasteProps {
  /** How many more guests the list can take. */
  readonly roomLeft: number;
  readonly onAdd: (guests: readonly PastedGuest[]) => void;
  /** Given when the list already has guests: the box can then be closed. */
  readonly onClose?: () => void;
  readonly boxRef?: Ref<HTMLTextAreaElement>;
}

/** How much of a cell a column's choice shows, in characters. */
const SAMPLE_MAX = 28;

function sample(cell: string): string {
  const characters = Array.from(cell);
  return characters.length > SAMPLE_MAX ? `${characters.slice(0, SAMPLE_MAX).join("")}…` : cell;
}

function columnNumber(value: string): number | null {
  return value === "" ? null : Number(value);
}

export function GuestPaste({ roomLeft, onAdd, onClose, boxRef }: GuestPasteProps): ReactElement {
  const id = useId();
  const [text, setText] = useState("");
  /** Null follows the reader's guess; true or false is the planner's own answer. */
  const [heading, setHeading] = useState<boolean | null>(null);
  /** Null follows the reader's guess at the columns. */
  const [pick, setPick] = useState<ColumnPick | null>(null);

  const parsed = useMemo(() => parsePaste(text, heading === null ? undefined : { header: heading }), [text, heading]);
  const firstRow = useMemo(() => parsePaste(text, { header: false }).rows[0] ?? [], [text]);
  const chosen: ColumnPick = pick ?? {
    nameColumn: parsed.nameColumn,
    secondNameColumn: parsed.secondNameColumn,
    secondFirst: false,
    partyColumn: parsed.partyColumn,
  };
  const taken = takeNames(parsed, chosen, roomLeft);
  const leftOut = leftOutWords(taken.skipped);
  const pasted = text.trim() !== "";
  /** The first guest exactly as Add will add it, shown under the column choices. */
  const firstGuest = parsed.columnCount >= 2 ? taken.guests[0] : undefined;
  const twoNameColumns = chosen.secondNameColumn !== null && chosen.secondNameColumn !== chosen.nameColumn;

  const columns = Array.from({ length: parsed.columnCount }, (_, at) => at);
  const columnLabel = (at: number): string => {
    const cell = sample(firstRow[at] ?? "");
    const number = `Column ${String(at + 1)}`;
    if (cell === "") return number;
    return parsed.hadHeader ? `${number}: ${cell}` : `${number}, such as ${cell}`;
  };

  const add = (): void => {
    onAdd(taken.guests);
    setText("");
    setHeading(null);
    setPick(null);
  };

  return (
    <section className="gl-paste" aria-labelledby={`${id}-title`}>
      <div className="gl-paste__head">
        <h2 className="gl-section-title" id={`${id}-title`}>Add guests</h2>
        {onClose !== undefined && (
          <button type="button" className="gl-button gl-button--quiet" onClick={onClose}>Close</button>
        )}
      </div>

      <div className="gl-field">
        <label className="gl-field__label" htmlFor={`${id}-box`}>Paste the names</label>
        <p className="gl-field__hint" id={`${id}-hint`}>
          Copy them from a spreadsheet, a document or an email, one guest a line, and paste them here. Other columns stay on your computer.
        </p>
        <textarea
          ref={boxRef}
          id={`${id}-box`}
          className="gl-paste__box"
          rows={8}
          value={text}
          spellCheck={false}
          autoComplete="off"
          aria-describedby={`${id}-hint`}
          onChange={(event) => {
            setText(event.target.value);
            setHeading(null);
            setPick(null);
          }}
        />
      </div>

      {pasted && (
        <div className="gl-paste__found">
          <p className="gl-paste__words">{foundWords(taken.guests.length, taken.droppedColumns)}</p>
          {leftOut !== null && <p className="gl-paste__left-out">{leftOut}</p>}

          <label className="gl-check">
            <input
              type="checkbox"
              checked={parsed.hadHeader}
              onChange={(event) => {
                setHeading(event.target.checked);
                setPick(null);
              }}
            />
            <span>The first row is a heading</span>
          </label>

          {parsed.columnCount >= 2 && (
            <div className="gl-paste__columns">
              <div className="gl-field">
                <label className="gl-field__label" htmlFor={`${id}-name`}>Name</label>
                <select
                  id={`${id}-name`}
                  className="gl-select"
                  value={String(chosen.nameColumn)}
                  onChange={(event) => { setPick({ ...chosen, nameColumn: Number(event.target.value) }); }}
                >
                  {columns.map((at) => <option key={at} value={String(at)}>{columnLabel(at)}</option>)}
                </select>
              </div>
              <div className="gl-field">
                <label className="gl-field__label" htmlFor={`${id}-second`}>Second name</label>
                <select
                  id={`${id}-second`}
                  className="gl-select"
                  value={chosen.secondNameColumn === null ? "" : String(chosen.secondNameColumn)}
                  onChange={(event) => { setPick({ ...chosen, secondNameColumn: columnNumber(event.target.value) }); }}
                >
                  <option value="">None</option>
                  {columns.map((at) => <option key={at} value={String(at)}>{columnLabel(at)}</option>)}
                </select>
              </div>
              <div className="gl-field">
                <label className="gl-field__label" htmlFor={`${id}-party`}>Party</label>
                <select
                  id={`${id}-party`}
                  className="gl-select"
                  value={chosen.partyColumn === null ? "" : String(chosen.partyColumn)}
                  onChange={(event) => { setPick({ ...chosen, partyColumn: columnNumber(event.target.value) }); }}
                >
                  <option value="">None</option>
                  {columns.map((at) => <option key={at} value={String(at)}>{columnLabel(at)}</option>)}
                </select>
              </div>
            </div>
          )}

          {parsed.columnCount >= 2 && (firstGuest !== undefined || twoNameColumns) && (
            <div className="gl-paste__first">
              {firstGuest !== undefined && (
                <p className="gl-paste__words">
                  {`The first guest will be added as: ${firstGuest.name}${
                    chosen.partyColumn === null ? "" : `, party: ${firstGuest.party === "" ? "none" : firstGuest.party}`
                  }`}
                </p>
              )}
              {twoNameColumns && (
                <button
                  type="button"
                  className="gl-button gl-button--quiet"
                  aria-pressed={chosen.secondFirst}
                  onClick={() => { setPick({ ...chosen, secondFirst: !chosen.secondFirst }); }}
                >
                  Put the two names the other way round
                </button>
              )}
            </div>
          )}

          {taken.guests.length > 0 && (
            <div className="gl-paste__add">
              <button type="button" className="gl-button gl-button--primary" onClick={add}>
                {`Add ${counted(taken.guests.length, "guest", "guests")}`}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
