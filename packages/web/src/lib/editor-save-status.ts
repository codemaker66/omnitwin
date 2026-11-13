import type { ChangedPiece, LayoutChangeSummary } from "./layout-change-summary.js";

export type EditorSaveStatus = "idle" | "unsaved" | "saving" | "saved" | "failed" | "offline";

export interface EditorSaveStatusInput {
  readonly isDirty: boolean;
  readonly isSaving: boolean;
  readonly saveError: string | null;
  readonly lastSavedAt: Date | null;
  /** Present only after a configuration has been loaded or created on the server. */
  readonly configId?: string | null;
  readonly isOnline?: boolean;
}

export interface EditorSaveStatusCopy {
  readonly label: string;
  readonly shortLabel: string;
  readonly description: string;
}

export function deriveEditorSaveStatus(input: EditorSaveStatusInput): EditorSaveStatus {
  if (input.isSaving) return "saving";
  if (input.saveError !== null) return "failed";
  if (input.isOnline === false) return "offline";
  if (input.isDirty) return "unsaved";
  if (input.lastSavedAt !== null) return "saved";
  if (input.configId !== undefined && input.configId !== null) return "saved";
  return "idle";
}

export function copyForEditorSaveStatus(status: EditorSaveStatus): EditorSaveStatusCopy {
  switch (status) {
    case "saving":
      return {
        label: "Saving…",
        shortLabel: "Saving",
        description: "Saving your latest layout changes.",
      };
    case "failed":
      return {
        label: "Save failed - retry",
        shortLabel: "Retry",
        description: "The last save did not reach the server. Retry before sending the layout.",
      };
    case "offline":
      return {
        label: "Offline - changes local",
        shortLabel: "Offline",
        description: "Network is unavailable. Changes are currently only in this browser session.",
      };
    case "unsaved":
      return {
        label: "Unsaved changes",
        shortLabel: "Unsaved",
        description: "This layout has local changes that have not been saved yet.",
      };
    case "saved":
      return {
        label: "Layout saved",
        shortLabel: "Saved",
        description: "The current layout has been saved.",
      };
    case "idle":
      return {
        label: "Save Layout",
        shortLabel: "Save",
        description: "Save the current layout before sharing it with the events team.",
      };
  }
}

// ---------------------------------------------------------------------------
// The slate's honest save machine (T-671 slice 7; spec 6.1, sheet 17): what
// happened and what is safe, in plain words. Saving is automatic, so "Save
// layout" never appears (F-43), and a change made elsewhere is told by who,
// what and when, never by revision number (F-44). Each state says only what
// is true: work is "kept on this device" only when the device holds it.
// ---------------------------------------------------------------------------

/** The venue's own zone when the slate is not told another (the schema's default). */
const DEFAULT_VENUE_TIME_ZONE = "Europe/London";

export interface SlateConflict {
  /** The person who made the newer version, as the venue knows them; null when unknown. */
  readonly changedByName: string | null;
  /** The newer version is this person's own, from another tab. */
  readonly byYou: boolean;
  readonly changedAt: Date | null;
  /** What their version changed against the one this tab started from. */
  readonly theirChange: LayoutChangeSummary | null;
}

export interface SlateSaveInput {
  /** A layout exists on the server (or is being made into one). */
  readonly hasLayout: boolean;
  readonly guest: boolean;
  readonly isSaving: boolean;
  readonly isDirty: boolean;
  /** Pieces that differ from the last saved version right now. */
  readonly pendingChanges: number;
  /** Pieces on their way in the save in flight; null when none is. */
  readonly savingChanges: number | null;
  readonly isOnline: boolean;
  /** The unsaved work is stored on this device, not only in this tab. */
  readonly keptOnDevice: boolean;
  readonly saveError: string | null;
  readonly conflict: SlateConflict | null;
  readonly lockReason: "phase-preview" | "in-review" | null;
  readonly lastSavedAt: Date | null;
  /** The venue's IANA zone for the times the slate names. */
  readonly timeZone?: string;
}

export type SlateSaveKind = "saved" | "saving" | "offline" | "not-saved" | "changed-elsewhere" | "draft" | "view-only" | "new";

/** The dot (or indicator) before the words: what kind of news it is. */
export type SlateSaveMark = "saved" | "working" | "offline" | "problem" | "draft" | "none";

export interface SlateAction<Id extends string> {
  readonly id: Id;
  readonly label: string;
}

export interface SlateNotice {
  readonly heading: string;
  readonly body: string;
  readonly actions: readonly SlateAction<"try-again" | "show-theirs" | "keep-mine">[];
}

export interface SlateSaveState {
  readonly kind: SlateSaveKind;
  /** The first words on the line: "Saved", "Offline", "Not saved". */
  readonly status: string;
  /** What follows the dot: "2 changes", "kept on this device"; null for nothing. */
  readonly detail: string | null;
  readonly mark: SlateSaveMark;
  /** The fuller words on hover ("Saved 21:41"); null when the line says it all. */
  readonly title: string | null;
  /** What the notice under the plane says, and the ways forward; null for none. */
  readonly notice: SlateNotice | null;
  /** Sending waits until the layout on the server is this one. */
  readonly sendWaits: boolean;
  /** One way forward on the line itself. */
  readonly lineAction: SlateAction<"sign-in"> | null;
}

const LOCK_REASONS: Readonly<Record<NonNullable<SlateSaveInput["lockReason"]>, string>> = {
  "phase-preview": "previewing an act's layout",
  "in-review": "sent for approval",
};

function clockTime(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
}

function changesWord(count: number): string {
  return count === 1 ? "1 change" : `${String(count)} changes`;
}

/** Where the work waits: on the device only when the device truly holds it. */
function keptWhere(keptOnDevice: boolean): string {
  return keptOnDevice ? "kept on this device" : "kept in this tab";
}

function state(partial: Partial<SlateSaveState> & Pick<SlateSaveState, "kind" | "status" | "mark">): SlateSaveState {
  return { detail: null, title: null, notice: null, sendWaits: false, lineAction: null, ...partial };
}

const BOTH_KEPT = "Whichever you keep, the other stays in History.";

function conflictNotice(conflict: SlateConflict, timeZone: string): SlateNotice {
  const at = conflict.changedAt === null ? "" : ` at ${clockTime(conflict.changedAt, timeZone)}`;
  const change = conflict.theirChange === null ? null : describeLayoutChange(conflict.theirChange);
  if (conflict.byYou) {
    return {
      heading: `You changed this layout in another tab${at}.`,
      body: change === null ? BOTH_KEPT : `That tab ${change}. ${BOTH_KEPT}`,
      actions: [{ id: "show-theirs", label: "Show that version" }, { id: "keep-mine", label: "Keep this one" }],
    };
  }
  const name = conflict.changedByName?.trim() ?? "";
  if (name.length === 0) {
    return {
      heading: `This layout was changed elsewhere${at}.`,
      body: change === null ? BOTH_KEPT : `The newer version ${change}. ${BOTH_KEPT}`,
      actions: [{ id: "show-theirs", label: "Show the newer version" }, { id: "keep-mine", label: "Keep mine" }],
    };
  }
  return {
    heading: `${name} changed this layout${at}.`,
    body: change === null ? BOTH_KEPT : `${name} ${change}. ${BOTH_KEPT}`,
    actions: [{ id: "show-theirs", label: `Show ${name}'s version` }, { id: "keep-mine", label: "Keep mine" }],
  };
}

/**
 * The slate's save state, first match wins: view only (nothing can change,
 * whatever else is true), a guest's draft, a change made elsewhere, offline
 * (a failed save while offline is offline, not a failure), a save that did not
 * arrive, saving (queued or in flight), a layout not yet made, saved.
 */
export function slateSaveState(input: SlateSaveInput): SlateSaveState {
  const timeZone = input.timeZone ?? DEFAULT_VENUE_TIME_ZONE;
  if (input.lockReason !== null) {
    return state({ kind: "view-only", status: "View only", detail: LOCK_REASONS[input.lockReason], mark: "none" });
  }
  if (input.guest) {
    return state({
      kind: "draft",
      status: "Draft",
      detail: input.keptOnDevice ? keptWhere(true) : input.isDirty ? keptWhere(false) : null,
      mark: "draft",
      lineAction: { id: "sign-in", label: "Sign in to keep it" },
    });
  }
  if (input.conflict !== null) {
    return state({
      kind: "changed-elsewhere",
      status: "Not saved",
      detail: "changed elsewhere",
      mark: "problem",
      notice: conflictNotice(input.conflict, timeZone),
      sendWaits: true,
    });
  }
  if (!input.isOnline) {
    const unsaved = input.isDirty || input.pendingChanges > 0;
    const what = input.pendingChanges > 0 ? changesWord(input.pendingChanges) : "your changes";
    return state({
      kind: "offline",
      status: "Offline",
      detail: unsaved ? `${what} ${keptWhere(input.keptOnDevice)}` : "everything is saved",
      mark: "offline",
      notice: {
        heading: "The connection to Venviewer has dropped.",
        body: "You can keep working. Your changes save as soon as it is back; sending waits until then.",
        actions: [],
      },
      sendWaits: true,
    });
  }
  if (input.saveError !== null) {
    return state({
      kind: "not-saved",
      status: "Not saved",
      detail: keptWhere(input.keptOnDevice),
      mark: "problem",
      notice: {
        heading: "The last save did not reach Venviewer.",
        body: input.keptOnDevice ? "Your changes are kept on this device." : "Your changes are kept in this tab until it closes.",
        actions: [{ id: "try-again", label: "Try again" }],
      },
      sendWaits: true,
    });
  }
  if (input.isSaving || input.isDirty) {
    const count = input.isSaving ? input.savingChanges : input.pendingChanges;
    return state({
      kind: "saving",
      status: "Saving",
      detail: count === null || count <= 0 ? null : changesWord(count),
      mark: "working",
      sendWaits: true,
    });
  }
  if (!input.hasLayout) {
    return state({ kind: "new", status: "New layout", mark: "none" });
  }
  return state({
    kind: "saved",
    status: "Saved",
    mark: "saved",
    title: input.lastSavedAt === null ? null : `Saved ${clockTime(input.lastSavedAt, timeZone)}`,
  });
}

// ---------------------------------------------------------------------------
// Work that outlives the page or the layout it was made in (QoL D-01, D-X3):
// the receipt for work restored from this device, the note left when another
// layout opened before the last changes arrived, and what a switch says when
// it waits for changes that are neither saved nor kept.
// ---------------------------------------------------------------------------

export interface RestoreReceiptInput {
  readonly restored: { readonly changes: number; readonly editedAt: Date };
  readonly isSaving: boolean;
  readonly isDirty: boolean;
  readonly isOnline: boolean;
  readonly keptOnDevice: boolean;
  readonly lastSavedAt: Date | null;
  /** Today, for naming the day the changes were made; the clock's now by default. */
  readonly now?: Date;
  /** The venue's IANA zone for the times the receipt names. */
  readonly timeZone?: string;
}

export interface RestoreReceipt {
  /** "Restored 3 changes you made at 21:41 on this device". */
  readonly lead: string;
  /** "Saving", "Saved 21:42", "Offline · kept on this device". */
  readonly status: string;
  /** The restored work is on its way: the house indicator runs beside it. */
  readonly working: boolean;
}

function venueDayKey(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** "at 21:41", "yesterday at 21:41" or "on Sat 24 Oct at 21:41", in the venue's zone. */
function whenMade(at: Date, now: Date, timeZone: string): string {
  const clock = `at ${clockTime(at, timeZone)}`;
  if (venueDayKey(at, timeZone) === venueDayKey(now, timeZone)) return clock;
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (venueDayKey(at, timeZone) === venueDayKey(yesterday, timeZone)) return `yesterday ${clock}`;
  const day = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short" }).format(at);
  return `on ${day.replace(",", "")} ${clock}`;
}

/** The receipt for work this device kept, restored as the layout opened. */
export function restoreReceipt(input: RestoreReceiptInput): RestoreReceipt {
  const timeZone = input.timeZone ?? DEFAULT_VENUE_TIME_ZONE;
  const lead = `Restored ${changesWord(input.restored.changes)} you made ${whenMade(input.restored.editedAt, input.now ?? new Date(), timeZone)} on this device`;
  if (input.isSaving || (input.isDirty && input.isOnline)) return { lead, status: "Saving", working: true };
  if (input.isDirty) return { lead, status: `Offline · ${keptWhere(input.keptOnDevice)}`, working: false };
  return {
    lead,
    status: input.lastSavedAt === null ? "Saved" : `Saved ${clockTime(input.lastSavedAt, timeZone)}`,
    working: false,
  };
}

export interface LeftBehindInput {
  readonly roomName: string | null;
  readonly kept: boolean;
  readonly savesOnReturn: boolean;
}

/** The note left when another layout opened before this one's changes arrived. */
export function leftBehindWords(input: LeftBehindInput): string {
  const room = input.roomName?.trim().replace(/^the\s+/iu, "") ?? "";
  const layout = room.length === 0 ? "that layout" : `the ${room} layout`;
  if (!input.kept) return `Your changes to ${layout} did not reach Venviewer, and this browser could not keep them.`;
  return input.savesOnReturn
    ? `Your changes to ${layout} are kept on this device and save when you open it again.`
    : `Your changes to ${layout} are kept on this device.`;
}

/** A room or layout switch waiting for changes this device cannot keep. */
export interface HeldLayoutChange {
  readonly heading: string;
  readonly body: string;
  readonly actions: readonly SlateAction<"try-again" | "leave-anyway">[];
}

/** `destination` as said in a sentence: "the Saloon", "Drinks reception". */
export function heldLayoutChange(destination: string): HeldLayoutChange {
  return {
    heading: "Your changes to this layout have not reached Venviewer yet.",
    body: `This browser cannot keep them on this device, so ${destination} waits until they are saved.`,
    actions: [{ id: "try-again", label: "Try again" }, { id: "leave-anyway", label: `Open ${destination} without them` }],
  };
}

/** A notice the slate gives beside its save state: a switch held for unsaved
 *  work, the note about a layout left behind, or the restore receipt. */
export interface SlateAside {
  readonly heading: string;
  readonly body: string | null;
  readonly actions: readonly SlateAction<"try-again" | "leave-anyway">[];
  /** Needs the person now (a held switch, lost work): an alert, ahead of the save state's notice. */
  readonly urgent: boolean;
}

export interface SlateAsideInput {
  /** Where a held switch was going ("the Saloon"), or null. */
  readonly held: string | null;
  readonly leftBehind: LeftBehindInput | null;
  readonly restored: RestoreReceiptInput | null;
}

/** First match wins: the held switch, the note about a layout left behind, the receipt. */
export function slateAside(input: SlateAsideInput): SlateAside | null {
  if (input.held !== null) {
    const held = heldLayoutChange(input.held);
    return { heading: held.heading, body: held.body, actions: held.actions, urgent: true };
  }
  if (input.leftBehind !== null) {
    return { heading: leftBehindWords(input.leftBehind), body: null, actions: [], urgent: !input.leftBehind.kept };
  }
  if (input.restored !== null) {
    const receipt = restoreReceipt(input.restored);
    return { heading: receipt.lead, body: receipt.status, actions: [], urgent: false };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Someone else's change, as a clause: "moved Tables 3 and 4 and added a
// lectern". Labelled pieces are named by their labels, numbered labels of one
// kind gathered ("Tables 3 and 4"); the rest are counted by noun ("2 tables
// and a chair"). The verbs come in one order: moved, added, removed, changed.
// ---------------------------------------------------------------------------

function joinedWithAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1] ?? ""}`;
}

function plural(noun: string): string {
  if (/(?:s|x|z|ch|sh)$/iu.test(noun)) return `${noun}es`;
  if (/[^aeiou]y$/iu.test(noun)) return `${noun.slice(0, -1)}ies`;
  return `${noun}s`;
}

function withArticle(noun: string): string {
  return /^[aeiou]/iu.test(noun) ? `an ${noun}` : `a ${noun}`;
}

/** "Table 3" → { word: "Table", number: "3" }; null for a label without a trailing number. */
function numberedLabel(label: string): { readonly word: string; readonly number: string } | null {
  const match = /^(.*\S)\s+(\d+[a-z]?)$/iu.exec(label);
  if (match === null) return null;
  const [, word, number] = match;
  return word === undefined || number === undefined ? null : { word, number };
}

/** One phrase of a list, in first-seen order; numbers and counts gather as pieces arrive. */
type PiecePhrase =
  | { readonly kind: "label"; readonly label: string }
  | { readonly kind: "numbered"; readonly word: string; readonly numbers: string[] }
  | { readonly kind: "counted"; readonly noun: string; count: number };

function describePieces(pieces: readonly ChangedPiece[]): string {
  const phrases: PiecePhrase[] = [];
  const numbered = new Map<string, { numbers: string[] }>();
  const counted = new Map<string, { count: number }>();
  for (const piece of pieces) {
    const parts = piece.label === null ? null : numberedLabel(piece.label);
    if (piece.label !== null && parts === null) {
      phrases.push({ kind: "label", label: piece.label });
    } else if (parts !== null) {
      const known = numbered.get(parts.word);
      if (known !== undefined) {
        known.numbers.push(parts.number);
      } else {
        const phrase: PiecePhrase & { kind: "numbered" } = { kind: "numbered", word: parts.word, numbers: [parts.number] };
        numbered.set(parts.word, phrase);
        phrases.push(phrase);
      }
    } else {
      const known = counted.get(piece.noun);
      if (known !== undefined) {
        known.count += 1;
      } else {
        const phrase: PiecePhrase & { kind: "counted" } = { kind: "counted", noun: piece.noun, count: 1 };
        counted.set(piece.noun, phrase);
        phrases.push(phrase);
      }
    }
  }
  return joinedWithAnd(phrases.map((phrase) => {
    switch (phrase.kind) {
      case "label":
        return phrase.label;
      case "numbered":
        return phrase.numbers.length === 1
          ? `${phrase.word} ${phrase.numbers[0] ?? ""}`
          : `${plural(phrase.word)} ${joinedWithAnd([...phrase.numbers].sort((x, y) => Number.parseInt(x, 10) - Number.parseInt(y, 10)))}`;
      case "counted":
        return phrase.count === 1 ? withArticle(phrase.noun) : `${String(phrase.count)} ${plural(phrase.noun)}`;
    }
  }));
}

/** The change as a clause after a name, or null when nothing differs. */
export function describeLayoutChange(summary: LayoutChangeSummary): string | null {
  const clauses: string[] = [];
  const verbs: readonly (readonly [string, readonly ChangedPiece[]])[] = [
    ["moved", summary.moved],
    ["added", summary.added],
    ["removed", summary.removed],
    ["changed", summary.restyled],
  ];
  for (const [verb, pieces] of verbs) {
    if (pieces.length > 0) clauses.push(`${verb} ${describePieces(pieces)}`);
  }
  return clauses.length === 0 ? null : joinedWithAnd(clauses);
}
