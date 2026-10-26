import { create } from "zustand";
import { getConfig, patchConfigMetadata } from "../api/configurations.js";
import { usePlannerEventStore, type PlannerEventKind } from "../stores/planner-event-store.js";
import { subscribeOnlineStatus } from "./online-status.js";
import type { AutoFillStyle } from "./auto-fill.js";

// ---------------------------------------------------------------------------
// The kind of event a layout is for (Blake, 26 Oct 2026; T-674).
//
// The planner asks it once, when a new layout first opens ("What are you
// planning?"), keeps the answer with the layout, and reads it back whenever
// the layout opens again. The answer chooses the chair a new seat gets
// (lib/furniture-defaults) and the shape Lay out starts with.
//
// A signed-in layout keeps it in configurations.metadata.eventKind; the PATCH
// merges top-level keys, so the write never touches the layout's other
// metadata. A guest's draft has no metadata route, so this device keeps its
// answer, as it keeps the draft's claim secret; once the draft is someone's,
// the device's answer is written to the layout the first time it opens
// signed in. An absent answer means never asked; null means asked and
// skipped, which is never asked again.
// ---------------------------------------------------------------------------

export const PLANNER_EVENT_KINDS: readonly PlannerEventKind[] = ["wedding", "corporate", "other"];

/** A layout's answer: a kind, or null when the person skipped the question. */
export type EventKindAnswer = PlannerEventKind | null;

export function isPlannerEventKind(value: unknown): value is PlannerEventKind {
  return value === "wedding" || value === "corporate" || value === "other";
}

/** The answer a layout's metadata holds: a kind, null (skipped), or undefined (never asked, or unreadable). */
export function storedEventKind(metadata: unknown): EventKindAnswer | undefined {
  if (typeof metadata !== "object" || metadata === null || !("eventKind" in metadata)) return undefined;
  const value: unknown = (metadata as { readonly eventKind?: unknown }).eventKind;
  if (value === null) return null;
  return isPlannerEventKind(value) ? value : undefined;
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
  readonly kind: EventKindAnswer;
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
    if (kind !== null && !isPlannerEventKind(kind)) continue;
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

/** This device's answer for a layout, or undefined when it holds none. */
export function deviceEventKind(configId: string): EventKindAnswer | undefined {
  return readDeviceRecord().entries.find((entry) => entry.configId === configId)?.kind;
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
 * as `?assembly=off` is for the Assembly.
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

/** Asks only a new, empty layout that nothing has answered for, and never over someone's work. */
export function shouldAskEventKind(facts: EventKindQuestionFacts): boolean {
  return facts.deviceAsks && facts.editable && facts.floorEmpty && !facts.eventLinked
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

/** Every word is true of the planner: the chair is lib/furniture-defaults' PLANNER_CHAIR_BY_EVENT, the shape layOutStyleFor. */
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

export interface EventKindQuestionState {
  /** The layout these facts are about; null before one opens. */
  readonly configId: string | null;
  /** A guest's draft: its answer is kept on this device. */
  readonly guest: boolean;
  /** Whether the layout's answer has been read: from its metadata, this device or the address. */
  readonly known: boolean;
  /** The layout's answer; undefined while unread or never asked. */
  readonly answer: EventKindAnswer | undefined;
  /** The answer holds in this tab but has not reached the layout (or, for a guest, this device) yet. */
  readonly unsaved: boolean;
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
  unsaved: false,
  changing: false,
  receipt: null,
};

export const useEventKindQuestion = create<EventKindQuestionState>()(() => INITIAL);

export interface EventKindRecordDeps {
  /** A signed-in layout's metadata as stored now. */
  readonly readMetadata: (configId: string) => Promise<unknown>;
  /** Writes the answer into a signed-in layout's metadata. */
  readonly writeMetadata: (configId: string, answer: EventKindAnswer) => Promise<unknown>;
}

const DEFAULT_DEPS: EventKindRecordDeps = {
  readMetadata: async (configId) => (await getConfig(configId)).metadata,
  writeMetadata: (configId, answer) => patchConfigMetadata(configId, { eventKind: answer }),
};

export interface OpenedLayout {
  readonly configId: string;
  /** A guest's draft. */
  readonly isPublicPreview: boolean;
  /** The planner's address (`?event=`). */
  readonly search: string;
  /** The layout's metadata, when the caller already holds it; read when omitted. */
  readonly metadata?: unknown;
}

let openToken = 0;
let receiptSeq = 0;
let writing: Promise<void> = Promise.resolve();
let stopRetry: (() => void) | null = null;

/** The layout's answer, read. A receipt or a change in hand stays: only a different layout clears those. */
function applyAnswer(configId: string, guest: boolean, answer: EventKindAnswer | undefined): void {
  useEventKindQuestion.setState({ configId, guest, known: true, answer, unsaved: false });
  usePlannerEventStore.getState().setEventKind(answer ?? null);
}

/**
 * Reads the layout's answer as it opens and sets the planner's kind from it.
 * A different layout forgets the last one's kind at once, so a new seat never
 * takes another event's chair while the answer is read. A signed-in layout
 * that holds no answer takes the address's, or the one this device kept for
 * it as a guest's draft, and the layout is given it. An unreadable answer is
 * left unknown: the planner then neither asks (it may have been answered) nor
 * changes the chair.
 */
export async function openLayoutEventKind(layout: OpenedLayout, deps: Partial<EventKindRecordDeps> = {}): Promise<void> {
  const use: EventKindRecordDeps = { ...DEFAULT_DEPS, ...deps };
  const token = ++openToken;
  const current = useEventKindQuestion.getState();
  // Read again when the same layout changes hands (a guest's draft claimed into an account opens signed in).
  if (current.configId === layout.configId && current.guest === layout.isPublicPreview && current.known && layout.metadata === undefined) return;
  if (current.configId !== layout.configId) {
    useEventKindQuestion.setState({ ...INITIAL, configId: layout.configId, guest: layout.isPublicPreview });
    usePlannerEventStore.getState().setEventKind(null);
  }
  const fromAddress = eventKindFromSearch(layout.search);
  const onDevice = deviceEventKind(layout.configId);
  if (layout.isPublicPreview) {
    applyAnswer(layout.configId, true, fromAddress ?? onDevice);
    if (fromAddress !== undefined && fromAddress !== onDevice) {
      useEventKindQuestion.setState({ unsaved: !rememberDeviceEventKind(layout.configId, fromAddress) });
    }
    return;
  }
  let stored: EventKindAnswer | undefined;
  try {
    stored = storedEventKind(layout.metadata !== undefined ? layout.metadata : await use.readMetadata(layout.configId));
  } catch {
    return;
  }
  if (token !== openToken || useEventKindQuestion.getState().configId !== layout.configId) return;
  const answer = fromAddress ?? (stored !== undefined ? stored : onDevice);
  applyAnswer(layout.configId, false, answer);
  if (answer !== undefined && answer !== stored) void writeAnswer(layout.configId, answer, use);
}

/** The person's answer (a kind, or null for "Not sure yet"): set at once, then kept with the layout. */
export function answerEventKind(answer: EventKindAnswer, deps: Partial<EventKindRecordDeps> = {}): void {
  const { configId, guest } = useEventKindQuestion.getState();
  if (configId === null) return;
  receiptSeq += 1;
  useEventKindQuestion.setState({ known: true, answer, changing: false, unsaved: false, receipt: { answer, seq: receiptSeq } });
  usePlannerEventStore.getState().setEventKind(answer);
  if (guest) {
    useEventKindQuestion.setState({ unsaved: !rememberDeviceEventKind(configId, answer) });
    return;
  }
  void writeAnswer(configId, answer, { ...DEFAULT_DEPS, ...deps });
}

/**
 * Writes a signed-in layout's answer, one write at a time. A failed write
 * leaves the answer held in this tab, marked unsaved, and is tried again when
 * the browser comes back online, with whatever the answer is by then.
 */
function writeAnswer(configId: string, answer: EventKindAnswer, deps: EventKindRecordDeps): Promise<void> {
  writing = writing.then(async () => {
    try {
      await deps.writeMetadata(configId, answer);
      const state = useEventKindQuestion.getState();
      if (state.configId === configId && state.answer === answer) useEventKindQuestion.setState({ unsaved: false });
    } catch {
      if (useEventKindQuestion.getState().configId !== configId) return;
      useEventKindQuestion.setState({ unsaved: true });
      retryWhenOnline(configId, deps);
    }
  });
  return writing;
}

function retryWhenOnline(configId: string, deps: EventKindRecordDeps): void {
  stopRetry?.();
  const unsubscribe = subscribeOnlineStatus((online) => {
    if (!online) return;
    unsubscribe();
    if (stopRetry === unsubscribe) stopRetry = null;
    const state = useEventKindQuestion.getState();
    if (state.configId === configId && state.unsaved && state.answer !== undefined) void writeAnswer(configId, state.answer, deps);
  });
  stopRetry = unsubscribe;
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

/** Forgets every answer and write in flight (tests). */
export function resetEventKindQuestionForTesting(): void {
  stopRetry?.();
  stopRetry = null;
  openToken = 0;
  receiptSeq = 0;
  writing = Promise.resolve();
  useEventKindQuestion.setState(INITIAL);
  usePlannerEventStore.getState().setEventKind(null);
}
