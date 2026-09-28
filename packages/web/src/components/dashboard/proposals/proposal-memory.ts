import type { ComposerDraft, KeptVersion } from "./proposals-desk-format.js";

// ---------------------------------------------------------------------------
// What a booker has written on the Proposals desk this visit, per person and
// proposal: the words in a composer not yet saved, and the copies kept of
// words that did not save. It lives as long as the page does, so moving to
// another proposal, or to another part of the dashboard, loses nothing, and a
// save that answers after the desk was left still finds its words. A reload
// starts afresh, so the page asks before one while any words are here. Kept
// per person, so an account signed in after another never reads theirs.
// ---------------------------------------------------------------------------

/** The words in one proposal's composer while they differ from where they
 *  started: which composer wrote them, and the version they started from. */
export interface WrittenDraft {
  readonly composer: number;
  readonly start: number;
  readonly draft: ComposerDraft;
}

export type KeptCopies = Readonly<Record<string, readonly KeptVersion[]>>;

const NONE: KeptCopies = {};
const drafts = new Map<string, WrittenDraft>();
const kept = new Map<string, KeptCopies>();
const listeners = new Set<() => void>();

function key(person: string, proposalId: string): string {
  return `${person}\u0000${proposalId}`;
}

// A reload or a closed tab would take every word here, on screen or not: the
// browser asks first while there are any.
let guarding = false;
function protect(event: BeforeUnloadEvent): void {
  event.preventDefault();
}
function guardUnload(): void {
  const unsaved = drafts.size > 0 || kept.size > 0;
  if (unsaved === guarding) return;
  guarding = unsaved;
  if (unsaved) window.addEventListener("beforeunload", protect);
  else window.removeEventListener("beforeunload", protect);
}

export function recallDraft(person: string, proposalId: string): WrittenDraft | null {
  return drafts.get(key(person, proposalId)) ?? null;
}

/** Remembers the words, or forgets them when given null. */
export function rememberDraft(person: string, proposalId: string, written: WrittenDraft | null): void {
  if (written === null) drafts.delete(key(person, proposalId));
  else drafts.set(key(person, proposalId), written);
  guardUnload();
}

/** The person's kept copies, the same object until they change. */
export function recallKept(person: string): KeptCopies {
  return kept.get(person) ?? NONE;
}

/** Changes the person's kept copies, whether or not a desk is showing them. */
export function updateKept(person: string, update: (current: KeptCopies) => KeptCopies): void {
  const current = recallKept(person);
  const next = update(current);
  if (next === current) return;
  if (Object.keys(next).length === 0) kept.delete(person);
  else kept.set(person, next);
  guardUnload();
  for (const listener of listeners) listener();
}

/** Tells a desk when kept copies change; returns how to stop. */
export function subscribeKept(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Forgets everything; for tests, which share one page. */
export function forgetProposalMemory(): void {
  drafts.clear();
  kept.clear();
  guardUnload();
  for (const listener of listeners) listener();
}
