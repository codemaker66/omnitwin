// ---------------------------------------------------------------------------
// Notes handed to pieces as an edit sets them down (Replace carries each old
// table's note to the new table nearest it, card-dock spec §8.2, Q-16).
//
// Notes live on the editor's objects, and the placement → editor bridge
// (components/editor/EditorBridge.tsx) makes those objects synchronously,
// inside the placement write. A note set afterwards is a second undo step,
// since an entry that adds or removes objects never coalesces with one that
// updates them. So the notes ride in the same write: an edit opens a seed
// for the length of its write, and the bridge gives each piece its seeded
// note as it maps the piece. Taken in that write only; nothing lingers.
// ---------------------------------------------------------------------------

let seeds: ReadonlyMap<string, string> | null = null;

/** Runs `write` with `notes` (piece id → its note's whole text) seeded for the bridge, and closes the seed after. */
export function withNoteSeeds<T>(notes: ReadonlyMap<string, string>, write: () => T): T {
  const outer = seeds;
  seeds = notes.size === 0 ? outer : notes;
  try {
    return write();
  } finally {
    seeds = outer;
  }
}

/** The note an edit hands this piece in the write under way, or undefined to keep its own. */
export function seededNote(pieceId: string): string | undefined {
  return seeds?.get(pieceId);
}
