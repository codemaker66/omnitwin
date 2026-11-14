/**
 * The planner's kit: the downloadable list, a CSV a spreadsheet opens. It is
 * built here, in the browser, and handed to the planner as a file; nothing is
 * sent anywhere.
 *
 * Every cell is quoted. A cell that a spreadsheet could read as a formula gets
 * a leading apostrophe, so a guest's name can never run as one.
 */

import type { GuestList } from "./model.js";
import { seatedGuests } from "./paper.js";

const BYTE_ORDER_MARK = "﻿";
const LINE_END = "\r\n";
const HEADER = ["Name", "Party", "Table", "Seat"] as const;
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(text: string): string {
  const safe = FORMULA_START.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

function line(cells: readonly string[]): string {
  return cells.map(cell).join(",") + LINE_END;
}

/**
 * One line a guest, in list order: name, party, table number, seat. A guest
 * with no seat has the table and seat cells empty. Begins with a UTF-8 byte
 * order mark so a spreadsheet reads accents correctly.
 */
export function toCsv(list: GuestList): string {
  const seating = new Map(seatedGuests(list).map((seated) => [seated.guest, seated]));
  const rows = list.guests.map((guest) => {
    const seated = seating.get(guest);
    return line([
      guest.name,
      guest.party,
      seated === undefined ? "" : String(seated.table.number),
      seated === undefined ? "" : String(seated.seat),
    ]);
  });
  return BYTE_ORDER_MARK + line(HEADER) + rows.join("");
}
