import {
  HallkeeperSheetSummarySchema,
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
// ---------------------------------------------------------------------------

export function summarizeSheet(
  configId: string,
  sheet: Pick<HallkeeperSheetV2, "phases" | "timing">,
  checkedKeys: Iterable<string>,
): HallkeeperSheetSummary {
  const marked = new Set(checkedKeys);
  const rows = sheet.phases.flatMap((phase) => phase.zones.flatMap((zone) => zone.rows));
  return HallkeeperSheetSummarySchema.parse({
    configId,
    readyBy: sheet.timing?.setupBy ?? null,
    eventStart: sheet.timing?.eventStart ?? null,
    total: rows.length,
    checked: rows.filter((row) => marked.has(row.key)).length,
  });
}
