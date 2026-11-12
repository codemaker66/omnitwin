import { Fragment, useEffect, useId, useRef, useState, type ReactElement } from "react";
import {
  BUILDING_CHECK_LABEL_MAX,
  BUILDING_CHECKS_MAX,
  buildingBoardDay,
  type BuildingCheck,
  type BuildingCheckKind,
  type BuildingChecksDay,
  type SupplierArrival,
} from "@omnitwin/types";
import { ActivityIndicator, ActivityStatus } from "../../components/shared/Activity.js";
import { formatInlineDay, formatWallTime, msToWallInput, wallInputToMs } from "../diary/lib/board-time.js";
import type { BuildingDay, BuildingHold, BuildingMoment, LongHold } from "./lib/building-day.js";
import { listKey, type BuildingChecksApi } from "./lib/use-building-checks.js";
import type { SupplierArrivalsApi } from "./lib/use-supplier-arrivals.js";

// ---------------------------------------------------------------------------
// The building (T-693): when it must be open and when it can be locked up,
// from everything that needs it that day, and the venue's own checks for
// each, ticked by the floor with who and when. A booking that holds the
// building across the day's edge is named instead of a time. While the
// suppliers are being read, or could not be read, the line says so, since
// its times and its count of who is in may then leave someone out. Whoever
// is marked in and not out is named, with Gone for the floor, whether or not
// the checks could be read; one marked gone here stays named, with Undo,
// while the board shows the day. While last night's lock-up may still be
// ticked and is not done, its list stands on today's board, ticked against
// last night. The lists are the venue's words, kept by its administrators on
// today's board or a later one: a building with none says so rather than
// offering an invented list.
// ---------------------------------------------------------------------------

const KIND_WORDS: Readonly<Record<BuildingCheckKind, { readonly title: string; readonly short: string }>> = {
  opening: { title: "Opening checks", short: "opening" },
  lockup: { title: "Lock-up checks", short: "lock-up" },
};

interface Clock {
  readonly timeZone: string;
  readonly nowMs: number;
  readonly dayBoundaryHour: number;
}

/** What the building reads of the suppliers. */
export type BuildingSuppliers = Pick<SupplierArrivalsApi, "status" | "reading" | "arrivals" | "earlier" | "busy" | "failures" | "refresh" | "step" | "undo">;

const NO_IDS: readonly string[] = [];

function onList(list: readonly BuildingCheck[]): readonly BuildingCheck[] {
  return list.filter((check) => !check.retired);
}

function done(list: readonly BuildingCheck[]): number {
  return list.filter((check) => check.mark !== null).length;
}

/** A booking's name, and that it is provisional when it is. */
function named(hold: BuildingHold): string {
  return `${hold.title}${hold.provisional ? " (provisional)" : ""}`;
}

/** "07:00", or "01:00, after midnight" when it falls past the board's date. */
function momentTime(moment: BuildingMoment, boardDate: string, timeZone: string): string {
  const date = msToWallInput(moment.atMs, timeZone).slice(0, 10);
  return `${formatWallTime(moment.atMs, timeZone)}${date > boardDate ? ", after midnight" : ""}`;
}

/** What holds the building across the day's edge, in a sentence. */
function holdSentence(hold: BuildingHold, edge: "from" | "until"): string {
  const through = `${named(hold)} ${hold.setsUp ? "sets up" : "runs"} through the night.`;
  return edge === "from" ? `Open since last night: ${through}` : `No lock-up tonight: ${through}`;
}

/** A booking running for days, in a sentence. */
function longSentence(hold: LongHold, clock: Clock): string {
  const day = (ms: number): string => formatInlineDay(ms, clock.nowMs, clock.timeZone);
  return `${named(hold)} runs from ${day(hold.fromMs)} to ${day(hold.toMs)}; its daily hours are not on the Diary.`;
}

/** The same, for the one-line summary. */
function longWords(hold: LongHold, clock: Clock): string {
  if (hold.startsToday) return `${named(hold)} runs on to ${formatInlineDay(hold.toMs, clock.nowMs, clock.timeZone)}`;
  return hold.endsToday ? `${named(hold)} ends today` : `${named(hold)} runs all day`;
}

/** The tick's time, and its day when that is not the list's own. */
function tickWords(check: BuildingCheck, listDay: string, clock: Clock): string {
  if (check.mark === null) return "";
  const atMs = Date.parse(check.mark.doneAt);
  const elsewhere = buildingBoardDay(atMs, clock.dayBoundaryHour, clock.timeZone) !== listDay;
  return `${check.mark.doneByName} · ${formatWallTime(atMs, clock.timeZone)}${elsewhere ? ` on ${formatInlineDay(atMs, clock.nowMs, clock.timeZone)}` : ""}`;
}

/** A check in the editor, by its words, or by its place while it has none. */
function editorName(label: string, index: number): string {
  return label.trim().length > 0 ? `“${label}”` : `new check ${String(index + 1)}`;
}

function ListEditor({ kind, checks, busy, onSave, onCancel }: {
  readonly kind: BuildingCheckKind;
  readonly checks: readonly BuildingCheck[];
  readonly busy: boolean;
  /** The list as it should be, and the ids it was opened on, in order. */
  readonly onSave: (items: readonly { readonly id?: string; readonly label: string }[], expected: readonly string[]) => void;
  readonly onCancel: () => void;
}): ReactElement {
  const id = useId();
  const problemId = `${id}-problem`;
  // The list as it was when the editor opened: what a save is checked against.
  const [expected] = useState(() => onList(checks).map((check) => check.id));
  const [items, setItems] = useState<readonly { readonly key: string; readonly id?: string; readonly label: string }[]>(
    () => onList(checks).map((check) => ({ key: check.id, id: check.id, label: check.label })),
  );
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const added = useRef(0);
  const listRef = useRef<HTMLOListElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  // Where the keyboard goes: the first check as the editor opens, then after one is added or taken off.
  const [focusRow, setFocusRow] = useState<number | null>(0);
  useEffect(() => {
    if (focusRow === null) return;
    const inputs = listRef.current?.querySelectorAll("input") ?? [];
    const row = inputs[Math.min(focusRow, inputs.length - 1)];
    if (row instanceof HTMLInputElement) row.focus();
    else addRef.current?.focus();
  }, [focusRow, items.length]);
  // A moved check keeps the keyboard: on the same arrow, or on its words once
  // that arrow stops at the end of the list.
  const moved = useRef<{ readonly key: string; readonly direction: "up" | "down" } | null>(null);
  const [movedCount, setMovedCount] = useState(0);
  useEffect(() => {
    const target = moved.current;
    moved.current = null;
    if (target === null) return;
    const row = [...(listRef.current?.querySelectorAll<HTMLElement>("li") ?? [])].find((item) => item.dataset["key"] === target.key);
    const arrow = row?.querySelector<HTMLButtonElement>(`button[data-move="${target.direction}"]`);
    if (arrow !== null && arrow !== undefined && !arrow.disabled) arrow.focus();
    else row?.querySelector("input")?.focus();
  }, [movedCount]);
  const move = (index: number, by: -1 | 1): void => {
    const item = items[index];
    const next = [...items];
    next.splice(index, 1);
    if (item === undefined) return;
    next.splice(index + by, 0, item);
    setItems(next);
    moved.current = { key: item.key, direction: by < 0 ? "up" : "down" };
    setMovedCount((count) => count + 1);
    setSaid(`${editorName(item.label, index)} moved to ${String(index + by + 1)} of ${String(next.length)}.`);
  };
  const words = KIND_WORDS[kind];
  const full = items.length >= BUILDING_CHECKS_MAX;
  const blank = (label: string): boolean => label.trim().length === 0;
  return (
    <form
      className="dayboard-checks-editor"
      aria-label={`Change the ${words.short} checks`}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        if (items.some((item) => blank(item.label))) {
          setProblem("Write each check, or take it off.");
          // The keyboard goes to the first check without words.
          [...(listRef.current?.querySelectorAll("input") ?? [])].find((input) => blank(input.value))?.focus();
          return;
        }
        setProblem(null);
        onSave(items.map((item) => (item.id === undefined ? { label: item.label.trim() } : { id: item.id, label: item.label.trim() })), expected);
      }}
    >
      <ol ref={listRef}>
        {items.map((item, index) => {
          const name = editorName(item.label, index);
          const invalid = problem !== null && blank(item.label);
          return (
            <li key={item.key} data-key={item.key}>
              <input
                aria-label={`${words.title}, ${String(index + 1)}`}
                aria-invalid={invalid}
                aria-describedby={invalid ? problemId : undefined}
                value={item.label}
                maxLength={BUILDING_CHECK_LABEL_MAX}
                onChange={(event) => { const label = event.target.value; setItems((current) => current.map((other) => (other.key === item.key ? { ...other, label } : other))); }}
              />
              <button type="button" className="dayboard-button" data-move="up" aria-label={`Move ${name} up`} disabled={index === 0} onClick={() => { move(index, -1); }}>↑</button>
              <button type="button" className="dayboard-button" data-move="down" aria-label={`Move ${name} down`} disabled={index === items.length - 1} onClick={() => { move(index, 1); }}>↓</button>
              <button type="button" className="dayboard-button" aria-label={`Take ${name} off`}
                onClick={() => {
                  setItems((current) => current.filter((other) => other.key !== item.key));
                  setFocusRow(index);
                  setSaid(`${name} taken off.`);
                }}>Take off</button>
            </li>
          );
        })}
      </ol>
      <button ref={addRef} type="button" className="dayboard-button" aria-disabled={full}
        onClick={() => {
          if (full) return;
          added.current += 1;
          setItems((current) => [...current, { key: `${id}-new-${String(added.current)}`, label: "" }]);
          setFocusRow(items.length);
        }}>Add a check</button>
      {full && <p className="dayboard-checks-note">A list holds {BUILDING_CHECKS_MAX} checks at most.</p>}
      <p id={problemId} className="dayboard-checks-problem" role="status">{problem ?? ""}</p>
      <p className="dayboard-sr" role="status">{said}</p>
      <div className="dayboard-checks-editor-actions">
        <button type="submit" className="dayboard-button is-primary" aria-busy={busy} aria-disabled={busy}>
          {busy && <ActivityIndicator size={14} />}Save the list
        </button>
        <button type="button" className="dayboard-button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function ChecksList({ kind, title, day, api, clock, userId, canTick, tickNote, canPlan, current }: {
  readonly kind: BuildingCheckKind;
  /** The list's heading, when not the kind's own ("Last night's lock-up, Sat 14 Nov"). */
  readonly title?: string;
  readonly day: BuildingChecksDay;
  readonly api: BuildingChecksApi;
  readonly clock: Clock;
  readonly userId: string | null;
  /** The floor may tick this day's checks now. */
  readonly canTick: boolean;
  /** Why not, when it may not: read with each box that cannot be ticked. */
  readonly tickNote: string;
  /** The office: takes back anyone's tick, and writes the lists. */
  readonly canPlan: boolean;
  /** The day shown is today's or a later one, whose list is the venue's list now. */
  readonly current: boolean;
}): ReactElement {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const changeRef = useRef<HTMLButtonElement>(null);
  const [backToChange, setBackToChange] = useState(0);
  useEffect(() => { if (backToChange > 0) changeRef.current?.focus(); }, [backToChange]);
  const words = KIND_WORDS[kind];
  const checks = day[kind];
  const onNow = onList(checks);
  const heading = title ?? words.title;
  // The list is written on today's board or a later one, never from a past day's list.
  const canChange = canPlan && current && title === undefined;
  const closeEditor = (): void => { setEditing(false); setBackToChange((count) => count + 1); };
  const none = !current
    ? `No ${words.short} checks were set up for this day.`
    : canPlan ? `No ${words.short} checks yet. Write the building’s own.` : `No ${words.short} checks are set up. The office can write the building’s own.`;
  return (
    <div className="dayboard-checks" role="group" aria-label={heading} data-checks={title === undefined ? kind : undefined} tabIndex={-1}>
      <h3 className="dayboard-checks-title">
        {heading}
        {onNow.length > 0 && <span className="dayboard-checks-count"> {done(onNow)} of {onNow.length}</span>}
      </h3>
      {editing ? (
        <ListEditor
          kind={kind}
          checks={checks}
          busy={api.busy.has(listKey(kind))}
          onSave={(items, expected) => {
            void api.replace(kind, items, expected).then((outcome) => { if (outcome !== "failed") closeEditor(); });
          }}
          onCancel={closeEditor}
        />
      ) : (
        <>
          {checks.length === 0 ? (
            <p className="dayboard-checks-none">{none}</p>
          ) : (
            <ul className="dayboard-checks-list">
              {checks.map((check) => {
                const busy = api.busy.has(check.id);
                // A tick is taken back by whoever made it, or by the office.
                const mine = check.mark !== null && (canPlan || (userId !== null && check.mark.doneByUserId === userId));
                const enabled = canTick && (check.mark === null ? !check.retired : mine);
                const whoId = `${id}-${check.id}-who`;
                const whyId = `${id}-${check.id}-why`;
                const why = enabled ? null
                  : !canTick ? tickNote
                    : check.mark !== null ? `${check.mark.doneByName} ticked this. Only they, or the office, can take it back.` : null;
                const described = [check.mark === null ? null : whoId, why === null ? null : whyId].filter((part) => part !== null).join(" ");
                return (
                  <li key={check.id} className={check.mark === null ? undefined : "is-done"}>
                    <label>
                      <input
                        type="checkbox"
                        checked={check.mark !== null}
                        disabled={!enabled}
                        aria-busy={busy}
                        aria-describedby={described === "" ? undefined : described}
                        onChange={(event) => { if (!busy) void api.tick(check, event.target.checked); }}
                      />
                      <span className="dayboard-checks-label">{check.label}{check.retired ? " (since taken off the list)" : ""}</span>
                    </label>
                    {busy && <ActivityIndicator size={14} />}
                    {check.mark !== null && <span id={whoId} className="dayboard-checks-who">{tickWords(check, day.day, clock)}</span>}
                    {why !== null && <span id={whyId} className="dayboard-sr">{why}</span>}
                    <p className="dayboard-checks-problem" role="status">{api.failures.get(check.id) ?? ""}</p>
                  </li>
                );
              })}
            </ul>
          )}
          {canChange && (
            <button ref={changeRef} type="button" className="dayboard-checks-change" onClick={() => { setEditing(true); }}>
              {checks.length === 0 ? `Write the ${words.short} checks` : `Change the ${words.short} checks`}
            </button>
          )}
        </>
      )}
      <p className="dayboard-checks-problem" role="status">{api.failures.get(listKey(kind)) ?? ""}</p>
    </div>
  );
}

/** When someone was marked in, earliest first. */
function byIn(a: SupplierArrival, b: SupplierArrival): number {
  return Date.parse(a.arrivedAt ?? a.arrivesAt) - Date.parse(b.arrivedAt ?? b.arrivesAt);
}

/**
 * Who is marked in and not out, with Gone for the floor. One marked gone
 * here stays named, with Undo, so a tap on the wrong row is put right where
 * it was made: for someone in since another day, nowhere else on the board.
 */
function StillIn({ rows, boardDate, clock, suppliers, canMark, asLastRead, onGone, onBack }: {
  readonly rows: readonly SupplierArrival[];
  readonly boardDate: string;
  readonly clock: Clock;
  readonly suppliers: BuildingSuppliers | null;
  readonly canMark: boolean;
  /** The suppliers could not be read since: these are as last read. */
  readonly asLastRead: boolean;
  readonly onGone: (id: string) => void;
  readonly onBack: (id: string) => void;
}): ReactElement {
  const [said, setSaid] = useState("");
  // One tap at a time per supplier, from this list's own record as well as the hook's.
  const [working, setWorking] = useState<ReadonlySet<string>>(new Set());
  const listRef = useRef<HTMLUListElement>(null);
  // A tapped button leaves with its step; if that dropped the keyboard's place
  // to the document, it goes to the same supplier's other button.
  const focusTo = useRef<string | null>(null);
  const [focusAsked, setFocusAsked] = useState(0);
  useEffect(() => {
    const target = focusTo.current;
    focusTo.current = null;
    if (target === null) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    const item = [...(listRef.current?.querySelectorAll<HTMLElement>("li") ?? [])].find((row) => row.dataset["arrival"] === target);
    (item?.querySelector<HTMLButtonElement>("button") ?? listRef.current?.closest<HTMLElement>("[role=group]"))?.focus();
  }, [focusAsked]);
  const tap = (arrival: SupplierArrival, act: "gone" | "undo"): void => {
    if (suppliers === null || working.has(arrival.id) || suppliers.busy.has(arrival.id)) return;
    setWorking((current) => new Set([...current, arrival.id]));
    void (act === "gone" ? suppliers.step(arrival, "left") : suppliers.undo(arrival, "left")).then((outcome) => {
      setWorking((current) => new Set([...current].filter((id) => id !== arrival.id)));
      if (outcome === "saved") {
        if (act === "gone") onGone(arrival.id);
        else onBack(arrival.id);
        setSaid(act === "gone" ? `${arrival.supplierName} marked gone.` : `${arrival.supplierName} no longer marked gone.`);
      }
      focusTo.current = arrival.id;
      setFocusAsked((count) => count + 1);
    });
  };
  const heading = asLastRead ? "Marked in, not out, as last read" : "Marked in, not out";
  return (
    <div className="dayboard-still-in" role="group" aria-label={heading} tabIndex={-1}>
      <h3 className="dayboard-checks-title">{heading}</h3>
      <ul ref={listRef} className="dayboard-checks-list">
        {rows.map((arrival) => {
          const inMs = Date.parse(arrival.arrivedAt ?? arrival.arrivesAt);
          const elsewhere = buildingBoardDay(inMs, clock.dayBoundaryHour, clock.timeZone) !== boardDate;
          const busy = working.has(arrival.id) || (suppliers?.busy.has(arrival.id) ?? false);
          const gone = arrival.leftAt === null ? null : formatWallTime(Date.parse(arrival.leftAt), clock.timeZone);
          return (
            <li key={arrival.id} data-arrival={arrival.id} className={gone === null ? undefined : "is-gone"}>
              <span className="dayboard-checks-label">
                {arrival.supplierName} · in at {formatWallTime(inMs, clock.timeZone)}{elsewhere ? ` on ${formatInlineDay(inMs, clock.nowMs, clock.timeZone)}` : ""}
                {gone === null ? "" : `, gone at ${gone}`}
              </span>
              {canMark && suppliers !== null && (gone === null ? (
                <button type="button" className="dayboard-button" aria-busy={busy} aria-disabled={busy} aria-label={`${arrival.supplierName} gone`}
                  onClick={() => { tap(arrival, "gone"); }}>
                  {busy && <ActivityIndicator size={14} />}Gone
                </button>
              ) : (
                <button type="button" className="dayboard-checks-change" aria-busy={busy} aria-disabled={busy} aria-label={`Undo: ${arrival.supplierName} marked gone`}
                  onClick={() => { tap(arrival, "undo"); }}>
                  {busy && <ActivityIndicator size={14} />}Undo
                </button>
              ))}
              <p className="dayboard-checks-problem" role="status">{suppliers?.failures.get(arrival.id) ?? ""}</p>
            </li>
          );
        })}
      </ul>
      <p className="dayboard-sr" role="status">{said}</p>
    </div>
  );
}

/** A part of the one-line summary; a working part shows the work under way. */
interface LinePart {
  readonly words: string;
  readonly working?: boolean;
}

export function BuildingSection({
  building, api, lastNight = null, boardDate, dayBoundaryHour, timeZone, nowMs, userId, canTick,
  tickNote = "Checks are ticked on the day itself, and last night’s the morning after.", canPlan, current = true,
  canMark = false, suppliers = null,
}: {
  readonly building: BuildingDay;
  /** The board day's checks. */
  readonly api: BuildingChecksApi;
  /** Last night's checks, while they may still be ticked from today's board. */
  readonly lastNight?: { readonly api: BuildingChecksApi; readonly canTick: boolean } | null;
  /** The board's day, YYYY-MM-DD on the venue's clock, and the hour it rolls. */
  readonly boardDate: string;
  readonly dayBoundaryHour: number;
  readonly timeZone: string;
  readonly nowMs: number;
  readonly userId: string | null;
  /** The floor may tick this board day's checks now. */
  readonly canTick: boolean;
  /** Why a box cannot be ticked here, read with it. */
  readonly tickNote?: string;
  /** The office: takes back anyone's tick, and writes the lists. */
  readonly canPlan: boolean;
  /** The board shows today or a later day, whose lists are the venue's lists now: only then are they changed here. */
  readonly current?: boolean;
  /** The floor, on today's board: marks a supplier gone. */
  readonly canMark?: boolean;
  readonly suppliers?: BuildingSuppliers | null;
}): ReactElement | null {
  const [retried, setRetried] = useState(false);
  const [suppliersRetried, setSuppliersRetried] = useState(false);
  const [said, setSaid] = useState("");
  const sectionRef = useRef<HTMLElement>(null);
  // Suppliers marked gone from this board, kept named with Undo while it shows the day.
  const [goneHere, setGoneHere] = useState<{ readonly day: string; readonly ids: readonly string[] }>({ day: boardDate, ids: NO_IDS });
  const goneIds = goneHere.day === boardDate ? goneHere.ids : NO_IDS;
  const clock: Clock = { timeZone, nowMs, dayBoundaryHour };
  const day = api.day;
  const lastNightDay = lastNight?.api.day ?? null;
  // Last night's lock-up stands here only while it is not done.
  const lastNightLockup = lastNightDay === null ? [] : onList(lastNightDay.lockup);
  const lastNightOpen = lastNightLockup.some((check) => check.mark === null);
  // When it is done, the board says so and keeps the keyboard in the section.
  const wasOpen = useRef(lastNightOpen);
  useEffect(() => {
    const was = wasOpen.current;
    wasOpen.current = lastNightOpen;
    if (!was || lastNightOpen || lastNightDay === null) return;
    setSaid("Last night’s lock-up is done.");
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    const section = sectionRef.current;
    (section?.querySelector<HTMLElement>("[data-checks=\"lockup\"]") ?? section?.querySelector<HTMLElement>("summary"))?.focus();
  }, [lastNightOpen, lastNightDay]);

  const suppliersState = suppliers === null || suppliers.status === "idle" ? "ready" : suppliers.status;
  const known = suppliers === null ? [] : [...suppliers.earlier, ...suppliers.arrivals];
  const goneRows = goneIds.flatMap((id) => {
    const arrival = known.find((item) => item.id === id);
    return arrival !== undefined && arrival.arrivedAt !== null && arrival.leftAt !== null ? [arrival] : [];
  });
  const stillRows = [...building.stillIn, ...goneRows.filter((gone) => !building.stillIn.some((still) => still.id === gone.id))].sort(byIn);

  const hasTimes = building.openBy !== null || building.lockUpAfter !== null || building.heldFrom !== null || building.heldUntil !== null
    || building.longHolds.length > 0;
  const hasChecks = day !== null && (day.opening.length > 0 || day.lockup.length > 0);
  if (!hasTimes && !hasChecks && stillRows.length === 0 && api.status !== "failed" && suppliersState !== "failed" && !lastNightOpen && !canPlan) {
    return null;
  }

  const openWords = building.openBy !== null
    ? `Open by ${momentTime(building.openBy, boardDate, timeZone)}`
    : building.heldFrom === null ? null : "Open since last night";
  const lockWords = building.lockUpAfter !== null
    ? `Lock up after ${momentTime(building.lockUpAfter, boardDate, timeZone)}`
    : building.heldUntil === null ? null : "No lock-up tonight";
  const counts = day === null ? [] : (["opening", "lockup"] as const)
    .map((kind) => ({ kind, onNow: onList(day[kind]) }))
    .filter((entry) => entry.onNow.length > 0)
    .map((entry) => `${KIND_WORDS[entry.kind].short} ${String(done(entry.onNow))} of ${String(entry.onNow.length)}`);
  const lastNightWords = lastNightOpen ? `last night’s lock-up ${String(done(lastNightLockup))} of ${String(lastNightLockup.length)}` : null;
  const stillInWords = building.stillIn.length === 0
    ? null
    : `${String(building.stillIn.length)} marked in, not out${suppliersState === "failed" ? ", as last read" : ""}`;
  // The times and who is in count the suppliers: until they are read, the line says so.
  const suppliersPart: LinePart | null = suppliersState === "loading"
    ? { words: "reading the suppliers…", working: true }
    : suppliersState === "failed" ? { words: "suppliers could not be read" } : null;
  const line: LinePart[] = [
    ...[openWords, lockWords, ...building.longHolds.map((hold) => longWords(hold, clock)), lastNightWords, ...counts, stillInWords]
      .filter((words): words is string => words !== null)
      .map((words) => ({ words })),
    ...(suppliersPart === null ? [] : [suppliersPart]),
  ];
  const holdLines = [
    ...(building.heldFrom === null ? [] : [holdSentence(building.heldFrom, "from")]),
    ...building.longHolds.map((hold) => longSentence(hold, clock)),
    ...(building.heldUntil === null ? [] : [holdSentence(building.heldUntil, "until")]),
  ];
  const lastNightTitle = lastNightDay === null
    ? ""
    : `Last night’s lock-up, ${formatInlineDay(wallInputToMs(`${lastNightDay.day}T12:00`, timeZone) ?? nowMs, nowMs, timeZone)}`;

  return (
    <section ref={sectionRef} className="dayboard-building" aria-label="The building">
      <details className="dayboard-building-details">
        <summary>
          <span className="dayboard-building-title">The building</span>
          {line.length > 0 && (
            <span className="dayboard-building-line">
              {line.map((part, index) => (
                <Fragment key={`${String(index)}:${part.words}`}>
                  {index > 0 && " · "}
                  {part.working === true && <ActivityIndicator size={14} />}
                  {part.words}
                </Fragment>
              ))}
            </span>
          )}
        </summary>
        <div className="dayboard-building-body">
          {(building.openBy !== null || building.lockUpAfter !== null || holdLines.length > 0) && (
            <div className="dayboard-building-moments">
              {building.openBy !== null && openWords !== null && <p><strong>{openWords}</strong> · {building.openBy.why}</p>}
              {holdLines.map((words) => <p key={words}>{words}</p>)}
              {building.lockUpAfter !== null && <p><strong>{`Lock up after ${momentTime(building.lockUpAfter, boardDate, timeZone)}`}</strong> · {building.lockUpAfter.why}</p>}
            </div>
          )}
          {suppliers !== null && suppliersState === "failed" && (
            <div className="dayboard-checks-failed">
              <p>The suppliers could not be read just now, so these times, and who is marked in, may leave someone out.</p>
              <button type="button" className="dayboard-button" aria-busy={suppliersRetried && suppliers.reading}
                onClick={() => { setSuppliersRetried(true); suppliers.refresh(); }}>
                {suppliersRetried && suppliers.reading && <ActivityIndicator size={14} />}Try again
              </button>
            </div>
          )}
          {stillRows.length > 0 && (
            <StillIn
              rows={stillRows}
              boardDate={boardDate}
              clock={clock}
              suppliers={suppliers}
              canMark={canMark}
              asLastRead={suppliersState === "failed"}
              onGone={(id) => { setGoneHere((now) => ({ day: boardDate, ids: [...(now.day === boardDate ? now.ids : NO_IDS), id] })); }}
              onBack={(id) => { setGoneHere((now) => ({ day: boardDate, ids: (now.day === boardDate ? now.ids : NO_IDS).filter((other) => other !== id) })); }}
            />
          )}
          {lastNight !== null && lastNightDay !== null && lastNightOpen && (
            <div className="dayboard-checks-pair">
              <ChecksList kind="lockup" title={lastNightTitle} day={lastNightDay} api={lastNight.api} clock={clock} userId={userId}
                canTick={lastNight.canTick} tickNote={tickNote} canPlan={canPlan} current={false} />
            </div>
          )}
          {api.status === "loading" && day === null && <ActivityStatus>Reading the building’s checks…</ActivityStatus>}
          {api.status === "failed" && (
            <div className="dayboard-checks-failed">
              <p>{day === null ? "The building’s checks could not be read just now." : "The building’s checks could not be read just now; these are as last read."}</p>
              <button type="button" className="dayboard-button" aria-busy={retried && api.reading}
                onClick={() => { setRetried(true); api.refresh(); }}>
                {retried && api.reading && <ActivityIndicator size={14} />}Try again
              </button>
            </div>
          )}
          {day !== null && (
            <div className="dayboard-checks-pair">
              <ChecksList kind="opening" day={day} api={api} clock={clock} userId={userId} canTick={canTick} tickNote={tickNote} canPlan={canPlan} current={current} />
              <ChecksList kind="lockup" day={day} api={api} clock={clock} userId={userId} canTick={canTick} tickNote={tickNote} canPlan={canPlan} current={current} />
            </div>
          )}
        </div>
      </details>
      <p className="dayboard-sr" role="status">{said}</p>
    </section>
  );
}
