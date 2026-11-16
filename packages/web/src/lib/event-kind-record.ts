import { create } from "zustand";
import { ApiError } from "../api/client.js";
import { patchConfigMetadata } from "../api/configurations.js";
import { usePlannerEventStore, type PlannerEventKind } from "../stores/planner-event-store.js";
import { useAuthStore } from "../stores/auth-store.js";
import { readOnlineStatus, subscribeOnlineStatus } from "./online-status.js";
import type { AutoFillStyle } from "./auto-fill.js";

// ---------------------------------------------------------------------------
// The kind of event a layout is for (Blake, 26 Oct 2026; T-674).
//
// The planner asks it once, when a new layout first opens ("What are you
// planning?"), keeps the answer with the layout, and reads it back whenever
// the layout opens again. The answer chooses the chair a new seat gets
// (lib/furniture-defaults) and the shape Lay out starts with. Only a layout
// that is new as it opens is asked: nothing on its floor, in the copy it
// opens with or the server's. While it stays open, once anything has stood
// on its floor it is never asked, however empty the floor becomes. A layout
// whose saved copy is empty as it opens counts as new again.
//
// A signed-in layout keeps it in configurations.metadata.eventKind; the PATCH
// merges top-level keys, so the write never touches the layout's other
// metadata. A guest's draft has no metadata route, so this device keeps its
// answer, as it keeps the draft's claim secret; the moment the draft becomes
// the person's (its claim lands), the answer is written to the layout. An
// absent answer means never asked; null means asked and skipped, which is
// never asked again.
// ---------------------------------------------------------------------------

export const PLANNER_EVENT_KINDS: readonly PlannerEventKind[] = ["wedding", "corporate", "other"];

/** A layout's answer: a kind, or null when the person skipped the question. */
export type EventKindAnswer = PlannerEventKind | null;

export function isPlannerEventKind(value: unknown): value is PlannerEventKind {
  return value === "wedding" || value === "corporate" || value === "other";
}

/**
 * A kind a later release added: a short name this planner does not know. A
 * tab left open across that release reads it as answered, with no kind: it
 * never asks such a layout again, and never rewrites it away.
 */
function isLaterKind(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 64 && !isPlannerEventKind(value);
}

/**
 * The answer a layout's metadata holds: a kind, null (skipped, or a kind a
 * later release added, which this planner has no chair for), or undefined
 * (never asked, or unreadable).
 */
export function storedEventKind(metadata: unknown): EventKindAnswer | undefined {
  if (typeof metadata !== "object" || metadata === null || !("eventKind" in metadata)) return undefined;
  const value: unknown = (metadata as { readonly eventKind?: unknown }).eventKind;
  if (value === null) return null;
  if (isPlannerEventKind(value)) return value;
  return isLaterKind(value) ? null : undefined;
}

/** An answer carried in the planner's address (`?event=wedding`), as a link from the venue's wedding page would. */
export function eventKindFromSearch(search: string): PlannerEventKind | undefined {
  const value = new URLSearchParams(search).get("event");
  return isPlannerEventKind(value) ? value : undefined;
}

// ---------------------------------------------------------------------------
// This device's record: a guest draft's answer, and whether this device asks.
// ---------------------------------------------------------------------------

const STORAGE_KEY = "venviewer.planner.eventKind";

/** Answers kept on one device, newest first. */
export const DEVICE_RECORD_LIMIT = 200;

interface DeviceEntry {
  readonly configId: string;
  /** A kind, null (skipped), or a kind a later release added, kept as it was written. */
  readonly kind: string | null;
}

/** `quiet`: this device was told not to ask (`?event-question=off`): the venue's demo laptop, automated runs. */
export interface DeviceRecord {
  readonly version: 1;
  readonly entries: readonly DeviceEntry[];
  readonly quiet: boolean;
}

const EMPTY_RECORD: DeviceRecord = { version: 1, entries: [], quiet: false };

function deviceStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The device's record, read defensively: storage can hold anything, so a damaged record reads as empty. */
export function readDeviceRecord(): DeviceRecord {
  const storage = deviceStorage();
  if (storage === null) return EMPTY_RECORD;
  let parsed: unknown;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return EMPTY_RECORD;
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY_RECORD;
  }
  if (typeof parsed !== "object" || parsed === null) return EMPTY_RECORD;
  const record = parsed as { readonly version?: unknown; readonly entries?: unknown; readonly quiet?: unknown };
  if (record.version !== 1 || !Array.isArray(record.entries)) return EMPTY_RECORD;
  const entries: DeviceEntry[] = [];
  const seen = new Set<string>();
  for (const item of record.entries as readonly unknown[]) {
    if (entries.length === DEVICE_RECORD_LIMIT) break;
    if (typeof item !== "object" || item === null) continue;
    const { configId, kind } = item as { readonly configId?: unknown; readonly kind?: unknown };
    if (typeof configId !== "string" || configId.length === 0 || configId.length > 128 || seen.has(configId)) continue;
    if (kind !== null && !isPlannerEventKind(kind) && !isLaterKind(kind)) continue;
    seen.add(configId);
    entries.push({ configId, kind });
  }
  return { version: 1, entries, quiet: record.quiet === true };
}

function writeDeviceRecord(record: DeviceRecord): boolean {
  const storage = deviceStorage();
  if (storage === null) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(record));
    return true;
  } catch {
    return false;
  }
}

/** This device's answer for a layout, or undefined when it holds none; a kind a later release added reads as answered, with no kind. */
export function deviceEventKind(configId: string): EventKindAnswer | undefined {
  const entry = readDeviceRecord().entries.find((candidate) => candidate.configId === configId);
  if (entry === undefined) return undefined;
  return entry.kind === null || isPlannerEventKind(entry.kind) ? entry.kind : null;
}

/** Keeps a layout's answer on this device, newest first; false when the device cannot keep it. */
export function rememberDeviceEventKind(configId: string, kind: EventKindAnswer): boolean {
  const record = readDeviceRecord();
  const entries = [{ configId, kind }, ...record.entries.filter((entry) => entry.configId !== configId)]
    .slice(0, DEVICE_RECORD_LIMIT);
  return writeDeviceRecord({ ...record, entries });
}

/**
 * Whether this device asks. `?event-question=off` stops it asking here and
 * `?event-question=on` starts it again; either is remembered on the device,
 * as `?assembly=off` is for the Assembly. It is for the venue's demo laptop
 * and automated runs; any planner address carrying it changes the device
 * that opens it, so it belongs in no link given to a customer.
 */
export function deviceAsksEventKind(search: string): boolean {
  const asked = new URLSearchParams(search).get("event-question");
  if (asked === "off" || asked === "on") {
    writeDeviceRecord({ ...readDeviceRecord(), quiet: asked === "off" });
    return asked === "on";
  }
  return !readDeviceRecord().quiet;
}

// ---------------------------------------------------------------------------
// When to ask, and what an answer sets.
// ---------------------------------------------------------------------------

export interface EventKindQuestionFacts {
  /** The layout can be changed now: no review lock, no frozen phase, no timeline preview. */
  readonly editable: boolean;
  /** The layout was new when it opened (nothing stood on its floor), and nothing has stood on it since. */
  readonly askable: boolean;
  /** Nothing is on the floor. */
  readonly floorEmpty: boolean;
  /** The layout was opened from an event (`?eventId=`), whose people already know what it is. */
  readonly eventLinked: boolean;
  /** Whether the layout's answer has been read yet. */
  readonly known: boolean;
  /** The layout's answer; undefined when the planner has never asked. */
  readonly answer: EventKindAnswer | undefined;
  /** This device asks (it has not been told not to). */
  readonly deviceAsks: boolean;
}

/** Asks only a layout that was new when it opened and is still empty, that nothing has answered for, and never over someone's work. */
export function shouldAskEventKind(facts: EventKindQuestionFacts): boolean {
  return facts.deviceAsks && facts.editable && facts.askable && facts.floorEmpty && !facts.eventLinked
    && facts.known && facts.answer === undefined;
}

/** The shape Lay out starts with: theatre rows for a corporate event, round tables for anything else. */
export function layOutStyleFor(kind: EventKindAnswer | undefined): AutoFillStyle {
  return kind === "corporate" ? "theatre" : "dinner-rounds";
}

export interface EventKindWords {
  /** The panel's title. */
  readonly title: string;
  /** The panel's one line: what the planner sets for it. */
  readonly line: string;
  /** How the room header names the event. */
  readonly label: string;
  /** The receipt after the pick. */
  readonly receipt: string;
  /** What Lay out does for it, after "Add a table, or" on the empty floor. */
  readonly layOut: string;
}

/**
 * Every word is true of the planner: the chair is lib/furniture-defaults'
 * PLANNER_CHAIR_BY_EVENT, the shape layOutStyleFor. A panel offers a choice
 * ("Something else"); the header names the event the choice made ("Other
 * event").
 */
export const EVENT_KIND_WORDS: Readonly<Record<PlannerEventKind, EventKindWords>> = {
  wedding: {
    title: "Wedding",
    line: "Round tables and gold Chiavari chairs",
    label: "Wedding",
    receipt: "Set up for a wedding: round tables and gold Chiavari chairs.",
    layOut: "lay out round tables for your wedding",
  },
  corporate: {
    title: "Corporate event",
    line: "Rows of seats and the venue's pink chairs",
    label: "Corporate event",
    receipt: "Set up for a corporate event: rows of seats and the venue's pink chairs.",
    layOut: "lay out rows of seats for your event",
  },
  other: {
    title: "Something else",
    line: "The venue's pink chairs, laid out your way",
    label: "Other event",
    receipt: "Set up with the venue's pink chairs.",
    layOut: "lay out for your guests",
  },
};

// ---------------------------------------------------------------------------
// The open layout's answer, and keeping it.
// ---------------------------------------------------------------------------

/**
 * Where the layout's answer is kept:
 *   kept       on the layout (for a guest's draft, on this device), or there is nothing to keep;
 *   retrying   a write found no network, a server error or a busy moment, and is tried again;
 *   this-visit the layout or the device refused it (no permission to write, a locked layout, full storage): it holds in this tab only.
 */
export type EventKindSave = "kept" | "retrying" | "this-visit";

export interface EventKindQuestionState {
  /** The layout these facts are about; null before one opens. */
  readonly configId: string | null;
  /** A guest's draft: its answer is kept on this device. */
  readonly guest: boolean;
  /** Whether the layout's answer has been read: from its metadata, this device or the address. */
  readonly known: boolean;
  /** The layout's answer; undefined while unread or never asked. */
  readonly answer: EventKindAnswer | undefined;
  /**
   * The layout was new as it opened: nothing stood on its floor. Only such a
   * layout is asked. While it stays open, once anything stands on it, it is
   * not asked again: a reload of the same layout can clear this, never set it.
   * (Opened afresh later with an empty saved copy, it is new again.)
   */
  readonly askable: boolean;
  readonly save: EventKindSave;
  /** The picker is open to change the answer, from the room's name or the receipt. */
  readonly changing: boolean;
  /** The pick just made, for its receipt; null once the receipt has gone. */
  readonly receipt: { readonly answer: EventKindAnswer; readonly seq: number } | null;
}

const INITIAL: EventKindQuestionState = {
  configId: null,
  guest: false,
  known: false,
  answer: undefined,
  askable: false,
  save: "kept",
  changing: false,
  receipt: null,
};

export const useEventKindQuestion = create<EventKindQuestionState>()(() => INITIAL);

export interface EventKindRecordDeps {
  /** Writes the answer into a signed-in layout's metadata. */
  readonly writeMetadata: (configId: string, answer: EventKindAnswer) => Promise<unknown>;
}

const DEFAULT_DEPS: EventKindRecordDeps = {
  writeMetadata: (configId, answer) => patchConfigMetadata(configId, { eventKind: answer }),
};

export interface OpenedLayout {
  readonly configId: string;
  /** A guest's draft. */
  readonly isPublicPreview: boolean;
  /** The planner's address (`?event=`). */
  readonly search: string;
  /** The layout's metadata as its load returned it; null when it has none. */
  readonly metadata: unknown;
  /** Nothing stood on the floor as the layout opened: neither in the copy it opened with nor in the server's. */
  readonly floorEmptyAtOpen: boolean;
}

/**
 * How long to wait before each new try of an unsent answer while the browser
 * is online, ms. A busy moment or a refreshed session passes in seconds; after
 * the last wait, only coming back online or the next answer tries again.
 */
export const EVENT_KIND_RETRY_MS: readonly number[] = [2_000, 5_000, 15_000, 30_000, 60_000];

/**
 * One answer given for a layout and not yet seen written. A later answer is a
 * new entry, even one of the same kind.
 */
interface UnsentAnswer {
  readonly answer: EventKindAnswer;
  /**
   * What the layout held, as far as this tab knows, when this answer was
   * given; moved on when this tab's own earlier answer is seen written. A
   * stored answer found later that is neither this nor one this tab sent
   * itself without seeing it land (sentUnseen) was given elsewhere. Answers
   * are compared, not versions: one changed and changed back elsewhere reads
   * as unchanged.
   */
  base: EventKindAnswer | undefined;
  /** Who gave it: it is only ever written as that person. */
  readonly userId: string | null;
}

let receiptSeq = 0;
let writing: Promise<void> = Promise.resolve();
/** Each layout's newest answer this tab gave and has not yet seen kept: tried again whichever layout is open. */
const unsent = new Map<string, UnsentAnswer>();
/** Each signed-in layout's stored answer as far as this tab knows: read as it opens, then each answer seen written. */
const knownStored = new Map<string, EventKindAnswer | undefined>();

/** The person signed in now, whose answers this tab may write. */
function currentUserId(): string | null {
  return useAuthStore.getState().user?.id ?? null;
}
/** Writes queued or under way, by layout, so a retry never doubles one. */
const writesQueued = new Map<string, number>();
/** One write of an answer, as this tab sent it. */
interface SentWrite {
  readonly answer: EventKindAnswer;
}
/**
 * Each layout's writes this tab has sent without seeing them land or be
 * refused for good. A write can reach the layout and lose its answer on the
 * way back, so the answer of any of these may be what the layout holds. A
 * write seen landing clears them all: the layout holds its answer, after every
 * write sent before it. They start afresh when the layout is read with nothing
 * of this tab's unsent or on its way, since that read follows them all.
 */
const sentUnseen = new Map<string, readonly SentWrite[]>();
/** The person last seen signed in, once this tab has written for anyone: the answers it holds are theirs. */
let lastPerson: string | null = null;
let stopPersonWatch: (() => void) | null = null;
let retryDeps: EventKindRecordDeps = DEFAULT_DEPS;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempts = 0;
let stopOnlineRetry: (() => void) | null = null;

/** The first answer given: null (a skipped question) counts as an answer; only undefined does not. */
function firstAnswer(...answers: readonly (EventKindAnswer | undefined)[]): EventKindAnswer | undefined {
  return answers.find((answer) => answer !== undefined);
}

/** The layout's answer, read. A receipt or a change in hand stays: only a different layout clears those. */
function applyAnswer(configId: string, guest: boolean, answer: EventKindAnswer | undefined, save: EventKindSave): void {
  useEventKindQuestion.setState({ configId, guest, known: true, answer, save });
  usePlannerEventStore.getState().setEventKind(answer ?? null);
}

/**
 * Sets the planner's kind for a layout as it opens, from what its load
 * returned (editor-store's loadConfiguration and createPublicConfig call
 * this), before any seat can be placed. A different layout first forgets the
 * last one's kind, and is askable only if its floor was empty as it opened.
 *
 * - A guest's draft takes this device's answer. The address (`?event=`) answers
 *   only a draft nothing has answered yet: the link it came by started the
 *   plan. That answer is kept on the device.
 * - A signed-in layout takes the answer it holds. An answer this tab gave, by
 *   the person signed in now, and has not seen kept stands over it and is
 *   written again, unless the layout now holds that very answer (it landed) or
 *   one given elsewhere since (the newer answer stands). An answer this tab
 *   sent itself without seeing it land is its own, not one given elsewhere.
 *   Otherwise the layout takes an answer this tab holds for this visit, or the
 *   one this device kept for it as a guest's draft (claimed since), which is
 *   written to the layout.
 *   Opening writes nothing else: the address never answers a signed-in
 *   layout, so a link cannot change a layout's event, and a viewer who may not
 *   write is not made to try.
 */
export function openLayoutEventKind(layout: OpenedLayout, deps: Partial<EventKindRecordDeps> = {}): void {
  const current = useEventKindQuestion.getState();
  const sameLayout = current.configId === layout.configId && current.known;
  if (current.configId !== layout.configId) {
    useEventKindQuestion.setState({ ...INITIAL, configId: layout.configId, guest: layout.isPublicPreview, askable: layout.floorEmptyAtOpen });
    usePlannerEventStore.getState().setEventKind(null);
  } else if (current.askable && !layout.floorEmptyAtOpen) {
    useEventKindQuestion.setState({ askable: false });
  }
  // An answer this tab holds for the layout that its owner refused to keep.
  const held = sameLayout && current.save === "this-visit" ? current.answer : undefined;
  const onDevice = deviceEventKind(layout.configId);
  if (layout.isPublicPreview) {
    const answer = firstAnswer(onDevice, held, eventKindFromSearch(layout.search));
    applyAnswer(layout.configId, true, answer, "kept");
    if (onDevice === undefined && answer !== undefined) {
      useEventKindQuestion.setState({ save: rememberDeviceEventKind(layout.configId, answer) ? "kept" : "this-visit" });
    }
    return;
  }
  const use: EventKindRecordDeps = { ...DEFAULT_DEPS, ...deps };
  const stored = storedEventKind(layout.metadata);
  const waiting = unsent.get(layout.configId);
  if (waiting !== undefined) {
    const stands = waiting.userId === currentUserId()
      && (stored === undefined
        || (stored !== waiting.answer
          && (stored === waiting.base || sentUnseen.get(layout.configId)?.some((sent) => sent.answer === stored) === true)));
    if (stands) {
      knownStored.set(layout.configId, stored);
      applyAnswer(layout.configId, false, waiting.answer, "retrying");
      if (!writesQueued.has(layout.configId)) void writeAnswer(layout.configId, waiting, use);
      return;
    }
    // Another person's answer, one that landed after all, or one overtaken by an answer given elsewhere.
    unsent.delete(layout.configId);
  }
  // Read with nothing of this tab's unsent or on its way, the layout's copy follows every write this tab sent.
  if (!writesQueued.has(layout.configId)) sentUnseen.delete(layout.configId);
  knownStored.set(layout.configId, stored);
  if (stored !== undefined) {
    applyAnswer(layout.configId, false, stored, "kept");
    return;
  }
  if (held !== undefined) {
    applyAnswer(layout.configId, false, held, "this-visit");
    return;
  }
  applyAnswer(layout.configId, false, onDevice, "kept");
  if (onDevice !== undefined) queueAnswer(layout.configId, onDevice, use);
}

/**
 * The open guest draft has just become the signed-in person's (its claim
 * landed): its answer, held here and on this device, now belongs with the
 * layout and is written there at once. The planner calls this beside
 * isPublicPreview: false, for a new plan (EditorPage) and for a draft claimed
 * as its guest signs in (use-planner-draft-claim).
 */
export function layoutClaimedEventKind(configId: string, deps: Partial<EventKindRecordDeps> = {}): void {
  const state = useEventKindQuestion.getState();
  if (state.configId !== configId || !state.guest) return;
  useEventKindQuestion.setState({ guest: false });
  if (!state.known) return;
  const answer = firstAnswer(state.answer, deviceEventKind(configId));
  if (answer === undefined) return;
  if (state.answer === undefined) applyAnswer(configId, false, answer, "kept");
  queueAnswer(configId, answer, { ...DEFAULT_DEPS, ...deps });
}

/** The person's answer (a kind, or null for "Not sure yet"): set at once, then kept with the layout. */
export function answerEventKind(answer: EventKindAnswer, deps: Partial<EventKindRecordDeps> = {}): void {
  const { configId, guest } = useEventKindQuestion.getState();
  if (configId === null) return;
  receiptSeq += 1;
  useEventKindQuestion.setState({ known: true, answer, askable: false, changing: false, save: "kept", receipt: { answer, seq: receiptSeq } });
  usePlannerEventStore.getState().setEventKind(answer);
  if (guest) {
    useEventKindQuestion.setState({ save: rememberDeviceEventKind(configId, answer) ? "kept" : "this-visit" });
    return;
  }
  queueAnswer(configId, answer, { ...DEFAULT_DEPS, ...deps });
}

/**
 * A refusal no new try can change: the request is wrong, not allowed, or for
 * a layout that is gone or locked for review. An expired session (401, after
 * the client has asked for a fresh token, while someone is still signed in),
 * a timeout (408), too many requests (429), the route's own "try again" (409
 * RETRY) and a server error all pass. A 401 with nobody signed in is final.
 */
function refusedForGood(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.status === 401) return currentUserId() === null;
  if (error.status === 408 || error.status === 429) return false;
  if (error.status === 409) return error.code !== "RETRY";
  return error.status >= 400 && error.status < 500;
}

/** Marks the open layout's save, only while the answer it is about is still the one in hand. */
function markSave(configId: string, answer: EventKindAnswer, save: EventKindSave): void {
  const state = useEventKindQuestion.getState();
  if (state.configId === configId && state.answer === answer) useEventKindQuestion.setState({ save });
}

/** Keeps a signed-in layout's newest answer until it is seen kept, and writes it. */
function queueAnswer(configId: string, answer: EventKindAnswer, deps: EventKindRecordDeps): void {
  watchPerson();
  const entry: UnsentAnswer = { answer, base: knownStored.get(configId), userId: currentUserId() };
  unsent.set(configId, entry);
  retryAttempts = 0;
  void writeAnswer(configId, entry, deps);
}

/**
 * Writes a signed-in layout's answer, one write at a time. Only the layout's
 * newest answer reaches the network: one overtaken while it waited its turn is
 * never sent. Only the person who gave it may send it: if someone else, or
 * nobody, is signed in when its turn comes, it is dropped, and the open
 * layout shows what it holds instead. A write refused for good leaves the
 * answer held for this visit. Any other failed write keeps the answer unsent,
 * whichever layout is open by then, and tries it again: at once when the
 * browser comes back online, and after a growing wait while it is online.
 * Every write, first or retried, with the layout open or not, writes over
 * whatever it holds by then: the last writer wins, as everywhere in the
 * PATCH. Only a reopen looks first (openLayoutEventKind).
 */
function writeAnswer(configId: string, entry: UnsentAnswer, deps: EventKindRecordDeps): Promise<void> {
  writesQueued.set(configId, (writesQueued.get(configId) ?? 0) + 1);
  writing = writing.then(async () => {
    const sent: SentWrite = { answer: entry.answer };
    try {
      if (unsent.get(configId) !== entry) return;
      if (entry.userId !== currentUserId()) {
        unsent.delete(configId);
        const state = useEventKindQuestion.getState();
        if (state.configId === configId && !state.guest && state.answer === entry.answer) showStoredAnswer(configId);
        return;
      }
      sentUnseen.set(configId, [...(sentUnseen.get(configId) ?? []), sent]);
      await deps.writeMetadata(configId, entry.answer);
      retryAttempts = 0;
      knownStored.set(configId, entry.answer);
      // Seen landing: the layout holds this answer now, after every write this tab sent before it.
      sentUnseen.delete(configId);
      const newest = unsent.get(configId);
      if (newest !== entry) {
        // This tab's own answer landed under a newer one still to go: the newer one now replaces it.
        if (newest !== undefined) newest.base = entry.answer;
        // Let go of on its way (a change of person, or a reopen holding another answer), it landed all the same.
        else showLandedAnswer(configId, entry.answer);
        return;
      }
      unsent.delete(configId);
      markSave(configId, entry.answer, "kept");
    } catch (error) {
      const final = refusedForGood(error);
      // Refused for good, this write certainly did not land: its answer is no longer one the layout may hold.
      if (final) sentUnseen.set(configId, (sentUnseen.get(configId) ?? []).filter((other) => other !== sent));
      if (unsent.get(configId) !== entry) return;
      if (final) {
        unsent.delete(configId);
        markSave(configId, entry.answer, "this-visit");
        return;
      }
      markSave(configId, entry.answer, "retrying");
      retryLater(deps);
    } finally {
      const left = (writesQueued.get(configId) ?? 1) - 1;
      if (left > 0) writesQueued.set(configId, left);
      else writesQueued.delete(configId);
      if (unsent.size === 0) stopRetrying();
    }
  });
  return writing;
}

function retryLater(deps: EventKindRecordDeps): void {
  retryDeps = deps;
  stopOnlineRetry ??= subscribeOnlineStatus((online) => { if (online) retryUnsent(); });
  if (retryTimer !== null || retryAttempts >= EVENT_KIND_RETRY_MS.length || !readOnlineStatus()) return;
  const wait = EVENT_KIND_RETRY_MS[retryAttempts] ?? 0;
  retryAttempts += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    retryUnsent();
  }, wait);
}

function retryUnsent(): void {
  for (const [configId, entry] of [...unsent]) {
    if (!writesQueued.has(configId)) void writeAnswer(configId, entry, retryDeps);
  }
}

function stopRetrying(): void {
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = null;
  stopOnlineRetry?.();
  stopOnlineRetry = null;
  retryAttempts = 0;
}

/** The open layout shows what it holds, as far as this tab knows, in place of an answer held for someone no longer here. */
function showStoredAnswer(configId: string): void {
  applyAnswer(configId, false, knownStored.get(configId), "kept");
  useEventKindQuestion.setState({ changing: false, receipt: null });
}

/** A write this tab let go of on its way landed all the same: the open layout shows what it now holds. */
function showLandedAnswer(configId: string, answer: EventKindAnswer): void {
  if (useEventKindQuestion.getState().configId === configId) applyAnswer(configId, false, answer, "kept");
}

/**
 * From this tab's first write, watches who is signed in. Once someone else
 * is, the last person's unsent answers are dropped, and wherever the open
 * layout showed an answer held for them, unsent (its write perhaps still on
 * its way) or for this visit, it gives way at once to what the layout holds.
 * Nobody signed in is no change of person: the auth bridge passes through
 * nobody while it checks anyone's access, the same person's included.
 */
function watchPerson(): void {
  if (stopPersonWatch !== null) return;
  lastPerson = currentUserId();
  stopPersonWatch = useAuthStore.subscribe((auth) => {
    const next = auth.user?.id ?? null;
    if (next === null || next === lastPerson) return;
    lastPerson = next;
    const state = useEventKindQuestion.getState();
    const heldForLast = state.save !== "kept" || (state.configId !== null && unsent.has(state.configId));
    unsent.clear();
    if (state.configId !== null && !state.guest && heldForLast) showStoredAnswer(state.configId);
  });
}

/** Something stands on the open layout's floor: it is no longer new, and is never asked again (EventKindPicker). */
export function eventKindFloorTaken(configId: string): void {
  const state = useEventKindQuestion.getState();
  if (state.configId === configId && state.askable) useEventKindQuestion.setState({ askable: false });
}

/** Opens the picker to change the answer (the room's name, the receipt's Change). */
export function changeEventKind(): void {
  if (useEventKindQuestion.getState().configId === null) return;
  useEventKindQuestion.setState({ changing: true, receipt: null });
}

/** Closes a change without changing anything. */
export function keepEventKind(): void {
  useEventKindQuestion.setState({ changing: false });
}

/** The receipt has had its moment. */
export function dismissEventKindReceipt(seq: number): void {
  if (useEventKindQuestion.getState().receipt?.seq === seq) useEventKindQuestion.setState({ receipt: null });
}

/** The picker has gone with the planner: a change or a receipt in hand goes with it, so neither returns unasked. */
export function settleEventKindQuestion(): void {
  const { changing, receipt } = useEventKindQuestion.getState();
  if (changing || receipt !== null) useEventKindQuestion.setState({ changing: false, receipt: null });
}

/** Forgets every answer and write in flight (tests). */
export function resetEventKindQuestionForTesting(): void {
  stopRetrying();
  stopPersonWatch?.();
  stopPersonWatch = null;
  lastPerson = null;
  unsent.clear();
  knownStored.clear();
  writesQueued.clear();
  sentUnseen.clear();
  retryDeps = DEFAULT_DEPS;
  receiptSeq = 0;
  writing = Promise.resolve();
  useEventKindQuestion.setState(INITIAL);
  usePlannerEventStore.getState().setEventKind(null);
}
