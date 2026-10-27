import type { AIDraftCommitmentKind } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// What was taken out of an AI draft (Plan 19, L6): a sentence that gave a
// price, said whether a date or room is free, or said how many a room holds.
// Only the venue's team confirms these, so the server takes them out of the
// model's words and the draft says which; this says it in words.
// ---------------------------------------------------------------------------

const WITHHELD_WORDS: Readonly<Record<AIDraftCommitmentKind, string>> = {
  price: "gave a price",
  availability: "said whether a date or room is free",
  capacity: "said how many a room holds",
};

/** What was taken out of an AI draft, in a sentence; null when nothing was.
 *  Only the venue's team confirms a price, availability or capacity (L6). */
export function withheldWords(kinds: readonly AIDraftCommitmentKind[]): string | null {
  if (kinds.length === 0) return null;
  const parts = kinds.map((kind) => WITHHELD_WORDS[kind]);
  const last = parts[parts.length - 1] ?? "";
  const list = parts.length === 1 ? last : `${parts.slice(0, -1).join(", ")} and ${last}`;
  return `It ${list}, which only the team confirms, so ${kinds.length === 1 ? "that part was" : "those parts were"} taken out.`;
}
