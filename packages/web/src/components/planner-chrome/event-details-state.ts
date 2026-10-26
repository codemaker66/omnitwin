import { create } from "zustand";
import {
  ConfigurationMetadataSchema,
  emptyEventInstructions,
  normalizeProtectedPremises,
  type EventInstructions,
} from "@omnitwin/types";
import { ApiError } from "../../api/client.js";
import { patchConfigMetadata } from "../../api/configurations.js";
import { createEventPhase, updateEventPhase } from "../../api/events.js";
import { actNameProblem, durationProblem, type ActFacts } from "../../lib/event-details-acts.js";
import { createSaveQueue, type SaveQueue, type SaveSnapshot } from "../../lib/event-details-queue.js";
import {
  announceEventChanged,
  getLayoutDetails,
  patchEventGuestCount,
  patchLayoutGuestCount,
} from "../../lib/event-details-requests.js";
import { eventDetailsLogSpec, sendableInstructions } from "../../lib/event-details-save.js";
import { isLayoutTimelineMutationLocked } from "../../lib/layout-timeline-preview-lock.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { logPlannerAction } from "../../stores/planner-action-log.js";

// ---------------------------------------------------------------------------
// Event details' drafts and saves, per layout (T-674 slice 19).
//
// The panel comes and goes; what was typed in it does not. Each layout's
// details live here from the first open: what the server holds, what has been
// typed, and one save queue per thing that saves (the instructions, the
// guests figure, each act), so closing the panel only sends sooner, reopening
// it never reads over an unsent edit (critic C-12: v1's reopen re-read the
// server and dropped it), and a layout switched away from keeps sending to
// its own layout. While anything is unsent the page asks before it unloads.
// ---------------------------------------------------------------------------

/** The pause after typing before a save goes (lens C-12: one request per pause, not per key). */
export const SAVE_PAUSE_MS = 800;

export type LoadStatus = "loading" | "loaded" | "failed";

export interface ActDraft {
  readonly name: string;
  readonly startsAt: string | null;
  readonly durationMinutes: number;
}

/** Where the guests figure is written: the event's when one is linked, else the layout's own. */
export type GuestsTarget =
  | { readonly kind: "event"; readonly eventId: string }
  | { readonly kind: "layout" };

interface GuestsValue {
  readonly count: number;
  readonly target: GuestsTarget;
}

export interface EventDetailsDoc {
  readonly configId: string;
  readonly load: LoadStatus;
  /** The layout is an unclaimed preview: no one can save details to it. */
  readonly preview: boolean;
  /** What the server holds, as last read or acknowledged. */
  readonly server: EventInstructions | null;
  /** What has been typed. */
  readonly draft: EventInstructions | null;
  /** The layout's own guests figure (configurations.guest_count), as last read or saved. */
  readonly layoutGuests: number | null;
  /** A guests figure typed and not yet acknowledged, else null. */
  readonly guestsTyped: number | null;
  /** The event's guests figure as this panel last saved it, over what the event read said. */
  readonly eventGuestsSaved: number | null;
  /** Acts as typed, over what the event read said. */
  readonly actDrafts: Readonly<Record<string, ActDraft>>;
  /** Acts as last saved from here. */
  readonly actsSaved: Readonly<Record<string, ActDraft>>;
  /** Acts added from here. */
  readonly addedActs: readonly ActFacts[];
  /** What was edited since the panel first opened, for "Saved" beside it. */
  readonly touched: Readonly<Record<string, true>>;
  /** Each save's state: "instructions", "guests", "act:<id>". */
  readonly saves: Readonly<Record<string, SaveSnapshot<unknown>>>;
  /** Adding an act: running, or failed until the next try. */
  readonly adding: "idle" | "running" | "failed";
}

interface EventDetailsState {
  readonly docs: Readonly<Record<string, EventDetailsDoc>>;
  /** Read the layout's details, unless an edit there is still unsent. */
  readonly open: (configId: string) => void;
  /** Read again after a failed read. */
  readonly reload: (configId: string) => void;
  readonly edit: (configId: string, section: string, change: (draft: EventInstructions) => EventInstructions) => void;
  readonly editGuests: (configId: string, count: number, target: GuestsTarget) => void;
  readonly editAct: (configId: string, eventId: string, act: ActFacts, patch: Partial<ActDraft>) => void;
  readonly addAct: (configId: string, eventId: string, act: ActDraft) => Promise<ActFacts | null>;
  /** Send everything waiting for this layout now (closing the panel). */
  readonly flush: (configId: string) => Promise<void>;
  /** Try every failed or held save for this layout again. */
  readonly retry: (configId: string) => void;
}

const queues = new Map<string, SaveQueue<unknown>>();
const SEP = "\u0000";

function online(): boolean {
  const navigatorOnline = typeof navigator === "undefined" || navigator.onLine;
  return navigatorOnline && useEditorStore.getState().isOnline;
}

/** Saves wait while the layout is read-only (with the events team, or an act's layout previewed). */
export function detailsLocked(): boolean {
  return isLayoutTimelineMutationLocked() || useEditorStore.getState().lockReason !== null;
}

function canSend(): boolean {
  return online() && !detailsLocked();
}

/** Anything typed and not yet acknowledged, on any layout. */
export function hasUnsentEventDetails(): boolean {
  for (const queue of queues.values()) if (queue.snapshot().unsent) return true;
  return false;
}

function docUnsent(configId: string): boolean {
  for (const [key, queue] of queues) if (key.startsWith(`${configId}${SEP}`) && queue.snapshot().unsent) return true;
  return false;
}

function retryAll(): void {
  for (const queue of queues.values()) queue.retry();
}

let pageGuardsOn = false;

/** The page asks before unloading with an edit unsent, and sends again when the connection or the layout reopens. */
function ensurePageGuards(): void {
  if (pageGuardsOn || typeof window === "undefined") return;
  pageGuardsOn = true;
  window.addEventListener("beforeunload", (event) => {
    if (!hasUnsentEventDetails()) return;
    event.preventDefault();
  });
  window.addEventListener("online", retryAll);
  useEditorStore.subscribe((state, previous) => {
    if ((state.isOnline && !previous.isOnline) || (state.lockReason === null && previous.lockReason !== null)) retryAll();
  });
}

function hydrate(metadata: unknown): EventInstructions | null {
  const parsed = ConfigurationMetadataSchema.nullable().safeParse(metadata ?? null);
  if (!parsed.success) return null;
  const loaded = parsed.data?.instructions;
  if (loaded === undefined) return emptyEventInstructions();
  // v1's hydration: Martyn's Law entries in their saved, normalised form so an
  // untouched block never reads as an edit.
  return { ...emptyEventInstructions(), ...loaded, protectedPremises: normalizeProtectedPremises(loaded.protectedPremises) };
}

function blankDoc(configId: string): EventDetailsDoc {
  return {
    configId,
    load: "loading",
    preview: false,
    server: null,
    draft: null,
    layoutGuests: null,
    guestsTyped: null,
    eventGuestsSaved: null,
    actDrafts: {},
    actsSaved: {},
    addedActs: [],
    touched: {},
    saves: {},
    adding: "idle",
  };
}

export const useEventDetailsStore = create<EventDetailsState>()((set, get) => {
  const patchDoc = (configId: string, change: (doc: EventDetailsDoc) => EventDetailsDoc): void => {
    set((state) => {
      const doc = state.docs[configId];
      return doc === undefined ? state : { docs: { ...state.docs, [configId]: change(doc) } };
    });
  };

  const queueFor = <T>(configId: string, target: string, send: (value: T) => Promise<void>): SaveQueue<T> => {
    ensurePageGuards();
    const key = `${configId}${SEP}${target}`;
    const existing = queues.get(key);
    if (existing !== undefined) return existing as SaveQueue<T>;
    const queue = createSaveQueue<T>({ send, delayMs: SAVE_PAUSE_MS, canSend });
    queue.subscribe(() => {
      patchDoc(configId, (doc) => ({ ...doc, saves: { ...doc.saves, [target]: queue.snapshot() } }));
    });
    queues.set(key, queue as SaveQueue<unknown>);
    return queue;
  };

  const load = (configId: string): void => {
    set((state) => ({ docs: { ...state.docs, [configId]: { ...(state.docs[configId] ?? blankDoc(configId)), load: "loading" } } }));
    getLayoutDetails(configId).then(
      (layout) => {
        // An edit typed while the read was out wins over it.
        if (docUnsent(configId)) {
          patchDoc(configId, (doc) => ({ ...doc, load: "loaded", preview: layout.isPublicPreview }));
          return;
        }
        const instructions = hydrate(layout.metadata);
        // Unreadable details are not editable: the PATCH replaces the whole
        // blob, so a blank form saved over them would erase them (v1's rule).
        if (instructions === null) {
          patchDoc(configId, (doc) => ({ ...doc, load: "failed" }));
          return;
        }
        patchDoc(configId, (doc) => ({
          ...doc,
          load: "loaded",
          preview: layout.isPublicPreview,
          server: instructions,
          draft: instructions,
          layoutGuests: layout.guestCount ?? null,
        }));
      },
      () => { patchDoc(configId, (doc) => ({ ...doc, load: "failed" })); },
    );
  };

  const instructionsQueue = (configId: string): SaveQueue<EventInstructions> => queueFor<EventInstructions>(configId, "instructions", async (draft) => {
    const before = get().docs[configId]?.server ?? null;
    const { payload } = sendableInstructions(draft, before);
    if (payload === null || JSON.stringify(payload) === JSON.stringify(before)) return;
    await patchConfigMetadata(configId, { instructions: payload });
    // The action log is the open layout's: a save for a layout switched away
    // from must not land in another layout's log (v1's guard).
    if (useEditorStore.getState().configId === configId) {
      const spec = eventDetailsLogSpec(before, payload);
      if (spec !== null) logPlannerAction(spec);
    }
    patchDoc(configId, (doc) => ({ ...doc, server: payload }));
  });

  const guestsQueue = (configId: string): SaveQueue<GuestsValue> => queueFor<GuestsValue>(configId, "guests", async ({ count, target }) => {
    if (target.kind === "event") await patchEventGuestCount(target.eventId, count);
    else await patchLayoutGuestCount(configId, count);
    patchDoc(configId, (doc) => ({
      ...doc,
      ...(target.kind === "event" ? { eventGuestsSaved: count } : { layoutGuests: count }),
      guestsTyped: doc.guestsTyped === count ? null : doc.guestsTyped,
    }));
    if (target.kind === "event") announceEventChanged({ eventId: target.eventId, what: "guests" });
  });

  const actQueue = (configId: string, eventId: string, actId: string): SaveQueue<ActDraft> => queueFor<ActDraft>(configId, `act:${actId}`, async (value) => {
    // A name or duration the event cannot take waits, said beside the field.
    if (actNameProblem(value.name) !== null || durationProblem(value.durationMinutes) !== null) return;
    await updateEventPhase(actId, { name: value.name.trim(), startsAt: value.startsAt, durationMinutes: value.durationMinutes });
    patchDoc(configId, (doc) => ({ ...doc, actsSaved: { ...doc.actsSaved, [actId]: value } }));
    announceEventChanged({ eventId, what: "acts" });
  });

  return {
    docs: {},
    open: (configId) => {
      const doc = get().docs[configId];
      if (doc !== undefined && (doc.load === "loading" || docUnsent(configId))) return;
      load(configId);
    },
    reload: (configId) => { load(configId); },
    edit: (configId, section, change) => {
      const doc = get().docs[configId];
      if (doc === undefined || doc.draft === null) return;
      const draft = change(doc.draft);
      patchDoc(configId, (current) => ({ ...current, draft, touched: { ...current.touched, [section]: true } }));
      instructionsQueue(configId).set(draft);
    },
    editGuests: (configId, count, target) => {
      patchDoc(configId, (doc) => ({ ...doc, guestsTyped: count, touched: { ...doc.touched, guests: true } }));
      guestsQueue(configId).set({ count, target });
    },
    editAct: (configId, eventId, act, patch) => {
      const doc = get().docs[configId];
      if (doc === undefined) return;
      const base = doc.actDrafts[act.id] ?? { name: act.name, startsAt: act.startsAt, durationMinutes: act.durationMinutes };
      const next = { ...base, ...patch };
      patchDoc(configId, (current) => ({
        ...current,
        actDrafts: { ...current.actDrafts, [act.id]: next },
        touched: { ...current.touched, [`act:${act.id}`]: true },
      }));
      actQueue(configId, eventId, act.id).set(next);
    },
    addAct: async (configId, eventId, act) => {
      patchDoc(configId, (doc) => ({ ...doc, adding: "running" }));
      try {
        // The schema's own defaults for the counts, which the panel does not set.
        const created = await createEventPhase(eventId, {
          name: act.name, startsAt: act.startsAt, durationMinutes: act.durationMinutes, opsTasksCount: 0, reviewGatesCount: 0,
        });
        const facts: ActFacts = { id: created.id, name: created.name, startsAt: created.startsAt, durationMinutes: created.durationMinutes, sortOrder: created.sortOrder };
        patchDoc(configId, (doc) => ({ ...doc, adding: "idle", addedActs: [...doc.addedActs, facts] }));
        announceEventChanged({ eventId, what: "acts" });
        return facts;
      } catch {
        patchDoc(configId, (doc) => ({ ...doc, adding: "failed" }));
        return null;
      }
    },
    flush: async (configId) => {
      await Promise.all([...queues].filter(([key]) => key.startsWith(`${configId}${SEP}`)).map(([, queue]) => queue.flush()));
    },
    retry: (configId) => {
      for (const [key, queue] of queues) if (key.startsWith(`${configId}${SEP}`)) queue.retry();
    },
  };
});

/** Forget every layout's details and saves (tests only). */
export function resetEventDetailsForTests(): void {
  queues.clear();
  useEventDetailsStore.setState({ docs: {} });
}

/** The connection dropped: the save waits for it rather than failing. */
export function isOfflineError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 0 && error.code === "NETWORK_ERROR";
}

/**
 * What a failed save says, in plain words, with what is safe. Never the
 * server's own message: a validation answer can quote what was sent.
 */
export function refusalWords(error: unknown): string {
  if (isOfflineError(error)) return "Not sent: you are offline. It is kept here while this page is open and sends when you are back.";
  if (error instanceof ApiError) {
    if (error.status === 401) return "Not saved: you have been signed out. It is kept here while this page is open; sign in again and it sends.";
    if (error.status === 403) return "Venviewer refused this change: you cannot change these details on this layout.";
    if (error.status === 404) return "Not saved: this layout or its event is no longer on Venviewer.";
    if (error.status === 409 || error.status === 423) return "Not saved: the layout is with the events team for approval.";
    if (error.status === 400 || error.status === 422) return "Venviewer could not take one of these details. Check this section, then try again.";
  }
  return "Not saved: Venviewer did not answer. It is kept here while this page is open.";
}
