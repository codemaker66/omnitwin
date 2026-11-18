/**
 * The planner's kit: reading a pasted guest list.
 *
 * The planner pastes from a spreadsheet, a CSV or a plain list of names. This
 * module splits the text into cells, guesses which columns are the name, a
 * second name and the party, and then (once the planner has confirmed the
 * columns) takes names and parties only. Nothing else in the paste is kept,
 * and nothing here talks to a server.
 *
 * No function here throws, and none puts pasted text in a message: what it
 * could not take is reported as counts.
 */

import { GUEST_NAME_MAX, PARTY_MAX, GUESTS_MAX } from "./model.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedPaste {
  /** Cleaned cells, one array a row, the header row removed. */
  readonly rows: readonly (readonly string[])[];
  /** The widest row, counting the header; trailing empty cells do not count. */
  readonly columnCount: number;
  readonly hadHeader: boolean;
  /** The reader's guess at the column holding the name. */
  readonly nameColumn: number;
  /** A separate surname column, when one was found. */
  readonly secondNameColumn: number | null;
  readonly partyColumn: number | null;
}

export interface Taken {
  readonly guests: readonly { readonly name: string; readonly party: string }[];
  /** How many columns of the paste were not taken as a name, a second name or a party. */
  readonly droppedColumns: number;
  readonly skipped: {
    /** The name was empty after cleaning. */
    readonly blank: number;
    /** The name was over the name limit; it is refused, never cut. */
    readonly tooLong: number;
    /** The row would pass the room left on the list. */
    readonly overLimit: number;
  };
}

export interface ColumnPick {
  readonly nameColumn: number;
  readonly secondNameColumn: number | null;
  /** Join the two name columns as "second first" instead of "first second". */
  readonly secondFirst: boolean;
  readonly partyColumn: number | null;
}

// ---------------------------------------------------------------------------
// Cleaning
// ---------------------------------------------------------------------------

/** Control characters (tabs and line ends have already become spaces). */
const CONTROL_CHARACTERS = /\p{Cc}/gu;
const WHITESPACE_RUN = /\s+/g;
const SPACE_RUN = / {2,}/g;

/** NFC, whitespace runs to one space, control characters out, trimmed. */
function cleanCell(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(WHITESPACE_RUN, " ")
    .replace(CONTROL_CHARACTERS, "")
    .replace(SPACE_RUN, " ")
    .trim();
}

/** True when the name is over the name limit, counted in characters (code points), not UTF-16 units. */
function overNameLimit(name: string): boolean {
  return name.length > GUEST_NAME_MAX && Array.from(name).length > GUEST_NAME_MAX;
}

/** The first `max` characters of `text`, never splitting a surrogate pair. */
function firstChars(text: string, max: number): string {
  if (text.length <= max) return text;
  return Array.from(text).slice(0, max).join("");
}

// ---------------------------------------------------------------------------
// Splitting
// ---------------------------------------------------------------------------

/** How a quote that opens a cell fared: it closes at `close`, or it is plain text. */
type QuoteReading =
  | { readonly kind: "closes"; readonly close: number }
  /** Plain text. Another opening quote before `until` would read the same, so it need not be scanned. */
  | { readonly kind: "plain"; readonly until: number };

/**
 * Where a quoted cell opening at `open` ends. A quote inside it closes the
 * cell only when the delimiter, a line end or the end of the text follows;
 * "" is one quote. Any other quote (as in `"Granny" Fraser`) shows the
 * opening quote was never a CSV quote, so the cell is plain text, as lenient
 * CSV readers treat it. The same goes when no quote follows at all.
 */
function readOpeningQuote(text: string, open: number, delimiter: string): QuoteReading {
  let at = open + 1;
  for (;;) {
    const quote = text.indexOf('"', at);
    if (quote === -1) return { kind: "plain", until: Number.POSITIVE_INFINITY };
    const next = text[quote + 1];
    if (next === '"') {
      at = quote + 2;
      continue;
    }
    if (next === undefined || next === delimiter || next === "\n" || next === "\r") return { kind: "closes", close: quote };
    return { kind: "plain", until: quote };
  }
}

/**
 * Splits text into records of raw cells. A quoted cell (a quote at the very
 * start of a cell) runs to its closing quote and may hold the delimiter and
 * line ends; "" inside it is one quote. A cell-start quote that is not a CSV
 * quote (see `readOpeningQuote`) is plain text. Line ends are \n, \r\n or \r.
 */
function splitRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let cells: string[] = [];
  let cell = "";
  let atCellStart = true;
  // An opening quote before this position has been found to be plain text;
  // skipping the scan for the ones inside that stretch keeps reading linear.
  let plainUntil = -1;
  let i = 0;

  while (i < text.length) {
    const c = text.charAt(i);
    if (c === '"' && atCellStart && i >= plainUntil) {
      const reading = readOpeningQuote(text, i, delimiter);
      if (reading.kind === "closes") {
        cell = text.slice(i + 1, reading.close).replaceAll('""', '"');
        atCellStart = false;
        i = reading.close + 1;
        continue;
      }
      plainUntil = reading.until;
    }
    if (c === delimiter) {
      cells.push(cell);
      cell = "";
      atCellStart = true;
      i += 1;
    } else if (c === "\n" || c === "\r") {
      cells.push(cell);
      records.push(cells);
      cells = [];
      cell = "";
      atCellStart = true;
      i += c === "\r" && text.charAt(i + 1) === "\n" ? 2 : 1;
    } else {
      cell += c;
      atCellStart = false;
      i += 1;
    }
  }
  if (cell !== "" || cells.length > 0) {
    cells.push(cell);
    records.push(cells);
  }
  return records;
}

function isBlankRecord(cells: readonly string[]): boolean {
  return cells.every((cell) => cleanCell(cell) === "");
}

/** Drops cells off the end of a row while they are empty. */
function trimTrailingEmpty(cells: readonly string[]): string[] {
  let end = cells.length;
  while (end > 0 && cells[end - 1] === "") end -= 1;
  return cells.slice(0, end);
}

/**
 * Any tab in the text means tab-separated. Otherwise it is comma-separated
 * only when every non-blank line has the same number (one or more) of commas
 * outside quotes; otherwise it is one name a line.
 *
 * `written` is true when the text is two cells a line, every line with a
 * comma followed by a space between them ("Fraser, Ailsa"): the way a list is
 * written by hand. A spreadsheet's export puts no space after its comma.
 */
function readCells(text: string): { readonly rows: string[][]; readonly written: boolean } {
  let records: string[][];
  let written = false;
  if (text.includes("\t")) {
    records = splitRecords(text, "\t");
  } else {
    const byComma = splitRecords(text, ",").filter((r) => !isBlankRecord(r));
    const first = byComma[0];
    const width = first === undefined ? 0 : first.length;
    if (width >= 2 && byComma.every((r) => r.length === width)) {
      records = byComma;
      written = width === 2 && byComma.every((r) => r[1]?.startsWith(" ") === true);
    } else {
      records = text.split(/\r\n|\n|\r/).map((line) => [line]);
    }
  }
  const rows = records
    .filter((r) => !isBlankRecord(r))
    .map((r) => trimTrailingEmpty(r.map(cleanCell)));
  return { rows, written };
}

// ---------------------------------------------------------------------------
// Header and column guesses
// ---------------------------------------------------------------------------

// Cells are cleaned before they are tested: single spaces, trimmed.
/** A surname heading: "surname", "last name", "family name", "last names", "surname(s)". */
const SURNAME_HEADING = /^(?:sur|last|family)\s*names?(?:\(s\))?$/i;
/** A name heading: "name", "names", "name(s)", "guest name", "given name", "full names", and the surname ones. */
const NAME_HEADING = /^(?:(?:guest|first|given|last|sur|family|full)\s*)?names?(?:\(s\))?$/i;
/** "guest" or "guests" on its own: the name column of a one-column sheet. */
const GUEST_HEADING = /^guests?$/i;
/** A party heading: "household", "party", "group", "family", or two of them as "party/household". */
const PARTY_HEADING = /^(?:household|party|group|family)(?:\s*\/\s*(?:household|party|group|family))?$/i;
/** Headings that only a header row carries: no guest is named like this. */
const HEADER_ONLY_HEADING =
  /^(?:table(?:\s*(?:no\.?|number))?|seat|rsvp|e-?mail|phone|diet|dietary(?:\s*requirements)?|notes|title)$/i;

function isHeaderCell(cell: string): boolean {
  return NAME_HEADING.test(cell) || GUEST_HEADING.test(cell) || PARTY_HEADING.test(cell) || HEADER_ONLY_HEADING.test(cell);
}

function findColumn(header: readonly string[], test: (cell: string, at: number) => boolean): number | null {
  const at = header.findIndex(test);
  return at === -1 ? null : at;
}

interface Guess {
  readonly nameColumn: number;
  readonly secondNameColumn: number | null;
  readonly partyColumn: number | null;
}

const NO_HEADER_GUESS: Guess = { nameColumn: 0, secondNameColumn: null, partyColumn: null };

/** "Fraser, Ailsa": the name is column 2, then column 1, so "Ailsa Fraser" is added. */
const SURNAME_FIRST_GUESS: Guess = { nameColumn: 1, secondNameColumn: 0, partyColumn: null };

/** Two cells, each one word: a surname and a first name, as a list written by hand has them. */
function isTwoSingleWords(row: readonly string[]): boolean {
  return row.length === 2 && row.every((cell) => cell !== "" && !cell.includes(" "));
}

function guessColumns(header: readonly string[]): Guess {
  const nameColumn =
    findColumn(header, (cell) => (NAME_HEADING.test(cell) && !SURNAME_HEADING.test(cell)) || GUEST_HEADING.test(cell)) ??
    findColumn(header, (cell) => NAME_HEADING.test(cell)) ??
    0;
  const secondNameColumn = findColumn(header, (cell, at) => at !== nameColumn && SURNAME_HEADING.test(cell));
  const partyColumn = findColumn(
    header,
    (cell, at) => at !== nameColumn && at !== secondNameColumn && PARTY_HEADING.test(cell),
  );
  return { nameColumn, secondNameColumn, partyColumn };
}

// ---------------------------------------------------------------------------
// parsePaste
// ---------------------------------------------------------------------------

/**
 * Reads pasted text into cells, drops a header row if there is one, and
 * guesses the name, second-name and party columns from that header. Without a
 * header the guess is the first column alone, except for a list written
 * surname first by hand: no tab, every line two single words with a comma and
 * a space between them ("Fraser, Ailsa"), read as column 2 then column 1. The
 * page shows the first guest as it will be added, whatever the guess.
 *
 * The first row is a header when one of its cells is a usual heading (see
 * `isHeaderCell`). `opts.header` overrules that test: true takes the first
 * row as the header, false takes it as a guest.
 */
export function parsePaste(text: string, opts?: { readonly header?: boolean }): ParsedPaste {
  const { rows: all, written } = readCells(text);
  const columnCount = all.reduce((widest, row) => Math.max(widest, row.length), 0);
  const first = all[0];
  const isHeader = opts?.header ?? (first?.some(isHeaderCell) ?? false);
  const header = isHeader && first !== undefined ? first : null;
  const rows = header === null ? all : all.slice(1);
  let guess: Guess;
  if (header !== null) guess = guessColumns(header);
  else if (written && rows.every(isTwoSingleWords)) guess = SURNAME_FIRST_GUESS;
  else guess = NO_HEADER_GUESS;
  return { rows, columnCount, hadHeader: header !== null, ...guess };
}

// ---------------------------------------------------------------------------
// takeNames
// ---------------------------------------------------------------------------

function cellAt(row: readonly string[], column: number | null): string {
  if (column === null || !Number.isInteger(column) || column < 0) return "";
  return row[column] ?? "";
}

/** How many of the picked columns are real columns of this paste, each counted once. */
function takenColumnCount(columnCount: number, pick: ColumnPick): number {
  const used = new Set<number>();
  for (const column of [pick.nameColumn, pick.secondNameColumn, pick.partyColumn]) {
    if (column !== null && Number.isInteger(column) && column >= 0 && column < columnCount) used.add(column);
  }
  return used.size;
}

/**
 * Takes names and parties from the picked columns, nothing else. A name over
 * the limit is refused and counted, never cut; a party label over its limit
 * is cut and the guest kept. Rows past `roomLeft` (never more than the list
 * limit) are counted, not taken.
 */
export function takeNames(parsed: ParsedPaste, pick: ColumnPick, roomLeft: number): Taken {
  const room = Number.isNaN(roomLeft) ? 0 : Math.max(0, Math.min(Math.floor(roomLeft), GUESTS_MAX));
  const secondColumn = pick.secondNameColumn === pick.nameColumn ? null : pick.secondNameColumn;
  const guests: { name: string; party: string }[] = [];
  let blank = 0;
  let tooLong = 0;
  let overLimit = 0;

  for (const row of parsed.rows) {
    const first = cellAt(row, pick.nameColumn);
    const second = cellAt(row, secondColumn);
    const parts = pick.secondFirst ? [second, first] : [first, second];
    const name = parts.filter((part) => part !== "").join(" ");
    if (name === "") {
      blank += 1;
    } else if (overNameLimit(name)) {
      tooLong += 1;
    } else if (guests.length >= room) {
      overLimit += 1;
    } else {
      guests.push({ name, party: firstChars(cellAt(row, pick.partyColumn), PARTY_MAX) });
    }
  }

  return {
    guests,
    droppedColumns: Math.max(0, parsed.columnCount - takenColumnCount(parsed.columnCount, { ...pick, secondNameColumn: secondColumn })),
    skipped: { blank, tooLong, overLimit },
  };
}
