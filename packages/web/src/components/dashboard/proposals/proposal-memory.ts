import type { ComposerDraft, KeptVersion } from "./proposals-desk-format.js";

// ---------------------------------------------------------------------------
// What a booker has written on the Proposals desk this visit, per person and
// proposal: the words in a composer not yet saved, and the copies kept of
// words that did not save. It lives as long as the page does, so moving to
// another proposal, or to another part of the dashboard, loses nothing; a
// reload starts afresh, and the page asks before one while words are unsaved.
// Kept per person, so an account signed in after another never reads theirs.
// ---------------------------------------------------------------------------

/** The words in one proposal's composer while they differ from where they
 *  started: which composer wrote them, and the version they started from. */
export interface WrittenDraft {
  readonly composer: number;
  readonly start: number;
  readonly draft: ComposerDraft;
}

export type KeptCopies = Readonly<Record<string, readonly KeptVersion[]>>;

const drafts = new Map<string, WrittenDraft>();
const kept = new Map<string, KeptCopies>();

function key(person: string, proposalId: string): string {
  return `${person}\u0000${proposalId}`;
}

export function recallDraft(person: string, proposalId: string): WrittenDraft | null {
  return drafts.get(key(person, proposalId)) ?? null;
}

/** Remembers the words, or forgets them when given null. */
export function rememberDraft(person: string, proposalId: string, written: WrittenDraft | null): void {
  if (written === null) drafts.delete(key(person, proposalId));
  else drafts.set(key(person, proposalId), written);
}

export function recallKept(person: string): KeptCopies {
  return kept.get(person) ?? {};
}

export function rememberKept(person: string, copies: KeptCopies): void {
  if (Object.keys(copies).length === 0) kept.delete(person);
  else kept.set(person, copies);
}

/** Forgets everything; for tests, which share one page. */
export function forgetProposalMemory(): void {
  drafts.clear();
  kept.clear();
}
