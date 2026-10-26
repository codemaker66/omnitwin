import { useEffect, useMemo, useRef, type ReactElement } from "react";
import { useSearchParams } from "react-router-dom";
import { X } from "lucide-react";
import type { EventInstructions } from "@omnitwin/types";
import { ActivityStatus } from "../shared/Activity.js";
import { useClientEventSchedule } from "../../hooks/use-client-event-schedule.js";
import { useLinkedEvent } from "../../hooks/use-linked-event.js";
import { actOverlaps, runningOrder, type ActFacts, type OrderedAct } from "../../lib/event-details-acts.js";
import type { SaveSnapshot } from "../../lib/event-details-queue.js";
import { EVENT_DETAILS_SECTIONS, sendableInstructions } from "../../lib/event-details-save.js";
import { defaultLeadTime, glasgowClock, glasgowDay } from "../../lib/event-details-times.js";
import { canReadInternalEventData, isCustomerRole } from "../../lib/event-access.js";
import { useEscapeLayer } from "../../lib/planner-keys.js";
import { useAuthStore } from "../../stores/auth-store.js";
import { useEditorStore } from "../../stores/editor-store.js";
import { usePlannerChromeStore } from "../../stores/planner-chrome-store.js";
import {
  isOfflineError,
  refusalWords,
  useEventDetailsStore,
  type ActDraft,
  type EventDetailsDoc,
  type GuestsTarget,
} from "./event-details-state.js";
import {
  Access,
  ContactOnTheDay,
  DietaryAndAccessibility,
  DoorSchedule,
  ForTheHallkeeper,
  Guests,
  MartynsLaw,
  RunningOrder,
  SetupDeadlines,
  type ActPatch,
  type InstructionsProps,
  type SectionMark,
} from "./EventDetailsSections.js";
import { Key, QuietKey } from "./Keys.js";
import "./chrome.css";
import "./event-details.css";

// ---------------------------------------------------------------------------
// Event details, in the left zone (T-674 slice 19; spec 6.13, 4.5, 6.1, 12,
// 13; lens C-05, C-12, C-13, C-15, C-16; critic C-X2).
//
// A panel, not a dialog: the room stays live beside it. It holds the running
// order (the acts the evening shows), the guests, the contact on the day,
// access, dietary needs and accessibility, the door schedule and set-up
// deadlines, Martyn's Law readiness, and the instructions for the hallkeeper.
// Every field saves as you type, one request at a time (event-details-state);
// Esc and Close send anything waiting and return focus to whatever opened it.
//
// Who sees what:
//   - a guest (not signed in, or a layout not yet theirs): one line on what
//     event details are and how to get them, and no fields;
//   - a client: their layout's details; their event's guests and acts to read;
//   - staff: everything, the event's guests and acts to edit, and the
//     function sheet.
// While the layout is with the events team (in review) everything reads only.
// ---------------------------------------------------------------------------

export interface EventDetailsPanelProps {
  /** The control that opened the panel, for focus on close (default: what had focus when it opened, else the slate's title). */
  readonly returnFocusTo?: () => HTMLElement | null;
}

/** What a guest reads instead of fields. */
export const GUEST_LINE = "Event details hold the running order, guests and notes the hall works from on the day. Send your layout to the events team and they'll set up your event here.";

const LOCK_LINES: Readonly<Record<string, string>> = {
  "in-review": "View only · sent for approval",
  "phase-preview": "View only · previewing an act's layout",
};

const OFFLINE_HELD = "Not sent: you are offline. It is kept here while this page is open and sends when you are back.";
const LOCKED_HELD = "Waiting: the layout is view only just now. It is kept here while this page is open.";

interface PanelEvent {
  readonly id: string;
  readonly name: string;
  readonly startsAt: string | null;
  readonly guestCount: number;
}

type EventRead = "none" | "loading" | "failed" | "read";

function savedClock(snapshot: SaveSnapshot<unknown> | undefined): string | null {
  return snapshot === undefined || snapshot.savedAt === null ? null : glasgowClock(new Date(snapshot.savedAt).toISOString());
}

/** A dirty save's mark from its queue: failing, held (offline or locked), or on its way. */
function pendingMark(snapshot: SaveSnapshot<unknown> | undefined): SectionMark {
  if (snapshot?.phase === "failed") return { kind: "failed", line: refusalWords(snapshot.error) };
  if (snapshot?.phase === "held") return { kind: "held", line: typeof navigator !== "undefined" && !navigator.onLine ? OFFLINE_HELD : LOCKED_HELD };
  return { kind: "saving" };
}

function settledMark(touched: boolean, snapshot: SaveSnapshot<unknown> | undefined): SectionMark {
  return touched ? { kind: "saved", at: savedClock(snapshot) } : { kind: "none" };
}

/** Each instructions section's mark. */
export function instructionMarks(doc: EventDetailsDoc): Readonly<Record<string, SectionMark>> {
  if (doc.draft === null) return {};
  const snapshot = doc.saves["instructions"];
  const { payload, held } = sendableInstructions(doc.draft, doc.server);
  const marks: Record<string, SectionMark> = {};
  for (const section of EVENT_DETAILS_SECTIONS) {
    const heldLine = held[section];
    const sent = payload === null ? doc.draft[section] : payload[section];
    const dirty = JSON.stringify(sent ?? null) !== JSON.stringify(doc.server?.[section] ?? null);
    if (heldLine !== undefined) marks[section] = { kind: "held", line: heldLine };
    else if (dirty && payload === null) marks[section] = { kind: "held", line: "This section cannot be saved as it is. Check what was typed." };
    else if (dirty) marks[section] = pendingMark(snapshot);
    else marks[section] = settledMark(doc.touched[section] === true, snapshot);
  }
  return marks;
}

interface PhaseLike {
  readonly id: string;
  readonly name: string;
  readonly startsAt: string | null;
  readonly durationMinutes: number;
  readonly sortOrder?: number;
}

function actFactsFrom(phases: readonly PhaseLike[]): readonly ActFacts[] {
  return phases.map((phase, index) => ({
    id: phase.id, name: phase.name, startsAt: phase.startsAt, durationMinutes: phase.durationMinutes, sortOrder: phase.sortOrder ?? index,
  }));
}

/** Where a new act starts: when the last timed act ends, else the event's start. */
export function nextActStart(acts: readonly OrderedAct[], eventStart: string | null): string | null {
  const last = [...acts].reverse().find((act) => act.endsAt !== null);
  return last?.endsAt ?? eventStart;
}

/** The panel's one summary line: the worst state wins. */
export function summaryOf(marks: readonly SectionMark[]): { readonly mark: SectionMark; readonly words: string } {
  const failed = marks.find((mark) => mark.kind === "failed");
  if (failed?.kind === "failed") return { mark: failed, words: failed.line };
  if (marks.some((mark) => mark.kind === "saving")) return { mark: { kind: "saving" }, words: "Saving" };
  const held = marks.find((mark) => mark.kind === "held");
  if (held?.kind === "held") return { mark: held, words: held.line };
  const times = marks.flatMap((mark) => (mark.kind === "saved" ? [mark.at] : []));
  if (times.length > 0) {
    const at = times.filter((value): value is string => value !== null).sort().at(-1) ?? null;
    return { mark: { kind: "saved", at }, words: at === null ? "Saved" : `Saved ${at}` };
  }
  return { mark: { kind: "none" }, words: "Every change saves as you type." };
}

export function EventDetailsPanel({ returnFocusTo }: EventDetailsPanelProps = {}): ReactElement {
  const configId = useEditorStore((state) => state.configId);
  const venueId = useEditorStore((state) => state.venueId);
  const isPublicPreview = useEditorStore((state) => state.isPublicPreview);
  const lockReason = useEditorStore((state) => state.lockReason);
  const auth = useAuthStore();
  const staff = canReadInternalEventData(auth);
  const signedIn = !auth.isLoading && auth.isAuthenticated;
  const customer = !staff && signedIn && isCustomerRole(auth.user?.role);
  const [searchParams] = useSearchParams();
  const requested = searchParams.get("eventId")?.trim() ?? "";
  const eventId = requested.length === 0 ? null : requested;
  const linked = useLinkedEvent(venueId);
  const schedule = useClientEventSchedule(eventId, { configurationId: configId, expectedVenueId: venueId, enabled: customer });
  const doc = useEventDetailsStore((state) => (configId === null ? undefined : state.docs[configId]));
  const store = useEventDetailsStore.getState;

  const guest = !signedIn || isPublicPreview || configId === null || doc?.preview === true;
  const readOnly = lockReason !== null;

  // -- Open, close, and focus (spec 4.5) --------------------------------------
  const sectionRef = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && sectionRef.current?.contains(active) !== true) opener.current = active;
    // Its first control takes the focus: the close key, so a phone's keyboard does not rise unasked.
    sectionRef.current?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (configId === null || !signedIn || isPublicPreview) return;
    store().open(configId);
  }, [configId, isPublicPreview, signedIn, store]);

  // Leaving sends what is waiting at once; the saves outlive the panel.
  useEffect(() => {
    if (configId === null) return;
    return () => { void store().flush(configId); };
  }, [configId, store]);

  const close = (): void => {
    if (configId !== null) void store().flush(configId);
    usePlannerChromeStore.getState().close("left");
  };
  const focusBack = (): HTMLElement | null => {
    const given = returnFocusTo?.() ?? null;
    if (given?.isConnected === true) return given;
    if (opener.current?.isConnected === true) return opener.current;
    return document.querySelector<HTMLElement>(".pc-slate__title");
  };
  useEscapeLayer("panel", { open: true, onEscape: close, returnFocusTo: focusBack });

  // -- The event, its acts and its guests ---------------------------------------
  const event: PanelEvent | null = staff
    ? (linked.graph === null ? null : linked.graph.event)
    : schedule.data === null ? null : schedule.data.event;
  const eventRead: EventRead = eventId === null ? "none"
    : event !== null ? "read"
      : staff ? (linked.status === "error" ? "failed" : linked.status === "none" ? "none" : "loading")
        : customer ? (schedule.status === "loading" ? "loading" : "failed") : "none";
  const sourceActs = useMemo<readonly ActFacts[]>(() => {
    if (staff && linked.graph !== null) return actFactsFrom(linked.graph.phases);
    if (!staff && schedule.data !== null) return actFactsFrom(schedule.data.phases);
    return [];
  }, [linked.graph, schedule.data, staff]);
  const actDrafts = doc?.actDrafts;
  const addedActs = doc?.addedActs;
  const acts = useMemo(() => {
    const known = new Set(sourceActs.map((act) => act.id));
    const all = [...sourceActs, ...(addedActs ?? []).filter((act) => !known.has(act.id))];
    return runningOrder(all.map((act) => {
      const draft = actDrafts?.[act.id];
      return draft === undefined ? act : { ...act, ...draft };
    }));
  }, [actDrafts, addedActs, sourceActs]);
  const overlaps = useMemo(() => actOverlaps(acts), [acts]);
  const actsEditable = staff && event !== null && !readOnly;

  const guestsTarget: GuestsTarget | null = event !== null ? { kind: "event", eventId: event.id } : eventRead === "none" ? { kind: "layout" } : null;
  const guestsValue = doc === undefined ? null
    : doc.guestsTyped ?? (event !== null ? (doc.eventGuestsSaved ?? event.guestCount) : doc.layoutGuests);
  const guestsEditable = !readOnly && guestsTarget !== null && (guestsTarget.kind === "layout" || staff);
  const guestsLine = event !== null
    ? (staff ? "The event's figure, the one the plane shows." : "Your event's figure. The events team keeps it up to date.")
    : eventRead === "loading" ? "Reading the event."
      : eventRead === "failed" ? "The event could not be read, so its guests are not shown here."
        : "This layout's figure, printed on the function sheet.";

  // -- Marks ---------------------------------------------------------------------
  const marks = doc === undefined ? {} : instructionMarks(doc);
  const guestsMark: SectionMark = doc === undefined ? { kind: "none" }
    : doc.guestsTyped !== null ? pendingMark(doc.saves["guests"])
      : settledMark(doc.touched["guests"] === true, doc.saves["guests"]);
  const actMarks: Record<string, SectionMark> = {};
  if (doc !== undefined) {
    for (const act of acts) {
      const typed = doc.actDrafts[act.id];
      const base: ActDraft | undefined = doc.actsSaved[act.id] ?? sourceActs.find((source) => source.id === act.id);
      const snapshot = doc.saves[`act:${act.id}`];
      const dirty = typed !== undefined && (base === undefined
        || typed.name !== base.name || typed.startsAt !== base.startsAt || typed.durationMinutes !== base.durationMinutes);
      actMarks[act.id] = dirty ? pendingMark(snapshot) : settledMark(doc.touched[`act:${act.id}`] === true, snapshot);
    }
  }
  const summary = summaryOf([...Object.values(marks), guestsMark, ...Object.values(actMarks)]);
  const offlineOnly = Object.values(doc?.saves ?? {}).every((snapshot) => snapshot.phase !== "failed" || isOfflineError(snapshot.error));
  const offerRetry = summary.mark.kind === "failed" && !offlineOnly;

  // -- Edits ---------------------------------------------------------------------
  const onEdit = (section: string, change: (draft: EventInstructions) => EventInstructions): void => {
    if (configId === null || readOnly) return;
    store().edit(configId, section, change);
  };
  const onEditAct = (act: OrderedAct, patch: ActPatch): void => {
    if (configId === null || event === null || !actsEditable) return;
    store().editAct(configId, event.id, act, patch);
  };
  const onAddAct = (): void => {
    if (configId === null || event === null) return;
    void store().addAct(configId, event.id, { name: "New act", startsAt: nextActStart(acts, event.startsAt), durationMinutes: 60 });
  };
  const leadTime = (): string => defaultLeadTime(event?.startsAt ?? null, new Date());

  const day = glasgowDay(event?.startsAt ?? null);
  const subtitle = event === null ? null : day === null ? event.name : `${event.name} · ${day}`;
  const lockLine = lockReason === null ? null : (LOCK_LINES[lockReason] ?? "View only");
  const actsLine = event === null
    ? (eventRead === "loading" ? "Reading the event."
      : eventRead === "failed" ? "The event could not be read, so its acts are not shown here."
        : staff ? "Open this layout from its event to set the running order."
          : "The running order comes with your event: the events team sets it up.")
    : actsEditable ? "Glasgow time. The evening shows these acts."
      : staff ? "Glasgow time. View only while the layout is with the events team."
        : "Glasgow time. The events team sets the timings.";

  const instructionsProps: Omit<InstructionsProps, "draft"> = { readOnly, marks, guests: guestsValue, onEdit, leadTime };
  const loading = doc === undefined || (doc.draft === null && doc.load === "loading");
  const failed = doc !== undefined && doc.draft === null && doc.load === "failed";

  return (
    <section
      ref={sectionRef}
      className="pc-lacquer pc-lacquer--raised pc-ed"
      aria-labelledby="pc-ed-heading"
      data-testid="planner-event-details"
      data-state={guest ? "guest" : loading ? "loading" : failed ? "failed" : readOnly ? "read-only" : "editing"}
    >
      <header className="pc-ed__head">
        <div className="pc-ed__titles">
          <h2 id="pc-ed-heading" className="pc-title pc-ed__title">Event details</h2>
          {subtitle !== null && !guest ? <p className="pc-meta pc-ed__subtitle">{subtitle}</p> : null}
        </div>
        <Key label="Close" iconOnly small icon={<X className="pc-icon" aria-hidden="true" />} shortcut={["Esc"]} tooltipSide="below" onPress={close} />
      </header>

      {guest ? (
        <p className="pc-ed__guest" data-testid="planner-event-details-guest">{GUEST_LINE}</p>
      ) : loading ? (
        <div className="pc-ed__status-panel">
          <ActivityStatus>Reading the event details</ActivityStatus>
        </div>
      ) : failed || doc.draft === null ? (
        <div className="pc-ed__status-panel" role="alert">
          <p className="pc-ed__guest">These event details could not be read, so they cannot be changed here until they are. Nothing here can overwrite them.</p>
          <QuietKey label="Try again" onPress={() => { store().reload(configId); }} />
        </div>
      ) : (
        <>
          {lockLine !== null ? <p className="pc-meta pc-ed__lock" data-testid="planner-event-details-lock">{lockLine}</p> : null}
          <div className="pc-ed__body">
            <RunningOrder
              acts={acts}
              overlaps={overlaps}
              editable={actsEditable}
              line={actsLine}
              noEvent={event === null}
              eventStart={event?.startsAt ?? null}
              marks={actMarks}
              onEdit={onEditAct}
              onAdd={actsEditable ? onAddAct : null}
              adding={doc.adding}
            />
            <Guests
              value={guestsValue}
              editable={guestsEditable}
              line={guestsLine}
              mark={guestsMark}
              onChange={(count) => { if (guestsTarget !== null) store().editGuests(configId, count, guestsTarget); }}
            />
            <ContactOnTheDay draft={doc.draft} {...instructionsProps} />
            <Access draft={doc.draft} {...instructionsProps} />
            <DietaryAndAccessibility draft={doc.draft} {...instructionsProps} />
            <DoorSchedule draft={doc.draft} {...instructionsProps} />
            <SetupDeadlines draft={doc.draft} {...instructionsProps} />
            <MartynsLaw draft={doc.draft} {...instructionsProps} />
            <ForTheHallkeeper draft={doc.draft} {...instructionsProps} />
          </div>
        </>
      )}

      {!guest ? (
        <footer className="pc-ed__foot">
          <p className="pc-meta pc-ed__summary" role="status" data-testid="planner-event-details-status" data-mark={summary.mark.kind}>{summary.words}</p>
          <div className="pc-ed__foot-keys">
            {offerRetry ? <QuietKey label="Try again" onPress={() => { store().retry(configId); }} /> : null}
            {staff ? (
              <a className="pc-quiet" href={`/hallkeeper/${encodeURIComponent(configId)}`} target="_blank" rel="noopener noreferrer" data-testid="planner-event-details-sheet">
                <span>Open the function sheet</span>
              </a>
            ) : null}
          </div>
        </footer>
      ) : null}
    </section>
  );
}
