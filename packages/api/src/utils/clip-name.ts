// ---------------------------------------------------------------------------
// A person's name as the floor's records keep it. An account's name may run
// to 200 characters (users.name), but an observation, a request and its
// history, a message and its receipts keep 160: varchar(160) columns read
// through max(160) wire schemas. A longer name is clipped to fit, never
// refused: the tap or the step is what matters, and the user id beside the
// name records who.
//
// Both limits count characters as Unicode code points: PostgreSQL's varchar
// in a UTF8 database, and Zod 4's string max. So the clip counts code points,
// not UTF-16 units. It cuts between whole characters as a reader sees them
// (a flag, a skin tone or a family is one) and, where it cannot, between code
// points: it never leaves half of a surrogate pair, which PostgreSQL would
// keep as U+FFFD.
// ---------------------------------------------------------------------------

/** The longest name a floor record keeps, in characters. */
export const RECORD_NAME_MAX = 160;

/** Characters as a reader sees them. Made once; a runtime without it clips
 *  by code point instead. */
const graphemes: Intl.Segmenter | null = ((): Intl.Segmenter | null => {
  try {
    return new Intl.Segmenter("en", { granularity: "grapheme" });
  } catch {
    return null;
  }
})();

/** The name whole when it fits in `max` characters; otherwise the longest
 *  run of whole characters from its start that does. When not even its
 *  first character fits, or characters cannot be told apart, it keeps the
 *  first `max` code points. */
export function clipName(name: string, max: number = RECORD_NAME_MAX, characters: Intl.Segmenter | null = graphemes): string {
  // At most `max` UTF-16 units is at most `max` code points: the common case.
  if (name.length <= max) return name;
  const points = Array.from(name);
  if (points.length <= max) return name;
  const whole = characters === null ? "" : wholeCharacters(name, max, characters);
  return whole === "" ? points.slice(0, max).join("") : whole;
}

/** The longest run of whole characters from the start within `max` code
 *  points; empty when the first is already longer. */
function wholeCharacters(text: string, max: number, characters: Intl.Segmenter): string {
  let kept = "";
  let count = 0;
  for (const { segment } of characters.segment(text)) {
    const size = Array.from(segment).length;
    if (count + size > max) break;
    kept += segment;
    count += size;
  }
  return kept;
}
