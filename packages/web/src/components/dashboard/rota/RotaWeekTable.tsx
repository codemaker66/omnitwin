import { useId, useRef, type KeyboardEvent, type ReactElement } from "react";
import { Plus } from "lucide-react";
import {
  STAFF_UNAVAILABILITY_LABELS,
  rotaClock,
  rotaDurationShort,
  rotaInstant,
  rotaWeekDates,
  addRotaDays,
  type RotaPerson,
  type RotaShift,
  type RotaWeek,
  type StaffRecord,
  type StaffUnavailability,
} from "@omnitwin/types";
import { ShiftChip } from "./ShiftChip.js";
import { dayTile, personFacts, personMeta, shiftDate, type DayFunctions, type FunctionLine } from "./rota-format.js";

// ---------------------------------------------------------------------------
// The week as the Diary reads it: people down the side, days across, and the
// week's Confirmed functions along the top. On a phone it is one day at a
// time, chosen from day tabs. Unfilled needs sit in their own row, in copper.
// ---------------------------------------------------------------------------

export interface RotaWeekActions {
  readonly onOpenShift: ((shift: RotaShift, trigger: HTMLElement) => void) | null;
  readonly onAdd: ((personId: string | null, date: string, trigger: HTMLElement) => void) | null;
  readonly onOpenPerson: ((personId: string, trigger: HTMLElement) => void) | null;
}

interface WeekProps extends RotaWeekActions {
  readonly week: RotaWeek;
  /** Null while the Diary's functions are loading or unavailable. */
  readonly functions: ReadonlyMap<string, DayFunctions> | null;
  readonly today: string;
  readonly selectedShiftId: string | null;
}

interface CellAway {
  readonly label: string;
}

function awayLabel(absence: StaffUnavailability, date: string, timeZone: string): string {
  const dayStart = rotaInstant(date, 0, timeZone);
  const dayEnd = rotaInstant(addRotaDays(date, 1), 0, timeZone);
  const start = Date.parse(absence.startsAt);
  const end = Date.parse(absence.endsAt);
  const reason = STAFF_UNAVAILABILITY_LABELS[absence.reason];
  if (start <= dayStart && end >= dayEnd) return reason;
  if (start > dayStart && end < dayEnd) return `${reason} ${rotaClock(start, timeZone)}–${rotaClock(end, timeZone)}`;
  return start > dayStart ? `${reason} from ${rotaClock(start, timeZone)}` : `${reason} until ${rotaClock(end, timeZone)}`;
}

/** What each cell holds: shifts by person (or unfilled) and day, and leave. */
function weekCells(week: RotaWeek): {
  readonly shifts: ReadonlyMap<string, readonly RotaShift[]>;
  readonly away: ReadonlyMap<string, CellAway>;
  /** Working minutes each person is rostered this week, breaks aside. */
  readonly worked: ReadonlyMap<string, number>;
} {
  const shifts = new Map<string, RotaShift[]>();
  const worked = new Map<string, number>();
  for (const shift of week.shifts) {
    const key = `${shift.staffMemberId ?? "unfilled"}|${shiftDate(shift, week.timeZone)}`;
    shifts.set(key, [...(shifts.get(key) ?? []), shift]);
    if (shift.staffMemberId !== null && shift.status !== "cancelled") {
      const minutes = (Date.parse(shift.endsAt) - Date.parse(shift.startsAt)) / 60_000 - shift.breakMinutes;
      worked.set(shift.staffMemberId, (worked.get(shift.staffMemberId) ?? 0) + minutes);
    }
  }
  const away = new Map<string, CellAway>();
  for (const date of rotaWeekDates(week.weekStart)) {
    const dayStart = rotaInstant(date, 0, week.timeZone);
    const dayEnd = rotaInstant(addRotaDays(date, 1), 0, week.timeZone);
    for (const absence of week.unavailability) {
      if (Date.parse(absence.startsAt) < dayEnd && Date.parse(absence.endsAt) > dayStart) {
        away.set(`${absence.staffMemberId}|${date}`, { label: awayLabel(absence, date, week.timeZone) });
      }
    }
  }
  return { shifts, away, worked };
}

function FunctionBlock({ line }: { readonly line: FunctionLine }): ReactElement {
  const meta = [line.room, line.times, line.guests === null ? null : `${String(line.guests)} guests`]
    .filter((part): part is string => part !== null).join(" · ");
  return (
    <div className="rota-fn">
      <span className="rota-fn__title">{line.title}</span>
      <span className="rota-fn__meta">{meta}</span>
    </div>
  );
}

function LikelyLine({ line }: { readonly line: FunctionLine }): ReactElement {
  return (
    <p className="rota-fn-likely">
      <span className="rota-fn-likely__hold">{line.hold}</span> {line.title}{line.room === null ? "" : ` · ${line.room}`}
    </p>
  );
}

function DayFunctionsList({ day }: { readonly day: DayFunctions | undefined }): ReactElement | null {
  if (day === undefined) return null;
  return (
    <>
      {day.confirmed.map((line) => <FunctionBlock key={line.id} line={line} />)}
      {day.likely.length > 0 && (
        <div className="rota-fn-likely-group" aria-label="Likely, not yet confirmed">
          {day.likely.map((line) => <LikelyLine key={line.id} line={line} />)}
        </div>
      )}
    </>
  );
}

function PersonHeading({ person, record, workedMinutes, today, onOpenPerson }: {
  readonly person: RotaPerson;
  readonly record: StaffRecord | undefined;
  readonly workedMinutes: number | undefined;
  readonly today: string;
  readonly onOpenPerson: RotaWeekActions["onOpenPerson"];
}): ReactElement {
  const attention = record === undefined ? [] : personFacts(record, today).filter((fact) => fact.attention);
  return (
    <div className="rota-person">
      {onOpenPerson === null
        ? <span className="rota-person__name">{person.displayName}</span>
        : <button type="button" className="rota-person__name rota-person__open"
          aria-label={`${person.displayName}: open their staff record`}
          onClick={(event) => { onOpenPerson(person.id, event.currentTarget); }}>{person.displayName}</button>}
      <span className="rota-person__meta">{personMeta(person)}{person.isActive ? "" : " · No longer on the rota"}</span>
      {workedMinutes !== undefined && workedMinutes > 0 && <span className="rota-person__hours">{rotaDurationShort(workedMinutes)} this week</span>}
      {attention.map((fact) => <span key={fact.text} className="rota-person__fact">{fact.text}</span>)}
    </div>
  );
}

function Cell({ week, personId, personName, date, cells, selectedShiftId, actions, label }: {
  readonly week: RotaWeek;
  readonly personId: string | null;
  readonly personName: string | null;
  readonly date: string;
  readonly cells: ReturnType<typeof weekCells>;
  readonly selectedShiftId: string | null;
  readonly actions: RotaWeekActions;
  readonly label: string;
}): ReactElement {
  const key = `${personId ?? "unfilled"}|${date}`;
  const shifts = cells.shifts.get(key) ?? [];
  const away = personId === null ? undefined : cells.away.get(key);
  const { onAdd } = actions;
  return (
    <div className="rota-cell" data-away={away === undefined ? undefined : "true"} data-empty={shifts.length === 0 ? "true" : undefined}>
      {away !== undefined && <p className="rota-away">{away.label}</p>}
      {shifts.map((shift) => (
        <ShiftChip key={shift.id} shift={shift} personName={personName} timeZone={week.timeZone}
          selected={shift.id === selectedShiftId} onOpen={actions.onOpenShift} />
      ))}
      {onAdd !== null && (
        <button type="button" className="rota-add" data-compact={shifts.length > 0 ? "true" : undefined}
          aria-label={label} onClick={(event) => { onAdd(personId, date, event.currentTarget); }}>
          <Plus aria-hidden="true" size={16} strokeWidth={1.75} />
        </button>
      )}
    </div>
  );
}

function recordsById(week: RotaWeek): ReadonlyMap<string, StaffRecord> {
  return new Map(week.records.map((record) => [record.id, record]));
}

export function RotaWeekTable({ week, functions, today, selectedShiftId, onOpenShift, onAdd, onOpenPerson }: WeekProps): ReactElement {
  const dates = rotaWeekDates(week.weekStart);
  const cells = weekCells(week);
  const records = recordsById(week);
  const actions: RotaWeekActions = { onOpenShift, onAdd, onOpenPerson };
  const showUnfilled = week.access !== "own";
  return (
    <div className="rota-table-wrap">
      <table className="rota-table">
        <caption className="vv-sr-only">The rota for the week, people down the side and days across</caption>
        <colgroup>
          <col className="rota-table__people" />
          {dates.map((date) => <col key={date} />)}
        </colgroup>
        <thead>
          <tr>
            <td className="rota-table__corner" />
            {dates.map((date) => {
              const tile = dayTile(date);
              return (
                <th key={date} scope="col" aria-label={tile.full}>
                  <span className="rota-tile" data-today={date === today ? "true" : undefined}>
                    <span className="rota-tile__weekday">{tile.weekday}</span>
                    <span className="rota-tile__day">{tile.day}</span>
                    <span className="rota-tile__month">{tile.month}</span>
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {functions !== null && (
            <tr className="rota-table__functions">
              <th scope="row"><span className="rota-row-label">Functions</span></th>
              {dates.map((date) => <td key={date}><DayFunctionsList day={functions.get(date)} /></td>)}
            </tr>
          )}
          {showUnfilled && (
            <tr className="rota-table__unfilled">
              <th scope="row"><span className="rota-row-label" data-tone="attention">Unfilled</span></th>
              {dates.map((date) => (
                <td key={date}>
                  <Cell week={week} personId={null} personName={null} date={date} cells={cells} selectedShiftId={selectedShiftId}
                    actions={actions} label={`Add an unfilled need on ${dayTile(date).full}`} />
                </td>
              ))}
            </tr>
          )}
          {week.people.map((person) => (
            <tr key={person.id}>
              <th scope="row">
                <PersonHeading person={person} record={records.get(person.id)} workedMinutes={cells.worked.get(person.id)} today={today} onOpenPerson={onOpenPerson} />
              </th>
              {dates.map((date) => (
                <td key={date}>
                  <Cell week={week} personId={person.id} personName={person.displayName} date={date} cells={cells}
                    selectedShiftId={selectedShiftId} actions={actions} label={`Add a shift for ${person.displayName} on ${dayTile(date).full}`} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RotaDayList({
  week, functions, today, selectedShiftId, onOpenShift, onAdd, onOpenPerson, day, onDayChange,
}: WeekProps & { readonly day: string; readonly onDayChange: (date: string) => void }): ReactElement {
  const dates = rotaWeekDates(week.weekStart);
  const cells = weekCells(week);
  const records = recordsById(week);
  const actions: RotaWeekActions = { onOpenShift, onAdd, onOpenPerson };
  const tabsId = useId();
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const current = dates.includes(day) ? day : dates[0] ?? day;
  const tile = dayTile(current);

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const target = event.key === "ArrowRight" ? index + 1 : event.key === "ArrowLeft" ? index - 1
      : event.key === "Home" ? 0 : event.key === "End" ? dates.length - 1 : null;
    if (target === null) return;
    event.preventDefault();
    const next = dates[(target + dates.length) % dates.length];
    if (next === undefined) return;
    onDayChange(next);
    tabRefs.current.get(next)?.focus();
  };

  return (
    <div className="rota-days">
      <div className="rota-days__tabs" role="tablist" aria-label="Days of the week">
        {dates.map((date, index) => {
          const dayOf = dayTile(date);
          const count = week.shifts.filter((shift) => shift.status !== "cancelled" && shiftDate(shift, week.timeZone) === date).length;
          return (
            <button key={date} type="button" role="tab" id={`${tabsId}-${date}`} aria-controls={`${tabsId}-panel`}
              aria-selected={date === current} tabIndex={date === current ? 0 : -1} aria-label={`${dayOf.full}, ${String(count)} ${count === 1 ? "shift" : "shifts"}`}
              className="rota-days__tab" data-today={date === today ? "true" : undefined}
              ref={(element) => { if (element === null) tabRefs.current.delete(date); else tabRefs.current.set(date, element); }}
              onClick={() => { onDayChange(date); }} onKeyDown={(event) => { move(event, index); }}>
              <span className="rota-days__weekday">{dayOf.weekday}</span>
              <span className="rota-days__date">{dayOf.day}</span>
            </button>
          );
        })}
      </div>
      <section className="rota-days__panel" role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${current}`}>
        <h2 className="rota-days__title">{tile.full}</h2>
        {functions !== null && (functions.get(current)?.confirmed.length ?? 0) + (functions.get(current)?.likely.length ?? 0) > 0 && (
          <div className="rota-days__functions">
            <p className="rota-row-label">Functions</p>
            <DayFunctionsList day={functions.get(current)} />
          </div>
        )}
        <ul className="rota-days__people">
          {week.access !== "own" && (
            <li className="rota-days__person" data-unfilled="true">
              <span className="rota-row-label" data-tone="attention">Unfilled</span>
              <Cell week={week} personId={null} personName={null} date={current} cells={cells} selectedShiftId={selectedShiftId}
                actions={actions} label={`Add an unfilled need on ${tile.full}`} />
            </li>
          )}
          {week.people.map((person) => (
            <li key={person.id} className="rota-days__person">
              <PersonHeading person={person} record={records.get(person.id)} workedMinutes={cells.worked.get(person.id)} today={today} onOpenPerson={onOpenPerson} />
              <Cell week={week} personId={person.id} personName={person.displayName} date={current} cells={cells}
                selectedShiftId={selectedShiftId} actions={actions} label={`Add a shift for ${person.displayName} on ${tile.full}`} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
