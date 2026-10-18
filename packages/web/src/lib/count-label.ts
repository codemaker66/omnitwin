// ---------------------------------------------------------------------------
// count-label — one way to put a number in front of a noun.
//
// "1 issues", "1 seats placed" and "1 hotspots" read as careless to a
// veteran. Every count label in the planner goes through countLabel so the
// singular is right and large numbers carry the British thousands separator
// ("1,200 guests"). Irregular plurals are passed in ("1 person", "3 people").
// ---------------------------------------------------------------------------

/** The noun alone, singular for exactly one: `countNoun(1, "issue")` → "issue". */
export function countNoun(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

/** The number and its noun: `countLabel(1, "issue")` → "1 issue";
 *  `countLabel(1200, "guest")` → "1,200 guests". */
export function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count.toLocaleString("en-GB")} ${countNoun(count, singular, plural)}`;
}
