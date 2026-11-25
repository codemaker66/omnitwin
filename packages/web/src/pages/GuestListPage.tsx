import { useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent as KeyEvent, type ReactElement } from "react";
import { flushSync } from "react-dom";
import { getPublicConfig } from "../api/configurations.js";
import { GuestPanel, type RoomState } from "../components/guest-list/GuestPanel.js";
import { GuestPaste, type PastedGuest } from "../components/guest-list/GuestPaste.js";
import { GuestRows, type GuestFilter } from "../components/guest-list/GuestRows.js";
import { GuestTables } from "../components/guest-list/GuestTables.js";
import { KitGate } from "../components/guest-list/KitGate.js";
import {
  counted,
  DATE_REFUSED,
  NOT_KEPT,
  NOT_OPENED,
  noticeWords,
  seatedSentence,
  toSeatSentence,
} from "../components/guest-list/words.js";
import { ActivityIndicator, ActivityStatus } from "../components/shared/Activity.js";
import {
  earliestEventDate,
  eventDateRefused,
  GuestListSchema,
  GUESTS_MAX,
  SEATS_DEFAULT,
  TABLES_MAX,
  type GuestList,
} from "../lib/guest-list/model.js";
import { planTables, tablesDiffer } from "../lib/guest-list/plan-tables.js";
import { addGuests, moveGuest, seatEveryone, setTables, setTableSeats, summary, type MoveRefusal } from "../lib/guest-list/seating.js";
import { guestListStore, type GuestListStore } from "../lib/guest-list/store.js";
import { useGuestListStore } from "../stores/guest-list-store.js";
import "./GuestListPage.css";

// ---------------------------------------------------------------------------
// The planner's guest list (the planner's kit), at /plan/:code/guests behind
// the kit's switch. One desk for the event: the list is pasted in once, seats
// are given from the list (never drawn in the room), and the paper is one link
// away. The names are kept only in this browser: the one request this page
// makes is the read of the plan, to count the room's tables, and the desk
// never waits for it.
// ---------------------------------------------------------------------------

const PAGE_TITLE = "Guest list";
const TITLE_MAX = GuestListSchema.shape.title.maxLength ?? 120;

type View = GuestFilter | "tables";

const REFUSED: Readonly<Record<MoveRefusal["refused"], string>> = {
  "seat-taken": "That seat is taken.",
  "table-full": "That table is full.",
  "no-such-table": "That table is no longer on the list.",
  "no-such-guest": "That guest is no longer on the list.",
};

export function GuestListPage({ store }: { readonly store?: GuestListStore }): ReactElement {
  return (
    <KitGate title={PAGE_TITLE}>
      {(planId) => <GuestDesk key={planId} planId={planId} store={store ?? guestListStore()} />}
    </KitGate>
  );
}

export default GuestListPage;

// ---------------------------------------------------------------------------
// Opening: the list from this device, and the room from the plan
// ---------------------------------------------------------------------------

/**
 * Reads the device every time the page mounts: removes lists past their day,
 * then opens this plan's list, or, when the page state already holds it (the
 * planner went to another page of the app and came back), takes up what
 * another tab did meanwhile. Answers false until that read has returned: the
 * page stays in its opening state till then, so nothing can be typed over a
 * list the page has not yet seen.
 */
function useOpenedList(planId: string, store: GuestListStore): boolean {
  const [read, setRead] = useState(false);
  /** A sweep of this mount removed this plan's list. Kept through React's second run of the effect in development. */
  const sweptHere = useRef(false);
  useEffect(() => {
    const left = new AbortController();
    // Read afresh after each wait: the planner may leave while one runs.
    const gone = (): boolean => left.signal.aborted;
    void (async () => {
      // The sweep goes first, so a list past its removal day is never shown.
      try {
        if ((await store.sweep(Date.now())).includes(planId)) sweptHere.current = true;
      } catch {
        // A tidy-up only: the list still opens.
      }
      if (gone()) return;
      const page = useGuestListStore.getState();
      const mount = { sweptHere: sweptHere.current };
      if (page.planId !== planId) await page.open(planId, store, undefined, mount);
      else await page.refresh(mount);
      // In one step with its effects, as when the page state itself changes: the desk is never on the page half set up.
      if (!gone()) flushSync(() => { setRead(true); });
    })();
    return () => { left.abort(); };
  }, [planId, store]);
  return read;
}

/** The one read of the plan, to count its tables. Any failure leaves the list as it is. */
function useRoom(planId: string): RoomState {
  const [room, setRoom] = useState<RoomState>({ status: "waiting" });
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const plan = await getPublicConfig(planId, controller.signal);
        if (!controller.signal.aborted) setRoom({ status: "ready", name: plan.name, tables: planTables(plan.objects ?? []) });
      } catch {
        if (!controller.signal.aborted) setRoom({ status: "failed" });
      }
    })();
    return () => { controller.abort(); };
  }, [planId]);
  return room;
}

/**
 * A change waiting to be kept is kept as the tab goes out of sight, and as the
 * page is left (a close, a reload, a move to another site): the save starts at
 * once, without waiting out the autosave. Nothing is written in the first
 * moments after a change, and a save started as a tab closes may not finish,
 * so while a change is waiting to be kept, or being kept, the browser is asked
 * to confirm leaving. When the page is seen again, or its window gains focus,
 * what another tab did to the list is taken up, unless a change here is still
 * unsaved.
 */
function useKeepWhenHidden(): void {
  useEffect(() => {
    const takeUp = (): void => { void useGuestListStore.getState().refresh(); };
    const keep = (): void => { void useGuestListStore.getState().flush(); };
    const onVisibility = (): void => {
      if (document.visibilityState === "hidden") keep();
      else takeUp();
    };
    const onLeaving = (event: BeforeUnloadEvent): void => {
      if (!useGuestListStore.getState().changeWaiting()) return;
      event.preventDefault();
      // Older engines ask only when a return value is set; current ones go by preventDefault.
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- set for those older engines only
      event.returnValue = "";
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", takeUp);
    window.addEventListener("pagehide", keep);
    window.addEventListener("beforeunload", onLeaving);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", takeUp);
      window.removeEventListener("pagehide", keep);
      window.removeEventListener("beforeunload", onLeaving);
    };
  }, []);
}

function GuestDesk({ planId, store }: { readonly planId: string; readonly store: GuestListStore }): ReactElement {
  const openPlan = useGuestListStore((s) => s.planId);
  const phase = useGuestListStore((s) => s.phase);
  const list = useGuestListStore((s) => s.list);
  const room = useRoom(planId);
  const read = useOpenedList(planId, store);
  useKeepWhenHidden();
  // Each delete draws the desk afresh, so nothing the planner typed, pasted or was told about a guest stays on the page.
  const [erasures, setErasures] = useState(0);
  const erase = async (): Promise<void> => {
    await useGuestListStore.getState().eraseList();
    setErasures((n) => n + 1);
  };

  let body: ReactElement;
  if (!read || openPlan !== planId || phase === "opening" || (phase === "ready" && list === null)) {
    body = (
      <div className="gl-waiting">
        <ActivityStatus variant="panel">Opening your guest list…</ActivityStatus>
      </div>
    );
  } else if (phase === "unreadable" || list === null) {
    body = <Unreadable />;
  } else {
    body = <ReadyDesk key={erasures} planId={planId} list={list} room={room} onErase={erase} afterErase={erasures > 0} />;
  }
  return <div className="gl" data-register="ivory" data-testid="guest-list-page">{body}</div>;
}

function Unreadable(): ReactElement {
  const [starting, setStarting] = useState(false);
  const startAgain = async (): Promise<void> => {
    setStarting(true);
    try {
      await useGuestListStore.getState().startAgain();
    } finally {
      setStarting(false);
    }
  };
  return (
    <main className="gl-alone">
      <h1 className="gl-alone__title">Guest list</h1>
      <p className="gl-alone__lede">A list was kept here for this plan, but it cannot be read.</p>
      <p className="gl-alone__detail">Starting a new list removes what was kept here for this plan.</p>
      <div className="gl-actions">
        <button type="button" className="gl-button gl-button--primary" aria-busy={starting} aria-disabled={starting}
          onClick={() => { if (!starting) void startAgain(); }}>
          {starting && <ActivityIndicator size={16} />}
          {starting ? "Starting a new list…" : "Start a new list"}
        </button>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// The desk
// ---------------------------------------------------------------------------

function commonest(values: readonly number[]): number {
  const tally = new Map<number, number>();
  for (const value of values) tally.set(value, (tally.get(value) ?? 0) + 1);
  let best = SEATS_DEFAULT;
  let most = 0;
  for (const [value, times] of tally) {
    if (times > most || (times === most && value > best)) {
      best = value;
      most = times;
    }
  }
  return best;
}

function showingWords(view: View, list: GuestList, openTable: number | null): string | null {
  const counts = summary(list);
  switch (view) {
    case "tables":
      if (counts.tables === 0) return null;
      return `Showing all ${counted(counts.tables, "table", "tables")}.${openTable === null ? "" : ` Table ${String(openTable)} is open.`}`;
    case "all":
      return counts.guests === 0 ? null : `Showing all ${counted(counts.guests, "guest", "guests")}, A to Z`;
    case "seated":
      return counts.seated === 0 ? null : `Showing the ${counted(counts.seated, "guest who has", "guests who have")} a seat, A to Z`;
    case "to-seat":
      return counts.toSeat === 0 ? null : `Showing the ${counted(counts.toSeat, "guest", "guests")} with no seat yet`;
  }
}

/** Where the focus can be sent once the desk has drawn again; a target that is gone falls back to the sheet's heading. */
type FocusTarget = "box" | "next" | "showing" | "moving" | "tables" | "heading" | "add-guests" | "change-tables";

// The page state's actions, called through the store each time.
function apply(change: (list: GuestList) => GuestList, opts?: { readonly undo?: boolean }): void {
  useGuestListStore.getState().apply(change, opts);
}

function undoLast(): void {
  useGuestListStore.getState().undo();
}

function closeNotice(): void {
  useGuestListStore.getState().dismissNotice();
}

interface ReadyDeskProps {
  readonly planId: string;
  readonly list: GuestList;
  readonly room: RoomState;
  readonly onErase: () => Promise<void>;
  /** This desk was drawn after a delete: the focus starts on the sheet's heading. */
  readonly afterErase: boolean;
}

function ReadyDesk({ planId, list, room, onErase, afterErase }: ReadyDeskProps): ReactElement {
  const id = useId();
  const kept = useGuestListStore((s) => s.kept);
  const unread = useGuestListStore((s) => s.unread);
  const notice = useGuestListStore((s) => s.notice);
  const canUndo = useGuestListStore((s) => s.canUndo);
  const takeUps = useGuestListStore((s) => s.takeUps);
  const counts = summary(list);

  const [view, setView] = useState<View>(() => (list.tables.length > 0 ? "tables" : "all"));
  const [openTableId, setOpenTableId] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [returnView, setReturnView] = useState<View | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const [tableNotice, setTableNotice] = useState<string | null>(null);
  const [roomNoticeClosed, setRoomNoticeClosed] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [tablesFormOpen, setTablesFormOpen] = useState(false);
  /** The control that opened the tables form, for the focus to go back to on Cancel. */
  const [tablesFormFrom, setTablesFormFrom] = useState<"next" | "change-tables">("next");
  const [focusAsk, setFocusAsk] = useState<{ readonly target: FocusTarget; readonly n: number } | null>(
    afterErase ? { target: "heading", n: 0 } : null,
  );

  const boxRef = useRef<HTMLTextAreaElement>(null);
  const showingRef = useRef<HTMLParagraphElement>(null);
  const movingRef = useRef<HTMLParagraphElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const addGuestsRef = useRef<HTMLButtonElement>(null);
  const changeTablesRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLElement | null>(null);
  const tablesFieldRef = useRef<HTMLInputElement | null>(null);
  /** The control focused when the table notice appeared, for its Close to return to. */
  const tableNoticeFrom = useRef<HTMLElement | null>(null);
  // Typing in the title, or keeping a date, is one change for undo: the first of each visit to the field.
  const fieldVisit = useRef(false);
  /** The date field's value while it is worked in; kept to the list when the field is left, or on Enter. */
  const [dateDraft, setDateDraft] = useState(list.eventDate ?? "");
  /** A date was refused because the list would be removed at once; said beside the field. */
  const [dateRefused, setDateRefused] = useState(false);
  const dateRef = useRef<HTMLInputElement>(null);

  // A change from elsewhere (undo) shows in the field.
  useEffect(() => { setDateDraft(list.eventDate ?? ""); }, [list.eventDate]);

  // A list taken up from another tab: the seat line and the date refusal spoke of the list before it.
  useEffect(() => {
    setSaid("");
    setDateRefused(false);
  }, [takeUps]);

  const focusOn = (target: FocusTarget): void => {
    setFocusAsk((was) => ({ target, n: (was?.n ?? 0) + 1 }));
  };

  useEffect(() => {
    if (focusAsk === null) return;
    const targets: Readonly<Record<FocusTarget, HTMLElement | null>> = {
      box: boxRef.current,
      next: nextRef.current,
      showing: showingRef.current,
      moving: movingRef.current,
      tables: tablesFieldRef.current,
      heading: headingRef.current,
      "add-guests": addGuestsRef.current,
      "change-tables": changeTablesRef.current,
    };
    (targets[focusAsk.target] ?? headingRef.current)?.focus();
  }, [focusAsk]);

  /** Closing a notice: back to the control that was in use when it appeared, while it is still there. */
  const closeAndRefocus = (close: () => void, from: HTMLElement | null): void => {
    close();
    if (from?.isConnected === true) from.focus();
    else headingRef.current?.focus();
  };

  const sayTables = (words: string): void => {
    const active = document.activeElement;
    tableNoticeFrom.current = active instanceof HTMLElement && active !== document.body ? active : null;
    setTableNotice(words);
  };

  const chosen = moving === null ? undefined : list.guests.find((g) => g.id === moving);
  const movingId = chosen === undefined ? null : chosen.id;

  const finishMoving = (): void => {
    setMoving(null);
    setRefusal(null);
    if (returnView !== null) setView(returnView);
    setReturnView(null);
    focusOn("showing");
  };

  // Escape lets go of a chosen guest, wherever the focus is.
  useEffect(() => {
    if (movingId === null) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      setMoving(null);
      setRefusal(null);
      if (returnView !== null) setView(returnView);
      setReturnView(null);
      showingRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); };
  }, [movingId, returnView]);

  // A removed table takes its focused button with it: the focus goes to the ledger's head.
  useEffect(() => {
    if (tableNotice !== null && (document.activeElement === null || document.activeElement === document.body)) {
      showingRef.current?.focus();
    }
  }, [tableNotice]);

  const showView = (next: View): void => {
    setView(next);
    setReturnView(null);
  };

  const choose = (guestId: string): void => {
    if (movingId === guestId) {
      finishMoving();
      return;
    }
    setMoving(guestId);
    setRefusal(null);
    if (view !== "tables") {
      setReturnView((was) => was ?? view);
      setView("tables");
    }
    focusOn("moving");
  };

  const place = (tableId: string | null, seat?: number): void => {
    if (chosen === undefined) return;
    const result = moveGuest(list, chosen.id, tableId, seat);
    if ("refused" in result) {
      setRefusal(REFUSED[result.refused]);
      return;
    }
    apply((l) => {
      const moved = moveGuest(l, chosen.id, tableId, seat);
      return "refused" in moved ? l : moved;
    });
    const seatNow = result.guests.find((g) => g.id === chosen.id)?.seat ?? null;
    const table = tableId === null ? undefined : result.tables.find((t) => t.id === tableId);
    setSaid(table === undefined || seatNow === null
      ? `${chosen.name} has no seat now.`
      : `${chosen.name} is at table ${String(table.number)}, seat ${String(seatNow)}.`);
    finishMoving();
  };

  const addPasted = (guests: readonly PastedGuest[]): void => {
    const ids = guests.map(() => crypto.randomUUID());
    const before = list.guests.length;
    const next = addGuests(list, guests, ids);
    apply((l) => addGuests(l, guests, ids));
    setPasteOpen(false);
    showView("all");
    setSaid(`${counted(next.guests.length - before, "guest was", "guests were")} added.`);
    focusOn("next");
  };

  const takeRoomTables = (): void => {
    if (room.status !== "ready") return;
    const count = Math.min(room.tables.tables, TABLES_MAX);
    const seatsEach = room.tables.seatsEach.slice(0, count);
    const ids: readonly string[] = Array.from({ length: count }, () => crypto.randomUUID());
    apply((l) => {
      let next = setTables(l, count, commonest(seatsEach), ids);
      const made = next.tables.filter((t) => ids.includes(t.id)).sort((a, b) => a.number - b.number);
      made.forEach((table, at) => {
        const wanted = seatsEach[at];
        if (wanted !== undefined && wanted !== table.seats) next = setTableSeats(next, table.id, wanted);
      });
      return next;
    });
    showView("tables");
    focusOn("next");
  };

  const setTablesTo = (count: number, seats: number): boolean => {
    if (!Number.isFinite(count) || !Number.isFinite(seats)) return false;
    const target = Math.min(TABLES_MAX, Math.max(0, Math.trunc(count)));
    if (target === list.tables.length) {
      setTablesFormOpen(false);
      return true;
    }
    const ids = Array.from({ length: Math.max(0, target - list.tables.length) }, () => crypto.randomUUID());
    const next = setTables(list, count, seats, ids);
    apply((l) => setTables(l, count, seats, ids));
    const removed = list.tables.length - next.tables.length;
    const sentBack = summary(next).toSeat - counts.toSeat;
    if (removed > 0) {
      sayTables(`${counted(removed, "table was", "tables were")} removed.${sentBack > 0 ? ` ${counted(sentBack, "guest is", "guests are")} now to seat.` : ""}`);
    }
    setTablesFormOpen(false);
    showView("tables");
    focusOn("next");
    return true;
  };

  const seatAll = (): void => {
    const next = seatEveryone(list);
    apply(seatEveryone);
    setSaid(`${counted(summary(next).seated - counts.seated, "guest was", "guests were")} seated.`);
    focusOn("next");
  };

  const askPaste = (): void => {
    setPasteOpen(true);
    focusOn("box");
  };

  /** Closing the paste step: back to "Add guests", which opened it. */
  const closePaste = (): void => {
    setPasteOpen(false);
    focusOn("add-guests");
  };

  const openTablesForm = (from: "next" | "change-tables"): void => {
    setTablesFormFrom(from);
    setTablesFormOpen(true);
    focusOn("tables");
  };

  /** Cancelling the tables form: back to the button that opened it. */
  const cancelTablesForm = (): void => {
    setTablesFormOpen(false);
    focusOn(tablesFormFrom);
  };

  const editField = (change: (l: GuestList) => GuestList): void => {
    apply(change, { undo: !fieldVisit.current });
    fieldVisit.current = true;
  };

  const onTitle = (event: ChangeEvent<HTMLInputElement>): void => {
    const title = Array.from(event.target.value).slice(0, TITLE_MAX).join("");
    editField((l) => ({ ...l, title, changedSincePrint: true }));
  };

  /** The field shows the kept date again. */
  const showKeptDate = (): void => {
    const kept = list.eventDate ?? "";
    setDateDraft(kept);
    // A date half typed is not the field's value to React, so it is cleared here too.
    if (dateRef.current !== null) dateRef.current.value = kept;
  };

  /**
   * Keeps the date in the field, when it is left or on Enter. A date half
   * typed changes nothing; a date that would have the list removed at once
   * (its removal day is today or earlier) is refused and said so; clearing the
   * field sets no date.
   */
  const keepDate = (): void => {
    const typed = dateDraft;
    const kept = list.eventDate;
    if (typed === "") {
      // A date half typed reads as empty and as bad input.
      if (dateRef.current?.validity.badInput === true) {
        showKeptDate();
        return;
      }
      setDateRefused(false);
      if (kept !== null) editField((l) => ({ ...l, eventDate: null, changedSincePrint: true }));
      return;
    }
    if (typed === kept) return;
    if (!GuestListSchema.shape.eventDate.safeParse(typed).success) {
      showKeptDate();
      return;
    }
    if (eventDateRefused(typed, Date.now())) {
      setDateRefused(true);
      showKeptDate();
      return;
    }
    setDateRefused(false);
    editField((l) => ({ ...l, eventDate: typed, changedSincePrint: true }));
  };

  const onDateKey = (event: KeyEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      keepDate();
    } else if (event.key === "Escape") {
      showKeptDate();
    }
  };

  const roomName = room.status === "ready" ? room.name.trim() : "";
  const title = list.title.trim() !== "" ? list.title : roomName !== "" ? roomName : "Your event";
  const differ = room.status === "ready" ? tablesDiffer(room.tables, list) : null;
  const openTable = list.tables.find((t) => t.id === openTableId);
  const showing = showingWords(view, list, openTable?.number ?? null);
  const pasteShown = pasteOpen || counts.guests === 0;
  const chosenAt = chosen === undefined || chosen.tableId === null || chosen.seat === null
    ? undefined
    : { table: list.tables.find((t) => t.id === chosen.tableId)?.number, seat: chosen.seat };

  const plane: readonly { readonly view: View; readonly label: string; readonly value: number; readonly tone?: string }[] = [
    { view: "all", label: "Guests", value: counts.guests },
    { view: "seated", label: "Seated", value: counts.seated, tone: "settled" },
    { view: "to-seat", label: "To seat", value: counts.toSeat, tone: counts.toSeat > 0 ? "owed" : undefined },
    { view: "tables", label: "Tables", value: counts.tables },
  ];

  return (
    <div className="gl-desk" data-testid="guest-list-desk">
      <main className="gl-sheet">
        <header className="gl-head">
          <h1 className="gl-eyebrow" ref={headingRef} tabIndex={-1}>Guest list</h1>
          <label className="gl-title">
            <span className="gl-sr-only">The event's name</span>
            <input
              className="gl-title__input"
              value={list.title}
              placeholder={roomName !== "" ? roomName : "Name the event"}
              maxLength={TITLE_MAX}
              autoComplete="off"
              spellCheck={false}
              onChange={onTitle}
              onBlur={() => { fieldVisit.current = false; }}
            />
          </label>
          <div className="gl-date">
            <label className="gl-date__label" htmlFor={`${id}-date`}>Date of the event</label>
            <input
              ref={dateRef}
              id={`${id}-date`}
              className="gl-input gl-date__input"
              type="date"
              min={earliestEventDate(Date.now())}
              value={dateDraft}
              aria-describedby={dateRefused ? `${id}-date-refused` : undefined}
              onChange={(event) => { setDateDraft(event.target.value); }}
              onKeyDown={onDateKey}
              onBlur={() => {
                keepDate();
                fieldVisit.current = false;
              }}
            />
            {dateRefused && <p className="gl-date__refusal" id={`${id}-date-refused`} role="alert">{DATE_REFUSED}</p>}
          </div>
          <p className="gl-lede">
            {counts.guests === 0 ? (
              <span>There are no guests on this list yet.</span>
            ) : (
              <>
                <span className="gl-lede__count">{seatedSentence(counts.seated, counts.guests)}</span>
                {counts.toSeat > 0 && <>{" "}<span className="gl-lede__owed">{toSeatSentence(counts.toSeat)}</span></>}
              </>
            )}
          </p>
        </header>

        <dl className="gl-plane ws-plane" aria-label="The list in numbers">
          {plane.map((count) => (
            <div key={count.view} className="gl-count" data-tone={count.tone}>
              <dt id={`${id}-${count.view}-label`}>{count.label}</dt>
              <dd>
                {/* Read once, as the button's name; the button lies over the whole tile and draws its focus ring. */}
                <span id={`${id}-${count.view}-value`} className="gl-count__value" aria-hidden="true">{String(count.value)}</span>
                <button
                  type="button"
                  className="gl-count__button"
                  aria-pressed={view === count.view}
                  aria-labelledby={`${id}-${count.view}-label ${id}-${count.view}-value`}
                  onClick={() => { showView(count.view); }}
                />
              </dd>
            </div>
          ))}
        </dl>

        {/* Always on the page, so a notice that appears in it is announced; the two that warn of losing work are alerts. */}
        <div className="gl-notices" role="status">
          {unread ? (
            <div className="gl-notice" data-notice="unread" data-tone="alert" role="alert">
              <p>{NOT_OPENED}</p>
            </div>
          ) : !kept && (
            <div className="gl-notice" data-notice="not-kept" data-tone="alert" role="alert">
              <p>{NOT_KEPT}</p>
            </div>
          )}
          {notice !== null && (
            <div className="gl-notice" data-notice={notice.kind} data-tone="attention">
              <p>{noticeWords(notice)}</p>
              <button type="button" className="gl-link" onClick={() => { closeAndRefocus(closeNotice, null); }}>Close</button>
            </div>
          )}
          {room.status === "failed" && !roomNoticeClosed && (
            <div className="gl-notice" data-notice="room" data-tone="attention">
              <p>The room for this plan could not be opened, so its tables were not counted. Your list is unaffected.</p>
              <button type="button" className="gl-link" onClick={() => { closeAndRefocus(() => { setRoomNoticeClosed(true); }, null); }}>Close</button>
            </div>
          )}
          {differ !== null && (
            <div className="gl-notice" data-notice="differ" data-tone="attention">
              <p>{`The room has ${counted(differ.room, "table", "tables")}; your list has ${String(differ.list)}.`}</p>
            </div>
          )}
          {tableNotice !== null && (
            <div className="gl-notice" data-notice="tables" data-tone="settled">
              <p>{tableNotice}</p>
              <button type="button" className="gl-link" onClick={() => { closeAndRefocus(() => { setTableNotice(null); }, tableNoticeFrom.current); }}>Close</button>
            </div>
          )}
        </div>

        {chosen !== undefined && (
          <div className="gl-moving" role="group" aria-labelledby={`${id}-moving`}>
            <p className="gl-moving__words" translate="no" id={`${id}-moving`} ref={movingRef} tabIndex={-1}>
              {`Moving ${chosen.name}${chosenAt?.table === undefined ? "" : ` from table ${String(chosenAt.table)}, seat ${String(chosenAt.seat)}`}. Choose a free seat or a table.`}
            </p>
            <p className="gl-moving__hint">Escape lets go.</p>
            <div className="gl-actions">
              <button type="button" className="gl-button gl-button--quiet" onClick={finishMoving}>Let go</button>
              {chosenAt !== undefined && (
                <button type="button" className="gl-button gl-button--quiet" onClick={() => { place(null); }}>Leave without a seat</button>
              )}
            </div>
            {/* Always there while the group is, so a refusal that arrives in it is announced; empty, it takes no space. */}
            <p className="gl-moving__refusal" role="status">{refusal ?? ""}</p>
          </div>
        )}

        <p className="gl-said" role="status" translate="no">{said}</p>

        {pasteShown && (
          <GuestPaste
            roomLeft={GUESTS_MAX - counts.guests}
            onAdd={addPasted}
            onClose={counts.guests > 0 ? closePaste : undefined}
            boxRef={boxRef}
          />
        )}

        {counts.guests > 0 && (
          <>
            <div className="gl-ledger-head">
              <p className="gl-showing" ref={showingRef} tabIndex={-1} aria-live="polite">{showing ?? ""}</p>
              <div className="gl-actions">
                {!pasteShown && (
                  <button ref={addGuestsRef} type="button" className="gl-button gl-button--quiet" onClick={askPaste}>Add guests</button>
                )}
                {view === "tables" && !tablesFormOpen && (
                  <button ref={changeTablesRef} type="button" className="gl-button gl-button--quiet" onClick={() => { openTablesForm("change-tables"); }}>
                    Change the number of tables
                  </button>
                )}
              </div>
            </div>
            <section className="gl-ledger" aria-label="Guests and tables">
              {view === "tables" ? (
                <GuestTables
                  list={list}
                  openTableId={openTable === undefined ? null : openTable.id}
                  onToggle={(tableId) => { setOpenTableId((was) => (was === tableId ? null : tableId)); }}
                  moving={movingId}
                  onChoose={choose}
                  onPlace={(tableId, seat) => { place(tableId, seat); }}
                  onChange={(change) => { apply(change); }}
                  onNotice={sayTables}
                />
              ) : (
                <GuestRows
                  list={list}
                  filter={view}
                  moving={movingId}
                  onChoose={choose}
                  onChange={(change) => { apply(change); }}
                  onFocusHead={() => { focusOn("showing"); }}
                />
              )}
            </section>
          </>
        )}
      </main>

      <GuestPanel
        planId={planId}
        list={list}
        title={title}
        kept={kept}
        canDelete={!unread}
        canUndo={canUndo}
        room={room}
        tablesFormOpen={tablesFormOpen}
        nextRef={(element) => { nextRef.current = element; }}
        tablesFieldRef={(element) => { tablesFieldRef.current = element; }}
        onPaste={askPaste}
        onUseRoomTables={takeRoomTables}
        onOpenTablesForm={() => { openTablesForm("next"); }}
        onCloseTablesForm={cancelTablesForm}
        onSetTables={setTablesTo}
        onSeatEveryone={seatAll}
        onUndo={() => {
          undoLast();
          // What the status line said (where a guest sits, how many were added) may no longer be true.
          setSaid("");
        }}
        onErase={onErase}
      />
    </div>
  );
}
