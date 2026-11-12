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
//
// The API does not refuse a save that leaves such a piece out (final review of
// #388), so the planner holds that line itself, at the one place every save
// passes: a document that has lost such a piece takes it back before it is
// sent, and the planner says the piece stayed (heldNotePiecesToPutBack).
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
 * So does a piece whose note this browser carried onto a newer version
 * (keepingConfirmedNotes): the note is theirs to read, change or clear, and
 * a cleared one is an empty note, not one kept from them.
 */
export function noteHeldOn(state: GuestPlanNoteFacts, objectId: string): boolean {
  if (!heldNoteIds(state).has(objectId)) return false;
  if ((state.baseObjects.find((object) => object.id === objectId)?.notes ?? "") !== "") return false;
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
 *
 * `carried` is "Keep mine": the notes were confirmed at an older revision and
 * are put on a newer one, where someone else may have rewritten them. Such a
 * note is what this browser last knew, not the server's word, so the piece
 * keeps its mark beside it: it counts as holding a note this browser is not
 * shown (nothing may take the piece) until a save confirms the note, and the
 * person still reads and changes their own words on it. A note that came with
 * its mark stays so through a reload.
 */
export function keepingConfirmedNotes(
  fresh: readonly EditorObject[],
  confirmed: readonly EditorObject[],
  carried = false,
): readonly EditorObject[] {
  const known = new Map<string, EditorObject>();
  for (const object of confirmed) {
    if (object.notes.length > 0) known.set(object.id, object);
  }
  if (known.size === 0) return fresh;
  return fresh.map((object) => {
    const { noteHeld, ...shown } = object;
    const was = noteHeld === true && object.notes.length === 0 ? known.get(object.id) : undefined;
    if (was === undefined) return object;
    return carried || was.noteHeld === true ? { ...object, notes: was.notes } : { ...shown, notes: was.notes };
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
 * The API's code for a save refused because it leaves out a piece that holds
 * a note its sender was not shown (409): the API's own backstop to
 * heldNotePiecesToPutBack, which keeps such a save from ever being sent.
 */
export const HELD_PIECE_OMITTED_CODE = "HELD_PIECE_OMITTED";

/**
 * Whether a save was refused for a held note, by either code. Every save
 * surface then says the refusal in the API's own words, as they arrive, and
 * offers no Retry: the same save meets the same refusal. Only NOTE_HELD is
 * ever sent again without a recorded note (editor-store
 * saveLeavingOutOfDateNotes); a save refused for a left-out piece is not.
 */
export function refusedOverHeldNote(code: string | null): boolean {
  return code === NOTE_HELD_CODE || code === HELD_PIECE_OMITTED_CODE;
}

/**
 * The save that goes before one which removes a piece carrying this browser's
 * own note, where the plan's notes are kept from it. The API cannot tell that
 * note from one this browser is not shown, and refuses a save that leaves the
 * piece out (HELD_PIECE_OMITTED). The person can read the note and has removed
 * the piece, so the note is cleared first, by name, as they could by hand:
 * this is the confirmed document as the server holds it, with the note taken
 * off each such piece and nothing else changed. A piece that holds a note this
 * browser is not shown, or a note carried unconfirmed, says nothing of its
 * note here, which keeps it; such a piece is never among the removed
 * (heldNotePiecesToPutBack). Null when no removed piece carries a note the
 * server confirmed to this browser.
 */
export function batchClearingOwnNotesOfRemovedPieces(
  confirmed: readonly EditorObject[],
  objects: readonly EditorObject[],
  toBatch: (object: EditorObject) => BatchObjectInput,
): readonly BatchObjectInput[] | null {
  const going = ownNoteRemoved(objects);
  if (!confirmed.some(going)) return null;
  return confirmed.map((object) => {
    if (going(object)) return { ...toBatch({ ...object, notes: "" }), replacesNote: object.notes };
    return object.noteHeld === true ? toBatch({ ...object, notes: "" }) : toBatch(object);
  });
}

/** Whether a piece of the confirmed document carries a note the server confirmed to this browser and `objects` has lost it. */
function ownNoteRemoved(objects: readonly EditorObject[]): (object: EditorObject) => boolean {
  const present = new Set(objects.map((object) => object.id));
  return (object) => object.notes !== "" && object.noteHeld !== true && !present.has(object.id);
}

/**
 * The confirmed document once the removal of pieces carrying this browser's
 * own note is given up, because the save that clears those notes
 * (batchClearingOwnNotesOfRemovedPieces) was refused for the document itself,
 * not for a newer version: every later save would meet the same refusal
 * while the removal waited (delta review of #388, R3 and A6). Each such piece
 * is marked as holding a note this browser is not shown, so the save takes
 * it back (heldNotePiecesToPutBack) and goes without the clearing step.
 * `notTheirs`: the refusal was for a held note, so the note on record may no
 * longer be the one the piece holds, and it is no longer on record. Otherwise
 * it is still theirs, carried until a save confirms it, as "Keep mine"
 * carries one (keepingConfirmedNotes).
 */
export function givingUpOwnNoteRemoval(
  confirmed: readonly EditorObject[],
  objects: readonly EditorObject[],
  notTheirs: boolean,
): readonly EditorObject[] {
  const going = ownNoteRemoved(objects);
  return confirmed.map((object) => {
    if (!going(object)) return object;
    return notTheirs ? { ...object, notes: "", noteHeld: true } : { ...object, noteHeld: true };
  });
}

/**
 * The pieces on which the person's own words stand over a note this browser
 * is not shown (work kept on the device from before the piece held one, or
 * kept over a newer version that put one there). These are what a refused
 * save tried to change, and the person can take their words off again. A
 * piece whose note this browser carried is not one of them: its words name
 * the note they replace, and are refused only if that note is out of date.
 */
export function ownWordsOverHeldNotes(state: GuestPlanNoteFacts): readonly EditorObject[] {
  const held = heldNoteIds(state);
  if (held.size === 0) return [];
  const carried = new Set(state.baseObjects.filter((object) => object.notes !== "").map((object) => object.id));
  return state.objects.filter((object) => held.has(object.id) && object.notes !== "" && !carried.has(object.id));
}

/**
 * The notes this browser has on record, by piece: the ones a save sends or
 * names, and so the only ones a refusal for a held note can be about when no
 * words of the person's stand over one. One of them is then out of date:
 * "Keep mine" carries the notes confirmed at one revision onto a newer one,
 * where someone else may have rewritten them, and a save that sends or names
 * a note wrongly is refused every time (editor-store saveLeavingOutOfDateNotes).
 */
export function recordedNotes(confirmed: readonly EditorObject[]): ReadonlyMap<string, string> {
  const recorded = new Map<string, string>();
  for (const object of confirmed) {
    if (object.notes !== "") recorded.set(object.id, object.notes);
  }
  return recorded;
}

/**
 * The working pieces after a save that landed by leaving the notes in
 * `outOfDate` to the server (piece id to the words this browser had on record
 * for it: the piece holds other words now). `working` is the document to go
 * on with (the server's answer, or the work done while the save was in
 * flight) and `theirs` the person's pieces as they stand. The recorded words
 * come off the piece: they are not its note any more, and it is shown as
 * holding one. Words the person had put in their place stay on it, theirs to
 * read and to take off: they stand over a note this browser is not shown, and
 * no save takes them. A note they had cleared stays cleared on screen, and
 * the piece shows the note it holds. Either change was refused, not saved
 * (notesRefusedOnLeaving). The same array when no note was left.
 */
export function afterLeavingOutOfDateNotes(
  working: readonly EditorObject[],
  theirs: readonly EditorObject[],
  outOfDate: ReadonlyMap<string, string>,
): readonly EditorObject[] {
  if (outOfDate.size === 0) return working;
  const words = new Map(theirs.filter((object) => outOfDate.has(object.id)).map((object) => [object.id, object.notes]));
  return working.map((object) => {
    const recorded = outOfDate.get(object.id);
    if (recorded === undefined) return object;
    const now = words.get(object.id) ?? "";
    const notes = now === recorded ? "" : now;
    return object.notes === notes ? object : { ...object, notes };
  });
}

/**
 * Of the person's pieces (`theirs`), the ones whose note a save left to the
 * server as out of date (`outOfDate`, as for afterLeavingOutOfDateNotes) and
 * which they had changed or cleared: someone else had rewritten that note, so
 * the change was not made. Such a save is refused for them, and never said to
 * have saved (delta review of #388 at 713dc3f1, R1).
 */
export function notesRefusedOnLeaving(
  theirs: readonly EditorObject[],
  outOfDate: ReadonlyMap<string, string>,
): readonly EditorObject[] {
  if (outOfDate.size === 0) return [];
  return theirs.filter((object) => {
    const recorded = outOfDate.get(object.id);
    return recorded !== undefined && object.notes !== recorded;
  });
}

// ---------------------------------------------------------------------------
// The open plan's held notes, for the scene's stores and commands. The editor
// store owns the document and registers this reading; the placement store and
// the planner's libraries ask here, so none of them loads the editor store to
// find out (lib/card-stock's registerStoreStock is the same arrangement).
// ---------------------------------------------------------------------------

let heldNotesSource: () => ReadonlySet<string> = () => NONE;
let carriedNotesSource: () => ReadonlySet<string> = () => NONE;

/** The editor store's reading of heldNoteIds, and of carriedNoteIds, for the open plan. */
export function registerHeldNotes(read: () => ReadonlySet<string>, carried: () => ReadonlySet<string> = () => NONE): void {
  heldNotesSource = read;
  carriedNotesSource = carried;
}

/** The pieces of the open plan holding a note this browser is not shown; none when no plan is open. */
export function currentHeldNoteIds(): ReadonlySet<string> {
  return heldNotesSource();
}

const carriedIn = new WeakMap<readonly EditorObject[], ReadonlySet<string>>();

/**
 * Of the pieces counted as holding a note this browser is not shown, those
 * whose note is its own: carried onto a newer version by "Keep mine" and not
 * yet confirmed by a save (keepingConfirmedNotes). The person can read that
 * note, so a refusal says it is still being saved, not that it cannot be
 * shown (noteStillSavingLine).
 */
export function carriedNoteIds(state: Pick<GuestPlanNoteFacts, "isPublicPreview" | "notesIncluded" | "baseObjects">): ReadonlySet<string> {
  if (heldNoteIds(state).size === 0) return NONE;
  const known = carriedIn.get(state.baseObjects);
  if (known !== undefined) return known;
  const carried = new Set(state.baseObjects.filter((object) => object.noteHeld === true && object.notes !== "").map((object) => object.id));
  carriedIn.set(state.baseObjects, carried);
  return carried;
}

/** Those pieces of the open plan; none when no plan is open. */
export function currentCarriedNoteIds(): ReadonlySet<string> {
  return carriedNotesSource();
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
  /** Where it stands, when the caller knows: which of several tables is its own. */
  readonly x?: number;
  readonly z?: number;
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

/** What a piece at a table is called there: any chair is "chair". */
function nounAtTable(piece: NamedPiece): string {
  return getCatalogueItem(piece.catalogueItemId)?.category === "chair" ? "chair" : nounOf(piece);
}

/** The named table of the piece's group that stands nearest it: its own table, also in an old group of several. */
function tableToFindBy(piece: NamedPiece, pieces: readonly NamedPiece[]): NamedPiece | undefined {
  if (piece.groupId === null || isTable(piece)) return undefined;
  const away = (table: NamedPiece): number => Math.hypot((table.x ?? 0) - (piece.x ?? 0), (table.z ?? 0) - (piece.z ?? 0));
  return pieces
    .filter((other) => other.groupId === piece.groupId && isTable(other) && ownName(other) !== "")
    .reduce<NamedPiece | undefined>((nearest, table) => (nearest === undefined || away(table) < away(nearest) ? table : nearest), undefined);
}

/**
 * How these lines know a piece: by its own name ("Table 3"); a chair or other
 * piece of a named table's group by that table, where the person can find it
 * ("a chair at Table 3": the table's own note panel shows nothing held, so the
 * table's name alone would send them to the wrong piece); otherwise by what
 * it is. A ChangedPiece, so several are said as the planner says changed
 * pieces anywhere (describePieces). A piece known by its table is one phrase
 * per table, never gathered: "a chair at Table 1 and a chair at Table 3"
 * (delta review of #388 at 713dc3f1, C1).
 */
export function heldNotePieceNamed(piece: NamedPiece, pieces: readonly NamedPiece[]): ChangedPiece {
  if (ownName(piece) !== "") return { label: ownName(piece), noun: nounOf(piece) };
  const table = tableToFindBy(piece, pieces);
  if (table === undefined) return { label: null, noun: nounOf(piece) };
  const what = describePieces([{ label: null, noun: nounAtTable(piece) }]);
  return { label: `${what} at ${ownName(table)}`, noun: nounOf(piece), asWritten: true };
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
 * The piece a save refused for a held note (the API's own sentence) can be
 * said to be about: the one piece on which the person's own words stand over
 * a held note, by name. Null when there is none, or more than one: the API
 * does not say which piece it refused. A refused clear says its piece in its
 * own sentence (refusedClearsLine).
 */
export function pieceNamedForRefusedSave(state: GuestPlanNoteFacts): string | null {
  const written = ownWordsOverHeldNotes(state);
  const [only] = written;
  if (written.length !== 1 || only === undefined) return null;
  // It leads its line: "A chair at Table 3: ...".
  return leading(heldNotePieceName(asNamed(only), state.objects.map(asNamed)));
}

/** A piece's name where it starts a sentence: "A chair at Table 3". */
function leading(name: string): string {
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

/**
 * What the planner says of the person's clear of a note the API refused,
 * because someone else had rewritten that note (editor-store
 * noteClearsRefused): one sentence a piece, each named as these lines name a
 * piece ("A chair at Table 1's note was not removed: ..."). Null for none.
 */
export function refusedClearsLine(state: { readonly objects: readonly EditorObject[]; readonly noteClearsRefused: readonly string[] }): string | null {
  if (state.noteClearsRefused.length === 0) return null;
  const among = state.objects.map(asNamed);
  const said = state.objects
    .filter((object) => state.noteClearsRefused.includes(object.id))
    .map((object) => noteNotRemovedLine(leading(heldNotePieceName(asNamed(object), among))));
  return said.length === 0 ? null : said.join(" ");
}

/** A piece of the document as these lines name pieces. */
function asNamed(object: EditorObject): NamedPiece {
  return {
    id: object.id,
    catalogueItemId: object.assetDefinitionId,
    groupId: object.groupId,
    x: object.positionX,
    z: object.positionZ,
    ...(object.label === undefined ? {} : { label: object.label }),
  };
}

/**
 * Pieces of the document as these lines name them, among `among`: one name
 * for each piece that stands alone and one for each group, since a table and
 * its chairs stay or go as one and are found under the table's name.
 */
export function heldNoteObjectsNamed(pieces: readonly EditorObject[], among: readonly EditorObject[]): readonly ChangedPiece[] {
  const all = among.map(asNamed);
  const units = new Map<string, NamedPiece[]>();
  for (const piece of pieces.map(asNamed)) {
    const key = piece.groupId ?? `piece:${piece.id}`;
    const unit = units.get(key);
    if (unit === undefined) units.set(key, [piece]);
    else unit.push(piece);
  }
  return [...units.values()].flatMap((unit) => {
    const named = heldNotePieceToName(unit);
    return named === undefined ? [] : [heldNotePieceNamed(named, all)];
  });
}

/** The same as one phrase: "Table 3", "Tables 3 and 5", "a table". */
export function heldNoteObjectsName(pieces: readonly EditorObject[], among: readonly EditorObject[]): string {
  return describePieces(heldNoteObjectsNamed(pieces, among));
}

/**
 * What a document must take back before it is saved. `from` is the document
 * the save is made against (the last one the server confirmed), and a piece
 * of it left out of the save is removed, with its note. So each piece of
 * `from` that holds a note this browser is not shown, and that `objects`
 * lacks, goes back as the server sent it, with the rest of its group that
 * `objects` lacks too: a table keeps its chairs. `held` are the note holders
 * among them, to be named. Nothing in a plan read with its notes, or in a
 * layout that is not a guest plan.
 */
export function heldNotePiecesToPutBack(
  state: Pick<GuestPlanNoteFacts, "isPublicPreview" | "notesIncluded">,
  from: readonly EditorObject[],
  objects: readonly EditorObject[],
): { readonly held: readonly EditorObject[]; readonly pieces: readonly EditorObject[] } {
  if (signedInRoutesSuit(state)) return { held: [], pieces: [] };
  const present = new Set(objects.map((object) => object.id));
  const held = from.filter((object) => object.noteHeld === true && !present.has(object.id));
  if (held.length === 0) return { held, pieces: held };
  const holders = new Set(held.map((object) => object.id));
  const groups = new Set(held.flatMap((object) => (object.groupId === null ? [] : [object.groupId])));
  const pieces = from.filter((object) => !present.has(object.id)
    && (holders.has(object.id) || (object.groupId !== null && groups.has(object.groupId))));
  return { held, pieces };
}

/**
 * The pieces holding a note this browser is not shown that are in the working
 * document and would not be in `next`: what a change of the document to
 * `next` (a step back or forward) would take away.
 */
export function heldNotePiecesDropped(state: GuestPlanNoteFacts, next: readonly EditorObject[]): readonly EditorObject[] {
  const held = heldNoteIds(state);
  if (held.size === 0) return [];
  const staying = new Set(next.map((object) => object.id));
  return state.objects.filter((object) => held.has(object.id) && !staying.has(object.id));
}

/** A change that did not happen because of one such piece: "<outcome>: <name> has a note that cannot be shown here." */
function refusedLine(outcome: string, name: string): string {
  return `${outcome}: ${name} has a note that cannot be shown here.`;
}

/** The same for one piece or several: "<outcome>: Tables 3 and 5 have notes that cannot be shown here." */
function refusedForPiecesLine(outcome: string, pieces: readonly ChangedPiece[]): string {
  return pieces.length === 1
    ? refusedLine(outcome, describePieces(pieces))
    : `${outcome}: ${describePieces(pieces)} have notes that cannot be shown here.`;
}

/** Undo's refusal: the step back would take such pieces away. The whole step is refused. */
export function nothingUndoneLine(pieces: readonly ChangedPiece[]): string {
  return refusedForPiecesLine("Nothing was undone", pieces);
}

/** Redo's refusal: the step forward would take such pieces away. The whole step is refused. */
export function nothingRedoneLine(pieces: readonly ChangedPiece[]): string {
  return refusedForPiecesLine("Nothing was redone", pieces);
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

/**
 * A removal's refusal when every note in the way is the person's own, carried
 * and not yet confirmed (carriedNoteIds): they can read it, so "cannot be
 * shown here" would contradict the screen. Ruled 12 November 2026.
 */
export function noteStillSavingLine(pieces: readonly ChangedPiece[]): string {
  const names = describePieces(pieces);
  return pieces.length === 1
    ? `Nothing was removed: the note on ${names} is still being saved. Try again once it has saved.`
    : `Nothing was removed: the notes on ${names} are still being saved. Try again once they have saved.`;
}

/**
 * A clear of the person's own note that was not made, because someone else
 * had changed that note since (a save refused for a held note: the API's own
 * sentence would ask them to clear what they have cleared). Ruled 12 November
 * 2026 (C3 on #388). `name` leads: "Table 3", "A chair at Table 1".
 */
export function noteNotRemovedLine(name: string): string {
  return `${name}'s note was not removed: it was changed somewhere else, and that note cannot be shown here.`;
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
