// ---------------------------------------------------------------------------
// Free text that names an erased person (release audit people-privacy-5).
//
// Staff-facing rows the venue keeps after an erasure (a deal, a released hold
// in the Diary, its event, a proposal) were titled from the enquiry, for
// example "Wedding — Morag Smith" or "morag@example.com — Dinner". The row
// stays, because it is the venue's own record of work done; the person's name
// and addresses leave its text. Only whole words are replaced, so "Al" never
// turns "Hall" into "HErased", and the longest names go first, so "Morag
// Smith" becomes one "Erased", not two.
// ---------------------------------------------------------------------------

export const ERASED_TEXT = "Erased";

/** Letters and digits in any script: a name only matches as a whole word. */
const WORD_EDGE_BEFORE = "(?<![\\p{L}\\p{N}])";
const WORD_EDGE_AFTER = "(?![\\p{L}\\p{N}])";

function escapeForPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** Whether the value is an email address (matched in any case). */
export function isAddress(value: string): boolean {
  return value.includes("@");
}

/**
 * The names and addresses to take out of text, longest first.
 *   - A name is a full name: two words or more, each of two letters or more
 *     once its full stop is set aside ("Isla Erasable", "M. Erasable" is not).
 *     A single word ("May", "Will", "Rose") is a word in other people's
 *     sentences too, and an initial matches far too much.
 *   - Names are kept in every casing they were written in, because a name
 *     only matches as written: "isla erasable" typed into an enquiry is
 *     reworded where it was copied, beside "Isla Erasable" on the record.
 *   - Addresses are matched in any case, so one lower-cased copy each.
 */
export function namesToErase(values: readonly (string | null | undefined)[]): readonly string[] {
  const letters = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const long = (word: string): boolean => [...letters.segment(word.replace(/\.$/u, ""))].length >= 2;
  const seen = new Set<string>();
  for (const value of values) {
    const name = value?.trim().replace(/\s+/gu, " ") ?? "";
    if (isAddress(name)) {
      if (long(name)) seen.add(name.toLowerCase());
      continue;
    }
    const words = name.split(" ");
    if (words.length >= 2 && words.every(long)) seen.add(name);
  }
  return [...seen].sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
}

/** A cheap SQL-side test before the exact one: does the text hold any of the
 *  names, in any case, anywhere? Every row withoutNames would change passes. */
export function mentionPatterns(names: readonly string[]): readonly string[] {
  return names.map((name) => `%${name.toLowerCase().replace(/[\\%_]/gu, "\\$&").replace(/ /gu, "%")}%`);
}

function wholeWords(names: readonly string[], flags: string): RegExp | null {
  if (names.length === 0) return null;
  const alternatives = names.map((name) => escapeForPattern(name).replace(/ /gu, "\\s+")).join("|");
  return new RegExp(`${WORD_EDGE_BEFORE}(?:${alternatives})${WORD_EDGE_AFTER}`, flags);
}

/**
 * The text with every whole-word occurrence of the names replaced by
 * "Erased", and runs of "Erased" left by a name in parts joined into one.
 * A name matches as written (capitals and all), so a client called "Will
 * Smith" never touches "will call back"; an address matches in any case.
 * Null and text without a name come back unchanged (the same string), so
 * callers can tell nothing changed.
 */
export function withoutNames(text: string | null, names: readonly string[]): string | null {
  if (text === null || names.length === 0) return text;
  const patterns = [
    wholeWords(names.filter((name) => !isAddress(name)), "gu"),
    wholeWords(names.filter(isAddress), "giu"),
  ].flatMap((pattern) => (pattern === null ? [] : [pattern]));
  if (!patterns.some((pattern) => pattern.test(text))) return text;
  let rewritten = text;
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    rewritten = rewritten.replace(pattern, ERASED_TEXT);
  }
  return rewritten.replace(new RegExp(`${ERASED_TEXT}(?:[\\s,&]+${ERASED_TEXT})+`, "gu"), ERASED_TEXT);
}
