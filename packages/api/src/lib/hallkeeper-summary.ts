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
// That start goes as setupFrom, so the board can say when the window leaves
// no time to set the room, on the sheet's own rule (sheetIntervals).
// ---------------------------------------------------------------------------

export function summarizeSheet(
  configId: string,
  sheet: Pick<HallkeeperSheetV2, "phases" | "timing" | "instructions">,
  checkedKeys: Iterable<string>,
): HallkeeperSheetSummary {
  const marked = new Set(checkedKeys);
  const rows = sheet.phases.flatMap((phase) => phase.zones.flatMap((zone) => zone.rows));
  const times = sheetTimes(sheet);
  return HallkeeperSheetSummarySchema.parse({
    configId,
    readyBy: times.readyBy,
    eventStart: times.guestsIn,
    setupFrom: times.setupFrom,
    total: rows.length,
    checked: rows.filter((row) => marked.has(row.key)).length,
  });
}
