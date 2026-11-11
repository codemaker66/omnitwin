import type { BatchObjectInput } from "../api/configurations.js";
import type { EditorObject } from "../stores/editor-store.js";
import { getCatalogueItem } from "./catalogue.js";
import { describePieces } from "./editor-save-status.js";
import type { ChangedPiece } from "./layout-change-summary.js";

// ---------------------------------------------------------------------------
// A guest plan's notes, in a browser that is not shown them.
//
// The API gives a guest plan's notes only to the browser that made the plan
// (final review, TENANCY-3). Every other reader gets each piece without its
// note, and a piece that holds one says so (EditorObject.noteHeld). Two things
// follow for the planner (review of #375):
//
//   - a piece that holds a note the person cannot see is shown as holding
//     one, never as an empty note to write over (heldNoteIds, noteHeldOn);
//   - a save names, for each note it changes, the note that one replaces
//     (namingReplacedNotes). The API takes a changed or cleared note from a
//     browser it does not show notes to only when that name is right, which
//     is what lets the person go on writing, correct or take off a note they
//     wrote here: the autosave often stores a note half-typed.
//
// Both read the last document the server confirmed (baseObjects). The mark is
// the server's word, not the person's, and the scene rebuilds the working
// objects as pieces move; and a note is known to this browser exactly when
// the server has returned it here.
//
// A third thing follows (review of #388). A piece left out of a save is
// removed, and its note with it, and Undo cannot bring that note back: it
// returns the piece as a new one. So someone who cannot see a note never
// destroys it. In a browser the notes are kept from, a piece holding one is
// not taken by Replace or a fill, nor by a seat fewer, a smaller dance floor
// or a cleared floor, and it is not removed when the person asks for it to go
// (currentHeldNoteIds, and the lines at the foot of this file that say why).
// ---------------------------------------------------------------------------

/** The parts of the editor's state these read. */
export interface GuestPlanNoteFacts {
  readonly isPublicPreview: boolean;
  /** The open plan was read with its notes. */
  readonly notesIncluded: boolean;
  readonly objects: readonly EditorObject[];
  readonly baseObjects: readonly EditorObject[];
}

const NONE: ReadonlySet<string> = new Set<string>();
const heldIn = new WeakMap<readonly EditorObject[], ReadonlySet<string>>();

/**
 * The pieces holding a note this browser is not shown. None in a plan read
 * with its notes, and none in a layout that is not a guest plan: there the
 * mark means nothing.
 */
export function heldNoteIds(state: Pick<GuestPlanNoteFacts, "isPublicPreview" | "notesIncluded" | "baseObjects">): ReadonlySet<string> {
  if (!state.isPublicPreview || state.notesIncluded) return NONE;
  const known = heldIn.get(state.baseObjects);
  if (known !== undefined) return known;
  const held = new Set(state.baseObjects.filter((object) => object.noteHeld === true).map((object) => object.id));
  heldIn.set(state.baseObjects, held);
  return held;
}

/**
 * Whether this piece is to be shown as holding a note the person cannot see
 * or change here. A piece they have written on shows their own words instead
 * (work kept on the device can carry a note for a piece that has since come
 * to hold one): they can then read it and take it off, which the save needs.
 */
export function noteHeldOn(state: GuestPlanNoteFacts, objectId: string): boolean {
  if (!heldNoteIds(state).has(objectId)) return false;
  return (state.objects.find((object) => object.id === objectId)?.notes ?? "") === "";
}

/**
 * Whether the open document may go through the signed-in routes at all. The
 * signed-in save stores each piece's details as sent, so it is only for a
 * document that holds every note: any layout that is not a guest plan, and a
 * guest plan read with its notes. The planner opens a plan before the sign-in
 * has resolved, so venue staff read a guest plan through the public route,
 * without its notes; saved through the signed-in route, that copy would erase
 * them all. It stays on the public routes, which settle each note, for as long
 * as it is open.
 */
export function signedInRoutesSuit(state: Pick<GuestPlanNoteFacts, "isPublicPreview" | "notesIncluded">): boolean {
  return !state.isPublicPreview || state.notesIncluded;
}

/**
 * A fresh copy from a read that does not show this browser the plan's notes,
 * with the notes the server had already confirmed here put back on their
 * pieces. Such a read hides every note, the ones this browser wrote included,
 * so taken as it stands it forgets them, and the person's next words on their
 * own note are refused. `confirmed` is the document that read replaces (the
 * last confirmed one, or the base of work kept on this device, at the same
 * revision). A note is put back only on a piece the fresh copy says holds
 * one; the API still refuses a save naming a note the piece no longer holds.
 */
export function keepingConfirmedNotes(
  fresh: readonly EditorObject[],
  confirmed: readonly EditorObject[],
): readonly EditorObject[] {
  const known = new Map<string, string>();
  for (const object of confirmed) {
    if (object.notes.length > 0) known.set(object.id, object.notes);
  }
  if (known.size === 0) return fresh;
  return fresh.map((object) => {
    const { noteHeld, ...shown } = object;
    const note = noteHeld === true && object.notes.length === 0 ? known.get(object.id) : undefined;
    return note === undefined ? object : { ...shown, notes: note };
  });
}

/**
 * A guest plan's save batch (objects through editorToBatch, in order), with
 * each piece whose note differs from the one the server last confirmed here
 * naming that note. A piece the server confirmed no note for names nothing:
 * its note, if it has one, is new.
 */
export function namingReplacedNotes(
  batch: readonly BatchObjectInput[],
  objects: readonly EditorObject[],
  baseObjects: readonly EditorObject[],
): readonly BatchObjectInput[] {
  const confirmed = new Map<string, string>();
  for (const object of baseObjects) {
    if (object.notes.length > 0) confirmed.set(object.id, object.notes);
  }
  if (confirmed.size === 0) return batch;
  return batch.map((piece, index) => {
    const object = objects[index];
    const was = object === undefined ? undefined : confirmed.get(object.id);
    return was === undefined || was === object?.notes ? piece : { ...piece, replacesNote: was };
  });
}

// ---------------------------------------------------------------------------
// A save the API refuses for a held note (409 NOTE_HELD): it would have
// changed a note its sender had not shown it knows. The API does not say which
// piece, so the planner works out what it can from its own document.
// ---------------------------------------------------------------------------

/** The API's code for a save refused because it would change a note its sender was not shown. */
export const NOTE_HELD_CODE = "NOTE_HELD";

/**
 * The pieces on which the person's own words stand over a note this browser
 * is not shown (work kept on the device from before the piece held one, or
 * kept over a newer version that put one there). These are what a refused
 * save tried to change, and the person can take their words off again.
 */
export function ownWordsOverHeldNotes(state: GuestPlanNoteFacts): readonly EditorObject[] {
  const held = heldNoteIds(state);
  return held.size === 0 ? [] : state.objects.filter((object) => held.has(object.id) && object.notes !== "");
}

/**
 * The confirmed document with this browser's record of confirmed notes taken
 * out: each piece that held one says only that it holds a note. For a save
 * refused for a held note when no words of the person's stand over one. Then
 * the record itself is out of date: "Keep mine" carries the notes confirmed
 * at one revision onto a newer one, where someone else may have changed them,
 * and a save that names a note wrongly is refused every time. Without the
 * record the person's notes are shown as their own words again, a note they
 * left alone is confirmed afresh by the next save, and one they clear saves.
 * The same array when no note is recorded.
 */
export function forgettingConfirmedNotes(confirmed: readonly EditorObject[]): readonly EditorObject[] {
  if (!confirmed.some((object) => object.notes !== "")) return confirmed;
  return confirmed.map((object) => (object.notes === "" ? object : { ...object, notes: "", noteHeld: true }));
}

// ---------------------------------------------------------------------------
// The open plan's held notes, for the scene's stores and commands. The editor
// store owns the document and registers this reading; the placement store and
// the planner's libraries ask here, so none of them loads the editor store to
// find out (lib/card-stock's registerStoreStock is the same arrangement).
// ---------------------------------------------------------------------------

let heldNotesSource: () => ReadonlySet<string> = () => NONE;

/** The editor store's reading of heldNoteIds for the open plan. */
export function registerHeldNotes(read: () => ReadonlySet<string>): void {
  heldNotesSource = read;
}

/** The pieces of the open plan holding a note this browser is not shown; none when no plan is open. */
export function currentHeldNoteIds(): ReadonlySet<string> {
  return heldNotesSource();
}

// ---------------------------------------------------------------------------
// What the planner says of a held note. The words were decided by the release
// lead on 11 November 2026, for the owner to look at; change them here only.
// ---------------------------------------------------------------------------

/** In place of the note field. */
export const HELD_NOTE_LINE = "This piece has a note that cannot be shown or changed here.";

interface NamedPiece {
  readonly id: string;
  readonly label?: string;
  readonly catalogueItemId: string;
  readonly groupId: string | null;
}

function ownName(piece: NamedPiece): string {
  return (piece.label ?? "").trim();
}

/** What a piece is, as layout-change-summary's nounFor says it: any table is "table". */
function nounOf(piece: NamedPiece): string {
  const item = getCatalogueItem(piece.catalogueItemId);
  if (item === undefined) return "piece";
  return item.tableShape !== null ? "table" : item.name.toLowerCase();
}

function isTable(piece: NamedPiece): boolean {
  const item = getCatalogueItem(piece.catalogueItemId);
  return item !== undefined && item.tableShape !== null;
}

/**
 * How these lines know a piece: by its own name ("Table 3"); a chair or other
 * piece of a named table's group by that table's name, since that is what the
 * person can find; otherwise by what it is. A ChangedPiece, so several are
 * said as the planner says changed pieces anywhere (describePieces).
 */
export function heldNotePieceNamed(piece: NamedPiece, pieces: readonly NamedPiece[]): ChangedPiece {
  if (ownName(piece) !== "") return { label: ownName(piece), noun: nounOf(piece) };
  const tables = piece.groupId === null ? [] : pieces.filter((other) => other.groupId === piece.groupId && isTable(other) && ownName(other) !== "");
  const [table] = tables;
  if (tables.length === 1 && table !== undefined) return { label: ownName(table), noun: nounOf(table) };
  return { label: null, noun: nounOf(piece) };
}

/** One piece as a line names it: "Table 3", or "a table", "a lectern". */
export function heldNotePieceName(piece: NamedPiece, pieces: readonly NamedPiece[]): string {
  return describePieces([heldNotePieceNamed(piece, pieces)]);
}

/**
 * The piece these lines name among several holding a held note: one with a
 * name of its own if there is one, else the first.
 */
export function heldNotePieceToName<T extends NamedPiece>(held: readonly T[]): T | undefined {
  return held.find((piece) => ownName(piece) !== "") ?? held[0];
}

/**
 * The piece a refused save can be said to be about: the one piece on which
 * the person's own words stand over a held note, by name. Null when there is
 * none, or more than one: the API does not say which piece it refused.
 */
export function pieceNamedForRefusedSave(state: GuestPlanNoteFacts): string | null {
  const written = ownWordsOverHeldNotes(state);
  const [only] = written;
  if (written.length !== 1 || only === undefined) return null;
  const asNamed = (object: EditorObject): NamedPiece => ({
    id: object.id,
    catalogueItemId: object.assetDefinitionId,
    groupId: object.groupId,
    ...(object.label === undefined ? {} : { label: object.label }),
  });
  return heldNotePieceName(asNamed(only), state.objects.map(asNamed));
}

/** A change that did not happen because of one such piece: "<outcome>: <name> has a note that cannot be shown here." */
function refusedLine(outcome: string, name: string): string {
  return `${outcome}: ${name} has a note that cannot be shown here.`;
}

/** Replace's refusal: the selection holds such a piece, so nothing is replaced. */
export function nothingReplacedLine(name: string): string {
  return refusedLine("Nothing was replaced", name);
}

/** A fill's refusal, when it would clear such a piece from the floor. */
export function nothingFilledLine(name: string): string {
  return refusedLine("Nothing was filled", name);
}

/** A removal's refusal, when the one piece (or group) asked to go holds such a note. */
export function nothingRemovedLine(name: string): string {
  return refusedLine("Nothing was removed", name);
}

/** A seat taken from a table, when the chair that would go holds such a note. */
export function noSeatRemovedLine(name: string): string {
  return refusedLine("No seat was removed", name);
}

/** A dance floor made smaller, when a panel that would go holds such a note. */
export function danceFloorNotResizedLine(name: string): string {
  return refusedLine("The dance floor was not resized", name);
}

/** Clearing the floor, when a piece on it holds such a note. */
export function nothingClearedLine(name: string): string {
  return refusedLine("Nothing was cleared", name);
}

/**
 * Said after a change that went ahead round such pieces and left them where
 * they stood (a fill, a removal of several): one sentence, naming one piece
 * ("Table 3 stayed where it is, because it has a note that cannot be shown
 * here.") or listing several ("Tables 3, 5 and 8 stayed where they are,
 * because each has a note that cannot be shown here."). Null for none.
 */
export function stayedForNotesLine(kept: readonly ChangedPiece[]): string | null {
  if (kept.length === 0) return null;
  const names = describePieces(kept);
  const led = `${names.charAt(0).toUpperCase()}${names.slice(1)}`;
  return kept.length === 1
    ? `${led} stayed where it is, because it has a note that cannot be shown here.`
    : `${led} stayed where they are, because each has a note that cannot be shown here.`;
}
