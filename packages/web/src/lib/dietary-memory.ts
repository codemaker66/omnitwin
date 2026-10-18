import type { RememberedDietaryNote } from "@omnitwin/types";

// ---------------------------------------------------------------------------
// "Ask once, then remember" (Blake, 17 October 2026): the planner's side of a
// client's remembered allergy note, as pure decisions the Event details sheet
// and its tests share.
//
// The box beside the allergy note reads "Remember these for our next event?"
// and starts unticked. Once a note is remembered, the client's next layout at
// the venue is filled in from it and the box starts ticked, so the answer is
// asked once. Unticking a box that started ticked, and saving, removes the
// remembered note; emptying the note on one layout does not.
// ---------------------------------------------------------------------------

/** The page where a client sees and removes what is remembered. */
export const REMEMBERED_NOTES_PATH = "/account/allergy-notes";

/** Where the sheet stands on the remembered note. "off": the box is not
 *  offered (not the client's own layout, or not a client's account). */
export type MemoryStatus = "off" | "loading" | "ready" | "error";

export interface DietaryMemoryState {
  readonly status: MemoryStatus;
  /** The note remembered for this layout's venue, if any. */
  readonly remembered: RememberedDietaryNote | null;
  /** How the box stood when the sheet opened: the client's standing answer. */
  readonly initiallyTicked: boolean;
  readonly ticked: boolean;
  /** The note on this layout was filled in from the remembered one. */
  readonly prefilled: boolean;
}

export const MEMORY_OFF: DietaryMemoryState = {
  status: "off", remembered: null, initiallyTicked: false, ticked: false, prefilled: false,
};

/** The remembered note for a venue, from the account's list. */
export function rememberedForVenue(
  notes: readonly RememberedDietaryNote[],
  venueId: string,
): RememberedDietaryNote | null {
  return notes.find((note) => note.venueId === venueId) ?? null;
}

/**
 * A layout that has never had event details saved is the client's next
 * event: its note is filled in from the remembered one. A layout already
 * worked on is left as its owner saved it (they can fill it in by hand).
 */
export function shouldPrefill(remembered: RememberedDietaryNote | null, savedInstructionsExist: boolean): boolean {
  return remembered !== null && !savedInstructionsExist;
}

/**
 * The box starts ticked when the note on the layout is the remembered one
 * (or is about to be filled in from it); otherwise it starts unticked: the
 * first ask, or a layout carrying a different note.
 */
export function startsTicked(remembered: RememberedDietaryNote | null, savedNote: string, prefilling: boolean): boolean {
  if (remembered === null) return false;
  return prefilling || savedNote === remembered.otherAllergies;
}

export type MemoryStep = "remember" | "forget" | "none";

/**
 * What saving the sheet does to the remembered note.
 *   - Ticked: remember this note, unless it is already the remembered note
 *     last saved from this same layout. Saving it with another layout is its
 *     use, which restarts the unused period.
 *   - Unticked: remove the remembered note only if the box started ticked
 *     (the client took the tick away). Otherwise leave it as it is.
 *   - An empty note offers no box, and changes nothing remembered.
 */
export function memoryStepOnSave(memory: DietaryMemoryState, note: string, configId: string): MemoryStep {
  if (memory.status === "off" || memory.status === "loading") return "none";
  if (note.trim().length === 0) return "none";
  const remembered = memory.remembered;
  if (memory.ticked) {
    if (remembered === null) return "remember";
    if (remembered.otherAllergies !== note) return "remember";
    if (remembered.sourceLayout?.id !== configId) return "remember";
    return "none";
  }
  return memory.initiallyTicked && remembered !== null ? "forget" : "none";
}

/** The client changed the box since the sheet opened. */
export function memoryChoiceChanged(memory: DietaryMemoryState, note: string): boolean {
  if (memory.status === "off" || memory.status === "loading") return false;
  return note.trim().length > 0 && memory.ticked !== memory.initiallyTicked;
}

const LONG_DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });

/** "17 October 2026". */
export function longDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : LONG_DATE.format(date);
}
