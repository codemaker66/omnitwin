import {
  HallkeeperSheetSummarySchema,
  sheetTimes,
  type HallkeeperSheetSummary,
  type HallkeeperSheetV2,
} from "@omnitwin/types";

// ---------------------------------------------------------------------------
// hallkeeper-summary — the Day Board's one line about a setup sheet.
//
// "Ready by 16:00 · 12 of 43 checked" is counted exactly as the sheet counts
// it: every row of every zone of every phase, and a row is checked when its
// key carries a check mark. Marks left on keys a re-save removed are not
// counted, because the sheet does not show them. Pure, so the count is
// tested without a database.
//
// Its Ready by is the printed sheet's (sheetTimes): the planner's final-touches
// time, else when guests come in. It used to send timing.setupBy, which is
// when setup STARTS, so the board told the room to be ready an hour early.
// That start goes as setupFrom when the board asks for it, so the board can
// say when the window leaves no time to set the room, on the sheet's own rule
// (sheetIntervals).
// ---------------------------------------------------------------------------

/** What a caller asks the summary to carry beyond the shape it has always had. */
export interface SummaryOptions {
  /**
   * When setup starts (setupFrom). Only when asked: the web reads the summary
   * with a strict schema, so web code older than #454 refuses a key it does
   * not know, and a Day Board left open on that code would freeze its line
   * until someone reloaded it.
   */
  readonly setupFrom?: boolean;
}

export function summarizeSheet(
  configId: string,
  sheet: Pick<HallkeeperSheetV2, "phases" | "timing" | "instructions">,
  checkedKeys: Iterable<string>,
  options: SummaryOptions = {},
): HallkeeperSheetSummary {
  const marked = new Set(checkedKeys);
  const rows = sheet.phases.flatMap((phase) => phase.zones.flatMap((zone) => zone.rows));
  const times = sheetTimes(sheet);
  return HallkeeperSheetSummarySchema.parse({
    configId,
    // Ready by can be the planner's final time as written in the layout's
    // metadata, which a row written outside the API may give with a UTC offset
    // the schema refuses (sheetTimes takes any time it can read). The board
    // gets the same instant, in UTC, as its other times come.
    readyBy: times.readyBy === null ? null : new Date(times.readyBy).toISOString(),
    eventStart: times.guestsIn,
    ...(options.setupFrom === true ? { setupFrom: times.setupFrom } : {}),
    total: rows.length,
    checked: rows.filter((row) => marked.has(row.key)).length,
  });
}
