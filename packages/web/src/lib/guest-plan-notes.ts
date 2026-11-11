import type { BatchObjectInput } from "../api/configurations.js";
import type { EditorObject } from "../stores/editor-store.js";

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
