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
