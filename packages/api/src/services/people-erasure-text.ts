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

/**
 * The names and addresses to take out of text: trimmed, distinct regardless
 * of case, two letters or longer (a lone initial would match too much), and
 * longest first.
 */
export function namesToErase(values: readonly (string | null | undefined)[]): readonly string[] {
  const letters = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const seen = new Map<string, string>();
  for (const value of values) {
    const name = value?.trim().replace(/\s+/gu, " ") ?? "";
    if ([...letters.segment(name)].length < 2) continue;
    const key = name.toLowerCase();
    if (!seen.has(key)) seen.set(key, name);
  }
  return [...seen.values()].sort((a, b) => b.length - a.length);
}

/**
 * The text with every whole-word occurrence of the names replaced by
 * "Erased", case-insensitively, and runs of "Erased" left by a name in parts
 * ("Morag" then "Smith") joined into one. Null and text without a name come
 * back unchanged (the same string), so callers can tell nothing changed.
 */
export function withoutNames(text: string | null, names: readonly string[]): string | null {
  if (text === null || names.length === 0) return text;
  const alternatives = names.map((name) => escapeForPattern(name).replace(/ /gu, "\\s+")).join("|");
  const pattern = new RegExp(`${WORD_EDGE_BEFORE}(?:${alternatives})${WORD_EDGE_AFTER}`, "giu");
  if (!pattern.test(text)) return text;
  pattern.lastIndex = 0;
  return text
    .replace(pattern, ERASED_TEXT)
    .replace(new RegExp(`${ERASED_TEXT}(?:[\\s,&]+${ERASED_TEXT})+`, "gu"), ERASED_TEXT);
}
