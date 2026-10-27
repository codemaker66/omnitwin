import type { AIDraftCommitmentKind } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// What was taken out of an AI draft (Plan 19, L6): a sentence that gave a
// price, said whether a date or room is free, or said how many a room holds.
// Only the venue's team confirms these, so the server takes them out of the
// model's words and the draft says which; this says it in words.
// ---------------------------------------------------------------------------

const WITHHELD_WORDS: Readonly<Record<AIDraftCommitmentKind, string>> = {
  price: "give a price",
  availability: "say whether a date or room is free",
  capacity: "say how many a room holds",
};

/** What was taken out of an AI draft, in a sentence; null when nothing was.
 *  The check reads the shape of the words, so it says what the words seemed
 *  to do, not what the AI meant, and not how many sentences went. Only the
 *  venue's team confirms these (L6). */
export function withheldWords(kinds: readonly AIDraftCommitmentKind[] | undefined): string | null {
  if (kinds === undefined || kinds.length === 0) return null;
  const parts = kinds.map((kind) => WITHHELD_WORDS[kind]);
  const last = parts[parts.length - 1] ?? "";
  const list = parts.length === 1 ? last : `${parts.slice(0, -1).join(", ")} or ${last}`;
  return `Wording that seemed to ${list} was taken out, as only the team confirms ${parts.length === 1 ? "that" : "these"}.`;
}
