import { useEffect, useId, useRef, useState, type ReactElement } from "react";
import {
  BUILDING_CHECKS_MAX,
  buildingBoardDay,
  type BuildingCheck,
  type BuildingCheckKind,
  type BuildingChecksDay,
  type SupplierArrival,
} from "@omnitwin/types";
import { ActivityIndicator, ActivityStatus } from "../../components/shared/Activity.js";
import { formatInlineDay, formatWallTime, msToWallInput, wallInputToMs } from "../diary/lib/board-time.js";
import type { BuildingDay, BuildingHold, BuildingMoment } from "./lib/building-day.js";
import { listKey, type BuildingChecksApi } from "./lib/use-building-checks.js";
import type { SupplierArrivalsApi } from "./lib/use-supplier-arrivals.js";

// ---------------------------------------------------------------------------
// The building (T-693): when it must be open and when it can be locked up,
// from everything that needs it that day, and the venue's own checks for
// each, ticked by the floor with who and when. A booking that holds the
// building across the day's edge is named instead of a time. Whoever is
// marked in and not out is named, with Gone for the floor, whether or not
// the checks could be read. While last night's lock-up may still be ticked
// and is not done, its list stands on today's board, ticked against last
// night. The lists are the venue's words, kept by its administrators: a
// building with none says so rather than offering an invented list.
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

function onList(list: readonly BuildingCheck[]): readonly BuildingCheck[] {
  return list.filter((check) => !check.retired);
}

function done(list: readonly BuildingCheck[]): number {
  return list.filter((check) => check.mark !== null).length;
}

/** "07:00", or "01:00, after midnight" when it falls past the board's date. */
function momentTime(moment: BuildingMoment, boardDate: string, timeZone: string): string {
  const date = msToWallInput(moment.atMs, timeZone).slice(0, 10);
  return `${formatWallTime(moment.atMs, timeZone)}${date > boardDate ? ", after midnight" : ""}`;
}

/** What holds the building across the day's edge, in a sentence. */
function holdSentence(hold: BuildingHold, edge: "from" | "until", clock: Clock): string {
  const day = (ms: number): string => formatInlineDay(ms, clock.nowMs, clock.timeZone);
  if (hold.days) return `${hold.title} runs from ${day(hold.fromMs)} to ${day(hold.toMs)}; its daily hours are not on the Diary.`;
  const through = `${hold.title} ${hold.setsUp ? "sets up" : "runs"} through the night.`;
  return edge === "from" ? `Open since last night: ${through}` : `No lock-up tonight: ${through}`;
}

/** The tick's time, and its day when that is not the list's own. */
function tickWords(check: BuildingCheck, listDay: string, clock: Clock): string {
  if (check.mark === null) return "";
  const atMs = Date.parse(check.mark.doneAt);
  const elsewhere = buildingBoardDay(atMs, clock.dayBoundaryHour, clock.timeZone) !== listDay;
  return `${check.mark.doneByName} · ${formatWallTime(atMs, clock.timeZone)}${elsewhere ? ` on ${formatInlineDay(atMs, clock.nowMs, clock.timeZone)}` : ""}`;
}

function ListEditor({ kind, checks, busy, onSave, onCancel }: {
  readonly kind: BuildingCheckKind;
  readonly checks: readonly BuildingCheck[];
  readonly busy: boolean;
  /** The list as it should be, and the ids it was opened on. */
  readonly onSave: (items: readonly { readonly id?: string; readonly label: string }[], expected: readonly string[]) => void;
  readonly onCancel: () => void;
}): ReactElement {
  const id = useId();
  // The list as it was when the editor opened: what a save is checked against.
  const [expected] = useState(() => onList(checks).map((check) => check.id));
  const [items, setItems] = useState<readonly { readonly key: string; readonly id?: string; readonly label: string }[]>(
    () => onList(checks).map((check) => ({ key: check.id, id: check.id, label: check.label })),
  );
  const [problem, setProblem] = useState<string | null>(null);
  const added = useRef(0);
  const listRef = useRef<HTMLOListElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  // Where the keyboard goes after a check is added or taken off.
  const [focusRow, setFocusRow] = useState<number | null>(null);
  useEffect(() => {
    if (focusRow === null) return;
    const inputs = listRef.current?.querySelectorAll("input") ?? [];
    const row = inputs[Math.min(focusRow, inputs.length - 1)];
    if (row instanceof HTMLInputElement) row.focus();
    else addRef.current?.focus();
  }, [focusRow, items.length]);
  const move = (index: number, by: number): void => {
    setItems((current) => {
      const next = [...current];
      const [item] = next.splice(index, 1);
      if (item !== undefined) next.splice(index + by, 0, item);
      return next;
    });
  };
  const words = KIND_WORDS[kind];
  const full = items.length >= BUILDING_CHECKS_MAX;
  return (
    <form
      className="dayboard-checks-editor"
      aria-label={`Change the ${words.short} checks`}
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        if (items.some((item) => item.label.trim().length === 0)) {
          setProblem("Write each check, or take it off.");
          return;
        }
        setProblem(null);
        onSave(items.map((item) => (item.id === undefined ? { label: item.label.trim() } : { id: item.id, label: item.label.trim() })), expected);
      }}
    >
      <ol ref={listRef}>
        {items.map((item, index) => (
          <li key={item.key}>
            <input
              aria-label={`${words.title}, ${String(index + 1)}`}
              value={item.label}
              maxLength={200}
              onChange={(event) => { const label = event.target.value; setItems((current) => current.map((other) => (other.key === item.key ? { ...other, label } : other))); }}
            />
            <button type="button" className="dayboard-button" aria-label={`Move “${item.label}” up`} disabled={index === 0} onClick={() => { move(index, -1); }}>↑</button>
            <button type="button" className="dayboard-button" aria-label={`Move “${item.label}” down`} disabled={index === items.length - 1} onClick={() => { move(index, 1); }}>↓</button>
            <button type="button" className="dayboard-button" aria-label={`Take “${item.label}” off`}
              onClick={() => { setItems((current) => current.filter((other) => other.key !== item.key)); setFocusRow(index); }}>Take off</button>
          </li>
        ))}
      </ol>
      <button ref={addRef} type="button" className="dayboard-button" aria-disabled={full}
        onClick={() => {
          if (full) return;
          added.current += 1;
          setItems((current) => [...current, { key: `${id}-new-${String(added.current)}`, label: "" }]);
          setFocusRow(items.length);
        }}>Add a check</button>
      {full && <p className="dayboard-checks-note">A list holds {BUILDING_CHECKS_MAX} checks at most.</p>}
      {problem !== null && <p className="dayboard-checks-problem" role="status">{problem}</p>}
      <div className="dayboard-checks-editor-actions">
        <button type="submit" className="dayboard-button is-primary" aria-busy={busy} aria-disabled={busy}>
          {busy && <ActivityIndicator size={14} />}Save the list
        </button>
        <button type="button" className="dayboard-button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function ChecksList({ kind, title, day, api, clock, userId, canTick, canPlan }: {
  readonly kind: BuildingCheckKind;
  /** The list's heading, when not the kind's own ("Last night's lock-up, Sat 14 Nov"). */
  readonly title?: string;
  readonly day: BuildingChecksDay;
  readonly api: BuildingChecksApi;
  readonly clock: Clock;
  readonly userId: string | null;
  /** The floor may tick this day's checks now. */
  readonly canTick: boolean;
  /** The office: writes the lists, and takes back anyone's tick. */
  readonly canPlan: boolean;
}): ReactElement {
  const [editing, setEditing] = useState(false);
  const changeRef = useRef<HTMLButtonElement>(null);
  const [backToChange, setBackToChange] = useState(0);
  useEffect(() => { if (backToChange > 0) changeRef.current?.focus(); }, [backToChange]);
  const words = KIND_WORDS[kind];
  const checks = day[kind];
  const current = onList(checks);
  const heading = title ?? words.title;
  const closeEditor = (): void => { setEditing(false); setBackToChange((count) => count + 1); };
  return (
    <div className="dayboard-checks" role="group" aria-label={heading}>
      <h3 className="dayboard-checks-title">
        {heading}
        {current.length > 0 && <span className="dayboard-checks-count"> {done(current)} of {current.length}</span>}
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
            <p className="dayboard-checks-none">
              {canPlan ? `No ${words.short} checks yet. Write the building’s own.` : `No ${words.short} checks are set up. The office can write the building’s own.`}
            </p>
          ) : (
            <ul className="dayboard-checks-list">
              {checks.map((check) => {
                const busy = api.busy.has(check.id);
                // A tick is taken back by whoever made it, or by the office.
                const mine = check.mark !== null && (canPlan || (userId !== null && check.mark.doneByUserId === userId));
                const enabled = canTick && (check.mark === null ? !check.retired : mine);
                return (
                  <li key={check.id} className={check.mark === null ? undefined : "is-done"}>
                    <label>
                      <input
                        type="checkbox"
                        checked={check.mark !== null}
                        disabled={!enabled}
                        aria-busy={busy}
                        onChange={(event) => { if (!busy) void api.tick(check, event.target.checked); }}
                      />
                      <span className="dayboard-checks-label">{check.label}{check.retired ? " (since taken off the list)" : ""}</span>
                    </label>
                    {busy && <ActivityIndicator size={14} />}
                    {check.mark !== null && <span className="dayboard-checks-who">{tickWords(check, day.day, clock)}</span>}
                    <p className="dayboard-checks-problem" role="status">{api.failures.get(check.id) ?? ""}</p>
                  </li>
                );
              })}
            </ul>
          )}
          {canPlan && title === undefined && (
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

/** Who is marked in and not out, with Gone for the floor. */
function StillIn({ arrivals, boardDate, clock, suppliers, canMark }: {
  readonly arrivals: readonly SupplierArrival[];
  readonly boardDate: string;
  readonly clock: Clock;
  readonly suppliers: Pick<SupplierArrivalsApi, "busy" | "failures" | "step"> | null;
  readonly canMark: boolean;
}): ReactElement {
  return (
    <div className="dayboard-still-in" role="group" aria-label="Marked in, not out">
      <h3 className="dayboard-checks-title">Marked in, not out</h3>
      <ul className="dayboard-checks-list">
        {arrivals.map((arrival) => {
          const inMs = Date.parse(arrival.arrivedAt ?? arrival.arrivesAt);
          const elsewhere = buildingBoardDay(inMs, clock.dayBoundaryHour, clock.timeZone) !== boardDate;
          const busy = suppliers?.busy.has(arrival.id) ?? false;
          return (
            <li key={arrival.id}>
              <span className="dayboard-checks-label">
                {arrival.supplierName} · in at {formatWallTime(inMs, clock.timeZone)}{elsewhere ? ` on ${formatInlineDay(inMs, clock.nowMs, clock.timeZone)}` : ""}
              </span>
              {canMark && suppliers !== null && (
                <button type="button" className="dayboard-button" aria-busy={busy} aria-disabled={busy} aria-label={`${arrival.supplierName} gone`}
                  onClick={() => { if (!busy) void suppliers.step(arrival, "left"); }}>
                  {busy && <ActivityIndicator size={14} />}Gone
                </button>
              )}
              <p className="dayboard-checks-problem" role="status">{suppliers?.failures.get(arrival.id) ?? ""}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function BuildingSection({ building, api, lastNight = null, boardDate, dayBoundaryHour, timeZone, nowMs, userId, canTick, canPlan, canMark = false, suppliers = null }: {
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
  /** The office: writes the lists, and takes back anyone's tick. */
  readonly canPlan: boolean;
  /** The floor, on today's board: marks a supplier gone. */
  readonly canMark?: boolean;
  readonly suppliers?: Pick<SupplierArrivalsApi, "busy" | "failures" | "step"> | null;
}): ReactElement | null {
  const [retried, setRetried] = useState(false);
  const clock: Clock = { timeZone, nowMs, dayBoundaryHour };
  const day = api.day;
  const lastNightDay = lastNight?.api.day ?? null;
  // Last night's lock-up stands here only while it is not done.
  const lastNightLockup = lastNightDay === null ? [] : onList(lastNightDay.lockup);
  const lastNightOpen = lastNightLockup.some((check) => check.mark === null);
  const hasTimes = building.openBy !== null || building.lockUpAfter !== null || building.heldFrom !== null || building.heldUntil !== null;
  const hasChecks = day !== null && (day.opening.length > 0 || day.lockup.length > 0);
  if (!hasTimes && !hasChecks && building.stillIn.length === 0 && api.status !== "failed" && !lastNightOpen && !canPlan) return null;

  const day1 = (ms: number): string => formatInlineDay(ms, nowMs, timeZone);
  const sameLongHold = building.heldFrom !== null && building.heldUntil !== null && building.heldFrom.days && building.heldUntil.days
    && building.heldFrom.title === building.heldUntil.title;
  const openWords = building.openBy !== null
    ? `Open by ${momentTime(building.openBy, boardDate, timeZone)}`
    : building.heldFrom === null ? null
      : sameLongHold ? `${building.heldFrom.title} runs all day`
        : building.heldFrom.days ? `${building.heldFrom.title} since ${day1(building.heldFrom.fromMs)}` : "Open since last night";
  const lockWords = building.lockUpAfter !== null
    ? `Lock up after ${momentTime(building.lockUpAfter, boardDate, timeZone)}`
    : building.heldUntil === null || sameLongHold ? null
      : building.heldUntil.days ? `${building.heldUntil.title} until ${day1(building.heldUntil.toMs)}` : "No lock-up tonight";
  const counts = day === null ? [] : (["opening", "lockup"] as const)
    .map((kind) => ({ kind, current: onList(day[kind]) }))
    .filter((entry) => entry.current.length > 0)
    .map((entry) => `${KIND_WORDS[entry.kind].short} ${String(done(entry.current))} of ${String(entry.current.length)}`);
  const lastNightWords = lastNightOpen ? `last night’s lock-up ${String(done(lastNightLockup))} of ${String(lastNightLockup.length)}` : null;
  const stillInWords = building.stillIn.length === 0 ? null : `${String(building.stillIn.length)} marked in, not out`;
  const line = [openWords, lockWords, lastNightWords, ...counts, stillInWords].filter((part): part is string => part !== null);
  const holdLines = sameLongHold
    ? [holdSentence(building.heldFrom, "from", clock)]
    : [
      ...(building.heldFrom === null ? [] : [holdSentence(building.heldFrom, "from", clock)]),
      ...(building.heldUntil === null ? [] : [holdSentence(building.heldUntil, "until", clock)]),
    ];
  const lastNightTitle = lastNightDay === null ? "" : `Last night’s lock-up, ${day1(wallInputToMs(`${lastNightDay.day}T12:00`, timeZone) ?? nowMs)}`;

  return (
    <section className="dayboard-building" aria-label="The building">
      <details className="dayboard-building-details">
        <summary>
          <span className="dayboard-building-title">The building</span>
          {line.length > 0 && <span className="dayboard-building-line">{line.join(" · ")}</span>}
        </summary>
        <div className="dayboard-building-body">
          {(building.openBy !== null || building.lockUpAfter !== null || holdLines.length > 0) && (
            <div className="dayboard-building-moments">
              {building.openBy !== null && openWords !== null && <p><strong>{openWords}</strong> · {building.openBy.why}</p>}
              {holdLines.map((words) => <p key={words}>{words}</p>)}
              {building.lockUpAfter !== null && <p><strong>{`Lock up after ${momentTime(building.lockUpAfter, boardDate, timeZone)}`}</strong> · {building.lockUpAfter.why}</p>}
            </div>
          )}
          {building.stillIn.length > 0 && (
            <StillIn arrivals={building.stillIn} boardDate={boardDate} clock={clock} suppliers={suppliers} canMark={canMark} />
          )}
          {lastNight !== null && lastNightDay !== null && lastNightOpen && (
            <div className="dayboard-checks-pair">
              <ChecksList kind="lockup" title={lastNightTitle} day={lastNightDay} api={lastNight.api} clock={clock} userId={userId}
                canTick={lastNight.canTick} canPlan={canPlan} />
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
              <ChecksList kind="opening" day={day} api={api} clock={clock} userId={userId} canTick={canTick} canPlan={canPlan} />
              <ChecksList kind="lockup" day={day} api={api} clock={clock} userId={userId} canTick={canTick} canPlan={canPlan} />
            </div>
          )}
        </div>
      </details>
    </section>
  );
}
